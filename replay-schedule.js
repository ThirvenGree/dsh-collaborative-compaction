export const week=7*86400000;
export const retryDelay=86400000;
const positive=n=>Number.isFinite(n)&&n>0;
export function manualBaseline(state){
 if(positive(state.manualBaselineAt))return state.manualBaselineAt;
 // A recorded completed manual check from the older release is still valid authorization.
 const last=state.last;
 return last?.origin==='manual'&&['promoted','held','unchanged'].includes(last.status)&&last.before&&positive(last.at)?last.at:null;
}
export function automaticSchedule(state,kind='auto',now=Date.now()){
 const baseline=manualBaseline(state);
 if(!baseline)return {ready:false,requiresManual:true,nextAt:null,reason:'先手动完成一次校准并查看耗时，之后才允许后台自动校准。'};
 const leaseUntil=state.lease?.until||0;
 const retryAt=state.nextRetryAt||0;
 const completed=kind==='learned'?state.lastLearnedCompletedAt||baseline:state.lastCompletedAt||baseline;
 const regular=completed+(kind==='learned'?86400000:week);
 // A failed scheduled attempt retries after a day, without consuming a full week's slot.
 const pending=state.retryOrigin===kind&&positive(retryAt);
 const nextAt=Math.max(leaseUntil,retryAt,pending?retryAt:regular);
 return {ready:now>=nextAt,requiresManual:false,nextAt,reason:pending?'上轮技术失败后退避一天再试，失败不消耗每周的完成配额。':'等待下一次校准窗口。'};
}
export function settleSchedule(old,{origin,completed,now}){
 if(completed)return {...old,lastCompletedAt:now,...(origin==='manual'?{manualBaselineAt:now}:{}),
  ...(origin==='learned'||origin==='manual'?{lastLearnedCompletedAt:now}:{}),nextRetryAt:0,retryOrigin:null};
 return {...old,nextRetryAt:now+retryDelay,retryOrigin:origin};
}
