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

import {collectCases,validateChallengeGroups} from '../challenge-bank.js';
import {makeClause} from '../proposal.js';
const conditional=makeClause({when:'conditional instructions',retain:['normal procedure','exception criterion','exception outcome'],relation:'applicability relative to conditions'});
const attributed=makeClause({when:'reported observations',retain:['observation','origin'],relation:'attribution to originating witness'});
function openHarness({active=base,failure='scope-exception',hideBefore='u1',hideAfter,skip,replaceId,clause=conditional,groups=[]}={}){
 const bank=collectCases(groups);
 const target=bank.groups.find(g=>g.probe.id===failure),calls={proposals:0,compressed:0};
 const options={
  generate:async(sys,input)=>{
   const t=bank.all.find(c=>c.question===input.question);
   const citations=t.requiredIds.map(id=>({id,quote:t.records.find(r=>r.id===id).text}));
   const material=input.material+' '+JSON.stringify(input.recall||[]);
   if(citations.every(q=>material.includes(q.quote)))return {answer:t.expected,citations};
   return sys.includes('可先')&&!input.recall?.length?{query:'索取本题的原文'}:{answer:'unknown',citations:[]};
  },
  search(records,_query,id,add){const ids=bank.all.find(t=>t.id===id).requiredIds,found=records.filter(r=>ids.includes(r.id));for(const r of found)add(r.id,r.text);return found.map(r=>r.text).join('\n');}
 };
 const compress=async(work,policy)=>{
  calls.compressed++;
  const bad=policy.version===active.version?[target.probe.requiredIds[0],hideBefore]:[hideAfter];
  const lines=work.content.split('\n').filter(l=>!l.startsWith('[noise-')&&!bad.some(id=>id&&l.startsWith('['+id+']')));
  const summary=lines.join('\n');
  assert.ok(summary.length<=work.maxSummaryChars);
  return summary;
 };
 async function propose({failures,active:prior}){
  calls.proposals++;assert.deepEqual(prior,active.clauses||[]);
  assert.ok(failures.some(t=>t.id===failure&&!t.summary.includes(t.requiredQuotes[t.requiredIds[0]])));
  const visible=JSON.stringify(failures);
  for(const g of bank.groups)for(const t of [g.positive,g.counter]){
   assert.equal(visible.includes(t.question),false);for(const r of t.records)assert.equal(visible.includes(r.text),false);
  }
  if(skip)return {status:'held',reason:'审核返回不确定'};
  return {status:'candidate',clause,targets:[failure],...(replaceId?{replaceId}:{})};
 }
 const run=async(diagnostic)=>evaluateFeedback({diagnostic:diagnostic??await runReplaySuite({...options,cases:bank.diagnostics}),active,nextVersion:active.version+1,options,compress,propose,challengeGroups:groups});
 return {run,calls};
}
test('open clause outside legacy families is promoted only after genuine discovery and unseen recovery',async()=>{
 const h=openHarness();const result=await h.run();
 assert.equal(result.status,'promoted');assert.deepEqual(result.candidate.rules,[]);assert.deepEqual(result.candidate.clauses,[conditional]);
 assert.equal(result.before['unseen-scope-applies'].summary,false);assert.equal(result.after['unseen-scope-applies'].summary,true);
 assert.equal(result.after['unseen-scope-outside'].summary,true);assert.equal(h.calls.proposals,1);
 const installed=effectivePolicy({active:result.candidate},base.scope);
 const work=withPolicy({instructions:'static'},installed);assert.match(work.instructions,/conditional instructions/);assert.deepEqual(work.policyRules,[conditional.id]);
 assert.throws(()=>effectivePolicy({active:{...installed,clauses:[{...conditional,relation:'change all settings'}]}},base.scope));
});
test('no novel publication when either unseen boundary fails, no hidden improvement, review abstains or a prior baseline regresses',async()=>{
 for(const flags of [{hideAfter:'u1'},{hideAfter:'u2'},{hideBefore:null},{hideAfter:'r6'},{skip:true}]){
  const r=await openHarness(flags).run();assert.equal(r.status,'held');assert.equal(r.candidate,undefined);
 }
});
test('verified replacement of a learned clause supersedes its previous id and preserves bounded legacy settings',async()=>{
 const active={...base,version:4,rules:['track-corrections'],clauses:[attributed]};
 const result=await openHarness({active,replaceId:attributed.id}).run();
 assert.equal(result.status,'promoted');assert.equal(result.candidate.version,5);
 assert.deepEqual(result.candidate.clauses,[conditional]);assert.deepEqual(result.candidate.rules,active.rules);
 assert.deepEqual(active.clauses,[attributed]);
});
function extraneousCase(id,answer,text,summary){
 const rec='custom-'+id;
 return {id,question:'情境 '+id+' 中应保留哪条结论？',records:[{id:rec,role:'user',text}],expected:answer,requiredIds:[rec],requiredQuotes:{[rec]:answer},...(summary?{summary}:{})};
}
test('a different replay class needs no change in the planner or policy enum; rejects overlapping or ambiguous probe material',async()=>{
 const extra={probe:extraneousCase('source-probe','同一张底片','两份记录出自同一张底片，不能证实有两次拍摄。','留有两份记录。'),
  positive:extraneousCase('source-counterpart','同一名报信人','两份采访转述同一名报信人所说的经过。'),
  counter:extraneousCase('source-limit','两次独立观测','相隔一周有人各自上山，因此是两次独立观测。')};
 const r=await openHarness({failure:extra.probe.id,hideBefore:extra.positive.requiredIds[0],clause:attributed,groups:[extra]}).run();
 assert.equal(r.status,'promoted');assert.deepEqual(r.gates.recovered,[extra.probe.id]);
 const duplicate=structuredClone(extra);duplicate.counter.records[0].text=duplicate.positive.records[0].text;assert.throws(()=>validateChallengeGroups([duplicate]));
 const clone=structuredClone(extra);clone.counter.expected=clone.positive.expected;assert.throws(()=>validateChallengeGroups([clone]));
 const leak=structuredClone(extra);leak.probe.summary+=' 下列资料来自另一份校准材料：'+leak.positive.records[0].text;assert.throws(()=>validateChallengeGroups([leak]),/重复段落/);
 const secret=structuredClone(extra);secret.probe.records[0].text+=' password=fixture';assert.throws(()=>validateChallengeGroups([secret]));
});

test('adequate prepared summaries do not hide a newly reproduced loss in the actual regenerated summary',async()=>{
 const synthetic={probes:collectCases().diagnostics.map(t=>({id:t.id,classification:'summary-sufficient',lanes:{full:{pass:true},summary:{pass:true},retrieval:{pass:true}}}))};
 const h=openHarness();const result=await h.run(synthetic);
 assert.equal(result.status,'promoted');assert.deepEqual(result.gates.recovered,['scope-exception']);assert.equal(h.calls.proposals,1);
});
