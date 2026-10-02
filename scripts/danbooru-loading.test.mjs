import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDanbooruLimiter, createDanbooruDiskCache } from './danbooru-loading.mjs';
import { createResponseMemoryCache } from './media-memory-cache.mjs';

const clock = () => {
  let time = 0, id = 0; const timers = new Map();
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    now: () => time,
    setTimer: (callback, delay) => { timers.set(++id, { at: time + delay, callback }); return id; },
    clearTimer: id => timers.delete(id),
    async advance(duration) {
      const end = time + duration; await settle();
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      time = end; await settle();
    },
  };
};

test('全局查询突发池八个，持续每秒补一个，启动至少相隔 150ms', async () => {
  const time = clock(), limiter = createDanbooruLimiter(time), starts = [];
  const requests = Array.from({ length: 20 }, () => limiter.run(async () => { starts.push(time.now()); return 1; }));
  await time.advance(30_000); await Promise.all(requests);
  assert.equal(starts.length, 20);
  assert.ok(starts.slice(1).every((at, index) => at - starts[index] >= 150));
  for (let index = 0; index < starts.length; index++) assert.ok(index + 1 <= 8 + Math.floor(starts[index] / 1000));
  assert.ok(starts[19] >= 12_000);
});

test('实际联网不超过四个，可见查询排在后台前，取消排队不花请求预算', async () => {
  const time = clock(), limiter = createDanbooruLimiter(time), order = [];
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const first = Array.from({ length: 4 }, (_, index) => limiter.run(async () => { order.push(index); await blocked; }));
  await time.advance(450); assert.equal(order.length, 4);
  const background = limiter.run(async () => { order.push('background'); }, undefined, 1);
  const controller = new AbortController();
  const cancelled = limiter.run(async () => { order.push('cancelled'); }, controller.signal).catch(error => error);
  const visible = limiter.run(async () => { order.push('visible'); });
  controller.abort(); assert.equal((await cancelled).name, 'AbortError');
  release(); await time.advance(2000); await Promise.all([...first, background, visible]);
  assert.deepEqual(order, [0, 1, 2, 3, 'visible', 'background']);
});

test('热门榜遵循独立端点预算，耗尽后普通检索仍可进行', async () => {
  const time = clock(), limiter = createDanbooruLimiter({ ...time, popularBurst: 2 }), starts = [];
  const popular = Array.from({ length: 3 }, () => limiter.run(async () => { starts.push(time.now()); }, undefined, 0, true));
  await time.advance(500); assert.deepEqual(starts, [0, 150]);
  const ordinary = limiter.run(async () => 'ordinary'); await time.advance(500); assert.equal(await ordinary, 'ordinary');
  await time.advance(60_000); await Promise.all(popular); assert.ok(starts[2] >= 60_000 && starts[2] <= 60_002);
});

test('429 尊重 Retry-After 与指数冷却，403 停五分钟，冷却中不继续联网', async () => {
  const time = clock(), limiter = createDanbooruLimiter(time);
  const rejected = limiter.run(async () => 1).catch(error => error);
  limiter.observe(429, '90'); await rejected;
  await assert.rejects(limiter.run(async () => assert.fail('冷却期间联网')), /90 秒/);
  await time.advance(90_000);
  const recovered = limiter.run(async () => 2); await time.advance(1000); assert.equal(await recovered, 2);
  limiter.observe(429); await assert.rejects(limiter.run(async () => 3), /60 秒/);
  await time.advance(60_000); limiter.observe(403);
  await assert.rejects(limiter.run(async () => 4), /300 秒/);
});

test('公共响应共享取消不误伤其他消费者，最后退出才中止，新请求不被迟到旧响应污染', async () => {
  const cache = createResponseMemoryCache(); let signal, release;
  const load = async nextSignal => { signal = nextSignal; return new Promise(resolve => { release = resolve; }); };
  const a = new AbortController(), b = new AbortController();
  const first = cache.get('shared', load, 1000, a.signal).catch(error => error);
  const second = cache.get('shared', load, 1000, b.signal).catch(error => error);
  await new Promise(resolve => setImmediate(resolve)); a.abort(); assert.equal(signal.aborted, false);
  b.abort(); assert.equal(signal.aborted, true);
  assert.equal((await first).name, 'AbortError'); assert.equal((await second).name, 'AbortError');
  const current = { status: 200, body: Buffer.from('new') };
  await cache.get('shared', async () => current, 1000);
  release({ status: 200, body: Buffer.from('old') }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await cache.get('shared', async () => assert.fail('应命中缓存'), 1000)).body.toString(), 'new');
});

test('封面查询缓存跨重启／浏览器复用，过期不延寿，失败／空／短期／随机不写磁盘', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'nai-danbooru-test-'));
  assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + '\\') || resolve(folder).startsWith(resolve(tmpdir()) + '/'));
  let time = 0;
  try {
    const options = { now: () => time, maxEntries: 2, maxBytes: 2000 };
    const disk = createDanbooruDiskCache(folder, options);
    const value = { status: 200, body: Buffer.from('[{"id":1}]') };
    await disk.set('cover', value, 86_400_000);
    for (const [key, result, ttl] of [['empty', { ...value, body: Buffer.from('[]') }, 86_400_000], ['random', value, 0], ['latest', value, 15_000], ['failed', { ...value, status: 429 }, 86_400_000]]) await disk.set(key, result, ttl);
    assert.equal((await readdir(folder)).length, 1);
    const restarted = createDanbooruDiskCache(folder, options);
    time = 86_399_999; const saved = await restarted.get('cover'); assert.equal(saved.body.toString(), value.body.toString());
    const memory = createResponseMemoryCache({ now: () => time }); await memory.get('cover', async () => saved, 86_400_000);
    time++; assert.equal(await restarted.get('cover'), null);
    let reloaded = false; await memory.get('cover', async () => { reloaded = true; return value; }, 86_400_000); assert.equal(reloaded, true);
    await disk.set('b', value, 86_400_000); await disk.set('c', value, 86_400_000);
    assert.equal(await disk.get('cover'), null); assert.equal((await readdir(folder)).length, 2);
    await writeFile(join(folder, 'unrelated.txt'), 'preserve'); await disk.set('d', value, 86_400_000);
    assert.ok((await readdir(folder)).includes('unrelated.txt'));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
