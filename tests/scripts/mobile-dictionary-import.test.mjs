import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { projectRoot } from '../support/workspace.mjs';
import '../support/node-environment.mjs';

const loadMobileDictionary = async () => {
  const { transform } = await import('esbuild');
  const source = extractAndroidShared(join(projectRoot, 'mobile/dictionary.ts'), ['mobileDictionary'], `
    const native = globalThis.__native;
    const writeBlob = (...args) => globalThis.__writeBlob(...args);
    const db = globalThis.__db;
    const generate = (...args) => globalThis.__generate(...args);
    const naiConfig = globalThis.__naiConfig;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  `);
  const transformed = await transform(source, { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64') + '#' + crypto.randomUUID());
};

const importRequest = body => new Request('https://localhost/api/tag-dictionary/import', { method: 'POST', body });

test('手机端手动导入在本地生成词库并原子切换索引，不走下载线路', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).startsWith('/tag-data/')
    ? new Response(JSON.stringify({ count: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : originalFetch(input);
  try {
    const calls = { native: [], generate: [], writes: [], db: [] };
    globalThis.__native = {
      async sql(options) { calls.native.push(options); return { results: [{ name: '1girl', category: 0, cn_name: '一个女孩', post_count: 9000 }] }; },
      async file(options) { calls.native.push(options); return {}; }
    };
    globalThis.__writeBlob = async (blob, path) => { calls.writes.push({ path, size: blob.size }); return path; };
    globalThis.__generate = async (rows, config, metadata, directory) => { calls.generate.push({ rows, metadata, directory }); return { count: rows.length, directory }; };
    globalThis.__db = {
      prepare(sql) {
        return {
          first: async () => null,
          bind: (...values) => ({ async run() { calls.db.push({ sql, values }); return { success: true }; } })
        };
      }
    };
    globalThis.__naiConfig = { tags: [] };
    const module = await loadMobileDictionary();

    assert.equal((await module.mobileDictionary(importRequest('not-a-dictionary'))).status, 400);
    const payload = new Uint8Array([...new TextEncoder().encode('SQLite format 3\u0000'), 1, 2, 3]);
    const accepted = await module.mobileDictionary(importRequest(payload));
    assert.equal(accepted.status, 200);
    const initial = await accepted.json();
    assert.equal(initial.running, true);
    assert.equal(initial.phase, 'generating');
    let status = initial;
    for (let attempt = 0; attempt < 100 && status.running; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
      status = await (await module.mobileDictionary(new Request('https://localhost/api/tag-dictionary'))).json();
    }
    assert.equal(status.running, false);
    assert.equal(status.phase, 'completed', status.message);
    assert.equal(calls.writes.length, 1);
    assert.match(calls.writes[0].path, /^dictionary\/builds\/[0-9a-f-]+\/source\.sqlite$/);
    assert.equal(calls.writes[0].size, payload.length);
    assert.equal(calls.generate.length, 1);
    assert.equal(calls.generate[0].metadata.downloadUrl, 'manual-import');
    assert.deepEqual(calls.generate[0].metadata.validators, {});
    assert.equal(calls.generate[0].rows.length, 1);
    const stored = calls.db.find(entry => entry.sql.includes('INSERT OR REPLACE'));
    assert.ok(stored, '没有写入当前词库路径');
    assert.match(stored.values[0], /^dictionary\/builds\/[0-9a-f-]+\/tag-data$/);
    assert.equal(calls.native.some(entry => entry.action === 'delete' && entry.path.endsWith('/source.sqlite')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('手机端拒绝空文件与非 POST 导入，不影响现有状态', async () => {
  globalThis.__native = { async sql() { return { results: [] }; }, async file() { return {}; } };
  globalThis.__writeBlob = async () => 'unused';
  globalThis.__generate = async () => ({ count: 0 });
  globalThis.__db = { prepare: () => ({ first: async () => null, bind: () => ({ run: async () => ({ success: true }) }) }) };
  globalThis.__naiConfig = { tags: [] };
  const module = await loadMobileDictionary();
  assert.equal((await module.mobileDictionary(new Request('https://localhost/api/tag-dictionary/import'))).status, 405);
  const empty = await module.mobileDictionary(importRequest(new Uint8Array()));
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /没有收到词库文件/);
});
test('手机端删除词库移除构建目录并清空当前路径', async () => {
  const calls = [];
  globalThis.__native = {
    async sql() { return { results: [] }; },
    async file(options) { calls.push(options); return {}; },
  };
  globalThis.__writeBlob = async () => 'unused';
  globalThis.__generate = async () => ({ count: 0 });
  globalThis.__db = {
    prepare(sql) {
      return {
        first: async () => ({ value: 'dictionary/builds/11111111-1111-1111-1111-111111111111/tag-data' }),
        bind: () => ({ run: async () => ({ success: true }) }),
        run: async () => { calls.push({ sql }); return { success: true }; },
      };
    }
  };
  globalThis.__naiConfig = { tags: [] };
  const module = await loadMobileDictionary();
  const response = await module.mobileDictionary(new Request('https://localhost/api/tag-dictionary/delete', { method: 'POST' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.manifest.count, 0);
  assert.equal(calls.some(item => item.action === 'deleteTree' && item.path === 'dictionary/builds/11111111-1111-1111-1111-111111111111'), true);
  assert.equal(calls.some(item => item.sql && item.sql.includes('DELETE FROM settings')), true);
});
