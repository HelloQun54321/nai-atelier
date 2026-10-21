import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import JSZip from 'jszip';
import { composeGenerationOutput, generationImageBytes, readGenerationResponse } from '../../scripts/generation-output.mjs';
import { createDesktopGenerationJobs, handleGenerationJobRequest } from '../../scripts/generation-gateway.mjs';
import { GenerationTasks } from '../../worker/generationTasks.mjs';
import { GenerationJobs } from '../../worker/generationJobs.mjs';

const png = async (width, height, rgba) => sharp({ create: { width, height, channels: 4, background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 } } }).png().toBuffer();
const uri = bytes => 'data:image/png;base64,' + bytes.toString('base64');

test('第六张返回502网页时停止任务并保留前五张，回执不暴露HTML，不自动重试', async () => {
  let requests = 0;
  const html = '<!DOCTYPE html><html><title>novelai.net | 502: Bad gateway</title><body>synthetic-ray-id</body></html>';
  const jobs = new GenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), validate: () => {}, estimate: async () => 0, readCleanup: () => undefined,
    generate: async () => { if (++requests === 6) return readGenerationResponse(new Response(html, { status: 502 })); return { seed: requests }; },
    save: async (_job, output, metadata) => ({ ...metadata, id: `saved-${output.seed}`, imageUrl: `/synthetic/${output.seed}.png` }),
  });
  const descriptor = { payload: { model: 'synthetic', action: 'generate', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0 };
  jobs.start('synthetic-key', 'synthetic-http-error-token', 6, undefined, descriptor, {});
  const job = jobs.get('synthetic-key', 'synthetic-http-error-token'); await job.running;
  const snapshot = jobs.snapshot(job);
  assert.equal(snapshot.state, 'failed'); assert.equal(snapshot.completedCount, 5); assert.equal(snapshot.requestedCount, 6);
  assert.deepEqual(snapshot.historyIds, ['saved-1', 'saved-2', 'saved-3', 'saved-4', 'saved-5']);
  assert.equal(snapshot.error, '服务暂时不可用 (HTTP 502)，请稍后重试'); assert.equal(requests, 6);
  assert.doesNotMatch(snapshot.error, /DOCTYPE|synthetic-ray-id|<html/);
});

