import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { GenerationTasks, validateGenerationInterval } from '../../worker/generationTasks.mjs';
import { handleGenerationTaskRequest, handleGenerateRequest, handleGenerateStreamRequest, CloudQueueCoordinator, DEFAULT_NAI_RUNTIME, normalizeCloudQueuePreferences } from '../../scripts/media-gateway.mjs';

const owner = 'a'.repeat(32), other = 'b'.repeat(32);

test('间隔支持一位小数，保存到下一次准入按毫秒计时，旧整数设置仍有效', () => {
  for (const seconds of [0, 0.1, 0.5, 1.5, 2, 2.3, 17.1, 3600]) {
    assert.equal(validateGenerationInterval(seconds), seconds);
    assert.equal(normalizeCloudQueuePreferences({ generationIntervalSeconds: seconds }).generationIntervalSeconds, seconds);
  }
  for (const invalid of [0.05, 2.35, 3600.1, NaN, Infinity, '0.5', null]) {
    assert.throws(() => validateGenerationInterval(invalid), { code: 'invalid_generation_interval', status: 400 });
    assert.equal(normalizeCloudQueuePreferences({ generationIntervalSeconds: invalid }).generationIntervalSeconds, 2);
  }
  let now = 0; const tasks = new GenerationTasks({ now: () => now, intervalSeconds: 0.5 });
  tasks.reserve('key', owner, 3); tasks.enter('key', owner)(); tasks.renew('key', owner, 1);
  assert.equal(tasks.snapshot('key').intervalSeconds, 0.5);
  now = 499; assert.equal(tasks.status('key', owner).waitMs, 1);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_interval' });
  now = 500; tasks.enter('key', owner)(); tasks.renew('key', owner, 2);
  tasks.setInterval('key', 2.3); assert.equal(tasks.status('key', owner).waitMs, 2300);
  now = 2800; tasks.enter('key', owner)();
});

test('默认间隔 2 秒：第一张立即生成，保存后计时，重复进度和心跳不延长', () => {
  let now = 100; const tasks = new GenerationTasks({ now: () => now });
  tasks.reserve('key', owner, 2);
  assert.equal(tasks.snapshot('key').intervalSeconds, 2);
  assert.equal(tasks.status('key', owner).waitMs, 0);
  const finish = tasks.enter('key', owner); now = 200; finish();
  now = 500; tasks.renew('key', owner, 1);
  assert.equal(tasks.status('key', owner).waitMs, 2000);
  now = 600; tasks.renew('key', owner, 1); tasks.renew('key', owner);
  assert.equal(tasks.status('key', owner).waitMs, 1900);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_interval' });
  now = 2499; assert.equal(tasks.status('key', owner).waitMs, 1);
  now = 2500; tasks.enter('key', owner)();
});

test('间隔按 Key 共享：插队、换 token、无租约入口不能绕过，其他 Key 不等待', () => {
  let now = 0; const tasks = new GenerationTasks({ now: () => now });
  tasks.reserve('key', owner, 3); tasks.enter('key', owner)(); tasks.renew('key', owner, 1);
  tasks.renew('key', owner, undefined, true);
  tasks.enqueue('key', other, 'next', 1);
  assert.equal(tasks.status('key', other).position, 0);
  assert.equal(tasks.status('key', other).waitMs, 2000);
  assert.throws(() => tasks.enter('key', other), { code: 'generation_interval' });
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  tasks.enter('other-key')();
  tasks.release('key', owner); tasks.release('key', other);
  assert.throws(() => tasks.enter('key'), { code: 'generation_interval' });
  assert.equal(tasks.current('key'), undefined);
  tasks.reserve('key', other); assert.equal(tasks.status('key', other).waitMs, 2000);
  now = 2000; tasks.enter('key', other)();
});

test('修改间隔立即影响下一张，暂停／继续不重置时钟，0 秒只关闭额外等待', () => {
  let now = 0; const tasks = new GenerationTasks({ now: () => now });
  tasks.reserve('key', owner, 3); tasks.enter('key', owner)(); tasks.renew('key', owner, 1);
  tasks.setInterval('key', 5); now = 2000;
  assert.equal(tasks.status('key', owner).waitMs, 3000);
  tasks.pause('key', true); now = 4000; tasks.pause('key', false);
  assert.equal(tasks.status('key', owner).waitMs, 1000);
  tasks.setInterval('key', 0); const finish = tasks.enter('key', owner);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_busy' });
  finish();
  tasks.pause('key', true);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_paused' });
  for (const invalid of [-1, 0.55, 3601, NaN, Infinity, '2', null]) assert.throws(() => tasks.setInterval('key', invalid), { code: 'invalid_generation_interval', status: 400 });
  assert.equal(tasks.snapshot('key').intervalSeconds, 0);
  assert.equal(tasks.snapshot('other-key').intervalSeconds, 2);
});

