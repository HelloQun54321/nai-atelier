import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { DEFAULT_NAI_RUNTIME, CloudQueueCoordinator, handleGenerateRequest, handleGenerateStreamRequest } from '../../scripts/media-gateway.mjs';
import { normalizeCloudQueueCount } from '../../worker/cloudQueueNumbers.mjs';

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
const generationOptions = { prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }), settleGeneration: async () => ({ estimatedCost: 0, anlasBudget: null }), checkLowConsumption: async () => {} };
const finalFrame = 'event: final\ndata: {"image":"test"}\n\n';
const run = (handler, q, remote, taskId, res = new TestResponse(), options = {}, action = 'generate') => ({
  res,
  pending: handler(requestFor(taskId, action), res, '', 0, q, preferences, remote, { ...generationOptions, ...options }),
});
const waitUntil = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await sleep(5); }
  assert.fail('模拟任务未达到预期状态');
};

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
