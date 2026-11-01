import {Worker} from 'node:worker_threads';
let worker,sequence=0;const pending=new Map();
export function estimatedTokens(text,signal){
 if(signal?.aborted)return Promise.reject(Error('Tokenization cancelled'));
 if(pending.size>=64)return Promise.reject(Error('Tokenizer queue full'));
 if(!worker){
  const instance=new Worker(new URL('./token-worker.js',import.meta.url),{execArgv:[]});worker=instance;
  const fail=()=>{if(worker===instance)worker=undefined;for(const [id,p]of pending){if(p.worker===instance){pending.delete(id);p.cleanup();p.reject(Error('Tokenizer worker failed'));}}};
  instance.on('error',fail);instance.on('exit',fail);
  instance.on('message',({id,tokens,error})=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.cleanup();if(error)p.reject(Error(error));else p.resolve(tokens);if(!pending.size)instance.unref();});instance.unref();
 }
 const instance=worker;instance.ref();const id=++sequence;
 return new Promise((resolve,reject)=>{
  const cancel=()=>{pending.delete(id);cleanup();if(!pending.size)instance.unref();reject(Error('Tokenization cancelled'));};
  const cleanup=()=>signal?.removeEventListener('abort',cancel);
  pending.set(id,{resolve,reject,cleanup,worker:instance});signal?.addEventListener('abort',cancel,{once:true});
  try{instance.postMessage({id,text});}catch{cancel();}
 });
}
export function createTokenBudget(){
 const cache=new Map();let encoded=0,fastPaths=0;
 return {
  stats:()=>({encoded,fastPaths}),
  async check(parts,limit,outputTokens,signal){
   signal?.throwIfAborted();const reserve=outputTokens+1024;
   // Byte upper bound is only an inexpensive admission fast path, not a rejection rule.
   if(Math.ceil(parts.reduce((n,t)=>n+Buffer.byteLength(t,'utf8'),0)*1.25)+reserve<=limit){fastPaths++;return;}
   let sum=0;
   for(const text of parts){
    let result=cache.get(text);
    if(!result){encoded++;result=estimatedTokens(text,signal);cache.set(text,result);result.catch(()=>cache.delete(text));}
    sum+=await result;
   }
   signal?.throwIfAborted();if(sum+reserve>limit)throw Error('Input exceeds estimated provider context budget; select a smaller history range');
  }
 };
}
