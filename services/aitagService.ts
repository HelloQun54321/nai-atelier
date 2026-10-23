import { api } from './api';
import { promptHasArtistTags } from './styleRollSeed';
import type { PromptChain } from '../types';

const AITAG_IMAGE_BASE_URL = 'https://ai-img.10118899.xyz/';
const AITAG_SOURCE_TYPE = 'nai';
const MIN_AITAG_METADATA_BYTES = 30;
const utf8Encoder = new TextEncoder();

export interface AitagWorkSummary {
  id: number;
  userId?: number;
  title?: string;
  caption?: string;
  tags?: string | string[];
  create_date?: string;
  AI_type?: string;
  ai_type?: string;
  remote_cover_url?: string;
  local_cover_url?: string;
  cover_status?: string;
  cover_cached_at?: number;
  remoteFirstImageUrl?: string;
  localFirstImageUrl?: string;
  firstImageStatus?: string;
  firstImageCachedAt?: number;
  first_image?: AitagImage;
  first_image_cached_at?: number;
  firstImage?: AitagImage;
  hasCachedDetail?: boolean;
  hasFullyCachedImages?: boolean;
  detailCachedAt?: number;
  isFavorite?: boolean;
  is_favorite?: number | boolean;
  favoriteAt?: number;
  favorite_at?: number;
  total_view?: number;
  total_bookmarks?: number;
  image_count?: number;
  imageCount?: number;
  original_urls?: string | string[];
  originalUrls?: string | string[];
  image_urls?: string | string[];
  imageUrls?: string | string[];
}

export interface AitagImage {
  id: number;
  work_id: number;
  author_id: number;
  image_type: string;
  model?: string;
  type?: string;
  generation_type?: string;
  action?: string;
  file_name: string;
  image_path?: string;
  remote_image_url?: string;
  local_image_url?: string;
  image_cache_status?: string;
  image_cached_at?: number;
  ai_json?: string | Record<string, any>;
  prompt_text?: string;
}

export interface AitagWorkDetail {
  work: AitagWorkSummary & {
    json?: string;
    original_urls?: string | string[];
  };
  images: AitagImage[];
  isPreviewOnly?: boolean;
}

export interface AitagSearchResponse {
  page: number;
  page_size: number;
  total: number;
  items: AitagWorkSummary[];
  source?: 'cache' | 'remote';
  status?: AitagCacheStatus;
  offline?: boolean;
}

export interface AitagSearchParams {
  page: number;
  pageSize?: number;
  q?: string;
  prompt?: string;
  sort?: 'new' | 'monthly';
  timeRange?: string;
}

export interface AitagCacheSearchParams extends AitagSearchParams {
  cacheFilter?: 'all' | 'full' | 'first-image' | 'favorite';
}

export interface AitagCacheStatus {
  key: string;
  sort: 'new' | 'monthly';
  timeRange: string;
  aiType: 'all' | 'nai' | 'sd' | 'comfyui';
  status: 'idle' | 'running' | 'paused' | 'done' | 'error' | string;
  paused: boolean;
  currentPage: number;
  nextPage: number;
  targetPages: number;
  pageSize: number;
  total: number;
  lastError?: string | null;
  startedAt?: number | null;
  updatedAt?: number | null;
  worksCount: number;
  sortWorksCount: number;
  detailsCount: number;
  firstImagesCount?: number;
  /** @deprecated use firstImagesCount */
  coversCount?: number;
}

export interface AitagMonthsResponse {
  months: string[];
  availableMonths?: string[];
  years?: number[];
}

export interface AitagFirstImageCacheResponse {
  items: AitagWorkSummary[];
  elapsedMs?: number;
  timedOut?: boolean;
  status?: AitagCacheStatus;
}

export const parseMaybeJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(/[,\s]+/).map(part => part.trim()).filter(Boolean);
  }
};

export const getAitagType = (work?: Partial<AitagWorkSummary>) => {
  return String(work?.AI_type || work?.ai_type || '').trim();
};

