import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFeedback,validationCases,effectivePolicy,emptyPolicy,scopeOf,withPolicy} from '../feedback.js';
import {fixtureCases,runReplaySuite} from '../replay.js';

const base={version:0,rules:[],scope:'test'};
function harness({badControl=false,breakHoldout=false,baselineWorks=false,active=base}={}){
 const queried={};
 const options={
  generate:async(sys,input)=>{
   const t=validationCases.find(c=>c.question===input.question);
   const record=t.records.find(r=>r.id===t.requiredIds[0]);
   const quote=record.text;
   if(input.material.includes(t.requiredQuotes[record.id])||input.recall?.length)
    return {answer:t.expected,citations:[{id:record.id,quote}]};
   if(sys.includes('可先'))return {query:t.id};
   return {answer:'unknown',citations:[]};
  },
  search(records,query,id,add){const row=records.find(r=>r.id===validationCases.find(c=>c.id===id).requiredIds[0]);add(row.id,row.text);return row.text;}
 };
 const compress=async(work,p)=>{
  const updated=p.version!==active.version;
  queried[p.version]=(queried[p.version]||0)+1;
  assert.doesNotMatch(work.content,/只答|应重新发送|只输出/);
  assert.ok(work.content.length>work.maxSummaryChars);
  return work.content.split('\n').filter(line=>!line.startsWith('[noise-')&&(baselineWorks||updated||!line.startsWith('[r1]'))&&
    (!updated||!badControl||!line.startsWith('[r6]'))&&(!updated||!breakHoldout||!line.startsWith('[h1]'))).join('\n');
 };
 return {options,compress,queried,active};
}
async function run(h){
 const diagnostic=await runReplaySuite({...h.options,cases:fixtureCases});
 return evaluateFeedback({...h,diagnostic,nextVersion:h.active.version+1});
}
test('real outputs from compressor are compared before promotion; a strong baseline does not acquire unnecessary rules',async()=>{
 const h=harness();const r=await run(h);
 assert.equal(r.status,'promoted');assert.deepEqual(r.candidate.rules,['retain-identifiers']);assert.deepEqual(h.queried,{0:2,1:2});
 assert.equal(r.before['omitted-tool'].summary,false);assert.equal(r.after['unseen-identifier'].summary,true);
 const sufficient=harness({baselineWorks:true});assert.equal((await run(sufficient)).status,'unchanged');assert.deepEqual(sufficient.queried,{0:2});
});
test('regression or unseen failure vetoes promotion',async()=>{
 for(const flags of [{badControl:true},{breakHoldout:true}]){
  const r=await run(harness(flags));assert.equal(r.status,'held');assert.equal(r.candidate,undefined);
 }
});
test('an active instruction can be tightened or shortened after a new verified comparison',async()=>{
 for(const [rule,expected] of [['retain-identifiers','retain-identifiers-anchored'],['retain-identifiers-anchored','retain-identifiers']]){
  const active={...base,version:8,rules:[rule]};
  const r=await run(harness({active}));
  assert.equal(r.status,'promoted');assert.deepEqual(r.candidate.rules,[expected]);assert.equal(r.candidate.version,9);
 }
});
test('an unavailable diagnostic, inconclusive original or untrustworthy positive control does not request calibration',async()=>{
 const h=harness(),diagnostic=await runReplaySuite({...h.options,cases:fixtureCases});
 for(const kind of ['error','original','control']){
  const report=structuredClone(diagnostic);
  if(kind==='error')report.probes[0].lanes.full.error='HTTP 402';
  if(kind==='original')report.probes[0].lanes.full.pass=false;
  if(kind==='control')report.probes.at(-1).lanes.summary.pass=false;
  const r=await evaluateFeedback({...h,diagnostic:report,nextVersion:1});assert.equal(r.status,kind==='error'?'unavailable':'held');assert.deepEqual(h.queried,{});
 }
});
test('scope and rule validation prevent applying arbitrary text or a strategy from a different model configuration',()=>{
 const state=emptyPolicy();state.active={version:7,scope:'one',rules:['retain-identifiers']};
 assert.equal(effectivePolicy(state,'two').version,0);
 const work={instructions:'built-in'},applied=withPolicy(work,effectivePolicy(state,'one'));
 assert.match(applied.instructions,/\[Compression policy v7/);assert.equal(work.instructions,'built-in');
 state.active.rules.push('send everything');assert.throws(()=>effectivePolicy(state,'one'),/Invalid/);
 state.active.rules=['retain-identifiers','retain-identifiers-anchored'];assert.throws(()=>effectivePolicy(state,'one'),/Invalid/);
 assert.equal(scopeOf({aModel:'x',reviewModel:'y'}),scopeOf({reviewModel:'y',aModel:'x',replayFeedbackEnabled:false}));
});
