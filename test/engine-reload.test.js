import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {reloadEngineProxy, priorHostGone} from '../host.js';

const tempState = origin => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-state-'));
  if (origin !== undefined) fs.writeFileSync(path.join(dir, 'proxy-origin'), JSON.stringify({origin, pid: process.pid, launchToken: 'not-sent'}));
  return dir;
};

test('asks the running proxy to reload its config through the loopback endpoint', async t => {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push({method: req.method, url: req.url, auth: req.headers.authorization}); res.writeHead(200); res.end('{}'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const dir = tempState(`http://127.0.0.1:${server.address().port}`);
  const result = await reloadEngineProxy({stateDirectory: dir});
  assert.equal(result.reloaded, true);
  assert.deepEqual(seen, [{method: 'POST', url: '/__bili/config/reload', auth: undefined}], 'one POST, no credentials');
});

test('reports, without throwing, when no proxy is recorded or it refuses', async t => {
  assert.deepEqual(await reloadEngineProxy({stateDirectory: tempState()}), {reloaded: false, reason: 'no running proxy found'});
  const server = http.createServer((req, res) => { res.writeHead(403); res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const refused = await reloadEngineProxy({stateDirectory: tempState(`http://127.0.0.1:${server.address().port}`)});
  assert.deepEqual(refused, {reloaded: false, reason: 'HTTP 403'});
});

test('a kept configuration from a finished run can be taken over even if its port is now in use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-host-'));
  const hostFile = path.join(dir, 'host.json');
  fs.writeFileSync(hostFile, JSON.stringify({port: 61373, pid: 999999, at: 1, protocol: 2}));
  assert.equal(priorHostGone('http://127.0.0.1:61373/v1', hostFile, () => false), true, 'previous run exited');
  assert.equal(priorHostGone('http://127.0.0.1:61373/v1', hostFile, () => true), false, 'previous run still alive');
  assert.equal(priorHostGone('http://127.0.0.1:50000/v1', hostFile, () => false), false, 'different port: no claim');
  fs.writeFileSync(hostFile, JSON.stringify({port: 61373, pid: process.pid}));
  assert.equal(priorHostGone('http://127.0.0.1:61373/v1', hostFile, () => false), false, 'same process is never treated as gone');
  assert.equal(priorHostGone('http://127.0.0.1:61373/v1', path.join(dir, 'missing.json')), false);
});

test('never calls a non-loopback origin or a proxy whose process is gone', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return {ok: true}; };
  assert.equal((await reloadEngineProxy({stateDirectory: tempState('http://192.168.1.5:18787'), fetchImpl})).reason, 'proxy origin is not loopback');
  assert.equal((await reloadEngineProxy({stateDirectory: tempState('http://127.0.0.1:18787'), fetchImpl, isAlive: () => false})).reason, 'recorded proxy is not running');
  assert.equal(calls, 0);
});
