import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { DEFAULT_NAI_RUNTIME, CloudQueueCoordinator, handleGenerateRequest, handleGenerateStreamRequest, buildCachedVibeReferences, generateWithVibeCacheRetry } from '../../scripts/media-gateway.mjs';
import { normalizeCloudQueueCount } from '../../worker/cloudQueueNumbers.mjs';
import { getCloudQueueGenerationUrl } from '../../worker/cloudQueueTarget.mjs';
import { GenerationTasks } from '../../worker/generationTasks.mjs';
import JSZip from 'jszip';
import { readGenerationResponse } from '../../scripts/generation-output.mjs';

// 只使用模拟外部请求和注入的结算函数，不启动真实网关、不读取或改写私人数据。
const preferences = { enabled: true, serviceUrl: 'https://queue.example', greeting: '', showGreeting: true };
// 公共队列记录按 Key 指纹 + taskId 组合隔离；合成请求统一使用 'Bearer test-key'。
const testKeyHash = createHash('sha256').update('test-key').digest('hex');
const json = value => new Response(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const handlers = [handleGenerateRequest, handleGenerateStreamRequest];
const modes = ['generate', 'img2img', 'infill', 'outpaint'];
const payload = action => ({ model: 'nai-diffusion-4-5-full', action: action === 'outpaint' ? 'infill' : action, parameters: {
  ...(action === 'outpaint' ? { _local_edit_operation: 'outpaint' } : {}),
} });
const requestFor = (taskId, action = 'generate', body = payload(action)) => {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { authorization: 'Bearer test-key', 'x-nai-queue-task-id': taskId };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.setTimeout = () => {};
  return req;
};
class TestResponse extends Writable {
  constructor() { super(); this.headers = {}; this.statusCode = 0; this.headersSent = false; this.chunks = []; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers) { this.statusCode = status; Object.entries(headers).forEach(([name, value]) => this.setHeader(name, value)); this.headersSent = true; }
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  body() { return Buffer.concat(this.chunks).toString(); }
}
const setup = (remote, options = {}) => new CloudQueueCoordinator(remote, preferences.serviceUrl, { pollIntervalMs: 5, waitTimeoutMs: 2000, ...options });
const generationOptions = { tasks: new GenerationTasks({ intervalSeconds: 0 }), prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }), settleGeneration: async () => ({ estimatedCost: 0, anlasBudget: null }), };
const finalFrame = 'event: final\ndata: {"image":"test"}\n\n';
const run = (handler, q, remote, taskId, res = new TestResponse(), options = {}, action = 'generate', taskPreferences = preferences) => ({
  res,
  pending: handler(requestFor(taskId, action), res, '', 0, q, taskPreferences, remote, { ...generationOptions, ...options }),
});
const waitUntil = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await sleep(5); }
  assert.fail('模拟任务未达到预期状态');
};

for (const member of [false, true]) test(`后台 ZIP 提前 final，记账与清理回执收齐前保留锁，成员网关=${member}`, async () => {
  let settleStarted = false, finishSettlement, finishCleanup, cleanupStarted = false, requests = 0;
  const settlement = new Promise(resolve => { finishSettlement = resolve; });
  const cleanup = new Promise(resolve => { finishCleanup = resolve; });
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
    if (url.endsWith('/complete')) { cleanupStarted = true; await cleanup; }
    return json({ status: 'ok' });
  });
  const zip = new JSZip(); zip.file('result.png', Buffer.from('synthetic-image')); zip.file('metadata.json', '{"seed":42}');
  const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), token = 'synthetic-early-zip-0001';
  tasks.reserve(testKeyHash, token);
  const req = requestFor('early-zip-task');
  req.headers['x-nai-generation-task'] = token; req.headers['x-nai-generation-response'] = 'events';
  const res = new TestResponse();
  const pending = (member ? handleGenerateStreamRequest : handleGenerateRequest)(req, res, '', 0, q, preferences, async url => {
    requests++; assert.equal(url, member ? 'https://member.example/ai/generate-image' : 'https://image.novelai.net/ai/generate-image');
    return new Response(zipped);
  }, { ...generationOptions, tasks, gatewayUrl: member ? 'https://member.example' : '', settleGeneration: async () => { settleStarted = true; await settlement; return { estimatedCost: 3, accountingFailed: true, accountingError: 'synthetic accounting' }; } });
  await waitUntil(() => settleStarted);
  assert.match(res.body(), /event: final/); assert.doesNotMatch(res.body(), /nai_usage/);
  assert.equal(res.writableEnded, false); assert.equal(tasks.current(testKeyHash).inFlight, true);
  finishSettlement();
  if (!member) {
    await waitUntil(() => cleanupStarted);
    assert.match(res.body(), /nai_usage/); assert.equal(res.writableEnded, false);
    assert.equal(tasks.current(testKeyHash).inFlight, true);
  }
  finishCleanup(); await pending;
  const output = await readGenerationResponse(new Response(res.body(), { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.equal(output.seed, 42); assert.equal(output.bytes.toString(), 'synthetic-image');
  assert.equal(output.accountingError, 'synthetic accounting'); assert.equal(requests, 1);
  assert.equal(tasks.current(testKeyHash).inFlight, false);
});

test('后台 ZIP 解析失败也完成一次记账和队列清理，不重新生图', async () => {
  let settlements = 0, releases = 0, requests = 0;
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
    if (url.endsWith('/complete')) releases++;
    return json({ status: 'ok' });
  });
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), token = 'synthetic-invalid-zip-0001'; tasks.reserve(testKeyHash, token);
  const req = requestFor('invalid-zip-task'); req.headers['x-nai-generation-task'] = token; req.headers['x-nai-generation-response'] = 'events';
  const res = new TestResponse();
  await handleGenerateRequest(req, res, '', 0, q, preferences, async () => { requests++; return new Response('invalid zip'); }, {
    ...generationOptions, tasks, settleGeneration: async () => { settlements++; return { estimatedCost: 2 }; },
  });
  assert.equal(requests, 1); assert.equal(settlements, 1); assert.equal(releases, 1);
  assert.match(res.body(), /event: nai_usage/); assert.match(res.body(), /generation_output_invalid/);
  await assert.rejects(readGenerationResponse(new Response(res.body(), { headers: { 'Content-Type': 'text/event-stream' } })), { code: 'generation_output_invalid' });
});

