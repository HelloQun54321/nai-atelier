
import { readImageDimensions } from './imageDimensions.mjs';
import { MEDIA_VARIANTS, validateMediaSource } from './mediaValidation';
import { LAN_ACCESS_COOKIE } from './sharedWhitelist.mjs';

// Add missing D1 type definitions locally
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: any;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec<T = unknown>(query: string): Promise<D1Result<T>>;
}

// R2 Type Definitions
interface R2ObjectBody {
  body: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
  httpEtag: string;
}

interface R2Bucket {
    put(key: string, body: ReadableStream | ArrayBuffer | string, options?: any): Promise<any>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
}

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: D1Database;
  BUCKET?: R2Bucket; // R2 Binding
  MASTER_KEY: string; 
  R2_PUBLIC_URL?: string; // Kept for legacy compatibility if needed
  LOCAL_HISTORY_ENABLED?: string;
  PERSONAL_MODE_ENABLED?: string;
  LAN_ACCESS_PIN?: string;
  LAN_ACCESS_SECRET?: string;
  AITAG_LOCAL_PROXY_URL?: string;
  DANBOORU_LOCAL_PROXY_URL?: string;
  // GUEST_PASSCODE removed, now stored in DB
}

interface WorkerContext {
  waitUntil(promise: Promise<any>): void;
}

// ==================== 角色策略配置 ====================
// 统一的角色策略定义，前后端应共用此语义
const ROLE_POLICY = {
  // 有效角色列表
  VALID_ROLES: ['user', 'vip', 'admin', 'guest'] as const,
  
  // 可管理画师的角色（admin + vip）
  CAN_MANAGE_ARTISTS: ['admin', 'vip'] as const,
  
  // 默认存储配额（字节）
  DEFAULT_QUOTA: {
    user: 314572800,    // 300MB
    vip: 524288000,     // 500MB
    admin: null,        // admin 无限制，使用 null 表示
    guest: 104857600,   // 100MB
  } as const,
  
  // 判断是否可管理画师
  canManageArtists: (role: string) => ['admin', 'vip'].includes(role),
  
  // 判断是否不受存储配额限制
  isUnlimitedStorage: (role: string) => role === 'admin',
  
  // 获取默认配额，admin 返回 null 表示无限制
  getDefaultQuota: (role: string): number | null => {
    if (role === 'admin') return null;
    return (ROLE_POLICY.DEFAULT_QUOTA as Record<string, number | null>)[role] ?? 314572800;
  }
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, Server-Timing',
  'Access-Control-Allow-Credentials': 'true',
};

const json = (data: any, status = 200, headers: Record<string, string> = {}) => 
  new Response(JSON.stringify(data), { 
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers }, 
    status 
  });

const error = (msg: string, status = 500) => 
  new Response(JSON.stringify({ error: msg }), { headers: { 'Content-Type': 'application/json', ...corsHeaders }, status });

const AITAG_BASE_URL = 'https://aitag.win';
const AITAG_IMAGE_BASE_URL = 'https://ai-img.10118899.xyz/';
const AITAG_MIN_PAGE_SIZE = 60;
const AITAG_MAX_PAGE_SIZE = 60;
const AITAG_CACHE_DEFAULT_TARGET_PAGES = 500;
const AITAG_CACHE_BATCH_PAGES = 2;
const AITAG_CACHE_DELAY_MIN_MS = 800;
const AITAG_CACHE_DELAY_MAX_MS = 1200;
const AITAG_CONFIG_VERSION = '260528a';
const DANBOORU_BASE_URL = 'https://safebooru.donmai.us';
const DANBOORU_MAX_PAGE_SIZE = 200;
const LAN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const lanAccessAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const MAX_MANAGED_IMAGE_BYTES = 12 * 1024 * 1024;

const isLoopbackHostname = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
};

const signLanAccessValue = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(signature));
};

const createLanAccessToken = async (secret: string) => {
  const expiresAt = Date.now() + LAN_SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = crypto.randomUUID();
  const value = `${expiresAt}.${nonce}`;
  return `${value}.${await signLanAccessValue(value, secret)}`;
};

const hasValidLanAccess = async (request: Request, secret: string) => {
  if (!secret) return false;
  const token = parseCookies(request)[LAN_ACCESS_COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !nonce || !signature) return false;
  const expected = await signLanAccessValue(`${expiresAt}.${nonce}`, secret);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
};

const getLanAttemptKey = (request: Request) =>
  // CF-Connecting-IP 由 Cloudflare 边缘写入、客户端不可伪造，部署在 CF 上时优先采用；
  // X-Nai-Client-IP 在本地形态下由 media gateway 用 socket 地址覆写（同样可信），
  // 但在 CF 形态下客户端可伪造，故排在 CF-Connecting-IP 之后。
  // 不要把任意客户端提供的 X-Forwarded-For 当作限流主键。
  request.headers.get('CF-Connecting-IP') ||
  request.headers.get('X-Nai-Client-IP') ||
  request.headers.get('X-Forwarded-For')?.split(',').at(-1)?.trim() ||
  request.headers.get('User-Agent') ||
  'lan-device';

