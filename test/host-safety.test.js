import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'collab-host-'));
const {body,syncEngine:sync,saveSettings}=await import('../host.js');
// Unit tests run independently of the separately built upstream engine.
const testSchema=engine=>assert.ok(engine.compress.externalSummary.enabled);
const syncEngine=(settings,port,token)=>sync(settings,port,token,testSchema);
test('680k Chinese characters survive byte boundaries and byte limit is enforced',async()=>{
 const content='青枔岑舒天气变化'.repeat(85000);const bytes=Buffer.from(JSON.stringify({content}));
 async function* chunks(){for(let i=0;i<bytes.length;i+=65537)yield bytes.subarray(i,i+65537);}
 const result=await body(chunks());assert.equal(result.content,content);assert.ok(!result.content.includes('\ufffd'));
 await assert.rejects(body(chunks(),bytes.length-1),/too large/);
 async function* bad(){yield Buffer.from([123,34,120,34,58,34,0xff,34,125]);}await assert.rejects(body(bad()));
});
test('disabled never-owned config stays untouched; each enable captures fresh baseline',()=>{
 const file=path.join(process.env.DSH_COLLAB_TEST_HOME,'engine.json');process.env.BILI_CONFIG_FILE=file;
 const put=v=>fs.writeFileSync(file,JSON.stringify(v));const get=()=>JSON.parse(fs.readFileSync(file));
 const baseline={compress:{preserveRecentTokens:123,maxSummaryLength:456},providers:{other:{keep:true}}};put(baseline);
 syncEngine({enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 const enabled={enabled:true,timeoutMs:540000,maxSummaryChars:12000,outputTokens:16384,preserveRecentTokens:16000,plannerEnabled:true,autoFoldTargetTokens:80000};
 syncEngine(enabled,1,'fake');syncEngine({...enabled,enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 baseline.compress.preserveRecentTokens=999;put(baseline);syncEngine(enabled,1,'fake');syncEngine({...enabled,enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 syncEngine(enabled,1,'fake');const manual={compress:{externalSummary:{enabled:true,targets:['other/model']},preserveRecentTokens:42}};put(manual);syncEngine({enabled:false},1,'fake');assert.deepEqual(get(),manual);
 delete process.env.BILI_CONFIG_FILE;
});

test('all four settings commit steps roll back to their exact previous bytes',()=>{
 const dir=process.env.DSH_COLLAB_TEST_HOME;
 const file=path.join(dir,'rollback-engine.json');
 process.env.BILI_CONFIG_FILE=file;
 const settingsFile=path.join(dir,'config.json'), credentials=file+'.summary-credentials.json';
 fs.writeFileSync(file,'{ "compress":{} }');
 fs.writeFileSync(credentials,'{ "keep":"original" }');
 fs.writeFileSync(settingsFile,'{ "enabled":false }');
 const snapshot=()=>new Map(fs.readdirSync(dir).map(name=>[name,fs.readFileSync(path.join(dir,name),'hex')]));
 const original=snapshot();
 try{
  for(let failAt=1;failAt<=4;failAt++){
   const rename=fs.renameSync;let n=0;
   try {
    fs.renameSync=(...args)=>{if(++n===failAt)throw Error('injected rename failure');return rename(...args);};
    assert.throws(()=>saveSettings({enabled:true},1,'fake',testSchema),/injected/);
   } finally {fs.renameSync=rename;}
   assert.deepEqual(snapshot(),original);
  }
  assert.throws(()=>saveSettings({enabled:true},1,'fake',()=>{throw Error('schema rejected')}),/schema rejected/);
  assert.deepEqual(snapshot(),original);
  fs.writeFileSync(credentials,'broken');
  const malformed=snapshot();
  assert.throws(()=>saveSettings({enabled:true},1,'fake',testSchema));
  assert.deepEqual(snapshot(),malformed);
 }finally{delete process.env.BILI_CONFIG_FILE;}
});
test('plugin accepts exactly the engine fold-target interval',async()=>{
 const {validateConfig}=await import('../runtime.js');
 for(const value of [2000,4096,8191,10000001,8192.5]) assert.throws(()=>validateConfig({autoFoldTargetTokens:value}));
 for(const value of [8192,80000,10000000]) assert.equal(validateConfig({autoFoldTargetTokens:value}).autoFoldTargetTokens,value);
});
