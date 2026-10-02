// Danbooru proxy/search routes.
// Moved verbatim from worker/index.ts during the domain split; behavior unchanged.
import { json, error, clampInt, type Env, type RouteContext } from './types';
import { matchesDanbooruImageFilters, parseDanbooruExploreQuery, splitDanbooruQuery, validateDanbooruQuery } from '../../services/danbooruQuery';

const DANBOORU_BASE_URL = 'https://danbooru.donmai.us';
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

// Danbooru 在负载高时会对重查询返回 500 time-out（官方文档亦有多项说明）；
// 上游 500 time-out 自动重试，网络超时同样重试，避免瞬时负载造成偶发失败。
async function fetchDanbooruJson(target: URL, env?: Env) {
  const maxAttempts = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) { const { promise, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 1000 * attempt); await promise; }
    try {
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
        const isServerTimeOut = response.status === 500 && /timeout|timed out/i.test(message);
        if (isServerTimeOut && attempt < maxAttempts - 1) {
          lastError = new Error(`Danbooru ${response.status}: ${message}`);
          continue;
        }
        if (isServerTimeOut) {
          throw Object.assign(new Error('Danbooru 数据库查询超时（随机检索繁忙），请稍后再试'), { status: 502, danbooruDetail: message });
        }
        throw Object.assign(new Error(`Danbooru ${response.status}: ${message}`), { status: response.status });
      }
      try { return JSON.parse(text); } catch { throw new Error('Danbooru 返回了无效 JSON'); }
    } catch (error: any) {
      lastError = error;
      const networkTimeOut = error?.name === 'TimeoutError'
        || error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
        || error?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT'
        || error?.cause?.code === 'UND_ERR_SOCKET';
      if (networkTimeOut && attempt < maxAttempts - 1) continue;
      throw error;
    }
  }
  throw lastError;
}

const splitDanbooruTags = (value: unknown) => String(value || '').split(/\s+/).map(tag => tag.trim()).filter(Boolean);

function normalizeDanbooruPost(post: any) {
  const variants = Array.isArray(post?.media_asset?.variants) ? post.media_asset.variants : [];
  const publicImageUrl = (value: unknown) => {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'cdn.donmai.us'
        && !url.username && !url.password && (!url.port || url.port === '443') ? value : '';
    }
    catch { return ''; }
  };
  // 只使用上游实际公开的地址；预览缺失时仍可用公开缩略变体或大图，不推算受限地址。
  const variantUrl = (type: string) => variants.map((variant: any) => variant?.type === type ? publicImageUrl(variant?.url) : '').find(Boolean) || '';
  const sampleUrl = variantUrl('720x720') || variantUrl('360x360')
    || publicImageUrl(post?.large_file_url) || publicImageUrl(post?.file_url)
    || publicImageUrl(post?.preview_file_url) || variantUrl('180x180');
  const previewUrl = publicImageUrl(post?.preview_file_url) || variantUrl('180x180') || variantUrl('360x360') || sampleUrl;
  if (!Number.isFinite(Number(post?.id)) || !previewUrl) return null;
  return {
    id: Number(post.id),
    rating: String(post.rating || 'g'),
    score: Number(post.score || 0),
    favCount: Number(post.fav_count || 0),
    width: Number(post.image_width || 0),
    height: Number(post.image_height || 0),
    fileExt: String(post.file_ext || ''),
    previewUrl,
    sampleUrl,
    sourceUrl: String(post.source || '').slice(0, 2048),
    postUrl: `https://danbooru.donmai.us/posts/${Number(post.id)}`,
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
  const query = String(value || '').trim().replace(/[,，]+/g, ' ').replace(/\s+/g, ' ');
  if (!query) return 'order:rank';
  try { validateDanbooruQuery(query); }
  catch (e) { throw Object.assign(e as Error, { status: 400 }); }
  return query;
};

export async function handleDanbooruRoute(ctx: RouteContext): Promise<Response | null> {
  const { env, url, path, method } = ctx;

  if (path === '/api/danbooru/posts' && method === 'GET') {
    try {
      const page = clampInt(url.searchParams.get('page'), 1, 1, 1000);
      const limit = clampInt(url.searchParams.get('limit'), 40, 1, DANBOORU_MAX_PAGE_SIZE);
      const query = normalizeDanbooruQuery(url.searchParams.get('tags'));
      const isRandom = splitDanbooruQuery(query).includes('order:random');
      const explore = parseDanbooruExploreQuery(query);
      
      let target: URL;
      // 当全局无额外 Tag 且请求 popular/rank 时，优先使用 Danbooru Explore Popular 接口，避免大库全表排序 500 超时
      if (explore) {
        target = new URL('/explore/posts/popular.json', DANBOORU_BASE_URL);
        target.searchParams.set('scale', explore.scale);
      } else {
        target = new URL('/posts.json', DANBOORU_BASE_URL);
        target.searchParams.set('tags', query);
      }
      // 随机不翻页；普通搜索与排行榜都传入实际页码和页长。
      target.searchParams.set('page', isRandom ? '1' : String(page));
      target.searchParams.set('limit', String(limit));

      const payload = await fetchDanbooruJson(target, env);
      if (!Array.isArray(payload)) throw new Error('Danbooru 返回了无效的图片列表');
      const items = payload
        .map(normalizeDanbooruPost)
        .filter(post => post && (!explore || matchesDanbooruImageFilters(post, explore.filters)));
      // 用筛选前的上游页长判断后续页，不能把筛选后的空页误报为全部加载完毕。
      return json({ items, page: isRandom ? 1 : page, limit, query, hasMore: !isRandom && page < 1000 && payload.length >= limit }, 200, {
        'Cache-Control': isRandom ? 'no-cache, no-store' : 'private, max-age=120',
      });
    } catch (e: any) {
      return error(e?.message || 'Danbooru 查询失败', Number(e?.status) >= 400 && Number(e?.status) < 500 ? Number(e.status) : 502);
    }
  }

  return null;
}
