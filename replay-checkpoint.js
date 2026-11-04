import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const stale=()=>Object.assign(Error('Replay checkpoint no longer belongs to the active calibration'),{checkpointFailure:true,code:'REPLAY_STALE'});

// The host owns the job identity, lease and atomic file replacement. The save callback
// must recheck those under its persistence lock. This helper additionally prevents an
// obsolete async task from even requesting a write, and serializes parallel readers.
export function createReplayCheckpoint({state,save,isCurrent=()=>true,signal}={}){
 if(typeof save!=='function')throw Error('Replay checkpoint requires a persistence callback');
 let current={schema:1,tasks:{},completed:0};
 if(state!==undefined){
  if(state?.schema!==1||!state.tasks||typeof state.tasks!=='object'||Array.isArray(state.tasks))throw Error('Invalid replay checkpoint');
  const tasks=Object.fromEntries(Object.entries(state.tasks).map(([key,task])=>{
   if(!key||!task||!/^[a-f0-9]{64}$/.test(task.inputHash)||!Object.hasOwn(task,'value')||!Number.isFinite(task.completedAt))throw Error('Invalid replay checkpoint task');
   return [key,clone(task)];
  }));
  current={schema:1,tasks,completed:Object.keys(tasks).length};
 }
 let writes=Promise.resolve();const pending=new Map();
 const check=()=>{signal?.throwIfAborted();if(!isCurrent())throw stale();};
 const snapshot=()=>clone(current);
 async function execute(key,inputHash,fn){
  check();const value=await fn();check();
  if(value===undefined)throw Object.assign(Error('Replay checkpoint task returned no result'),{checkpointFailure:true});
  const stored=clone(value);
  const commit=writes.catch(()=>{}).then(async()=>{
   check();
   const next={schema:1,tasks:{...current.tasks,[key]:{inputHash,value:stored,completedAt:Date.now()}}};
   next.completed=Object.keys(next.tasks).length;
   await save(clone(next));check();current=next;
  });
  writes=commit;
  try{await commit;}catch(error){error.checkpointFailure=true;throw error;}
  return clone(stored);
 }
 async function run(key,input,fn){
  check();
  if(typeof key!=='string'||!key||key.length>600||typeof fn!=='function')throw Error('Invalid replay checkpoint operation');
  const inputHash=digest(input),cached=Object.hasOwn(current.tasks,key)?current.tasks[key]:undefined;
  if(cached?.inputHash===inputHash)return clone(cached.value);
  const token=key+'\0'+inputHash;
  if(pending.has(token))return pending.get(token);
  const task=execute(key,inputHash,fn).finally(()=>pending.delete(token));pending.set(token,task);return task;
 }
 return {run,snapshot};
}
