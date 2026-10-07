import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { startTagUpdateServer } from '../../scripts/tag-update-server.mjs';

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
