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
test('disabled never-owned config stays untouched; each enable captures fresh baseline',async()=>{
 const file=path.join(process.env.DSH_COLLAB_TEST_HOME,'engine.json');process.env.BILI_CONFIG_FILE=file;
 const put=v=>fs.writeFileSync(file,JSON.stringify(v));const get=()=>JSON.parse(fs.readFileSync(file));
 const baseline={compress:{preserveRecentTokens:123,maxSummaryLength:456},providers:{other:{keep:true}}};put(baseline);
 await syncEngine({enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 const enabled={enabled:true,timeoutMs:540000,maxSummaryChars:12000,outputTokens:16384,preserveRecentTokens:16000,plannerEnabled:true,autoFoldTargetTokens:80000};
 await syncEngine(enabled,1,'fake');await syncEngine({...enabled,enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 baseline.compress.preserveRecentTokens=999;put(baseline);await syncEngine(enabled,1,'fake');await syncEngine({...enabled,enabled:false},1,'fake');assert.deepEqual(get(),baseline);
 await syncEngine(enabled,1,'fake');const manual={compress:{externalSummary:{enabled:true,targets:['other/model']},preserveRecentTokens:42}};put(manual);await syncEngine({enabled:false},1,'fake');assert.deepEqual(get(),manual);
 delete process.env.BILI_CONFIG_FILE;
});

test('all four settings commit steps roll back to their exact previous bytes',async()=>{
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
  for(let failAt=1;failAt<=5;failAt++){
   const rename=fs.renameSync;let n=0;
   try {
    fs.renameSync=(...args)=>{if(++n===failAt)throw Error('injected rename failure');return rename(...args);};
    await assert.rejects(()=>saveSettings({enabled:true},1,'fake',testSchema),/injected/);
   } finally {fs.renameSync=rename;}
   assert.deepEqual(snapshot(),original);
  }
  await assert.rejects(()=>saveSettings({enabled:true},1,'fake',()=>{throw Error('schema rejected')}),/schema rejected/);
  assert.deepEqual(snapshot(),original);
  fs.writeFileSync(credentials,'broken');
  const malformed=snapshot();
  await assert.rejects(()=>saveSettings({enabled:true},1,'fake',testSchema));
  assert.deepEqual(snapshot(),malformed);
 }finally{delete process.env.BILI_CONFIG_FILE;}
});
test('plugin accepts exactly the engine fold-target interval',async()=>{
 const {validateConfig}=await import('../runtime.js');
 for(const value of [2000,4096,8191,10000001,8192.5]) assert.throws(()=>validateConfig({autoFoldTargetTokens:value}));
 for(const value of [8192,80000,10000000]) assert.equal(validateConfig({autoFoldTargetTokens:value}).autoFoldTargetTokens,value);
});

test('custom install loads ESM validator with top-level await',async()=>{
 const dir=process.env.DSH_COLLAB_TEST_HOME,root=path.join(dir,'custom # engine');
 fs.mkdirSync(path.join(root,'dist'),{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
 fs.writeFileSync(path.join(root,'dist','external-summary-settings.js'),"await Promise.resolve();export const parseExternalSummaryChain=x=>x,expandExternalSummaryChain=x=>x,parseExternalSummarySettings=()=>{throw Error('custom schema invoked')}");
 fs.writeFileSync(path.join(dir,'installed-engine.json'),JSON.stringify({enginePath:root}));
 const profile=process.env.DSH_PROFILE_DIR;delete process.env.DSH_PROFILE_DIR;process.env.BILI_CONFIG_FILE=path.join(dir,'custom.json');
 try{await assert.rejects(sync({enabled:true},1,'fake'),/custom schema invoked/);}
 finally{delete process.env.BILI_CONFIG_FILE;if(profile!==undefined)process.env.DSH_PROFILE_DIR=profile;}
});

test('external edits during validation survive, and pre-existing credentials are restored',async()=>{
 const dir=process.env.DSH_COLLAB_TEST_HOME,file=path.join(dir,'concurrent.json'),credential=file+'.summary-credentials.json';
 process.env.BILI_CONFIG_FILE=file;fs.writeFileSync(file,'{}');fs.writeFileSync(credential,JSON.stringify({'dsh-collaborative':'before'}));
 try{
  await assert.rejects(sync({enabled:true},1,'fake',async()=>fs.writeFileSync(file,'{"external":true}')),/changed during validation/);
  assert.equal(JSON.parse(fs.readFileSync(file)).external,true);
  await syncEngine({enabled:true},1,'fake');await syncEngine({enabled:false},1,'fake');
  assert.equal(JSON.parse(fs.readFileSync(credential))['dsh-collaborative'],'before');
 }finally{delete process.env.BILI_CONFIG_FILE;}
});

test('next process recovers a settings transaction interrupted after the engine rename',async()=>{
 const {spawnSync}=await import('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collab-crash-'));
 const file=path.join(dir,'engine.json'), original='{ "compress": {} }';
 fs.writeFileSync(file,original);
 const env={...process.env,DSH_COLLAB_TEST_HOME:dir,BILI_CONFIG_FILE:file};
 const hostURL=JSON.stringify(new URL('../host.js',import.meta.url).href);
 const child=code=>spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8'});
 const stopped=child(`import fs from 'node:fs';import {saveSettings} from ${hostURL};
 const rename=fs.renameSync.bind(fs);fs.renameSync=(a,b)=>{rename(a,b);if(b===process.env.BILI_CONFIG_FILE)process.exit(73);};
 await saveSettings({enabled:true},1234,'fixture',()=>{});`);
 assert.equal(stopped.status,73,stopped.stderr);
 assert.ok(fs.existsSync(file+'.collab-transaction.json'));
 const recovered=child(`import {syncEngine} from ${hostURL};await syncEngine({enabled:false},1234,'fixture',()=>{});`);
 assert.equal(recovered.status,0,recovered.stderr);assert.equal(fs.readFileSync(file,'utf8'),original);
 assert.deepEqual(fs.readdirSync(dir),['engine.json']);
});

test('live ownership blocks token takeover; once stopped both takeover and disable recover the baseline',async()=>{
 const net=await import('node:net');const dir=process.env.DSH_COLLAB_TEST_HOME;
 const engine=path.join(dir,'owner-test.json');process.env.BILI_CONFIG_FILE=engine;
 fs.writeFileSync(engine,JSON.stringify({compress:{preserveRecentTokens:7123}}));
 const server=net.createServer(socket=>socket.end());await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 try{
  await syncEngine({enabled:true},port,'old');
  for(const enabled of [true,false])await assert.rejects(syncEngine({enabled},port+1,'replacement'),/live or unverifiable/);
  await new Promise(r=>server.close(r));
  await syncEngine({enabled:true},port,'replacement');
  await syncEngine({enabled:false},port,'third-after-token-loss');
  assert.deepEqual(JSON.parse(fs.readFileSync(engine)).compress,{preserveRecentTokens:7123});
 }finally{if(server.listening)await new Promise(r=>server.close(r));delete process.env.BILI_CONFIG_FILE;}
});
test('multi-profile import uses last install; legacy data follows original profile once',async()=>{
 const {spawnSync}=await import('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-home-'));
 const legacy=path.join(dir,'.dsh','collaborative-compaction'),owner=path.join(dir,'owner'),other=path.join(dir,'other');
 fs.mkdirSync(legacy,{recursive:true});
 for(const [name,data] of Object.entries({'local-token':'PRIVATE_FIXTURE','config.json':'{"enabled":true}','engine-before-0123456789abcdef.json':'{}','host.json':'{}'}))fs.writeFileSync(path.join(legacy,name),data);
 fs.writeFileSync(path.join(legacy,'installed-engine.json'),JSON.stringify({profilePath:other,legacyProfilePath:owner,profiles:[owner,other]}));
 const env={...process.env,HOME:dir,USERPROFILE:dir};delete env.DSH_COLLAB_TEST_HOME;delete env.DSH_PROFILE_DIR;
 const moduleURL=JSON.stringify(new URL('../runtime.js',import.meta.url).href);
 function run(extra){const proc=spawnSync(process.execPath,['--input-type=module','-e',`import {activeProfile,migrateProfile} from ${moduleURL};migrateProfile();console.log(activeProfile)`],{env:{...env,...extra},cwd:dir,encoding:'utf8'});assert.equal(proc.status,0,proc.stderr);return proc.stdout.trim();}
 assert.equal(run({}),other);assert.ok(!fs.existsSync(path.join(other,'collaborative-compaction','local-token')));
 assert.equal(run({DSH_PROFILE_DIR:owner}),owner);
 const dest=path.join(owner,'collaborative-compaction');assert.equal(fs.readFileSync(path.join(dest,'local-token'),'utf8'),'PRIVATE_FIXTURE');
 assert.equal(fs.readFileSync(path.join(dest,'config.json'),'utf8'),'{"enabled":true}');assert.ok(fs.existsSync(path.join(dest,'engine-before-0123456789abcdef.json')));
 assert.ok(!fs.existsSync(path.join(dest,'host.json')));fs.unlinkSync(path.join(dest,'local-token'));run({DSH_PROFILE_DIR:owner});assert.ok(!fs.existsSync(path.join(dest,'local-token')));
});
