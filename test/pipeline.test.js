import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'collab-test-'));
process.env.COLLAB_FAKE_KEY='fake-not-real';
const {runPipeline,defaults,validateSummary,config,runs}=await import('../runtime.js');
const c={...defaults,verificationProvider:'openai',enabled:true,factCheckEnabled:false,claudeKeyEnv:'COLLAB_FAKE_KEY',reviewKeyEnv:'COLLAB_FAKE_KEY'};
const work={content:'交付从3日改为5日，预算1200元，不能发布',instructions:'保留更正',maxSummaryChars:200};
const result='5日交付，预算1200元，未经确认不能发布。';
function transport(calls,fail){return async(base,route,headers,body)=>{calls.push({route,body});if(fail===route)throw Error('Provider HTTP 401');return route==='/messages'?{stop_reason:'compaction',content:[{type:'compaction',content:result}],usage:{iterations:[{input_tokens:100,output_tokens:30}]}}:{status:'completed',output:[{content:[{type:'output_text',text:result}]}],usage:{input_tokens:120,output_tokens:30}};};}
test('same source reaches native Claude and Terra; API shape and telemetry',async()=>{const calls=[];assert.equal(await runPipeline(work,async()=>result,{settings:c,transport:transport(calls)}),result);assert.equal(calls[0].body.compaction.type,'summarize');assert.equal(JSON.parse(calls[0].body.messages[0].content).history,work.content);const audit=JSON.parse(calls[1].body.input);assert.equal(audit.original,work.content);assert.equal(audit.summaryA,result);assert.equal(audit.summaryB,result);assert.equal(calls[1].body.store,false);assert.ok(runs()[0].stages[1].usage);assert.ok(!JSON.stringify(runs()).includes('fake-not-real'));});
test('all toggle combinations and disabled path',async()=>{for(const b of [false,true])for(const review of [false,true]){const calls=[];await runPipeline(work,async()=>result,{settings:{...c,claudeEnabled:b,reviewEnabled:review},transport:transport(calls)});assert.equal(calls.length,Number(b)+Number(review));}const calls=[];assert.equal(await runPipeline(work,async()=>result,{settings:{...c,enabled:false},transport:transport(calls)}),result);assert.equal(calls.length,0);});
test('B or review fails: no silent fallback',async()=>{for(const endpoint of ['/messages','/responses'])await assert.rejects(runPipeline(work,async()=>result,{settings:c,transport:transport([],endpoint)}),/401/);});
test('A failure also fails whole batch',async()=>{await assert.rejects(runPipeline(work,async()=>{throw Error('A failed');},{settings:c,transport:transport([])}),/A failed/);});
test('truncated Claude and Terra rejected even with text',async()=>{for(const endpoint of ['/messages','/responses'])await assert.rejects(runPipeline(work,async()=>result,{settings:c,transport:async(...args)=>{const r=await transport([])(...args);if(args[1]===endpoint){if(endpoint==='/messages')r.stop_reason='max_tokens';else r.status='incomplete';}return r;}}),/complete|incomplete/);});
test('empty, oversized, cancelled and context overflow rejected',async()=>{assert.throws(()=>validateSummary('',work,c));assert.throws(()=>validateSummary('x'.repeat(201),work,c));const abort=new AbortController();abort.abort();await assert.rejects(runPipeline(work,async()=>result,{settings:c,signal:abort.signal,transport:transport([])}));await assert.rejects(runPipeline({...work,content:'x'.repeat(5000)},async()=>result,{settings:{...c,claudeContextTokens:4096},transport:transport([])}),/context budget/);});
const {planCompression}=await import('../runtime.js');
const structured=value=>async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:12,output_tokens:5}});
test('planner accepts wait and uncertain without ranges; rejects malformed now',async()=>{
 for(const decision of ['wait','uncertain'])assert.equal((await planCompression({candidates:[]},{settings:c,transport:structured({decision,reason:'not yet',ranges:[]})})).decision,decision);
 await assert.rejects(planCompression({}, {settings:c,transport:structured({decision:'now',reason:'bad',ranges:[]})}),/Invalid/);
});
test('disabled cross review does not call unused summary A',async()=>{
 let a=0;await runPipeline(work,async()=>{a++;return result;},{settings:{...c,reviewEnabled:false},transport:transport([])});assert.equal(a,0);
});
test('rejected summary stage never appears successful',async()=>{
 const original='oversized-stage-unique';await assert.rejects(runPipeline({...work,content:original},async()=> 'x'.repeat(201),{settings:{...c,claudeEnabled:false,reviewEnabled:false},transport:transport([])}));
 const log=runs().find(r=>r.sourceChars===original.length);assert.equal(log.stages[0].status,'failed');
});
test('independent fact verification rejects fabricated evidence',async()=>{
 const source='Budget is 1200 CNY.';
 const settings={...c,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:true};
 const check={approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'1200',sourceQuote:'1200'}]};
 assert.equal(await runPipeline({content:source,maxSummaryChars:100,instructions:''},async()=>source,{settings,transport:structured(check)}),source);
 check.facts[0].sourceQuote='9000';await assert.rejects(runPipeline({content:source,maxSummaryChars:100,instructions:''},async()=>source,{settings,transport:structured(check)}),/verification failed/);
});

