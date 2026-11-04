import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

const accounting=new AsyncLocalStorage();
export const currentCalibrationAccounting=()=>accounting.getStore();
export const withCalibrationAccounting=(budget,fn)=>accounting.run(budget,fn);
const utcDay=at=>new Date(at).toISOString().slice(0,10);
const nextDay=at=>Date.parse(utcDay(at)+'T00:00:00Z')+86400000;
const clone=value=>structuredClone(value);
const nonnegative=value=>Number.isFinite(value)&&value>=0;

export class BudgetPause extends Error {
 constructor(pauseKind,message,nextAt){
  super(message);this.name='BudgetPause';this.code='CALIBRATION_PAUSED';
  this.paused=true;this.stopReplay=true;this.pauseKind=pauseKind;this.nextAt=nextAt;
 }
}

// Providers expose different spellings. Total counts already include reasoning tokens;
// cache details are not added again. Anthropic compaction can report several iterations.
export function usageTokens(usage){
 if(Array.isArray(usage)){
  const values=usage.map(usageTokens);
  return values.length&&values.every(nonnegative)?values.reduce((a,b)=>a+b,0):null;
 }
 if(!usage||typeof usage!=='object')return null;
 if(Array.isArray(usage.iterations))return usageTokens(usage.iterations);
 for(const key of ['total_tokens','totalTokens'])if(nonnegative(usage[key]))return Math.ceil(usage[key]);
 const input=usage.input_tokens??usage.prompt_tokens??usage.inputTokens??usage.promptTokens;
 const output=usage.output_tokens??usage.completion_tokens??usage.outputTokens??usage.completionTokens;
 if(!nonnegative(input)||!nonnegative(output))return null;
 // Anthropic reports cache reads/creation separately from ordinary input tokens.
 const cache=(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0);
 return nonnegative(cache)?Math.ceil(input+output+cache):null;
}

// This is deliberately a conservative reservation, not an invoice or tokenizer claim.
// Known usage releases the difference; missing usage and interrupted attempts stay charged.
export function reservedTokens(input,outputTokens){
 const serialized=typeof input==='string'?input:JSON.stringify(input??{});
 return Buffer.byteLength(serialized,'utf8')+Math.max(1,Math.ceil(outputTokens||8192))+256;
}

export function createCalibrationBudget({config,state={schema:1,days:{}},now=Date.now,persist=async()=>{}}){
 if(state.schema!==1||!state.days||typeof state.days!=='object'||Array.isArray(state.days))throw Error('Invalid calibration budget record');
 let saved=clone(state),queue=Promise.resolve(),sliceCalls=0;
 const startedAt=now();
 for(const day of Object.values(saved.days)){
  if(!day||!['calls','tokens','knownTokens','estimatedTokens','knownRequests','estimatedRequests'].every(k=>Number.isSafeInteger(day[k])&&day[k]>=0)||
   !day.reservations||typeof day.reservations!=='object'||Array.isArray(day.reservations))throw Error('Invalid calibration daily usage');
 }
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const save=async next=>{await persist(clone(next));saved=next;};
 const emptyDay=()=>({calls:0,tokens:0,knownTokens:0,estimatedTokens:0,knownRequests:0,estimatedRequests:0,reservations:{}});
 const snapshot=()=>({schema:1,days:clone(saved.days),day:utcDay(now()),today:clone(saved.days[utcDay(now())]||emptyDay()),
  slice:{startedAt,calls:sliceCalls,elapsedMs:Math.max(0,now()-startedAt)},limits:{sliceCalls:config.replaySliceCalls,dailyCalls:config.replayDailyCalls,dailyTokens:config.replayDailyTokens,sliceMs:config.replaySliceMs}});
 return {
  snapshot,
  begin:input=>serial(async()=>{
   const at=now(),dayKey=utcDay(at),day=saved.days[dayKey]||emptyDay();
   const pauseAt=at+config.replayResumeMinutes*60000;
   if(sliceCalls>=config.replaySliceCalls)throw new BudgetPause('slice-calls','本批模型调用预算已用完，已保存进度，稍后继续。',pauseAt);
   if(at-startedAt>=config.replaySliceMs)throw new BudgetPause('slice-time','本批运行时间已到，已保存进度，稍后继续。',pauseAt);
   if(day.calls>=config.replayDailyCalls)throw new BudgetPause('daily-calls','今日模型调用预算已用完，UTC 次日继续。',nextDay(at));
   const tokens=reservedTokens(input.input,input.outputTokens);
   if(tokens>config.replayDailyTokens)throw new BudgetPause('request-budget','单次请求的保守 token 预留超过每日预算，请提高预算后继续。',null);
   if(day.tokens+tokens>config.replayDailyTokens)throw new BudgetPause('daily-tokens','今日 token 预算不足以预留下一次请求，UTC 次日继续。',nextDay(at));
   const ticket={id:randomUUID(),day:dayKey,tokens,model:String(input.model||'unknown').slice(0,120),at};
   const next=clone(saved),entry=next.days[dayKey]??=emptyDay();
   entry.calls++;entry.tokens+=tokens;entry.estimatedTokens+=tokens;entry.estimatedRequests++;
   entry.reservations[ticket.id]={tokens,at,model:ticket.model};
   // Retain recent daily totals only. Stale reservations remain charged on their day;
   // no process restart turns an uncertain request into free usage.
   for(const key of Object.keys(next.days))if(key<utcDay(at-8*86400000))delete next.days[key];
   await save(next);sliceCalls++;
   return ticket;
  }),
  finish:(ticket,usage)=>serial(async()=>{
   if(!ticket)return;
   const entry=saved.days[ticket.day],reservation=entry?.reservations[ticket.id];
   if(!reservation)return; // An already settled request is never charged twice.
   const next=clone(saved),day=next.days[ticket.day],actual=usageTokens(usage);
   delete day.reservations[ticket.id];
   if(actual!==null){
    day.tokens+=actual-reservation.tokens;day.estimatedTokens-=reservation.tokens;
    day.knownTokens+=actual;day.knownRequests++;day.estimatedRequests--;
   }
   await save(next);
  })
 };
}
