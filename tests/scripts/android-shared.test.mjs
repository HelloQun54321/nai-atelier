import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { androidDictionaryGenerator } from '../../scripts/android-dictionary.mjs';
import { projectRoot } from '../support/workspace.mjs';
import { DEFAULT_NAI_RUNTIME, computeNaiRuntimeSync, extractNaiRuntimeChunkPaths } from '../../scripts/media-gateway.mjs';
import { NAI_MEDIUM_BILLING_BUNDLE, NAI_TURBOPACK_BILLING_BUNDLE } from '../fixtures/nai-runtime.mjs';

test('Android 默认规则和官方提取复用电脑声明，不能带入 Node 文件系统',async()=>{
  const billing=join(projectRoot,'worker/naiBilling.mjs').replace(/\\/g,'/');
  const source=extractAndroidShared(join(projectRoot,'scripts/media-gateway.mjs'),['DEFAULT_NAI_RUNTIME','computeNaiRuntimeSync','extractNaiRuntimeChunkPaths'],`import {DEFAULT_NAI_BILLING,isNaiBillingRules} from 'file:///${billing}';`);
  const mobile=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.deepEqual(mobile.DEFAULT_NAI_RUNTIME,DEFAULT_NAI_RUNTIME);assert.deepEqual(mobile.computeNaiRuntimeSync('synthetic missing official rules'),computeNaiRuntimeSync('synthetic missing official rules'));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE), computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_TURBOPACK_BILLING_BUNDLE), computeNaiRuntimeSync(NAI_TURBOPACK_BILLING_BUNDLE));
  const html = '<script src="/_next/static/chunks/synthetic.js?dpl=synthetic"></script>';
  assert.deepEqual(mobile.extractNaiRuntimeChunkPaths(html), extractNaiRuntimeChunkPaths(html));
  assert.doesNotMatch(source,/node:|readFile|process\.cwd/);
});

