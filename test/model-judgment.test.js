// 2026-11-15: four judgments moved from fixed program rules to the models; the program only checks and bounds them.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'model-judgment-'));process.env.JUDGE_TEST_KEY='not-real';
const {conversationSegments,selectConversation,applyExclusionAudit}=await import('../conversation-selection.js');
const {runPipeline,defaults,runs,unanchoredLiterals}=await import('../runtime.js');
const latest=()=>runs().sort((a,b)=>b.startedAt-a.startedAt)[0];
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const inputOf=body=>JSON.parse(body.input.split('\n').slice(1).join('\n'));

test('segments end at a message boundary instead of the middle of a message',()=>{
 const text='[user]\n'+'甲'.repeat(1400)+'\n\n[assistant]\n'+'乙'.repeat(2500)+'\n\n[user]\n好';
 const rows=conversationSegments(text);
 assert.ok(rows[0].text.endsWith('\n\n'));assert.ok(rows[1].text.startsWith('[assistant]'));
 assert.equal(rows.map(r=>r.text).join(''),text);
 const plain=conversationSegments('丙'.repeat(4000));assert.equal(plain[0].text.length,3000);
});

const block='<system-reminder>运行参数一大段。刚收到的用户正文："明天几点出发"。其余全是注入。</system-reminder>';
test('the audit can restore exact excerpts; invalid excerpts or a whole-restore restore the full segment',()=>{
 const rows=[{id:'s0',text:block},{id:'s1',text:'岑舒：早上八点。'+block}];
 const decisions=[{id:'s0',action:'discard',reason:'注入'},{id:'s1',action:'partial',reason:'留回复',keepSpans:['岑舒：早上八点。']}];
 const out=selectConversation(rows,{decisions:applyExclusionAudit(decisions,{restoreIds:[],restoreSpans:[{id:'s0',keepSpans:['刚收到的用户正文："明天几点出发"']},{id:'s1',keepSpans:['早上八点。<system-reminder>运行参数']}]})});
 assert.ok(out.content.includes('明天几点出发'));assert.ok(!out.content.includes('其余全是注入'));
 assert.ok(out.content.includes('岑舒：早上八点。<system-reminder>运行参数'),'overlapping excerpts are merged');
 assert.equal(out.auditSpanRestores,2);assert.equal(out.auditSpanFallbacks,0);assert.equal(out.kept,2);
 const bad=selectConversation(rows,{decisions:applyExclusionAudit(decisions,{restoreIds:[],restoreSpans:[{id:'s0',keepSpans:['不在原文里']}]})});
 assert.ok(bad.content.includes('其余全是注入'));assert.equal(bad.auditSpanFallbacks,1);assert.equal(bad.partialFallbacks,0);
 const both=selectConversation(rows,{decisions:applyExclusionAudit(decisions,{restoreIds:['s0'],restoreSpans:[{id:'s0',keepSpans:['运行参数']}]})});
 assert.ok(both.content.startsWith(block));assert.equal(both.auditSpanRestores,0);
});

