import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { DEFAULT_NAI_RUNTIME, enforceLowConsumptionRequest, handleGenerateRequest, handleGenerateStreamRequest, CloudQueueCoordinator } from './media-gateway.mjs';
import { lowConsumptionViolation } from '../worker/lowConsumptionPolicy.mjs';

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
const request = (key = 'handler-key') => {
  const req = Readable.from([Buffer.from(JSON.stringify(payload()))]);
  req.method = 'POST'; req.headers = { authorization: `Bearer ${key}` };
  req.socket = { remoteAddress: '127.0.0.1' }; req.setTimeout = () => {};
  return req;
};
const idleQueue = () => new CloudQueueCoordinator(() => assert.fail('不能调用公共队列'), 'https://queue.invalid');
for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
  const label = handler === handleGenerateRequest ? 'ZIP' : 'SSE';
  const success = () => new Response(handler === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n');
  const settleGeneration = async () => ({ estimatedCost: 0, anlasBudget: null });
  test(`${label}：校验失败不入队、不生图、不重试，错误后能再次生成`, async () => {
    const res = new Output();
    await handler(request(`failure-${label}`), res, '', 0, idleQueue(), { enabled: true, serviceUrl: 'https://queue.invalid' }, () => assert.fail('不能生图'), {
      settleGeneration, checkLowConsumption: async ({ onEnabled }) => { onEnabled(); throw Object.assign(new Error('限额'), { status: 400 }); },
    });
    assert.equal(res.statusCode, 400);
    const next = new Output();
    await handler(request(`failure-${label}`), next, '', 0, idleQueue(), { enabled: false }, success, { settleGeneration, checkLowConsumption: async ({ onEnabled }) => { onEnabled(); return true; } });
    assert.equal(next.statusCode, 200);
  });
  test(`${label}：同 Key 并发在额度查询前阻止，不同 Key 正常生成，结算完成才解锁`, async () => {
    let complete, started = false;
    const options = { settleGeneration: async () => { started = true; await new Promise(resolve => { complete = resolve; }); return { estimatedCost: 0 }; },
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
