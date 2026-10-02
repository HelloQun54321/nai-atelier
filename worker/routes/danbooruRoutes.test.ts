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
afterEach(() => vi.unstubAllGlobals());

describe('Danbooru 请求、筛选与分页', () => {
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
