import { api } from './api';
import { normalizeTagQuery, searchTagDictionary } from './tagDictionary';

export type DanbooruTagCategory = 'general' | 'artist' | 'copyright' | 'character' | 'meta';

export interface DanbooruPost {
  id: number;
  rating: 'g';
  score: number;
  favCount: number;
  width: number;
  height: number;
  fileExt: string;
  previewUrl: string;
  sampleUrl: string;
  sourceUrl: string;
  postUrl: string;
  tags: Record<DanbooruTagCategory, string[]>;
}

export interface DanbooruSearchResult {
  items: DanbooruPost[];
  page: number;
  limit: number;
  query: string;
  hasMore: boolean;
}

const COVER_CACHE_KEY = 'nai_danbooru_cover_cache_v3';
const COVER_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const COVER_CACHE_LIMIT = 600;
const COVER_REQUEST_INTERVAL_MS = 300;
type StoredCover = { post: DanbooruPost | null; updatedAt: number };
let coverCache: Record<string, StoredCover> | null = null;
const coverRequests = new Map<string, Promise<DanbooruPost | null>>();
let coverRequestQueue: Promise<void> = Promise.resolve();
let nextCoverRequestAt = 0;

const scheduleCoverRequest = <T>(request: () => Promise<T>): Promise<T> => {
  const start = coverRequestQueue.then(async () => {
    const delay = Math.max(0, nextCoverRequestAt - Date.now());
    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
    nextCoverRequestAt = Date.now() + COVER_REQUEST_INTERVAL_MS;
  });
  coverRequestQueue = start.catch(() => undefined);
  return start.then(request);
};

const readCoverCache = () => {
  if (coverCache) return coverCache;
  try {
    coverCache = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || '{}');
  } catch {
    coverCache = {};
  }
  return coverCache!;
};

const persistCoverCache = () => {
  const cache = readCoverCache();
  const entries = Object.entries(cache)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, COVER_CACHE_LIMIT);
  coverCache = Object.fromEntries(entries);
  try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(coverCache)); } catch { /* Optional cache. */ }
};

const normalizeSingleTag = async (rawValue: string) => {
  const value = rawValue.trim();
  if (!value) return '';
  if (/^[a-z_][a-z0-9_:.()'!+\-/]*$/i.test(value)) return value.toLowerCase().replaceAll(' ', '_');

  const normalized = normalizeTagQuery(value);
  const matches = await searchTagDictionary(value, 12).catch(() => []);
  const exact = matches.find(item => normalizeTagQuery(item.chinese) === normalized || normalizeTagQuery(item.name) === normalized);
  return (exact?.name || normalized).replaceAll(' ', '_');
};

/** Search accepts one or two comma-separated tags. Spaces inside one tag are normalized to underscores. */
export const resolveDanbooruQuery = async (rawValue: string) => {
  const parts = rawValue.split(/[,，]+/).map(value => value.trim()).filter(Boolean).slice(0, 2);
  return (await Promise.all(parts.map(normalizeSingleTag))).filter(Boolean).join(' ');
};

export const danbooruPromptTags = (post: DanbooruPost) => [
  ...post.tags.character,
  ...post.tags.general,
].map(tag => tag.replaceAll('_', ' ')).join(', ');

export const danbooruAllTags = (post: DanbooruPost) => [
  ...post.tags.artist,
  ...post.tags.copyright,
  ...post.tags.character,
  ...post.tags.general,
  ...post.tags.meta,
];

const search = (options: { query?: string; page?: number; limit?: number } = {}): Promise<DanbooruSearchResult> => {
  const params = new URLSearchParams();
  if (options.query) params.set('tags', options.query);
  params.set('page', String(Math.max(1, options.page || 1)));
  params.set('limit', String(Math.min(60, Math.max(1, options.limit || 40))));
  return api.get(`/danbooru/posts?${params.toString()}`, { cache: 'no-store' });
};

const chooseCover = (items: DanbooruPost[], tag: string, kind: 'artist' | 'character') => {
  const normalizedTag = tag.toLowerCase().replaceAll(' ', '_');
  const exact = items.filter(post => post.tags[kind].some(value => value.toLowerCase() === normalizedTag));
  return exact[0] || null;
};

const getCover = (tag: string, kind: 'artist' | 'character'): Promise<DanbooruPost | null> => {
  const normalizedTag = tag.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalizedTag) return Promise.resolve(null);
  const key = `${kind}:${normalizedTag}`;
  const cached = readCoverCache()[key];
  if (cached && Date.now() - cached.updatedAt < COVER_CACHE_TTL) return Promise.resolve(cached.post);
  const pending = coverRequests.get(key);
  if (pending) return pending;

  const request = scheduleCoverRequest(() => search({ query: `${normalizedTag} order:score`, limit: 20 }))
    .then(result => {
      const post = chooseCover(result.items, normalizedTag, kind);
      readCoverCache()[key] = { post, updatedAt: Date.now() };
      persistCoverCache();
      return post;
    })
    .finally(() => coverRequests.delete(key));
  coverRequests.set(key, request);
  return request;
};

export const clearDanbooruCoverCache = () => {
  coverCache = {};
  localStorage.removeItem(COVER_CACHE_KEY);
};

export const danbooruService = { search, getCover };
