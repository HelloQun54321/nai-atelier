import { api } from './api';
import { normalizeTagQuery, searchTagDictionary } from './tagDictionary';
import { countDanbooruQueryTerms, DANBOORU_RATIO_QUERIES, splitDanbooruQuery, validateDanbooruQuery } from './danbooruQuery';

export type DanbooruTagCategory = 'general' | 'artist' | 'copyright' | 'character' | 'meta';

export interface DanbooruPost {
  id: number;
  rating: string;
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

const COVER_CACHE_KEY = 'nai_danbooru_cover_cache_v12';
const COVER_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const COVER_EMPTY_CACHE_TTL = 60_000;
const COVER_SOURCE_PAGE_SIZE = 200;
const COVER_EMPTY_PAGE_LOOKAHEAD = 3;
const COVER_CACHE_LIMIT = 150;
// 候选枚举最多 5 并发，串行安排启动时刻，避免多个等待者同时醒来形成请求突发。
// 遭遇 429 时所有尚未启动的请求共同退避 2 秒。
const COVER_REQUEST_CONCURRENCY = 5;
const COVER_REQUEST_INTERVAL_MS = 60;
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
  /** 缓存首屏被截短时重读本页补齐，避免遗漏该页其余可用图片。 */
  nextPage?: number;
}

type StoredCover = DanbooruCoverSet & { updatedAt: number };
let coverCache: Record<string, StoredCover> | null = null;
const coverRequests = new Map<string, Promise<DanbooruCoverSet>>();
let coverInFlight = 0;
const coverWaiters: Array<() => void> = [];
let nextCoverRequestAt = 0;
let coverStartQueue = Promise.resolve();

