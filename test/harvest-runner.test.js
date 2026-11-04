import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {emptyHarvest,HarvestRunner,harvestLimits,validateHarvestState} from '../harvest-runner.js';

const hour=3600000;
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(condition){for(let i=0;i<300;i++){if(condition())return;await delay(1);}assert.fail('runner did not reach expected state');}
function harness(options={}){
 let state=structuredClone(options.state||emptyHarvest()),clock=Date.UTC(2026,10,4,4),current={enabled:true,replayHarvestEnabled:true,reviewEnabled:true,
  aProvider:'dsh',aModel:'main-model',reviewModel:'review-model',reviewBase:'https://review.invalid',reviewKeyEnv:'FAKE_KEY'};
 const writes=[],calls=[],admissions=[],notifications=[];
 const read=()=>structuredClone(state);
 const mutate=async fn=>{
  if(options.beforeMutate)await options.beforeMutate();
  const next=fn(read());
  if(next){state=structuredClone(next);writes.push(read());}
  return next?read():null;
 };
 const runner=new HarvestRunner({read,mutate,config:()=>({...current}),now:()=>clock,
  process:async(...args)=>{calls.push(args);return options.process?options.process(...args):{status:'clean'};},
  admit:async(value,valid)=>{
   if(options.beforeAdmit)await options.beforeAdmit();
   if(!valid())return {status:'cancelled'};
   admissions.push(value);return options.admit?options.admit(value):{status:'added'};
  },onAdmit:()=>notifications.push(clock)});
 return {runner,writes,calls,admissions,notifications,read,config:patch=>Object.assign(current,patch),advance:n=>clock+=n,now:()=>clock};
}
const item=(i=1,extra={})=>({content:'私密来源原文 '+i,summary:'压缩结果 '+i,trigger:'auto',...extra});
async function done(h){await until(()=>!h.runner.running);}

test('only enabled eligible live compression queues learning; calibration/test/disabled paths make no call',async()=>{
 const h=harness();
 for(const value of [item(1,{trigger:'calibration'}),item(2,{trigger:'test'}),item(3,{eligible:false}),item(4,{trigger:'direct'}),item(5,{content:''})])
  assert.equal(h.runner.enqueue(value),false);
 h.config({replayHarvestEnabled:false});assert.equal(h.runner.enqueue(item(6)),false);
 h.config({replayHarvestEnabled:true,reviewEnabled:false});assert.equal(h.runner.enqueue(item(9)),false);assert.match(h.runner.status().blockedReason,/交叉审核已关闭/);
 h.config({reviewEnabled:true});
 h.config({replayHarvestEnabled:true,enabled:false});assert.equal(h.runner.enqueue(item(7)),false);
 await h.runner.pump();assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
 h.config({enabled:true});assert.equal(h.runner.enqueue(item(8,{trigger:'tool'})),true);await done(h);assert.equal(h.calls.length,1);
});

test('memory queue includes in-flight work and rejects oversized source without truncating it',async()=>{
 const gate=deferred(),h=harness({process:()=>gate.promise});
 assert.equal(h.runner.enqueue(item(1)),true);await until(()=>h.calls.length===1);
 assert.equal(h.runner.enqueue(item(2)),true);
 assert.equal(h.runner.enqueue(item(3)),false);assert.equal(h.runner.status().queued,1);
 assert.equal(h.runner.enqueue(item(1)),false);
 gate.resolve({status:'clean'});await done(h);await h.runner.pump();assert.equal(h.calls.length,2);
 assert.equal(h.runner.enqueue(item(4,{content:'中'.repeat(harvestLimits.sourceChars+1)})),false);
 assert.equal(h.runner.enqueue(item(5,{summary:'文'.repeat(100001)})),false);
 assert.equal(h.runner.enqueue(item(6,{content:'中'.repeat(harvestLimits.sourceChars)})),true);await done(h);
 assert.equal(h.calls.at(-1)[0].content.length,harvestLimits.sourceChars);
});

test('daily cap is shared through persisted state, surviving restart and resetting next day',async()=>{
 const h=harness();
 for(let i=0;i<harvestLimits.daily;i++){assert.equal(h.runner.enqueue(item(i)),true);await done(h);}
 assert.equal(h.calls.length,4);assert.equal(h.runner.status().today.attempts,4);
 assert.equal(h.runner.enqueue(item(5)),true);await done(h);assert.equal(h.calls.length,4);assert.equal(h.runner.status().queued,1);
 const fresh=harness({state:h.read()});fresh.runner.enqueue(item(6));await done(fresh);assert.equal(fresh.calls.length,0);
 fresh.advance(24*hour);await fresh.runner.pump();assert.equal(fresh.calls.length,0,'yesterday\'s transient source expires instead of silently learning it');
 fresh.runner.enqueue(item(7));await done(fresh);assert.equal(fresh.calls.length,1);assert.equal(fresh.runner.status().today.attempts,1);
});

