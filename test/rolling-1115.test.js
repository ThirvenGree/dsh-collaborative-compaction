// 2026-11-15: rolling whole-history summary written by Gemini through the Antigravity route.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'rolling-1115-'));
process.env.DSH_COLLAB_TEST_HOME=path.join(home,'collab');process.env.DSH_HOME=path.join(home,'dsh');process.env.ROLLING_TEST_KEY='not-real';
const keyFile=path.join(home,'client-key');fs.writeFileSync(keyFile,'fixture-proxy-key\n');
process.env.CENSHU_CLIPROXY_KEY_FILE=keyFile;
const {runPipeline,defaults,validateConfig,runs,rollingRule}=await import('../runtime.js');
const {keepSummarySegments,summarySpans}=await import('../conversation-selection.js');
const latest=()=>runs().sort((a,b)=>b.startedAt-a.startedAt)[0];
const SUMMARY='青枔和岑舒约好周六一起去看海；岑舒今天在家煮了热汤面，外头风大没出门。';
const settings={...defaults,enabled:true,rollingEnabled:true,claudeEnabled:true,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'ROLLING_TEST_KEY',claudeKeyEnv:'ROLLING_TEST_KEY'};
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const gemini=text=>({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'thinking'},{text}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:5}});
function transport(seen,{geminiReply=gemini(SUMMARY)}={}){
 return async(base,route,headers,body)=>{
  seen.push({base,route,headers,body});
  if(route.includes(':generateContent'))return geminiReply;
  if(route==='/messages')throw Error('Claude must not run for a rolling summary');
  if(/Audit candidates/.test(body.instructions||''))throw Error('Cross review must not run for a rolling summary');
  return reply(JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'看海',sourceQuote:'看海'}]}));
 };
}
const work=tag=>({content:'[summarized b1: 约定]\n青枔和岑舒约好周六一起去看海。\n\n[user]\n[m00012] 今天怎么样\n\n[assistant]\n[m00013] 在家煮了热汤面，外头风大没出门。'+tag,instructions:'',maxSummaryChars:400,minSummaryChars:20,trigger:'rolling'});

test('rolling settings default off, and only a loopback HTTP or HTTPS endpoint is accepted',()=>{
 assert.equal(defaults.rollingEnabled,false);assert.equal(defaults.rollingModel,'gemini-4-hydrogen-high');assert.equal(defaults.rollingBase,'http://127.0.0.1:8317');
 assert.doesNotThrow(()=>validateConfig({...defaults,rollingBase:'http://localhost:8317'}));
 assert.doesNotThrow(()=>validateConfig({...defaults,rollingBase:'https://proxy.example.com'}));
 assert.throws(()=>validateConfig({...defaults,rollingBase:'http://192.168.1.2:8317'}),/loopback/);
 assert.throws(()=>validateConfig({...defaults,rollingTriggerTokens:100}),/rollingTriggerTokens/);
 assert.throws(()=>validateConfig({...defaults,rollingEnabled:'yes'}),/rollingEnabled/);
});

test('a rolling run calls Gemini through Antigravity instead of A, B and the cross review; the fact check still runs',async()=>{
 const seen=[];let aCalls=0;
 const out=await runPipeline(work('a'),async()=>{aCalls++;return SUMMARY;},{settings,transport:transport(seen)});
 assert.equal(out,SUMMARY);assert.equal(aCalls,0);
 const call=seen.find(x=>x.route.includes(':generateContent'));
 assert.equal(call.base,'http://127.0.0.1:8317');assert.equal(call.route,'/v1beta/models/gemini-4-hydrogen-high:generateContent');
 assert.equal(call.headers.authorization,'Bearer fixture-proxy-key');
 assert.ok(call.body.systemInstruction.parts[0].text.includes(rollingRule));
 assert.match(JSON.parse(call.body.contents[0].parts[0].text).history,/\[summarized b1/);
 const r=latest();assert.equal(r.status,'validated');assert.equal(r.trigger,'rolling');assert.equal(r.mode.rolling,true);
 assert.deepEqual(r.stages.map(s=>s.name),['rolling','fact-check']);
 assert.equal(r.stages[0].usage.output_tokens,25);
});

test('a rolling trigger with rolling switched off uses the normal pipeline',async()=>{
 const seen=[];let aCalls=0;const off={...settings,rollingEnabled:false,claudeEnabled:false,reviewEnabled:false};
 await runPipeline(work('b'),async()=>{aCalls++;return SUMMARY;},{settings:off,transport:transport(seen)});
 assert.equal(aCalls,1);assert.ok(!seen.some(x=>x.route.includes(':generateContent')));
});

test('an incomplete Gemini answer fails the range, and a shared Antigravity pause stops the call',async()=>{
 await assert.rejects(runPipeline(work('c'),async()=>SUMMARY,{settings,transport:transport([],{geminiReply:{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:SUMMARY}]}}]}})}),/incomplete/);
 const pause=path.join(process.env.DSH_HOME,'cen-shu-life','antigravity-pause.json');
 fs.mkdirSync(path.dirname(pause),{recursive:true});fs.writeFileSync(pause,JSON.stringify({manual:true}));
 const seen=[];
 try{await assert.rejects(runPipeline(work('d'),async()=>SUMMARY,{settings,transport:transport(seen)}),/Antigravity paused/);}
 finally{fs.rmSync(pause);}
 assert.ok(!seen.some(x=>x.route.includes(':generateContent')));
});

