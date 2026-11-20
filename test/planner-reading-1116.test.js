// 2026-11-16: planners get no messages up front; they choose how many to read, read more if needed, then decide.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'planner-reading-'));process.env.PR_KEY='x';
const {pagedDecision,planCompression,defaults,readProtocolRule}=await import('../runtime.js');
const msgs=Array.from({length:50},(_,i)=>({ref:'m'+i,role:i%2?'assistant':'user',text:'t'+i}));
test('the model first reads what it chooses, then more, then decides; nothing is handed over up front',async()=>{
 const views=[];const answers=[{read:{count:5}},{read:{offset:5,count:10}},{decision:'wait',reason:'ok',ranges:[]}];
 const r=await pagedDecision({messages:msgs,candidates:[]},async v=>{views.push(v);return {value:answers[views.length-1]};},{deadlineAt:Date.now()+60000});
 assert.equal(views[0].messages,undefined);assert.equal(views[0].messageTotal,50);assert.equal(views[0].readMessages.length,0);
 assert.deepEqual(views[1].readMessages.map(m=>m.ref),['m45','m46','m47','m48','m49']);
 assert.deepEqual(views[2].readMessages.map(m=>m.ref),msgs.slice(35).map(m=>m.ref));
 assert.equal(r.value.decision,'wait');assert.equal(r.readCount,15);
});
test('after the deadline reading is closed and the model must decide; a repeated read closes it too',async()=>{
 await assert.rejects(pagedDecision({messages:msgs},async()=>({value:{read:{count:3}}}),{deadlineAt:0}),/kept reading/);
 const views=[];await pagedDecision({messages:msgs},async v=>{views.push(v);return {value:views.length<3?{read:{count:3}}:{decision:'wait',reason:'',ranges:[]}};},{deadlineAt:Date.now()+60000});
 assert.equal(views[2].readingClosed,true,'repeating the same read closes reading');
});
test('the compaction planner prompt carries the read protocol and the planner reads before deciding',async()=>{
 const seen=[];const transport=async(_b,_r,_h,body)=>{seen.push(body);const v=seen.length===1?{read:{count:4}}:{decision:'wait',reason:'还在聊',ranges:[]};return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]};};
 const out=await planCompression({messages:msgs,candidates:[]},{settings:{...defaults,enabled:true,plannerEnabled:true,reviewKeyEnv:'PR_KEY'},transport});
 assert.equal(out.decision,'wait');assert.ok(seen[0].instructions.startsWith(readProtocolRule));
 assert.equal(JSON.parse(seen[1].input.replace(/^[^{]*/,'')).readMessages.length,4);
});
