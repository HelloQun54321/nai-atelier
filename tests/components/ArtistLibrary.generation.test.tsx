// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollBlocklist: async () => [], saveRollBlocklist: async (tags: string[]) => tags }));
import { getDefaultArtistSampleTemplate } from '../../services/artistSampleDrafts';
import { getArtistSampleGeneration } from '../../services/artistSampleGeneration';

const mocks = vi.hoisted(() => ({ build: vi.fn(), begin: vi.fn(), data: vi.fn(), changed: undefined as (() => void) | undefined }));
vi.mock('../../services/naiService', () => ({ buildGenerationJobDescriptor: mocks.build }));
vi.mock('../../services/generationSeries', () => ({ beginGenerationSeries: mocks.begin, subscribeGenerationSeries: (changed: () => void) => { mocks.changed = changed; return () => {}; }, stopGenerationSeriesSession: vi.fn(), approveGenerationSeries: vi.fn() }));
vi.mock('../../services/anlasBudget', async original => ({ ...await original<typeof import('../../services/anlasBudget')>(), useAnlasBudget: () => ({ remaining: 100 }), estimateV45GenerationCost: () => 0 }));
vi.mock('../../services/naiUsage', async original => ({ ...await original<typeof import('../../services/naiUsage')>(), useNovelaiUsage: () => ({ info: null, refreshIfStale: async () => {} }) }));
vi.mock('../../services/naiRuntime', async original => { const actual = await original<typeof import('../../services/naiRuntime')>(); return { ...actual, useNaiRuntime: () => actual.DEFAULT_NAI_RUNTIME, getNaiRuntimeConfig: async () => actual.DEFAULT_NAI_RUNTIME }; });
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(),
  getArtistSampleStatus: async () => ({ available: true, packs: ['v45', 'v5'].map(id => ({ id, phase: 'ready', count: 1 })) }),
  getArtistSampleCatalog: async (pack: string) => ({ pack, tags: ['synthetic artist'], revision: 'fixture' }),
  getArtistSampleDictionary: async () => [{ name: 'synthetic artist', postCount: 1 }],
  getArtistSampleLookup: async () => ({ imageCount: 0, revision: 'fixture' }),
}));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getArtistDictionaryPage: async () => ({ entries: [], pageCount: 0, total: 0 }) }));
vi.mock('../../services/collectionFavorites', () => ({ ensureCollection: async () => {}, toggleArtistPreference: vi.fn(), collectionSnapshot: () => [], subscribeCollection: () => () => {} }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'h-11 w-11 rounded-full md:h-8 md:w-8' }));
vi.mock('../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ eager, previewTransform, ...props }: any) => <img {...props} /> }));
vi.mock('../../services/imageDisplayPreferences', () => ({ useMobileImageDisplayPreferences: () => ({ layout: 'masonry', columns: 'auto', desktopColumns: 5 }), mobileGalleryClassName: () => '', mobileGalleryStyle: () => ({}) }));

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });
it('真实瀑布流和封面沿服务订阅显示连续预览帧；完成后直接点封面重新生成，不选中画师且请求流式', async () => {
  localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('nai_api_key', 'synthetic-key');
  const watchingPreference = JSON.stringify({ generationStreamPreview: false }); localStorage.setItem('nai_appearance_preferences', watchingPreference);
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} });
  const template = getDefaultArtistSampleTemplate('v45');
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  mocks.build.mockImplementation(async input => input);
  const session: any = { key: 'synthetic-key', state: 'generating', historyIds: [] };
  let finish!: (value: unknown) => void;
  mocks.begin.mockImplementation(() => ({ session, settle: new Promise(resolve => { finish = resolve; }) }));
  const props = { notify: vi.fn(), onNavigateToPlayground: vi.fn() };
  const view = render(<ArtistLibrary {...props} />);
  const card = await screen.findByRole('button', { name: '选择画师：synthetic artist' });
  const button = await screen.findByRole('button', { name: '补充样张' });
  fireEvent.click(button);
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce());
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(mocks.build.mock.calls[0][0].stream).toBe(true);
  act(() => { session.preview = { image: 'data:image/png;base64,Zmlyc3Q=', step: 1 }; mocks.changed?.(); });
  const preview = await screen.findByRole('img', { name: '样张生成预览' });
  expect(preview.getAttribute('src')).toBe('data:image/png;base64,Zmlyc3Q=');
  act(() => { session.preview = { image: 'data:image/png;base64,c2Vjb25k', step: 2 }; mocks.changed?.(); });
  expect(screen.getByRole('img', { name: '样张生成预览' })).toBe(preview);
  expect(preview.getAttribute('src')).toBe('data:image/png;base64,c2Vjb25k');
  expect(preview.closest('[data-gallery-work-id]')).toBe(card);
  const item = { id: 'history-synthetic', imageUrl: '/api/assets/synthetic.png', prompt: 'artist:synthetic artist', negativePrompt: '', params: { ...template.params, seed: 123 }, createdAt: 100 };
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [{ ...item, id: 'sample-v45-' + item.id, tag: 'synthetic artist', pack: 'v45' }] });
  await act(async () => { session.preview = undefined; session.historyIds = [item.id]; session.lastSavedItem = item; finish({ success: true }); });
  expect(getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'saved' });
  const regenerate = await screen.findByRole('button', { name: '重新生成样张' });
  expect(regenerate.closest('[role=dialog]')).toBeNull(); expect(regenerate.closest('.mobile-gallery-frame')).not.toBeNull();
  view.rerender(<ArtistLibrary {...props} />);
  fireEvent.click(regenerate);
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledTimes(2));
  expect(mocks.build.mock.calls[1][0]).toMatchObject({ stream: true, forceEmptySeed: true });
  await act(async () => finish({ success: true }));
  expect(props.onNavigateToPlayground).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai_appearance_preferences')).toBe(watchingPreference);
});
