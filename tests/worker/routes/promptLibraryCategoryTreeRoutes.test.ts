import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handlePromptLibraryCategoryTreeRoute } from '../../../worker/routes/promptLibraryCategoryTreeRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,tags TEXT,params TEXT); INSERT INTO chains VALUES ('asset','[\"旧组合分类\"]','{\"unchanged\":true}')");
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...next) => prepare(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[], success: true, meta: {} }),
    run: async <T>() => ({ results: [] as T[], success: true, meta: sqlite.prepare(sql).run(...values) }),
    raw: async <T>() => [] as T[],
  });
  db = { prepare } as D1Database;
});
afterEach(() => sqlite.close());
const initial = () => ({ revision: 0, nodes: [{ id: '*', name: '*', parentId: null }, { id: '子分类', name: '子分类', parentId: '*' }] });
const invoke = async (method: string, body?: unknown, owner = 'owner', role = 'admin', raw?: string) => (await handlePromptLibraryCategoryTreeRoute({
  db, currentUser: { id: owner, role }, path: '/api/prompt-library-category-tree', method,
  request: new Request('http://localhost/api/prompt-library-category-tree', { method, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) }),
} as RouteContext))!;

it('首次GET返回空树且绝不写入，PUT仅保存层级不改组合标签或旧分类名单', async () => {
  sqlite.prepare('INSERT INTO settings VALUES (?,?)').run('prompt_library_tags_v1:owner', '["旧组合分类"]');
  const response = await invoke('GET');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ revision: 0, nodes: [] });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(2);
  const saved = await invoke('PUT', initial());
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ ...initial(), revision: 1 });
  expect(await (await invoke('GET')).json()).toEqual({ ...initial(), revision: 1 });
  expect(sqlite.prepare('SELECT tags,params FROM chains').get()).toMatchObject({ tags: '["旧组合分类"]', params: '{"unchanged":true}' });
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_tags_v1:owner')!.value).toBe('["旧组合分类"]');
  expect(sqlite.prepare("SELECT value FROM settings WHERE key='unrelated'").get()!.value).toBe('keep');
});

it('首次及后续并发保存只有一方成功，过期revision拒绝覆盖且空树可持久保存', async () => {
  expect((await Promise.all([invoke('PUT', initial()), invoke('PUT', { revision: 0, nodes: [] })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await Promise.all([invoke('PUT', { ...initial(), revision: 1 }), invoke('PUT', { revision: 1, nodes: [] })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await invoke('PUT', initial())).status).toBe(409);
  expect((await invoke('PUT', { revision: 2, nodes: [] })).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual({ revision: 3, nodes: [] });
});

it('兼容超过1000个旧分类及逗号换行身份，侧存读回且不改原标签和独立名单协议', async () => {
  const labels = [...Array.from({ length: 1001 }, (_, index) => `旧分类${index}`), '旧,标签', '旧\n标签'];
  const state = { revision: 0, nodes: labels.map(name => ({ id: name, name, parentId: name === '旧\n标签' ? '旧,标签' : null })) };
  expect(JSON.stringify(state).length).toBeLessThan(1_000_000);
  const saved = await invoke('PUT', state);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ ...state, revision: 1 });
  expect(await (await invoke('GET')).json()).toEqual({ ...state, revision: 1 });
  expect(sqlite.prepare('SELECT tags FROM chains').get()!.tags).toBe('["旧组合分类"]');
});

it('所有者按settings键隔离，guest只读，方法和非法树不产生写入', async () => {
  await invoke('PUT', initial());
  expect(await (await invoke('GET', undefined, 'another')).json()).toEqual({ revision: 0, nodes: [] });
  expect((await invoke('PUT', { revision: 0, nodes: [] }, 'another')).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual({ ...initial(), revision: 1 });
  expect((await invoke('PUT', initial(), 'guest', 'guest')).status).toBe(403);
  expect(await (await invoke('GET', undefined, 'guest', 'guest')).json()).toEqual({ revision: 0, nodes: [] });
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_category_tree_v1:guest')).toBeUndefined();
  expect((await invoke('POST', initial())).status).toBe(405);
  expect((await invoke('PUT', { revision: 1, nodes: [{ id: 'x', name: 'other', parentId: null }] })).status).toBe(400);
  expect((await invoke('PUT', undefined, 'owner', 'admin', '{broken')).status).toBe(400);
  expect((await invoke('PUT', undefined, 'owner', 'admin', ' '.repeat(1_000_001))).status).toBe(413);
  expect(await handlePromptLibraryCategoryTreeRoute({ path: '/api/other' } as RouteContext)).toBeNull();
});

it('损坏状态和数据库读取失败明确503，不能当空树覆盖原值', async () => {
  for (const value of ['broken', JSON.stringify({ revision: 1, nodes: [{ id: 'x', name: 'x', parentId: 'missing' }] })]) {
    sqlite.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('prompt_library_category_tree_v1:owner', value);
    expect((await invoke('GET')).status).toBe(503);
    expect((await invoke('PUT', initial())).status).toBe(503);
    expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_category_tree_v1:owner')!.value).toBe(value);
  }
  db = { prepare() { throw new Error('synthetic read failure'); } } as unknown as D1Database;
  expect((await invoke('GET')).status).toBe(503);
  expect((await invoke('PUT', initial())).status).toBe(503);
});