test('公开 ZIP 不因单独协商头改变格式，仍携带结算头部和原始字节', async () => {
  let settleStarted = false, finishSettlement;
  const settlement = new Promise(resolve => { finishSettlement = resolve; });
  const req = requestFor('public-zip-task'); req.headers['x-nai-generation-response'] = 'events';
  const res = new TestResponse(), bytes = Buffer.from('original zip bytes');
  const pending = handleGenerateRequest(req, res, '', 0, setup(async () => json({})), { enabled: false }, async () => new Response(bytes, { headers: { 'Content-Type': 'application/zip' } }), {
    ...generationOptions, tasks: new GenerationTasks({ intervalSeconds: 0 }),
    settleGeneration: async () => { settleStarted = true; await settlement; return { estimatedCost: 7, accountingFailed: true, accountingError: 'synthetic accounting' }; },
  });
  await waitUntil(() => settleStarted); assert.equal(res.headersSent, false); assert.equal(res.body(), '');
  finishSettlement(); await pending;
  assert.deepEqual(Buffer.concat(res.chunks), bytes); assert.equal(res.headers['content-type'], 'application/zip');
  assert.equal(res.headers['x-nai-anlas-accounting-failed'], '1'); assert.equal(res.headers['x-nai-anlas-estimated-spent'], '7');
});

test('通用中转识别任意域名、端口与前缀，只接受明确的兼容生图接口', () => {
  for (const prefix of ['https://nai.ry.mk', 'https://relay.example/v1', 'http://127.0.0.1:8199/prefix']) {
    for (const suffix of ['/ai/generate-image', '/ai/generate-image/', '/ai/generate-image-stream']) {
      assert.equal(getCloudQueueGenerationUrl(prefix + suffix), prefix + '/ai/generate-image');
      assert.equal(getCloudQueueGenerationUrl(prefix + suffix, true), prefix + '/ai/generate-image-stream');
    }
  }
  for (const value of ['', 'invalid', 'https://st-chatu-novelai-queue.hf.space/', 'https://relay.example/v1',
    'https://relay.example/ai/generate-image-extra', 'https://user:pass@relay.example/ai/generate-image',
    'https://relay.example/ai/generate-image?key=synthetic', 'https://relay.example/ai/generate-image#fragment',
    'ftp://relay.example/ai/generate-image']) assert.equal(getCloudQueueGenerationUrl(value), null, value);
});

const proxyPreferences = { ...preferences, serviceUrl: 'https://relay.example/prefix/ai/generate-image/' };
for (const wrapped of [false, true]) test(`流式上游502错误网页（JSON包装=${wrapped}）不会进入排队状态或错误响应，不结算或重试`, async () => {
  const html = '<!DOCTYPE html><html><title>502 Bad Gateway</title><body>synthetic-ray</body></html>';
  const q = setup(async () => assert.fail('中转不得调用独立队列'));
  const taskId = `html-error-${wrapped}`; let calls = 0;
  const { pending, res } = run(handleGenerateStreamRequest, q, async () => {
    calls++; return new Response(wrapped ? JSON.stringify({ error: html, code: 'UPSTREAM_DOWN' }) : html, { status: 502 });
  }, taskId, undefined, { settleGeneration: () => assert.fail('失败不结算') }, 'generate', proxyPreferences);
  await pending;
  assert.equal(calls, 1); assert.equal(res.statusCode, 502);
  const payload = JSON.parse(res.body());
  assert.equal(payload.error, '服务暂时不可用 (HTTP 502)，请稍后重试');
  if (wrapped) assert.equal(payload.code, 'UPSTREAM_DOWN');
  assert.equal(q.get(testKeyHash, taskId).error, payload.error);
  assert.equal(q.get(testKeyHash, taskId).phase, 'error'); assert.equal(q.get(testKeyHash, taskId).controller, null);
  assert.doesNotMatch(res.body(), /DOCTYPE|synthetic-ray|<html/);
});

