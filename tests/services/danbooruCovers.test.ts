// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DanbooruPost } from '../../services/danbooruService';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get: apiGet } }));
// 此文件覆盖选图／候选／缓存；真实批次调度另由 danbooruCoverTransport.test 覆盖。
vi.mock('../../services/danbooruCoverTransport', () => ({ requestCoverQuery: (query: { query: string; page: number; limit: number }, signal: AbortSignal) =>
  apiGet(`/danbooru/posts?${new URLSearchParams({ tags: query.query, page: String(query.page), limit: String(query.limit) })}`, { signal }) }));
const post = (id: number, tag: string): DanbooruPost => ({
  id, rating: 'g', score: 100 - id, favCount: 1, width: 800, height: 1200, fileExt: 'png',
  previewUrl: `https://cdn.donmai.us/preview/${id}.jpg`, sampleUrl: `https://cdn.donmai.us/sample/${id}.webp`, sourceUrl: '', postUrl: '',
  tags: { artist: [tag], character: [tag], general: ['solo'], copyright: [], meta: [] },
});
const result = (items: DanbooruPost[] = [], hasMore = false) => ({ items, hasMore, page: 1, limit: 200, query: '' });
const settle = async <T,>(promise: Promise<T>) => { await vi.runAllTimersAsync(); return promise; };
beforeEach(() => { vi.resetModules(); apiGet.mockReset(); localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it('普通排序短缓存复用，最新更快到期，随机不复用且独立取消', async () => {
  const { danbooruService } = await import('../../services/danbooruService');
  apiGet.mockResolvedValue(result([post(1, 'synthetic')]));
  await danbooruService.search({ query: 'order:score' }); await danbooruService.search({ query: 'order:score' });
  expect(apiGet).toHaveBeenCalledTimes(1);
  await danbooruService.search({ query: 'order:id_desc' });
  await vi.advanceTimersByTimeAsync(15_001);
  await danbooruService.search({ query: 'order:id_desc' }); expect(apiGet).toHaveBeenCalledTimes(3);
  await danbooruService.search({ query: 'order:score' }); expect(apiGet).toHaveBeenCalledTimes(3);
  await Promise.all([danbooruService.search({ query: 'order:random' }), danbooruService.search({ query: 'order:random' })]);
  expect(apiGet).toHaveBeenCalledTimes(5);
});


describe.each(['artist', 'character'] as const)('%s 可用封面查找', kind => {
  it('评分前查无图后只补查一次最新作品，保留评分分页游标并缓存结果', async () => {
    apiGet.mockImplementation(async path => result(new URL(path, 'http://localhost').searchParams.get('tags')!.includes('order:id_desc') ? [post(2, 'synthetic')] : [], true));
    const { danbooruService } = await import('../../services/danbooruService');
    const covers = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(covers).toMatchObject({ representative: { id: 2 }, hasMore: true, nextPage: 4, latestFallbackTried: true });
    expect(covers.candidates.map(item => item.id)).toEqual([2]);
    expect(apiGet).toHaveBeenCalledTimes(5);
    const latest = new URL(apiGet.mock.calls[4][0], 'http://localhost');
    expect(latest.searchParams.get('tags')).toBe('synthetic order:id_desc -status:banned');
    expect(latest.searchParams.get('page')).toBe('1');
    expect(latest.searchParams.get('limit')).toBe('200');
    await danbooruService.getCoverSet('synthetic', kind);
    expect(apiGet).toHaveBeenCalledTimes(5);
  });
  it('最新兜底放宽展示偏好，仍要求精确 Tag 和公开图片地址，不限制评级', async () => {
    const relaxed = { ...post(2, 'synthetic'), rating: 'e', tags: { ...post(2, 'synthetic').tags, general: ['photo', 'chibi', 'multiple_girls', 'alternate_costume'] } };
    apiGet.mockResolvedValueOnce(result()).mockResolvedValueOnce(result([post(1, 'other'), relaxed, { ...post(3, 'synthetic'), sampleUrl: '', previewUrl: '' }]));
    const { danbooruService } = await import('../../services/danbooruService');
    const covers = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(covers.candidates.map(item => item.id)).toEqual([2]);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
  it('旧空缓存补查兜底，已有封面缓存继续复用', async () => {
    localStorage.setItem('nai_danbooru_cover_cache_v13', JSON.stringify({
      [`${kind}:empty`]: { ...result(), representative: null, candidates: [], updatedAt: Date.now() },
      [`${kind}:positive`]: { representative: post(9, 'positive'), candidates: [post(9, 'positive')], updatedAt: Date.now() },
    }));
    apiGet.mockResolvedValueOnce(result()).mockResolvedValueOnce(result([post(2, 'empty')]));
    const { danbooruService } = await import('../../services/danbooruService');
    expect((await danbooruService.getCoverSet('positive', kind)).representative?.id).toBe(9);
    expect(apiGet).not.toHaveBeenCalled();
    expect((await settle(danbooruService.getCoverSet('empty', kind))).representative?.id).toBe(2);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
  it('限流不触发其他排序查询，兜底请求失败也不缓存成空结果', async () => {
    apiGet.mockRejectedValueOnce(new Error('Danbooru 429'));
    const { danbooruService } = await import('../../services/danbooruService');
    await expect(danbooruService.getCoverSet('busy', kind)).rejects.toThrow('429');
    expect(apiGet).toHaveBeenCalledTimes(1);
    apiGet.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('Danbooru 429'));
    await expect(danbooruService.getCoverSet('empty', kind)).rejects.toThrow('429');
    apiGet.mockResolvedValue(result([post(2, 'empty')]));
    expect((await settle(danbooruService.getCoverSet('empty', kind))).representative?.id).toBe(2);
    expect(apiGet.mock.calls.filter(([path]) => path.includes('order%3Aid_desc'))).toHaveLength(2);
  });
  it('首批无权限图片后继续读取，找到精确 Tag 的可用封面', async () => {
    apiGet.mockResolvedValueOnce(result([], true)).mockResolvedValueOnce(result([], true))
      .mockResolvedValueOnce(result([post(2, 'synthetic')], false));
    const { danbooruService } = await import('../../services/danbooruService');
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
    const { danbooruService } = await import('../../services/danbooruService');
    const empty = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(apiGet).toHaveBeenCalledTimes(5);
    expect(empty).toMatchObject({ candidates: [], nextPage: 4, hasMore: true });
    await danbooruService.getCoverSet('synthetic', kind);
    expect(apiGet).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_001);
    apiGet.mockResolvedValue(result([post(1, 'synthetic')], false));
    expect((await settle(danbooruService.getCoverSet('synthetic', kind))).candidates).toHaveLength(1);
    expect(apiGet).toHaveBeenCalledTimes(6);
  });
  it('首屏被压缩为 24 个候选时仍能补齐同页，不丢掉第 25 张', async () => {
    const items = Array.from({ length: 40 }, (_, index) => post(index + 1, 'synthetic'));
    apiGet.mockResolvedValue(result(items, false));
    const { danbooruService } = await import('../../services/danbooruService');
    const set = await settle(danbooruService.getCoverSet('synthetic', kind));
    expect(set.candidates).toHaveLength(24);
    expect(set).toMatchObject({ hasMore: true, nextPage: 1 });
    const page = await settle(danbooruService.getCoverCandidatePage('synthetic', kind, set.nextPage!));
    expect(page.candidates.map(item => item.id)).toContain(25);
  });
  it('精确 Tag 不被其他作品替代，正缓存复用，失败不缓存为空', async () => {
    apiGet.mockRejectedValueOnce(new Error('synthetic failure'));
    const { danbooruService } = await import('../../services/danbooruService');
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
    const { danbooruService } = await import('../../services/danbooruService');
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
  const { danbooruService } = await import('../../services/danbooruService');
  const covers = await settle(danbooruService.getCoverSet('synthetic', 'character'));
  expect(covers.representative?.id).toBe(1);
  expect(covers.candidates.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
  const page = await settle(danbooruService.getCoverCandidatePage('synthetic', 'character', 2));
  expect(page.candidates.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
});

it.each(['general', 'meta'] as const)('跨角色高分照片／拼贴的 %s 标签不抢首图，候选与全部评级仍保留', async category => {
  const tags = ['synthetic_a', 'synthetic_b', 'synthetic_c'];
  const mosaic = {
    ...post(1, 'synthetic_a'), score: 10_000,
    tags: { ...post(1, 'synthetic_a').tags, character: tags, [category]: ['photomosaic', 'photo'] },
  };
  apiGet.mockImplementation(async path => {
    const tag = new URL(path, 'http://localhost').searchParams.get('tags')!.split(' ')[0];
    return result([mosaic, { ...post(tags.indexOf(tag) + 2, tag), rating: 'e' }]);
  });
  const { danbooruService } = await import('../../services/danbooruService');
  for (const [index, tag] of tags.entries()) {
    const covers = await settle(danbooruService.getCoverSet(tag, 'character'));
    expect(covers.representative?.id).toBe(index + 2);
    expect(covers.candidates.map(item => item.id)).toEqual([index + 2, 1]);
    expect((await danbooruService.getCoverSet(tag, 'character')).candidates[0].id).toBe(index + 2);
  }
});

it('照片带 solo 且评分更高时，换装／多人插画也优先作为代表图', async () => {
  const photo = { ...post(1, 'synthetic'), score: 10_000, tags: { ...post(1, 'synthetic').tags, general: ['solo', 'photo'] } };
  const illustration = { ...post(2, 'synthetic'), tags: { ...post(2, 'synthetic').tags, general: ['alternate_costume', 'multiple_girls'] } };
  apiGet.mockResolvedValue(result([photo, illustration]));
  const { danbooruService } = await import('../../services/danbooruService');
  const covers = await settle(danbooruService.getCoverSet('synthetic', 'character'));
  expect(covers.representative?.id).toBe(2);
  expect(covers.candidates.map(item => item.id)).toEqual([2, 1]);
});

it('代表图评分在 24 名以后时仍进入首屏，截短页可补齐其他图片', async () => {
  const photos = Array.from({ length: 30 }, (_, index) => ({
    ...post(index + 1, 'synthetic'), tags: { ...post(index + 1, 'synthetic').tags, meta: ['photomosaic'] },
  }));
  apiGet.mockResolvedValue(result([...photos, post(31, 'synthetic')]));
  const { danbooruService } = await import('../../services/danbooruService');
  const covers = await settle(danbooruService.getCoverSet('synthetic', 'character'));
  expect(covers.representative?.id).toBe(31);
  expect(covers.candidates[0].id).toBe(31);
  expect(covers.candidates).toHaveLength(24);
  expect(covers).toMatchObject({ hasMore: true, nextPage: 1 });
  const page = await settle(danbooruService.getCoverCandidatePage('synthetic', 'character', 1));
  expect(page.candidates.map(item => item.id)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
});

it('只有照片可用时仍可显示，不增加无封面情况，画师候选保持评分顺序', async () => {
  const photo = { ...post(1, 'synthetic'), tags: { ...post(1, 'synthetic').tags, meta: ['photo'] } };
  apiGet.mockResolvedValue(result([photo]));
  const { danbooruService } = await import('../../services/danbooruService');
  expect((await settle(danbooruService.getCoverSet('synthetic', 'character'))).candidates.map(item => item.id)).toEqual([1]);
  apiGet.mockResolvedValue(result([photo, post(2, 'synthetic')]));
  expect((await settle(danbooruService.getCoverSet('synthetic', 'artist'))).candidates.map(item => item.id)).toEqual([1, 2]);
});
