import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'collab-host-'));
const {body,syncEngine}=await import('../host.js');
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
