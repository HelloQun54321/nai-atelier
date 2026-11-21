import '../support/node-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';
import { CODEX_MEDIA_HOSTS } from '../../worker/sharedWhitelist.mjs';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { projectRoot } from '../support/workspace.mjs';
import { join } from 'node:path';

test('本机网关法典入口只读，原始字节经过出站通道，不转发账户凭据或跟随重定向', async () => {
  const previous = getGlobalDispatcher();
  const mock = new MockAgent(); mock.disableNetConnect(); mock.enableNetConnect(/^127\.0\.0\.1(?::\d+)?$/); setGlobalDispatcher(mock);
  const pool = mock.get('https://novelai.quicktagcloud.com');
  const raw = '{ "entries": [{"title":"合成"}] }';
  pool.intercept({ path: '/api/community', method: 'GET' }).reply(200, options => {
    assert.doesNotMatch(JSON.stringify(options.headers), /synthetic-private-key|synthetic-cookie/);
    return raw;
  }, { headers: { 'content-type': 'application/json' } });
  pool.intercept({ path: '/data-source.json', method: 'GET' }).reply(302, '', { headers: { location: 'https://evil.test/data.json' } });
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: 39999 });
    const base = `http://127.0.0.1:${server.address().port}/api/codex/data?url=`;
    const response = await fetch(base + encodeURIComponent('https://novelai.quicktagcloud.com/api/community'), { headers: { authorization: 'Bearer synthetic-private-key', cookie: 'session=synthetic-cookie' } });
    assert.equal(response.status, 200); assert.equal(await response.text(), raw);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await fetch(base + encodeURIComponent('https://evil.test/data.json'))).status, 400);
    assert.equal((await fetch(base + encodeURIComponent('https://novelai.quicktagcloud.com/api/community'), { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + encodeURIComponent('https://novelai.quicktagcloud.com/data-source.json'))).status, 502);
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    setGlobalDispatcher(previous); await mock.close();
  }
});

test('法典和 Danbooru 图床原图返回原始字节，浏览器取图不跳转跨域', async () => {
  const previous = getGlobalDispatcher();
  const mock = new MockAgent(); mock.disableNetConnect(); mock.enableNetConnect(/^127\.0\.0\.1(?::\d+)?$/); setGlobalDispatcher(mock);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const hosts = [...CODEX_MEDIA_HOSTS, 'cdn.donmai.us'];
  for (const host of hosts) mock.get(`https://${host}`).intercept({ path: '/synthetic.png?v=abc', method: 'GET' }).reply(200, options => {
    assert.doesNotMatch(JSON.stringify(options.headers), /synthetic-private-key|synthetic-cookie/);
    return bytes;
  }, { headers: { 'content-type': 'image/png' } });
  let server;
  try {
    server = await createMediaGateway({ port: 0, workerPort: 39999 });
    for (const host of hosts) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/media?source=${encodeURIComponent(`https://${host}/synthetic.png?v=abc`)}&variant=original`, {
        redirect: 'manual', headers: { authorization: 'Bearer synthetic-private-key', cookie: 'session=synthetic-cookie' },
      });
      assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    mock.assertNoPendingInterceptors();
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    setGlobalDispatcher(previous); await mock.close();
  }
});

test('独立手机法典读取走原生网络，共用地址限制、原始字节与只读规则', async t => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/gateway.ts'), ['mobileGateway'], `
    import { fetchCodexData } from '${new URL('../../worker/codexRemote.mjs', import.meta.url).href}';
    let nativeRequests = 0;
    const nativeFetch = (...args) => { nativeRequests++; return fetch(...args); };
    const json = (value, status = 200) => Response.json(value, { status });
  `, { tasks: 'const tasks = {};', queue: 'const queue = {};', generationJobs: 'const generationJobs = {};', readSetting: 'const readSetting = async (_key, fallback) => fallback;' });
  const transformed = await transform(source + '\nexport { nativeRequests };', { loader: 'ts', format: 'esm' });
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
  const raw = '{ "词条": "合成" }';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://novelai.quicktagcloud.com/api/community');
    assert.equal(options.redirect, 'manual'); assert.deepEqual(options.headers, { Accept: 'application/json' });
    return new Response(raw);
  });
  const base = 'https://localhost/api/codex/data?url=';
  const response = await mobile.mobileGateway(new Request(base + encodeURIComponent('https://novelai.quicktagcloud.com/api/community'), {
    headers: { authorization: 'Bearer synthetic-private-key', cookie: 'session=synthetic-cookie' },
  }));
  assert.equal(response.status, 200); assert.equal(await response.text(), raw); assert.equal(mobile.nativeRequests, 1);
  assert.equal((await mobile.mobileGateway(new Request(base + encodeURIComponent('https://evil.test/data.json')))).status, 400);
  assert.equal((await mobile.mobileGateway(new Request(base + encodeURIComponent('https://novelai.quicktagcloud.com/api/community'), { method: 'POST' }))).status, 405);
  assert.equal(mobile.nativeRequests, 1);
});
