import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {loadChallengeBank} from '../host.js';
import {collectCases} from '../challenge-bank.js';
import {defaults,reviewProposedClause} from '../runtime.js';

test('the example bank loads from the chosen data root; a change is visible to the publication check',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-bank-format-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 const file=path.join(root,'feedback-cases.json');
 assert.deepEqual(loadChallengeBank(root),{groups:[],digest:'built-in'});
 fs.copyFileSync(new URL('../examples/feedback-cases.json',import.meta.url),file);
 const first=loadChallengeBank(root);assert(collectCases(first.groups).diagnostics.some(p=>p.id==='witness-discovery'));
 fs.appendFileSync(file,'\n');assert.notEqual(loadChallengeBank(root).digest,first.digest);
 fs.writeFileSync(file,'{"schema":2,"groups":[]}');assert.throws(()=>loadChallengeBank(root),/schema/);
 fs.writeFileSync(file,Buffer.from([0x7b,0xff,0x7d]));assert.throws(()=>loadChallengeBank(root),/UTF-8/);
 fs.writeFileSync(file,Buffer.alloc(262145));assert.throws(()=>loadChallengeBank(root),/256 KiB/);
});

test('review uses the independent configured route, rejects a mixed refusal or truncated response and honors cancellation',async t=>{
 const key='UNIT_FAKE_CLAUSE_REVIEW_KEY';const prior=process.env[key];process.env[key]='isolated';
 t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});
 const config={...defaults,aModel:'fixture-author',reviewModel:'fixture-reviewer',reviewKeyEnv:key,reviewBase:'https://policy-review.invalid/v1'};
 let calls=0,outcome;
 const transport=async(base,endpoint,headers,body)=>{
  calls++;assert.equal(base,config.reviewBase);assert.equal(endpoint,'/responses');assert.equal(body.model,config.reviewModel);assert.equal(body.store,false);
  assert.deepEqual(headers,{authorization:'Bearer isolated'});assert(!body.tools);return outcome;
 };
 const run=(cfg=config,signal)=>reviewProposedClause('Check the rule.',{task:'review-compression-clause'},cfg,signal,transport);
 const approved={decision:'approve',safe:true,general:true,supportedTargets:['case']};
 outcome={status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(approved)}]}]};
 assert.deepEqual(await run(),approved);
 outcome.output[0].content.push({type:'refusal',refusal:'declined'});await assert.rejects(run(),/refused/);
 outcome={status:'incomplete',output:[]};await assert.rejects(run(),/incomplete/);
 await assert.rejects(run({...config,aModel:config.reviewModel}),/不同的审核模型/);
 await assert.rejects(run(config,AbortSignal.abort(Error('test cancelled'))),/cancelled/);assert.equal(calls,3);
});
