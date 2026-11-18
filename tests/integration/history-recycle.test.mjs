import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { encode } from 'fast-png';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../support/workspace.mjs';

// 普通 SQLite 通过不代表 D1 能执行：在实际本地 D1/R2 绑定下验证完整历史生命周期。
test('本地 D1：历史移入、恢复、永久删除与 Roll 引用的事务边界', async () => {
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
    assert.deepEqual(moved.completedIds, ['plain'], JSON.stringify(moved));
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

    const rollUrl = 'http://localhost/api/style-roll';
    const candidate = { id: 'candidate', tags: [{ tag: 'synthetic artist', weight: 1 }], createdAt: 1, archived: false };
    const experiment = {
      version: 1, id: 'synthetic-roll', name: 'synthetic roll', revision: 0, createdAt: 1, updatedAt: 1,
      template: { prompt: '{style}, synthetic subject', negativePrompt: '', params: {
        model: 'nai-diffusion-4-5-full', seed: 1, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
      } },
      artists: [], candidates: [candidate], rounds: [], rules: { minArtists: 1, maxArtists: 1, minWeight: 1, maxWeight: 1 },
    };
    const saveRoll = body => mf.dispatchFetch(rollUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const id = 'roll-original';
    await invoke('/import', { id, prompt: 'synthetic roll original', createdAt: 456, sourceChainId: `style-roll:${experiment.id}`,
      modules: [{ id: `style-roll:${candidate.id}`, name: 'Roll', content: '', isActive: false }],
      params: { steps: 28 }, imageUrl: 'data:image/png;base64,' + Buffer.from(image).toString('base64') });
    const beforeRoll = await invoke(bin + '/preview', { ids: [id] });
    assert.equal(beforeRoll.movableCount, 1);
    const created = await saveRoll(experiment);
    assert.equal(created.status, 200);
    const { experiment: savedRoll } = await created.json();
    const afterRoll = await invoke(bin + '/move', { previewToken: beforeRoll.previewToken });
    assert.deepEqual(afterRoll.completedIds, []);
    assert.deepEqual(afterRoll.skipped, [{ id, reasons: ['roll'] }]);

    const archived = await saveRoll({ ...savedRoll, candidates: [{ ...candidate, archived: true }] });
    assert.equal(archived.status, 200);
    const { experiment: archivedRoll } = await archived.json();
    assert.deepEqual((await invoke(bin + '/move', { ids: [id] })).completedIds, [id]);
    // 移入先提交时，既不能重新启用旧候选，也不能删除记录后重建同一个悬空关联。
    const refused = await saveRoll({ ...archivedRoll, candidates: [candidate] });
    assert.equal(refused.status, 409);
    assert.match(await refused.text(), /候选原图已在历史回收站/);
    assert.equal((await mf.dispatchFetch(`${rollUrl}/${experiment.id}?revision=${archivedRoll.revision}`, { method: 'DELETE' })).status, 200);
    assert.equal((await saveRoll(experiment)).status, 409);
    const rollBinItem = (await invoke(`${bin}/${id}`)).item;
    assert.deepEqual((await invoke(bin + '/restore', { ids: [id], expectedVersions: { [id]: rollBinItem.version } })).completedIds, [id]);
    assert.equal((await saveRoll(experiment)).status, 200);
  } finally { await mf.dispose(); }
});
