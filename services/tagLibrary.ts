import { normalizeTagQuery, type ArtistDictionarySort } from './tagDictionary';

const normalizeArtistSearch = (value: string) => normalizeTagQuery(value).replace(/\s*\(/g, ' (');

/** 逗号分隔多个模糊搜索项；空格属于名字，不另行拆词。 */
export const parseArtistSearchTerms = (raw: string): string[] =>
  [...new Set(raw.split(/[,，]/).map(normalizeArtistSearch).filter(Boolean))];

export const matchesArtistSearch = (entry: { name: string; chinese?: string }, terms: readonly string[]): boolean => {
  if (!terms.length) return true;
  const name = normalizeArtistSearch(entry.name), chinese = normalizeArtistSearch(entry.chinese || '');
  return terms.some(term => name.includes(term) || chinese.includes(term));
};

/** 收藏快照和自定义条目也遵循目录排序，不依赖当前已加载的页。 */
export function compareLibraryTags(
  left: { name: string; tagName?: string; postCount?: number; postCountKnown?: boolean },
  right: { name: string; tagName?: string; postCount?: number; postCountKnown?: boolean },
  sort: ArtistDictionarySort,
) {
  const names = (left.tagName || left.name).localeCompare(right.tagName || right.name);
  if (sort === 'name-asc') return names;
  if (sort === 'name-desc') return -names;
  if (left.postCountKnown === false || right.postCountKnown === false)
    return Number(left.postCountKnown === false) - Number(right.postCountKnown === false) || names;
  const popularity = (left.postCount || 0) - (right.postCount || 0);
  return (sort === 'least' ? popularity : -popularity) || names;
}
