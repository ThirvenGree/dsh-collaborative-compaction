import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the installed settings component through its real module/slot entrypoint.
// Effects are intentionally not mounted: inspecting a status must not invoke a model.
const source=fs.readFileSync(new URL('../client.js',import.meta.url),'utf8');
function panel(state,{tab='settings'}={}){
 let Component,hook=0,requests=0;
 const draft=Object.fromEntries(Object.entries(state.config).map(([k,v])=>[k,typeof v==='number'?String(v):v]));
 const values=[state,draft,'',tab,false,null];
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState:value=>[hook<values.length?values[hook++]:value,()=>{}],useEffect:()=>{},useRef:value=>({current:value})};
 const slots={inject:(_name,fn)=>fn(),register:(_meta,component)=>{Component=component;}};
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load:definition=>definition.factory(()=>react).apply({get:()=>slots})}},
  fetch:()=>{requests++;throw Error('render must not fetch');},setInterval,clearInterval,setTimeout,clearTimeout,URL});
 const nodes=[];
 function visit(node){
  if(node==null||typeof node==='boolean')return '';
  if(Array.isArray(node))return node.map(visit).join(' ');
  if(typeof node!=='object')return String(node);
  if(typeof node.type==='function')return visit(node.type({...node.props,children:node.children}));
  nodes.push(node);return node.type==='style'?'':node.children.map(visit).join(' ');
 }
 return {text:visit(Component()),nodes,requests:()=>requests};
}
const base={health:'ready',config:{enabled:true,replayFeedbackEnabled:true,replayHarvestEnabled:false,
 replaySliceCalls:12,replayDailyCalls:120,replayDailyTokens:1000000,replaySliceMs:120000,replayResumeMinutes:15},
 replay:{running:false,policy:{active:{version:0}},effectivePolicy:{version:0,rules:[]},schedule:{reason:'等待后台小批初始化。'}}};

test('settings distinguish bootstrap, cost pause, failed attempt and complete baseline without claiming promotion',()=>{
 const stamp=Date.parse('2026-11-04T01:00:00Z');
 const paused={...base,calibration:{kind:'bootstrap',status:'paused',phase:'bootstrap',reason:'每日请求预算不足',
  nextAt:stamp,updatedAt:stamp,completedTasks:6,coverage:{completed:1,total:4},
  usage:{day:'2026-11-04',calls:120,tokens:40000,estimatedTokens:1000}}};
 const rendered=panel(paused);
 assert.match(rendered.text,/已保存进度，等待继续/);
 assert.match(rendered.text,/每日请求预算不足/);
 assert.match(rendered.text,/1 \/ 4/);
 assert.match(rendered.text,/120 \/ 120/);
 assert.match(rendered.text,/其中保守估算/);
 assert.match(rendered.text,/当前实际策略 v0/);
 assert.equal(rendered.requests(),0);
 assert.doesNotMatch(rendered.text,/请.*手动完成一次校准|先手动完成一轮/);
 const failed=panel({...paused,calibration:{...paused.calibration,status:'failed',reason:'Provider timeout'}});
 assert.match(failed.text,/暂未完成，等待恢复/);assert.match(failed.text,/Provider timeout/);
 const complete=panel({...base,replay:{...base.replay,policy:{...base.replay.policy,baseline:{at:stamp,coverage:{completed:4,total:4},failures:['omitted-tool']}}},
  calibration:{kind:'bootstrap',status:'completed',phase:'bootstrap'}});
 assert.match(complete.text,/建立基线只表示完成诊断，不表示新的压缩策略已获准/);
 assert.match(complete.text,/待复核问题：原工具名/);
 assert.match(complete.text,/当前实际策略 v0/);
 const stale=panel({...base,replay:{...base.replay,policy:{baseline:{at:stamp,current:false}}}});
 assert.match(stale.text,/尚无当前范围的完整基线/);
});

test('settings expose budget fields and disable background status when the master plugin is off',()=>{
 const rendered=panel({...base,config:{...base.config,enabled:false}});
 assert.match(rendered.text,/后台校准已关闭/);
 for(const [id,min,max]of [['replaySliceCalls',1,100],['replayDailyCalls',1,10000],['replayDailyTokens',1000,100000000],['replaySliceMs',1000,600000],['replayResumeMinutes',1,1440]]){
  const input=rendered.nodes.find(node=>node.type==='input'&&node.props.id==='dcc-f-'+id);
  assert(input,id+' control missing');assert.equal(input.props.inputMode,'numeric');assert.equal(input.props['aria-invalid'],'false');
  for(const value of [min-1,max+1]){
   const invalid=panel({...base,config:{...base.config,[id]:value}}).nodes.find(node=>node.type==='input'&&node.props.id==='dcc-f-'+id);
   assert.equal(invalid.props['aria-invalid'],'true',id+' must reject '+value);
  }
 }
 assert.equal(rendered.requests(),0);
});

test('running phase overrides a saved phase and budget pauses are not displayed as provider failures',()=>{
 const state={...base,replay:{...base.replay,running:true,progress:{phase:'validation/candidate-repeat-2',startedAt:Date.now()},
  calibration:{kind:'validation',status:'running',phase:'validation/discovery-old-1'}},runs:[
   {id:'paused-at-review',startedAt:Date.now(),status:'paused',error:'本批调用预算已用完',stages:[{name:'review',status:'paused',error:'本批调用预算已用完'}]}
  ]};
 const rendered=panel(state,{tab:'runs'});
 assert.match(rendered.text,/当前阶段：第二次独立生成候选摘要/);
 assert.match(rendered.text,/预算暂停/);
 assert.match(rendered.text,/等待续跑/);
 assert(rendered.nodes.some(node=>node.props.className==='dcc-error dcc-tone-warn'));
});

test('harvest remains configured on while review is off and discloses original-text recipients and separate costs',()=>{
 const state={...base,config:{...base.config,replayHarvestEnabled:true,reviewEnabled:false,aProvider:'deepseek',aModel:'ds-flash',reviewModel:'terra',reviewBase:'https://review.example/v1'},
  replay:{...base.replay,harvest:{configured:true,enabled:false,blockedReason:'交叉审核已关闭；自动提炼已暂停。',reviewEndpoint:'https://review.example/v1/responses',reviewModel:'terra',today:{attempts:0,limit:4}}}};
 const result=panel(state);
 assert.match(result.text,/已暂停：交叉审核关闭/);
 assert.match(result.text,/交叉审核已关闭；自动提炼已暂停/);
 assert.match(result.text,/https:\/\/review\.example\/v1\/responses/);
 assert.match(result.text,/deepseek \/ ds-flash/);
 assert.match(result.text,/脱敏发生在模型处理之后/);
 assert.match(result.text,/不计入上方策略校准/);
 assert.match(result.text,/今日提炼任务/);
 assert.match(result.text,/不是 4 次模型调用/);
 const toggle=result.nodes.find(node=>node.props['aria-label']==='从正式压缩中提炼脱敏回放样例');
 assert(toggle);assert.equal(toggle.props['aria-checked'],'true');
 assert.equal(result.requests(),0);
 const enabled=panel({...state,config:{...state.config,reviewEnabled:true},replay:{...state.replay,harvest:{...state.replay.harvest,enabled:true,blockedReason:null}}});
 assert.match(enabled.text,/已开启，等待压缩结果/);
 assert.doesNotMatch(enabled.text,/已暂停：交叉审核关闭/);
});
