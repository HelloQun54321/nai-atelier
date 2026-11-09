import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWithCacheRetry, toCachedBaseImageParameters } from '../../scripts/media-gateway.mjs';

const okResponse = () => new Response('synthetic', { status: 200 });

test('底图缓存：首次带原图，官方确认后只发键', async () => {
  const payload = { parameters: { image: 'synthetic-base-64' } };
  const originals = { image: 'synthetic-base-64' };
  const first = toCachedBaseImageParameters(payload.parameters, { reuseServerCache: true });
  assert.equal(first.size, 0, '首次未确认前不能省略原图');
  assert.equal(payload.parameters.image, 'synthetic-base-64');
  assert.match(payload.parameters.image_cache_secret_key, /^[0-9a-f]{64}$/);

  await generateWithCacheRetry(payload, 'Bearer synthetic', { baseImageOriginals: originals }, async () => okResponse());

  const second = { parameters: { image: 'synthetic-base-64' } };
  const omitted = toCachedBaseImageParameters(second.parameters, { reuseServerCache: true });
  assert.equal(omitted.size, 1);
  assert.equal(second.parameters.image, undefined, '确认过的底图不再重复上传');
  assert.ok(second.parameters.image_cache_secret_key);
});

test('底图缓存：中转站与云队列始终带原图，只附加缓存键', () => {
  const parameters = { image: 'synthetic-base-64', mask: 'synthetic-mask' };
  const omitted = toCachedBaseImageParameters(parameters);
  assert.equal(omitted.size, 0);
  assert.equal(parameters.image, 'synthetic-base-64');
  assert.equal(parameters.mask, 'synthetic-mask');
  assert.ok(parameters.image_cache_secret_key);
  assert.ok(parameters.mask_cache_secret_key);
});

test('底图缓存失效时补回原图并重试一次', async () => {
  const payload = { parameters: { image: 'synthetic-base-64' } };
  const originals = { image: 'synthetic-base-64' };
  await generateWithCacheRetry(payload, 'Bearer synthetic', { baseImageOriginals: originals }, async () => okResponse());

  const retryPayload = { parameters: { image: 'synthetic-base-64' } };
  toCachedBaseImageParameters(retryPayload.parameters, { reuseServerCache: true });
  assert.equal(retryPayload.parameters.image, undefined);
  const sentKeys = retryPayload.parameters.image_cache_secret_key;

  const requests = [];
  const response = await generateWithCacheRetry(retryPayload, 'Bearer synthetic', { baseImageOriginals: originals }, async next => {
    requests.push(JSON.parse(JSON.stringify(next.parameters)));
    return requests.length === 1
      ? new Response(JSON.stringify({ message: 'INVALID_CACHE_KEYS', details: { invalidKeys: [sentKeys] } }), { status: 400 })
      : okResponse();
  });
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].image, 'synthetic-base-64', '失效的那次必须把原图补回来');
  assert.ok(requests[1].image_cache_secret_key);
});