test('间隔接口校验、按 Key 保存并重新读取，拒绝请求不写设置，旧公共队列设置保留间隔', async () => {
  const saved = new Map(); const tasks = new GenerationTasks(); let writes = 0;
  const call = async (key, seconds, ip = '127.0.0.1', coordinator = tasks) => {
    const req = request(seconds === undefined ? 'GET' : 'PATCH', '', key, ip), res = new Reply();
    if (seconds !== undefined) Object.assign(req.headers, { 'x-nai-generation-action': 'interval', 'x-nai-generation-interval': String(seconds) });
    const preferences = normalizeCloudQueuePreferences(saved.get(key));
    await handleGenerationTaskRequest(req, res, 'synthetic-secret', coordinator, { preferences, saveInterval: async generationIntervalSeconds => { writes++; saved.set(key, normalizeCloudQueuePreferences({ ...preferences, generationIntervalSeconds })); } });
    return { status: res.statusCode, data: JSON.parse(res.body()) };
  };
  assert.equal((await call('synthetic-a', 0.5)).data.intervalSeconds, 0.5);
  assert.equal((await call('synthetic-b')).data.intervalSeconds, 2);
  assert.equal((await call('synthetic-a', undefined, '127.0.0.1', new GenerationTasks())).data.intervalSeconds, 0.5);
  assert.equal((await call('synthetic-a', -1)).status, 400);
  assert.equal((await call('synthetic-a', 0.55)).status, 400);
  assert.equal((await call('synthetic-a', 3601)).status, 400);
  assert.equal((await call('synthetic-a', 1, '192.168.1.8')).status, 401);
  assert.equal((await call('', 1)).status, 401);
  assert.equal(writes, 1);
  assert.equal(normalizeCloudQueuePreferences({ ...saved.get('synthetic-a'), greeting: '更新队列问候' }).generationIntervalSeconds, 0.5);
});
test('同 Key 的不同入口原子抢占，token 只能使用所属 Key；释放旧 token 不释放新任务', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key-a', owner);
  tasks.reserve('key-a', owner);
  assert.throws(() => tasks.reserve('key-a', other), { code: 'generation_busy' });
  tasks.reserve('key-b', other);
  assert.throws(() => tasks.enter('key-b', owner), { code: 'generation_task_expired' });
  tasks.release('key-a', owner); tasks.reserve('key-a', other); tasks.release('key-a', owner);
  assert.equal(tasks.size, 2);
});
test('关闭页面后的空闲锁过期，旧任务不可续期；在途请求不因超时或提前释放被绕过', () => {
  let now = 0; const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now, idleMs: 100 });
  tasks.reserve('key', owner); now = 90; tasks.renew('key', owner); now = 120;
  const finish = tasks.enter('key', owner); now = 1000;
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_busy' });
  tasks.release('key', owner);
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  finish(); assert.equal(tasks.size, 0);
  tasks.reserve('key', owner); now += 101;
  assert.equal(tasks.size, 0);
  assert.throws(() => tasks.renew('key', owner), { code: 'generation_task_expired' });
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_task_expired' });
});

class Reply extends Writable {
  constructor() { super(); this.headers = {}; this.chunks = []; }
  setHeader(key, value) { this.headers[key] = value; }
  writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); this.headersSent = true; }
  _write(chunk, _encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
  body() { return Buffer.concat(this.chunks).toString(); }
}
const request = (method = 'POST', token = '', key = 'synthetic-key', ip = '127.0.0.1') => {
  const req = Readable.from([Buffer.from(JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: {} }))]);
  req.setTimeout = () => {};
  req.method = method; req.socket = { remoteAddress: ip };
  req.headers = { authorization: key ? 'Bearer ' + key : '', 'x-nai-generation-task': token };
  return req;
};
const runTask = async (tasks, method, token, key, ip, completed) => {
  const req = request(method, token, key, ip), res = new Reply();
  if (completed !== undefined) req.headers['x-nai-generation-completed'] = String(completed);
  await handleGenerationTaskRequest(req, res, 'synthetic-secret', tasks);
  return { status: res.statusCode, data: JSON.parse(res.body()) };
};
test('租约接口检查局域网授权与 Key，不泄露指纹／token，竞争返回忙碌', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  assert.equal((await runTask(tasks, 'POST', owner, '', '127.0.0.1')).status, 401);
  assert.equal((await runTask(tasks, 'POST', owner, 'key', '192.168.1.8')).status, 401);
  assert.equal((await runTask(tasks, 'POST', 'bad')).status, 400);
  assert.deepEqual(await runTask(tasks, 'POST', owner), { status: 200, data: { success: true, position: 0, paused: false, waitMs: 0 } });
  assert.equal((await runTask(tasks, 'POST', other)).data.code, 'generation_busy');
  assert.equal((await runTask(tasks, 'GET')).data.busy, true);
  await runTask(tasks, 'DELETE', other);
  assert.equal((await runTask(tasks, 'GET')).data.busy, true);
  await runTask(tasks, 'DELETE', owner);
  assert.equal((await runTask(tasks, 'GET')).data.busy, false);
});

