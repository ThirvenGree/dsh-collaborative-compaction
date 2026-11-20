// 2026-11-20 review fixes: selection switch, mode-aware cache keys, quote evidence against what the verifier saw,
// budgets on what is sent, DeepSeek health not gating rolling runs, bounded private diagnostics.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DSH_COLLAB_TEST_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'review-fixes-'));process.env.JUDGE_TEST_KEY='not-real';
const {runPipeline,defaults,factEvidenceStatus,pruneDiagnostics,diagnosticsInfo,clearDiagnostics,DIAGNOSTICS_MAX_FILES,validateConfig}=await import('../runtime.js');
const reply=text=>({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const chat={instructions:'',maxSummaryChars:300,selectConversation:true,validationScope:{mode:'conversation'},trigger:'auto'};
const base={...defaults,enabled:true,claudeEnabled:false,reviewEnabled:true,factCheckEnabled:true,verificationProvider:'openai',reviewKeyEnv:'JUDGE_TEST_KEY'};
const good={approved:true,missingCritical:[],unsupported:[],facts:[{summaryQuote:'八点',sourceQuote:'八点'}]};
function routed(seen,{verdicts=[good],summary='青枔问明天几点出发，岑舒说早上八点。'}={}){
 return async(_b,_p,_h,body)=>{const ins=body.instructions||'';(seen.calls??=[]).push(ins.slice(0,60));
  if(/Classify every supplied historical segment/.test(ins)){seen.selection=(seen.selection||0)+1;const rows=JSON.parse(body.input.split('\n').slice(1).join('\n')).segments;return reply(JSON.stringify({decisions:rows.map(r=>({id:r.id,action:'keep',reason:'对话'}))}));}
  if(/Audit candidates/.test(ins))return reply(summary);
  if(/Independently verify|Recheck|Verify the top-level/.test(ins))return reply(JSON.stringify(verdicts.length>1?verdicts.shift():verdicts[0]));
  return reply('{}');};
}

test('selection switch: off sends nothing to the selection model; on by default',async()=>{
 assert.equal(defaults.selectionEnabled,true);
 assert.throws(()=>validateConfig({...base,selectionEnabled:'no'}),/selectionEnabled/);
 const content='青枔：明天几点出发？\n岑舒：早上八点。\n'.repeat(20);
 const off={};await runPipeline({...chat,content:content+'x'},async()=>'青枔问明天几点出发，岑舒说早上八点。',{settings:{...base,selectionEnabled:false},transport:routed(off)});
 assert.equal(off.selection,undefined,'no selection request when switched off');
 const on={};await runPipeline({...chat,content:content+'y'},async()=>'青枔问明天几点出发，岑舒说早上八点。',{settings:base,transport:routed(on)});
 assert.equal(on.selection,1);
});

test('a non-empty chat summary needs one anchored quote; zero facts is repairable, not valid',()=>{
 const empty={approved:true,missingCritical:[],unsupported:[],facts:[]};
 const s=factEvidenceStatus(empty,'青枔说早上八点。','青枔：早上八点。',8,false,true);
 assert.equal(s.valid,false);assert.equal(s.repairable,true);
 assert.equal(factEvidenceStatus(empty,'本段没有实际对话。','[No actual dialogue]',8,true,true).valid,true,'empty range stays valid');
 assert.equal(factEvidenceStatus(good,'早上八点','岑舒：早上八点。',8,false,true).valid,true);
 // A quote only present in text the verifier never saw does not anchor.
 assert.equal(factEvidenceStatus({...good,facts:[{summaryQuote:'八点',sourceQuote:'被筛掉的原话'}]},'早上八点','岑舒：早上八点。',8,false,true).valid,false);
});

test('a chat run whose verifier returns no facts fails instead of passing',async()=>{
 const seen={},empty={approved:true,missingCritical:[],unsupported:[],facts:[]};
 await assert.rejects(runPipeline({...chat,content:'青枔：明天几点出发？\n岑舒：早上八点。\n'.repeat(20)+'z'},async()=>'青枔问明天几点出发，岑舒说早上八点。',{settings:base,transport:routed(seen,{verdicts:[empty]})}),/fact verification failed/i);
});

test('rolling and standard runs never share a cached summary',async()=>{
 const src=fs.readFileSync(new URL('../runtime.js',import.meta.url),'utf8');
 assert.match(src,/const keyParts=\[runMode,/);assert.match(src,/const cooldownKey=fingerprint\(\[runMode,/);
});

test('budgets count what is actually sent; DeepSeek health does not gate rolling runs',()=>{
 const src=fs.readFileSync(new URL('../runtime.js',import.meta.url),'utf8');
 assert.ok(!/budget\.check\(\[originalPart,referencePart/.test(src));
 const host=fs.readFileSync(new URL('../host.js',import.meta.url),'utf8');
 assert.match(host,/if\(!\(work\.trigger==='rolling'&&c\.rollingEnabled\)&&\(!c\.claudeEnabled\|\|c\.reviewEnabled\)\)providerHealth\.assert\(c\);/);
});

test('private diagnostics are bounded by count and age and can be cleared',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diag-'));
 const now=Date.now();
 for(let i=0;i<DIAGNOSTICS_MAX_FILES+5;i++){const f=path.join(dir,'d'+i+'.json');fs.writeFileSync(f,'{}');fs.utimesSync(f,new Date(now-i*1000),new Date(now-i*1000));}
 const old=path.join(dir,'old.json');fs.writeFileSync(old,'{}');fs.utimesSync(old,new Date(now-8*86400000),new Date(now-8*86400000));
 pruneDiagnostics(dir,now);
 const left=fs.readdirSync(dir);assert.equal(left.length,DIAGNOSTICS_MAX_FILES);assert.ok(!left.includes('old.json'));assert.ok(left.includes('d0.json'));
 assert.equal(diagnosticsInfo(dir).count,DIAGNOSTICS_MAX_FILES);
 assert.equal(clearDiagnostics(dir),DIAGNOSTICS_MAX_FILES);assert.equal(diagnosticsInfo(dir).count,0);
});