test('手机官方同步复用部署查询参数路径，完整规则写入合成设置', async () => {
  const { transform } = await import('esbuild');
  const gatewayUrl = new URL('../../scripts/media-gateway.mjs', import.meta.url).href;
  const source = extractAndroidShared(join(projectRoot, 'mobile/gateway.ts'), ['refreshRuntime'], `
    import { extractNaiRuntimeChunkPaths } from '${gatewayUrl}';
    const requests = [], writes = [];
    let runtime = { health: { ok: false }, syncedAt: 0 };
    const getNaiRuntime = () => runtime;
    const applyNaiRuntimeOverride = next => { runtime = { ...runtime, ...next }; };
    const fetchNaiRuntimeText = async url => {
      requests.push(url);
      return url.endsWith('/image') ? '<script src="/_next/static/chunks/synthetic.js?dpl=synthetic"></script>' : 'synthetic chunk';
    };
    const computeNaiRuntimeSync = text => {
      if (text !== 'synthetic chunk') throw new Error('missing chunk');
      return { runtime: { synthetic: true }, health: { ok: true, missed: [] } };
    };
  `, { writeSetting: 'const writeSetting = async (key, value) => { writes.push({ key, value }); };' });
  const transformed = await transform(source + '\nexport { requests, writes };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  await mobile.refreshRuntime();
  assert.deepEqual(mobile.requests, ['https://novelai.net/image', 'https://novelai.net/_next/static/chunks/synthetic.js?dpl=synthetic']);
  assert.equal(mobile.writes.length, 1);
  assert.equal(mobile.writes[0].key, 'mobile_nai_runtime');
  assert.equal(mobile.writes[0].value.synthetic, true);
  assert.equal(mobile.writes[0].value.health.ok, true);
});

test('手机接入路由按所选 Key 连接生成、余额与 Vibe，切回官方不残留网关', async t => {
  const { transform } = await import('esbuild');
  const connectionUrl = new URL('../../worker/naiConnection.mjs', import.meta.url).href;
  const gatewayUrl = new URL('../../scripts/media-gateway.mjs', import.meta.url).href;
  const source = extractAndroidShared(join(projectRoot, 'mobile/gateway.ts'), ['mobileGateway'], `
    import { resolveNaiGatewayUrl } from '${connectionUrl}';
    import { sanitizeNovelAiSubscription, normalizeCloudQueuePreferences } from '${gatewayUrl}';
    const keyHashFromAuthorization = authorization => authorization;
    let nativeRequests = 0;
    const nativeFetch = (...args) => { nativeRequests++; return fetch(...args); };
    const entries = [{ key: 'STA1N-phone', gatewayUrl: 'https://gateway.example/v1' }];
    const json = value => new Response(JSON.stringify(value));
    const runHandler = (request, handler) => handler({ headers: { authorization: request.headers.get('authorization') } }, {});
    const handleGenerateRequest = (...args) => json({ handler: 'zip', gatewayUrl: args[7].gatewayUrl });
    const handleGenerateStreamRequest = (...args) => json({ handler: 'stream', gatewayUrl: args[7].gatewayUrl });
    const handleVibeEncodeRequest = (...args) => json({ handler: 'vibe', gatewayUrl: args[6] });
    const rememberNaiSubscription = () => {};
  `, { tasks: 'const tasks = {};', queue: 'const queue = {};', generationJobs: 'const generationJobs = {};',
    readSetting: "const readSetting = async (key, fallback) => key === 'nai_key_vault' ? entries : fallback;" });
  const transformed = await transform(source + '\nexport { nativeRequests };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, authorization: options.headers.authorization, redirect: options.redirect });
    return new Response('{"active":true,"tier":3,"trainingStepsLeft":{"fixedTrainingStepsLeft":3,"purchasedTrainingSteps":7}}');
  });
  for (const [key, target] of [['STA1N-phone', 'https://gateway.example/v1'], ['pst-phone-official', '']]) {
    for (const path of ['/api/generate', '/api/generate-stream', '/api/vibes/synthetic/encodings']) {
      const response = await mobile.mobileGateway(new Request(`https://localhost${path}`, { method: 'POST', headers: { authorization: `Bearer ${key}` } }));
      assert.equal((await response.json()).gatewayUrl, target);
    }
    const response = await mobile.mobileGateway(new Request('https://localhost/api/novelai-subscription', { headers: { authorization: `Bearer ${key}` } }));
    assert.equal((await response.json()).source, target ? 'gateway' : undefined);
    assert.deepEqual(calls.at(-1), { url: `${target || 'https://image.novelai.net'}/user/subscription`, authorization: `Bearer ${key}`, redirect: target ? 'error' : undefined });
  }
  await assert.rejects(mobile.mobileGateway(new Request('https://localhost/api/novelai-subscription', { headers: { authorization: 'Bearer STA1N-missing' } })), { status: 400 });
  assert.equal(calls.length, 2);
  assert.equal(mobile.nativeRequests, 1);
});
test('手机词库生成必须留下原子切换，由共用生成器保留字符检索和目录分页',()=>{
  const source=androidDictionaryGenerator(join(projectRoot,'scripts/update-tag-dictionary.mjs'));
  assert.match(source,/characterSearchRecords/);assert.match(source,/artistNamePages/);assert.match(source,/characterNamePages/);
  assert.doesNotMatch(source,/DatabaseSync|await rm\(|rename\(STAGING|local-data/);
});

test('手机共用生图处理器包含通用中转分支，构建注入地址和队列数量依赖', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['handleGenerateRequest', 'handleGenerateStreamRequest']);
  assert.match(source, /getCloudQueueGenerationUrl\(queuePreferences\.serviceUrl\)/);
  assert.match(source, /getCloudQueueGenerationUrl\(queuePreferences\.serviceUrl, true\)/);
  const build = await readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8');
  assert.match(build, /import \{ getCloudQueueGenerationUrl \} from '\/worker\/cloudQueueTarget\.mjs'/);
  assert.match(build, /import \{ normalizeCloudQueueCount \} from '\/worker\/cloudQueueNumbers\.mjs'/);
  assert.match(source, /parseHttpError\(/);
  assert.equal((build.match(/import \{ parseHttpError \} from '\/services\/httpErrors\.mjs'/g) || []).length, 2);
});

 test('Android 共用任务租约接口及协调器，不遗漏后端单并发依赖', async () => {
   const { readFile } = await import('node:fs/promises');
   const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['handleGenerationTaskRequest', 'handleGenerateRequest', 'handleGenerateStreamRequest']);
   assert.match(source, /tasks\.enter\(keyHash/); assert.match(source, /tasks\.reserve\(key, token, count\)/); assert.match(source, /finishGeneration\?\.\(\)/);
   const build = await readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8');
   assert.match(build, /'handleGenerationTaskRequest'/);
   assert.match(build, /import \{ GenerationTasks, DEFAULT_GENERATION_INTERVAL_SECONDS, MAX_GENERATION_INTERVAL_SECONDS, validateGenerationInterval \} from '\/worker\/generationTasks\.mjs'/);
 });

test('Android 共用间隔设置与校验，旧公共队列设置更新不丢间隔', async () => {
  const url = new URL('../../worker/generationTasks.mjs', import.meta.url).href;
  const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['normalizeCloudQueuePreferences'], `import { DEFAULT_GENERATION_INTERVAL_SECONDS, MAX_GENERATION_INTERVAL_SECONDS } from '${url}';`);
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.equal(mobile.normalizeCloudQueuePreferences({}).generationIntervalSeconds, 2);
  assert.equal(mobile.normalizeCloudQueuePreferences({ generationIntervalSeconds: 0, enabled: false }).generationIntervalSeconds, 0);
  assert.equal(mobile.normalizeCloudQueuePreferences({ generationIntervalSeconds: 8, greeting: '手机' }).generationIntervalSeconds, 8);
  assert.equal(mobile.normalizeCloudQueuePreferences({ generationIntervalSeconds: 0.5 }).generationIntervalSeconds, 0.5);
  assert.equal(mobile.normalizeCloudQueuePreferences({ generationIntervalSeconds: 0.55 }).generationIntervalSeconds, 2);
});

