import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { handleImageTaggerRequest, handleTaggerRemoteAccess, normalizeTaggerOrigin, readTaggerRemoteAccess, writeTaggerRemoteAccess, writeLanPin } from '../../scripts/media-gateway.mjs';
import { LAN_ACCESS_COOKIE } from '../../worker/sharedWhitelist.mjs';

const secret = 'synthetic-tagger-access-secret';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'atelier-origin-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configFile = join(directory, 'lan-access.json');
  await writeFile(configFile, JSON.stringify({ pin: '1234', secret, untouched: 'keep' }));
  return configFile;
}
async function invoke(configFile, { settings = false, method = settings ? 'PUT' : 'POST', origin = 'http://localhost:3000', host = 'localhost:3000', ip = '127.0.0.1', headers = {}, body = {} } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.setTimeout = () => {};
  req.method = method;
  req.headers = { host, ...(origin === null ? {} : { origin }), ...headers };
  req.socket = { remoteAddress: ip };
  let status, payload;
  const res = { writeHead: code => { status = code; }, end: value => { payload = JSON.parse(value.toString()); } };
  let called = false;
  if (settings) await handleTaggerRemoteAccess(req, res, { secret, configFile });
  else await handleImageTaggerRequest(req, res, new URL('http://localhost/api/image-tagger/pause'), secret, { pauseDownload: async () => { called = true; } }, configFile);
  return { status, payload, called };
}

test('来源规范化只接受精确协议、主机与端口', () => {
  for (const value of ['https://EXAMPLE.com:443/', ' https://example.com ']) assert.equal(normalizeTaggerOrigin(value), 'https://example.com');
  assert.equal(normalizeTaggerOrigin('http://example.com:80'), 'http://example.com');
  assert.equal(normalizeTaggerOrigin('https://[::1]:9178'), 'https://[::1]:9178');
  for (const value of ['null', '*.example.com', 'https://*.example.com', 'https://user@example.com', 'https://example.com/path', 'https://example.com/../', 'https://example.com?', 'https://example.com#', 'https://example.com\\evil', 'https://exa mple.com', 'file://example.com', 'example.com', {}, ['https://example.com']]) assert.equal(normalizeTaggerOrigin(value), null, String(value));
});

