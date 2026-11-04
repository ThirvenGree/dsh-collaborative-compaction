import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execSync} from 'node:child_process';

// npm ci installs the lockfile. Check the package identities too, including the engine's
// linked workspaces, so a warm developer node_modules cannot hide a mismatched dependency.
export function checkDependencies(directory,{sqlite=false}={}){
 const root=path.resolve(directory),read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 const manifest=read('package.json'),lock=read('package-lock.json'),base=lock.packages?.[''];
 assert.equal(lock.lockfileVersion,3,'Expected a v3 npm lockfile');
 assert.equal(base?.name,manifest.name,'Manifest and lockfile package names differ');
 assert.equal(base?.version,manifest.version,'Manifest and lockfile package versions differ');
 const checked=[];
 for(const section of ['dependencies','devDependencies','optionalDependencies']){
  assert.deepEqual(base[section]||{},manifest[section]||{},section+' declarations differ from the lockfile');
  for(const name of Object.keys(manifest[section]||{})){
   const relative='node_modules/'+name,record=lock.packages[relative];
   assert.ok(record,'Missing locked dependency '+name);
   const expected=record.link?lock.packages[record.resolved]?.version:record.version;
   assert.ok(expected,'Missing resolved version '+name);
   let installed;
   try{installed=read(relative+'/package.json');}
   catch(error){if(section==='optionalDependencies'&&error.code==='ENOENT')continue;throw error;}
   assert.equal(installed.name,name,'Installed dependency identity differs: '+name);
   assert.equal(installed.version,expected,'Installed dependency differs from lockfile: '+name);
   checked.push(name+'@'+installed.version);
  }
 }
 if(sqlite){
  // CI explicitly exercises the same builtin SQLite driver instead of silently falling back
  // to a host-installed native module or downloading a different binary during the test.
  const require=createRequire(pathToFileURL(path.join(root,'package.json')));
  const {DatabaseSync}=require('node:sqlite');
  const database=new DatabaseSync(':memory:');
  try{
   assert.equal(database.prepare('SELECT 1 AS ok').get().ok,1);
   database.exec("CREATE VIRTUAL TABLE fts_probe USING fts5(body, tokenize='trigram');");
   database.prepare('INSERT INTO fts_probe(body) VALUES(?)').run('中文检索 autoFoldTargetTokens=80000');
   assert.equal(database.prepare('SELECT count(*) AS n FROM fts_probe WHERE fts_probe MATCH ?').get('"中文检索"').n,1,'SQLite must provide FTS5 trigram');
  }finally{database.close();}
 }
 return {package:manifest.name,version:manifest.version,node:process.version,dependencies:checked,sqlite:sqlite?'node:sqlite':'not required'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const repository=path.resolve(import.meta.dirname,'..');
 const expectedNode=fs.readFileSync(path.join(repository,'.node-version'),'utf8').trim();
 const manager=JSON.parse(fs.readFileSync(path.join(repository,'package.json'),'utf8')).packageManager;
 const npm=execSync('npm --version',{encoding:'utf8',windowsHide:true}).trim();
 if(process.argv.includes('--pinned-toolchain')){
  assert.equal(process.versions.node,expectedNode,'Use the same Node version as .node-version');
  assert.match(manager,/^npm@\d+\.\d+\.\d+$/,'Declare the tested npm version');
  assert.equal('npm@'+npm,manager,'Use the same npm version as packageManager');
 }
 console.log(JSON.stringify({...checkDependencies(process.argv[2]||process.cwd(),{sqlite:process.argv.includes('--sqlite')}),npm},null,2));
}
