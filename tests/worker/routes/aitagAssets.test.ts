import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../../worker';
import type { Env } from '../../../worker/routes/types';

const remote = 'https://ai-img.10118899.xyz/NAI/42/123_p3.webp';
const firstImage = { file_name: '123_p3', local_image_url: '/api/assets/aitag-covers/123.webp', remote_image_url: remote };
const fixture = (image = firstImage) => {
  const first = vi.fn(async () => ({ first_image_json: JSON.stringify(image), detail_json: JSON.stringify({ images: [image] }) }));
  const bind = vi.fn((_id: number) => ({ first })), prepare = vi.fn((_sql: string) => ({ bind }));
  const get = vi.fn(async (_key: string): Promise<any> => null);
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response('synthetic image', { headers: { 'Content-Type': 'image/webp' } }));
  vi.stubGlobal('fetch', fetch);
  const env = { DB: { prepare }, BUCKET: { get }, AITAG_LOCAL_PROXY_URL: 'http://127.0.0.1:3000/api/aitag/proxy', LAN_ACCESS_SECRET: 'synthetic-secret' } as unknown as Env;
  const read = (key: string, origin = 'http://localhost') => worker.fetch(new Request(`${origin}/api/assets/${key}`), env);
  return { read, prepare, bind, first, get, fetch };
};
afterEach(() => vi.unstubAllGlobals());

it('失效首图缓存回退到真实的 p3 原图，本机代理与防盗链头仍保留，不写数据库或桶', async () => {
  const f = fixture();
  const response = await f.read('aitag-covers/123.webp');
  expect(response.status).toBe(200); expect(await response.text()).toBe('synthetic image');
  expect(response.headers.get('Content-Type')).toBe('image/webp');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  const [url, options] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).searchParams.get('url')).toBe(remote);
  expect(options.headers).toMatchObject({ Referer: 'https://aitag.win/', 'X-Nai-Internal-Secret': 'synthetic-secret' });
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.prepare.mock.calls[0][0]).toMatch(/^SELECT/);
  expect(f.bind).toHaveBeenCalledWith(123);
  expect(f.get).toHaveBeenCalledOnce();
});

it('后续单图的缓存文件缺失也回退本张；缓存存在直接返回，不查询或联网', async () => {
  const image = { ...firstImage, local_image_url: '/api/assets/aitag-images/123/123_p3.webp' };
  const f = fixture(image);
  expect((await f.read('aitag-images/123/123_p3.webp')).status).toBe(200);
  f.prepare.mockClear(); f.fetch.mockClear();
  f.get.mockResolvedValueOnce({ body: 'local image', httpEtag: 'synthetic-etag', writeHttpMetadata: (headers: Headers) => headers.set('Content-Type', 'image/webp') } as never);
  expect(await (await f.read('aitag-images/123/123_p3.webp')).text()).toBe('local image');
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});

it('非 AITag 缺图、错误图片身份与未授权局域网请求不查询原图或出站', async () => {
  const f = fixture();
  expect((await f.read('covers/123.webp')).status).toBe(404);
  expect(f.prepare).not.toHaveBeenCalled();
  expect((await f.read('aitag-images/123/123_p9.webp')).status).toBe(404);
  f.prepare.mockClear();
  expect((await f.read('aitag-covers/123.webp', 'http://192.168.1.2')).status).toBe(401);
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});

it.each(['https://example.com/a.webp', 'invalid', ''])('不可信原图地址 %s 不出站', async remote_image_url => {
  const f = fixture({ ...firstImage, remote_image_url, file_name: '' });
  expect((await f.read('aitag-covers/123.webp')).status).toBe(404);
  expect(f.fetch).not.toHaveBeenCalled();
});

it.each([404, 200])('上游失败或返回 HTML 时不冒充图片，状态 %s', async status => {
  const f = fixture();
  f.fetch.mockResolvedValueOnce(new Response('not an image', { status, headers: { 'Content-Type': 'text/html' } }));
  expect((await f.read('aitag-covers/123.webp')).status).toBe(404);
});

it('首图记录损坏时使用详情里的真实首图，文件按页码排序而非猜测 p0', async () => {
  const f = fixture();
  f.first.mockResolvedValueOnce({ first_image_json: '{damaged', detail_json: JSON.stringify({ images: [
    { fileName: '123_p10', remote_image_url: remote.replace('p3', 'p10') }, firstImage,
  ] }) });
  expect((await f.read('aitag-covers/123.webp')).status).toBe(200);
  expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('url')).toBe(remote);
});

it('尚无 AITag 缓存表时保持 404，不为图片读取创建表或写入数据', async () => {
  const f = fixture();
  f.first.mockRejectedValueOnce(new Error('D1_ERROR: no such table: aitag_works'));
  expect((await f.read('aitag-covers/123.webp')).status).toBe(404);
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled();
});
