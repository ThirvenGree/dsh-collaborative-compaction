import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkDependencies} from '../scripts/check-dependencies.mjs';

test('installed dependency identities match lockfile, including workspace links',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'compaction-dependency-check-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 const manifest={name:'fixture',version:'1.0.0',dependencies:{plain:'^2.0.0'},devDependencies:{workspace:'file:./workspace'}};
 const lock={lockfileVersion:3,packages:{'':manifest,'node_modules/plain':{version:'2.1.0'},'node_modules/workspace':{link:true,resolved:'workspace'},workspace:{name:'workspace',version:'3.0.0'}}};
 write('package.json',manifest);write('package-lock.json',lock);
 write('node_modules/plain/package.json',{name:'plain',version:'2.1.0'});write('node_modules/workspace/package.json',{name:'workspace',version:'3.0.0'});
 assert.deepEqual(checkDependencies(root).dependencies,['plain@2.1.0','workspace@3.0.0']);
 write('node_modules/plain/package.json',{name:'plain',version:'2.0.0'});
 assert.throws(()=>checkDependencies(root),/differs from lockfile/);
 write('node_modules/plain/package.json',{name:'plain',version:'2.1.0'});
 manifest.dependencies.plain='^3.0.0';write('package.json',manifest);
 assert.throws(()=>checkDependencies(root),/declarations differ/);
});

test('repository dependency lock can be installed without drift',()=>{
 const root=path.resolve(import.meta.dirname,'..'),result=checkDependencies(root);
 assert.ok(result.dependencies.includes('js-tiktoken@1.0.21'));
});

test('pinned SQLite supports the FTS5 trigram search index',()=>{
 const root=path.resolve(import.meta.dirname,'..');
 assert.equal(checkDependencies(root,{sqlite:true}).sqlite,'node:sqlite');
});

test('engine pin and customized vendored kernel must both match their lock records',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'compaction-engine-pin-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 const manifest={name:'billion-context',version:'0.1.212',devDependencies:{'acp-kernel':'file:./kernel'}};
 const lock={lockfileVersion:3,packages:{'':manifest,'node_modules/acp-kernel':{link:true,resolved:'kernel'},kernel:{name:'acp-kernel',version:'0.0.178-censhu.1'}}};
 write('package.json',manifest);write('package-lock.json',lock);
 write('node_modules/acp-kernel/package.json',{name:'acp-kernel',version:'0.0.178-censhu.1'});
 assert.deepEqual(checkDependencies(root,{engineVersion:'0.1.212'}).dependencies,['acp-kernel@0.0.178-censhu.1']);
 write('node_modules/acp-kernel/package.json',{name:'acp-kernel',version:'0.0.178'});
 assert.throws(()=>checkDependencies(root,{engineVersion:'0.1.212'}),/differs from lockfile/);
 write('node_modules/acp-kernel/package.json',{name:'acp-kernel',version:'0.0.178-censhu.1'});
 manifest.version='0.1.209';write('package.json',manifest);write('package-lock.json',lock);
 assert.throws(()=>checkDependencies(root,{engineVersion:'0.1.212'}),/tested upstream pin/);
});

test('installer and CI use the same reviewed upstream commit and patch',()=>{
 const root=path.resolve(import.meta.dirname,'..');
 for(const name of ['prepare-engine.ps1','.github/workflows/ci.yml']){
  const text=fs.readFileSync(path.join(root,name),'utf8');
  assert.ok(text.includes('daa082ead8a8ead60311e29ad4627bff0f569fc1'),name+' commit pin');
  assert.ok(text.includes('patches/billion-context-v0.1.212.patch'),name+' patch pin');
  assert.ok(text.includes('--engine-version=0.1.212'),name+' installed version validation');
  assert.ok(!text.includes('v0.1.209'),name+' has a stale patch');
 }
});
