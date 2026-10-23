import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { deactivateArtistHistory, ensureArtistHistoryIndex, readArtistGenerationCounts, readArtistHistorySnapshots, recordArtistHistory } from '../../worker/routes/artistUsageIndex';
import { INIT_SQL, type D1Database, type Env } from '../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const sql = new DatabaseSync(':memory:'); databases.push(sql); sql.exec(INIT_SQL);
  let pending = Promise.resolve<unknown>(undefined);
  let beforeBatch: (() => Promise<void>) | undefined;
  const db = { prepare(query: string) {
    let values: any[] = [];
    return { bind(...args: any[]) { values = args; return this; },
      async first() { return sql.prepare(query).get(...values) || null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: sql.prepare(query).run(...values) }; } };
  }, async batch(statements: { run(): Promise<unknown> }[]) {
    const hook = beforeBatch; beforeBatch = undefined;
    if (hook) await hook();
    const result = pending.then(async () => {
      sql.exec('BEGIN'); try { const output = []; for (const statement of statements) output.push(await statement.run()); sql.exec('COMMIT'); return output; }
      catch (cause) { sql.exec('ROLLBACK'); throw cause; }
    });
    pending = result.catch(() => {}); return result;
  } } as unknown as D1Database;
  const insert = (id: string, prompt = '1.0::artist:alpha_artist ::', source = '', external: string | null = null) => {
    sql.prepare(`INSERT INTO local_generation_history (id,user_id,image_key,prompt,created_at,source_chain_id,external_source)
      VALUES (?, 'owner', '', ?, 100, ?, ?)`).run(id, prompt, source, external);
  };
  return { sql, db, insert, env: {} as Env, beforeBatch(hook: () => Promise<void>) { beforeBatch = hook; } };
}

it('首次全量回填超过4000张，空参与也记凭据，再读不解析原词', async () => {
  const { db, sql, insert, env } = fixture();
  for (let i = 0; i < 4002; i++) insert(String(i));
  insert('empty', 'solo'); insert('sample', 'artist:alpha_artist', 'artist-sample:a'); insert('import', 'artist:alpha_artist', '', 'import');
  await ensureArtistHistoryIndex(db, 'owner', env);
  expect(await readArtistGenerationCounts(db, 'owner')).toEqual([{ name: 'alpha artist', images: 4002, lastAt: 100 }]);
  sql.prepare("UPDATE local_generation_history SET prompt='artist:changed'").run();
  await ensureArtistHistoryIndex(db, 'owner', env);
  expect(await readArtistGenerationCounts(db, 'owner')).toEqual([{ name: 'alpha artist', images: 4002, lastAt: 100 }]);
  expect((await readArtistHistorySnapshots(db, 'owner', 100, 100))).toHaveLength(4004);
  expect(await readArtistHistorySnapshots(db, 'other', 0, 200)).toEqual([]);
});

it('删除读取空凭据后遇到并发索引，会重读并正确扣数', async () => {
  const f = fixture(); f.insert('one');
  f.beforeBatch(async () => { await recordArtistHistory(f.db, 'owner', { id: 'one' }); });
  await deactivateArtistHistory(f.db, 'owner', [{ id: 'one' }], f.env);
  expect((await readArtistGenerationCounts(f.db, 'owner'))[0].images).toBe(0);
  expect(await readArtistHistorySnapshots(f.db, 'owner', 0, 200)).toEqual([]);
});

it('删除旧凭据遇到同ID删除再新增，不误扣旧画师或留下新画师计数', async () => {
  const f = fixture(); f.insert('one'); await ensureArtistHistoryIndex(f.db, 'owner', f.env);
  f.beforeBatch(async () => {
    await deactivateArtistHistory(f.db, 'owner', [{ id: 'one' }], f.env);
    f.insert('one', 'artist:beta'); await ensureArtistHistoryIndex(f.db, 'owner', f.env);
  });
  await deactivateArtistHistory(f.db, 'owner', [{ id: 'one' }], f.env);
  expect((await readArtistGenerationCounts(f.db, 'owner')).map(row => row.images)).toEqual([0, 0]);
  expect(await readArtistHistorySnapshots(f.db, 'owner', 0, 200)).toEqual([]);
});

it('迟到旧回填遇到同ID新内容，来源CAS失败后重新读取当前内容', async () => {
  const f = fixture(); f.insert('one');
  f.beforeBatch(async () => {
    f.sql.prepare("DELETE FROM local_generation_history WHERE id='one'").run(); f.insert('one', 'artist:beta');
  });
  await recordArtistHistory(f.db, 'owner', { id: 'one', prompt: 'artist:alpha_artist', created_at: 100 });
  expect(await readArtistGenerationCounts(f.db, 'owner')).toEqual([{ name: 'beta', images: 1, lastAt: 100 }]);
});

it('并发提交同一历史只累计一次，未索引历史删除无需词库', async () => {
  const { db, insert, env } = fixture(); insert('one');
  await Promise.all(Array.from({ length: 5 }, () => recordArtistHistory(db, 'owner', { id: 'one', prompt: 'artist:alpha', created_at: 100 })));
  expect(await readArtistGenerationCounts(db, 'owner')).toEqual([{ name: 'alpha artist', images: 1, lastAt: 100 }]);
  env.ASSETS = { fetch: async () => { throw new Error('词库不可用'); } };
  insert('unindexed', 'artist:beta');
  await deactivateArtistHistory(db, 'owner', [{ id: 'one' }, { id: 'unindexed' }], env);
  expect(await readArtistHistorySnapshots(db, 'owner', 0, 200)).toEqual([]);
  expect((await readArtistGenerationCounts(db, 'owner'))[0].images).toBe(0);
});

it('重存不改首次归因，删除扣一次，删后同ID重新保存重新归因', async () => {
  const { db, sql, insert, env } = fixture(); insert('one');
  await ensureArtistHistoryIndex(db, 'owner', env);
  const changed = { id: 'one', prompt: 'artist:beta', created_at: 200 };
  await recordArtistHistory(db, 'owner', changed);
  expect((await readArtistGenerationCounts(db, 'owner'))[0].images).toBe(1);
  await deactivateArtistHistory(db, 'owner', [{ id: 'one' }], env);
  await deactivateArtistHistory(db, 'owner', [{ id: 'one' }], env);
  expect((await readArtistGenerationCounts(db, 'owner'))[0]).toMatchObject({ images: 0, lastAt: 0 });
  expect(await readArtistHistorySnapshots(db, 'owner', 0, 300)).toEqual([]);
  insert('one', 'artist:beta');
  await ensureArtistHistoryIndex(db, 'owner', env);
  expect(await readArtistGenerationCounts(db, 'owner')).toContainEqual({ name: 'beta', images: 1, lastAt: 100 });
  expect(sql.prepare('SELECT COUNT(*) AS count FROM local_generation_history').get()).toMatchObject({ count: 1 });
});
