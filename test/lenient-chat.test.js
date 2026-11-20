// 2026-11-14: the chat workspace uses lenient verification; other scopes stay strict.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'lenient-chat-'));process.env.LENIENT_TEST_KEY='not-real';
const {runPipeline,defaults,factEvidenceStatus}=await import('../runtime.js');
const summary='她说周日见，先确认地址。',original='她说：周日见。决定先确认地址。';
const facts=[{summaryQuote:'先确认地址',sourceQuote:'先确认地址'},{summaryQuote:'周日见面',sourceQuote:'周日见'}];
test('minor issues never block, blocking findings still do',()=>{
 const minor={approved:true,missingCritical:[],unsupported:[],minorIssues:['措辞略有不同'],facts:facts.slice(0,1)};
 assert.equal(factEvidenceStatus(minor,summary,original,24,false,true).valid,true);
 assert.equal(factEvidenceStatus(minor,summary,original,24,false,true).diagnostic.minor,1);
 const blocking={...minor,unsupported:['把未说明的说话人写成了青枔']};
 assert.equal(factEvidenceStatus(blocking,summary,original,24,false,true).valid,false);
 assert.equal(factEvidenceStatus({...minor,approved:false},summary,original,24,false,true).valid,false);
});
test('one anchored quote is enough only in lenient mode',()=>{
 const v={approved:true,missingCritical:[],unsupported:[],facts};
 assert.equal(factEvidenceStatus(v,summary,original,24,false,true).valid,true);
 const strict=factEvidenceStatus(v,summary,original,24,false,false);assert.equal(strict.valid,false);assert.equal(strict.repairable,true);
 const none={approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'不存在',sourceQuote:'不存在'}]};
 const r=factEvidenceStatus(none,summary,original,24,false,true);assert.equal(r.valid,false);assert.equal(r.repairable,true);
});
// 2026-11-20: a non-empty chat summary needs one anchored quote even in lenient mode; without quotes it is sent
// back for a quote recheck (repairable) instead of passing. An empty range still passes without quotes.
test('an approval without quotes never passes for a non-empty chat summary',()=>{
 const v={approved:true,missingCritical:[],unsupported:[],facts:[]};
 const lenient=factEvidenceStatus(v,summary,original,24,false,true);
 assert.equal(lenient.valid,false);assert.equal(lenient.repairable,true);
 assert.equal(factEvidenceStatus(v,summary,original,24,true,true).valid,true);
 assert.equal(factEvidenceStatus(v,summary,original,24,false,false).valid,false);
});
const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'LENIENT_TEST_KEY'};
for(const scope of ['conversation','strict'])test(`${scope} scope ${scope==='conversation'?'accepts':'rechecks'} a partly anchored approval`,async()=>{
 const prompts=[];const check={approved:true,missingCritical:[],unsupported:[],minorIssues:['语气更简短'],facts};
 const transport=async(_b,_p,_h,body)=>{prompts.push(body.instructions);return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(check)}]}]};};
 const work={content:original+scope,maxSummaryChars:200,...(scope==='conversation'?{validationScope:{mode:'conversation'},instructions:'chat guidance'}:{})};
 const p=runPipeline(work,async()=>summary,{settings,transport});
 if(scope==='conversation'){assert.equal(await p,summary);assert.equal(prompts.length,1);assert.match(prompts[0],/minorIssues never block/);}
 else{await assert.rejects(p,/Independent fact verification failed/);assert.ok(prompts.length>=2);assert.ok(prompts.every(x=>!/minorIssues/.test(x)));}
});
