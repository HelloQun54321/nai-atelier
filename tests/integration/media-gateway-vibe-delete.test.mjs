import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { assertVibeEncodingIdle, createMediaGateway, handleGenerateRequest, handleVibeEncodeRequest, CloudQueueCoordinator, DEFAULT_NAI_RUNTIME } from '../../scripts/media-gateway.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import { GenerationJobs } from '../../worker/generationJobs.mjs';
import { GenerationTasks } from '../../worker/generationTasks.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const authorization = 'Bearer synthetic-vibe-deletion';
async function fixture(t, handle = () => false) {
  const forwarded = [];
  const worker = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    forwarded.push({ method: req.method, path: req.url, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (handle(req, res, Buffer.concat(chunks))) return;
    res.end('{}');
  });
  worker.listen(0, '127.0.0.1'); await once(worker, 'listening');
  let gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
  // fetch 禁用部分端口，Windows 的动态分配范围可能包含这些端口。
  while ([2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080].includes(gateway.address().port)) {
    await new Promise(done => gateway.close(done));
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
  }
  t.after(async () => {
    gateway.closeAllConnections(); worker.closeAllConnections();
    await Promise.all([new Promise(done => gateway.close(done)), new Promise(done => worker.close(done))]);
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const request = (path, method = 'GET', headers = {}, body) => fetch(base + path, {
    method, headers: { authorization, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { worker, gateway, forwarded, base, request };
}

test('无法读取付费编码恢复目录时保持未知保护，不把读取失败当没有恢复', async t => {
  const original = fsPromises.readdir;
  fsPromises.readdir = async (path, ...args) => {
    if (path === join(process.cwd(), 'local-data', 'vibe-recovery')) throw Object.assign(new Error('合成目录不可读'), { code: 'EACCES' });
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const f = await fixture(t);
    assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  } finally { fsPromises.readdir = original; syncBuiltinESMExports(); }
});

test('Vibe 永久删除核查与 Worker 响应期间互斥写入，GET继续且原请求身份照常转发', async t => {
  const checking = deferred(), checked = deferred(), deleting = deferred();
  t.mock.method(PromptAgentService.prototype, 'assertVibeNotReferenced', async (vibeId, encodingId, existingEncodingIds) => {
    assert.equal(vibeId, 'synthetic asset'); assert.equal(encodingId, 'synthetic encoding');
    assert.deepEqual(existingEncodingIds, ['synthetic encoding']);
    checking.resolve(); await checked.promise;
  });
  const f = await fixture(t, (req, res) => {
    if (req.method === 'DELETE') { res.write('{"deleted":'); deleting.resolve(res); return true; }
    if (req.url === '/api/vibes/synthetic%20asset') { res.end('{"item":{"id":"synthetic asset","encodings":[{"id":"synthetic encoding"}]}}'); return true; }
    return false;
  });
  const lanRequest = Readable.from([]), lanResponse = new Output();
  lanRequest.method = 'DELETE'; lanRequest.url = '/api/vibes/synthetic'; lanRequest.headers = { host: '192.0.2.1' };
  lanRequest.socket = { remoteAddress: '192.0.2.2' };
  f.gateway.emit('request', lanRequest, lanResponse); await once(lanResponse, 'finish');
  assert.equal(lanResponse.statusCode, 401);
  const deletion = f.request('/api/vibes/synthetic%20asset/encodings/synthetic%20encoding', 'DELETE', { cookie: 'synthetic=retained' });
  await checking.promise;
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 409);
  assert.equal((await f.request('/api/vibes/another', 'DELETE')).status, 409);
  assert.equal((await f.request('/api/vibes/synthetic')).status, 200);
  checked.resolve();
  const response = await deleting.promise;
  assert.equal((await f.request('/api/chains/synthetic', 'POST', {}, {})).status, 409);
  response.end('true}');
  assert.deepEqual(await (await deletion).json(), { deleted: true });
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 200);
  const proxied = f.forwarded.filter(item => item.method === 'DELETE');
  assert.equal(proxied.length, 1); assert.equal(proxied[0].headers.cookie, 'synthetic=retained');
  assert.equal(proxied[0].headers.authorization, authorization);
  assert.equal(proxied[0].path, '/api/vibes/synthetic%20asset/encodings/synthetic%20encoding');
});

test('Vibe 删除忽略未结束GET，但拒绝先前写入、租约、排队与暂停任务及运行/启动Agent', async t => {
  const check = t.mock.method(PromptAgentService.prototype, 'assertVibeNotReferenced', async () => {});
  const start = t.mock.method(GenerationJobs.prototype, 'start', () => ({}));
  const held = deferred();
  const f = await fixture(t, (req, res) => { if (req.url === '/api/synthetic-held') { held.resolve(res); return true; } return false; });
  const read = f.request('/api/synthetic-held'); const readRes = await held.promise;
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 200);
  readRes.end('{}'); await (await read).text();
  const heldWrite = f.request('/api/synthetic-held', 'PUT', {}, {});
  // 同一回调在第二次请求保存新的响应对象。
  while (!f.forwarded.some(item => item.method === 'PUT')) await new Promise(done => setTimeout(done, 5));
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  f.worker.closeAllConnections(); await heldWrite.catch(() => {});
  const token = 'synthetic-vibe-task';
  for (const [method, headers] of [['POST', { 'x-nai-generation-count': '2' }], ['PATCH', { 'x-nai-generation-action': 'pause' }], ['POST', { 'x-nai-generation-placement': 'end' }]]) {
    assert.equal((await f.request('/api/generation-task', method, { 'x-nai-generation-task': token + (headers['x-nai-generation-placement'] ? '-queued' : ''), ...headers })).status, 200);
    assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  }
  await f.request('/api/generation-task', 'DELETE', { 'x-nai-generation-cancel-all': '1' });
  await f.request('/api/generation-job', 'POST', { 'x-nai-generation-task': 'synthetic-vibe-job' }, {});
  const agent = check.mock.calls[0].this, jobs = start.mock.calls[0].this;
  for (const state of ['waiting', 'paused', 'preparing', 'generating', 'saving', 'awaiting_confirmation']) {
    jobs.jobs.set('synthetic', { state });
    assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409, state);
  }
  for (const state of ['succeeded', 'cancelled', 'failed']) {
    jobs.jobs.set('synthetic', { state });
    assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 200, state);
  }
  jobs.jobs.clear();
  for (const running of [agent.activeAgents, agent.startingAgents]) {
    if (running instanceof Map) running.set('synthetic', {}); else running.add('synthetic');
    assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
    running.delete('synthetic');
  }
});

