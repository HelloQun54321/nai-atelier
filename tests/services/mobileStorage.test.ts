import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../../mobile/storage';
import { handleChainFolderRoute } from '../../worker/routes/chainFolderRoutes';
import type { RouteContext } from '../../worker/routes/types';

const sql = vi.hoisted(() => vi.fn());
vi.mock('../../mobile/native', () => ({ native: { sql }, writeBlob: vi.fn(), fetchFile: vi.fn() }));
let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)');
  // 模拟原生桥：每条语句完成后在同连接立即读取 SQLite 的 changes()。
  const execute = ({ sql: query, values = [] }: { sql: string; values?: (string | number | null)[] }) => {
    const statement = sqlite.prepare(query);
    const results = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    return { results, success: true, meta: { changes: Number(sqlite.prepare('SELECT changes() AS count').get()!.count) } };
  };
  sql.mockImplementation(async request => request.statements
    ? { results: request.statements.map(execute) }
    : execute(request));
});
afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

const initial = () => ({ revision: 0, folders: [{ id: 'synthetic-folder', name: '合成目录', parentId: null }], assignments: {} });
const invoke = async (method: string, body?: unknown) => (await handleChainFolderRoute({
  db, currentUser: { id: 'synthetic-owner' }, path: '/api/chain-folders', method,
  request: new Request('http://localhost/api/chain-folders', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
} as RouteContext))!;

it('手机 run 透传真实受影响行数：首次目录保存成功，旧 revision 保持冲突', async () => {
  expect((await invoke('PUT', initial())).status).toBe(200);
  expect((await invoke('PUT', { ...initial(), folders: [] })).status).toBe(409);
  expect(await (await invoke('GET')).json()).toEqual({ ...initial(), revision: 1 });
  expect((await invoke('PUT', { ...initial(), revision: 1, assignments: { 'synthetic-chain': 'synthetic-folder' } })).status).toBe(200);
});

it('手机零行条件更新与忽略插入不冒充成功，batch 保留每条回执', async () => {
  const inserted = await db.prepare("INSERT OR IGNORE INTO settings VALUES ('synthetic','original')").run();
  expect(inserted.meta.changes).toBe(1);
  const ignored = await db.prepare("INSERT OR IGNORE INTO settings VALUES ('synthetic','replacement')").run();
  expect(ignored.meta.changes).toBe(0);
  const results = await db.batch([
    db.prepare("UPDATE settings SET value='updated' WHERE key='synthetic' AND value='original'"),
    db.prepare("UPDATE settings SET value='stale' WHERE key='synthetic' AND value='original'"),
  ]);
  expect(results.map(result => result.meta.changes)).toEqual([1, 0]);
  expect(await db.prepare("SELECT value FROM settings WHERE key='synthetic'").first('value')).toBe('updated');
});

it('手机桥缺失 changes 时不被补成成功回执', async () => {
  sql.mockResolvedValueOnce({ results: [], success: true, meta: {} });
  expect((await db.prepare('UPDATE settings SET value=? WHERE key=?').bind('new', 'missing').run()).meta.changes).toBeUndefined();
});
