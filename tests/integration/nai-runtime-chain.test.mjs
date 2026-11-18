import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import JSZip from 'jszip';
import sharp from 'sharp';
import { Agent, MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { createWorkspace, removeWorkspace, projectRoot } from '../support/workspace.mjs';
import { cacheNovelAiSubscription, createMediaGateway, DEFAULT_NAI_RUNTIME, estimateNovelAiGenerationCost } from '../../scripts/media-gateway.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const withDeadline = async (promise, ms, phase) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase}超时（${ms}ms）`)), ms);
    })]);
  } finally { clearTimeout(timer); }
};
const nativeJson = (port, path, method = 'GET', body, signal = AbortSignal.timeout(10_000)) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port, path, method, agent: false, signal,
    headers: { 'content-type': 'application/json' } }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
    res.on('end', () => {
      try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
      catch (error) { reject(error); }
    });
  });
  req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
});

test('真实 Pages → 网关 → D1/R2：四模式、Roll、画师补图与 Vibe 完整保存和结算', { timeout: 120_000 }, async t => {
  const root = createWorkspace('nai-runtime-'), dist = join(root, 'dist');
  let phase = '构建隔离 Worker', stopPages, stopGateway, pagesDiagnostic = () => '';
  t.after(async () => {
    if (phase !== '完成') t.diagnostic(`${phase}\n${pagesDiagnostic()}`);
    try { await stopGateway?.(); }
    finally {
      try { await stopPages?.(); }
      finally {
        // Windows 上 workerd 可能还持有临时库文件；只清当前用例拥有的目录。
        try { removeWorkspace(root); } catch (error) { console.warn(`测试临时目录留待下次清理：${error.message}`); }
      }
    }
  });
  const deadline = ms => AbortSignal.any([t.signal, AbortSignal.timeout(ms)]);
  const home = join(root, 'home');
  mkdirSync(home);
  mkdirSync(dist);
  // Wrangler 会从最近的 package.json 定位 Pages 构建目录；不能回落到仓库根目录。
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-nai-runtime', private: true }));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>synthetic runtime</title>');
  writeFileSync(join(root, 'wrangler.toml'), `name = "synthetic-nai-runtime"
compatibility_date = "2024-04-01"
pages_build_output_dir = "./dist"
[[d1_databases]]
binding = "DB"
database_name = "synthetic-only"
database_id = "00000000-0000-4000-8000-000000000001"
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "synthetic-assets"
`);
  await build({ entryPoints: [join(projectRoot, 'worker/index.ts')], absWorkingDir: projectRoot,
    bundle: true, format: 'esm', platform: 'browser', outfile: join(dist, '_worker.js'), logLevel: 'silent' });
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const updateProbe = join(root, 'wrangler-update-probe.cjs');
  const updateAttempt = join(root, 'unexpected-update-check');
  // 冷缓存若触发版本检查，留下回归标记并阻止连线；不让 Wrangler 的错误诊断被探针挂住。
  writeFileSync(updateProbe, `const { writeFileSync } = require('node:fs');
for (const protocol of ['node:http', 'node:https']) {
  const transport = require(protocol), original = transport.get;
  transport.get = function (options, ...args) {
    if (String(options?.headers?.accept || '').includes('application/vnd.npm.install-v1+json')) {
      writeFileSync(${JSON.stringify(updateAttempt)}, 'unexpected npm update check');
      throw new Error('Synthetic npm update check blocked before connection');
    }
    return original.call(this, options, ...args);
  };
}
`);
  // Wrangler/Undici 优先读取小写代理变量，且 npm 版本检查走原生 HTTP。
  // 分离子进程的宿主配置和开发注册表，不读取或写入开发者的 Wrangler 目录。
  const sandboxEnv = /^(?:(?:http|https|all|no)_proxy|npm_config_registry|node_options|node_use_env_proxy|home|userprofile|(?:local)?appdata|xdg_(?:config|cache|data)_home|wrangler_registry_path|(?:cf|cloudflare)_(?:api_token|api_key|email|account_id))$/i;
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !sandboxEnv.test(key)));
  const blockedProxy = 'http://127.0.0.1:1', loopback = '127.0.0.1,localhost,::1';
  Object.assign(childEnv, {
    http_proxy: blockedProxy, https_proxy: blockedProxy, all_proxy: blockedProxy, no_proxy: loopback,
    HTTP_PROXY: blockedProxy, HTTPS_PROXY: blockedProxy, ALL_PROXY: blockedProxy, NO_PROXY: loopback,
    HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, XDG_DATA_HOME: home,
    npm_config_registry: blockedProxy, WRANGLER_HIDE_BANNER: 'true', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_LOG_PATH: join(root, 'logs'),
    WRANGLER_REGISTRY_PATH: join(root, 'registry'), CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  });
  const child = spawn(process.execPath, ['--require', join(projectRoot, 'scripts/wrangler-local-transport.cjs'),
    '--require', updateProbe,
    join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'dev', dist, '--persist-to', join(root, 'state'),
    '--binding', 'LOCAL_HISTORY_ENABLED=true', '--binding', 'PERSONAL_MODE_ENABLED=true', '--ip', '127.0.0.1',
    '--port', String(port), '--compatibility-date', '2024-04-01', '--show-interactive-dev-session=false'], {
    cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv,
  });
  let diagnostic = '', launchError, closed = false, lastProbe;
  const collect = chunk => { diagnostic = (diagnostic + chunk).slice(-6000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', error => { launchError = error; });
  const pagesClosed = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  pagesDiagnostic = () => [`Pages pid=${child.pid ?? '-'} exit=${child.exitCode ?? '-'} signal=${child.signalCode ?? '-'}`,
    launchError?.message, lastProbe, existsSync(updateAttempt) ? '已阻止非预期 npm 版本检查' : '', diagnostic].filter(Boolean).join('\n');
  stopPages = async () => {
    if (closed) return;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { timeout: 3000, windowsHide: true, stdio: 'ignore' }); }
        catch { if (child.exitCode === null && child.signalCode === null) child.kill(); }
      } else child.kill('SIGTERM');
    }
    try { await withDeadline(pagesClosed, 3000, '关闭 Pages'); }
    catch (error) {
      if (process.platform === 'win32' || !child.pid) throw error;
      // 只强制关闭这里创建的独立进程组，不按端口或进程名查杀。
      try { process.kill(-child.pid, 'SIGKILL'); } catch (killError) { if (killError.code !== 'ESRCH') throw killError; }
      await withDeadline(pagesClosed, 2000, '强制关闭 Pages');
    }
  };
  phase = '等待 Pages/Worker 记账路由就绪';
  const readiness = deadline(25_000);
  let ready;
  while (!readiness.aborted && !launchError && child.exitCode === null && child.signalCode === null && !existsSync(updateAttempt)) {
    try { ready = await nativeJson(port, '/api/nai-accounting', 'POST', {}, AbortSignal.any([readiness, AbortSignal.timeout(1500)])); }
    catch (error) { lastProbe = `最后一次就绪请求：${error.code ?? error.name} ${error.message}`; }
    if (ready) break;
    await pause(100);
  }
  assert.equal(existsSync(updateAttempt), false, '本地链路测试不得等待或请求 npm 版本更新');
  assert.equal(ready?.status, 400, pagesDiagnostic());
  assert.equal(ready.headers['content-encoding'], undefined, '原生 HTTP 不能收到被二次压缩的 JSON');
  assert.equal(ready.body.error, 'Invalid accounting receipt');

  phase = '准备合成上游和图片';
  const original = getGlobalDispatcher(), local = new Agent(), mock = new MockAgent(); mock.disableNetConnect();
  // 只模拟收费上游；直通回环请求使用独立的原生连接池，不继承宿主代理。
  setGlobalDispatcher({ dispatch(options, handler) {
    if (String(options.origin) === 'https://image.novelai.net') return mock.dispatch(options, handler);
    assert.equal(new URL(options.origin).hostname, '127.0.0.1', '禁止访问其他真实外部服务');
    return local.dispatch(options, handler);
  } });
  const authorization = 'Bearer pst-test', keyHash = createHash('sha256').update(authorization.slice(7)).digest('hex');
  const closeGateway = async server => {
    const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await withDeadline(closing, 5000, '关闭测试网关');
  };
  let gateway, stopping = false;
  stopGateway = async () => {
    stopping = true;
    cacheNovelAiSubscription(authorization, null);
    try {
      await withDeadline(Promise.all([mock.close(), local.destroy()]), 3000, '关闭测试 HTTP 连接池');
    } finally {
      try { if (gateway) await closeGateway(gateway); }
      finally { setGlobalDispatcher(original); }
    }
  };
  const subscription = { active: true, tier: 3, usage: { percent: 30, isNegative: false } };
  cacheNovelAiSubscription(authorization, subscription);
  let generated = 0, encoded = 0;
  const upstream = mock.get('https://image.novelai.net');
  upstream.intercept({ path: '/user/subscription', method: 'GET' }).reply(200, JSON.stringify(subscription)).persist();
  const png = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#ef2233' } }).png().toBuffer();
  const basePng = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#2244ee' } }).png().toBuffer();
  const mask = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const uri = b => 'data:image/png;base64,' + b.toString('base64');
  const zip = new JSZip(); zip.file('image.png', png); const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  const upstreamBodies = [];
  const readUpstreamBody = async body => {
    if (typeof body === 'string') return JSON.parse(body);
    const chunks = []; for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  for (const stream of [false, true]) upstream.intercept({ path: '/ai/generate-image' + (stream ? '-stream' : ''), method: 'POST' }).reply(200, async options => {
    generated++; upstreamBodies.push(await readUpstreamBody(options.body));
    return stream ? `event: final\ndata: ${JSON.stringify({ image: png.toString('base64'), seed: 11 })}\n\n` : zipped;
  }, { headers: { 'content-type': stream ? 'text/event-stream' : 'application/zip' } }).persist();
  const encoding = Buffer.alloc(128, 47); let encodedImage;
  upstream.intercept({ path: '/ai/encode-vibe', method: 'POST' }).reply(200, async options => {
    encoded++; encodedImage = (await readUpstreamBody(options.body)).image; return encoding;
  }).persist();
  phase = '初始化媒体网关';
  const startGateway = createMediaGateway({ port: 0, workerPort: port }).then(async server => {
    if (stopping) await closeGateway(server);
    else gateway = server;
  });
  await withDeadline(startGateway, 35_000, phase);
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const request = async (path, method = 'GET', body, headers = {}) => {
    phase = `网关 ${method} ${path.split('?')[0]}`;
    const response = await fetch(base + path, { method, signal: deadline(10_000), headers: { authorization, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, path + ': ' + JSON.stringify(result)); return result;
  };
  const assetBytes = async path => {
    phase = '通过网关读取保存的图片或蒙版';
    const response = await fetch(base + path, { signal: deadline(10_000) }); assert.equal(response.status, 200, path);
    return Buffer.from(await response.arrayBuffer());
  };
  await request('/api/anlas-budget', 'PUT', { keyHash, remaining: 100 });
  await request('/api/generation-queue/preferences', 'PUT', { generationIntervalSeconds: 0 });
  const descriptor = (mode = 'generate', stream = false) => ({
    payload: { input: 'synthetic runtime', action: mode === 'generate' ? 'generate' : mode === 'img2img' ? 'img2img' : 'infill',
      model: 'nai-diffusion-5-full', parameters: { width: 128, height: 128, steps: 23, n_samples: 1, seed: 11, scale: 5, sampler: 'k_euler',
        ...(mode !== 'generate' ? { image: basePng.toString('base64'), strength: 0.6, noise: 0 } : {}),
        ...(['infill', 'focused', 'outpaint'].includes(mode) ? { mask: mask.toString('base64') } : {}),
        ...(mode === 'focused' ? { _local_focused_inpainting: true } : {}),
        ...(mode === 'outpaint' ? { _local_edit_operation: 'outpaint' } : {}),
      } }, history: { prompt: 'synthetic runtime', params: {}, ...(mode !== 'generate' ? { edit: { operation: mode, maskAvailable: true } } : {}) },
    approvedCost: 100, stream,
    ...(['infill', 'focused', 'outpaint'].includes(mode) ? { editMask: uri(mask), composition: { originalImage: uri(basePng), compositeMask: uri(mask),
      ...(mode === 'focused' ? { focusedGeometry: { crop: { x: 32, y: 32, width: 64, height: 64 } } } : {}) } } : {}),
  });
  const run = async (d, count = 1) => {
    const token = crypto.randomUUID();
    await request('/api/generation-job', 'POST', d, { 'x-nai-generation-task': token, 'x-nai-generation-count': String(count) });
    for (let i = 0; i < 400; i++) {
      const job = await request('/api/generation-job?token=' + token);
      if (['succeeded', 'failed', 'awaiting_confirmation'].includes(job.state)) {
        assert.equal(job.state, 'succeeded', JSON.stringify(job)); assert.equal(job.completedCount, count);
        assert.ok(!job.accountingFailed, JSON.stringify(job)); return job;
      }
      await pause(10);
    }
    assert.fail('真实后台任务未结束');
  };
  for (const stream of [false, true]) for (const mode of ['generate', 'img2img', 'infill', 'focused', 'outpaint']) {
    await t.test(`${mode} ${stream ? 'SSE' : 'ZIP'}：实际保存、图片和蒙版可读`, async () => {
      const scope = `synthetic:${mode}:${stream}`, d = descriptor(mode, stream); d.history.sourceChainId = scope;
      await run(d);
      const history = await request('/api/local-history?sourceChainId=' + encodeURIComponent(scope));
      assert.equal(history.items.length, 1, JSON.stringify(history));
      const item = history.items[0], bytes = await assetBytes(item.imageUrl);
      const image = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(image.info.width, 128); assert.equal(image.info.height, 128);
      if (mode === 'focused') {
        assert.deepEqual([...image.data.subarray(0, 3)], [34, 68, 238]);
        assert.deepEqual([...image.data.subarray((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 3)], [239, 34, 51]);
      }
      if (d.editMask) {
        assert.equal(item.edit.maskAvailable, true);
        assert.deepEqual(await assetBytes('/api/local-history/' + item.id + '/edit-mask'), mask);
      }
    });
  }
  let generationCost = 0;
  for (const stream of [false, true]) await t.test(`付费 ${stream ? 'SSE' : 'ZIP'}：跨 5 秒空闲边界后仍取得有效结算回执`, async () => {
    await pause(5100);
    const d = descriptor('generate', stream); d.payload.parameters.steps = 29;
    const cost = estimateNovelAiGenerationCost(d.payload, false, false); assert.ok(cost > 0);
    await run(d); generationCost += cost;
    phase = '通过 Pages 原生 HTTP 读取付费结算回执';
    const receipt = await nativeJson(port, '/api/anlas-budget?keyHash=' + keyHash, 'GET', undefined, deadline(10_000));
    assert.equal(receipt.headers['content-encoding'], undefined);
    assert.equal(receipt.body.remaining, 100 - generationCost);
    assert.equal(receipt.body.personal[keyHash].anlasSpent, generationCost);
  });
  await t.test('Roll 串：不同候选的历史元数据保留', async () => {
    const scope = 'style-roll:synthetic-experiment';
    const sequence = ['candidate-a', 'candidate-b'].map(id => {
      const d = descriptor(); d.history.sourceChainId = scope;
      d.history.modules = [{ id: 'style-roll:' + id, name: 'Roll 串', content: id, isActive: false }]; return d;
    });
    await run({ ...sequence[0], sequence }, sequence.length);
    const history = await request('/api/local-history?sourceChainId=' + scope);
    assert.deepEqual(history.items.map(item => item.modules[0].content).sort(), ['candidate-a', 'candidate-b']);
  });
  await t.test('画师补图：V4.5 与 V5 自动归档并共用实际图片', async () => {
    for (const pack of ['v45', 'v5']) {
      const tag = 'synthetic artist', d = descriptor();
      const targetId = crypto.randomUUID();
      d.payload.model = pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full';
      d.payload.input = d.history.prompt = '1girl, artist:' + tag;
      d.history.sourceChainId = `artist-sample:${pack}:${encodeURIComponent(tag)}`;
      d.history.params = { ...d.payload.parameters, model: d.payload.model };
      d.history.modules = [{ id: 'artist-sample-target:' + targetId, name: '画师样张', isActive: false,
        content: JSON.stringify({ id: targetId, tag, pack }) }];
      await run(d);
    }
    const data = await request('/api/artist-sample-data');
    assert.equal(data.samples.length, 2, JSON.stringify(data));
    for (const sample of data.samples) assert.deepEqual(await assetBytes(sample.imageUrl), png);
  });
  await t.test('Vibe：原图读取 → 编码 → 结算 → R2 保存 → 复用 → 实际生图引用', async () => {
    const asset = await request('/api/vibes', 'POST', { name: 'synthetic', imageData: uri(basePng) });
    const path = '/api/vibes/' + asset.item.id;
    const saved = await request(path + '/encodings', 'POST', { informationExtracted: 1 });
    assert.equal(encodedImage, basePng.toString('base64'));
    assert.equal(saved.item.encodings.length, 1); assert.ok(!saved.anlasAccountingFailed);
    const duplicate = await request(path + '/encodings', 'POST', { informationExtracted: 1 });
    assert.equal(duplicate.duplicate, true); assert.equal(encoded, 1);
    const variant = saved.item.encodings[0];
    const stored = await request(path + '/encodings/' + variant.id + '/data');
    assert.deepEqual(Buffer.from(stored.encoding, 'base64'), encoding);
    for (const stream of [false, true]) {
      const d = descriptor('generate', stream); d.payload.model = 'nai-diffusion-4-5-full';
      d.history.sourceChainId = 'synthetic:vibe:' + stream;
      d.payload.parameters._local_vibes = { enabled: true,
        slots: [{ vibeId: asset.item.id, encodingId: variant.id, informationExtracted: 1, strength: 0.6 }] };
      await run(d);
      const parameters = upstreamBodies.at(-1).parameters;
      assert.equal(parameters.reference_image_multiple_cached.length, 1);
      assert.equal(parameters.reference_strength_multiple[0], 0.6);
      assert.equal(parameters._local_vibes, undefined);
      assert.equal(parameters.stream, stream ? 'sse' : undefined);
      if (!stream) assert.equal(parameters.reference_image_multiple_cached[0].data, encoding.toString('base64'));
      const history = await request('/api/local-history?sourceChainId=' + d.history.sourceChainId);
      assert.equal(history.items.length, 1); assert.deepEqual(await assetBytes(history.items[0].imageUrl), png);
    }
    assert.equal(encoded, 1, '生图使用既有编码，不能再次付费编码');
  });
  assert.equal(generated, 18);
  phase = '核对 Pages 最终结算';
  const budget = (await nativeJson(port, '/api/anlas-budget?keyHash=' + keyHash, 'GET', undefined, deadline(10_000))).body;
  assert.equal(budget.remaining, 100 - generationCost - DEFAULT_NAI_RUNTIME.billing.vibeEncodingCost);
  assert.equal(budget.personal[keyHash].anlasSpent, generationCost + DEFAULT_NAI_RUNTIME.billing.vibeEncodingCost);
  assert.equal(existsSync(updateAttempt), false, '本地链路运行期间不得请求 npm 版本更新');
  phase = '完成';
});
