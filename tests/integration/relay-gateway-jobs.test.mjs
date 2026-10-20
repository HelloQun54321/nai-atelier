import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import JSZip from 'jszip';
import sharp from 'sharp';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { cacheNovelAiSubscription, createMediaGateway, estimateNovelAiGenerationCost } from '../../scripts/media-gateway.mjs';

const payload = { model: 'nai-diffusion-5-full', action: 'generate', parameters: { width: 832, height: 1216, steps: 28, n_samples: 1 } };
const paidCost = estimateNovelAiGenerationCost(payload, false, false);
const until = async (read, predicate) => {
  let last;
  for (let index = 0; index < 300; index++) {
    const value = await read();
    last = value;
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('模拟网关后台任务没有进入预期状态：' + JSON.stringify(last));
};

async function fixture(t, { status, member = true, stale = false }) {
  const original = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const key = member ? 'STA1N-batch' : 'pst-batch', authorization = `Bearer ${key}`;
  if (stale) cacheNovelAiSubscription(authorization, { active: true, tier: 3, usage: { percent: 0, isNegative: false } });
  else cacheNovelAiSubscription(authorization, null);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#526781' } }).png().toBuffer();
  const archive = new JSZip(); archive.file('image.png', png);
  const zipped = await archive.generateAsync({ type: 'nodebuffer' });
  let generations = 0, saved = 0, spent = 0;
  const events = [];
  const upstream = mock.get(member ? 'https://gateway.example' : 'https://image.novelai.net');
  const prefix = member ? '/v1' : '';
  const quota = upstream.intercept({ path: prefix + '/user/subscription', method: 'GET' });
  if (status === 'network') quota.replyWithError(new Error('synthetic network failure')).persist();
  else quota.reply(status, '{}').persist();
  upstream.intercept({ path: prefix + '/ai/generate-image', method: 'POST' }).reply(200, () => {
    generations++; return zipped;
  }, { headers: { 'content-type': 'application/zip' } }).persist();
  const worker = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/nai-key-vault/connection') return res.end(JSON.stringify({ gatewayUrl: member ? 'https://gateway.example/v1' : '' }));
    if (req.url === '/api/local-history') return res.end(JSON.stringify({ item: { id: `saved-${++saved}`, imageUrl: '/synthetic.png' } }));
    if (req.url === '/api/local-usage/events') { events.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"inserted":1}'); }
    if (req.url === '/api/anlas-budget/spend') spent++;
    res.end('{"remaining":1000}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  // 历史保存只替换存储边界，检查真实 multipart 与 PNG，避免 MockAgent 的跨版本 FormData 流阻塞。
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input) === `http://127.0.0.1:${worker.address().port}/api/local-history`) {
      assert.ok(options.body instanceof FormData);
      assert.ok((await options.body.get('image').arrayBuffer()).byteLength > 8);
      return new Response(JSON.stringify({ item: { id: `saved-${++saved}`, imageUrl: '/synthetic.png' } }));
    }
    return originalFetch(input, options);
  };
  const gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const request = async (path, method = 'GET', body, extra = {}) => {
    const response = await fetch(base + path, { method, headers: { authorization, 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const token = 'synthetic-relay-batch';
  t.after(async () => {
    await request('/api/generation-job', 'DELETE', undefined, { 'x-nai-generation-task': token }).catch(() => {});
    gateway.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    globalThis.fetch = originalFetch; setGlobalDispatcher(original); await mock.close(); cacheNovelAiSubscription(authorization, null);
  });
  await request('/api/generation-queue/preferences', 'PUT', { generationIntervalSeconds: 0 });
  return {
    events, counts: () => ({ generations, saved, spent }),
    start: approvedCost => request('/api/generation-job', 'POST', { payload, history: { prompt: 'synthetic', params: {} }, approvedCost },
      { 'x-nai-generation-task': token, 'x-nai-generation-count': '3' }),
    read: () => request(`/api/generation-job?token=${token}`),
    approve: () => request('/api/generation-job', 'PATCH', { approvedCost: paidCost }, { 'x-nai-generation-task': token }),
  };
}

for (const status of [404, 405, 501]) test(`成员网关 ${status}：确认保守费用后真实后台任务生成并保存三张`, async t => {
  const f = await fixture(t, { status });
  await f.start(paidCost);
  const result = await until(f.read, value => ['failed', 'succeeded', 'awaiting_confirmation'].includes(value.state));
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  assert.equal(result.completedCount, 3);
  assert.deepEqual(f.counts(), { generations: 3, saved: 3, spent: 0 });
  assert.equal(f.events.length, 3);
  assert.ok(f.events.every(event => event.meta.billingKnown === false && event.amount === 1), '缺少订阅时保留成功张数，费用不能沿用旧快照');
});

test('网关不支持额度接口时丢弃旧免费权益，零费用授权必须等待重新确认', async t => {
  const f = await fixture(t, { status: 404, stale: true });
  await f.start(0);
  const pending = await until(f.read, value => ['failed', 'succeeded', 'awaiting_confirmation'].includes(value.state));
  assert.equal(pending.state, 'awaiting_confirmation'); assert.equal(pending.cost, paidCost);
  assert.deepEqual(f.counts(), { generations: 0, saved: 0, spent: 0 });
  await f.approve();
  const done = await until(f.read, value => ['failed', 'succeeded'].includes(value.state));
  assert.equal(done.state, 'succeeded'); assert.equal(done.completedCount, 3);
  assert.ok(f.events.every(event => event.meta.billingKnown === false));
  assert.equal(f.counts().spent, 0);
});

for (const [status, member] of [[401, true], [403, true], [429, true], [500, true], [502, true], [503, true], ['network', true], [404, false]]) {
  test(`${member ? '成员网关' : '官方直连'} ${status} 仍停止，不发出生图或记账请求`, async t => {
    const f = await fixture(t, { status, member, stale: true });
    await f.start(paidCost);
    const result = await until(f.read, value => value.state === 'failed');
    assert.equal(result.code, 'quota_refresh_failed'); assert.equal(result.completedCount, 0);
    assert.deepEqual(f.counts(), { generations: 0, saved: 0, spent: 0 }); assert.equal(f.events.length, 0);
  });
}
