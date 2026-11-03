import {createHash} from 'node:crypto';
import {fixtureCases,runReplaySuite} from './replay.js';

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
const holdouts=[
 {id:'unseen-identifier',question:'校准工单最终指定使用哪个探针标识？只回答标识。',expected:'probe_L9',requiredIds:['h1'],requiredQuotes:{h1:'probe_L9'},records:[{id:'h1',role:'tool',text:'校准工单确认使用探针 probe_L9，先作只读测量。'}]},
 {id:'unseen-correction',question:'按最后一次变更，返程在几号站台？只答站台号。',expected:'七号',requiredIds:['h3'],requiredQuotes:{h3:'七号'},records:[{id:'h2',role:'user',text:'返程在二号站台。'},{id:'h3',role:'user',text:'后来通知改了，返程在七号站台。',corrects:'h2'}]},
 {id:'unseen-receipt',question:'归档申请现在应重新发送（submit）、核对结果（verify），还是宣布完成（done）？仅答英文动作。',expected:'verify',requiredIds:['h5'],requiredQuotes:{h5:'尚无确认编号'},records:[{id:'h4',role:'user',text:'只允许提出一次归档申请。'},{id:'h5',role:'tool',text:'申请已经发出，尚无确认编号，外部状态未知。'}]}
];
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
export const validationCases=[...fixtureCases,...holdouts];
export const scopeOf=c=>createHash('sha256').update(JSON.stringify(Object.entries(c).filter(([k])=>k!=='replayFeedbackEnabled').sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
export const emptyPolicy=()=>({schema:1,revision:0,active:{version:0,rules:[],scope:null},previous:null,last:null,lease:null,lastAttempt:0});
export function effectivePolicy(state,scope){
 const policy=state.active;
 if(policy.scope!==scope)return {version:0,rules:[],scope};
 if(!Number.isSafeInteger(policy.version)||policy.version<0||!Array.isArray(policy.rules)||policy.rules.length>3||
    new Set(policy.rules).size!==policy.rules.length||policy.rules.some(id=>!Object.hasOwn(rules,id))||new Set(policy.rules.map(id=>id.replace(/-anchored$/,''))).size!==policy.rules.length)throw Error('Invalid compression policy');
 return policy;
}
export function withPolicy(work,policy){
 const snapshot={...work,policyVersion:policy.version,policyRules:[...policy.rules]};
 if(policy.rules.length)snapshot.instructions+='\n[Compression policy v'+policy.version+': '+policy.rules.join(', ')+']\n'+policy.rules.map(id=>rules[id]).join('\n');
 return snapshot;
}
// Only substrings visibly associated with the same record label can be cited by summary-only readers.
function citedSpans(text,records){
 const spans=[];
 const matches=[...text.matchAll(/\[([\w-]+)\]/g)];
 for(const [i,m] of matches.entries()){
  const record=records.find(r=>r.id===m[1]);if(!record)continue;
  const chunk=text.slice(m.index+m[0].length,matches[i+1]?.index);
  for(let start=0;start<record.text.length;start++){
   let end=start+4;if(!chunk.includes(record.text.slice(start,end))||end>record.text.length)continue;
   while(end<record.text.length&&chunk.includes(record.text.slice(start,end+1)))end++;
   spans.push({id:record.id,quote:record.text.slice(start,end)});start=end-1;
  }
 }
 return spans;
}
function quality(probes){
 return Object.fromEntries(probes.map(({id,classification,lanes})=>[id,{classification,
   full:lanes.full.pass,summary:lanes.summary.pass,retrieval:lanes.retrieval.pass,
   summaryCorrect:lanes.summary.correct===true,retrievalCorrect:lanes.retrieval.correct===true}]));
}
const stop=report=>report.probes.flatMap(p=>Object.values(p.lanes)).find(l=>l.error);
export async function evaluateFeedback({diagnostic,active,nextVersion,options,compress}){
 const unavailable=stop(diagnostic);
 if(unavailable)return {status:'unavailable',reason:unavailable.error};
 if(diagnostic.probes.length!==fixtureCases.length||!fixtureCases.every(c=>diagnostic.probes.some(p=>p.id===c.id&&p.lanes.full.pass)))
  return {status:'held',reason:'诊断的原文对照不足，不能归因于压缩策略。'};
 const control=fixtureCases.at(-1).id;
 if(!diagnostic.probes.find(p=>p.id===control).lanes.summary.pass)return {status:'held',reason:'摘要充足的正对照未通过。'};
 const suspects=Object.keys(families).filter(id=>!diagnostic.probes.find(p=>p.id===families[id].probe).lanes.summary.pass);
 if(!suspects.length)return {status:'unchanged',reason:'未发现可调整的新条款。'};
 // Keep the validation questions, answers and failure labels out of both compressors.
 const run=async policy=>{
  const cases=[];
  for(const suite of [fixtureCases,holdouts]){
   options.signal?.throwIfAborted();
   const source=suite.flatMap(x=>x.records);
   const noise=background.map((text,i)=>({id:'noise-'+i,role:'assistant',text}));
   const records=source.flatMap((r,i)=>noise[i]?[noise[i],r]:[r]).concat(noise.slice(source.length));
   const content=records.map(r=>'['+r.id+'] '+r.text).join('\n');
   const summary=await compress({content,reference:'',instructions:'Summarize the current decisions and task state. Cite relevant record IDs as [id] alongside short exact evidence where available.',trigger:'calibration',minSummaryChars:1,maxSummaryChars:420},policy);
   const summaryCitations=citedSpans(summary,records);
   for(const test of suite)cases.push({...test,records,summary,summaryCitations});
  }
  const report=await runReplaySuite({...options,cases});
  if(stop(report))throw Error(stop(report).error);
  return quality(report.probes);
 };
 const before=await run(active);
 if(Object.values(before).some(q=>!q.full))return {status:'held',reason:'重生成对照中，原文组未通过。',before};
 const signals=suspects.filter(id=>!before[families[id].probe].summary);
 if(!signals.length)return {status:'unchanged',reason:'现行策略重生成的摘要已经通过，未复现诊断遗漏。',before};
 const revised=signals.map(id=>active.rules.includes(id)?id+'-anchored':id);
 const unchanged=active.rules.filter(id=>!signals.includes(id.replace(/-anchored$/,'')));
 const candidate={version:nextVersion,rules:[...unchanged,...revised],scope:active.scope};
 const after=await run(candidate);
 const regression=Object.keys(before).some(id=>['full','summary','retrieval','summaryCorrect','retrievalCorrect'].some(lane=>before[id][lane]&&!after[id][lane]));
 const recovered=signals.filter(key=>{const {probe,holdout}=families[key];return !before[probe].summary&&after[probe].summary&&after[probe].retrieval&&after[holdout].summary&&after[holdout].retrieval;});
 const gates={noRegression:!regression,control:after[control].summary&&after[control].retrieval,recovered};
 // A bundled amendment must earn each clause, not hide a useless clause behind a different improvement.
 if(regression||!gates.control||recovered.length!==signals.length)return {status:'held',reason:'候选未逐项改善已复现的失误、未通过未见情境或使其他表现退步。',before,after,gates,proposed:revised};
 return {status:'promoted',reason:'各项遗漏在真实重生成对照中得到补足；未见情境、充足摘要对照和无回退检查通过。',before,after,gates,proposed:revised,candidate};
}