export const buildAitagImageUrl = (image?: Partial<AitagImage>) => {
  if (!image) return '';

  if (image.local_image_url) return image.local_image_url;
  if (image.remote_image_url) return image.remote_image_url;

  const imageType = String(image.image_type || '').trim();
  const authorId = String(image.author_id ?? '').trim();
  const fileName = String(image.file_name || '').trim().replace(/\.(png|jpe?g|webp)$/i, '');
  if (imageType && authorId && fileName) {
    return `${AITAG_IMAGE_BASE_URL}${imageType}/${authorId}/${fileName}.webp`;
  }

  const fallbackPath = String(image.image_path || '')
    .replace(/^\/?www\/pixiv_ai_tag\//, '')
    .replace(/^\/?pixiv_ai_tag\//, '')
    .replace(/\.png$/i, '.webp')
    .replace(/^\/+/, '');

  return fallbackPath ? `${AITAG_IMAGE_BASE_URL}${fallbackPath}` : '';
};

export const buildAitagPreviewUrl = (work?: Partial<AitagWorkSummary>) => {
  if (!work?.id) return '';

  if (work.localFirstImageUrl) return work.localFirstImageUrl;
  if (work.local_cover_url) return work.local_cover_url;
  if (work.firstImage) return buildAitagImageUrl(work.firstImage);
  if (work.first_image) return buildAitagImageUrl(work.first_image);
  if (work.remoteFirstImageUrl) return work.remoteFirstImageUrl;
  if (work.remote_cover_url) return work.remote_cover_url;

  const imageType = getAitagType(work);
  const userId = String(work.userId ?? '').trim();
  if (!imageType || !userId) return '';

  return `${AITAG_IMAGE_BASE_URL}${imageType}/${userId}/${work.id}_p0.webp`;
};

export const parseAitagAiJson = (value: unknown): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return null;
  }
};

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const parseMaybeJsonObject = (value: unknown): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

const getAitagCommentObject = (parsed: Record<string, any> | null) => {
  if (!parsed) return null;
  return parseMaybeJsonObject(parsed.Comment ?? parsed.comment);
};

const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasValue);
  return Boolean(value);
};

const hasMeaningfulKey = (value: unknown, patterns: RegExp[], depth = 0): boolean => {
  if (!value || depth > 5 || typeof value !== 'object') return false;

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const isTargetKey = patterns.some(pattern => pattern.test(key));
    if (isTargetKey && hasValue(child)) return true;
    return hasMeaningfulKey(child, patterns, depth + 1);
  });
};

const formatGenerationType = (rawValue: string) => {
  const raw = rawValue.trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '');

  if (/inpaint|inpainting|infill|paintmask|局部重绘/.test(normalized)) {
    return '局部重绘 (Inpainting)';
  }

  if (/img2img|image2image|imagetoimage|图生图/.test(normalized)) {
    return '图生图 (Image to Image)';
  }

  if (/txt2img|text2img|texttoimage|generate|generation|文生图/.test(normalized)) {
    return '文生图 (Text to Image)';
  }

  if (/vibe|氛围/.test(normalized)) {
    return '氛围参考 (Vibe Transfer)';
  }

  if (/characterreference|charref|角色参考/.test(normalized)) {
    return '角色参考 (Character Reference)';
  }

  return raw;
};

/**
 * aitag 元数据里的模型名常带版本哈希后缀（如 "NovelAI Diffusion V4.5 1229B44F"），
 * 同一模型系列每个作品后缀都不同；去掉独立的十六进制哈希词，让筛选项按系列归并。
 */
const normalizeAitagModelLabel = (raw: string) =>
  raw
    .split(/\s+/)
    .filter(part => part && !/^[0-9A-Fa-f]{6,10}$/i.test(part))
    .join(' ')
    .trim();

export const getAitagModelLabel = (image: AitagImage) => {
  const parsed = parseAitagAiJson(image.ai_json);
  const comment = getAitagCommentObject(parsed);
  const parameters = parsed?.parameters;

  return normalizeAitagModelLabel(pickString(
    image.model,
    parsed?.model,
    parsed?.Model,
    parameters?.model,
    comment?.model,
    comment?.Model,
    image.image_type
  ));
};

