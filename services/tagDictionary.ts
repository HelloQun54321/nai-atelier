export type TagDictionaryEntry = [name: string, chinese: string, category: number, postCount: number, source: number];

interface TagDictionaryManifest {
  version: number;
  generatedAt: string;
  count: number;
  categoryCounts: Record<string, number>;
  categories: Record<string, string>;
  shards: Record<string, string>;
  chineseShards: Record<string, string>;
  popular: Record<string, TagDictionaryEntry[]>;
  popularArtists: TagDictionaryEntry[];
}

export interface TagSuggestion {
  name: string;
  chinese: string;
  category: number;
  categoryLabel: string;
  postCount: number;
  isNovelAI: boolean;
}

const CATEGORY_LABELS: Record<number, string> = {
  0: '普通',
  1: '画师',
  3: '作品',
  4: '角色',
  5: '元数据',
  6: 'NAI V4.5'
};

let manifestPromise: Promise<TagDictionaryManifest> | null = null;
const shardPromises = new Map<string, Promise<TagDictionaryEntry[]>>();
let cacheVersion = Date.now();

export const normalizeTagQuery = (value: string) => value
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const loadManifest = () => {
  if (!manifestPromise) {
    manifestPromise = fetch(`/tag-data/manifest.json?v=${cacheVersion}`, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`Tag dictionary manifest failed: ${response.status}`);
        return response.json() as Promise<TagDictionaryManifest>;
      })
      .catch(error => {
        manifestPromise = null;
        throw error;
      });
  }
  return manifestPromise;
};

const loadShard = async (manifest: TagDictionaryManifest, key: string, language: 'english' | 'chinese') => {
  const filename = language === 'chinese' ? manifest.chineseShards[key] : manifest.shards[key];
  if (!filename) return [];
  const cacheKey = `${language}:${key}`;
  const directory = language === 'chinese' ? 'zh-shards' : 'shards';
  if (!shardPromises.has(cacheKey)) {
    shardPromises.set(cacheKey, fetch(`/tag-data/${directory}/${filename}?v=${encodeURIComponent(manifest.generatedAt)}`)
      .then(response => {
        if (!response.ok) throw new Error(`Tag dictionary shard failed: ${response.status}`);
        return response.json() as Promise<TagDictionaryEntry[]>;
      })
      .catch(error => {
        shardPromises.delete(cacheKey);
        throw error;
      }));
  }
  return shardPromises.get(cacheKey)!;
};

const loadQueryEntries = async (manifest: TagDictionaryManifest, query: string) => {
  const isChineseQuery = /[\u3400-\u9fff]/.test(query[0]);
  const chineseFirstCharacter = Array.from(query)[0];
  const chineseShardKey = chineseFirstCharacter
    ? (chineseFirstCharacter.codePointAt(0)! % 256).toString(16).padStart(2, '0')
    : '';

  if (isChineseQuery) {
    return { entries: await loadShard(manifest, chineseShardKey, 'chinese'), isChineseQuery };
  }
  if (query.length === 1) {
    return { entries: manifest.popular[query[0]] || [], isChineseQuery };
  }
  return {
    entries: await loadShard(manifest, query.slice(0, 2).padEnd(2, ' '), 'english'),
    isChineseQuery
  };
};

export const searchTagDictionary = async (rawQuery: string, limit = 10): Promise<TagSuggestion[]> => {
  const query = normalizeTagQuery(rawQuery);
  if (!query) return [];

  const manifest = await loadManifest();
  const { entries, isChineseQuery } = await loadQueryEntries(manifest, query);

  return entries
    .filter(entry => (isChineseQuery ? entry[1] : entry[0]).toLowerCase().startsWith(query))
    .sort((a, b) => {
      const aSearchValue = isChineseQuery ? a[1] : a[0];
      const bSearchValue = isChineseQuery ? b[1] : b[0];
      const exactDifference = Number(bSearchValue.toLowerCase() === query) - Number(aSearchValue.toLowerCase() === query);
      return exactDifference || b[4] - a[4] || b[3] - a[3] || a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(entry => ({
      name: entry[0],
      chinese: entry[1],
      category: entry[2],
      categoryLabel: CATEGORY_LABELS[entry[2]] || 'Tag',
      postCount: entry[3],
      isNovelAI: entry[4] === 1
    }));
};

export interface ArtistDictionaryEntry {
  name: string;
  chinese: string;
  postCount: number;
}

const mapArtistEntry = (entry: TagDictionaryEntry): ArtistDictionaryEntry => ({
  name: entry[0],
  chinese: entry[1],
  postCount: entry[3]
});

export const getPopularArtistDictionary = async (limit = 500): Promise<ArtistDictionaryEntry[]> => {
  const manifest = await loadManifest();
  return (manifest.popularArtists || []).slice(0, limit).map(mapArtistEntry);
};

export const getArtistDictionaryCount = async () => {
  const manifest = await loadManifest();
  return manifest.categoryCounts?.artist || 0;
};

export const searchArtistDictionary = async (rawQuery: string, limit = 200): Promise<ArtistDictionaryEntry[]> => {
  const query = normalizeTagQuery(rawQuery);
  if (!query) return getPopularArtistDictionary(limit);

  const manifest = await loadManifest();
  const { entries: queryEntries, isChineseQuery } = await loadQueryEntries(manifest, query);
  const entries = !isChineseQuery && query.length === 1
    ? (manifest.popularArtists || [])
    : queryEntries;

  return entries
    .filter(entry => entry[2] === 1 && (isChineseQuery ? entry[1] : entry[0]).toLowerCase().startsWith(query))
    .sort((a, b) => b[3] - a[3] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(mapArtistEntry);
};

export const preloadTagDictionary = () => {
  void loadManifest().catch(error => console.warn('Tag autocomplete is unavailable:', error));
};

export const resetTagDictionaryCache = () => {
  cacheVersion = Date.now();
  manifestPromise = null;
  shardPromises.clear();
};
