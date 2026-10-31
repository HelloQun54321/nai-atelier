import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handlePromptLibraryCategoryTreeRoute } from '../../../worker/routes/promptLibraryCategoryTreeRoutes';
import { PROMPT_LIBRARY_CHARACTER_ROOT } from '../../../services/promptLibraryCategoryTree';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
let beforeRun: ((sql: string) => void) | undefined;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  beforeRun = undefined;
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,tags TEXT,params TEXT); INSERT INTO chains VALUES ('asset','[\"旧组合分类\"]','{\"unchanged\":true}')");
  sqlite.exec('ALTER TABLE chains ADD COLUMN user_id TEXT; ALTER TABLE chains ADD COLUMN updated_at INTEGER; ALTER TABLE chains ADD COLUMN type TEXT; ALTER TABLE chains ADD COLUMN name TEXT');
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...next) => prepare(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[], success: true, meta: {} }),
    run: async <T>() => { beforeRun?.(sql); return { results: [] as T[], success: true, meta: sqlite.prepare(sql).run(...values) }; },
    raw: async <T>() => [] as T[],
  });
  db = { prepare } as D1Database;
});
afterEach(() => sqlite.close());
const roleOnly = (revision = 0) => ({ revision, nodes: [{ id: PROMPT_LIBRARY_CHARACTER_ROOT, name: PROMPT_LIBRARY_CHARACTER_ROOT, parentId: null }] });
const invoke = async (method: string, body?: unknown, owner = 'owner', role = 'admin', raw?: string) => (await handlePromptLibraryCategoryTreeRoute({
  db, currentUser: { id: owner, role }, path: '/api/prompt-library-category-tree', method,
  request: new Request('http://localhost/api/prompt-library-category-tree', { method, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) }),
} as RouteContext))!;
const action = async (body?: unknown, role = 'admin') => (await handlePromptLibraryCategoryTreeRoute({
  db, currentUser: { id: 'owner', role }, path: '/api/prompt-library-category-tree/actions', method: body ? 'POST' : 'GET',
  request: new Request('http://localhost/api/prompt-library-category-tree/actions', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) }),
} as RouteContext))!;
const insert = (id: string, tags: string[], combination = true, owner = 'owner') => sqlite.prepare('INSERT INTO chains(id,user_id,tags,params,type,name) VALUES (?,?,?,?,?,?)').run(id, owner, JSON.stringify(tags), JSON.stringify(combination ? { _rollContentSnapshot: { format: 'nai-roll-content', original: true }, keep: 28 } : { _promptLibraryOriginal: true }), combination ? null : 'preset', id);
const insertCharacter = (id: string, name: string, owner = 'owner') => sqlite.prepare('INSERT INTO chains(id,user_id,tags,params,type,name) VALUES (?,?,?,?,?,?)').run(id, owner, '[]', '{}', 'character', name);

it('空树 GET 只读返回默认「角色」，不写入；PUT 归一为仅角色根', async () => {
  sqlite.prepare('INSERT INTO settings VALUES (?,?)').run('prompt_library_tags_v1:owner', '["旧组合分类"]');
  const response = await invoke('GET');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(roleOnly(0));
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(2);
  const saved = await invoke('PUT', { revision: 0, nodes: [{ id: '测试', name: '测试', parentId: null }, { id: '双人', name: '双人', parentId: null }] });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual(roleOnly(1));
  expect(await (await invoke('GET')).json()).toEqual(roleOnly(1));
  expect(sqlite.prepare('SELECT tags,params FROM chains').get()).toMatchObject({ tags: '["旧组合分类"]', params: '{"unchanged":true}' });
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_tags_v1:owner')!.value).toBe('["旧组合分类"]');
});

it('操作投影只含角色与自定义角色，拒绝自由新建／改名／删除', async () => {
  insert('combo', ['小铃']); insertCharacter('char-1', '小铃'); insert('original', ['原文专有'], false);
  insertCharacter('catalog', '词库', 'owner');
  sqlite.prepare('UPDATE chains SET tags=? WHERE id=?').run(JSON.stringify(['__character_catalog__']), 'catalog');
  const response = await action();
  expect(await response.json()).toMatchObject({
    tree: { nodes: [{ id: PROMPT_LIBRARY_CHARACTER_ROOT, parentId: null }, { id: '小铃', parentId: PROMPT_LIBRARY_CHARACTER_ROOT }] },
  });
  for (const body of [
    { action: 'create', name: '自由分类' },
    { action: 'update', id: PROMPT_LIBRARY_CHARACTER_ROOT, name: '改名' },
    { action: 'delete', id: PROMPT_LIBRARY_CHARACTER_ROOT },
  ]) {
    const denied = await action(body);
    expect(denied.status).toBe(400);
    expect(await denied.text()).toMatch(/自定义角色/);
  }
});

