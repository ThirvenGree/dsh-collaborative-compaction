import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const engine=process.env.COLLAB_TEST_ENGINE||path.resolve(import.meta.dirname,'../../billion-context-collab');
const available=fs.existsSync(path.join(engine,'dist/external-summary-settings.js'));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(fn,label){for(let i=0;i<500;i++){const value=await fn();if(value)return value;await delay(10);}assert.fail(label);}
function row(id,question,expected,text,summary){const ref=id+'-row';return {id,question,expected,records:[{id:ref,role:'user',text}],requiredIds:[ref],requiredQuotes:{[ref]:expected},...(summary?{summary}:{})};}
const group={
 probe:row('glass-piece','复盘应该摆哪种棋子？','玻璃棋子','棋局约定先用木棋子。新规确定改用玻璃棋子，旧规即刻停用。','棋局的器材已经备好。'),
 positive:row('trial-mode','复测之后设备该设为哪个档？','丙档','试验先设置乙档，复测结论改成丙档；乙档不再使用。'),
 counter:row('wax-proposal','封口最终采用哪一种蜡？','红蜡','原方案使用红蜡封口，另一个提议改用蓝蜡被否决，保留红蜡。')
};
const source='PRIVATE-CHAIN-TEST 私人联系人说明：批准版本是冬稿四版。';
const summary='已经安排装订，项目继续进行。';
const omission={decision:'candidate',question:'现在批准的版本是哪一版？',expected:'冬稿四版',quotes:[{role:'user',text:'批准版本是冬稿四版。'}]};

