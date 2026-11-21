import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as mobileSleep } from '../../mobile/shims/timers.mjs';
import { fetchNovelAiSubscription } from '../../scripts/novelai-subscription-network.mjs';

test('Android 订阅复用外部网络模块，构建不再从网关提取已移动声明', async () => {
  const source = await readFile(new URL('../../scripts/build-android.mjs', import.meta.url), 'utf8');
  const exports = source.match(/const gatewayExports = \[(.*?)\];/s)[1];
  assert.doesNotMatch(exports, /'fetchNovelAiSubscription'/);
  assert.match(source, /import \{ fetchNovelAiSubscription \} from '\/scripts\/novelai-subscription-network.mjs'/);
  assert.match(source, /replacement: shim\('timers'\)/);
});

test('手机定时器完成返回值、拒绝已取消及等待中的请求', async () => {
  assert.equal(await mobileSleep(0, 42), 42);
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const pending = mobileSleep(60000, null, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  await assert.rejects(mobileSleep(0, null, { signal: controller.signal }), error => error === reason);
});

test('订阅读取有限重试且不发送生图请求', async () => {
  let calls = 0;
  const response = await fetchNovelAiSubscription('synthetic', undefined, async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(new URL(url).pathname, '/user/subscription');
    return ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ tier: 3 });
  }, '', { retryDelaysMs: [0] });
  assert.equal(calls, 2);
  assert.deepEqual(await response.json(), { tier: 3 });
});
