import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import type { RouteContext } from '../../../worker/routes/types';

it('未使用标签保存在既有设置表，读取不写入，重读恢复并隔离所有者，拒绝访客与无效输入', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('private_setting', 'keep');");
  try {
    const db = { prepare(query: string) {
      let values: string[] = [];
      return {
        bind(...next: string[]) { values = next; return this; },
        async first() { return sqlite.prepare(query).get(...values); },
        async run() { return sqlite.prepare(query).run(...values); },
      };
    } };
    const invoke = async (method: string, tags?: unknown, id = 'owner', role = 'user') => {
      const url = new URL('http://localhost/api/collection-tags');
      const request = new Request(url, { method, ...(method === 'PUT' ? { body: JSON.stringify({ tags }) } : {}) });
      return (await handleHistoryRoute({ request, url, path: url.pathname, method, db, currentUser: { id, role }, env: {} } as unknown as RouteContext))!;
    };
    expect(await (await invoke('GET')).json()).toEqual({ tags: [] });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM settings').get()?.count).toBe(1);
    expect(await (await invoke('PUT', [' #构图 ', '构图', '', '光影'])).json()).toEqual({ tags: ['构图', '光影'] });
    expect(await (await invoke('GET')).json()).toEqual({ tags: ['构图', '光影'] });
    expect(await (await invoke('GET', undefined, 'other')).json()).toEqual({ tags: [] });
    for (const bad of [null, 'wrong', [9], ['x'.repeat(201)], Array(1001).fill('tag')]) expect((await invoke('PUT', bad)).status).toBe(400);
    expect((await invoke('PUT', ['覆盖'], 'owner', 'guest')).status).toBe(403);
    expect((await invoke('POST')).status).toBe(405);
    expect(await (await invoke('GET')).json()).toEqual({ tags: ['构图', '光影'] });
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'private_setting'").get()?.value).toBe('keep');
    expect(await (await invoke('PUT', Array.from({ length: 100 }, (_, index) => 'tag-' + index))).json()).toHaveProperty('tags.length', 100);
    sqlite.prepare('UPDATE settings SET value = ? WHERE key = ?').run('broken', 'collection_tags_v1:owner');
    expect(await (await invoke('GET')).json()).toEqual({ tags: [] });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: 'settings' }]);
  } finally { sqlite.close(); }
});
