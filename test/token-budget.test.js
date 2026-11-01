import test from 'node:test';import assert from 'node:assert/strict';
import {estimatedTokens,createTokenBudget} from '../token-budget.js';
test('obvious byte-bound fit performs no encoding',async()=>{const b=createTokenBudget();await b.check(['天气很好'],100000,1000);assert.deepEqual(b.stats(),{encoded:0,fastPaths:1});});
test('large Chinese tokenization does not block heartbeat and reused source is encoded once',async()=>{
 const source='今天整理旧书时想起了那张票根。'.repeat(60000).slice(0,880000);
 let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},20);
 try{
  const b=createTokenBudget();await b.check([source],1800000,1000);assert.equal(b.stats().encoded,1);
  await b.check([source],1800000,2000);assert.equal(b.stats().encoded,1);
  assert.ok(ticks>=5,`ticks=${ticks}`);assert.ok(maxGap<1500,`heartbeat stalled ${maxGap}ms`);
  console.log(JSON.stringify({chars:source.length,heartbeatTicks:ticks,maxGapMs:Math.round(maxGap),encoded:b.stats().encoded}));
 }finally{clearInterval(timer);}
});
test('token worker rejects aborted work',async()=>{const c=new AbortController();c.abort();await assert.rejects(estimatedTokens('测试',c.signal),/cancelled/);});
