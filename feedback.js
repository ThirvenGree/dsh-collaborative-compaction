import {createHash} from 'node:crypto';
import {fixtureCases,runReplaySuite,mapReplayTasks} from './replay.js';
import {collectCases,bankControl,citedSpans} from './challenge-bank.js';
import {validateClause,renderClause} from './proposal.js';
export {collectCases,validateChallengeGroups} from './challenge-bank.js';

// A replay can select these source-handling instructions. Nothing returned by a model is persisted as executable policy.
const families={
 'retain-identifiers':{probe:'omitted-tool',holdout:'unseen-identifier',text:'Where a later action depends on a technical identifier, preserve its exact spelling, its purpose and the record that establishes it.'},
 'track-corrections':{probe:'later-correction',holdout:'unseen-correction',text:'Keep the current corrected value and identify which earlier decision was superseded. Tie the change to the relevant source records.'},
 'distinguish-receipts':{probe:'unconfirmed-click',holdout:'unseen-receipt',text:'Keep permission, attempted action and independently confirmed outcome separate. If confirmation is missing, retain the open verification step and the evidence that prevents duplicate execution.'}
};
// Each family can be tightened or shortened again under a new validation. Keys, never free-form text, cross the trust boundary.
const anchored={
 'retain-identifiers':'For identifiers that select a tool, file or parameter, keep one compact source-linked tuple: exact identifier, intended use, supporting record. When space is tight, prefer this tuple to background prose.',
 'track-corrections':'Use one compact revision entry for each changed decision: original value (superseded), current value, and the source of the change. Quote the exact current value beside the current source.',
 'distinguish-receipts':'For an irreversible action preserve one short ledger entry: permitted or requested, attempted, confirmed or still unknown, next safe check and supporting record. Never label an attempt as confirmed.'
};
const rules=Object.fromEntries(Object.entries(families).flatMap(([key,family])=>[[key,family.text],[key+'-anchored',anchored[key]]]));
const builtIns=collectCases();
const holdouts=builtIns.groups.slice(0,3).map(group=>group.positive);
const background=[
 '傍晚整理完桌上的空文件夹，借用的水杯已经洗净放回原处。窗边贴的新纸条只是提醒离开前关灯，大家已经读过。',
 '例行碰面时花了些时间核对签到位置，临时放错地方的标签已取回。换了笔仍写得不顺，拿来备用笔之后这件小事已处理好。',
 '资料袋的封口比预想的紧，拆开时没有弄坏里面的东西。现已将空包装折好统一回收，下一次有同样包装还可以沿边拆。',
 '中途短暂讨论了屋内光线和桌椅摆放。大家把桌子移开一点，方便经过走廊。午后送来的空盒已清点完毕。',
 '例会的茶点已经分好，剩余纸杯放回箱子。布置桌面的便签颜色没有统一要求，此事已谈妥，和正在进行的任务无关。',
 '临时标出的入口后来换回原来的指示牌。来访名单另有人核对，衣帽架已经搬回门边，最近这轮值日也完成了。',
 '有人想把靠门的架子再调高一点，查看后沿用了现在的高度。此前水杯打翻过的位置已经擦干，地板可正常通行。',
 '讨论休息处摆放杂志的方式时更换了几种顺序，最后由当值人员自行决定。这件事情不需要在之后的交接时继续跟进。',
 '记录里的字迹难辨是墨水太淡所致，换了一支笔后可以清楚阅读。空笔芯已经单独放好，等下次收集时一并处理。'
];
export const validationCases=builtIns.all;
export const diagnosticCases=builtIns.diagnostics;
export {scopeOf} from './policy-scope.js';
export const emptyPolicy=()=>({schema:1,revision:0,active:{version:0,rules:[],scope:null},previous:null,last:null,lease:null,lastAttempt:null});
function checkedClauses(clauses=[]){
 if(!Array.isArray(clauses)||clauses.length>4)throw Error('Invalid learned compression policy');
 const checked=clauses.map(c=>validateClause(c));
 if(new Set(checked.map(c=>c.id)).size!==checked.length)throw Error('Duplicate learned compression clause');
 return checked;
}
export function effectivePolicy(state,scope){
 const policy=state.active;
 if(policy.scope!==scope)return {version:0,rules:[],scope};
 if(!Number.isSafeInteger(policy.version)||policy.version<0||!Array.isArray(policy.rules)||policy.rules.length>3||
    new Set(policy.rules).size!==policy.rules.length||policy.rules.some(id=>!Object.hasOwn(rules,id))||new Set(policy.rules.map(id=>id.replace(/-anchored$/,''))).size!==policy.rules.length)throw Error('Invalid compression policy');
 return policy.clauses===undefined?policy:{...policy,clauses:checkedClauses(policy.clauses)};
}
export function withPolicy(work,policy){
 const clauses=checkedClauses(policy.clauses);
 const snapshot={...work,policyVersion:policy.version,policyRules:[...policy.rules,...clauses.map(c=>c.id)]};
 if(policy.rules.length||clauses.length){
  const marker=[...policy.rules,...(clauses.length?['learned']:[])].join(', ');
  const instructions=[...policy.rules.map(id=>rules[id]),...clauses.map(c=>renderClause(c))];
  snapshot.instructions+='\n[Compression policy v'+policy.version+': '+marker+']\n'+instructions.join('\n');
 }
 return snapshot;
}
function quality(probes){
 return Object.fromEntries(probes.map(({id,classification,lanes})=>[id,{classification,
   full:lanes.full.pass,summary:lanes.summary.pass,retrieval:lanes.retrieval.pass,
   summaryCorrect:lanes.summary.correct===true,retrievalCorrect:lanes.retrieval.correct===true}]));
}
const stop=report=>report.probes.flatMap(p=>Object.values(p.lanes)).find(l=>l.error);
function chunks(list,size=4){
 return Array.from({length:Math.ceil(list.length/size)},(_,i)=>list.slice(i*size,(i+1)*size));
}
const phased=(options,phase)=>({...options,phase:(options.phase||'feedback')+'/'+phase});
const checkpointTask=(options,key,input,fn)=>options.checkpoint?options.checkpoint(`${options.phase||'feedback'}/${key}`,input,fn):fn();
async function regenerated(suites,policy,{options,compress,onlyIds}){
 options.onPhase?.(options.phase||'feedback');
 const cases=[],summaries=new Map();
 const batches=await mapReplayTasks(suites,async (suite,index)=>{
  options.signal?.throwIfAborted();
  const source=suite.flatMap(x=>x.records);
  const noise=background.map((text,i)=>({id:'noise-'+i,role:'assistant',text}));
  const records=source.flatMap((r,i)=>noise[i]?[noise[i],r]:[r]).concat(noise.slice(source.length));
  const content=records.map(r=>'['+r.id+'] '+r.text).join('\n');
  const work={content,reference:'',instructions:'Summarize the current decisions and task state. Cite relevant record IDs as [id] alongside short exact evidence where available.',trigger:'calibration',minSummaryChars:1,maxSummaryChars:420};
  const key=`compression/${index}`;
  const summary=await checkpointTask(options,key,{work,policy},()=>compress(work,policy,{phase:options.phase||'feedback',key}));
  const summaryCitations=citedSpans(summary,records);
  return suite.filter(t=>!onlyIds||onlyIds.has(t.id)).map(t=>({...t,records,summary,summaryCitations}));
 },{signal:options.signal,concurrency:options.concurrency??3});
 for(const batch of batches)for(const test of batch){cases.push(test);summaries.set(test.id,test.summary);}
 const report=await runReplaySuite({...options,cases});
 if(stop(report))throw Error(stop(report).error);
 return {before:quality(report.probes),summaries,report};
}
// A bounded bootstrap diagnoses the current compressor. It never proposes or
// installs a policy; a completed baseline may still have identified real omissions.
export async function runBaseline({active,options,compress,cases=diagnosticCases}){
 if(!Array.isArray(cases)||!cases.length||new Set(cases.map(t=>t.id)).size!==cases.length||!cases.some(t=>t.id===bankControl.id))throw Error('Baseline requires distinct cases and the positive control');
 const result=await regenerated(chunks(cases),active,{options:{...options,phase:options.phase||'bootstrap'},compress});
 const {before,report}=result;
 const failures=cases.filter(t=>t.id!==bankControl.id&&!before[t.id].summary).map(t=>t.id);
 const valid=Object.values(before).every(q=>q.full)&&before[bankControl.id].summary&&before[bankControl.id].retrieval;
 return {status:valid?'baseline-complete':'held',reason:valid?(failures.length?'已完成小批当前策略基线，发现待复现的压缩遗漏；尚未修改策略。':'已完成小批当前策略基线，本批未发现压缩遗漏；尚未修改策略。'):'原文或正对照未通过，尚不能将差异归因于压缩。',before,report,failures,covered:cases.map(t=>t.id)};
}
function regressed(before,after){
 return Object.keys(before).some(id=>['full','summary','retrieval','summaryCorrect','retrievalCorrect'].some(lane=>before[id][lane]&&!after[id][lane]));
}
function unchanged(reason,proof={}){return {status:'held',reason,...proof};}
async function modelFeedback({active,nextVersion,options,compress,propose},bank){
 // Separate compression corpora as well as prompts. The summaries sent to the proposer must not contain holdouts.
 const discoverySuites=chunks(bank.diagnostics);
 const hiddenSuites=chunks(bank.groups.flatMap(g=>[g.positive,g.counter]));
 const oldDiscovery=await regenerated(discoverySuites,active,{options:phased(options,'discovery-old-1'),compress});
 const beforeDiscovery=oldDiscovery.before;
 if(Object.values(beforeDiscovery).some(q=>!q.full))return unchanged('重生成后的原文组未通过。',{before:beforeDiscovery});
 if(!beforeDiscovery[bankControl.id]?.summary||!beforeDiscovery[bankControl.id]?.retrieval)return unchanged('实际生成摘要的正对照未通过，不能把本轮作为可靠基线。',{before:beforeDiscovery});
 const failures=bank.diagnostics.filter(t=>t.id!==bankControl.id&&!beforeDiscovery[t.id].summary).map(t=>{
  const probe=oldDiscovery.report.probes.find(p=>p.id===t.id);
  return {...t,summary:oldDiscovery.summaries.get(t.id),classification:probe.classification,summaryAnswer:probe.lanes.summary.answer,summaryCited:probe.lanes.summary.cited,summaryCorrect:probe.lanes.summary.correct,retrievalRecovered:probe.lanes.retrieval.pass};
 });
 if(!failures.length)return {status:'unchanged',reason:'现行策略重生成的摘要已经通过，未复现诊断遗漏。',before:beforeDiscovery};
 const proposalInput={failures,active:checkedClauses(active.clauses)};
 options.onPhase?.((options.phase||'feedback')+'/proposal-review');
 const response=await checkpointTask(options,'proposal-review',proposalInput,()=>propose(proposalInput));
 if(response?.status!=='candidate')return unchanged(response?.reason||'没有通过独立审核的模型提案。',{before:beforeDiscovery});
 const {targets,replaceId}=response;
 if(!Array.isArray(targets)||targets.length<1||targets.length>2||new Set(targets).size!==targets.length||!targets.every(id=>failures.some(f=>f.id===id)))
  return unchanged('候选未绑定到实际复现的诊断失误。');
 let clause;
 try{clause=validateClause(response.clause);}catch{return unchanged('候选条款结构无效。');}
 const previous=checkedClauses(active.clauses);
 if(previous.some(c=>c.id===clause.id)||replaceId&&!previous.some(c=>c.id===replaceId))return unchanged('候选重复或要替换的旧条款已经变化。');
 const clauses=previous.filter(c=>c.id!==replaceId).concat([clause]);
 if(clauses.length>4)return unchanged('当前四条自拟策略已满；本次提案未指定可替换的旧条款。');
 // No discovery answers, withheld source text or record labels may be stashed in a reusable instruction.
 const text=[clause.when,clause.retain,clause.relation].join(' ').normalize('NFKC').toLowerCase();
 const disallowed=bank.all.flatMap(t=>[t.expected,t.question,...t.records.map(r=>r.text),...Object.values(t.requiredQuotes||{})]);
 if(disallowed.some(v=>v.length>=4&&text.includes(v.normalize('NFKC').toLowerCase())))return unchanged('候选出现校准题的专用字面量，未采用。');
 const candidate={...active,version:nextVersion,clauses};
 const oldHidden=await regenerated(hiddenSuites,active,{options:phased(options,'hidden-old-1'),compress});
 const before={...beforeDiscovery,...oldHidden.before};
 if(Object.values(oldHidden.before).some(q=>!q.full))return unchanged('未见场景的原文对照不可靠。',{before});
 const {before:after}=await regenerated([...discoverySuites,...hiddenSuites],candidate,{options:phased(options,'candidate-1'),compress});
 const noRegression=!regressed(before,after),control=after[bankControl.id].summary&&after[bankControl.id].retrieval;
 const recovered=targets.filter(id=>{
  const {positive,counter}=bank.groups.find(g=>g.probe.id===id),unseen=[positive.id,counter.id];
  return !before[id].summary&&after[id].summary&&after[id].retrieval&&
   unseen.every(key=>after[key].summary&&after[key].retrieval)&&unseen.some(key=>!before[key].summary);
 });
 const proof={before,after,gates:{noRegression,control,recovered},proposed:[clause.id],targets,...(replaceId?{replaceId}:{})};
 if(!noRegression||!control||recovered.length!==targets.length)return unchanged('新提案未同时修复复现题和未见题、守住边界反例以及其他基线。',proof);
 // Retest the actual compressor, not merely the same saved summary. Keep each original
 // corpus and character budget unchanged so a smaller/easier batch cannot fake replication.
 const repeatIds=new Set([bankControl.id,...targets.flatMap(id=>{
  const group=bank.groups.find(g=>g.probe.id===id);return [id,group.positive.id,group.counter.id];
 })]);
 const repeatSuites=[...discoverySuites,...hiddenSuites].filter(suite=>suite.some(t=>repeatIds.has(t.id)));
 const {before:repeatBefore}=await regenerated(repeatSuites,active,{options:phased(options,'old-repeat-2'),compress,onlyIds:repeatIds});
 const counts=Object.fromEntries(targets.map(id=>{
  const {positive,counter}=bank.groups.find(g=>g.probe.id===id);
  return [id,{oldFailures:Number(!before[id].summary)+Number(!repeatBefore[id].summary),
   unseen:Object.fromEntries([positive.id,counter.id].map(key=>[key,{oldFailures:Number(!before[key].summary)+Number(!repeatBefore[key].summary)}]))}];
 }));
 const oldStable=Object.values(repeatBefore).every(q=>q.full)&&targets.every(id=>counts[id].oldFailures===2&&Object.values(counts[id].unseen).some(q=>q.oldFailures===2));
 proof.repeat={before:repeatBefore};
 proof.gates.repeatable={required:2,passed:false,targets:counts};
 if(!oldStable)return unchanged('目标题或未见题的旧策略失误未能重复两次，可能是采样波动，保留现行策略。',proof);
 const {before:repeatAfter}=await regenerated(repeatSuites,candidate,{options:phased(options,'candidate-repeat-2'),compress,onlyIds:repeatIds});
 proof.repeat.after=repeatAfter;
 for(const id of targets){
  counts[id].newPasses=Number(after[id].full&&after[id].summary&&after[id].retrieval)+Number(repeatAfter[id].full&&repeatAfter[id].summary&&repeatAfter[id].retrieval);
  for(const key of Object.keys(counts[id].unseen))counts[id].unseen[key].newPasses=Number(after[key].full&&after[key].summary&&after[key].retrieval)+Number(repeatAfter[key].full&&repeatAfter[key].summary&&repeatAfter[key].retrieval);
 }
 const stable=targets.every(id=>counts[id].newPasses===2&&Object.values(counts[id].unseen).every(q=>q.newPasses===2))&&
  repeatAfter[bankControl.id].summary&&repeatAfter[bankControl.id].retrieval&&!regressed(repeatBefore,repeatAfter);
 proof.gates.repeatable.passed=!!stable;
 if(!stable)return unchanged('候选在第二次独立压缩与回放中未能保持改进或守住对照，保留现行策略。',proof);
 return {status:'promoted',reason:'模型提案已通过独立审核；旧策略遗漏和候选改进重复两次成立，未见正例、边界反例与对照均通过。',...proof,candidate};
}
export async function evaluateFeedback(args){
 const {diagnostic,active,nextVersion,options,compress,propose,challengeGroups=[]}=args;
 const unavailable=stop(diagnostic);
 if(unavailable)return {status:'unavailable',reason:unavailable.error};
 const bank=collectCases(challengeGroups);
 const diagnostics=propose?bank.diagnostics:fixtureCases;
 if(diagnostic.probes.length!==diagnostics.length||!diagnostics.every(c=>diagnostic.probes.some(p=>p.id===c.id&&p.lanes.full.pass)))
  return unchanged('诊断的原文对照不足，不能归因于压缩策略。');
 const control=bankControl.id;
 if(!diagnostic.probes.find(p=>p.id===control).lanes.summary.pass)return unchanged('摘要充足的正对照未通过。');
 const misses=diagnostics.filter(t=>!diagnostic.probes.find(p=>p.id===t.id).lanes.summary.pass);
 // A prepared diagnostic summary can succeed even when the actual compressor drops the same evidence.
 if(propose)return modelFeedback(args,bank);
 if(!misses.length)return {status:'unchanged',reason:'本轮未发现需要调整的压缩遗漏。'};
 // Compatibility path for callers of the original diagnostic API, without a proposal service.
 const run=async (policy,phase)=>(await regenerated([fixtureCases,holdouts],policy,{options:phased(options,phase),compress})).before;
 const before=await run(active,'legacy-old-1');
 if(Object.values(before).some(q=>!q.full))return unchanged('重生成对照中，原文组未通过。',{before});
 const signals=Object.keys(families).filter(id=>misses.some(t=>t.id===families[id].probe)&&!before[families[id].probe].summary);
 if(!signals.length)return {status:'unchanged',reason:'现行策略重生成的摘要已经通过，未复现诊断遗漏。',before};
 const revised=signals.map(id=>active.rules.includes(id)?id+'-anchored':id);
 const retained=active.rules.filter(id=>!signals.includes(id.replace(/-anchored$/,'')));
 const candidate={...active,version:nextVersion,rules:[...retained,...revised]};
 const after=await run(candidate,'legacy-candidate-1');
 const recovered=signals.filter(key=>{const {probe,holdout}=families[key];return !before[probe].summary&&after[probe].summary&&after[probe].retrieval&&after[holdout].summary&&after[holdout].retrieval;});
 const gates={noRegression:!regressed(before,after),control:after[control].summary&&after[control].retrieval,recovered};
 if(!gates.noRegression||!gates.control||recovered.length!==signals.length)return unchanged('候选未逐项改善已复现的失误、未通过未见情境或使其他表现退步。',{before,after,gates,proposed:revised});
 return {status:'promoted',reason:'各项遗漏已补足，未见情境和无退步检查通过。',before,after,gates,proposed:revised,candidate};
}
