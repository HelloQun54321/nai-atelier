import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture(version: number | null = 10) {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite); sqlite.exec(INIT_SQL);
  sqlite.prepare('INSERT INTO chains(id,user_id,name,base_prompt,negative_prompt,params,updated_at) VALUES (?,?,?,?,?,?,?)').run('c', 'owner', '保留名称', 'original', 'negative', '{"seed":123}', version);
  let beforeWrite: (() => void) | undefined;
  const db = { prepare(query: string) {
    let values: any[] = [];
    return { bind(...next: any[]) { values = next; return this; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { results: sqlite.prepare(query).all(...values) }; },
      async run() {
        if (query.startsWith('UPDATE chains SET')) { const hook = beforeWrite; beforeWrite = undefined; hook?.(); }
        return { success: true, meta: sqlite.prepare(query).run(...values) };
      },
    };
  }, async batch(statements: { run(): Promise<unknown> }[]) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } } as unknown as D1Database;
  const invoke = (body: unknown, role = 'admin') => {
    const request = new Request('http://localhost/api/chains/c', { method: 'PUT', body: JSON.stringify(body) });
    return handleSettingsRoute({ path: '/api/chains/c', method: 'PUT', request, url: new URL(request.url), db, env: {}, currentUser: { id: 'owner', role }, initDB: async () => {} } as RouteContext);
  };
  return { sqlite, invoke, race: (hook: () => void) => { beforeWrite = hook; }, row: () => sqlite.prepare('SELECT * FROM chains WHERE id=?').get('c')! };
}

it('条件更新只修改指定正文，回传严格递增版本；同版本不能再次覆盖', async () => {
  const f = fixture(); vi.spyOn(Date, 'now').mockReturnValue(10);
  const response = await f.invoke({ basePrompt: 'restored', expectedUpdatedAt: 10 });
  expect(response?.status).toBe(200); expect(await response!.json()).toEqual({ success: true, updatedAt: 11 });
  expect(f.row()).toMatchObject({ name: '保留名称', base_prompt: 'restored', negative_prompt: 'negative', params: '{"seed":123}', updated_at: 11 });
  expect((await f.invoke({ basePrompt: 'stale', expectedUpdatedAt: 10 }))?.status).toBe(409);
  expect(f.row().base_prompt).toBe('restored');
});

it('读取后实际SQL前发生手改时CAS拒绝且不执行后续归属重算', async () => {
  const f = fixture();
  f.race(() => f.sqlite.prepare('UPDATE chains SET base_prompt=?,params=?,updated_at=11 WHERE id=?').run('manual', '{"seed":456}', 'c'));
  expect((await f.invoke({ basePrompt: 'restore', params: { seed: 123 }, expectedUpdatedAt: 10 }))?.status).toBe(409);
  expect(f.row()).toMatchObject({ base_prompt: 'manual', params: '{"seed":456}', updated_at: 11 });
  expect(f.sqlite.prepare("SELECT key FROM settings WHERE key LIKE 'artist_chain_snapshot_v1:%'").all()).toEqual([]);
});

it('旧空版本可条件写；省略条件的旧调用保持兼容', async () => {
  const f = fixture(null); vi.spyOn(Date, 'now').mockReturnValue(1);
  expect((await f.invoke({ negativePrompt: 'new', expectedUpdatedAt: null }))?.status).toBe(200);
  expect(f.row().updated_at).toBe(1);
  expect((await f.invoke({ description: 'legacy caller' }))?.status).toBe(200);
  expect(f.row()).toMatchObject({ description: 'legacy caller', updated_at: 2 });
});

it.each([-1, 1.1, '10', {}, Number.MAX_SAFE_INTEGER + 1])('非法条件%j不写入', async expectedUpdatedAt => {
  const f = fixture(); expect((await f.invoke({ basePrompt: 'bad', expectedUpdatedAt }))?.status).toBe(400);
  expect(f.row().base_prompt).toBe('original');
});

it('只读访客仍不能条件写', async () => {
  const f = fixture(); expect((await f.invoke({ basePrompt: 'bad', expectedUpdatedAt: 10 }, 'guest'))?.status).toBe(403);
  expect(f.row().base_prompt).toBe('original');
});
