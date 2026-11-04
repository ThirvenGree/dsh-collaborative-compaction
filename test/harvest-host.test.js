import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {validationCases,emptyPolicy} from '../feedback.js';

const engine=process.env.COLLAB_TEST_ENGINE||path.resolve(import.meta.dirname,'../../billion-context-collab');
const available=fs.existsSync(path.join(engine,'dist/external-summary-settings.js'));
const fakeBase='https://harvest-review.invalid/v1';
const source='PRIVATE-HARVEST-CedarWindow7。私人联系人李沐说明：批准版本是冬稿四版。联系地址 contact-private@example.invalid。';
const summary='PRIVATE-HARVEST-SUMMARY：已经安排装订，项目继续进行。';
const omission={decision:'candidate',question:'PRIVATE-HARVEST-QUESTION：现在批准的版本是哪一版？',expected:'冬稿四版',quotes:[{role:'user',text:'批准版本是冬稿四版。'}]};
const original={id:'formal-omission',question:omission.question,expected:omission.expected,
 records:[{id:'formal-0',role:'user',text:omission.quotes[0].text}],requiredIds:['formal-0'],requiredQuotes:{'formal-0':omission.quotes[0].text}};
function fixture(id,question,expected,text,summary){
 const record=id+'-row';
 return {id,question,expected,records:[{id:record,role:'user',text}],requiredIds:[record],requiredQuotes:{[record]:expected},...(summary?{summary}:{})};
}
const groups=[{
 probe:fixture('glass-piece','复盘应该摆哪种棋子？只答材质。','玻璃棋子','棋局约定先用木棋子。新规确定改用玻璃棋子，旧规即刻停用。','棋局的器材已经备好。'),
 positive:fixture('trial-mode','复测之后设备该设为哪个档？只回答档位。','丙档','试验先设置乙档，复测结论改成丙档；乙档不再使用。'),
 counter:fixture('wax-proposal','封口最终采用哪一种蜡？只回答颜色和材料。','红蜡','原方案使用红蜡封口，另一个提议改用蓝蜡被否决，保留红蜡。')
},{
 probe:fixture('fan-site','房间的风扇最后放在什么方向？','西面','清扫之前风扇放北面，家具搬入后已经移到西面，不再按旧位置摆放。','房间清扫和家具布置均已完成。'),
 positive:fixture('pottery-glaze','重新确认之后陶杯采用哪种釉色？','白釉','陶杯原本安排薄荷绿，后来调色试样换成白釉，最终只采用更新的釉色。'),
 counter:fixture('cloth-patch','修补斗篷最后使用何种布料？','棉布','补料先选棉布，后来有人建议改用丝绸，但这个建议未采纳，原材料保持不变。')
}];
const secretError='PRIVATE-HARVEST-PROVIDER-ECHO '+source;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function until(predicate,message){
 for(let i=0;i<1000;i++){const value=await predicate();if(value)return value;await delay(15);}
 assert.fail(message);
}
function excerpt(row,id){
 const raw=row.records.find(r=>r.id===id).text,key=row.requiredQuotes?.[id]||raw;
 const at=raw.indexOf(key);assert.ok(at>=0);
 return raw.slice(Math.max(0,at-2),Math.min(raw.length,at+key.length+2));
}