test('content selection never drops a segment holding an earlier summary',()=>{
 const text='[summarized b1: 约定]\n约好周六去看海。\n\n[user]\n系统注入的说明\n\n[assistant]\n好的';
 assert.deepEqual(summarySpans(text),[[0,text.indexOf('\n\n[user]')]]);
 const rows=[{id:'s0',text:text.slice(0,20)},{id:'s1',text:text.slice(20)}];
 const decisions=[{id:'s0',action:'discard',reason:'x'},{id:'s1',action:'discard',reason:'y'}];
 const kept=keepSummarySegments(rows,decisions);
 assert.equal(kept[0].action,'keep');assert.equal(kept[0].keptAsSummary,true);
 assert.equal(kept[1].action,'keep','s1 still overlaps the summary text');
 const later=[{id:'s0',text:text.slice(0,text.indexOf('\n\n[user]'))},{id:'s1',text:text.slice(text.indexOf('\n\n[user]'))}];
 assert.equal(keepSummarySegments(later,decisions)[1].action,'discard','a segment after the summary is the model\'s call');
});

test('the engine config carries rolling only while it is switched on',async()=>{
 const {syncEngine}=await import('../host.js');
 const file=path.join(home,'engine.json');process.env.BILI_CONFIG_FILE=file;fs.writeFileSync(file,JSON.stringify({compress:{},providers:{}}));
 const schema=engine=>assert.ok(engine.compress.externalSummary.enabled);
 const base={enabled:true,timeoutMs:540000,maxSummaryChars:12000,outputTokens:16384,preserveRecentTokens:16000,plannerEnabled:true,autoFoldTargetTokens:80000,rollingTriggerTokens:300000};
 await syncEngine({...base,rollingEnabled:false},7,'fake',schema);
 assert.equal(JSON.parse(fs.readFileSync(file)).compress.externalSummary.rolling,undefined);
 await syncEngine({...base,rollingEnabled:true},7,'fake',schema);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).compress.externalSummary.rolling,{enabled:true,triggerTokens:300000,maxSummaryChars:60000});
});

test('the rolling planner asks Gemini when and where to cut, and only accepts an offered cut point',async()=>{
 const {planRolling,rollingPlanRule}=await import('../runtime.js');
 const input={rolling:true,startId:'m00001',cutPoints:[{endId:'m00010',keptTokens:9000},{endId:'m00020',keptTokens:3000}],estimatedContextTokens:320000,triggerTokens:300000,messages:[]};
 const answer=v=>async(_b,route,_h,body)=>{assert.ok(route.includes(':generateContent'));assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.systemInstruction.parts[0].text.startsWith(rollingPlanRule));assert.equal(JSON.parse(body.contents[0].parts[0].text).cutPoints.length,2);return gemini(JSON.stringify(v));};
 assert.deepEqual(await planRolling(input,{settings,transport:answer({decision:'now',endId:'m00010',reason:'话题在这里结束'})}),{decision:'now',endId:'m00010',reason:'话题在这里结束'});
 const r=runs().filter(x=>x.kind==='planning'&&x.rolling).sort((a,b)=>b.startedAt-a.startedAt)[0];
 assert.equal(r.status,'decided');assert.deepEqual(r.ranges,[{startId:'m00001',endId:'m00010'}]);
 assert.deepEqual(await planRolling(input,{settings,transport:answer({decision:'wait',recheckAfterTokens:20000,reason:'还在聊'})}),{decision:'wait',recheckAfterTokens:20000,reason:'还在聊'});
 await assert.rejects(planRolling(input,{settings,transport:answer({decision:'now',endId:'m99999',reason:'x'})}),/Invalid rolling plan/);
 await assert.rejects(planRolling(input,{settings,transport:answer({decision:'wait',recheckAfterTokens:10,reason:'x'})}),/Invalid rolling plan/);
 assert.equal((await planRolling(input,{settings:{...settings,rollingEnabled:false}})).decision,'legacy');
 assert.equal((await planRolling(input,{settings:{...settings,plannerEnabled:false}})).decision,'legacy');
});
