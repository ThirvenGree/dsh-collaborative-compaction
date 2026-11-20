// 2026-11-15: a candidate or review summary outside the length bounds no longer fails a range the other candidate covers.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-fallback-'));process.env.FALLBACK_TEST_KEY='not-real';
const {runPipeline,defaults,runs}=await import('../runtime.js');
const latest=()=>runs().sort((a,b)=>b.startedAt-a.startedAt)[0];
const B='青枔问今天怎么样，岑舒说在家窝着，外头风挺大，并问她连问两遍是不是有什么事。';
const settings={...defaults,enabled:true,claudeEnabled:true,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'FALLBACK_TEST_KEY',claudeKeyEnv:'FALLBACK_TEST_KEY'};
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
function transport(review,seen={}){
 return async(_b,route,_h,body)=>{
  if(route==='/messages')return {stop_reason:'compaction',content:[{type:'compaction',content:B}],usage:{iterations:[{input_tokens:100,output_tokens:30}]}};
  const ins=body.instructions||'';
  if(/Audit candidates/.test(ins)){seen.review=JSON.parse(body.input);return reply(review);}
  return reply(JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'风挺大',sourceQuote:'风挺大'}]}));
 };
}
const work=tag=>({content:'青枔：今天怎么样\n岑舒：在家窝着，外头风挺大。你连问两遍，是有什么事吧\n'.repeat(3)+tag,instructions:'',maxSummaryChars:300,minSummaryChars:30,trigger:'auto'});
test('a too-short A no longer fails the range when B is valid',async()=>{
 const seen={};
 const out=await runPipeline(work('a'),async()=>'太短',{settings,transport:transport(B,seen)});
 assert.equal(out,B);assert.equal(seen.review.summaryA,null);assert.equal(seen.review.summaryB,B);
 const r=latest();assert.equal(r.status,'validated');assert.equal(r.stages.find(s=>s.name==='A').status,'failed');
});
test('a too-short review falls back to B and is still fact-checked',async()=>{
 const out=await runPipeline(work('b'),async()=>B,{settings,transport:transport('太短')});
 assert.equal(out,B);
 const r=latest();const review=r.stages.find(s=>s.name==='review');assert.equal(review.status,'fallback');assert.equal(review.fallbackTo,'B');
 assert.equal(r.stages.find(s=>s.name==='fact-check').status,'success');
});
test('both candidates failing still fails the range',async()=>{
 const bad={...settings,claudeEnabled:false};
 await assert.rejects(runPipeline(work('c'),async()=>'太短',{settings:bad,transport:transport(B)}),/too short/);
});
test('a review failure other than length still fails the range',async()=>{
 const t=transport(B);const failing=async(b,route,h,body)=>{if(/Audit candidates/.test(body.instructions||''))return {status:'incomplete',output:[]};return t(b,route,h,body);};
 await assert.rejects(runPipeline(work('d'),async()=>B,{settings,transport:failing}),/incomplete or refused/);
});
