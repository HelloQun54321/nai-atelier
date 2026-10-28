// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Inspiration, PromptChain, User } from '../../types';
import { ChainList } from '../../components/ChainList';
import { PromptLibraryCard } from '../../components/PromptLibraryCard';
import { ImageLightbox } from '../../components/ImageLightbox';
import { PromptLibraryHub } from '../../components/PromptLibrary';
import { ChainSimilarityDialog } from '../../components/chain/ChainSimilarityDialog';
import { PromptLibraryContext } from '../../components/PromptLibraryAccess';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { createFragmentData } from '../../services/promptLibraryEntries';
import { collectionSnapshot, loadCollection } from '../../services/collectionFavorites';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), upload: vi.fn(), stored: [] as Inspiration[] }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: mocks.get, put: mocks.put, post: mocks.post, uploadFile: mocks.upload } }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: async () => ({ items: [], count: 0 }), subscribe: () => () => {}, setFavorite: vi.fn(), setFavorites: vi.fn() } }));
vi.mock('../../services/appearancePreferences', () => ({ useGalleryFrostedCaption: () => false }));
vi.mock('../../services/imageSharing', () => ({ useCleanSharedImages: () => false, copySharedImage: vi.fn(), downloadSharedImage: vi.fn() }));
vi.mock('../../services/stChatu8Preferences', () => ({ useStChatu8Preferences: () => ({ enabled: false }) }));
vi.mock('../../services/stChatu8Sync', () => ({ useStChatu8Selection: () => ({ open: false, selecting: false, busy: false, entries: new Map(), available: new Set(), selected: new Set(), accepts: () => true, cancel: vi.fn() }), wisdomEntryLabel: () => '' }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => ({}) }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getSelectableNaiModels: () => [] }));
vi.mock('../../components/StyleCollectorControl', () => ({ StyleCollectorControl: () => null }));
vi.mock('../../components/chain/FolderBatchImportModal', () => ({ FolderBatchImportModal: () => null }));
vi.mock('../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));
vi.mock('../../services/promptLibraryUsage', () => ({ PROMPT_LIBRARY_USAGE_PAGE_SIZE: 24, PROMPT_LIBRARY_USAGE_PREVIEW_SIZE: 6, fetchPromptLibraryUsageSummary: async () => ({ items: [], linkedImages: 0, entries: 0 }), fetchPromptLibraryUsageImages: async () => ({ items: [], count: 0 }) }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleDictionary: async () => [] }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />, OriginalImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));

