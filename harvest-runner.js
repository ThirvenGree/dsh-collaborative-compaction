import {createHash,randomUUID} from 'node:crypto';

const hour=3600000,day=24*hour,leaseTime=660000;
export const harvestLimits={sourceChars:120000,daily:4,queued:2,retention:20};
export const emptyHarvest=()=>({schema:1,day:'',attempts:0,nextRetryAt:0,seen:[],last:null,lease:null});
const exact=(s,keys)=>s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).length===keys.length&&keys.every(k=>Object.hasOwn(s,k));
const persistedReasons=new Set([
 '正在核对实际摘要遗漏并提炼脱敏题。','自动学习已关闭，本轮未采用。',
 '脱敏样例已通过审核和回放并入库，等待压缩策略对照验证。','同一来源或同一脱敏题已收录。',
 '脱敏题库已满，本次未新增。','未发现可复现的摘要遗漏。',
 '学习模型暂不可用，保留内存任务，退避后重试。','没有通过遗漏核对、脱敏审核或回放，本次不入库。'
]);
export function validateHarvestState(s){
 if(!exact(s,['schema','day','attempts','nextRetryAt','seen','last','lease'])||s.schema!==1||typeof s.day!=='string'||s.day&&!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s.day)||!Number.isInteger(s.attempts)||s.attempts<0||s.attempts>4||
  !Number.isFinite(s.nextRetryAt)||!Array.isArray(s.seen)||s.seen.length>200||s.seen.some(x=>!exact(x,['key','status','at'])||!/^[a-f0-9]{64}$/.test(x.key)||!['done','retry'].includes(x.status)||!Number.isFinite(x.at))||
  s.lease&&(!exact(s.lease,['id','until'])||!/^[a-f0-9-]{36}$/.test(s.lease.id)||!Number.isFinite(s.lease.until))||
  s.last&&(!exact(s.last,['status','reason','at'])||!['running','cancelled','added','duplicate','full','clean','held','conflict'].includes(s.last.status)||!persistedReasons.has(s.last.reason)||!Number.isFinite(s.last.at)))throw Error('样例学习状态无效');
 return s;
}
const digest=text=>createHash('sha256').update(text).digest('hex');
const dayKey=now=>{const d=new Date(now);return [d.getFullYear(),d.getMonth()+1,d.getDate()].join('-');};

