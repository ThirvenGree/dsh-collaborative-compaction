import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixtureCases,runReplaySuite,screenMethod,replaySearch} from '../replay.js';
const fixture=fixtureCases[0];
const correct={answer:fixture.expected,citations:[{id:'r1',quote:fixture.expected}]};
test('isolated replay always opts out of persistent process search caches',()=>{
 let received;
 const search=replaySearch((...args)=>{received=args;return 'evidence';});
 const rows=[{id:'private',role:'user',text:'临时原文'}];
 assert.equal(search(rows,'原文','check'), 'evidence');
 assert.match(received[0].id,/^isolated-replay:/);
 assert.deepEqual(received[7],{cache:false});
 assert.equal(received[4][0].text,'临时原文');
});
test('only matching displayed records can ground an answer; summary can be correct without evidence',async()=>{
 const calls=[];
 const out=await runReplaySuite({cases:[fixture],provider:'p',model:'same',generate:async(_s,input,config)=>{
  calls.push([config.provider,config.model]);if(input.material===fixture.summary&&_s.includes('可先')&&!input.recall)return {query:'工具'};
  return correct;
 },search:(_rows,_q,_id,emit)=>{emit('wrong',fixture.expected);return '[wrong] '+fixture.expected;}});
 const {lanes,classification}=out.probes[0];assert.ok(lanes.full.pass);assert.ok(lanes.summary.correct);assert.equal(lanes.summary.cited,false);
 assert.equal(lanes.retrieval.pass,false);assert.equal(lanes.retrieval.foundRequired,false);
 assert.equal(classification,'correct-answer-without-grounding');assert.ok(calls.every(([p,m])=>p==='p'&&m==='same'));
});
test('grounded short excerpt in a long record recovers the task and positive control can pass without searching',async()=>{
 const long={...fixture,records:[{...fixture.records[0],text:'x'.repeat(4000)+fixture.expected+'y'.repeat(4000)}]};
 const control=fixtureCases.at(-1);
 const out=await runReplaySuite({cases:[long,control],generate:async(system,input)=>{
  if(input.question===control.question)return {answer:control.expected,citations:control.summaryCitations};
  if(input.material===fixture.summary&&!input.recall)return system.includes('可先')?{query:'工具'}:{answer:'unknown',citations:[]};
  return correct;
 },search:(_r,_q,_id,emit)=>{emit('r1',fixture.expected);return '[r1] '+fixture.expected}});
 assert.equal(out.probes[0].classification,'recovered-by-recall');assert.equal(out.probes[0].lanes.retrieval.foundRequired,true);
 assert.equal(out.probes[1].classification,'summary-sufficient');
});
test('method self-citation cannot pass, reject secret excerpts and malformed probes before calls',async()=>{
 const base={id:'a',question:'是否采用？',records:[{role:'tool',id:'m',text:'真实回执原文'}],expected:'use',requiredIds:['m']};
 const input={candidateId:'candidate',method:'真实回执原文',probes:[base,{...base,id:'b',expected:'avoid',question:'另一情境'}]};
 const fake={generate:async(_s,x)=>({answer:x.question.startsWith('另一')?'avoid':'use',citations:[{id:'m',quote:'真实回执原文'}]}),search:()=>''};
 const report=await screenMethod(input,fake);assert.equal(report.status,'unconfirmed');assert.ok(report.probes.every(p=>p.lanes.full.pass&&!p.lanes.summary.cited));
 await assert.rejects(()=>screenMethod({...input,method:'api_key=privatekey'},fake));
 await assert.rejects(()=>screenMethod({...input,probes:[base,base]},fake));
});

test('a quota rejection pauses all remaining lanes and makes method screening retryable',async()=>{
 const probe={id:'a',question:'此时可以采用吗？',expected:'use',records:[{id:'rec',role:'tool',text:'可核对的原始回执'}],requiredIds:['rec']};
 const gate={candidateId:'c',method:'练习方法',probes:[probe,{...probe,id:'b',expected:'avoid'}]};let calls=0;
 const report=await screenMethod(gate,{model:'same',provider:'p',search(){throw Error('unexpected')},generate:async()=>{
  calls++;throw Object.assign(Error('ACCOUNT_QUOTA 402'),{stopReplay:true});
 }});
 assert.ok(calls>=1&&calls<=2,'at most already-started cases can reach the provider');assert.equal(report.status,'unavailable');assert.ok(report.retryable);assert.match(report.error,/402/);
 assert.equal(report.probes[1].lanes.summary.skipped,true);
});

test('independent cases overlap up to three while lanes and retrieval stay sequential and output order stays stable',async()=>{
 const cases=Array.from({length:8},(_,i)=>({...fixture,id:'parallel-'+i,question:'question-'+i}));
 let active=0,peak=0;const inflight=new Set(),seen=new Map();
 const report=await runReplaySuite({cases,generate:async(system,input)=>{
  assert(!inflight.has(input.question),'same case cannot have overlapping model calls');
  inflight.add(input.question);active++;peak=Math.max(peak,active);
  const lane=input.material===fixture.summary?system.includes('可先')?'retrieval':'summary':'full';
  const trace=seen.get(input.question)||[];trace.push(lane);seen.set(input.question,trace);
  await delay((Number(input.question.at(-1))%3+1)*3);active--;inflight.delete(input.question);
  return lane==='retrieval'&&!input.recall?{query:'original'}:correct;
 },search:async(_r,_q,_id,emit)=>{active++;peak=Math.max(peak,active);await delay(2);active--;emit('r1',fixture.expected);return fixture.expected;}});
 assert.equal(active,0);assert.equal(peak,3);assert.deepEqual(report.probes.map(p=>p.id),cases.map(c=>c.id));
 for(const trace of seen.values())assert.deepEqual(trace,['full','summary','retrieval','retrieval']);
});

test('fatal provider failure cancels peers, prevents new model/search calls and drains in-flight tasks',async()=>{
 const cases=Array.from({length:7},(_,i)=>({...fixture,id:'failure-'+i,question:'failure-'+i}));
 let active=0,calls=0,searches=0,abortedPeers=0;
 const report=await runReplaySuite({cases,generate:async(_sys,input,{signal})=>{
  calls++;active++;
  try{
   if(input.question==='failure-0'){await delay(3);throw Object.assign(Error('HTTP 429'),{stopReplay:true});}
   await delay(20);if(signal.aborted)abortedPeers++;return {query:'must not search'};
  }finally{active--;}
 },search:()=>{searches++;return '';}});
 assert.equal(calls,3);assert.equal(searches,0);assert.equal(active,0);assert.equal(abortedPeers,2);
 assert(report.probes.every(p=>p.classification==='execution-error'));
 assert(report.probes.slice(3).every(p=>p.lanes.full.skipped));
});

test('external cancellation drains active cases before rejection and starts no later work',async()=>{
 const controller=new AbortController();let active=0,calls=0;
 const pending=runReplaySuite({cases:Array.from({length:6},(_,i)=>({...fixture,id:'cancel-'+i})),signal:controller.signal,
  generate:async()=>{calls++;active++;try{await delay(25);return correct;}finally{active--;}},search:()=>{throw Error('no search');}});
 await delay(3);controller.abort(Error('operator cancelled'));
 await assert.rejects(pending,/operator cancelled/);assert.equal(active,0);assert.equal(calls,3);
});
