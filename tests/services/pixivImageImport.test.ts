// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { importPixivImageAsFile, buildPixivPreviewMediaUrl, getPixivCurrentPageUrl, type PixivIllust } from '../../services/pixivService';
const source = 'https://i.pximg.net/img-original/synthetic.jpg';
afterEach(() => vi.unstubAllGlobals());
it('收藏导入保留超过旧 12MB 上限的原图，不改用预览地址', async () => {
  const bytes = new Uint8Array(39_460_518).fill(7);
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetcher);
  const file = await importPixivImageAsFile(source);
  expect(file.size).toBe(bytes.length);
  expect(file.type).toBe('image/jpeg');
  expect(String(fetcher.mock.calls[0][0])).toContain(encodeURIComponent(source));
});
it('超限时明确提示大小，仍拒绝不可信来源', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 413 })));
  await expect(importPixivImageAsFile(source)).rejects.toThrow('64MB');
  await expect(importPixivImageAsFile('https://evil.example/a.jpg')).rejects.toThrow('受信任');
});

it('重新打开旧足迹先展开嵌套代理，预览只包装一次且保留原图', () => {
  const wrap = (value: string) => '/api/media?source=' + encodeURIComponent(value) + '&variant=thumb-960';
  const nested = wrap(wrap(source));
  const item = { urls: { large: nested, original: source }, metaPages: [source] } as PixivIllust;
  const preview = new URL(buildPixivPreviewMediaUrl(item), 'http://localhost');
  expect(preview.searchParams.get('source')).toBe(source);
  expect(getPixivCurrentPageUrl(item)).toBe(source);
});
