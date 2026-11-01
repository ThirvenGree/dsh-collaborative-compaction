import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {engineConfigFile} from '../host.js';
test('engine config follows explicit and XDG overrides',()=>{
 const old={BILI_CONFIG_FILE:process.env.BILI_CONFIG_FILE,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME};
 try{
 process.env.BILI_CONFIG_FILE='./custom-config.json';process.env.XDG_CONFIG_HOME='./ignored';assert.equal(engineConfigFile(),path.resolve('./custom-config.json'));
 delete process.env.BILI_CONFIG_FILE;assert.equal(engineConfigFile(),path.join(path.resolve('./ignored'),'billion-context','billion-context.json'));
 delete process.env.XDG_CONFIG_HOME;assert.equal(engineConfigFile(),path.join(os.homedir(),'.config/billion-context/billion-context.json'));
 }finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
