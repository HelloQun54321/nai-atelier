import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import ts from 'typescript';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { androidDictionaryGenerator } from '../../scripts/android-dictionary.mjs';
import { projectRoot } from '../support/workspace.mjs';
import { DEFAULT_NAI_RUNTIME, computeNaiRuntimeSync, extractNaiRuntimeChunkPaths } from '../../scripts/media-gateway.mjs';
import { NAI_MEDIUM_BILLING_BUNDLE, NAI_TURBOPACK_BILLING_BUNDLE, NAI_PRICING_SUBSCRIPTION_BUNDLE } from '../fixtures/nai-runtime.mjs';

test('手机 Vibe 删除核查和写入互斥至完成，保留读取且失败释放锁', async () => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/entry.ts'), ['phoneFetch'], `
    const location = { origin: 'https://localhost' }, calls = [];
    const control = { checking: null, deleting: null, writing: null, busy: false };
    const webFetch = async () => new Response('web');
    const nativeFetch = webFetch;
    const error = (message, status) => Response.json({ error: message }, { status });
    const assertMobileVibeNotBusy = () => { if (control.busy) throw Object.assign(new Error('busy'), { status: 409 }); };
    const assertMobileAgentVibeNotReferenced = () => control.checking || Promise.resolve();
    const mobileGateway = async () => null, mobileDictionary = async () => null, mobileAgent = async () => null;
    const worker = { fetch: async request => {
      calls.push([request.method, new URL(request.url).pathname]);
      if (request.method === 'DELETE' && control.deleting) await control.deleting;
      if (request.method === 'POST' && control.writing) await control.writing;
      return Response.json({ success: true });
    } };
  `, { env: 'const env = {};' });
  const transformed = await transform(source + '\nexport { control, calls };', { loader: 'ts', format: 'esm' });
  const phone = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  const request = (method, path = '/api/chains') => phone.phoneFetch(path, { method });
  let checked, deleted, written;
  phone.control.checking = new Promise(resolve => { checked = resolve; });
  phone.control.deleting = new Promise(resolve => { deleted = resolve; });
  const deleting = request('DELETE', '/api/vibes/synthetic/encodings/encoding');
  assert.equal((await request('POST')).status, 409);
  assert.equal((await request('GET')).status, 200);
  checked(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(phone.calls.some(([method]) => method === 'DELETE'));
  assert.equal((await request('POST')).status, 409);
  deleted(); assert.equal((await deleting).status, 200);
  phone.control.checking = null; phone.control.deleting = null;
  assert.equal((await request('POST')).status, 200);
  phone.control.busy = true;
  assert.equal((await request('DELETE', '/api/vibes/synthetic')).status, 409);
  phone.control.busy = false;
  assert.equal((await request('POST')).status, 200);
  phone.control.writing = new Promise(resolve => { written = resolve; });
  const writing = request('POST');
  assert.equal((await request('DELETE', '/api/vibes/synthetic')).status, 409);
  written(); assert.equal((await writing).status, 200);
  phone.control.writing = null;
  phone.control.checking = Promise.reject(Object.assign(new Error('referenced'), { status: 409 }));
  assert.equal((await request('DELETE', '/api/vibes/synthetic')).status, 409);
  phone.control.checking = null;
  assert.equal((await request('POST')).status, 200);
});

test('手机 Vibe 删除保护生成、暂停和排队任务，并复用编码恢复保护', async () => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/gateway.ts'), ['assertMobileVibeNotBusy'], `
    const checked = [];
    const assertVibeEncodingIdle = id => { checked.push(id); if (id === 'recovering') throw Object.assign(new Error('recovering'), { status: 409 }); };
  `, { tasks: 'const tasks = { size: 0 };', generationJobs: 'const generationJobs = { jobs: { jobs: new Map() } };' });
  const transformed = await transform(source + '\nexport { tasks, generationJobs, checked };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  mobile.assertMobileVibeNotBusy('free');
  assert.deepEqual(mobile.checked, ['free']);
  mobile.tasks.size = 1;
  assert.throws(() => mobile.assertMobileVibeNotBusy('free'), { status: 409 });
  mobile.tasks.size = 0;
  for (const state of ['running', 'paused', 'queued', 'awaiting_approval']) {
    mobile.generationJobs.jobs.jobs.set('job', { state });
    assert.throws(() => mobile.assertMobileVibeNotBusy('free'), { status: 409 });
  }
  for (const state of ['succeeded', 'failed', 'cancelled']) {
    mobile.generationJobs.jobs.jobs.set('job', { state });
    mobile.assertMobileVibeNotBusy('free');
  }
  assert.throws(() => mobile.assertMobileVibeNotBusy('recovering'), { status: 409 });
});

test('手机助手单编码删除核对现有兄弟编码，运行或读取失败时拒绝', async t => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/agent.ts'), ['assertMobileAgentVibeNotReferenced'], '', {
    agent: 'const agent = { activeAgents: new Map(), startingAgents: new Set(), checks: [], async assertVibeNotReferenced(...args) { this.checks.push(args); } };',
  });
  const transformed = await transform(source + '\nexport { agent };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return Response.json({ item: { id: 'synthetic', encodings: [{ id: 'first' }, { id: 'second' }] } }); });
  await mobile.assertMobileAgentVibeNotReferenced('synthetic', 'first');
  assert.deepEqual(requests, ['/api/vibes/synthetic']);
  assert.deepEqual(mobile.agent.checks, [['synthetic', 'first', ['first', 'second']]]);
  await mobile.assertMobileAgentVibeNotReferenced('synthetic');
  assert.equal(requests.length, 1);
  mobile.agent.activeAgents.set('run', {});
  await assert.rejects(mobile.assertMobileAgentVibeNotReferenced('synthetic'), { status: 409 });
  mobile.agent.activeAgents.clear();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'synthetic read error' }, { status: 503 }));
  await assert.rejects(mobile.assertMobileAgentVibeNotReferenced('synthetic', 'first'), { status: 409 });
  assert.equal(mobile.agent.checks.length, 2);
});

test('Android Agent 自报 Android 运行平台并保留 /documents 文件边界', async () => {
  const source = await (await import('node:fs/promises')).readFile(join(projectRoot, 'mobile/agent.ts'), 'utf8');
  assert.match(source, /new PromptAgentService\(\{[^}]*runtimePlatform:\s*'android'/s);
  assert.match(source, /path !== '\/documents' && !path\.startsWith\('\/documents\/'\)/);
});

test('Android直接队列与图片反推适配复用本地服务实例，不暴露Key或任务令牌', async () => {
  const { transform } = await import('esbuild');
  const inferred = { tags: [{ name: 'synthetic_tag' }] };
  const source = extractAndroidShared(join(projectRoot, 'mobile/gateway.ts'), ['agentGenerationQueue', 'agentInspectImageTags'], `
    const calls = [], inferred = ${JSON.stringify(inferred)};
    const runAgentGenerationQueue = (...args) => { calls.push(['queue', ...args]); return { busy: false, paused: false, waiting: [] }; };
    const native = { tagger: async options => { calls.push(['tagger', options]); return options.action === 'status' ? { model: 'synthetic-model', models: [{ id: 'synthetic-model', downloaded: true }] } : inferred; } };
    const bytesToBase64 = bytes => Buffer.from(bytes).toString('base64');
  `, {
    tasks: "const tasks = { instance: 'same-tasks' };",
    generationJobs: "const generationJobs = { jobs: { instance: 'same-jobs' } };",
  });
  const transformed = await transform(source + '\nexport { calls };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  assert.deepEqual(mobile.agentGenerationQueue('synthetic-key-hash', 'read'), { busy: false, paused: false, waiting: [] });
  assert.deepEqual(await mobile.agentInspectImageTags(new Uint8Array([1, 2, 3]), { threshold: 0.4, characterThreshold: 0.7 }), inferred);
  assert.deepEqual(mobile.calls, [
    ['queue', 'read', 'synthetic-key-hash', { instance: 'same-tasks' }, { instance: 'same-jobs' }],
    ['tagger', { action: 'status' }],
    ['tagger', { action: 'infer', model: 'synthetic-model', data: 'AQID', threshold: 0.4, characterThreshold: 0.7 }],
  ]);
});

test('Android 生成路由给电脑 Collector 工具提供明确不可用实现', async () => {
  const { readFile } = await import('node:fs/promises');
  const { transform } = await import('esbuild');
  const [build, gateway] = await Promise.all([
    readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8'),
    readFile(join(projectRoot, 'scripts/media-gateway.mjs'), 'utf8'),
  ]);
  const tree = ts.createSourceFile('gateway.mjs', gateway, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let agentBranch = '';
  const findAgent = node => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "url.pathname.startsWith('/api/prompt-agent/')") agentBranch = node.getText(tree);
    ts.forEachChild(node, findAgent);
  };
  findAgent(tree);
  assert.ok(agentBranch, '应提取电脑端实际 Agent 路由');
  const template = build.match(/const agentRoutes=`([\s\S]*?)`;\r?\nconst remote/)[1];
  const source = `
    const sendJson=()=>{},hasValidLanCookie=()=>true,getNaiRuntime=()=>({}),normalizeCloudQueuePreferences=()=>({});
    const readRequestBody=async()=>Buffer.from('{"message":"synthetic"}'),requestWorkerJson=()=>{},requestWorkerBuffer=()=>{};
    const readSetting=async()=>{},writeSetting=async()=>{},queuePreferences=async()=>({});
    const serviceCalls=[];
    const agentGenerationQueue=(keyHash,action)=>{serviceCalls.push(['queue',keyHash,action]);return {busy:false,paused:false,waiting:[]};};
    const agentInspectImageTags=async(buffer,options)=>{serviceCalls.push(['tags',[...buffer],options]);return {tags:[{name:'synthetic_tag',confidence:0.9}]};};
  ` + template.replace(/^import .*;\r?\n/gm, '').replace('${agentBranch}', agentBranch);
  const transformed = await transform(source + '\nexport { serviceCalls };', { loader: 'js', format: 'esm' });
  const route = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  let collector, generation, inspected;
  const response = { destroyed: false, writableEnded: false, writeHead() {}, write() {}, end() { this.writableEnded = true; } };
  await route.handleAgent({ method: 'POST' }, response, { pathname: '/api/prompt-agent/run' }, {
    async run(_body, _emit, _signal, project) {
      let state, stateError, error;
      try { state = project.getStyleCollectorState(); } catch (cause) { stateError = cause.message; }
      try { project.controlStyleCollector('start'); } catch (cause) { error = cause.message; }
      collector = { state, stateError, error };
      generation = await project.generationQueue('read');
      inspected = await project.inspectImageTags(new Uint8Array([1, 2]), { threshold: 0.5, model: 'synthetic-model' });
    },
  }, async () => ({ keyHash: 'synthetic', preferences: {} }));
  assert.deepEqual(collector.state, { available: false, reason: '独立 Android 不支持电脑收集浮窗' }, collector.stateError);
  assert.equal(collector.error, 'Android 不支持电脑本机收集浮窗');
  assert.deepEqual(generation, { busy: false, paused: false, waiting: [] });
  assert.deepEqual(inspected, { tags: [{ name: 'synthetic_tag', confidence: 0.9 }] });
  assert.deepEqual(route.serviceCalls, [
    ['queue', 'synthetic', 'read'],
    ['tags', [1, 2], { threshold: 0.5, model: 'synthetic-model' }],
  ]);
});

test('Android 提取后的真实会话路由支持提示词版本读写 API', async () => {
  const { readFile } = await import('node:fs/promises');
  const { transform } = await import('esbuild');
  const [build, gateway] = await Promise.all([
    readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8'),
    readFile(join(projectRoot, 'scripts/media-gateway.mjs'), 'utf8'),
  ]);
  const tree = ts.createSourceFile('gateway.mjs', gateway, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let agentBranch = '';
  const findAgent = node => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "url.pathname.startsWith('/api/prompt-agent/')") agentBranch = node.getText(tree);
    ts.forEachChild(node, findAgent);
  };
  findAgent(tree);
  assert.match(agentBranch, /prompt-versions/, 'Android 应从电脑 Agent 路由提取提示词版本端点');
  const template = build.match(/const agentRoutes=`([\s\S]*?)`;\r?\nconst remote/)[1];
  const source = `
    const sendJson=(_res,status,payload)=>({status,payload}),hasValidLanCookie=()=>true,getNaiRuntime=()=>({}),normalizeCloudQueuePreferences=()=>({});
    const readRequestBody=async req=>req.body,requestWorkerJson=()=>{},requestWorkerBuffer=()=>{};
    const readSetting=async()=>{},writeSetting=async()=>{},queuePreferences=async()=>{};
    const agentGenerationQueue=()=>{},agentInspectImageTags=()=>{};
  ` + template.replace(/^import .*;\r?\n/gm, '').replace('${agentBranch}', agentBranch);
  const transformed = await transform(source, { loader: 'js', format: 'esm' });
  const route = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  const calls = [];
  const promptAgent = {
    async listPromptVersions(sessionId, query) { calls.push(['list', sessionId, query]); return { items: [{ id: 'v1' }], nextOffset: null }; },
    async readPromptVersion(sessionId, versionId, query) { calls.push(['read', sessionId, versionId, query]); return { id: versionId, text: 'synthetic' }; },
    async savePromptVersion(sessionId, input) { calls.push(['save', sessionId, input]); return { id: 'v2' }; },
    async finishPromptVersion(sessionId, versionId, afterDraft) { calls.push(['finish', sessionId, versionId, afterDraft]); return { ok: true }; },
  };
  const run = (method, path, body = {}) => route.handleAgent(
    { method, body: Buffer.from(JSON.stringify(body)), headers: {}, socket: { remoteAddress: '127.0.0.1' } }, {},
    new URL(`http://atelier.local${path}`), promptAgent, async () => ({ keyHash: 'synthetic-key-hash', preferences: {} }),
  );
  assert.deepEqual(await run('GET', '/api/prompt-agent/sessions/synthetic-session/prompt-versions?scope=draft&offset=2'), {
    status: 200, payload: { items: [{ id: 'v1' }], nextOffset: null },
  });
  assert.deepEqual(await run('POST', '/api/prompt-agent/sessions/synthetic-session/prompt-versions', { draft: { target: { chainId: 'synthetic-chain' } }, reason: 'before_apply' }), {
    status: 200, payload: { id: 'v2' },
  });
  assert.deepEqual(await run('GET', '/api/prompt-agent/sessions/synthetic-session/prompt-versions/synthetic-version?offset=3'), {
    status: 200, payload: { id: 'synthetic-version', text: 'synthetic' },
  });
  assert.deepEqual(await run('PATCH', '/api/prompt-agent/sessions/synthetic-session/prompt-versions/synthetic-version', { afterDraft: { basePrompt: 'after' } }), {
    status: 200, payload: { ok: true },
  });
  assert.deepEqual(calls, [
    ['list', 'synthetic-session', { scope: 'draft', offset: '2' }],
    ['save', 'synthetic-session', { draft: { target: { chainId: 'synthetic-chain' } }, reason: 'before_apply', source: 'page', scope: 'draft' }],
    ['read', 'synthetic-session', 'synthetic-version', { offset: '3' }],
    ['finish', 'synthetic-session', 'synthetic-version', { basePrompt: 'after' }],
  ]);
});

