import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNovelAiSubscription as query } from '../../scripts/novelai-subscription-network.mjs';
const options = { retryDelaysMs: [1, 1], attemptTimeoutMs: 100 };
const ok = () => Response.json({ active: true, tier: 3 });

test('temporary network failure recovers using GET with unchanged authorization and gateway', async () => {
  let calls = 0;
  const response = await query('Bearer synthetic-test', AbortSignal.timeout(1000), async (url, init) => {
    assert.equal(url, 'https://example.invalid/user/subscription');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test');
    assert.equal(init.redirect, 'error');
    if (++calls === 1) throw new TypeError('fetch failed');
    return ok();
  }, 'https://example.invalid', options);
  assert.equal(calls, 2);
  assert.equal((await response.json()).tier, 3);
});
for (const status of [401, 403, 429]) test(`${status} is not retried`, async () => {
  let calls = 0;
  const response = await query('test', AbortSignal.timeout(1000), async () => { calls++; return new Response('', { status }); }, '', options);
  assert.equal(response.status, status);
  assert.equal(calls, 1);
});
test('temporary upstream failure has a three-attempt bound', async () => {
  let calls = 0;
  const response = await query('test', AbortSignal.timeout(1000), async () => { calls++; return new Response('', { status: 503 }); }, '', options);
  assert.equal(response.status, 503);
  assert.equal(calls, 3);
});
test('broken response body is retried before delivery', async () => {
  let calls = 0;
  const response = await query('test', AbortSignal.timeout(1000), async () => {
    if (++calls === 1) return new Response(new ReadableStream({ start(c) { c.error(new TypeError('socket closed')); } }));
    return ok();
  }, '', options);
  assert.equal((await response.json()).active, true);
  assert.equal(calls, 2);
});
test('per-attempt timeout recovers without waiting for the overall timeout', async () => {
  let calls = 0;
  await query('test', AbortSignal.timeout(1000), async (_, { signal }) => {
    if (++calls > 1) return ok();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, '', { ...options, attemptTimeoutMs: 5 });
  assert.equal(calls, 2);
});
test('caller cancellation stops retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(query('test', controller.signal, async () => {
    calls++;
    controller.abort(new DOMException('cancelled', 'AbortError'));
    throw new TypeError('fetch failed');
  }, '', options), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('overall deadline bounds retries', async () => {
  let calls = 0;
  await assert.rejects(query('test', AbortSignal.timeout(5), async () => { calls++; throw new TypeError('fetch failed'); }, '', { ...options, retryDelaysMs: [50, 50] }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
