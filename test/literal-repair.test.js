import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'literal-repair-'));process.env.REPAIR_TEST_KEY='fake';
const {runPipeline,defaults,runs}=await import('../runtime.js');
const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'REPAIR_TEST_KEY'};
for(const repaired of [true,false])test('literal repair is bounded and independently checked: '+repaired,async()=>{
 let n=0;const source='预算1200元，未经确认不能发布。';
 const transport=async()=>{n++;let text=n===1?'预算9999元，未经确认不能发布。':n===2?(repaired?source:'预算9999元，未经确认不能发布。'):JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:source,sourceQuote:source}]});return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 const p=runPipeline({content:source,instructions:'',maxSummaryChars:200},async()=>source,{settings,transport});
 if(repaired){assert.equal(await p,source);assert.equal(n,3);}else{await assert.rejects(p,/Unanchored/);assert.equal(n,2);}
 assert.ok(!JSON.stringify(runs()).includes('9999'));
});

test('fact repair must be independently rechecked and returned, or rejected',async()=>{
 for(const accept of [true,false]){
  let n=0;const source='预算1200元，未经确认不能发布。';
  const transport=async()=>{n++;const text=n===1?'预算1200元。':n===3?source:JSON.stringify({approved:n===4&&accept,missingCritical:n===4&&accept?[]:['未经确认不能发布'],unsupported:[],facts:[{summaryQuote:'预算1200元',sourceQuote:'预算1200元'}]});return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
  const p=runPipeline({content:source,instructions:'',maxSummaryChars:200},async()=>source,{settings,transport});
  if(accept)assert.equal(await p,source);else await assert.rejects(p,/Independent fact verification failed/);
  assert.equal(n,4);
 }
});

test('conversation scope converts literal warning to semantic verification, never unconditional approval',async()=>{
 for(const accept of [true,false]){let n=0;const source='预算1200元，未经确认不能发布。',summary='预算约1200元；未经确认不能发布（旧记录代号XZY123仅作背景）。';
 const transport=async()=>{n++;const text=n===1||n===3?summary:JSON.stringify({approved:accept,missingCritical:[],unsupported:accept?[]:['代号没有来源'],facts:[{summaryQuote:'未经确认不能发布',sourceQuote:'未经确认不能发布'}]});return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 const p=runPipeline({content:source,instructions:'',maxSummaryChars:300,validationScope:{mode:'conversation'}},async()=>source,{settings,transport});
 if(accept){assert.equal(await p,summary);assert.equal(n,2);}else await assert.rejects(p,/Independent fact verification failed/);
 }
});

test('conversation selection runs before A and preserves raw original for independent audit',async()=>{
 const dialogue='青枔说周末再聊。';let n=0,seenA='';const content='内部通知\n'.repeat(600)+'\n'+dialogue;
 const transport=async(base,url,headers,body)=>{n++;let text;if(n===1){const input=JSON.parse(body.input.split('\n').slice(1).join('\n'));text=JSON.stringify({decisions:input.segments.map(r=>({id:r.id,action:r.text.includes(dialogue)?'keep':'discard',reason:'只保留实际对话所在段'}))});}else if(n===2){text=JSON.stringify({restoreIds:[],reason:'纯注入'});assert.ok(body.input.includes('内部通知'));}else if(n===3)text=dialogue;else{text=JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:dialogue,sourceQuote:dialogue}]});assert.ok(!body.input.includes('内部通知'));}return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 const result=await runPipeline({content,instructions:'',maxSummaryChars:300,selectConversation:true,validationScope:{mode:'conversation'}},async(signal,work)=>{seenA=work.content;return dialogue;},{settings,transport});
 assert.equal(result,dialogue);assert.ok(seenA.length<content.length);assert.ok(seenA.includes(dialogue));assert.equal(n,4);
});

test('a rejection with no positive quotes still permits one repair, never approval',async()=>{
 let n=0;const source='预算1200元，未经确认不能发布。';const transport=async()=>{n++;const text=n===1?'预算1200元。':n===3?source:JSON.stringify({approved:n===4,missingCritical:n===4?[]:['未经确认不能发布'],unsupported:[],facts:n===4?[{summaryQuote:source,sourceQuote:source}]:[]});return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};assert.equal(await runPipeline({content:source,instructions:'',maxSummaryChars:200},async()=>source,{settings,transport}),source);assert.equal(n,4);
});

