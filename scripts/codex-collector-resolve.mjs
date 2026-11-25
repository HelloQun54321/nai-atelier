export const CODEX_SITE_HOST = 'novelai.quicktagcloud.com';
export const CODEX_ASSET_HOST = 'assets.quicktagcloud.com';
export const CODEX_COMMUNITY_HOSTS = Object.freeze([
  'novelai-strings.quicktagcloud.com',
  'pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev',
]);

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_HTML_BYTES = 32 * 1024;
const GENERIC_SHARE_TITLES = new Set(['法典图鉴', 'NovelAI Tag Atlas']);

const bootstrapCache = new Map();
const bookCache = new Map();
const communityCache = new Map();

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function isSafeSegment(value) {
  return Boolean(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractMetaMap(html) {
  const result = {};
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    const attrRe = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match;
    while ((match = attrRe.exec(tag)) !== null) {
      attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !result[key]) result[key] = attrs.content.trim();
  }
  return result;
}

function cleanShareTitle(rawTitle) {
  const trimmed = String(rawTitle || '').replace(/\s*\|\s*法典图鉴\s*$/i, '').trim();
  if (!trimmed || GENERIC_SHARE_TITLES.has(trimmed) || trimmed === '法典图鉴 | NovelAI Tag Atlas') return '';
  const parts = trimmed.split(/\s+·\s+/);
  const title = parts[0].trim();
  return GENERIC_SHARE_TITLES.has(title) ? '' : title;
}

function encodePathSegments(path) {
  return String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

function bookEntryOriginal(entry, book, media) {
  const path = Array.isArray(entry.path) ? entry.path : [];
  const topDir = String(path[0] ?? '').trim();
  const allowOriginal = book.hasOriginal === true || (Array.isArray(book.originalSections) && book.originalSections.includes(topDir));
  const images = Array.isArray(entry.images) ? [...entry.images] : [];
  if (entry.image && !images.some(item => (typeof item === 'string' ? item : item?.path || item?.image) === entry.image)) {
    images.unshift({ path: entry.image, original: entry.original });
  }
  if (!images.length) return { noOriginal: true, candidates: [], fallbackUrl: '', name: String(entry.title || '') };
  const coverIndex = Math.min(Math.max(0, Number(entry.coverIndex) || 0), images.length - 1);
  const rawCover = images[coverIndex];
  const cover = typeof rawCover === 'string' ? { path: rawCover } : (rawCover && typeof rawCover === 'object' ? rawCover : {});
  const thumbFile = cover.path || cover.file || cover.image || cover.url || '';
  const origFile = allowOriginal && cover._hasOriginal !== false ? (cover.original || '') : '';
  const toUrl = (file, original) => {
    if (!file) return '';
    let value = String(file);
    if (!/^https?:\/\//i.test(value)) {
      if (book.assetPathMode === 'relative') {
        const base = String(book.assetBaseUrl || '').replace(/\/+$/, '');
        value = base ? `${base}/${encodePathSegments(value)}` : '';
      } else {
        const prefix = original ? (media.originalPrefix || 'originals') : (media.imagePrefix || 'images');
        const assetCodexId = entry.assetCodexId || book.id;
        const base = String(media.baseUrl || `https://${CODEX_ASSET_HOST}`).replace(/\/+$/, '');
        value = `${base}/${encodePathSegments(`${prefix}/${assetCodexId}/${value}`)}`;
      }
    }
    if (!value) return '';
    try {
      const url = new URL(value);
      if (entry.assetRev) url.searchParams.set('v', String(entry.assetRev));
      return url.href;
    } catch {
      return '';
    }
  };
  const fallbackUrl = toUrl(thumbFile, false);
  const origUrl = toUrl(origFile, true);
  return {
    noOriginal: !origUrl,
    candidates: origUrl ? [origUrl] : [],
    fallbackUrl,
    name: String(entry.title || ''),
  };
}

function communityEntryOriginal(entry) {
  const images = Array.isArray(entry.images) ? entry.images : [];
  if (!images.length) return { noOriginal: true, candidates: [], fallbackUrl: '', name: String(entry.title || '') };
  const coverIndex = Math.min(Math.max(0, Number(entry.coverIndex) || 0), images.length - 1);
  const cover = images[coverIndex] && typeof images[coverIndex] === 'object' ? images[coverIndex] : {};
  const toUrl = value => {
    if (!value || typeof value !== 'string') return '';
    return /^https?:\/\//i.test(value) ? value : `https://pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev/${value.replace(/^\/+/, '')}`;
  };
  const fallbackUrl = toUrl(cover.file || cover.path || cover.image || cover.url);
  const origUrl = cover._hasOriginal === false ? '' : toUrl(cover.original);
  return {
    noOriginal: !origUrl,
    candidates: origUrl ? [origUrl] : [],
    fallbackUrl,
    name: String(entry.title || ''),
  };
}

async function cachedJson(cache, key, loader) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/** 判断 HTTP 下载错误是否为 404（供多后缀原图试探跳过）。 */
export function isNotFoundDownloadError(error) {
  return error?.status === 404 || /\(404\)/.test(String(error?.message || ''));
}

/** 解析法典分享链接（书目分享页或共创广场条目链接）；不匹配返回 null。 */
export function parseCodexShareUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || /\s/.test(raw.trim())) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname.toLowerCase() !== CODEX_SITE_HOST) return null;
    const shareMatch = url.pathname.match(/^\/share\/([^/]+)\/([^/]+)\/?$/);
    if (shareMatch) {
      const bookId = decodePathPart(shareMatch[1]);
      const entryId = decodePathPart(shareMatch[2]);
      if (!isSafeSegment(bookId) || !isSafeSegment(entryId)) return null;
      return { kind: 'share', bookId, entryId, href: url.href };
    }
    if (url.pathname === '/strings.html') {
      const entryId = (url.searchParams.get('entry') || '').trim();
      if (!isSafeSegment(entryId) || entryId.length > 256) return null;
      return { kind: 'community', entryId, href: url.href };
    }
  } catch { /* 非法 URL 返回 null。 */ }
  return null;
}

