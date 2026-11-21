import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createNovelAiRemoteFetch } from '../../scripts/novelai-generation-network.mjs';
const require = createRequire(import.meta.url);
const { Agent, fetch } = require('undici');
const generation = 'https://image.novelai.net/ai/generate-image';

test('generation uses a new dispatcher on each request', async () => {
  let created = 0, closed = 0;
  class Proxy { constructor() { this.id = ++created; } async close() { closed++; } }
  const ids = [];
  const remote = createNovelAiRemoteFetch({ ProxyAgent: Proxy, proxyUrl: 'http://localhost:7897', requestRemote: async (_, init) => { ids.push(init.dispatcher.id); return Response.json({}); } });
  await remote(generation, { method: 'POST' });
  await remote(generation, { method: 'POST' });
  assert.deepEqual(ids, [1, 2]);
  assert.equal(closed, 2);
});
test('failed generation is never replayed and its dispatcher is destroyed', async () => {
  let calls = 0, destroyed = 0;
  class Proxy { async destroy() { destroyed++; } }
  const remote = createNovelAiRemoteFetch({ ProxyAgent: Proxy, proxyUrl: 'http://localhost:7897', requestRemote: async () => { calls++; throw new TypeError('socket closed'); } });
  await assert.rejects(remote(generation, { method: 'POST' }), /socket closed/);
  assert.equal(calls, 1);
  assert.equal(destroyed, 1);
});
test('subscription retains shared dispatcher', async () => {
  const sharedAgent = {};
  const remote = createNovelAiRemoteFetch({ sharedAgent, proxyUrl: 'proxy', ProxyAgent: class { constructor() { throw new Error('not expected'); } }, requestRemote: async (_, init) => { assert.equal(init.dispatcher, sharedAgent); return Response.json({}); } });
  await remote('https://image.novelai.net/user/subscription', { method: 'GET' });
});
test('graceful dispatcher close preserves a delayed streaming response', async () => {
  const server = createServer((req, res) => { res.writeHead(200); res.write('first'); setTimeout(() => res.end('second'), 25); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const remote = createNovelAiRemoteFetch({ proxyUrl: 'test', ProxyAgent: class { constructor() { return new Agent(); } }, requestRemote: (_, init) => fetch(`http://127.0.0.1:${server.address().port}/`, init) });
    const response = await remote(generation, { method: 'POST', body: 'synthetic' });
    assert.equal(await response.text(), 'firstsecond');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