export const getAitagGenerationLabels = (image: AitagImage) => {
  const parsed = parseAitagAiJson(image.ai_json);
  const comment = getAitagCommentObject(parsed);
  const parameters = parsed?.parameters;
  const rawType = pickString(
    image.generation_type,
    image.type,
    image.action,
    parsed?.generation_type,
    parsed?.generationType,
    parsed?.type,
    parsed?.Type,
    parsed?.action,
    parsed?.Action,
    parsed?.mode,
    parsed?.Mode,
    parsed?.request_type,
    parsed?.requestType,
    parameters?.generation_type,
    parameters?.type,
    parameters?.action,
    comment?.generation_type,
    comment?.generationType,
    comment?.type,
    comment?.Type,
    comment?.action,
    comment?.Action,
    comment?.mode,
    comment?.Mode
  );
  const labels: string[] = [];
  const addLabel = (label: string) => {
    if (label && !labels.includes(label)) labels.push(label);
  };

  if (rawType) {
    addLabel(formatGenerationType(rawType));
  }

  const metadataSources = { image, parsed, comment, parameters };

  if (hasMeaningfulKey(metadataSources, [/inpaint/i, /infill/i, /mask/i])) {
    addLabel('局部重绘 (Inpainting)');
  }

  if (hasMeaningfulKey(metadataSources, [/img2img/i, /image2image/i, /init_?image/i, /initial_?image/i, /source_?image/i])) {
    addLabel('图生图 (Image to Image)');
  }

  if (hasMeaningfulKey(metadataSources, [/^vibe_?transfer$/i, /^reference_?image/i, /^reference_?strength/i, /^reference_?information_?extracted/i])) {
    addLabel('氛围参考 (Vibe Transfer)');
  }

  if (hasMeaningfulKey(metadataSources, [/character_?reference/i, /char_?ref/i, /reference_?character/i, /director_?reference/i])) {
    addLabel('角色参考 (Character Reference)');
  }

  if (
    labels.length === 0 &&
    (parsed?.prompt || parsed?.v4_prompt || comment?.prompt || comment?.v4_prompt || image.prompt_text)
  ) {
    addLabel('文生图 (Text to Image)');
  }

  return labels;
};

export const extractAitagPrompt = (image: AitagImage) => {
  const parsed = parseAitagAiJson(image.ai_json);
  const comment = parsed?.Comment;

  if (comment && typeof comment === 'object') {
    const prompt = comment.v4_prompt?.caption?.base_caption || comment.prompt;
    if (typeof prompt === 'string' && prompt.trim()) return prompt;
  }

  const v4Prompt = parsed?.v4_prompt?.caption?.base_caption;
  if (typeof v4Prompt === 'string' && v4Prompt.trim()) return v4Prompt;

  if (typeof parsed?.prompt === 'string' && parsed.prompt.trim()) return parsed.prompt;
  if (typeof parsed?.Description === 'string' && parsed.Description.trim()) return parsed.Description;
  return image.prompt_text || '';
};

/**
 * 判定图片是否携带可用于生图/导入的有效 prompt。
 * 与 extractAitagPrompt 使用同一套提取顺序（Comment.v4_prompt → Comment.prompt →
 * v4_prompt → prompt → Description → prompt_text），但直接基于原始字段判定，
 * 避免为了过滤而构造中间字符串。
 */
export const hasAitagImagePrompt = (image: AitagImage): boolean => {
  if (!image) return false;

  const parsed = parseAitagAiJson(image.ai_json);
  const comment = parsed?.Comment;

  if (comment && typeof comment === 'object') {
    const prompt = comment.v4_prompt?.caption?.base_caption || comment.prompt;
    if (typeof prompt === 'string' && prompt.trim()) return true;
  }

  const v4Prompt = parsed?.v4_prompt?.caption?.base_caption;
  if (typeof v4Prompt === 'string' && v4Prompt.trim()) return true;

  if (typeof parsed?.prompt === 'string' && parsed.prompt.trim()) return true;
  if (typeof parsed?.Description === 'string' && parsed.Description.trim()) return true;
  return typeof image.prompt_text === 'string' && image.prompt_text.trim().length > 0;
};

