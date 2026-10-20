import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { normalizeNaiGatewayUrl, resolveNaiGatewayUrl, validateNaiApiKey } from '../../worker/naiConnection.mjs';
import { fetchNovelAiSubscription, readNaiGatewayUrl, sanitizeNovelAiSubscription, createMediaGateway, toCachedPreciseReferenceParameters, isSubscriptionUnsupported, getVibeCacheSecretKey, cacheNovelAiSubscription, estimateNovelAiGenerationCost } from '../../scripts/media-gateway.mjs';
import sharp from 'sharp';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

test('成员网关地址保留部署前缀，兼容根地址与完整接口地址', () => {
  for (const prefix of ['https://gateway.example', 'https://gateway.example/v1', 'http://127.0.0.1:8199/prefix']) {
    for (const suffix of ['', '/', '/ai/generate-image/', '/ai/generate-image-stream', '/ai/encode-vibe', '/user/subscription']) {
      assert.equal(normalizeNaiGatewayUrl(` ${prefix}${suffix} `), prefix);
    }
  }
  for (const value of ['broken', 'ftp://gateway.example', 'https://user:secret@gateway.example',
    'https://gateway.example?key=synthetic', 'https://gateway.example#fragment', {}, 'https://gateway.example/' + 'a'.repeat(2048)]) {
    assert.throws(() => normalizeNaiGatewayUrl(value));
  }
});

test('Key 接入按条目隔离，旧官方 Key 保持官方，未配置成员 Key 与损坏地址不能回退', () => {
  const entries = [{ key: 'STA1N-synthetic', gatewayUrl: 'https://gateway.example/v1/ai/generate-image' }, { key: 'pst-official' }];
  assert.equal(resolveNaiGatewayUrl('Bearer STA1N-synthetic', entries), 'https://gateway.example/v1');
  assert.equal(resolveNaiGatewayUrl('Bearer pst-official', entries), '');
  assert.equal(resolveNaiGatewayUrl('Bearer pst-unsaved', entries), '');
  assert.throws(() => resolveNaiGatewayUrl('Bearer STA1N-missing', entries), { status: 400 });
  assert.throws(() => resolveNaiGatewayUrl('Bearer pst-broken', [{ key: 'pst-broken', gatewayUrl: 'invalid' }]), { status: 400 });
  for (const key of ['STA1N-unsafe\nvalue', 'member key', '成员', 'x'.repeat(4097)]) assert.throws(() => validateNaiApiKey(key, 'https://gateway.example'));
});

