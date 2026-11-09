// 2026-11-07 回放题每个任务新出：校验与改名、对照题引用、独立审核、失败兜底，以及与已学题组共用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFreshBase,collectCases,builtinBase,citedSpans} from '../challenge-bank.js';
import {generateFreshBase,freshPrompt,freshReviewPrompt,freshView} from '../fresh-bank.js';

const kase=(id,question,expected,records,required,extra={})=>({id,question,expected,records,requiredIds:Object.keys(required),requiredQuotes:required,...extra});
export function sampleFresh(){
 return {theme:'温室与借书',
  groups:[
   {probe:kase('p1','后续给苗床补光要用哪个灯具编号？只答编号。','lamp_G4',[{id:'a1',role:'tool',text:'温室巡检单：补光改用灯具 lamp_G4，旧灯管停用。'}],{a1:'lamp_G4'},{summary:'温室巡检已完成，补光灯有调整。'}),
    positive:kase('u1','滴灌阀门检修要用哪个扳手型号？只答型号。','wrench_K2',[{id:'b1',role:'tool',text:'工具柜登记：滴灌阀门检修指定扳手 wrench_K2。'}],{b1:'wrench_K2'}),
    counter:kase('c1','花架擦拭需要特殊工具吗？只答是或否。','否',[{id:'d1',role:'user',text:'花架只要用干布擦一遍就行，不用任何专门工具。'}],{d1:'不用任何专门工具'})},
   {probe:kase('p2','按最后的更正，读书会在哪个房间？只答房间号。','三〇二',[{id:'a2',role:'user',text:'读书会先定在一〇五教室。'},{id:'a3',role:'user',text:'更正：读书会挪到三〇二室。',corrects:'a2'}],{a3:'三〇二'},{summary:'读书会地点：一〇五教室。'}),
    positive:kase('u2','按最新通知，旧书交换摊摆在哪个门口？只答门名。','西门',[{id:'b2',role:'user',text:'旧书交换摊原计划摆在东门口。'},{id:'b3',role:'user',text:'刚刚改了：交换摊挪到西门口。',corrects:'b2'}],{b3:'西门'}),
    counter:kase('c2','借阅卡的有效期是多久？只答时长。','一年',[{id:'d2',role:'tool',text:'借阅卡办理后有效期一年，期间没有任何改动。'}],{d2:'有效期一年'})},
   {probe:kase('p3','补订花肥现在应重新下单（submit）、核对订单（verify），还是宣布完成（done）？只答英文。','verify',[{id:'a4',role:'user',text:'可以替温室补订一次花肥。'},{id:'a5',role:'tool',text:'下单按钮已点过一次，商家还没回传订单号。'}],{a5:'还没回传订单号'},{summary:'已获准补订花肥。'}),
    positive:kase('u3','续借申请现在应再提交（submit）、核对状态（verify），还是宣布完成（done）？仅答英文。','verify',[{id:'b4',role:'user',text:'允许替我续借那本园艺书一次。'},{id:'b5',role:'tool',text:'续借请求发出了，馆方系统尚未显示新的到期日。'}],{b5:'尚未显示新的到期日'}),
    counter:kase('c3','还书手续现在是核对中（verify）还是已办结（done）？只答英文。','done',[{id:'d3',role:'tool',text:'图书已归还，馆员在系统里登记了归还时间。'}],{d3:'登记了归还时间'})},
   {probe:kase('p4','叶片发黄的那盆兰花今天该怎么浇水？只答做法。','暂停浇水',[{id:'a6',role:'user',text:'兰花通常每天早上浇一次水。若叶片发黄就暂停浇水，等根部晾干再说。'}],{a6:'暂停浇水'},{summary:'兰花通常每天早上浇一次水。'}),
    positive:kase('u4','阅览室在考试周几点闭馆？只答时间。','晚上十一点',[{id:'b6',role:'tool',text:'阅览室平日九点闭馆，考试周延长到晚上十一点。'}],{b6:'晚上十一点'}),
    counter:kase('c4','普通周二阅览室几点闭馆？只答时间。','九点',[{id:'d4',role:'user',text:'周二不在考试周，阅览室照常在九点关门。'}],{d4:'九点关门'})}
  ],
  control:kase('k1','温室的备用钥匙挂在哪里？只答位置。','门后挂钩',[{id:'e1',role:'tool',text:'温室备用钥匙挂在门后挂钩上。'}],{e1:'门后挂钩'},{summary:'[e1] 温室备用钥匙挂在门后挂钩上。'})};
}

