import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDanbooruRoute } from './danbooruRoutes';
import type { Env, RouteContext } from './types';

const post = (id = 1, overrides = {}) => ({
  id, preview_file_url: `https://cdn.donmai.us/preview/${id}.jpg`, file_url: `https://cdn.donmai.us/original/${id}.png`,
  rating: 'g', image_width: 800, image_height: 1200, tag_string_general: 'solo', ...overrides,
});
const invoke = async (tags: string, page = 1, limit = 2, env: Partial<Env> = {}) => {
  const url = new URL('http://localhost/api/danbooru/posts');
  url.search = new URLSearchParams({ tags, page: String(page), limit: String(limit) }).toString();
  const response = (await handleDanbooruRoute({ url, path: url.pathname, method: 'GET', env } as RouteContext))!;
  return { response, body: await response.json() };
};
const mockFetch = (payload: unknown) => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const batchHandler = async () => {
  vi.resetModules();
  const { handleDanbooruRoute: handle } = await import('./danbooruRoutes');
  return async (requests: unknown[], background = false, env: Partial<Env> = {}) => {
    const url = new URL('http://localhost/api/danbooru/covers');
    const request = new Request(url, { method: 'POST', body: JSON.stringify({ requests, background }) });
    return (await handle({ url, path: url.pathname, method: 'POST', request, env } as RouteContext))!;
  };
};
const coverQuery = (query: string) => ({ query, page: 1, limit: 60 });

