import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { normalizeNaiGatewayUrl, resolveNaiGatewayUrl, validateNaiApiKey } from '../../worker/naiConnection.mjs';
import { fetchGatewayMemberQuota, fetchNovelAiSubscription, readNaiGatewayUrl, sanitizeNovelAiSubscription, selectBackendPoolMember, createMediaGateway, toCachedPreciseReferenceParameters, isSubscriptionUnsupported, getVibeCacheSecretKey, cacheNovelAiSubscription, estimateNovelAiGenerationCost, parseNovelAiMsgpackStream } from '../../scripts/media-gateway.mjs';
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
  }, { headers: { 'content-type': 'application/zip' } });
  // 成员网关同样提供流式端点：预览入口走它自己的 /ai/generate-image-stream。
  member.intercept({ path: '/v1/ai/generate-image-stream', method: 'POST' }).reply(200, options => {
    const body = JSON.parse(options.body); assert.equal(body.model, 'nai-diffusion-5-full-medium');
    assert.equal(body.parameters.stream, 'sse'); calls.push(options.path);
    return 'event: final\ndata: {"image":"test"}\n\n';
  }, { headers: { 'content-type': 'text/event-stream' } });
  member.intercept({ path: '/v1/ai/encode-vibe', method: 'POST' }).reply(200, Buffer.alloc(128, 2));
  const worker = createServer(async (req, res) => {
    if (req.url === '/api/nai-key-vault/connection') {
      const key = req.headers.authorization;
      if (key === 'Bearer STA1N-http') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
      if (key === 'Bearer pst-http') return res.end('{"gatewayUrl":""}');
      res.writeHead(400); return res.end('{"error":"成员 Key 需网关地址"}');
    }
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/vibes/http-vibe') return res.end('{"item":{"id":"http-vibe","encodings":[]}}');
    if (req.url.endsWith('/encoding-result')) return res.end(JSON.stringify({ item: { id: 'http-vibe', encodings: [
      { id: 'http-encoding', model: 'nai-diffusion-4-5-full', informationExtracted: 1, encodingHash: createHash('sha256').update(Buffer.alloc(128, 2)).digest('hex') },
    ] } }));
    if (req.url === '/api/nai-accounting') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      return res.end(JSON.stringify({ receiptId: body.receiptId, budget: { remaining: 1666 } }));
    }
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
    const generateBody = { model: 'nai-diffusion-5-full-medium', action: 'generate', parameters: { width: 832, height: 1216, steps: 14, stream: true } };
    const zipResponse = await request('/api/generate', 'STA1N-http', generateBody);
    assert.equal(zipResponse.status, 200, await zipResponse.clone().text()); assert.equal(await zipResponse.text(), 'synthetic-zip');
    const streamResponse = await request('/api/generate-stream', 'STA1N-http', generateBody);
    assert.equal(streamResponse.status, 200, await streamResponse.clone().text()); assert.match(await streamResponse.text(), /event: final/);
    const encoded = await request('/api/vibes/http-vibe/encodings', 'STA1N-http', { informationExtracted: 1 });
    assert.equal(encoded.status, 200, await encoded.clone().text()); assert.equal((await encoded.json()).item.id, 'http-vibe');
    const rejected = await request('/api/generate', 'STA1N-missing', { model: 'nai-diffusion-5-full-medium', parameters: {} });
    assert.equal(rejected.status, 400); assert.equal(calls.filter(path => path.includes('/ai/generate-image')).length, 2);
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
  }
});

test('第三方网关与官方直连都发送参考图缓存形式，网关始终附原图', async () => {
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
    if (req.url === '/api/nai-accounting') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); events.push(body);
      return res.end(JSON.stringify({ receiptId: body.receiptId, budget: { remaining: 1666 } }));
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
    assert.equal(bodies.official.director_reference_images, undefined);
    assert.equal(bodies.official.director_reference_images_cached.length, 1);
    // 首次使用同一张参考图时官方也要原图数据，缓存键与网关一致（同一份内容派生）。
    assert.equal(bodies.official.director_reference_images_cached[0].data, bodies.gateway.director_reference_images_cached[0].data);
    assert.equal(bodies.official.director_reference_images_cached[0].cache_secret_key, bodies.gateway.director_reference_images_cached[0].cache_secret_key);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.cost > 0 && event.images === 1 && event.receiptId));
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