export function isCodexShareUrl(raw) {
  return Boolean(parseCodexShareUrl(raw));
}

/** 将法典预览图 URL 升级为原图候选地址列表；非法典预览图返回 null。 */
export function codexOriginalCandidates(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === CODEX_ASSET_HOST) {
      const match = url.pathname.match(/^\/images\/([^/]+)\/(.+)\.(png|jpe?g|webp|gif|avif)$/i);
      if (!match) return null;
      const bookId = match[1];
      const stem = match[2];
      const base = `${url.origin}/originals/${bookId}/${stem}`;
      const candidates = [...new Set(['png', 'webp', 'jpg'].map(ext => `${base}.${ext}${url.search}`))];
      return { kind: 'codex-book-image', candidates, fallbackUrl: url.href };
    }
    if (CODEX_COMMUNITY_HOSTS.includes(host)) {
      const match = url.pathname.match(/^(\/community\/img\/[^/]+\/.+?)\.(jpe?g|webp|gif|avif)$/i);
      if (!match || /\.orig$/i.test(match[1])) return null;
      const prefix = `${url.origin}${match[1]}`;
      return {
        kind: 'codex-community-image',
        candidates: [`${prefix}.orig.png${url.search}`, `${prefix}.orig.webp${url.search}`],
        fallbackUrl: url.href,
      };
    }
  } catch { /* 非法 URL 返回 null。 */ }
  return null;
}

/**
 * 解析法典分享链接对应的封面原图候选与名称。
 * 先走轻量规则与分享页 <head> 元标签，仅在直接原图 404 时才按需回查对应书目/广场索引。
 */
export async function resolveCodexShareCover(shareUrl, { signal, fetchText } = {}) {
  const parsed = parseCodexShareUrl(shareUrl);
  if (!parsed) return null;
  const loadText = fetchText || (async (url, opts) => {
    const { downloadCollectorText } = await import('./collector-download.mjs');
    return downloadCollectorText(url, opts);
  });
  const fetchJson = async url => JSON.parse(await loadText(url, { signal, maxBytes: MAX_JSON_BYTES, accept: 'application/json' }));

  if (parsed.kind === 'community') {
    const encodedId = encodeURIComponent(parsed.entryId);
    const prefix = `https://${CODEX_COMMUNITY_HOSTS[0]}/community/img/${encodedId}/1`;
    return {
      candidates: [`${prefix}.orig.png`, `${prefix}.orig.webp`],
      fallbackUrl: `${prefix}.jpg`,
      name: '',
      resolveFallback: async () => {
        const data = await cachedJson(communityCache, 'community', () => fetchJson(`https://${CODEX_SITE_HOST}/api/community`));
        const entry = Array.isArray(data?.entries) ? data.entries.find(item => String(item?.id || '') === parsed.entryId) : null;
        return entry ? communityEntryOriginal(entry) : null;
      },
    };
  }

  let ogImage = '';
  let name = '';
  try {
    const html = await loadText(parsed.href, { signal, maxBytes: MAX_HTML_BYTES, stopAfter: '</head>', accept: 'text/html' });
    const meta = extractMetaMap(html);
    ogImage = meta['og:image'] || meta['twitter:image'] || '';
    name = cleanShareTitle(meta['og:title'] || meta['twitter:title'] || '');
  } catch (error) {
    if (signal?.aborted) throw error;
    // 分享页读取异常时继续尝试直接按路径构造原图与索引兜底，由后续下载统一报错或跳过。
  }

  const upgraded = ogImage ? codexOriginalCandidates(ogImage) : null;
  const encodedBook = encodeURIComponent(parsed.bookId);
  const encodedEntry = encodeURIComponent(parsed.entryId);
  const directCandidates = upgraded?.candidates || [
    `https://${CODEX_ASSET_HOST}/originals/${encodedBook}/${encodedEntry}.png`,
    `https://${CODEX_ASSET_HOST}/originals/${encodedBook}/${encodedEntry}.webp`,
  ];
  const fallbackUrl = upgraded?.fallbackUrl || ogImage || `https://${CODEX_ASSET_HOST}/images/${encodedBook}/${encodedEntry}.jpg`;

  return {
    candidates: directCandidates,
    fallbackUrl,
    name,
    resolveFallback: async () => {
      const boot = await cachedJson(bootstrapCache, 'boot', async () => {
        const source = await fetchJson(`https://${CODEX_SITE_HOST}/data-source.json`);
        const pointer = await fetchJson(`${source.baseUrl}/${source.pointer}`);
        const baseUrl = `${source.baseUrl}/releases/${pointer.release}`;
        const [books, media] = await Promise.all([
          fetchJson(`${baseUrl}/codexes.json`),
          fetchJson(`${baseUrl}/media.json`),
        ]);
        return { baseUrl, books: Array.isArray(books) ? books : [], media: media || {} };
      });
      const book = boot.books.find(item => item?.id === parsed.bookId);
      if (!book) return null;
      const dataUrl = book.dataUrl || `${boot.baseUrl}/${encodeURIComponent(book.id)}.json`;
      const bookData = await cachedJson(bookCache, `${boot.baseUrl}:${book.id}`, () => fetchJson(dataUrl));
      const entry = Array.isArray(bookData?.entries) ? bookData.entries.find(item => String(item?.id || '') === parsed.entryId) : null;
      if (!entry) return null;
      return bookEntryOriginal(entry, book, boot.media);
    },
  };
}
