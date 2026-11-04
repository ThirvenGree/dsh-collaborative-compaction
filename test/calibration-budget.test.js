import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCalibrationBudget,usageTokens,reservedTokens,withCalibrationAccounting,currentCalibrationAccounting,BudgetPause} from '../calibration-budget.js';
import {scopeOf} from '../policy-scope.js';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'collab-budget-'));
process.env.CALIBRATION_TEST_KEY='fake-not-real';
const {defaults,validateConfig,runPipeline,reviewProposedClause}=await import('../runtime.js');
const base={...defaults,replaySliceCalls:3,replayDailyCalls:6,replayDailyTokens:1000000};
const input={input:'测试预算',outputTokens:256,model:'fixture'};

test('provider usage accounting handles all supported spellings without adding cached or reasoning totals twice',()=>{
 assert.equal(usageTokens({total_tokens:120,input_tokens:80,output_tokens:40,output_tokens_details:{reasoning_tokens:20}}),120);
 assert.equal(usageTokens({totalTokens:122,inputTokens:90,outputTokens:32}),122);
 assert.equal(usageTokens({prompt_tokens:45,completion_tokens:10}),55);
 assert.equal(usageTokens({input_tokens:10,output_tokens:20,cache_read_input_tokens:50,cache_creation_input_tokens:30}),110);
 assert.equal(usageTokens({iterations:[{input_tokens:50,output_tokens:10},{input_tokens:40,output_tokens:10}]}),110);
 for(const missing of [undefined,{},[],{input_tokens:20},{iterations:[{input_tokens:10,output_tokens:1},{}]}])assert.equal(usageTokens(missing),null);
 assert.equal(usageTokens({input_tokens:0,output_tokens:0}),0);
});

test('concurrent admissions reserve before calling providers, enforce slice calls and settle once',async()=>{
 let persisted;
 const budget=createCalibrationBudget({config:base,persist:async s=>{await Promise.resolve();persisted=s;}});
 const results=await Promise.allSettled(Array.from({length:4},()=>budget.begin(input)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,3);
 const pause=results.find(x=>x.status==='rejected').reason;
 assert.equal(pause.pauseKind,'slice-calls');assert.equal(pause.paused,true);assert.equal(pause.stopReplay,true);
 assert.equal(persisted.days[budget.snapshot().day].calls,3);
 const ticket=results[0].value;await budget.finish(ticket,{input_tokens:30,output_tokens:10});await budget.finish(ticket,{total_tokens:1});
 const shown=budget.snapshot().today;
 assert.equal(shown.knownTokens,40);assert.equal(shown.knownRequests,1);assert.equal(shown.estimatedRequests,2);
 assert.equal(shown.tokens,40+2*reservedTokens(input.input,input.outputTokens));
});

test('restarts retain charged unknown calls and daily cap; UTC midnight admits a new day',async()=>{
 let clock=Date.parse('2026-11-04T23:59:59Z'),state;
 const config={...base,replayDailyCalls:1};
 const first=createCalibrationBudget({config,now:()=>clock,persist:async s=>{state=s;}});
 await first.begin(input); // Simulates crash before receiving or persisting usage.
 const next=createCalibrationBudget({config,state,now:()=>clock,persist:async s=>{state=s;}});
 await assert.rejects(next.begin(input),error=>error.pauseKind==='daily-calls'&&error.nextAt===Date.parse('2026-11-05T00:00:00Z'));
 assert.equal(next.snapshot().today.estimatedRequests,1);
 clock+=2000;await next.begin(input);
 assert.equal(next.snapshot().day,'2026-11-05');assert.equal(next.snapshot().today.calls,1);
 assert.equal(next.snapshot().days['2026-11-04'].calls,1);
});

test('tokens are reserved conservatively and known usage releases space; missing usage does not',async()=>{
 const reservation=reservedTokens(input.input,input.outputTokens),config={...base,replayDailyTokens:reservation+20,replaySliceCalls:10};
 const budget=createCalibrationBudget({config});
 const first=await budget.begin(input);
 await assert.rejects(budget.begin(input),e=>e.pauseKind==='daily-tokens');
 await budget.finish(first,{total_tokens:10});
 const next=await budget.begin(input);await budget.finish(next);
 assert.equal(budget.snapshot().today.tokens,10+reservation);
 await assert.rejects(budget.begin(input),e=>e.pauseKind==='daily-tokens');
 const tooSmall=createCalibrationBudget({config:{...base,replayDailyTokens:1}});
 await assert.rejects(tooSmall.begin(input),e=>e.pauseKind==='request-budget'&&e.nextAt===null);
});

test('slice duration stops new admissions without cancelling or discarding an already running call',async()=>{
 let clock=1000000;
 const budget=createCalibrationBudget({config:{...base,replaySliceMs:1000},now:()=>clock});
 const ticket=await budget.begin(input);clock+=1500;
 await budget.finish(ticket,{total_tokens:50});
 assert.equal(budget.snapshot().today.knownTokens,50);
 await assert.rejects(budget.begin(input),e=>e.pauseKind==='slice-time'&&e.nextAt===clock+900000);
});

test('failed persistence blocks admission and accounting contexts remain isolated across tasks',async()=>{
 const broken=createCalibrationBudget({config:base,persist:async()=>{throw Error('disk full');}});
 await assert.rejects(broken.begin(input),/disk full/);assert.equal(broken.snapshot().today.calls,0);
 const a={},b={};
 await Promise.all([withCalibrationAccounting(a,async()=>{await Promise.resolve();assert.equal(currentCalibrationAccounting(),a);}),
  withCalibrationAccounting(b,async()=>{await Promise.resolve();assert.equal(currentCalibrationAccounting(),b);})]);
 assert.equal(currentCalibrationAccounting(),undefined);
});

test('calibration settings validate consistently and operational knobs preserve learned policy scope',()=>{
 const valid={replaySliceCalls:1,replayDailyCalls:1,replayDailyTokens:1000,replaySliceMs:1000,replayResumeMinutes:1};
 const c=validateConfig(valid);for(const [k,v] of Object.entries(valid)){assert.equal(c[k],v);assert.throws(()=>validateConfig({[k]:v-1}),new RegExp(k));assert.equal(scopeOf({...defaults,[k]:v}),scopeOf(defaults));}
});

test('native provider retries are counted individually, including unknown usage on 429',async()=>{
 const previous=globalThis.fetch;let calls=0;
 const budget=createCalibrationBudget({config:{...base,replaySliceCalls:4}});
 const settings={...defaults,enabled:true,claudeEnabled:true,reviewEnabled:false,factCheckEnabled:false,claudeKeyEnv:'CALIBRATION_TEST_KEY'};
 try{
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('',{status:429});return new Response(JSON.stringify({stop_reason:'compaction',content:[{type:'compaction',content:'简短摘要。'}],usage:{iterations:[{input_tokens:20,output_tokens:10}]}}));};
  assert.equal(await runPipeline({content:'原始材料。',instructions:'',maxSummaryChars:100},()=>{throw Error('A unused');},{settings,calibration:budget}),'简短摘要。');
  assert.equal(calls,2);assert.equal(budget.snapshot().today.calls,2);assert.equal(budget.snapshot().today.knownTokens,30);assert.equal(budget.snapshot().today.estimatedRequests,1);
 }finally{globalThis.fetch=previous;}
});

