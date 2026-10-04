// Danbooru 公开检索与目录封面批次流，共用候选规范化和官方权限边界。
import { json, error, clampInt, type Env, type RouteContext } from './types';
import { matchesDanbooruImageFilters, parseDanbooruExploreQuery, splitDanbooruQuery, validateDanbooruQuery } from '../../services/danbooruQuery';
import { createDanbooruResponseFailure, createDanbooruNetworkFailure, isRetryableDanbooruNetworkError, readDanbooruRetryAfter } from '../../services/danbooruErrors.mjs';

const DANBOORU_BASE_URL = 'https://danbooru.donmai.us';
const DANBOORU_MAX_PAGE_SIZE = 200;
// 官方 only 参数只传页面实际使用的字段，去掉重复总 Tag 字符串与无关审计字段。
const DANBOORU_POST_FIELDS = [
  'id', 'rating', 'score', 'fav_count', 'image_width', 'image_height', 'file_ext', 'source',
  'preview_file_url', 'large_file_url', 'file_url', 'media_asset[variants]',
  'tag_string_general', 'tag_string_artist', 'tag_string_copyright', 'tag_string_character', 'tag_string_meta',
].join(',');

function buildLocalDanbooruFetch(targetUrl: string, env?: Env) {
  if (!env?.DANBOORU_LOCAL_PROXY_URL) return { url: targetUrl, headers: {} as Record<string, string> };
  const proxyUrl = new URL(env.DANBOORU_LOCAL_PROXY_URL);
  proxyUrl.searchParams.set('url', targetUrl);
  return {
    url: proxyUrl.toString(),
    headers: env.LAN_ACCESS_SECRET ? { 'X-Nai-Internal-Secret': env.LAN_ACCESS_SECRET } : {},
  };
}

const waitForDanbooruRetry = (delay: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, delay);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});

// 重查询 500 time-out 和临时连接故障最多三次；网关传回的网络错误也参与判定。
async function fetchDanbooruJson(target: URL, env?: Env, signal?: AbortSignal, background = false) {
  const maxAttempts = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    if (attempt > 0) await waitForDanbooruRetry(1000 * attempt, signal);
    try {
      const localFetch = buildLocalDanbooruFetch(target.toString(), env);
      const response = await fetch(localFetch.url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NAI-Atelier/0.5 (+local personal use)',
          ...localFetch.headers,
          ...(background && env?.DANBOORU_LOCAL_PROXY_URL ? { 'X-Nai-Danbooru-Prefetch': '1' } : {}),
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { /* 非 JSON 交由统一分类。 */ }
      const relayFailure = env?.DANBOORU_LOCAL_PROXY_URL && !response.ok && typeof payload?.code === 'string' && typeof payload?.error === 'string';
      const failure = relayFailure ? {
        status: response.status, error: payload.error, code: payload.code,
        causeCode: payload.causeCode, upstreamStatus: payload.upstreamStatus,
        retryAfter: readDanbooruRetryAfter(response.headers.get('retry-after')) || readDanbooruRetryAfter(payload.retryAfter) || undefined,
      } : createDanbooruResponseFailure(response.status, response.headers, text);
      if (failure) {
        const message = failure.error;
        const isServerTimeOut = response.status === 500 && /timeout|timed out/i.test(message);
        if (isServerTimeOut && attempt < maxAttempts - 1) {
          lastError = new Error(`Danbooru ${response.status}: ${message}`);
          continue;
        }
        if (isServerTimeOut) {
          throw Object.assign(new Error('Danbooru 数据库查询超时（随机检索繁忙），请稍后再试'), { status: 502, code: 'DANBOORU_QUERY_TIMEOUT', upstreamStatus: 500, danbooruDetail: message });
        }
        throw Object.assign(new Error(message), failure);
      }
      if (payload === undefined) throw Object.assign(new Error('Danbooru 返回了无效 JSON'), { status: 502, code: 'DANBOORU_INVALID_RESPONSE', upstreamStatus: response.status });
      return payload;
    } catch (error: any) {
      signal?.throwIfAborted();
      lastError = error;
      if (isRetryableDanbooruNetworkError(error) && attempt < maxAttempts - 1) continue;
      if (!error?.status) {
        const failure = createDanbooruNetworkFailure(error);
        throw Object.assign(new Error(failure.error), failure);
      }
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

// 同一 Worker 内所有批次共用启动时钟；屏幕内短突发错开，附近预取每秒一条。
let coverStartQueue = Promise.resolve();
let nextCoverStartAt = 0;
const startCoverQuery = (signal: AbortSignal, background: boolean) => {
  const start = coverStartQueue.then(async () => {
    signal.throwIfAborted();
    while (nextCoverStartAt > Date.now()) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, nextCoverStartAt - Date.now());
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
      });
      signal.throwIfAborted();
    }
    nextCoverStartAt = Date.now() + (background ? 1000 : 100);
  });
  coverStartQueue = start.catch(() => {});
  return start;
};