test('Android 打包源码覆盖助手启动签名全部文件，文件系统 shim 可以实际读取', async () => {
  const { readFile } = await import('node:fs/promises');
  const build = await readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8');
  const agent = await readFile(join(projectRoot, 'scripts/prompt-agent.mjs'), 'utf8');
  const packaged = JSON.parse(build.match(/for \(const name of (\[[^\n]+\])\) sources\[name\]/)[1].replace(/'/g, '"'));
  const required = JSON.parse(agent.match(/const runtimeSourceFiles = (\[[^\n]+\]);/)[1].replace(/'/g, '"'));
  assert.ok(required.includes('agent-compaction.mjs'), '助手启动签名必须包含 Pi 摘要模块');
  assert.ok(packaged.includes('scripts/agent-compaction.mjs'), 'Android 必须打包 Pi 摘要模块');
  assert.ok(required.includes('agent-prompt-library.mjs'), '助手启动签名必须包含提示词资料分页与续读模块');
  assert.ok(packaged.includes('scripts/agent-prompt-library.mjs'), 'Android 必须打包提示词资料分页与续读模块');
  assert.ok(required.includes('agent-directories.mjs'), '助手启动签名必须包含直接目录工具');
  assert.ok(required.includes('agent-creative-read.mjs'), '助手启动签名必须包含创作资料读取工具');
  assert.ok(required.includes('../services/directoryTree.mjs'), '助手启动签名必须包含目录树依赖');
  assert.ok(packaged.includes('scripts/agent-directories.mjs'), 'Android 必须打包直接目录工具');
  assert.ok(packaged.includes('scripts/agent-creative-read.mjs'), 'Android 必须打包创作资料读取工具');
  assert.ok(packaged.includes('services/directoryTree.mjs'), 'Android 必须打包目录树依赖');
  for (const file of required) {
    assert.ok(packaged.includes(new URL(file, 'file:///scripts/prompt-agent.mjs').pathname.slice(1)), `启动签名文件未打包：${file}`);
  }
  const sources = Object.fromEntries(await Promise.all(packaged.map(async name => [name, await readFile(join(projectRoot, name), 'utf8')])));
  const source = extractAndroidShared(join(projectRoot, 'mobile/shims/fs.mjs'), ['readFileSync'], `const sources = ${JSON.stringify(sources)};`);
  const shim = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  for (const file of required) {
    const url = new URL(file, 'file:///scripts/prompt-agent.mjs');
    const expected = await readFile(join(projectRoot, url.pathname.slice(1)), 'utf8');
    assert.equal(shim.readFileSync(url), expected, `启动签名文件未打包：${file}`);
  }
  assert.ok(required.includes('../services/promptExtraction.mjs'));
});

test('手机Worker读取统计词库走已下载的本地路由，其他资源保持原读取方式', async () => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/entry.ts'), ['env'], `
    const db = {}, bucket = {}, location = { origin: 'https://localhost' };
    const calls = [];
    const webFetch = async request => { calls.push(['web', request.url]); return new Response('{}'); };
  `, { phoneFetch: "const phoneFetch = async request => { calls.push(['phone', request.url]); return new Response('{}'); };" });
  const transformed = await transform(source + '\nexport { calls };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  await mobile.env.ASSETS.fetch(new Request('https://atelier.local/tag-data/manifest.json'));
  await mobile.env.ASSETS.fetch(new Request('https://atelier.local/assets/app.js'));
  assert.deepEqual(mobile.calls, [['phone', 'https://localhost/tag-data/manifest.json'], ['web', 'https://atelier.local/assets/app.js']]);
});

test('Android 默认规则和官方提取复用电脑声明，不能带入 Node 文件系统',async()=>{
  const billing=join(projectRoot,'worker/naiBilling.mjs').replace(/\\/g,'/');
  const source=extractAndroidShared(join(projectRoot,'scripts/media-gateway.mjs'),['DEFAULT_NAI_RUNTIME','computeNaiRuntimeSync','extractNaiRuntimeChunkPaths'],`import {DEFAULT_NAI_BILLING,isNaiBillingRules} from 'file:///${billing}';`);
  const mobile=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.deepEqual(mobile.DEFAULT_NAI_RUNTIME,DEFAULT_NAI_RUNTIME);assert.deepEqual(mobile.computeNaiRuntimeSync('synthetic missing official rules'),computeNaiRuntimeSync('synthetic missing official rules'));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE), computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_TURBOPACK_BILLING_BUNDLE), computeNaiRuntimeSync(NAI_TURBOPACK_BILLING_BUNDLE));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_PRICING_SUBSCRIPTION_BUNDLE), computeNaiRuntimeSync(NAI_PRICING_SUBSCRIPTION_BUNDLE));
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
  assert.match(build, /import \{ readGenerationResponse \} from 'mobile:generation-output'/);
  assert.match(source, /readGenerationResponse\(new Response\(responseBody\)\)/);
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
    const randomUUID = () => crypto.randomUUID();
    const writes = [];
    const requestWorkerJson = async (path, req, port, options) => { writes.push({ path, ...options }); return { receiptId: options.body.receiptId, budget: null }; };
  `, { requestWorkerJson: '' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { writes };').toString('base64'));
  assert.doesNotMatch(source, /httpRequest|node:fs/);
  const options = { payload: { model: 'nai-diffusion-4-5-full', parameters: { width: 832, height: 1216, steps: 23, n_samples: 1 } }, keyHash: 'a'.repeat(64), req: {}, workerPort: 0,
    billing: { runtime: mobile.DEFAULT_NAI_RUNTIME, subscription: { active: true, tier: 3 }, opusSubscriber: true, exhausted: false } };
  const result = await mobile.settleSuccessfulNovelAiGeneration(options);
  assert.equal(result.estimatedCost, 0); assert.equal(result.accountingFailed, false);
  assert.equal(mobile.writes.length, 1); assert.equal(mobile.writes[0].path, '/api/nai-accounting');
  const { receiptId, ...body } = mobile.writes[0].body;
  assert.match(receiptId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(body, { action: 'generation', keyHash: 'a'.repeat(64), images: 1, cost: 0,
    model: options.payload.model, opusImages: 0 });
  await mobile.settleSuccessfulNovelAiGeneration({ ...options, billing: { runtime: mobile.DEFAULT_NAI_RUNTIME } });
  assert.equal(mobile.writes.length, 2);
  assert.equal(mobile.writes[1].body.cost, undefined);
  assert.equal(mobile.writes[1].body.opusImages, undefined);
  assert.notEqual(mobile.writes[1].body.receiptId, receiptId);
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