test('literal guard rejects invented dates paths identifiers while allowing paraphrase',async()=>{
 const {validateLiterals}=await import('../runtime.js');
 const source='预算1200，日期2026-11-05，路径 C:\\work\\file.json，使用 model_name 与 USD。';
 assert.doesNotThrow(()=>validateLiterals('使用 model_name；预算1200 USD。',source));
 for(const summary of ['预算1300','日期2026-05-11','日期2026-11-06','路径 C:\\other\\file.json','使用 other_name'])assert.throws(()=>validateLiterals(summary,source),/Unanchored/);
});
test('Chinese token estimate is not UTF8 byte count and stage caps are independent',async()=>{
 const {estimatedTokens}=await import('../runtime.js');const chinese='今天下雨，我在整理旧书。'.repeat(5000);
 assert.ok(estimatedTokens(chinese)<Buffer.byteLength(chinese)*0.7);
 const calls=[];await runPipeline(work,async()=>result,{settings:c,transport:transport(calls)});
 assert.equal(calls[0].body.max_tokens,c.claudeOutputTokens);assert.equal(calls[1].body.max_output_tokens,c.reviewOutputTokens);
});
test('Claude independently verifies bounded facts',async()=>{
 const text='预算1200元。';let request;
 const value=await runPipeline({content:text,instructions:'',maxSummaryChars:100},async()=>text,{settings:{...c,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:true,verificationProvider:'claude'},transport:async(_base,_route,_headers,body)=>{request=body;return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'1200',sourceQuote:'1200'}]})}]};}});
 assert.equal(value,text);assert.equal(request.max_tokens,c.verificationOutputTokens);assert.ok(request.system.includes('at most 24'));
});
test('network retry delay is abortable',async()=>{const {retryDelay}=await import('../runtime.js');const c=new AbortController();const p=retryDelay(0,c.signal);c.abort();await assert.rejects(p,/cancelled/);});

test('long Chinese summary retains full text and verifier output stays bounded',async()=>{
 const text='今天整理旧书时找到一张旧票根，想先把它收好，之后再决定是否分享。'.repeat(400).slice(0,12000);
 const settings={...c,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:true};let prompt;
 const answer=await runPipeline({content:text,instructions:'',maxSummaryChars:12000},async()=>text,{settings,transport:async(...args)=>{prompt=args[3];return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:text.slice(0,30),sourceQuote:text.slice(0,30)}]})}]}]};}});
 assert.equal(answer,text);assert.equal(prompt.max_output_tokens,c.verificationOutputTokens);assert.ok(prompt.instructions.includes('at most 24'));
});
test('run retention prunes old files and reads only latest hundred',async()=>{
 const dir=path.join(process.env.DSH_COLLAB_TEST_HOME,'runs');fs.mkdirSync(dir,{recursive:true});
 for(let i=0;i<530;i++){const f=path.join(dir,`old-${i}.json`);fs.writeFileSync(f,JSON.stringify({id:`old-${i}`,status:'validated',startedAt:i}));fs.utimesSync(f,1,1);}
 await planCompression({}, {settings:c,transport:structured({decision:'wait',reason:'retention',ranges:[]})});
 assert.ok(fs.readdirSync(dir).length<=500);assert.equal(runs().length,100);
});

test('legacy saved verifier model retains its OpenAI provider on upgrade',()=>{
 const file=path.join(process.env.DSH_COLLAB_TEST_HOME,'config.json');fs.writeFileSync(file,JSON.stringify({verificationModel:'gpt-6.1-terra'}));
 try{assert.equal(config().verificationProvider,'openai');}finally{fs.unlinkSync(file);}
});
