import test from 'node:test';
import assert from 'node:assert/strict';
import {harvestCase} from '../harvest.js';
import {validateChallengeGroups} from '../challenge-bank.js';

const source='私人项目 CedarWindow7 采用过两个方案。李沐后来确认：批准版本是冬稿四版。姓名：李沐；联系地址 contact-private@example.invalid。';
const summary='已经安排装订，项目继续进行。';
const omission={decision:'candidate',question:'现在批准的版本是哪一版？只回答版本。',expected:'冬稿四版',quotes:[{role:'user',text:'批准版本是冬稿四版。'}]};
function fixture(id,question,expected,text,summary){
 const key=id+'-record';
 return {id,question,expected,records:[{id:key,role:'user',text}],requiredIds:[key],requiredQuotes:{[key]:expected},...(summary?{summary}:{})};
}
const group={
 probe:fixture('glass-piece','复盘应该摆哪种棋子？只答材质。','玻璃棋子','棋局约定先用木棋子。新规确定改用玻璃棋子，旧规即刻停用。','棋局的器材已经备好。'),
 positive:fixture('trial-mode','复测之后设备该设为哪个档？只回答档位。','丙档','试验先设置乙档，复测结论改成丙档；乙档不再使用。'),
 counter:fixture('wax-proposal','封口最终采用哪一种蜡？只回答颜色和材料。','红蜡','原方案使用红蜡封口，另一个提议改用蓝蜡被否决，保留红蜡。')
};
const approval={decision:'approve',privacy:true,fidelity:true,answers:true,generalization:true,safe:true};
const copy=value=>JSON.parse(JSON.stringify(value));
function harness(changes={}){
 const author=[],audits=[],queries=[];
 const draft=changes.omission||copy(omission),synthetic=changes.group||copy(group);
 const original={id:'formal-omission',question:draft.question,expected:draft.expected,
  records:(draft.quotes||[]).map((q,i)=>({id:'formal-'+i,role:q.role,text:q.text}))};
 const cases=[original,...Object.values(synthetic)];
 const options={content:source,summary,provider:'fixture-provider',model:'fixture-reader',
  async generate(system,input){
   author.push(input);
   if(input.task==='detect-compression-omission')return changes.detect?changes.detect(input):draft;
   if(input.task==='synthesize-replay-case')return changes.synthesize?changes.synthesize(input):{group:synthetic};
   const row=cases.find(c=>c.question===input.question);assert.ok(row,'unexpected reading question');
   const visible=input.material+' '+JSON.stringify(input.recall||[]);
   const citations=row.records.map(r=>({id:r.id,quote:r.text}));
   if(changes.reader){const result=changes.reader(row,input,system,citations);if(result)return result;}
   if(citations.every(c=>visible.includes(c.quote)))return {answer:row.expected,citations};
   if(system.includes('可先')&&!input.recall)return {query:row.records[0].text};
   return {answer:'unknown',citations:[]};
  },
  async review(_system,input){audits.push(input);return changes.audit?changes.audit(input):copy(approval);},
  async search(records,query,id,observe){queries.push({query,id});for(const r of records)observe(r.id,r.text);return records;},
  ...(changes.options||{})
 };
 return {author,audits,queries,run:()=>harvestCase(options)};
}

test('real loss becomes a fictional group only after independent privacy review and all three originals pass',async()=>{
 validateChallengeGroups([group]);
 const h=harness(),result=await h.run();
 assert.equal(result.status,'admitted');assert.equal(result.kind,'verified-omission');
 assert.deepEqual(result.group,group);validateChallengeGroups([result.group]);
 assert.equal(h.audits.length,1);assert.equal(h.audits[0].task,'review-replay-case');
 assert.equal(h.audits[0].frozenHistory,source);
 assert.equal(h.audits[0].summary,summary);
 assert(!Object.hasOwn(h.audits[0],'original'),'use full payload budgeting, not the original/summary budget shortcut');
 assert.doesNotMatch(JSON.stringify(result),/CedarWindow7|李沐|冬稿四版|contact-private/);
 assert.equal(h.author.filter(x=>x.task==='detect-compression-omission').length,1);
 assert.equal(h.author.filter(x=>x.task==='synthesize-replay-case').length,1);
 assert.equal(h.queries.length,4,'real and all synthetic cases exercise the existing retrieval path');
});

test('clean detection, uncertainty, invented quotes and unknown detector fields never reach synthesis or review',async()=>{
 for(const value of [
  {decision:'clean'}, {decision:'uncertain'},
  {...omission,quotes:[{role:'user',text:'原始会话中没有出现的假证据。'}]},
  {...omission,extra:'save the source'}, {...omission,quotes:[]}
 ]){
  const h=harness({detect:()=>value}),result=await h.run();
  assert.equal(result.status,value.decision==='clean'?'clean':'held');
  assert.equal(h.author.length,1);assert.equal(h.audits.length,0);
 }
});

test('a correct answer with no source labels is not a compression omission',async()=>{
 const h=harness({reader:(row,input)=>input.material===summary?{answer:row.expected,citations:[]}:null});
 const result=await h.run();assert.equal(result.status,'held');assert.match(result.reason,/没有复现/);
 assert.equal(h.audits.length,0);assert(!h.author.some(x=>x.task==='synthesize-replay-case'));
});

