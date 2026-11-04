import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {addDynamicCase,clearDynamicBank,dynamicBankFile,dynamicBankLimit,loadDynamicBank,markDynamicCasesTested,selectDynamicCases} from '../dynamic-bank.js';
import {collectCases,validateChallengeGroups} from '../challenge-bank.js';

const hash=x=>createHash('sha256').update(x).digest('hex');
const models={generator:'local/model-one',reviewer:'other-model'};
function fixture(label='amber'){
 const q=(kind,index,summary)=>{
  const text=label+index+' known',id=kind+label;
  return {id,question:'Which '+label+' '+kind+' item?',expected:label+index,
   records:[{id:'record'+id,role:'tool',text}],requiredIds:['record'+id],requiredQuotes:{['record'+id]:text},...(summary?{summary}:{})};
 };
 return {probe:q('probe',1,'Unknown '+label+' information.'),positive:q('positive',2),counter:q('counter',3)};
}
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dynamic-bank-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function admit(root,label,now=1){return addDynamicCase(root,{group:fixture(label),sourceHash:hash('source '+label),summaryHash:hash('summary '+label),models,now});}

test('admission stores only synthetic cases and hash provenance, with stable namespaced identifiers',t=>{
 const root=temp(t);assert.equal(loadDynamicBank(root).entries.length,0);
 const result=admit(root,'amber',1234);assert.equal(result.status,'added');
 const saved=loadDynamicBank(root);assert.equal(saved.revision,1);assert.equal(saved.entries.length,1);
 const entry=saved.entries[0];assert.match(entry.id,/^learn-[a-f0-9]{24}$/);
 assert.equal(entry.group.probe.id,entry.id+'-p');assert.equal(entry.group.probe.records[0].id,entry.id+'-p-r1');
 assert.equal(entry.sourceHash,hash('source amber'));assert.deepEqual(entry.models,models);
 const disk=fs.readFileSync(path.join(root,dynamicBankFile),'utf8');
 assert.doesNotMatch(disk,/source amber|summary amber|recordprobeamber/);
 assert.deepEqual(selectDynamicCases(root).ids,[entry.id]);
});

test('renaming source labels or replaying the same source-summary pair cannot add duplicate cases',t=>{
 const root=temp(t),first=admit(root,'amber');
 const renamed=fixture('amber');
 for(const c of Object.values(renamed)){
  const old=c.records[0].id;c.id='renamed'+c.id;c.records[0].id='renamed'+old;
  c.requiredIds=['renamed'+old];c.requiredQuotes={['renamed'+old]:c.requiredQuotes[old]};
 }
 assert.equal(addDynamicCase(root,{group:renamed,sourceHash:hash('different-source'),summaryHash:hash('different-summary'),models}).status,'duplicate');
 assert.equal(addDynamicCase(root,{group:fixture('cobalt'),sourceHash:hash('source amber'),summaryHash:hash('summary amber'),models}).status,'duplicate');
 assert.equal(loadDynamicBank(root).revision,first.state.revision);
});

test('record citations and correction links survive namespace assignment and reload',t=>{
 const root=temp(t),group=fixture('amber'),c=group.probe;
 const original=c.records[0].id;
 c.records.push({id:'revision',role:'user',text:'Replacement amber4 confirmed',corrects:original});
 c.summary='['+original+'] Unknown amber information.';
 c.requiredIds=['revision'];c.requiredQuotes={revision:'amber4 confirmed'};c.expected='amber4';
 const result=addDynamicCase(root,{group,sourceHash:hash('revised source'),summaryHash:hash('partial summary'),models});
 assert.equal(result.status,'added');
 const saved=loadDynamicBank(root).entries[0].group.probe;
 assert.equal(saved.records[1].corrects,saved.records[0].id);
 assert.deepEqual(saved.requiredIds,[saved.records[1].id]);
 assert.ok(saved.summary.startsWith('['+saved.records[0].id+']'));
});

