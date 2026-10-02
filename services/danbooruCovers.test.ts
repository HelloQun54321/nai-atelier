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
  it('全部评级都可成为封面，首屏与后续页不隐式限制 SFW', async () => {
    const items = ['g', 's', 'q', 'e'].map((rating, index) => ({ ...post(index + 1, 'synthetic'), rating }));
    apiGet.mockResolvedValue(result(items));
    const { danbooruService } = await import('./danbooruService');
    expect((await settle(danbooruService.getCoverSet('synthetic', kind))).candidates.map(item => item.id)).toEqual([1, 2, 3, 4]);
    expect((await settle(danbooruService.getCoverCandidatePage('synthetic', kind, 2))).candidates.map(item => item.id)).toEqual([1, 2, 3, 4]);
    for (const [path] of apiGet.mock.calls) {
      expect(new URL(path, 'http://localhost').searchParams.get('tags')).toBe('synthetic order:score -status:banned');
    }
  });
});

it('经典单人代表图不吞掉其他精确角色候选，坏图之后仍可回退', async () => {
  const variants = ['alternate_costume', 'nude', 'chibi', 'multiple_girls'].map((tag, index) => ({
    ...post(index + 2, 'synthetic'), tags: { ...post(index + 2, 'synthetic').tags, general: [tag] },
  }));
  apiGet.mockResolvedValue(result([post(1, 'synthetic'), ...variants, post(6, 'other')]));
  const { danbooruService } = await import('./danbooruService');
  const covers = await settle(danbooruService.getCoverSet('synthetic', 'character'));
  expect(covers.representative?.id).toBe(1);
  expect(covers.candidates.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
  const page = await settle(danbooruService.getCoverCandidatePage('synthetic', 'character', 2));
  expect(page.candidates.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
});

it('并发封面请求逐一错开启动，不让同时醒来的等待者形成突发', async () => {
  const starts: number[] = [];
  apiGet.mockImplementation(async () => { starts.push(Date.now()); return result(); });
  const { danbooruService } = await import('./danbooruService');
  await settle(Promise.all(Array.from({ length: 9 }, (_, index) => danbooruService.getCoverSet(`synthetic_${index}`, 'artist'))));
  expect(starts).toHaveLength(9);
  expect(starts.slice(1).every((time, index) => time - starts[index] >= 60)).toBe(true);
});

it('429 后尚未启动的并发请求共同退避，失败不写入空封面缓存', async () => {
  const starts: number[] = [];
  apiGet.mockImplementation(async () => {
    starts.push(Date.now());
    if (starts.length === 1) throw new Error('Danbooru 429');
    return result([post(1, 'synthetic_b')]);
  });
  const { danbooruService } = await import('./danbooruService');
  const settled = Promise.allSettled([danbooruService.getCoverSet('synthetic_a', 'artist'), danbooruService.getCoverSet('synthetic_b', 'artist')]);
  expect((await settle(settled))[0].status).toBe('rejected');
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2000);
  apiGet.mockResolvedValue(result([post(2, 'synthetic_a')]));
  expect((await settle(danbooruService.getCoverSet('synthetic_a', 'artist'))).candidates[0].id).toBe(2);
});