test('拼车成员网关探测 /api/me/quota 剥离 /v1 前缀，透传个人额度上限、恢复时间与独立钱包，失败静默降级', async () => {
  const seen = [];
  const quota = await fetchGatewayMemberQuota('Bearer STA1N-carpool', undefined, async (url, options) => {
    seen.push({ url, auth: options.headers.Authorization, redirect: options.redirect });
    return new Response(JSON.stringify({ fairQuota: { enabled: true, member: true, v5Capacity: 25, v5RefillPerDay: 5.5, v5FullRefillSeconds: 100800, v5RefillLimited: false, anlasAvailable: 2500 } }));
  }, 'https://gateway.example/v1/');
  assert.deepEqual(quota, { capacity: 25, managedWallet: true, refillPerDay: 5.5, fullRefillSeconds: 100800 });
  assert.deepEqual(seen, [{ url: 'https://gateway.example/api/me/quota', auth: 'Bearer STA1N-carpool', redirect: 'error' }]);

  // 恢复受限时 v5FullRefillSeconds 为 null，绝不能被 Number(null) 误转成 0（已满）。
  const limitedQuota = await fetchGatewayMemberQuota('Bearer STA1N-limited', undefined, async () =>
    new Response(JSON.stringify({ fairQuota: { enabled: true, member: true, v5Capacity: 25, v5RefillPerDay: 0, v5FullRefillSeconds: null, v5RefillLimited: true } })),
  'https://gateway.example/v1');
  assert.deepEqual(limitedQuota, { capacity: 25, managedWallet: true, refillPerDay: 0, refillLimited: true });

  // 官方 Key 不探测；不支持 /api/me/quota、404 或未启用公平额度时静默返回 null。
  assert.equal(await fetchGatewayMemberQuota('Bearer pst-official', undefined, async () => { throw new Error('should not fetch'); }, ''), null);
  assert.equal(await fetchGatewayMemberQuota('Bearer STA1N-404', undefined, async () => new Response('', { status: 404 }), 'https://gateway.example/v1'), null);
  assert.equal(await fetchGatewayMemberQuota('Bearer STA1N-off', undefined, async () => new Response(JSON.stringify({ fairQuota: { enabled: false, member: false } })), 'https://gateway.example'), null);

  const raw = { active: true, tier: 3, usage: { percent: 18.5, isNegative: false, timeUntilNextPercent: 0 }, trainingStepsLeft: { fixedTrainingStepsLeft: 2500, purchasedTrainingSteps: 0 } };
  const memberClean = sanitizeNovelAiSubscription(raw, 'https://gateway.example/v1', quota);
  assert.equal(memberClean.source, 'gateway');
  assert.equal(memberClean.gatewayManagedWallet, true);
  assert.equal(memberClean.usage.capacity, 25);
  assert.equal(memberClean.usage.percent, 18.5);
  assert.equal(memberClean.usage.refillPerDay, 5.5);
  assert.equal(memberClean.usage.fullRefillSeconds, 100800);
  assert.equal(memberClean.usage.refillLimited, undefined);

  const limitedClean = sanitizeNovelAiSubscription(raw, 'https://gateway.example/v1', limitedQuota);
  assert.equal(limitedClean.usage.refillLimited, true);
  assert.equal(limitedClean.usage.fullRefillSeconds, undefined);

  // 官方连接绝不附加成员上限、网关恢复字段或托管钱包标记。
  const officialClean = sanitizeNovelAiSubscription(raw, '', quota);
  assert.equal(officialClean.source, undefined);
  assert.equal(officialClean.gatewayManagedWallet, undefined);
  assert.equal(officialClean.usage.capacity, undefined);
  assert.equal(officialClean.usage.refillPerDay, undefined);
  assert.equal(officialClean.usage.fullRefillSeconds, undefined);

  // 完整 HTTP 入口联调：/api/novelai-subscription 并行合并 /v1/user/subscription 与根路径 /api/me/quota。
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const member = mock.get('https://gateway.example');
  member.intercept({ path: '/v1/user/subscription', method: 'GET' }).reply(200, JSON.stringify(raw), { headers: { 'content-type': 'application/json' } });
  member.intercept({ path: '/api/me/quota', method: 'GET' }).reply(200, JSON.stringify({ fairQuota: { enabled: true, member: true, v5Capacity: 25, v5RefillPerDay: 5.5, v5FullRefillSeconds: 100800, v5RefillLimited: false } }), { headers: { 'content-type': 'application/json' } });
  const worker = createServer((req, res) => {
    if (req.url === '/api/nai-key-vault/connection') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
    res.writeHead(404); res.end();
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/novelai-subscription`, { headers: { Authorization: 'Bearer STA1N-carpool' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'gateway');
    assert.equal(body.gatewayManagedWallet, true);
    assert.equal(body.usage.percent, 18.5);
    assert.equal(body.usage.capacity, 25);
    assert.equal(body.usage.refillPerDay, 5.5);
    assert.equal(body.usage.fullRefillSeconds, 100800);
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
    cacheNovelAiSubscription('Bearer STA1N-carpool', null);
  }
});

test('拼车成员网关 /api/me/quota 偶发失败时保留已有钱包与车位上限缓存，并发请求自动合并去重', async () => {
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const raw = { active: true, tier: 3, usage: { percent: 25, isNegative: false, timeUntilNextPercent: 0 }, trainingStepsLeft: { fixedTrainingStepsLeft: 2504, purchasedTrainingSteps: 0 } };
  let quotaCalls = 0;
  let quotaMode = 'ok';
  const member = mock.get('https://gateway.example');
  member.intercept({ path: '/v1/user/subscription', method: 'GET' }).reply(200, () => JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }).persist();
  member.intercept({ path: '/api/me/quota', method: 'GET' }).reply(() => {
    quotaCalls += 1;
    if (quotaMode === 'error') return { statusCode: 502, data: 'Bad Gateway' };
    if (quotaMode === 'unsupported') return { statusCode: 404, data: 'Not Found' };
    return {
      statusCode: 200,
      data: JSON.stringify({ fairQuota: { enabled: true, member: true, v5Capacity: 25, v5RefillPerDay: 5.5, v5FullRefillSeconds: 0, v5RefillLimited: false } }),
      responseOptions: { headers: { 'content-type': 'application/json' } },
    };
  }).delay(40).persist();
  const worker = createServer((req, res) => {
    if (req.url === '/api/nai-key-vault/connection') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
    res.writeHead(404); res.end();
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const url = `http://127.0.0.1:${server.address().port}/api/novelai-subscription`;
    const headers = { Authorization: 'Bearer STA1N-flaky' };

    // 1) 并发两次查询合并为一次上游 /api/me/quota 请求，且都返回完整托管钱包与车位上限。
    const [r1, r2] = await Promise.all([fetch(url, { headers }), fetch(url, { headers })]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    assert.equal(b1.gatewayManagedWallet, true);
    assert.equal(b1.usage.capacity, 25);
    assert.equal(b2.gatewayManagedWallet, true);
    assert.equal(b2.usage.capacity, 25);
    assert.equal(quotaCalls, 1);

    // 2) 后续 /api/me/quota 偶发 502 时，沿用已缓存的托管钱包与 25% 车位上限，绝不退回「本地预算 / 余额」和 1/4 圆环。
    quotaMode = 'error';
    const r3 = await fetch(url, { headers });
    const b3 = await r3.json();
    assert.equal(r3.status, 200);
    assert.equal(b3.source, 'gateway');
    assert.equal(b3.gatewayManagedWallet, true);
    assert.equal(b3.usage.capacity, 25);

    // 3) 网关明确返回 404 不支持 /api/me/quota 时，正常清除托管钱包与车位上限标记。
    quotaMode = 'unsupported';
    const r4 = await fetch(url, { headers });
    const b4 = await r4.json();
    assert.equal(r4.status, 200);
    assert.equal(b4.source, 'gateway');
    assert.equal(b4.gatewayManagedWallet, undefined);
    assert.equal(b4.usage.capacity, undefined);
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
    cacheNovelAiSubscription('Bearer STA1N-flaky', null);
  }
});

test('批量生图（如 Roll 串多张）在开启 Key 池时逐张按满圈率轮询切 Key，全池耗尽立即停止', async () => {
  // 纯函数验证：满圈率优先 + 同分避开刚用过的 Key
  const e1 = { id: 'p1', name: '车位1', key: 'STA1N-batch-1', gatewayUrl: 'https://g1.example/v1' };
  const e2 = { id: 'p2', name: '车位2', key: 'STA1N-batch-2', gatewayUrl: 'https://g2.example/v1' };
  const tieRotate = selectBackendPoolMember([
    { entry: e1, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
    { entry: e2, info: { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } } },
  ], 'Bearer STA1N-batch-1');
  assert.equal(tieRotate.ok, true);
  assert.equal(tieRotate.entry.id, 'p2');

  // 真实后台批量任务联调（使用与 Roll 串相同的 sequence 多张配方）：
  // 1) 3 张：第 1 张走车位1（25%->24.5%），第 2 张切车位2（25%->0%），第 3 张切回车位1（24.5%->24%）
  // 2) 全池耗尽：第 1 张耗尽车位1、第 2 张耗尽车位2，第 3 张前立即以 pool_exhausted 停止且不发起第 3 次生图
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const quotas = { 'STA1N-batch-1': 25, 'STA1N-batch-2': 25 };
  const quotaEndpointCalls = { 'STA1N-batch-1': 0, 'STA1N-batch-2': 0 };
  const subEndpointCalls = { 'STA1N-batch-1': 0, 'STA1N-batch-2': 0 };
  let drainBoth = false;
  const usedKeys = [];
  const accountedAuths = [];
  const savedDurations = [];
  const savedCount = { n: 0 };
  const pngBuffer = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#10b981' } }).png().toBuffer();
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('image_0.png', pngBuffer);
  const zipBody = await zip.generateAsync({ type: 'nodebuffer' });

  for (const [host, key] of [['https://g1.example', 'STA1N-batch-1'], ['https://g2.example', 'STA1N-batch-2']]) {
    const pool = mock.get(host);
    pool.intercept({ path: '/v1/user/subscription', method: 'GET' }).reply(200, () => {
      subEndpointCalls[key] += 1;
      return JSON.stringify({
        active: true, tier: 3,
        usage: { percent: quotas[key], isNegative: quotas[key] <= 0, timeUntilNextPercent: 0 },
        trainingStepsLeft: { fixedTrainingStepsLeft: 2500, purchasedTrainingSteps: 0 },
      });
    }, { headers: { 'content-type': 'application/json' } }).persist();
    pool.intercept({ path: '/api/me/quota', method: 'GET' }).reply(200, () => {
      quotaEndpointCalls[key] += 1;
      return JSON.stringify({ fairQuota: { enabled: true, member: true, v5Capacity: 25 } });
    }, { headers: { 'content-type': 'application/json' } }).persist();
    pool.intercept({ path: '/v1/ai/generate-image', method: 'POST' }).reply(200, () => {
      usedKeys.push(key);
      quotas[key] = drainBoth || key === 'STA1N-batch-2' ? 0 : Math.max(0, quotas[key] - 0.5);
      return zipBody;
    }, { headers: { 'content-type': 'application/zip' } }).persist();
  }

  const worker = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/nai-key-vault/pool') return res.end(JSON.stringify({ pool: { enabled: true, memberIds: ['p1', 'p2'] } }));
    if (req.url === '/api/nai-key-vault') return res.end(JSON.stringify({ entries: [e1, e2] }));
    if (req.url === '/api/nai-key-vault/connection') {
      const auth = req.headers.authorization;
      return res.end(JSON.stringify({ gatewayUrl: auth === 'Bearer STA1N-batch-2' ? 'https://g2.example/v1' : 'https://g1.example/v1' }));
    }
    if (req.url === '/api/nai-accounting') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      accountedAuths.push(body.keyHash);
      return res.end(JSON.stringify({ receiptId: body.receiptId, budget: { remaining: 2500 } }));
    }
    res.end('{}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  // 历史保存只替换存储边界，验证真实 multipart 与 PNG，避免 MockAgent 跨版本 FormData 流阻塞。
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input) === `http://127.0.0.1:${worker.address().port}/api/local-history`) {
      assert.ok(options.body instanceof FormData);
      assert.ok((await options.body.get('image').arrayBuffer()).byteLength > 8);
      const rawMeta = options.body.get('metadata');
      const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : null;
      savedDurations.push(meta?.params?._local_generation_duration_ms);
      const id = `hist-${++savedCount.n}`;
      return new Response(JSON.stringify({ item: { id, imageUrl: `/api/files/${id}.png`, prompt: 'test', params: meta?.params || {} } }));
    }
    return originalFetch(input, options);
  };
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${server.address().port}`;
    const localReq = (path, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
      const payloadText = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(base + path, {
        method,
        headers: {
          authorization: 'Bearer STA1N-batch-1',
          'content-type': 'application/json',
          ...(payloadText === undefined ? {} : { 'content-length': Buffer.byteLength(payloadText) }),
          ...extra,
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      if (payloadText !== undefined) req.write(payloadText);
      req.end();
    });
    const waitDone = async token => {
      let snap;
      for (let i = 0; i < 120; i++) {
        snap = (await localReq(`/api/generation-job?token=${token}`)).body;
        if (['succeeded', 'failed', 'cancelled'].includes(snap.state)) return snap;
        await new Promise(r => setTimeout(r, 25));
      }
      assert.fail('后台批量任务超时未收束：' + JSON.stringify(snap));
    };

    assert.equal((await localReq('/api/generation-queue/preferences', 'PUT', { generationIntervalSeconds: 0 })).status, 200);
    const makeEntry = prompt => ({
      payload: { model: 'nai-diffusion-5-full-medium', action: 'generate', input: prompt, parameters: { width: 832, height: 1216, steps: 14, n_samples: 1 } },
      history: { prompt, params: { model: 'nai-diffusion-5-full-medium', width: 832, height: 1216, steps: 14 } },
      approvedCost: 0,
      stream: false,
    });
    const seq3 = [makeEntry('roll-1'), makeEntry('roll-2'), makeEntry('roll-3')];
    const token1 = 'poolbatchtoken1234567890';
    const started1 = await localReq('/api/generation-job', 'POST', { ...seq3[0], sequence: seq3 }, {
      'x-nai-generation-task': token1, 'x-nai-generation-count': '3',
    });
    assert.equal(started1.status, 200, JSON.stringify(started1));
    const done1 = await waitDone(token1);
    assert.equal(done1.state, 'succeeded', JSON.stringify(done1));
    assert.equal(done1.completedCount, 3);
    const sha256 = text => createHash('sha256').update(text).digest('hex');
    assert.deepEqual(usedKeys, ['STA1N-batch-1', 'STA1N-batch-2', 'STA1N-batch-1']);
    assert.deepEqual(accountedAuths, [sha256('STA1N-batch-1'), sha256('STA1N-batch-2'), sha256('STA1N-batch-1')]);
    assert.equal(savedDurations.length, 3);
    assert.ok(savedDurations.every(ms => Number.isFinite(ms) && ms > 0), `每张应记录上游出口生图毫秒耗时：${JSON.stringify(savedDurations)}`);
    // 静态个人配额上限缓存生效：整批 3 张里每把 Key 至多请求 1 次 /api/me/quota，不逐张阻塞。
    assert.equal(quotaEndpointCalls['STA1N-batch-1'], 1);
    assert.equal(quotaEndpointCalls['STA1N-batch-2'], 1);

    // 场景 2：中途全池耗尽立即以 pool_exhausted 停止，不消耗 Anlas 也不发起第 3 次请求
    usedKeys.length = 0;
    accountedAuths.length = 0;
    quotas['STA1N-batch-1'] = 25;
    quotas['STA1N-batch-2'] = 25;
    cacheNovelAiSubscription('Bearer STA1N-batch-1', null);
    cacheNovelAiSubscription('Bearer STA1N-batch-2', null);
    drainBoth = true;
    const token2 = 'poolbatchtoken2234567890';
    const started2 = await localReq('/api/generation-job', 'POST', { ...seq3[0], sequence: seq3 }, {
      'x-nai-generation-task': token2, 'x-nai-generation-count': '3',
    });
    assert.equal(started2.status, 200, JSON.stringify(started2));
    const done2 = await waitDone(token2);
    assert.equal(done2.state, 'failed', JSON.stringify(done2));
    assert.equal(done2.code, 'pool_exhausted');
    assert.equal(done2.completedCount, 2);
    assert.equal(usedKeys.length, 2);
    assert.equal(new Set(usedKeys).size, 2, '耗尽前应先轮询用完两把不同的 Key');

    // 场景 3：单张发车前零阻塞（复用干净缓存直接出图），成图后后台静默刷新并在下次点击时自动切 Key
    usedKeys.length = 0;
    drainBoth = false;
    quotas['STA1N-batch-1'] = 25;
    quotas['STA1N-batch-2'] = 25;
    cacheNovelAiSubscription('Bearer STA1N-batch-1', { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } });
    cacheNovelAiSubscription('Bearer STA1N-batch-2', { source: 'gateway', active: true, tier: 3, usage: { percent: 25, capacity: 25, isNegative: false, timeUntilNextPercent: 0 } });
    const subBeforeSingle = subEndpointCalls['STA1N-batch-1'] + subEndpointCalls['STA1N-batch-2'];
    const token3 = 'poolbatchtoken3234567890';
    const started3 = await localReq('/api/generation-job', 'POST', makeEntry('single-1'), {
      'x-nai-generation-task': token3, 'x-nai-generation-count': '1',
    });
    assert.equal(started3.status, 200, JSON.stringify(started3));
    const done3 = await waitDone(token3);
    assert.equal(done3.state, 'succeeded', JSON.stringify(done3));
    assert.deepEqual(usedKeys, ['STA1N-batch-1']);
    // 等待成图后的后台静默刷新落盘（把 STA1N-batch-1 更新为 24.5%）
    for (let i = 0; i < 40; i++) {
      if (subEndpointCalls['STA1N-batch-1'] + subEndpointCalls['STA1N-batch-2'] > subBeforeSingle) break;
      await new Promise(r => setTimeout(r, 15));
    }
    assert.ok(subEndpointCalls['STA1N-batch-1'] + subEndpointCalls['STA1N-batch-2'] > subBeforeSingle, '成图后应在后台异步刷新刚用过的 Key');
    // 下一张单图点击：零等待直接切到满圈率更高的 STA1N-batch-2
    const token4 = 'poolbatchtoken4234567890';
    const started4 = await localReq('/api/generation-job', 'POST', makeEntry('single-2'), {
      'x-nai-generation-task': token4, 'x-nai-generation-count': '1',
    });
    assert.equal(started4.status, 200, JSON.stringify(started4));
    const done4 = await waitDone(token4);
    assert.equal(done4.state, 'succeeded', JSON.stringify(done4));
    assert.deepEqual(usedKeys, ['STA1N-batch-1', 'STA1N-batch-2']);
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    globalThis.fetch = originalFetch;
    setGlobalDispatcher(originalDispatcher); await mock.close();
    cacheNovelAiSubscription('Bearer STA1N-batch-1', null);
    cacheNovelAiSubscription('Bearer STA1N-batch-2', null);
  }
});

test('流式接口兼容拼车网关二进制 MsgPack 响应与 Vibe 完整编码透传', async () => {
  const encodeStr = value => {
    const bytes = Buffer.from(String(value), 'utf8');
    const head = Buffer.alloc(5);
    head[0] = 0xdb;
    head.writeUInt32BE(bytes.length, 1);
    return Buffer.concat([head, bytes]);
  };
  const encodeBin = bytes => {
    const head = Buffer.alloc(5);
    head[0] = 0xc6;
    head.writeUInt32BE(bytes.length, 1);
    return Buffer.concat([head, bytes]);
  };
  const wrapFrame = parts => {
    const payload = Buffer.concat(parts);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(payload.length, 0);
    return Buffer.concat([prefix, payload]);
  };

  const pngBuffer = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#38bdf8' } }).png().toBuffer();
  // 与 novelai-shared-gateway/server/native-stream.js 完全一致的 4 字节长度前缀 MsgPack 帧
  const msgpackFinal = wrapFrame([
    Buffer.from([0x83]),
    encodeStr('event_type'), encodeStr('final'),
    encodeStr('samp_ix'), Buffer.from([0]),
    encodeStr('image'), encodeBin(pngBuffer),
  ]);
  const msgpackError = wrapFrame([
    Buffer.from([0x83]),
    encodeStr('event_type'), encodeStr('error'),
    encodeStr('samp_ix'), Buffer.from([0]),
    encodeStr('message'), encodeStr('配额不足'),
  ]);

  const parsed = parseNovelAiMsgpackStream(msgpackFinal);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].event_type, 'final');
  assert.equal(Buffer.compare(Buffer.from(parsed[0].image), pngBuffer), 0);

  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const member = mock.get('https://gateway.example');
  const seenVibePayloads = [];
  member.intercept({ path: '/v1/ai/generate-image-stream', method: 'POST' }).reply(200, options => {
    seenVibePayloads.push(JSON.parse(options.body).parameters.reference_image_multiple_cached);
    return msgpackFinal;
  }, { headers: { 'content-type': 'application/octet-stream' } }).times(2);
  member.intercept({ path: '/v1/ai/generate-image-stream', method: 'POST' }).reply(200, () => msgpackError, {
    headers: { 'content-type': 'application/octet-stream' },
  });

  const vibeEncoding = Buffer.alloc(160, 7).toString('base64');
  const worker = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/nai-key-vault/connection') return res.end('{"gatewayUrl":"https://gateway.example/v1"}');
    if (req.url === '/api/vibes/v1/encodings/e1/data') {
      return res.end(JSON.stringify({ variant: { model: 'nai-diffusion-4-5-full' }, encoding: vibeEncoding }));
    }
    if (req.url === '/api/nai-accounting') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      return res.end(JSON.stringify({ receiptId: body.receiptId, budget: { remaining: 1666 } }));
    }
    res.end('{"remaining":1666}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    cacheNovelAiSubscription('Bearer STA1N-msgpack', { source: 'gateway', active: true, tier: 3 });
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(base + '/api/generation-queue/preferences', {
      method: 'PUT',
      headers: { Authorization: 'Bearer STA1N-msgpack', 'Content-Type': 'application/json' },
      body: '{"generationIntervalSeconds":0}',
    });
    const body = {
      model: 'nai-diffusion-4-5-full',
      action: 'generate',
      parameters: {
        width: 832, height: 1216, steps: 23,
        _local_vibes: { enabled: true, slots: [{ vibeId: 'v1', encodingId: 'e1', strength: 0.6 }] },
      },
    };
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/generate-stream', {
        method: 'POST',
        headers: { Authorization: 'Bearer STA1N-msgpack', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
      const text = await response.text();
      assert.match(text, /event: final/);
      assert.ok(text.includes(pngBuffer.toString('base64')));
      assert.match(text, /event: nai_usage/);
    }
    // 连续两次流式请求均须附带完整 Vibe data，不因缓存键省略导致拼车网关 422。
    assert.equal(seenVibePayloads.length, 2);
    assert.equal(seenVibePayloads[0]?.[0]?.data, vibeEncoding);
    assert.equal(seenVibePayloads[1]?.[0]?.data, vibeEncoding);

    // 仅含 error 帧的 MsgPack 响应应转成 SSE error 事件透传原因。
    const errRes = await fetch(base + '/api/generate-stream', {
      method: 'POST',
      headers: { Authorization: 'Bearer STA1N-msgpack', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { width: 832, height: 1216, steps: 23 } }),
    });
    const errText = await errRes.text();
    assert.match(errText, /event: error/);
    assert.match(errText, /配额不足/);
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
    cacheNovelAiSubscription('Bearer STA1N-msgpack', null);
  }
});

test('独立 2× 放大对拼车成员网关发送 nai-diffusion-5-curated，官方直连保持 nai-diffusion-5-full', async () => {
  const originalDispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect(); mock.enableNetConnect(host => host.startsWith('127.0.0.1:'));
  setGlobalDispatcher(mock);
  const seenModels = {};
  const sourcePng = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#6366f1' } }).png().toBuffer();
  const resultPng = await sharp(randomBytes(64 * 64 * 3), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('image_0.png', resultPng);
  const zipBody = await zip.generateAsync({ type: 'nodebuffer' });

  mock.get('https://gateway.example').intercept({ path: '/v1/ai/upscale', method: 'POST' }).reply(200, options => {
    seenModels.gateway = JSON.parse(options.body).model;
    return zipBody;
  }, { headers: { 'content-type': 'application/zip' } });
  mock.get('https://image.novelai.net').intercept({ path: '/ai/upscale', method: 'POST' }).reply(200, options => {
    seenModels.official = JSON.parse(options.body).model;
    return zipBody;
  }, { headers: { 'content-type': 'application/zip' } });

  const worker = createServer((req, res) => {
    if (req.url === '/api/nai-key-vault/connection') {
      return res.end(req.headers.authorization === 'Bearer STA1N-up' ? '{"gatewayUrl":"https://gateway.example/v1"}' : '{"gatewayUrl":""}');
    }
    if (req.url === '/api/local-history/h1/image') return res.end(sourcePng);
    res.writeHead(404); res.end();
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    const base = `http://127.0.0.1:${server.address().port}`;
    const memberRes = await fetch(base + '/api/nai/upscale', {
      method: 'POST',
      headers: { Authorization: 'Bearer STA1N-up', 'Content-Type': 'application/json' },
      body: JSON.stringify({ historyId: 'h1' }),
    });
    assert.equal(memberRes.status, 200, await memberRes.clone().text());
    assert.equal(memberRes.headers.get('x-nai-upscale-model'), 'nai-diffusion-5-curated');
    assert.equal(Buffer.compare(Buffer.from(await memberRes.arrayBuffer()), resultPng), 0);

    const officialRes = await fetch(base + '/api/nai/upscale', {
      method: 'POST',
      headers: { Authorization: 'Bearer pst-up', 'Content-Type': 'application/json' },
      body: JSON.stringify({ historyId: 'h1' }),
    });
    assert.equal(officialRes.status, 200, await officialRes.clone().text());
    assert.equal(officialRes.headers.get('x-nai-upscale-model'), 'nai-diffusion-5-full');
    assert.equal(Buffer.compare(Buffer.from(await officialRes.arrayBuffer()), resultPng), 0);

    assert.equal(seenModels.gateway, 'nai-diffusion-5-curated');
    assert.equal(seenModels.official, 'nai-diffusion-5-full');
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([server && new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
    setGlobalDispatcher(originalDispatcher); await mock.close();
  }
});
