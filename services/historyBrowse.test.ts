import { describe, expect, it } from 'vitest';
import { buildBrowserHistoryOrder, historyBrowseParams, shuffleHistoryIds } from './historyBrowse';
import type { LocalGenItem } from '../types';

const items = Array.from({ length: 65 }, (_, index) => ({
  id: `synthetic-${String(index).padStart(3, '0')}`, createdAt: 1000 + index,
  prompt: index % 2 ? 'blue sky' : 'red flower', negativePrompt: 'low quality',
  params: { model: index % 2 ? 'model-a' : 'model-b' },
  isFavorite: index % 3 === 0, favoriteAt: 5000 - index,
  sourceChainId: index % 2 ? 'preset' : undefined, sourceChainName: index % 2 ? '测试预设' : undefined,
  edit: index % 2 ? { operation: 'inpaint' } : undefined,
})) as LocalGenItem[];

describe('历史浏览索引', () => {
  it('洗牌覆盖所有 65 条且无重复，同一种子不受输入顺序/页边界影响', () => {
    const ids = items.map(item => item.id);
    const shuffled = shuffleHistoryIds(ids, 'session-a');
    expect(shuffled).toHaveLength(65);
    expect([...new Set(shuffled)].sort()).toEqual([...ids].sort());
    expect(shuffleHistoryIds([...ids].reverse(), 'session-a')).toEqual(shuffled);
    expect(shuffled.slice(0, 20).concat(shuffled.slice(20, 40), shuffled.slice(40))).toEqual(shuffled);
    expect(shuffleHistoryIds(ids, 'session-b')).not.toEqual(shuffled);
    expect(shuffleHistoryIds([], 'session-a')).toEqual([]);
  });
  it('生成时间/收藏时间各自排序，相同时间以 ID 稳定排序且不改原数组', () => {
    expect(buildBrowserHistoryOrder(items, {}).ids[0]).toBe('synthetic-064');
    expect(buildBrowserHistoryOrder(items, { sort: 'oldest' }).ids[0]).toBe('synthetic-000');
    expect(buildBrowserHistoryOrder(items, { sort: 'favorite', favoriteOnly: true }).ids[0]).toBe('synthetic-000');
    const equal = [{ ...items[1], createdAt: 1 }, { ...items[0], createdAt: 1 }];
    expect(buildBrowserHistoryOrder(equal, { sort: 'oldest' }).ids).toEqual(['synthetic-000', 'synthetic-001']);
    expect(items[0].id).toBe('synthetic-000');
  });
  it('随机只覆盖当前交集，关键词也可匹配负面词/来源名称', () => {
    const query = { from: 1010, to: 1040, model: 'model-a', operation: 'inpaint', source: 'preset', favoriteOnly: true, search: '测试预设', sort: 'random' as const, seed: 'a' };
    const result = buildBrowserHistoryOrder(items, query);
    expect(result.ids.sort()).toEqual(['synthetic-015', 'synthetic-021', 'synthetic-027', 'synthetic-033', 'synthetic-039']);
    expect(buildBrowserHistoryOrder(items, { search: 'LOW QUALITY' }).ids).toHaveLength(65);
    expect(buildBrowserHistoryOrder(items, { source: 'playground', operation: 'text-to-image' }).ids).toHaveLength(33);
    expect(result.models).toEqual(['model-a', 'model-b']);
  });
  it('查询参数只携带条件，不将会话 ID 索引发送到 GET URL', () => {
    const params = historyBrowseParams({ sort: 'random', seed: 'a & b', favoriteOnly: true, search: '100%_tag', from: 0 });
    expect(params.get('seed')).toBe('a & b'); expect(params.get('favorite')).toBe('1');
    expect(params.get('from')).toBe('0'); expect(params.get('search')).toBe('100%_tag');
  });
});
