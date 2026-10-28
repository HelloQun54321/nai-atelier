import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAitagRoute } from '../../../worker/routes/aitagRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from '../../../worker/routes/types';

const database = (rows: any[]) => {
  const writes: { sql: string; values: unknown[] }[] = [];
  const queries: string[] = [];
  const db = { prepare(sql: string) {
    queries.push(sql);
    let values: any[] = [];
    const query = {
      bind(...bound: any[]) { values = bound; return query; },
      async run() {
        if (/UPDATE aitag_works/.test(sql)) {
          writes.push({ sql, values });
          rows.filter(row => row.id === values[3]).forEach(row => { row.is_favorite = values[0]; });
        }
        return { success: true };
      },
      async all() {
        return { results: /WHERE w.is_favorite/.test(sql) ? rows.filter(row => row.is_favorite) : rows.filter(row => row.source_sort === values[0] && values.slice(1).includes(row.id)) };
      },
      async first() { return rows.find(row => row.id === values[0]) || null; },
    };
    return query;
  } };
  return { db, writes, queries };
};
const invoke = async (db: unknown, path: string, favorite?: boolean, userId = 'owner') => {
  const url = new URL(`http://localhost${path}`);
  const method = favorite === undefined ? 'GET' : 'POST';
  const request = new Request(url, favorite === undefined ? {} : { method, body: JSON.stringify({ favorite }) });
  return (await handleAitagRoute({ db, url, path: url.pathname, method, request, currentUser: { id: userId } } as RouteContext))!;
};
afterEach(() => vi.unstubAllGlobals());

it('只读汇总不同榜单的同一收藏组，完整详情优先，旧记录回退到已缓存首图', async () => {
  const detail = { work: { id: 1 }, images: [0, 1].map(index => ({ id: index, work_id: 1, file_name: `1_p${index}`, local_image_url: `/api/assets/aitag/${index}.webp` })) };
  const { db, writes, queries } = database([
    { id: 1, source_sort: 'new', is_favorite: 1, detail_json: JSON.stringify(detail) },
    { id: 1, source_sort: 'hot', is_favorite: 1, detail_json: JSON.stringify(detail) },
    { id: 2, source_sort: 'new', is_favorite: 1, detail_json: 'invalid', first_image_json: JSON.stringify({ file_name: '2_p3', local_image_url: '/api/assets/aitag/2.webp' }) },
    { id: 3, source_sort: 'new', is_favorite: 0 },
  ]);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const response = await invoke(db, '/api/aitag/favorites');
  const body = await response.json() as any[];
  expect(body).toHaveLength(2); expect(body[0].images).toHaveLength(2);
  expect(body[1].images[0].file_name).toBe('2_p3');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(writes).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  expect(queries).toHaveLength(1); expect(queries[0]).toMatch(/^SELECT/);
});

it('尚无 AITag 缓存表时返回空收藏，不触发建表；真实读取异常继续报错', async () => {
  const all = vi.fn().mockRejectedValueOnce(new Error('D1_ERROR: no such table: aitag_works: SQLITE_ERROR'))
    .mockRejectedValueOnce(new Error('D1_ERROR: no such table: aitag_work_details: SQLITE_ERROR'))
    .mockRejectedValueOnce(new Error('合成数据库读取失败'));
  const prepare = vi.fn(() => ({ all }));
  const db = { prepare };
  expect(await (await invoke(db, '/api/aitag/favorites')).json()).toEqual([]);
  expect(await (await invoke(db, '/api/aitag/favorites')).json()).toEqual([]);
  await expect(invoke(db, '/api/aitag/favorites')).rejects.toThrow('合成数据库读取失败');
  expect(prepare).toHaveBeenCalledTimes(3);
});