for (const handler of handlers) {
  for (const action of modes) {
    test(`成员网关 ${handler === handleGenerateRequest ? 'ZIP' : '预览入口'} ${action}：Medium 参数原样透传，一次请求普通 ZIP`, async () => {
      const body = payload(action);
      body.model = `nai-diffusion-5-full-medium${action === 'infill' || action === 'outpaint' ? '-inpainting' : ''}`;
      Object.assign(body.parameters, { stream: true, width: 832, height: 1216, steps: 14, sampler: 'k_euler_ancestral', seed: 123,
        image: action === 'generate' ? undefined : 'synthetic-image', mask: action === 'infill' || action === 'outpaint' ? 'synthetic-mask' : undefined,
        reference_image_multiple: ['synthetic-vibe'], reference_information_extracted_multiple: [1], reference_strength_multiple: [0.6] });
      const expected = structuredClone(body);
      delete expected.parameters.stream; delete expected.parameters._local_edit_operation;
      const req = requestFor(`member-${action}`, action, body);
      req.headers.authorization = 'Bearer STA1N-synthetic';
      const res = new TestResponse(); let calls = 0, settled = 0;
      await handler(req, res, '', 0, setup(() => assert.fail('成员网关不能调用旧队列')), proxyPreferences, async (url, options) => {
        calls++; assert.equal(url, 'https://gateway.example/v1/ai/generate-image');
        assert.equal(options.headers.Authorization, 'Bearer STA1N-synthetic');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), JSON.parse(JSON.stringify(expected)));
        return new Response('synthetic-zip', { headers: { 'Content-Type': 'application/zip' } });
      }, { ...generationOptions, gatewayUrl: 'https://gateway.example/v1', settleGeneration: async () => { settled++; return { estimatedCost: 0 }; } });
      assert.equal(res.statusCode, 200, res.body());
      assert.equal(res.headers['content-type'], 'application/zip');
      assert.equal(res.body(), 'synthetic-zip'); assert.equal(calls, 1); assert.equal(settled, 1);
    });
  }
  for (const status of [401, 402, 403, 429, 500]) {
    test(`成员网关拒绝 ${status} 不重试、不回退、不结算`, async () => {
      const res = new TestResponse(); let calls = 0;
      await handler(requestFor(`member-denied-${status}`), res, '', 0, setup(() => assert.fail('不可进入旧队列')), { enabled: false },
        async url => { calls++; assert.equal(url, 'https://gateway.example/ai/generate-image'); return new Response('member denied', { status }); },
        { ...generationOptions, gatewayUrl: 'https://gateway.example', settleGeneration: () => assert.fail('失败不能结算') });
      assert.equal(res.statusCode, status); assert.equal(calls, 1);
    });
  }
}
for (const handler of handlers) {
  const label = handler === handleGenerateRequest ? 'normal' : 'stream';
  for (const action of modes) {
    test(`${label} ${action}：通用中转直接提交完整请求，由服务端排队，不调用 HF 协议`, async () => {
      const q = setup(async () => assert.fail('中转不得调用独立队列接口'));
      const taskId = `proxy-${label}-${action}`;
      let calls = 0, settled = 0;
      const { pending, res } = run(handler, q, async (url, options) => {
        calls++;
        assert.equal(url, 'https://relay.example/prefix/ai/generate-image' + (label === 'stream' ? '-stream' : ''));
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.action, action === 'outpaint' ? 'infill' : action);
        assert.equal(body.model, payload(action).model);
        assert.equal(body.parameters._local_edit_operation, undefined);
        assert.equal(q.get(testKeyHash, taskId).proxy, true);
        assert.equal(q.get(testKeyHash, taskId).phase, 'waiting');
        assert.equal(q.get(testKeyHash, taskId).position, null);
        assert.equal(q.get(testKeyHash, taskId).queueSize, null);
        return new Response(label === 'stream' ? finalFrame : 'synthetic-image');
      }, taskId, undefined, { settleGeneration: async ({ keyHash }) => {
        settled++;
        assert.match(keyHash, /^[a-f0-9]{64}$/);
        return { estimatedCost: 0, anlasBudget: null };
      } }, action, proxyPreferences);
      await pending;
      assert.equal(calls, 1); assert.equal(settled, 1);
      assert.equal(res.statusCode, 200);
      assert.match(res.body(), label === 'stream' ? /event: final/ : /synthetic-image/);
      assert.equal(q.get(testKeyHash, taskId).phase, 'completed');
      assert.equal(q.get(testKeyHash, taskId).controller, null);
    });
  }

  test(`${label}：关闭中转后仍使用官方接口，不触发队列请求`, async () => {
    const q = setup(async () => assert.fail('关闭队列时不能调用队列'));
    const { pending, res } = run(handler, q, async url => {
      assert.equal(url, 'https://image.novelai.net/ai/generate-image' + (label === 'stream' ? '-stream' : ''));
      return new Response(label === 'stream' ? finalFrame : 'image');
    }, `proxy-off-${label}`, undefined, {}, 'generate', { ...proxyPreferences, enabled: false });
    await pending; assert.equal(res.statusCode, 200);
  });

  for (const status of [401, 429, 500]) {
    test(`${label}：中转 ${status} 不结算、不重试、不回退官方`, async () => {
      let calls = 0;
      const q = setup(async () => assert.fail('不应调用队列服务'));
      const { pending, res } = run(handler, q, async () => { calls++; return new Response('synthetic rejection', { status }); },
        `proxy-rejected-${label}-${status}`, undefined, { settleGeneration: () => assert.fail('失败不得结算') }, 'generate', proxyPreferences);
      await pending;
      assert.equal(calls, 1); assert.equal(res.statusCode, status);
      assert.equal(q.get(testKeyHash, `proxy-rejected-${label}-${status}`).phase, 'error');
    });
  }

  for (const cancel of [false, true]) {
    test(`${label}：中转${cancel ? '停止等待' : '超时'}中断同一请求，不结算、不重新发起`, async () => {
      const taskId = `proxy-abort-${label}-${cancel}`;
      const q = setup(async () => assert.fail('中转不退出独立队列'));
      let calls = 0;
      const { pending, res } = run(handler, q, async (url, options) => {
        calls++;
        assert.equal(q.get(testKeyHash, taskId).cancelable, true);
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }, taskId, undefined, { generationTimeoutMs: cancel ? 2000 : 20, settleGeneration: () => assert.fail('失败或停止不得结算') }, 'generate', proxyPreferences);
      await waitUntil(() => calls === 1);
      if (cancel) q.get(testKeyHash, taskId).controller.abort(new DOMException('用户停止等待', 'AbortError'));
      await pending;
      assert.equal(calls, 1); assert.equal(res.statusCode, cancel ? 499 : 504);
      assert.equal(q.get(testKeyHash, taskId).phase, cancel ? 'cancelled' : 'error');
    });
  }

  test(`${label}：中转停止等待后迟到的成功响应不能交付或结算`, async () => {
    const taskId = `proxy-late-${label}`;
    const q = setup(async () => assert.fail('中转不调用队列'));
    const { pending, res } = run(handler, q, async () => {
      q.get(testKeyHash, taskId).controller.abort(new DOMException('停止等待', 'AbortError'));
      return new Response(label === 'stream' ? finalFrame : 'late-image');
    }, taskId, undefined, { settleGeneration: () => assert.fail('停止后不得结算') }, 'generate', proxyPreferences);
    await pending;
    assert.equal(res.statusCode, 499); assert.equal(q.get(testKeyHash, taskId).phase, 'cancelled');
    assert.doesNotMatch(res.body(), /event: final|late-image/);
  });
}

