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

const COVER_CACHE_KEY = 'nai_danbooru_cover_cache_v9';
const COVER_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const COVER_CACHE_LIMIT = 150;
const COVER_REQUEST_INTERVAL_MS = 300;
// Keep the cached first screen compact. The cover component loads later pages on demand.
const COVER_CACHE_CANDIDATE_LIMIT = 24;

export interface DanbooruCoverCandidate {
  id: number;
  score: number;
  previewUrl: string;
  sampleUrl: string;
  postUrl: string;
}

export interface DanbooruCoverSet {
  representative: DanbooruCoverCandidate | null;
  candidates: DanbooruCoverCandidate[];
  hasMore: boolean;
}

type StoredCover = DanbooruCoverSet & { updatedAt: number };
let coverCache: Record<string, StoredCover> | null = null;
const coverRequests = new Map<string, Promise<DanbooruCoverSet>>();
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
  params.set('limit', String(Math.min(200, Math.max(1, options.limit || 40))));
  return api.get(`/danbooru/posts?${params.toString()}`, { cache: 'no-store' });
};

const CHARACTER_COVER_EXCLUDED_TAGS = new Set([
  'multiple_girls', 'multiple_boys', 'comic', '4koma', 'manga', 'chibi', 'super_deformed',
  'multiple_views', 'character_sheet', 'reference_sheet', 'model_sheet', 'comparison', 'chart',
  'collage', 'cosplay', 'faceless', 'head_out_of_frame', 'from_behind',
  'meme', 'english_text', 'japanese_text', 'chinese_text', 'korean_text', 'text_focus', 'caption',
  'speech_bubble', 'dialogue_box', 'thought_bubble', 'fumo_(doll)', 'doll', 'plushie', 'plush_toy',
  'food', 'eating', 'food_focus', 'personification', 'animalization', 'monochrome', 'greyscale',
  'sketch', 'lineart',
]);

const CHARACTER_COVER_VARIANT_TAGS = new Set([
  'alternate_costume', 'official_alternate_costume', 'alternate_hairstyle', 'alternate_hair_length',
  'genderswap', 'genderswap_(mtf)', 'genderswap_(ftm)', 'aged_up', 'aged_down', 'swimsuit',
  'bikini', 'school_swimsuit', 'one-piece_swimsuit', 'competition_swimsuit', 'underwear',
  'lingerie', 'nude', 'topless', 'bottomless',
]);

const CHARACTER_VARIANT_NAME = /(?:^|_)(?:alter|lily|lancer|master|swimsuit|bikini|casual|maid|school_uniform|summer|winter|halloween|christmas|wedding|young|adult|child|ghost|race_queen|idol)(?:_|$)|\((?:alter|lily|lancer|master|swimsuit|bikini|casual|maid|school_uniform|summer|winter|halloween|christmas|wedding|young|adult|child|ghost|race_queen|idol)\)/;
const CHARACTER_COVER_FRAMING_TAGS = new Set(['portrait', 'upper_body', 'cowboy_shot', 'full_body', 'standing']);
const CHARACTER_SIGNATURE_IGNORED_TAGS = new Set([
  '1girl', '1boy', 'solo', 'looking_at_viewer', 'facing_viewer', 'closed_mouth', 'open_mouth',
  'smile', 'blush', 'breasts', 'large_breasts', 'medium_breasts', 'small_breasts',
  'simple_background', 'white_background',
]);

const toCoverCandidate = (post: DanbooruPost): DanbooruCoverCandidate => ({
  id: post.id,
  score: post.score,
  previewUrl: post.previewUrl,
  sampleUrl: post.sampleUrl,
  postUrl: post.postUrl,
});

const candidatePostsFor = (items: DanbooruPost[], normalizedTag: string, kind: 'artist' | 'character') => (
  kind === 'character'
    ? getCharacterCandidates(items, normalizedTag)
    : items.filter(post => post.tags.artist.some(value => value.toLowerCase() === normalizedTag))
);

const getCharacterCandidates = (items: DanbooruPost[], normalizedTag: string) => {
  const exact = items.filter(post => post.tags.character.some(value => value.toLowerCase() === normalizedTag));
  const targetIsVariant = CHARACTER_VARIANT_NAME.test(normalizedTag);
  const representative = exact.filter(post => (
    post.tags.general.includes('solo')
    && post.tags.character.length <= 2
    && !post.tags.general.some(value => CHARACTER_COVER_EXCLUDED_TAGS.has(value))
    && !post.tags.meta.some(value => CHARACTER_COVER_EXCLUDED_TAGS.has(value))
    && (targetIsVariant || !post.tags.general.some(value => CHARACTER_COVER_VARIANT_TAGS.has(value)))
    && (targetIsVariant || !post.tags.meta.some(value => CHARACTER_COVER_VARIANT_TAGS.has(value)))
    && !post.tags.character.some(value => value !== normalizedTag && CHARACTER_VARIANT_NAME.test(value))
  ));
  const canonical = representative.filter(post => post.tags.character.length === 1);
  return canonical.length ? canonical : representative;
};

