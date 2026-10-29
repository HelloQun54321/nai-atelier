import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handlePromptLibraryCategoryTreeRoute } from '../../../worker/routes/promptLibraryCategoryTreeRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
let beforeRun: ((sql: string) => void) | undefined;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  beforeRun = undefined;
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,tags TEXT,params TEXT); INSERT INTO chains VALUES ('asset','[\"旧组合分类\"]','{\"unchanged\":true}')");
  sqlite.exec('ALTER TABLE chains ADD COLUMN user_id TEXT; ALTER TABLE chains ADD COLUMN updated_at INTEGER');
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
const initial = () => ({ revision: 0, nodes: [{ id: '*', name: '*', parentId: null }, { id: '子分类', name: '子分类', parentId: '*' }] });
const invoke = async (method: string, body?: unknown, owner = 'owner', role = 'admin', raw?: string) => (await handlePromptLibraryCategoryTreeRoute({
  db, currentUser: { id: owner, role }, path: '/api/prompt-library-category-tree', method,
  request: new Request('http://localhost/api/prompt-library-category-tree', { method, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) }),
} as RouteContext))!;
const action = async (body?: unknown, role = 'admin') => (await handlePromptLibraryCategoryTreeRoute({
  db, currentUser: { id: 'owner', role }, path: '/api/prompt-library-category-tree/actions', method: body ? 'POST' : 'GET',
  request: new Request('http://localhost/api/prompt-library-category-tree/actions', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) }),
} as RouteContext))!;
const insert = (id: string, tags: string[], combination = true, owner = 'owner') => sqlite.prepare('INSERT INTO chains(id,user_id,tags,params) VALUES (?,?,?,?)').run(id, owner, JSON.stringify(tags), JSON.stringify(combination ? { _rollContentSnapshot: { format: 'nai-roll-content', original: true }, keep: 28 } : { _promptLibraryOriginal: true }));

it('组合目录只读投影旧标签、名单和空侧树，不借用原文或他人同名标签', async () => {
  insert('combo', ['旧分类']); insert('original', ['原文专有'], false); insert('other', ['他人'], true, 'other');
  sqlite.prepare('INSERT INTO settings VALUES (?,?)').run('prompt_library_tags_v1:owner', '["空候选"]');
  await invoke('PUT', { revision: 0, nodes: [{ id: '空侧树', name: '空侧树', parentId: null }] });
  const response = await action();
  expect(await response.json()).toMatchObject({ tree: { nodes: [{ id: '空侧树' }, { id: '空候选' }, { id: '旧分类' }] } });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(3);
});

it('创建幂等、改名移动和删除提升子目录，只改组合同名归属并保留无关标签和参数', async () => {
  insert('combo', ['旧分类', '保留', '__internal__']); insert('original', ['旧分类'], false);
  const original = sqlite.prepare('SELECT params FROM chains WHERE id=?').get('combo')!.params;
  expect(await (await action({ action: 'create', name: '父目录' })).json()).toMatchObject({ ok: true });
  expect(await (await action({ action: 'create', name: '父目录' })).json()).toMatchObject({ ok: true });
  expect(await (await action({ action: 'update', id: '旧分类', name: '新分类', parentId: '父目录' })).json()).toMatchObject({ ok: true, completedIds: ['combo'] });
  expect(JSON.parse(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('combo')!.tags as string)).toEqual(['新分类', '保留', '__internal__']);
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('original')!.tags).toBe('["旧分类"]');
  expect(sqlite.prepare('SELECT params FROM chains WHERE id=?').get('combo')!.params).toBe(original);
  expect(await (await action({ action: 'delete', id: '父目录' })).json()).toMatchObject({ ok: true, tree: { nodes: expect.arrayContaining([{ id: '新分类', name: '新分类', parentId: null }]) } });
  expect(await (await action({ action: 'delete', id: '新分类' })).json()).toMatchObject({ ok: true, completedIds: ['combo'] });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM chains').get()!.n).toBe(3);
});