test('disabled cross-review never starts harvest; disabling and re-enabling cancels queued and in-flight private-source work',
 {skip:available?false:'Build patched engine for the host integration.',timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harvest-privacy-host-'));
 const vars={DSH_COLLAB_TEST_HOME:dir,DSH_HOME:path.join(dir,'home'),BILI_CONFIG_FILE:path.join(dir,'engine.json'),DSH_PROFILE_DIR:undefined,HARVEST_PRIVATE_TEST_KEY:'fixture-only'};
 const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]])),realFetch=globalThis.fetch;
 const env=values=>{for(const[k,v]of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
 const clean=[];
 env(vars);t.after(async()=>{try{for(const off of clean.reverse())await off();}finally{globalThis.fetch=realFetch;env(previous);fs.rmSync(dir,{recursive:true,force:true});}});
 const {defaults,config}=await import('../runtime.js'),{apply}=await import('../host.js');
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...defaults,enabled:true,replayFeedbackEnabled:false,replayHarvestEnabled:true,
  claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,plannerEnabled:false,aProvider:'fixture',aModel:'fixture',reviewBase:'https://harvest-private.invalid/v1',reviewKeyEnv:'HARVEST_PRIVATE_TEST_KEY'}));
 fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 let mode='none',gate,entered,detectors=0,readers=0,syntheses=0,audits=0,remoteCalls=0,ui,base,token;
 const original={question:omission.question,expected:omission.expected,records:[{id:'formal-0',text:omission.quotes[0].text}]};
 globalThis.fetch=async(url,options)=>{
  if(new URL(url).hostname==='127.0.0.1')return realFetch(url,options);
  assert.equal(String(url),'https://harvest-private.invalid/v1/responses');
  assert.equal(config().reviewEnabled,true,'no remote review may begin while cross-review is disabled');remoteCalls++;
  const request=JSON.parse(options.body),input=JSON.parse(request.input.slice(request.input.indexOf('{')));
  if(!input.task)return Response.json({status:'completed',output:[{content:[{type:'output_text',text:input.summaryA}]}]});
  assert.equal(input.task,'review-replay-case');assert(input.frozenHistory.startsWith(source));audits++;
  if(mode==='audit-block'){entered.resolve();await gate.promise;}
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({decision:'approve',privacy:true,fidelity:true,answers:true,generalization:true,safe:true})}]}]});
 };
 async function* stream(request){
  const input=JSON.parse(request.messages[0].content[0].text);let output;
  if(typeof input.content==='string'){
   if(mode==='production-block'){entered.resolve();await gate.promise;}
   output=summary;
  }
  else if(input.task==='detect-compression-omission'){
   assert.equal(config().reviewEnabled,true);detectors++;
   if(mode==='detector-block'){entered.resolve();await gate.promise;}
   output=JSON.stringify(mode==='clean'?{decision:'clean'}:omission);
  }else if(input.task==='synthesize-replay-case'){syntheses++;output=JSON.stringify({group});}
  else{
   readers++;const r=[original,...Object.values(group)].find(c=>c.question===input.question);assert(r,'known isolated question');
   const citations=r.records.map(q=>({id:q.id,quote:q.text}));
   output=JSON.stringify(citations.every(q=>(input.material+JSON.stringify(input.recall||[])).includes(q.quote))?{answer:r.expected,citations}:{answer:'unknown',citations:[]});
  }
  yield {type:'text-delta',text:output};yield {type:'finish',reason:{kind:'stop'}};
 }
 apply({llm:{stream},effect:fn=>{const off=fn();if(typeof off==='function')clean.push(off);},webServer:{register(spec){
  const registered=http.createServer(spec.handler);ui=registered;registered.listen(0,'127.0.0.1');return()=>new Promise(r=>registered.close(r));
 }}});
 const hostFile=path.join(dir,'host.json'),host=await until(()=>fs.existsSync(hostFile)&&JSON.parse(fs.readFileSync(hostFile,'utf8')),'host ready');
 base='http://127.0.0.1:'+host.port;token=fs.readFileSync(path.join(dir,'local-token'),'utf8');
 const url=()=>`http://127.0.0.1:${ui.address().port}/dsh-collaborative-compaction/state`;
 const state=async()=>(await fetch(url())).json();
 const settings=async changes=>{const s=await state(),r=await fetch(url(),{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':s.csrf},body:JSON.stringify({changes})});const value=await r.json();assert(r.ok,JSON.stringify(value));return value;};
 const compress=async tag=>{
  const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'manual',maxSummaryChars:300}},messages:[{role:'user',content:JSON.stringify({content:source+tag})}]})});
  const value=await r.json();assert(r.ok,JSON.stringify(value));assert.equal(value.choices[0].message.content,summary);
 };
 await compress('关闭审核。');await delay(25);
 assert.equal(remoteCalls,0);assert.equal(detectors,0);assert.equal((await state()).replay.harvest.queued,0);
 assert.equal((await state()).replay.harvest.configured,true);assert.match((await state()).replay.harvest.blockedReason,/交叉审核已关闭/);
 await settings({reviewEnabled:true});
 for(const change of [{aModel:'new-reader-model'},{reviewBase:'https://other-review.invalid/v1'}]){
  mode='production-block';gate=deferred();entered=deferred();const before=config();
  const pending=compress('手工编辑配置期间的旧摘要'+JSON.stringify(change));await entered.promise;
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...before,...change}));gate.resolve();await pending;
  assert.equal(detectors,0,'an old observer must not submit private history through a new model route');
  assert.equal((await state()).replay.harvest.queued,0);
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(before));
 }
 mode='detector-block';gate=deferred();entered=deferred();
 await compress('等待提炼。');await entered.promise;await compress('另一份排队原文。');assert.equal((await state()).replay.harvest.queued,1);
 await settings({reviewEnabled:false});assert.equal((await state()).replay.harvest.queued,0);await settings({reviewEnabled:true});gate.resolve();
 await until(async()=>!(await state()).replay.harvest.running,'cancelled detector drains');
 assert.equal(readers,0);assert.equal(syntheses,0);assert.equal(audits,0);assert.equal(detectors,1);
 mode='audit-block';gate=deferred();entered=deferred();await compress('等待独立审核。');await entered.promise;
 const readersBefore=readers;await settings({reviewEnabled:false});await settings({reviewEnabled:true});gate.resolve();
 await until(async()=>!(await state()).replay.harvest.running,'cancelled audit drains');
 assert.equal(readers,readersBefore,'late audit approval cannot launch synthetic replay');assert.equal((await state()).replay.harvest.approvedCount,0);
 assert.equal(fs.existsSync(path.join(dir,'learned-replay-cases.json')),false,'late candidate cannot persist');
 mode='clean';await compress('新的明确授权请求。');await until(async()=>!(await state()).replay.harvest.running&&(await state()).replay.harvest.last?.status==='clean','new work can run');
 assert.equal(detectors,3);assert.equal(audits,1);assert.equal((await state()).replay.harvest.today.attempts,3);
});