const user: User = { id: 'synthetic-owner', username: 'synthetic', role: 'admin', createdAt: 1 };
const chain: PromptChain = { id: 'style', userId: user.id, name: '合成风格', type: 'style', description: '', tags: [], basePrompt: 'artist:synthetic', negativePrompt: '', modules: [], params: { ...LAB_DEFAULT_PARAMS, model: 'nai-diffusion-4-5-full' }, previewImage: '/synthetic/new-style.png', createdAt: 1, updatedAt: 1 };
const fragment = { id: 'fragment', userId: user.id, ...createFragmentData('red dress', '合成片段', 'wardrobe'), previewImage: '/synthetic/new-fragment.png', createdAt: 1, updatedAt: 1 } as PromptChain;
const notify = vi.fn();
const directories = { revision: 1, nodes: [] };
beforeEach(async () => {
  localStorage.clear(); vi.clearAllMocks();
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'portrait' }));
  mocks.stored = [chain, fragment].map(item => ({ id: 'saved-' + item.id, userId: user.id, title: item.name, imageUrl: '/synthetic/old-' + item.id + '.png', sourceType: item.id === chain.id ? 'chain' : 'other', sourceId: item.id, prompt: '旧收藏配方', tags: [], createdAt: 1, updatedAt: 1 }));
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/auth/me') return user;
    if (path === '/inspirations') return structuredClone(mocks.stored);
    if (path === '/aitag/favorites') return [];
    if (path === '/chain-folders') return { revision: 1, folders: [], assignments: {} };
    throw Error('本测试禁止未声明的读取：' + path);
  });
  mocks.put.mockImplementation(async (path: string, updates: Partial<Inspiration>) => {
    const id = decodeURIComponent(path.split('/').at(-1)!);
    mocks.stored = mocks.stored.map(item => item.id === id ? { ...item, ...updates } : item);
    return {};
  });
  mocks.post.mockRejectedValue(Error('本测试不应创建收藏或修改其他资料'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('本测试禁止联网与真实生图'); }));
  window.history.replaceState(null, '');
  await loadCollection(user);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['chain', 'other'] as const)('%s 旧封面已收藏时当前卡片和大图同为红心，取消实际归档并即时同步', async sourceType => {
  const item = sourceType === 'chain' ? chain : fragment;
  render(<ConfirmDialogProvider>
    {sourceType === 'chain' ? <ChainList chains={[item]} type="style" onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} onRefresh={vi.fn()} onUpdateChain={vi.fn()} isLoading={false} notify={notify} />
      : <PromptLibraryCard chain={item} label="片段" onOpen={vi.fn()} notify={notify} />}
    <ImageLightbox src={item.previewImage!} favorite={{ imageUrl: item.previewImage!, sourceType, sourceId: item.id }} onClose={vi.fn()} />
  </ConfirmDialogProvider>);
  const card = sourceType === 'chain' ? screen.getByRole('button', { name: '打开风格串：合成风格' }) : screen.getByRole('button', { name: '查看合成片段' });
  const lightbox = within(screen.getByRole('dialog', { name: '图片预览' }));
  await waitFor(() => expect(within(card).getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe('true'));
  expect(lightbox.getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click((sourceType === 'chain' ? within(card) : lightbox).getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(collectionSnapshot().find(saved => saved.sourceId === item.id)?.archived).toBe(true));
  expect(mocks.put).toHaveBeenCalledWith('/inspirations/saved-' + item.id, { archived: true });
  expect(within(card).getByRole('button', { name: '收藏' }).getAttribute('aria-pressed')).toBe('false');
  expect(lightbox.getByRole('button', { name: '收藏' }).getAttribute('aria-pressed')).toBe('false');
  expect(collectionSnapshot().find(saved => saved.sourceId === item.id)?.imageUrl).toBe('/synthetic/old-' + item.id + '.png');
  expect(collectionSnapshot().find(saved => saved.sourceId === item.id)?.prompt).toBe('旧收藏配方');
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
});

it('提示词管理面板封面大图保留对象来源，从大图取消后目录与卡片同步', async () => {
  localStorage.setItem('nai-prompt-library-directories-expanded', 'true');
  render(<ConfirmDialogProvider><PromptLibraryContext.Provider value={{ chains: [fragment], directories, save: vi.fn() }}><PromptLibraryHub chains={[fragment]} onCreate={vi.fn()} onUpdateChain={vi.fn()} onDelete={vi.fn()} notify={notify} embedded /></PromptLibraryContext.Provider></ConfirmDialogProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '片段：合成片段' }));
  fireEvent.click(await screen.findByRole('button', { name: '查看封面原图' }));
  const lightbox = within(await screen.findByRole('dialog', { name: '图片预览' }));
  expect(lightbox.getByRole('button', { name: '取消收藏' })).toBeTruthy();
  fireEvent.click(lightbox.getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(collectionSnapshot().find(saved => saved.sourceId === fragment.id)?.archived).toBe(true));
  await screen.findByRole('option', { name: '收藏 (0)' });
  expect(mocks.put).toHaveBeenCalledWith('/inspirations/saved-fragment', { archived: true });
  expect(mocks.post).not.toHaveBeenCalled();
});

it('风格串相似对比大图保留原对象来源，旧封面收藏可直接取消', async () => {
  const second = { ...chain, id: 'second-style', name: '合成风格二' };
  render(<ConfirmDialogProvider><ChainSimilarityDialog chains={[chain, second]} filteredChains={[chain, second]} onDelete={async () => false} onOpenChain={vi.fn()} onClose={vi.fn()} /></ConfirmDialogProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '放大查看：合成风格' }));
  const lightbox = within(await screen.findByRole('dialog', { name: '图片预览' }));
  expect(lightbox.getByRole('button', { name: '取消收藏' })).toBeTruthy();
  fireEvent.click(lightbox.getByRole('button', { name: '取消收藏' }));
  await waitFor(() => expect(collectionSnapshot().find(saved => saved.sourceId === chain.id)?.archived).toBe(true));
  expect(mocks.put).toHaveBeenCalledWith('/inspirations/saved-style', { archived: true });
  expect(mocks.post).not.toHaveBeenCalled();
});
