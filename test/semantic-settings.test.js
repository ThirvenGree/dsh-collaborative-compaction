import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createSemanticSettings,localSettingsRequest} from '../semantic-host.js';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-semantic-settings-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'semantic-search.json'),calls=[];
 const defaults={enabled:false,keyEnv:'GEMINI_API_KEY',dimensions:1536,selectedSessions:[]};
 const schema={defaults,configPath:()=>file,validate:c=>{const x={...defaults,...c};if(![768,1536,3072].includes(x.dimensions))throw Error('Invalid dimensions');return x;},loadStatus:()=>({instance:'worker-a',phase:'idle'}),control:(...args)=>calls.push(args)};
 return {file,calls,settings:createSemanticSettings({loadEngine:async()=>schema,keyAvailable:async()=>true})};
}
test('semantic settings stay independent and refresh never requests work',async t=>{
 const {settings,calls,file}=await fixture(t);
 const initial=await settings.snapshot();assert.equal(initial.config.enabled,false);assert.equal(initial.keyConfigured,true);
 const next=await settings.update({action:'save',revision:initial.revision,changes:{enabled:true,dimensions:768}});
 assert.equal(next.config.dimensions,768);assert.equal(next.config.enabled,true);
 await settings.snapshot();await settings.snapshot();assert.deepEqual(calls,[]);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).enabled,true);
});
test('malformed or changed config is never overwritten and validation precedes writes',async t=>{
 const {settings,file}=await fixture(t),initial=await settings.snapshot();
 await assert.rejects(settings.update({revision:initial.revision,changes:{dimensions:777}}),/Invalid dimensions/);
 await assert.rejects(fs.readFile(file),{code:'ENOENT'});
 await fs.writeFile(file,'{"enabled":true,"dimensions":3072}');
 await assert.rejects(settings.update({revision:initial.revision,changes:{enabled:false}}),/其他窗口/);
 const before=await fs.readFile(file,'utf8');assert.equal(JSON.parse(before).enabled,true);
 await fs.writeFile(file,'{broken');assert.equal((await settings.snapshot()).available,false);
 await assert.rejects(settings.update({revision:initial.revision,changes:{enabled:false}}));
 assert.equal(await fs.readFile(file,'utf8'),'{broken');
});
test('queue controls preserve instance identity without silently changing config',async t=>{
 const {settings,calls}=await fixture(t);
 await settings.update({action:'retry',instance:'worker-a'});
 assert.equal(calls[0][0],'retry');assert.equal(calls[0][2],'worker-a');
 assert.equal((await settings.snapshot()).config.enabled,false);
 await assert.rejects(settings.update({action:'send-raw'}),/Unknown/);
});
test('DNS rebinding and cross-origin settings requests fail closed',()=>{
 const request=(host,extra={})=>({headers:{host,...extra},socket:{localPort:3210}});
 assert.equal(localSettingsRequest(request('127.0.0.1:3210')),true);
 assert.equal(localSettingsRequest(request('localhost:3210',{origin:'http://localhost:3210'})),true);
 assert.equal(localSettingsRequest(request('[::1]:3210')),true);
 for(const r of [request('attacker.example:3210'),request('127.0.0.1:3333'),request('127.0.0.1:3210',{origin:'https://evil.example'}),request('127.0.0.1:3210',{'sec-fetch-site':'cross-site'})])assert.equal(localSettingsRequest(r),false);
});
