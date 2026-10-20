import '../support/node-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';
import { getStoragePreferences, updateStoragePreferences } from '../../scripts/storage-locations.mjs';

test('工坊、缓存、备份与导出共用注入目录选择器，等待确认且取消不保存偏好', { skip: process.platform !== 'win32' }, async () => {
  const worker = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  await new Promise(done => worker.listen(0, '127.0.0.1', done));
  let gateway, finish, reached;
  try {
    await updateStoragePreferences({ exportMode: 'directory', exportDir: 'C:\\原选择' });
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port, pickDirectory: () => new Promise(done => { finish = done; reached(); }) });
    const base = `http://127.0.0.1:${gateway.address().port}`;
    for (const kind of ['data', 'cache', 'backup', 'export']) {
      const called = new Promise(done => { reached = done; }); let settled = false;
      const pending = fetch(base + '/api/local-maintenance/storage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action: 'pickDirectory', kind }) }).then(response => response.json()).then(value => { settled = true; return value; });
      await called; assert.equal(settled, false); finish({ path: '', cancelled: true });
      assert.deepEqual(await pending, { path: '', cancelled: true });
    }
    const called = new Promise(done => { reached = done; });
    const pending = fetch(base + '/api/local-maintenance/export-location', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify({ action: 'pick' }) }).then(response => response.json());
    await called; finish({ path: '', cancelled: true });
    assert.deepEqual(await pending, { cancelled: true });
    assert.equal((await getStoragePreferences()).exportDir, 'C:\\原选择');
  } finally {
    gateway?.closeAllConnections(); if (gateway) await new Promise(done => gateway.close(done));
    worker.closeAllConnections(); await new Promise(done => worker.close(done));
  }
});

test('存储切换不被只读长请求阻挡，真实写请求仍拒绝切换', async () => {
  let observed;
  const worker = createServer((req, res) => {
    if (req.url === '/api/synthetic-storage-read') observed?.({ req, res });
    else { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
  });
  await new Promise(done => worker.listen(0, '127.0.0.1', done));
  let gateway;
  try {
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    for (const method of ['GET', 'POST']) {
      const reached = new Promise(done => { observed = done; });
      const client = request({ hostname: '127.0.0.1', port: gateway.address().port, path: '/api/synthetic-storage-read', method });
      const finished = new Promise((done, reject) => { client.on('response', response => { response.resume(); response.on('end', done); }); client.on('error', reject); });
      client.end();
      const { res } = await reached;
      if (method === 'GET') { assert.doesNotThrow(() => gateway.prepareStorageSwitch()); gateway.cancelUpdate(); }
      else assert.throws(() => gateway.prepareStorageSwitch(), /先结束/);
      res.end('{}'); await finished;
    }
  } finally {
    gateway?.closeAllConnections();
    if (gateway) await new Promise(done => gateway.close(done));
    worker.closeAllConnections(); await new Promise(done => worker.close(done));
  }
});

test('本机文件管理在 Windows、macOS 与桌面安装版开放，其余平台的源码版保持只读', async () => {
  const { localFileManagementPlatform } = await import('../../scripts/media-gateway.mjs');
  assert.equal(localFileManagementPlatform('win32', false), true);
  assert.equal(localFileManagementPlatform('darwin', false), true);
  assert.equal(localFileManagementPlatform('linux', false), false);
  assert.equal(localFileManagementPlatform('linux', true), true);
});
