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
