import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VibeEncodingMemoryCache,
  buildCachedVibeReferences,
  generateWithVibeCacheRetry,
  getVibeCacheSecretKey,
  estimateNovelAiGenerationCost,
  normalizeVibeStrengths,
  parseInvalidVibeCacheKeys,
} from './media-gateway.mjs';

test('Vibe strengths are only scaled when their sum exceeds one', () => {
  assert.deepEqual(normalizeVibeStrengths([{ strength: 0.2 }, { strength: 0.3 }]), [0.2, 0.3]);
  assert.deepEqual(normalizeVibeStrengths([{ strength: 0.8 }, { strength: 0.8 }]), [0.5, 0.5]);
});

test('NovelAI V4.5 costs follow Opus free limits and current web formula', () => {
  const payload = { action: 'generate', parameters: { width: 832, height: 1216, steps: 23, n_samples: 1 } };
  assert.equal(estimateNovelAiGenerationCost(payload), 0);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: { ...payload.parameters, steps: 29 } }), 20);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: {
    ...payload.parameters,
    reference_image_multiple_cached: Array.from({ length: 5 }, (_, index) => ({ cache_secret_key: String(index) })),
  } }), 2);
  assert.equal(estimateNovelAiGenerationCost({ ...payload, parameters: {
    ...payload.parameters,
    director_reference_images_cached: [{ cache_secret_key: 'character' }],
  } }), 5);
});

test('cached Vibe references use stable private keys and optionally include data', () => {
  const encodings = ['encoding-a', 'encoding-b'];
  const first = buildCachedVibeReferences(encodings);
  assert.equal(first[0].cache_secret_key, getVibeCacheSecretKey(encodings[0]));
  assert.equal(first[0].data, encodings[0]);

  const includeOnlySecond = new Set([getVibeCacheSecretKey(encodings[1])]);
  const retry = buildCachedVibeReferences(encodings, includeOnlySecond);
  assert.equal('data' in retry[0], false);
  assert.equal(retry[1].data, encodings[1]);
});

test('encoding memory cache merges concurrent loads and evicts least recently used data', async () => {
  const cache = new VibeEncodingMemoryCache(10);
  let loads = 0;
  const loader = async () => {
    loads++;
    return { encoding: Buffer.from('123456').toString('base64') };
  };
  const [first, second] = await Promise.all([cache.get('one', loader), cache.get('one', loader)]);
  assert.equal(first, second);
  assert.equal(loads, 1);
  await cache.get('two', async () => ({ encoding: Buffer.from('abcdef').toString('base64') }));
  assert.equal(cache.entries.has('one'), false);
  assert.equal(cache.entries.has('two'), true);
});

test('NovelAI invalid cache-key response is recognized without logging encoded data', async () => {
  const response = new Response(JSON.stringify({
    message: 'INVALID_CACHE_KEYS',
    details: { invalidKeys: ['key-a'] },
  }), { status: 400 });
  const parsed = await parseInvalidVibeCacheKeys(response);
  assert.deepEqual([...parsed.invalidKeys], ['key-a']);
});

test('generation retries once with encoded data when NovelAI cache has expired', async () => {
  const encoding = `retry-${'x'.repeat(128)}`;
  const cacheKey = getVibeCacheSecretKey(encoding);
  const payload = {
    parameters: {
      reference_image_multiple_cached: [{ cache_secret_key: cacheKey }],
      reference_strength_multiple: [0.6],
    },
  };
  const requests = [];
  const requestGeneration = async currentPayload => {
    requests.push(structuredClone(currentPayload));
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        message: 'INVALID_CACHE_KEYS',
        details: { invalidKeys: [cacheKey] },
      }), { status: 400 });
    }
    return new Response('zip', { status: 200 });
  };

  const response = await generateWithVibeCacheRetry(payload, 'Bearer test', [encoding], new Set(), requestGeneration);
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal('data' in requests[0].parameters.reference_image_multiple_cached[0], false);
  assert.equal(requests[1].parameters.reference_image_multiple_cached[0].data, encoding);
});