it('作品组收藏同步所有榜单副本，默认榜单不存在时也能从缓存返回同一作品', async () => {
  const rows = ['hot', 'day'].map(source_sort => ({ id: 8, source_sort, is_favorite: 0 }));
  const { db, writes } = database(rows);
  const response = await invoke(db, '/api/aitag/work/8/favorite', true);
  expect(response.status).toBe(200); expect(rows.every(row => row.is_favorite === 1)).toBe(true);
  expect(writes[0].sql).toMatch(/WHERE id = \?/); expect(writes[0].sql).not.toMatch(/AND source_sort/);
  expect(await response.json()).toMatchObject({ isFavorite: true, item: { id: 8, isFavorite: true } });
  expect((await invoke(db, '/api/aitag/work/999/favorite', true)).status).toBe(404);
});

it('真实SQL收藏筛选合并当前用户单页与旧整组标记，归档和其他用户隔离且分页总数一致', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(INIT_SQL);
    const db = { prepare(sql: string) { let values: any[] = []; return {
      bind(...bound: any[]) { values = bound; return this; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...values) }; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
    }; } } as unknown as D1Database;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await invoke(db, '/api/aitag/cache/search');
    const addWork = (id: number, favorite = 0, ai = 'nai', sort = 'new', title = 'kept work', prompt = 'blue sky') => sqlite.prepare(`
      INSERT INTO aitag_works (id, source_sort, source_page, source_index, title, ai_type, is_favorite, favorite_at, first_image_json, raw_json)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, '{}')
    `).run(id, sort, id, title, ai, favorite, favorite ? 10 : 0, JSON.stringify({ prompt_text: prompt }));
    addWork(1); addWork(2); addWork(3); addWork(4, 1); addWork(5); addWork(6, 0, 'sd'); addWork(7, 0, 'nai', 'monthly');
    addWork(8, 0, 'nai', 'new', 'other title'); addWork(9, 0, 'nai', 'new', 'kept work', 'red forest');
    const addFavorite = (id: string, workId: number, user = 'owner', archived = 0, source = 'aitag') => sqlite.prepare(`
      INSERT INTO inspirations (id, user_id, title, image_url, source_type, source_id, archived) VALUES (?, ?, 'saved page', '/synthetic/page.png', ?, ?, ?)
    `).run(id, user, source, String(workId), archived);
    addFavorite('active-page', 1); addFavorite('another-page', 1); addFavorite('archived', 2, 'owner', 1);
    addFavorite('other-user', 3, 'other'); addFavorite('wrong-source', 5, 'owner', 0, 'pixiv');
    for (const id of [6, 7, 8, 9]) addFavorite('excluded-' + id, id);
    const beforeChanges = sqlite.prepare('SELECT total_changes() AS changes').get()?.changes;
    const search = async (query: string, user = 'owner') => (await (await invoke(db, '/api/aitag/cache/search?cacheFilter=favorite&' + query, undefined, user)).json()) as { total: number; items: { id: number }[] };
    const first = await search('page_size=1&page=1&q=kept&prompt=sky');
    const second = await search('page_size=1&page=2&q=kept&prompt=sky');
    const third = await search('page_size=1&page=3&q=kept&prompt=sky');
    expect(first).toMatchObject({ total: 2, items: [{ id: 4 }] });
    expect(second).toMatchObject({ total: 2, items: [{ id: 1 }] });
    expect(third).toMatchObject({ total: 2, items: [] });
    const own = await search('page_size=60');
    expect(own.items.map(item => item.id)).toEqual([4, 1, 8, 9]);
    expect(own.total).toBe(4);
    const other = await search('page_size=60', 'other');
    expect(other.items.map(item => item.id)).toEqual([4, 3]);
    expect(other.total).toBe(2);
    expect(sqlite.prepare('SELECT is_favorite FROM aitag_works WHERE id = 1').get()?.is_favorite).toBe(0);
    expect(sqlite.prepare('SELECT total_changes() AS changes').get()?.changes).toBe(beforeChanges);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM inspirations WHERE source_id = ?').get('1')?.count).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  } finally { sqlite.close(); }
});