test('JSON中的HTML及SSE错误帧共用简明错误说明，保留业务错误码', async () => {
  const html = '<html><body>synthetic upstream error</body></html>';
  await assert.rejects(readGenerationResponse(new Response(JSON.stringify({ error: html, code: 'UPSTREAM_DOWN' }), { status: 503 })), { message: '服务暂时不可用 (HTTP 503)，请稍后重试', code: 'UPSTREAM_DOWN', status: 503 });
  await assert.rejects(readGenerationResponse(new Response(`event: error\ndata: ${JSON.stringify({ message: html })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })), { message: '服务返回了错误页面，请稍后重试', code: 'generation_failed' });
});

for (const stream of [false, true]) test(`电脑预览 ${stream}：上游尚在排队时任务已带公共任务标识与状态`, async t => {
  const records = new Map(); let finish;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith(stream ? '/api/generate-stream' : '/api/generate'));
    const taskId = options.headers['X-Nai-Queue-Task-Id'];
    records.set(taskId, { taskId, phase: 'waiting', position: 2, queueSize: 4, cancelable: true, keyHash: 'private', controller: new AbortController() });
    return new Promise(resolve => { finish = () => resolve(new Response('{"error":"synthetic failure"}', { status: 503 })); });
  };
  const jobs = createDesktopGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), gatewayUrl: () => 'http://synthetic', workerPort: 9999,
    estimate: async () => 0, readCleanup: () => undefined, readQueue: job => records.get(job.lastQueueTaskId),
  });
  const token = 'synthetic-queue-token-0001';
  jobs.start('key', token, 1, undefined, { payload: { model: 'synthetic', action: 'generate', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0, stream }, { authorization: 'Bearer synthetic' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const job = jobs.get('key', token), queue = jobs.snapshot(job).cloudQueue;
  assert.equal(queue.taskId, job.lastQueueTaskId);
  assert.equal(queue.position, 2); assert.equal(queue.queueSize, 4);
  assert.equal(queue.keyHash, undefined); assert.equal(queue.controller, undefined);
  finish(); await job.running;
  assert.equal(job.state, 'failed'); assert.equal(records.size, 1);
});

test('电脑 GET 传递预览版本，未带版本的旧客户端保留完整快照', async () => {
  const seen = [], job = { state: 'generating' };
  const jobs = { get: () => job, snapshot: (value, version) => { assert.equal(value, job); seen.push(version); return {}; } };
  const options = { allowed: () => true, keyHash: () => 'synthetic', sendJson: (_res, status) => assert.equal(status, 200) };
  for (const suffix of ['&previewVersion=7', '']) await handleGenerationJobRequest({ method: 'GET', url: '/api/generation-job?token=synthetic' + suffix, headers: {} }, {}, jobs, options);
  assert.deepEqual(seen, ['7', null]);
});

test('电脑真实预览解析与 HTTP 推送逐步交付，同块八步不覆盖，终态仍保存一次', async () => {
  let begin;
  const frames = Array.from({ length: 8 }, (_, step) => `event: intermediate\ndata: ${JSON.stringify({ image: 'iVBORw0KGgo=', step_ix: step })}\n\n`).join('') + 'event: final\ndata: {"image":"iVBORw0KGgo="}\n\n';
  let saves = 0;
  const jobs = new GenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), validate: () => {}, estimate: async () => 0, readCleanup: () => undefined,
    generate: async (_job, _payload, preview) => {
      await new Promise(resolve => { begin = resolve; });
      return readGenerationResponse(new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } }), preview);
    },
    save: async (_job, _output, metadata) => { saves++; return { ...metadata, imageUrl: '/synthetic/saved.png' }; },
  });
  const token = 'synthetic-preview-token-0001';
  jobs.start('key', token, 1, undefined, { payload: { model: 'synthetic', action: 'generate', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0, stream: true }, {});
  const chunks = [], res = new EventEmitter();
  res.writeHead = (status, headers) => { assert.equal(status, 200); assert.match(headers['content-type'], /text\/event-stream/); };
  res.write = value => { chunks.push(new TextDecoder().decode(value)); return true; };
  res.end = () => {};
  const request = handleGenerationJobRequest({ method: 'GET', url: `/api/generation-job?token=${token}&events=1`, headers: {} }, res, jobs, { allowed: () => true, keyHash: () => 'key', sendJson: () => assert.fail('不能退为 JSON') });
  await new Promise(resolve => setTimeout(resolve, 0)); begin();
  await request;
  const events = chunks.map(chunk => JSON.parse(chunk.split('data: ')[1]));
  assert.deepEqual(events.filter(event => event.preview?.step).map(event => event.preview.step), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(events.at(-1).state, 'succeeded'); assert.equal(saves, 1);
  assert.equal(res.listenerCount('close'), 0);
});

for (const failure of ['composition', 'storage', 'receipt']) test(`电脑真实 ZIP 保存链路：${failure} 失败保留产物且不补发生图`, async t => {
  const generated = await png(8, 8, [220, 140, 60, 255]);
  const base = await png(16, 16, [20, 40, 60, 255]);
  const mask = await png(8, 8, [255, 255, 255, 255]);
  const composition = { originalImage: uri(base), compositeMask: uri(mask), focusedGeometry: { crop: { x: failure === 'composition' ? 30 : 4, y: 4, width: 8, height: 8 } } };
  const zip = new JSZip(); zip.file('image.png', generated); const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  let generations = 0, saves = 0;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async url => {
    if (String(url).endsWith('/api/generate')) { generations++; return new Response(zipped); }
    assert.ok(String(url).endsWith('/api/local-history')); saves++;
    return new Response(JSON.stringify(failure === 'storage' ? { error: 'synthetic save error' } : { item: { id: 'missing-image' } }), { status: failure === 'storage' ? 500 : 200 });
  };
  const jobs = createDesktopGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), gatewayUrl: () => 'http://synthetic', workerPort: 9999, estimate: async () => 0, readCleanup: () => undefined });
  const token = 'synthetic-generation-token-0001';
  jobs.start('key', token, 2, undefined, { payload: { model: 'synthetic', action: 'infill', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, composition, approvedCost: 0 }, { authorization: 'Bearer synthetic', cookie: '', host: 'localhost', ip: '127.0.0.1' });
  const job = jobs.get('key', token); await job.running;
  const snapshot = jobs.snapshot(job);
  assert.equal(snapshot.state, 'failed'); assert.equal(snapshot.code, 'history_save_failed');
  assert.equal(snapshot.completedCount, 0); assert.equal(generations, 1); assert.equal(saves, failure === 'composition' ? 0 : 1);
  const recovered = generationImageBytes(snapshot.preview.image);
  assert.equal((await sharp(recovered.bytes).metadata()).width, failure === 'composition' ? 8 : 16);
  if (failure === 'composition') assert.deepEqual(recovered.bytes, generated);
});

test('聚焦回贴保留选区外像素，只在整图真实选区混合羽化像素', async () => {
  const base = await png(16, 16, [20, 40, 60, 255]);
  const generated = await png(8, 8, [220, 140, 60, 255]);
  const mask = await png(8, 8, [255, 255, 255, 128]);
  const result = await composeGenerationOutput(generated, { originalImage: uri(base), compositeMask: uri(mask), focusedGeometry: { crop: { x: 4, y: 4, width: 8, height: 8 } } });
  const image = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, 16); assert.equal(image.info.height, 16);
  const pixel = (x, y) => [...image.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [20, 40, 60, 255]);
  assert.deepEqual(pixel(3, 8), [20, 40, 60, 255]);
  assert.deepEqual(pixel(8, 8), [120, 90, 60, 255]);
  assert.deepEqual(pixel(12, 8), [20, 40, 60, 255]);
});

test('扩图新区域的全量蒙版不混回白色底图，透明回贴保持输出 alpha', async () => {
  const base = await png(8, 8, [255, 255, 255, 255]);
  const generated = await png(8, 8, [10, 70, 130, 128]);
  const mask = await png(8, 8, [255, 255, 255, 255]);
  const result = await composeGenerationOutput(generated, { originalImage: uri(base), compositeMask: uri(mask) });
  const actual = await sharp(result.bytes).raw().toBuffer();
  assert.deepEqual([...actual.subarray(0, 4)], [10, 70, 130, 128]);
});

test('ZIP 最终图片、真实 seed 与记账失败独立收回，不把附属 JSON 损坏当作再次生成理由', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const zip = new JSZip(); zip.file('image.png', image); zip.file('metadata.json', JSON.stringify({ parameters: { seed: 123 } }));
  const decoded = await readGenerationResponse(new Response(await zip.generateAsync({ type: 'nodebuffer' }), { headers: { 'X-Nai-Anlas-Accounting-Failed': '1', 'X-Nai-Anlas-Accounting-Error': encodeURIComponent('用量记录写入失败（HTTP 500）') } }));
  assert.equal(decoded.seed, 123); assert.equal(decoded.accountingFailed, true); assert.deepEqual(decoded.bytes, image);
  assert.equal(decoded.accountingError, '用量记录写入失败（HTTP 500）');
});

test('浏览器平台不支持 nodebuffer 时仍能解包并交付可读取的 PNG', async t => {
  const nodebuffer = JSZip.support.nodebuffer;
  t.after(() => { JSZip.support.nodebuffer = nodebuffer; });
  JSZip.support.nodebuffer = false;
  const zip = new JSZip();
  zip.file('image.png', await png(8, 8, [40, 80, 120, 255]));
  const decoded = await readGenerationResponse(new Response(await zip.generateAsync({ type: 'uint8array' })));
  const image = await sharp(decoded.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, 8);
  assert.deepEqual([...image.data.subarray(0, 4)], [40, 80, 120, 255]);
});

test('SSE final 后中断仍交付成图，只有 intermediate 时不能伪报成功', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const final = `event: final\ndata: ${JSON.stringify({ image: image.toString('base64'), seed: 321 })}\n\n`;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(final)); setTimeout(() => controller.error(new Error('synthetic-late-disconnect')), 0); } });
  const result = await readGenerationResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.deepEqual(result.bytes, image); assert.equal(result.seed, 321); assert.equal(result.accountingFailed, true);
  await assert.rejects(readGenerationResponse(new Response(`event: intermediate\ndata: ${JSON.stringify({ image: image.toString('base64') })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })), { code: 'generation_output_invalid' });
});

