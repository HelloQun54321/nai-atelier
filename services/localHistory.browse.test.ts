import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('BroadcastChannel', undefined); });
import { localHistory } from './localHistory';
import { api } from './api';
afterEach(() => vi.restoreAllMocks());

describe('历史索引按页读取契约', () => {
  it('只读索引传递组合条件与种子，不请求原图', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async endpoint => endpoint.endsWith('/status')
      ? { enabled: true } : { ids: ['b', 'a'], models: ['model-a'], sources: [] });
    const order = await localHistory.getBrowseOrder({ sort: 'random', seed: 'stable', model: 'model-a', favoriteOnly: true, search: 'a & b' });
    expect(order.ids).toEqual(['b', 'a']);
    const url = new URL(get.mock.calls.at(-1)![0], 'http://synthetic');
    expect(url.pathname).toBe('/local-history/browse');
    expect(url.searchParams.get('seed')).toBe('stable'); expect(url.searchParams.get('search')).toBe('a & b');
    expect(url.searchParams.get('favorite')).toBe('1'); expect(url.searchParams.get('model')).toBe('model-a');
    expect(get.mock.calls.some(([endpoint]) => endpoint.endsWith('/image'))).toBe(false);
  });
  it('按 ID 固定分页，即使返回顺序不同/某张被删除也不换入其他图片', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ enabled: true });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ items: [{ id: 'd' }, { id: 'c' }] });
    const query = { orderIds: ['a', 'b', 'c', 'd', 'deleted'] };
    expect(await localHistory.getPage(1, 3, query, true)).toEqual({ items: [{ id: 'd' }], count: 5 });
    expect(post).toHaveBeenLastCalledWith('/local-history/browse-page', { ids: ['d', 'deleted'] });
    post.mockResolvedValueOnce({ items: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] });
    expect(await localHistory.getPage(0, 3, query, false)).toEqual({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(query.orderIds).toEqual(['a', 'b', 'c', 'd', 'deleted']);
    const calls = post.mock.calls.length;
    expect(await localHistory.getPage(3, 3, query)).toEqual({ items: [], count: 5 });
    expect(post.mock.calls.length).toBe(calls);
  });
});
