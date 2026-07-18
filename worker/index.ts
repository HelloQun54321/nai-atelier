
import bcrypt from 'bcryptjs';

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
const LOG_STRING_LIMIT = 600;
const LAN_ACCESS_COOKIE = 'nai_lan_access';
const LAN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const lanAccessAttempts = new Map<string, { failures: number; blockedUntil: number }>();

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
  request.headers.get('CF-Connecting-IP') ||
  request.headers.get('X-Forwarded-For') ||
  request.headers.get('User-Agent') ||
  'lan-device';

const lanAccessRequired = () => json({ error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' }, 401);

const clampInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

async function proxyAitagJson(targetUrl: URL): Promise<Response> {
  const response = await fetch(targetUrl.toString(), {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'NaiPromptManager-Qun/0.5 (+local personal use)',
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

async function fetchAitagJson(targetUrl: URL): Promise<any> {
  const response = await fetch(targetUrl.toString(), {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'NaiPromptManager-Qun/0.5 (+local personal use)',
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

async function fetchAitagConfig() {
  const configUrl = new URL('/api/config', AITAG_BASE_URL);
  configUrl.searchParams.set('v', AITAG_CONFIG_VERSION);
  return fetchAitagJson(configUrl);
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
    const response = await fetch(remoteUrl, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'NaiPromptManager-Qun/0.5 (+local personal use)',
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
    const detail = cachedDetail || await fetchAitagJson(new URL(`/api/work/${workId}`, AITAG_BASE_URL));
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
      const data = await fetchAitagJson(buildAitagSearchUrl(sourceUrl));
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
    created_at INTEGER
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
    source_chain_id TEXT,
    source_chain_name TEXT,
    source_chain_type TEXT,
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
`;

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
      source_chain_id TEXT,
      source_chain_name TEXT,
      source_chain_type TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_local_history_user_created
    ON local_generation_history(user_id, created_at DESC)`).run();
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
  const format = match[1].toLowerCase().replace('jpeg', 'jpg');
  const valid = format === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : format === 'webp'
      ? String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
      : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error('图片内容与文件格式不一致');
  return { bytes, format, contentType: format === 'jpg' ? 'image/jpeg' : `image/${format}` };
}

const mapVibeEncoding = (row: any) => ({
  id: row.id,
  model: row.model,
  modelKey: row.model_key,
  informationExtracted: Number(row.information_extracted),
  encodingHash: row.encoding_hash,
  createdAt: Number(row.created_at),
});

async function mapVibeAsset(db: D1Database, row: any) {
  const encodings = await db.prepare('SELECT * FROM vibe_encodings WHERE vibe_id = ? ORDER BY information_extracted DESC')
    .bind(row.id).all<any>();
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
    encodings: encodings.results.map(mapVibeEncoding),
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

function mapLocalHistoryRow(row: any) {
  return {
    id: row.id,
    imageUrl: `/api/local-history/${encodeURIComponent(row.id)}/image`,
    prompt: row.prompt || '',
    negativePrompt: row.negative_prompt || '',
    params: parseStoredJson(row.params, {}),
    sourceChainId: row.source_chain_id || undefined,
    sourceChainName: row.source_chain_name || undefined,
    sourceChainType: row.source_chain_type || undefined,
    createdAt: Number(row.created_at || 0),
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

  const result = await db.prepare('SELECT image_url, preview_url, benchmarks FROM artists').all<any>();
  const assetUrls = new Set<string>();
  for (const artist of result.results || []) {
    if (artist.image_url) assetUrls.add(artist.image_url);
    if (artist.preview_url) assetUrls.add(artist.preview_url);
    for (const url of parseStoredJson(artist.benchmarks, [])) {
      if (url) assetUrls.add(url);
    }
  }

  for (const url of assetUrls) await deleteR2File(env, url);
  await db.prepare('DELETE FROM artists').run();
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

function isMissingLogSchemaError(e: any): boolean {
  if (!e || !e.message) return false;
  const msg = e.message;
  return isMissingColumnError(e) || msg.includes('no such table');
}

function getClientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

function truncateLogString(value: string) {
  if (value.startsWith('data:image/')) {
    return `[image data uri, ${value.length} chars]`;
  }
  if (value.length <= LOG_STRING_LIMIT) return value;
  return `${value.slice(0, LOG_STRING_LIMIT)}... (${value.length} chars)`;
}

function sanitizeLogValue(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateLogString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[depth limit]';
  if (Array.isArray(value)) {
    const mapped = value.slice(0, 30).map(item => sanitizeLogValue(item, depth + 1));
    return value.length > 30 ? [...mapped, `[${value.length - 30} more items]`] : mapped;
  }
  if (typeof value === 'object') {
    const result: Record<string, any> = {};
    const entries = Object.entries(value).slice(0, 60);
    for (const [key, item] of entries) {
      if (/password|passcode|authorization|api[_-]?key|token|cookie|session/i.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = sanitizeLogValue(item, depth + 1);
      }
    }
    const totalKeys = Object.keys(value).length;
    if (totalKeys > entries.length) result._truncatedKeys = totalKeys - entries.length;
    return result;
  }
  return String(value);
}

function stringifyLogMetadata(metadata: any) {
  if (metadata === undefined) return null;
  try {
    return JSON.stringify(sanitizeLogValue(metadata));
  } catch {
    return JSON.stringify({ value: '[unserializable]' });
  }
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

async function writeSystemLog(
  db: D1Database,
  options: {
    user?: {id?: string, username?: string, role?: string} | null;
    request: Request;
    action: string;
    category: string;
    status?: 'success' | 'error' | 'warning';
    resourceType?: string;
    resourceId?: string | number | null;
    message?: string;
    metadata?: any;
    durationMs?: number;
  }
) {
  // Persistent audit logging is intentionally disabled in personal mode.
  void db;
  void options;
  return;

  const ip = options.request.headers.get('CF-Connecting-IP') ||
             options.request.headers.get('X-Forwarded-For') ||
             'unknown';
  const userAgent = options.request.headers.get('User-Agent') || 'unknown';
  const url = new URL(options.request.url);
  const values = [
    options.user?.id || 'anonymous',
    options.user?.username || 'anonymous',
    options.user?.role || 'anonymous',
    ip,
    userAgent.slice(0, 200),
    options.action.slice(0, 120),
    options.category.slice(0, 80),
    options.status || 'success',
    options.request.method,
    url.pathname,
    options.resourceType || null,
    options.resourceId === undefined || options.resourceId === null ? null : String(options.resourceId).slice(0, 160),
    options.message ? truncateLogString(options.message) : null,
    stringifyLogMetadata(options.metadata),
    options.durationMs ?? null,
    Date.now(),
  ];

  try {
    await db.prepare(
      `INSERT INTO access_logs (
        user_id, username, role, ip, user_agent, action, category, status, method, path,
        resource_type, resource_id, message, metadata, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(...values).run();
  } catch (e) {
    if (isMissingLogSchemaError(e)) {
      try {
        await ensureAccessLogsSchema(db);
        await db.prepare(
          `INSERT INTO access_logs (
            user_id, username, role, ip, user_agent, action, category, status, method, path,
            resource_type, resource_id, message, metadata, duration_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(...values).run();
        return;
      } catch (retryError) {
        console.error('Failed to log access after schema repair:', retryError);
        return;
      }
    }
    console.error('Failed to log access:', e);
  }
}

// Helper: 记录登录日志
async function logAccess(
  db: D1Database,
  user: {id: string, username: string, role: string},
  request: Request,
  action: string,
  metadata?: any
) {
  await writeSystemLog(db, {
    user,
    request,
    action,
    category: 'auth',
    status: 'success',
    resourceType: 'session',
    resourceId: user.id,
    message: action === 'guest_login' ? '游客登录成功' : '用户登录成功',
    metadata,
  });
}

// Helper: 更新每日统计
async function incrementDailyStat(db: D1Database, field: string) {
  // Usage statistics are part of the removed multi-user logging system.
  void db;
  void field;
  return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    await db.prepare(`
      INSERT INTO daily_stats (date, ${field}) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1
    `).bind(today).run();
  } catch (e) {
    console.error('Failed to update daily stat:', e);
  }
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

    const matches = imageData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data format");
    }

    const ext = matches[1]; 
    const base64Data = matches[2];
    const filename = `${folder}/${id}_${Date.now()}.${ext}`;

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const fileSize = bytes.length;

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
        // Fetch the image from external URL
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }

        // Get the image data as ArrayBuffer
        const arrayBuffer = await response.arrayBuffer();
        const fileSize = arrayBuffer.byteLength;

        // Extract file extension from URL or Content-Type
        const contentType = response.headers.get('Content-Type') || 'image/jpeg';
        const ext = contentType.split('/')[1] || 'jpg';
        
        // Generate filename
        const urlPathname = new URL(imageUrl).pathname;
        const originalFilename = urlPathname.split('/').pop() || `${id}_${Date.now()}`;
        const filename = `${folder}/${id}_${originalFilename}`;

        if (user && user.role !== 'admin') {
            const currentUsage = user.storage_usage || 0;
            const maxStorage = user.max_storage || 314572800; // 默认 300MB
            if (currentUsage + fileSize > maxStorage) {
                throw new Error(`Storage quota exceeded (limit: ${Math.round(maxStorage / 1024 / 1024)}MB).`);
            }
        }

        await env.BUCKET.put(filename, arrayBuffer, {
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

    // --- R2 Asset Proxy Route (LAN sessions are checked above) ---
    if (path.startsWith('/api/assets/') && method === 'GET') {
        if (!env.BUCKET) return error('Bucket not configured', 503);
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
      

      // Default Admin
      try {
        const admin = await db.prepare('SELECT * FROM users WHERE username = ?').bind('admin').first();
        if (!admin) {
            const adminId = crypto.randomUUID();
            await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)')
              .bind(adminId, 'admin', 'admin_996', 'admin', Date.now()).run();
        }
      } catch (e) { console.error('Admin init failed', e) }

      // Default Guest
      try {
        const guestName = 'guest';
        const existing = await db.prepare('SELECT * FROM users WHERE username = ?').bind(guestName).first<{id: string, role: string}>();
        if (!existing) {
             const guestId = 'guest-0000-0000-0000-000000000000';
             await db.prepare("INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, 'nai_guest_123', 'guest', ?, 0)")
               .bind(guestId, guestName, Date.now()).run();
        }
      } catch (e) { console.error('Guest init failed', e) }
    };

    // --- Authentication Middleware ---
    const getSessionUser = async () => {
        const cookies = parseCookies(request);
        const sessionId = cookies['session_id'];
        if (!sessionId) return null;
        const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
            .bind(sessionId, Date.now()).first<{user_id: string}>();
        if (!session) return null;
        try {
            return await db.prepare('SELECT id, username, role, storage_usage, max_storage FROM users WHERE id = ?')
                .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number, max_storage: number}>();
        } catch (e: any) {
             if (e.message && e.message.includes('no such column')) {
                 await initDB();
                 return await db.prepare('SELECT id, username, role, storage_usage, max_storage FROM users WHERE id = ?')
                    .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number, max_storage: number}>();
             }
             throw e;
        }
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

      // Guest Login & Normal Login Logic
      if (path === '/api/auth/guest-login' && method === 'POST') {
          const { passcode } = await request.json() as any;
          if (!passcode) return error('请输入访问口令', 400);
          let guestUser = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first<{id: string, username: string, role: string, password: string}>();
          if (!guestUser) { await initDB(); guestUser = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first<{id: string, username: string, role: string, password: string}>(); }
          if (!guestUser) return error('System Error', 500);
          if (passcode !== guestUser.password) {
            await writeSystemLog(db, {
              user: { id: guestUser.id, username: guestUser.username, role: 'guest' },
              request,
              action: 'guest_login_failed',
              category: 'auth',
              status: 'error',
              resourceType: 'session',
              message: '游客口令错误',
              metadata: { ip: getClientIp(request) },
            });
            return error('访问口令错误', 401);
          }
          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 86400000;
          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, guestUser.id, expiresAt).run();
          // 记录登录日志和每日统计
          await logAccess(db, { id: guestUser.id, username: guestUser.username, role: 'guest' }, request, 'guest_login', { expiresAt });
          await incrementDailyStat(db, 'guest_logins');
          return json({ success: true, user: { id: guestUser.id, username: guestUser.username, role: 'guest', storageUsage: 0 } }, 200, { 'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/login' && method === 'POST') {
          const { username, password } = await request.json() as any;
          try { await db.prepare('SELECT 1 FROM users').first(); } catch(e) { await initDB(); }
          const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<{id: string, role: string, storage_usage: number, password: string}>();
          if (!user) {
            await writeSystemLog(db, {
              request,
              action: 'login_failed',
              category: 'auth',
              status: 'error',
              resourceType: 'session',
              message: '用户名不存在或密码错误',
              metadata: { username },
            });
            return error('用户名或密码错误', 401);
          }
          if (user.role === 'guest') {
            await writeSystemLog(db, {
              user: { id: user.id, username, role: user.role },
              request,
              action: 'login_failed',
              category: 'auth',
              status: 'error',
              resourceType: 'session',
              message: '游客账号尝试账号登录入口',
            });
            return error('Invalid login method', 401);
          }
          let isValid = await bcrypt.compare(password, user.password);
          if (!isValid && user.password === password) { isValid = true; const newHash = await bcrypt.hash(password, 10); await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(newHash, user.id).run(); }
          if (!isValid) {
            await writeSystemLog(db, {
              user: { id: user.id, username, role: user.role },
              request,
              action: 'login_failed',
              category: 'auth',
              status: 'error',
              resourceType: 'session',
              message: '密码错误',
              metadata: { username },
            });
            return error('用户名或密码错误', 401);
          }
          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 604800000;
          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, user.id, expiresAt).run();
          // 更新最后登录时间
          await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Date.now(), user.id).run();
          // 记录登录日志和每日统计
          await logAccess(db, { id: user.id, username, role: user.role }, request, 'login');
          await incrementDailyStat(db, 'user_logins');
          return json({ success: true, user: { id: user.id, username, role: user.role, storageUsage: user.storage_usage || 0 } }, 200, { 'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
          const cookies = parseCookies(request);
          let logoutUser = null;
          if (cookies['session_id']) {
            logoutUser = await db.prepare(`
              SELECT users.id, users.username, users.role
              FROM sessions JOIN users ON sessions.user_id = users.id
              WHERE sessions.id = ?
            `).bind(cookies['session_id']).first<{id: string, username: string, role: string}>();
            await db.prepare('DELETE FROM sessions WHERE id = ?').bind(cookies['session_id']).run();
          }
          await writeSystemLog(db, {
            user: logoutUser,
            request,
            action: 'logout',
            category: 'auth',
            status: 'success',
            resourceType: 'session',
            resourceId: logoutUser?.id,
            message: logoutUser ? '退出登录' : '退出登录：未找到有效会话',
          });
          return json({ success: true }, 200, { 'Set-Cookie': `session_id=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/me' && method === 'GET') {
          const user = await getSessionUser();
          if (!user) return error('Unauthorized', 401);
          return json({ id: user.id, username: user.username, role: user.role, storageUsage: user.storage_usage || 0, maxStorage: user.max_storage || 314572800 });
      }

      // --- Authenticated Logic ---
      const currentUser = await getLocalOwner(db);

      if (
        path.startsWith('/api/users') ||
        path.startsWith('/api/admin/guest-setting') ||
        path.startsWith('/api/admin/logs') ||
        path.startsWith('/api/admin/clear-logs') ||
        path === '/api/client-logs'
      ) {
        return error('Account management is disabled in personal mode', 410);
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
          return json({ items: await Promise.all(rows.results.map(row => mapVibeAsset(db, row))) });
        }

        if (path === '/api/vibes' && method === 'POST') {
          const body = await request.json() as any;
          let parsed;
          try { parsed = parseImageData(body.imageData); } catch (e: any) { return error(e.message, 400); }
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
          if (body.thumbnailData) {
            try {
              const thumbnail = parseImageData(body.thumbnailData);
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
          const sourceHash = String(document.id || actualSourceHash).toLowerCase();
          if (!/^[a-f0-9]{64}$/.test(sourceHash)) return error('Vibe 文件缺少有效的图片标识', 400);
          if (actualSourceHash && sourceHash !== actualSourceHash) return error('Vibe 文件的原图哈希不匹配', 400);
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
      if (path === '/api/local-history/status' && method === 'GET') {
        const enabled = localHistoryEnabled(env) && Boolean(env.BUCKET);
        if (enabled) await ensureLocalHistorySchema(db);
        return json({ enabled });
      }

      if (path.startsWith('/api/local-history')) {
        if (!localHistoryEnabled(env)) return error('Local history is disabled', 404);
        if (!env.BUCKET) return error('Local history storage is unavailable', 503);
        await ensureLocalHistorySchema(db);

        const deleteHistoryRows = async (rows: Array<{id: string, image_key: string}>) => {
          for (const row of rows) {
            await env.BUCKET!.delete(row.image_key);
            await db.prepare('DELETE FROM local_generation_history WHERE id = ? AND user_id = ?')
              .bind(row.id, currentUser.id).run();
          }
          return rows.length;
        };

        const imageMatch = path.match(/^\/api\/local-history\/([^/]+)\/image$/);
        if (imageMatch && method === 'GET') {
          const id = decodeURIComponent(imageMatch[1]);
          const row = await db.prepare('SELECT image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<{image_key: string}>();
          if (!row) return error('History image not found', 404);
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
          const dateWhere = from || to ? ` AND created_at >= ? AND created_at <= ?` : '';
          const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
          const count = await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}`)
            .bind(currentUser.id, ...dateValues).first<{count: number}>();
          const result = await db.prepare(`
            SELECT * FROM local_generation_history
            WHERE user_id = ?${dateWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(currentUser.id, ...dateValues, pageSize, page * pageSize).all<any>();
          return json({ items: result.results.map(mapLocalHistoryRow), count: Number(count?.count || 0) });
        }

        if (path === '/api/local-history/count' && method === 'GET') {
          const from = Number(url.searchParams.get('from') || 0);
          const to = Number(url.searchParams.get('to') || 0);
          const dateWhere = from || to ? ' AND created_at >= ? AND created_at <= ?' : '';
          const dateValues = from || to ? [from || 0, to || Number.MAX_SAFE_INTEGER] : [];
          const result = await db.prepare(`SELECT COUNT(*) AS count FROM local_generation_history WHERE user_id = ?${dateWhere}`)
            .bind(currentUser.id, ...dateValues).first<{count: number}>();
          return json({ count: Number(result?.count || 0) });
        }

        if (path === '/api/local-history' && method === 'POST') {
          const body = await request.json() as any;
          const id = String(body.id || crypto.randomUUID());
          const match = String(body.imageUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
          if (!match) return error('Invalid history image data', 400);
          const imageType = `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`;
          const extension = imageType === 'image/jpeg' ? 'jpg' : imageType.split('/')[1];
          const binary = atob(match[2]);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const imageKey = `local-history/${currentUser.id}/${id}.${extension}`;
          const existing = await db.prepare('SELECT image_key FROM local_generation_history WHERE id = ? AND user_id = ?')
            .bind(id, currentUser.id).first<{image_key: string}>();

          await env.BUCKET.put(imageKey, bytes.buffer, { httpMetadata: { contentType: imageType } });
          await db.prepare(`
            INSERT OR REPLACE INTO local_generation_history (
              id, user_id, image_key, image_type, prompt, negative_prompt, params,
              source_chain_id, source_chain_name, source_chain_type, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id, currentUser.id, imageKey, imageType, body.prompt || '', body.negativePrompt || '',
            JSON.stringify(body.params || {}), body.sourceChainId || null, body.sourceChainName || null,
            body.sourceChainType || null, Number(body.createdAt || Date.now())
          ).run();
          if (existing?.image_key && existing.image_key !== imageKey) await env.BUCKET.delete(existing.image_key);
          return json({ item: mapLocalHistoryRow({
            id, image_key: imageKey, prompt: body.prompt, negative_prompt: body.negativePrompt,
            params: JSON.stringify(body.params || {}), source_chain_id: body.sourceChainId,
            source_chain_name: body.sourceChainName, source_chain_type: body.sourceChainType,
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

      if (path === '/api/aitag/cache/status' && method === 'GET') {
        try { await ensureAitagCacheSchema(db); } catch (e) { await initDB(); }
        const sort = normalizeAitagSort(url.searchParams.get('sort'));
        const timeRange = normalizeAitagTimeRange(url.searchParams.get('time_range'), sort);
        const aiType = normalizeAitagAiTypeFilter(url.searchParams.get('aiType'));
        return json(await getAitagCacheStatus(db, sort, timeRange, aiType));
      }

      if (path === '/api/aitag/months' && method === 'GET') {
        try {
          const config = await fetchAitagConfig();
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

        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: isFavorite ? 'aitag_favorite_add' : 'aitag_favorite_remove',
          category: 'aitag',
          status: 'success',
          resourceType: 'aitag_work',
          resourceId: String(workId),
          message: isFavorite ? 'aitag work favorited' : 'aitag work unfavorited',
          metadata: { sort, timeRange },
        });

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
        const status = await runAitagIndexBatch(db, { sort, timeRange, aiType, maxPages: AITAG_CACHE_BATCH_PAGES });
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: 'aitag_cache_index',
          category: 'aitag',
          resourceType: 'aitag_cache',
          message: `aitag 缓存索引推进到第 ${status.currentPage} 页`,
          metadata: { sort, timeRange, aiType, targetPages, status: status.status, worksCount: status.worksCount },
        });
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
        return json(await runAitagIndexBatch(db, { sort, timeRange, aiType, maxPages: AITAG_CACHE_BATCH_PAGES }));
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
          const data = await fetchAitagJson(buildAitagSearchUrl(sourceUrl));
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
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'aitag_search',
            category: 'aitag',
            status: 'success',
            resourceType: 'aitag_search',
            message: 'aitag search fetched and cached',
            metadata: {
              page: url.searchParams.get('page'),
              pageSize: url.searchParams.get('page_size'),
              q: sourceUrl.searchParams.get('q'),
              prompt: url.searchParams.get('prompt'),
              sort: url.searchParams.get('sort'),
              timeRange,
              aiType,
            },
            durationMs: Date.now() - startedAt,
          });
          return json({
            ...responsePayload,
            status: await getAitagCacheStatus(db, sort, timeRange, aiType),
            source: 'remote',
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e: any) {
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'aitag_search',
            category: 'aitag',
            status: 'error',
            resourceType: 'aitag_search',
            message: e.message || 'aitag 搜索异常',
            durationMs: Date.now() - startedAt,
          });
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
              const upgradeTask = cacheAitagDetail(env, db, cached)
                .then(() => writeSystemLog(db, {
                  user: currentUser,
                  request,
                  action: 'aitag_work_detail_background_upgrade',
                  category: 'aitag',
                  resourceType: 'aitag_work',
                  resourceId: workId,
                  message: 'aitag cached work detail image upgrade scheduled in background',
                  durationMs: Date.now() - startedAt,
                }))
                .catch(e => writeSystemLog(db, {
                  user: currentUser,
                  request,
                  action: 'aitag_work_detail_background_upgrade',
                  category: 'aitag',
                  status: 'error',
                  resourceType: 'aitag_work',
                  resourceId: workId,
                  message: e?.message || 'aitag cached work detail background image upgrade failed',
                  durationMs: Date.now() - startedAt,
                }));
              if (ctx?.waitUntil) ctx.waitUntil(upgradeTask);
              else upgradeTask.catch(console.error);
            }
            await writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'aitag_work_detail_cached',
              category: 'aitag',
              resourceType: 'aitag_work',
              resourceId: workId,
              message: cacheInfo.hasFullyCachedImages
                ? 'aitag work detail loaded from complete local cache'
                : 'aitag work detail loaded from local cache with background image upgrade',
              durationMs: Date.now() - startedAt,
            });
            return json(cached, 200, { 'Cache-Control': 'no-store' });
          }

          const detail = await fetchAitagJson(target);
          const cachedDetail = await cacheAitagDetailFirstImageOnly(env, db, detail);
          const backgroundCacheTask = cacheAitagDetail(env, db, cachedDetail)
            .then(() => writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'aitag_work_detail_background_full_cache',
              category: 'aitag',
              resourceType: 'aitag_work',
              resourceId: workId,
              message: 'aitag work detail remaining images cached in background',
              durationMs: Date.now() - startedAt,
            }))
            .catch(e => writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'aitag_work_detail_background_full_cache',
              category: 'aitag',
              status: 'error',
              resourceType: 'aitag_work',
              resourceId: workId,
              message: e?.message || 'aitag work detail background full image cache failed',
              durationMs: Date.now() - startedAt,
            }));
          if (ctx?.waitUntil) ctx.waitUntil(backgroundCacheTask);
          else backgroundCacheTask.catch(console.error);
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'aitag_work_detail',
            category: 'aitag',
            status: 'success',
            resourceType: 'aitag_work',
            resourceId: workId,
            message: 'aitag work detail fetched with first image cached; full image cache scheduled',
            durationMs: Date.now() - startedAt,
          });
          return json(cachedDetail, 200, { 'Cache-Control': 'no-store' });
        } catch (e: any) {
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'aitag_work_detail',
            category: 'aitag',
            status: 'error',
            resourceType: 'aitag_work',
            resourceId: workId,
            message: e.message || '读取 aitag 作品详情异常',
            durationMs: Date.now() - startedAt,
          });
          throw e;
        }
      }

      if (path === '/api/client-logs' && method === 'POST') {
        const body = await request.json() as any;
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: String(body.action || 'client_event'),
          category: String(body.category || 'client'),
          status: body.status === 'error' || body.status === 'warning' ? body.status : 'success',
          resourceType: body.resourceType,
          resourceId: body.resourceId,
          message: body.message,
          metadata: body.metadata,
        });
        return json({ success: true });
      }

      // --- ADMIN: Global Settings (Benchmark Config) ---
      if (path === '/api/config/benchmarks' && method === 'PUT') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { config } = await request.json() as any;
          await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('benchmark_config', JSON.stringify(config)).run();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'benchmark_config_update',
            category: 'settings',
            resourceType: 'benchmark_config',
            message: '更新画师库基准测试配置',
            metadata: {
              slots: Array.isArray(config?.slots) ? config.slots.length : 0,
              interval: config?.interval,
              steps: config?.steps,
              scale: config?.scale,
              hasNegative: Boolean(config?.negative),
            },
          });
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
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'guest_passcode_update',
            category: 'user',
            resourceType: 'guest_setting',
            message: '更新游客访问口令',
            metadata: { passcodeLength: typeof passcode === 'string' ? passcode.length : 0 },
          });
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
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'logs_clear_old',
            category: 'system',
            resourceType: 'access_logs',
            message: '清理 30 天前系统日志',
          });
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
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'generate_image',
            category: 'generation',
            status: 'error',
            resourceType: 'nai_generation',
            message: '生图失败：缺少 NovelAI API Key',
            metadata: generationMeta,
            durationMs: Date.now() - startedAt,
          });
          return error('Missing API Key', 401);
        }
        const naiRes = await fetch("https://image.novelai.net/ai/generate-image", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": clientAuth }, body: JSON.stringify(body) });
        if (!naiRes.ok) {
          const errText = await naiRes.text();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'generate_image',
            category: 'generation',
            status: 'error',
            resourceType: 'nai_generation',
            message: `生图失败：NovelAI HTTP ${naiRes.status}`,
            metadata: { ...generationMeta, response: errText },
            durationMs: Date.now() - startedAt,
          });
          return error(errText, naiRes.status);
        }
        const blob = await naiRes.blob();
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: 'generate_image',
          category: 'generation',
          resourceType: 'nai_generation',
          message: 'NovelAI 生图成功',
          metadata: { ...generationMeta, bytes: blob.size },
          durationMs: Date.now() - startedAt,
        });
        return new Response(blob, { headers: { ...corsHeaders, 'Content-Type': 'application/zip' } });
      }

      // --- File Upload ---
      if (path === '/api/upload' && method === 'POST') {
          if (!env.BUCKET) return error('R2 Bucket not configured', 503);
          if (currentUser.role === 'guest') {
            await writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'upload_file_denied',
              category: 'upload',
              status: 'warning',
              resourceType: 'file',
              message: '游客尝试上传文件',
            });
            return error('Guests cannot upload files', 403);
          }
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file || !(file instanceof File)) return error('Invalid file', 400);
          const folder = formData.get('folder') as string || 'misc';
          const ext = file.name.split('.').pop() || 'png';
          const filename = `${folder}/${currentUser.id}_${Date.now()}.${ext}`;
          const fileSize = file.size;
          // 使用统一的角色策略检查存储配额
          if (!ROLE_POLICY.isUnlimitedStorage(currentUser.role)) {
              const currentUsage = currentUser.storage_usage || 0;
              const maxStorage = currentUser.max_storage || ROLE_POLICY.getDefaultQuota(currentUser.role) || 314572800;
              if (currentUsage + fileSize > maxStorage) {
                await writeSystemLog(db, {
                  user: currentUser,
                  request,
                  action: 'upload_file_denied',
                  category: 'upload',
                  status: 'warning',
                  resourceType: 'file',
                  message: '上传失败：存储配额不足',
                  metadata: { folder, fileName: file.name, fileSize, currentUsage, maxStorage },
                });
                return error(`Storage quota exceeded`, 413);
              }
          }
          await env.BUCKET.put(filename, file.stream(), { httpMetadata: { contentType: file.type } });
          await db.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?').bind(fileSize, currentUser.id).run();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'upload_file',
            category: 'upload',
            resourceType: 'file',
            resourceId: filename,
            message: `上传文件到 ${folder}`,
            metadata: { folder, fileName: file.name, fileSize, contentType: file.type, url: `/api/assets/${filename}` },
          });
          return json({ url: `/api/assets/${filename}`, size: fileSize });
      }

      // --- CRUD Routes ---
      if (path === '/api/users' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { username, password, role = 'user' } = await request.json() as any;
          
          // 使用统一的角色策略验证角色值
          if (!ROLE_POLICY.VALID_ROLES.includes(role as any) || role === 'guest') {
              return error('Invalid role', 400);
          }
          
          const hashedPassword = await bcrypt.hash(password, 10);
          // 使用统一的角色策略获取默认配额，admin 为 null 表示无限制
          const defaultQuota = ROLE_POLICY.getDefaultQuota(role);
          
          try {
              const userId = crypto.randomUUID();
              await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage, max_storage) VALUES (?, ?, ?, ?, ?, 0, ?)')
                  .bind(userId, username, hashedPassword, role, Date.now(), defaultQuota).run();
              await writeSystemLog(db, {
                user: currentUser,
                request,
                action: 'user_create',
                category: 'user',
                resourceType: 'user',
                resourceId: userId,
                message: `创建用户：${username}`,
                metadata: { username, role, maxStorage: defaultQuota },
              });
              return json({ success: true });
          } catch(e) {
              return error('Username exists', 409);
          }
      }
      if (path === '/api/users/password' && method === 'PUT') {
          // Guest cannot change password (guest uses shared passcode, not personal password)
          if (currentUser.role === 'guest') return error('Forbidden: Guest cannot change password', 403);
          const { password } = await request.json() as any;
          const hashedPassword = await bcrypt.hash(password, 10);
          await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashedPassword, currentUser.id).run();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'password_update',
            category: 'user',
            resourceType: 'user',
            resourceId: currentUser.id,
            message: '修改当前用户密码',
            metadata: { passwordLength: typeof password === 'string' ? password.length : 0 },
          });
          return json({ success: true });
      }
      if (path === '/api/users' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          
          // 支持分页参数
          const page = parseInt(url.searchParams.get('page') || '0');
          const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '50'), 100); // 最大100条
          const offset = page * pageSize;
          
          // 获取总数
          const countResult = await db.prepare('SELECT COUNT(*) as total FROM users').first<{total: number}>();
          const total = countResult?.total || 0;
          
          // 分页查询
          const res = await db.prepare('SELECT id, username, role, created_at, last_login, storage_usage, max_storage FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
            .bind(pageSize, offset).all();
          
          // 将数据库字段名（下划线）映射为前端字段名（驼峰）
          return json({
              data: res.results.map((u: any) => ({
                  id: u.id,
                  username: u.username,
                  role: u.role,
                  createdAt: u.created_at,
                  lastLogin: u.last_login,
                  storageUsage: u.storage_usage,
                  maxStorage: u.max_storage
              })),
              pagination: {
                  page,
                  pageSize,
                  total,
                  totalPages: Math.ceil(total / pageSize)
              }
          });
      }
      if (path.startsWith('/api/users/') && method === 'DELETE') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const id = path.split('/').pop();
         if (id === currentUser.id) return error('Cannot delete self', 400);
         const targetUser = await db.prepare('SELECT username, role FROM users WHERE id = ?').bind(id).first<{username: string, role: string}>();
         await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
         await writeSystemLog(db, {
           user: currentUser,
           request,
           action: 'user_delete',
           category: 'user',
           resourceType: 'user',
           resourceId: id,
           message: targetUser ? `删除用户：${targetUser.username}` : '删除用户',
           metadata: targetUser,
         });
         return json({ success: true });
      }
      // 更新用户最大配额
      if (path.match(/^\/api\/users\/[^/]+\/quota$/) && method === 'PUT') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const userId = path.split('/')[3];
         const { maxStorage } = await request.json() as any;

         // 输入验证
         if (typeof maxStorage !== 'number' || maxStorage < 0) {
           return error('Invalid maxStorage value: must be a non-negative number', 400);
         }

         // 设置合理的上限（100GB）
         const MAX_QUOTA_LIMIT = 100 * 1024 * 1024 * 1024; // 100GB
         if (maxStorage > MAX_QUOTA_LIMIT) {
           return error(`Invalid maxStorage value: exceeds maximum limit of 100GB`, 400);
         }

         // 使用事务确保原子性：验证用户存在性 + 更新配额
         const batchResults = await db.batch([
           db.prepare('SELECT id FROM users WHERE id = ?').bind(userId),
           db.prepare('UPDATE users SET max_storage = ? WHERE id = ?').bind(maxStorage, userId)
         ]);

         // 检查第一个查询结果：用户是否存在
         const targetUser = batchResults[0].results?.[0];
         if (!targetUser) {
           return error('User not found', 404);
         }

         // 检查第二个查询结果：更新是否成功
         if (!batchResults[1].success) {
           return error('Failed to update quota', 500);
         }

         await writeSystemLog(db, {
           user: currentUser,
           request,
           action: 'user_quota_update',
           category: 'user',
           resourceType: 'user',
           resourceId: userId,
           message: '更新用户存储配额',
           metadata: { maxStorage },
         });

         return json({ success: true });
      }
      
      // 更新用户角色
      if (path.match(/^\/api\/users\/[^/]+\/role$/) && method === 'PUT') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const userId = path.split('/')[3];
         const { role, resetQuota = false } = await request.json() as any;

         // 使用统一的角色策略验证角色值
         if (!ROLE_POLICY.VALID_ROLES.includes(role as any) || role === 'guest') {
           return error('Invalid role value: must be user, vip, or admin', 400);
         }

         // 不能修改自己的角色
         if (userId === currentUser.id) {
           return error('Cannot change own role', 400);
         }

         // 获取用户当前信息
         const targetUser = await db.prepare('SELECT id, role, max_storage FROM users WHERE id = ?').bind(userId).first<{id: string, role: string, max_storage: number | null}>();
         if (!targetUser) {
           return error('User not found', 404);
         }

         // 只有显式请求重置配额时才更新配额，避免隐藏副作用
         if (resetQuota) {
           const defaultQuota = ROLE_POLICY.getDefaultQuota(role);
           await db.prepare('UPDATE users SET role = ?, max_storage = ? WHERE id = ?').bind(role, defaultQuota, userId).run();
           await writeSystemLog(db, {
             user: currentUser,
             request,
             action: 'user_role_update',
             category: 'user',
             resourceType: 'user',
             resourceId: userId,
             message: `更新用户角色：${targetUser.role} -> ${role}`,
             metadata: { oldRole: targetUser.role, newRole: role, resetQuota: true, maxStorage: defaultQuota },
           });
           return json({ success: true, role, maxStorage: defaultQuota });
         } else {
           // 仅更新角色，保留现有配额
           await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
           await writeSystemLog(db, {
             user: currentUser,
             request,
             action: 'user_role_update',
             category: 'user',
             resourceType: 'user',
             resourceId: userId,
             message: `更新用户角色：${targetUser.role} -> ${role}`,
             metadata: { oldRole: targetUser.role, newRole: role, resetQuota: false, maxStorage: targetUser.max_storage },
           });
           return json({ success: true, role, maxStorage: targetUser.max_storage });
         }
      }

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
          tags: JSON.parse(c.tags || '[]'), previewImage: c.preview_image, base_prompt: c.base_prompt, // raw DB column needed? No, mapping below
          basePrompt: c.base_prompt,
          negativePrompt: c.negative_prompt, modules: JSON.parse(c.modules || '[]'), params: JSON.parse(c.params || '{}'),
          variableValues: JSON.parse(c.variable_values || '{}'), guestHidden: c.guest_hidden === 1, createdAt: c.created_at, updatedAt: c.updated_at
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
          const sanitizedTags = body.tags
            .map(tag => typeof tag === 'string' ? tag.trim().substring(0, 50) : '')
            .filter(tag => tag.length > 0);
          tags = JSON.stringify(sanitizedTags);
        }
        try {
          await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', body.params ? JSON.stringify(body.params) : '{}', body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'chain_create',
            category: 'chain',
            resourceType: type === 'character' ? 'character_chain' : 'style_chain',
            resourceId: id,
            message: `创建${type === 'character' ? '角色串' : '画师串'}：${body.name || id}`,
            metadata: {
              name: body.name,
              type,
              tagCount: Array.isArray(body.tags) ? body.tags.length : 0,
              moduleCount: Array.isArray(body.modules) ? body.modules.length : 0,
              promptLength: typeof body.basePrompt === 'string' ? body.basePrompt.length : 0,
              negativeLength: typeof body.negativePrompt === 'string' ? body.negativePrompt.length : 0,
              guestHidden: Boolean(body.guestHidden),
            },
          });
          return json({ id });
        } catch (e: any) {
          if (isMissingColumnError(e)) {
            await initDB();
            await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, guest_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', body.params ? JSON.stringify(body.params) : '{}', body.variableValues ? JSON.stringify(body.variableValues) : '{}', guestHidden, Date.now(), Date.now()).run();
            await writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'chain_create',
              category: 'chain',
              resourceType: type === 'character' ? 'character_chain' : 'style_chain',
              resourceId: id,
              message: `创建${type === 'character' ? '角色串' : '画师串'}：${body.name || id}`,
              metadata: { name: body.name, type, repairedSchema: true },
            });
            return json({ id });
          }
          throw e;
        }
      }
      const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
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
                 // Delete old cover if exists and different
                 if (chain.preview_image && chain.preview_image !== newUrl) {
                     await deleteR2File(env, chain.preview_image);
                 }
                 updates.previewImage = newUrl;
             } catch (e: any) { return error(e.message, 413); }
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
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: 'chain_update',
          category: 'chain',
          resourceType: (chain.type || updates.type) === 'character' ? 'character_chain' : 'style_chain',
          resourceId: id,
          message: `更新${(chain.type || updates.type) === 'character' ? '角色串' : '画师串'}：${updates.name || chain.name || id}`,
          metadata: {
            fields: Object.keys(updates),
            name: updates.name || chain.name,
            promptLength: typeof updates.basePrompt === 'string' ? updates.basePrompt.length : undefined,
            negativeLength: typeof updates.negativePrompt === 'string' ? updates.negativePrompt.length : undefined,
            moduleCount: Array.isArray(updates.modules) ? updates.modules.length : undefined,
            tagCount: Array.isArray(updates.tags) ? updates.tags.length : undefined,
            hasPreviewImage: updates.previewImage !== undefined,
            guestHidden: updates.guestHidden,
          },
        });
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
            await writeSystemLog(db, {
              user: currentUser,
              request,
              action: 'chain_delete',
              category: 'chain',
              resourceType: chain.type === 'character' ? 'character_chain' : 'style_chain',
              resourceId: id,
              message: `删除${chain.type === 'character' ? '角色串' : '画师串'}：${chain.name || id}`,
              metadata: { name: chain.name, type: chain.type, hadPreviewImage: Boolean(chain.preview_image) },
            });
        }
        return json({ success: true });
      }

      // Artists (Updated with Deletion Logic)
      if (path === '/api/artists' && method === 'GET') {
         const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
         return json(res.results.map((a: any) => ({ id: a.id, name: a.name, imageUrl: a.image_url, previewUrl: a.preview_url, benchmarks: a.benchmarks ? JSON.parse(a.benchmarks) : [] })));
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
            imageUrl = await processImageUpload(env, imageUrl, 'artists', id);
            // Delete old avatar if changed
            if (existing && existing.image_url && existing.image_url !== imageUrl) {
                await deleteR2File(env, existing.image_url);
            }
        } else if (imageUrl && imageUrl.startsWith('http')) {
            // Fetch external image URL and store in R2
            imageUrl = await fetchAndUploadImage(env, imageUrl, 'artists', id, currentUser);
            // Delete old avatar if changed
            if (existing && existing.image_url && existing.image_url !== imageUrl) {
                await deleteR2File(env, existing.image_url);
            }
        }

        // Process benchmarks - handle both Base64 and external URLs
        let benchmarks = body.benchmarks || [];
        if (Array.isArray(benchmarks)) {
            for (let i = 0; i < benchmarks.length; i++) {
                if (benchmarks[i] && benchmarks[i].startsWith('data:')) {
                    // Upload new file
                    const newUrl = await processImageUpload(env, benchmarks[i], `artists/benchmarks_${i}`, id);
                    benchmarks[i] = newUrl;
                    
                    // Check and delete old file at this index
                    const oldUrl = oldBenchmarks[i];
                    if (oldUrl && oldUrl !== newUrl) {
                        await deleteR2File(env, oldUrl);
                    }
                } else if (benchmarks[i] && benchmarks[i].startsWith('http')) {
                    // Fetch external image URL and store in R2
                    const newUrl = await fetchAndUploadImage(env, benchmarks[i], `artists/benchmarks_${i}`, id, currentUser);
                    benchmarks[i] = newUrl;
                    
                    // Check and delete old file at this index
                    const oldUrl = oldBenchmarks[i];
                    if (oldUrl && oldUrl !== newUrl) {
                        await deleteR2File(env, oldUrl);
                    }
                }
            }
        }
        
        // Handle undefined values - convert to null or default
        const previewUrl = body.previewUrl ?? null;
        const benchmarksJson = JSON.stringify(benchmarks || []);
        const sanitizedName = body.name ? body.name.trim() : '';
        
        await db.prepare(`INSERT INTO artists (id, name, image_url, benchmarks, preview_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url, benchmarks = excluded.benchmarks, preview_url = excluded.preview_url`).bind(id, sanitizedName, imageUrl, benchmarksJson, previewUrl).run();
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: existing ? 'artist_update' : 'artist_create',
          category: 'artist',
          resourceType: 'artist',
          resourceId: id,
          message: `${existing ? '更新' : '创建'}画师库条目：${sanitizedName || id}`,
          metadata: {
            name: sanitizedName,
            previousName: existing?.name,
            benchmarkCount: Array.isArray(benchmarks) ? benchmarks.length : 0,
            hasPreviewUrl: Boolean(previewUrl),
            imageChanged: !existing || existing.image_url !== imageUrl,
          },
        });
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
                const bms = JSON.parse(artist.benchmarks);
                for (const url of bms) {
                    if (url) await deleteR2File(env, url);
                }
            }
        }
        await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
        await writeSystemLog(db, {
          user: currentUser,
          request,
          action: 'artist_delete',
          category: 'artist',
          resourceType: 'artist',
          resourceId: id,
          message: artist ? `删除画师库条目：${artist.name || id}` : '删除画师库条目',
          metadata: {
            name: artist?.name,
            hadPreviewUrl: Boolean(artist?.preview_url),
            benchmarkCount: artist?.benchmarks ? JSON.parse(artist.benchmarks).filter(Boolean).length : 0,
          },
        });
        return json({ success: true });
      }

      // Inspirations
      if (path === '/api/inspirations' && method === 'GET') {
        const res = await db.prepare('SELECT * FROM inspirations ORDER BY created_at DESC').all();
        return json(res.results.map((i: any) => ({
          id: i.id,
          userId: i.user_id,
          username: i.username,
          title: i.title,
          imageUrl: i.image_url,
          prompt: i.prompt,
          negativePrompt: i.negative_prompt || '',
          params: i.params ? JSON.parse(i.params) : undefined,
          createdAt: i.created_at
        })));
      }
      if (path === '/api/inspirations' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        
        const body = await request.json() as any;
        let imageUrl = body.imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) { 
          try { imageUrl = await processImageUpload(env, imageUrl, 'inspirations', body.id || crypto.randomUUID(), currentUser); } 
          catch (e: any) { return error(e.message, 413); } 
        }
        
        let paramsJson: string | null = null;
        if (body.params) {
          try {
            paramsJson = JSON.stringify(body.params);
          } catch (e: any) {
            console.error('Failed to serialize params:', e);
            paramsJson = null;
          }
        }
        
        try {
          await db.prepare('INSERT OR REPLACE INTO inspirations (id, user_id, username, title, image_url, prompt, negative_prompt, params, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(body.id, currentUser.id, currentUser.username, body.title, imageUrl, body.prompt, body.negativePrompt || '', paramsJson, body.createdAt)
            .run();
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'inspiration_save',
            category: 'inspiration',
            resourceType: 'inspiration',
            resourceId: body.id,
            message: `保存灵感：${body.title || body.id}`,
            metadata: {
              title: body.title,
              promptLength: typeof body.prompt === 'string' ? body.prompt.length : 0,
              negativeLength: typeof body.negativePrompt === 'string' ? body.negativePrompt.length : 0,
              hasParams: Boolean(body.params),
              imageUrl,
            },
          });
          return json({ success: true });
        } catch (e: any) {
          if (isMissingColumnError(e)) {
            await initDB();
            try {
              await db.prepare('INSERT OR REPLACE INTO inspirations (id, user_id, username, title, image_url, prompt, negative_prompt, params, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(body.id, currentUser.id, currentUser.username, body.title, imageUrl, body.prompt, body.negativePrompt || '', paramsJson, body.createdAt)
                .run();
              await writeSystemLog(db, {
                user: currentUser,
                request,
                action: 'inspiration_save',
                category: 'inspiration',
                resourceType: 'inspiration',
                resourceId: body.id,
                message: `保存灵感：${body.title || body.id}`,
                metadata: { title: body.title, repairedSchema: true },
              });
              return json({ success: true });
            } catch (retryError: any) {
              return error(retryError.message || 'Database initialization failed', 500);
            }
          }
          console.error('POST /api/inspirations error:', e.message, e.stack);
          return error(e.message || 'Internal Server Error', 500);
        }
      }
      if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
          if (currentUser.role === 'guest') return error('Forbidden', 403);
          const { ids } = await request.json() as { ids: string[] };
          let deletedCount = 0;
          let skippedCount = 0;
          for (const id of ids) {
              const item = await db.prepare('SELECT user_id, image_url FROM inspirations WHERE id = ?').bind(id).first<{user_id: string, image_url: string}>();
              if (item) {
                  if (currentUser.role !== 'admin' && item.user_id !== currentUser.id) {
                    skippedCount++;
                    continue;
                  }
                  await deleteR2File(env, item.image_url);
                  await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
                  deletedCount++;
              }
          }
          await writeSystemLog(db, {
            user: currentUser,
            request,
            action: 'inspiration_bulk_delete',
            category: 'inspiration',
            resourceType: 'inspiration',
            message: `批量删除灵感：${deletedCount} 条`,
            metadata: { requestedCount: ids.length, deletedCount, skippedCount, ids },
          });
          return json({ success: true });
      }
      if (path.startsWith('/api/inspirations/') && method === 'PUT') {
         if (currentUser.role === 'guest') return error('Forbidden', 403);
         const id = path.split('/').pop();
         const updates = await request.json() as any;
         const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<{user_id: string}>();
         if (!item) return error('Not Found', 404);
         if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
         const applyInspirationUpdates = async () => {
           if (updates.title) await db.prepare('UPDATE inspirations SET title = ? WHERE id = ?').bind(updates.title, id).run();
           if (updates.prompt) await db.prepare('UPDATE inspirations SET prompt = ? WHERE id = ?').bind(updates.prompt, id).run();
           if (updates.negativePrompt !== undefined) await db.prepare('UPDATE inspirations SET negative_prompt = ? WHERE id = ?').bind(updates.negativePrompt, id).run();
         };
         try {
           await applyInspirationUpdates();
         } catch (e: any) {
           if (isMissingColumnError(e)) {
             await initDB();
             await applyInspirationUpdates();
           } else {
             throw e;
           }
         }
         await writeSystemLog(db, {
           user: currentUser,
           request,
           action: 'inspiration_update',
           category: 'inspiration',
           resourceType: 'inspiration',
           resourceId: id,
           message: `更新灵感：${updates.title || id}`,
           metadata: {
             fields: Object.keys(updates),
             title: updates.title,
             promptLength: typeof updates.prompt === 'string' ? updates.prompt.length : undefined,
             negativeLength: typeof updates.negativePrompt === 'string' ? updates.negativePrompt.length : undefined,
           },
         });
         return json({ success: true });
      }
      if (path.startsWith('/api/inspirations/') && method === 'DELETE') {
         if (currentUser.role === 'guest') return error('Forbidden', 403);
         const id = path.split('/').pop();
         const item = await db.prepare('SELECT user_id, image_url FROM inspirations WHERE id = ?').bind(id).first<{user_id: string, image_url: string}>();
         if (item) {
             if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
             await deleteR2File(env, item.image_url);
             await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
             await writeSystemLog(db, {
               user: currentUser,
               request,
               action: 'inspiration_delete',
               category: 'inspiration',
               resourceType: 'inspiration',
               resourceId: id,
               message: '删除灵感',
               metadata: { imageUrl: item.image_url },
             });
         }
         return json({ success: true });
      }

      if (path.startsWith('/api/')) return error('Not Found', 404);
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      return error(e.message, 500);
    }
  }
};
