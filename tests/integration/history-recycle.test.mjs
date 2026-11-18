import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { encode } from 'fast-png';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../support/workspace.mjs';

// 普通 SQLite 通过不代表 D1 能执行：在实际本地 D1/R2 绑定下验证完整历史生命周期。
test('本地 D1：无引用历史可移入、恢复和永久删除；收藏、引用和无法核实的资料受保护', async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../worker/index.ts', import.meta.url))],
    absWorkingDir: projectRoot, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
  const mf = new Miniflare({ script: bundled.outputFiles[0].text, modules: true, compatibilityDate: '2026-04-09',
    d1Databases: ['DB'], d1Persist: false, r2Buckets: ['BUCKET'], r2Persist: false,
    bindings: { PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true' }, log: new Log(LogLevel.NONE) });
  const root = 'http://localhost/api/local-history';
  const invoke = async (path, body) => {
    const response = await mf.dispatchFetch(root + path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${path}: ${response.status}`);
    return response.json();
  };
  const bin = '/recycle-bin';
  const image = encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(255) });
  try {
    for (const id of ['plain', 'favorite', 'referenced']) {
      // 导入回执含原记录校验信息，本身不构成创作引用。
      await invoke(id === 'plain' ? '/import' : '', { id, isFavorite: id === 'favorite', prompt: `synthetic ${id}`, createdAt: 123,
        params: { steps: 28 }, imageUrl: 'data:image/png;base64,' + Buffer.from(image).toString('base64') });
    }
    const db = await mf.getD1Database('DB');
    await db.prepare('INSERT INTO chains(id,name,params) VALUES(?,?,?)')
      .bind('chain', 'synthetic chain', JSON.stringify({ image: '/api/local-history/referenced/image?full=1' })).run();

    const preview = await invoke(bin + '/preview', { ids: ['plain', 'favorite', 'referenced'] });
    assert.equal(preview.movableCount, 1);
    assert.deepEqual(preview.skipped, [{ id: 'favorite', reasons: ['favorite'] }, { id: 'referenced', reasons: ['chain'] }]);
    const moved = await invoke(bin + '/move', { previewToken: preview.previewToken });
    assert.deepEqual(moved.completedIds, ['plain']);
    assert.deepEqual(moved.skipped, preview.skipped);

    const media = await mf.dispatchFetch(root + bin + '/plain/image');
    assert.equal(media.status, 200);
    assert.deepEqual(new Uint8Array(await media.arrayBuffer()), image);
    const first = (await invoke(bin + '/plain')).item;
    const restored = await invoke(bin + '/restore', { ids: ['plain'], expectedVersions: { plain: first.version } });
    assert.deepEqual(restored.completedIds, ['plain']);
    assert.equal((await invoke('/plain')).item.prompt, 'synthetic plain');

    await db.prepare('UPDATE chains SET params = ? WHERE id = ?').bind('unreadable', 'chain').run();
    const protectedMove = await invoke(bin + '/move', { ids: ['plain'] });
    assert.deepEqual(protectedMove.skipped, [{ id: 'plain', reasons: ['reference_check_failed'] }]);
    assert.equal((await invoke('/plain')).item.id, 'plain');
    await db.prepare('UPDATE chains SET params = ? WHERE id = ?').bind('{}', 'chain').run();
    assert.deepEqual((await invoke(bin + '/move', { ids: ['plain'] })).completedIds, ['plain']);
    const again = (await invoke(bin + '/plain')).item;
    const purged = await invoke(bin + '/purge', { ids: ['plain'], expectedVersions: { plain: again.version } });
    assert.deepEqual(purged.completedIds, ['plain']);
    assert.deepEqual(purged.warnings, []);
    assert.equal(await (await mf.getR2Bucket('BUCKET')).get('local-history/local-owner/plain.png'), null);
    assert.equal((await invoke(bin)).count, 0);
  } finally { await mf.dispose(); }
});
