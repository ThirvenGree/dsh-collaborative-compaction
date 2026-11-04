export const week=7*86400000;
export const retryDelay=86400000;
const positive=n=>Number.isFinite(n)&&n>0;
export function manualBaseline(state){
 if(positive(state.manualBaselineAt))return state.manualBaselineAt;
 // A recorded completed manual check from the older release is still valid authorization.
 const last=state.last;
 return last?.origin==='manual'&&['promoted','held','unchanged'].includes(last.status)&&last.before&&positive(last.at)?last.at:null;
}
export function automaticSchedule(state,kind='auto',now=Date.now(),scope){
 const valid=s=>(!scope||!s?.scope||s.scope===scope)&&(s?.revision===undefined||s.revision===state.revision);
 const job=state.calibration;
 const leaseUntil=state.lease?.until||0;
 const retryAt=valid(job)?state.nextRetryAt||0:0;
 if(job&&valid(job)&&['running','paused','failed'].includes(job.status)){
  const nextAt=Math.max(leaseUntil,retryAt,job.nextAt||0);
  return {ready:now>=nextAt,requiresManual:false,nextAt,phase:job.kind,reason:job.reason||'继续已保存的小批校准进度。'};
 }
 const baseline=valid(state.baseline)?state.baseline?.at:0;
 if(!baseline){
  const nextAt=Math.max(leaseUntil,retryAt);
  return {ready:now>=nextAt,requiresManual:false,nextAt,phase:'bootstrap',reason:'后台分批建立当前策略的三路基线；完成对照验证前不修改策略。'};
 }
 if(state.pendingValidation&&valid(state.pendingValidation)){
  const nextAt=Math.max(leaseUntil,retryAt,state.pendingValidation.nextAt||0);
  return {ready:now>=nextAt,requiresManual:false,nextAt,phase:'validation',reason:'已发现可复现的遗漏，继续提案与独立对照验证。'};
 }
 const completed=kind==='learned'?state.lastLearnedCompletedAt||baseline:state.lastCompletedAt||baseline;
 const regular=completed+(kind==='learned'?86400000:week);
 // A failed scheduled attempt retries after a day, without consuming a full week's slot.
 const pending=state.retryOrigin===kind&&positive(retryAt);
 const nextAt=Math.max(leaseUntil,retryAt,pending?retryAt:regular);
 return {ready:now>=nextAt,requiresManual:false,nextAt,phase:'bootstrap',reason:pending?'上轮技术失败后退避一天再试，失败不消耗每周的完成配额。':'等待下一次小批基线检查窗口。'};
}
export function settleSchedule(old,{origin,completed,now}){
 if(completed)return {...old,lastCompletedAt:now,...(origin==='manual'?{manualBaselineAt:now}:{}),
  ...(origin==='learned'||origin==='manual'?{lastLearnedCompletedAt:now}:{}),nextRetryAt:0,retryOrigin:null};
 return {...old,nextRetryAt:now+retryDelay,retryOrigin:origin};
}