export async function handleDanbooruRoute(ctx: RouteContext): Promise<Response | null> {
  const { env, url, path, method } = ctx;

  if (path === '/api/danbooru/covers' && method === 'POST') {
    try {
      const text = await ctx.request.text();
      if (text.length > 8192) return error('封面查询过大', 400);
      const body = JSON.parse(text);
      if (!Array.isArray(body.requests) || !body.requests.length || body.requests.length > 5) return error('每批封面查询必须为 1～5 项', 400);
      const urls = body.requests.map((item: any) => {
        if (typeof item?.query !== 'string' || item.query.length > 500
          || !Number.isInteger(item.page) || item.page < 1 || item.page > 1000
          || !Number.isInteger(item.limit) || item.limit < 1 || item.limit > 200) throw new Error('无效的封面查询');
        const query = normalizeDanbooruQuery(item.query);
        const target = new URL('/api/danbooru/posts', url);
        target.search = new URLSearchParams({ tags: query, page: String(item.page), limit: String(item.limit) }).toString();
        return target;
      });
      const controller = new AbortController();
      const signal = AbortSignal.any([ctx.request.signal, controller.signal]);
      const encoder = new TextEncoder();
      const emit = (output: ReadableStreamDefaultController<Uint8Array>, frame: string) => {
        if (signal.aborted) return;
        try { output.enqueue(encoder.encode(frame)); }
        catch { controller.abort(); }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(output) {
          emit(output, ': covers\n\n');
          void Promise.all(urls.map(async (target: URL, index: number) => {
            try {
              // 本地网关在缓存之后统一控制真实联网；缓存命中不应等待上游启动间隔。
              if (env.DANBOORU_LOCAL_PROXY_URL) signal.throwIfAborted();
              else await startCoverQuery(signal, body.background === true);
              const response = (await handleDanbooruRoute({ ...ctx, url: target, path: target.pathname, method: 'GET', request: new Request(target, { signal, headers: body.background === true ? { 'X-Nai-Cover-Background': '1' } : {} }) }))!;
              const data = await response.json();
              if (response.status === 429 || response.status === 403) nextCoverStartAt = Math.max(nextCoverStartAt, Date.now() + (readDanbooruRetryAfter(data.retryAfter) || (response.status === 403 ? 300 : 30)) * 1000);
              emit(output, `event: result\ndata: ${JSON.stringify({ index, status: response.status, data })}\n\n`);
            } catch (e) {
              emit(output, `event: result\ndata: ${JSON.stringify({ index, status: 502, data: { error: e instanceof Error ? e.message : '封面查询失败' } })}\n\n`);
            }
          })).finally(() => {
            if (!signal.aborted) { try { output.close(); } catch { controller.abort(); } }
          });
        },
        cancel() { controller.abort(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    } catch (e) { return error(e instanceof Error ? e.message : '无效的封面查询', 400); }
  }

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
      target.searchParams.set('only', DANBOORU_POST_FIELDS);

      const payload = await fetchDanbooruJson(target, env, ctx.request?.signal, ctx.request?.headers.get('x-nai-cover-background') === '1');
      if (!Array.isArray(payload)) throw new Error('Danbooru 返回了无效的图片列表');
      const items = payload
        .map(normalizeDanbooruPost)
        .filter(post => post && (!explore || matchesDanbooruImageFilters(post, explore.filters)));
      // 用筛选前的上游页长判断后续页，不能把筛选后的空页误报为全部加载完毕。
      return json({ items, page: isRandom ? 1 : page, limit, query, hasMore: !isRandom && page < 1000 && payload.length >= limit }, 200, {
        'Cache-Control': isRandom ? 'no-cache, no-store' : 'private, max-age=120',
      });
    } catch (e: any) {
      const status = Number(e?.status) >= 400 && Number(e?.status) <= 599 ? Number(e.status) : 502;
      const retryAfter = readDanbooruRetryAfter(e?.retryAfter);
      return json({ error: e?.message || 'Danbooru 查询失败', code: e?.code, causeCode: e?.causeCode, upstreamStatus: e?.upstreamStatus, ...(retryAfter ? { retryAfter } : {}) }, status, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
    }
  }

  return null;
}
