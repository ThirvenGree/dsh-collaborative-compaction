// 2026-11-18: rolling summaries get their own length cap and Gemini decides the length within it (one retry when the
// reply hits the token limit); the agency display session is written to the engine config as stateless.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'endless-1118-'));
process.env.DSH_COLLAB_TEST_HOME=path.join(home,'collab');process.env.DSH_HOME=path.join(home,'dsh');process.env.ROLLING_TEST_KEY='not-real';
const keyFile=path.join(home,'client-key');fs.writeFileSync(keyFile,'fixture-proxy-key\n');process.env.CENSHU_CLIPROXY_KEY_FILE=keyFile;
const {runPipeline,defaults,validateConfig,summaryCap,rollingLengthRule}=await import('../runtime.js');
const SUMMARY='青枔和岑舒约好周六一起去看海；岑舒今天在家煮了热汤面，外头风大没出门。';
const settings={...defaults,enabled:true,rollingEnabled:true,claudeEnabled:true,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'ROLLING_TEST_KEY',claudeKeyEnv:'ROLLING_TEST_KEY'};
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const gemini=(text,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}});
const work=(tag,max=60000)=>({content:'[summarized b1: 约定]\n青枔和岑舒约好周六一起去看海。\n\n[user]\n[m00012] 今天怎么样\n\n[assistant]\n[m00013] 在家煮了热汤面，外头风大没出门。'+tag,instructions:'',maxSummaryChars:max,minSummaryChars:20,trigger:'rolling'});

test('rolling has its own, larger length cap; every other fold keeps the normal cap; defaults are raised',()=>{
 const c=validateConfig(settings);
 assert.equal(c.rollingOutputTokens,65536);assert.equal(c.rollingMaxSummaryChars,60000);
 assert.equal(summaryCap({trigger:'rolling',maxSummaryChars:60000},c),60000);
 assert.equal(summaryCap({trigger:'rolling',maxSummaryChars:999999},c),60000,'never above the rolling cap');
 assert.equal(summaryCap({trigger:'auto',maxSummaryChars:60000},c),c.maxSummaryChars,'a normal fold keeps the normal cap');
 assert.equal(summaryCap({trigger:'rolling',maxSummaryChars:60000},{...c,rollingEnabled:false}),c.maxSummaryChars,'rolling switched off');
 assert.throws(()=>validateConfig({...settings,rollingMaxSummaryChars:100}),/Invalid|rollingMaxSummaryChars/);
});

test('Gemini decides the length; a reply that hits the token limit gets one retry asked to condense older parts',async()=>{
 const seen=[];let n=0;
 const transport=async(base,route,headers,body)=>{seen.push({route,body});if(route.includes(':generateContent'))return ++n===1?gemini(SUMMARY.repeat(3),'MAX_TOKENS'):gemini(SUMMARY);return reply(JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'看海',sourceQuote:'看海'}]}));};
 const out=await runPipeline(work('a'),async()=>SUMMARY,{settings,transport});
 assert.equal(out,SUMMARY);
 const calls=seen.filter(x=>x.route.includes(':generateContent'));assert.equal(calls.length,2);
 assert.ok(calls[0].body.systemInstruction.parts[0].text.includes(rollingLengthRule),'the length is the model\'s call');
 assert.match(calls[1].body.systemInstruction.parts[0].text,/ran past the output limit.*within about 36000 characters/s);
 assert.equal(calls[0].body.generationConfig.maxOutputTokens,65536);
});

test('the engine config carries the rolling cap, a large enough byte budget and the stateless display session',async()=>{
 const disp=path.join(process.env.DSH_HOME,'censhu-inner-life','display-session.json');fs.mkdirSync(path.dirname(disp),{recursive:true});
 fs.writeFileSync(disp,JSON.stringify({sessionId:'session-00000000-0000-4000-8000-000000000001',previousSessionId:'session-00000000-0000-4000-8000-000000000002',readOnly:true}));
 const {syncEngine}=await import('../host.js');
 const file=path.join(home,'engine.json');process.env.BILI_CONFIG_FILE=file;fs.writeFileSync(file,JSON.stringify({compress:{},providers:{}}));
 const base={enabled:true,timeoutMs:540000,maxSummaryChars:16000,outputTokens:16384,preserveRecentTokens:16000,plannerEnabled:true,autoFoldTargetTokens:80000,rollingTriggerTokens:200000,rollingMaxSummaryChars:60000};
 await syncEngine({...base,rollingEnabled:true},7,'fake',engine=>assert.ok(engine.compress.externalSummary.enabled));
 const es=JSON.parse(fs.readFileSync(file)).compress.externalSummary;
 assert.deepEqual(es.rolling,{enabled:true,triggerTokens:200000,maxSummaryChars:60000});
 assert.equal(es.budget.maxSummaryBytes,60000*4+4096);
 assert.deepEqual(es.statelessSessions,['session-00000000-0000-4000-8000-000000000001','session-00000000-0000-4000-8000-000000000002']);
 const host=fs.readFileSync(new URL('../host.js',import.meta.url),'utf8');assert.match(host,/const capChars=requestedTrigger==='rolling'&&c\.rollingEnabled\?c\.rollingMaxSummaryChars:c\.maxSummaryChars;/);
});
