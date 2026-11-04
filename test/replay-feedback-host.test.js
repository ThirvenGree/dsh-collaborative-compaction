import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {validationCases} from '../feedback.js';

const engine=process.env.COLLAB_TEST_ENGINE||path.resolve(import.meta.dirname,'../../billion-context-collab');
const engineInstalled=fs.existsSync(path.join(engine,'dist/external-summary-settings.js'));

// Exercise both plugin HTTP paths with the installed engine's search. Only the model is simulated.
test('first compression bootstraps without modifying policy; full validation and restarted host retain the adopted policy',
 {skip:engineInstalled?false:'Build the patched engine and set COLLAB_TEST_ENGINE to run the HTTP integration.',timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collab-policy-http-'));
 const env={DSH_HOME:path.join(dir,'home'),DSH_COLLAB_TEST_HOME:dir,BILI_CONFIG_FILE:path.join(dir,'engine.json'),DSH_PROFILE_DIR:undefined,LOCAL_REPLAY_TEST_KEY:'fixture-only'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
 const assign=values=>{for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
 assign(env);
 t.after(()=>{assign(previous);fs.rmSync(dir,{recursive:true,force:true});});
 const nativeFetch=globalThis.fetch;
 const clause={when:'summarizing technical identifiers',retain:['exact spelling','specific purpose'],relation:'connection between names and purposes'};
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);if(u.hostname==='127.0.0.1')return nativeFetch(url,options);
  if(u.href!=='https://policy-review.invalid/v1/responses')throw Error('unexpected external transport in isolated test');
  const args=JSON.parse(options.body);const review=JSON.parse(args.input.slice(args.input.indexOf('{')));
  assert.equal(review.task,'review-compression-clause');
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({decision:'approve',safe:true,general:true,supportedTargets:review.targets})}]}]});
 };
 t.after(()=>{globalThis.fetch=nativeFetch;});
 const {defaults}=await import('../runtime.js'),{apply}=await import('../host.js');
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...defaults,enabled:true,replaySliceCalls:100,replayDailyCalls:10000,replayDailyTokens:100000000,replayHarvestEnabled:false,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,aProvider:'test',aModel:'fixture',reviewBase:'https://policy-review.invalid/v1',reviewKeyEnv:'LOCAL_REPLAY_TEST_KEY'}));
 fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 const seen=[];
 async function* stream(req){
  const input=JSON.parse(req.messages[0].content[0].text);
  let text;
  if(typeof input.content==='string'){
   const amended=req.system.includes(clause.relation);
   if(input.content.startsWith('隔离收据'))seen.push(amended);
   text=input.content.split('\n').filter(line=>!line.startsWith('[noise-')).join('\n');
   if(!amended)text=text.replaceAll('listen_frame_Q7','只读工具').replaceAll('probe_L9','探针');
  }else if(input.task==='propose-compression-clause'){
   assert.ok(input.failures.some(r=>r.id==='omitted-tool'));
   text=JSON.stringify({decision:'propose',targets:['omitted-tool'],...clause});
  }else{
   const probe=validationCases.find(c=>c.question===input.question);
   assert.ok(probe,'unknown probe');
   const citations=probe.requiredIds.map(id=>({id,quote:probe.records.find(r=>r.id===id).text}));
   const visible=input.material+JSON.stringify(input.recall||[]);
   const found=citations.every(c=>visible.includes(c.quote));
   const search=req.system.includes('可先')&&!input.recall?.length;
   text=JSON.stringify(found?{answer:probe.expected,citations}:search?{query:citations[0].quote}:{answer:'unknown',citations:[]});
  }
  yield {type:'text-delta',text};yield {type:'finish',reason:{kind:'stop'}};
 }
 async function untilFile(file){
  for(let i=0;i<250&&!fs.existsSync(file);i++)await delay(40);
  return JSON.parse(fs.readFileSync(file,'utf8'));
 }
 const hostFile=path.join(dir,'host.json');
 let cleanup=[];
 const stop=async()=>{for(const off of cleanup.reverse())await off();cleanup=[];};
 const start=async()=>{
  fs.rmSync(hostFile,{force:true});
  apply({effect:fn=>{const off=fn();if(typeof off==='function')cleanup.push(off);},llm:{stream},webServer:{register:()=>()=>{}}});
  const {port}=await untilFile(hostFile),token=fs.readFileSync(path.join(dir,'local-token'),'utf8');
  const compress=async content=>{
   const res=await fetch('http://127.0.0.1:'+port+'/v1/chat/completions',{method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'auto',maxSummaryChars:300}},
     messages:[{role:'user',content:JSON.stringify({content})}]})});
   const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));assert.equal(body.choices[0].message.content,content);
  };
  compress.calibrate=async()=>{
   const response=await fetch('http://127.0.0.1:'+port+'/v1/replay',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});
   assert.equal(response.status,200);const value=await response.json();return value.feedback.status==='paused'?compress.calibrate():value;
  };
  return compress;
 };
 try{
  const compress=await start();await compress('隔离收据，第一次正常压缩。');
  const initial=await untilFile(path.join(dir,'fixture-replay.json'));assert.equal(initial.feedback.status,'baseline-complete',initial.feedback.reason);assert.equal(initial.feedback.kind,'bootstrap');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'compression-policy.json'),'utf8')).active.version,0,'bootstrap cannot adopt a policy');
  const report=await compress.calibrate();
  assert.equal(report.feedback.origin,'manual');assert.equal(report.feedback.status,'promoted',report.feedback.reason);
  assert.ok(report.telemetry.elapsedMs>=0);assert.ok(report.telemetry.readerCalls>0);assert.ok(report.telemetry.pipelineCalls>0);
  const policyFile=path.join(dir,'compression-policy.json'),policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  assert.ok(policy.manualBaselineAt>0);policy.lastCompletedAt=Date.now()-8*86400000;policy.manualBaselineAt=policy.lastCompletedAt;policy.baseline.at=policy.lastCompletedAt;
  fs.writeFileSync(policyFile,JSON.stringify(policy));fs.unlinkSync(path.join(dir,'fixture-replay.json'));
  await compress('隔离收据，第二次正常压缩。');
  assert.equal((await untilFile(path.join(dir,'fixture-replay.json'))).feedback.origin,'auto');
  await stop();const afterRestart=await start();await afterRestart('隔离收据，重载后的正常压缩。');
  assert.deepEqual(seen,[false,true,true]);
 }finally{await stop();}
});