test('a valid fresh base is renamed under fresh- ids and keeps the fixed control id', () => {
 const b=validateFreshBase(sampleFresh());
 assert.equal(b.source,'generated');
 assert.deepEqual(b.groups.map(g=>g.probe.id),['fresh-identifier','fresh-correction','fresh-receipt','fresh-scope']);
 assert.equal(b.groups[1].positive.id,'fresh-correction-unseen');assert.equal(b.groups[1].counter.id,'fresh-correction-boundary');
 const p2=b.groups[1].probe;assert.equal(p2.records[1].corrects,p2.records[0].id,'corrections follow the renamed records');
 assert.ok(p2.requiredIds.every(id=>id.startsWith('fresh-correction-p-')));assert.ok(Object.keys(p2.requiredQuotes).every(id=>p2.requiredIds.includes(id)));
 assert.equal(b.control.id,'adequate-summary-control');
 assert.match(b.control.summary,/^\[fresh-control-r1\] /,'summary labels are renamed with the records');
 assert.ok(b.control.summaryCitations.some(s=>s.quote.includes('门后挂钩')));
});

test('fresh bases that would grade wrongly or leak are rejected', () => {
 const bad=(mut,re)=>{const s=sampleFresh();mut(s);assert.throws(()=>validateFreshBase(s),re);};
 bad(s=>{s.groups.pop();},/4 组/);
 bad(s=>{s.control.summary='温室钥匙有固定位置。';},/对照题的摘要/);
 bad(s=>{s.groups[2].counter.expected='verify';},/不同答案/);
 bad(s=>{s.groups[0].positive.requiredQuotes.b1='wrench_K9';},/必需引用/);
 bad(s=>{s.groups[0].probe.summary+='工具柜登记：滴灌阀门检修指定扳手 wrench_K2。';},/重复段落|未见/);
 // reusing a built-in passage is rejected (the built-in questions stay the published fallback)
 bad(s=>{s.groups[3].counter.records[0].text='实验盒先放东格-14。';s.groups[3].counter.requiredQuotes.d4='东格-14';},/重复/);
});

test('generation: approved suite is used; a rejected review or a dead model falls back to the built-in questions', async () => {
 let reviewed=0;
 const gen=async(prompt)=>{assert.equal(prompt,freshPrompt);return sampleFresh();};
 const ok=await generateFreshBase({generate:gen,review:async(p)=>{reviewed++;assert.equal(p,freshReviewPrompt);return {decision:'approve',answers:true,mechanisms:true,safe:true};}});
 assert.equal(ok.source,'generated');assert.equal(ok.theme,'温室与借书');assert.equal(reviewed,1);
 assert.deepEqual(freshView(ok),{source:'generated',theme:'温室与借书',reason:null,attempts:1,groups:4,mechanisms:['identifier','correction','receipt','scope']});
 const rejected=await generateFreshBase({generate:gen,review:async()=>({decision:'reject',reason:'对照题答案不唯一'})});
 assert.equal(rejected.source,'builtin');assert.match(rejected.reason,/独立审核未通过：对照题答案不唯一/);
 assert.equal(rejected.groups.length,4);assert.equal(rejected.control.id,'adequate-summary-control');
 const dead=await generateFreshBase({generate:async()=>{throw Error('HTTP 402');},review:async()=>({})});
 assert.equal(dead.source,'builtin');assert.match(dead.reason,/402/);
 const same=async()=>sampleFresh();
 assert.equal((await generateFreshBase({generate:same,review:same})).source,'builtin','the reviewer must be independent of the generator');
});

test('budget pauses and lost leases are not swallowed by the fallback', async () => {
 const paused=Object.assign(Error('今日回放预算已用完'),{paused:true});
 await assert.rejects(generateFreshBase({generate:async()=>{throw paused;},review:async()=>({})}),/预算/);
 const stale=Object.assign(Error('stale'),{checkpointFailure:true});
 await assert.rejects(generateFreshBase({generate:async()=>sampleFresh(),review:async()=>{throw stale;}}),/stale/);
});

test('the bank built on a fresh base carries its control and still admits learned groups', () => {
 const b=validateFreshBase(sampleFresh());
 const learned={probe:kase('lp1','冷库的温控旋钮该拨到几档？只答档位。','三档',[{id:'lr1',role:'tool',text:'冷库温控说明：旋钮固定拨到三档。'}],{lr1:'三档'},{summary:'冷库温控有说明。'}),
  positive:kase('lu1','烤箱预热要设到几度？只答温度。','一百八十度',[{id:'lr2',role:'tool',text:'烤箱说明：预热设到一百八十度。'}],{lr2:'一百八十度'}),
  counter:kase('lc1','冰箱门要关紧吗？只答是或否。','是',[{id:'lr3',role:'user',text:'冰箱门每次都要关紧，不然会结霜。'}],{lr3:'都要关紧'})};
 const bank=collectCases([learned],b);
 assert.equal(bank.source,'generated');assert.equal(bank.control.id,'adequate-summary-control');
 assert.deepEqual(bank.diagnostics.map(c=>c.id),['fresh-identifier','fresh-correction','fresh-receipt','fresh-scope','lp1','adequate-summary-control']);
 assert.equal(bank.all.length,6+10);
 // The default (no base) is unchanged: the built-in questions.
 assert.equal(collectCases().diagnostics.at(-1).id,'adequate-summary-control');assert.equal(collectCases().source,'builtin');
 assert.equal(builtinBase.source,'builtin');
 assert.ok(citedSpans(b.control.summary,b.control.records).length>0);
});
