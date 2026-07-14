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
  artistPageSize: number;
  artistPages: string[];
  artistNamePages: string[];
  popularCharacters: TagDictionaryEntry[];
  characterPageSize: number;
  characterPages: string[];
  characterNamePages: string[];
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

export interface ArtistDictionaryPage {
  entries: ArtistDictionaryEntry[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export type ArtistDictionarySort = 'popular' | 'least' | 'name-asc' | 'name-desc';

export const getArtistDictionaryPage = async (page: number, sort: ArtistDictionarySort = 'popular'): Promise<ArtistDictionaryPage> => {
  const manifest = await loadManifest();
  const normalizedPage = Math.max(0, Math.trunc(page));
  const isNameSort = sort === 'name-asc' || sort === 'name-desc';
  const isReverse = sort === 'least' || sort === 'name-desc';
  const pages = (isNameSort ? manifest.artistNamePages : manifest.artistPages) || [];
  const physicalPage = isReverse ? pages.length - 1 - normalizedPage : normalizedPage;
  const filename = pages?.[physicalPage];
  let entries: TagDictionaryEntry[] = [];

  if (filename) {
    const directory = isNameSort ? 'artist-name-pages' : 'artist-pages';
    const cacheKey = `${directory}:${physicalPage}`;
    if (!shardPromises.has(cacheKey)) {
      shardPromises.set(cacheKey, fetch(`/tag-data/${directory}/${filename}?v=${encodeURIComponent(manifest.generatedAt)}`)
        .then(response => {
          if (!response.ok) throw new Error(`Artist dictionary page failed: ${response.status}`);
          return response.json() as Promise<TagDictionaryEntry[]>;
        })
        .catch(error => {
          shardPromises.delete(cacheKey);
          throw error;
        }));
    }
    entries = await shardPromises.get(cacheKey)!;
    if (isReverse) entries = [...entries].reverse();
  }

  return {
    entries: entries.map(mapArtistEntry),
    page: normalizedPage,
    pageCount: pages?.length || 0,
    pageSize: manifest.artistPageSize || 500,
    total: manifest.categoryCounts?.artist || 0
  };
};

export const getArtistDictionaryEntriesAt = async (indices: number[]): Promise<ArtistDictionaryEntry[]> => {
  if (indices.length === 0) return [];

  const manifest = await loadManifest();
  const pageSize = manifest.artistPageSize || 500;
  const total = manifest.categoryCounts?.artist || 0;
  const validIndices = [...new Set(indices)]
    .map(index => Math.trunc(index))
    .filter(index => index >= 0 && index < total);
  const pageNumbers = [...new Set(validIndices.map(index => Math.floor(index / pageSize)))];
  const pages = new Map<number, ArtistDictionaryEntry[]>();

  await Promise.all(pageNumbers.map(async pageNumber => {
    const page = await getArtistDictionaryPage(pageNumber, 'popular');
    pages.set(pageNumber, page.entries);
  }));

  return validIndices.flatMap(index => {
    const pageNumber = Math.floor(index / pageSize);
    const entry = pages.get(pageNumber)?.[index % pageSize];
    return entry ? [entry] : [];
  });
};

export const searchArtistDictionary = async (rawQuery: string, limit = 200, sort: ArtistDictionarySort = 'popular'): Promise<ArtistDictionaryEntry[]> => {
  const query = normalizeTagQuery(rawQuery);
  if (!query) return getPopularArtistDictionary(limit);

  const manifest = await loadManifest();
  const { entries: queryEntries, isChineseQuery } = await loadQueryEntries(manifest, query);
  const entries = !isChineseQuery && query.length === 1
    ? (manifest.popularArtists || [])
    : queryEntries;

  const matchingEntries = entries
    .filter(entry => entry[2] === 1 && (isChineseQuery ? entry[1] : entry[0]).toLowerCase().startsWith(query));
  matchingEntries.sort((a, b) => {
    if (sort === 'least') return a[3] - b[3] || a[0].localeCompare(b[0]);
    if (sort === 'name-asc') return a[0].localeCompare(b[0]);
    if (sort === 'name-desc') return b[0].localeCompare(a[0]);
    return b[3] - a[3] || a[0].localeCompare(b[0]);
  });

  return matchingEntries
    .slice(0, limit)
    .map(mapArtistEntry);
};

export interface CharacterDictionaryEntry {
  name: string;
  chinese: string;
  postCount: number;
}

export type CharacterDictionarySort = ArtistDictionarySort;

export interface CharacterDictionaryPage {
  entries: CharacterDictionaryEntry[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

const mapCharacterEntry = (entry: TagDictionaryEntry): CharacterDictionaryEntry => ({
  name: entry[0],
  chinese: entry[1],
  postCount: entry[3]
});

export const getCharacterDictionaryPage = async (page: number, sort: CharacterDictionarySort = 'popular'): Promise<CharacterDictionaryPage> => {
  const manifest = await loadManifest();
  const normalizedPage = Math.max(0, Math.trunc(page));
  const isNameSort = sort === 'name-asc' || sort === 'name-desc';
  const isReverse = sort === 'least' || sort === 'name-desc';
  const pageFiles = (isNameSort ? manifest.characterNamePages : manifest.characterPages) || [];
  const physicalPage = isReverse ? pageFiles.length - 1 - normalizedPage : normalizedPage;
  const filename = pageFiles[physicalPage];
  let entries: TagDictionaryEntry[] = [];

  if (filename) {
    const directory = isNameSort ? 'character-name-pages' : 'character-pages';
    const cacheKey = `${directory}:${physicalPage}`;
    if (!shardPromises.has(cacheKey)) {
      shardPromises.set(cacheKey, fetch(`/tag-data/${directory}/${filename}?v=${encodeURIComponent(manifest.generatedAt)}`)
        .then(response => {
          if (!response.ok) throw new Error(`Character dictionary page failed: ${response.status}`);
          return response.json() as Promise<TagDictionaryEntry[]>;
        })
        .catch(error => {
          shardPromises.delete(cacheKey);
          throw error;
        }));
    }
    entries = await shardPromises.get(cacheKey)!;
    if (isReverse) entries = [...entries].reverse();
  }

  return {
    entries: entries.map(mapCharacterEntry),
    page: normalizedPage,
    pageCount: pageFiles.length,
    pageSize: manifest.characterPageSize || 500,
    total: manifest.categoryCounts?.character || 0
  };
};

export const getCharacterDictionaryEntriesAt = async (indices: number[]): Promise<CharacterDictionaryEntry[]> => {
  if (indices.length === 0) return [];
  const manifest = await loadManifest();
  const pageSize = manifest.characterPageSize || 500;
  const total = manifest.categoryCounts?.character || 0;
  const validIndices = [...new Set(indices.map(index => Math.trunc(index)).filter(index => index >= 0 && index < total))];
  const pageNumbers = [...new Set(validIndices.map(index => Math.floor(index / pageSize)))];
  const pages = new Map<number, CharacterDictionaryEntry[]>();

  await Promise.all(pageNumbers.map(async pageNumber => {
    const result = await getCharacterDictionaryPage(pageNumber, 'popular');
    pages.set(pageNumber, result.entries);
  }));

  return validIndices.flatMap(index => {
    const entry = pages.get(Math.floor(index / pageSize))?.[index % pageSize];
    return entry ? [entry] : [];
  });
};

export const searchCharacterDictionary = async (rawQuery: string, limit = 200, sort: CharacterDictionarySort = 'popular'): Promise<CharacterDictionaryEntry[]> => {
  const query = normalizeTagQuery(rawQuery);
  if (!query) return [];
  const manifest = await loadManifest();
  const { entries: queryEntries, isChineseQuery } = await loadQueryEntries(manifest, query);
  const entries = !isChineseQuery && query.length === 1
    ? (manifest.popularCharacters || [])
    : queryEntries;
  const matchingEntries = entries
    .filter(entry => entry[2] === 4 && (isChineseQuery ? entry[1] : entry[0]).toLowerCase().startsWith(query));

  matchingEntries.sort((a, b) => {
    if (sort === 'least') return a[3] - b[3] || a[0].localeCompare(b[0]);
    if (sort === 'name-asc') return a[0].localeCompare(b[0]);
    if (sort === 'name-desc') return b[0].localeCompare(a[0]);
    return b[3] - a[3] || a[0].localeCompare(b[0]);
  });

  return matchingEntries.slice(0, limit).map(mapCharacterEntry);
};

export const preloadTagDictionary = () => {
  void loadManifest().catch(error => console.warn('Tag autocomplete is unavailable:', error));
};

export const resetTagDictionaryCache = () => {
  cacheVersion = Date.now();
  manifestPromise = null;
  shardPromises.clear();
};
