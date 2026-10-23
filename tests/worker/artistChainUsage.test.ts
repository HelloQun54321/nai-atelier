import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureArtistChainUsage, readArtistChainCounts, syncArtistChainUsage } from '../../worker/routes/artistChainUsage';
import { handleSettingsRoute } from '../../worker/routes/settingsRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  const prepare = vi.fn((query: string) => {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; },
    };
  });
  const db = { prepare, async batch(statements: { run(): Promise<unknown> }[]) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } } as unknown as D1Database;
  const add = (id: string, prompt: string, type = 'style', user = 'owner') => sqlite.prepare('INSERT INTO chains (id, name, type, user_id, base_prompt, updated_at) VALUES (?, ?, ?, ?, ?, 1)').run(id, id, type, user, prompt);
  return { sqlite, db, prepare, add };
}

it('首次分批回填共享风格串，同串去重、多画师各计一次，非风格串排除且空集不再解析', async () => {
  const f = fixture();
  f.add('a', 'artist:alice, artist:alice, artist:bob');
  f.add('b', 'artist:alice', 'style', 'other-owner');
  f.add('character', 'artist:alice', 'character');
  f.add('empty', 'scenery');
  await ensureArtistChainUsage(f.db);
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 2, bob: 1 });
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'artist_chain_snapshot_v1:empty'").get()?.value).toContain('"artists":[]');
  f.prepare.mockClear();
  await ensureArtistChainUsage(f.db);
  expect(f.prepare.mock.calls.some(([sql]) => sql.includes('base_prompt'))).toBe(false);
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 2, bob: 1 });
});

it('改词、删除和变更类型按当前现存数量增减，支持未知前缀与词库裸名', async () => {
  const f = fixture(); f.add('a', 'artist:alice, known');
  const dictionary = new Set(['known']);
  await ensureArtistChainUsage(f.db, dictionary);
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 1, known: 1 });
  f.sqlite.prepare("UPDATE chains SET base_prompt = 'artist:bob', updated_at = 2 WHERE id = 'a'").run();
  await ensureArtistChainUsage(f.db, dictionary);
  expect(await readArtistChainCounts(f.db)).toEqual({ bob: 1 });
  f.sqlite.prepare("UPDATE chains SET type = 'character', updated_at = 3 WHERE id = 'a'").run();
  await ensureArtistChainUsage(f.db, dictionary);
  expect(await readArtistChainCounts(f.db)).toEqual({});
  f.sqlite.prepare("UPDATE chains SET type = 'style', updated_at = 4 WHERE id = 'a'").run();
  await ensureArtistChainUsage(f.db, dictionary);
  f.sqlite.prepare("DELETE FROM chains WHERE id = 'a'").run();
  await ensureArtistChainUsage(f.db, dictionary);
  expect(await readArtistChainCounts(f.db)).toEqual({});
  await ensureArtistChainUsage(f.db, dictionary);
});

it('大量旧串完整分批回填，其他设置原样保留', async () => {
  const f = fixture();
  for (let i = 0; i < 205; i++) f.add(String(i), 'artist:alice');
  f.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('private-setting', 'original')").run();
  await ensureArtistChainUsage(f.db);
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 205 });
  expect(f.sqlite.prepare("SELECT value FROM settings WHERE key = 'private-setting'").get()?.value).toBe('original');
});

it('旧快照CAS冲突重新读取源，迟到写入不能重复累计或覆盖最新内容', async () => {
  const f = fixture(); f.add('a', 'artist:alice');
  const originalBatch = f.db.batch.bind(f.db);
  let injected = false;
  f.db.batch = async statements => {
    if (!injected) {
      injected = true;
      f.sqlite.prepare("UPDATE chains SET base_prompt = 'artist:bob', updated_at = 2 WHERE id = 'a'").run();
      await syncArtistChainUsage(f.db, 'a');
    }
    return originalBatch(statements);
  };
  await syncArtistChainUsage(f.db, 'a');
  expect(await readArtistChainCounts(f.db)).toEqual({ bob: 1 });
  await syncArtistChainUsage(f.db, 'a');
  expect(await readArtistChainCounts(f.db)).toEqual({ bob: 1 });
});

it('计数事务失败整体回滚，后续ensure补齐遗漏', async () => {
  const f = fixture(); f.add('a', 'artist:alice, artist:bob');
  const originalBatch = f.db.batch.bind(f.db);
  f.db.batch = statements => originalBatch([...statements.slice(0, 1), f.db.prepare('UPDATE nonexistent SET value = 1'), ...statements.slice(1)]);
  await expect(syncArtistChainUsage(f.db, 'a')).rejects.toThrow();
  expect(await readArtistChainCounts(f.db)).toEqual({});
  expect(f.sqlite.prepare("SELECT key FROM settings WHERE key LIKE 'artist_chain_snapshot_v1:%'").all()).toHaveLength(0);
  f.db.batch = originalBatch;
  await ensureArtistChainUsage(f.db);
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 1, bob: 1 });
});

it('风格串写路由立即增减，连续同毫秒更新仍保留可补齐版本', async () => {
  const f = fixture();
  const invoke = (path: string, method: string, body?: unknown) => {
    const request = new Request('http://localhost' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return handleSettingsRoute({ path, method, request, url: new URL(request.url), db: f.db, env: {}, currentUser: { id: 'owner', username: 'owner', role: 'admin' }, initDB: async () => {} } as RouteContext);
  };
  const response = await invoke('/api/chains', 'POST', { name: 'a', basePrompt: 'artist:alice' });
  expect(response?.status).toBe(200);
  const { id } = await response!.json() as { id: string };
  expect(await readArtistChainCounts(f.db)).toEqual({ alice: 1 });
  const before = Number(f.sqlite.prepare('SELECT updated_at FROM chains WHERE id = ?').get(id)?.updated_at);
  const now = vi.spyOn(Date, 'now').mockReturnValue(before);
  try {
    expect((await invoke('/api/chains/' + id, 'PUT', { basePrompt: 'artist:bob' }))?.status).toBe(200);
    expect((await invoke('/api/chains/' + id, 'PUT', { description: 'updated' }))?.status).toBe(200);
  } finally { now.mockRestore(); }
  expect(await readArtistChainCounts(f.db)).toEqual({ bob: 1 });
  expect(Number(f.sqlite.prepare('SELECT updated_at FROM chains WHERE id = ?').get(id)?.updated_at)).toBe(before + 2);
  expect((await invoke('/api/chains/' + id, 'DELETE'))?.status).toBe(200);
  expect(await readArtistChainCounts(f.db)).toEqual({});
});
