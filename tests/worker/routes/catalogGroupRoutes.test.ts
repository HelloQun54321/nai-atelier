import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handleCatalogGroupRoute } from '../../../worker/routes/catalogGroupRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,base_prompt TEXT); INSERT INTO chains VALUES ('asset','keep prompt')");
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
const initial = () => ({ revision: 0, groups: [{ id: 'g1', name: '合成分组' }], memberships: { 'artist:画师': ['g1'] } });
const invoke = async (method: string, body?: unknown, kind = 'artist', owner = 'owner') => (await handleCatalogGroupRoute({
  db, currentUser: { id: owner }, path: `/api/catalog-groups/${kind}`, method,
  request: new Request(`http://localhost/api/catalog-groups/${kind}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
} as RouteContext))!;
it('首次读取无写入，保存真实归属且不改资产或其他设置', async () => {
  const empty = await invoke('GET');
  expect(empty.headers.get('Cache-Control')).toBe('no-store');
  expect(await empty.json()).toEqual({ revision: 0, groups: [], memberships: {} });
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(1);
  expect((await invoke('PUT', initial())).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual({ ...initial(), revision: 1 });
  expect(sqlite.prepare('SELECT base_prompt FROM chains').get()!.base_prompt).toBe('keep prompt');
  expect(sqlite.prepare("SELECT value FROM settings WHERE key='unrelated'").get()!.value).toBe('keep');
});
it('首次并发与已有行并发都只允许一方原子提交', async () => {
  expect((await Promise.all([invoke('PUT', initial()), invoke('PUT', { ...initial(), memberships: {} })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await Promise.all([invoke('PUT', { ...initial(), revision: 1 }), invoke('PUT', { ...initial(), revision: 1, memberships: {} })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await invoke('PUT', initial())).status).toBe(409);
});
it('用户和类型隔离，并拒绝跨域对象身份', async () => {
  await invoke('PUT', initial());
  expect((await (await invoke('GET', undefined, 'artist', 'other')).json() as { revision: number }).revision).toBe(0);
  expect((await (await invoke('GET', undefined, 'character')).json() as { revision: number }).revision).toBe(0);
  expect((await invoke('PUT', initial(), 'character')).status).toBe(400);
  expect((await invoke('PUT', { ...initial(), memberships: { 'catalog:角色': ['g1'], 'custom:角色': ['g1'] } }, 'character')).status).toBe(200);
});
it('损坏既有状态拒绝读写，非法输入不半写', async () => {
  expect((await invoke('PUT', { ...initial(), memberships: { 'artist:画师': ['missing'] } })).status).toBe(400);
  sqlite.prepare('INSERT INTO settings VALUES (?,?)').run('catalog_groups_v1:artist:owner', 'broken');
  expect((await invoke('GET')).status).toBe(503);
  expect((await invoke('PUT', initial())).status).toBe(503);
  expect(sqlite.prepare("SELECT value FROM settings WHERE key='catalog_groups_v1:artist:owner'").get()!.value).toBe('broken');
});
it('未知类型、方法拒绝，其他路径留给其他路由', async () => {
  expect((await invoke('GET', undefined, 'unknown')).status).toBe(400);
  expect((await invoke('POST', initial())).status).toBe(405);
  expect(await handleCatalogGroupRoute({ path: '/api/another' } as RouteContext)).toBeNull();
});
