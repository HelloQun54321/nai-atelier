// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DanbooruPost } from './danbooruService';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ api: { get: apiGet } }));
const post = (id: number, tag: string): DanbooruPost => ({
  id, rating: 'g', score: 100 - id, favCount: 1, width: 800, height: 1200, fileExt: 'png',
  previewUrl: `https://cdn.donmai.us/preview/${id}.jpg`, sampleUrl: `https://cdn.donmai.us/sample/${id}.webp`, sourceUrl: '', postUrl: '',
  tags: { artist: [tag], character: [tag], general: ['solo'], copyright: [], meta: [] },
});
const result = (items: DanbooruPost[] = [], hasMore = false) => ({ items, hasMore, page: 1, limit: 200, query: '' });
const settle = async <T,>(promise: Promise<T>) => { await vi.runAllTimersAsync(); return promise; };
beforeEach(() => { vi.resetModules(); apiGet.mockReset(); localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe.each(['artist', 'character'] as const)('%s 可用封面查找', kind => {
  it('首批无权限图片后继续读取，找到精确 Tag 的可用封面', async () => {
    apiGet.mockResolvedValueOnce(result([], true)).mockResolvedValueOnce(result([], true))
      .mockResolvedValueOnce(result([post(2, 'synthetic')], false));
    const { danbooruService } = await import('./danbooruService');
    const set = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(set.candidates.map(item => item.id)).toEqual([2]);
    expect(set.nextPage).toBe(3);
    expect(set.hasMore).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(3);
    const urls = apiGet.mock.calls.map(([path]) => new URL(path, 'http://localhost'));
    expect(urls[0].searchParams.get('tags')).toBe('synthetic order:score -status:banned');
    expect(urls.slice(1).map(url => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(urls.slice(1).every(url => url.searchParams.get('limit') === '200')).toBe(true);
  });
  it('空结果只缓存一分钟，自动前查有界，不连续扫完整目录', async () => {
    apiGet.mockResolvedValue(result([], true));
    const { danbooruService } = await import('./danbooruService');
    const empty = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(apiGet).toHaveBeenCalledTimes(4);
    expect(empty).toMatchObject({ candidates: [], nextPage: 4, hasMore: true });
    await danbooruService.getCoverSet('synthetic', kind);
    expect(apiGet).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_001);
    apiGet.mockResolvedValue(result([post(1, 'synthetic')], false));
    expect((await settle(danbooruService.getCoverSet('synthetic', kind))).candidates).toHaveLength(1);
    expect(apiGet).toHaveBeenCalledTimes(5);
  });
  it('首屏被压缩为 24 个候选时仍能补齐同页，不丢掉第 25 张', async () => {
    const items = Array.from({ length: 40 }, (_, index) => post(index + 1, 'synthetic'));
    apiGet.mockResolvedValue(result(items, false));
    const { danbooruService } = await import('./danbooruService');
    const set = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(set.candidates).toHaveLength(24);
    expect(set).toMatchObject({ hasMore: true, nextPage: 1 });
    const page = await settle(danbooruService.getCoverCandidatePage('synthetic', kind, set.nextPage!));
    expect(page.candidates.map(item => item.id)).toContain(25);
  });
  it('精确 Tag 不被其他作品替代，正缓存复用，失败不缓存为空', async () => {
    apiGet.mockRejectedValueOnce(new Error('synthetic failure'));
    const { danbooruService } = await import('./danbooruService');
    const failed = danbooruService.getCoverSet('synthetic', kind);
    await expect(failed).rejects.toThrow('synthetic failure');
    apiGet.mockResolvedValue(result([post(1, 'other'), post(2, 'synthetic')], false));
    const set = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(set.candidates.map(item => item.id)).toEqual([2]);
    await danbooruService.getCoverSet('synthetic', kind);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
