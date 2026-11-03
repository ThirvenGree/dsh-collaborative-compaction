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
test('ordinary compression triggers calibration; the next request and restarted host use the promoted policy',
 {skip:engineInstalled?false:'Build the patched engine and set COLLAB_TEST_ENGINE to run the HTTP integration.',timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collab-policy-http-'));
 const env={DSH_HOME:path.join(dir,'home'),DSH_COLLAB_TEST_HOME:dir,BILI_CONFIG_FILE:path.join(dir,'engine.json'),DSH_PROFILE_DIR:undefined};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
 const assign=values=>{for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
 assign(env);
 t.after(()=>{assign(previous);fs.rmSync(dir,{recursive:true,force:true});});
 const {defaults}=await import('../runtime.js'),{apply}=await import('../host.js');
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...defaults,enabled:true,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,aProvider:'test',aModel:'fixture'}));
 fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:engine}));
 const seen=[];
 async function* stream(req){
  const input=JSON.parse(req.messages[0].content[0].text);
  let text;
  if(typeof input.content==='string'){
   const amended=req.system.includes('retain-identifiers');
   if(input.content.startsWith('隔离收据'))seen.push(amended);
   text=input.content.split('\n').filter(line=>!line.startsWith('[noise-')).join('\n');
   if(!amended)text=text.replaceAll('listen_frame_Q7','只读工具').replaceAll('probe_L9','探针');
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
  return async content=>{
   const res=await fetch('http://127.0.0.1:'+port+'/v1/chat/completions',{method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({model:'dsh-collaborative-v1',metadata:{dsh_compaction:{version:1,trigger:'auto',maxSummaryChars:300}},
     messages:[{role:'user',content:JSON.stringify({content})}]})});
   const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));assert.equal(body.choices[0].message.content,content);
  };
 };
 try{
  const compress=await start();await compress('隔离收据，第一次正常压缩。');
  const report=await untilFile(path.join(dir,'fixture-replay.json'));
  assert.equal(report.feedback.origin,'auto');assert.equal(report.feedback.status,'promoted',report.feedback.reason);
  await compress('隔离收据，第二次正常压缩。');
  await stop();const afterRestart=await start();await afterRestart('隔离收据，重载后的正常压缩。');
  assert.deepEqual(seen,[false,true,true]);
 }finally{await stop();}
});