describe('封面合并流', () => {
  it('本地缓存可立即并行返回，实际联网预算交给网关；保留后台标记与取消信号', async () => {
    vi.useFakeTimers(); const invokeBatch = await batchHandler();
    const fetchMock = mockFetch([post()]);
    const finished = (await invokeBatch(['a', 'b', 'c', 'd'].map(coverQuery), true, {
      DANBOORU_LOCAL_PROXY_URL: 'http://127.0.0.1:3000/__internal/danbooru-fetch', LAN_ACCESS_SECRET: 'synthetic-secret',
    })).text();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, options]) => options.headers['X-Nai-Danbooru-Prefetch'] === '1' && options.signal instanceof AbortSignal)).toBe(true);
    expect(await finished).toContain('"index":3');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('复用普通查询校验，超量或非法参数整批拒绝，不启动上游请求', async () => {
    const fetchMock = mockFetch([]); const invokeBatch = await batchHandler();
    for (const requests of [[], Array.from({ length: 5 }, () => coverQuery('solo')), [coverQuery('a b c')], [{ ...coverQuery('solo'), page: 0 }]]) {
      expect((await invokeBatch(requests)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('慢查询不阻挡其他结果，共用启动间隔且保留评级和公开地址规则', async () => {
    vi.useFakeTimers(); const invokeBatch = await batchHandler();
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      starts.push(Date.now());
      if (new URL(url).searchParams.get('tags') === 'slow') await blocked;
      return new Response(JSON.stringify([post(1, { rating: 'e' })]));
    }));
    const response = await invokeBatch([coverQuery('slow'), coverQuery('fast')]);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const reader = response.body!.getReader(); await reader.read();
    await vi.advanceTimersByTimeAsync(200);
    const result = new TextDecoder().decode((await reader.read()).value);
    expect(result).toContain('"index":1'); expect(result).toContain('"rating":"e"');
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(150);
    release(); await vi.runAllTimersAsync();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"index":0');
    expect((await reader.read()).done).toBe(true);
  });
  it('429 立即逐项反馈，共同延后尚未发出的查询，后台每秒最多启动一项', async () => {
    vi.useFakeTimers(); const invokeBatch = await batchHandler();
    const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? new Response('{"message":"rate limited"}', { status: 429 }) : new Response('[]');
    }));
    const response = await invokeBatch([coverQuery('first'), coverQuery('second')], true);
    const finished = response.text();
    await vi.advanceTimersByTimeAsync(1999); expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2000);
    expect(await finished).toContain('"status":429');
    const background = (await invokeBatch([coverQuery('a'), coverQuery('b')], true)).text();
    await vi.runAllTimersAsync(); await background;
    expect(starts[3] - starts[2]).toBeGreaterThanOrEqual(1000);
  });
  it('取消响应流会中止正在联网的查询，也撤销尚未开始的项', async () => {
    vi.useFakeTimers(); const invokeBatch = await batchHandler();
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = options.signal!;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invokeBatch([coverQuery('a'), coverQuery('b')]);
    await vi.advanceTimersByTimeAsync(1);
    await response.body!.cancel(); await vi.runAllTimersAsync();
    expect(signal.aborted).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Danbooru 请求、筛选与分页', () => {
  it('精简字段保留所有展示／选图字段和公开变体，不传重复总 Tag 字符串', async () => {
    const fetchMock = mockFetch([post()]);
    await invoke('synthetic');
    const fields = new URL(fetchMock.mock.calls[0][0]).searchParams.get('only')!.split(',');
    expect(fields).toEqual(expect.arrayContaining(['id', 'rating', 'score', 'fav_count', 'image_width', 'image_height', 'file_ext', 'source', 'preview_file_url', 'large_file_url', 'file_url', 'media_asset[variants]', 'tag_string_general', 'tag_string_artist', 'tag_string_copyright', 'tag_string_character', 'tag_string_meta']));
    expect(fields).not.toContain('tag_string');
  });
  it('不加 SFW 条件，四种评级的公开封面都返回', async () => {
    const fetchMock = mockFetch(['g', 's', 'q', 'e'].map((rating, index) => post(index + 1, { rating })));
    const query = 'synthetic order:score -status:banned';
    const { body } = await invoke(query, 1, 60);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('tags')).toBe(query);
    expect(body.items.map((item: { rating: string }) => item.rating)).toEqual(['g', 's', 'q', 'e']);
  });
  it('缺失预览仍保留上游公开变体或大图，不构造无权限地址', async () => {
    mockFetch([
      post(1, { preview_file_url: '', file_url: '', media_asset: { variants: [{ type: '720x720', url: 'https://cdn.donmai.us/sample/1.webp' }] } }),
      post(2, { preview_file_url: '', large_file_url: 'https://cdn.donmai.us/sample/2.jpg' }),
      post(3, { preview_file_url: '', file_url: '' }),
      post(4, { preview_file_url: 'https://cdn.donmai.us.evil.example/4.jpg', file_url: '', media_asset: { variants: [{ type: '360x360', url: 'https://cdn.donmai.us/preview/4.jpg' }] } }),
      post(5, { preview_file_url: '', file_url: 'https://cdn.donmai.us@evil.example/5.jpg' }),
    ]);
    const { body } = await invoke('synthetic order:score');
    expect(body.items.map((item: { id: number }) => item.id)).toEqual([1, 2, 4]);
    expect(body.items[0]).toMatchObject({ previewUrl: 'https://cdn.donmai.us/sample/1.webp', sampleUrl: 'https://cdn.donmai.us/sample/1.webp' });
    expect(body.items[1]).toMatchObject({ previewUrl: 'https://cdn.donmai.us/sample/2.jpg', sampleUrl: 'https://cdn.donmai.us/sample/2.jpg' });
    expect(body.items[2].previewUrl).toBe('https://cdn.donmai.us/preview/4.jpg');
  });
  it.each(['day', 'week', 'month'])('排行榜 %s 使用网关支持的接口，传入实际页码与页长', async scale => {
    const fetchMock = mockFetch([post(1), post(2)]);
    const { body } = await invoke(`explore:popular_${scale}`, 3);
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.pathname).toBe('/explore/posts/popular.json');
    expect(target.searchParams.get('only')).toContain('media_asset[variants]');
    target.searchParams.delete('only');
    expect(Object.fromEntries(target.searchParams)).toEqual({ scale, page: '3', limit: '2' });
    expect(body).toMatchObject({ page: 3, limit: 2, hasMore: true });
    expect(body.items).toHaveLength(2);
  });
  it('本机代理保留完整排行榜参数及内部鉴权', async () => {
    const fetchMock = mockFetch([]);
    await invoke('explore:popular_week', 2, 40, { DANBOORU_LOCAL_PROXY_URL: 'http://127.0.0.1:3000/api/internal/danbooru-remote', LAN_ACCESS_SECRET: 'synthetic-secret' });
    const [address, options] = fetchMock.mock.calls[0];
    const proxy = new URL(address);
    expect(proxy.origin).toBe('http://127.0.0.1:3000');
    const target = new URL(proxy.searchParams.get('url')!);
    expect(target.pathname).toBe('/explore/posts/popular.json');
    expect(target.searchParams.get('only')).toContain('media_asset[variants]');
    target.searchParams.delete('only');
    expect(Object.fromEntries(target.searchParams)).toEqual({ scale: 'week', page: '2', limit: '40' });
    expect(options.headers['X-Nai-Internal-Secret']).toBe('synthetic-secret');
  });
  it('单关键词的排序、评级、画幅同时传给普通搜索，不误算名额', async () => {
    const fetchMock = mockFetch([post()]);
    const query = 'frieren order:score rating:g ratio:<0.85';
    const { response, body } = await invoke(query);
    expect(response.status).toBe(200);
    const target = new URL(fetchMock.mock.calls[0][0]);
    expect(target.pathname).toBe('/posts.json');
    expect(target.searchParams.get('tags')).toBe(query);
    expect(body.hasMore).toBe(false);
  });
  it('排行榜本地筛选，筛选后空页仍按原始页长判定有后续页', async () => {
    mockFetch([post(1, { rating: 'e' }), post(2, { tag_string_general: '1girl 1boy' })]);
    const { response, body } = await invoke('explore:popular_month rating:g ratio:<0.85 solo', 2);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ items: [], page: 2, hasMore: true });
  });
  it('两个普通 Tag 加免费筛选可搜索，加排序则在出站前说明超限', async () => {
    const fetchMock = mockFetch([]);
    expect((await invoke('frieren solo rating:g ratio:0.85..1.15')).response.status).toBe(200);
    fetchMock.mockClear();
    const { response, body } = await invoke('frieren solo order:score');
    expect(response.status).toBe(400);
    expect(body.error).toContain('选择「最新」');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('随机固定第一页且不追加，页码上限后停止请求下一页', async () => {
    const fetchMock = mockFetch([post(1), post(2)]);
    const random = await invoke('solo order:random', 12);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('page')).toBe('1');
    expect(random.body).toMatchObject({ page: 1, hasMore: false });
    expect((await invoke('order:rank', 1000)).body.hasMore).toBe(false);
  });
  it.each(['explore:unknown', 'explore:popular_month frieren', 'solo order:score order:favcount', 'tag"invalid', 'a'.repeat(241)])('无效查询不会出站：%s', async query => {
    const fetchMock = mockFetch([]);
    expect((await invoke(query)).response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('无效列表不冒充空结果，上游 400 不自动重试', async () => {
    const fetchMock = mockFetch({ success: false });
    expect((await invoke('order:rank')).response.status).toBe(502);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'invalid query' }), { status: 400 }));
    const failed = await invoke('order:rank');
    expect(failed.response.status).toBe(400);
    expect(failed.body.error).toContain('invalid query');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