test('SSE 已有记账成功回执后断流不误报，明确记账失败仍保留原因', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const final = `event: final\ndata: ${JSON.stringify({ image: image.toString('base64') })}\n\n`;
  for (const known of [true, false]) {
    const usage = `event: nai_usage\ndata: ${JSON.stringify({ refreshPersonal: true, accountingFailed: false, ...(known ? { estimatedSpent: 0 } : {}) })}\n\n`;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(final + usage)); setTimeout(() => controller.error(new Error('synthetic-late-disconnect')), 0); } });
    const result = await readGenerationResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    assert.deepEqual(result.bytes, image); assert.equal(result.accountingFailed, false);
    assert.equal(result.estimatedCost, known ? 0 : undefined);
  }
  const result = await readGenerationResponse(new Response(final + 'event: nai_usage\ndata: {"estimatedSpent":0}\n\nevent: nai_usage_error\ndata: {"message":"本地预算更新失败（HTTP 500）"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.equal(result.accountingFailed, true); assert.equal(result.accountingError, '本地预算更新失败（HTTP 500）');
  const failedReceipt = 'event: nai_usage\ndata: {"estimatedSpent":0,"accountingFailed":true,"accountingError":"用量记录写入失败（HTTP 503）"}\n\n';
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(final + failedReceipt)); setTimeout(() => controller.error(new Error('synthetic-late-disconnect')), 0); } });
  const failed = await readGenerationResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.equal(failed.accountingFailed, true); assert.equal(failed.accountingError, '用量记录写入失败（HTTP 503）');
});

test('SSE 忽略未使用事件的非 JSON 内容，不将收尾消息误报为记账失败', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const frames = `event: final\ndata: ${JSON.stringify({ image: image.toString('base64') })}\n\nevent: nai_usage\ndata: {"estimatedSpent":0}\n\ndata: [DONE]\n\n`;
  const result = await readGenerationResponse(new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.deepEqual(result.bytes, image); assert.equal(result.accountingFailed, false);
});

test('后台回贴拒绝越界选区和任意外部原料地址', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  assert.throws(() => generationImageBytes('https://example.invalid/image.png'), { code: 'generation_output_invalid' });
  await assert.rejects(composeGenerationOutput(image, { originalImage: uri(image), compositeMask: uri(image), focusedGeometry: { crop: { x: 7, y: 0, width: 2, height: 8 } } }), { code: 'generation_output_invalid' });
});