test('HTTP 接口按 Key 共享暂停和保存计数，暂停时只能主动入队，恢复不会丢失队列', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const call = async (method, token, headers = {}, key = 'synthetic-key') => {
    const req = request(method, token, key), res = new Reply();
    Object.assign(req.headers, headers);
    await handleGenerationTaskRequest(req, res, 'synthetic-secret', tasks);
    return { status: res.statusCode, data: JSON.parse(res.body()) };
  };
  await call('POST', owner, { 'x-nai-generation-count': '3' });
  const paused = await call('PATCH', '', { 'x-nai-generation-action': 'pause' });
  assert.equal(paused.data.paused, true);
  await call('PUT', owner, { 'x-nai-generation-completed': '1' });
  await call('POST', other, { 'x-nai-generation-placement': 'end', 'x-nai-generation-count': '2' });
  const snapshot = (await call('GET')).data;
  assert.equal(snapshot.completed, 1); assert.equal(snapshot.total, 5);
  assert.equal(snapshot.paused, true); assert.equal(snapshot.waiting[0].total, 2);
  assert.equal((await call('GET', '', {}, 'other-key')).data.paused, false);
  assert.equal((await call('PATCH', '', { 'x-nai-generation-action': 'bad' })).status, 400);
  const resumed = await call('PATCH', '', { 'x-nai-generation-action': 'resume' });
  assert.equal(resumed.data.paused, false); assert.equal(resumed.data.total, 5);
  await call('DELETE', other); await call('DELETE', owner);
  const freshToken = 'd'.repeat(32);
  await call('PATCH', '', { 'x-nai-generation-action': 'pause' });
  assert.equal((await call('POST', freshToken)).data.code, 'generation_paused');
  assert.equal((await call('POST', freshToken, { 'x-nai-generation-placement': 'end', 'x-nai-generation-count': '2' })).data.paused, true);
});
const waitUntil = async check => {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('合成请求未抵达模拟上游');
};
for (const first of [handleGenerateRequest, handleGenerateStreamRequest]) {
  test(`${first.name} 在途及两张之间均阻止其他标签页／手机／直接请求，结束后释放`, async () => {
    const tasks = new GenerationTasks({ intervalSeconds: 0 }); await runTask(tasks, 'POST', owner);
    let release; let requests = 0;
    const remote = async () => { requests++; await new Promise(resolve => { release = resolve; }); return new Response(first === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n'); };
    const queue = new CloudQueueCoordinator(remote);
    const options = { tasks, prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }), settleGeneration: async () => ({ estimatedCost: 0 }) };
    const req = request('POST', owner), res = new Reply();
    const pending = first(req, res, '', 0, queue, { enabled: false }, remote, options);
    await waitUntil(() => requests === 1);
    // 前端退出不能提前终止直连上游、放开相同 Key。
    res.emit('close');
    for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
      const rejected = new Reply();
      const client = request('POST', '', 'synthetic-key', handler === handleGenerateStreamRequest ? '192.168.1.8' : '127.0.0.1');
      const value = String(Date.now() + 60_000) + '.synthetic-phone';
      client.headers.cookie = 'nai_lan_access=' + value + '.' + createHmac('sha256', 'synthetic-secret').update(value).digest('base64url');
      await handler(client, rejected, 'synthetic-secret', 0, queue, { enabled: false }, remote, options);
      assert.equal(rejected.statusCode, 409); assert.equal(JSON.parse(rejected.body()).code, 'generation_busy');
    }
    release(); await pending;
    assert.equal(res.statusCode, 200); assert.equal(requests, 1);
    // 请求结束后仍在等待客户端落库，整轮锁不能被抢走。
    assert.equal((await runTask(tasks, 'POST', other)).data.code, 'generation_busy');
    await runTask(tasks, 'PUT', owner, undefined, undefined, 1);
    await runTask(tasks, 'DELETE', owner); assert.equal(tasks.size, 0);
    const next = new Reply();
    await first(request(), next, '', 0, queue, { enabled: false }, async () => new Response(first === handleGenerateRequest ? 'zip' : 'event: final\ndata: {"image":"fake"}\n\n'), options);
    assert.equal(next.statusCode, 200); assert.equal(tasks.size, 0);
  });
}
test('上游失败释放独立请求；租约失败保留至客户端结束，不自动提交后续请求', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), queue = new CloudQueueCoordinator(async () => {});
  const options = { tasks, prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }) };
  for (const handler of [handleGenerateRequest, handleGenerateStreamRequest]) {
    const res = new Reply();
    await handler(request(), res, '', 0, queue, { enabled: false }, async () => { throw new Error('synthetic upstream failure'); }, options);
    assert.equal(res.statusCode, 502); assert.equal(tasks.size, 0);
  }
});

