import type { ArtistDictionarySort } from './tagDictionary';

/** 收藏快照和自定义条目也遵循目录排序，不依赖当前已加载的页。 */
export function compareLibraryTags(
  left: { name: string; tagName?: string; postCount?: number },
  right: { name: string; tagName?: string; postCount?: number },
  sort: ArtistDictionarySort,
) {
  const names = (left.tagName || left.name).localeCompare(right.tagName || right.name);
  if (sort === 'name-asc') return names;
  if (sort === 'name-desc') return -names;
  const popularity = (left.postCount || 0) - (right.postCount || 0);
  return (sort === 'least' ? popularity : -popularity) || names;
}