const chat={instructions:'',maxSummaryChars:300,selectConversation:true,validationScope:{mode:'conversation'},trigger:'auto'};
const settings={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'JUDGE_TEST_KEY'};
const good={approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'八点',sourceQuote:'八点'}]};
function routed({verdicts=[good],audit,select,summary='青枔问明天几点出发，岑舒说早上八点。',seen={}}){
 return async(_b,_p,_h,body)=>{const ins=body.instructions||'';(seen.calls??=[]).push(ins.slice(0,40));
  if(/Classify every supplied historical segment/.test(ins))return reply(JSON.stringify({decisions:inputOf(body).segments.map(select)}));
  if(/audit proposed context exclusions/.test(ins)){seen.auditPrompt=ins;return reply(JSON.stringify(audit(inputOf(body))));}
  if(/Audit candidates/.test(ins))return reply(summary);
  if(/Revise the summary/.test(ins)){seen.rewrites=(seen.rewrites||0)+1;return reply(summary);}
  if(/The independent review lists claims/.test(ins)){seen.trims=(seen.trims||0)+1;return reply(JSON.stringify({edits:[]}));}
  if(/Independently verify|Recheck|Verify the top-level/.test(ins)){const input=inputOf(body);(seen.verifyInputs??=[]).push(input);seen.verifyPrompt=ins;return reply(JSON.stringify(verdicts.length>1?verdicts.shift():verdicts[0]));}
  return reply('{}');};
}
test('a span restored by the audit reaches the summarizer without the rest of the segment',async()=>{
 const seen={};let seenA='';
 const content='内部通知\n'.repeat(300)+'岑舒：早上八点。'+block;
 await runPipeline({...chat,content},async(_s,w)=>{seenA=w.content;return '青枔问明天几点出发，岑舒说早上八点。';},{settings,transport:routed({seen,
  select:r=>r.text.includes('岑舒')?{id:r.id,action:'partial',reason:'回复',keepSpans:['岑舒：早上八点。']}:{id:r.id,action:'discard',reason:'注入'},
  audit:input=>({restoreIds:[],restoreSpans:input.segments.filter(r=>r.text.includes('明天几点出发')).map(r=>({id:r.id,keepSpans:['刚收到的用户正文："明天几点出发"']})),reason:'用户问题'})})});
 assert.match(seen.auditPrompt,/restoreSpans/);
 assert.ok(seenA.includes('明天几点出发')&&seenA.includes('早上八点'));assert.ok(!seenA.includes('其余全是注入'));
 const sel=latest().stages.find(s=>s.name==='content-selection');assert.equal(sel.exclusionAudit.restoredSpans,1);assert.equal(sel.exclusionAudit.spanFallbacks,0);
});
const plainChat=(content,extra={})=>({...chat,selectConversation:false,content,...extra});
const keepAll=r=>({id:r.id,action:'keep',reason:'对话'});
test('the verifier advice "rewrite" skips the local trim',async()=>{
 const seen={};const bad={approved:false,missingCritical:[],unsupported:['说早上八点'],facts:[],repair:'rewrite'};
 await runPipeline(plainChat('青枔：明天几点出发？\n岑舒：早上八点。\n'.repeat(30)+'a'),async()=>'青枔问明天几点出发，岑舒说早上八点。',{settings,transport:routed({seen,verdicts:[bad,good],select:keepAll})});
 assert.equal(seen.trims||0,0);assert.equal(seen.rewrites,1);
 assert.deepEqual(latest().stages.find(s=>s.name==='fact-check').contentRepair.advice,['rewrite']);
 assert.match(seen.verifyPrompt,/keep-original/);
});
test('"keep-original" stops further repairs only after one repair has failed',async()=>{
 const seen={};const keep={approved:false,missingCritical:['出发时间'],unsupported:[],facts:[],repair:'keep-original'};
 await assert.rejects(runPipeline(plainChat('青枔：明天几点出发？\n岑舒：早上八点。\n'.repeat(30)+'b'),async()=>'青枔问明天几点出发，岑舒说早上八点。',{settings,transport:routed({seen,verdicts:[keep,keep,keep],select:keepAll})}),e=>e.deterministic===true);
 assert.equal(seen.rewrites,1,'the first keep-original verdict still gets one repair');
 const repair=latest().stages.find(s=>s.name==='fact-check').contentRepair;
 assert.equal(repair.stoppedByAdvice,true);assert.deepEqual(repair.advice,['keep-original','keep-original']);
});
test('unanchored values reach the chat verifier as hints, never the run record',async()=>{
 const seen={};
 await runPipeline(plainChat('青枔：我们下周三见面。\n岑舒：好的。\n'.repeat(30)+'c'),async()=>'青枔约下周三见面，岑舒同意。',{settings,transport:routed({seen,summary:'青枔约2026-11-20见面，岑舒同意。',verdicts:[{...good,facts:[{summaryQuote:'见面',sourceQuote:'见面'}]}],select:keepAll})});
 assert.deepEqual(seen.verifyInputs[0].literalHints,['2026-11-20']);assert.match(seen.verifyPrompt,/literalHints/);
 assert.ok(!JSON.stringify(latest()).includes('2026-11-20'));
 assert.deepEqual(unanchoredLiterals('第3项 2026-11-20','2026-11-20 才是原文'),[]);
});
test('a chat verifier reply without facts is a clean rejection, not a crash',async()=>{
 const {factEvidenceStatus}=await import('../runtime.js');
 const s=factEvidenceStatus({approved:true},'摘要','原文',24,false,true);
 assert.equal(s.valid,false);assert.equal(s.diagnostic.structureValid,false);
});
test('strict mode sends no literal hints',async()=>{
 const seen={};
 await runPipeline({content:'交付改到 5 日。\n'.repeat(30)+'d',instructions:'',maxSummaryChars:300,trigger:'auto'},async()=>'交付改到5日。',{settings,transport:routed({seen,summary:'交付改到5日。',verdicts:[{...good,facts:[{summaryQuote:'交付改到',sourceQuote:'交付改到'}]}],select:keepAll})});
 assert.ok(seen.verifyInputs.every(i=>!('literalHints' in i)));
});
