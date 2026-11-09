// 2026-11-07：启动竞态——第一次重载找不到在跑的代理时，后台每隔一段时间重试，直到成功或用完次数；其他原因不重试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {retryReloadInBackground,RELOAD_RETRY_REASONS} from '../host.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,ms=3000){const end=Date.now()+ms;while(Date.now()<end){if(check())return true;await wait(10);}return check();}

test('代理记录还是上次的（已退出）时，后台重试到成功为止', async () => {
  let calls=0;const logs=[];
  retryReloadInBackground({delayMs:5,tries:5,log:m=>logs.push(m),reload:async()=>{calls++;return calls<3?{reloaded:false,reason:'recorded proxy is not running'}:{reloaded:true};}});
  assert.ok(await until(()=>logs.length>0));
  assert.equal(calls,3);assert.match(logs.at(-1),/已重载/);
});

test('用完次数就停；不是“没找到代理 / 连不上”的原因不重试；可以取消', async () => {
  let calls=0;const done=[];
  retryReloadInBackground({delayMs:5,tries:3,log:m=>done.push(m),reload:async()=>{calls++;return {reloaded:false,reason:'no running proxy found'};}});
  assert.ok(await until(()=>done.length>0));assert.equal(calls,3);
  let other=0;const otherLog=[];
  retryReloadInBackground({delayMs:5,tries:5,log:m=>otherLog.push(m),reload:async()=>{other++;return {reloaded:false,reason:'HTTP 403'};}});
  assert.ok(await until(()=>otherLog.length>0));assert.equal(other,1);
  let cancelled=0;const stop=retryReloadInBackground({delayMs:50,tries:5,reload:async()=>{cancelled++;return {reloaded:false,reason:'no running proxy found'};}});
  stop();await wait(150);assert.equal(cancelled,0);
  assert.ok(RELOAD_RETRY_REASONS.test('fetch failed'));assert.ok(!RELOAD_RETRY_REASONS.test('proxy origin is not loopback'));
});
