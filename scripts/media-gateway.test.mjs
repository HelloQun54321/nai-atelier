import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VibeEncodingMemoryCache,
  buildCachedVibeReferences,
  generateWithVibeCacheRetry,
  getVibeCacheSecretKey,
  classifyAitagRemoteTarget,
  estimateNovelAiGenerationCost,
  normalizeVibeStrengths,
  parseInvalidVibeCacheKeys,
  CloudQueueCoordinator,
  fetchNovelAiGeneration,
} from './media-gateway.mjs';

test('NovelAI generation uses the computer outbound proxy transport', async () => {
  let captured;
  const requestRemote = async (url, options) => {
    captured = { url, options };
    return new Response('ok', { status: 200 });
  };
  const response = await fetchNovelAiGeneration({ action: 'generate' }, 'Bearer hidden', AbortSignal.timeout(1000), requestRemote);
  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://image.novelai.net/ai/generate-image');
  assert.equal(captured.options.headers.Authorization, 'Bearer hidden');
});

test('cloud queue uses st-chatu8 key hashing without sending the raw NovelAI key', async () => {
  const calls = [];
  const remote = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/join-queue')) return new Response(JSON.stringify({ position: 1, queue_size: 2 }), { status: 200 });
    if (url.includes('/my-turn?')) return new Response(JSON.stringify({ is_my_turn: true, position: 0, queue_size: 2, lock_token: 'lock' }), { status: 200 });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  const coordinator = new CloudQueueCoordinator(remote, 'https://queue.example');
  const lock = await coordinator.join({ apiKey: 'secret-key', taskId: 'task-12345678', greeting: '你好', signal: new AbortController().signal });
  await coordinator.release(lock);
  const joined = JSON.parse(calls[0].options.body);
  assert.equal(joined.key_hash, '85dbe15d75ef9308c7ae0f33c7a324cc6f4bf519a2ed2f3027bd33c140a4f9aa');
  assert.equal(calls.some(call => JSON.stringify(call).includes('secret-key')), false);
  assert.equal(calls.at(-1).url.endsWith('/complete'), true);
});

test('cancelling while waiting removes the task from the cloud queue', async () => {
  const calls = [];
  const remote = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/join-queue')) return new Response(JSON.stringify({ position: 2, queue_size: 3 }), { status: 200 });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };
  const coordinator = new CloudQueueCoordinator(remote, 'https://queue.example');
  const controller = new AbortController();
  const pending = coordinator.join({ apiKey: 'secret-key', taskId: 'task-cancel-123', signal: controller.signal });
  setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 10);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls.at(-1).url.endsWith('/leave-queue'), true);
});

test('AITag computer proxy only accepts known API and image targets', () => {
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/api/ai_works_search?page=1'), 'json');
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/api/work/147453358'), 'json');
  assert.equal(classifyAitagRemoteTarget('https://ai-img.10118899.xyz/NAI/1/example.webp'), 'image');
  assert.equal(classifyAitagRemoteTarget('https://aitag.win/admin'), null);
  assert.equal(classifyAitagRemoteTarget('https://example.com/api/work/1'), null);
  assert.equal(classifyAitagRemoteTarget('file:///etc/passwd'), null);
});

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
