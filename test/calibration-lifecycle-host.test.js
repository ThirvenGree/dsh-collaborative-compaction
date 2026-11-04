import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {validationCases} from '../feedback.js';

const engine=process.env.COLLAB_TEST_ENGINE||path.resolve(import.meta.dirname,'../../billion-context-collab');
const available=fs.existsSync(path.join(engine,'dist/external-summary-settings.js'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function until(fn,label){for(let i=0;i<600;i++){const value=await fn();if(value)return value;await delay(10);}assert.fail(label);}

test('calibration lifecycle releases failed leases, refreshes inconclusive baselines and discards stale model or policy checkpoints',
 {skip:available?false:'Build the pinned engine and set COLLAB_TEST_ENGINE.',timeout:45000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'calibration-lifecycle-'));
 const env={DSH_HOME:path.join(dir,'home'),DSH_COLLAB_TEST_HOME:dir,BILI_CONFIG_FILE:path.join(dir,'engine.json'),DSH_PROFILE_DIR:undefined,LIFECYCLE_TEST_KEY:'fixture-only'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
 const assign=values=>{for(const[k,v]of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
 assign(env);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>{
  if(new URL(url).hostname==='lifecycle.invalid'){
   const request=JSON.parse(options.body),input=JSON.parse(request.input.slice(request.input.indexOf('{')));
   assert(input.original.startsWith('隔离生命周期')||input.original.startsWith('[noise-0]'),'only isolated trigger or synthetic calibration text may reach the fake verifier');
   return Promise.resolve(Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:input.summary,sourceQuote:input.original}]})}]}]}));
  }
  assert.equal(new URL(url).hostname,'127.0.0.1','no external model requests');return originalFetch(url,options);
 };
 t.after(()=>{globalThis.fetch=originalFetch;assign(previous);fs.rmSync(dir,{recursive:true,force:true});});
 const {defaults}=await import('../runtime.js'),{apply}=await import('../host.js');
 const files=Object.fromEntries(['config','compression-policy','calibration-checkpoint','calibration-usage','fixture-replay','host'].map(k=>[k,path.join(dir,k+'.json')]));
 const base={...defaults,enabled:true,replayHarvestEnabled:false,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,
  aProvider:'fixture',aModel:'lifecycle-reader',replaySliceCalls:100,replayDailyCalls:500,replayDailyTokens:10000000};
 const write=(key,value)=>fs.writeFileSync(files[key],JSON.stringify(value));
 write('config',base);fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 let mode='good',readers=0,summaries=0,formal=0,summarySequence=0;
 async function* stream(request){
  const input=JSON.parse(request.messages[0].content[0].text);let text;
  if(typeof input.content==='string'){
   if(input.content.startsWith('隔离生命周期')){formal++;text=input.content;}
   else{
    summaries++;summarySequence++;
    text=mode==='reject'?'新增上限 827364 条。':input.content.split('\n').filter(line=>!line.startsWith('[noise-')&&(mode!=='bad-control'||!line.startsWith('[r6]'))).join('\n');
    if(!text)text='门牌的位置已经记录。';
   }
  }else{
   readers++;const probe=validationCases.find(c=>c.question===input.question);assert.ok(probe,'unexpected model request');
   const citations=probe.requiredIds.map(id=>({id,quote:probe.records.find(r=>r.id===id).text}));
   const found=citations.every(c=>(input.material+JSON.stringify(input.recall||[])).includes(c.quote));
   text=JSON.stringify(mode==='bad-raw'?{answer:'unknown',citations:[]}:found?{answer:probe.expected,citations}:
    request.system.includes('可先')&&!input.recall?.length?{query:citations[0].quote}:{answer:'unknown',citations:[]});
  }
  yield {type:'text-delta',text};yield {type:'usage',usage:{inputTokens:6,outputTokens:4}};yield {type:'finish',reason:{kind:'stop'}};
 }
 let cleanup=[];
 const stop=async()=>{for(const off of cleanup.reverse())await off();cleanup=[];};
 const start=async()=>{
  fs.rmSync(files.host,{force:true});
  apply({effect:fn=>{const off=fn();if(typeof off==='function')cleanup.push(off);},llm:{stream},webServer:{register:()=>()=>{}}});
  const {port}=await until(()=>fs.existsSync(files.host)?read(files.host):null,'host did not start');
  const token=fs.readFileSync(path.join(dir,'local-token'),'utf8');
  return async(route,payload={})=>{
   const response=await fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});
   const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  };
 };
 const reset=async()=>{
  await stop();for(const key of ['compression-policy','calibration-checkpoint','calibration-usage','fixture-replay'])fs.rmSync(files[key],{force:true});
  write('config',base);mode='good';return start();
 };
 const trigger=call=>call('/v1/chat/completions',{model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'auto',maxSummaryChars:100}},
  messages:[{role:'user',content:JSON.stringify({content:'隔离生命周期：触发首次小批初始化。'})}]});
 try{
  await t.test('corrupt usage cannot reset charged usage or leave an active lease',async()=>{
   const call=await reset(),corrupt={schema:1,days:{[new Date().toISOString().slice(0,10)]:{calls:9,tokens:'corrupt'}}};
   write('calibration-usage',corrupt);const bytes=fs.readFileSync(files['calibration-usage'],'utf8'),calls=readers+summaries;
   const report=await call('/v1/replay');
   assert.equal(report.feedback.status,'unavailable');assert.match(report.feedback.reason,/Invalid calibration daily usage/);
   assert.equal(read(files['compression-policy']).lease,null);assert.equal(fs.readFileSync(files['calibration-usage'],'utf8'),bytes);
   assert.equal(readers+summaries,calls);
  });
  for(const fault of ['bad-raw','bad-control'])await t.test(fault+' bootstrap retries fresh rather than forever reusing inconclusive answers',async()=>{
   const call=await reset();mode=fault;await trigger(call);
   const report=await until(()=>fs.existsSync(files['fixture-replay'])?read(files['fixture-replay']):null,'inconclusive bootstrap did not settle');
   assert.equal(report.feedback.status,'held',report.feedback.reason);const job=read(files['calibration-checkpoint']),policy=read(files['compression-policy']);
   assert.equal(job.status,'failed');assert.equal(job.checkpoint.completed,0);assert.equal(policy.baseline,undefined);assert(policy.nextRetryAt>Date.now());
   const before=summaries;mode='good';const retried=await call('/v1/replay');
   assert.equal(retried.feedback.status,'baseline-complete',retried.feedback.reason);assert.equal(read(files['calibration-checkpoint']).id,job.id);
   assert(summaries>before,'inconclusive compression/read results must be freshly generated');assert.equal(read(files['compression-policy']).lease,null);
  });
  for(const change of ['model','revision'])await t.test(change+' changes invalidate resumed job identity and cached steps',async()=>{
   let call=await reset();write('config',{...base,replaySliceCalls:3});await trigger(call);
   await until(()=>fs.existsSync(files['fixture-replay'])&&read(files['fixture-replay']).feedback.status==='paused','slice did not pause');
   const job=read(files['calibration-checkpoint']);assert(job.checkpoint.completed>0);const before=summaries;
   await stop();
   if(change==='model')write('config',{...base,aModel:'lifecycle-reader-new'});
   else{const policy=read(files['compression-policy']);policy.revision++;write('compression-policy',policy);write('config',base);}
   call=await start();const result=await call('/v1/replay');
   assert.notEqual(read(files['calibration-checkpoint']).id,job.id);assert.notEqual(read(files['calibration-checkpoint']).identity,job.identity);
   assert(summaries>before,'new scope must not consume old compression checkpoints');assert.equal(result.feedback.status,'unchanged',result.feedback.reason);
  });
  await t.test('deterministic rejected content pauses automatic retries and clears rejected checkpoints',async()=>{
   const call=await reset();write('config',{...base,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'LIFECYCLE_TEST_KEY',reviewBase:'https://lifecycle.invalid/v1'});mode='reject';await trigger(call);
   const report=await until(()=>fs.existsSync(files['fixture-replay'])?read(files['fixture-replay']):null,'content rejection did not settle');
   assert.equal(report.feedback.status,'paused',report.feedback.reason);assert.equal(report.feedback.pauseKind,'content-rejected');
   const job=read(files['calibration-checkpoint']);assert.equal(job.checkpoint.completed,0);assert.equal(read(files['compression-policy']).nextRetryAt,Number.MAX_SAFE_INTEGER);
   const before=readers+summaries;await trigger(call);await delay(30);
   assert.equal(readers+summaries,before,'a new production compression must not retry deterministically rejected calibration');assert.equal(read(files['calibration-checkpoint']).id,job.id);
   mode='good';const retried=await call('/v1/replay');
   assert.equal(retried.feedback.status,'baseline-complete',retried.feedback.reason);assert(readers+summaries>before,'explicit retry must regenerate rejected candidates');
  });
  assert(formal>0);assert(summarySequence>0);
 }finally{await stop();}
});
