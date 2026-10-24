// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import { ARTIST_SAMPLES_CHANGED, type ArtistOwnSample } from '../../services/artistSamples';

const mocks = vi.hoisted(() => ({ data: vi.fn(), remove: vi.fn(), confirm: vi.fn(), lookup: vi.fn(), cached: [] as ArtistOwnSample[] }));
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollBlocklist: async () => [], saveRollBlocklist: async (tags: string[]) => tags }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, deleteArtistSample: mocks.remove }));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), getGeneratedArtistSamples: () => mocks.cached }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(),
  getArtistSampleStatus: async () => ({ available: true, packs: ['v45', 'v5'].map(id => ({ id, model: id === 'v5' ? 'nai-diffusion-5-full' : undefined, phase: 'ready', count: 1, revision: id + '-one' })) }),
  getArtistSampleCatalog: async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, tags: ['alpha_artist'], revision: pack + '-one' }),
  getArtistSampleDictionary: async () => [{ name: 'alpha artist', chinese: '画师甲', postCount: 1 }],
  getArtistSampleLookup: mocks.lookup,
}));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getArtistDictionaryPage: async () => ({ entries: [{ name: 'alpha artist', chinese: '画师甲', postCount: 1 }], pageCount: 1, total: 1 }) }));
vi.mock('../../services/artistUsage', async original => ({ ...await original<typeof import('../../services/artistUsage')>(), getArtistUsage: async () => ({ byTag: new Map(), indexed: 0, total: 0 }) }));
vi.mock('../../services/collectionFavorites', () => ({ ensureCollection: async () => {}, toggleArtistPreference: vi.fn(), collectionSnapshot: () => [], subscribeCollection: () => () => {} }));
vi.mock('../../services/anlasBudget', async original => ({ ...await original<typeof import('../../services/anlasBudget')>(), useAnlasBudget: () => ({ remaining: 100 }) }));
vi.mock('../../services/naiUsage', async original => ({ ...await original<typeof import('../../services/naiUsage')>(), useNovelaiUsage: () => ({ info: null, refreshIfStale: async () => {} }) }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => undefined }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ eager, previewTransform, ...props }: any) => <img {...props} /> }));
vi.mock('../../services/imageDisplayPreferences', async original => ({ ...await original<typeof import('../../services/imageDisplayPreferences')>(), useMobileImageDisplayPreferences: () => ({ layout: 'square', columns: 2, desktopColumns: 3 }) }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); mocks.cached = [];
  mocks.data.mockResolvedValue({ templates: {}, samples: [] }); mocks.remove.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(true);
  // 模拟尚未重启、没有 canonicalTag 的旧本地服务。
  mocks.lookup.mockImplementation(async (pack: string, tag: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, tag, revision: pack + '-one', imageCount: 4, sourceUrl: '' }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} });
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const currentImage = () => screen.getByRole('img', { name: '画师甲' }).getAttribute('src')!;
const removeButton = () => screen.getByRole('button', { name: '删除当前样张' });
const setup = async () => {
  const notify = vi.fn(); render(<ArtistLibrary notify={notify} />);
  await screen.findByRole('img', { name: '画师甲' }); return { notify };
};

it('真实卡片取消删除不写入不翻页，确认后只删当前物理页，旧数据刷新也不闪回', async () => {
  const { notify } = await setup();
  const search = screen.getByRole('searchbox'); fireEvent.change(search, { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(currentImage()).toContain('index=1'); expect(screen.getByText('2 / 4')).toBeTruthy();
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(removeButton()); await waitFor(() => expect(removeButton().hasAttribute('disabled')).toBe(false));
  expect(mocks.remove).not.toHaveBeenCalled(); expect(currentImage()).toContain('index=1'); expect(screen.getByText('2 / 4')).toBeTruthy(); expect(notify).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'artist-sample.delete', tone: 'danger', message: '只从画师样张中移除，历史、收藏和原图保留。' }));
  let confirm!: (value: boolean) => void;
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve; }));
  fireEvent.click(removeButton()); fireEvent.click(removeButton()); expect(mocks.confirm).toHaveBeenCalledTimes(2);
  await act(async () => confirm(true));
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ source: 'pack', pack: 'v45', tag: 'alpha_artist', revision: 'v45-one', index: 1, imageCount: 4 });
  expect(currentImage()).toContain('index=2'); expect(currentImage()).toContain('tag=alpha_artist'); expect(screen.getByText('2 / 3')).toBeTruthy();
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(mocks.data).toHaveBeenCalledTimes(2));
  expect(currentImage()).toContain('index=2'); expect(screen.getByText('2 / 3')).toBeTruthy();
  expect((search as HTMLInputElement).value).toBe('alpha'); expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('false');
  expect(notify).not.toHaveBeenCalled();
});

it('确认等待中切版本，写入仍指向捕获的原版本和原页，失败不改当前样张', async () => {
  const { notify } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  let confirm!: (value: boolean) => void;
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve; }));
  fireEvent.click(removeButton());
  fireEvent.click(screen.getByRole('button', { name: '样张版本 V4.5，切换为 V5 Full' }));
  await waitFor(() => expect(currentImage()).toContain('pack=v5'));
  await act(async () => confirm(true));
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ source: 'pack', pack: 'v45', tag: 'alpha_artist', revision: 'v45-one', index: 1, imageCount: 4 });
  expect(currentImage()).toContain('pack=v5'); expect(currentImage()).toContain('index=0'); expect(screen.getByText('1 / 4')).toBeTruthy();
  mocks.remove.mockRejectedValueOnce(new Error('合成删除失败'));
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); fireEvent.click(removeButton());
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成删除失败', 'error'));
  expect(currentImage()).toContain('pack=v5'); expect(currentImage()).toContain('index=1'); expect(screen.getByText('2 / 4')).toBeTruthy();
});

it('成功删除缓存自建图后不会被迟到缓存或旧GET复活，有样张筛选按删除标记更新', async () => {
  const sample: ArtistOwnSample = { id: 'own-alpha', tag: 'alpha artist', pack: 'v45', imageUrl: '/api/assets/own-alpha.png', prompt: '', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full' } as any, createdAt: 1 };
  mocks.cached = [sample];
  mocks.data.mockResolvedValue({ templates: {}, samples: [], removedSamples: [0, 1, 2, 3].map(index => ({ source: 'pack', pack: 'v45', tag: 'alpha_artist', revision: 'v45-one', index, imageCount: 4 })) });
  await setup(); expect(currentImage()).toBe(sample.imageUrl);
  fireEvent.click(removeButton());
  await waitFor(() => expect(screen.queryByRole('button', { name: '选择画师：alpha artist' })).toBeNull());
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ source: 'own', pack: 'v45', tag: 'alpha artist', id: 'own-alpha' });
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(mocks.data).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: '选择画师：alpha artist' })).toBeNull();
});
