import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../client.js',import.meta.url),'utf8');
function render(value){
 let hook=0,requests=0;const nodes=[];
 const draft=Object.fromEntries(Object.entries(value.config||{}).map(([k,v])=>[k,Array.isArray(v)?v.join('\n'):typeof v==='number'?String(v):v]));
 const states=[value,draft,'',false,''];
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState:v=>[hook<states.length?states[hook++]:v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{}};
 const sandbox={window:{__ModuleLoader__:{load:def=>def.factory(()=>react)}},fetch:()=>{requests++;throw Error('Render must be read only');},setTimeout,clearTimeout,setInterval,clearInterval,URL};
 vm.runInNewContext(source.replace("return {inject:['slots']","globalThis.__semantic=Semantic;return {inject:['slots']"),sandbox);
 function visit(node){
  if(node==null||typeof node==='boolean')return '';
  if(Array.isArray(node))return node.map(visit).join(' ');
  if(typeof node!=='object')return String(node);
  if(typeof node.type==='function')return visit(node.type({...node.props,children:node.children}));
  nodes.push(node);return node.children.map(visit).join(' ');
 }
 return {text:visit(sandbox.__semantic({active:true})),nodes,requests};
}
test('five modalities, independent controls and actual pending counts remain visible without model calls',()=>{
 const result=render({config:{enabled:true,mediaEnabled:true,dimensions:1536,keyEnv:'GEMINI_API_KEY',model:'gemini-embedding-2',selectedSessions:[],allowedMediaRoots:[],mediaMaxSeconds:60},keyConfigured:true,
  status:{indexed:4,pending:3,failed:1,phase:'indexing',running:true,updatedAt:Date.now(),modalities:{text:{indexed:1},image:{indexed:1},audio:{indexed:1},video:{pending:2},pdf:{indexed:1,failed:1}},requestsToday:12,tokensToday:123}});
 for(const label of ['文本经历','图片原件','音频片段','视频画面','PDF 页面','12 / 123','暂停队列','恢复处理','重试失败项','重建派生索引'])assert.ok(result.text.includes(label),label);
 // Counts are shown as stat tiles: label followed by its number.
 assert.match(result.text,/已索引 4 待处理 3 失败 1/);
 assert.match(result.text,/与协作压缩的总开关独立/);assert.match(result.text,/不会遍历整个目录/);assert.equal(result.requests,0);
});
test('missing engine or old heartbeat never claims a completed index',()=>{
 const old=render({config:{enabled:true},status:{running:true,updatedAt:Date.now()-600000,phase:'indexing',pending:9}});
 assert.match(old.text,/最近状态已过期/);assert.match(old.text,/已索引 0 待处理 9 失败 0/);
 const unavailable=render({config:null,health:'引擎模块缺失'});assert.match(unavailable.text,/等待引擎/);assert.match(unavailable.text,/引擎模块缺失/);
});
test('provider payment errors explain the cause and keep the raw message',()=>{
 const r=render({config:{enabled:true},keyConfigured:true,health:'Embedding provider HTTP 402',status:{indexed:2,pending:5,failed:3,updatedAt:Date.now()}});
 assert.match(r.text,/Gemini 预付余额不足/);assert.match(r.text,/重试失败项/);assert.match(r.text,/Embedding provider HTTP 402/);
 assert.ok(r.nodes.some(n=>n.props.role==='alert'));assert.equal(r.requests,0);
});
test('unchanged settings do not show the save bar',()=>{
 const r=render({config:{enabled:true,model:'gemini-embedding-2'},keyConfigured:true,status:{updatedAt:Date.now()}});
 assert.ok(!r.nodes.some(n=>String(n.props.className||'').includes('dcc-bar')));
});
