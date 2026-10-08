import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { DEFAULT_NAI_RUNTIME, CloudQueueCoordinator, handleGenerateRequest, handleGenerateStreamRequest, buildCachedVibeReferences, generateWithVibeCacheRetry } from '../../scripts/media-gateway.mjs';
import { normalizeCloudQueueCount } from '../../worker/cloudQueueNumbers.mjs';
import { getCloudQueueGenerationUrl } from '../../worker/cloudQueueTarget.mjs';

// 只使用模拟外部请求和注入的结算函数，不启动真实网关、不读取或改写私人数据。
const preferences = { enabled: true, serviceUrl: 'https://queue.example', greeting: '', showGreeting: true };
const json = value => new Response(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const handlers = [handleGenerateRequest, handleGenerateStreamRequest];
const modes = ['generate', 'img2img', 'infill', 'outpaint'];
const payload = action => ({ model: 'nai-diffusion-4-5-full', action: action === 'outpaint' ? 'infill' : action, parameters: {
  ...(action === 'outpaint' ? { _local_edit_operation: 'outpaint' } : {}),
} });
const requestFor = (taskId, action = 'generate') => {
  const req = Readable.from([Buffer.from(JSON.stringify(payload(action)))]);
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
const generationOptions = { prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }), settleGeneration: async () => ({ estimatedCost: 0, anlasBudget: null }), };
const finalFrame = 'event: final\ndata: {"image":"test"}\n\n';
const run = (handler, q, remote, taskId, res = new TestResponse(), options = {}, action = 'generate', taskPreferences = preferences) => ({
  res,
  pending: handler(requestFor(taskId, action), res, '', 0, q, taskPreferences, remote, { ...generationOptions, ...options }),
});
const waitUntil = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await sleep(5); }
  assert.fail('模拟任务未达到预期状态');
};

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
        assert.equal(q.get(taskId).proxy, true);
        assert.equal(q.get(taskId).phase, 'waiting');
        assert.equal(q.get(taskId).position, null);
        assert.equal(q.get(taskId).queueSize, null);
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
      assert.equal(q.get(taskId).phase, 'completed');
      assert.equal(q.get(taskId).controller, null);
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
      assert.equal(q.get(`proxy-rejected-${label}-${status}`).phase, 'error');
    });
  }

  for (const cancel of [false, true]) {
    test(`${label}：中转${cancel ? '停止等待' : '超时'}中断同一请求，不结算、不重新发起`, async () => {
      const taskId = `proxy-abort-${label}-${cancel}`;
      const q = setup(async () => assert.fail('中转不退出独立队列'));
      let calls = 0;
      const { pending, res } = run(handler, q, async (url, options) => {
        calls++;
        assert.equal(q.get(taskId).cancelable, true);
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }, taskId, undefined, { generationTimeoutMs: cancel ? 2000 : 20, settleGeneration: () => assert.fail('失败或停止不得结算') }, 'generate', proxyPreferences);
      await waitUntil(() => calls === 1);
      if (cancel) q.get(taskId).controller.abort(new DOMException('用户停止等待', 'AbortError'));
      await pending;
      assert.equal(calls, 1); assert.equal(res.statusCode, cancel ? 499 : 504);
      assert.equal(q.get(taskId).phase, cancel ? 'cancelled' : 'error');
    });
  }

  test(`${label}：中转停止等待后迟到的成功响应不能交付或结算`, async () => {
    const taskId = `proxy-late-${label}`;
    const q = setup(async () => assert.fail('中转不调用队列'));
    const { pending, res } = run(handler, q, async () => {
      q.get(taskId).controller.abort(new DOMException('停止等待', 'AbortError'));
      return new Response(label === 'stream' ? finalFrame : 'late-image');
    }, taskId, undefined, { settleGeneration: () => assert.fail('停止后不得结算') }, 'generate', proxyPreferences);
    await pending;
    assert.equal(res.statusCode, 499); assert.equal(q.get(taskId).phase, 'cancelled');
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
    assert.equal(q.get('count').queueSize, expected);
    assert.equal(q.get('count').position, 0);
  });
}

test('等待与获得许可的轮询：未知位置不冒充 0，新的 0 不继承旧数量', async () => {
  let polls = 0;
  const q = setup(async url => {
    if (url.endsWith('/join-queue')) return json({ position: 2, queue_size: 3 });
    polls++;
    if (polls === 1) {
      assert.equal(q.get('count').queueSize, 3);
      return json({ position: null, queue_size: 0 });
    }
    assert.equal(q.get('count').queueSize, 0);
    assert.equal(q.get('count').position, null);
    return json({ is_my_turn: true, lock_token: 'permit', queue_size: 0 });
  });
  await q.join({ apiKey: 'test-key', taskId: 'count' });
  assert.equal(q.get('count').phase, 'ready');
  assert.equal(q.get('count').queueSize, 0);
});

test('轮询缺失数量：不沿用先前的总数', async () => {
  const q = setup(async url => url.endsWith('/join-queue')
    ? json({ position: 1, queue_size: 2 })
    : json({ is_my_turn: true, lock_token: 'permit' }));
  await q.join({ apiKey: 'test-key', taskId: 'count' });
  assert.equal(q.get('count').queueSize, null);
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
      await waitUntil(() => q.get(`task-${label}-${action}`)?.phase === 'waiting');
      assert.equal(upstreamCalls, 0);
      granted = true;
      await waitUntil(() => controller);
      assert.equal(queueCalls.filter(call => call.url.endsWith('/complete')).length, 0);
      assert.notEqual(q.get(`task-${label}-${action}`).phase, 'completed');
      controller.enqueue(new TextEncoder().encode(handler === handleGenerateRequest ? 'image' : finalFrame));
      controller.close();
      await pending;
      const completed = queueCalls.filter(call => call.url.endsWith('/complete'));
      assert.equal(completed.length, 1);
      assert.equal(JSON.parse(completed[0].options.body).lock_token, 'permit');
      assert.equal(q.get(`task-${label}-${action}`).phase, 'completed');
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
    assert.equal(q.get(`task-timeout-${label}`).phase, 'error');
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
    assert.equal(q.get(`task-fresh-timeout-${label}`).phase, 'completed');
  });

  test(`${label}：上游 429 是错误终态，失败不结算且仍释放一次`, async () => {
    const calls = [];
    const q = setup(async url => { calls.push(url); return json({ position: 0, lock_token: 'permit' }); });
    const { pending, res } = run(handler, q, async () => new Response('rate limited', { status: 429 }), `task-rejected-${label}`, undefined, {
      settleGeneration: async () => assert.fail('失败不得结算'),
    });
    await pending;
    assert.equal(res.statusCode, 429);
    assert.equal(q.get(`task-rejected-${label}`).phase, 'error');
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
    assert.equal(q.get(`task-body-timeout-${label}`).phase, 'error');
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
    assert.match(q.get(`task-cleanup-${label}`).cleanupError, /释放失败/);
    assert.equal(q.get(`task-cleanup-${label}`).phase, 'completed');
    assert.equal(calls.filter(url => url.endsWith('/complete')).length, 1);
    assert.equal(logs.mock.callCount(), 1);
    if (handler === handleGenerateRequest) assert.equal(res.headers['x-nai-queue-cleanup-failed'], '1');
    else assert.match(res.body(), /event: nai_queue_cleanup_error/);
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
      await waitUntil(() => q.get(taskId)?.phase === 'waiting');
      client.destroy();
      await pending;
      assert.equal(q.get(taskId).phase, 'cancelled');
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
  assert.match(q.get('task-cleanup-failed').cleanupError, /释放失败/);
});
