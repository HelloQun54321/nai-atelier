import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { DEFAULT_NAI_RUNTIME, applyNaiRuntimeOverride, cacheNovelAiSubscription, handleGenerateRequest, handleGenerateStreamRequest, handleVibeEncodeRequest, CloudQueueCoordinator } from '../../scripts/media-gateway.mjs';
import { readGenerationResponse } from '../../scripts/generation-output.mjs';
import { GenerationTasks } from '../../worker/generationTasks.mjs';

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
const reply = (res, body, remaining = 1666) => res.end(JSON.stringify({ receiptId: body.receiptId, budget: { remaining } }));
const withoutReceipt = ({ receiptId, ...body }) => body;
const encodingReceipt = (id, informationExtracted = 1) => ({ item: { id,
  encodings: [{ id: 'synthetic-encoding', model: 'nai-diffusion-4-5-full', informationExtracted }] } });
const idleQueue = () => new CloudQueueCoordinator(() => assert.fail('不能调用公共队列'), 'https://queue.invalid');
test('Vibe 编码：成员 Key 走绑定网关，失败不重试，官方 Key 保持原接口；并发不同接入分别计费', async () => {
  const spends = [], saves = [], calls = [], usage = [];
  const worker = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/nai-accounting') { const body = JSON.parse(Buffer.concat(chunks)); usage.push(body); spends.push(body); return reply(res, body, 1664); }
    if (req.url.endsWith('/encoding-result')) { saves.push(JSON.parse(Buffer.concat(chunks))); return res.end(JSON.stringify(encodingReceipt('gateway-vibe'))); }
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
    assert.deepEqual(usage.map(row => [row.action, row.images, row.cost, row.opusImages]), [['encoding', 0, 2, 0], ['encoding', 0, 2, 0]]);
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
    if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
    if (req.url.endsWith('/encoding-result')) { saved++; return res.end(JSON.stringify(encodingReceipt('fixture'))); }
    if (req.url === '/api/nai-accounting') {
      const body = JSON.parse(Buffer.concat(chunks)); usage.push(body); spends.push(body);
      if (scenario === 'accounting-error') { res.statusCode = 500; return res.end('{"error":"synthetic"}'); }
      return reply(res, body, 1664);
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
    assert.deepEqual(spends.map(item => item.cost), [2, 2]);
  } finally { applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing }); await new Promise(resolve => worker.close(resolve)); }
});
for (const invalid of ['empty', 'wrong-asset', 'missing-variant', 'wrong-information']) {
  test(`Vibe 保存回执 ${invalid}：保留付费编码，重试只补保存而不重发或重复记账`, async () => {
    const vibeId = crypto.randomUUID();
    let valid = false, encoded = 0, accounted = 0, saved = 0;
    const worker = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (req.url.endsWith('/image')) return res.end(Buffer.alloc(128, 1));
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/nai-accounting') { accounted++; return reply(res, JSON.parse(Buffer.concat(chunks))); }
      if (req.url.endsWith('/encoding-result')) {
        saved++;
        const receipt = valid ? encodingReceipt(vibeId) : invalid === 'empty' ? {} : invalid === 'wrong-asset'
          ? encodingReceipt('other-asset') : invalid === 'missing-variant' ? { item: { id: vibeId, encodings: [] } } : encodingReceipt(vibeId, 0.5);
        return res.end(JSON.stringify(receipt));
      }
      res.end(JSON.stringify({ item: { id: vibeId, encodings: [] } }));
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    const encode = async () => { encoded++; return new Response(Buffer.alloc(128, 2)); };
    try {
      const first = new Output();
      await handleVibeEncodeRequest(request('synthetic-recovery', { informationExtracted: 1 }), first, '', worker.address().port, vibeId, encode);
      assert.equal(first.statusCode, 503, first.body());
      assert.match(first.body(), /付费编码已由电脑安全保留/);
      valid = true;
      const retry = new Output();
      await handleVibeEncodeRequest(request('synthetic-recovery', { informationExtracted: 1 }), retry, '', worker.address().port, vibeId, encode);
      assert.equal(retry.statusCode, 200, retry.body()); assert.equal(JSON.parse(retry.body()).recovered, true);
      assert.equal(encoded, 1); assert.equal(accounted, 1); assert.equal(saved, 2);
    } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
  });
}