test('one-call slices resume individual pipeline stages without replaying successful A/B/review',async()=>{
 const previous=globalThis.fetch;let state={schema:1,days:{}},aCalls=0,bCalls=0,reviewCalls=0,factCalls=0;
 const stored=new Map(),checkpoint=async(key,value,fn)=>{const id=JSON.stringify([key,value]);if(stored.has(id))return stored.get(id);const result=await fn();stored.set(id,result);return result;};
 const settings={...defaults,enabled:true,factCheckEnabled:true,claudeKeyEnv:'CALIBRATION_TEST_KEY',reviewKeyEnv:'CALIBRATION_TEST_KEY'};
 const config={...settings,replaySliceCalls:1,replayDailyCalls:30},summary='已确认预算为1200元。';
 const work={content:summary,instructions:'',maxSummaryChars:100,trigger:'calibration'};
 try{
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(options.body);
   if(body.compaction){bCalls++;return new Response(JSON.stringify({stop_reason:'compaction',content:[{type:'compaction',content:summary}],usage:{iterations:[{input_tokens:30,output_tokens:10}]}}));}
   if(body.max_output_tokens){reviewCalls++;return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:summary}]}],usage:{input_tokens:30,output_tokens:10}}));}
   factCalls++;return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'1200元',sourceQuote:'1200元'}]})}],usage:{input_tokens:30,output_tokens:10}}));
  };
  for(let round=0;round<4;round++){
   const budget=createCalibrationBudget({config,state,persist:async s=>{state=s;}});
   const promise=runPipeline(work,async()=>{
    const ticket=await budget.begin({input:work,outputTokens:100,model:'fixture-A'});aCalls++;await budget.finish(ticket,{total_tokens:40});return {text:summary,usage:{total_tokens:40}};
   },{settings,calibration:budget,checkpoint});
   if(round<3)await assert.rejects(promise,e=>e instanceof BudgetPause&&e.pauseKind==='slice-calls');else assert.equal(await promise,summary);
  }
  assert.deepEqual({aCalls,bCalls,reviewCalls,factCalls},{aCalls:1,bCalls:1,reviewCalls:1,factCalls:1});
  assert.equal(Object.values(state.days)[0].calls,4);
 }finally{globalThis.fetch=previous;}
});

test('independent proposal review uses the same request budget and keeps pause identity',async()=>{
 const previous=globalThis.fetch;let calls=0;
 const budget=createCalibrationBudget({config:{...base,replaySliceCalls:1}});
 const settings={...defaults,reviewKeyEnv:'CALIBRATION_TEST_KEY'};
 try{
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'{"approved":true}'}]}],usage:{total_tokens:20}}));};
  assert.deepEqual(await reviewProposedClause('审核条款',{},settings,undefined,undefined,{calibration:budget}),{approved:true});
  await assert.rejects(reviewProposedClause('审核条款',{},settings,undefined,undefined,{calibration:budget}),e=>e instanceof BudgetPause);
  assert.equal(calls,1);assert.equal(budget.snapshot().today.knownTokens,20);
 }finally{globalThis.fetch=previous;}
});
