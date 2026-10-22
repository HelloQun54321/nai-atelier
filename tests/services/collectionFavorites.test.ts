// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Inspiration, LocalGenItem, PromptChain, User } from '../../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), uploadFile: vi.fn(), historyPage: vi.fn(), historyFavorites: vi.fn(), workFavorite: vi.fn(), pixivImport: vi.fn(), danbooruImport: vi.fn(), codexFile: vi.fn(), codexMetadata: vi.fn() }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: mocks.get, post: mocks.post, put: mocks.put, uploadFile: mocks.uploadFile } }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: mocks.historyPage, setFavorite: vi.fn(), setFavorites: mocks.historyFavorites } }));
vi.mock('../../services/aitagService', async original => ({ ...await original<typeof import('../../services/aitagService')>(), aitagService: { setFavorite: mocks.workFavorite } }));
vi.mock('../../services/pixivService', () => ({ importPixivImageAsFile: mocks.pixivImport }));
vi.mock('../../services/danbooruCoverImport', () => ({ importDanbooruCoverAsDataUrl: mocks.danbooruImport }));
vi.mock('../../services/codexService', () => ({ readCodexImageFile: mocks.codexFile, readCodexImageMetadata: mocks.codexMetadata }));

const user: User = { id: 'test-owner', username: 'test', role: 'admin', createdAt: 1 };

it('画师级偏好保存当前样张版本来源，换图取消偏好不另存新图片', async () => {
  const service = await import('../../services/collectionFavorites');
  const image = { imageUrl: '/api/assets/sample.png', sourceUrl: 'https://synthetic.invalid/pack', imageId: 'v5:alpha:2', analysis: { artistSample: { pack: 'v5', tag: 'alpha', revision: 'fixture', index: 2 } } };
  await service.toggleArtistPreference('alpha', image.imageUrl, image);
  expect(service.collectionSnapshot()[0]).toMatchObject({ sourceType: 'artist', sourceId: 'alpha', sourceUrl: image.sourceUrl, analysis: { artistSample: image.analysis.artistSample, collectionImageId: image.imageId } });
  await service.toggleArtistPreference('alpha', '/api/assets/another.png');
  expect(service.collectionSnapshot()).toHaveLength(1); expect(service.collectionSnapshot()[0].archived).toBe(true);
});

it('缺样张画师可收藏 Tag，不同空封面互不合并，取消偏好同步收藏来源组', async () => {
  const service = await import('../../services/collectionFavorites');
  await service.toggleArtistPreference('alpha', '');
  await service.toggleArtistPreference('beta', '');
  expect(service.collectionSnapshot().filter(item => !item.archived).map(item => item.sourceId)).toEqual(['alpha', 'beta']);
  expect(service.collectionSnapshot().every(item => item.imageUrl === '' && item.sourceType === 'artist')).toBe(true);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  await service.toggleArtistPreference('alpha', '');
  expect(service.collectionSnapshot().filter(item => !item.archived).map(item => item.sourceId)).toEqual(['beta']);
  await service.toggleArtistPreference('alpha', '');
  expect(service.collectionSnapshot()).toHaveLength(2);
  await service.removeCollection(service.collectionSnapshot().filter(item => item.sourceId === 'alpha').map(item => item.id));
  expect(service.collectionSnapshot().find(item => item.sourceId === 'alpha')?.archived).toBe(true);
});

