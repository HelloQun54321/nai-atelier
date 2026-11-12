import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { writeFile, readFile, stat, mkdir } from 'node:fs/promises';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import '../support/node-environment.mjs';

const previousPackaged = process.env.NAI_PACKAGED;
process.env.NAI_PACKAGED = '1';
const { startTagUpdateServer } = await import('../../scripts/tag-update-server.mjs');
if (previousPackaged === undefined) delete process.env.NAI_PACKAGED;
else process.env.NAI_PACKAGED = previousPackaged;

test('停服会终止本次启动的词库子进程，不留下继续写入的后台', async () => {
  const root = createWorkspace('tag-update-child-');
  const script = join(root, 'synthetic-updater.mjs'), marker = join(root, 'pid.txt');
  await writeFile(script, "import fs from 'node:fs'; fs.writeFileSync(new URL('./pid.txt', import.meta.url), String(process.pid)); setInterval(() => {}, 1000);");
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    server.prepareUpdate();
    const blocked = await fetch(`http://127.0.0.1:${server.address().port}/tag-dictionary`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' } });
    assert.equal(blocked.status, 503);
    server.cancelUpdate();
    const result = await fetch(`http://127.0.0.1:${server.address().port}/tag-dictionary`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' } });
    assert.equal(result.status, 202);
    assert.throws(() => server.prepareUpdate(), /词库正在更新/);
    let pid;
    for (let attempt = 0; attempt < 40; attempt++) {
      pid = await readFile(marker, 'utf8').then(Number).catch(() => null);
      if (pid) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.ok(pid);
    process.kill(pid, 0);
    server.stopUpdates();
    for (let attempt = 0; attempt < 40; attempt++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(done => setTimeout(done, 25));
    }
    assert.throws(() => process.kill(pid, 0));
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});

test('手动导入把上传的 tag.sqlite 交给生成脚本，结束后清理临时副本', async () => {
  const root = createWorkspace('tag-import-');
  const script = join(root, 'synthetic-updater.mjs'), marker = join(root, 'import.json');
  await writeFile(script, "import fs from 'node:fs'; const file = process.env.NAI_TAG_LOCAL_SOURCE || ''; fs.writeFileSync(new URL('./import.json', import.meta.url), JSON.stringify({ file, text: file ? fs.readFileSync(file, 'utf8') : '' })); console.log('TAG_UPDATE_RESULT=updated');");
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' };
    const payload = `SQLite format 3\u0000${'synthetic-tags'.repeat(64)}`;
    const response = await fetch(`${base}/tag-dictionary/import`, { method: 'POST', headers, body: payload });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).running, true);
    let record;
    for (let attempt = 0; attempt < 80; attempt++) {
      record = await readFile(marker, 'utf8').then(JSON.parse).catch(() => null);
      if (record) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.ok(record, '生成脚本没有收到导入文件');
    assert.equal(record.text, payload);
    let status;
    for (let attempt = 0; attempt < 120; attempt++) {
      status = await (await fetch(`${base}/tag-dictionary`, { headers })).json();
      if (!status.running) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.equal(status.phase, 'completed');
    let remaining = true;
    for (let attempt = 0; attempt < 40 && remaining; attempt++) {
      remaining = await stat(dirname(record.file)).then(() => true, () => false);
      if (remaining) await new Promise(done => setTimeout(done, 25));
    }
    assert.equal(remaining, false, '导入文件的临时副本没有清理');
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});

test('导入非 SQLite 文件在原位拒绝，不启动更新也不覆盖现有词库', async () => {
  const root = createWorkspace('tag-import-invalid-');
  const marker = join(root, 'started.txt');
  const script = join(root, 'synthetic-updater.mjs');
  await writeFile(script, "import fs from 'node:fs'; fs.writeFileSync(new URL('./started.txt', import.meta.url), 'started');");
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' };
    const response = await fetch(`${base}/tag-dictionary/import`, { method: 'POST', headers, body: 'not-a-dictionary' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不是有效的 SQLite 词库/);
    const status = await (await fetch(`${base}/tag-dictionary`, { headers })).json();
    assert.equal(status.running, false);
    assert.equal(await stat(marker).then(() => true, () => false), false);
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});

test('更新子进程获得现有网关代理，多行主备错误原样返回界面', async () => {
  const root = createWorkspace('tag-update-proxy-');
  const script = join(root, 'synthetic-updater.mjs'), marker = join(root, 'proxy.txt');
  const detail = '主线路（primary.invalid）：连接超时\n备用线路（fallback.invalid）：下载服务器返回 403 Forbidden';
  await writeFile(script, `import fs from 'node:fs'; fs.writeFileSync(new URL('./proxy.txt', import.meta.url), process.env.NAI_TAG_PROXY_URL || ''); console.error('TAG_UPDATE_ERROR=' + encodeURIComponent(${JSON.stringify(detail)})); process.exitCode = 1;`);
  const proxy = 'http://127.0.0.1:7897';
  const server = startTagUpdateServer({ port: 0, updateScript: script, outboundProxyUrl: proxy });
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/tag-dictionary`;
    const headers = { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' };
    // 上一个停服用例的退出回执处理完成后，再启动下一次合成任务。
    for (let attempt = 0; attempt < 40 && (await (await fetch(url, { headers })).json()).running; attempt++) await new Promise(done => setTimeout(done, 25));
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 202);
    let status;
    for (let attempt = 0; attempt < 40; attempt++) {
      status = await (await fetch(url, { headers })).json();
      if (!status.running) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.equal(await readFile(marker, 'utf8'), proxy);
    assert.equal(status.phase, 'error');
    assert.equal(status.message, detail);
    assert.equal(status.running, false);
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});

test('删除词库只移除生成目录并清零摘要', async () => {
  const root = createWorkspace('tag-delete-');
  const dataDir = join(process.cwd(), 'public', 'tag-data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'manifest.json'), JSON.stringify({ count: 42, generatedAt: '2026-11-12T00:00:00Z' }));
  const script = join(root, 'synthetic-updater.mjs');
  await writeFile(script, "console.log('TAG_UPDATE_RESULT=updated');");
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' };
    const before = await (await fetch(`${base}/tag-dictionary`, { headers })).json();
    assert.equal(before.manifest.count, 42);
    const response = await fetch(`${base}/tag-dictionary/delete`, { method: 'POST', headers });
    assert.equal(response.status, 200);
    const after = await response.json();
    assert.equal(after.manifest.count, 0);
    assert.equal(after.phase, 'idle');
    assert.equal(await stat(join(dataDir, 'manifest.json')).then(() => true, () => false), false);
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});

test('更新进行中拒绝删除词库', async () => {
  const root = createWorkspace('tag-delete-busy-');
  const script = join(root, 'synthetic-updater.mjs');
  await writeFile(script, "await new Promise(resolve => setTimeout(resolve, 400)); console.log('TAG_UPDATE_RESULT=updated');");
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:3000', 'X-Nai-Local-Control': 'true' };
    assert.equal((await fetch(`${base}/tag-dictionary`, { method: 'POST', headers })).status, 202);
    const blocked = await fetch(`${base}/tag-dictionary/delete`, { method: 'POST', headers });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /正在更新/);
  } finally {
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});
