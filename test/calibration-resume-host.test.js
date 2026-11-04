import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {validationCases} from '../feedback.js';

const engine=process.env.COLLAB_TEST_ENGINE||path.resolve(import.meta.dirname,'../../billion-context-collab');
const available=fs.existsSync(path.join(engine,'dist/external-summary-settings.js'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function until(fn,label){for(let i=0;i<750;i++){const value=await fn();if(value)return value;await delay(15);}assert.fail(label);}

test('automatic bootstrap stops at twelve calls and resumes checkpoints across restart without resetting daily usage',
 {skip:available?false:'Build the pinned engine and set COLLAB_TEST_ENGINE.',timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'calibration-resume-http-'));
 const values={DSH_HOME:path.join(dir,'home'),DSH_COLLAB_TEST_HOME:dir,BILI_CONFIG_FILE:path.join(dir,'engine.json'),DSH_PROFILE_DIR:undefined};
 const oldEnv=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 const assign=items=>{for(const[k,v]of Object.entries(items)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
 assign(values);
 const realFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1','test must not contact external providers');return realFetch(url,options);};
 t.after(()=>{globalThis.fetch=realFetch;assign(oldEnv);fs.rmSync(dir,{recursive:true,force:true});});
 const {defaults}=await import('../runtime.js'),{apply}=await import('../host.js');
 const configFile=path.join(dir,'config.json'),policyFile=path.join(dir,'compression-policy.json'),jobFile=path.join(dir,'calibration-checkpoint.json');
 const reportFile=path.join(dir,'fixture-replay.json'),usageFile=path.join(dir,'calibration-usage.json'),hostFile=path.join(dir,'host.json');
 const c={...defaults,enabled:true,replayHarvestEnabled:false,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,
  aProvider:'fixture',aModel:'fixture-reader',replayDailyCalls:14};
 fs.writeFileSync(configFile,JSON.stringify(c));fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 let readers=0,summaries=0,formal=0,holdReader;
 const readerCalls=new Map(),summaryCalls=new Map();
 async function* stream(request){
  const input=JSON.parse(request.messages[0].content[0].text);let text;
  if(typeof input.content==='string'){
   if(input.content.startsWith('正式压缩隔离测试')){formal++;text=input.content;}
   else{summaries++;summaryCalls.set(input.content,(summaryCalls.get(input.content)||0)+1);text=input.content.split('\n').filter(line=>!line.startsWith('[noise-')).join('\n');}
  }else{
   if(holdReader){const hold=holdReader;holdReader=null;await hold();}
   readers++;const key=JSON.stringify([request.system,input]);readerCalls.set(key,(readerCalls.get(key)||0)+1);
   const probe=validationCases.find(c=>c.question===input.question);assert.ok(probe,'unknown baseline question');
   const citations=probe.requiredIds.map(id=>({id,quote:probe.records.find(r=>r.id===id).text}));
   const visible=input.material+JSON.stringify(input.recall||[]),found=citations.every(c=>visible.includes(c.quote));
   text=JSON.stringify(found?{answer:probe.expected,citations}:request.system.includes('可先')&&!input.recall?.length?{query:citations[0].quote}:{answer:'unknown',citations:[]});
  }
  yield {type:'text-delta',text};yield {type:'usage',usage:{inputTokens:8,outputTokens:2}};yield {type:'finish',reason:{kind:'stop'}};
 }
 let cleanup=[],settingsHandler;
 const ui=http.createServer((req,res)=>settingsHandler(req,res));await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>ui.close(resolve)));
 const uiUrl='http://127.0.0.1:'+ui.address().port+'/dsh-collaborative-compaction/state';
 const state=async()=>{const response=await fetch(uiUrl);assert.equal(response.status,200);return response.json();};
 const stop=async()=>{for(const off of cleanup.reverse())await off();cleanup=[];};
 const start=async()=>{
  fs.rmSync(hostFile,{force:true});
  apply({effect:fn=>{const off=fn();if(typeof off==='function')cleanup.push(off);},llm:{stream},webServer:{register:route=>{settingsHandler=route.handler;return ()=>{};}}});
  const {port}=await until(()=>fs.existsSync(hostFile)?read(hostFile):null,'host did not start');
  const token=fs.readFileSync(path.join(dir,'local-token'),'utf8');
  return async(route,payload={})=>{const response=await fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 };
 try{
  let call=await start();
  await call('/v1/chat/completions',{model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'auto',maxSummaryChars:100}},messages:[{role:'user',content:JSON.stringify({content:'正式压缩隔离测试：首次触发后台小批初始化。'})}]});
  await until(()=>fs.existsSync(reportFile)&&read(reportFile).feedback.status==='paused','automatic bootstrap did not pause');
  const initial=read(jobFile),first=await state();
  assert.equal(initial.kind,'bootstrap');assert.equal(first.replay.calibration.status,'paused');assert.equal(first.replay.calibration.pauseKind,'slice-calls');
  assert.equal(read(policyFile).active.version,0,'bootstrap must not promote any strategy');assert.equal(first.replay.calibration.usage.calls,12);
  assert.equal(readers+summaries,12);assert.equal(formal,1,'production compression is not counted as calibration');
  assert.ok(initial.checkpoint.completed>0);const jobId=initial.id,initialSummaryCalls=summaries;
  const daily=Object.values(read(usageFile).days)[0];assert.equal(daily.calls,12);assert.equal(daily.knownTokens,120);assert.equal(daily.estimatedTokens,0);
  const beforeRefresh=readers+summaries;await state();await state();assert.equal(readers+summaries,beforeRefresh,'GET status is read only');
  await stop();call=await start();
  const second=await call('/v1/replay');
  assert.equal(second.feedback.status,'paused');assert.equal(second.feedback.pauseKind,'daily-calls');
  assert.equal(read(jobFile).id,jobId);assert.equal(summaries,initialSummaryCalls,'successful summary tasks must survive restart');
  assert.equal(Object.values(read(usageFile).days)[0].calls,14);assert.equal(readers+summaries,14);
  await stop();call=await start();
  const capped=await call('/v1/replay');assert.equal(capped.feedback.status,'paused');assert.equal(capped.feedback.pauseKind,'daily-calls');assert.equal(readers+summaries,14,'restart/manual resume cannot bypass the daily budget');
  const beforeConfig=await state();assert.equal(beforeConfig.replay.schedule.ready,false);
  const change=await fetch(uiUrl,{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':beforeConfig.csrf},body:JSON.stringify({changes:{replayDailyCalls:120},expected:{replayDailyCalls:14}})});
  assert.equal(change.status,200,await change.text());assert.equal((await state()).replay.schedule.ready,true,'raising the daily budget reopens automatic scheduling');
  const resumed=await call('/v1/replay');
  assert.equal(resumed.feedback.status,'baseline-complete',resumed.feedback.reason);assert.equal(read(jobFile).id,jobId);
  assert.equal(resumed.calibration.status,'completed');assert.equal(read(policyFile).active.version,0);
  assert.equal(read(policyFile).baseline.coverage.completed,5);assert.equal(read(policyFile).baseline.coverage.total,5);
  assert.equal(readers,15);assert.equal(summaries,2);
  assert.ok([...summaryCalls.values()].every(n=>n===1));assert.ok([...readerCalls.values()].every(n=>n===1),'successful reader tasks must not be replayed after a pause');
  assert.equal(Object.values(read(usageFile).days)[0].calls,17);assert.equal(Object.values(read(usageFile).days)[0].knownTokens,170);
  // A late provider completion from an unloaded instance must not write either
  // approval checkpoints or a usage refund into the restarted host's files.
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  holdReader=async()=>{entered();await gate;};
  const inFlight=call('/v1/replay').catch(error=>error);
  await waiting;await stop();
  const stoppedCheckpoint=fs.readFileSync(jobFile,'utf8'),stoppedUsage=fs.readFileSync(usageFile,'utf8');
  const stoppedDay=Object.values(read(usageFile).days)[0];assert.ok(stoppedDay.estimatedRequests>0,'unconfirmed calls remain conservatively charged');
  release();await inFlight;await delay(30);
  assert.equal(fs.readFileSync(jobFile,'utf8'),stoppedCheckpoint,'disposed model responses cannot commit checkpoints');
  assert.equal(fs.readFileSync(usageFile,'utf8'),stoppedUsage,'disposed responses cannot overwrite or refund persisted usage');
 }finally{await stop();}
});
