import fs from 'node:fs';
import path from 'node:path';
import {dataRoot} from './runtime.js';
const host=JSON.parse(fs.readFileSync(path.join(dataRoot,'host.json'),'utf8'));
const token=fs.readFileSync(path.join(dataRoot,'local-token'),'utf8').trim();
const response=await fetch('http://127.0.0.1:'+host.port+'/v1/replay',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(620000)});
const report=await response.json();if(!response.ok)throw Error(report.error||'回放请求失败');
console.log(JSON.stringify(report,null,2));
if(report.feedback?.status==='unavailable'||report.probes.some(p=>p.classification==='execution-error'))process.exitCode=1;
