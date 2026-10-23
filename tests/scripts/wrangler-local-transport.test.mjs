import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { configureProxy } from '../../scripts/wrangler-local-transport.cjs';
import { RUNTIME_FILES } from '../../scripts/build-desktop.mjs';

test('Wrangler 使用 Miniflare 本机转发扩展点，初次启动与重新配置共用，源码和安装版都携带修复', () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(require.resolve('wrangler'), 'utf8');
  assert.match(source, /new miniflare\.Miniflare\(/);
  assert.ok(RUNTIME_FILES.includes('scripts/wrangler-local-transport.cjs'));
  assert.match(readFileSync(new URL('../../scripts/local-server.mjs', import.meta.url), 'utf8'), /'--require', resolvePath\(APP_ROOT, 'scripts\/wrangler-local-transport.cjs'\)/);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['dev:local:quick'], /node --require \.\/scripts\/wrangler-local-transport\.cjs/);
  const user = { name: 'UserWorker' }, inspector = { name: 'InspectorProxyWorker' };
  const options = { port: 0, workers: [{ name: 'ProxyWorker' }, user, inspector] };
  const configured = configureProxy(options);
  assert.equal(typeof configured.workers[0].outboundService, 'function');
  assert.equal(configureProxy(configured).workers[0].outboundService, configured.workers[0].outboundService);
  assert.equal(configured.workers[1], user); assert.equal(configured.workers[2], inspector);
  assert.equal(options.workers[0].outboundService, undefined);
  const miniflareRequire = createRequire(require.resolve('wrangler'));
  const wrapped = miniflareRequire('miniflare');
  assert.notEqual(wrapped.Miniflare, require('miniflare').Miniflare);
  assert.equal(typeof wrapped.Miniflare.prototype.setOptions, 'function');
});

test('只取消 Miniflare 回环服务的空闲回收，普通 HTTP 服务保留默认设置', () => {
  const loopback = createServer(Object.defineProperty(() => {}, 'name', { value: '#handleLoopback' }));
  const ordinary = createServer(() => {});
  assert.equal(loopback.keepAliveTimeout, 0); assert.equal(ordinary.keepAliveTimeout, 5000);
  loopback.close(); ordinary.close();
});

test('本机转发逐次建立连接，保留请求、流式响应及重定向状态，不自动重投 POST', async () => {
  const requests = []; let connections = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ body: Buffer.concat(chunks).toString(), cookie: req.headers.cookie });
    if (req.url === '/redirect') { res.writeHead(307, { location: '/must-not-follow' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: preview\ndata: first\n\n');
    setImmediate(() => res.end('event: final\ndata: last\n\n'));
  });
  server.on('connection', () => connections++);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const forward = configureProxy({ workers: [{ name: 'ProxyWorker' }] }).workers[0].outboundService;
  try {
    for (let i = 0; i < 2; i++) {
      const response = await forward(new Request(`http://127.0.0.1:${server.address().port}/stream`, {
        method: 'POST', headers: { cookie: 'synthetic=1' }, body: `synthetic-${i}`,
      }));
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.equal(await response.text(), 'event: preview\ndata: first\n\nevent: final\ndata: last\n\n');
    }
    const redirect = await forward(new Request(`http://127.0.0.1:${server.address().port}/redirect`, { method: 'POST', body: 'synthetic-redirect' }));
    assert.equal(redirect.status, 307); await redirect.text();
    assert.equal(connections, 3); assert.equal(requests.length, 3);
    assert.deepEqual(requests.slice(0, 2), [{ body: 'synthetic-0', cookie: 'synthetic=1' }, { body: 'synthetic-1', cookie: 'synthetic=1' }]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const [coding, encode] of [['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]]) {
  test(`${coding} 正文解压后清除旧编码与长度头，保留 JSON、状态和 Cookie`, async () => {
    const body = JSON.stringify({ receiptId: 'synthetic-receipt', budget: { remaining: 98 } });
    const bytes = encode(body);
    const server = createServer((_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json', 'content-encoding': coding, 'content-length': bytes.length,
        'set-cookie': ['synthetic=1; HttpOnly', 'second=2; HttpOnly'] });
      res.end(bytes);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const forward = configureProxy({ workers: [{ name: 'ProxyWorker' }] }).workers[0].outboundService;
      const response = await forward(new Request(`http://127.0.0.1:${server.address().port}/accounting`, { method: 'POST', body: '{}' }));
      assert.equal(response.status, 201); assert.equal(response.headers.get('content-encoding'), null);
      assert.equal(response.headers.get('content-length'), null);
      assert.deepEqual(response.headers.getSetCookie(), ['synthetic=1; HttpOnly', 'second=2; HttpOnly']);
      assert.deepEqual(await response.json(), JSON.parse(body));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}
