import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../support/workspace.mjs';

test('真实 D1：并发重交、不同 Key 并发和事务回滚不会重复或半笔结算', async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../worker/index.ts', import.meta.url))],
    absWorkingDir: projectRoot, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
  const mf = new Miniflare({ script: bundled.outputFiles[0].text, modules: true, compatibilityDate: '2026-04-09',
    d1Databases: ['DB'], d1Persist: false, bindings: { PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true' }, log: new Log(LogLevel.NONE) });
  const hash = 'a'.repeat(64), other = 'b'.repeat(64);
  const invoke = async (path, method, body) => mf.dispatchFetch('http://localhost/api/' + path, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const receipt = keyHash => ({ receiptId: crypto.randomUUID(), keyHash, action: 'generation', model: 'synthetic-v5', images: 1, cost: 2, opusImages: 0 });
  try {
    for (const keyHash of [hash, other]) assert.equal((await invoke('anlas-budget', 'PUT', { keyHash, remaining: 100 })).status, 200);
    const first = receipt(hash), second = receipt(other);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => invoke('nai-accounting', 'POST', i % 2 ? first : second)));
    assert.deepEqual(results.map(res => res.status), Array(12).fill(200));
    const db = await mf.getD1Database('DB');
    const remaining = async key => Number((await db.prepare('SELECT value FROM settings WHERE key = ?').bind('anlas_budget_remaining_v2:' + key).first()).value);
    const personal = async () => JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'anlas_personal_usage_v1'").first()).value);
    assert.equal(await remaining(hash), 98); assert.equal(await remaining(other), 98);
    assert.equal((await personal())[hash].anlasSpent, 2); assert.equal((await personal())[other].anlasSpent, 2);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM local_usage_events').first()).n, 2);
    assert.equal((await invoke('nai-accounting', 'POST', { ...first, cost: 9 })).status, 409);
    assert.equal(await remaining(hash), 98);
    await db.prepare("CREATE TRIGGER reject_usage BEFORE INSERT ON local_usage_events BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END").run();
    const failed = receipt(hash);
    assert.equal((await invoke('nai-accounting', 'POST', failed)).status, 500);
    assert.equal(await remaining(hash), 98); assert.equal((await personal())[hash].anlasSpent, 2);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM local_usage_events').first()).n, 2);
    await db.prepare('DROP TRIGGER reject_usage').run();
    assert.equal((await invoke('nai-accounting', 'POST', failed)).status, 200);
    assert.equal(await remaining(hash), 96); assert.equal((await personal())[hash].anlasSpent, 4);
  } finally { await mf.dispose(); }
});
