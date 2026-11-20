// 2026-11-15: validated summaries survive a restart on disk; provider calls are capped per base URL.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'disk-cache-'));
const runtimeUrl=new URL('../runtime.js',import.meta.url).href;
const {runPipeline,defaults,validatedDir,VALIDATED_TTL_MS,acquireProvider,PROVIDER_CONCURRENCY,_requestForTest,runs}=await import(runtimeUrl);
// A fresh module instance has an empty in-memory cache, like the plugin host after a DSH restart.
const restarted=tag=>import(runtimeUrl+'?restart='+tag);
const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false};
const summary='青枔说周末去爬山，岑舒答应一起去。';
const work=content=>({content,instructions:'',maxSummaryChars:200,trigger:'auto',reuseValidated:true});
const files=()=>fs.existsSync(validatedDir)?fs.readdirSync(validatedDir).filter(f=>f.endsWith('.json')):[];

test('a validated summary is reused after a restart without calling any model',async()=>{
 assert.equal(await runPipeline(work('磁盘缓存一'),async()=>summary,{settings}),summary);
 assert.equal(files().length,1);
 const raw=fs.readFileSync(path.join(validatedDir,files()[0]),'utf8'),stored=JSON.parse(raw);
 assert.deepEqual(Object.keys(stored).sort(),['data','id','iv','tag','until']);assert.ok(stored.until-Date.now()>VALIDATED_TTL_MS-60000);
 assert.ok(!raw.includes('爬山')&&!raw.includes('磁盘缓存一'),'neither the summary nor the source is stored in plaintext');
 const fresh=await restarted('a');let called=false;
 assert.equal(await fresh.runPipeline(work('磁盘缓存一'),async()=>{called=true;return 'x';},{settings}),summary);
 assert.equal(called,false);
 assert.equal(fresh.runs().sort((a,b)=>b.startedAt-a.startedAt)[0].reusedFrom,stored.id);
});
test('an expired or different-configuration entry is not reused',async()=>{
 await runPipeline(work('磁盘缓存二'),async()=>summary,{settings});
 for(const f of files()){const p=path.join(validatedDir,f);const v=JSON.parse(fs.readFileSync(p,'utf8'));v.until=Date.now()-1;fs.writeFileSync(p,JSON.stringify(v));}
 const fresh=await restarted('b');let calls=0;
 await fresh.runPipeline(work('磁盘缓存二'),async()=>{calls++;return summary;},{settings});
 assert.equal(calls,1);
 const other=await restarted('c');let otherCalls=0;
 await other.runPipeline(work('磁盘缓存二'),async()=>{otherCalls++;return summary;},{settings:{...settings,maxSummaryChars:15000}});
 assert.equal(otherCalls,1,'a configuration change gives a new fingerprint');
});
test('a tampered or foreign cache file is ignored and the range is summarized again',async()=>{
 await runPipeline(work('磁盘缓存四'),async()=>summary,{settings});
 const newest=files().map(f=>path.join(validatedDir,f)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
 const v=JSON.parse(fs.readFileSync(newest,'utf8'));v.data=Buffer.from('篡改').toString('base64');fs.writeFileSync(newest,JSON.stringify(v));
 const fresh=await restarted('e');let calls=0;
 assert.equal(await fresh.runPipeline(work('磁盘缓存四'),async()=>{calls++;return summary;},{settings}),summary);
 assert.equal(calls,1);
});
test('manual and direct runs without reuse never read the disk cache',async()=>{
 await runPipeline(work('磁盘缓存三'),async()=>summary,{settings});
 const fresh=await restarted('d');let calls=0;
 await fresh.runPipeline({...work('磁盘缓存三'),reuseValidated:false},async()=>{calls++;return summary;},{settings});
 assert.equal(calls,1);
});

test('provider slots cap in-flight calls, hand over in order and drop aborted waiters',async()=>{
 const base='https://slots.example/v1';const order=[];
 const r1=await acquireProvider(base),r2=await acquireProvider(base);
 const controller=new AbortController();
 const p3=acquireProvider(base).then(r=>{order.push(3);return r;});
 const p4=acquireProvider(base,controller.signal).then(()=>order.push(4),()=>order.push('4-aborted'));
 const p5=acquireProvider(base).then(r=>{order.push(5);return r;});
 const other=await acquireProvider('https://other.example/v1');other();
 controller.abort();await p4;
 r1();const r3=await p3;r2();const r5=await p5;
 assert.deepEqual(order,['4-aborted',3,5]);
 r3();r5();r3();
 const a=await acquireProvider(base),b=await acquireProvider(base);a();b();
 assert.equal(PROVIDER_CONCURRENCY,2);
});
test('real provider requests never exceed the slot count and a retry frees its slot while waiting',async()=>{
 const original=globalThis.fetch;let inFlight=0,peak=0,first=true;
 globalThis.fetch=async()=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,40));inFlight--;
  if(first){first=false;return new Response('',{status:429,headers:{'retry-after':'0'}});}
  return new Response(JSON.stringify({ok:true}),{status:200});};
 try{
  const signal=new AbortController().signal;
  const out=await Promise.all(Array.from({length:5},()=>_requestForTest('https://limit.example/v1','/responses',{},{model:'m'},{retries:1},signal)));
  assert.equal(out.length,5);assert.ok(out.every(x=>x.ok));assert.equal(peak,2);
 }finally{globalThis.fetch=original;}
});