it('已有画师图片收藏直接作为偏好，取消时仅归档引用且不会另存封面', async () => {
  const service = await import('../../services/collectionFavorites');
  await service.toggleCollectionTarget({ sourceType: 'artist', sourceId: 'alpha', imageUrl: '/api/assets/original.png' });
  await service.toggleArtistPreference('alpha', '/api/assets/new.png');
  expect(service.collectionSnapshot()).toHaveLength(1);
  expect(service.collectionSnapshot()[0]).toMatchObject({ archived: true, imageUrl: '/api/assets/original.png' });
  await service.toggleArtistPreference('alpha', '/api/assets/new.png');
  expect(service.collectionSnapshot()[0].archived).toBe(false);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('偏好沿用空格与下划线同名画师的收藏，收藏自建样张保留真实生成配置', async () => {
  const service = await import('../../services/collectionFavorites');
  await service.toggleArtistPreference('alpha_artist', '');
  await service.toggleArtistPreference('alpha artist', '');
  expect(service.collectionSnapshot()).toHaveLength(1); expect(service.collectionSnapshot()[0].archived).toBe(true);
  const get = mocks.get.getMockImplementation()!;
  const sample = { tag: 'beta', imageUrl: '/api/assets/sample.png', prompt: 'artist:beta, original', negativePrompt: 'bad', params: { seed: 42 } };
  mocks.get.mockImplementation(async path => path === '/artist-sample-data' ? { templates: {}, samples: [sample] } : get(path));
  await service.toggleArtistPreference('beta', sample.imageUrl);
  expect(service.collectionSnapshot().find(item => item.sourceId === 'beta')).toMatchObject({ prompt: sample.prompt, negativePrompt: sample.negativePrompt, params: sample.params });
});
let stored: Inspiration[];
let details: any[];
let chains: PromptChain[];
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); stored = []; details = []; chains = [];
  mocks.get.mockImplementation(async path => path === '/auth/me' ? user : path === '/inspirations' ? stored.map(item => ({ ...item })) : path === '/aitag/favorites' ? details : path === '/chains' ? chains : []);
  mocks.post.mockImplementation(async (path, body) => {
    if (path === '/inspirations') { stored.push({ ...body }); return { item: { ...body } }; }
    if (path === '/inspirations/bulk-update') stored = stored.map(item => body.ids.slice(0, 500).includes(item.id) ? { ...item, ...body.updates } : item);
    return { success: true };
  });
  mocks.put.mockImplementation(async (path, updates) => { stored = stored.map(item => path === '/inspirations/' + encodeURIComponent(item.id) ? { ...item, ...updates } : item); return { success: true }; });
  mocks.historyPage.mockResolvedValue({ items: [], count: 0 });
  mocks.historyFavorites.mockResolvedValue(1); mocks.workFavorite.mockResolvedValue({});
  mocks.uploadFile.mockResolvedValue({ url: '/api/assets/inspirations/saved.png' });
  mocks.codexFile.mockReset().mockResolvedValue(new File(['synthetic'], 'source.png', { type: 'image/png' }));
  mocks.codexMetadata.mockReset().mockResolvedValue(null);
});

const legacyChain = (id: string, type: 'style' | 'character' = 'style', previewImage?: string): PromptChain => ({
  id, type, userId: user.id, name: id, description: '', tags: [], previewImage,
  basePrompt: 'original prompt', negativePrompt: 'original negative', modules: [],
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, seed: 123 }, createdAt: 10, updatedAt: 20,
});