test('队尾先进先出，插队等待当前图片保存；重复入队不改已有位置', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); const c = 'c'.repeat(32), d = 'd'.repeat(32);
  tasks.reserve('key', owner);
  const finish = tasks.enter('key', owner);
  assert.deepEqual(tasks.enqueue('key', other, 'end'), { position: 1, paused: false });
  tasks.enqueue('key', c, 'end'); tasks.enqueue('key', d, 'next');
  assert.equal(tasks.status('key', d).position, 1); assert.equal(tasks.status('key', other).position, 2);
  tasks.enqueue('key', other, 'next'); assert.equal(tasks.status('key', other).position, 2);
  assert.throws(() => tasks.enter('key', d), { code: 'generation_waiting' });
  finish();
  assert.equal(tasks.status('key', owner).position, 0);
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  tasks.release('key', owner); assert.equal(tasks.status('key', d).position, 0);
  tasks.release('key', d); assert.equal(tasks.status('key', other).position, 0);
  tasks.release('key', other); assert.equal(tasks.status('key', c).position, 0);
});
test('取消等待项只移除该项；在途提前释放仍等收图；异常关闭的等待项过期不再执行', () => {
  let now = 0; const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now, idleMs: 100 });
  const c = 'c'.repeat(32); tasks.reserve('key', owner);
  tasks.enqueue('key', other, 'end'); tasks.enqueue('key', c, 'end');
  tasks.release('other-key', c); assert.equal(tasks.status('key', c).position, 2);
  tasks.release('key', other); assert.equal(tasks.status('key', c).position, 1);
  const finish = tasks.enter('key', owner); tasks.release('key', owner);
  assert.equal(tasks.status('key', c).position, 1);
  now = 101; finish(); assert.equal(tasks.size, 0);
  assert.throws(() => tasks.renew('key', c), { code: 'generation_task_expired' });
});
test('排队接口返回自身位置，续期更新位置；非法位置不领取锁', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); await runTask(tasks, 'POST', owner);
  const req = request('POST', other); req.headers['x-nai-generation-placement'] = 'end';
  const reply = new Reply(); await handleGenerationTaskRequest(req, reply, '', tasks);
  assert.equal(reply.statusCode, 200); assert.deepEqual(JSON.parse(reply.body()), { success: true, position: 1, paused: false });
  assert.equal((await runTask(tasks, 'PUT', other)).data.position, 1);
  await runTask(tasks, 'DELETE', owner); assert.equal((await runTask(tasks, 'PUT', other)).data.position, 0);
  assert.throws(() => tasks.enqueue('key', owner, 'bogus'), { code: 'invalid_generation_queue' });
  assert.throws(() => tasks.enqueue('key', 'bad', 'end'), { code: 'invalid_generation_task' });
});
test('待执行队列有边界，不同 Key 独立，过期活动租约将位置交给仍在线的等待者', () => {
  let now = 0; const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now, idleMs: 100 });
  tasks.reserve('key', owner);
  for (let n = 0; n < 50; n++) tasks.enqueue('key', String(n).padStart(16, '0'), 'end');
  assert.throws(() => tasks.enqueue('key', other, 'end'), { code: 'generation_queue_full' });
  assert.equal(tasks.enqueue('other-key', other, 'end').position, 0);
  now = 90; tasks.renew('key', '0'.repeat(16)); now = 101;
  assert.equal(tasks.status('key', '0'.repeat(16)).position, 0);
  assert.throws(() => tasks.renew('key', owner), { code: 'generation_task_expired' });
});

