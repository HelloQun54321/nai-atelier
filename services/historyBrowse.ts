import type { LocalGenItem } from '../types';

export type HistorySort = 'newest' | 'oldest' | 'favorite' | 'random';
export interface HistoryBrowseQuery {
  from?: number;
  to?: number;
  favoriteOnly?: boolean;
  sort?: HistorySort;
  seed?: string;
  search?: string;
  model?: string;
  operation?: string;
  source?: string;
}
export interface HistoryBrowseOrder {
  ids: string[];
  models: string[];
  sources: { id: string; name: string }[];
}
export const HISTORY_SORT_LABELS: Record<HistorySort, string> = {
  newest: '最新优先', oldest: '最早优先', favorite: '最近收藏', random: '随机浏览',
};

/** 固定种子的洗牌：输入先按 ID 排序，数据库返回顺序不影响结果。只处理索引，不读取原图。 */
export const shuffleHistoryIds = (ids: string[], seed: string): string[] => {
  const result = [...ids].sort();
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

/** 浏览器旧数据读取遵循与本地服务相同的查找语义，不重新建立权威存储。 */
export const buildBrowserHistoryOrder = (items: LocalGenItem[], query: HistoryBrowseQuery): HistoryBrowseOrder => {
  const needle = query.search?.trim().toLocaleLowerCase();
  const filtered = items.filter(item =>
    (!query.from || item.createdAt >= query.from) && (!query.to || item.createdAt <= query.to)
    && (!query.favoriteOnly || item.isFavorite)
    && (!query.model || item.params?.model === query.model)
    && (!query.source || (item.sourceChainId || 'playground') === query.source)
    && (!query.operation || (item.edit?.operation || 'text-to-image') === query.operation)
    && (!needle || [item.prompt, item.negativePrompt, item.sourceChainName].some(text => text?.toLocaleLowerCase().includes(needle))),
  );
  const sort = query.sort === 'favorite' && !query.favoriteOnly ? 'newest' : query.sort || 'newest';
  filtered.sort((a, b) => {
    const time = sort === 'favorite' ? (b.favoriteAt ?? b.createdAt) - (a.favoriteAt ?? a.createdAt)
      : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    const idOrder = a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
    return time || (sort === 'favorite' ? b.createdAt - a.createdAt : 0) || (sort === 'oldest' ? idOrder : -idOrder);
  });
  const ids = filtered.map(item => item.id);
  const sources = new Map<string, string>();
  items.forEach(item => sources.set(item.sourceChainId || 'playground', item.sourceChainName || '自由实验室'));
  return {
    ids: sort === 'random' ? shuffleHistoryIds(ids, query.seed || '') : ids,
    models: [...new Set(items.map(item => item.params?.model).filter((model): model is string => Boolean(model)))].sort(),
    sources: Array.from(sources, ([id, name]) => ({ id, name })),
  };
};

export const historyBrowseParams = (query: HistoryBrowseQuery): URLSearchParams => {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'sort', 'seed', 'search', 'model', 'operation', 'source'] as const) {
    const value = query[key];
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  if (query.favoriteOnly) params.set('favorite', '1');
  return params;
};