it('旧串与自建角色只读汇总当前封面，无封面、未知ID与blob不造图片，原名单和源串不改写', async () => {
  chains = [legacyChain('style', 'style', '/api/assets/style.png'), legacyChain('character', 'character', '/api/assets/character.png'), legacyChain('older-character', 'character', '/api/assets/older-character.png'), legacyChain('missing'), legacyChain('blob', 'style', 'blob:expired'), { ...legacyChain('catalog', 'character', '/api/assets/catalog.png'), tags: ['__character_catalog__'] }];
  const source = structuredClone(chains);
  const oldIds = JSON.stringify(['style', 'older-character', 'missing', 'unknown', 'blob', 'catalog']);
  localStorage.setItem('nai_chain_favs', oldIds);
  const oldCharacters = JSON.stringify(['custom:character', 'custom:unknown', 'catalog:catalog']);
  localStorage.setItem('nai_character_favorites', oldCharacters);
  const service = await import('../../services/collectionFavorites');
  const result = await service.loadCollection(user);
  expect(result.map(item => [item.sourceType, item.sourceId, item.imageUrl])).toEqual([
    ['chain', 'style', '/api/assets/style.png'], ['character', 'character', '/api/assets/character.png'], ['character', 'older-character', '/api/assets/older-character.png'],
  ]);
  for (const item of result) expect(service.collectionTargetActive(item)).toBe(true);
  expect(result[0]).toMatchObject({ userId: user.id, prompt: source[0].basePrompt, negativePrompt: source[0].negativePrompt, params: source[0].params });
  expect(chains).toEqual(source);
  expect(localStorage.getItem('nai_chain_favs')).toBe(oldIds);
  expect(localStorage.getItem('nai_character_favorites')).toBe(oldCharacters);
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('只有词库角色或旧画师名册时不扩大兼容范围，也不多读风格串', async () => {
  localStorage.setItem('nai_character_favorites', JSON.stringify(['catalog:sample']));
  localStorage.setItem('nai_fav_artists', JSON.stringify(['sample']));
  const service = await import('../../services/collectionFavorites');
  expect(await service.loadCollection(user)).toEqual([]);
  expect(mocks.get).not.toHaveBeenCalledWith('/chains');
});

it.each([false, true])('当前封面已有新收藏 archived=%s 时不重复，不恢复归档或改写资料', async archived => {
  chains = [legacyChain('style', 'style', '/api/assets/current.png')];
  localStorage.setItem('nai_chain_favs', '["style"]');
  stored = [{ id: 'existing', userId: user.id, title: '保存的快照', prompt: 'saved prompt', imageUrl: '/api/inspirations/existing/image', sourceType: 'chain', sourceId: 'style', archived, boardId: 'folder', tags: [], createdAt: 1, analysis: { collectionOriginalUrl: '/api/assets/current.png' } }];
  const service = await import('../../services/collectionFavorites');
  expect(await service.loadCollection(user)).toEqual(stored);
  expect(service.collectionTargetActive({ imageUrl: chains[0].previewImage!, sourceType: 'chain', sourceId: 'style' })).toBe(!archived);
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
});

it.each(['style', 'character'] as const)('旧%s收藏用户主动整理才保存引用，取消后刷新不会从旧名单复活', async type => {
  chains = [legacyChain('source', type, '/api/assets/current.png')];
  localStorage.setItem(type === 'style' ? 'nai_chain_favs' : 'nai_character_favorites', JSON.stringify([type === 'style' ? 'source' : 'custom:source']));
  const service = await import('../../services/collectionFavorites');
  const [virtual] = await service.loadCollection(user);
  expect(mocks.post).not.toHaveBeenCalled();
  await service.updateCollection([virtual.id], { boardId: 'chosen-folder' });
  expect(mocks.post).toHaveBeenCalledWith('/inspirations', virtual);
  expect(stored).toEqual([expect.objectContaining({ id: virtual.id, imageUrl: chains[0].previewImage, boardId: 'chosen-folder' })]);
  await service.toggleCollectionTarget({ imageUrl: chains[0].previewImage!, sourceType: type === 'style' ? 'chain' : 'character', sourceId: 'source' });
  const refreshed = await service.loadCollection(user);
  expect(refreshed).toHaveLength(1); expect(refreshed[0].archived).toBe(true);
  expect(refreshed[0].boardId).toBe('chosen-folder');
  expect(service.collectionTargetActive({ imageUrl: chains[0].previewImage! })).toBe(false);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

it('直接取消尚未持久化的旧收藏也保存归档引用，跨刷新不复活', async () => {
  chains = [legacyChain('source', 'style', '/api/assets/current.png')]; localStorage.setItem('nai_chain_favs', '["source"]');
  const service = await import('../../services/collectionFavorites');
  const [virtual] = await service.loadCollection(user);
  expect(await service.toggleCollectionTarget({ imageUrl: virtual.imageUrl, sourceType: 'chain', sourceId: 'source' })).toBe(false);
  expect(stored).toEqual([expect.objectContaining({ id: virtual.id, archived: true })]);
  expect((await service.loadCollection(user)).filter(item => !item.archived)).toHaveLength(0);
  expect(localStorage.getItem('nai_chain_favs')).toBe('["source"]');
});

it('同串换封面保留确切图片，不复用已保存旧封面ID，旧归档也不阻止其他新封面', async () => {
  chains = [legacyChain('source', 'style', '/api/assets/old.png')]; localStorage.setItem('nai_chain_favs', '["source"]');
  const service = await import('../../services/collectionFavorites');
  const [old] = await service.loadCollection(user); await service.updateCollection([old.id], { archived: true });
  chains[0] = { ...chains[0], previewImage: '/api/assets/new.png' };
  const result = await service.loadCollection(user);
  expect(result).toHaveLength(2); expect(result[0]).toMatchObject({ id: old.id, imageUrl: '/api/assets/old.png', archived: true });
  expect(result[1].imageUrl).toBe('/api/assets/new.png'); expect(result[1].id).not.toBe(old.id);
  expect(service.collectionTargetActive({ imageUrl: '/api/assets/old.png', sourceType: 'chain', sourceId: 'source' })).toBe(false);
  expect(service.collectionTargetActive({ imageUrl: '/api/assets/new.png', sourceType: 'chain', sourceId: 'source' })).toBe(true);
  const stable = await service.loadCollection(user); expect(stable[1].id).toBe(result[1].id);
  await service.updateCollection([stable[1].id], { notes: 'new image' });
  expect(stored.map(item => item.imageUrl)).toEqual(['/api/assets/old.png', '/api/assets/new.png']);
});

it('admin保留API可见的旧作者串，普通账号只汇总自身串，访客不接旧名单', async () => {
  chains = [legacyChain('mine', 'style', '/mine.png'), { ...legacyChain('imported', 'style', '/imported.png'), userId: 'old-author' }];
  localStorage.setItem('nai_chain_favs', '["mine","imported"]');
  const service = await import('../../services/collectionFavorites');
  expect((await service.loadCollection(user)).map(item => item.sourceId)).toEqual(['mine', 'imported']);
  expect((await service.loadCollection({ ...user, role: 'user' })).map(item => item.sourceId)).toEqual(['mine']);
  mocks.get.mockClear();
  expect(await service.loadCollection({ ...user, role: 'guest' })).toEqual([]);
  expect(mocks.get).not.toHaveBeenCalledWith('/chains'); expect(mocks.post).not.toHaveBeenCalled();
});

it('旧名单损坏或链读取失败保留上次快照，不伪装空名单也不写回旧数据', async () => {
  chains = [legacyChain('source', 'style', '/source.png')]; localStorage.setItem('nai_chain_favs', '["source"]');
  const service = await import('../../services/collectionFavorites');
  const previous = await service.loadCollection(user), revision = service.collectionRevision();
  localStorage.setItem('nai_chain_favs', '{broken');
  await expect(service.loadCollection(user)).rejects.toThrow();
  expect(service.collectionSnapshot()).toEqual(previous); expect(service.collectionRevision()).toBe(revision);
  expect(localStorage.getItem('nai_chain_favs')).toBe('{broken');
  localStorage.setItem('nai_chain_favs', '["source"]');
  mocks.get.mockImplementation(async path => { if (path === '/chains') throw new Error('chain read failed'); return []; });
  await expect(service.loadCollection(user)).rejects.toThrow('chain read failed');
  expect(service.collectionSnapshot()).toEqual(previous); expect(mocks.post).not.toHaveBeenCalled();
});

it.each(['codex', 'codex-community'] as const)('%s 收藏存原件和真实参数，分组补齐不重复保存已有页', async sourceType => {
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  mocks.codexMetadata.mockResolvedValue({ prompt: '', negativePrompt: '', params: { steps: 12, characters: [{ id: 'role', prompt: 'girl', x: 0.2, y: 0.8 }] } });
  const first = { sourceType, sourceId: 'book:entry', imageId: 'first.png', imageUrl: 'https://assets.quicktagcloud.com/originals/book/first.png', prompt: 'editorial prompt', analysis: { codex: { note: 'source note' } } };
  await service.toggleCollectionTarget(first);
  expect(stored[0]).toMatchObject({ prompt: '', params: { steps: 12 }, imageUrl: '/api/assets/inspirations/saved.png', analysis: { codex: { note: 'source note' } } });
  expect(stored[0].params?.width).toBeUndefined(); expect(stored[0].params?.sampler).toBeUndefined();
  const group = { ...first, groupSize: 2, getGroup: async () => [first, { ...first, imageId: 'second.png', imageUrl: 'https://assets.quicktagcloud.com/originals/book/second.png' }] };
  expect(service.collectionTargetActive(group)).toBe(false);
  await service.toggleCollectionTarget(group);
  expect(stored).toHaveLength(2); expect(mocks.uploadFile).toHaveBeenCalledTimes(2);
  expect(service.collectionTargetActive(group)).toBe(true);
});
it('法典图片保存失败不创建收藏记录，重试成功；非 NAI 图片只保存已知文字', async () => {
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  const image = { sourceType: 'codex' as const, sourceId: 'book:entry', imageId: 'image.png', imageUrl: 'https://assets.quicktagcloud.com/images/book/image.jpg', prompt: 'known text' };
  mocks.uploadFile.mockRejectedValueOnce(new Error('保存失败'));
  await expect(service.toggleCollectionTarget(image)).rejects.toThrow('保存失败'); expect(stored).toEqual([]);
  await service.toggleCollectionTarget(image); expect(stored[0].prompt).toBe('known text'); expect(stored[0].params).toBeUndefined();
});

it('收藏本地图包样张先保存原件，解除图包关联后不依赖源地址，模型版本分别收藏', async () => {
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  const fetchSample = vi.fn(async () => new Response(new Blob(['synthetic jpeg'], { type: 'image/jpeg' })));
  vi.stubGlobal('fetch', fetchSample);
  try {
    const image = { sourceType: 'artist' as const, sourceId: 'synthetic artist', imageId: 'v45:revision:0',
      imageUrl: '/api/artist-samples/image?pack=v45&tag=synthetic&index=0&revision=revision', analysis: { artistSample: { pack: 'v45' } } };
    await service.toggleCollectionTarget(image);
    expect(fetchSample).toHaveBeenCalledWith(image.imageUrl);
    expect(mocks.uploadFile).toHaveBeenCalledOnce();
    expect(stored[0]).toMatchObject({ imageUrl: '/api/assets/inspirations/saved.png', prompt: '', analysis: { collectionOriginalUrl: image.imageUrl, artistSample: { pack: 'v45' } } });
    expect(stored[0].params).toBeUndefined();
    expect(service.collectionTargetActive(image)).toBe(true);
    expect(service.collectionTargetActive({ ...image, imageId: 'v5:revision:0', imageUrl: image.imageUrl.replace('v45', 'v5') })).toBe(false);
  } finally { vi.unstubAllGlobals(); }
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


it.each([500, 501, 1201])('批量保存 %s 页完整分批，服务端限制 500 项时分类与快照都保持一致', async count => {
  stored = Array.from({ length: count }, (_, index) => ({ id: 'bulk-' + index, userId: user.id, sourceType: 'upload', imageUrl: '/image-' + index + '.png', title: '合成图片', prompt: '', tags: ['内容'], createdAt: 1 }));
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  await service.updateCollection(stored.map(item => item.id), { boardId: 'folder' });
  expect(stored.every(item => item.boardId === 'folder')).toBe(true);
  expect(service.collectionSnapshot().every(item => item.boardId === 'folder')).toBe(true);
  const calls = mocks.post.mock.calls.filter(([path]) => path === '/inspirations/bulk-update');
  expect(calls.every(([, body]) => body.ids.length <= 500)).toBe(true);
  expect(calls.reduce((sum, [, body]) => sum + body.ids.length, 0) + mocks.put.mock.calls.length).toBe(count);
  expect(stored.every(item => item.tags?.[0] === '内容' && !item.archived)).toBe(true);
});

it('超过 500 页取消收藏完整保存引用状态，原图和分类保留', async () => {
  stored = Array.from({ length: 601 }, (_, index) => ({ id: 'remove-' + index, userId: user.id, sourceType: 'upload', imageUrl: '/image-' + index + '.png', title: '合成图片', prompt: '', boardId: 'folder', createdAt: 1 }));
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  await service.removeCollection(stored.map(item => item.id));
  expect(stored.every(item => item.archived && item.boardId === 'folder' && item.imageUrl.startsWith('/image-'))).toBe(true);
  expect(service.collectionSnapshot().every(item => item.archived)).toBe(true);
});

it('批量保存第二批失败只更新成功批次快照，后续可重试；空选择不发请求', async () => {
  stored = Array.from({ length: 1001 }, (_, index) => ({ id: 'partial-' + index, userId: user.id, sourceType: 'upload', imageUrl: '/image-' + index + '.png', title: '合成图片', prompt: '', tags: ['旧'], createdAt: 1 }));
  const service = await import('../../services/collectionFavorites'); await service.loadCollection(user);
  const originalPost = mocks.post.getMockImplementation()!;
  let calls = 0;
  mocks.post.mockImplementation(async (path, body) => { if (++calls === 2) throw new Error('第二批失败'); return originalPost(path, body); });
  await expect(service.updateCollection(stored.map(item => item.id), { tags: ['新'] })).rejects.toThrow('第二批失败');
  expect(stored.filter(item => item.tags?.[0] === '新')).toHaveLength(500);
  expect(service.collectionSnapshot().filter(item => item.tags?.[0] === '新')).toHaveLength(500);
  await service.updateCollection(service.collectionSnapshot().filter(item => item.tags?.[0] === '旧').map(item => item.id), { tags: ['新'] });
  expect(stored.every(item => item.tags?.[0] === '新')).toBe(true);
  const requestCount = mocks.post.mock.calls.length + mocks.put.mock.calls.length;
  await service.updateCollection([], { tags: [] });
  expect(mocks.post.mock.calls.length + mocks.put.mock.calls.length).toBe(requestCount);
});