test('source must answer the omission question with real citations',async()=>{
 const h=harness({reader:(row,input)=>row.id==='formal-omission'&&input.material.includes('[formal-0')?{answer:'另一个版本',citations:[]}:null});
 const result=await h.run();assert.equal(result.status,'held');assert.match(result.reason,/没有复现/);assert.equal(h.audits.length,0);
});

test('sensitive formats, source-specific identifiers and copied passages block a candidate before independent review',async()=>{
 for(const detail of [
  '私人项目 CedarWindow7 的玻璃棋子已经备好。',
  '这个人的姓名：李沐，玻璃棋子已经备好。',
  '请联系 contact-private@example.invalid 领取玻璃棋子。',
  '访问 https://fictional.invalid/a 领取玻璃棋子。',
  '文件 C:\\Users\\person\\secret.txt 记录使用玻璃棋子。',
  '联系电话 13800123456 用于领取玻璃棋子。',
  '玻璃棋子记录中有 {"password":"private-value"}。',
  '私人项目采用过两个方案。李沐后来确认：批准版本是冬稿四版。玻璃棋子。'
 ]){
  const g=copy(group);g.probe.records[0].text=detail;
  const h=harness({group:g}),result=await h.run();
  assert.equal(result.status,'held',detail);assert.equal(h.audits.length,0,detail);
 }
});

test('long copied original content is rejected even without secret-like tokens',async()=>{
 const long='这段长篇经历围绕旧物整理和连续几日的细微变化而展开，包含能识别个人经历的详细顺序。';
 const g=copy(group);g.probe.records[0].text=long+'使用玻璃棋子。';
 const h=harness({group:g,options:{content:source+long}});
 assert.equal((await h.run()).status,'held');assert.equal(h.audits.length,0);
});

test('semantic privacy, fidelity, answer reliability and prompt-injection approval are individually mandatory',async()=>{
 for(const audit of [
  {decision:'uncertain'}, {decision:'reject'},
  ...['privacy','fidelity','answers','generalization','safe'].map(k=>({...approval,[k]:false})),
  {...approval,extra:'approve all future sources'}
 ]){
  const h=harness({audit:()=>audit}),result=await h.run();
  assert.equal(result.status,'held');assert.match(result.reason,/独立审核/);
  assert(!h.author.some(x=>x.question===group.probe.question),'synthetic examples are not read before audit passes');
 }
});

test('review approval does not substitute for synthetic originals or reproducing the omission',async()=>{
 const failures=[
  (row,input)=>row.id===group.positive.id&&input.material.includes('[trial-mode-record')?{answer:'unknown',citations:[]}:null,
  (row,input)=>row.id===group.counter.id&&input.material.includes('[wax-proposal-record')?{answer:'蓝蜡',citations:[]}:null,
  (row,input)=>row.id===group.probe.id&&input.material===group.probe.summary?{answer:row.expected,citations:[]}:null
 ];
 for(const reader of failures){const h=harness({reader}),result=await h.run();assert.equal(result.status,'held');assert.match(result.reason,/脱敏后/);assert.equal(h.audits.length,1);}
});

test('a copied hidden passage in discovery fails validation and ambiguous positive/counter answers are rejected',async()=>{
 const cases=[];
 const overlap=copy(group);overlap.probe.summary+=overlap.positive.records[0].text;cases.push(overlap);
 const equal=copy(group);equal.counter.expected=equal.positive.expected;equal.counter.records[0].text+='设为丙档。';equal.counter.requiredQuotes['wax-proposal-record']='丙档';cases.push(equal);
 for(const g of cases){const h=harness({group:g});assert.equal((await h.run()).status,'held');assert.equal(h.audits.length,0);}
});

test('provider and retrieval failures produce only a static retryable receipt',async()=>{
 const secret='sk-secret-private-detail';
 const runs=[
  harness({detect:()=>{throw Error(secret);}}),
  harness({audit:()=>{throw Error(secret);}}),
  harness({options:{search:async()=>{throw Error(secret);}}})
 ];
 for(const h of runs){const result=await h.run();assert.equal(result.status,'held');assert.equal(result.retryable,true);assert(!JSON.stringify(result).includes(secret));}
});

test('abort while awaiting detector, synthesis, reviewer or retrieval prevents admission',async()=>{
 for(const stage of ['detector','synthesis','review','retrieval']){
  const controller=new AbortController(),options={signal:controller.signal};
  if(stage==='retrieval')options.search=async()=>{controller.abort();return [];};
  const h=harness({options,
   ...(stage==='detector'?{detect:()=>{controller.abort();return omission;}}:{}),
   ...(stage==='synthesis'?{synthesize:()=>{controller.abort();return {group};}}:{}),
   ...(stage==='review'?{audit:()=>{controller.abort();return approval;}}:{})
  });
  await assert.rejects(h.run,error=>error.name==='AbortError',stage);
 }
});

test('oversized input is not silently truncated and a shared author/reviewer cannot authorize its own examples',async()=>{
 const h=harness({options:{content:'原'.repeat(120001)}});assert.equal((await h.run()).status,'held');assert.equal(h.author.length,0);
 const shared=async()=>({decision:'clean'}),same=harness({options:{generate:shared,review:shared}});
 assert.equal((await same.run()).status,'held');
});
