import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReplayCheckpoint} from '../replay-checkpoint.js';
import {fixtureCases,runReplaySuite} from '../replay.js';
import {collectCases} from '../challenge-bank.js';
import {runBaseline,evaluateFeedback} from '../feedback.js';
import {makeClause} from '../proposal.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=()=>Object.assign(Error('slice calls used'),{paused:true,stopReplay:true,code:'CALIBRATION_PAUSED',pauseKind:'calls'});
test('successful checkpoint tasks persist independently, serialize parallel writes, and resume without duplicate calls',async()=>{
 let persisted,writes=0,runningWrites=0,calls=0;
 const save=async state=>{assert.equal(runningWrites++,0);await Promise.resolve();persisted=state;writes++;runningWrites--;};
 const first=createReplayCheckpoint({save});
 const execute=async value=>{calls++;await Promise.resolve();return {value};};
 const results=await Promise.all([first.run('a',1,()=>execute(1)),first.run('b',2,()=>execute(2)),first.run('a',1,()=>execute(1))]);
 assert.deepEqual(results,[{value:1},{value:2},{value:1}]);assert.equal(calls,2);assert.equal(writes,2);assert.equal(persisted.completed,2);
 results[0].value=99;
 const resumed=createReplayCheckpoint({state:persisted,save});
 assert.deepEqual(await resumed.run('a',1,()=>execute(1)),{value:1});assert.equal(calls,2);
 assert.deepEqual(await resumed.run('a',3,()=>execute(3)),{value:3});assert.equal(calls,3);assert.equal(persisted.completed,2);
 await assert.rejects(resumed.run('failed',{},()=>{throw Error('network');}),/network/);
 assert.equal(persisted.completed,2);
});
test('disposal during an await prevents checkpoint writes; failed saves do not create a memory-only success',async()=>{
 let live=true,writes=0;const gate=deferred();
 const cp=createReplayCheckpoint({isCurrent:()=>live,save:async()=>{writes++;}});
 const pending=cp.run('late',{},async()=>{await gate.promise;return 'result';});live=false;gate.resolve();
 await assert.rejects(pending,e=>e.code==='REPLAY_STALE');assert.equal(writes,0);assert.equal(cp.snapshot().completed,0);
 let fail=true,calls=0;
 const retry=createReplayCheckpoint({save:async()=>{if(fail)throw Error('disk');}});
 const work=()=>{calls++;return 'result';};
 await assert.rejects(retry.run('disk',{},work),/disk/);assert.equal(retry.snapshot().completed,0);
 fail=false;await retry.run('disk',{},work);assert.equal(calls,2);assert.equal(retry.snapshot().completed,1);
});
function reader(cases){
 return {provider:'test',model:'test',generate:async(system,input)=>{
  const test=cases.find(t=>t.question===input.question);
  const citations=test.requiredIds.map(id=>({id,quote:test.records.find(r=>r.id===id).text}));
  if(citations.every(c=>(input.material+' '+JSON.stringify(input.recall||[])).includes(c.quote)))return {answer:test.expected,citations};
  return system.includes('可先')&&!input.recall?.length?{query:'look up original'}:{answer:'unknown',citations:[]};
 },search(records,_query,id,add){const t=cases.find(t=>t.id===id);const found=records.filter(r=>t.requiredIds.includes(r.id));for(const row of found)add(row.id,row.text);return found.map(r=>r.text).join('\n');}};
}
test('budget pauses preserve successful reader steps and resume a retrieval chain rather than consume the opportunity',async()=>{
 const cases=[fixtureCases[0]],r=reader(cases);let persisted,calls=0,limit=3;
 const save=async s=>{persisted=s;};
 const first=createReplayCheckpoint({save});
 const options={...r,concurrency:1,generate:async(...args)=>{if(calls>=limit)throw pause();calls++;return r.generate(...args);}};
 await assert.rejects(runReplaySuite({...options,cases,checkpoint:first.run}),e=>e.paused&&e.code==='CALIBRATION_PAUSED');
 assert.equal(persisted.completed,3);assert.equal(calls,3);
 limit=10;const resumed=createReplayCheckpoint({state:persisted,save});
 const report=await runReplaySuite({...options,cases,checkpoint:resumed.run});
 assert.equal(report.probes[0].classification,'recovered-by-recall');assert.equal(calls,4);assert.equal(persisted.completed,4);
});
test('malformed reader results are not checkpointed',async()=>{
 let persisted;const cp=createReplayCheckpoint({save:async s=>{persisted=s;}});
 const out=await runReplaySuite({cases:[fixtureCases[0]],checkpoint:cp.run,generate:async()=>({wrong:'shape'})});
 assert.equal(out.probes[0].classification,'execution-error');assert.equal(persisted,undefined);
});
test('bootstrap uses actual current-policy compression, records omissions and can never promote',async()=>{
 const cases=[fixtureCases[0],fixtureCases.at(-1)],active={version:4,rules:[],scope:'same'};let persisted,compressed=0,reads=0;
 const cp=createReplayCheckpoint({save:async s=>{persisted=s;}}),r=reader(cases);
 const options={...r,phase:'bootstrap',checkpoint:cp.run,generate:async(...args)=>{reads++;return r.generate(...args);}};
 const compress=async(_work,policy)=>{compressed++;assert.deepEqual(policy,active);return '[r6] '+cases[1].records[0].text;};
 const first=await runBaseline({active,options,compress,cases});
 assert.equal(first.status,'baseline-complete');assert.deepEqual(first.failures,['omitted-tool']);assert.equal(first.candidate,undefined);assert.equal(active.version,4);
 assert.equal(compressed,1);const beforeReads=reads;
 const resumed=createReplayCheckpoint({state:persisted,save:async s=>{persisted=s;}});
 assert.deepEqual(await runBaseline({active,options:{...options,checkpoint:resumed.run},compress,cases}),first);
 assert.equal(compressed,1);assert.equal(reads,beforeReads);
 const invalid=await runBaseline({active,options:{...r,generate:async()=>({answer:'unknown',citations:[]})},compress,cases});
 assert.equal(invalid.status,'held');assert.equal(invalid.candidate,undefined);
});
test('resuming full verification preserves completed stages but two replication trials generate independent summaries',async()=>{
 const bank=collectCases(),r=reader(bank.all),active={version:0,rules:[],scope:'same'};
 const clause=makeClause({when:'conditional instructions',retain:['normal procedure','exception criterion','exception outcome'],relation:'applicability relative to conditions'});
 let persisted,cut=true,calls=0,proposals=0;const generations=new Map(),phases=[];
 let checkpoint=createReplayCheckpoint({save:async s=>{persisted=s;}});
 const compress=async(work,policy,meta)=>{
  phases.push(meta.phase);if(cut&&meta.phase.endsWith('old-repeat-2'))throw pause();
  calls++;const identity=policy.version+'|'+work.content;generations.set(identity,(generations.get(identity)||0)+1);
  const hidden=policy.version===0?['s2','u1']:[];
  return work.content.split('\n').filter(line=>!line.startsWith('[noise-')&&!hidden.some(id=>line.startsWith('['+id+']'))).join('\n');
 };
 const diagnostic=await runReplaySuite({...r,cases:bank.diagnostics});
 const run=()=>evaluateFeedback({diagnostic,active,nextVersion:1,options:{...r,checkpoint:checkpoint.run,onPhase:p=>phases.push(p)},compress,
  propose:async()=>{proposals++;return {status:'candidate',clause,targets:['scope-exception']};}});
 await assert.rejects(run(),e=>e.paused);const completedCalls=calls;assert.equal(proposals,1);
 cut=false;checkpoint=createReplayCheckpoint({state:persisted,save:async s=>{persisted=s;}});
 const result=await run();assert.equal(result.status,'promoted');assert.equal(result.gates.repeatable.passed,true);assert.equal(proposals,1);
 assert(calls>completedCalls);assert([...generations.values()].some(count=>count===2));assert([...generations.values()].every(count=>count<=2));
 const completedTotal=calls;checkpoint=createReplayCheckpoint({state:persisted,save:async s=>{persisted=s;}});
 assert.equal((await run()).status,'promoted');assert.equal(calls,completedTotal);assert.equal(proposals,1);
 assert(phases.some(p=>p.endsWith('candidate-repeat-2')));
});