// Sources exist only inside this bounded, transient queue. The persisted record consists of
// hashes, counters and fixed status strings. No model text or provider error is stored here.
export class HarvestRunner{
 constructor({read,mutate,config,process,admit,onAdmit=()=>{},now=Date.now}){
  Object.assign(this,{read,mutate,config,process,admit,onAdmit,now});
  this.queue=[];this.running=null;this.disposed=false;this.lastLocal=null;
 }
 enabled(){const c=this.config();return !this.disposed&&c.enabled&&c.replayHarvestEnabled;}
 status(){
  const s=validateHarvestState(this.read());
  return {enabled:this.enabled(),running:!!this.running,queued:this.queue.length,
   today:{attempts:s.day===dayKey(this.now())?s.attempts:0,limit:harvestLimits.daily},nextRetryAt:s.nextRetryAt,
   last:this.lastLocal||s.last};
 }
 enqueue({content,summary,trigger,eligible=true}){
  if(!eligible||!['manual','tool','auto'].includes(trigger)||!this.enabled())return false;
  if(typeof content!=='string'||typeof summary!=='string'||!content||!summary)return false;
  if(content.length>harvestLimits.sourceChars||summary.length>100000){
   this.lastLocal={at:this.now(),status:'skipped',reason:'历史超过单次样例学习预算，已跳过；没有截断原文进行判断。'};return false;
  }
  const sourceHash=digest(content),summaryHash=digest(summary),key=digest(sourceHash+summaryHash);
  if(this.queue.some(x=>x.key===key)||this.running?.key===key)return false;
  const state=validateHarvestState(this.read()),seen=state.seen.find(x=>x.key===key);
  if(seen?.status==='done')return false;
  if(this.queue.length+(this.running?1:0)>=harvestLimits.queued){
   this.lastLocal={at:this.now(),status:'skipped',reason:'内存中的待学习历史已达上限，本次跳过。'};return false;
  }
  this.queue.push({content,summary,sourceHash,summaryHash,key,at:this.now()});
  void this.pump();return true;
 }
 async pump(){
  if(this.disposed)return;
  if(!this.enabled()){await this.cancel();return;}
  if(this.running)return;
  try{
   if(!this.enabled()){this.queue=[];return;}
   this.queue=this.queue.filter(x=>this.now()-x.at<day);
   const state=validateHarvestState(this.read());
   this.queue=this.queue.filter(x=>!state.seen.some(s=>s.key===x.key&&s.status==='done'));
   const item=this.queue[0];if(!item)return;
   // Reserve before the first await so concurrent ticks cannot start the same in-memory work.
   const id=randomUUID(),abort=new AbortController();this.running={key:item.key,id,abort};
   const claim=await this.mutate(old=>{
    validateHarvestState(old);if(!this.enabled())return null;
    const now=this.now(),count=old.day===dayKey(now)?old.attempts:0;
    if(old.nextRetryAt>now||old.lease?.until>now||count>=harvestLimits.daily||old.seen.some(x=>x.key===item.key&&x.status==='done'))return null;
    return {...old,day:dayKey(now),attempts:count+1,lease:{id,until:now+leaseTime},
     last:{status:'running',at:now,reason:'正在核对实际摘要遗漏并提炼脱敏题。'}};
   });
   if(!claim)return;
   this.queue.shift();this.lastLocal=null;
   const c=this.config(),modelKey=JSON.stringify([c.aProvider,c.aModel,c.reviewModel,c.reviewBase,c.reviewKeyEnv]);
   let outcome;
   try{outcome=await this.process(item,c,abort.signal);}catch{outcome={status:'held',retryable:true};}
   if(this.disposed||abort.signal.aborted||!this.enabled())return;
   const latest=this.config();
   if(JSON.stringify([latest.aProvider,latest.aModel,latest.reviewModel,latest.reviewBase,latest.reviewKeyEnv])!==modelKey){outcome={status:'held'};}
   let admission;
   if(outcome.status==='admitted'){
    // admit executes inside the bank lock and must recheck valid() immediately before writing.
    admission=await this.admit({...outcome,claimId:id,sourceHash:item.sourceHash,summaryHash:item.summaryHash,
     models:{generator:c.aProvider+'/'+c.aModel,reviewer:c.reviewModel}},()=>!this.disposed&&!abort.signal.aborted&&this.enabled()&&
       JSON.stringify([this.config().aProvider,this.config().aModel,this.config().reviewModel,this.config().reviewBase,this.config().reviewKeyEnv])===modelKey);
   }
   if(this.disposed||abort.signal.aborted||!this.enabled())return;
   const status=['added','duplicate','full','clean','held','conflict','cancelled'].includes(admission?.status||outcome.status)?admission?.status||outcome.status:'held';
   const reason=status==='added'?'脱敏样例已通过审核和回放并入库，等待压缩策略对照验证。':
    status==='duplicate'?'同一来源或同一脱敏题已收录。':status==='full'?'脱敏题库已满，本次未新增。':
    status==='clean'?'未发现可复现的摘要遗漏。':outcome.retryable?'学习模型暂不可用，保留内存任务，退避后重试。':'没有通过遗漏核对、脱敏审核或回放，本次不入库。';
   const saved=await this.mutate(old=>{
    if(this.disposed||!this.enabled()||old.lease?.id!==id)return null;
    const now=this.now();return {...old,lease:null,nextRetryAt:outcome.retryable?now+hour:0,
     seen:[...old.seen.filter(x=>x.key!==item.key),{key:item.key,status:outcome.retryable?'retry':'done',at:now}].slice(-200),
     last:{status,reason,at:now}};
   });
   if(saved&&outcome.retryable)this.queue.unshift(item);
   if(saved&&status==='added')this.onAdmit();
  }catch{
   this.lastLocal={status:'unavailable',reason:'无法安全读取或保存样例学习状态，保留现行压缩策略。',at:this.now()};
  }finally{this.running=null;}
 }
 async cancel(){
  this.queue=[];const active=this.running;
  active?.abort.abort(Error('学习已停止'));
  if(active&&!this.disposed)try{await this.mutate(old=>{
   if(this.disposed||old.lease?.id!==active.id)return null;
   return {...old,lease:null,last:{status:'cancelled',at:this.now(),reason:'自动学习已关闭，本轮未采用。'}};
  });}catch{}
 }
 dispose(){this.disposed=true;void this.cancel();}
}
