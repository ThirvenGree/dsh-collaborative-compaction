// 2026-11-14: the selection model may keep exact excerpts of a mixed segment; the program only checks them.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'partial-selection-'));process.env.PARTIAL_TEST_KEY='not-real';
const {selectConversation,partialSpans,MAX_KEEP_SPANS}=await import('../conversation-selection.js');
const {runPipeline,defaults,runs}=await import('../runtime.js');
const mixed='<system-reminder>会话信息：已读到 81。刚收到的用户正文："今天怎么样"。其余运行参数若干。</system-reminder>';

test('partial keeps only exact excerpts and marks the gaps',()=>{
 const rows=[{id:'s0',text:'青枔说周末见。'},{id:'s1',text:mixed},{id:'s2',text:'岑舒回：好。'}];
 const out=selectConversation(rows,{decisions:[{id:'s0',action:'keep',reason:'对话'},{id:'s1',action:'partial',reason:'只留新消息',keepSpans:['刚收到的用户正文："今天怎么样"']},{id:'s2',action:'keep',reason:'对话'}]});
 assert.equal(out.partial,1);assert.equal(out.kept,3);assert.equal(out.partialFallbacks,0);
 assert.ok(out.content.includes('刚收到的用户正文："今天怎么样"'));assert.ok(!out.content.includes('其余运行参数'));
 assert.equal(out.content.split('[Omitted internal context').length-1,2);
 assert.ok(out.keptChars<out.totalChars);
});
test('excerpts that are missing, repeated, overlapping or too many keep the whole segment',()=>{
 assert.equal(partialSpans(mixed,['不在原文里']),null);
 assert.equal(partialSpans('好的好的',['好的']),null);
 assert.equal(partialSpans(mixed,['会话信息：已读','已读到 81']),null);
 assert.equal(partialSpans(mixed,Array.from({length:MAX_KEEP_SPANS+1},(_,i)=>String(i))),null);
 assert.equal(partialSpans(mixed,[]),null);
 const rows=[{id:'s0',text:mixed}];
 const out=selectConversation(rows,{decisions:[{id:'s0',action:'partial',reason:'坏摘录',keepSpans:['不在原文里']}]});
 assert.equal(out.content,mixed);assert.equal(out.partialFallbacks,1);assert.equal(out.partial,0);
});
test('adjacent excerpts and whole segments stay joined without a gap marker',()=>{
 const rows=[{id:'s0',text:'甲乙'},{id:'s1',text:'丙丁戊'}];
 const out=selectConversation(rows,{decisions:[{id:'s0',action:'keep',reason:'对话'},{id:'s1',action:'partial',reason:'前半',keepSpans:['丙丁']}]});
 assert.equal(out.content,'甲乙丙丁');
});

