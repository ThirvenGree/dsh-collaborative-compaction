import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateChallengeGroups} from './challenge-bank.js';

export const dynamicBankFile='learned-replay-cases.json';
export const dynamicBankLimit=20;
const maxBytes=512*1024;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const timestamp=x=>Number.isSafeInteger(x)&&x>=0;
const normalized=x=>String(x).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const blank=()=>({schema:1,revision:0,updatedAt:0,entries:[]});

// The case's own arbitrary labels never become a persistent source identifier. Identity is
// derived from its synthetic contents, so renaming labels cannot evade duplicate detection.
function canonicalCase(c){
 const ids=new Map(c.records.map((r,i)=>[r.id,i]));
 const record=(r)=>({role:r.role,text:normalized(r.text),...(r.corrects!==undefined?{corrects:ids.get(r.corrects)}:{})});
 const labels=text=>text.replace(/\[([A-Za-z][\w-]*)\]/g,(whole,id)=>ids.has(id)?'[row'+ids.get(id)+']':whole);
 return {question:normalized(c.question),expected:normalized(c.expected),records:c.records.map(record),
  required:c.requiredIds.map(id=>({index:ids.get(id),quote:normalized(c.requiredQuotes[id])})).sort((a,b)=>a.index-b.index),
  ...(c.summary!==undefined?{summary:normalized(labels(c.summary))}:{})};
}
function groupDigest(group){return hash(['probe','positive','counter'].map(k=>canonicalCase(group[k])));}
function namespaceGroup(group,digest){
 const prefix='learn-'+digest.slice(0,24),out={};
 for(const [name,tag]of [['probe','p'],['positive','u'],['counter','c']]){
  const c=group[name],base=prefix+'-'+tag,ids=new Map(c.records.map((r,i)=>[r.id,base+'-r'+(i+1)]));
  const labels=text=>text.replace(/\[([A-Za-z][\w-]*)\]/g,(whole,id)=>ids.get(id)?'['+ids.get(id)+']':whole);
  out[name]={id:base,question:c.question,expected:c.expected,
   records:c.records.map(r=>({id:ids.get(r.id),role:r.role,text:r.text,...(r.corrects!==undefined?{corrects:ids.get(r.corrects)}:{})})),
   requiredIds:c.requiredIds.map(id=>ids.get(id)),requiredQuotes:Object.fromEntries(c.requiredIds.map(id=>[ids.get(id),c.requiredQuotes[id]])),
   ...(name==='probe'?{summary:labels(c.summary)}:{})};
 }
 return out;
}
function checkModels(models){
 if(!exact(models,['generator','reviewer'])||Object.values(models).some(s=>typeof s!=='string'||s.length<1||s.length>160||
  !/^[A-Za-z0-9_.:/-]+$/.test(s)||s.includes('://')||/(?:sk-|AIza|Bearer|password|token)/i.test(s)))throw Error('动态题库模型标识无效');
 return {generator:models.generator,reviewer:models.reviewer};
}
function checked(state){
 if(!exact(state,['schema','revision','updatedAt','entries'])||state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||
  !timestamp(state.updatedAt)||!Array.isArray(state.entries)||state.entries.length>dynamicBankLimit)throw Error('动态题库结构无效');
 const ids=new Set(),sources=new Set();
 for(const e of state.entries){
  if(!exact(e,['id','digest','sourceHash','summaryHash','createdAt','testedAt','models','group'])||!isHash(e.digest)||!isHash(e.sourceHash)||!isHash(e.summaryHash)||
   !timestamp(e.createdAt)||!timestamp(e.testedAt)||e.id!=='learn-'+e.digest.slice(0,24)||ids.has(e.id)||sources.has(e.sourceHash+e.summaryHash))throw Error('动态题库登记无效');
  checkModels(e.models);validateChallengeGroups([e.group]);
  if(groupDigest(e.group)!==e.digest||JSON.stringify(namespaceGroup(e.group,e.digest))!==JSON.stringify(e.group))throw Error('动态题库内容摘要不匹配');
  ids.add(e.id);sources.add(e.sourceHash+e.summaryHash);
 }
 // Enforce withheld/discovery isolation across the whole archive, not only the next batch.
 validateChallengeGroups(state.entries.map(e=>e.group),{maxGroups:dynamicBankLimit});
 return state;
}
function contentDigest(state){
 // Rotation metadata is not evidence. Marking a batch tested must not invalidate an otherwise
// identical in-flight validation, while adding/removing/changing an admitted group must.
 return hash(state.entries.map(({testedAt,...entry})=>entry));
}
export function loadDynamicBank(root){
 const filename=path.join(root,dynamicBankFile);
 let descriptor;
 try{
  descriptor=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK||0));
  const stat=fs.fstatSync(descriptor);
  if(!stat.isFile()||stat.size<1||stat.size>maxBytes)throw Error('动态题库须为不超过 512 KiB 的普通文件');
  const buffer=Buffer.alloc(stat.size);let received=0;
  while(received<buffer.length){const n=fs.readSync(descriptor,buffer,received,buffer.length-received,null);if(!n)throw Error('动态题库读取期间发生变化');received+=n;}
  const extra=Buffer.alloc(1);if(fs.readSync(descriptor,extra,0,1,null)!==0)throw Error('动态题库读取期间发生变化');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{throw Error('动态题库不是有效的 UTF-8 JSON');}
  return checked(value);
 }catch(error){if(error.code==='ENOENT')return blank();throw error;}
 finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function save(root,state){
 checked(state);
 const filename=path.join(root,dynamicBankFile),temp=filename+'.'+randomUUID()+'.tmp';
 const data=Buffer.from(JSON.stringify(state,null,2));if(data.length>maxBytes)throw Error('动态题库超过容量上限');
 fs.mkdirSync(root,{recursive:true});
 try{fs.writeFileSync(temp,data,{mode:0o600,flag:'wx'});fs.renameSync(temp,filename);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return state;
}
export function addDynamicCase(root,{group,sourceHash,summaryHash,models,now=Date.now()}){
 if(!isHash(sourceHash)||!isHash(summaryHash)||!timestamp(now))throw Error('动态题库来源登记无效');
 checkModels(models);validateChallengeGroups([group]);
 const state=loadDynamicBank(root),digest=groupDigest(group),id='learn-'+digest.slice(0,24);
 const duplicate=state.entries.find(e=>e.digest===digest||e.sourceHash===sourceHash&&e.summaryHash===summaryHash);
 if(duplicate)return {status:'duplicate',id:duplicate.id,state,digest:contentDigest(state)};
 if(state.entries.length>=dynamicBankLimit)return {status:'full',state,digest:contentDigest(state)};
 const entry={id,digest,sourceHash,summaryHash,createdAt:now,testedAt:0,models:checkModels(models),group:namespaceGroup(group,digest)};
 // Do not admit material overlapping an existing group's hidden evidence. Collision does not
// modify the prior archive, and a model can propose a different synthetic scenario next time.
 try{validateChallengeGroups([...state.entries.map(e=>e.group),entry.group],{maxGroups:dynamicBankLimit});}
 catch{return {status:'conflict',state,digest:contentDigest(state)};}
 const next=save(root,{...state,revision:state.revision+1,updatedAt:now,entries:[...state.entries,entry]});
 return {status:'added',id,state:next,digest:contentDigest(next)};
}
export function selectDynamicCases(root,{manualGroups=[],limit=2}={}){
 if(!Number.isSafeInteger(limit)||limit<0||limit>2)throw Error('每轮动态题库最多两组');
 validateChallengeGroups(manualGroups);
 const state=loadDynamicBank(root),selected=[];let skipped=0;
 const order=[...state.entries].sort((a,b)=>a.testedAt-b.testedAt||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
 for(const entry of order){
  if(selected.length>=limit)break;
  try{validateChallengeGroups([...manualGroups,...selected.map(e=>e.group),entry.group],{maxGroups:4});selected.push(entry);}
  catch{skipped++;}
 }
 return {groups:selected.map(e=>e.group),ids:selected.map(e=>e.id),digest:contentDigest(state),revision:state.revision,total:state.entries.length,skipped};
}
export function markDynamicCasesTested(root,ids,now=Date.now()){
 if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!timestamp(now))throw Error('动态题库回放登记无效');
 const state=loadDynamicBank(root),existing=new Set(state.entries.map(e=>e.id));
 if(!ids.every(id=>existing.has(id)))throw Error('动态题库回放版本已变化');
 if(!ids.length)return state;
 return save(root,{...state,revision:state.revision+1,updatedAt:now,entries:state.entries.map(e=>ids.includes(e.id)?{...e,testedAt:Math.max(e.testedAt,now)}:e)});
}
export function clearDynamicBank(root,now=Date.now()){
 if(!timestamp(now))throw Error('动态题库清理时间无效');
 const state=loadDynamicBank(root);
 return save(root,{schema:1,revision:state.revision+1,updatedAt:now,entries:[]});
}