const lanAccessRequired = () => json({ error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' }, 401);

const handleMediaRequest = async (request: Request, env: Env, url: URL) => {
  if (request.method !== 'GET') return error('Method not allowed', 405);
  const variant = url.searchParams.get('variant') || '';
  if (!MEDIA_VARIANTS.has(variant)) return error('Invalid image variant', 400);
  let validated: { source: string; internal: boolean };
  try {
    validated = validateMediaSource(url.searchParams.get('source'));
  } catch (mediaError: any) {
    return error(mediaError?.message || 'Invalid image source', 400);
  }

  const assetMatch = validated.source.match(/^\/api\/assets\/(.+?)(?:\?.*)?$/);
  if (assetMatch && env.BUCKET) {
    let key = '';
    try { key = decodeURIComponent(assetMatch[1]); } catch { return error('Invalid asset key', 400); }
    const object = await env.BUCKET.get(key);
    if (!object) return error('File not found', 404);
    if (request.headers.get('If-None-Match') === object.httpEtag) {
      return new Response(null, { status: 304, headers: {
        ETag: object.httpEtag,
        'Cache-Control': 'private, max-age=31536000, immutable',
      }});
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  }

  const target = validated.internal ? new URL(validated.source, url.origin).toString() : validated.source;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': variant === 'original' ? 'private, max-age=3600' : 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const clampInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

async function proxyAitagJson(targetUrl: URL): Promise<Response> {
  const response = await fetch(targetUrl.toString(), {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${AITAG_BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    },
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

function buildAitagSearchUrl(sourceUrl: URL) {
  const sort = sourceUrl.searchParams.get('sort') === 'monthly' ? 'monthly' : 'new';
  const timeRange = normalizeAitagTimeRange(sourceUrl.searchParams.get('time_range'), sort);
  const target = sort === 'monthly' && timeRange !== 'current'
    ? new URL('/api/rank/monthly/fixed', AITAG_BASE_URL)
    : new URL(sort === 'monthly' ? '/api/rank/monthly/real' : '/api/ai_works_search', AITAG_BASE_URL);
  target.searchParams.set('page', String(clampInt(sourceUrl.searchParams.get('page'), 1, 1, 10000)));
  target.searchParams.set('page_size', String(clampInt(sourceUrl.searchParams.get('page_size'), AITAG_MIN_PAGE_SIZE, AITAG_MIN_PAGE_SIZE, AITAG_MAX_PAGE_SIZE)));

  if (sort === 'monthly') {
    if (timeRange !== 'current') {
      target.searchParams.set('month', timeRange === 'older' ? 'older' : timeRange.replace(/^m/, ''));
    }
  } else {
    target.searchParams.set('sort', sort);
    target.searchParams.set('time_range', timeRange.slice(0, 32));
  }

  const q = (sourceUrl.searchParams.get('q') || '').trim();
  const prompt = (sourceUrl.searchParams.get('prompt') || '').trim();
  if (q) target.searchParams.set('q', q.slice(0, 2000));
  if (prompt) target.searchParams.set('prompt', prompt.slice(0, 2000));

  return target;
}

function mergeAitagQueryWithAiType(q: string, aiType: AitagAiTypeFilter) {
  const parts = [q.trim(), getAitagRemoteQueryForAiType(aiType)].filter(Boolean);
  return parts.join(' ').trim();
}

function buildAitagWorkUrl(path: string) {
  const match = path.match(/^\/api\/aitag\/work\/(\d+)$/);
  if (!match) return null;
  return new URL(`/api/work/${match[1]}`, AITAG_BASE_URL);
}

type AitagAiTypeFilter = 'all' | 'nai' | 'sd' | 'comfyui';
type AitagCacheFilter = 'all' | 'full' | 'first-image' | 'favorite';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAitagJson(targetUrl: URL, env?: Env): Promise<any> {
  const localFetch = buildLocalAitagFetch(targetUrl.toString(), env);
  const response = await fetch(localFetch.url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${AITAG_BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ...localFetch.headers,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`aitag HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('aitag returned invalid JSON');
  }
}

function buildLocalAitagFetch(targetUrl: string, env?: Env) {
  if (!env?.AITAG_LOCAL_PROXY_URL) return { url: targetUrl, headers: {} as Record<string, string> };
  const proxyUrl = new URL(env.AITAG_LOCAL_PROXY_URL);
  proxyUrl.searchParams.set('url', targetUrl);
  return {
    url: proxyUrl.toString(),
    headers: env.LAN_ACCESS_SECRET ? { 'X-Nai-Internal-Secret': env.LAN_ACCESS_SECRET } : {},
  };
}

function buildLocalDanbooruFetch(targetUrl: string, env?: Env) {
  if (!env?.DANBOORU_LOCAL_PROXY_URL) return { url: targetUrl, headers: {} as Record<string, string> };
  const proxyUrl = new URL(env.DANBOORU_LOCAL_PROXY_URL);
  proxyUrl.searchParams.set('url', targetUrl);
  return {
    url: proxyUrl.toString(),
    headers: env.LAN_ACCESS_SECRET ? { 'X-Nai-Internal-Secret': env.LAN_ACCESS_SECRET } : {},
  };
}

async function fetchDanbooruJson(target: URL, env?: Env) {
  const localFetch = buildLocalDanbooruFetch(target.toString(), env);
  const response = await fetch(localFetch.url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'NAI-Atelier/0.5 (+local personal use)',
      ...localFetch.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 240);
    try { message = JSON.parse(text)?.message || JSON.parse(text)?.error || message; } catch { /* Plain-text error. */ }
    throw Object.assign(new Error(`Danbooru ${response.status}: ${message}`), { status: response.status });
  }
  try { return JSON.parse(text); } catch { throw new Error('Danbooru 返回了无效 JSON'); }
}

const splitDanbooruTags = (value: unknown) => String(value || '').split(/\s+/).map(tag => tag.trim()).filter(Boolean);

function normalizeDanbooruPost(post: any) {
  const previewUrl = String(post?.preview_file_url || '');
  if (!Number.isFinite(Number(post?.id)) || post?.rating !== 'g' || !previewUrl.startsWith('https://cdn.donmai.us/')) return null;
  const variants = Array.isArray(post?.media_asset?.variants) ? post.media_asset.variants : [];
  const preferredVariant = variants.find((variant: any) => variant?.type === '720x720')
    || variants.find((variant: any) => variant?.type === '360x360');
  const sampleUrl = String(preferredVariant?.url || post?.large_file_url || post?.file_url || previewUrl);
  return {
    id: Number(post.id),
    rating: 'g',
    score: Number(post.score || 0),
    favCount: Number(post.fav_count || 0),
    width: Number(post.image_width || 0),
    height: Number(post.image_height || 0),
    fileExt: String(post.file_ext || ''),
    previewUrl,
    sampleUrl: sampleUrl.startsWith('https://cdn.donmai.us/') ? sampleUrl : previewUrl,
    sourceUrl: String(post.source || '').slice(0, 2048),
    postUrl: `https://safebooru.donmai.us/posts/${Number(post.id)}`,
    tags: {
      general: splitDanbooruTags(post.tag_string_general),
      artist: splitDanbooruTags(post.tag_string_artist),
      copyright: splitDanbooruTags(post.tag_string_copyright),
      character: splitDanbooruTags(post.tag_string_character),
      meta: splitDanbooruTags(post.tag_string_meta),
    },
  };
}

const normalizeDanbooruQuery = (value: string | null) => {
  const query = String(value || '').trim().replace(/[,，]+/g, ' ').replace(/\s+/g, ' ').slice(0, 240);
  if (!query) return 'order:rank';
  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length > 2) throw Object.assign(new Error('Danbooru 匿名检索一次最多支持两个 Tag，请用逗号分隔并减少条件'), { status: 400 });
  // 允许 Unicode 字母数字（中文等语言的 tag/别名可直接查询），仍拒绝空白、引号、
  // 斜杠等符号类注入。
  if (tokens.some(token => !/^[\p{L}\p{N}_:.()'!+\-/]+$/u.test(token))) {
    throw Object.assign(new Error('Danbooru 查询中包含不支持的字符'), { status: 400 });
  }
  return tokens.join(' ');
};

function normalizeAitagSearchPayload(payload: any, fallbackPage: number, fallbackPageSize: number) {
  const items = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload)
          ? payload
          : [];

  return {
    page: Number(payload?.page || fallbackPage || 1),
    page_size: Number(payload?.page_size || payload?.pageSize || fallbackPageSize || AITAG_MAX_PAGE_SIZE),
    total: Number(payload?.total || payload?.total_count || payload?.count || items.length || 0),
    items,
  };
}

function safeJsonStringify(value: any, fallback = '') {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function normalizeAitagSort(value: string | null) {
  return value === 'monthly' ? 'monthly' : 'new';
}

function normalizeAitagTimeRange(value: string | null, sort = 'new') {
  const raw = String(value || '').trim().slice(0, 32).toLowerCase();
  if (sort === 'monthly') {
    if (raw === 'older') return 'older';
    if (/^m\d{4}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}$/.test(raw)) return `m${raw}`;
    return 'current';
  }

  return raw || 'all';
}

function getAitagSourceSort(sort: string, timeRange = 'all') {
  const normalizedSort = normalizeAitagSort(sort);
  if (normalizedSort !== 'monthly') return 'new';

  const normalizedTimeRange = normalizeAitagTimeRange(timeRange, 'monthly');
  if (normalizedTimeRange === 'current') return 'monthly';
  if (normalizedTimeRange === 'older') return 'monthly:older';
  return `monthly:${normalizedTimeRange.replace(/^m/, '')}`;
}

function normalizeAitagSourceSort(value: string | null) {
  const raw = String(value || '').trim().slice(0, 64).toLowerCase();
  if (raw === 'new' || raw === 'monthly') return raw;
  if (/^monthly:(older|\d{4}-\d{2})$/.test(raw)) return raw;
  return normalizeAitagSort(raw);
}

async function fetchAitagConfig(env?: Env) {
  const configUrl = new URL('/api/config', AITAG_BASE_URL);
  configUrl.searchParams.set('v', AITAG_CONFIG_VERSION);
  return fetchAitagJson(configUrl, env);
}

function normalizeAitagAiTypeFilter(value: string | null): AitagAiTypeFilter {
  if (value === 'nai' || value === 'sd' || value === 'comfyui') return value;
  return 'all';
}

function normalizeAitagCacheFilter(value: string | null): AitagCacheFilter {
  if (value === 'full' || value === 'first-image' || value === 'favorite') return value;
  return 'all';
}

function getAitagStateKey(sort: string, timeRange: string, aiType: AitagAiTypeFilter = 'all') {
  const base = `${sort}:${timeRange || 'all'}`;
  return aiType === 'all' ? base : `${base}:${aiType}`;
}

function getAitagWorkAiType(work: any) {
  return String(work?.AI_type || work?.ai_type || work?.image_type || '').trim();
}

function buildAitagPreviewUrlFromWork(work: any) {
  const imageType = getAitagWorkAiType(work);
  const userId = String(work?.userId ?? work?.user_id ?? work?.author_id ?? '').trim();
  const workId = String(work?.id ?? '').trim();
  if (!imageType || !userId || !workId) return '';
  return `${AITAG_IMAGE_BASE_URL}${imageType}/${userId}/${workId}_p0.webp`;
}

function getAitagRemoteQueryForAiType(aiType: AitagAiTypeFilter) {
  if (aiType === 'nai') return '-SD -COMFYUI';
  if (aiType === 'sd') return '-NAI -COMFYUI';
  if (aiType === 'comfyui') return '-NAI -SD';
  return '';
}

function appendAitagAiTypeFilter(where: string[], values: any[], aiType: AitagAiTypeFilter) {
  if (aiType === 'nai') {
    where.push("(LOWER(COALESCE(w.ai_type, '')) = 'nai' OR LOWER(COALESCE(w.ai_type, '')) = 'nai_x')");
  } else if (aiType !== 'all') {
    where.push("LOWER(COALESCE(w.ai_type, '')) = ?");
    values.push(aiType);
  }
}

function serializeAitagTags(tags: any) {
  if (tags === undefined || tags === null) return null;
  if (typeof tags === 'string') return tags;
  return safeJsonStringify(tags, '');
}

function parseAitagArrayField(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getAitagWorkImageCount(work: any, detailInfo?: { imageCount?: number } | null) {
  const directCount = Number(
    work?.image_count ??
    work?.imageCount ??
    work?.images_count ??
    work?.page_count ??
    work?.pageCount ??
    0
  );
  if (directCount > 0) return directCount;

  const detailCount = Number(detailInfo?.imageCount || 0);
  if (detailCount > 0) return detailCount;

  const detailImagesCount = getAitagDetailImages(work).length;
  if (detailImagesCount > 0) return detailImagesCount;

  const originalUrlsCount = parseAitagArrayField(work?.original_urls ?? work?.originalUrls).length;
  if (originalUrlsCount > 0) return originalUrlsCount;

  const imageUrlsCount = parseAitagArrayField(work?.image_urls ?? work?.imageUrls).length;
  if (imageUrlsCount > 0) return imageUrlsCount;

  return 0;
}

function sanitizeAitagAssetPart(value: any, fallback: string) {
  const text = String(value ?? fallback)
    .trim()
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return text || fallback;
}

function normalizeAitagImage(image: any, work?: any, index = 0) {
  const workId = Number(image?.work_id ?? image?.workId ?? work?.id ?? work?.work_id);
  const authorId = Number(image?.author_id ?? image?.authorId ?? work?.userId ?? work?.user_id ?? work?.author_id);
  const imageType = String(image?.image_type || image?.imageType || image?.AI_type || image?.ai_type || getAitagWorkAiType(work) || '').trim();
  const fileName = String(
    image?.file_name ||
    image?.fileName ||
    image?.filename ||
    image?.name ||
    (Number.isFinite(workId) ? `${workId}_p${index}` : `p${index}`)
  ).trim().replace(/\.(png|jpe?g|webp)$/i, '');

  return {
    ...image,
    id: image?.id ?? (Number.isFinite(workId) ? Number(`${workId}${index}`) : index),
    work_id: Number.isFinite(workId) ? workId : image?.work_id,
    author_id: Number.isFinite(authorId) ? authorId : image?.author_id,
    image_type: imageType || image?.image_type,
    file_name: fileName,
  };
}

function getAitagDetailImages(detail: any) {
  if (Array.isArray(detail?.images)) return detail.images;
  if (Array.isArray(detail?.work?.images)) return detail.work.images;
  if (Array.isArray(detail?.data?.images)) return detail.data.images;
  if (Array.isArray(detail?.result?.images)) return detail.result.images;
  return [];
}

function sortAitagImages(images: any[]) {
  return [...images].sort((a, b) =>
    String(a?.file_name || a?.fileName || '').localeCompare(String(b?.file_name || b?.fileName || ''), undefined, { numeric: true })
  );
}

function pickFirstAitagImage(detailOrWork: any) {
  const images = getAitagDetailImages(detailOrWork);
  if (images.length > 0) return sortAitagImages(images)[0];
  if (detailOrWork?.firstImage) return detailOrWork.firstImage;
  if (detailOrWork?.first_image) return detailOrWork.first_image;
  if (Array.isArray(detailOrWork?.image_list) && detailOrWork.image_list.length > 0) return detailOrWork.image_list[0];
  return null;
}

function buildAitagImageUrlFromImage(image: any) {
  if (!image) return '';
  if (image.local_image_url) return image.local_image_url;
  if (image.remote_image_url) return image.remote_image_url;

  const imageType = String(image.image_type || image.imageType || '').trim();
  const authorId = String(image.author_id ?? image.authorId ?? '').trim();
  const fileName = String(image.file_name || image.fileName || '').trim().replace(/\.(png|jpe?g|webp)$/i, '');
  if (imageType && authorId && fileName) {
    return `${AITAG_IMAGE_BASE_URL}${imageType}/${authorId}/${fileName}.webp`;
  }

  const fallbackPath = String(image.image_path || image.imagePath || '')
    .replace(/^\/?www\/pixiv_ai_tag\//, '')
    .replace(/^\/?pixiv_ai_tag\//, '')
    .replace(/\.png$/i, '.webp')
    .replace(/^\/+/, '');

  return fallbackPath ? `${AITAG_IMAGE_BASE_URL}${fallbackPath}` : '';
}

async function fetchAitagImageToBucket(env: Env, image: any, options: { workId: number; index?: number; purpose?: 'cover' | 'detail' }) {
  const normalized = normalizeAitagImage(image, { id: options.workId }, options.index || 0);
  if (normalized.local_image_url) return normalized;

  const remoteUrl = buildAitagImageUrlFromImage(normalized);
  if (!remoteUrl || !env.BUCKET) {
    return { ...normalized, remote_image_url: remoteUrl || normalized.remote_image_url || null };
  }

  try {
    const localFetch = buildLocalAitagFetch(remoteUrl, env);
    const response = await fetch(localFetch.url, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': `${AITAG_BASE_URL}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        ...localFetch.headers,
      },
    });
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);

    const contentType = response.headers.get('Content-Type') || 'image/webp';
    const baseName = sanitizeAitagAssetPart(normalized.file_name || normalized.id, `p${options.index || 0}`);
    const key = options.purpose === 'cover'
      ? `aitag-covers/${options.workId}.webp`
      : `aitag-images/${options.workId}/${baseName}.webp`;
    const arrayBuffer = await response.arrayBuffer();
    await env.BUCKET.put(key, arrayBuffer, { httpMetadata: { contentType } });

    return {
      ...normalized,
      remote_image_url: remoteUrl,
      local_image_url: `/api/assets/${key}`,
      image_cache_status: 'cached',
      image_cached_at: Date.now(),
    };
  } catch (e: any) {
    console.error(`Failed to cache aitag image ${options.workId}/${normalized.file_name || options.index}:`, e?.message || e);
    return {
      ...normalized,
      remote_image_url: remoteUrl,
      image_cache_status: 'error',
      image_cached_at: Date.now(),
    };
  }
}

async function ensureAitagCacheSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS aitag_works (
      id INTEGER NOT NULL,
      source_sort TEXT NOT NULL DEFAULT 'new',
      source_page INTEGER DEFAULT 0,
      source_index INTEGER DEFAULT 0,
      user_id INTEGER,
      title TEXT,
      caption TEXT,
      tags TEXT,
      create_date TEXT,
      ai_type TEXT,
      total_view INTEGER DEFAULT 0,
      total_bookmarks INTEGER DEFAULT 0,
      image_count INTEGER DEFAULT 0,
      remote_cover_url TEXT,
      local_cover_url TEXT,
      cover_status TEXT DEFAULT 'missing',
      cover_cached_at INTEGER,
      first_image_json TEXT,
      first_image_cached_at INTEGER,
      is_favorite INTEGER DEFAULT 0,
      favorite_at INTEGER,
      raw_json TEXT,
      cached_at INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (id, source_sort)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS aitag_work_details (
      work_id INTEGER PRIMARY KEY,
      detail_json TEXT NOT NULL,
      cached_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS aitag_index_state (
      key TEXT PRIMARY KEY,
      source_sort TEXT NOT NULL DEFAULT 'new',
      time_range TEXT NOT NULL DEFAULT 'all',
      current_page INTEGER DEFAULT 0,
      next_page INTEGER DEFAULT 1,
      target_pages INTEGER DEFAULT 500,
      page_size INTEGER DEFAULT 60,
      status TEXT DEFAULT 'idle',
      paused INTEGER DEFAULT 0,
      last_error TEXT,
      total INTEGER DEFAULT 0,
      started_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN remote_cover_url TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN local_cover_url TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN cover_status TEXT DEFAULT 'missing'").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN cover_cached_at INTEGER").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN first_image_json TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN first_image_cached_at INTEGER").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN is_favorite INTEGER DEFAULT 0").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE aitag_works ADD COLUMN favorite_at INTEGER").run(); } catch (e) {}
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_works_sort_page ON aitag_works(source_sort, source_page, source_index)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_works_ai_type ON aitag_works(ai_type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_works_cover_status ON aitag_works(cover_status)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_works_cached_at ON aitag_works(cached_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_works_favorite ON aitag_works(source_sort, is_favorite, favorite_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_aitag_details_cached_at ON aitag_work_details(cached_at)').run();
}

async function cacheAitagWorks(
  db: D1Database,
  payload: any,
  options: { sort: string; page: number; pageSize: number; timeRange?: string }
) {
  const normalized = normalizeAitagSearchPayload(payload, options.page, options.pageSize);
  const sourceSort = getAitagSourceSort(options.sort, options.timeRange);
  const now = Date.now();
  const statements = normalized.items
    .filter((work: any) => Number.isFinite(Number(work?.id)))
    .map((work: any, index: number) => {
      const id = Number(work.id);
      const userId = work.userId ?? work.user_id ?? work.author_id ?? null;
      const remoteFirstImageUrl = buildAitagPreviewUrlFromWork(work) || null;
      return db.prepare(`
        INSERT INTO aitag_works (
          id, source_sort, source_page, source_index, user_id, title, caption, tags,
          create_date, ai_type, total_view, total_bookmarks, image_count, remote_cover_url,
          cover_status, raw_json, cached_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, source_sort) DO UPDATE SET
          source_page = excluded.source_page,
          source_index = excluded.source_index,
          user_id = excluded.user_id,
          title = excluded.title,
          caption = excluded.caption,
          tags = excluded.tags,
          create_date = excluded.create_date,
          ai_type = excluded.ai_type,
          total_view = excluded.total_view,
          total_bookmarks = excluded.total_bookmarks,
          image_count = excluded.image_count,
          remote_cover_url = excluded.remote_cover_url,
          cover_status = CASE
            WHEN aitag_works.local_cover_url IS NULL OR aitag_works.local_cover_url = '' THEN COALESCE(aitag_works.cover_status, excluded.cover_status)
            ELSE aitag_works.cover_status
          END,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at
      `).bind(
        id,
        sourceSort,
        Number(normalized.page || options.page),
        index,
        userId === null || userId === undefined ? null : Number(userId),
        work.title ?? null,
        work.caption ?? work.description ?? null,
        serializeAitagTags(work.tags),
        work.create_date ?? work.created_at ?? null,
        getAitagWorkAiType(work) || null,
        Number(work.total_view ?? work.totalView ?? 0),
        Number(work.total_bookmarks ?? work.totalBookmarks ?? 0),
        getAitagWorkImageCount(work),
        remoteFirstImageUrl,
        'missing',
        safeJsonStringify(work, '{}'),
        now,
        now
      );
    });

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return normalized;
}

async function getCachedAitagWorksByIds(db: D1Database, ids: number[], sort: string) {
  const numericIds = ids.map(Number).filter(Number.isFinite);
  if (numericIds.length === 0) return [];
  const sourceSort = normalizeAitagSourceSort(sort);

  const placeholders = numericIds.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT w.*,
      CASE WHEN cached_detail.work_id IS NULL THEN 0 ELSE 1 END as has_cached_detail,
      CASE
        WHEN cached_detail.work_id IS NOT NULL
          AND json_array_length(json_extract(cached_detail.detail_json, '$.images')) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(json_extract(cached_detail.detail_json, '$.images')) image
            WHERE COALESCE(json_extract(image.value, '$.local_image_url'), '') = ''
          )
        THEN 1 ELSE 0
      END as has_fully_cached_images,
      cached_detail.cached_at as detail_cached_at,
      cached_detail.detail_json as detail_json
    FROM aitag_works w
    LEFT JOIN aitag_work_details cached_detail ON cached_detail.work_id = w.id
    WHERE w.source_sort = ? AND w.id IN (${placeholders})
  `).bind(sourceSort, ...numericIds).all();
  const byId = new Map((rows.results || []).map((row: any) => [Number(row.id), mapAitagWorkRow(row)]));
  return numericIds.map(id => byId.get(id)).filter(Boolean);
}

async function waitForAitagFirstImageUpdates(
  db: D1Database,
  options: { ids: number[]; sort: string; timeoutMs: number; intervalMs: number }
) {
  const numericIds = Array.from(new Set(options.ids.map(Number).filter(Number.isFinite))).slice(0, AITAG_MAX_PAGE_SIZE);
  const startedAt = Date.now();

  while (numericIds.length > 0) {
    const items = await getCachedAitagWorksByIds(db, numericIds, options.sort);
    const changedItems = items.filter((item: any) => {
      const status = String(item.firstImageStatus || item.cover_status || '').toLowerCase();
      return Boolean(item.localFirstImageUrl || item.local_cover_url) || status === 'error';
    });

    if (changedItems.length > 0 || Date.now() - startedAt >= options.timeoutMs) {
      return {
        items: changedItems,
        elapsedMs: Date.now() - startedAt,
        timedOut: changedItems.length === 0,
      };
    }

    await sleep(options.intervalMs);
  }

  return {
    items: [],
    elapsedMs: Date.now() - startedAt,
    timedOut: false,
  };
}

async function cacheAitagFirstImage(env: Env, db: D1Database, work: any) {
  const workId = Number(work?.id);
  if (!Number.isFinite(workId)) return;
  const sourceSort = normalizeAitagSourceSort(work?.source_sort || null);

  const existing = await db.prepare(`
    SELECT local_cover_url, remote_cover_url, first_image_json FROM aitag_works
    WHERE id = ? AND source_sort = ?
  `).bind(workId, sourceSort).first<{local_cover_url?: string; remote_cover_url?: string; first_image_json?: string}>();
  if (existing?.local_cover_url && existing?.first_image_json) return;

  try {
    const cachedDetail = await getCachedAitagDetail(db, workId);
    const detail = cachedDetail || await fetchAitagJson(new URL(`/api/work/${workId}`, AITAG_BASE_URL), env);
    const firstImage = pickFirstAitagImage(detail);
    if (!firstImage) throw new Error('first image metadata missing');

    const workMeta = detail?.work || work;
    const normalizedFirstImage = normalizeAitagImage(firstImage, workMeta, 0);
    const cachedFirstImage = await fetchAitagImageToBucket(env, normalizedFirstImage, {
      workId,
      index: 0,
      purpose: 'cover',
    });
    const remoteFirstImageUrl = cachedFirstImage.remote_image_url || existing?.remote_cover_url || buildAitagImageUrlFromImage(normalizedFirstImage) || buildAitagPreviewUrlFromWork(work);
    const localFirstImageUrl = cachedFirstImage.local_image_url || existing?.local_cover_url || null;
    const firstImageStatus = localFirstImageUrl ? 'cached' : (cachedFirstImage.image_cache_status || 'metadata');
    const now = Date.now();

    await db.prepare(`
      UPDATE aitag_works
      SET
        local_cover_url = COALESCE(NULLIF(?, ''), local_cover_url),
        remote_cover_url = COALESCE(NULLIF(?, ''), remote_cover_url),
        cover_status = ?,
        cover_cached_at = ?,
        first_image_json = ?,
        first_image_cached_at = ?,
        updated_at = ?
      WHERE id = ? AND source_sort = ?
    `).bind(
      localFirstImageUrl || null,
      remoteFirstImageUrl || null,
      firstImageStatus,
      now,
      safeJsonStringify(cachedFirstImage, '{}'),
      now,
      now,
      workId,
      sourceSort
    ).run();
  } catch (e: any) {
    const now = Date.now();
    await db.prepare(`
      UPDATE aitag_works
      SET cover_status = ?, updated_at = ?
      WHERE id = ? AND source_sort = ? AND (local_cover_url IS NULL OR local_cover_url = '')
    `).bind('error', now, workId, sourceSort).run();
    console.error(`Failed to cache aitag first image ${workId}:`, e?.message || e);
  }
}

async function cacheAitagFirstImagesForWorks(env: Env, db: D1Database, works: any[], sort: string) {
  if (!Array.isArray(works)) return;
  for (const work of works) {
    await cacheAitagFirstImage(env, db, { ...work, source_sort: sort });
    await sleep(550);
  }
}

async function cacheAitagDetail(env: Env, db: D1Database, detail: any) {
  const workId = Number(detail?.work?.id || detail?.id || detail?.images?.[0]?.work_id);
  if (!Number.isFinite(workId)) return detail;

  const workMeta = detail?.work || detail;
  const images = sortAitagImages(getAitagDetailImages(detail))
    .map((image, index) => normalizeAitagImage(image, workMeta, index));
  const cachedImages: any[] = [];
  for (let index = 0; index < images.length; index++) {
    const cachedImage = await fetchAitagImageToBucket(env, images[index], {
      workId,
      index,
      purpose: index === 0 ? 'cover' : 'detail',
    });
    cachedImages.push(cachedImage);
    if (index < images.length - 1) await sleep(80);
  }

  const firstImage = cachedImages[0] || null;
  const localFirstImageUrl = firstImage?.local_image_url || null;
  const remoteFirstImageUrl = firstImage?.remote_image_url || buildAitagPreviewUrlFromWork(workMeta) || null;
  const cachedDetail = {
    ...detail,
    work: {
      ...(detail?.work || {}),
      local_cover_url: localFirstImageUrl || detail?.work?.local_cover_url,
      remote_cover_url: remoteFirstImageUrl || detail?.work?.remote_cover_url,
      localFirstImageUrl: localFirstImageUrl || detail?.work?.localFirstImageUrl || detail?.work?.local_cover_url,
      remoteFirstImageUrl: remoteFirstImageUrl || detail?.work?.remoteFirstImageUrl || detail?.work?.remote_cover_url,
      firstImageStatus: firstImage?.image_cache_status || detail?.work?.firstImageStatus || detail?.work?.cover_status,
      firstImageCachedAt: firstImage?.image_cached_at || detail?.work?.firstImageCachedAt || detail?.work?.first_image_cached_at || detail?.work?.cover_cached_at,
      first_image: firstImage || detail?.work?.first_image,
      firstImage: firstImage || detail?.work?.firstImage || detail?.work?.first_image,
    },
    images: cachedImages.length > 0 ? cachedImages : getAitagDetailImages(detail),
  };
  const cachedDetailInfo = getAitagDetailCacheInfo(cachedDetail);
  cachedDetail.work = {
    ...cachedDetail.work,
    hasCachedDetail: true,
    hasFullyCachedImages: cachedDetailInfo.hasFullyCachedImages,
  };

  const now = Date.now();
  await db.prepare(`
    INSERT INTO aitag_work_details (work_id, detail_json, cached_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(work_id) DO UPDATE SET
      detail_json = excluded.detail_json,
      updated_at = excluded.updated_at
  `).bind(workId, safeJsonStringify(cachedDetail, '{}'), now, now).run();

  if (firstImage) {
    await db.prepare(`
      UPDATE aitag_works
      SET
        local_cover_url = COALESCE(NULLIF(?, ''), local_cover_url),
        remote_cover_url = COALESCE(NULLIF(?, ''), remote_cover_url),
        cover_status = ?,
        cover_cached_at = ?,
        first_image_json = ?,
        first_image_cached_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      localFirstImageUrl || null,
      remoteFirstImageUrl || null,
      localFirstImageUrl ? 'cached' : (firstImage.image_cache_status || 'metadata'),
      now,
      safeJsonStringify(firstImage, '{}'),
      now,
      now,
      workId
    ).run();
  }

  return cachedDetail;
}

async function cacheAitagDetailFirstImageOnly(env: Env, db: D1Database, detail: any) {
  const workId = Number(detail?.work?.id || detail?.id || detail?.images?.[0]?.work_id);
  if (!Number.isFinite(workId)) return detail;

  const workMeta = detail?.work || detail;
  const images = sortAitagImages(getAitagDetailImages(detail))
    .map((image, index) => normalizeAitagImage(image, workMeta, index));
  const firstImage = images[0]
    ? await fetchAitagImageToBucket(env, images[0], { workId, index: 0, purpose: 'cover' })
    : null;
  const normalizedImages = images.map((image, index) => index === 0 && firstImage ? firstImage : {
    ...image,
    remote_image_url: buildAitagImageUrlFromImage(image) || image.remote_image_url,
  });
  const localFirstImageUrl = firstImage?.local_image_url || detail?.work?.localFirstImageUrl || detail?.work?.local_cover_url || null;
  const remoteFirstImageUrl = firstImage?.remote_image_url || buildAitagPreviewUrlFromWork(workMeta) || detail?.work?.remoteFirstImageUrl || detail?.work?.remote_cover_url || null;
  const cachedDetail = {
    ...detail,
    work: {
      ...(detail?.work || {}),
      local_cover_url: localFirstImageUrl || detail?.work?.local_cover_url,
      remote_cover_url: remoteFirstImageUrl || detail?.work?.remote_cover_url,
      localFirstImageUrl: localFirstImageUrl || detail?.work?.localFirstImageUrl || detail?.work?.local_cover_url,
      remoteFirstImageUrl: remoteFirstImageUrl || detail?.work?.remoteFirstImageUrl || detail?.work?.remote_cover_url,
      firstImageStatus: firstImage?.image_cache_status || detail?.work?.firstImageStatus || detail?.work?.cover_status,
      firstImageCachedAt: firstImage?.image_cached_at || detail?.work?.firstImageCachedAt || detail?.work?.first_image_cached_at || detail?.work?.cover_cached_at,
      first_image: firstImage || detail?.work?.first_image,
      firstImage: firstImage || detail?.work?.firstImage || detail?.work?.first_image,
      hasCachedDetail: true,
      hasFullyCachedImages: false,
    },
    images: normalizedImages,
  };

  const now = Date.now();
  await db.prepare(`
    INSERT INTO aitag_work_details (work_id, detail_json, cached_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(work_id) DO UPDATE SET
      detail_json = excluded.detail_json,
      updated_at = excluded.updated_at
  `).bind(workId, safeJsonStringify(cachedDetail, '{}'), now, now).run();

  if (firstImage) {
    await db.prepare(`
      UPDATE aitag_works
      SET
        local_cover_url = COALESCE(NULLIF(?, ''), local_cover_url),
        remote_cover_url = COALESCE(NULLIF(?, ''), remote_cover_url),
        cover_status = ?,
        cover_cached_at = ?,
        first_image_json = ?,
        first_image_cached_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      localFirstImageUrl || null,
      remoteFirstImageUrl || null,
      localFirstImageUrl ? 'cached' : (firstImage.image_cache_status || 'metadata'),
      now,
      safeJsonStringify(firstImage, '{}'),
      now,
      now,
      workId
    ).run();
  }

  return cachedDetail;
}

async function getCachedAitagDetail(db: D1Database, workId: number) {
  const row = await db.prepare('SELECT detail_json FROM aitag_work_details WHERE work_id = ?')
    .bind(workId)
    .first<{detail_json: string}>();
  if (!row?.detail_json) return null;

  try {
    const detail = JSON.parse(row.detail_json);
    const cacheInfo = getAitagDetailCacheInfo(detail);
    return {
      ...detail,
      work: {
        ...(detail?.work || {}),
        hasCachedDetail: true,
        hasFullyCachedImages: cacheInfo.hasFullyCachedImages,
      },
    };
  } catch {
    return null;
  }
}

function getAitagDetailCacheInfo(detail: any) {
  const images = getAitagDetailImages(detail);
  const imageCount = images.length;
  const localImageCount = images.filter((image: any) => Boolean(image?.local_image_url)).length;
  const failedImageCount = images.filter((image: any) => String(image?.image_cache_status || '').toLowerCase() === 'error').length;
  return {
    imageCount,
    localImageCount,
    failedImageCount,
    hasFullyCachedImages: imageCount > 0 && localImageCount === imageCount,
  };
}

function mapAitagWorkRow(row: any) {
  let parsed: any = null;
  let firstImage: any = null;
  let detail: any = null;
  try {
    parsed = row.raw_json ? JSON.parse(row.raw_json) : null;
  } catch {}
  try {
    firstImage = row.first_image_json ? JSON.parse(row.first_image_json) : null;
  } catch {}
  try {
    detail = row.detail_json ? JSON.parse(row.detail_json) : null;
  } catch {}
  const detailCacheInfo = detail ? getAitagDetailCacheInfo(detail) : null;

  return {
    ...(parsed || {}),
    id: Number(row.id),
    userId: row.user_id === null || row.user_id === undefined ? parsed?.userId : Number(row.user_id),
    title: row.title ?? parsed?.title,
    caption: row.caption ?? parsed?.caption,
    tags: row.tags ?? parsed?.tags,
    create_date: row.create_date ?? parsed?.create_date,
    AI_type: row.ai_type ?? parsed?.AI_type,
    ai_type: row.ai_type ?? parsed?.ai_type,
    remote_cover_url: row.remote_cover_url ?? parsed?.remote_cover_url,
    local_cover_url: row.local_cover_url ?? parsed?.local_cover_url,
    cover_status: row.cover_status ?? parsed?.cover_status,
    cover_cached_at: row.cover_cached_at ?? parsed?.cover_cached_at,
    remoteFirstImageUrl: row.remote_cover_url ?? parsed?.remoteFirstImageUrl ?? parsed?.remote_cover_url,
    localFirstImageUrl: row.local_cover_url ?? parsed?.localFirstImageUrl ?? parsed?.local_cover_url,
    firstImageStatus: row.cover_status ?? parsed?.firstImageStatus ?? parsed?.cover_status,
    firstImageCachedAt: row.first_image_cached_at ?? row.cover_cached_at ?? parsed?.firstImageCachedAt ?? parsed?.first_image_cached_at ?? parsed?.cover_cached_at,
    first_image: firstImage || parsed?.first_image || parsed?.firstImage,
    firstImage: firstImage || parsed?.firstImage || parsed?.first_image,
    first_image_cached_at: row.first_image_cached_at ?? parsed?.first_image_cached_at,
    hasCachedDetail: Boolean(row.has_cached_detail || parsed?.hasCachedDetail),
    hasFullyCachedImages: Boolean(row.has_fully_cached_images || detailCacheInfo?.hasFullyCachedImages || parsed?.hasFullyCachedImages),
    detailCachedAt: row.detail_cached_at ?? parsed?.detailCachedAt,
    isFavorite: Boolean(row.is_favorite ?? parsed?.isFavorite ?? parsed?.is_favorite),
    is_favorite: Boolean(row.is_favorite ?? parsed?.is_favorite ?? parsed?.isFavorite) ? 1 : 0,
    favoriteAt: row.favorite_at ?? parsed?.favoriteAt ?? parsed?.favorite_at,
    favorite_at: row.favorite_at ?? parsed?.favorite_at ?? parsed?.favoriteAt,
    total_view: Number(row.total_view ?? parsed?.total_view ?? 0),
    total_bookmarks: Number(row.total_bookmarks ?? parsed?.total_bookmarks ?? 0),
    image_count: getAitagWorkImageCount({
      ...(parsed || {}),
      image_count: row.image_count ?? parsed?.image_count,
      imageCount: parsed?.imageCount,
      original_urls: parsed?.original_urls,
      originalUrls: parsed?.originalUrls,
      image_urls: parsed?.image_urls,
      imageUrls: parsed?.imageUrls,
    }, detailCacheInfo),
  };
}

async function searchAitagCache(
  db: D1Database,
  options: { page: number; pageSize: number; sort: string; aiType: AitagAiTypeFilter; cacheFilter?: AitagCacheFilter; q?: string; prompt?: string }
) {
  const sourceSort = normalizeAitagSourceSort(options.sort);
  const where = ['w.source_sort = ?'];
  const values: any[] = [sourceSort];

  appendAitagAiTypeFilter(where, values, options.aiType);

  if (options.cacheFilter === 'full') {
    where.push(`
      EXISTS (
        SELECT 1 FROM aitag_work_details cache_filter_detail
        WHERE cache_filter_detail.work_id = w.id
          AND json_array_length(json_extract(cache_filter_detail.detail_json, '$.images')) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(json_extract(cache_filter_detail.detail_json, '$.images')) image
            WHERE COALESCE(json_extract(image.value, '$.local_image_url'), '') = ''
          )
      )
    `);
  } else if (options.cacheFilter === 'first-image') {
    where.push("(w.local_cover_url IS NOT NULL AND w.local_cover_url != '')");
    where.push(`
      NOT EXISTS (
        SELECT 1 FROM aitag_work_details cache_filter_detail
        WHERE cache_filter_detail.work_id = w.id
          AND json_array_length(json_extract(cache_filter_detail.detail_json, '$.images')) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(json_extract(cache_filter_detail.detail_json, '$.images')) image
            WHERE COALESCE(json_extract(image.value, '$.local_image_url'), '') = ''
          )
      )
    `);
  } else if (options.cacheFilter === 'favorite') {
    where.push('COALESCE(w.is_favorite, 0) = 1');
  }

  const q = (options.q || '').trim().toLowerCase();
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      CAST(w.id AS TEXT) LIKE ? OR
      CAST(COALESCE(w.user_id, '') AS TEXT) LIKE ? OR
      LOWER(COALESCE(w.title, '')) LIKE ? OR
      LOWER(COALESCE(w.caption, '')) LIKE ? OR
      LOWER(COALESCE(w.tags, '')) LIKE ? OR
      LOWER(COALESCE(w.create_date, '')) LIKE ? OR
      LOWER(COALESCE(w.ai_type, '')) LIKE ? OR
      LOWER(COALESCE(w.raw_json, '')) LIKE ? OR
      EXISTS (
        SELECT 1 FROM aitag_work_details d
        WHERE d.work_id = w.id AND LOWER(COALESCE(d.detail_json, '')) LIKE ?
      )
    )`);
    values.push(like, like, like, like, like, like, like, like, like);
  }

  const prompt = (options.prompt || '').trim().toLowerCase();
  if (prompt) {
    const like = `%${prompt}%`;
    where.push(`(
      LOWER(COALESCE(w.raw_json, '')) LIKE ? OR
      EXISTS (
        SELECT 1 FROM aitag_work_details d
        WHERE d.work_id = w.id AND LOWER(COALESCE(d.detail_json, '')) LIKE ?
      )
    )`);
    values.push(like, like);
  }

  const whereSql = where.join(' AND ');
  const exactViewedPage = !q && !prompt && (!options.cacheFilter || options.cacheFilter === 'all');
  const orderSql = options.cacheFilter === 'favorite'
    ? 'ORDER BY COALESCE(w.favorite_at, 0) DESC, w.source_page ASC, w.source_index ASC, w.id DESC'
    : 'ORDER BY w.source_page ASC, w.source_index ASC, w.id DESC';
  const rows = exactViewedPage
    ? await db.prepare(`
      SELECT w.*,
        CASE WHEN cached_detail.work_id IS NULL THEN 0 ELSE 1 END as has_cached_detail,
        CASE
          WHEN cached_detail.work_id IS NOT NULL
            AND json_array_length(json_extract(cached_detail.detail_json, '$.images')) > 0
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(json_extract(cached_detail.detail_json, '$.images')) image
              WHERE COALESCE(json_extract(image.value, '$.local_image_url'), '') = ''
            )
          THEN 1 ELSE 0
        END as has_fully_cached_images,
        cached_detail.cached_at as detail_cached_at,
        cached_detail.detail_json as detail_json
      FROM aitag_works w
      LEFT JOIN aitag_work_details cached_detail ON cached_detail.work_id = w.id
      WHERE ${whereSql} AND w.source_page = ?
      ORDER BY w.source_index ASC, w.id DESC
      LIMIT ?
    `).bind(...values, options.page, options.pageSize).all()
    : await db.prepare(`
      SELECT w.*,
        CASE WHEN cached_detail.work_id IS NULL THEN 0 ELSE 1 END as has_cached_detail,
        CASE
          WHEN cached_detail.work_id IS NOT NULL
            AND json_array_length(json_extract(cached_detail.detail_json, '$.images')) > 0
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(json_extract(cached_detail.detail_json, '$.images')) image
              WHERE COALESCE(json_extract(image.value, '$.local_image_url'), '') = ''
            )
          THEN 1 ELSE 0
        END as has_fully_cached_images,
        cached_detail.cached_at as detail_cached_at,
        cached_detail.detail_json as detail_json
      FROM aitag_works w
      LEFT JOIN aitag_work_details cached_detail ON cached_detail.work_id = w.id
      WHERE ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `).bind(...values, options.pageSize, Math.max(0, (options.page - 1) * options.pageSize)).all();
  let total: number;
  if (exactViewedPage) {
    const maxPageRow = await db.prepare(`SELECT MAX(w.source_page) as maxPage FROM aitag_works w WHERE ${whereSql}`)
      .bind(...values)
      .first<{maxPage: number}>();
    const maxCachedPage = Number(maxPageRow?.maxPage || 0);
    total = Math.max(maxCachedPage, options.page) * options.pageSize;
  } else {
    total = Number((await db.prepare(`SELECT COUNT(*) as total FROM aitag_works w WHERE ${whereSql}`)
      .bind(...values)
      .first<{total: number}>())?.total || 0);
  }

  return {
    page: options.page,
    page_size: options.pageSize,
    total,
    items: (rows.results || []).map(mapAitagWorkRow),
  };
}

async function getAitagIndexState(db: D1Database, sort: string, timeRange = 'all', aiType: AitagAiTypeFilter = 'all') {
  const key = getAitagStateKey(sort, timeRange, aiType);
  return await db.prepare('SELECT * FROM aitag_index_state WHERE key = ?')
    .bind(key)
    .first<any>();
}

async function getAitagCacheStatus(db: D1Database, sort: string, timeRange = 'all', aiType: AitagAiTypeFilter = 'all') {
  const normalizedSort = normalizeAitagSort(sort);
  const normalizedTimeRange = normalizeAitagTimeRange(timeRange, normalizedSort);
  const sourceSort = getAitagSourceSort(normalizedSort, normalizedTimeRange);
  const key = getAitagStateKey(normalizedSort, normalizedTimeRange, aiType);
  const state = await getAitagIndexState(db, normalizedSort, normalizedTimeRange, aiType);
  const worksCount = await db.prepare('SELECT COUNT(DISTINCT id) as count FROM aitag_works')
    .first<{count: number}>();
  const sortWhere = ['w.source_sort = ?'];
  const sortValues: any[] = [sourceSort];
  appendAitagAiTypeFilter(sortWhere, sortValues, aiType);
  const sortWorksCount = await db.prepare(`SELECT COUNT(*) as count FROM aitag_works w WHERE ${sortWhere.join(' AND ')}`)
    .bind(...sortValues)
    .first<{count: number}>();
  const detailsCount = await db.prepare('SELECT COUNT(*) as count FROM aitag_work_details')
    .first<{count: number}>();
  const firstImagesWhere = [...sortWhere, "w.local_cover_url IS NOT NULL", "w.local_cover_url != ''"];
  const firstImagesCount = await db.prepare(`SELECT COUNT(*) as count FROM aitag_works w WHERE ${firstImagesWhere.join(' AND ')}`)
    .bind(...sortValues)
    .first<{count: number}>();

  return {
    key,
    sort: normalizedSort,
    timeRange: normalizedTimeRange,
    aiType,
    status: state?.status || 'idle',
    paused: Boolean(state?.paused),
    currentPage: Number(state?.current_page || 0),
    nextPage: Number(state?.next_page || 1),
    targetPages: Number(state?.target_pages || AITAG_CACHE_DEFAULT_TARGET_PAGES),
    pageSize: Number(state?.page_size || AITAG_MAX_PAGE_SIZE),
    total: Number(state?.total || 0),
    lastError: state?.last_error || null,
    startedAt: state?.started_at || null,
    updatedAt: state?.updated_at || null,
    worksCount: Number(worksCount?.count || 0),
    sortWorksCount: Number(sortWorksCount?.count || 0),
    detailsCount: Number(detailsCount?.count || 0),
    firstImagesCount: Number(firstImagesCount?.count || 0),
    coversCount: Number(firstImagesCount?.count || 0),
  };
}

async function upsertAitagIndexState(
  db: D1Database,
  options: { sort: string; timeRange: string; aiType: AitagAiTypeFilter; targetPages: number; status: string; paused: boolean }
) {
  const key = getAitagStateKey(options.sort, options.timeRange, options.aiType);
  const existing = await getAitagIndexState(db, options.sort, options.timeRange, options.aiType);
  const now = Date.now();
  const nextPage = Math.max(1, Number(existing?.next_page || 1));
  const currentPage = Math.max(0, Number(existing?.current_page || 0));
  await db.prepare(`
    INSERT INTO aitag_index_state (
      key, source_sort, time_range, current_page, next_page, target_pages,
      page_size, status, paused, last_error, total, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      target_pages = excluded.target_pages,
      status = excluded.status,
      paused = excluded.paused,
      last_error = NULL,
      started_at = COALESCE(aitag_index_state.started_at, excluded.started_at),
      updated_at = excluded.updated_at
  `).bind(
    key,
    options.sort,
    options.timeRange,
    currentPage,
    nextPage,
    options.targetPages,
    AITAG_MAX_PAGE_SIZE,
    options.status,
    options.paused ? 1 : 0,
    null,
    Number(existing?.total || 0),
    existing?.started_at || now,
    now
  ).run();
}

async function runAitagIndexBatch(
  env: Env,
  db: D1Database,
  options: { sort: string; timeRange: string; aiType?: AitagAiTypeFilter; maxPages?: number }
) {
  const sort = normalizeAitagSort(options.sort);
  const timeRange = options.timeRange || 'all';
  const aiType = options.aiType || 'all';
  const key = getAitagStateKey(sort, timeRange, aiType);
  const maxPages = Math.max(1, Math.min(5, options.maxPages || AITAG_CACHE_BATCH_PAGES));

  for (let i = 0; i < maxPages; i++) {
    const state = await getAitagIndexState(db, sort, timeRange, aiType);
    if (!state || state.paused || state.status !== 'running') break;

    const nextPage = Math.max(1, Number(state.next_page || 1));
    const targetPages = Math.max(1, Number(state.target_pages || AITAG_CACHE_DEFAULT_TARGET_PAGES));
    if (nextPage > targetPages) {
      await db.prepare(`
        UPDATE aitag_index_state
        SET status = ?, paused = 0, updated_at = ?, last_error = NULL
        WHERE key = ?
      `).bind('done', Date.now(), key).run();
      break;
    }

    try {
      const sourceUrl = new URL('http://local/api/aitag/search');
      sourceUrl.searchParams.set('page', String(nextPage));
      sourceUrl.searchParams.set('page_size', String(AITAG_MAX_PAGE_SIZE));
      sourceUrl.searchParams.set('sort', sort);
      sourceUrl.searchParams.set('time_range', timeRange);
      const aiTypeQuery = getAitagRemoteQueryForAiType(aiType);
      if (aiTypeQuery) sourceUrl.searchParams.set('q', aiTypeQuery);
      const data = await fetchAitagJson(buildAitagSearchUrl(sourceUrl), env);
      const normalized = await cacheAitagWorks(db, data, { sort, page: nextPage, pageSize: AITAG_MAX_PAGE_SIZE, timeRange });
      const remotePage = Number(normalized.page || nextPage);
      const remoteTotal = Number(normalized.total || state.total || 0);
      const lastRemotePage = remoteTotal ? Math.ceil(remoteTotal / AITAG_MAX_PAGE_SIZE) : targetPages;
      const reachedEnd = remotePage >= targetPages || remotePage >= lastRemotePage || normalized.items.length === 0;
      const nextStatus = reachedEnd ? 'done' : 'running';

      await db.prepare(`
        UPDATE aitag_index_state
        SET current_page = ?, next_page = ?, total = ?, status = ?, paused = 0, last_error = NULL, updated_at = ?
        WHERE key = ?
      `).bind(
        remotePage,
        remotePage + 1,
        remoteTotal,
        nextStatus,
        Date.now(),
        key
      ).run();

      if (nextStatus !== 'running') break;
      if (i < maxPages - 1) {
        const delay = AITAG_CACHE_DELAY_MIN_MS + Math.floor(Math.random() * (AITAG_CACHE_DELAY_MAX_MS - AITAG_CACHE_DELAY_MIN_MS + 1));
        await sleep(delay);
      }
    } catch (e: any) {
      await db.prepare(`
        UPDATE aitag_index_state
        SET status = ?, last_error = ?, updated_at = ?
        WHERE key = ?
      `).bind('error', String(e?.message || e).slice(0, 500), Date.now(), key).run();
      break;
    }
  }

  return getAitagCacheStatus(db, sort, timeRange, aiType);
}

// Updated Schema with Users, Sessions, and Settings
const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at INTEGER,
    last_login INTEGER,
    storage_usage INTEGER DEFAULT 0,
    max_storage INTEGER DEFAULT 314572800
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    user_id TEXT, 
    username TEXT, 
    type TEXT DEFAULT 'style',
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    preview_image TEXT,
    base_prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    params TEXT DEFAULT '{}',
    variable_values TEXT DEFAULT '{}',
    guest_hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    preview_url TEXT,
    benchmarks TEXT
  );
  CREATE TABLE IF NOT EXISTS inspirations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    title TEXT NOT NULL,
    image_url TEXT,
    prompt TEXT,
    negative_prompt TEXT DEFAULT '',
    params TEXT,
    board_id TEXT,
    notes TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    source_type TEXT,
    source_id TEXT,
    source_url TEXT,
    rating INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT,
    analysis TEXT DEFAULT '{}',
    image_key TEXT,
    image_type TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS inspiration_boards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS local_generation_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_key TEXT NOT NULL,
    image_type TEXT DEFAULT 'image/png',
    prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    params TEXT DEFAULT '{}',
    base_prompt TEXT DEFAULT '',
    subject_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    structure_version INTEGER NOT NULL DEFAULT 0,
    source_chain_id TEXT,
    source_chain_name TEXT,
    source_chain_type TEXT,
    external_source TEXT,
    external_id TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    favorite_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_local_history_user_created
    ON local_generation_history(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS vibe_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT,
    original_type TEXT,
    thumbnail_key TEXT,
    thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vibe_encodings (
    id TEXT PRIMARY KEY,
    vibe_id TEXT NOT NULL,
    model TEXT NOT NULL,
    model_key TEXT NOT NULL,
    information_extracted REAL NOT NULL,
    encoding_key TEXT NOT NULL,
    encoding_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(vibe_id, model, information_extracted)
  );
  CREATE TABLE IF NOT EXISTS vibe_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slots TEXT NOT NULL DEFAULT '[]',
    normalize_strengths INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character_reference_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT NOT NULL,
    original_type TEXT NOT NULL,
    thumbnail_key TEXT,
    thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    default_fidelity REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

// 进程内标记：DDL 幂等但昂贵（1 CREATE TABLE + 16 ALTER + 3 INDEX），
// 同一实例只在首个请求跑一次，不再每个灵感请求都重复约 20 条语句。
let inspirationSchemaEnsured = false;
async function ensureInspirationSchema(db: D1Database) {
  if (inspirationSchemaEnsured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS inspiration_boards (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  for (const statement of [
    "ALTER TABLE inspirations ADD COLUMN board_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN notes TEXT DEFAULT ''",
    "ALTER TABLE inspirations ADD COLUMN tags TEXT DEFAULT '[]'",
    "ALTER TABLE inspirations ADD COLUMN source_type TEXT",
    "ALTER TABLE inspirations ADD COLUMN source_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN source_url TEXT",
    "ALTER TABLE inspirations ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN last_used_at INTEGER",
    "ALTER TABLE inspirations ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inspirations ADD COLUMN parent_id TEXT",
    "ALTER TABLE inspirations ADD COLUMN analysis TEXT DEFAULT '{}'",
    "ALTER TABLE inspirations ADD COLUMN image_key TEXT",
    "ALTER TABLE inspirations ADD COLUMN image_type TEXT",
    "ALTER TABLE inspirations ADD COLUMN updated_at INTEGER",
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspirations_board ON inspirations(user_id, board_id, archived, is_pinned, created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspirations_source ON inspirations(user_id, source_type, source_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_inspiration_boards_sort ON inspiration_boards(user_id, sort_order, created_at)').run();
  inspirationSchemaEnsured = true;
}

/** 构建灵感字段更新的 SET 子句与绑定值；无任何可更新字段时返回 null。 */
function buildInspirationSetStatements(updates: any): { assignments: string[]; values: any[] } | null {
  const assignments: string[] = [];
  const values: any[] = [];
  const stringFields: Record<string, string> = {
    title: 'title', prompt: 'prompt', negativePrompt: 'negative_prompt', boardId: 'board_id', notes: 'notes',
    sourceType: 'source_type', sourceId: 'source_id', sourceUrl: 'source_url', parentId: 'parent_id',
  };
  for (const [key, column] of Object.entries(stringFields)) {
    if (updates[key] !== undefined) { assignments.push(`${column} = ?`); values.push(updates[key] || null); }
  }
  if (updates.tags !== undefined) { assignments.push('tags = ?'); values.push(JSON.stringify(Array.isArray(updates.tags) ? updates.tags.slice(0, 80) : [])); }
  if (updates.params !== undefined) { assignments.push('params = ?'); values.push(updates.params ? JSON.stringify(updates.params) : null); }
  if (updates.analysis !== undefined) { assignments.push('analysis = ?'); values.push(JSON.stringify(updates.analysis || {})); }
  if (updates.rating !== undefined) { assignments.push('rating = ?'); values.push(Math.max(0, Math.min(5, Math.floor(Number(updates.rating) || 0)))); }
  if (updates.isPinned !== undefined) { assignments.push('is_pinned = ?'); values.push(updates.isPinned ? 1 : 0); }
  if (updates.archived !== undefined) { assignments.push('archived = ?'); values.push(updates.archived ? 1 : 0); }
  if (!assignments.length) return null;
  return { assignments, values };
}

async function ensureLocalHistorySchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS local_generation_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      image_key TEXT NOT NULL,
      image_type TEXT DEFAULT 'image/png',
      prompt TEXT DEFAULT '',
      negative_prompt TEXT DEFAULT '',
      params TEXT DEFAULT '{}',
      base_prompt TEXT DEFAULT '',
      subject_prompt TEXT DEFAULT '',
      modules TEXT DEFAULT '[]',
      structure_version INTEGER NOT NULL DEFAULT 0,
      source_chain_id TEXT,
      source_chain_name TEXT,
      source_chain_type TEXT,
      external_source TEXT,
      external_id TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      favorite_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `).run();
  for (const statement of [
    'ALTER TABLE local_generation_history ADD COLUMN external_source TEXT',
    'ALTER TABLE local_generation_history ADD COLUMN external_id TEXT',
    "ALTER TABLE local_generation_history ADD COLUMN base_prompt TEXT DEFAULT ''",
    "ALTER TABLE local_generation_history ADD COLUMN subject_prompt TEXT DEFAULT ''",
    "ALTER TABLE local_generation_history ADD COLUMN modules TEXT DEFAULT '[]'",
    'ALTER TABLE local_generation_history ADD COLUMN structure_version INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE local_generation_history ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE local_generation_history ADD COLUMN favorite_at INTEGER',
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_local_history_user_created
    ON local_generation_history(user_id, created_at DESC)`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_local_history_external
    ON local_generation_history(user_id, external_source, external_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_local_history_user_favorite_created
    ON local_generation_history(user_id, is_favorite, created_at DESC)`).run();
  // Rows written before structured history existed have migration defaults
  // (empty strings and []).  They must continue to import their full prompt.
  // Preserve any older row that demonstrably contains structured information.
  await db.prepare(`UPDATE local_generation_history
    SET structure_version = 1
    WHERE COALESCE(structure_version, 0) = 0
      AND (
        TRIM(COALESCE(base_prompt, '')) != ''
        OR TRIM(COALESCE(subject_prompt, '')) != ''
        OR TRIM(COALESCE(modules, '')) NOT IN ('', '[]', 'null')
      )`).run();
}

async function ensureVibeSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
      original_key TEXT, original_type TEXT, thumbnail_key TEXT, thumbnail_type TEXT, default_strength REAL NOT NULL DEFAULT 0.6,
      archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_encodings (
      id TEXT PRIMARY KEY, vibe_id TEXT NOT NULL, model TEXT NOT NULL, model_key TEXT NOT NULL,
      information_extracted REAL NOT NULL, encoding_key TEXT NOT NULL, encoding_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(vibe_id, model, information_extracted)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vibe_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slots TEXT NOT NULL DEFAULT '[]',
      normalize_strengths INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
  ]);
  for (const statement of [
    'ALTER TABLE vibe_assets ADD COLUMN thumbnail_key TEXT',
    'ALTER TABLE vibe_assets ADD COLUMN thumbnail_type TEXT',
  ]) {
    try { await db.prepare(statement).run(); } catch { /* Column already exists. */ }
  }
}

async function ensureCharacterReferenceSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS character_reference_assets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT NOT NULL, original_type TEXT NOT NULL,
    thumbnail_key TEXT, thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    default_fidelity REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_character_reference_assets_archived_updated
    ON character_reference_assets(archived, updated_at DESC)`).run();
  try {
    await db.prepare('ALTER TABLE character_reference_assets ADD COLUMN default_fidelity REAL NOT NULL DEFAULT 0.6').run();
  } catch { /* Column already exists. */ }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;

const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes))))
  .map(value => value.toString(16).padStart(2, '0')).join('');

const VIBE_MODEL = 'nai-diffusion-4-5-full';
const VIBE_MODEL_KEY = 'v4-5full';
const VIBE_UPLOAD_LIMIT = 30 * 1024 * 1024;

function parseImageData(value: string) {
  const match = String(value || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  const bytes = base64ToBytes(match[2]);
  if (!bytes.length || bytes.length > VIBE_UPLOAD_LIMIT) throw new Error('参考图大小必须在 30 MB 以内');
  const format = match[1].toLowerCase().replace('jpeg', 'jpg') as 'png' | 'jpg' | 'webp';
  const valid = format === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : format === 'webp'
      ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
      : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error('图片内容与文件格式不一致');
  return { bytes, format, contentType: format === 'jpg' ? 'image/jpeg' : `image/${format}`, ...readImageDimensions(bytes, format) };
}

async function parseUploadedImage(value: FormDataEntryValue | null, limit = VIBE_UPLOAD_LIMIT) {
  if (!(value instanceof File)) throw new Error('缺少图片文件');
  const contentType = value.type.toLowerCase();
  const format = contentType === 'image/png' ? 'png'
    : contentType === 'image/jpeg' ? 'jpg'
      : contentType === 'image/webp' ? 'webp'
        : '';
  if (!format) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  if (!value.size || value.size > limit) throw new Error(`图片大小必须在 ${Math.floor(limit / 1024 / 1024)} MB 以内`);
  const bytes = new Uint8Array(await value.arrayBuffer());
  const valid = format === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : format === 'webp'
      ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
      : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error('图片内容与文件格式不一致');
  return { bytes, format, contentType, ...readImageDimensions(bytes, format) };
}

const mapVibeEncoding = (row: any) => ({
  id: row.id,
  model: row.model,
  modelKey: row.model_key,
  informationExtracted: Number(row.information_extracted),
  encodingHash: row.encoding_hash,
  createdAt: Number(row.created_at),
});

async function mapVibeAsset(db: D1Database, row: any, preloadedEncodings?: any[]) {
  const encodings = preloadedEncodings || (await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? ORDER BY information_extracted DESC')
    .bind(row.id).all<any>()).results;
  return {
    id: row.id,
    name: row.name,
    sourceHash: row.source_hash,
    originalImageUrl: row.original_key ? `/api/vibes/${encodeURIComponent(row.id)}/image` : undefined,
    thumbnailUrl: row.thumbnail_key
      ? `/api/vibes/${encodeURIComponent(row.id)}/thumbnail`
      : row.original_key ? `/api/vibes/${encodeURIComponent(row.id)}/image` : undefined,
    hasOriginal: Boolean(row.original_key),
    defaultStrength: Number(row.default_strength ?? 0.6),
    encodings: encodings.map(mapVibeEncoding),
    archived: row.archived === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapCharacterReferenceAsset(row: any) {
  return {
    id: row.id,
    name: row.name,
    sourceHash: row.source_hash,
    originalImageUrl: `/api/character-references/${encodeURIComponent(row.id)}/image`,
    thumbnailUrl: row.thumbnail_key
      ? `/api/character-references/${encodeURIComponent(row.id)}/thumbnail`
      : `/api/character-references/${encodeURIComponent(row.id)}/image`,
    defaultStrength: Number(row.default_strength ?? 0.6),
    defaultFidelity: Number(row.default_fidelity ?? 0.6),
    archived: row.archived === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function localHistoryEnabled(env: Env) {
  return env.LOCAL_HISTORY_ENABLED === 'true';
}

function parseStoredJson(value: string | null | undefined, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function localHistoryImageUrl(row: any) {
  return row.external_source === 'st-chatu8' && row.external_id
    ? `/api/integrations/st-chatu8/history/${encodeURIComponent(row.external_id)}/image`
    : `/api/local-history/${encodeURIComponent(row.id)}/image`;
}

function mapLocalHistoryRow(row: any) {
  const hasStructuredPrompt = Number(row.structure_version || 0) >= 1;
  return {
    id: row.id,
    imageUrl: localHistoryImageUrl(row),
    isFavorite: Number(row.is_favorite || 0) === 1,
    favoriteAt: row.favorite_at ? Number(row.favorite_at) : undefined,
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    params: parseStoredJson(row.params, {}),
    ...(hasStructuredPrompt ? {
      basePrompt: row.base_prompt || '',
      subjectPrompt: row.subject_prompt || '',
      modules: parseStoredJson(row.modules, []),
    } : {}),
    sourceChainId: row.source_chain_id || undefined,
    sourceChainName: row.source_chain_name || undefined,
    sourceChainType: row.source_chain_type || undefined,
    externalSource: row.external_source || undefined,
    externalId: row.external_id || undefined,
    createdAt: Number(row.created_at || 0),
  };
}

function inspirationImageUrl(row: any) {
  return row.image_key ? `/api/inspirations/${encodeURIComponent(row.id)}/image` : row.image_url;
}

function mapInspirationRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    title: row.title || '未命名灵感',
    imageUrl: inspirationImageUrl(row),
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    params: parseStoredJson(row.params, undefined),
    boardId: row.board_id || undefined,
    notes: row.notes || '',
    tags: parseStoredJson(row.tags, []),
    sourceType: row.source_type || undefined,
    sourceId: row.source_id || undefined,
    sourceUrl: row.source_url || undefined,
    rating: Number(row.rating || 0),
    isPinned: Number(row.is_pinned || 0) === 1,
    archived: Number(row.archived || 0) === 1,
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    useCount: Number(row.use_count || 0),
    parentId: row.parent_id || undefined,
    analysis: parseStoredJson(row.analysis, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || row.created_at || 0),
  };
}

function mapInspirationBoardRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color || '#6366f1',
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function getLocalOwner(db: D1Database) {
  const savedOwner = await db.prepare("SELECT value FROM settings WHERE key = 'personal_owner_id_v2'")
    .first<{value: string}>();
  let owner = savedOwner?.value
    ? await db.prepare('SELECT id, username, role, storage_usage, max_storage FROM users WHERE id = ?')
        .bind(savedOwner.value).first<any>()
    : null;

  if (!owner) {
    try {
      owner = await db.prepare(`
        SELECT id, username, role, storage_usage, max_storage
        FROM users u WHERE role != 'guest'
        ORDER BY
          (SELECT COUNT(*) FROM local_generation_history h WHERE h.user_id = u.id) DESC,
          (SELECT COUNT(*) FROM chains c WHERE c.user_id = u.id) DESC,
          (SELECT COUNT(*) FROM inspirations i WHERE i.user_id = u.id) DESC,
          CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      `).first<any>();
    } catch {
      owner = await db.prepare(`
        SELECT id, username, role, storage_usage, max_storage
        FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1
      `).first<any>();
    }
  }
  if (!owner) {
    const id = 'local-owner';
    await db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password, role, created_at, storage_usage)
      VALUES (?, 'local', '', 'admin', ?, 0)
    `).bind(id, Date.now()).run();
    owner = await db.prepare('SELECT id, username, role, storage_usage, max_storage FROM users WHERE id = ?')
      .bind(id).first<any>();
  }
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_owner_id_v2', ?)")
    .bind(owner!.id).run();
  return owner!;
}

async function removeLegacyLoggingStorage(db: D1Database) {
  const marker = await db.prepare("SELECT value FROM settings WHERE key = 'personal_logging_removed_v1'")
    .first<{value: string}>();
  if (marker?.value === '1') return;
  await db.prepare('DROP TABLE IF EXISTS access_logs').run();
  await db.prepare('DROP TABLE IF EXISTS daily_stats').run();
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_logging_removed_v1', '1')").run();
}

async function removeLegacyArtistLibrary(env: Env, db: D1Database) {
  const marker = await db.prepare("SELECT value FROM settings WHERE key = 'artist_catalog_local_v2'")
    .first<{value: string}>();
  if (marker?.value === '1') return;
  // This migration used to erase every artist and its R2 assets.  A missing
  // marker is also possible after restoring an older backup, so it must never
  // be interpreted as permission to destroy user data.
  void env;
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('artist_catalog_local_v2', '1')").run();
}

// Constants
const MAX_STORAGE_QUOTA = 300 * 1024 * 1024; // 300MB

// Helper: Parse Cookies
function parseCookies(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const cookies: Record<string, string> = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.split('=').map(c => c.trim());
      cookies[name] = value;
    });
  }
  return cookies;
}

// Helper: 判断是否为缺失列错误（SQLite/D1 不同版本的报错格式）
function isMissingColumnError(e: any): boolean {
  if (!e || !e.message) return false;
  const msg = e.message;
  // SQLite 可能报 'no column named xxx' 或 'no such column: xxx'
  return msg.includes('no column named') || msg.includes('no such column');
}

async function ensureAccessLogsSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT,
      role TEXT,
      ip TEXT,
      user_agent TEXT,
      action TEXT,
      category TEXT DEFAULT 'auth',
      status TEXT DEFAULT 'success',
      method TEXT,
      path TEXT,
      resource_type TEXT,
      resource_id TEXT,
      message TEXT,
      metadata TEXT,
      duration_ms INTEGER,
      created_at INTEGER
    )
  `).run();

  const columns = [
    "ALTER TABLE access_logs ADD COLUMN category TEXT DEFAULT 'auth'",
    "ALTER TABLE access_logs ADD COLUMN status TEXT DEFAULT 'success'",
    "ALTER TABLE access_logs ADD COLUMN method TEXT",
    "ALTER TABLE access_logs ADD COLUMN path TEXT",
    "ALTER TABLE access_logs ADD COLUMN resource_type TEXT",
    "ALTER TABLE access_logs ADD COLUMN resource_id TEXT",
    "ALTER TABLE access_logs ADD COLUMN message TEXT",
    "ALTER TABLE access_logs ADD COLUMN metadata TEXT",
    "ALTER TABLE access_logs ADD COLUMN duration_ms INTEGER",
  ];
  for (const sql of columns) {
    try { await db.prepare(sql).run(); } catch (e) {}
  }

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_role ON access_logs(role)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_category ON access_logs(category)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_status ON access_logs(status)').run();
}

// Helper: Delete File from R2
async function deleteR2File(env: Env, url: string) {
    if (!env.BUCKET || !url) return;
    // Check if it is a local API asset URL
    if (url.startsWith('/api/assets/')) {
        const key = url.replace('/api/assets/', '');
        try {
            await env.BUCKET.delete(decodeURIComponent(key));
            console.log(`Deleted old file: ${key}`);
        } catch (e) {
            console.error(`Failed to delete file ${key}`, e);
        }
    }
}

const isPrivateOrLocalImageHost = (hostname: string) => {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') return true;
    if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(value => value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
};

const validateExternalImageUrl = (value: string) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('外链图片地址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateOrLocalImageHost(url.hostname)) {
        throw new Error('外链图片必须是可公开访问的 HTTPS 图片地址');
    }
    return url;
};

const readLimitedImageBody = async (response: Response) => {
    const advertisedLength = Number(response.headers.get('content-length') || 0);
    if (advertisedLength > MAX_MANAGED_IMAGE_BYTES) throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_MANAGED_IMAGE_BYTES) {
                await reader.cancel();
                throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
};

// Helper: Process Base64 Image and Upload to R2 with Quota Check
async function processImageUpload(
    env: Env,
    imageData: string,
    folder: string,
    id: string,
    user?: { id: string, role: string, storage_usage?: number, max_storage?: number }
): Promise<string> {
    if (imageData.startsWith('http') || imageData.startsWith('/api/')) return imageData;

    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    const matches = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data format");
    }

    const ext = matches[1].toLowerCase() === 'jpg' ? 'jpeg' : matches[1].toLowerCase();
    const base64Data = matches[2];
    const filename = `${folder}/${id}_${Date.now()}.${ext}`;

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const fileSize = bytes.length;
    if (fileSize > MAX_MANAGED_IMAGE_BYTES) {
        throw new Error(`图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`);
    }

    if (user && user.role !== 'admin') {
        const currentUsage = user.storage_usage || 0;
        const maxStorage = user.max_storage || 314572800; // 默认300MB
        if (currentUsage + fileSize > maxStorage) {
            throw new Error(`Storage quota exceeded (limit: ${Math.round(maxStorage / 1024 / 1024)}MB).`);
        }
    }

    await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType: `image/${ext}` }
    });
    
    if (user && env.DB) {
        await env.DB.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?')
            .bind(fileSize, user.id).run();
    }

    return `/api/assets/${filename}`;
}

// Helper: Fetch External Image URL and Upload to R2
async function fetchAndUploadImage(
    env: Env,
    imageUrl: string,
    folder: string,
    id: string,
    user?: { id: string, role: string, storage_usage?: number, max_storage?: number }
): Promise<string> {
    if (!imageUrl.startsWith('http')) return imageUrl;
    
    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    try {
        let target = validateExternalImageUrl(imageUrl);
        let response: Response | null = null;
        for (let redirects = 0; redirects <= 3; redirects++) {
            response = await fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location) throw new Error('外链图片重定向地址无效');
            target = validateExternalImageUrl(new URL(location, target).toString());
            response = null;
        }
        if (!response) throw new Error('外链图片重定向次数过多');
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);

        const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        const extensionByType: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        const ext = extensionByType[contentType];
        if (!ext) throw new Error('外链响应不是支持的 PNG、JPEG 或 WebP 图片');
        const bytes = await readLimitedImageBody(response);
        const fileSize = bytes.byteLength;
        
        // Generate filename（id 来自请求体，净化为单段安全字符，防止拼接出任意前缀的 R2 key）
        const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'asset';
        const filename = `${folder}/${safeId}_${Date.now()}.${ext}`;

        if (user && user.role !== 'admin') {
            const currentUsage = user.storage_usage || 0;
            const maxStorage = user.max_storage || 314572800; // 默认 300MB
            if (currentUsage + fileSize > maxStorage) {
                throw new Error(`Storage quota exceeded (limit: ${Math.round(maxStorage / 1024 / 1024)}MB).`);
            }
        }

        await env.BUCKET.put(filename, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
            httpMetadata: { contentType }
        });
        
        if (user && env.DB) {
            await env.DB.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?')
                .bind(fileSize, user.id).run();
        }

        return `/api/assets/${filename}`;
    } catch (error: any) {
        throw new Error(`Failed to fetch and store external image: ${error.message}`);
    }
}

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const isLocalComputer = isLoopbackHostname(url.hostname);
    const isLanAuthorized = isLocalComputer || await hasValidLanAccess(request, env.LAN_ACCESS_SECRET || '');

    if (path === '/api/lan/status' && method === 'GET') {
      return json({ required: !isLocalComputer, authorized: isLanAuthorized });
    }

    if (path === '/api/lan/unlock' && method === 'POST') {
      if (isLocalComputer) return json({ success: true, authorized: true });
      const configuredPin = String(env.LAN_ACCESS_PIN || '');
      const secret = String(env.LAN_ACCESS_SECRET || '');
      if (!/^\d{4}$/.test(configuredPin) || secret.length < 16) {
        return error('局域网访问密码尚未正确配置，请重新启动电脑端服务', 503);
      }

      const attemptKey = getLanAttemptKey(request);
      const attempt = lanAccessAttempts.get(attemptKey) || { failures: 0, blockedUntil: 0 };
      if (attempt.blockedUntil > Date.now()) {
        return json({ error: '尝试次数过多，请一分钟后再试', code: 'LAN_ACCESS_BLOCKED', retryAfter: Math.ceil((attempt.blockedUntil - Date.now()) / 1000) }, 429);
      }

      const payload = await request.json().catch(() => ({})) as { pin?: string };
      if (!/^\d{4}$/.test(payload.pin || '') || payload.pin !== configuredPin) {
        const failures = attempt.failures + 1;
        const blockedUntil = failures >= 5 ? Date.now() + 60_000 : 0;
        lanAccessAttempts.set(attemptKey, { failures: blockedUntil ? 0 : failures, blockedUntil });
        return json({
          error: blockedUntil ? '连续输错5次，请一分钟后再试' : '密码不正确',
          code: blockedUntil ? 'LAN_ACCESS_BLOCKED' : 'LAN_ACCESS_DENIED',
          attemptsRemaining: blockedUntil ? 0 : 5 - failures,
        }, blockedUntil ? 429 : 401);
      }

      lanAccessAttempts.delete(attemptKey);
      const token = await createLanAccessToken(secret);
      return json({ success: true, authorized: true }, 200, {
        'Set-Cookie': `${LAN_ACCESS_COOKIE}=${token}; Max-Age=${LAN_SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Strict`,
      });
    }

    if (path === '/api/lan/lock' && method === 'POST') {
      return json({ success: true }, 200, {
        'Set-Cookie': `${LAN_ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`,
      });
    }

    if (!isLanAuthorized && path.startsWith('/api/')) {
      return lanAccessRequired();
    }

    if (path === '/api/media') {
      try {
        return await handleMediaRequest(request, env, url);
      } catch (e) {
        console.error('media proxy failed', e);
        return error('Failed to load media', 500);
      }
    }

    // --- R2 Asset Proxy Route (LAN sessions are checked above) ---
    if (path.startsWith('/api/assets/') && method === 'GET') {
        if (!env.BUCKET) return error('Bucket not configured', 503);
        try {
          const rawKey = path.replace('/api/assets/', '');
          const key = decodeURIComponent(rawKey);
          const object = await env.BUCKET.get(key);
          if (!object) return error('File not found', 404);
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Cache-Control', 'private, max-age=31536000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');
          return new Response(object.body, { headers });
        } catch (e) {
          console.error('asset proxy failed', e);
          return error('Failed to load asset', 500);
        }
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.DB) {
       return error('Database not configured.', 503);
    }
    const db = env.DB!;

    // Auto Init DB
    const initDB = async () => {
      const statements = INIT_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const sql of statements) {
          try { await db.prepare(sql).run(); } catch(e) {}
      }
      try { await db.prepare("ALTER TABLE users ADD COLUMN storage_usage INTEGER DEFAULT 0").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE users ADD COLUMN last_login INTEGER").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE users ADD COLUMN max_storage INTEGER DEFAULT 314572800").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN negative_prompt TEXT DEFAULT ''").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN params TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN variable_values TEXT DEFAULT '{}'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN preview_url TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN benchmarks TEXT DEFAULT '[]'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN type TEXT DEFAULT 'style'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN guest_hidden INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
      try { await ensureAitagCacheSchema(db); } catch (e) { console.error('Aitag cache table init failed', e) }
    };

    try {
      if (path === '/api/init') { await initDB(); return json({ success: true }); }

      if (env.PERSONAL_MODE_ENABLED !== 'true') {
        return error('This personal build only supports local operation', 403);
      }

      try {
        await db.prepare('SELECT 1 FROM users LIMIT 1').first();
        await db.prepare('SELECT 1 FROM settings LIMIT 1').first();
      } catch {
        await initDB();
      }

      await removeLegacyLoggingStorage(db);
      await removeLegacyArtistLibrary(env, db);

      // Personal mode: no login, guest, logout, password, or account management.
      if (path.startsWith('/api/auth/')) {
        if (path === '/api/auth/me' && method === 'GET') {
          try { await db.prepare('SELECT 1 FROM users').first(); } catch { await initDB(); }
          const owner = await getLocalOwner(db);
          return json({
            id: owner.id,
            username: '本机用户',
            role: 'admin',
            storageUsage: owner.storage_usage || 0,
            maxStorage: owner.max_storage || null,
          });
        }
        return error('Account authentication is disabled in personal mode', 410);
      }

      // --- PUBLIC: Benchmark Config (Read) ---
      if (path === '/api/config/benchmarks' && method === 'GET') {
          const res = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('benchmark_config').first<{value: string}>();
          return json({ config: res ? JSON.parse(res.value) : null });
      }

      // Lightweight project summary for the local Agent. Keep image/base64
      // fields out of the response and let SQLite perform all counts.
      if (path === '/api/agent/project-overview' && method === 'GET') {
          await ensureInspirationSchema(db);
          const [chains, inspirations, artists, vibes, groups, characterReferences, history] = await Promise.all([
              db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN type = 'character' THEN 1 ELSE 0 END) AS characters FROM chains`).first<any>(),
              db.prepare('SELECT COUNT(*) AS total FROM inspirations').first<any>(),
              db.prepare('SELECT COUNT(*) AS total FROM artists').first<any>(),
              db.prepare('SELECT COUNT(*) AS total FROM vibe_assets').first<any>(),
              db.prepare('SELECT COUNT(*) AS total FROM vibe_groups').first<any>(),
              db.prepare('SELECT COUNT(*) AS total FROM character_reference_assets WHERE archived = 0').first<any>(),
              db.prepare(`SELECT id, prompt, negative_prompt, params, source_chain_id, source_chain_name, source_chain_type, created_at FROM local_generation_history ORDER BY created_at DESC LIMIT 5`).all<any>(),
          ]);
          const characterCount = Number(chains?.characters || 0);
          return json({
              styleChains: Math.max(0, Number(chains?.total || 0) - characterCount),
              characterChains: characterCount,
              inspirations: Number(inspirations?.total || 0),
              artists: Number(artists?.total || 0),
              vibes: Number(vibes?.total || 0),
              vibeGroups: Number(groups?.total || 0),
              characterReferences: Number(characterReferences?.total || 0),
              recentHistory: (history.results || []).map((item: any) => ({
                  id: item.id,
                  prompt: item.prompt,
                  negativePrompt: item.negative_prompt,
                  params: parseStoredJson(item.params, {}),
                  sourceChainId: item.source_chain_id,
                  sourceChainName: item.source_chain_name,
                  sourceChainType: item.source_chain_type,
                  createdAt: item.created_at,
              })),
          });
      }

      if (path === '/api/agent/library' && method === 'GET') {
          await ensureInspirationSchema(db);
          const kind = new URL(request.url).searchParams.get('kind') || 'all';
          const output: any = {};
          if (kind === 'all' || kind === 'chains') {
              const rows = await db.prepare(`SELECT id, type, name, description, tags, base_prompt, negative_prompt, variable_values, created_at, updated_at FROM chains ORDER BY updated_at DESC`).all<any>();
              output.chains = rows.results.map((item: any) => ({ ...item, tags: parseStoredJson(item.tags, []), variableValues: parseStoredJson(item.variable_values, {}), basePrompt: item.base_prompt, negativePrompt: item.negative_prompt, createdAt: item.created_at, updatedAt: item.updated_at }));
          }
          if (kind === 'all' || kind === 'inspirations') {
              const rows = await db.prepare(`SELECT id, title, prompt, negative_prompt, params, board_id, notes, tags, source_type, source_id, source_url, rating, is_pinned, archived, last_used_at, use_count, parent_id, analysis, created_at, updated_at FROM inspirations ORDER BY is_pinned DESC, created_at DESC`).all<any>();
              output.inspirations = rows.results.map((item: any) => ({
                id: item.id, title: item.title, prompt: item.prompt, negativePrompt: item.negative_prompt,
                params: parseStoredJson(item.params, undefined), boardId: item.board_id, notes: item.notes || '',
                tags: parseStoredJson(item.tags, []), sourceType: item.source_type, sourceId: item.source_id,
                sourceUrl: item.source_url, rating: Number(item.rating || 0), isPinned: Number(item.is_pinned || 0) === 1,
                archived: Number(item.archived || 0) === 1, lastUsedAt: item.last_used_at, useCount: Number(item.use_count || 0),
                parentId: item.parent_id, analysis: parseStoredJson(item.analysis, {}), createdAt: item.created_at, updatedAt: item.updated_at,
              }));
          }
          if (kind === 'all' || kind === 'artists') {
              const rows = await db.prepare(`SELECT id, name, benchmarks FROM artists ORDER BY name ASC`).all<any>();
              output.artists = rows.results.map((item: any) => ({ id: item.id, name: item.name, benchmarks: parseStoredJson(item.benchmarks, []).length }));
          }
          return json(output);
      }


      // --- Authenticated Logic ---
      const currentUser = await getLocalOwner(db);

      if (
        path.startsWith('/api/users') ||
        path.startsWith('/api/admin/stats') ||
        path.startsWith('/api/admin/guest-setting') ||
        path.startsWith('/api/admin/logs') ||
        path.startsWith('/api/admin/clear-logs') ||
        path === '/api/client-logs'
      ) {
        return error('Account management is disabled in personal mode', 410);
      }

      // --- Local Anlas budget tracker ---
      if (path === '/api/anlas-budget') {
        const key = 'anlas_budget_remaining_v1';
        const defaultBudget = 1666;
        await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, String(defaultBudget)).run();

        if (method === 'GET') {
          const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{value: string}>();
          return json({ remaining: Math.max(0, Number.parseInt(row?.value || String(defaultBudget), 10) || 0) });
        }
        if (method === 'PUT') {
          const body = await request.json() as any;
          const remaining = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(body.remaining))));
          if (!Number.isFinite(remaining)) return error('点数必须是有效整数', 400);
          await db.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(String(remaining), key).run();
          return json({ remaining, updatedAt: Date.now() });
        }
        if (method === 'POST') {
          const body = await request.json() as any;
          const amount = Math.max(0, Math.min(1_000_000, Math.floor(Number(body.amount))));
          if (!Number.isFinite(amount)) return error('扣除点数必须是有效整数', 400);
          await db.prepare(`UPDATE settings
            SET value = CAST(MAX(0, CAST(value AS INTEGER) - ?) AS TEXT)
            WHERE key = ?`).bind(amount, key).run();
          const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{value: string}>();
          return json({ remaining: Math.max(0, Number.parseInt(row?.value || '0', 10) || 0), spent: amount, updatedAt: Date.now() });
        }
        return error('Method not allowed', 405);
      }

      // --- Precise/Character Reference image library ---
      if (path.startsWith('/api/character-references')) {
        if (!env.BUCKET) return error('角色参考图本地存储不可用', 503);
        await ensureCharacterReferenceSchema(db);

        if (path === '/api/character-references' && method === 'GET') {
          const includeArchived = url.searchParams.get('archived') === 'true';
          const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
          const rows = query
            ? await db.prepare(`SELECT * FROM character_reference_assets
                WHERE archived = ? AND LOWER(name) LIKE ? ORDER BY updated_at DESC`)
                .bind(includeArchived ? 1 : 0, `%${query}%`).all<any>()
            : await db.prepare(`SELECT * FROM character_reference_assets
                WHERE archived = ? ORDER BY updated_at DESC`)
                .bind(includeArchived ? 1 : 0).all<any>();
          return json({ items: rows.results.map(mapCharacterReferenceAsset) });
        }

        if (path === '/api/character-references' && method === 'POST') {
          const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
          const form = multipart ? await request.formData() : null;
          const body = multipart ? { name: String(form?.get('name') || '') } : await request.json() as any;
          let original;
          try { original = multipart ? await parseUploadedImage(form?.get('image') || null) : parseImageData(body.imageData); } catch (e: any) { return error(e.message, 400); }
          const sourceHash = await sha256Hex(original.bytes);
          const existing = await db.prepare('SELECT * FROM character_reference_assets WHERE source_hash = ?')
            .bind(sourceHash).first<any>();
          if (existing) {
            if (existing.archived === 1) {
              const now = Date.now();
              await db.prepare('UPDATE character_reference_assets SET archived = 0, updated_at = ? WHERE id = ?')
                .bind(now, existing.id).run();
              existing.archived = 0;
              existing.updated_at = now;
            }
            return json({ item: mapCharacterReferenceAsset(existing), duplicate: true });
          }

          const id = crypto.randomUUID();
          const now = Date.now();
          const originalKey = `character-references/originals/${id}.${original.format}`;
          await env.BUCKET.put(originalKey, exactArrayBuffer(original.bytes), {
            httpMetadata: { contentType: original.contentType },
          });

          let thumbnailKey: string | null = null;
          let thumbnailType: string | null = null;
          if (multipart ? form?.get('thumbnail') instanceof File : body.thumbnailData) {
            try {
              const thumbnail = multipart
                ? await parseUploadedImage(form?.get('thumbnail') || null, 2 * 1024 * 1024)
                : parseImageData(body.thumbnailData);
              if (thumbnail.bytes.length <= 2 * 1024 * 1024) {
                thumbnailKey = `character-references/thumbnails/${id}.${thumbnail.format}`;
                thumbnailType = thumbnail.contentType;
                await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), {
                  httpMetadata: { contentType: thumbnailType },
                });
              }
            } catch { /* A failed optional thumbnail must not discard the original. */ }
          }

          const name = String(body.name || `角色参考 ${sourceHash.slice(0, 8)}`).trim().slice(0, 100)
            || `角色参考 ${sourceHash.slice(0, 8)}`;
          await db.prepare(`INSERT INTO character_reference_assets
            (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type,
             default_strength, default_fidelity, archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
            .bind(id, name, sourceHash, originalKey, original.contentType, thumbnailKey, thumbnailType, 0.6, 0.6, now, now).run();
          const created = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
          return json({ item: mapCharacterReferenceAsset(created) }, 201);
        }

        const imageMatch = path.match(/^\/api\/character-references\/([^/]+)\/image$/);
        if (imageMatch && method === 'GET') {
          const row = await db.prepare('SELECT original_key, original_type FROM character_reference_assets WHERE id = ?')
            .bind(decodeURIComponent(imageMatch[1])).first<any>();
          if (!row) return error('角色参考图不存在', 404);
          const object = await env.BUCKET.get(row.original_key);
          if (!object) return error('角色参考图文件不存在', 404);
          return new Response(object.body, { headers: {
            'Content-Type': row.original_type || 'image/png',
            'Cache-Control': 'private, max-age=31536000, immutable',
            'ETag': object.httpEtag,
          }});
        }

        const thumbnailMatch = path.match(/^\/api\/character-references\/([^/]+)\/thumbnail$/);
        if (thumbnailMatch && method === 'GET') {
          const row = await db.prepare(`SELECT thumbnail_key, thumbnail_type, original_key, original_type
            FROM character_reference_assets WHERE id = ?`)
            .bind(decodeURIComponent(thumbnailMatch[1])).first<any>();
          if (!row) return error('角色参考图不存在', 404);
          const key = row.thumbnail_key || row.original_key;
          const object = await env.BUCKET.get(key);
          if (!object) return error('角色参考图缩略图文件不存在', 404);
          return new Response(object.body, { headers: {
            'Content-Type': row.thumbnail_key ? (row.thumbnail_type || 'image/webp') : (row.original_type || 'image/png'),
            'Cache-Control': 'private, max-age=31536000, immutable',
            'ETag': object.httpEtag,
          }});
        }

        const archiveMatch = path.match(/^\/api\/character-references\/([^/]+)\/(archive|restore)$/);
        if (archiveMatch && method === 'POST') {
          const id = decodeURIComponent(archiveMatch[1]);
          const existing = await db.prepare('SELECT id FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
          if (!existing) return error('角色参考图不存在', 404);
          await db.prepare('UPDATE character_reference_assets SET archived = ?, updated_at = ? WHERE id = ?')
            .bind(archiveMatch[2] === 'archive' ? 1 : 0, Date.now(), id).run();
          return json({ success: true });
        }

        const assetMatch = path.match(/^\/api\/character-references\/([^/]+)$/);
        if (assetMatch && method === 'GET') {
          const row = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?')
            .bind(decodeURIComponent(assetMatch[1])).first<any>();
          if (!row) return error('角色参考图不存在', 404);
          return json({ item: mapCharacterReferenceAsset(row) });
        }
        if (assetMatch && method === 'PUT') {
          const id = decodeURIComponent(assetMatch[1]);
          const existing = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
          if (!existing) return error('角色参考图不存在', 404);
          const body = await request.json() as any;
          const name = String(body.name || '').trim().slice(0, 100);
          if (!name) return error('角色参考图名称不能为空', 400);
          const requestedStrength = body.defaultStrength === undefined
            ? Number(existing.default_strength ?? 0.6)
            : Number(body.defaultStrength);
          if (!Number.isFinite(requestedStrength) || requestedStrength < -1 || requestedStrength > 2) {
            return error('默认强度必须在 -1 到 2 之间', 400);
          }
          const requestedFidelity = body.defaultFidelity === undefined
            ? Number(existing.default_fidelity ?? 0.6)
            : Number(body.defaultFidelity);
          if (!Number.isFinite(requestedFidelity) || requestedFidelity < -1 || requestedFidelity > 2) {
            return error('默认保真度必须在 -1 到 2 之间', 400);
          }
          await db.prepare(`UPDATE character_reference_assets
            SET name = ?, default_strength = ?, default_fidelity = ?, updated_at = ? WHERE id = ?`)
            .bind(name, requestedStrength, requestedFidelity, Date.now(), id).run();
          const updated = await db.prepare('SELECT * FROM character_reference_assets WHERE id = ?').bind(id).first<any>();
          return json({ item: mapCharacterReferenceAsset(updated) });
        }

        return error('角色参考图接口不存在', 404);
      }

      // --- Permanent Vibe Transfer library ---
      if (path.startsWith('/api/vibes') || path.startsWith('/api/vibe-groups')) {
        if (!env.BUCKET) return error('Vibe 本地存储不可用', 503);
        await ensureVibeSchema(db);

        if (path === '/api/vibes' && method === 'GET') {
          const includeArchived = url.searchParams.get('archived') === 'true';
          const query = String(url.searchParams.get('q') || '').trim();
          const rows = query
            ? await db.prepare(`SELECT * FROM vibe_assets WHERE archived = ? AND LOWER(name) LIKE ? ORDER BY updated_at DESC`)
                .bind(includeArchived ? 1 : 0, `%${query.toLowerCase()}%`).all<any>()
            : await db.prepare('SELECT * FROM vibe_assets WHERE archived = ? ORDER BY updated_at DESC')
                .bind(includeArchived ? 1 : 0).all<any>();
          const vibeIds = rows.results.map(row => row.id);
          const encodingsByVibe = new Map<string, any[]>();
          for (let offset = 0; offset < vibeIds.length; offset += 80) {
            const batchIds = vibeIds.slice(offset, offset + 80);
            const placeholders = batchIds.map(() => '?').join(',');
            const encodings = await db.prepare(`SELECT * FROM vibe_encodings WHERE vibe_id IN (${placeholders}) ORDER BY information_extracted DESC`)
              .bind(...batchIds).all<any>();
            for (const encoding of encodings.results) {
              const grouped = encodingsByVibe.get(encoding.vibe_id) || [];
              grouped.push(encoding);
              encodingsByVibe.set(encoding.vibe_id, grouped);
            }
          }
          return json({ items: await Promise.all(rows.results.map(row => mapVibeAsset(db, row, encodingsByVibe.get(row.id) || []))) });
        }

        if (path === '/api/vibes' && method === 'POST') {
          const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
          const form = multipart ? await request.formData() : null;
          const body = multipart ? { name: String(form?.get('name') || '') } : await request.json() as any;
          let parsed;
          try { parsed = multipart ? await parseUploadedImage(form?.get('image') || null) : parseImageData(body.imageData); } catch (e: any) { return error(e.message, 400); }
          const sourceHash = await sha256Hex(parsed.bytes);
          const existing = await db.prepare('SELECT * FROM vibe_assets WHERE source_hash = ?').bind(sourceHash).first<any>();
          if (existing) {
            if (existing.archived === 1) {
              await db.prepare('UPDATE vibe_assets SET archived = 0, updated_at = ? WHERE id = ?').bind(Date.now(), existing.id).run();
              existing.archived = 0;
            }
            return json({ item: await mapVibeAsset(db, existing), duplicate: true });
          }
          const id = crypto.randomUUID();
          const now = Date.now();
          const key = `vibes/originals/${id}.${parsed.format}`;
          await env.BUCKET.put(key, exactArrayBuffer(parsed.bytes), { httpMetadata: { contentType: parsed.contentType } });
          let thumbnailKey: string | null = null;
          let thumbnailType: string | null = null;
          if (multipart ? form?.get('thumbnail') instanceof File : body.thumbnailData) {
            try {
              const thumbnail = multipart
                ? await parseUploadedImage(form?.get('thumbnail') || null, 2 * 1024 * 1024)
                : parseImageData(body.thumbnailData);
              if (thumbnail.bytes.length <= 2 * 1024 * 1024) {
                thumbnailKey = `vibes/thumbnails/${id}.${thumbnail.format}`;
                thumbnailType = thumbnail.contentType;
                await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), { httpMetadata: { contentType: thumbnailType } });
              }
            } catch { /* The original remains usable if thumbnail creation failed. */ }
          }
          await db.prepare(`INSERT INTO vibe_assets
            (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type, default_strength, archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
            .bind(id, String(body.name || `Vibe ${sourceHash.slice(0, 8)}`).slice(0, 100), sourceHash, key, parsed.contentType, thumbnailKey, thumbnailType, 0.6, now, now).run();
          const row = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
          return json({ item: await mapVibeAsset(db, row) }, 201);
        }

        if (path === '/api/vibes/import' && method === 'POST') {
          const body = await request.json() as any;
          let document: any;
          try { document = typeof body.fileText === 'string' ? JSON.parse(body.fileText) : body.document; } catch { return error('Vibe 文件不是有效 JSON', 400); }
          if (document?.identifier !== 'novelai-vibe-transfer' || Number(document?.version) !== 1 || !document?.encodings || typeof document.encodings !== 'object') {
            return error('不是有效的 .naiv4vibe 文件', 400);
          }
          let original: {bytes: Uint8Array, format: string, contentType: string} | null = null;
          let thumbnail: {bytes: Uint8Array, format: string, contentType: string} | null = null;
          if (document.image) {
            const raw = String(document.image).replace(/^data:image\/[^;]+;base64,/i, '');
            try {
              const bytes = base64ToBytes(raw);
              const prefix = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpeg' : String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' ? 'webp' : '';
              if (!prefix) throw new Error();
              original = parseImageData(`data:image/${prefix};base64,${raw}`);
            } catch { return error('Vibe 文件中的原图无效', 400); }
          }
          if (document.thumbnail) {
            try {
              thumbnail = parseImageData(String(document.thumbnail));
              if (thumbnail.bytes.length > 2 * 1024 * 1024) return error('Vibe 文件中的缩略图过大', 400);
            } catch { return error('Vibe 文件中的缩略图无效', 400); }
          }
          const actualSourceHash = original ? await sha256Hex(original.bytes) : '';
          const declaredSourceHash = String(document.id || actualSourceHash).toLowerCase();
          if (!/^[a-f0-9]{64}$/.test(declaredSourceHash)) return error('Vibe 文件缺少有效的图片标识', 400);
          if (actualSourceHash && declaredSourceHash !== actualSourceHash) {
            // st-chatu8 and some official-compatible exporters hash the Base64 text,
            // while NAI Atelier hashes the decoded image bytes. Accept both,
            // then keep the byte hash as the canonical deduplication key.
            const rawImage = String(document.image).replace(/^data:image\/[^;]+;base64,/i, '');
            const textHashes = new Set([
              await sha256Hex(new TextEncoder().encode(rawImage)),
              await sha256Hex(new TextEncoder().encode(String(document.image))),
            ]);
            if (!textHashes.has(declaredSourceHash)) return error('Vibe 文件的原图哈希不匹配', 400);
          }
          const sourceHash = actualSourceHash || declaredSourceHash;
          let asset = await db.prepare('SELECT * FROM vibe_assets WHERE source_hash = ?').bind(sourceHash).first<any>();
          const id = asset?.id || crypto.randomUUID();
          const now = Date.now();
          if (!asset) {
            let originalKey: string | null = null;
            let originalType: string | null = null;
            let thumbnailKey: string | null = null;
            let thumbnailType: string | null = null;
            if (original) {
              originalKey = `vibes/originals/${id}.${original.format}`;
              originalType = original.contentType;
              await env.BUCKET.put(originalKey, exactArrayBuffer(original.bytes), { httpMetadata: { contentType: originalType } });
            }
            if (thumbnail) {
              thumbnailKey = `vibes/thumbnails/${id}.${thumbnail.format}`;
              thumbnailType = thumbnail.contentType;
              await env.BUCKET.put(thumbnailKey, exactArrayBuffer(thumbnail.bytes), { httpMetadata: { contentType: thumbnailType } });
            }
            await db.prepare(`INSERT INTO vibe_assets
              (id, name, source_hash, original_key, original_type, thumbnail_key, thumbnail_type, default_strength, archived, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
              .bind(id, String(document.name || `Vibe ${sourceHash.slice(0, 8)}`).slice(0, 100), sourceHash, originalKey, originalType, thumbnailKey, thumbnailType,
                Math.max(0, Math.min(1, Number(document.importInfo?.strength ?? 0.6))), now, now).run();
          }
          let imported = 0;
          for (const [modelKey, variants] of Object.entries(document.encodings as Record<string, any>)) {
            if (!variants || typeof variants !== 'object') continue;
            const model = modelKey === 'v4-5full' ? VIBE_MODEL : String(document.importInfo?.model || modelKey);
            for (const variant of Object.values(variants as Record<string, any>)) {
              const information = Number((variant as any)?.params?.information_extracted);
              const encoding = String((variant as any)?.encoding || '');
              if (!Number.isFinite(information) || information < 0 || information > 1 || !/^[A-Za-z0-9+/=]+$/.test(encoding)) continue;
              const bytes = base64ToBytes(encoding);
              if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) continue;
              const exists = await db.prepare('SELECT id FROM vibe_encodings WHERE vibe_id = ? AND model = ? AND information_extracted = ?')
                .bind(id, model, information).first<any>();
              if (exists) continue;
              const encodingId = crypto.randomUUID();
              const encodingKey = `vibes/encodings/${id}/${encodingId}.bin`;
              const encodingHash = await sha256Hex(bytes);
              await env.BUCKET.put(encodingKey, exactArrayBuffer(bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
              await db.prepare(`INSERT INTO vibe_encodings
                (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(encodingId, id, model, modelKey, information, encodingKey, encodingHash, now).run();
              imported++;
            }
          }
          if (!imported && !asset) return error('Vibe 文件中没有可用编码', 400);
          await db.prepare('UPDATE vibe_assets SET archived = 0, updated_at = ? WHERE id = ?').bind(now, id).run();
          asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(id).first<any>();
          return json({ item: await mapVibeAsset(db, asset), imported });
        }

        const imageMatch = path.match(/^\/api\/vibes\/([^/]+)\/image$/);
        if (imageMatch && method === 'GET') {
          const row = await db.prepare('SELECT original_key, original_type FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(imageMatch[1])).first<any>();
          if (!row?.original_key) return error('Vibe 原图不存在', 404);
          const object = await env.BUCKET.get(row.original_key);
          if (!object) return error('Vibe 原图文件不存在', 404);
          return new Response(object.body, { headers: { 'Content-Type': row.original_type || 'image/png', 'Cache-Control': 'private, max-age=3600' } });
        }

        const thumbnailMatch = path.match(/^\/api\/vibes\/([^/]+)\/thumbnail$/);
        if (thumbnailMatch && method === 'GET') {
          const row = await db.prepare('SELECT thumbnail_key, thumbnail_type, original_key, original_type FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(thumbnailMatch[1])).first<any>();
          const key = row?.thumbnail_key || row?.original_key;
          if (!key) return error('Vibe 缩略图不存在', 404);
          const object = await env.BUCKET.get(key);
          if (!object) return error('Vibe 缩略图文件不存在', 404);
          return new Response(object.body, { headers: { 'Content-Type': row.thumbnail_key ? (row.thumbnail_type || 'image/webp') : (row.original_type || 'image/png'), 'Cache-Control': 'private, max-age=3600' } });
        }

        const assetMatch = path.match(/^\/api\/vibes\/([^/]+)$/);
        if (assetMatch && method === 'GET') {
          const row = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(decodeURIComponent(assetMatch[1])).first<any>();
          if (!row) return error('Vibe 不存在', 404);
          return json({ item: await mapVibeAsset(db, row) });
        }
        if (assetMatch && method === 'PUT') {
          const vibeId = decodeURIComponent(assetMatch[1]);
          const body = await request.json() as any;
          const name = String(body.name || '').trim().slice(0, 100);
          if (!name) return error('Vibe 名称不能为空', 400);
          const defaultStrength = Math.max(0, Math.min(1, Number(body.defaultStrength ?? 0.6)));
          await db.prepare('UPDATE vibe_assets SET name = ?, default_strength = ?, updated_at = ? WHERE id = ?')
            .bind(name, defaultStrength, Date.now(), vibeId).run();
          const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
          if (!updated) return error('Vibe 不存在', 404);
          return json({ item: await mapVibeAsset(db, updated) });
        }

        const resultMatch = path.match(/^\/api\/vibes\/([^/]+)\/encoding-result$/);
        if (resultMatch && method === 'POST') {
          const vibeId = decodeURIComponent(resultMatch[1]);
          const body = await request.json() as any;
          const information = Math.round(Number(body.informationExtracted) * 100) / 100;
          if (!Number.isFinite(information) || information < 0 || information > 1) return error('信息提取量必须在 0 到 1 之间', 400);
          const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
          if (!asset) return error('Vibe 不存在', 404);
          const existing = await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? AND model = ? AND information_extracted = ?')
            .bind(vibeId, VIBE_MODEL, information).first<any>();
          if (existing) return json({ item: await mapVibeAsset(db, asset), duplicate: true });
          let bytes: Uint8Array;
          try { bytes = base64ToBytes(String(body.encodingBase64 || '')); } catch { return error('编码数据无效', 400); }
          if (bytes.length < 64 || bytes.length > 12 * 1024 * 1024) return error('NovelAI 返回的编码大小异常', 400);
          const encodingId = crypto.randomUUID();
          const key = `vibes/encodings/${vibeId}/${encodingId}.bin`;
          const hash = await sha256Hex(bytes);
          await env.BUCKET.put(key, exactArrayBuffer(bytes), { httpMetadata: { contentType: 'application/octet-stream' } });
          await db.prepare(`INSERT INTO vibe_encodings
            (id, vibe_id, model, model_key, information_extracted, encoding_key, encoding_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(encodingId, vibeId, VIBE_MODEL, VIBE_MODEL_KEY, information, key, hash, Date.now()).run();
          await db.prepare('UPDATE vibe_assets SET updated_at = ? WHERE id = ?').bind(Date.now(), vibeId).run();
          const updated = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
          return json({ item: await mapVibeAsset(db, updated) });
        }

        const encodingDataMatch = path.match(/^\/api\/vibes\/([^/]+)\/encodings\/([^/]+)\/data$/);
        if (encodingDataMatch && method === 'GET') {
          const vibeId = decodeURIComponent(encodingDataMatch[1]);
          const encodingId = decodeURIComponent(encodingDataMatch[2]);
          const row = await db.prepare('SELECT * FROM vibe_encodings WHERE id = ? AND vibe_id = ?').bind(encodingId, vibeId).first<any>();
          if (!row) return error('Vibe 编码不存在', 404);
          const object = await env.BUCKET.get(row.encoding_key);
          if (!object) return error('Vibe 编码文件不存在', 404);
          const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
          return json({ encoding: bytesToBase64(bytes), variant: mapVibeEncoding(row) });
        }

        const fileMatch = path.match(/^\/api\/vibes\/([^/]+)\/file$/);
        if (fileMatch && method === 'GET') {
          const vibeId = decodeURIComponent(fileMatch[1]);
          const asset = await db.prepare('SELECT * FROM vibe_assets WHERE id = ?').bind(vibeId).first<any>();
          if (!asset) return error('Vibe 不存在', 404);
          const rows = await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? ORDER BY created_at').bind(vibeId).all<any>();
          const encodings: Record<string, Record<string, any>> = {};
          for (const row of rows.results) {
            const object = await env.BUCKET.get(row.encoding_key);
            if (!object) continue;
            const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
            const paramsKey = await sha256Hex(new TextEncoder().encode(`information_extracted:${Number(row.information_extracted)}`));
            encodings[row.model_key] ||= {};
            encodings[row.model_key][paramsKey] = { encoding: bytesToBase64(bytes), params: { information_extracted: Number(row.information_extracted) } };
          }
          let image: string | undefined;
          let thumbnail: string | undefined;
          if (asset.original_key) {
            const object = await env.BUCKET.get(asset.original_key);
            if (object) image = bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer()));
          }
          if (asset.thumbnail_key) {
            const object = await env.BUCKET.get(asset.thumbnail_key);
            if (object) thumbnail = `data:${asset.thumbnail_type || 'image/webp'};base64,${bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer()))}`;
          }
          const preferred = rows.results.find(row => row.model === VIBE_MODEL) || rows.results[0];
          const document = {
            identifier: 'novelai-vibe-transfer', version: 1, type: 'image', image,
            id: asset.source_hash, encodings, name: asset.name, thumbnail,
            createdAt: Number(asset.created_at),
            importInfo: { model: preferred?.model || VIBE_MODEL, information_extracted: Number(preferred?.information_extracted ?? 1), strength: Number(asset.default_strength ?? 0.6) },
          };
          return new Response(JSON.stringify(document), { headers: {
            'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${asset.name}.naiv4vibe`)}`,
            'Cache-Control': 'private, no-store',
          }});
        }

        const archiveMatch = path.match(/^\/api\/vibes\/([^/]+)\/(archive|restore)$/);
        if (archiveMatch && method === 'POST') {
          await db.prepare('UPDATE vibe_assets SET archived = ?, updated_at = ? WHERE id = ?')
            .bind(archiveMatch[2] === 'archive' ? 1 : 0, Date.now(), decodeURIComponent(archiveMatch[1])).run();
          return json({ success: true });
        }

        if (path === '/api/vibe-groups' && method === 'GET') {
          const rows = await db.prepare('SELECT * FROM vibe_groups ORDER BY updated_at DESC').all<any>();
          return json({ items: rows.results.map(row => ({ id: row.id, name: row.name, slots: parseStoredJson(row.slots, []), normalizeStrengths: row.normalize_strengths === 1, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })) });
        }
        if (path === '/api/vibe-groups' && method === 'POST') {
          const body = await request.json() as any;
          const slots = Array.isArray(body.slots) ? body.slots.slice(0, 4) : [];
          if (!slots.length) return error('组合至少需要一个 Vibe', 400);
          const id = crypto.randomUUID(); const now = Date.now();
          await db.prepare('INSERT INTO vibe_groups (id, name, slots, normalize_strengths, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(id, String(body.name || '未命名组合').slice(0, 100), JSON.stringify(slots), body.normalizeStrengths === false ? 0 : 1, now, now).run();
          return json({ item: { id, name: String(body.name || '未命名组合').slice(0, 100), slots, normalizeStrengths: body.normalizeStrengths !== false, createdAt: now, updatedAt: now } }, 201);
        }
        const groupMatch = path.match(/^\/api\/vibe-groups\/([^/]+)$/);
        if (groupMatch && method === 'PUT') {
          const body = await request.json() as any;
          const slots = Array.isArray(body.slots) ? body.slots.slice(0, 4) : [];
          await db.prepare('UPDATE vibe_groups SET name = ?, slots = ?, normalize_strengths = ?, updated_at = ? WHERE id = ?')
            .bind(String(body.name || '未命名组合').slice(0, 100), JSON.stringify(slots), body.normalizeStrengths === false ? 0 : 1, Date.now(), decodeURIComponent(groupMatch[1])).run();
          return json({ success: true });
        }
        if (groupMatch && method === 'DELETE') {
          await db.prepare('DELETE FROM vibe_groups WHERE id = ?').bind(decodeURIComponent(groupMatch[1])).run();
          return json({ success: true });
        }
      }

      // --- Local-only generation history (D1 metadata + R2 images) ---
      if (path === '/api/integrations/st-chatu8/history/known' && method === 'POST') {
        if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
        await ensureLocalHistorySchema(db);
        const body = await request.json() as any;
        const ids = Array.isArray(body.externalIds)
          ? body.externalIds.slice(0, 1000).map((id: any) => String(id)).filter((id: string) => /^[a-f0-9]{64}$/i.test(id))
          : [];
        if (!ids.length) return json({ externalIds: [] });
        const placeholders = ids.map(() => '?').join(',');
        const rows = await db.prepare(`SELECT external_id FROM local_generation_history
          WHERE user_id = ? AND external_source = 'st-chatu8' AND external_id IN (${placeholders})`)
          .bind(currentUser.id, ...ids).all<{external_id: string}>();
        return json({ externalIds: rows.results.map(row => row.external_id) });
      }

      if (path === '/api/integrations/st-chatu8/history/import' && method === 'POST') {
        if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
        await ensureLocalHistorySchema(db);
        const body = await request.json() as any;
        const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
        if (!items.length) return json({ imported: 0, skipped: 0 });
        let imported = 0;
        let skipped = 0;
        for (const item of items) {
          const externalId = String(item?.externalId || '').trim();
          if (!/^[a-f0-9]{64}$/i.test(externalId)) { skipped++; continue; }
          const existing = await db.prepare(`SELECT id FROM local_generation_history
            WHERE user_id = ? AND external_source = 'st-chatu8' AND external_id = ?`)
            .bind(currentUser.id, externalId).first<{id: string}>();
          if (existing) { skipped++; continue; }
          const id = `st-chatu8-${externalId.slice(0, 32)}`;
          await db.prepare(`INSERT OR IGNORE INTO local_generation_history (
            id, user_id, image_key, image_type, prompt, negative_prompt, params,
            source_chain_id, source_chain_name, source_chain_type, external_source, external_id, created_at
          ) VALUES (?, ?, '', ?, ?, ?, ?, NULL, ?, 'playground', 'st-chatu8', ?, ?)`)
            .bind(
              id, currentUser.id, String(item.imageType || 'image/png'), String(item.prompt || ''),
              String(item.negativePrompt || ''), JSON.stringify(item.params || {}),
              String(item.sourceName || 'st-chatu8'), externalId, Number(item.createdAt || Date.now())
            ).run();
          imported++;
        }
        return json({ imported, skipped });
      }

      if (path === '/api/local-history/status' && method === 'GET') {
        const enabled = localHistoryEnabled(env) && Boolean(env.BUCKET);
        if (enabled) await ensureLocalHistorySchema(db);
        return json({ enabled });
      }

      if (path.startsWith('/api/local-history')) {
        if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
        if (!env.BUCKET) return error('Local history storage is unavailable', 503);
        await ensureLocalHistorySchema(db);
        await ensureInspirationSchema(db);

        const deleteHistoryRows = async (rows: Array<{id: string, image_key: string}>) => {
          for (const row of rows) {
            if (row.image_key) {
              const reference = await db.prepare('SELECT COUNT(*) AS count FROM inspirations WHERE image_key = ?').bind(row.image_key).first<{count: number}>();
              if (Number(reference?.count || 0) === 0) await env.BUCKET!.delete(row.image_key);
            }
            await db.prepare('DELETE FROM local_generation_history WHERE id = ? AND user_id = ?')
              .bind(row.id, currentUser.id).run();
          }
          return rows.length;
        };

        if (path === '/api/local-history/media-index' && method === 'GET') {
          const page = clampInt(url.searchParams.get('page'), 0, 0, 1000000);
          const pageSize = clampInt(url.searchParams.get('pageSize'), 100, 1, 250);
          const includeCount = url.searchParams.get('includeCount') !== '0';
          const count = includeCount
            ? await db.prepare('SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?')
                .bind(currentUser.id).first<{count: number}>()
            : null;
          const result = await db.prepare(`
            SELECT id, external_source, external_id
            FROM local_generation_history
            WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(currentUser.id, pageSize, page * pageSize).all<any>();
          return json({
            items: result.results.map(row => ({ id: row.id, imageUrl: localHistoryImageUrl(row) })),
            ...(includeCount ? { count: Number(count?.count || 0) } : {}),
          });
        }

        const imageMatch = path.match(/^\/api\/local-history\/([^/]+)\/image$/);
        if (imageMatch && method === 'GET') {
          const id = decodeURIComponent(imageMatch[1]);
          const row = await db.prepare('SELECT image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<{image_key: string}>();
          if (!row) return error('History image not found', 404);
          if (!row.image_key) return error('External history image is served by the local gateway', 404);
          const object = await env.BUCKET.get(row.image_key);
          if (!object) return error('History image file not found', 404);
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Cache-Control', 'private, max-age=31536000, immutable');
          return new Response(object.body, { headers });
        }

        if (path === '/api/local-history' && method === 'GET') {
          const sourceChainId = url.searchParams.get('sourceChainId');
          if (sourceChainId) {
            const limit = clampInt(url.searchParams.get('limit'), 80, 1, 200);
            const result = await db.prepare(`
              SELECT * FROM local_generation_history
              WHERE user_id = ? AND source_chain_id = ?
              ORDER BY created_at DESC LIMIT ?
            `).bind(currentUser.id, sourceChainId, limit).all<any>();
            return json({ items: result.results.map(mapLocalHistoryRow) });
          }

          const page = clampInt(url.searchParams.get('page'), 0, 0, 1000000);
          const pageSize = clampInt(url.searchParams.get('pageSize'), 20, 1, 100);
          const from = Number(url.searchParams.get('from') || 0);
          const to = Number(url.searchParams.get('to') || 0);
          const includeCount = url.searchParams.get('includeCount') !== '0';
          const favoriteOnly = url.searchParams.get('favorite') === '1';
          const dateWhere = from || to ? ` AND created_at >= ? AND created_at <= ?` : '';
          const favoriteWhere = favoriteOnly ? ' AND COALESCE(is_favorite, 0) = 1' : '';
          const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
          const count = includeCount
            ? await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}${favoriteWhere}`)
                .bind(currentUser.id, ...dateValues).first<{count: number}>()
            : null;
          const result = await db.prepare(`
            SELECT * FROM local_generation_history
            WHERE user_id = ?${dateWhere}${favoriteWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(currentUser.id, ...dateValues, pageSize, page * pageSize).all<any>();
          return json({ items: result.results.map(mapLocalHistoryRow), ...(includeCount ? { count: Number(count?.count || 0) } : {}) });
        }

        if (path === '/api/local-history/count' && method === 'GET') {
          const from = Number(url.searchParams.get('from') || 0);
          const to = Number(url.searchParams.get('to') || 0);
          const favoriteOnly = url.searchParams.get('favorite') === '1';
          const dateWhere = from || to ? ' AND created_at >= ? AND created_at <= ?' : '';
          const favoriteWhere = favoriteOnly ? ' AND COALESCE(is_favorite, 0) = 1' : '';
          const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
          const result = await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}${favoriteWhere}`)
            .bind(currentUser.id, ...dateValues).first<{count: number}>();
          return json({ count: Number(result?.count || 0) });
        }

        if (path === '/api/local-history/favorites' && method === 'POST') {
          const body = await request.json() as any;
          const ids = Array.from(new Set(
            (Array.isArray(body.ids) ? body.ids : [])
              .slice(0, 200)
              .map((id: any) => String(id || '').trim())
              .filter(Boolean)
          )) as string[];
          if (!ids.length) return json({ updatedCount: 0 });
          const favorite = Boolean(body.favorite);
          const placeholders = ids.map(() => '?').join(',');
          const result = await db.prepare(`
            UPDATE local_generation_history
            SET is_favorite = ?, favorite_at = ?
            WHERE user_id = ? AND id IN (${placeholders})
          `).bind(favorite ? 1 : 0, favorite ? Date.now() : null, currentUser.id, ...ids).run();
          return json({ updatedCount: Number(result.meta?.changes || 0), favorite });
        }

        if (path === '/api/local-history' && method === 'POST') {
          const multipart = request.headers.get('Content-Type')?.includes('multipart/form-data');
          const form = multipart ? await request.formData() : null;
          let body: any;
          try {
            body = multipart ? JSON.parse(String(form?.get('metadata') || '{}')) : await request.json();
          } catch {
            return error('Invalid history metadata', 400);
          }
          const id = String(body.id || crypto.randomUUID());
          const hasStructuredInput = typeof body.basePrompt === 'string' ||
            typeof body.subjectPrompt === 'string' || Array.isArray(body.modules);
          let bytes: Uint8Array;
          let imageType: string;
          let extension: string;
          let width: number;
          let height: number;
          if (multipart) {
            let parsed;
            try { parsed = await parseUploadedImage(form?.get('image') || null, MAX_MANAGED_IMAGE_BYTES); } catch (e: any) { return error(e.message, 400); }
            bytes = parsed.bytes;
            imageType = parsed.contentType;
            extension = parsed.format;
            width = parsed.width;
            height = parsed.height;
          } else {
            let parsed;
            try { parsed = parseImageData(String(body.imageUrl || '')); } catch (e: any) { return error(e.message, 400); }
            bytes = parsed.bytes;
            imageType = parsed.contentType;
            extension = parsed.format;
            width = parsed.width;
            height = parsed.height;
          }
          if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) {
            return error(`历史图片不能超过 ${Math.floor(MAX_MANAGED_IMAGE_BYTES / 1024 / 1024)}MB`, 413);
          }
          // 以图片真实尺寸为准覆盖宽高；保留 steps/scale/sampler/seed 等其他生成参数
          const rawParams = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
          const normalizedParams = { ...rawParams, width, height };
          const imageKey = `local-history/${currentUser.id}/${id}.${extension}`;
          const existing = await db.prepare('SELECT image_key, is_favorite, favorite_at FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<{image_key: string, is_favorite: number, favorite_at: number | null}>();
          const isFavorite = body.isFavorite === undefined ? Number(existing?.is_favorite || 0) === 1 : Boolean(body.isFavorite);
          const favoriteAt = isFavorite ? Number(body.favoriteAt || existing?.favorite_at || Date.now()) : null;

          await env.BUCKET.put(imageKey, exactArrayBuffer(bytes), { httpMetadata: { contentType: imageType } });
          await db.prepare(`
            INSERT OR REPLACE INTO local_generation_history (
              id, user_id, image_key, image_type, prompt, negative_prompt, params,
              base_prompt, subject_prompt, modules, structure_version,
              source_chain_id, source_chain_name, source_chain_type, is_favorite, favorite_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id, currentUser.id, imageKey, imageType, body.prompt || '', body.negativePrompt || '',
            JSON.stringify(normalizedParams), body.basePrompt || '', body.subjectPrompt || '', JSON.stringify(body.modules || []),
            hasStructuredInput ? 1 : 0,
            body.sourceChainId || null, body.sourceChainName || null, body.sourceChainType || null,
            isFavorite ? 1 : 0, favoriteAt,
            Number(body.createdAt || Date.now())
          ).run();
          if (existing?.image_key && existing.image_key !== imageKey) await env.BUCKET.delete(existing.image_key);
          return json({ item: mapLocalHistoryRow({
            id, image_key: imageKey, prompt: body.prompt, negative_prompt: body.negativePrompt,
            params: JSON.stringify(normalizedParams), base_prompt: body.basePrompt, subject_prompt: body.subjectPrompt,
            modules: JSON.stringify(body.modules || []), structure_version: hasStructuredInput ? 1 : 0, source_chain_id: body.sourceChainId,
            source_chain_name: body.sourceChainName, source_chain_type: body.sourceChainType,
            is_favorite: isFavorite ? 1 : 0, favorite_at: favoriteAt,
            created_at: Number(body.createdAt || Date.now())
          }) });
        }

        if (path === '/api/local-history' && method === 'DELETE') {
          const result = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE user_id = ?')
            .bind(currentUser.id).all<{id: string, image_key: string}>();
          return json({ deletedCount: await deleteHistoryRows(result.results) });
        }

        if (path === '/api/local-history/cleanup' && method === 'POST') {
          const body = await request.json() as any;
          let result: D1Result<{id: string, image_key: string}>;
          if (Number.isFinite(body.days)) {
            const cutoff = Date.now() - Math.max(1, Math.floor(body.days)) * 86400000;
            result = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE user_id = ? AND created_at < ?')
              .bind(currentUser.id, cutoff).all<{id: string, image_key: string}>();
          } else {
            const keepCount = Math.max(1, Math.floor(Number(body.keepCount || 1)));
            result = await db.prepare(`
              SELECT id, image_key FROM local_generation_history WHERE user_id = ?
              ORDER BY created_at DESC LIMIT -1 OFFSET ?
            `).bind(currentUser.id, keepCount).all<{id: string, image_key: string}>();
          }
          return json({ deletedCount: await deleteHistoryRows(result.results) });
        }

        if (path === '/api/local-history/count-older' && method === 'GET') {
          const days = clampInt(url.searchParams.get('days'), 7, 1, 36500);
          const cutoff = Date.now() - days * 86400000;
          const result = await db.prepare('SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ? AND created_at < ?')
            .bind(currentUser.id, cutoff).first<{count: number}>();
          return json({ count: Number(result?.count || 0) });
        }

        if (path === '/api/local-history/unlink-source' && method === 'POST') {
          const { sourceChainId } = await request.json() as any;
          const result = await db.prepare(`
            UPDATE local_generation_history SET source_chain_id = NULL, source_chain_name = NULL, source_chain_type = NULL
            WHERE user_id = ? AND source_chain_id = ?
          `).bind(currentUser.id, sourceChainId).run();
          return json({ count: Number(result.meta?.changes || 0) });
        }

        const unlinkMatch = path.match(/^\/api\/local-history\/([^/]+)\/unlink$/);
        if (unlinkMatch && method === 'PUT') {
          const id = decodeURIComponent(unlinkMatch[1]);
          await db.prepare(`
            UPDATE local_generation_history SET source_chain_id = NULL, source_chain_name = NULL, source_chain_type = NULL
            WHERE id = ? AND user_id = ?
          `).bind(id, currentUser.id).run();
          const row = await db.prepare('SELECT * FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<any>();
          return json({ item: row ? mapLocalHistoryRow(row) : null });
        }

        const deleteMatch = path.match(/^\/api\/local-history\/([^/]+)$/);
        if (deleteMatch && method === 'DELETE') {
          const id = decodeURIComponent(deleteMatch[1]);
          const row = await db.prepare('SELECT id, image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<{id: string, image_key: string}>();
          if (row) await deleteHistoryRows([row]);
          return json({ success: true });
        }
      }

      if (path === '/api/danbooru/posts' && method === 'GET') {
        try {
          const page = clampInt(url.searchParams.get('page'), 1, 1, 1000);
          const limit = clampInt(url.searchParams.get('limit'), 40, 1, DANBOORU_MAX_PAGE_SIZE);
          const query = normalizeDanbooruQuery(url.searchParams.get('tags'));
          const target = new URL('/posts.json', DANBOORU_BASE_URL);
          target.searchParams.set('tags', query);
          target.searchParams.set('page', String(page));
          target.searchParams.set('limit', String(limit));
          const payload = await fetchDanbooruJson(target, env);
          const items = (Array.isArray(payload) ? payload : [])
            .map(normalizeDanbooruPost)
            .filter(Boolean);
          return json({ items, page, limit, query, hasMore: Array.isArray(payload) && payload.length >= limit }, 200, {
            'Cache-Control': 'private, max-age=120',
          });
        } catch (e: any) {
          return error(e?.message || 'Danbooru 查询失败', Number(e?.status) >= 400 && Number(e?.status) < 500 ? Number(e.status) : 502);
        }
      }

      if (path === '/api/aitag/cache/status' && method === 'GET') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const sort = normalizeAitagSort(url.searchParams.get('sort'));
        const timeRange = normalizeAitagTimeRange(url.searchParams.get('time_range'), sort);
        const aiType = normalizeAitagAiTypeFilter(url.searchParams.get('aiType'));
        return json(await getAitagCacheStatus(db, sort, timeRange, aiType));
      }

      if (path === '/api/aitag/months' && method === 'GET') {
        try {
          const config = await fetchAitagConfig(env);
          const months = Array.isArray(config?.available_months)
            ? config.available_months
                .map((month: any) => String(month || '').trim())
                .filter((month: string) => /^\d{4}-\d{2}$/.test(month))
            : [];
          return json({
            months,
            availableMonths: months,
            years: Array.isArray(config?.available_years) ? config.available_years : [],
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e: any) {
          return error(e?.message || 'Failed to fetch aitag months', 502);
        }
      }

      if (path === '/api/aitag/cache/first-images' && method === 'GET') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const sort = normalizeAitagSort(url.searchParams.get('sort'));
        const timeRange = normalizeAitagTimeRange(url.searchParams.get('time_range'), sort);
        const sourceSort = getAitagSourceSort(sort, timeRange);
        const ids = (url.searchParams.get('ids') || '')
          .split(',')
          .map(id => Number(id.trim()))
          .filter(Number.isFinite)
          .slice(0, AITAG_MAX_PAGE_SIZE);
        const timeoutMs = clampInt(url.searchParams.get('timeout_ms'), 4500, 0, 15000);
        const intervalMs = clampInt(url.searchParams.get('interval_ms'), 700, 250, 2500);
        const result = await waitForAitagFirstImageUpdates(db, {
          ids,
          sort: sourceSort,
          timeoutMs,
          intervalMs,
        });
        return json({
          ...result,
          status: await getAitagCacheStatus(db, sort, timeRange, normalizeAitagAiTypeFilter(url.searchParams.get('aiType'))),
          source: 'cache',
        }, 200, { 'Cache-Control': 'no-store' });
      }

      if (path === '/api/aitag/cache/search' && method === 'GET') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const sort = normalizeAitagSort(url.searchParams.get('sort'));
        const timeRange = normalizeAitagTimeRange(url.searchParams.get('time_range'), sort);
        const sourceSort = getAitagSourceSort(sort, timeRange);
        const page = clampInt(url.searchParams.get('page'), 1, 1, 100000);
        const pageSize = clampInt(url.searchParams.get('page_size'), AITAG_MAX_PAGE_SIZE, 1, AITAG_MAX_PAGE_SIZE);
        const aiType = normalizeAitagAiTypeFilter(url.searchParams.get('aiType'));
        const cacheFilter = normalizeAitagCacheFilter(url.searchParams.get('cacheFilter'));
        const searchResult = await searchAitagCache(db, {
          page,
          pageSize,
          sort: sourceSort,
          aiType,
          cacheFilter,
          q: url.searchParams.get('q') || '',
          prompt: url.searchParams.get('prompt') || '',
        });
        return json({
          ...searchResult,
          status: await getAitagCacheStatus(db, sort, timeRange, normalizeAitagAiTypeFilter(url.searchParams.get('statusAiType') || url.searchParams.get('aiType'))),
          source: 'cache',
        });
      }

      const favoriteMatch = path.match(/^\/api\/aitag\/work\/(\d+)\/favorite$/);
      if (favoriteMatch && method === 'POST') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const workId = Number(favoriteMatch[1]);
        const body = await request.json().catch(() => ({})) as any;
        const sort = normalizeAitagSort(body.sort || url.searchParams.get('sort'));
        const timeRange = normalizeAitagTimeRange(body.timeRange || body.time_range || url.searchParams.get('time_range'), sort);
        const sourceSort = getAitagSourceSort(sort, timeRange);
        const isFavorite = Boolean(body.favorite);
        const now = Date.now();

        await db.prepare(`
          UPDATE aitag_works
          SET is_favorite = ?, favorite_at = ?, updated_at = ?
          WHERE id = ? AND source_sort = ?
        `).bind(isFavorite ? 1 : 0, isFavorite ? now : null, now, workId, sourceSort).run();

        const item = (await getCachedAitagWorksByIds(db, [workId], sourceSort))[0];
        if (!item) return error('Aitag work not found in local cache', 404);


        return json({ item, isFavorite });
      }

      if (path === '/api/aitag/cache/index' && method === 'POST') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const body = await request.json().catch(() => ({})) as any;
        const sort = normalizeAitagSort(body.sort || url.searchParams.get('sort'));
        const timeRange = String(body.timeRange || body.time_range || 'all').slice(0, 32);
        const aiType = normalizeAitagAiTypeFilter(body.aiType || body.ai_type || url.searchParams.get('aiType'));
        const targetPages = Math.max(1, Math.min(10000, Number.parseInt(String(body.targetPages || body.target_pages || AITAG_CACHE_DEFAULT_TARGET_PAGES), 10) || AITAG_CACHE_DEFAULT_TARGET_PAGES));
        await upsertAitagIndexState(db, {
          sort,
          timeRange,
          aiType,
          targetPages,
          status: 'running',
          paused: false,
        });
        const status = await runAitagIndexBatch(env, db, { sort, timeRange, aiType, maxPages: AITAG_CACHE_BATCH_PAGES });
        return json(status);
      }

      if (path === '/api/aitag/cache/pause' && method === 'POST') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const body = await request.json().catch(() => ({})) as any;
        const sort = normalizeAitagSort(body.sort || url.searchParams.get('sort'));
        const timeRange = String(body.timeRange || body.time_range || 'all').slice(0, 32);
        const aiType = normalizeAitagAiTypeFilter(body.aiType || body.ai_type || url.searchParams.get('aiType'));
        const key = getAitagStateKey(sort, timeRange, aiType);
        await db.prepare(`
          INSERT INTO aitag_index_state (key, source_sort, time_range, status, paused, target_pages, page_size, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET status = excluded.status, paused = 1, updated_at = excluded.updated_at
        `).bind(key, sort, timeRange, 'paused', AITAG_CACHE_DEFAULT_TARGET_PAGES, AITAG_MAX_PAGE_SIZE, Date.now()).run();
        return json(await getAitagCacheStatus(db, sort, timeRange, aiType));
      }

      if (path === '/api/aitag/cache/resume' && method === 'POST') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const body = await request.json().catch(() => ({})) as any;
        const sort = normalizeAitagSort(body.sort || url.searchParams.get('sort'));
        const timeRange = String(body.timeRange || body.time_range || 'all').slice(0, 32);
        const aiType = normalizeAitagAiTypeFilter(body.aiType || body.ai_type || url.searchParams.get('aiType'));
        const existing = await getAitagIndexState(db, sort, timeRange, aiType);
        await upsertAitagIndexState(db, {
          sort,
          timeRange,
          aiType,
          targetPages: Number(body.targetPages || body.target_pages || existing?.target_pages || AITAG_CACHE_DEFAULT_TARGET_PAGES),
          status: 'running',
          paused: false,
        });
        return json(await runAitagIndexBatch(env, db, { sort, timeRange, aiType, maxPages: AITAG_CACHE_BATCH_PAGES }));
      }

      if (path === '/api/aitag/search' && method === 'GET') {
        const startedAt = Date.now();
        try {
          try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
          const sort = normalizeAitagSort(url.searchParams.get('sort'));
          const timeRange = normalizeAitagTimeRange(url.searchParams.get('time_range'), sort);
          const sourceSort = getAitagSourceSort(sort, timeRange);
          const aiType = normalizeAitagAiTypeFilter(url.searchParams.get('aiType'));
          const page = clampInt(url.searchParams.get('page'), 1, 1, 10000);
          const pageSize = clampInt(url.searchParams.get('page_size'), AITAG_MIN_PAGE_SIZE, AITAG_MIN_PAGE_SIZE, AITAG_MAX_PAGE_SIZE);
          const sourceUrl = new URL(url.toString());
          const mergedQuery = mergeAitagQueryWithAiType(sourceUrl.searchParams.get('q') || '', aiType);
          if (mergedQuery) sourceUrl.searchParams.set('q', mergedQuery);
          else sourceUrl.searchParams.delete('q');
          const data = await fetchAitagJson(buildAitagSearchUrl(sourceUrl), env);
          const normalized = await cacheAitagWorks(db, data, {
            sort,
            page,
            pageSize,
            timeRange,
          });
          const cachedItems = await getCachedAitagWorksByIds(db, normalized.items.map((item: any) => Number(item.id)), sourceSort);
          const responsePayload = {
            ...normalized,
            items: cachedItems.length === normalized.items.length ? cachedItems : normalized.items,
          };
          const firstImageTask = cacheAitagFirstImagesForWorks(env, db, normalized.items, sourceSort)
            .catch(e => console.error('Aitag first image cache task failed', e));
          if (ctx?.waitUntil) ctx.waitUntil(firstImageTask);
          return json({
            ...responsePayload,
            status: await getAitagCacheStatus(db, sort, timeRange, aiType),
            source: 'remote',
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e: any) {
          throw e;
        }
      }

      if (path.startsWith('/api/aitag/work/') && method === 'GET') {
        const startedAt = Date.now();
        const target = buildAitagWorkUrl(path);
        if (!target) return error('Invalid aitag work id', 400);
        const workId = path.split('/').pop();
        try {
          try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
          const cached = await getCachedAitagDetail(db, Number(workId));
          if (cached) {
            const cacheInfo = getAitagDetailCacheInfo(cached);
            if (!cacheInfo.hasFullyCachedImages) {
              const upgradeTask = cacheAitagDetail(env, db, cached);
              if (ctx?.waitUntil) ctx.waitUntil(upgradeTask);
              else upgradeTask.catch(console.error);
            }
            return json(cached, 200, { 'Cache-Control': 'no-store' });
          }

          const detail = await fetchAitagJson(target, env);
          const cachedDetail = await cacheAitagDetailFirstImageOnly(env, db, detail);
          const backgroundCacheTask = cacheAitagDetail(env, db, cachedDetail);
          if (ctx?.waitUntil) ctx.waitUntil(backgroundCacheTask);
          else backgroundCacheTask.catch(console.error);
          return json(cachedDetail, 200, { 'Cache-Control': 'no-store' });
        } catch (e: any) {
          throw e;
        }
      }

      if (path === '/api/client-logs' && method === 'POST') {
        const body = await request.json() as any;
        return json({ success: true });
      }

      // --- ADMIN: Global Settings (Benchmark Config) ---
      if (path === '/api/config/benchmarks' && method === 'PUT') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { config } = await request.json() as any;
          await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('benchmark_config', JSON.stringify(config)).run();
          return json({ success: true });
      }

      // --- Admin Guest Setting ---
      if (path === '/api/admin/guest-setting' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          let guest = await db.prepare('SELECT password FROM users WHERE role = ?').bind('guest').first<{password: string}>();
          if (!guest) { await initDB(); guest = await db.prepare('SELECT password FROM users WHERE role = ?').bind('guest').first<{password: string}>(); }
          return json({ passcode: guest?.password });
      }
      if (path === '/api/admin/guest-setting' && method === 'PUT') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { passcode } = await request.json() as any;
          await db.prepare('UPDATE users SET password = ? WHERE role = ?').bind(passcode, 'guest').run();
          return json({ success: true });
      }

      // --- ADMIN: Usage Statistics ---
      if (path === '/api/admin/stats' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          await ensureAccessLogsSchema(db);
          
          // 近 30 天的每日统计
          const dailyStatsResult = await db.prepare(`
              SELECT * FROM daily_stats 
              WHERE date >= date('now', '-30 days')
              ORDER BY date DESC
          `).all();
          
          // 最近 50 条登录日志
          const recentLogsResult = await db.prepare(`
              SELECT * FROM access_logs 
              ORDER BY created_at DESC 
              LIMIT 50
          `).all();
          
          // 存储统计
          const userStorageStats = await db.prepare(`
              SELECT SUM(storage_usage) as total_storage, COUNT(*) as user_count 
              FROM users WHERE role != 'guest'
          `).first<{total_storage: number, user_count: number}>();
          
          const chainsCount = await db.prepare('SELECT COUNT(*) as count FROM chains').first<{count: number}>();
          const inspirationsCount = await db.prepare('SELECT COUNT(*) as count FROM inspirations').first<{count: number}>();
          const artistsCount = await db.prepare('SELECT COUNT(*) as count FROM artists').first<{count: number}>();
          
          return json({
              dailyStats: dailyStatsResult.results.map((s: any) => ({
                  date: s.date,
                  totalRequests: s.total_requests || 0,
                  apiRequests: s.api_requests || 0,
                  guestLogins: s.guest_logins || 0,
                  userLogins: s.user_logins || 0,
                  generateRequests: s.generate_requests || 0
              })),
              recentLogs: recentLogsResult.results.map((l: any) => ({
                  id: l.id,
                  userId: l.user_id,
                  username: l.username,
                  role: l.role,
                  ip: l.ip,
                  userAgent: l.user_agent,
                  action: l.action,
                  category: l.category || 'auth',
                  status: l.status || 'success',
                  method: l.method,
                  path: l.path,
                  resourceType: l.resource_type,
                  resourceId: l.resource_id,
                  message: l.message,
                  metadata: l.metadata,
                  durationMs: l.duration_ms,
                  createdAt: l.created_at
              })),
              storage: {
                  totalUserStorage: userStorageStats?.total_storage || 0,
                  userCount: userStorageStats?.user_count || 0,
                  chainsCount: chainsCount?.count || 0,
                  inspirationsCount: inspirationsCount?.count || 0,
                  artistsCount: artistsCount?.count || 0
              }
          });
      }

      if (path === '/api/admin/logs' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          await ensureAccessLogsSchema(db);

          const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10));
          const pageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '100', 10), 20), 200);
          const category = (url.searchParams.get('category') || '').trim();
          const status = (url.searchParams.get('status') || '').trim();
          const q = (url.searchParams.get('q') || '').trim();

          const conditions: string[] = [];
          const values: any[] = [];

          if (category) {
            conditions.push("COALESCE(category, 'auth') = ?");
            values.push(category);
          }
          if (status) {
            conditions.push("COALESCE(status, 'success') = ?");
            values.push(status);
          }
          if (q) {
            const like = `%${q}%`;
            conditions.push(`(
              username LIKE ? OR action LIKE ? OR COALESCE(message, '') LIKE ? OR
              COALESCE(resource_type, '') LIKE ? OR COALESCE(resource_id, '') LIKE ? OR
              COALESCE(path, '') LIKE ? OR COALESCE(metadata, '') LIKE ?
            )`);
            values.push(like, like, like, like, like, like, like);
          }

          const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const countResult = await db.prepare(`SELECT COUNT(*) as total FROM access_logs ${whereSql}`)
            .bind(...values)
            .first<{total: number}>();
          const total = countResult?.total || 0;
          const logsResult = await db.prepare(`
              SELECT * FROM access_logs
              ${whereSql}
              ORDER BY created_at DESC
              LIMIT ? OFFSET ?
          `).bind(...values, pageSize, page * pageSize).all();

          return json({
            data: logsResult.results.map((l: any) => ({
              id: l.id,
              userId: l.user_id,
              username: l.username,
              role: l.role,
              ip: l.ip,
              userAgent: l.user_agent,
              action: l.action,
              category: l.category || 'auth',
              status: l.status || 'success',
              method: l.method,
              path: l.path,
              resourceType: l.resource_type,
              resourceId: l.resource_id,
              message: l.message,
              metadata: l.metadata,
              durationMs: l.duration_ms,
              createdAt: l.created_at
            })),
            pagination: {
              page,
              pageSize,
              total,
              totalPages: Math.ceil(total / pageSize)
            }
          });
      }

      // --- ADMIN: Clear Old Logs ---
      if (path === '/api/admin/clear-logs' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          await ensureAccessLogsSchema(db);
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          await db.prepare('DELETE FROM access_logs WHERE created_at < ?').bind(thirtyDaysAgo).run();
          return json({ success: true });
      }

      // --- NAI Proxy ---
      if (path === '/api/generate' && method === 'POST') {
        const startedAt = Date.now();
        const body = await request.json();
        const clientAuth = request.headers.get('Authorization');
        const generationMeta = {
          model: body?.model,
          action: body?.action,
          width: body?.parameters?.width,
          height: body?.parameters?.height,
          steps: body?.parameters?.steps,
          scale: body?.parameters?.scale,
          sampler: body?.parameters?.sampler,
          seed: body?.parameters?.seed ?? 'random',
          promptLength: typeof body?.input === 'string' ? body.input.length : 0,
          negativeLength: typeof body?.parameters?.negative_prompt === 'string' ? body.parameters.negative_prompt.length : 0,
          characters: Array.isArray(body?.parameters?.v4_prompt?.caption?.char_captions) ? body.parameters.v4_prompt.caption.char_captions.length : 0,
        };
        if (!clientAuth) {
          return error('Missing API Key', 401);
        }
        const naiRes = await fetch("https://image.novelai.net/ai/generate-image", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": clientAuth }, body: JSON.stringify(body) });
        if (!naiRes.ok) {
          const errText = await naiRes.text();
          return error(errText, naiRes.status);
        }
        const blob = await naiRes.blob();
        return new Response(blob, { headers: { ...corsHeaders, 'Content-Type': 'application/zip' } });
      }

      // --- File Upload ---
      if (path === '/api/upload' && method === 'POST') {
          if (!env.BUCKET) return error('R2 Bucket not configured', 503);
          if (currentUser.role === 'guest') {
            return error('Guests cannot upload files', 403);
          }
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file || !(file instanceof File)) return error('Invalid file', 400);
          // folder/ext 净化为单段安全字符：两者都来自客户端，直接拼接可写出任意前缀的 R2 key
          const folder = String(formData.get('folder') || 'misc').replace(/[^a-zA-Z0-9_-]/g, '') || 'misc';
          const ext = String(file.name.split('.').pop() || 'png').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
          const filename = `${folder}/${currentUser.id}_${Date.now()}.${ext}`;
          const fileSize = file.size;
          // 使用统一的角色策略检查存储配额
          if (!ROLE_POLICY.isUnlimitedStorage(currentUser.role)) {
              const currentUsage = currentUser.storage_usage || 0;
              const maxStorage = currentUser.max_storage || ROLE_POLICY.getDefaultQuota(currentUser.role) || 314572800;
              if (currentUsage + fileSize > maxStorage) {
                return error(`Storage quota exceeded`, 413);
              }
          }
          await env.BUCKET.put(filename, file.stream(), { httpMetadata: { contentType: file.type } });
          await db.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?').bind(fileSize, currentUser.id).run();
          return json({ url: `/api/assets/${filename}`, size: fileSize });
      }

      // --- CRUD Routes ---

      // Chains
      if (path === '/api/chains' && method === 'GET') {
        // 游客不返回 guest_hidden=1 的记录
        const isGuestUser = currentUser.role === 'guest';
        let chainsResult;
        try {
          if (isGuestUser) {
            chainsResult = await db.prepare('SELECT * FROM chains WHERE guest_hidden = 0 ORDER BY updated_at DESC').all();
          } else {
            chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
          }
        } catch (e: any) {
          if (isMissingColumnError(e)) {
            await initDB();
            if (isGuestUser) {
              chainsResult = await db.prepare('SELECT * FROM chains WHERE guest_hidden = 0 ORDER BY updated_at DESC').all();
            } else {
              chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
            }
          } else {
            throw e;
          }
        }
        const data = chainsResult.results.map((c: any) => ({
          id: c.id, userId: c.user_id, username: c.username, type: c.type || 'style', name: c.name, description: c.description,
          tags: parseStoredJson(c.tags, []), previewImage: c.preview_image, base_prompt: c.base_prompt, // raw DB column needed? No, mapping below
          basePrompt: c.base_prompt,
          negativePrompt: c.negative_prompt, modules: parseStoredJson(c.modules, []), params: parseStoredJson(c.params, {}),
          variableValues: parseStoredJson(c.variable_values, {}), guestHidden: c.guest_hidden === 1, createdAt: c.created_at, updatedAt: c.updated_at
        }));
        return json(data);
      }
      if (path === '/api/chains' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const id = crypto.randomUUID();
        const type = body.type || 'style'; // Default to style
        const guestHidden = body.guestHidden ? 1 : 0;
        // Sanitize and validate tags
        let tags = '[]';
        if (Array.isArray(body.tags)) {
          const sanitizedTags = (body.tags as unknown[])
            .map(tag => typeof tag === 'string' ? tag.trim().substring(0, 50) : '')
            .filter(tag => tag.length > 0);
          tags = JSON.stringify(sanitizedTags);
        }
        try {
          await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', body.params ? JSON.stringify(body.params) : '{}', body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
          return json({ id });
        } catch (e: any) {
          if (isMissingColumnError(e)) {
            await initDB();
            await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', body.params ? JSON.stringify(body.params) : '{}', body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
            return json({ id });
          }
          throw e;
        }
      }
      const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
      if (chainIdMatch && method === 'GET') {
        const id = decodeURIComponent(chainIdMatch[1]);
        const chain = await db.prepare('SELECT * FROM chains WHERE id = ?').bind(id).first<any>();
        if (!chain) return error('Not Found', 404);
        if (currentUser.role === 'guest' && chain.guest_hidden === 1) return error('Not Found', 404);
        return json({
          id: chain.id,
          userId: chain.user_id,
          username: chain.username,
          type: chain.type || 'style',
          name: chain.name,
          description: chain.description,
          tags: parseStoredJson(chain.tags, []),
          previewImage: chain.preview_image,
          basePrompt: chain.base_prompt || '',
          negativePrompt: chain.negative_prompt || '',
          modules: parseStoredJson(chain.modules, []),
          params: parseStoredJson(chain.params, {}),
          variableValues: parseStoredJson(chain.variable_values, {}),
          guestHidden: chain.guest_hidden === 1,
          createdAt: chain.created_at,
          updatedAt: chain.updated_at,
        });
      }
      if (chainIdMatch && method === 'PUT') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = chainIdMatch[1];
        const updates = await request.json() as any;
        const chain = await db.prepare('SELECT user_id, preview_image, name, type FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string, name: string, type: string}>();
        if (!chain) return error('Not Found', 404);
        if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
        
        // Handle Chain Cover Cleanup
        if (updates.previewImage && updates.previewImage.startsWith('data:')) {
             try { 
                  const newUrl = await processImageUpload(env, updates.previewImage, 'covers', id, currentUser);
                  updates.previewImage = newUrl;
             } catch (e: any) { return error(e.message, 413); }
        } else if (updates.previewImage && updates.previewImage.startsWith('http')) {
             try {
                  const previewSource = new URL(updates.previewImage);
                  if (previewSource.protocol !== 'https:' || previewSource.hostname.toLowerCase() !== 'cdn.donmai.us') {
                    return error('角色 Tag 外部封面仅允许 Danbooru 图片地址', 422);
                  }
                  updates.previewImage = await fetchAndUploadImage(env, updates.previewImage, 'covers', id, currentUser);
             } catch (e: any) { return error(e.message, 422); }
        }

        const fields = []; const values = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.previewImage !== undefined) { fields.push('preview_image = ?'); values.push(updates.previewImage); }
        if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
        if (updates.negativePrompt !== undefined) { fields.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
        if (updates.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(updates.modules)); }
        if (updates.params !== undefined) { fields.push('params = ?'); values.push(JSON.stringify(updates.params)); }
        if (updates.variableValues !== undefined) { fields.push('variable_values = ?'); values.push(JSON.stringify(updates.variableValues)); }
        if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
        if (updates.guestHidden !== undefined) { fields.push('guest_hidden = ?'); values.push(updates.guestHidden ? 1 : 0); }
        if (fields.length > 0) {
          fields.push('updated_at = ?');
          values.push(Date.now());
          values.push(id);
          try {
            await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
          } catch (e: any) {
            if (isMissingColumnError(e)) {
              await initDB();
              await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
            } else {
              throw e;
            }
          }
        }
        // Delete only after the new reference has committed.  This covers
        // replacement, clearing a cover, and future non-base64 cover sources.
        if (updates.previewImage !== undefined && chain.preview_image && chain.preview_image !== updates.previewImage) {
          await deleteR2File(env, chain.preview_image);
        }
        return json({ success: true });
      }
      if (chainIdMatch && method === 'DELETE') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = chainIdMatch[1];
        const chain = await db.prepare('SELECT user_id, preview_image, name, type FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string, name: string, type: string}>();
        if (chain) {
            if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
            // Delete Cover
            if (chain.preview_image) await deleteR2File(env, chain.preview_image);
            await db.prepare('DELETE FROM chains WHERE id = ?').bind(id).run();
        }
        return json({ success: true });
      }

      // Artists (Updated with Deletion Logic)
      if (path === '/api/artists' && method === 'GET') {
         const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
         return json(res.results.map((a: any) => ({ id: a.id, name: a.name, imageUrl: a.image_url, previewUrl: a.preview_url, benchmarks: parseStoredJson(a.benchmarks, []) })));
      }
      if (path === '/api/artists' && method === 'POST') {
        // 使用统一的角色策略检查画师管理权限（admin + vip）
        if (!ROLE_POLICY.canManageArtists(currentUser.role)) return error('Forbidden', 403);
        const body = await request.json() as any;
        const id = body.id || crypto.randomUUID();
        
        // Fetch existing artist to compare for deletions
        const existing = await db.prepare('SELECT name, benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{name: string, benchmarks: string, preview_url: string, image_url: string}>();
        const oldBenchmarks = existing && existing.benchmarks ? JSON.parse(existing.benchmarks) : [];

        // Process image URL - handle both Base64 and external URL
        let imageUrl = body.imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) {
            imageUrl = await processImageUpload(env, imageUrl, 'artists', id, currentUser);
        } else if (imageUrl && imageUrl.startsWith('http')) {
            // Fetch external image URL and store in R2
            imageUrl = await fetchAndUploadImage(env, imageUrl, 'artists', id, currentUser);
        }

        // Process benchmarks - handle both Base64 and external URLs
        const benchmarks = body.benchmarks || [];
        if (Array.isArray(benchmarks)) {
            for (let i = 0; i < benchmarks.length; i++) {
                if (benchmarks[i] && benchmarks[i].startsWith('data:')) {
                    // Upload new file
                    const newUrl = await processImageUpload(env, benchmarks[i], `artists/benchmarks_${i}`, id);
                    benchmarks[i] = newUrl;
                    
                } else if (benchmarks[i] && benchmarks[i].startsWith('http')) {
                    // Fetch external image URL and store in R2
                    const newUrl = await fetchAndUploadImage(env, benchmarks[i], `artists/benchmarks_${i}`, id, currentUser);
                    benchmarks[i] = newUrl;
                    
                }
            }
        }
        
        // Handle undefined values - convert to null or default
        const previewUrl = body.previewUrl ?? null;
        const benchmarksJson = JSON.stringify(benchmarks || []);
        const sanitizedName = body.name ? body.name.trim() : '';
        
        await db.prepare(`INSERT INTO artists (id, name, image_url, benchmarks, preview_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url, benchmarks = excluded.benchmarks, preview_url = excluded.preview_url`).bind(id, sanitizedName, imageUrl, benchmarksJson, previewUrl).run();
        // A database update must become durable before any old asset is
        // removed.  This also cleans up benchmarks that were removed from the
        // edited list instead of leaving them orphaned forever.
        const retainedAssets = new Set([imageUrl, previewUrl, ...benchmarks].filter((url): url is string => typeof url === 'string' && url.length > 0));
        const previousAssets = [existing?.image_url, existing?.preview_url, ...oldBenchmarks]
          .filter((url): url is string => typeof url === 'string' && url.length > 0);
        for (const oldUrl of new Set(previousAssets)) {
          if (!retainedAssets.has(oldUrl)) await deleteR2File(env, oldUrl);
        }
        return json({ success: true, benchmarks });
      }
      if (path.startsWith('/api/artists/') && method === 'DELETE') {
        // 使用统一的角色策略检查画师管理权限（admin + vip）
        if (!ROLE_POLICY.canManageArtists(currentUser.role)) return error('Forbidden', 403);
        const id = path.split('/').pop();
        const artist = await db.prepare('SELECT name, benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{name: string, benchmarks: string, preview_url: string, image_url: string}>();
        if (artist) {
            // Delete all associated files
            await deleteR2File(env, artist.image_url);
            if (artist.preview_url) await deleteR2File(env, artist.preview_url);
            if (artist.benchmarks) {
                // benchmarks 列损坏时回退为空数组，保证画师条目本身仍能删除
                const bms = parseStoredJson(artist.benchmarks, []);
                for (const url of Array.isArray(bms) ? bms : []) {
                    if (url) await deleteR2File(env, url);
                }
            }
        }
        await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // Inspiration boards and curated inspiration library
      if (path.startsWith('/api/inspiration-boards') || path.startsWith('/api/inspirations')) {
        await ensureInspirationSchema(db);
      }

      if (path === '/api/inspiration-boards' && method === 'GET') {
        const result = await db.prepare('SELECT * FROM inspiration_boards WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
          .bind(currentUser.id).all<any>();
        return json({ items: result.results.map(mapInspirationBoardRow) });
      }
      if (path === '/api/inspiration-boards' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const now = Date.now();
        const id = String(body.id || crypto.randomUUID());
        const name = String(body.name || '').trim().slice(0, 80);
        if (!name) return error('Board name is required', 400);
        await db.prepare(`INSERT INTO inspiration_boards (id, user_id, name, color, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, currentUser.id, name, String(body.color || '#6366f1'), Number(body.sortOrder || 0), now, now).run();
        const row = await db.prepare('SELECT * FROM inspiration_boards WHERE id = ?').bind(id).first<any>();
        return json({ item: mapInspirationBoardRow(row) });
      }
      const boardMatch = path.match(/^\/api\/inspiration-boards\/([^/]+)$/);
      if (boardMatch && method === 'PUT') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = decodeURIComponent(boardMatch[1]);
        const body = await request.json() as any;
        const current = await db.prepare('SELECT * FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).first<any>();
        if (!current) return error('Not Found', 404);
        await db.prepare('UPDATE inspiration_boards SET name = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .bind(
            typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : current.name,
            typeof body.color === 'string' ? body.color : current.color,
            Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : current.sort_order,
            Date.now(), id, currentUser.id,
          ).run();
        return json({ success: true });
      }
      if (boardMatch && method === 'DELETE') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = decodeURIComponent(boardMatch[1]);
        const board = await db.prepare('SELECT id FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).first<any>();
        if (!board) return error('Not Found', 404);
        await db.prepare('UPDATE inspirations SET board_id = NULL, updated_at = ? WHERE board_id = ? AND user_id = ?').bind(Date.now(), id, currentUser.id).run();
        await db.prepare('DELETE FROM inspiration_boards WHERE id = ? AND user_id = ?').bind(id, currentUser.id).run();
        return json({ success: true });
      }

      const updateInspirationFields = async (id: string, updates: any) => {
        const built = buildInspirationSetStatements(updates);
        if (!built) return 0;
        const result = await db.prepare(`UPDATE inspirations SET ${built.assignments.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
          .bind(...built.values, Date.now(), id, currentUser.id).run();
        return Number(result.meta?.changes || 0);
      };

      const deleteInspirationAsset = async (item: any) => {
        if (item.image_key) {
          const references = await db.prepare(`SELECT
            (SELECT COUNT(*) FROM local_generation_history WHERE image_key = ?) +
            (SELECT COUNT(*) FROM inspirations WHERE image_key = ? AND id != ?) AS count`)
            .bind(item.image_key, item.image_key, item.id).first<{count: number}>();
          if (Number(references?.count || 0) === 0 && env.BUCKET) await env.BUCKET.delete(item.image_key);
        } else if (item.image_url) {
          await deleteR2File(env, item.image_url);
        }
      };

      const inspirationImageMatch = path.match(/^\/api\/inspirations\/([^/]+)\/image$/);
      if (inspirationImageMatch && method === 'GET') {
        const id = decodeURIComponent(inspirationImageMatch[1]);
        const row = await db.prepare('SELECT image_key, image_type FROM inspirations WHERE id = ?').bind(id).first<any>();
        if (!row?.image_key || !env.BUCKET) return error('Inspiration image not found', 404);
        const object = await env.BUCKET.get(row.image_key);
        if (!object) return error('Inspiration image file not found', 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Content-Type', row.image_type || headers.get('Content-Type') || 'image/png');
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'private, max-age=31536000, immutable');
        return new Response(object.body, { headers });
      }

      if (path === '/api/inspirations' && method === 'GET') {
        const result = await db.prepare('SELECT * FROM inspirations ORDER BY is_pinned DESC, created_at DESC').all<any>();
        return json(result.results.map(mapInspirationRow));
      }
      if (path === '/api/inspirations' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const id = String(body.id || crypto.randomUUID());
        const now = Number(body.createdAt || Date.now());
        let imageUrl = body.imageUrl || null;
        let imageKey: string | null = null;
        let imageType: string | null = null;
        if (body.sourceType === 'history' && body.sourceId) {
          const history = await db.prepare('SELECT image_key, image_type FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(String(body.sourceId), currentUser.id).first<any>();
          if (history?.image_key) {
            imageKey = history.image_key;
            imageType = history.image_type || 'image/png';
            imageUrl = null;
          }
        }
        if (imageUrl && String(imageUrl).startsWith('data:')) {
          try { imageUrl = await processImageUpload(env, imageUrl, 'inspirations', id, currentUser); }
          catch (e: any) { return error(e.message, 413); }
        }
        await db.prepare(`INSERT OR REPLACE INTO inspirations (
          id, user_id, username, title, image_url, image_key, image_type, prompt, negative_prompt, params,
          board_id, notes, tags, source_type, source_id, source_url, rating, is_pinned, archived,
          last_used_at, use_count, parent_id, analysis, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            id, currentUser.id, currentUser.username, String(body.title || '未命名灵感').slice(0, 160), imageUrl, imageKey, imageType,
            String(body.prompt || ''), String(body.negativePrompt || ''), body.params ? JSON.stringify(body.params) : null,
            body.boardId || null, String(body.notes || ''), JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 80) : []),
            body.sourceType || 'other', body.sourceId || null, body.sourceUrl || null,
            Math.max(0, Math.min(5, Math.floor(Number(body.rating) || 0))), body.isPinned ? 1 : 0, body.archived ? 1 : 0,
            body.lastUsedAt || null, Number(body.useCount || 0), body.parentId || null, JSON.stringify(body.analysis || {}), now, Number(body.updatedAt || now),
          ).run();
        const row = await db.prepare('SELECT * FROM inspirations WHERE id = ?').bind(id).first<any>();
        return json({ success: true, id, item: mapInspirationRow(row) });
      }
      if (path === '/api/inspirations/bulk-update' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, 500).map((id: any) => String(id)).filter(Boolean))) as string[];
        // 同一组字段更新 N 条：一次构建 SET 子句，db.batch 单往返执行，替代 N 次串行 UPDATE
        const updates = body.updates || {};
        const built = buildInspirationSetStatements(updates);
        if (!built || !ids.length) return json({ success: true, updatedCount: 0 });
        const results = await db.batch(ids.map(id =>
          db.prepare(`UPDATE inspirations SET ${built.assignments.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
            .bind(...built.values, Date.now(), id, currentUser.id)));
        const updatedCount = results.reduce((sum, result) => sum + Number((result.meta as any)?.changes || 0), 0);
        return json({ success: true, updatedCount });
      }
      if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, 500).map((id: any) => String(id)).filter(Boolean))) as string[];
        // 分块 IN 查询（D1 单查询绑定参数上限）+ 批量 DELETE，替代 N 次 SELECT + N 次 DELETE 的串行往返
        const rows: any[] = [];
        for (let index = 0; index < ids.length; index += 90) {
          const chunk = ids.slice(index, index + 90);
          const found = await db.prepare(`SELECT * FROM inspirations WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<any>();
          rows.push(...found.results);
        }
        const valid = rows.filter(item => currentUser.role === 'admin' || item.user_id === currentUser.id);
        if (valid.length) {
          await db.batch(valid.map(item => db.prepare('DELETE FROM inspirations WHERE id = ?').bind(item.id)));
          for (const item of valid) await deleteInspirationAsset(item);
        }
        return json({ success: true, deletedCount: valid.length });
      }
      const inspirationUseMatch = path.match(/^\/api\/inspirations\/([^/]+)\/use$/);
      if (inspirationUseMatch && method === 'POST') {
        const id = decodeURIComponent(inspirationUseMatch[1]);
        await db.prepare('UPDATE inspirations SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ?, updated_at = ? WHERE id = ?')
          .bind(Date.now(), Date.now(), id).run();
        return json({ success: true });
      }
      const inspirationMatch = path.match(/^\/api\/inspirations\/([^/]+)$/);
      if (inspirationMatch && method === 'PUT') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = decodeURIComponent(inspirationMatch[1]);
        const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<any>();
        if (!item) return error('Not Found', 404);
        if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
        const updates = await request.json() as any;
        if (currentUser.role === 'admin' && item.user_id !== currentUser.id) {
          const ownerId = item.user_id;
          const statements: string[] = [];
          const values: any[] = [];
          if (typeof updates.title === 'string') { statements.push('title = ?'); values.push(updates.title.slice(0, 160)); }
          if (typeof updates.prompt === 'string') { statements.push('prompt = ?'); values.push(updates.prompt); }
          if (typeof updates.negativePrompt === 'string') { statements.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
          if (statements.length) await db.prepare(`UPDATE inspirations SET ${statements.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...values, Date.now(), id, ownerId).run();
        } else {
          await updateInspirationFields(id, updates);
        }
        return json({ success: true });
      }
      if (inspirationMatch && method === 'DELETE') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = decodeURIComponent(inspirationMatch[1]);
        const item = await db.prepare('SELECT * FROM inspirations WHERE id = ?').bind(id).first<any>();
        if (!item) return json({ success: true });
        if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
        await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
        await deleteInspirationAsset(item);
        return json({ success: true });
      }
      if (path.startsWith('/api/')) return error('Not Found', 404);
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      // 原始异常（D1/R2 报错可能含内部细节）只进服务端日志，客户端统一收简短文案；
      // 带业务语义的校验错误在各路由内就地捕获并返回对应状态码，不会走到这里。
      console.error('worker request failed:', path, method, e);
      return error('请求处理失败，请查看本地服务日志', 500);
    }
  }
};
