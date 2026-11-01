import {parentPort} from 'node:worker_threads';
import {getEncoding} from 'js-tiktoken';
const encoder=getEncoding('o200k_base');
parentPort.on('message',({id,text})=>{try{parentPort.postMessage({id,tokens:Math.ceil(encoder.encode(text,[],[]).length*1.25)});}catch{parentPort.postMessage({id,error:'Tokenization failed'});}});
