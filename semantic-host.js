import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value??'').digest('hex');
const safeError=error=>String(error?.message??error).replace(/(?:sk-|AIza)[\w-]+/g,'[redacted]').slice(0,400);
export function aggregateSemanticStatus(value){
 if(!Array.isArray(value?.instances))return value;
 const rows=value.instances,latest=[...rows].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
 if(!latest)return null;
 const sum=key=>rows.reduce((n,row)=>n+(Number(row[key])||0),0);
 const modalities={};
 for(const key of ['text','image','audio','video','pdf']){
  modalities[key]={};
  for(const field of ['indexed','pending','failed'])modalities[key][field]=rows.reduce((n,row)=>n+(Number((row.modalities??row.perModality)?.[key]?.[field])||0),0);
 }
 return {...latest,instance:rows.length===1?latest.instance:undefined,instances:rows,
  running:rows.some(row=>row.running&&!row.stale),paused:rows.length>0&&rows.every(row=>row.paused),
  indexed:sum('indexed'),pending:sum('pending'),failed:sum('failed'),requestsToday:sum('requestsToday'),tokensToday:sum('tokensToday'),rejectedStale:sum('rejectedStale'),modalities,
  lastSuccessAt:Math.max(0,...rows.map(row=>Number(row.lastSuccessAt)||0))||null,lastError:rows.find(row=>row.lastError&&!row.stale)?.lastError??latest.lastError??null};
}

// This settings channel only reads status files. It never starts an embedding
// request while rendering or polling the page.
export function createSemanticSettings({loadEngine,keyAvailable=async name=>!!process.env[name],lock=async(_file,fn)=>fn()}){
 let queue=Promise.resolve();
 async function read(schema){
  const file=schema.configPath();
  let raw;
  try{raw=await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const config=schema.validate(raw===undefined?{}:JSON.parse(raw));
  return {file,raw,config,revision:hash(raw)};
 }
 async function snapshot(){
  try{
   const schema=await loadEngine(),saved=await read(schema);
   const status=aggregateSemanticStatus(await schema.loadStatus(saved.file));
   const ready=await keyAvailable(saved.config.keyEnv).catch(()=>false);
   return {config:saved.config,revision:saved.revision,status,keyConfigured:ready,
    health:!ready&&saved.config.enabled?'未配置环境变量 '+saved.config.keyEnv:status?.lastError??null,
    notice:'精确全文索引保留；语义向量由 Google 生成。只索引已选择的会话及搜索时明确指定的目标，不扫描全盘。刷新本页不调用模型。'};
  }catch(error){return {config:null,status:null,health:safeError(error),available:false};}
 }
 function update(input){
  const next=queue.then(async()=>{
   if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid semantic settings request');
   const schema=await loadEngine();
   return lock(schema.configPath(),async()=>{
    const old=await read(schema);
    if(input.action&&input.action!=='save'){
     if(!['pause','resume','retry','rebuild','purge'].includes(input.action))throw Error('Unknown semantic action');
     await schema.control(input.action,old.file,input.instance);
     return snapshot();
    }
    if(input.revision!==old.revision)throw Error('语义设置已被其他窗口修改，请刷新后保存');
    if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw Error('Invalid semantic changes');
    const allowed=new Set(Object.keys(schema.defaults));
    for(const key of Object.keys(input.changes))if(!allowed.has(key))throw Error('Unknown semantic setting: '+key);
    const config=schema.validate({...old.config,...input.changes});
    let current;
    try{current=await fs.readFile(old.file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(hash(current)!==old.revision)throw Error('语义设置已改变，请重新保存');
    await fs.mkdir(path.dirname(old.file),{recursive:true});
    const temporary=old.file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});await fs.rename(temporary,old.file);}
    finally{await fs.rm(temporary,{force:true});}
    return snapshot();
   });
  });
  queue=next.catch(()=>{});
  return next;
 }
 return {snapshot,update};
}

export function localSettingsRequest(req){
 const host=req.headers.host||'',origin=req.headers.origin;
 return /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)&&Number(host.slice(host.lastIndexOf(':')+1))===req.socket.localPort&&req.headers['sec-fetch-site']!=='cross-site'&&(!origin||origin===`http://${host}`);
}