test('Android 复用成功消费记录，免费 V4.5 也计张数，未知费用不扣预算', async () => {
  const billing = new URL('../../worker/naiBilling.mjs', import.meta.url).href;
  const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['settleSuccessfulNovelAiGeneration', 'DEFAULT_NAI_RUNTIME'], `
    import { DEFAULT_NAI_BILLING, estimateNaiBilling, isNaiBillingRules } from '${billing}';
    const writes = [];
    const requestWorkerJson = async (path, req, port, options) => { writes.push({ path, ...options }); return { inserted: 1, remaining: 99 }; };
  `, { requestWorkerJson: '' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { writes };').toString('base64'));
  assert.doesNotMatch(source, /httpRequest|node:fs/);
  const options = { payload: { model: 'nai-diffusion-4-5-full', parameters: { width: 832, height: 1216, steps: 23, n_samples: 1 } }, keyHash: 'a'.repeat(64), req: {}, workerPort: 0,
    billing: { runtime: mobile.DEFAULT_NAI_RUNTIME, subscription: { active: true, tier: 3 }, opusSubscriber: true, exhausted: false } };
  const result = await mobile.settleSuccessfulNovelAiGeneration(options);
  assert.equal(result.estimatedCost, 0); assert.equal(result.accountingFailed, false);
  assert.equal(mobile.writes.length, 1); assert.equal(mobile.writes[0].path, '/api/local-usage/events');
  assert.deepEqual(mobile.writes[0].body, { category: 'nai', action: 'generation', target: 'a'.repeat(64), amount: 1, value: 0,
    meta: { model: options.payload.model, billingKnown: true, opusImages: 0 } });
  await mobile.settleSuccessfulNovelAiGeneration({ ...options, billing: { runtime: mobile.DEFAULT_NAI_RUNTIME } });
  assert.equal(mobile.writes.length, 2);
  assert.equal(mobile.writes[1].body.value, undefined);
  assert.equal(mobile.writes[1].body.meta.billingKnown, false);
});

test('Android 提取后的角色参考与额度降级共用桌面实现，构建显式导出判定函数', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['toCachedPreciseReferenceParameters', 'isSubscriptionUnsupported'],
    "import { createHmac, randomBytes } from 'node:crypto';");
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const converted = mobile.toCachedPreciseReferenceParameters({ director_reference_images: ['synthetic-image-data'], director_reference_strength_values: [0.6] });
  assert.equal(converted.director_reference_images, undefined);
  assert.equal(converted.director_reference_images_cached[0].data, 'synthetic-image-data');
  assert.match(converted.director_reference_images_cached[0].cache_secret_key, /^[a-f0-9]{64}$/);
  assert.deepEqual(converted.director_reference_strength_values, [0.6]);
  for (const status of [404, 405, 501]) assert.equal(mobile.isSubscriptionUnsupported('https://gateway.example', status), true);
  assert.equal(mobile.isSubscriptionUnsupported('', 404), false);
  const build = await readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8');
  assert.match(build, /'isSubscriptionUnsupported'/);
});
