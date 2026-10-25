import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleHistoryRoute } from '../../../worker/routes/historyRoutes';
import type { RouteContext } from '../../../worker/routes/types';

it('组合分类使用独立目录，空分类可持久化且不修改其他资料，按用户隔离并拒绝非法写入', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('collection_tags_v1:owner', '[\"收藏分类\"]'); CREATE TABLE chains (id TEXT, tags TEXT); INSERT INTO chains VALUES ('synthetic', '[\"原标签\"]');");
  let fail = false;
  const db = { prepare(query: string) {
    let values: string[] = [];
    return {
      bind(...next: string[]) { values = next; return this; },
      async first() { if (fail) throw Error('synthetic read failure'); return sqlite.prepare(query).get(...values); },
      async run() { if (fail) throw Error('synthetic write failure'); return sqlite.prepare(query).run(...values); },
    };
  } };
  const invoke = async (method = 'GET', tags?: unknown, id = 'owner', role = 'user', raw?: string) => {
    const url = new URL('http://localhost/api/prompt-library-tags');
    const request = new Request(url, { method, ...(method === 'PUT' ? { body: raw ?? JSON.stringify({ tags }) } : {}) });
    return (await handleHistoryRoute({ request, url, path: url.pathname, method, db, currentUser: { id, role }, env: {} } as unknown as RouteContext))!;
  };
  try {
    expect(await (await invoke()).json()).toEqual({ tags: [] });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()?.n).toBe(1);
    expect(await (await invoke('PUT', [' 空分类 ', '空分类', '夜景'])).json()).toEqual({ tags: ['空分类', '夜景'] });
    expect(await (await invoke()).json()).toEqual({ tags: ['空分类', '夜景'] });
    expect(await (await invoke('GET', undefined, 'other')).json()).toEqual({ tags: [] });
    for (const tags of [null, {}, 'x', [9], [''], ['  '], ['a,b'], ['a，b'], ['a\nb'], ['a\rb'], ['__character_catalog__'], ['待实测'], ['Pixiv'], ['AITag'], ['x'.repeat(201)], Array(1001).fill('tag')]) {
      expect((await invoke('PUT', tags)).status).toBe(400);
    }
    expect((await invoke('PUT', [], 'owner', 'user', '{')).status).toBe(400);
    expect((await invoke('PUT', [], 'owner', 'guest')).status).toBe(403);
    expect((await invoke('POST')).status).toBe(405);
    expect(await (await invoke()).json()).toEqual({ tags: ['空分类', '夜景'] });
    expect(sqlite.prepare('SELECT tags FROM chains').get()?.tags).toBe('["原标签"]');
    expect(sqlite.prepare("SELECT value FROM settings WHERE key='collection_tags_v1:owner'").get()?.value).toBe('["收藏分类"]');
    sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run('invalid json', 'prompt_library_tags_v1:owner');
    expect((await invoke()).status).toBe(500);
    sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run('["AITag"]', 'prompt_library_tags_v1:owner');
    expect((await invoke()).status).toBe(500);
    fail = true;
    await expect(invoke()).rejects.toThrow('synthetic read failure');
    await expect(invoke('PUT', ['valid'])).rejects.toThrow('synthetic write failure');
  } finally { sqlite.close(); }
});