test('真实 HTTP 两个客户端按同 Key 排队，直连请求不能插到等待任务前，最后收图和客户端保存后才放行', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); let calls = 0, finishUpstream;
  const remote = async () => { calls++; await new Promise(resolve => { finishUpstream = resolve; }); return new Response('synthetic-zip'); };
  const queue = new CloudQueueCoordinator(remote);
  const server = createServer((req, res) => {
    const operation = req.url === '/api/generation-task'
      ? handleGenerationTaskRequest(req, res, '', tasks)
      : handleGenerateRequest(req, res, '', 0, queue, { enabled: false }, remote, { tasks, prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }), settleGeneration: async () => ({ estimatedCost: 0 }) });
    operation.catch(error => { res.writeHead(500); res.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, method, token, placement, completed) => fetch(base + path, { method, headers: {
    Authorization: 'Bearer synthetic-http-key', 'X-Nai-Generation-Task': token,
    ...(placement ? { 'X-Nai-Generation-Placement': placement } : {}),
    ...(completed === undefined ? {} : { 'X-Nai-Generation-Completed': String(completed) }),
  }, ...(path === '/api/generate' ? { body: JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: {} }) } : {}) });
  try {
    assert.equal((await call('/api/generation-task', 'POST', owner)).status, 200);
    const pending = call('/api/generate', 'POST', owner); await waitUntil(() => calls === 1);
    assert.equal((await (await call('/api/generation-task', 'POST', other, 'end')).json()).position, 1);
    assert.equal((await call('/api/generate', 'POST', other)).status, 409); assert.equal(calls, 1);
    finishUpstream(); await (await pending).arrayBuffer();
    assert.equal((await (await call('/api/generation-task', 'PUT', other)).json()).position, 1);
    await call('/api/generation-task', 'PUT', owner, undefined, 1);
    await call('/api/generation-task', 'DELETE', owner);
    assert.equal((await (await call('/api/generation-task', 'PUT', other)).json()).position, 0);
    assert.equal((await call('/api/generate', 'POST', '')).status, 409); assert.equal(calls, 1);
    const next = call('/api/generate', 'POST', other); await waitUntil(() => calls === 2);
    finishUpstream(); assert.equal((await next).status, 200);
    await call('/api/generation-task', 'PUT', other, undefined, 1);
    await call('/api/generation-task', 'DELETE', other); assert.equal(tasks.size, 0);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('同 Key 暂停覆盖所有入口，当前图保存后停止，继续保留任务／插队与总进度', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key', owner, 3); const finish = tasks.enter('key', owner);
  tasks.enqueue('key', other, 'end', 2);
  const third = 'c'.repeat(32);
  assert.equal(tasks.snapshot('key').total, 5);
  assert.equal(tasks.pause('key', true).pausing, true);
  finish(); assert.equal(tasks.snapshot('key').pausing, true);
  tasks.renew('key', owner, 1);
  assert.equal(tasks.snapshot('key').pausing, false);
  assert.equal(tasks.snapshot('key').completed, 1);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_paused' });
  assert.throws(() => tasks.enter('key'), { code: 'generation_paused' });
  tasks.enqueue('key', third, 'next', 4);
  assert.equal(tasks.snapshot('key').total, 9);
  assert.equal(tasks.status('key', third).paused, true);
  tasks.pause('key', false);
  assert.equal(tasks.status('key', third).position, 0);
  const inserted = tasks.enter('key', third); inserted(); tasks.renew('key', third, 4); tasks.release('key', third);
  const next = tasks.enter('key', owner); next(); tasks.renew('key', owner, 3);
  tasks.release('key', owner);
  assert.equal(tasks.status('key', other).position, 0);
  assert.equal(tasks.snapshot('key').completed, 7);
  assert.equal(tasks.snapshot('key').total, 9);
  tasks.release('key', other); assert.equal(tasks.snapshot('key').total, 7);
  assert.equal(tasks.snapshot('key').total, 7);
  tasks.reserve('key', 'd'.repeat(32), 1); assert.equal(tasks.snapshot('key').completed, 0);
  assert.equal(tasks.snapshot('key').total, 1);
});
test('张数与保存进度边界校验，其他 Key 的暂停不影响本 Key', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); tasks.reserve('key', owner, 2);
  for(const count of [0, -1, 1.5, Infinity]) assert.throws(() => tasks.enqueue('key', other, 'end', count), { code: 'invalid_generation_count' });
  tasks.pause('other-key', true); assert.equal(tasks.status('key', owner).paused, false);
  tasks.renew('key', owner, 1);
  for(const completed of [0, 3, 1.5]) assert.throws(() => tasks.renew('key', owner, completed), { code: 'invalid_generation_progress' });
  tasks.renew('key', owner, 1); assert.equal(tasks.snapshot('key').completed, 1);
});

test('插队只在单张保存确认后交接，完整执行插入任务，再恢复原任务且保持队尾与总进度', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), tail = 'c'.repeat(32);
  tasks.reserve('key', owner, 3); const finish = tasks.enter('key', owner);
  tasks.enqueue('key', tail, 'end', 1); tasks.enqueue('key', other, 'next', 2);
  assert.throws(() => tasks.enter('key', other), { code: 'generation_waiting' });
  finish();
  assert.equal(tasks.status('key', other).position, 1);
  tasks.renew('key', owner);
  assert.equal(tasks.status('key', owner).position, 0);
  assert.deepEqual(tasks.renew('key', owner, 1), { position: 1, paused: false });
  assert.equal(tasks.status('key', other).position, 0);
  assert.equal(tasks.status('key', tail).position, 2);
  assert.equal(tasks.snapshot('key').completed, 1); assert.equal(tasks.snapshot('key').total, 6);
  assert.throws(() => tasks.enter('key', owner), { code: 'generation_waiting' });
  for (let n = 1; n <= 2; n++) {
    tasks.enter('key', other)(); tasks.renew('key', other, n);
    assert.equal(tasks.status('key', other).position, 0);
  }
  tasks.release('key', other);
  assert.equal(tasks.status('key', owner).position, 0);
  for (let n = 2; n <= 3; n++) { tasks.enter('key', owner)(); tasks.renew('key', owner, n); }
  tasks.release('key', owner);
  assert.equal(tasks.status('key', tail).position, 0);
  tasks.enter('key', tail)(); tasks.renew('key', tail, 1); tasks.release('key', tail);
  assert.equal(tasks.snapshot('key').completed, 6); assert.equal(tasks.snapshot('key').total, 6);
});

