// 2026-11-14: unsupported-only findings are fixed by exact local edits that must still pass a fresh independent check.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'fact-trim-'));process.env.TRIM_TEST_KEY='not-real';
const {runPipeline,defaults,applyTrimEdits,quoteAnchored,runs}=await import('../runtime.js');
const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'TRIM_TEST_KEY'};
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const ok=(summaryQuote,sourceQuote)=>({approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote,sourceQuote}]});
// Routes each fake model call by the instructions it was given.
function transport(plan){
 const seen=[];
 const fn=async(_base,_path,_headers,body)=>{
  const kind=/smallest exact edit/.test(body.instructions)?'trim':/Revise the summary/.test(body.instructions)?'rewrite':/Audit candidates/.test(body.instructions)?'review':'verify';
  seen.push(kind);const next=plan[kind].shift();if(next===undefined)throw Error('unexpected '+kind+' call');
  return reply(typeof next==='string'?next:JSON.stringify(next));
 };
 fn.seen=seen;return fn;
}
const latest=()=>runs().sort((a,b)=>b.startedAt-a.startedAt)[0];

test('trim edits apply only to unique, non-overlapping, non-growing spans',()=>{
 assert.equal(applyTrimEdits('甲说前两张图一样。',[{find:'前两张',replace:'两张'}],3),'甲说两张图一样。');
 assert.throws(()=>applyTrimEdits('一样一样',[{find:'一样',replace:''}],3),/unique/);
 assert.throws(()=>applyTrimEdits('甲说好',[{find:'好',replace:'很好'}],3),/adds text/);
 assert.throws(()=>applyTrimEdits('甲乙丙丁',[{find:'甲乙',replace:''},{find:'乙丙',replace:''}],3),/overlap/);
 assert.throws(()=>applyTrimEdits('甲乙',[{find:'甲',replace:'甲'}],3),/no change/);
 assert.throws(()=>applyTrimEdits('甲乙',[],3),/no usable/);
 assert.throws(()=>applyTrimEdits('甲乙丙',[{find:'甲',replace:''},{find:'乙',replace:''}],1),/no usable/);
});
test('quote anchoring tolerates whitespace, width and quote style but not wording',()=>{
 assert.ok(quoteAnchored('她说「怎么样」  然后走了',"她说\"怎么样\" 然后走了"));
 assert.ok(quoteAnchored('预算ＡＢＣ','预算ABC'));
 assert.equal(quoteAnchored('她说「怎么样」','她问「怎么样」'),false);
 assert.equal(quoteAnchored('任何文字',''),false);
});
test('unsupported-only finding is fixed by a local trim and re-verified',async()=>{
 const content='决定：先确认地址再寄出。她发了两张一样的图。',draft='先确认地址再寄出。她发的前两张图一样。',fixed='先确认地址再寄出。她发的两张图一样。';
 const t=transport({review:[draft],verify:[{approved:false,missingCritical:[],unsupported:['“前两张”原文未指明'],facts:[{summaryQuote:'先确认地址再寄出。',sourceQuote:'先确认地址再寄出。'}]},ok('两张图一样','两张一样的图')],trim:[{edits:[{find:'前两张',replace:'两张',reason:'原文未说是哪两张'}]}]});
 const out=await runPipeline({content,maxSummaryChars:200},async()=>draft,{settings,transport:t});
 assert.equal(out,fixed);assert.deepEqual(t.seen,['review','verify','trim','verify']);
 const r=latest();assert.equal(r.status,'validated');assert.deepEqual(r.stages.map(s=>s.name+':'+s.status),['A:success','review:success','fact-check:success','fact-trim:success']);
});
test('an invalid trim falls back to the full rewrite',async()=>{
 const content='决定：先确认收件人再寄出。',draft='先确认收件人再寄出，并已寄出。',fixed='先确认收件人再寄出。';
 const t=transport({review:[draft],verify:[{approved:false,missingCritical:[],unsupported:['“已寄出”无依据'],facts:[{summaryQuote:'先确认收件人再寄出',sourceQuote:'先确认收件人再寄出'}]},ok(fixed,'先确认收件人再寄出。')],trim:[{edits:[{find:'不存在的文字',replace:''}]}],rewrite:[fixed]});
 const out=await runPipeline({content,maxSummaryChars:200},async()=>draft,{settings,transport:t});
 assert.equal(out,fixed);assert.deepEqual(t.seen,['review','verify','trim','rewrite','verify']);
 const stages=latest().stages.map(s=>s.name+':'+s.status);assert.ok(stages.includes('fact-trim:fallback'),stages.join());assert.ok(stages.includes('fact-repair:success'));
});
test('after the rewrite budget, one extra pass may only trim',async()=>{
 const content='决定：周五前交稿，不要公开。',draft='周五前交稿。',rewritten='周五前交稿，不要公开，已获批准。',fixed='周五前交稿，不要公开。';
 const t=transport({review:[draft],verify:[{approved:false,missingCritical:['缺少“不要公开”'],unsupported:[],facts:[{summaryQuote:'周五前交稿',sourceQuote:'周五前交稿'}]},{approved:false,missingCritical:[],unsupported:['“已获批准”无依据'],facts:[{summaryQuote:'周五前交稿',sourceQuote:'周五前交稿'}]},ok(fixed,'周五前交稿，不要公开。')],rewrite:[rewritten],trim:[{edits:[{find:'，已获批准',replace:''}]}]});
 const out=await runPipeline({content,maxSummaryChars:200},async()=>draft,{settings,transport:t});
 assert.equal(out,fixed);assert.deepEqual(t.seen,['review','verify','rewrite','verify','trim','verify']);
});
test('a trimmed summary that still fails independent verification is rejected',async()=>{
 const content='决定：先核对清单。',draft='先核对清单，然后马上发货。';
 const bad={approved:false,missingCritical:[],unsupported:['“马上发货”无依据'],facts:[{summaryQuote:'先核对清单',sourceQuote:'先核对清单'}]};
 const t=transport({review:[draft],verify:[bad,bad,bad],trim:[{edits:[{find:'马上',replace:''}]},{edits:[{find:'然后',replace:''}]}]});
 await assert.rejects(runPipeline({content,maxSummaryChars:200},async()=>draft,{settings,transport:t}),/Independent fact verification failed/);
 assert.equal(latest().status,'failed');
});
