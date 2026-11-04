import {fixtureCases} from './replay.js';

function question(id,ask,answer,recordId,text,anchor,summary){
 return {id,question:ask,expected:answer,records:[{id:recordId,role:'tool',text}],
  requiredIds:[recordId],requiredQuotes:{[recordId]:anchor},...(summary===undefined?{}:{summary})};
}
const legacyHoldouts=[
 {id:'unseen-identifier',question:'校准工单最终指定使用哪个探针标识？只回答标识。',expected:'probe_L9',requiredIds:['h1'],requiredQuotes:{h1:'probe_L9'},records:[{id:'h1',role:'tool',text:'校准工单确认使用探针 probe_L9，先作只读测量。'}]},
 {id:'unseen-correction',question:'按最后一次变更，返程在几号站台？只答站台号。',expected:'七号',requiredIds:['h3'],requiredQuotes:{h3:'七号'},records:[{id:'h2',role:'user',text:'返程在二号站台。'},{id:'h3',role:'user',text:'后来通知改了，返程在七号站台。',corrects:'h2'}]},
 {id:'unseen-receipt',question:'归档申请现在应重新发送（submit）、核对结果（verify），还是宣布完成（done）？仅答英文动作。',expected:'verify',requiredIds:['h5'],requiredQuotes:{h5:'尚无确认编号'},records:[{id:'h4',role:'user',text:'只允许提出一次归档申请。'},{id:'h5',role:'tool',text:'申请已经发出，尚无确认编号，外部状态未知。'}]}
];
const legacyCounters=[
 question('unseen-identifier-inapplicable','检修板面这一步用何种方式检查？只答方式。','目视检查','b1','柜内另有扫频仪，但本步骤指定目视检查，仪器留给后续班组。','目视检查'),
 question('unseen-independent-value','上午那班从哪座桥经过？只答桥名。','石桥','b2','上午的班车经过石桥，晚班另走木桥；晚班路线不改变早班安排。','经过石桥'),
 question('unseen-confirmed','记录移交现在是核实中（verify）还是已签收（done）？只答英文。','done','b3','纸本移交后，收件人已签收，同一笔收据归入当日日志。','收件人已签收')
];
const scopeProblem={
 probe:question('scope-exception','墨层已经松脱的借用底稿，此刻该做什么？只答一个动作。','暂停扫描','s2','借入的底稿一般当日扫描。若墨层松脱须暂停扫描，修复员确认后方可继续。','须暂停扫描','借入的底稿一般当日扫描。'),
 positive:question('unseen-scope-applies','周三临时停电时，访客入馆如何登记？只答登记方式。','纸本登记','u1','访客平时刷卡入馆。停电期间启用纸本登记，恢复供电后撤走登记册。','启用纸本登记'),
 counter:question('unseen-scope-outside','一份签章齐全的普通申请应转交给谁？只答岗位。','值班员','u2','签章齐全的普通申请由值班员接收。只有签章缺失的申请交给稽核员补核。','值班员接收')
};
const builtInGroups=fixtureCases.slice(0,3).map((probe,i)=>({probe,positive:legacyHoldouts[i],counter:legacyCounters[i]})).concat(scopeProblem);
export const bankControl=fixtureCases.at(-1);

const idOK=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)&&!['constructor','prototype','toString','valueOf'].includes(id)&&!id.startsWith('noise-');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=(text,max)=>typeof text==='string'&&text.trim()===text&&text.length>0&&text.length<=max&&
 !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]|(?:sk-[\w-]{12,}|AIza[\w-]{22,}|Bearer\s+\S+|(?:password|api[_-]?key|令牌|密码)\s*[:=：]\s*\S+)/i.test(text);