for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
  const label = handler === handleGenerateRequest ? 'ZIP' : 'SSE';
  const success = () => new Response(handler === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n');
  const settleGeneration = async () => ({ estimatedCost: 0, anlasBudget: null });
  const prepareBilling = async () => ({ runtime: DEFAULT_NAI_RUNTIME });
  test(`${label}：本地 503 有限重交同一凭据，始终只生成一次并隐藏私密错误`, async () => {
    const receipts = []; let generated = 0;
    const worker = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.url, '/api/nai-accounting'); receipts.push(JSON.parse(Buffer.concat(chunks)));
      res.statusCode = 503; res.end('{"error":"synthetic-private-key-and-sql"}');
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    try {
      const key = `retry-${label}`; cacheNovelAiSubscription(`Bearer ${key}`, subscription);
      const res = new Output();
      await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async () => { generated++; return success(); }, {});
      assert.equal(generated, 1); assert.equal(receipts.length, 3);
      assert.equal(new Set(receipts.map(item => item.receiptId)).size, 1);
      const message = handler === handleGenerateRequest ? decodeURIComponent(res.headers['X-Nai-Anlas-Accounting-Error']) : res.body();
      assert.match(message, /本地用量结算失败（HTTP 503）/); assert.doesNotMatch(message, /synthetic-private-key-and-sql|Bearer/);
    } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
  });
  test(`${label}：本地事务成功后回执断线，只重交结算，下一张使用新凭据`, async () => {
    const receipts = new Set(), attempts = []; let generated = 0;
    const worker = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); attempts.push(body.receiptId);
      const first = !receipts.has(body.receiptId); receipts.add(body.receiptId);
      if (first) { req.socket.destroy(); return; }
      reply(res, body);
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    try {
      const key = `lost-receipt-${label}`; cacheNovelAiSubscription(`Bearer ${key}`, subscription);
      const tasks = new GenerationTasks({ intervalSeconds: 0 });
      for (let i = 0; i < 2; i++) {
        const res = new Output();
        await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async () => { generated++; return success(); }, { tasks });
        assert.equal(res.statusCode, 200, res.body());
        assert.equal(handler === handleGenerateRequest ? res.headers['X-Nai-Anlas-Accounting-Failed'] : /nai_usage_error/.test(res.body()), handler === handleGenerateRequest ? undefined : false);
      }
      assert.equal(generated, 2); assert.equal(attempts.length, 4); assert.equal(receipts.size, 2);
    } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
  });
  test(`${label}：成功图片独立记 Key、真实模型、费用和额度，未知费用不冒充零且失败不计数`, async () => {
    const usage = [], spends = [];
    let rejectRecord = false, generations = 0;
    const worker = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/nai-accounting') {
        usage.push(body);
        if (rejectRecord) { res.statusCode = 500; return res.end('{"error":"synthetic ledger error"}'); }
        return reply(res, body);
      }
      assert.fail('unexpected worker request');
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
          assert.equal(record.keyHash, createHash('sha256').update(key).digest('hex'));
          assert.equal(record.images, 1); assert.equal(record.model, model);
          assert.equal(Object.hasOwn(record, 'cost'), known);
          if (known) assert.equal(record.cost, 0);
          else { assert.equal(record.cost, undefined); assert.equal(record.opusImages, undefined); }
          if (handler === handleGenerateStreamRequest) {
            assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], known ? String(record.cost) : undefined);
          }
        }
      }
      assert.equal(usage.length, 3); assert.equal(generations, 4);
      assert.equal(usage.filter(item => item.opusImages > 0).length, 1, '只有受限模型免费档计 Opus');
      rejectRecord = true;
      const key = `ledger-error-${label}`;
      cacheNovelAiSubscription(`Bearer ${key}`, subscription);
      const res = new Output();
      await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async () => { generations++; return success(); }, {});
      assert.equal(res.statusCode, 200); assert.equal(generations, 5); assert.equal(usage.length, 4);
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
      const body = JSON.parse(Buffer.concat(chunks)); spends.push(body);
      res.setHeader('Content-Type', 'application/json');
      reply(res, body);
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
        assert.deepEqual(withoutReceipt(spends.at(-1)), { action: 'generation', model: 'nai-diffusion-5-full', images: 1,
          keyHash: createHash('sha256').update(key).digest('hex'), cost: exhausted ? 26 : 0, opusImages: exhausted ? 0 : 1 });
        if (handler === handleGenerateStreamRequest) {
          assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], String(spends.at(-1).cost), '提前保存的费用必须使用本轮快照，与流尾结算一致');
        }
        applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      }
      assert.equal(calls.filter(url => url.endsWith('/user/subscription')).length, 0);
    } finally {
      applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      await new Promise(resolve => worker.close(resolve));
    }
  });
  test(`${label}：免费图生图、普通／聚焦重绘和扩图成功后使用同一 Key 结算`, async () => {
    const spends = [];
    const worker = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); spends.push(body);
      res.setHeader('Content-Type', 'application/json');
      reply(res, body);
    });
    worker.listen(0, '127.0.0.1');
    await once(worker, 'listening');
    try {
      for (const operation of ['img2img', 'infill', 'focused', 'outpaint']) {
        const action = operation === 'img2img' ? 'img2img' : 'infill';
        const key = `free-edit-${label}-${operation}`, res = new Output();
        const body = payload({ image: 'fake', strength: 0.7,
          ...(action === 'infill' ? { mask: 'fake', inpaintImg2ImgStrength: 1, _local_focused_inpainting: operation === 'focused',
            ...(operation === 'outpaint' ? { _local_edit_operation: 'outpaint' } : {}) } : {}) },
        { action, model: action === 'infill' ? 'nai-diffusion-5-full-inpainting' : 'nai-diffusion-5-full' });
        cacheNovelAiSubscription(`Bearer ${key}`, subscription);
        await handler(request(key, body), res, '', worker.address().port, idleQueue(), { enabled: false },
          async url => url.endsWith('/user/subscription') ? json(subscription) : success(), {});
        assert.equal(res.statusCode, 200);
        assert.deepEqual(withoutReceipt(spends.at(-1)), { action: 'generation', model: body.model, images: 1, keyHash: createHash('sha256').update(key).digest('hex'), cost: 0, opusImages: 1 });
        if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], '0');
        else assert.match(res.body(), /"estimatedSpent":0/);
      }
    } finally { await new Promise(resolve => worker.close(resolve)); }
  });
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full']) {
    test(`${label} ${model}：普通模式允许过期订阅请求，成功按当前 Key 记付费点数，不记 Opus 用量`, async () => {
      const spends = [], calls = [];
      const worker = createServer(async (req, res) => {
        assert.equal(req.url, '/api/nai-accounting');
        assert.equal(req.method, 'POST');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks)); spends.push(body);
        res.setHeader('Content-Type', 'application/json');
        reply(res, body, 1646);
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
        assert.deepEqual(spends.map(withoutReceipt), [{ action: 'generation', model, images: 1, keyHash: createHash('sha256').update(key).digest('hex'), cost, opusImages: 0 }]);
        if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], String(cost));
        else assert.match(res.body(), new RegExp(`"estimatedSpent":${cost}`));
      } finally { await new Promise(resolve => worker.close(resolve)); }
    });
  }
}

