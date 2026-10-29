import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { handlePromptLibraryDirectoryRoute } from '../../../worker/routes/promptLibraryDirectoryRoutes';
import type { D1Database, D1PreparedStatement, RouteContext } from '../../../worker/routes/types';

let sqlite: DatabaseSync;
let db: D1Database;
let beforeRun: ((sql: string) => void) | undefined;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  beforeRun = undefined;
  sqlite.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('unrelated','keep'); CREATE TABLE chains(id TEXT PRIMARY KEY,base_prompt TEXT,params TEXT); INSERT INTO chains VALUES ('asset','keep prompt','{\"unchanged\":true}')");
  sqlite.exec('ALTER TABLE chains ADD COLUMN user_id TEXT; ALTER TABLE chains ADD COLUMN type TEXT; ALTER TABLE chains ADD COLUMN updated_at INTEGER');
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...next) => prepare(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[], success: true, meta: {} }),
    run: async <T>() => { beforeRun?.(sql); return { results: [] as T[], success: true, meta: sqlite.prepare(sql).run(...values) }; },
    raw: async <T>() => [] as T[],
  });
  db = { prepare } as D1Database;
});

const membership = async (body: unknown, role = 'user') => (await handlePromptLibraryDirectoryRoute({
  db, currentUser: { id: 'owner', role }, path: '/api/prompt-library/directory-memberships', method: 'POST',
  request: new Request('http://localhost/api/prompt-library/directory-memberships', { method: 'POST', body: JSON.stringify(body) }),
} as RouteContext))!;
const insertFragment = (id: string, params: unknown = {}, owner = 'owner', type = 'appearance') => sqlite.prepare('INSERT INTO chains(id,user_id,type,base_prompt,params) VALUES (?,?,?,?,?)').run(id, owner, type, '原始正文', JSON.stringify(params));

it('原子增减旧默认与明确空归属，保留正文、来源、参数及其它归属', async () => {
  insertFragment('legacy', { source: { id: 'original' }, steps: 28 });
  insertFragment('empty', { _promptLibraryDirectoryIds: [], source: 'keep' });
  const later = Date.now() + 100_000;
  sqlite.prepare('UPDATE chains SET updated_at=? WHERE id=?').run(later, 'empty');
  expect((await membership({ itemIds: ['legacy', 'empty'], addDirectoryIds: ['person-pose'] })).status).toBe(200);
  const read = (id: string) => JSON.parse(sqlite.prepare('SELECT params FROM chains WHERE id=?').get(id)!.params as string);
  expect(read('legacy')).toEqual({ source: { id: 'original' }, steps: 28, _promptLibraryDirectoryIds: ['person-appearance', 'person-pose'] });
  expect(read('empty')._promptLibraryDirectoryIds).toEqual(['person-pose']);
  expect(sqlite.prepare('SELECT updated_at FROM chains WHERE id=?').get('empty')!.updated_at).toBe(later + 1);
  expect((await membership({ itemIds: ['legacy'], removeDirectoryIds: ['person-appearance'] })).status).toBe(200);
  expect(read('legacy')._promptLibraryDirectoryIds).toEqual(['person-pose']);
  expect((await membership({ itemIds: ['empty'], removeDirectoryIds: ['person-pose'] })).status).toBe(200);
  expect(read('empty')._promptLibraryDirectoryIds).toEqual([]);
  expect(sqlite.prepare('SELECT base_prompt,updated_at FROM chains WHERE id=?').get('legacy')).toMatchObject({ base_prompt: '原始正文', updated_at: expect.any(Number) });
});

it('并发手改参数或目录返回冲突，已完成项准确返回且不覆盖手改', async () => {
  insertFragment('saved'); insertFragment('race');
  beforeRun = sql => {
    if (!sql.startsWith('UPDATE chains')) return;
    const saved = sqlite.prepare('SELECT updated_at FROM chains WHERE id=?').get('saved');
    if (saved?.updated_at) sqlite.prepare('UPDATE chains SET params=? WHERE id=?').run('{"manual":true}', 'race');
  };
  const response = await membership({ itemIds: ['saved', 'race'], addDirectoryIds: ['person-pose'] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: false, completedIds: ['saved'], failedItems: [{ id: 'race', status: 409 }] });
  expect(sqlite.prepare('SELECT params FROM chains WHERE id=?').get('race')!.params).toBe('{"manual":true}');
  beforeRun = sql => { if (sql.startsWith('UPDATE chains')) sqlite.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('prompt_library_directories_v1:owner', JSON.stringify(initial())); };
  expect(await (await membership({ itemIds: ['saved'], addDirectoryIds: ['person-pose'] })).json()).toMatchObject({ ok: false, completedIds: [], failedItems: [{ id: 'saved', status: 409 }] });
});

it('拒绝无效目标、非片段、他人资产和访客，损坏参数不被重写', async () => {
  insertFragment('mine'); insertFragment('other', {}, 'another'); insertFragment('style', {}, 'owner', 'style');
  insertFragment('original', { _promptLibraryOriginal: true });
  expect((await membership({ itemIds: ['mine'], addDirectoryIds: ['favorites'] })).status).toBe(400);
  expect((await membership({ itemIds: ['mine'], addDirectoryIds: ['person-pose'], removeDirectoryIds: ['person-pose'] })).status).toBe(400);
  expect((await membership({ itemIds: ['mine'], addDirectoryIds: ['person-pose'] }, 'guest')).status).toBe(403);
  sqlite.prepare('UPDATE chains SET params=? WHERE id=?').run('broken', 'mine');
  const response = await membership({ itemIds: ['mine', 'other', 'style', 'original'], addDirectoryIds: ['person-pose'] });
  expect(await response.json()).toMatchObject({ ok: false, completedIds: [], failedItems: [{ id: 'mine', status: 503 }, { id: 'other', status: 404 }, { id: 'style', status: 400 }, { id: 'original', status: 400 }] });
  expect(sqlite.prepare('SELECT params FROM chains WHERE id=?').get('mine')!.params).toBe('broken');
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
