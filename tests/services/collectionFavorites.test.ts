// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Inspiration, LocalGenItem, User } from '../../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), uploadFile: vi.fn(), historyPage: vi.fn(), historyFavorites: vi.fn(), workFavorite: vi.fn(), pixivImport: vi.fn(), danbooruImport: vi.fn() }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: mocks.get, post: mocks.post, put: mocks.put, uploadFile: mocks.uploadFile } }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: mocks.historyPage, setFavorite: vi.fn(), setFavorites: mocks.historyFavorites } }));
vi.mock('../../services/aitagService', async original => ({ ...await original<typeof import('../../services/aitagService')>(), aitagService: { setFavorite: mocks.workFavorite } }));
vi.mock('../../services/pixivService', () => ({ importPixivImageAsFile: mocks.pixivImport }));
vi.mock('../../services/danbooruCoverImport', () => ({ importDanbooruCoverAsDataUrl: mocks.danbooruImport }));

const user: User = { id: 'test-owner', username: 'test', role: 'admin', createdAt: 1 };
let stored: Inspiration[];
let details: any[];
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); stored = []; details = [];
  mocks.get.mockImplementation(async path => path === '/auth/me' ? user : path === '/inspirations' ? stored.map(item => ({ ...item })) : path === '/aitag/favorites' ? details : []);
  mocks.post.mockImplementation(async (path, body) => {
    if (path === '/inspirations') { stored.push({ ...body }); return { item: { ...body } }; }
    if (path === '/inspirations/bulk-update') stored = stored.map(item => body.ids.includes(item.id) ? { ...item, ...body.updates } : item);
    return { success: true };
  });
  mocks.put.mockImplementation(async (path, updates) => { stored = stored.map(item => path === '/inspirations/' + encodeURIComponent(item.id) ? { ...item, ...updates } : item); return { success: true }; });
  mocks.historyPage.mockResolvedValue({ items: [], count: 0 });
  mocks.historyFavorites.mockResolvedValue(1); mocks.workFavorite.mockResolvedValue({});
  mocks.uploadFile.mockResolvedValue({ url: '/api/assets/inspirations/saved.png' });
});