const scheduleCoverRequest = <T>(request: () => Promise<T>): Promise<T> => {
  const acquire = async () => {
    while (coverInFlight >= COVER_REQUEST_CONCURRENCY) {
      await new Promise<void>(resolve => coverWaiters.push(resolve));
    }
    coverInFlight++;
    const start = coverStartQueue.then(async () => {
      // 等待期间也可能收到 429，醒来后重新检查退避时间。
      while (nextCoverRequestAt > Date.now()) {
        await new Promise(resolve => window.setTimeout(resolve, nextCoverRequestAt - Date.now()));
      }
      nextCoverRequestAt = Date.now() + COVER_REQUEST_INTERVAL_MS;
    });
    coverStartQueue = start;
    await start;
  };
  return acquire().then(() =>
    request().catch(error => {
      if (/429/.test(String((error as Error)?.message || error))) {
        nextCoverRequestAt = Math.max(nextCoverRequestAt, Date.now() + 2000);
      }
      throw error;
    }).finally(() => {
      coverInFlight--;
      coverWaiters.shift()?.();
    })
  );
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
  if (/^[a-z0-9_~*-][a-z0-9_:.()'!+\-/<>=~*]*$/i.test(value)) return value.toLowerCase();

  const normalized = normalizeTagQuery(value);
  const matches = await searchTagDictionary(value, 12).catch(() => []);
  // 精确匹配优先；否则取最相关结果作为翻译。
  const exact = matches.find(item => normalizeTagQuery(item.chinese) === normalized || normalizeTagQuery(item.name) === normalized);
  const best = exact || matches[0];
  return (best?.name || normalized).replaceAll(' ', '_');
};

/** Search accepts one or two comma-separated tags. Spaces inside one tag are normalized to underscores. */
export const resolveDanbooruQuery = async (rawValue: string) => {
  const parts = rawValue.split(/[,，]+/).map(value => value.trim()).filter(Boolean);
  if (parts.length > 2) throw new Error('Danbooru 搜索最多输入两个关键词，请用逗号分隔');
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

export interface DanbooruFilterOptions {
  query?: string;
  sort?: 'rank' | 'score' | 'favcount' | 'latest';
  rating?: 'all' | 'g' | 's' | 'q' | 'e';
  ratio?: 'all' | 'portrait' | 'landscape' | 'square';
  subject?: 'all' | 'solo' | '1girl' | '1boy';
}

export const buildDanbooruFilterQuery = (options: DanbooruFilterOptions = {}): string => {
  const raw = (options.query || '').trim();
  const parts = splitDanbooruQuery(raw).filter(token => !options.sort || !token.startsWith('order:'));
  const hasQuery = parts.length > 0;

  // 排序修饰：
  // 1. 当有关键词时（如 frieren order:score），Danbooru 的索引能极快响应；
  // 2. 当无关键词时（全站大库），全表 order:score 或 order:favcount 会触发 Danbooru 官方数据库 500 timeout；
  //    此时无缝路由到 Danbooru 官方专用的 /explore/posts/popular 聚合接口（日榜/周榜/月榜），秒级响应且结果高质量。
  if (options.sort === 'score') {
    parts.push(hasQuery ? 'order:score' : 'explore:popular_month');
  } else if (options.sort === 'favcount') {
    parts.push(hasQuery ? 'order:favcount' : 'explore:popular_week');
  } else if (options.sort === 'latest') {
    // 官方默认就是最新；两个关键词时省去会占一个名额的显式排序。
    if (countDanbooruQueryTerms(parts.join(' ')) < 2) parts.push('order:id_desc');
  } else if (options.sort === 'rank' || (!options.sort && !raw)) {
    parts.push('order:rank');
  }

  // rating/ratio 属于官方免费修饰条件，不应因为普通 Tag 已满而被省略。
  if (options.rating && options.rating !== 'all') {
    parts.push(`rating:${options.rating}`);
  }

  // 构图比例修饰
  if (options.ratio && options.ratio !== 'all') parts.push(DANBOORU_RATIO_QUERIES[options.ratio]);

  // 主体修饰
  // solo 是普通 Tag；没有上游名额时由页面对每个加载页做相同条件的筛选。
  if (options.subject && options.subject !== 'all'
    && (parts[0]?.startsWith('explore:') || countDanbooruQueryTerms(parts.join(' ')) < 2)) {
    parts.push(options.subject);
  }

  const query = parts.join(' ');
  validateDanbooruQuery(query);
  return query;
};

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

// 经典立绘只影响代表图排序，不丢弃换装、多人或任何评级的精确匹配候选。
const candidatePostsFor = (items: DanbooruPost[], normalizedTag: string, kind: 'artist' | 'character') =>
  items.filter(post => post.tags[kind].some(value => value.toLowerCase() === normalizedTag));

const getCharacterCandidates = (items: DanbooruPost[], normalizedTag: string) => {
  const exact = items.filter(post => post.tags.character.some(value => value.toLowerCase() === normalizedTag));
  if (!exact.length) return [];

  const targetIsVariant = CHARACTER_VARIANT_NAME.test(normalizedTag);

  // 梯队 1：严格单人经典立绘（无 Q 版、无草稿、无换装）
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
  if (canonical.length) return canonical;
  if (representative.length) return representative;

  // 梯队 2：放宽换装与常规排除词限制（只要是 solo 单人即可）
  const relaxedSolo = exact.filter(post => post.tags.general.includes('solo'));
  if (relaxedSolo.length) return relaxedSolo;

  // 梯队 3：放宽 solo 单人限制（允许双人或合照图）
  const relaxedCharacterCount = exact.filter(post => post.tags.character.length <= 2);
  if (relaxedCharacterCount.length) return relaxedCharacterCount;

  // 梯队 4：终极兜底，返回所有匹配该角色标签的帖子
  return exact;
};

const chooseCover = (items: DanbooruPost[], tag: string, kind: 'artist' | 'character') => {
  const normalizedTag = tag.toLowerCase().replaceAll(' ', '_');
  const exact = items.filter(post => post.tags[kind].some(value => value.toLowerCase() === normalizedTag));
  if (!exact.length) return null;
  if (kind === 'artist') return exact[0] || null;

  const candidates = getCharacterCandidates(items, normalizedTag);
  if (!candidates.length) return exact[0] || null;

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
  return candidates.sort((left, right) => representativeScore(right) - representativeScore(left))[0] || exact[0] || null;
};

const getCoverSet = (tag: string, kind: 'artist' | 'character'): Promise<DanbooruCoverSet> => {
  const normalizedTag = tag.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalizedTag) return Promise.resolve({ representative: null, candidates: [], hasMore: false });
  const key = `${kind}:${normalizedTag}`;
  const cached = readCoverCache()[key];
  if (cached && Date.now() - cached.updatedAt < (cached.candidates?.length ? COVER_CACHE_TTL : COVER_EMPTY_CACHE_TTL)) {
    return Promise.resolve({ representative: cached.representative || null, candidates: cached.candidates || [], hasMore: Boolean(cached.hasMore), nextPage: cached.nextPage || 1 });
  }
  const pending = coverRequests.get(key);
  if (pending) return pending;

  // 排除已被上游禁用的作品；评级／权限限制仍由官方决定，不构造隐藏图片地址。
  const query = `${normalizedTag} order:score -status:banned`;
  const request = (async () => {
      let result = await scheduleCoverRequest(() => search({ query, limit: kind === 'character' ? 60 : 20 }));
      let candidatePosts = candidatePostsFor(result.items, normalizedTag, kind);
      let sourcePage = 1;
      let fullSourcePage = false;
      // 首批热门作品可能全无图片权限。只对空候选向后查有限页，不镜像整个目录。
      while (!candidatePosts.length && result.hasMore && sourcePage <= COVER_EMPTY_PAGE_LOOKAHEAD) {
        const page = sourcePage;
        result = await scheduleCoverRequest(() => search({ query, page, limit: COVER_SOURCE_PAGE_SIZE }));
        candidatePosts = candidatePostsFor(result.items, normalizedTag, kind);
        fullSourcePage = true;
        if (!candidatePosts.length) sourcePage++;
      }
      const representativePost = chooseCover(result.items, normalizedTag, kind);
      const truncated = candidatePosts.length > COVER_CACHE_CANDIDATE_LIMIT;
      const coverSet: DanbooruCoverSet = {
        representative: representativePost ? toCoverCandidate(representativePost) : null,
        candidates: [...candidatePosts].sort((left, right) => right.score - left.score).slice(0, COVER_CACHE_CANDIDATE_LIMIT).map(toCoverCandidate),
        hasMore: result.hasMore || truncated,
        // 小首屏尚未读完整的 200 条源页，或截短候选时，下次先补同一页。
        nextPage: fullSourcePage && candidatePosts.length && !truncated ? sourcePage + 1 : sourcePage,
      };
      readCoverCache()[key] = { ...coverSet, updatedAt: Date.now() };
      persistCoverCache();
      return coverSet;
    })()
    .finally(() => coverRequests.delete(key));
  coverRequests.set(key, request);
  return request;
};

/** Returns one source page of every eligible exact-tag result, ordered by score. */
const getCoverCandidatePage = async (tag: string, kind: 'artist' | 'character', page: number) => {
  const normalizedTag = tag.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalizedTag) return { candidates: [], hasMore: false };
  const result = await scheduleCoverRequest(() => search({ query: `${normalizedTag} order:score -status:banned`, page, limit: COVER_SOURCE_PAGE_SIZE }));
  return {
    candidates: candidatePostsFor(result.items, normalizedTag, kind)
      .sort((left, right) => right.score - left.score)
      .map(toCoverCandidate),
    hasMore: result.hasMore,
  };
};

const getCover = async (tag: string, kind: 'artist' | 'character') => (await getCoverSet(tag, kind)).representative;

export const danbooruService = { search, getCover, getCoverSet, getCoverCandidatePage };