test('中转完整发送已在官方缓存的 Vibe 编码，缓存拒绝不重发生图', async () => {
  const encoding = 'synthetic-encoded-vibe'.repeat(10);
  const refs = buildCachedVibeReferences([encoding]);
  await generateWithVibeCacheRetry({ parameters: { reference_image_multiple_cached: refs } }, 'Bearer synthetic', [encoding],
    new Set(refs.map(item => item.cache_secret_key)), async () => new Response('image'));
  assert.equal(buildCachedVibeReferences([encoding])[0].data, undefined);
  const worker = createServer((req, res) => {
    assert.match(req.url, /^\/api\/vibes\/synthetic-vibe\/encodings\/synthetic-encoding\/data$/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ variant: { model: 'nai-diffusion-4-5-full' }, encoding }));
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    const body = payload('generate');
    body.parameters._local_vibes = { enabled: true, slots: [{ vibeId: 'synthetic-vibe', encodingId: 'synthetic-encoding', strength: 0.6 }] };
    const req = requestFor('proxy-vibe');
    const customReq = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(customReq, { method: req.method, headers: req.headers, socket: req.socket, setTimeout: req.setTimeout });
    const res = new TestResponse(); let calls = 0;
    const q = setup(async () => assert.fail('中转不进入独立队列'));
    await handleGenerateRequest(customReq, res, '', worker.address().port, q, proxyPreferences, async (url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).parameters.reference_image_multiple_cached[0].data, encoding);
      return new Response(JSON.stringify({ message: 'INVALID_CACHE_KEYS', details: { invalidKeys: refs.map(item => item.cache_secret_key) } }), { status: 400 });
    }, { ...generationOptions, settleGeneration: () => assert.fail('拒绝不得结算') });
    assert.equal(calls, 1, res.body()); assert.equal(res.statusCode, 400);
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