test('authenticated production compression learns isolated synthetic cases, replay consumes them, restart deduplicates and failures do not leak private text',
 {skip:available?false:'Build the pinned engine and set COLLAB_TEST_ENGINE.',timeout:45000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harvest-host-'));
 const vars={DSH_COLLAB_TEST_HOME:dir,DSH_HOME:path.join(dir,'home'),BILI_CONFIG_FILE:path.join(dir,'engine.json'),
  DSH_PROFILE_DIR:undefined,LOCAL_HARVEST_REVIEW_KEY:'fixture-only'};
 const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]])),realFetch=globalThis.fetch;
 const env=values=>{for(const[k,v]of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
 env(vars);t.after(()=>{globalThis.fetch=realFetch;env(previous);fs.rmSync(dir,{recursive:true,force:true});});
 const {defaults,config}=await import('../runtime.js'),{apply}=await import('../host.js');const {scopeOf}=await import('../policy-scope.js');
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...defaults,enabled:true,replaySliceCalls:100,replayDailyCalls:10000,replayDailyTokens:100000000,replayFeedbackEnabled:false,replayHarvestEnabled:true,
  claudeEnabled:false,reviewEnabled:false,plannerEnabled:false,factCheckEnabled:false,
  aProvider:'fixture',aModel:'fixture-author',reviewBase:fakeBase,reviewKeyEnv:'LOCAL_HARVEST_REVIEW_KEY',retries:0}));
 fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 const bankFile=path.join(dir,'learned-replay-cases.json'),harvestFile=path.join(dir,'harvest-status.json'),reportFile=path.join(dir,'fixture-replay.json');
 let phase='first',ui,base,token,offs=[],forbiddenTransport=0,calibrations=0;
 const detectors=[],reviews=[],questions=[];
 const learned=()=>fs.existsSync(bankFile)?read(bankFile).entries.flatMap(e=>Object.values(e.group)):[];
 const cases=()=>[...validationCases,...learned(),...groups.flatMap(g=>Object.values(g)),original];
 globalThis.fetch=async(url,options)=>{
  const target=new URL(url);if(target.hostname==='127.0.0.1')return realFetch(url,options);
  if(target.href!==fakeBase+'/responses'){forbiddenTransport++;throw Error('Unexpected external transport');}
  const request=JSON.parse(options.body),input=JSON.parse(request.input.slice(request.input.indexOf('{')));
  assert.equal(input.task,'review-replay-case');assert.equal(request.store,false);reviews.push(input);
  if(phase==='review-error')throw Error(secretError);
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({decision:'approve',privacy:true,fidelity:true,answers:true,generalization:true,safe:true})}]}]});
 };
 async function* stream(request){
  const input=JSON.parse(request.messages[0].content[0].text);let output;
  if(typeof input.content==='string'){
   if(input.content.startsWith('PRIVATE-HARVEST'))output=summary;
   else{
    calibrations++;
    const retained=new Map();
    for(const row of cases())for(const id of row.requiredIds){if(input.content.includes('['+id+']'))retained.set(id,'['+id+'] '+excerpt(row,id));}
    output=[...retained.values()].join('\n')||'已完成虚构资料整理。';
   }
  }else if(input.task==='detect-compression-omission'){
   detectors.push(input);output=JSON.stringify(phase==='uncertain'?{decision:'uncertain'}:omission);
  }else if(input.task==='synthesize-replay-case'){
   output=JSON.stringify({group:groups[phase==='second'?1:0]});
  }else if(input.task==='propose-compression-clause')output=JSON.stringify({decision:'skip'});
  else{
   questions.push(input.question);
   const possible=cases().filter(c=>c.question===input.question);assert(possible.length,'unexpected reading question');
   const visible=input.material+' '+JSON.stringify(input.recall||[]);
   const row=possible.find(c=>c.records.some(r=>visible.includes('['+r.id)||visible.includes('"'+r.id+'"')))||possible[0];
   const citations=row.requiredIds.map(id=>({id,quote:excerpt(row,id)}));
   if(citations.every(c=>visible.includes(c.quote)))output=JSON.stringify({answer:row.expected,citations});
   else if(request.system.includes('可先')&&!input.recall)output=JSON.stringify({query:row.requiredQuotes[row.requiredIds[0]]});
   else output=JSON.stringify({answer:'unknown',citations:[]});
  }
  yield {type:'text-delta',text:output};yield {type:'finish',reason:{kind:'stop'}};
 }
 const hostFile=path.join(dir,'host.json');
 async function start(){
  fs.rmSync(hostFile,{force:true});
  apply({llm:{stream},webServer:{register(spec){ui=http.createServer(spec.handler);ui.listen(0,'127.0.0.1');return()=>new Promise(resolve=>ui.close(resolve));}},
   effect:fn=>{const off=fn();if(typeof off==='function')offs.push(off);}});
  const host=await until(()=>fs.existsSync(hostFile)&&read(hostFile),'host ready');
  base='http://127.0.0.1:'+host.port;token=fs.readFileSync(path.join(dir,'local-token'),'utf8');
 }
 async function stop(){for(const off of offs.reverse())await off();offs=[];}
 const stateURL=()=>`http://127.0.0.1:${ui.address().port}/dsh-collaborative-compaction/state`;
 const state=async()=>(await fetch(stateURL())).json();
 async function post(endpoint,data){
  const response=await fetch(base+endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});
  const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
 }
 async function settings(changes){
  const prior=await state();
  const response=await fetch(stateURL(),{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':prior.csrf},body:JSON.stringify({changes})});
  const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
 }
 async function compress(suffix='',extra={}){
  const response=await post('/v1/chat/completions',{model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'manual',maxSummaryChars:300,...extra}},
   messages:[{role:'user',content:JSON.stringify({content:source+suffix})}]});
  assert.equal(response.choices[0].message.content,summary);
 }
 async function settled(status){return until(async()=>{
  const value=await state();
  if(!value.replay.harvest.running&&value.replay.harvest.last&&value.replay.harvest.last.status!==status)
   assert.fail('unexpected harvest status '+JSON.stringify(value.replay.harvest)+' calls='+detectors.length+'/'+reviews.length);
  return !value.replay.harvest.running&&value.replay.harvest.last?.status===status&&value;
 },'harvest settles as '+status);}
 try{
  await start();await compress();const admitted=await settled('added');
  assert.equal(admitted.replay.harvest.approvedCount,1);assert.equal(detectors.length,1);assert.equal(reviews.length,1);
  assert.equal(admitted.replay.effectivePolicy.version,0,'admission does not itself activate a policy');
  assert.equal(admitted.replay.report,null,'learning works while auto strategy feedback is off');
  assert(fs.existsSync(bankFile));assert.equal(read(bankFile).entries[0].testedAt,0);
  await stop();await start();await compress();await delay(60);
  assert.equal(detectors.length,1,'restart must not relearn an admitted source+summary');
  assert.equal((await state()).replay.harvest.queued,0);

  // Prevent the unrelated weekly schedule; this run must be caused specifically by admitting
  // a new learned case. The normal production endpoint still initiates the whole chain.
  fs.writeFileSync(path.join(dir,'compression-policy.json'),JSON.stringify({...emptyPolicy(),baseline:{scope:scopeOf(config()),at:Date.now()-2*86400000,revision:0},lastAttempt:Date.now(),lastCompletedAt:Date.now(),manualBaselineAt:Date.now()-2*86400000}));
  await settings({replayFeedbackEnabled:true});phase='second';await compress('这是一段新的独立来源。');
  const replay=await until(()=>{
   if(!fs.existsSync(reportFile))return false;
   const result=read(reportFile);return result.feedback.origin==='learned'&&result;
  },'newly admitted case triggers automatic replay');
  assert.equal(detectors.length,2,'calibration summaries must never recursively enter the learner');
  assert.equal(reviews.length,2);assert(calibrations>0);
  const entries=read(bankFile).entries;assert.equal(entries.length,2);
  for(const entry of entries){assert(replay.probes.some(p=>p.id===entry.group.probe.id));assert(entry.testedAt>0);}
  assert.deepEqual(new Set(replay.feedback.learnedIds),new Set(entries.map(e=>e.id)));
  assert.equal((await state()).replay.policy.active.version,0,'the baseline need not change simply because the bank grew');

  await compress('明确排除的隔离测试历史。',{replayLearning:'exclude'});await delay(60);
  assert.equal(detectors.length,2,'explicitly excluded source must not be learned');
  phase='uncertain';await compress('这一段只有不确定判断。');await settled('held');
  assert.equal(detectors.length,3);assert.equal(read(bankFile).entries.length,2);assert.equal(reviews.length,2);
  phase='review-error';await compress('这一段用来模拟审核服务故障。');const failed=await settled('held');
  assert.equal(detectors.length,4);assert.equal(reviews.length,3);assert.equal(read(bankFile).entries.length,2);
  assert(failed.replay.harvest.nextRetryAt>Date.now());
  const disabled=await settings({replayHarvestEnabled:false});assert.equal(disabled.replay.harvest.enabled,false);
  await compress('关闭学习以后的新来源。');await delay(60);assert.equal(detectors.length,4);

  const privateMarkers=['PRIVATE-HARVEST','CedarWindow7','李沐','冬稿四版','contact-private@example.invalid'];
  const snapshot=JSON.stringify(await state());for(const marker of privateMarkers)assert(!snapshot.includes(marker),'UI contains '+marker);
  for(const relative of fs.readdirSync(dir,{recursive:true})){
   const file=path.join(dir,relative);if(!fs.statSync(file).isFile())continue;
   const stored=fs.readFileSync(file,'utf8');for(const marker of privateMarkers)assert(!stored.includes(marker),'persisted private content in '+relative);
  }
  const beforeClear=await state();
  const denied=await fetch(stateURL(),{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':'wrong'},body:JSON.stringify({action:'clear-learned-cases'})});
  assert.equal(denied.status,403);assert.equal(read(bankFile).entries.length,2);
  const cleared=await fetch(stateURL(),{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':beforeClear.csrf},body:JSON.stringify({action:'clear-learned-cases'})});
  assert.equal(cleared.status,200);assert.equal((await cleared.json()).replay.harvest.approvedCount,0);
  assert.equal(read(bankFile).entries.length,0);assert.equal((await state()).replay.policy.active.version,0);
  assert.equal(forbiddenTransport,0);
 }finally{await stop();}
});
