import '../support/node-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';
import { openInExplorer } from '../../scripts/local-backup.mjs';

const send = (port, path, { method = 'POST', headers = {}, body = '{"keepCount":1}' } = {}) => new Promise((resolve, reject) => {
  const client = request({ hostname: '127.0.0.1', port, path, method, headers }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  client.on('error', reject);
  client.end(method === 'GET' ? undefined : body);
});

const withGateway = async run => {
  // 网关启动时会自行请求 Worker（收集器会话、历史索引），只记录本测试发出的合成路径。
  const reached = [];
  const worker = createServer((req, res) => { if (/synthetic|cleanup/.test(req.url)) reached.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  await new Promise(done => worker.listen(0, '127.0.0.1', done));
  let gateway;
  try {
    gateway = await createMediaGateway({ port: 0, workerPort: worker.address().port });
    await run(gateway.address().port, reached);
  } finally {
    gateway?.closeAllConnections(); if (gateway) await new Promise(done => gateway.close(done));
    worker.closeAllConnections(); await new Promise(done => worker.close(done));
  }
};

test('备份打开目录只接受电脑本机页面的明确操作，且只打开现有目录', async () => {
  await withGateway(async port => {
    const missingControl = await send(port, '/api/local-maintenance/backup/open-folder', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(missingControl.status, 403);
    const crossSite = await send(port, '/api/local-maintenance/backup/open-folder', { headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example', 'x-nai-local-control': 'true' }, body: '{}' });
    assert.equal(crossSite.status, 403);
  });
  const root = await mkdtemp(join(tmpdir(), 'nai-open-folder-'));
  try {
    const script = join(root, 'synthetic.bat');
    await writeFile(script, '@echo off');
    await assert.rejects(openInExplorer(script), /只能打开现有目录/);
    await assert.rejects(openInExplorer('synthetic-relative-dir'), /目标路径不存在|只能打开现有目录/);
    await assert.rejects(openInExplorer(join(root, 'missing')), /目标路径不存在/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
