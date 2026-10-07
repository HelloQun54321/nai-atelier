import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { DEFAULT_NAI_RUNTIME, applyNaiRuntimeOverride, enforceLowConsumptionRequest, handleGenerateRequest, handleGenerateStreamRequest, handleVibeEncodeRequest, CloudQueueCoordinator } from '../../scripts/media-gateway.mjs';
import { lowConsumptionViolation } from '../../worker/lowConsumptionPolicy.mjs';

// 全部请求、额度和预算都注入模拟值，不访问真实 NovelAI、公共队列或私人数据库。
const runtime = { ...DEFAULT_NAI_RUNTIME, health: { ok: true } };
const subscription = { active: true, tier: 3, usage: { percent: 30, isNegative: false } };
const json = value => new Response(JSON.stringify(value));
const base = { operation: 'text-to-image', model: 'nai-diffusion-5-full', steps: 23, freeMaxSteps: 28,
  width: 832, height: 1216, freeMaxArea: 1048576, referenceCount: 0, vibeCount: 0, focused: false,
  estimatedCost: 0, runtimeHealthy: true, subscriptionKnown: true, usageLimited: true, usageExhausted: false };
const payload = (parameters = {}, extra = {}) => ({ action: 'generate', model: 'nai-diffusion-5-full',
  parameters: { steps: 23, width: 832, height: 1216, n_samples: 1, ...parameters }, ...extra });
const check = (body = payload(), options = {}) => enforceLowConsumptionRequest({ payload: body, authorization: 'Bearer fake-key', keyHash: 'fake-hash', req: {}, workerPort: 0,
  runtime, loadPreferences: async () => ({ enabled: true }), requestRemote: async () => json(subscription), ...options });

test('只允许文生图／Focused 零点数请求，图生图与扩图无论费用均关闭', () => {
  for (const operation of ['text-to-image', 'inpaint']) {
    const values = { ...base, operation, focused: operation === 'inpaint', estimatedCost: 0 };
    assert.equal(lowConsumptionViolation(values), null);
    assert.match(lowConsumptionViolation({ ...values, estimatedCost: 1 }), /只允许零点数/);
  }
  for (const operation of ['image-to-image', 'outpaint']) {
    assert.match(lowConsumptionViolation({ ...base, operation, estimatedCost: 0 }), /已关闭/);
    assert.match(lowConsumptionViolation({ ...base, operation, estimatedCost: 50 }), /已关闭/);
  }
});
test('未知规则、费用、额度，付费参考、5 个 Vibe 和非 Focused 重绘不能放行', () => {
  for (const extra of [{ runtimeHealthy: false }, { subscriptionKnown: false }, { estimatedCost: NaN }, { usageExhausted: true },
    { referenceCount: 1 }, { vibeCount: 5 }, { operation: 'inpaint' }, { width: -832 }, { operation: 'unknown' }]) {
    assert.ok(lowConsumptionViolation({ ...base, ...extra }));
  }
  assert.equal(lowConsumptionViolation({ ...base, vibeCount: 4 }), null);
  assert.equal(lowConsumptionViolation({ ...base, model: 'nai-diffusion-4-5-full', usageLimited: false, usageExhausted: true, steps: 28 }), null);
});
test('网关从真实请求形态核算，而非信任客户端免费标签或费用', async () => {
  assert.equal(await check(), true);
  assert.equal(await check(payload(), { loadPreferences: async () => ({ enabled: false }), requestRemote: () => assert.fail('关闭时不查询订阅') }), false);
  await assert.rejects(check(payload({ steps: 28 })), /23 步/);
  await assert.rejects(check(payload({ reference_image_multiple_cached: Array(5).fill('cached') })), /4 个/);
  await assert.rejects(check(payload({ _local_character_references: { enabled: true, slots: [{}] } })), /参考已暂停/);
  await assert.rejects(check(payload({ n_samples: 2 })), /零点数|一张/);
  await assert.rejects(check(payload(), { requestRemote: async () => json({ active: true, tier: 2 }) }), /订阅|无法确认/);
  await assert.rejects(check(payload(), { requestRemote: async () => json({ active: true, tier: 3 }) }), /无法确认/);
  await assert.rejects(check(payload(), { requestRemote: async () => { throw new Error('offline'); } }), /无法确认/);
  await assert.rejects(check(payload(), { requestRemote: async () => json({ ...subscription, usage: { percent: 0, isNegative: false } }) }), /额度已用尽/);
});