it('组合增减归属验证范围，逐项回执且并发手改不丢失', async () => {
  insert('combo', ['旧分类', '保留']); insert('race', ['旧分类']); insert('original', ['旧分类'], false); insert('other', ['旧分类'], true, 'other');
  await action({ action: 'create', name: '目标' });
  expect((await action({ action: 'memberships', itemIds: ['combo'], addDirectoryIds: ['未知'] })).status).toBe(400);
  expect((await action({ action: 'delete', id: '旧分类' }, 'guest')).status).toBe(403);
  beforeRun = sql => { if (sql.startsWith('UPDATE chains')) sqlite.prepare('UPDATE chains SET tags=? WHERE id=?').run('["手改"]', 'race'); };
  const response = await action({ action: 'memberships', itemIds: ['combo', 'race', 'original', 'other'], addDirectoryIds: ['目标'], removeDirectoryIds: ['旧分类'] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: false, completedIds: ['combo'], failedItems: expect.arrayContaining([{ id: 'race', status: 409, error: expect.any(String) }, { id: 'original', status: 400, error: expect.any(String) }, { id: 'other', status: 404, error: expect.any(String) }]) });
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('combo')!.tags).toBe('["保留","目标"]');
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('race')!.tags).toBe('["手改"]');
});

it('分类删除部分冲突不提交整树，重读重试保留已经成功的组合及后来的参数', async () => {
  insert('combo', ['旧分类']); insert('race', ['旧分类']);
  beforeRun = sql => { if (sql.startsWith('UPDATE chains')) sqlite.prepare('UPDATE chains SET params=? WHERE id=?').run('{"_rollContentSnapshot":{"format":"nai-roll-content"},"manual":true}', 'race'); };
  expect(await (await action({ action: 'delete', id: '旧分类' })).json()).toMatchObject({ ok: false, completedIds: ['combo'], failedItems: [{ id: 'race', status: 409 }] });
  beforeRun = undefined;
  expect(await (await action({ action: 'delete', id: '旧分类' })).json()).toMatchObject({ ok: true, completedIds: ['race'] });
  expect(JSON.parse(sqlite.prepare('SELECT params FROM chains WHERE id=?').get('race')!.params as string).manual).toBe(true);
});

it('落树前新增的旧归属阻止虚报整批完成；循环移动和候选并发不覆盖', async () => {
  insert('combo', ['旧分类']);
  beforeRun = sql => { if (sql.startsWith('INSERT OR IGNORE INTO settings(key,value) SELECT')) insert('late', ['旧分类']); };
  expect(await (await action({ action: 'update', id: '旧分类', name: '新分类' })).json()).toMatchObject({ ok: false, completedIds: ['combo'], failedItems: [{ id: '旧分类', status: 409 }] });
  beforeRun = undefined;
  expect(await (await action({ action: 'update', id: '旧分类', name: '新分类' })).status).toBe(400);
  expect(await (await action({ action: 'delete', id: '旧分类' })).json()).toMatchObject({ ok: true, completedIds: ['late'] });
  await action({ action: 'create', name: '子目录', parentId: '新分类' });
  expect((await action({ action: 'update', id: '新分类', parentId: '子目录' })).status).toBe(400);
  beforeRun = sql => { if (sql.startsWith('UPDATE settings SET value = ? WHERE key = ? AND value = ? AND (SELECT value')) sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run('["手改候选"]', 'prompt_library_tags_v1:owner'); };
  expect(await (await action({ action: 'create', name: '并发目录' })).json()).toMatchObject({ ok: false, failedItems: [{ id: '并发目录', status: 409 }] });
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_tags_v1:owner')!.value).toBe('["手改候选"]');
});

it('普通改名拒绝已有分类，整树和成员保持原样；关系更新时间严格递增', async () => {
  insert('combo', ['原分类', '目标分类']);
  await action({ action: 'create', name: '空分类' });
  const before = sqlite.prepare('SELECT key,value FROM settings ORDER BY key').all();
  const tags = sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('combo')!.tags;
  expect((await action({ action: 'update', id: '原分类', name: '目标分类' })).status).toBe(400);
  expect(sqlite.prepare('SELECT key,value FROM settings ORDER BY key').all()).toEqual(before);
  expect(sqlite.prepare('SELECT tags FROM chains WHERE id=?').get('combo')!.tags).toBe(tags);
  const later = Date.now() + 100_000;
  sqlite.prepare('UPDATE chains SET updated_at=? WHERE id=?').run(later, 'combo');
  expect(await (await action({ action: 'memberships', itemIds: ['combo'], addDirectoryIds: ['空分类'] })).json()).toMatchObject({ ok: true });
  expect(sqlite.prepare('SELECT updated_at FROM chains WHERE id=?').get('combo')!.updated_at).toBe(later + 1);
});

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