/** 作品图片的正向提示词全文（基础提示词与角色提示词），用于本地细筛和画师识别。 */
export const getAitagPositivePromptText = (image?: AitagImage | null) => {
  if (!image) return '';
  const parsed = parseAitagAiJson(image.ai_json);
  const comment = getAitagCommentObject(parsed);
  const parts = [extractAitagPrompt(image)];
  for (const source of [comment?.v4_prompt, parsed?.v4_prompt]) {
    const characters = source?.caption?.char_captions;
    if (!Array.isArray(characters)) continue;
    for (const character of characters) {
      if (typeof character?.char_caption === 'string' && character.char_caption.trim()) parts.push(character.char_caption);
    }
  }
  return Array.from(new Set(parts.map(part => part.trim()).filter(Boolean))).join(', ');
};

/** 作品已知图片的正向提示词：详情已加载时覆盖全部页，否则只能依据首图。 */
export const getAitagWorkPromptTexts = (work: AitagWorkSummary, detail?: AitagWorkDetail | null) => {
  const images = detail && !detail.isPreviewOnly && detail.images.length
    ? detail.images
    : [work.firstImage || work.first_image];
  return images.map(getAitagPositivePromptText).filter(Boolean);
};

const artistDetectionCache = new WeakMap<ReadonlySet<string>, Map<string, boolean>>();
const prefixedArtistDetectionCache = new Map<string, boolean>();
/** 画师识别按提示词与词库缓存结果，滚动重渲染时不重复解析整段提示词。 */
export const aitagPromptHasArtistTags = (text: string, knownArtists?: ReadonlySet<string> | null) => {
  let cache = prefixedArtistDetectionCache;
  if (knownArtists) {
    cache = artistDetectionCache.get(knownArtists) || new Map();
    artistDetectionCache.set(knownArtists, cache);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const result = promptHasArtistTags(text, knownArtists || undefined);
  if (cache.size > 5000) cache.clear();
  cache.set(text, result);
  return result;
};

export interface AitagPromptQuery {
  /** 交给服务端检索的单个条件（最长的包含条件，保留原文）。 */
  remote: string;
  /** 服务端未覆盖、需在已加载条目上本地判定的包含条件（已归一化）。 */
  localInclude: string[];
  /** 排除条件（已归一化），只在本地判定。 */
  exclude: string[];
}

const normalizeAitagPromptTerm = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 提示词检索语法：逗号（含中文逗号）分隔多个条件，需同时包含；以「-」开头表示排除。
 * 最长的包含条件交给服务端缩小范围，其余条件只在已加载条目的正向提示词上细筛；
 * 只有一个包含条件时保持原有服务端检索语义，不在本地重复判定。
 */
export const parseAitagPromptQuery = (value: string): AitagPromptQuery => {
  const include: Array<{ raw: string; term: string }> = [];
  const exclude: string[] = [];
  for (const part of String(value || '').split(/[,，\n]/)) {
    const raw = part.trim();
    if (!raw) continue;
    if (raw.startsWith('-')) {
      const term = normalizeAitagPromptTerm(raw.slice(1));
      if (term && !exclude.includes(term)) exclude.push(term);
      continue;
    }
    const term = normalizeAitagPromptTerm(raw);
    if (term && !include.some(item => item.term === term)) include.push({ raw, term });
  }
  const remote = include.reduce<{ raw: string; term: string } | null>((longest, item) => (!longest || item.term.length > longest.term.length ? item : longest), null);
  return {
    remote: remote?.raw || '',
    localInclude: include.filter(item => item !== remote).map(item => item.term),
    exclude,
  };
};

export const hasAitagLocalPromptTerms = (query: AitagPromptQuery) => query.localInclude.length > 0 || query.exclude.length > 0;

/** 本地细筛：全部包含条件命中且没有排除条件命中；无提示词的作品无法满足包含条件。 */
export const matchesAitagPromptQuery = (texts: string[], query: AitagPromptQuery) => {
  if (!hasAitagLocalPromptTerms(query)) return true;
  const haystack = normalizeAitagPromptTerm(texts.join('\n'));
  return query.localInclude.every(term => haystack.includes(term)) && !query.exclude.some(term => haystack.includes(term));
};

const AITAG_CHAIN_DESCRIPTION_PREFIX = 'Imported from aitag #';
/** 「保存到风格串」写入的来源说明，同时作为识别已保存作品的依据。 */
export const buildAitagChainDescription = (workId: number | string) => `${AITAG_CHAIN_DESCRIPTION_PREFIX}${workId}`;

/** 从风格串列表中找出已由 AITag 作品保存的作品编号。 */
export const getAitagSavedChainWorkIds = (chains: ReadonlyArray<Pick<PromptChain, 'type' | 'description'>> = []) => {
  const ids = new Set<number>();
  for (const chain of chains) {
    if (chain.type !== 'style') continue;
    const match = String(chain.description || '').match(/Imported from aitag #(\d+)/);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
};

export const formatAitagJson = (image: AitagImage) => {
  const parsed = parseAitagAiJson(image.ai_json);
  if (parsed) return JSON.stringify(parsed, null, 2);
  return String(image.ai_json || '');
};

export const getAitagMetadataText = (image: AitagImage) => {
  const parsed = parseAitagAiJson(image.ai_json);
  const comment = parsed?.Comment ?? parsed?.comment;
  let metadataText: string;

  if (comment && typeof comment === 'object') {
    metadataText = JSON.stringify(comment);
  } else if (typeof comment === 'string' && comment.trim()) {
    metadataText = comment;
  } else {
    metadataText = formatAitagJson(image);
  }

  return utf8Encoder.encode(metadataText.trim()).byteLength < MIN_AITAG_METADATA_BYTES ? '' : metadataText;
};

export const aitagService = {
  search: (params: AitagSearchParams): Promise<AitagSearchResponse> => {
    const query = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize || 60),
      sort: params.sort || 'new',
      time_range: params.timeRange || 'all',
      aiType: AITAG_SOURCE_TYPE,
    });

    if (params.q?.trim()) query.set('q', params.q.trim());
    if (params.prompt?.trim()) query.set('prompt', params.prompt.trim());
    return api.get(`/aitag/search?${query.toString()}`);
  },

  searchCache: (params: AitagCacheSearchParams): Promise<AitagSearchResponse> => {
    const query = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize || 60),
      sort: params.sort || 'new',
      time_range: params.timeRange || 'all',
      aiType: AITAG_SOURCE_TYPE,
    });

    if (params.q?.trim()) query.set('q', params.q.trim());
    if (params.prompt?.trim()) query.set('prompt', params.prompt.trim());
    if (params.cacheFilter) query.set('cacheFilter', params.cacheFilter);

    return api.get(`/aitag/cache/search?${query.toString()}`);
  },

  getCacheStatus: (params: { sort?: 'new' | 'monthly'; timeRange?: string } = {}): Promise<AitagCacheStatus> => {
    const query = new URLSearchParams({
      sort: params.sort || 'new',
      time_range: params.timeRange || 'all',
      aiType: AITAG_SOURCE_TYPE,
    });
    return api.get(`/aitag/cache/status?${query.toString()}`);
  },

  waitForFirstImageCache: (params: {
    ids: number[];
    sort?: 'new' | 'monthly';
    timeRange?: string;
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  }): Promise<AitagFirstImageCacheResponse> => {
    const query = new URLSearchParams({
      ids: params.ids.join(','),
      sort: params.sort || 'new',
      time_range: params.timeRange || 'all',
      aiType: AITAG_SOURCE_TYPE,
      timeout_ms: String(params.timeoutMs ?? 4500),
      interval_ms: String(params.intervalMs ?? 700),
    });
    return fetch(`/api/aitag/cache/first-images?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: params.signal,
    }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `AITag 首图缓存检查失败 (${response.status})`);
      return payload as AitagFirstImageCacheResponse;
    });
  },

  setFavorite: (
    id: number | string,
    favorite: boolean,
    params: { sort?: 'new' | 'monthly'; timeRange?: string } = {}
  ): Promise<{ item: AitagWorkSummary; isFavorite: boolean }> => {
    return api.post(`/aitag/work/${id}/favorite`, {
      favorite,
      sort: params.sort || 'new',
      time_range: params.timeRange || 'all',
    });
  },

  getMonths: (): Promise<AitagMonthsResponse> => {
    return api.get('/aitag/months');
  },

  getWork: (id: number | string): Promise<AitagWorkDetail> => {
    return api.get(`/aitag/work/${id}`);
  },
};