for (const handler of handlers) test(`${handler === handleGenerateRequest ? 'ZIP' : 'SSE'}：编码模型不符时停止，匹配时保留负强度并按绝对值归一化`, async () => {
  const encoding = Buffer.alloc(64, 2).toString('base64');
  const worker = createServer((req, res) => {
    assert.match(req.url, /\/encodings\/e\/data$/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ variant: { model: 'nai-diffusion-4-5-curated' }, encoding }));
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    let calls = 0;
    for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated']) {
      const body = payload('generate'); body.model = model;
      body.parameters._local_vibes = { enabled: true, normalizeStrengths: true, slots: [
        { vibeId: `model-${model}`, encodingId: 'e', strength: 1.5 }, { vibeId: `model-${model}`, encodingId: 'e', strength: -0.5 },
      ] };
      const res = new TestResponse();
      await handler(requestFor(`matching-${model}-${handler.name}`, 'generate', body), res, '', worker.address().port,
        setup(() => assert.fail('不调用排队')), { enabled: false }, async (_url, options) => {
          calls++; const parameters = JSON.parse(options.body).parameters;
          assert.deepEqual(parameters.reference_strength_multiple, [0.75, -0.25]);
          assert.equal(parameters.normalize_reference_strength_multiple, false);
          assert.equal(parameters._local_vibes, undefined);
          assert.equal(parameters.stream, handler === handleGenerateStreamRequest ? 'sse' : undefined);
          return new Response(handler === handleGenerateRequest ? 'zip' : finalFrame);
        }, generationOptions);
      if (model.endsWith('full')) { assert.equal(res.statusCode, 400); assert.match(res.body(), /模型不匹配/); assert.equal(calls, 0); }
      else assert.equal(res.statusCode, 200, res.body());
    }
    assert.equal(calls, 1);
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

test('SSE Vibe：复用编码、缓存失效补数据，过程帧与最终图原样交付且仅结算一次', async () => {
  const encoding = Buffer.alloc(128, 81).toString('base64');
  const worker = createServer((req, res) => {
    assert.match(req.url, /\/encodings\/stream-cache\/data$/);
    res.end(JSON.stringify({ variant: { model: 'nai-diffusion-4-5-full' }, encoding }));
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    const bodies = [], settled = [];
    const frames = 'event: intermediate\ndata: {"image":"preview","step":2}\n\n' + finalFrame;
    for (const retry of [false, true]) {
      const body = payload('img2img'); body.parameters._local_edit_operation = 'image-to-image';
      body.parameters._local_vibes = { enabled: true, normalizeStrengths: false,
        slots: [{ vibeId: 'stream-cache', encodingId: 'stream-cache', strength: -1.5 }] };
      const res = new TestResponse(); let calls = 0;
      await handleGenerateStreamRequest(requestFor(`stream-cache-${retry}`, 'img2img', body), res, '', worker.address().port,
        setup(() => assert.fail('未开启公共队列')), { enabled: false }, async (url, options) => {
          assert.equal(url, 'https://image.novelai.net/ai/generate-image-stream'); calls++;
          const sent = JSON.parse(options.body); bodies.push(sent);
          assert.equal(sent.parameters.stream, 'sse');
          assert.deepEqual(sent.parameters.reference_strength_multiple, [-1.5]);
          assert.equal(sent.parameters._local_vibes, undefined);
          assert.equal(sent.parameters._local_edit_operation, undefined);
          const reference = sent.parameters.reference_image_multiple_cached[0];
          if (retry && calls === 1) {
            assert.equal(reference.data, undefined);
            return new Response(JSON.stringify({ message: 'INVALID_CACHE_KEYS', details: { invalidKeys: [reference.cache_secret_key] } }), { status: 400 });
          }
          assert.equal(reference.data, encoding);
          return new Response(frames);
        }, { ...generationOptions, settleGeneration: async ({ payload }) => { settled.push(payload); return { estimatedCost: 0 }; } });
      assert.equal(res.statusCode, 200, res.body()); assert.ok(res.body().startsWith(frames));
      assert.equal(calls, retry ? 2 : 1); assert.match(res.body(), /event: nai_usage/);
    }
    assert.equal(settled.length, 2); assert.equal(bodies.length, 3);
    assert.deepEqual(settled[1].parameters.reference_strength_multiple, [-1.5]);
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

test('SSE Vibe：收到生成错误后不改走普通生成、不重发、不结算', async () => {
  const worker = createServer((_req, res) => res.end(JSON.stringify({ variant: { model: 'nai-diffusion-4-5-full' }, encoding: Buffer.alloc(128, 82).toString('base64') })));
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    const body = payload('generate'); body.parameters._local_vibes = { enabled: true, slots: [{ vibeId: 'stream-error', encodingId: 'e', strength: 0.6 }] };
    let calls = 0; const res = new TestResponse();
    await handleGenerateStreamRequest(requestFor('stream-error', 'generate', body), res, '', worker.address().port,
      setup(() => assert.fail('未开启公共队列')), { enabled: false }, async () => { calls++; return new Response('event: error\ndata: {"message":"synthetic failure"}\n\n'); },
      { ...generationOptions, settleGeneration: () => assert.fail('失败不能结算') });
    assert.equal(calls, 1); assert.match(res.body(), /synthetic failure/); assert.doesNotMatch(res.body(), /event: final|event: nai_usage/);
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

for (const handler of handlers) test(`${handler === handleGenerateRequest ? 'ZIP' : 'SSE'}：参考数量、互斥与模式校验在发出生成前生效`, async () => {
  const vibe = { vibeId: 'v', encodingId: 'e', strength: 0.6 };
  const reference = { assetId: 'a', type: 'character', strength: 0.6, fidelity: 0.6 };
  const cases = [
    [{ _local_vibes: { enabled: true, slots: Array(17).fill(vibe) } }, 'generate', /最多使用 16/],
    [{ _local_vibes: { enabled: true, slots: [{ ...vibe, strength: null }] } }, 'generate', /有限数值/],
    [{ _local_vibes: { enabled: true, slots: [vibe] }, _local_character_references: { enabled: true, slots: [reference] } }, 'generate', /不能同时/],
    [{ _local_vibes: { enabled: true, slots: [vibe] } }, 'infill', /重绘和扩图/],
    [{ _local_character_references: { enabled: true, slots: Array(5).fill(reference) } }, 'generate', /最多使用 4/],
  ];
  for (const [parameters, action, message] of cases) {
    const body = payload(action); Object.assign(body.parameters, parameters);
    const res = new TestResponse();
    await handler(requestFor('reference-validation', action, body), res, '', 0, setup(() => assert.fail('校验失败不排队')),
      { enabled: false }, () => assert.fail('校验失败不生图'), { ...generationOptions, prepareBilling: () => assert.fail('校验失败不进入计费') });
    assert.equal(res.statusCode, 400, res.body()); assert.match(res.body(), message);
  }
});

test('SSE 角色参考：文生图、图生图、重绘与扩图共用原图解析并保留参考参数', async () => {
  const { default: sharp } = await import('sharp');
  const image = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#38bdf8' } }).png().toBuffer();
  const worker = createServer((req, res) => { assert.equal(req.url, '/api/character-references/stream-character/image'); res.setHeader('etag', 'synthetic'); res.end(image); });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  try {
    for (const operation of ['generate', 'image-to-image', 'inpaint', 'outpaint']) {
      const body = payload(operation === 'generate' ? 'generate' : operation === 'image-to-image' ? 'img2img' : 'infill');
      if (operation !== 'generate') body.parameters._local_edit_operation = operation;
      body.parameters._local_character_references = { enabled: true, slots: [{ assetId: 'stream-character', type: 'character_style', strength: -0.5, fidelity: 0.8 }] };
      let calls = 0, settlements = 0; const res = new TestResponse();
      await handleGenerateStreamRequest(requestFor(`stream-character-${operation}`, body.action, body), res, '', worker.address().port,
        setup(() => assert.fail('未开启公共队列')), { enabled: false }, async (_url, options) => {
          calls++; const parameters = JSON.parse(options.body).parameters;
          assert.equal(parameters._local_character_references, undefined);
          assert.equal(parameters.director_reference_images.length, 1);
          assert.ok(Buffer.from(parameters.director_reference_images[0], 'base64').length > image.length);
          assert.deepEqual(parameters.director_reference_strength_values, [-0.5]);
          assert.deepEqual(parameters.director_reference_descriptions.map(d => d.caption.base_caption), ['character&style']);
          return new Response(finalFrame);
        }, { ...generationOptions, settleGeneration: async ({ payload }) => { settlements++; assert.equal(payload.parameters.director_reference_images.length, 1); return { estimatedCost: 0 }; } });
      assert.equal(res.statusCode, 200, res.body()); assert.equal(calls, 1); assert.equal(settlements, 1);
    }
  } finally { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); }
});

test('队列数量：保留 0，缺失和非法值保持未知', () => {
  for (const value of [0, '0', ' 0 ']) assert.equal(normalizeCloudQueueCount(value), 0);
  for (const value of [3, '3']) assert.equal(normalizeCloudQueueCount(value), 3);
  for (const value of [undefined, null, '', ' ', false, true, -1, 1.5, 'NaN', Infinity, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeCloudQueueCount(value), null);
  }
});

for (const [label, value, expected] of [['零', 0, 0], ['字符串零', '0', 0], ['缺失', undefined, null], ['非法', -1, null], ['正数', 3, 3]]) {
  test(`入队立即获得许可：${label}队列数量原样归一化，不增加自己`, async () => {
    const q = setup(async () => json({ position: 0, queue_size: value, lock_token: 'permit' }));
    await q.join({ apiKey: 'test-key', taskId: 'count' });
    assert.equal(q.get(testKeyHash, 'count').queueSize, expected);
    assert.equal(q.get(testKeyHash, 'count').position, 0);
  });
}

test('等待与获得许可的轮询：未知位置不冒充 0，新的 0 不继承旧数量', async () => {
  let polls = 0;
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 2, queue_size: 3 });
    polls++;
    if (polls === 1) {
      assert.equal(q.get(testKeyHash, 'count').queueSize, 3);
      return json({ position: null, queue_size: 0 });
    }
    assert.equal(q.get(testKeyHash, 'count').queueSize, 0);
    assert.equal(q.get(testKeyHash, 'count').position, null);
    return json({ is_my_turn: true, lock_token: 'permit', queue_size: 0 });
  });
  await q.join({ apiKey: 'test-key', taskId: 'count' });
  assert.equal(q.get(testKeyHash, 'count').phase, 'ready');
  assert.equal(q.get(testKeyHash, 'count').queueSize, 0);
});

test('轮询缺失数量：不沿用先前的总数', async () => {
  const q = setup(async url => url.endsWith('/join-queue')
    ? json({ position: 1, queue_size: 2 })
    : json({ is_my_turn: true, lock_token: 'permit' }));
  await q.join({ apiKey: 'test-key', taskId: 'count' });
  assert.equal(q.get(testKeyHash, 'count').queueSize, null);
});

for (const handler of handlers) {
  const label = handler === handleGenerateRequest ? 'normal' : 'stream';
  for (const action of modes) {
    test(`${label} ${action}：取得令牌前不生成，响应体完成后仅释放一次`, async () => {
      let granted = false, upstreamCalls = 0, controller;
      const queueCalls = [];
      const q = setup(async (url, options) => {
        queueCalls.push({ url, options });
        if (url.endsWith('/join-queue')) return json({ position: 1 });
        if (url.includes('/my-turn?')) return json(granted ? { is_my_turn: true, lock_token: 'permit' } : { position: 1 });
        return json({ status: 'ok' });
      });
      const { pending, res } = run(handler, q, async () => {
        upstreamCalls++;
        return new Response(new ReadableStream({ start(c) { controller = c; } }));
      }, `task-${label}-${action}`, undefined, {}, action);
      await waitUntil(() => q.get(testKeyHash, `task-${label}-${action}`)?.phase === 'waiting');
      assert.equal(upstreamCalls, 0);
      granted = true;
      await waitUntil(() => controller);
      assert.equal(queueCalls.filter(call => call.url.endsWith('/complete')).length, 0);
      assert.notEqual(q.get(testKeyHash, `task-${label}-${action}`).phase, 'completed');
      controller.enqueue(new TextEncoder().encode(handler === handleGenerateRequest ? 'image' : finalFrame));
      controller.close();
      await pending;
      const completed = queueCalls.filter(call => call.url.endsWith('/complete'));
      assert.equal(completed.length, 1);
      assert.equal(JSON.parse(completed[0].options.body).lock_token, 'permit');
      assert.equal(q.get(testKeyHash, `task-${label}-${action}`).phase, 'completed');
      assert.equal(res.statusCode, 200);
      assert.equal(upstreamCalls, 1);
    });
  }

  test(`${label}：排队超时退出一次，既不生成也不自动重试`, async () => {
    const calls = [];
    const q = setup(async url => { calls.push(url); return json({ position: 1 }); }, { waitTimeoutMs: 25 });
    const { pending, res } = run(handler, q, async () => assert.fail('超时后不能生成'), `task-timeout-${label}`);
    await pending;
    assert.equal(res.statusCode, 504);
    assert.equal(JSON.parse(res.body()).code, 'CLOUD_QUEUE_TIMEOUT');
    assert.equal(q.get(testKeyHash, `task-timeout-${label}`).phase, 'error');
    assert.equal(calls.filter(url => url.endsWith('/join-queue')).length, 1);
    assert.equal(calls.filter(url => url.endsWith('/leave-queue')).length, 1);
  });

  test(`${label}：等待时间不消耗生成时限`, async () => {
    const q = setup(async url => {
      if (url.endsWith('/join-queue')) { await sleep(60); return json({ position: 0, lock_token: 'permit' }); }
      return json({ status: 'ok' });
    });
    const { pending, res } = run(handler, q, async (url, options) => {
      assert.equal(options.signal.aborted, false);
      await sleep(10);
      assert.equal(options.signal.aborted, false);
      return new Response(handler === handleGenerateRequest ? 'image' : finalFrame);
    }, `task-fresh-timeout-${label}`, undefined, { generationTimeoutMs: 50 });
    await pending;
    assert.equal(res.statusCode, 200);
    assert.equal(q.get(testKeyHash, `task-fresh-timeout-${label}`).phase, 'completed');
  });

  test(`${label}：上游 429 是错误终态，失败不结算且仍释放一次`, async () => {
    const calls = [];
    const q = setup(async url => { calls.push(url); return json({ position: 0, lock_token: 'permit' }); });
    const { pending, res } = run(handler, q, async () => new Response('rate limited', { status: 429 }), `task-rejected-${label}`, undefined, {
      settleGeneration: async () => assert.fail('失败不得结算'),
    });
    await pending;
    assert.equal(res.statusCode, 429);
    assert.equal(q.get(testKeyHash, `task-rejected-${label}`).phase, 'error');
    assert.equal(calls.filter(url => url.endsWith('/complete')).length, 1);
  });

  test(`${label}：生成响应体超时后释放一次，不结算或重发`, async () => {
    const calls = [];
    const q = setup(async url => { calls.push(url); return json({ position: 0, lock_token: 'permit' }); });
    let upstreamCalls = 0;
    const { pending, res } = run(handler, q, async (url, options) => {
      upstreamCalls++;
      return new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
      } }));
    }, `task-body-timeout-${label}`, undefined, {
      generationTimeoutMs: 25,
      settleGeneration: async () => assert.fail('超时不得结算'),
    });
    // 模拟流自身没有网络句柄，保留短计时器使 AbortSignal.timeout 可被测试观察。
    const keepAlive = setTimeout(() => {}, 2000);
    try { await pending; } finally { clearTimeout(keepAlive); }
    assert.equal(q.get(testKeyHash, `task-body-timeout-${label}`).phase, 'error');
    assert.equal(calls.filter(url => url.endsWith('/complete')).length, 1);
    assert.equal(upstreamCalls, 1);
    if (handler === handleGenerateRequest) assert.equal(res.statusCode, 504);
    else assert.match(res.body(), /event: error/);
  });

  test(`${label}：释放失败保留成品并反馈，只发送一次释放请求`, async t => {
    const calls = [];
    const logs = t.mock.method(console, 'warn', () => {});
    const q = setup(async url => {
      calls.push(url);
      return url.endsWith('/complete') ? new Response('unavailable', { status: 503 }) : json({ position: 0, lock_token: 'permit' });
    });
    const { pending, res } = run(handler, q, async () => new Response(handler === handleGenerateRequest ? 'image' : finalFrame), `task-cleanup-${label}`);
    await pending;
    assert.equal(res.statusCode, 200);
    assert.match(res.body(), /image/);
    assert.match(q.get(testKeyHash, `task-cleanup-${label}`).cleanupError, /释放失败/);
    assert.equal(q.get(testKeyHash, `task-cleanup-${label}`).phase, 'completed');
    assert.equal(calls.filter(url => url.endsWith('/complete')).length, 1);
    assert.equal(logs.mock.callCount(), 1);
    // 任务标识始终随响应下发，供前端结束请求后从状态通道补收清理回执。
    assert.equal(res.headers['x-nai-queue-task-id'], `task-cleanup-${label}`);
    if (handler === handleGenerateRequest) {
      // ZIP 先交付成品、后做 complete：释放结果不可能写进已发出的响应头。
      assert.equal(res.headers['x-nai-queue-cleanup-failed'], undefined);
    } else {
      assert.match(res.body(), /event: nai_queue_cleanup_error/);
    }
  });

  test(`${label}：真实 HTTP 完整上传后断连，退出队列且不生成`, async () => {
    const calls = [];
    const q = setup(async url => { calls.push(url); return json({ position: 1 }); });
    let pending;
    const server = createServer((req, res) => { pending = handler(req, res, '', 0, q, preferences, async () => assert.fail('断连后不能生成'), generationOptions); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const taskId = `task-disconnect-${label}`;
      const client = request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', headers: {
        authorization: 'Bearer test-key', 'x-nai-queue-task-id': taskId,
      } });
      client.on('error', () => {});
      client.end(JSON.stringify(payload('generate')));
      await waitUntil(() => q.get(testKeyHash, taskId)?.phase === 'waiting');
      client.destroy();
      await pending;
      assert.equal(q.get(testKeyHash, taskId).phase, 'cancelled');
      assert.equal(calls.filter(url => url.endsWith('/leave-queue')).length, 1);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('入队响应丢失：补发一次退出，保留原始错误', async () => {
  const calls = [];
  const q = setup(async url => { calls.push(url); if (url.endsWith('/join-queue')) throw new Error('response lost'); return json({ status: 'ok' }); });
  await assert.rejects(q.join({ apiKey: 'test-key', taskId: 'task-lost', signal: new AbortController().signal }), /response lost/);
  assert.equal(calls.filter(url => url.endsWith('/join-queue')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('/leave-queue')).length, 1);
});

test('轮询失败：立即退出，不重试轮询、不绕过队列', async () => {
  const calls = [];
  const q = setup(async url => {
    calls.push(url);
    if (url.includes('/my-turn?')) throw new Error('poll failed');
    return json({ position: 1 });
  });
  await assert.rejects(q.join({ apiKey: 'test-key', taskId: 'task-poll' }), /poll failed/);
  assert.equal(calls.filter(url => url.includes('/my-turn?')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('/leave-queue')).length, 1);
});

test('轮询中取消却同时收到令牌：退出携带该令牌，不生成', async () => {
  const controller = new AbortController();
  let left;
  const q = setup(async (url, options) => {
    if (url.endsWith('/join-queue')) return json({ position: 1 });
    if (url.includes('/my-turn?')) { controller.abort(new DOMException('cancelled', 'AbortError')); return json({ is_my_turn: true, lock_token: 'late-permit' }); }
    left = JSON.parse(options.body);
    return json({ status: 'ok' });
  });
  await assert.rejects(q.join({ apiKey: 'test-key', taskId: 'task-late-permit', signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(left.lock_token, 'late-permit');
});

test('清理也失败：记录警告、不重复退出、不覆盖入队错误', async t => {
  const logs = t.mock.method(console, 'warn', () => {});
  const calls = [];
  const q = setup(async url => { calls.push(url); throw new Error(url.endsWith('/join-queue') ? 'join failed' : 'cleanup failed'); });
  await assert.rejects(q.join({ apiKey: 'test-key', taskId: 'task-cleanup-failed' }), /join failed/);
  assert.equal(calls.length, 2);
  assert.equal(logs.mock.callCount(), 1);
  assert.match(q.get(testKeyHash, 'task-cleanup-failed').cleanupError, /释放失败/);
});

test('活动记录不因超时被清理，终态按真实 TTL 清理', () => {
  let now = 0;
  const q = setup(async () => json({}), { now: () => now, statusTtlMs: 100 });
  for (const [taskId, phase] of [['waiting-id', 'waiting'], ['generating-id', 'generating'], ['preparing-id', 'preparing'], ['joining-id', 'joining'], ['ready-id', 'ready']]) {
    q.claim('key-a', taskId, { phase });
  }
  now = 10_000;
  q.update('key-a', 'ready-id', { position: 0 });
  for (const taskId of ['waiting-id', 'generating-id', 'preparing-id', 'joining-id', 'ready-id']) {
    assert.ok(q.get('key-a', taskId), `${taskId} 活动记录无论多久都不能被清理`);
  }
  q.update('key-a', 'ready-id', { phase: 'completed' });
  assert.ok(q.get('key-a', 'ready-id'));
  now += 500;
  q.update('key-a', 'generating-id', { phase: 'error' });
  assert.equal(q.get('key-a', 'ready-id'), null, '终态超过 TTL 后清理');
  for (const taskId of ['waiting-id', 'preparing-id', 'joining-id']) assert.ok(q.get('key-a', taskId), '活动记录仍保留');
});

test('终态数量有上限：超出后淘汰最旧，活动记录不参与', () => {
  let now = 0;
  const q = setup(async () => json({}), { now: () => now, statusTtlMs: 1_000_000, terminalLimit: 2 });
  q.claim('key-a', 'done-1', { phase: 'completed' }); now = 1;
  q.claim('key-a', 'done-2', { phase: 'completed' }); now = 2;
  q.claim('key-a', 'done-3', { phase: 'completed' }); now = 3;
  assert.equal(q.get('key-a', 'done-1'), null);
  assert.ok(q.get('key-a', 'done-2') && q.get('key-a', 'done-3'));
});

test('同 Key 同 taskId 仍在途时明确拒绝，不覆盖在途 controller', () => {
  const q = setup(async () => json({}));
  const controller = new AbortController();
  q.claim('key-a', 'busy-id', { phase: 'waiting', cancelable: true, controller });
  assert.throws(() => q.claim('key-a', 'busy-id', { phase: 'preparing', controller: new AbortController() }),
    error => error.status === 409 && error.code === 'QUEUE_TASK_IN_USE');
  assert.equal(q.get('key-a', 'busy-id').controller, controller);
  // 终态后可重新领取，新记录不继承旧清理警告
  q.update('key-a', 'busy-id', { phase: 'completed', controller: null, cleanupError: '公共队列退出或释放失败，请检查队列状态' });
  const next = q.claim('key-a', 'busy-id', { phase: 'preparing' });
  assert.equal(next.cleanupError, undefined);
  assert.equal(q.get('key-a', 'busy-id').phase, 'preparing');
  assert.equal(q.get('key-a', 'busy-id').cleanupError, undefined);
});

test('同一 taskId 跨 Key 互不覆盖，取消只中止本 Key 的 controller', async () => {
  const q = setup(async url => url.endsWith('/join-queue') ? json({ position: 0, lock_token: 'permit' }) : json({ status: 'ok' }));
  const keyHashOf = key => createHash('sha256').update(key).digest('hex');
  const requestWithKey = key => {
    const req = Readable.from([Buffer.from(JSON.stringify(payload('generate')))]);
    req.method = 'POST';
    req.headers = { authorization: `Bearer ${key}`, 'x-nai-queue-task-id': 'shared-id' };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.setTimeout = () => {};
    return req;
  };
  const upstreamCalls = { 'key-a': 0, 'key-b': 0 };
  const upstream = key => async (url, options) => {
    upstreamCalls[key]++;
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return new Response('late-image');
  };
  const resA = new TestResponse(), resB = new TestResponse();
  const pendingA = handleGenerateRequest(requestWithKey('key-a'), resA, '', 0, q, preferences, upstream('key-a'), generationOptions);
  const pendingB = handleGenerateRequest(requestWithKey('key-b'), resB, '', 0, q, preferences, upstream('key-b'), generationOptions);
  await waitUntil(() => q.get(keyHashOf('key-a'), 'shared-id')?.phase === 'generating' && q.get(keyHashOf('key-b'), 'shared-id')?.phase === 'generating');
  await waitUntil(() => upstreamCalls['key-b'] === 1);
  q.get(keyHashOf('key-a'), 'shared-id').controller.abort(new DOMException('用户已取消排队', 'AbortError'));
  await pendingA;
  assert.equal(resA.statusCode, 499);
  assert.equal(q.get(keyHashOf('key-a'), 'shared-id').phase, 'cancelled');
  assert.equal(q.get(keyHashOf('key-b'), 'shared-id').phase, 'generating');
  assert.equal(q.get(keyHashOf('key-b'), 'shared-id').controller.signal.aborted, false);
  q.get(keyHashOf('key-b'), 'shared-id').controller.abort(new DOMException('结束', 'AbortError'));
  await pendingB;
  assert.equal(q.get(keyHashOf('key-b'), 'shared-id').phase, 'cancelled');
});

test('complete 挂起时图片先交付，内部生成锁在清理结束前仍忙', async () => {
  let markCompleteStarted;
  const completeStarted = new Promise(resolve => { markCompleteStarted = resolve; });
  let finishComplete;
  const completeGate = new Promise(resolve => { finishComplete = resolve; });
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
    if (url.endsWith('/complete')) { markCompleteStarted(); await completeGate; return json({ status: 'ok' }); }
    return json({ status: 'ok' });
  });
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const res = new TestResponse();
  const pending = handleGenerateRequest(requestFor('hold-cleanup'), res, '', 0, q, preferences, async () => new Response('delivered-image'), { ...generationOptions, tasks });
  await completeStarted;
  // complete 还没回来，成品已经交付
  assert.equal(res.statusCode, 200);
  assert.match(res.body(), /delivered-image/);
  assert.equal(q.get(testKeyHash, 'hold-cleanup').phase, 'generating');
  assert.equal(tasks.size, 1, '清理结束前内部生成锁仍忙');
  finishComplete();
  await pending;
  assert.equal(q.get(testKeyHash, 'hold-cleanup').phase, 'completed');
  assert.equal(tasks.size, 0);
});

test('同 Key 同 taskId 在途时第二个请求被明确拒绝，不生成也不覆盖', async () => {
  // 网关只接受 /^[a-zA-Z0-9-]{8,80}$/ 的 X-Nai-Queue-Task-Id，过短会被换成随机 UUID。
  const q = setup(async url => url.endsWith('/join-queue') ? json({ position: 1 }) : json({ status: 'ok' }));
  // 不依赖文件级共享的 tasks，避免其他用例的租约状态影响本用例时序。
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const first = run(handleGenerateRequest, q, async () => assert.fail('在途任务不应生成'), 'dup-task-id', undefined, { tasks });
  await waitUntil(() => q.get(testKeyHash, 'dup-task-id')?.phase === 'waiting');
  const second = run(handleGenerateRequest, q, async () => assert.fail('重复 id 不得触发上游'), 'dup-task-id', undefined, { tasks });
  await second.pending;
  assert.equal(second.res.statusCode, 409);
  assert.equal(JSON.parse(second.res.body()).code, 'QUEUE_TASK_IN_USE');
  assert.equal(q.get(testKeyHash, 'dup-task-id').phase, 'waiting');
  q.get(testKeyHash, 'dup-task-id').controller.abort(new DOMException('结束', 'AbortError'));
  await first.pending;
  assert.equal(first.res.statusCode, 499);
});

test('释放失败后同 id 重新发起：新任务不继承旧清理警告', async t => {
  t.mock.method(console, 'warn', () => {});
  let completes = 0;
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 0, lock_token: 'permit' });
    if (url.endsWith('/complete')) { completes++; return completes === 1 ? new Response('unavailable', { status: 503 }) : json({ status: 'ok' }); }
    return json({ status: 'ok' });
  });
  const first = run(handleGenerateRequest, q, async () => new Response('first-image'), 'reused-id');
  await first.pending;
  assert.match(q.get(testKeyHash, 'reused-id').cleanupError, /释放失败/);
  assert.equal(q.get(testKeyHash, 'reused-id').phase, 'completed');
  const second = run(handleGenerateRequest, q, async () => new Response('second-image'), 'reused-id');
  await second.pending;
  assert.match(second.res.body(), /second-image/);
  assert.equal(q.get(testKeyHash, 'reused-id').phase, 'completed');
  assert.equal(q.get(testKeyHash, 'reused-id').cleanupError, undefined);
});