it('组合增减归属仍可用，只改组合标签；并发手改不丢失', async () => {
  insert('combo', ['旧分类', '保留']); insert('race', ['旧分类']); insert('original', ['旧分类'], false); insert('other', ['旧分类'], true, 'other');
  insertCharacter('char-1', '目标');
  expect((await action({ action: 'memberships', itemIds: ['combo'], addDirectoryIds: ['未知'] })).status).toBe(400);
  expect((await action({ action: 'delete', id: '旧分类' }, 'guest')).status).toBe(403);
  beforeRun = sql => { if (sql.startsWith('UPDATE chains')) sqlite.prepare('UPDATE chains SET tags=? WHERE id=?').run('["手改"]', 'race'); };
  const response = await action({ action: 'memberships', itemIds: ['combo', 'race', 'original', 'other'], addDirectoryIds: ['目标'], removeDirectoryIds: ['旧分类'] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ok: false,
    completedIds: ['combo'],
    failedItems: expect.arrayContaining([
      { id: 'race', status: 409, error: expect.any(String) },
      { id: 'original', status: 400, error: expect.any(String) },
      { id: 'other', status: 404, error: expect.any(String) },
    ]),
  });
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('combo')!.tags).toBe('["保留","目标"]');
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('race')!.tags).toBe('["手改"]');
});

it('归属更新时间严格递增', async () => {
  insert('combo', ['原分类']);
  insertCharacter('char-1', '空分类');
  const later = Date.now() + 100_000;
  sqlite.prepare('UPDATE chains SET updated_at=? WHERE id=?').run(later, 'combo');
  expect(await (await action({ action: 'memberships', itemIds: ['combo'], addDirectoryIds: ['空分类'] })).json()).toMatchObject({ ok: true });
  expect(sqlite.prepare('SELECT updated_at FROM chains WHERE id=?').get('combo')!.updated_at).toBe(later + 1);
});

it('首次及后续并发保存只有一方成功，过期 revision 拒绝覆盖', async () => {
  expect((await Promise.all([invoke('PUT', roleOnly(0)), invoke('PUT', { revision: 0, nodes: [] })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await Promise.all([invoke('PUT', roleOnly(1)), invoke('PUT', roleOnly(1))])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await invoke('PUT', roleOnly(0))).status).toBe(409);
  expect((await invoke('PUT', roleOnly(2))).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual(roleOnly(3));
});

it('所有者按 settings 键隔离，guest 只读，方法和非法树不产生写入', async () => {
  await invoke('PUT', roleOnly(0));
  expect(await (await invoke('GET', undefined, 'another')).json()).toEqual(roleOnly(0));
  expect((await invoke('PUT', roleOnly(0), 'another')).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual(roleOnly(1));
  expect((await invoke('PUT', roleOnly(0), 'guest', 'guest')).status).toBe(403);
  expect(await (await invoke('GET', undefined, 'guest', 'guest')).json()).toEqual(roleOnly(0));
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_category_tree_v1:guest')).toBeUndefined();
  expect((await invoke('POST', roleOnly(0))).status).toBe(405);
  expect((await invoke('PUT', { revision: 1, nodes: [{ id: 'x', name: 'other', parentId: null }] })).status).toBe(400);
  expect((await invoke('PUT', { revision: 1, nodes: [{ id: '多余', name: '多余', parentId: null }] })).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual(roleOnly(2));
  expect((await invoke('PUT', undefined, 'owner', 'admin', '{broken')).status).toBe(400);
  expect((await invoke('PUT', undefined, 'owner', 'admin', ' '.repeat(1_000_001))).status).toBe(413);
  expect(await handlePromptLibraryCategoryTreeRoute({ path: '/api/other' } as RouteContext)).toBeNull();
});

it('损坏状态和数据库读取失败明确 503，不能当空树覆盖原值', async () => {
  for (const value of ['broken', JSON.stringify({ revision: 1, nodes: [{ id: 'x', name: 'x', parentId: 'missing' }] })]) {
    sqlite.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('prompt_library_category_tree_v1:owner', value);
    expect((await invoke('GET')).status).toBe(503);
    expect((await invoke('PUT', roleOnly(0))).status).toBe(503);
    expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_category_tree_v1:owner')!.value).toBe(value);
  }
  db = { prepare() { throw new Error('synthetic read failure'); } } as unknown as D1Database;
  expect((await invoke('GET')).status).toBe(503);
  expect((await invoke('PUT', roleOnly(0))).status).toBe(503);
});