test('SSE 上游交付最终图片后断开仍完成一次本地记账，未交付 final 不记账', async () => {
  let settlements = 0, generations = 0;
  for (const final of [true, false]) {
    const res = new Output();
    await handleGenerateStreamRequest(request(`late-close-${final}`), res, '', 0, idleQueue(), { enabled: false }, async () => {
      generations++;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: ${final ? 'final' : 'intermediate'}\ndata: {"image":"fake"}\n\n`));
        setTimeout(() => controller.error(new Error('synthetic upstream disconnect')), 0);
      } }));
    }, { prepareBilling: async () => ({}), settleGeneration: async () => { settlements++; return { estimatedCost: 0 }; } });
    if (final) { assert.match(res.body(), /event: nai_usage\n/); assert.doesNotMatch(res.body(), /event: error\n/); }
    else assert.match(res.body(), /event: error\n/);
  }
  assert.equal(settlements, 1); assert.equal(generations, 2);
});

test('SSE final 在正常 EOF 前没有空行时，追加记账帧仍与图片正确分开', async () => {
  const res = new Output(); let settlements = 0;
  await handleGenerateStreamRequest(request('final-without-delimiter'), res, '', 0, idleQueue(), { enabled: false }, async () => new Response('event: final\ndata: {"image":"ZmFrZQ=="}'),
    { prepareBilling: async () => ({}), settleGeneration: async () => { settlements++; return { estimatedCost: 0 }; } });
  const decoded = await readGenerationResponse(new Response(res.body(), { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.equal(decoded.bytes.toString(), 'fake'); assert.equal(decoded.estimatedCost, 0); assert.equal(decoded.accountingFailed, false); assert.equal(settlements, 1);
});
