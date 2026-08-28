// AITag scraping + reverse-proxy routes.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { json, error, clampInt, sleep, type D1Database, type Env, type RouteContext } from './types';

const AITAG_BASE_URL = 'https://aitag.win';
const AITAG_IMAGE_BASE_URL = 'https://ai-img.10118899.xyz/';
const AITAG_MIN_PAGE_SIZE = 60;
const AITAG_MAX_PAGE_SIZE = 60;
const AITAG_CACHE_DEFAULT_TARGET_PAGES = 500;
const AITAG_CACHE_BATCH_PAGES = 2;
const AITAG_CACHE_DELAY_MIN_MS = 800;
const AITAG_CACHE_DELAY_MAX_MS = 1200;
const AITAG_CONFIG_VERSION = '260528a';

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
const AITAG_SOURCE_AI_TYPE: AitagAiTypeFilter = 'nai';

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

function normalizeAitagAiTypeFilter(_value: string | null): AitagAiTypeFilter {
  return AITAG_SOURCE_AI_TYPE;
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

export async function ensureAitagCacheSchema(db: D1Database) {
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

async function cacheAitagFirstImage(env: Env, db: D1Database, work: any): Promise<boolean> {
  const workId = Number(work?.id);
  if (!Number.isFinite(workId)) return true;
  const sourceSort = normalizeAitagSourceSort(work?.source_sort || null);

  const existing = await db.prepare(`
    SELECT local_cover_url, remote_cover_url, first_image_json FROM aitag_works
    WHERE id = ? AND source_sort = ?
  `).bind(workId, sourceSort).first<{local_cover_url?: string; remote_cover_url?: string; first_image_json?: string}>();
  if (existing?.local_cover_url && existing?.first_image_json) return true;

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
    return true;
  } catch (e: any) {
    const now = Date.now();
    await db.prepare(`
      UPDATE aitag_works
      SET cover_status = ?, updated_at = ?
      WHERE id = ? AND source_sort = ? AND (local_cover_url IS NULL OR local_cover_url = '')
    `).bind('error', now, workId, sourceSort).run();
    console.error(`Failed to cache aitag first image ${workId}:`, e?.message || e);
    return false;
  }
}

async function cacheAitagFirstImagesForWorks(env: Env, db: D1Database, works: any[], sort: string) {
  if (!Array.isArray(works)) return;
  let consecutiveFailures = 0;
  for (const work of works) {
    const success = await cacheAitagFirstImage(env, db, { ...work, source_sort: sort });
    if (!success) {
      consecutiveFailures++;
      // 连续失败说明 aitag.win 正在挑战/限流，本轮熔断避免轰炸并刷屏错误日志；
      // 未处理的作品保持原状态，下次加载会继续重试。
      if (consecutiveFailures >= 2) {
        console.warn(`[aitag] 首图缓存连续失败 ${consecutiveFailures} 次，本轮暂停（${works.length} 个待处理）`);
        return;
      }
    } else {
      consecutiveFailures = 0;
    }
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

// All /api/aitag/* routes, in the original dispatch order.
export async function handleAitagRoute(ctx: RouteContext): Promise<Response | null> {
  const { request, env, url, path, method, db, initDB, ctx: workerCtx } = ctx;

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
      if (workerCtx?.waitUntil) workerCtx?.waitUntil(firstImageTask);
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
          if (workerCtx?.waitUntil) workerCtx?.waitUntil(upgradeTask);
          else upgradeTask.catch(console.error);
        }
        return json(cached, 200, { 'Cache-Control': 'no-store' });
      }

      const detail = await fetchAitagJson(target, env);
      const cachedDetail = await cacheAitagDetailFirstImageOnly(env, db, detail);
      const backgroundCacheTask = cacheAitagDetail(env, db, cachedDetail);
      if (workerCtx?.waitUntil) workerCtx?.waitUntil(backgroundCacheTask);
      else backgroundCacheTask.catch(console.error);
      return json(cachedDetail, 200, { 'Cache-Control': 'no-store' });
    } catch (e: any) {
      throw e;
    }
  }

  return null;
}
