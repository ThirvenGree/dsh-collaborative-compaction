import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderHealth} from '../provider-health.js';
const c={aProvider:'deepseek-account',aModel:'deepseek-flash'};
test('account failure persists across instances, blocks hard pressure, and requires explicit recovery',()=>{
 let state=null;const deps={read:()=>state,write:v=>{state=v;},now:()=>123};
 const first=createProviderHealth(deps);
 first.failure(c,{kind:'error',failure:{status:402,code:'ACCOUNT_QUOTA',message:'Insufficient Balance'}});
 const reloaded=createProviderHealth(deps);
 assert.throws(()=>reloaded.assert({...c,pressure:'hard'}),/摘要 A 已暂停/);
 assert.equal(reloaded.current(c).at,123);
 reloaded.assert({...c,aModel:'another-model'});
 reloaded.clear(c);reloaded.assert(c);assert.equal(reloaded.current(c),null);
});
test('transient errors do not lock accounts; credentials are redacted',()=>{
 let state=null;const h=createProviderHealth({read:()=>state,write:v=>{state=v;}});
 for(const status of [429,500,503])h.failure(c,{failure:{status,message:'retry'}});
 assert.equal(state,null);
 h.failure(c,{failure:{status:401,message:'invalid Bearer secret123 sk-secret123'}});
 assert.ok(!state.message.includes('secret123'));
});
