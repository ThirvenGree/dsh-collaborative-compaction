import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureCases,runReplaySuite,screenMethod} from '../replay.js';
const fixture=fixtureCases[0];
const correct={answer:fixture.expected,citations:[{id:'r1',quote:fixture.expected}]};
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
 assert.equal(calls,1);assert.equal(report.status,'unavailable');assert.ok(report.retryable);assert.match(report.error,/402/);
 assert.equal(report.probes[1].lanes.full.skipped,true);
});
