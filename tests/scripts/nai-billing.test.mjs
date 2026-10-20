import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { DEFAULT_NAI_RUNTIME, applyNaiRuntimeOverride, cacheNovelAiSubscription, handleGenerateRequest, handleGenerateStreamRequest, handleVibeEncodeRequest, CloudQueueCoordinator } from '../../scripts/media-gateway.mjs';

// 全部请求、额度和预算都注入模拟值，不访问真实 NovelAI、公共队列或私人数据库。
const subscription = { active: true, tier: 3, usage: { percent: 30, isNegative: false } };
const json = value => new Response(JSON.stringify(value));
const payload = (parameters = {}, extra = {}) => ({ action: 'generate', model: 'nai-diffusion-5-full',
  parameters: { steps: 23, width: 832, height: 1216, n_samples: 1, ...parameters }, ...extra });
class Output extends Writable {
  constructor() { super(); this.headers = {}; this.statusCode = 0; this.headersSent = false; this.chunks = []; }
  setHeader(name, value) { this.headers[name] = value; }
  writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); this.headersSent = true; }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  body() { return Buffer.concat(this.chunks).toString(); }
}
const request = (key = 'handler-key', body = payload(), maximum) => {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST'; req.headers = { authorization: `Bearer ${key}`, ...(maximum !== undefined ? { 'x-nai-anlas-max-cost': String(maximum) } : {}) };
  req.socket = { remoteAddress: '127.0.0.1' }; req.setTimeout = () => {};
  return req;
};
const idleQueue = () => new CloudQueueCoordinator(() => assert.fail('不能调用公共队列'), 'https://queue.invalid');
test('Vibe 编码：成员 Key 走绑定网关，失败不重试，官方 Key 保持原接口；并发不同接入分别计费', async () => {
  const spends = [], saves = [], calls = [], usage = [];
  const worker = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/local-usage/events') { usage.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"inserted":1}'); }
    if (req.url.endsWith('/encoding-result')) { saves.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"item":{"id":"gateway-encoding"}}'); }
    if (req.url === '/api/anlas-budget') { spends.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"remaining":1664}'); }
    res.end('{"item":{"id":"gateway-vibe","encodings":[]}}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    const remote = async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      assert.equal(options.redirect, url.startsWith('https://gateway.example') ? 'error' : undefined);
      assert.deepEqual(JSON.parse(options.body), { image: Buffer.alloc(128, 1).toString('base64'), information_extracted: 1, model: 'nai-diffusion-4-5-full' });
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response(Buffer.alloc(128, 2));
    };
    const gateway = new Output(), official = new Output();
    await Promise.all([
      handleVibeEncodeRequest(request('STA1N-encode', { informationExtracted: 1 }), gateway, '', worker.address().port, 'gateway-vibe', remote, 'https://gateway.example/v1'),
      handleVibeEncodeRequest(request('pst-encode-original', { informationExtracted: 1 }), official, '', worker.address().port, 'gateway-vibe', remote),
    ]);
    assert.equal(gateway.statusCode, 200, gateway.body()); assert.equal(official.statusCode, 200, official.body());
    assert.deepEqual(calls.map(call => call.url).sort(), ['https://gateway.example/v1/ai/encode-vibe', 'https://image.novelai.net/ai/encode-vibe']);
    assert.equal(saves.length, 2); assert.equal(spends.length, 2);
    assert.equal(usage.length, 2);
    assert.deepEqual(usage.map(row => [row.action, row.amount, row.value, row.meta.opusImages]), [['encoding', 0, 2, 0], ['encoding', 0, 2, 0]]);
    assert.equal(new Set(spends.map(item => item.keyHash)).size, 2);
    const denied = new Output(); let rejected = 0;
    await handleVibeEncodeRequest(request('STA1N-denied', { informationExtracted: 1 }), denied, '', worker.address().port, 'gateway-denied-vibe', async url => {
      rejected++; assert.equal(url, 'https://gateway.example/v1/ai/encode-vibe'); return new Response('member disabled', { status: 403 });
    }, 'https://gateway.example/v1');
    assert.equal(denied.statusCode, 403); assert.match(denied.body(), /member disabled/);
    assert.equal(rejected, 1); assert.equal(spends.length, 2); assert.equal(saves.length, 2); assert.equal(usage.length, 2);
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});
test('Vibe 编码无额外费用上限拦截、重复复用与生成前单价一致，记账失败仍保存编码', async () => {
  let scenario, encoded = 0, saved = 0;
  const spends = [], usage = [];
  const worker = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/local-usage/events') { usage.push(JSON.parse(Buffer.concat(chunks))); return res.end('{"inserted":1}'); }
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    if (req.url.endsWith('/encoding-result')) { saved++; return res.end(JSON.stringify({ item: { id: 'fixture' } })); }
    if (req.url === '/api/anlas-budget') {
      spends.push(JSON.parse(Buffer.concat(chunks).toString()));
      if (scenario === 'accounting-error') { res.statusCode = 500; return res.end('{"error":"synthetic"}'); }
      return res.end('{"remaining":1664}');
    }
    return res.end(JSON.stringify({ item: { id: 'fixture', encodings: scenario === 'cached' ? [{ informationExtracted: 1, model: 'nai-diffusion-4-5-full' }] : [] } }));
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    for (scenario of ['normal', 'accounting-error', 'cached']) {
      applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      const res = new Output();
      await handleVibeEncodeRequest(request(`encode-${scenario}`, { informationExtracted: 1 }, scenario === 'changed' ? 1 : 2), res, '', worker.address().port, 'fixture', async () => {
        encoded++;
        applyNaiRuntimeOverride({ billing: { ...DEFAULT_NAI_RUNTIME.billing, vibeEncodingCost: 6 } });
        return new Response(Buffer.alloc(128, 2));
      });
      const result = JSON.parse(res.body());
      assert.equal(res.statusCode, 200);
      if (scenario === 'accounting-error') assert.equal(result.anlasAccountingFailed, true);
      if (scenario === 'cached') assert.equal(result.duplicate, true);
    }
    assert.equal(encoded, 2); assert.equal(saved, 2);
    assert.equal(usage.length, 2, '已有编码和恢复保存不能再次记消费');
    assert.deepEqual(spends.map(item => item.amount), [2, 2]);
  } finally { applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing }); await new Promise(resolve => worker.close(resolve)); }
});
for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
  const label = handler === handleGenerateRequest ? 'ZIP' : 'SSE';
  const success = () => new Response(handler === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n');
  const settleGeneration = async () => ({ estimatedCost: 0, anlasBudget: null });
  const prepareBilling = async () => ({ runtime: DEFAULT_NAI_RUNTIME });
  test(`${label}：成功图片独立记 Key、真实模型、费用和额度，未知费用不冒充零且失败不计数`, async () => {
    const usage = [], spends = [];
    let rejectRecord = false, generations = 0;
    const worker = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/local-usage/events') {
        usage.push(body);
        if (rejectRecord) { res.statusCode = 500; return res.end('{"error":"synthetic ledger error"}'); }
        return res.end('{"inserted":1}');
      }
      spends.push(body); res.end('{"remaining":1666}');
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    try {
      for (const [suffix, model, known, status] of [
        ['v45', 'nai-diffusion-4-5-full', true, 200], ['v5', 'nai-diffusion-5-full-medium', true, 200],
        ['unknown', 'nai-diffusion-5-full', false, 200], ['denied', 'nai-diffusion-5-full', true, 403],
      ]) {
        const key = `ledger-${label}-${suffix}`;
        if (known) cacheNovelAiSubscription(`Bearer ${key}`, subscription);
        const res = new Output();
        await handler(request(key, payload({}, { model })), res, '', worker.address().port, idleQueue(), { enabled: false }, async () => {
          generations++;
          return status === 200 ? success() : new Response('{"error":"denied"}', { status });
        }, {});
        assert.equal(res.statusCode, status);
        if (status === 200) {
          const record = usage.at(-1);
          assert.equal(record.target, createHash('sha256').update(key).digest('hex'));
          assert.equal(record.amount, 1); assert.equal(record.meta.model, model);
          assert.equal(record.meta.billingKnown, known);
          if (known) assert.equal(record.value, 0);
          else { assert.equal(record.value, undefined); assert.equal(record.meta.opusImages, undefined); }
        }
      }
      assert.equal(usage.length, 3); assert.equal(generations, 4);
      assert.equal(spends.length, 1, '只有受限模型免费档需要原有 Opus 计数');
      rejectRecord = true;
      const key = `ledger-error-${label}`;
      cacheNovelAiSubscription(`Bearer ${key}`, subscription);
      const res = new Output();
      await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async () => { generations++; return success(); }, {});
      assert.equal(res.statusCode, 200); assert.equal(generations, 5); assert.equal(spends.length, 2);
      if (handler === handleGenerateRequest) { assert.equal(res.body(), 'zip'); assert.equal(res.headers['X-Nai-Anlas-Accounting-Failed'], '1'); }
      else { assert.match(res.body(), /event: final/); assert.match(res.body(), /event: nai_usage_error/); }
    } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
  });
  test(`${label}：上游成功后本地记账失败仍交付成品，并单独提示费用异常，不重试`, async () => {
    let generations = 0;
    const res = new Output();
    await handler(request(`accounting-${label}`), res, '', 0, idleQueue(), { enabled: false }, async () => { generations++; return success(); },
      { prepareBilling, settleGeneration: async () => { throw new Error('synthetic accounting failure'); } });
    assert.equal(res.statusCode, 200); assert.equal(generations, 1);
    if (handler === handleGenerateRequest) {
      assert.equal(res.body(), 'zip');
      assert.equal(res.headers['X-Nai-Anlas-Accounting-Failed'], '1');
      assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], undefined);
    } else {
      assert.match(res.body(), /event: final/); assert.match(res.body(), /event: nai_usage_error/);
      assert.doesNotMatch(res.body(), /event: error/);
    }
  });
  test(`${label}：普通生成不查询订阅、不等待同步，旧费用上限不再拦截`, async () => {
    const res = new Output(); let generations = 0;
    await handler(request(`fast-${label}`, payload(), 0), res, '', 0, idleQueue(), { enabled: false }, async url => {
      assert.match(url, /\/ai\/generate-image(?:-stream)?$/); generations++; return success();
    }, {});
    assert.equal(res.statusCode, 200); assert.equal(generations, 1);
  });
  test(`${label}：零点数且不计 Opus 的 V4.5 成功请求仍返回准确费用，不依赖预算扣减`, async () => {
    const res = new Output();
    cacheNovelAiSubscription(`Bearer zero-${label}`, subscription);
    await handler(request(`zero-${label}`, payload({}, { model: 'nai-diffusion-4-5-full' }), 0), res, '', 0, idleQueue(), { enabled: false },
      async url => url.endsWith('/user/subscription') ? json(subscription) : success(), {});
    assert.equal(res.statusCode, 200);
    if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], '0');
    else assert.match(res.body(), /"estimatedSpent":0/);
  });
  test(`${label}：复用生成前订阅快照，最后一张免费图不被生成后的透支或新倍率改写`, async () => {
    const spends = [], calls = [];
    const worker = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.url === '/api/local-usage/events') return res.end('{"inserted":1}');
      spends.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remaining: 1666 }));
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    try {
      for (const exhausted of [false, true]) {
        let generated = false;
        const res = new Output(), key = `boundary-${label}-${exhausted}`;
        cacheNovelAiSubscription(`Bearer ${key}`, { ...subscription, usage: { percent: exhausted ? 0 : 0.01, isNegative: exhausted } });
        await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async url => {
          calls.push(url);
          if (url.endsWith('/user/subscription')) {
            assert.equal(generated, false, '订阅必须在生成前读取');
            return json({ ...subscription, usage: { percent: exhausted ? 0 : 0.01, isNegative: exhausted } });
          }
          generated = true;
          cacheNovelAiSubscription(`Bearer ${key}`, { ...subscription, usage: { percent: 0, isNegative: true } });
          applyNaiRuntimeOverride({ billing: { ...DEFAULT_NAI_RUNTIME.billing, modelMultipliers: { v5: 3 } } });
          return success();
        }, {});
        assert.equal(res.statusCode, 200);
        assert.deepEqual(spends.at(-1), { amount: exhausted ? 26 : 0, reason: 'generation',
          keyHash: createHash('sha256').update(key).digest('hex'), anlasDelta: exhausted ? 26 : 0, opusImagesDelta: exhausted ? 0 : 1 });
        applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      }
      assert.equal(calls.filter(url => url.endsWith('/user/subscription')).length, 0);
    } finally {
      applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      await new Promise(resolve => worker.close(resolve));
    }
  });
  test(`${label}：免费图生图与普通重绘不扣本地 Anlas，成功才按当前 Key 记录 Opus`, async () => {
    const spends = [];
    const worker = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.url === '/api/local-usage/events') return res.end('{"inserted":1}');
      spends.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remaining: 1666 }));
    });
    worker.listen(0, '127.0.0.1');
    await once(worker, 'listening');
    try {
      for (const action of ['img2img', 'infill']) {
        const key = `free-edit-${label}-${action}`, res = new Output();
        const body = payload({ image: 'fake', strength: 0.7,
          ...(action === 'infill' ? { mask: 'fake', inpaintImg2ImgStrength: 1, _local_focused_inpainting: false } : {}) },
        { action, model: action === 'infill' ? 'nai-diffusion-5-full-inpainting' : 'nai-diffusion-5-full' });
        cacheNovelAiSubscription(`Bearer ${key}`, subscription);
        await handler(request(key, body), res, '', worker.address().port, idleQueue(), { enabled: false },
          async url => url.endsWith('/user/subscription') ? json(subscription) : success(), {});
        assert.equal(res.statusCode, 200);
        assert.deepEqual(spends.at(-1), { amount: 0, reason: 'generation', keyHash: createHash('sha256').update(key).digest('hex'), anlasDelta: 0, opusImagesDelta: 1 });
        if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], '0');
        else assert.match(res.body(), /"estimatedSpent":0/);
      }
    } finally { await new Promise(resolve => worker.close(resolve)); }
  });
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full']) {
    test(`${label} ${model}：普通模式允许过期订阅请求，成功按当前 Key 记付费点数，不记 Opus 用量`, async () => {
      const spends = [], calls = [];
      const worker = createServer(async (req, res) => {
        if (req.url === '/api/local-usage/events') { for await (const _chunk of req) { /* 读完合成请求体。 */ } return res.end('{"inserted":1}'); }
        assert.equal(req.url, '/api/anlas-budget');
        assert.equal(req.method, 'POST');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        spends.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ remaining: 1646 }));
      });
      worker.listen(0, '127.0.0.1');
      await once(worker, 'listening');
      try {
        const key = `expired-paid-${label}-${model}`;
        const res = new Output();
        cacheNovelAiSubscription(`Bearer ${key}`, { active: false, tier: 3 });
        await handler(request(key, payload({ steps: 28 }, { model })), res, '', worker.address().port, idleQueue(), { enabled: false }, async url => {
          calls.push(url);
          if (url.endsWith('/user/subscription')) return json({ active: false, tier: 3, usage: { percent: 100, isNegative: false }, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 } });
          assert.match(url, /\/ai\/generate-image(?:-stream)?$/);
          return success();
        }, {});
        assert.equal(res.statusCode, 200);
        assert.equal(calls.filter(url => url.endsWith('/user/subscription')).length, 0);
        assert.equal(calls.filter(url => url.includes('/ai/generate-image')).length, 1);
        const cost = /^nai-diffusion-5-/.test(model) ? 30 : 20;
        assert.deepEqual(spends, [{ amount: cost, reason: 'generation', keyHash: createHash('sha256').update(key).digest('hex'), anlasDelta: cost, opusImagesDelta: 0 }]);
        if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], String(cost));
        else assert.match(res.body(), new RegExp(`"estimatedSpent":${cost}`));
      } finally { await new Promise(resolve => worker.close(resolve)); }
    });
  }
}