test('多次插队与嵌套插队分别保存原任务余量，不让较早插队任务打断后来插入的任务', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), c = 'c'.repeat(32), d = 'd'.repeat(32), order = [];
  tasks.reserve('key', owner, 3); const first = tasks.enter('key', owner);
  tasks.enqueue('key', other, 'next', 2); tasks.enqueue('key', c, 'next', 2);
  const save = (token, completed) => { tasks.enter('key', token)(); tasks.renew('key', token, completed); order.push(token[0] + completed); };
  first(); tasks.renew('key', owner, 1); order.push('a1');
  const nested = tasks.enter('key', c); tasks.enqueue('key', d, 'next', 1);
  nested(); tasks.renew('key', c, 1); order.push('c1');
  save(d, 1); tasks.release('key', d);
  save(c, 2); tasks.release('key', c);
  save(other, 1); save(other, 2); tasks.release('key', other);
  save(owner, 2); save(owner, 3); tasks.release('key', owner);
  assert.deepEqual(order, ['a1', 'c1', 'd1', 'c2', 'b1', 'b2', 'a2', 'a3']);
  assert.equal(tasks.snapshot('key').completed, 8); assert.equal(tasks.snapshot('key').total, 8);
});

test('插队不会抢走已领取的单张准备；取消挂起原任务只移除未生成余量', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); tasks.reserve('key', owner, 3);
  tasks.enter('key', owner)(); tasks.renew('key', owner, 1);
  tasks.renew('key', owner, undefined, true);
  assert.equal(tasks.enqueue('key', other, 'next', 2).position, 1);
  tasks.renew('key', owner);
  assert.equal(tasks.status('key', owner).position, 0);
  tasks.enter('key', owner)(); tasks.renew('key', owner, 2);
  tasks.release('key', owner);
  assert.equal(tasks.status('key', other).position, 0);
  assert.equal(tasks.snapshot('key').total, 4); assert.equal(tasks.snapshot('key').completed, 2);
  assert.throws(() => tasks.renew('key', owner), { code: 'generation_task_expired' });
  tasks.reserve('different-key', owner); assert.equal(tasks.status('different-key', owner).position, 0);
});

