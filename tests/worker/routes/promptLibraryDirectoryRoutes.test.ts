import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handlePromptLibraryDirectoryRoute } from '../../../worker/routes/promptLibraryDirectoryRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,base_prompt TEXT,params TEXT); INSERT INTO chains VALUES ('asset','keep prompt','{\"unchanged\":true}')");
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
const initial = () => ({ revision: 0, nodes: [{ id: 'root', parentId: null, name: '合成目录' }] });
const invoke = async (method: string, body?: unknown, owner = 'owner') => (await handlePromptLibraryDirectoryRoute({
  db, currentUser: { id: owner }, path: '/api/prompt-library/directories', method,
  request: new Request('http://localhost/api/prompt-library/directories', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
} as RouteContext))!;

it('首次读取返回默认树且不写入；保存空树不会恢复预设或更改任何片段', async () => {
  const result = await invoke('GET');
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect((await result.json() as ReturnType<typeof initial>).nodes.filter(node => node.parentId === null)).toHaveLength(8);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(1);
  expect((await invoke('PUT', { revision: 0, nodes: [] })).status).toBe(200);
  expect(await (await invoke('GET')).json()).toEqual({ revision: 1, nodes: [] });
  expect(sqlite.prepare('SELECT base_prompt,params FROM chains').get()).toMatchObject({ base_prompt: 'keep prompt', params: '{"unchanged":true}' });
  expect(sqlite.prepare("SELECT value FROM settings WHERE key='unrelated'").get()!.value).toBe('keep');
});

it('首次及后续并发保存均只允许一方提交，版本过期明确拒绝', async () => {
  expect((await Promise.all([invoke('PUT', initial()), invoke('PUT', { revision: 0, nodes: [] })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await Promise.all([invoke('PUT', { ...initial(), revision: 1 }), invoke('PUT', { revision: 1, nodes: [] })])).map(result => result.status).sort()).toEqual([200, 409]);
  expect((await invoke('PUT', initial())).status).toBe(409);
});

it('所有者隔离；损坏状态拒绝覆盖；非法树和方法不写入', async () => {
  expect((await invoke('PUT', { ...initial(), nodes: [{ id: 'root', parentId: 'missing', name: '无效' }] })).status).toBe(400);
  await invoke('PUT', initial());
  expect((await (await invoke('GET', undefined, 'another')).json() as ReturnType<typeof initial>).revision).toBe(0);
  sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run('broken', 'prompt_library_directories_v1:owner');
  expect((await invoke('GET')).status).toBe(503);
  expect((await invoke('PUT', initial())).status).toBe(503);
  expect(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('prompt_library_directories_v1:owner')!.value).toBe('broken');
  expect((await invoke('POST', initial())).status).toBe(405);
  expect(await handlePromptLibraryDirectoryRoute({ path: '/api/another' } as RouteContext)).toBeNull();
});
