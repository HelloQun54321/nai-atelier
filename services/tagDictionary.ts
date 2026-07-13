export type TagDictionaryEntry = [name: string, category: number, postCount: number, source: number];

interface TagDictionaryManifest {
  version: number;
  generatedAt: string;
  count: number;
  categories: Record<string, string>;
  shards: Record<string, string>;
  popular: Record<string, TagDictionaryEntry[]>;
}

export interface TagSuggestion {
  name: string;
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

export const normalizeTagQuery = (value: string) => value
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const loadManifest = () => {
  if (!manifestPromise) {
    manifestPromise = fetch('/tag-data/manifest.json')
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

const loadShard = async (manifest: TagDictionaryManifest, key: string) => {
  const filename = manifest.shards[key];
  if (!filename) return [];
  if (!shardPromises.has(key)) {
    shardPromises.set(key, fetch(`/tag-data/shards/${filename}`)
      .then(response => {
        if (!response.ok) throw new Error(`Tag dictionary shard failed: ${response.status}`);
        return response.json() as Promise<TagDictionaryEntry[]>;
      })
      .catch(error => {
        shardPromises.delete(key);
        throw error;
      }));
  }
  return shardPromises.get(key)!;
};

export const searchTagDictionary = async (rawQuery: string, limit = 10): Promise<TagSuggestion[]> => {
  const query = normalizeTagQuery(rawQuery);
  if (!query) return [];

  const manifest = await loadManifest();
  const entries = query.length === 1
    ? (manifest.popular[query[0]] || [])
    : await loadShard(manifest, query.slice(0, 2).padEnd(2, ' '));

  return entries
    .filter(entry => entry[0].startsWith(query))
    .sort((a, b) => {
      const exactDifference = Number(b[0] === query) - Number(a[0] === query);
      return exactDifference || b[3] - a[3] || b[2] - a[2] || a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(entry => ({
      name: entry[0],
      category: entry[1],
      categoryLabel: CATEGORY_LABELS[entry[1]] || 'Tag',
      postCount: entry[2],
      isNovelAI: entry[3] === 1
    }));
};

export const preloadTagDictionary = () => {
  void loadManifest().catch(error => console.warn('Tag autocomplete is unavailable:', error));
};