test('电脑接入查询只转发所选 Key，保留拒绝状态，不读取完整保管箱', async () => {
  const worker = createServer((req, res) => {
    assert.equal(req.url, '/api/nai-key-vault/connection');
    if (req.headers.authorization === 'Bearer STA1N-synthetic') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
    res.writeHead(400); res.end('{"error":"成员 Key 需网关地址"}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  const req = key => ({ headers: { authorization: `Bearer ${key}` }, socket: { remoteAddress: '127.0.0.1' } });
  try {
    assert.equal(await readNaiGatewayUrl(req('STA1N-synthetic'), worker.address().port), 'https://gateway.example/v1');
    await assert.rejects(readNaiGatewayUrl(req('STA1N-missing'), worker.address().port), { status: 400 });
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

test('成员余额查询用同一网关与 Key，禁止重定向；官方地址与响应形状保留', async () => {
  const payload = { active: true, tier: 3, usage: { percent: 12, isNegative: false, timeUntilNextPercent: 100 },
    trainingStepsLeft: { fixedTrainingStepsLeft: 80, purchasedTrainingSteps: 20 }, paymentProcessorData: { secret: 'synthetic' } };
  for (const gatewayUrl of ['', 'https://gateway.example/v1']) {
    let calls = 0;
    const authorization = gatewayUrl ? 'Bearer STA1N-synthetic' : 'Bearer pst-synthetic';
    const response = await fetchNovelAiSubscription(authorization, undefined, async (url, options) => {
      calls++; assert.equal(url, `${gatewayUrl || 'https://image.novelai.net'}/user/subscription`);
      assert.equal(options.headers.Authorization, authorization);
      assert.equal(options.redirect, gatewayUrl ? 'error' : undefined);
      return new Response(JSON.stringify(payload));
    }, gatewayUrl);
    const clean = sanitizeNovelAiSubscription(await response.json(), gatewayUrl);
    assert.deepEqual(clean.trainingStepsLeft, payload.trainingStepsLeft);
    assert.equal(clean.usage.percent, 12); assert.equal(clean.paymentProcessorData, undefined);
    assert.equal(clean.source, gatewayUrl ? 'gateway' : undefined); assert.equal(calls, 1);
  }
});

test('电脑实际 HTTP 入口连接成员 Key、生图、余额与 Vibe；无地址成员 Key 拒绝，官方仍直连', async () => {
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const calls = [];
  const member = mock.get('https://gateway.example'), official = mock.get('https://image.novelai.net');
  const subscription = { active: true, tier: 3, usage: { percent: 5, isNegative: false, timeUntilNextPercent: 0 }, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0 } };
  for (const [pool, prefix, key] of [[member, '/v1', 'STA1N-http'], [official, '', 'pst-http']]) {
    pool.intercept({ path: `${prefix}/user/subscription`, method: 'GET' }).reply(200, options => {
      assert.ok(JSON.stringify(options.headers).includes(`Bearer ${key}`)); calls.push(options.path); return JSON.stringify(subscription);
    }, { headers: { 'content-type': 'application/json' } });
  }
  member.intercept({ path: '/v1/ai/generate-image', method: 'POST' }).reply(200, options => {
    const body = JSON.parse(options.body); assert.equal(body.model, 'nai-diffusion-5-full-medium');
    assert.equal(body.parameters.stream, undefined); calls.push(options.path); return 'synthetic-zip';
  }, { headers: { 'content-type': 'application/zip' } }).times(2);
  member.intercept({ path: '/v1/ai/encode-vibe', method: 'POST' }).reply(200, Buffer.alloc(128, 2));
  const worker = createServer((req, res) => {
    if (req.url === '/api/nai-key-vault/connection') {
      const key = req.headers.authorization;
      if (key === 'Bearer STA1N-http') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
      if (key === 'Bearer pst-http') return res.end('{"gatewayUrl":""}');
      res.writeHead(400); return res.end('{"error":"成员 Key 需网关地址"}');
    }
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/vibes/http-vibe') return res.end('{"item":{"id":"http-vibe","encodings":[]}}');
    if (req.url.endsWith('/encoding-result')) return res.end('{"item":{"id":"http-encoding"}}');
    res.end('{"remaining":1666}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, key, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const balance = await request('/api/novelai-subscription', 'STA1N-http');
    assert.equal(balance.status, 200); assert.equal((await balance.json()).source, 'gateway');
    const officialBalance = await request('/api/novelai-subscription', 'pst-http');
    assert.equal(officialBalance.status, 200); assert.equal((await officialBalance.json()).source, undefined);
    await fetch(base + '/api/generation-queue/preferences', { method: 'PUT', headers: { Authorization: 'Bearer STA1N-http', 'Content-Type': 'application/json' }, body: '{"generationIntervalSeconds":0}' });
    for (const path of ['/api/generate', '/api/generate-stream']) {
      const response = await request(path, 'STA1N-http', { model: 'nai-diffusion-5-full-medium', action: 'generate', parameters: { width: 832, height: 1216, steps: 14, stream: true } });
      assert.equal(response.status, 200, await response.clone().text()); assert.equal(await response.text(), 'synthetic-zip');
    }
    const encoded = await request('/api/vibes/http-vibe/encodings', 'STA1N-http', { informationExtracted: 1 });
    assert.equal(encoded.status, 200, await encoded.clone().text()); assert.equal((await encoded.json()).item.id, 'http-encoding');
    const rejected = await request('/api/generate', 'STA1N-missing', { model: 'nai-diffusion-5-full-medium', parameters: {} });
    assert.equal(rejected.status, 400); assert.equal(calls.filter(path => path.endsWith('/ai/generate-image')).length, 2);
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
  }
});

test('第三方网关的精确参考改写为附原图的缓存形式，官方直连保持原始字段', async () => {
  const parameters = { director_reference_images: ['aGVsbG8=', 'd29ybGQ='], director_reference_strength_values: [0.6, 0.6] };
  toCachedPreciseReferenceParameters(parameters);
  assert.equal(parameters.director_reference_images, undefined);
  assert.deepEqual(parameters.director_reference_images_cached, ['aGVsbG8=', 'd29ybGQ='].map(data => ({ cache_secret_key: getVibeCacheSecretKey(data), data })));
  assert.deepEqual(parameters.director_reference_strength_values, [0.6, 0.6]);
  for (const empty of [{}, { director_reference_images: [] }]) assert.deepEqual(toCachedPreciseReferenceParameters({ ...empty }), empty);

  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const bodies = {};
  const events = [];
  mock.get('https://gateway.example').intercept({ path: '/v1/ai/generate-image', method: 'POST' }).reply(200, options => { bodies.gateway = JSON.parse(options.body).parameters; return 'synthetic-zip'; }, { headers: { 'content-type': 'application/zip' } });
  mock.get('https://image.novelai.net').intercept({ path: '/ai/generate-image', method: 'POST' }).reply(200, options => { bodies.official = JSON.parse(options.body).parameters; return 'synthetic-zip'; }, { headers: { 'content-type': 'application/zip' } });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#38bdf8' } }).png().toBuffer();
  const worker = createServer(async (req, res) => {
    if (req.url === '/api/nai-key-vault/connection') return res.end(req.headers.authorization === 'Bearer STA1N-ref' ? '{"gatewayUrl":"https://gateway.example/v1"}' : '{"gatewayUrl":""}');
    if (req.url === '/api/character-references/ref-1/image') { res.setHeader('etag', '"synthetic"'); return res.end(reference); }
    if (req.url === '/api/local-usage/events') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      events.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"inserted":1}');
    }
    res.setHeader('content-type', 'application/json'); res.end('{"remaining":1666}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const key of ['STA1N-ref', 'pst-ref']) {
      cacheNovelAiSubscription('Bearer ' + key, { active: true, tier: 3 });
      await fetch(base + '/api/generation-queue/preferences', { method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{"generationIntervalSeconds":0}' });
      const response = await fetch(base + '/api/generate', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { width: 832, height: 1216, steps: 23,
        _local_character_references: { enabled: true, slots: [{ assetId: 'ref-1', type: 'character', strength: 0.6, fidelity: 0.6 }] } } }) });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('x-nai-anlas-accounting-failed'), null);
      const expectedCost = estimateNovelAiGenerationCost({ model: 'nai-diffusion-4-5-full',
        parameters: { width: 832, height: 1216, steps: 23, director_reference_images_cached: [{}] } }, false, true);
      assert.equal(Number(response.headers.get('x-nai-anlas-estimated-spent')), expectedCost);
    }
    assert.equal(bodies.gateway.director_reference_images, undefined);
    assert.equal(bodies.gateway.director_reference_images_cached.length, 1);
    assert.match(bodies.gateway.director_reference_images_cached[0].cache_secret_key, /^[a-f0-9]{64}$/);
    assert.ok(bodies.gateway.director_reference_images_cached[0].data.length > 100, '网关请求必须附带原图数据');
    assert.equal(bodies.gateway.director_reference_descriptions.length, 1);
    assert.equal(bodies.official.director_reference_images_cached, undefined);
    assert.equal(bodies.official.director_reference_images.length, 1);
    assert.equal(bodies.official.director_reference_images[0], bodies.gateway.director_reference_images_cached[0].data);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.meta.billingKnown && event.value > 0 && event.amount === 1));
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
    for (const key of ['STA1N-ref', 'pst-ref']) cacheNovelAiSubscription('Bearer ' + key, null);
  }
});

test('只有第三方网关明确没有额度接口时才视为额度未知，官方与鉴权／服务错误仍按失败处理', () => {
  for (const status of [404, 405, 501, '404']) assert.equal(isSubscriptionUnsupported('https://gateway.example/v1', status), true);
  for (const status of [200, 401, 403, 429, 500, 502, 503]) assert.equal(isSubscriptionUnsupported('https://gateway.example/v1', status), false);
  assert.equal(isSubscriptionUnsupported('', 404), false);
});