const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'PARTIAL_TEST_KEY'};
function routed(onAudit){
 return async(_b,_p,_h,body)=>{
  const ins=body.instructions||'';let text;
  if(/Classify every supplied historical segment/.test(ins)){const input=JSON.parse(body.input.split('\n').slice(1).join('\n'));text=JSON.stringify({decisions:input.segments.map(r=>r.text.includes('刚收到的用户正文')?{id:r.id,action:'partial',reason:'只留新消息',keepSpans:['刚收到的用户正文："今天怎么样"']}:{id:r.id,action:'discard',reason:'纯注入'})});}
  else if(/audit proposed context exclusions/.test(ins)){assert.match(ins,/partial/);text=JSON.stringify(onAudit(body));}
  else if(/Audit candidates/.test(ins))text='用户问今天怎么样。';
  else text=JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'今天怎么样',sourceQuote:'今天怎么样'}]});
  return {status:'completed',output:[{content:[{type:'output_text',text}]}]};
 };
}
const content='内部通知\n'.repeat(400)+mixed;
test('partial selection reaches the summarizer and is reported in the run',async()=>{
 let seenA='';
 const out=await runPipeline({content,instructions:'',maxSummaryChars:300,selectConversation:true,validationScope:{mode:'conversation'}},async(_s,work)=>{seenA=work.content;return '用户问今天怎么样。';},{settings,transport:routed(()=>({restoreIds:[],reason:'剩余为注入'}))});
 assert.equal(out,'用户问今天怎么样。');assert.ok(seenA.includes('今天怎么样'));assert.ok(!seenA.includes('其余运行参数'));assert.ok(!seenA.includes('内部通知'));
 const sel=runs().sort((a,b)=>b.startedAt-a.startedAt)[0].stages.find(s=>s.name==='content-selection');
 assert.equal(sel.partial,1);assert.ok(sel.keptChars<sel.totalChars);
});
test('the exclusion audit can restore a partial segment in full',async()=>{
 let seenA='';
 await runPipeline({content:content+'x',instructions:'',maxSummaryChars:300,selectConversation:true,validationScope:{mode:'conversation'}},async(_s,work)=>{seenA=work.content;return '用户问今天怎么样。';},{settings,transport:routed(body=>{const input=JSON.parse(body.input.split('\n').slice(1).join('\n'));return {restoreIds:input.decisions.filter(d=>d.action==='partial').map(d=>d.id),reason:'剩余部分有已读状态'};})});
 assert.ok(seenA.includes('其余运行参数'));
});
test('a range with no actual dialogue skips A, B, review and fact check',async()=>{
 const {emptyRangeSummary}=await import('../conversation-selection.js');
 const calls=[];let aCalled=false;
 const transport=async(_b,_p,_h,body)=>{const ins=body.instructions||'';let text;
  if(/Classify every supplied historical segment/.test(ins)){calls.push('select');const input=JSON.parse(body.input.split('\n').slice(1).join('\n'));text=JSON.stringify({decisions:input.segments.map(r=>({id:r.id,action:'discard',reason:'纯注入'}))});}
  else if(/audit proposed context exclusions/.test(ins)){calls.push('audit');text=JSON.stringify({restoreIds:[],reason:'都是注入'});}
  else{calls.push('other');text='unexpected';}
  return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 const out=await runPipeline({content:'内部通知\n'.repeat(500)+'empty',instructions:'',maxSummaryChars:300,minSummaryChars:50,selectConversation:true,validationScope:{mode:'conversation'}},async()=>{aCalled=true;return 'x';},{settings,transport});
 assert.equal(out,emptyRangeSummary);assert.equal(aCalled,false);assert.deepEqual(calls,['select','audit']);
 const r=runs().sort((a,b)=>b.startedAt-a.startedAt)[0];assert.equal(r.status,'validated');assert.ok(r.stages.some(s=>s.name==='empty-range'&&s.status==='success'));
});
test('the empty-range shortcut yields to the normal pipeline when the engine needs a longer summary',async()=>{
 let aCalled=false;
 const transport=async(_b,_p,_h,body)=>{const ins=body.instructions||'';let text;
  if(/Classify every supplied historical segment/.test(ins)){const input=JSON.parse(body.input.split('\n').slice(1).join('\n'));text=JSON.stringify({decisions:input.segments.map(r=>({id:r.id,action:'discard',reason:'纯注入'}))});}
  else if(/audit proposed context exclusions/.test(ins))text=JSON.stringify({restoreIds:[],reason:'都是注入'});
  else if(/Audit candidates/.test(ins))text='本段只有内部上下文，没有可总结的实际对话。'+'补充说明'.repeat(60);
  else text=JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[]});
  return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 await runPipeline({content:'内部通知\n'.repeat(500)+'long',instructions:'',maxSummaryChars:400,minSummaryChars:200,selectConversation:true,validationScope:{mode:'conversation'}},async()=>{aCalled=true;return '本段只有内部上下文，没有可总结的实际对话。'+'补充说明'.repeat(60);},{settings,transport});
 assert.equal(aCalled,true);
});
