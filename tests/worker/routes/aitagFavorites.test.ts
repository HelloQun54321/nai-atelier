import { afterEach, expect, it, vi } from 'vitest';
import { handleAitagRoute } from '../../../worker/routes/aitagRoutes';
import type { RouteContext } from '../../../worker/routes/types';

const database = (rows: any[]) => {
  const writes: { sql: string; values: unknown[] }[] = [];
  const db = { prepare(sql: string) {
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
  return { db, writes };
};
const invoke = async (db: unknown, path: string, favorite?: boolean) => {
  const url = new URL(`http://localhost${path}`);
  const method = favorite === undefined ? 'GET' : 'POST';
  const request = new Request(url, favorite === undefined ? {} : { method, body: JSON.stringify({ favorite }) });
  return (await handleAitagRoute({ db, url, path, method, request } as RouteContext))!;
};
afterEach(() => vi.unstubAllGlobals());

it('只读汇总不同榜单的同一收藏组，完整详情优先，旧记录回退到已缓存首图', async () => {
  const detail = { work: { id: 1 }, images: [0, 1].map(index => ({ id: index, work_id: 1, file_name: `1_p${index}`, local_image_url: `/api/assets/aitag/${index}.webp` })) };
  const { db, writes } = database([
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