const norm=text=>text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function keysOnly(o,keys){return plain(o)&&Object.keys(o).every(k=>keys.includes(k));}
function addUnique(set,value,what){
 if(!value||set.has(value))throw Error('校准包存在空白或重复的'+what);
 set.add(value);
}
function checkCase(c,isProbe,seen){
 if(!keysOnly(c,['id','question','expected','requiredIds','requiredQuotes','records',...(isProbe?['summary']:[])])||
  !idOK(c.id)||!safe(c.question,300)||!safe(c.expected,90)||isProbe&&!safe(c.summary,600)||
  !Array.isArray(c.records)||c.records.length<1||c.records.length>4)throw Error('校准包的问题或记录格式无效');
 addUnique(seen.ids,c.id,'编号');addUnique(seen.questions,norm(c.question),'问题');
 const local=new Map();
 for(const r of c.records){
  if(!keysOnly(r,['id','role','text','corrects'])||!idOK(r.id)||!['user','assistant','tool'].includes(r.role)||!safe(r.text,440)||
   r.corrects!==undefined&&!local.has(r.corrects))throw Error('校准包原记录、来源或更正关系无效');
  addUnique(seen.ids,r.id,'编号');addUnique(seen.texts,norm(r.text),'原文');
  local.set(r.id,r.text);
 }
 if(!Array.isArray(c.requiredIds)||!c.requiredIds.length||new Set(c.requiredIds).size!==c.requiredIds.length||
  !keysOnly(c.requiredQuotes,c.requiredIds)||!c.requiredIds.every(id=>local.has(id)&&safe(c.requiredQuotes[id],180)&&local.get(id).includes(c.requiredQuotes[id])))
  throw Error('校准包每个必需引用都要能回到本题原文');
}
export function validateChallengeGroups(groups,{maxGroups=2}={}){
 if(!Number.isSafeInteger(maxGroups)||maxGroups<0||maxGroups>20)throw Error('校准组数量限制无效');
 if(!Array.isArray(groups)||groups.length>maxGroups)throw Error('额外校准包超出本轮组数上限');
 const seen={ids:new Set(),questions:new Set(),texts:new Set()};
 for(const c of [...builtInGroups.flatMap(g=>[g.probe,g.positive,g.counter]),bankControl]){
  seen.ids.add(c.id);seen.questions.add(norm(c.question));for(const r of c.records){seen.ids.add(r.id);seen.texts.add(norm(r.text));}
 }
 for(const g of groups){
  if(!keysOnly(g,['probe','positive','counter']))throw Error('校准组需提供诊断、正向留出和边界反例');
  checkCase(g.probe,true,seen);checkCase(g.positive,false,seen);checkCase(g.counter,false,seen);
  if(norm(g.positive.expected)===norm(g.counter.expected))throw Error('正向留出与边界反例必须能区分不同答案');
 }
 if(groups.length){
  // Exact duplicates were checked above. Also reject an excerpt smuggled into a longer discovery record or summary.
  const all=[...builtInGroups,...groups];
  const discovery=[...all.map(g=>g.probe),bankControl].flatMap(c=>[c.question,c.summary,...c.records.map(r=>r.text)]).map(norm);
  for(const g of all)for(const test of [g.positive,g.counter]){
   const hiddenQuestion=norm(test.question);
   if(discovery.some(v=>v.includes(hiddenQuestion)))throw Error('发现集已包含未见题目。');
   for(const row of test.records){
    const text=norm(row.text),span=Math.min(18,text.length);
    for(let i=0;i+span<=text.length;i++){
     if(discovery.some(v=>v.includes(text.slice(i,i+span))))throw Error('发现集与未见证据有重复段落。');
    }
   }
  }
 }
 return groups;
}
// Only substrings visibly associated with the same record label can be cited by summary-only readers.
export function citedSpans(text,records){
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
export function collectCases(extraGroups=[]){
 // Two operator-supplied groups and two admitted dynamic groups can be evaluated together.
 // Persisted dynamic banks may be larger, but are rotated through bounded replay batches.
 const groups=[...builtInGroups,...validateChallengeGroups(extraGroups,{maxGroups:4})];
 const diagnostics=[...groups.map(g=>({...g.probe,summaryCitations:citedSpans(g.probe.summary,g.probe.records)})),bankControl];
 return {groups,diagnostics,all:[...diagnostics,...groups.flatMap(g=>[g.positive,g.counter])]};
}