test('Vibe 删除核查失败和上游断线均释放锁，异步核查后的新增任务会再次拦下', async t => {
  let conflict = false, startAgent = false;
  const check = t.mock.method(PromptAgentService.prototype, 'assertVibeNotReferenced', async function () {
    if (conflict) throw Object.assign(new Error('合成草稿仍在引用'), { status: 409 });
    if (startAgent) this.startingAgents.add('synthetic');
  });
  let disconnect = false;
  const f = await fixture(t, (req) => { if (disconnect && req.method === 'DELETE') { req.socket.destroy(); return true; } return false; });
  conflict = true;
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  assert.equal(f.forwarded.filter(item => item.method === 'DELETE').length, 0);
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 200);
  conflict = false;
  assert.equal((await f.request('/api/vibes/synthetic/encodings/unknown', 'DELETE')).status, 409);
  assert.equal(f.forwarded.filter(item => item.method === 'DELETE').length, 0);
  startAgent = true;
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  check.mock.calls.at(-1).this.startingAgents.clear(); startAgent = false; disconnect = true;
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 502);
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 200);
});

test('Vibe 删除客户端提前断开仍等 Worker 完成才释放写锁', async t => {
  const reached = deferred(), controller = new AbortController();
  const f = await fixture(t, (req, res) => {
    if (req.method !== 'DELETE') return false;
    res.write('{'); reached.resolve(res); return true;
  });
  const pending = fetch(f.base + '/api/vibes/synthetic', { method: 'DELETE', signal: controller.signal });
  const workerResponse = await reached.promise, response = await pending;
  controller.abort(); await assert.rejects(response.text());
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 409);
  workerResponse.end('}');
  await f.request('/api/vibes/synthetic');
  assert.equal((await f.request('/api/chains/synthetic', 'PUT', {}, {})).status, 200);
});

