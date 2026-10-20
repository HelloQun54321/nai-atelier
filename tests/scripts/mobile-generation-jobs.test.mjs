import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import sharp from 'sharp';
import { GenerationTasks } from '../../worker/generationTasks.mjs';

// 执行真实手机适配器，只替换原生桥与 Canvas，全部产物留在内存。
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../../mobile/generationJobs.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'mobile-test-boundaries', setup(builder) {
    builder.onResolve({ filter: /^mobile:generation-output$/ }, () => ({ path: fileURLToPath(new URL('../../scripts/generation-output.mjs', import.meta.url)) }));
    builder.onResolve({ filter: /^(mobile:gateway|\.\/native|\.\.\/services\/imageEdit)$/ }, args => ({ path: args.path, namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'mobile:gateway'
      ? 'export const cacheNovelAiSubscription=()=>{}; export const estimateNovelAiGenerationCost=(payload,exhausted,opus)=>payload.model==="synthetic"||opus?0:7; export const isSubscriptionUnsupported=(url,status)=>Boolean(url)&&[404,405,501].includes(status); export const keyHashFromAuthorization=x=>x; export const sanitizeNovelAiSubscription=x=>x;'
      : args.path === './native'
        ? 'export const bytesToBase64=x=>Buffer.from(x).toString("base64"); export const native={backgroundJob:async()=>{}};'
        : 'export const composeImageEditResult=async (_output, options)=>{if(options.focusedGeometry.crop.x===30) throw new Error("synthetic Canvas failure"); return options.originalImage;};' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createMobileGenerationJobs, rememberNaiSubscription } = module.exports;

for (const stream of [false, true]) test(`手机预览 ${stream}：上游尚在排队时任务已带公共任务标识与状态`, async t => {
  const records = new Map(); let finish;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, stream ? '/api/generate-stream' : '/api/generate');
    const taskId = options.headers['X-Nai-Queue-Task-Id'];
    records.set(taskId, { taskId, phase: 'waiting', position: 0, queueSize: null, proxy: true, cancelable: true, keyHash: 'private', controller: new AbortController() });
    return new Promise(resolve => { finish = () => resolve(new Response('{"error":"synthetic failure"}', { status: 503 })); });
  };
  const { jobs } = createMobileGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), queue: { get: (_key, taskId) => records.get(taskId) }, readGatewayUrl: async () => '' });
  const token = 'synthetic-queue-token-0001';
  jobs.start('key', token, 1, undefined, { payload: { model: 'synthetic', action: 'generate', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0, stream }, { authorization: 'Bearer synthetic' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const job = jobs.get('key', token), queue = jobs.snapshot(job).cloudQueue;
  assert.equal(queue.taskId, job.lastQueueTaskId); assert.equal(queue.proxy, true);
  assert.equal(queue.position, 0); assert.equal(queue.queueSize, null);
  assert.equal(queue.keyHash, undefined); assert.equal(queue.controller, undefined);
  finish(); await job.running;
  assert.equal(job.state, 'failed'); assert.equal(records.size, 1);
});

for (const failure of ['composition', 'storage', 'receipt']) test(`手机真实 ZIP 保存链路：${failure} 失败保留产物且不补发生图`, async t => {
  const png = width => sharp({ create: { width, height: width, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  const generated = await png(8), base = await png(16);
  const uri = image => 'data:image/png;base64,' + image.toString('base64');
  const zip = new JSZip(); zip.file('image.png', generated); const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  let generations = 0, saves = 0;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async url => {
    if (url === '/api/novelai-subscription') return new Response('{}');
    if (url === '/api/generate') { generations++; return new Response(zipped); }
    assert.equal(url, '/api/local-history'); saves++;
    return new Response(JSON.stringify(failure === 'storage' ? { error: 'synthetic storage failure' } : { item: { id: 'missing-image' } }), { status: failure === 'storage' ? 500 : 200 });
  };
  const { jobs } = createMobileGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), queue: { get: () => undefined }, readGatewayUrl: async () => '' });
  const token = 'synthetic-generation-token-0001';
  jobs.start('key', token, 2, undefined, {
    payload: { model: 'synthetic', action: 'infill', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0,
    composition: { originalImage: uri(base), compositeMask: uri(generated), focusedGeometry: { crop: { x: failure === 'composition' ? 30 : 4, y: 4, width: 8, height: 8 } } },
  }, { authorization: 'Bearer synthetic' });
  const job = jobs.get('key', token); await job.running;
  const snapshot = jobs.snapshot(job);
  assert.equal(snapshot.state, 'failed'); assert.equal(snapshot.code, 'history_save_failed'); assert.equal(snapshot.completedCount, 0);
  assert.equal(generations, 1); assert.equal(saves, failure === 'composition' ? 0 : 1);
  assert.deepEqual(Buffer.from(snapshot.preview.image.split(',')[1], 'base64'), failure === 'composition' ? generated : base);
});

for (const [status, member, stale] of [[404, true, false], [405, true, false], [501, true, false], [404, true, true],
  [401, true, true], [403, true, true], [429, true, true], [500, true, true], [502, true, true], [503, true, true], [404, false, true], ['network', true, true]]) {
  test(`手机额度 ${status}、网关 ${member}、旧快照 ${stale}：降级与费用确认遵循桌面规则`, async t => {
    const unsupported = member && [404, 405, 501].includes(status);
    const authorization = 'Bearer synthetic-mobile-quota';
    rememberNaiSubscription(authorization, stale ? { active: true, tier: 3, usage: { isNegative: false } } : null);
    const archive = new JSZip();
    archive.file('image.png', await sharp({ create: { width: 8, height: 8, channels: 3, background: '#526781' } }).png().toBuffer());
    const zipped = await archive.generateAsync({ type: 'nodebuffer' });
    let generated = 0, saved = 0;
    const previous = globalThis.fetch;
    t.after(() => { globalThis.fetch = previous; rememberNaiSubscription(authorization, null); });
    globalThis.fetch = async url => {
      if (url === '/api/novelai-subscription') {
        if (status === 'network') throw new TypeError('synthetic network failure');
        return new Response('{}', { status });
      }
      if (url === '/api/generate') { generated++; return new Response(zipped); }
      assert.equal(url, '/api/local-history');
      return new Response(JSON.stringify({ item: { id: 'saved-' + (++saved), imageUrl: '/synthetic.png' } }));
    };
    const { jobs } = createMobileGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), queue: { get: () => undefined },
      readGatewayUrl: async () => member ? 'https://gateway.example/v1' : '' });
    t.after(() => jobs.close());
    const token = 'synthetic-mobile-quota-token';
    jobs.start('key', token, 3, undefined, { payload: { model: 'nai-diffusion-5-full', action: 'generate', parameters: { n_samples: 1 } },
      history: { prompt: 'synthetic', params: {} }, approvedCost: stale ? 0 : 7 }, { authorization });
    const job = jobs.get('key', token);
    if (unsupported && stale) {
      for (let index = 0; index < 1000 && !['awaiting_confirmation', 'failed', 'succeeded'].includes(job.state); index++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(job.state, 'awaiting_confirmation'); assert.equal(job.cost, 7);
      assert.equal(generated, 0); jobs.approve('key', token, 7);
    }
    await job.running;
    assert.equal(job.state, unsupported ? 'succeeded' : 'failed');
    assert.equal(generated, unsupported ? 3 : 0); assert.equal(saved, unsupported ? 3 : 0);
    if (!unsupported) assert.equal(job.code, 'quota_refresh_failed');
  });
}
