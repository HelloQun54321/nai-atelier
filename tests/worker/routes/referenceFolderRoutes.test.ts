import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleReferenceFolderRoute } from '../../../worker/routes/referenceFolderRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
const initial = () => ({ revision: 0, folders: [{ id: 'f1', name: '角色', parentId: null }], assignments: { 'ref-a': ['f1'] } });
const invoke = async (method: string, body?: unknown, path = '/api/reference-folders/character-reference', owner = 'owner') => (await handleReferenceFolderRoute({
  db, currentUser: { id: owner }, path, method,
  request: new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
} as RouteContext))!;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('unrelated', 'keep');");
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

describe('参考资料库目录持久化', () => {
  it('两类资料库分别存储，互不覆盖', async () => {
    expect((await invoke('PUT', initial())).status).toBe(200);
    const vibe = { revision: 0, folders: [{ id: 'v1', name: '画风', parentId: null }], assignments: { 'vibe-a': ['v1'] } };
    expect((await invoke('PUT', vibe, '/api/reference-folders/vibe')).status).toBe(200);
    expect((await (await invoke('GET')).json()).assignments).toEqual({ 'ref-a': ['f1'] });
    expect((await (await invoke('GET', undefined, '/api/reference-folders/vibe')).json()).assignments).toEqual({ 'vibe-a': ['v1'] });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'reference_folders_v1:%'").get()?.count).toBe(2);
  });

  it('首次读取不写私人库，未改动其它设置', async () => {
    expect(await (await invoke('GET')).json()).toEqual({ revision: 0, folders: [], assignments: {} });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM settings').get()?.count).toBe(1);
  });

  it('版本不一致时拒绝覆盖，保存成功后版本递增', async () => {
    const first = await (await invoke('PUT', initial())).json();
    expect(first.revision).toBe(1);
    expect((await invoke('PUT', initial())).status).toBe(409);
    expect((await invoke('PUT', { ...initial(), revision: 1 })).status).toBe(200);
  });

  it('拒绝未知资料库、非法数据与未登录用户', async () => {
    expect((await invoke('GET', undefined, '/api/reference-folders/unknown')).status).toBe(400);
    expect((await invoke('PUT', { revision: 0, folders: [{ id: 'a', name: 'A', parentId: 'a' }], assignments: {} })).status).toBe(400);
    expect((await handleReferenceFolderRoute({
      db, currentUser: null, path: '/api/reference-folders/vibe', method: 'GET',
      request: new Request('http://localhost/api/reference-folders/vibe'),
    } as RouteContext))!.status).toBe(403);
    expect(await handleReferenceFolderRoute({ db, currentUser: { id: 'owner' }, path: '/api/chain-folders', method: 'GET' } as RouteContext)).toBeNull();
  });

  it('损坏的已存数据不覆盖，返回可恢复错误', async () => {
    sqlite.prepare('INSERT INTO settings VALUES (?, ?)').run('reference_folders_v1:owner:character-reference', '{not-json');
    const response = await invoke('GET');
    expect(response.status).toBe(503);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'reference_folders_v1:owner:character-reference'").get()?.value).toBe('{not-json');
  });
});
