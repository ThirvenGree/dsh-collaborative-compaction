// 2026-11-16: how much recent conversation stays verbatim is the planner's call (keepRecentTokens).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'recent-zone-'));process.env.DSH_COLLAB_TEST_HOME=path.join(home,'c');process.env.DSH_HOME=path.join(home,'d');process.env.ZONE_KEY='x';
const keyFile=path.join(home,'k');fs.writeFileSync(keyFile,'k');process.env.CENSHU_CLIPROXY_KEY_FILE=keyFile;
const {planCompression,planRolling,defaults}=await import('../runtime.js');
const settings={...defaults,enabled:true,plannerEnabled:true,rollingEnabled:true,reviewKeyEnv:'ZONE_KEY'};
const openai=v=>async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]});
const gemini=v=>async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(v)}]}}]});
test('the compaction planner may set keepRecentTokens; invalid values are dropped',async()=>{
 const ok=await planCompression({candidates:[]},{settings,transport:openai({decision:'wait',reason:'还在聊',ranges:[],keepRecentTokens:30000})});
 assert.equal(ok.keepRecentTokens,30000);
 const bad=await planCompression({candidates:[]},{settings,transport:openai({decision:'wait',reason:'x',ranges:[],keepRecentTokens:-1})});
 assert.equal(bad.keepRecentTokens,undefined);
});
test('the rolling planner may set keepRecentTokens too',async()=>{
 const r=await planRolling({rolling:true,startId:'m1',cutPoints:[{endId:'m9',keptTokens:100}]},{settings,transport:gemini({decision:'now',endId:'m9',reason:'话题结束',keepRecentTokens:8000})});
 assert.equal(r.keepRecentTokens,8000);
});
