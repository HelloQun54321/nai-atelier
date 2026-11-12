import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import '../support/node-environment.mjs';

// 安装版跳过源码构建；网关与 Tag 服务都按安装版运行时加载。
const previousPackaged = process.env.NAI_PACKAGED;
process.env.NAI_PACKAGED = '1';
const { startTagUpdateServer } = await import('../../scripts/tag-update-server.mjs');
const { requestTagDictionaryImport } = await import('../../scripts/media-gateway.mjs');
if (previousPackaged === undefined) delete process.env.NAI_PACKAGED;
else process.env.NAI_PACKAGED = previousPackaged;

test('网关把手动导入的词库字节原样转交本地 Tag 服务', async () => {
  const root = createWorkspace('gateway-tag-import-');
  const marker = join(root, 'import.txt');
  const script = join(root, 'synthetic-updater.mjs');
  await writeFile(script, "import fs from 'node:fs'; const file = process.env.NAI_TAG_LOCAL_SOURCE || ''; fs.writeFileSync(new URL('./import.txt', import.meta.url), file ? fs.readFileSync(file, 'utf8') : 'missing'); console.log('TAG_UPDATE_RESULT=updated');");
  const previousPort = process.env.NAI_TAG_UPDATE_PORT;
  const server = startTagUpdateServer({ port: 0, updateScript: script });
  try {
    await once(server, 'listening');
    process.env.NAI_TAG_UPDATE_PORT = String(server.address().port);
    const payload = Buffer.from(`SQLite format 3\u0000${'gateway-forwarded'.repeat(8)}`);
    const result = await requestTagDictionaryImport(payload);
    assert.equal(result.available, true);
    assert.equal(result.running, true);
    assert.equal(result.phase, 'generating');
    let received = '';
    for (let attempt = 0; attempt < 80; attempt++) {
      received = await readFile(marker, 'utf8').catch(() => '');
      if (received) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.equal(received, payload.toString('utf8'));
  } finally {
    if (previousPort === undefined) delete process.env.NAI_TAG_UPDATE_PORT;
    else process.env.NAI_TAG_UPDATE_PORT = previousPort;
    server.stopUpdates();
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    removeWorkspace(root);
  }
});