class Output extends Writable {
  constructor() { super(); this.headers = {}; this.statusCode = 0; this.chunks = []; }
  setHeader(name, value) { this.headers[name] = value; }
  writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); }
  _write(chunk, _encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
}
const payloadRequest = body => {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST'; req.headers = { authorization }; req.socket = { remoteAddress: '127.0.0.1' }; req.setTimeout = () => {}; return req;
};
const encodeRequest = () => payloadRequest({ informationExtracted: 1 });
test('Vibe 新编码和已付费恢复保护资产，恢复只补保存、不再次请求编码', async t => {
  const encoding = Buffer.alloc(128, 2), encodingHash = createHash('sha256').update(encoding).digest('hex');
  const started = deferred(), encoded = deferred(); let save = false, calls = 0;
  const f = await fixture(t, (req, res, bytes) => {
    if (req.url === '/api/vibes/synthetic/image') { res.end(Buffer.alloc(128, 1)); return true; }
    if (req.url === '/api/nai-accounting') { res.end(JSON.stringify({ receiptId: JSON.parse(bytes).receiptId, budget: null })); return true; }
    if (req.url === '/api/vibes/synthetic/encoding-result') {
      res.end(JSON.stringify(save ? { item: { id: 'synthetic', encodings: [{ id: 'encoded', model: 'nai-diffusion-4-5-full', informationExtracted: 1, encodingHash }] } } : {})); return true;
    }
    if (req.url === '/api/vibes/synthetic' && req.method === 'GET') { res.end('{"item":{"id":"synthetic","encodings":[]}}'); return true; }
    return false;
  });
  const remote = async () => { calls++; started.resolve(); await encoded.promise; return new Response(encoding); };
  const first = new Output();
  const pending = handleVibeEncodeRequest(encodeRequest(), first, '', f.worker.address().port, 'synthetic', remote);
  await Promise.race([started.promise, pending.then(() => assert.fail(Buffer.concat(first.chunks).toString()))]);
  assert.throws(() => assertVibeEncodingIdle('synthetic'), { status: 409 });
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  encoded.resolve(); await pending; assert.equal(first.statusCode, 503);
  assert.equal((await f.request('/api/vibes/synthetic/encodings/any', 'DELETE')).status, 409);
  assert.equal((await f.request('/api/vibes/unrelated', 'DELETE')).status, 200);
  save = true;
  const retry = new Output(); await handleVibeEncodeRequest(encodeRequest(), retry, '', f.worker.address().port, 'synthetic', remote);
  assert.equal(retry.statusCode, 200); assert.equal(calls, 1);
  assert.doesNotThrow(() => assertVibeEncodingIdle('synthetic'));
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 200);
});

test('Vibe 永久删除清理编码缓存，另一端旧草稿必须重新读持久层并在缺失时停止生图', async t => {
  let removed = false, reads = 0, generated = 0;
  const f = await fixture(t, (req, res) => {
    if (req.method === 'DELETE') { removed = true; res.end('{}'); return true; }
    if (req.url === '/api/vibes/cached-delete/encodings/encoded/data') {
      reads++;
      if (removed) { res.statusCode = 404; res.end('{"error":"合成编码已删除"}'); }
      else res.end(JSON.stringify({ encoding: Buffer.alloc(128, 2).toString('base64'), variant: { model: 'nai-diffusion-4-5-full' } }));
      return true;
    }
    return false;
  });
  const generate = async () => {
    const response = new Output();
    await handleGenerateRequest(payloadRequest({ action: 'generate', model: 'nai-diffusion-4-5-full', parameters: {
      width: 832, height: 1216, steps: 23, n_samples: 1, _local_vibes: { enabled: true, slots: [{ vibeId: 'cached-delete', encodingId: 'encoded', strength: 0.6 }] },
    } }), response, '', f.worker.address().port, new CloudQueueCoordinator(() => assert.fail('不能进入公共队列')), { enabled: false },
    async () => { generated++; return new Response('synthetic zip'); }, {
      tasks: new GenerationTasks({ intervalSeconds: 0 }), prepareBilling: async () => ({ runtime: DEFAULT_NAI_RUNTIME }),
      settleGeneration: async () => ({ estimatedCost: 0, anlasBudget: null }),
    });
    return response;
  };
  assert.equal((await generate()).statusCode, 200); assert.equal(reads, 1);
  assert.equal((await generate()).statusCode, 200); assert.equal(reads, 1);
  assert.equal((await f.request('/api/vibes/cached-delete', 'DELETE')).status, 200);
  assert.equal((await generate()).statusCode, 404);
  assert.equal(reads, 2); assert.equal(generated, 2);
});

test('损坏的付费编码恢复记录保持未知保护，不因启动解析失败放行永久删除', async t => {
  const dir = join(process.cwd(), 'local-data', 'vibe-recovery');
  await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'synthetic-corrupt.json'), '{');
  const f = await fixture(t);
  assert.throws(() => assertVibeEncodingIdle('synthetic'), { status: 409 });
  assert.equal((await f.request('/api/vibes/synthetic', 'DELETE')).status, 409);
  assert.equal(f.forwarded.filter(item => item.method === 'DELETE').length, 0);
});