test('HTTP 插队在客户端确认单张保存后放行，单张准备头与普通心跳不混用', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const call = async (method, token, headers = {}) => {
    const req = request(method, token), res = new Reply(); Object.assign(req.headers, headers);
    await handleGenerationTaskRequest(req, res, '', tasks);
    return JSON.parse(res.body());
  };
  await call('POST', owner, { 'x-nai-generation-count': '3' });
  await call('PUT', owner, { 'x-nai-generation-completed': '1' });
  await call('PUT', owner, { 'x-nai-generation-prepare': '1' });
  assert.equal((await call('POST', other, { 'x-nai-generation-count': '2', 'x-nai-generation-placement': 'next' })).position, 1);
  assert.equal((await call('PUT', owner)).position, 0);
  assert.equal((await call('PUT', owner, { 'x-nai-generation-completed': '2' })).position, 1);
  assert.equal((await call('PUT', other)).position, 0);
  assert.equal((await call('GET')).total, 5);
});
test('初始任务尚未提交第一张时，插队仍接在该张保存后；单张任务不被等待抢占卡住', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }); tasks.reserve('key', owner, 1);
  assert.equal(tasks.enqueue('key', other, 'next', 2).position, 1);
  tasks.enter('key', owner)(); tasks.renew('key', owner, 1); tasks.release('key', owner);
  assert.equal(tasks.status('key', other).position, 0);
});
test('暂停按真实执行阶段判定：准备阶段暂停可继续，生成与保存期间保持暂停中', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key', owner, 3);
  tasks.renew('key', owner, undefined, true);
  assert.equal(tasks.pause('key', true).pausing, false);
  // 准备阶段仍独占执行位：插队不能抢占，也不能被普通心跳接管。
  assert.equal(tasks.enqueue('key', other, 'next', 1).position, 1);
  assert.equal(tasks.status('key', owner).position, 0);
  assert.equal(tasks.snapshot('key').pausing, false);
  tasks.pause('key', false);
  const finish = tasks.enter('key', owner);
  tasks.pause('key', true);
  assert.equal(tasks.snapshot('key').pausing, true);
  finish();
  assert.equal(tasks.snapshot('key').pausing, true);
  tasks.renew('key', owner, 1);
  assert.equal(tasks.snapshot('key').pausing, false);
  assert.equal(tasks.status('key', other).position, 0);
});
test('收图后已完成保存确认的任务不被 finish 退回保存中，也不虚假暂停', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key', owner, 2);
  const finish = tasks.enter('key', owner);
  tasks.renew('key', owner, 1); // 后台 runner 先确认保存
  tasks.pause('key', true);
  finish(); // 公共 handler 稍后才收尾
  assert.equal(tasks.snapshot('key').pausing, false);
  assert.equal(tasks.status('key', owner).position, 0);
  tasks.pause('key', false);
  const next = tasks.enter('key', owner); next();
});
test('提前收图仍占用执行位：保存确认后、finish 前不能交接，finish 后才交接且间隔从保存确认计时', () => {
  let now = 100; const tasks = new GenerationTasks({ intervalSeconds: 2, now: () => now });
  tasks.reserve('key', owner, 2);
  const finish = tasks.enter('key', owner);
  now = 200;
  tasks.renew('key', owner, 1); // 后台 runner 先确认保存，公共 cleanup 仍保持 inFlight
  assert.equal(tasks.snapshot('key').pausing, false);
  // 收图后公共 cleanup 未收尾前，插队不能抢走执行位。
  assert.equal(tasks.enqueue('key', other, 'next', 1).position, 1);
  assert.equal(tasks.status('key', owner).position, 0);
  now = 300;
  finish(); // 公共 cleanup 结束，inFlight 释放后才交接
  assert.equal(tasks.status('key', other).position, 0);
  // 间隔从保存确认（now=200）起算，不被 finish（now=300）覆盖。
  assert.equal(tasks.status('key', other).waitMs, 1900);
});
test('后台托管任务冻结跨过期窗口并保持互斥，等待项同样保留，释放仍按原语义', () => {
  let now = 0; const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now, idleMs: 90_000 });
  tasks.reserve('key', owner, 2);
  assert.equal(tasks.manage('key', owner).managed, true);
  tasks.enqueue('key', other, 'end', 1);
  tasks.manage('key', other);
  now = 90_000 * 4;
  assert.equal(tasks.size, 1);
  assert.equal(tasks.status('key', owner).position, 0);
  assert.equal(tasks.status('key', other).position, 1);
  assert.throws(() => tasks.reserve('key', 'c'.repeat(32)), { code: 'generation_busy' });
  tasks.release('key', other); tasks.release('key', owner);
  assert.equal(tasks.size, 0);
});
test('取消只在同一 Key 内生效，跨 Key 不误取消也不影响其他任务', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), tail = 'c'.repeat(32);
  tasks.reserve('key-a', owner, 2);
  tasks.reserve('key-b', other, 2);
  tasks.enqueue('key-a', tail, 'end', 1);
  tasks.cancel('key-a', owner);
  assert.throws(() => tasks.status('key-a', owner), { code: 'generation_cancelled', status: 409, outcome: 'cancelled' });
  assert.equal(tasks.status('key-a', tail).position, 0);
  assert.equal(tasks.status('key-b', other).position, 0);
  assert.throws(() => tasks.cancel('key-b', owner), { code: 'generation_task_expired' });
  assert.equal(tasks.status('key-b', other).position, 0);
  assert.equal(tasks.snapshot('key-b').total, 2);
});
test('明确取消与租约过期是不同终态：取消返回结构化 cancelled 且有界，过期仍为 expired', () => {
  let now = 0; const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now, idleMs: 100, cancelTtlMs: 300 });
  tasks.reserve('cancelled-key', owner, 2);
  tasks.cancel('cancelled-key', owner);
  assert.throws(() => tasks.status('cancelled-key', owner), { code: 'generation_cancelled', status: 409, outcome: 'cancelled' });
  assert.throws(() => tasks.owned('cancelled-key', owner), { code: 'generation_cancelled', outcome: 'cancelled' });
  now = 300;
  assert.throws(() => tasks.status('cancelled-key', owner), { code: 'generation_task_expired' });
  tasks.reserve('expired-key', owner, 1);
  now = 401;
  assert.throws(() => tasks.status('expired-key', owner), { code: 'generation_task_expired' });
});
test('取消排队项只移除自身并保留其余队列', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), tail = 'c'.repeat(32);
  tasks.reserve('key', owner, 1);
  tasks.enqueue('key', other, 'end', 1);
  tasks.enqueue('key', tail, 'end', 1);
  tasks.cancel('key', other);
  assert.throws(() => tasks.status('key', other), { code: 'generation_cancelled' });
  assert.equal(tasks.status('key', tail).position, 1);
  assert.equal(tasks.status('key', owner).position, 0);
});
test('取消在途任务不提前放行，收图后才释放执行位', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('flight-key', owner, 2);
  const finish = tasks.enter('flight-key', owner);
  tasks.cancel('flight-key', owner);
  assert.throws(() => tasks.reserve('flight-key', other), { code: 'generation_busy' });
  assert.throws(() => tasks.enter('flight-key'), { code: 'generation_busy' });
  assert.throws(() => tasks.status('flight-key', owner), { code: 'generation_cancelled', outcome: 'cancelled' });
  finish();
  assert.equal(tasks.size, 0);
  tasks.reserve('flight-key', other, 1);
  assert.equal(tasks.status('flight-key', other).position, 0);
});

