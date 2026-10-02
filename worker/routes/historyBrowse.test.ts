import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleHistoryRoute } from './historyRoutes';
import { INIT_SQL, type D1Database, type RouteContext } from './types';
import { buildBrowserHistoryOrder } from '../../services/historyBrowse';
import type { LocalGenItem } from '../../types';

const sqlite = new DatabaseSync(':memory:');
const statements: string[] = [];
const bucket = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const db = { prepare(query: string) {
  statements.push(query); let values: unknown[] = [];
  return {
    bind(...next: unknown[]) { values = next; return this; },
    async first() { return sqlite.prepare(query).get(...values as (string | number)[]) || null; },
    async all() { return { results: sqlite.prepare(query).all(...values as (string | number)[]) }; },
    async run() { return { success: true, meta: { changes: sqlite.prepare(query).run(...values as (string | number)[]).changes } }; },
  };
} } as unknown as D1Database;
const invoke = async (query = '', body?: unknown) => {
  const path = body === undefined ? `/api/local-history/browse${query}` : '/api/local-history/browse-page';
  const request = new Request(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return (await handleHistoryRoute({ request, url: new URL(request.url), path: new URL(request.url).pathname, method: request.method, db, currentUser: { id: 'owner' }, env: { LOCAL_HISTORY_ENABLED: 'true', BUCKET: bucket } } as unknown as RouteContext))!;
};
const items = Array.from({ length: 65 }, (_, index) => ({
  id: `row-${String(index).padStart(3, '0')}`, createdAt: 1000 + Math.floor(index / 2),
  prompt: index % 2 ? '100%_tag' : 'normal prompt', negativePrompt: 'negative test',
  params: { model: index % 2 ? 'model-a' : 'model-b', ...(index % 2 ? { _local_edit: { operation: 'inpaint' } } : {}) },
  edit: index % 2 ? { operation: 'inpaint' } : undefined,
  isFavorite: index % 3 === 0, favoriteAt: 5000 - index,
  sourceChainId: index % 2 ? 'preset' : undefined, sourceChainName: index % 2 ? '合成来源' : undefined,
})) as LocalGenItem[];
beforeAll(async () => { sqlite.exec(INIT_SQL); await invoke(); });
beforeEach(() => {
  sqlite.exec('DELETE FROM local_generation_history');
  const insert = sqlite.prepare('INSERT INTO local_generation_history (id,user_id,image_key,prompt,negative_prompt,params,source_chain_id,source_chain_name,is_favorite,favorite_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const item of items) insert.run(item.id, 'owner', `synthetic/${item.id}`, item.prompt, item.negativePrompt || '', JSON.stringify(item.params), item.sourceChainId || null, item.sourceChainName || '', Number(item.isFavorite), item.favoriteAt || null, item.createdAt);
  insert.run('private-other', 'other-owner', 'other-key', 'private', '', '{}', null, '', 1, 9000, 9000);
  statements.length = 0; vi.clearAllMocks();
});
afterAll(() => sqlite.close());

it('外部图片反推结果沿用灵感持久化，按精确来源和所有者恢复，两类 Tag 与页码分离', async () => {
  const requestInspiration = async (suffix = '', body?: unknown) => {
    const request = new Request(`http://localhost/api/inspirations${suffix}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await handleHistoryRoute({ request, url: new URL(request.url), path: '/api/inspirations', method: request.method, db, currentUser: { id: 'owner', username: 'test', role: 'admin' }, env: { BUCKET: bucket } } as unknown as RouteContext))!;
  };
  sqlite.exec('DELETE FROM inspirations');
  const analysis = { externalSourceTags: ['原站标签'], externalSourcePage: 1, imageTagger: { result: { model: 'test', tags: [] }, prompt: 'blue hair', createdAt: 1 } };
  for (const [id, sourceType, sourceId] of [['p', 'pixiv', '100'], ['d', 'danbooru', '100'], ['other', 'pixiv', '101']]) {
    expect((await requestInspiration('', { id, sourceType, sourceId, imageUrl: '/api/assets/test', prompt: 'blue hair', analysis })).status).toBe(200);
  }
  sqlite.prepare('UPDATE inspirations SET user_id = ? WHERE id = ?').run('other-owner', 'other');
  for (const [sourceType, expected] of [['pixiv', 'p'], ['danbooru', 'd']]) {
    const found = await (await requestInspiration(`?sourceType=${sourceType}&sourceId=100`)).json();
    expect(found.map((item: { id: string }) => item.id)).toEqual([expected]);
    expect(found[0]).toMatchObject({ prompt: 'blue hair', analysis });
  }
  expect(await (await requestInspiration('?sourceType=pixiv&sourceId=101')).json()).toEqual([]);
  expect(await (await requestInspiration('?sourceType=pixiv&sourceId=100%27%20OR%201%3D1')).json()).toEqual([]);
  expect((await requestInspiration('?sourceType=unknown&sourceId=100')).status).toBe(400);
  expect((await requestInspiration('?sourceType=pixiv')).status).toBe(400);
  expect((await requestInspiration('?sourceType=&sourceId=')).status).toBe(400);
  expect(bucket.put).not.toHaveBeenCalled();
});

describe('历史浏览查询（隔离 SQLite，无真实资产）', () => {
  it.each(['newest', 'oldest', 'favorite', 'random'] as const)('%s 的完整索引与浏览器兼容读取一致且稳定', async sort => {
    const query = { sort, seed: 'stable', favoriteOnly: sort === 'favorite' };
    const suffix = `?sort=${sort}&seed=stable${query.favoriteOnly ? '&favorite=1' : ''}`;
    const first = await (await invoke(suffix)).json();
    expect(first.ids).toEqual(buildBrowserHistoryOrder(items, query).ids);
    expect(await (await invoke(suffix)).json()).toEqual(first);
    expect(first.ids).not.toContain('private-other');
    expect(statements.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true);
    expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled(); expect(bucket.delete).not.toHaveBeenCalled();
  });
  it('组合日期/模型/方式/来源/收藏，搜索通配符按字面匹配且排序不能注入 SQL', async () => {
    const result = await (await invoke('?from=1004&to=1014&model=model-a&operation=inpaint&source=preset&favorite=1&search=100%25_tag&sort=oldest')).json();
    expect(result.ids).toEqual(['row-009', 'row-015', 'row-021', 'row-027']);
    expect((await (await invoke('?search=合成来源')).json()).ids).toHaveLength(32);
    expect((await (await invoke('?search=negative%20test')).json()).ids).toHaveLength(65);
    expect((await (await invoke('?sort=created_at;DROP%20TABLE%20local_generation_history')).json()).ids).toHaveLength(65);
  });
  it('新图不会改变既有索引的按 ID 翻页，跨页没有重复，读取隔离其他用户', async () => {
    const { ids } = await (await invoke('?sort=random&seed=stable')).json() as { ids: string[] };
    sqlite.prepare('INSERT INTO local_generation_history (id,user_id,image_key,created_at) VALUES (?,?,?,?)').run('new', 'owner', 'new-key', 9999);
    const all = [];
    for (let page = 0; page < 4; page++) {
      const result = await (await invoke('', { ids: ids.slice(page * 20, page * 20 + 20) })).json();
      all.push(...result.items.map((item: { id: string }) => item.id));
    }
    expect(all).toEqual(ids); expect(new Set(all).size).toBe(65);
    expect((await (await invoke('', { ids: ['private-other', ids[2], ids[1], ids[2]] })).json()).items.map((item: { id: string }) => item.id)).toEqual([ids[2], ids[1]]);
  });
  it('非法 ID 批次被拒绝，已删除 ID 跳过，不读取原图', async () => {
    expect((await invoke('', { ids: [1] })).status).toBe(400);
    expect((await invoke('', { ids: Array(101).fill('row-000') })).status).toBe(400);
    const response = await (await invoke('', { ids: ['missing', 'row-001'] })).json();
    expect(response.items.map((item: { id: string }) => item.id)).toEqual(['row-001']);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