test('订阅过期且有 Paid Anlas：低消耗明确拒绝付费，普通模式检查放行', async () => {
  const options = { requestRemote: async () => json({ active: false, tier: 0, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 }, usage: { percent: 100 } }) };
  await assert.rejects(check(payload(), options), /订阅已过期.*关闭低消耗/);
  assert.equal(await check(payload(), { ...options, loadPreferences: async () => ({ enabled: false }) }), false);
});
test('隐藏模式在订阅／生图请求前就拒绝，关闭开关则完整放行普通编辑', async () => {
  for (const body of [payload({ image: 'image', strength: 1 }, { action: 'img2img' }),
    payload({ image: 'image', mask: 'mask', width: 2048, height: 2048, steps: 40, _local_edit_operation: 'outpaint' }, { action: 'infill' })]) {
    await assert.rejects(check(body, { requestRemote: () => assert.fail('不能请求订阅或生图') }), /已关闭图生图和扩图/);
    assert.equal(await check(body, { loadPreferences: async () => ({ enabled: false }), requestRemote: () => assert.fail('普通模式不使用低消耗检查') }), false);
  }
  const focused = payload({ image: 'image', mask: 'mask', _local_edit_operation: 'inpaint', _local_focused_inpainting: true }, { action: 'infill' });
  assert.equal(await check(focused), true);
  await assert.rejects(check({ ...focused, parameters: { ...focused.parameters, _local_focused_inpainting: false } }), /Focused/);
});

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
test('Vibe 编码费用上限、重复复用与生成前单价一致，记账失败仍保存编码', async () => {
  let scenario, encoded = 0, saved = 0;
  const spends = [];
  const worker = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
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
    for (scenario of ['changed', 'normal', 'accounting-error', 'cached']) {
      applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      const res = new Output();
      await handleVibeEncodeRequest(request(`encode-${scenario}`, { informationExtracted: 1 }, scenario === 'changed' ? 1 : 2), res, '', worker.address().port, 'fixture', async () => {
        encoded++;
        applyNaiRuntimeOverride({ billing: { ...DEFAULT_NAI_RUNTIME.billing, vibeEncodingCost: 6 } });
        return new Response(Buffer.alloc(128, 2));
      });
      const result = JSON.parse(res.body());
      assert.equal(res.statusCode, scenario === 'changed' ? 409 : 200);
      if (scenario === 'changed') assert.equal(result.code, 'BILLING_COST_CHANGED');
      if (scenario === 'accounting-error') assert.equal(result.anlasAccountingFailed, true);
      if (scenario === 'cached') assert.equal(result.duplicate, true);
    }
    assert.equal(encoded, 2); assert.equal(saved, 2);
    assert.deepEqual(spends.map(item => item.amount), [2, 2]);
  } finally { applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing }); await new Promise(resolve => worker.close(resolve)); }
});
for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
  const label = handler === handleGenerateRequest ? 'ZIP' : 'SSE';
  const success = () => new Response(handler === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n');
  const settleGeneration = async () => ({ estimatedCost: 0, anlasBudget: null });
  const prepareBilling = async () => ({ runtime: DEFAULT_NAI_RUNTIME });
  test(`${label}：上游成功后本地记账失败仍交付成品，并单独提示费用异常，不重试`, async () => {
    let generations = 0;
    const res = new Output();
    await handler(request(`accounting-${label}`), res, '', 0, idleQueue(), { enabled: false }, async () => { generations++; return success(); },
      { prepareBilling, checkLowConsumption: async () => false, settleGeneration: async () => { throw new Error('synthetic accounting failure'); } });
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
  test(`${label}：排队后费用超过确认值即停止提交，释放队列，不能静默从免费转付费`, async () => {
    let released = 0, queried = 0;
    const q = new CloudQueueCoordinator(async url => {
      if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
      if (url.endsWith('/complete')) released++;
      return json({ status: 'ok' });
    }, 'https://queue.invalid');
    const res = new Output();
    await handler(request(`changed-${label}`, payload(), 0), res, '', 0, q, { enabled: true, serviceUrl: 'https://queue.invalid' }, async url => {
      assert.ok(url.endsWith('/user/subscription'), '未重新确认不得生图'); queried++;
      return json({ ...subscription, usage: { percent: 0, isNegative: true } });
    }, { checkLowConsumption: async () => false, settleGeneration: async () => assert.fail('未生成不得结算') });
    assert.equal(res.statusCode, 409);
    assert.match(res.body(), /BILLING_COST_CHANGED/);
    assert.equal(queried, 1); assert.equal(released, 1);
  });
  test(`${label}：零点数且不计 Opus 的 V4.5 成功请求仍返回准确费用，不依赖预算扣减`, async () => {
    const res = new Output();
    await handler(request(`zero-${label}`, payload({}, { model: 'nai-diffusion-4-5-full' }), 0), res, '', 0, idleQueue(), { enabled: false },
      async url => url.endsWith('/user/subscription') ? json(subscription) : success(), { checkLowConsumption: async () => false });
    assert.equal(res.statusCode, 200);
    if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], '0');
    else assert.match(res.body(), /"estimatedSpent":0/);
  });
  test(`${label}：生成前捕获额度和规则，最后一张免费图不被生成后的透支或新倍率改写`, async () => {
    const spends = [], calls = [];
    const worker = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      spends.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remaining: 1666 }));
    });
    worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
    try {
      for (const exhausted of [false, true]) {
        let generated = false;
        const res = new Output(), key = `boundary-${label}-${exhausted}`;
        await handler(request(key), res, '', worker.address().port, idleQueue(), { enabled: false }, async url => {
          calls.push(url);
          if (url.endsWith('/user/subscription')) {
            assert.equal(generated, false, '订阅必须在生成前读取');
            return json({ ...subscription, usage: { percent: exhausted ? 0 : 0.01, isNegative: exhausted } });
          }
          generated = true;
          applyNaiRuntimeOverride({ billing: { ...DEFAULT_NAI_RUNTIME.billing, modelMultipliers: { v5: 3 } } });
          return success();
        }, { checkLowConsumption: async () => false });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(spends.at(-1), { amount: exhausted ? 26 : 0, reason: 'generation',
          keyHash: createHash('sha256').update(key).digest('hex'), anlasDelta: exhausted ? 26 : 0, opusImagesDelta: exhausted ? 0 : 1 });
        applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      }
      assert.equal(calls.filter(url => url.endsWith('/user/subscription')).length, 2);
    } finally {
      applyNaiRuntimeOverride({ billing: DEFAULT_NAI_RUNTIME.billing });
      await new Promise(resolve => worker.close(resolve));
    }
  });
  test(`${label}：普通模式费用状态未知时拒绝提交，不用旧值或生成后的额度猜测`, async () => {
    for (const value of [null, {}, { active: true, tier: 3 }, { active: true, tier: 3, usage: { percent: 50 } }]) {
      const res = new Output();
      await handler(request(`unknown-${label}`), res, '', 0, idleQueue(), { enabled: false }, async url => {
        assert.ok(url.endsWith('/user/subscription'), '未知状态不能提交付费生图');
        return json(value);
      }, { checkLowConsumption: async () => false });
      assert.equal(res.statusCode, 503);
      assert.match(res.body(), /本次未提交生图/);
    }
  });
  test(`${label}：免费图生图与普通重绘不扣本地 Anlas，成功才按当前 Key 记录 Opus`, async () => {
    const spends = [];
    const worker = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
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
        await handler(request(key, body), res, '', worker.address().port, idleQueue(), { enabled: false },
          async url => url.endsWith('/user/subscription') ? json(subscription) : success(), { checkLowConsumption: async () => false });
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
        await handler(request(key, payload({ steps: 28 }, { model })), res, '', worker.address().port, idleQueue(), { enabled: false }, async url => {
          calls.push(url);
          if (url.endsWith('/user/subscription')) return json({ active: false, tier: 3, usage: { percent: 100, isNegative: false }, trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 420 } });
          assert.match(url, /\/ai\/generate-image(?:-stream)?$/);
          return success();
        }, { checkLowConsumption: async () => false });
        assert.equal(res.statusCode, 200);
        assert.equal(calls.filter(url => url.endsWith('/user/subscription')).length, 1);
        assert.equal(calls.filter(url => url.includes('/ai/generate-image')).length, 1);
        const cost = /^nai-diffusion-5-/.test(model) ? 30 : 20;
        assert.deepEqual(spends, [{ amount: cost, reason: 'generation', keyHash: createHash('sha256').update(key).digest('hex'), anlasDelta: cost, opusImagesDelta: 0 }]);
        if (handler === handleGenerateRequest) assert.equal(res.headers['X-Nai-Anlas-Estimated-Spent'], String(cost));
        else assert.match(res.body(), new RegExp(`"estimatedSpent":${cost}`));
      } finally { await new Promise(resolve => worker.close(resolve)); }
    });
  }
  test(`${label}：校验失败不入队、不生图、不重试，错误后能再次生成`, async () => {
    const res = new Output();
    await handler(request(`failure-${label}`), res, '', 0, idleQueue(), { enabled: true, serviceUrl: 'https://queue.invalid' }, () => assert.fail('不能生图'), {
      prepareBilling, settleGeneration, checkLowConsumption: async ({ onEnabled }) => { onEnabled(); throw Object.assign(new Error('限额'), { status: 400 }); },
    });
    assert.equal(res.statusCode, 400);
    const next = new Output();
    await handler(request(`failure-${label}`), next, '', 0, idleQueue(), { enabled: false }, success, { prepareBilling, settleGeneration, checkLowConsumption: async ({ onEnabled }) => { onEnabled(); return true; } });
    assert.equal(next.statusCode, 200);
  });
  test(`${label}：同 Key 并发在额度查询前阻止，不同 Key 正常生成，结算完成才解锁`, async () => {
    let complete, started = false;
    const options = { prepareBilling, settleGeneration: async () => { started = true; await new Promise(resolve => { complete = resolve; }); return { estimatedCost: 0 }; },
      checkLowConsumption: async ({ onEnabled }) => { onEnabled(); return true; } };
    const first = handler(request(`concurrent-${label}`), new Output(), '', 0, idleQueue(), { enabled: false }, success, options);
    while (!started) await new Promise(resolve => setTimeout(resolve, 1));
    const blocked = new Output();
    await handler(request(`concurrent-${label}`), blocked, '', 0, idleQueue(), { enabled: false }, () => assert.fail('同 Key 不能并发'), options);
    assert.equal(blocked.statusCode, 409);
    const other = new Output();
    await handler(request(`other-${label}`), other, '', 0, idleQueue(), { enabled: false }, success, { ...options, settleGeneration });
    assert.equal(other.statusCode, 200);
    complete(); await first;
    const next = new Output();
    await handler(request(`concurrent-${label}`), next, '', 0, idleQueue(), { enabled: false }, success, { ...options, settleGeneration });
    assert.equal(next.statusCode, 200);
  });
  test(`${label}：排队后零点数条件变化，释放许可且不生成`, async () => {
    let checks = 0, released = 0;
    const q = new CloudQueueCoordinator(async url => {
      if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
      if (url.endsWith('/complete')) released++;
      return json({ status: 'ok' });
    }, 'https://queue.invalid');
    const res = new Output();
    await handler(request(`queued-${label}`), res, '', 0, q, { enabled: true, serviceUrl: 'https://queue.invalid' }, () => assert.fail('排队后不能放行'), {
      settleGeneration, checkLowConsumption: async ({ onEnabled, forceEnabled }) => {
        onEnabled();
        if (++checks === 2) { assert.equal(forceEnabled, true); throw Object.assign(new Error('额度不足'), { status: 400 }); }
        return true;
      },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(checks, 2);
    assert.equal(released, 1);
  });
}