it('只读汇总全部旧历史收藏与 AITag 组内图片，不复制原图或写入旧资料', async () => {
  const histories = Array.from({ length: 202 }, (_, index) => ({ id: `h${index}`, imageUrl: `/api/local-history/h${index}/image`, prompt: 'source', negativePrompt: 'negative', params: { width: 832, height: 1216, seed: index }, createdAt: index + 1, favoriteAt: 1000 + index } as LocalGenItem));
  mocks.historyPage.mockImplementation(async page => ({ items: histories.slice(page * 200, (page + 1) * 200), count: 202 }));
  details = [{ work: { id: 3, title: '组', favoriteAt: 600 }, images: [1, 2].map(id => ({ id, work_id: 3, file_name: `3_p${id}.png`, local_image_url: `/api/assets/aitag/${id}.png`, ai_json: { prompt: 'AITag 原词', uc: 'negative', seed: id, width: 832, height: 1216 } })) }];
  const { loadCollection } = await import('../../services/collectionFavorites');
  const result = await loadCollection(user);
  expect(result).toHaveLength(204);
  expect(result.every(item => item.tags?.length === 0)).toBe(true);
  expect(mocks.historyPage).toHaveBeenCalledTimes(2);
  expect(mocks.historyPage).toHaveBeenNthCalledWith(1, 0, 200, { favoriteOnly: true }, true);
  expect(mocks.historyPage).toHaveBeenNthCalledWith(2, 1, 200, { favoriteOnly: true }, false);
  expect(result.find(item => item.sourceType === 'aitag')).toEqual(expect.objectContaining({ prompt: 'AITag 原词', tags: [], analysis: { collectionImageId: '3_p1.png', collectionGroupSize: 2 }, params: expect.objectContaining({ seed: 1 }) }));
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('旧收藏与历史爱心按来源去重，保留收藏夹、备注、完整参数和旧评分资料', async () => {
  const { historyFavorite, mergeCollectionFavorites } = await import('../../services/collectionFavorites');
  const history = { id: 'h', imageUrl: '/api/local-history/h/image', prompt: 'original', negativePrompt: '', params: { seed: 12 }, createdAt: 1 } as LocalGenItem;
  const favorite = historyFavorite(history, user);
  const existing = { ...favorite, id: 'existing', title: '我的标题', boardId: 'folder', notes: '笔记', tags: ['生成历史', '自定义'], rating: 5, isPinned: true, archived: true };
  const result = mergeCollectionFavorites([existing], [favorite]);
  expect(result).toEqual([{ ...existing, archived: false, tags: ['自定义'] }]);
  expect(existing.tags).toEqual(['生成历史', '自定义']);
  expect(existing.archived).toBe(true);
});

it('整组收藏、逐张取消、补齐整组与重复点击共用同一批图片；取消收藏保留分类和原图', async () => {
  const service = await import('../../services/collectionFavorites');
  const images = [1, 2].map(index => ({ imageUrl: `/api/assets/work-${index}.png`, sourceType: 'pixiv' as const, sourceId: '99', imageId: String(index), title: `图片 ${index}` }));
  const group = { ...images[0], groupSize: 2, getGroup: vi.fn(async () => images) };
  expect(await service.toggleCollectionTarget(group)).toBe(true);
  expect(stored).toHaveLength(2); expect(service.collectionTargetActive(group)).toBe(true);
  const first = service.collectionSnapshot()[0];
  await service.updateCollection([first.id], { boardId: 'folder', notes: '备注' });
  expect(await service.toggleCollectionTarget(images[0])).toBe(false);
  expect(service.collectionTargetActive(group)).toBe(false); expect(service.collectionTargetActive(images[1])).toBe(true);
  expect(stored[0]).toEqual(expect.objectContaining({ boardId: 'folder', notes: '备注', archived: true }));
  expect(await service.toggleCollectionTarget(group)).toBe(true); expect(stored).toHaveLength(2);
  expect(stored[0]).toEqual(expect.objectContaining({ boardId: 'folder', notes: '备注', archived: false }));
  expect(await service.toggleCollectionTarget(group)).toBe(false);
  expect(stored.every(item => item.archived)).toBe(true);
  expect(mocks.post.mock.calls.some(([path]) => String(path).includes('delete'))).toBe(false);
});

it('组内图片保存失败时保留已完成收藏，重试补齐缺少的图片，不重复保存', async () => {
  const service = await import('../../services/collectionFavorites');
  const images = [1, 2].map(index => ({ imageUrl: `/api/assets/image-${index}.png`, sourceType: 'pixiv' as const, sourceId: 'retry', imageId: String(index) }));
  const group = { ...images[0], groupSize: 2, getGroup: async () => images };
  const original = mocks.post.getMockImplementation()!;
  let fail = true;
  mocks.post.mockImplementation(async (path, body) => {
    if (path === '/inspirations' && body.analysis.collectionImageId === '2' && fail) { fail = false; throw new Error('合成保存失败'); }
    return original(path, body);
  });
  await expect(service.toggleCollectionTarget(group)).rejects.toThrow('合成保存失败');
  expect(stored).toHaveLength(1); expect(service.collectionTargetActive(group)).toBe(false);
  await service.toggleCollectionTarget(group); expect(stored).toHaveLength(2);
});

it('旧收藏首次拖入收藏夹只保存当前条目的引用和元数据，随后沿用既有更新接口', async () => {
  mocks.historyPage.mockResolvedValue({ items: [{ id: 'h', imageUrl: '/api/local-history/h/image', prompt: 'original', params: { seed: 9 }, createdAt: 1 }], count: 1 });
  const service = await import('../../services/collectionFavorites');
  const [item] = await service.loadCollection(user);
  await service.updateCollection([item.id], { boardId: 'folder' });
  expect(mocks.post).toHaveBeenNthCalledWith(1, '/inspirations', expect.objectContaining({ sourceType: 'history', sourceId: 'h', params: { seed: 9 } }));
  expect(mocks.put).toHaveBeenCalledWith('/inspirations/' + encodeURIComponent(item.id), { boardId: 'folder' });
  await service.updateCollection([item.id], { notes: '笔记' });
  expect(stored).toHaveLength(1); expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('AITag 整组收藏沿用作品级标记，移除一张不会取消其余图片或整组来源标记', async () => {
  const service = await import('../../services/collectionFavorites');
  const images = [1, 2].map(index => ({ imageUrl: `/api/assets/aitag-${index}.png`, sourceType: 'aitag' as const, sourceId: '5', imageId: String(index) }));
  const group = { ...images[0], groupSize: 2, getGroup: async () => images };
  await service.toggleCollectionTarget(group);
  expect(mocks.workFavorite).toHaveBeenCalledWith('5', true);
  await service.toggleCollectionTarget(images[0]);
  expect(mocks.workFavorite).toHaveBeenCalledTimes(1);
  await service.loadCollection(user);
  expect(service.collectionTargetActive(images[0])).toBe(false);
  await service.toggleCollectionTarget(images[1]);
  expect(mocks.workFavorite).toHaveBeenLastCalledWith('5', false);
});

it('外站图片收藏沿用原图导入校验和持久上传，保持页码身份与独立来源，不自动添加来源标签', async () => {
  mocks.pixivImport.mockResolvedValue(new File(['synthetic'], 'original.png', { type: 'image/png' }));
  const service = await import('../../services/collectionFavorites');
  await service.toggleCollectionTarget({ imageUrl: 'https://i.pximg.net/original.png', sourceType: 'pixiv', sourceId: '88', imageId: '2', sourceUrl: 'https://www.pixiv.net/artworks/88' });
  expect(mocks.pixivImport).toHaveBeenCalledWith('https://i.pximg.net/original.png');
  expect(stored[0]).toEqual(expect.objectContaining({ imageUrl: '/api/assets/inspirations/saved.png', sourceType: 'pixiv', sourceId: '88', tags: [], analysis: { collectionImageId: '2', collectionOriginalUrl: 'https://i.pximg.net/original.png' } }));
  expect(service.collectionTargetActive({ imageUrl: 'https://i.pximg.net/original.png', sourceType: 'pixiv', sourceId: '88', imageId: '2' })).toBe(true);
});

it('列表与详情同时点击同一爱心只保存一次，整组与单张并发不会重复创建或误取消', async () => {
  const service = await import('../../services/collectionFavorites');
  await service.loadCollection(user);
  const images = [1, 2].map(index => ({ imageUrl: `/api/assets/concurrent-${index}.png`, sourceType: 'pixiv' as const, sourceId: 'concurrent', imageId: String(index) }));
  const group = { ...images[0], groupSize: 2, getGroup: async () => images };
  const result = await Promise.all([service.toggleCollectionTarget(group), service.toggleCollectionTarget(group), service.toggleCollectionTarget(images[0])]);
  expect(result).toEqual([true, true, true]); expect(stored).toHaveLength(2);
  expect(service.collectionTargetActive(group)).toBe(true);
});

it('历史爱心取消与恢复同步旧收藏条目，保留原来的收藏夹和备注', async () => {
  const service = await import('../../services/collectionFavorites');
  const history = { id: 'old', imageUrl: '/api/local-history/old/image', prompt: 'original', createdAt: 1 } as LocalGenItem;
  stored = [{ ...service.historyFavorite(history, user), id: 'saved-old', boardId: 'folder', notes: '保留' }];
  mocks.historyPage.mockResolvedValue({ items: [history], count: 1 });
  await service.loadCollection(user);
  await service.syncHistoryCollectionFavorites(['old'], false);
  mocks.historyPage.mockResolvedValue({ items: [], count: 0 }); await service.loadCollection(user);
  expect(service.collectionTargetActive({ imageUrl: history.imageUrl, sourceType: 'history', sourceId: 'old' })).toBe(false);
  await service.syncHistoryCollectionFavorites(['old'], true);
  expect(stored).toEqual([expect.objectContaining({ id: 'saved-old', boardId: 'folder', notes: '保留', archived: false })]);
});

it('慢刷新不会覆盖刚完成的收藏，同一原图在角色列表与详情共用状态', async () => {
  const service = await import('../../services/collectionFavorites');
  await service.loadCollection(user);
  let finish!: (value: Inspiration[]) => void;
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = service.loadCollection(user);
  const image = { imageUrl: '/api/assets/character.png', sourceType: 'character' as const, sourceId: 'chain-id' };
  await service.toggleCollectionTarget(image); finish([]); await refresh;
  expect(service.collectionTargetActive({ ...image, sourceId: 'custom:chain-id' })).toBe(true);
  expect(service.collectionSnapshot()).toHaveLength(1);
});

it('未知旧来源安全归入其他来源，访客收藏失败前不写入任何资料', async () => {
  const service = await import('../../services/collectionFavorites');
  const item = { id: 'unknown', userId: user.id, title: '旧资料', prompt: '', imageUrl: '/old.png', createdAt: 1, sourceType: 'old-source' } as unknown as Inspiration;
  expect(service.mergeCollectionFavorites([item], [])[0].tags).toEqual([]);
  await service.loadCollection({ ...user, role: 'guest' });
  await expect(service.toggleCollectionTarget({ imageUrl: '/synthetic.png' })).rejects.toThrow('访客');
  expect(mocks.post).not.toHaveBeenCalled();
});

it('旧作品组仅缓存首图时不会误认为全组已收藏', async () => {
  const service = await import('../../services/collectionFavorites');
  details = [{ work: { id: 5, image_count: 3 }, images: [{ id: 1, work_id: 5, file_name: '5_p0', local_image_url: '/api/assets/first.webp' }] }];
  await service.loadCollection(user);
  expect(service.collectionTargetActive({ imageUrl: '/api/assets/first.webp', sourceType: 'aitag', sourceId: '5', groupSize: 3, getGroup: async () => [] })).toBe(false);
});


it('收藏库内未收全的作品组仍显示已收藏，整组取消仅移除该用户已经收藏的图片', async () => {
  stored = [
    { id: 'one', userId: user.id, imageUrl: '/one.png', sourceType: 'pixiv', sourceId: 'work', title: '组 · 2', prompt: '', createdAt: 1, analysis: { collectionImageId: '1', collectionGroupSize: 5 } },
    { id: 'other', userId: 'another-owner', imageUrl: '/other.png', sourceType: 'pixiv', sourceId: 'work', title: '另一份', prompt: '', createdAt: 1 },
  ];
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  const getGroup = vi.fn(async () => [{ imageUrl: '/one.png', collectionId: 'one' }]);
  const target = { imageUrl: '/one.png', collectionId: 'one', sourceType: 'pixiv' as const, sourceId: 'work', groupSize: 1, getGroup };
  expect(service.collectionTargetActive(target)).toBe(true);
  expect(await service.toggleCollectionTarget(target)).toBe(false);
  expect(stored[0].archived).toBe(true); expect(stored[1].archived).not.toBe(true);
  expect(getGroup).not.toHaveBeenCalled(); expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('大量旧收藏按索引汇总，不对每张图片反复扫描整份列表，保留旧页码兼容与首条匹配', async () => {
  const { mergeCollectionFavorites } = await import('../../services/collectionFavorites');
  let reads = 0;
  const favorites = Array.from({ length: 500 }, (_, index) => {
    const item: Inspiration = { id: 'fav-' + index, userId: user.id, sourceType: 'pixiv', sourceId: 'work-' + index, imageUrl: '', title: '图片', prompt: '', createdAt: 1, analysis: { collectionImageId: '0' } };
    Object.defineProperty(item, 'imageUrl', { enumerable: true, get() { reads++; return '/new-' + index + '.png'; } });
    return item;
  });
  const stored = favorites.map((item, index) => ({ ...item, id: 'old-' + index, imageUrl: '/old-' + index + '.png', boardId: 'folder', analysis: { externalSourcePage: 0 } }));
  reads = 0;
  const result = mergeCollectionFavorites(stored, favorites);
  expect(result).toHaveLength(500); expect(result.every(item => item.boardId === 'folder')).toBe(true);
  expect(reads).toBeLessThan(500 * 10);
  const bySource = { ...stored[0], imageUrl: '/source-match.png' };
  const byUrl = { ...stored[0], id: 'later', sourceId: 'different', imageUrl: favorites[0].imageUrl };
  expect(mergeCollectionFavorites([bySource, byUrl], [favorites[0]])).toHaveLength(2);
});
