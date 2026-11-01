import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'collab-test-'));
process.env.COLLAB_FAKE_KEY='fake-not-real';
const {runPipeline,defaults,validateSummary,config,runs}=await import('../runtime.js');
const c={...defaults,enabled:true,claudeKeyEnv:'COLLAB_FAKE_KEY',reviewKeyEnv:'COLLAB_FAKE_KEY'};
const work={content:'交付从3日改为5日，预算1200元，不能发布',instructions:'保留更正',maxSummaryChars:200};
const result='5日交付，预算1200元，未经确认不能发布。';
function transport(calls,fail){return async(base,route,headers,body)=>{calls.push({route,body});if(fail===route)throw Error('Provider HTTP 401');return route==='/messages'?{stop_reason:'compaction',content:[{type:'compaction',content:result}],usage:{iterations:[{input_tokens:100,output_tokens:30}]}}:{status:'completed',output:[{content:[{type:'output_text',text:result}]}],usage:{input_tokens:120,output_tokens:30}};};}
test('same source reaches native Claude and Terra; API shape and telemetry',async()=>{const calls=[];assert.equal(await runPipeline(work,async()=>result,{settings:c,transport:transport(calls)}),result);assert.equal(calls[0].body.compaction.type,'summarize');assert.equal(JSON.parse(calls[0].body.messages[0].content).history,work.content);const audit=JSON.parse(calls[1].body.input);assert.equal(audit.original,work.content);assert.equal(audit.summaryA,result);assert.equal(audit.summaryB,result);assert.equal(calls[1].body.store,false);assert.ok(runs()[0].stages[1].usage);assert.ok(!JSON.stringify(runs()).includes('fake-not-real'));});
test('all toggle combinations and disabled path',async()=>{for(const b of [false,true])for(const review of [false,true]){const calls=[];await runPipeline(work,async()=>result,{settings:{...c,claudeEnabled:b,reviewEnabled:review},transport:transport(calls)});assert.equal(calls.length,Number(b)+Number(review));}const calls=[];assert.equal(await runPipeline(work,async()=>result,{settings:{...c,enabled:false},transport:transport(calls)}),result);assert.equal(calls.length,0);});
test('B or review fails: no silent fallback',async()=>{for(const endpoint of ['/messages','/responses'])await assert.rejects(runPipeline(work,async()=>result,{settings:c,transport:transport([],endpoint)}),/401/);});
test('A failure also fails whole batch',async()=>{await assert.rejects(runPipeline(work,async()=>{throw Error('A failed');},{settings:c,transport:transport([])}),/A failed/);});
test('truncated Claude and Terra rejected even with text',async()=>{for(const endpoint of ['/messages','/responses'])await assert.rejects(runPipeline(work,async()=>result,{settings:c,transport:async(...args)=>{const r=await transport([])(...args);if(args[1]===endpoint){if(endpoint==='/messages')r.stop_reason='max_tokens';else r.status='incomplete';}return r;}}),/complete|incomplete/);});
test('empty, oversized, cancelled and context overflow rejected',async()=>{assert.throws(()=>validateSummary('',work,c));assert.throws(()=>validateSummary('x'.repeat(201),work,c));const abort=new AbortController();abort.abort();await assert.rejects(runPipeline(work,async()=>result,{settings:c,signal:abort.signal,transport:transport([])}));await assert.rejects(runPipeline({...work,content:'x'.repeat(5000)},async()=>result,{settings:{...c,claudeContextTokens:4096},transport:transport([])}),/context budget/);});
