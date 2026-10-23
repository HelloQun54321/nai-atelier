import { api } from './api';
import { normalizeRollArtistKey } from './styleRollSeed';
import type { ArtistDictionaryEntry, ArtistDictionarySort } from './tagDictionary';
import { compareLibraryTags } from './tagLibrary';

export interface ArtistUsage { chains: number; images: number; lastAt: number }
export interface ArtistUsageIndex { byTag: Map<string, ArtistUsage>; indexed: number; total: number }
export type ArtistUsageSort = 'usage-chains' | 'usage-chains-asc' | 'usage-images' | 'usage-images-asc';
export type ArtistBrowseSort = ArtistDictionarySort | ArtistUsageSort;
export type ArtistUsageFilter = 'all' | 'used' | 'unused';

export function isArtistUsageSort(sort: string): sort is ArtistUsageSort {
  return sort === 'usage-chains' || sort === 'usage-chains-asc' || sort === 'usage-images' || sort === 'usage-images-asc';
}

export function artistUsageCount(name: string, index: ArtistUsageIndex, metric: 'chains' | 'images'): number {
  return index.byTag.get(normalizeRollArtistKey(name))?.[metric] ?? 0;
}

export function compareArtistUsage(left: ArtistDictionaryEntry, right: ArtistDictionaryEntry, sort: ArtistBrowseSort, index: ArtistUsageIndex): number {
  if (!isArtistUsageSort(sort)) return compareLibraryTags(left, right, sort);
  const metric = sort.startsWith('usage-chains') ? 'chains' : 'images';
  const difference = artistUsageCount(left.name, index, metric) - artistUsageCount(right.name, index, metric);
  return (sort.endsWith('-asc') ? difference : -difference) || compareLibraryTags(left, right, 'popular');
}

export function matchesArtistUsage(name: string, index: ArtistUsageIndex, chains: ArtistUsageFilter, images: ArtistUsageFilter): boolean {
  return (chains === 'all' || (artistUsageCount(name, index, 'chains') > 0) === (chains === 'used')) &&
    (images === 'all' || (artistUsageCount(name, index, 'images') > 0) === (images === 'used'));
}

/** 只读取已由服务端增量维护的画师使用统计。 */
export async function getArtistUsage(signal?: AbortSignal): Promise<ArtistUsageIndex> {
  const value = await api.get('/artist-usage', { cache: 'no-store', signal }) as { artists?: unknown; indexed?: unknown; total?: unknown; complete?: unknown };
  if (!value || value.complete !== true || !Array.isArray(value.artists) ||
    !Number.isSafeInteger(value.indexed) || (value.indexed as number) < 0 ||
    !Number.isSafeInteger(value.total) || (value.total as number) < (value.indexed as number)) {
    throw new Error('画师使用统计数据无效');
  }
  const byTag = new Map<string, ArtistUsage>();
  for (const item of value.artists) {
    const artist = item as { name?: unknown; chains?: unknown; images?: unknown; lastAt?: unknown };
    if (typeof artist?.name !== 'string' || !artist.name.trim() ||
      !Number.isSafeInteger(artist.chains) || (artist.chains as number) < 0 ||
      !Number.isSafeInteger(artist.images) || (artist.images as number) < 0 ||
      typeof artist.lastAt !== 'number' || !Number.isFinite(artist.lastAt)) {
      throw new Error('画师使用统计数据无效');
    }
    const key = normalizeRollArtistKey(artist.name);
    if (byTag.has(key)) throw new Error('画师使用统计数据无效');
    byTag.set(key, { chains: artist.chains as number, images: artist.images as number, lastAt: artist.lastAt });
  }
  return { byTag, indexed: value.indexed as number, total: value.total as number };
}