test('bounded archive rotates oldest untested cases and content digest ignores testing metadata',t=>{
 const root=temp(t);for(const [i,label]of ['amber','cobalt','jade'].entries())assert.equal(admit(root,label,i+1).status,'added');
 const first=selectDynamicCases(root);assert.equal(first.groups.length,2);
 markDynamicCasesTested(root,first.ids,50);
 const second=selectDynamicCases(root);assert.equal(second.digest,first.digest);
 assert.ok(!first.ids.includes(second.ids[0]));assert.equal(second.total,3);
 assert.equal(second.revision,first.revision+1);
 assert.throws(()=>markDynamicCasesTested(root,['learn-nonexistent'],60),/版本/);
 assert.throws(()=>selectDynamicCases(root,{limit:3}),/最多两组/);
});

test('operator examples retain their slots, conflicting dynamic examples are skipped',t=>{
 const root=temp(t);admit(root,'amber',1);admit(root,'cobalt',2);admit(root,'jade',3);
 const manual=[fixture('amber'),fixture('opal')],selection=selectDynamicCases(root,{manualGroups:manual});
 assert.equal(selection.groups.length,2);assert.equal(selection.skipped,1);
 assert.equal(collectCases([...manual,...selection.groups]).groups.length,8);
 assert.throws(()=>validateChallengeGroups([fixture('a'),fixture('b'),fixture('c')]),/上限/);
 assert.throws(()=>collectCases([fixture('a'),fixture('b'),fixture('c'),fixture('d'),fixture('e')]),/上限/);
});

test('new groups cannot leak one another hidden cases; prior archive remains unchanged',t=>{
 const root=temp(t);admit(root,'amber');const before=fs.readFileSync(path.join(root,dynamicBankFile),'utf8');
 const colliding=fixture('jade');colliding.probe.summary='A note about amber2 known was copied.';
 assert.equal(addDynamicCase(root,{group:colliding,sourceHash:hash('new'),summaryHash:hash('new-summary'),models}).status,'conflict');
 assert.equal(fs.readFileSync(path.join(root,dynamicBankFile),'utf8'),before);
});

test('archive capacity is bounded without silently deleting prior accepted coverage',t=>{
 const root=temp(t),labels=Array.from({length:dynamicBankLimit},(_,i)=>'case'+String.fromCharCode(97+i));
 for(const [i,label]of labels.entries())assert.equal(admit(root,label,i+1).status,'added');
 const before=selectDynamicCases(root);assert.equal(admit(root,'overflow',90).status,'full');
 assert.equal(loadDynamicBank(root).entries.length,dynamicBankLimit);assert.equal(selectDynamicCases(root).digest,before.digest);
 const cleared=clearDynamicBank(root,100);assert.equal(cleared.entries.length,0);
 assert.notEqual(selectDynamicCases(root).digest,before.digest);assert.equal(cleared.revision,dynamicBankLimit+1);
});

test('malformed, oversized, tampered, and nonprivate metadata fail closed',t=>{
 const root=temp(t),file=path.join(root,dynamicBankFile);
 const write=value=>fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
 write(Buffer.from([0xff,0xfe]));assert.throws(()=>loadDynamicBank(root),/UTF-8/);
 write('x'.repeat(512*1024+1));assert.throws(()=>loadDynamicBank(root),/512/);
 fs.unlinkSync(file);const valid=admit(root,'amber').state;
 const tampered=structuredClone(valid);tampered.entries[0].group.probe.question='Changed private question?';write(tampered);
 assert.throws(()=>loadDynamicBank(root),/摘要/);
 const rawExtra=structuredClone(valid);rawExtra.entries[0].original='Sensitive real conversation';write(rawExtra);
 assert.throws(()=>loadDynamicBank(root),/登记/);
 write(valid);
 assert.throws(()=>addDynamicCase(root,{group:fixture('jade'),sourceHash:'real source',summaryHash:hash('summary'),models}),/来源/);
 assert.throws(()=>addDynamicCase(root,{group:fixture('jade'),sourceHash:hash('source'),summaryHash:hash('summary'),models:{generator:'C:\\Users\\private',reviewer:'x'}}),/模型/);
 assert.throws(()=>addDynamicCase(root,{group:fixture('jade'),sourceHash:hash('source'),summaryHash:hash('summary'),models:{...models,original:'private'}}),/模型/);
});
