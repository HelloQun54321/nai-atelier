import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleChainFolderRoute } from '../../../worker/routes/chainFolderRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
const initial = () => ({ revision: 0, folders: [{ id: 'f1', name: '画风实验', parentId: null }], assignments: { 'style-a': 'f1' } });
const invoke = async (method: string, body?: unknown, owner = 'owner') => (await handleChainFolderRoute({
  db, currentUser: { id: owner }, path: '/api/chain-folders', method,
  request: new Request('http://localhost/api/chain-folders', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
} as RouteContext))!;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('unrelated', 'keep'); CREATE TABLE chains (id TEXT PRIMARY KEY, base_prompt TEXT); INSERT INTO chains VALUES ('style-a', 'original prompt');");
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
describe('风格串文件夹持久化', () => {
  it('首次读取不写私人库；保存后其他客户端可以读取，原配方不变', async () => {
    expect(await (await invoke('GET')).json()).toEqual({ revision: 0, folders: [], assignments: {} });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM settings').get()?.count).toBe(1);
    expect((await invoke('PUT', initial())).status).toBe(200);
    const response = await invoke('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ...initial(), revision: 1 });
    expect(sqlite.prepare('SELECT base_prompt FROM chains').get()?.base_prompt).toBe('original prompt');
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'unrelated'").get()?.value).toBe('keep');
  });
  it('两个旧窗口不能相互覆盖，新版本可继续整理', async () => {
    await invoke('PUT', initial());
    expect((await invoke('PUT', { ...initial(), assignments: {} })).status).toBe(409);
    expect((await invoke('PUT', { ...initial(), revision: 1, assignments: {} })).status).toBe(200);
    expect((await (await invoke('GET')).json() as any).assignments).toEqual({});
  });
  it('同一初始版本并发创建只有一个写入成功', async () => {
    const responses = await Promise.all([invoke('PUT', initial()), invoke('PUT', { ...initial(), assignments: {} })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  });
  it('不同所有者隔离目录，非法层级不产生半份写入', async () => {
    await invoke('PUT', initial());
    expect((await (await invoke('GET', undefined, 'another')).json() as any).folders).toEqual([]);
    expect((await invoke('PUT', { ...initial(), revision: 1, folders: [{ id: 'f1', name: '循环', parentId: 'f1' }] })).status).toBe(400);
    expect((await (await invoke('GET')).json() as any).revision).toBe(1);
  });
  it('已有资料损坏时拒绝覆盖，不伪装成空目录', async () => {
    sqlite.prepare('INSERT INTO settings VALUES (?, ?)').run('chain_folders_v1:owner', 'broken');
    expect((await invoke('GET')).status).toBe(503);
    expect((await invoke('PUT', initial())).status).toBe(503);
  });
  it('拒绝其他方法，交给其他路由处理不同路径', async () => {
    expect((await invoke('POST', initial())).status).toBe(405);
    expect(await handleChainFolderRoute({ path: '/api/another' } as RouteContext)).toBeNull();
  });
});