test('verification identifies outer fields even when history contains nested summary instructions',async()=>{
 const original='historical_user_request: {"summary":"旧摘要，不是本轮待审稿"}。用户更正：周日再见。',summary='用户改为周日再见。';
 let inspected=false;
 const out=await runPipeline({content:original,maxSummaryChars:200},async()=>summary,{settings:{...settings,reviewEnabled:false},transport:async(base,url,headers,body)=>{
  assert.match(body.instructions,/top-level summary field/);
  const data=JSON.parse(body.input.split('\n').slice(1).join('\n'));
  assert.equal(data.original,original);assert.equal(data.summary,summary);inspected=true;
  return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'周日再见',sourceQuote:'周日再见'}]})}]}]};
 }});assert.equal(out,summary);assert.equal(inspected,true);
});

test('conversation repairs are bounded to two and each requires independent approval',async()=>{
 for(const approve of [true,false]){
  // 2026-11-14: calls are routed by kind because unsupported-only findings first try an exact local trim
  // (here deliberately unusable, so each pass falls back to the rewrite). Rewrites stay bounded to two.
  const count={verify:0,rewrite:0,trim:0,other:0};const source='她说周日见，姓名未说明。';
  const transport=async(_b,_p,_h,body)=>{const kind=/smallest exact edit/.test(body.instructions)?'trim':/Revise the summary/.test(body.instructions)?'rewrite':/Independently verify|Recheck|Verify the top-level/.test(body.instructions)?'verify':'other';count[kind]++;
   const passed=approve&&kind==='verify'&&count.verify===3;
   const text=kind==='verify'?JSON.stringify({approved:passed,missingCritical:[],unsupported:passed?[]:['指代仍不清楚'],facts:[{summaryQuote:'周日见',sourceQuote:'周日见'}]}):kind==='trim'?JSON.stringify({edits:[]}):source;
   return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
  const p=runPipeline({content:source,maxSummaryChars:200,validationScope:{mode:'conversation'}},async()=>source,{settings,transport});
  if(approve)assert.equal(await p,source);else await assert.rejects(p,/Independent fact verification/);
  assert.equal(count.rewrite,2,JSON.stringify(count));assert.equal(count.verify,3,JSON.stringify(count));assert.equal(count.trim,approve?2:3,JSON.stringify(count));
 }
});

test('validated reuse avoids paid regeneration only for identical evidence and settings',async()=>{
 let calls=0;const source='缓存验证：预算1200元，未经确认不能发布。';const work={content:source,maxSummaryChars:200,reuseValidated:true};
 const transport=async()=>{calls++;return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'预算1200元',sourceQuote:'预算1200元'}]})}]}]};};
 const opts={settings:{...settings,reviewEnabled:false},transport};let generated=0;const a=async()=>{generated++;return '预算1200元，未经确认不能发布。';};
 await runPipeline(work,a,opts);await runPipeline(work,a,opts);assert.equal(generated,1);assert.equal(calls,1);
 await runPipeline({...work,content:source+'另加备注。'},a,opts);assert.equal(generated,2);
 await runPipeline({...work,validationScope:{mode:'conversation'}},a,opts);assert.equal(generated,3);
});
test('content repair with approved meaning but miscopied quotes is independently rechecked',async()=>{
 let n=0;const source='预算1200元，未经确认不能发布。';const transport=async()=>{n++;const text=n===1?'预算1200元。':n===3?source:JSON.stringify({approved:n>=4,missingCritical:n===2?['发布条件']:[],unsupported:[],facts:[{summaryQuote:n===4?'预算为1200元':'预算1200元',sourceQuote:'预算1200元'}]});return {status:'completed',output:[{content:[{type:'output_text',text}]}]};};
 assert.equal(await runPipeline({content:source,maxSummaryChars:200},async()=>source,{settings,transport}),source);assert.equal(n,5);
});