test('默认关闭保留 HTTP 与无来源旧行为，不采信转发头', async t => {
  const file = await fixture(t);
  assert.deepEqual(await readTaggerRemoteAccess(file), { enabled: false, origins: [] });
  assert.equal((await invoke(file)).status, 200);
  assert.equal((await invoke(file, { origin: null })).status, 200);
  for (const headers of [{}, { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.com' }]) {
    const result = await invoke(file, { origin: 'https://example.com', host: 'example.com', headers });
    assert.equal(result.status, 403); assert.equal(result.called, false);
  }
});

test('HTTPS 精确匹配，拒绝跨站、主机协议端口不符，仍要求 LAN 会话', async t => {
  const file = await fixture(t);
  await writeTaggerRemoteAccess({ enabled: true, origins: ['https://example.com', 'https://example.com:9178'] }, file);
  assert.equal((await invoke(file, { origin: 'https://EXAMPLE.com:443', host: 'example.com' })).status, 200);
  assert.equal((await invoke(file, { origin: 'https://example.com:9178', host: 'example.com:9178' })).status, 200);
  for (const options of [
    { origin: 'https://example.com', host: 'example.com', headers: { 'sec-fetch-site': 'cross-site' } },
    { origin: 'https://evil.example', host: 'evil.example' },
    { origin: 'https://example.com:9179', host: 'example.com:9179' },
    { origin: 'https://example.com', host: 'localhost:3000' },
    { origin: 'http://example.com', host: 'localhost:3000' },
    { origin: 'null', host: 'example.com' },
  ]) { const result = await invoke(file, options); assert.equal(result.status, 403); assert.equal(result.called, false); }
  assert.equal((await invoke(file, { origin: 'https://example.com', host: 'example.com', ip: '192.168.1.2' })).status, 401);
  const value = `${Date.now() + 60000}.synthetic-nonce`;
  const cookie = `${LAN_ACCESS_COOKIE}=${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
  assert.equal((await invoke(file, { origin: 'https://example.com', host: 'example.com', ip: '192.168.1.2', headers: { cookie } })).status, 200);
});

test('配置不能由未获准页面自授权，保存重读与关闭保留列表且不丢 PIN/secret', async t => {
  const file = await fixture(t);
  const body = { enabled: true, origins: ['https://EXAMPLE.com:443/', 'https://example.com'] };
  for (const options of [{ origin: 'https://example.com', host: 'example.com' }, { origin: null }, { headers: { 'sec-fetch-site': 'cross-site' } }]) assert.equal((await invoke(file, { ...options, settings: true, body })).status, 403);
  assert.equal((await invoke(file, { settings: true, ip: '192.168.1.2', body })).status, 401);
  assert.equal((await invoke(file, { settings: true, method: 'POST', body })).status, 405);
  assert.equal((await invoke(file, { settings: true, body })).status, 200);
  assert.deepEqual((await invoke(file, { settings: true, method: 'GET' })).payload, { enabled: true, origins: ['https://example.com'] });
  assert.equal((await invoke(file, { settings: true, origin: 'https://example.com', host: 'example.com', body: { enabled: false, origins: ['https://example.com'] } })).status, 200);
  assert.deepEqual(await readTaggerRemoteAccess(file), { enabled: false, origins: ['https://example.com'] });
  assert.equal((await invoke(file, { origin: 'https://example.com', host: 'example.com' })).status, 403);
  await Promise.all([writeTaggerRemoteAccess(body, file), writeLanPin('5678', file)]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.pin, '5678'); assert.equal(saved.secret, secret); assert.equal(saved.untouched, 'keep');
  assert.deepEqual(saved.taggerRemoteAccess, { enabled: true, origins: ['https://example.com'] });
  for (const body of [{ enabled: 'true', origins: [] }, { enabled: true, origins: ['https://*.example.com'] }, { enabled: true, origins: Array(33).fill('https://example.com') }]) assert.equal((await invoke(file, { settings: true, body })).status, 400);
});

test('首次缺文件与旧配置默认关闭，显式关闭保留来源', async t => {
  const file = await fixture(t);
  await rm(file);
  assert.deepEqual(await readTaggerRemoteAccess(file), { enabled: false, origins: [] });
  assert.deepEqual((await invoke(file, { settings: true, method: 'GET' })).payload, { enabled: false, origins: [] });
  await writeFile(file, JSON.stringify({ pin: '1234', secret, untouched: 'keep' }));
  assert.deepEqual(await readTaggerRemoteAccess(file), { enabled: false, origins: [] });
  await writeTaggerRemoteAccess({ enabled: false, origins: ['https://example.com'] }, file);
  assert.deepEqual(await readTaggerRemoteAccess(file), { enabled: false, origins: ['https://example.com'] });
});

test('损坏 JSON 与非法来源配置报读取错误，不覆盖已有字节', async t => {
  const file = await fixture(t);
  for (const content of ['{broken', JSON.stringify({ pin: '1234', secret, taggerRemoteAccess: { enabled: 'true', origins: [] } })]) {
    await writeFile(file, content);
    await assert.rejects(readTaggerRemoteAccess(file));
    for (const method of ['GET', 'PUT']) {
      const result = await invoke(file, { settings: true, method, body: { enabled: true, origins: ['https://example.com'] } });
      assert.equal(result.status, 503);
      assert.deepEqual(result.payload, { error: '无法读取来源配置', code: 'TAGGER_REMOTE_ACCESS_READ_FAILED' });
    }
    assert.equal((await invoke(file, { origin: 'https://example.com', host: 'example.com' })).status, 403);
    assert.equal(await readFile(file, 'utf8'), content);
    await assert.rejects(writeTaggerRemoteAccess({ enabled: true, origins: [] }, file));
    assert.equal(await readFile(file, 'utf8'), content);
  }
});

test('权限错误拒绝管理读取和写入，保留有效配置', { skip: process.getuid?.() === 0 ? 'root 无法可靠验证文件读取权限' : false }, async t => {
  const file = await fixture(t);
  const content = JSON.stringify({ pin: '1234', secret, taggerRemoteAccess: { enabled: true, origins: ['https://example.com'] } });
  await writeFile(file, content);
  await chmod(file, 0o000);
  try {
    await assert.rejects(readTaggerRemoteAccess(file), { code: 'EACCES' });
    assert.equal((await invoke(file, { settings: true, method: 'GET' })).status, 503);
    assert.equal((await invoke(file, { settings: true, method: 'PUT' })).status, 503);
    assert.equal((await invoke(file, { origin: 'https://example.com', host: 'example.com' })).status, 403);
  } finally { await chmod(file, 0o600); }
  assert.equal(await readFile(file, 'utf8'), content);
});

test('非 ENOENT I/O 错误不会被误认成首次配置', async t => {
  const file = await fixture(t);
  await rm(file);
  await mkdir(file);
  await assert.rejects(readTaggerRemoteAccess(file), { code: 'EISDIR' });
  assert.equal((await invoke(file, { settings: true, method: 'GET' })).status, 503);
});
