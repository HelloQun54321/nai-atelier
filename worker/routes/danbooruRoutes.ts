// Danbooru proxy/search routes.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { json, error, clampInt, type D1Database, type Env, type RouteContext } from './types';

const DANBOORU_BASE_URL = 'https://safebooru.donmai.us';
const DANBOORU_MAX_PAGE_SIZE = 200;

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

export async function handleDanbooruRoute(ctx: RouteContext): Promise<Response | null> {
  const { env, url, path, method } = ctx;

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

  return null;
}