const chooseCover = (items: DanbooruPost[], tag: string, kind: 'artist' | 'character') => {
  const normalizedTag = tag.toLowerCase().replaceAll(' ', '_');
  const exact = items.filter(post => post.tags[kind].some(value => value.toLowerCase() === normalizedTag));
  if (kind === 'artist') return exact[0] || null;

  const candidates = getCharacterCandidates(items, normalizedTag);
  const tagFrequency = new Map<string, number>();
  for (const post of candidates) {
    for (const value of new Set(post.tags.general)) {
      if (!CHARACTER_SIGNATURE_IGNORED_TAGS.has(value)) tagFrequency.set(value, (tagFrequency.get(value) || 0) + 1);
    }
  }
  const minimumFrequency = Math.max(3, Math.ceil(candidates.length * 0.2));
  const signatureWeight = new Map(
    [...tagFrequency].filter(([, count]) => count >= minimumFrequency)
      .map(([value, count]) => [value, count / Math.max(1, candidates.length)]),
  );
  const representativeScore = (post: DanbooruPost) => {
    const signatureScore = post.tags.general.reduce((sum, value) => sum + (signatureWeight.get(value) || 0), 0);
    return signatureScore * 25
      + Math.log2(Math.max(1, post.score + 1)) * 5
      + (post.tags.general.some(value => ['looking_at_viewer', 'facing_viewer'].includes(value)) ? 35 : 0)
      + (post.tags.general.some(value => CHARACTER_COVER_FRAMING_TAGS.has(value)) ? 20 : 0);
  };
  return candidates.sort((left, right) => representativeScore(right) - representativeScore(left))[0] || null;
};

const getCoverSet = (tag: string, kind: 'artist' | 'character'): Promise<DanbooruCoverSet> => {
  const normalizedTag = tag.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalizedTag) return Promise.resolve({ representative: null, candidates: [], hasMore: false });
  const key = `${kind}:${normalizedTag}`;
  const cached = readCoverCache()[key];
  if (cached && Date.now() - cached.updatedAt < COVER_CACHE_TTL) {
    return Promise.resolve({ representative: cached.representative || null, candidates: cached.candidates || [], hasMore: Boolean(cached.hasMore) });
  }
  const pending = coverRequests.get(key);
  if (pending) return pending;

  const request = scheduleCoverRequest(() => search({ query: `${normalizedTag} order:score`, limit: kind === 'character' ? 160 : 20 }))
    .then(result => {
      const representativePost = chooseCover(result.items, normalizedTag, kind);
      const candidatePosts = candidatePostsFor(result.items, normalizedTag, kind);
      const coverSet: DanbooruCoverSet = {
        representative: representativePost ? toCoverCandidate(representativePost) : null,
        candidates: [...candidatePosts].sort((left, right) => right.score - left.score).slice(0, COVER_CACHE_CANDIDATE_LIMIT).map(toCoverCandidate),
        hasMore: result.hasMore,
      };
      readCoverCache()[key] = { ...coverSet, updatedAt: Date.now() };
      persistCoverCache();
      return coverSet;
    })
    .finally(() => coverRequests.delete(key));
  coverRequests.set(key, request);
  return request;
};

/** Returns one source page of every eligible exact-tag result, ordered by score. */
const getCoverCandidatePage = async (tag: string, kind: 'artist' | 'character', page: number) => {
  const normalizedTag = tag.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalizedTag) return { candidates: [], hasMore: false };
  const result = await scheduleCoverRequest(() => search({ query: `${normalizedTag} order:score`, page, limit: 200 }));
  return {
    candidates: candidatePostsFor(result.items, normalizedTag, kind)
      .sort((left, right) => right.score - left.score)
      .map(toCoverCandidate),
    hasMore: result.hasMore,
  };
};

const getCover = async (tag: string, kind: 'artist' | 'character') => (await getCoverSet(tag, kind)).representative;

export const clearDanbooruCoverCache = () => {
  coverCache = {};
  localStorage.removeItem(COVER_CACHE_KEY);
};

export const danbooruService = { search, getCover, getCoverSet, getCoverCandidatePage };