test('按 Key 取消当前与全部等待项，跨标签页取消返回真实数量', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 }), tail = 'c'.repeat(32);
  tasks.reserve('key', owner, 2);
  tasks.enqueue('key', other, 'end', 1);
  tasks.enqueue('key', tail, 'next', 1);
  const result = tasks.cancelAll('key');
  assert.equal(result.cancelled, 3);
  for (const token of [owner, other, tail]) assert.throws(() => tasks.status('key', token), { code: 'generation_cancelled' });
  assert.equal(tasks.size, 0);
});

test('取消全部队列的 HTTP 入口只接受当前 Key 的明确请求', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  await runTask(tasks, 'POST', owner, 'synthetic-key');
  const req = request('DELETE', '', 'synthetic-key'), res = new Reply();
  req.headers['x-nai-generation-cancel-all'] = '1';
  await handleGenerationTaskRequest(req, res, 'synthetic-secret', tasks);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body());
  assert.equal(data.success, true);
  assert.equal(data.cancelled, 1);
  const after = await runTask(tasks, 'GET', owner, 'synthetic-key');
  assert.equal(after.status, 200);
  assert.equal(after.data.total, 0);
  assert.equal(after.data.busy, false);
});

for (const managed of [false, true]) test(`保存中取消全部后，收尾释放并交接且保留取消墓碑（托管=${managed}）`, () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key', owner, 2);
  if (managed) tasks.manage('key', owner);
  tasks.enter('key', owner)();
  assert.equal(tasks.current('key').phase, 'saving');
  tasks.cancelAll('key');
  tasks.pause('key', true);
  tasks.enqueue('key', other, 'end');
  tasks.cancel('key', owner); tasks.cancel('key', owner);
  assert.equal(tasks.current('key').token, owner);
  assert.equal(tasks.status('key', other).position, 1);
  assert.throws(() => tasks.reserve('key', 'c'.repeat(32)), { code: 'generation_busy' });
  tasks.cancel('key', owner, true);
  assert.equal(tasks.current('key').token, other);
  assert.deepEqual(tasks.status('key', other), { position: 0, paused: true, waitMs: 0 });
  assert.equal(tasks.snapshot('key').completed, 0);
  assert.throws(() => tasks.enter('key', other), { code: 'generation_paused' });
  tasks.cancel('key', owner, true);
  assert.equal(tasks.current('key').token, other);
  assert.throws(() => tasks.status('key', owner), { code: 'generation_cancelled' });
});

test('取消收尾确认仍不提前释放在途请求，公共清理结束才交接', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  tasks.reserve('key', owner, 2); tasks.manage('key', owner);
  const finish = tasks.enter('key', owner);
  tasks.cancelAll('key'); tasks.enqueue('key', other, 'end');
  tasks.cancel('key', owner, true);
  assert.equal(tasks.current('key').token, owner);
  assert.equal(tasks.status('key', other).position, 1);
  finish();
  assert.equal(tasks.status('key', other).position, 0);
  assert.equal(tasks.snapshot('key').completed, 0);
});

test('浏览器保存完成 PUT 在取消墓碑存在时释放租约，不记完成且不误放普通心跳', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  await runTask(tasks, 'POST', owner);
  const key = tasks.tasks.keys().next().value;
  tasks.enter(key, owner)(); tasks.cancelAll(key);
  assert.equal((await runTask(tasks, 'PUT', owner)).data.code, 'generation_cancelled');
  assert.equal((await runTask(tasks, 'PUT', owner, undefined, undefined, 0)).data.code, 'generation_cancelled');
  assert.equal((await runTask(tasks, 'PUT', owner, undefined, undefined, 2)).data.code, 'generation_cancelled');
  assert.equal((await runTask(tasks, 'DELETE', owner)).status, 200);
  assert.equal((await runTask(tasks, 'POST', other)).data.code, 'generation_busy');
  const result = await runTask(tasks, 'PUT', owner, undefined, undefined, 1);
  assert.equal(result.status, 409); assert.equal(result.data.code, 'generation_cancelled');
  assert.equal(tasks.current(key), undefined);
  assert.equal(tasks.snapshot(key).completed, 0);
  assert.equal((await runTask(tasks, 'POST', other)).status, 200);
  await runTask(tasks, 'DELETE', owner);
  assert.equal(tasks.current(key).token, other);
});