test('seen hashes deduplicate across restart and persistence never contains private inputs or raw model/provider details',async()=>{
 const secret='CONFIDENTIAL source and provider reply';
 const h=harness({process:async()=>({status:'held',reason:secret,error:secret})});
 h.runner.enqueue(item(1,{content:secret,summary:'private summary'}));await done(h);
 assert.equal(h.read().seen.length,1);assert.match(h.read().seen[0].key,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(JSON.stringify(h.writes),/CONFIDENTIAL|private summary|私密来源|压缩结果/);
 assert.equal(h.runner.enqueue(item(1,{content:secret,summary:'private summary'})),false);
 const fresh=harness({state:h.read()});assert.equal(fresh.runner.enqueue(item(1,{content:secret,summary:'private summary'})),false);assert.equal(fresh.calls.length,0);
});

test('retryable failure retains only transient job, waits one hour and uses source again once eligible',async()=>{
 let count=0;const h=harness({process:async()=>++count===1?{status:'held',retryable:true,reason:'raw error text'}:{status:'clean'}});
 h.runner.enqueue(item());await done(h);
 assert.equal(h.read().seen[0].status,'retry');assert.equal(h.read().nextRetryAt,h.now()+hour);assert.equal(h.runner.status().queued,1);
 assert.doesNotMatch(JSON.stringify(h.writes),/raw error text|私密来源原文|压缩结果/);
 await h.runner.pump();assert.equal(h.calls.length,1);
 h.advance(hour-1);await h.runner.pump();assert.equal(h.calls.length,1);
 h.advance(1);await h.runner.pump();assert.equal(h.calls.length,2);assert.equal(h.runner.status().queued,0);
 assert.equal(h.read().seen[0].status,'done');assert.equal(h.read().nextRetryAt,0);
});

test('cancel and disposal while model is awaiting prevent admission and status writes after cancellation',async()=>{
 for(const action of ['cancel','dispose']){
  for(const outcome of ['resolved','rejected']){
  const gate=deferred(),h=harness({process:()=>gate.promise});h.runner.enqueue(item());await until(()=>h.calls.length===1);
  h.runner[action]();const before=h.writes.length;
  if(outcome==='resolved')gate.resolve({status:'admitted',group:{synthetic:true}});else gate.reject(Error('private provider payload'));
  await done(h);
  assert.equal(h.admissions.length,0);assert.equal(h.notifications.length,0);assert.equal(h.writes.length,before);
  assert.equal(h.runner.status().queued,0);
  }
 }
});

test('changed model configuration invalidates a completed candidate instead of publishing it',async()=>{
 const gate=deferred(),h=harness({process:()=>gate.promise});h.runner.enqueue(item());await until(()=>h.calls.length===1);
 h.config({reviewModel:'new-review-model'});gate.resolve({status:'admitted',group:{synthetic:true}});await done(h);
 assert.equal(h.admissions.length,0);assert.equal(h.notifications.length,0);assert.equal(h.read().last.status,'held');
 assert.equal(h.read().seen[0].status,'done');
});

test('review-off gates queued work and cancelling survives re-enable before a late result',async()=>{
 const gate=deferred(),h=harness({process:()=>gate.promise});
 h.runner.enqueue(item(1));await until(()=>h.calls.length===1);h.runner.enqueue(item(2));
 h.config({reviewEnabled:false});await h.runner.cancel();h.config({reviewEnabled:true});
 gate.resolve({status:'admitted',group:{synthetic:true}});await done(h);
 assert.equal(h.runner.status().queued,0);assert.equal(h.admissions.length,0);assert.equal(h.notifications.length,0);
 await h.runner.pump();assert.equal(h.calls.length,1,'cleared private history is not resumed after re-enable');
 h.config({reviewEnabled:false});assert.equal(h.runner.enqueue(item(3)),false);await h.runner.pump();assert.equal(h.calls.length,1);
});

test('per-call guard invalidates routing changes before another remote model call',async()=>{
 const gate=deferred();let invoked=false;
 const h=harness({process:async(_item,_c,_signal,assertAllowed)=>{
  await gate.promise;assertAllowed();invoked=true;return {status:'admitted',group:{synthetic:true}};
 }});
 h.runner.enqueue(item());await until(()=>h.calls.length===1);
 h.config({reviewBase:'https://new-review.invalid'});gate.resolve();await done(h);
 assert.equal(invoked,false);assert.equal(h.admissions.length,0);
});

test('valid gate checked inside delayed admission lock prevents post-dispose or stale-model bank write',async()=>{
 for(const invalidate of ['dispose','model']){
  const gate=deferred();let lockEntered=false;
  const h=harness({process:async()=>({status:'admitted',group:{synthetic:true}}),beforeAdmit:async()=>{lockEntered=true;await gate.promise;}});
  h.runner.enqueue(item());await until(()=>lockEntered);
  if(invalidate==='dispose')h.runner.dispose();else h.config({aModel:'new-main-model'});
  const before=h.writes.length;gate.resolve();await done(h);
  assert.equal(h.admissions.length,0);assert.equal(h.notifications.length,0);
  if(invalidate==='dispose')assert.equal(h.writes.length,before);
 }
});

test('claim awaiting state lock rechecks lifecycle before writing or calling a model',async()=>{
 const gate=deferred();let pending=false;
 const h=harness({beforeMutate:async()=>{pending=true;await gate.promise;}});
 h.runner.enqueue(item());await until(()=>pending);h.runner.dispose();gate.resolve();await done(h);
 assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);assert.equal(h.admissions.length,0);
});

test('review cancellation while claim waits cannot revive old work after re-enable',async()=>{
 const gate=deferred();let pending=false;
 const h=harness({beforeMutate:async()=>{pending=true;await gate.promise;}});
 h.runner.enqueue(item(1));await until(()=>pending);
 h.config({reviewEnabled:false});const cancelled=h.runner.cancel();h.config({reviewEnabled:true});
 assert.equal(h.runner.enqueue(item(2)),true);gate.resolve();await cancelled;await done(h);
 assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);assert.equal(h.runner.status().queued,1);
 await h.runner.pump();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0].content,item(2).content);
});

test('invalid persistent counters and hash keys are rejected before processing',()=>{
 const valid=emptyHarvest();assert.deepEqual(validateHarvestState(valid),valid);
 for(const patch of [{attempts:5},{nextRetryAt:NaN},{seen:[{key:'real source',status:'done',at:1}]},{seen:Array.from({length:201},()=>({key:'a'.repeat(64),status:'done',at:1}))}])
  assert.throws(()=>validateHarvestState({...valid,...patch}),/状态无效/);
});
