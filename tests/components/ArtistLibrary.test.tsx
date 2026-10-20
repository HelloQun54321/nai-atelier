// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import { ARTIST_SAMPLES_CHANGED } from '../../services/artistSamples';
import { ImageActivityContext } from '../../components/SmartImage';
import { clearImageDisplayPageOverride, getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
const mocks = vi.hoisted(() => ({ status: vi.fn(), catalog: vi.fn(), dictionary: vi.fn(), data: vi.fn(), prepare: vi.fn(), begin: vi.fn(), key: 'synthetic-key', confirm: vi.fn(), states: new Map<string, any>(), generationListeners: new Set<() => void>(), generationRevision: 0, generatedSamples: [] as any[], retry: vi.fn(), page: vi.fn(), search: vi.fn(), focus: vi.fn(), control: vi.fn(), collection: [] as { sourceType: string; sourceId: string; archived?: boolean }[], collectionListeners: new Set<() => void>() }));
vi.mock('../../services/anlasBudget', async original => ({ ...await original<typeof import('../../services/anlasBudget')>(), useAnlasBudget: () => ({ remaining: 100 }), estimateV45GenerationCost: () => 3 }));
vi.mock('../../services/naiUsage', async original => ({ ...await original<typeof import('../../services/naiUsage')>(), useNovelaiUsage: () => ({ info: null, refreshIfStale: async () => {} }) }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => undefined }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), beginArtistSampleGeneration: mocks.begin, readArtistSampleApiKey: () => mocks.key, getGeneratedArtistSamples: () => mocks.generatedSamples, getArtistSampleGeneration: (tag: string, pack: string) => mocks.states.get(pack + ':' + tag), artistSampleGenerationRevision: () => mocks.generationRevision, subscribeArtistSampleGeneration: (listener: () => void) => { mocks.generationListeners.add(listener); return () => { mocks.generationListeners.delete(listener); }; }, retryArtistSampleSave: mocks.retry }));
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog, getArtistSampleDictionary: mocks.dictionary, controlArtistSamplePack: mocks.control }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, prepareArtistSampleImport: mocks.prepare }));
vi.mock('../../components/ArtistSampleSettingsDialog', () => ({ ArtistSampleSettingsDialog: ({ tag, pack, generateAfterSave, onSaved, onClose }: any) => <div role="dialog" aria-label="补图生成设置"><span>{tag} {pack}</span><button onClick={() => onSaved({ prompt: 'artist:{artist}', negativePrompt: '', params: { model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', seed: 1 } })}>{generateAfterSave ? '保存并生成样张' : '保存配置'}</button><button onClick={onClose}>取消</button></div> }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getArtistDictionaryPage: mocks.page, searchArtistDictionary: mocks.search }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => mocks.collection, subscribeCollection: (listener: () => void) => { mocks.collectionListeners.add(listener); return () => { mocks.collectionListeners.delete(listener); }; } }));
vi.mock('../../components/ArtistSampleCover', () => ({ ArtistSampleCover: ({ tag, pack, onPackChange, revision, hasPackSample, ownSamples, sampleStatusText, onSupplement, onGenerate, onImageLoad, imageClassName }: any) => <div data-testid={'cover-' + tag} data-pack={pack} data-revision={revision} data-packed={hasPackSample} data-own={ownSamples.length} data-own-ids={ownSamples.map((sample: any) => sample.id).join(',')} data-image-class={imageClassName}>
  <div data-card-action="true" onClick={event => event.stopPropagation()}>{['v45', 'v5'].map(value => <button key={value} aria-label={'卡片 ' + value} aria-pressed={pack === value} onClick={() => onPackChange(value)}>{value}</button>)}</div>
  {(hasPackSample || ownSamples.length > 0) ? <><img alt={tag} src={'/synthetic-' + pack + '.png'} onLoad={event => onImageLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /><div data-card-action="true" onClick={event => event.stopPropagation()}><button aria-label="收藏">收藏</button></div></> : sampleStatusText && <span>{sampleStatusText}</span>}
  {(hasPackSample || ownSamples.length > 0) && <button data-agent-action="business" onClick={event => { event.stopPropagation(); onGenerate(); }}>{ownSamples.length ? '重新生成样张' : '生成样张'}</button>}
  {!hasPackSample && !ownSamples.length && <button data-card-action="true" onClick={event => { event.stopPropagation(); onSupplement(); }}>补充样张</button>}
</div> }));
vi.mock('../../components/ShortestColumnMasonry', async original => ({ ...await original<typeof import('../../components/ShortestColumnMasonry')>(), ShortestColumnMasonry: ({ items, columns, renderItem }: any) => <div data-testid="masonry" data-columns={columns}>{items.map(renderItem)}</div> }));
vi.mock('../../components/useGallerySelectionAnchor', () => ({ useGallerySelectionAnchor: (_a: unknown, _b: unknown, focused: string | null) => { mocks.focus(focused); return { hasAnchor: false, onScroll: () => {} }; } }));
vi.mock('../../components/useKeepAliveScrollRestore', () => ({ useKeepAliveScrollRestore: () => () => {} }));
const entries = [
  { name: 'alpha artist', chinese: '画师甲', postCount: 30 },
  { name: 'beta artist', chinese: '画师乙', postCount: 20 },
  { name: 'missing artist', chinese: '缺图画师', postCount: 10 },
];
const template = { prompt: 'artist:{artist}', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full', seed: 1, width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' } };
const status = (phase = 'ready', error?: string) => ({ available: true, canManage: true, packs: ['v45', 'v5'].map(id => ({ id, label: id, filename: id + '.tar', phase, progress: 25, count: 2, revision: id + '-one', error })) });
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.key = 'synthetic-key'; mocks.begin.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(true); mocks.states.clear(); mocks.generationListeners.clear(); mocks.generationRevision = 0; mocks.generatedSamples = [];
  mocks.collection = []; mocks.collectionListeners.clear();
  mocks.status.mockResolvedValue(status());
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack + '-one', tags: pack === 'v45' ? ['alpha_artist', 'unknown archive key'] : ['alpha_artist', 'beta artist'] }));
  mocks.dictionary.mockResolvedValue(entries); mocks.data.mockResolvedValue({ templates: {}, samples: [] });
  mocks.page.mockResolvedValue({ entries, page: 0, pageCount: 1, pageSize: 100, total: entries.length });
  mocks.search.mockImplementation(async (query: string) => entries.filter(entry => entry.name.includes(query)));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo); else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; });
const publishGeneration = () => act(() => { mocks.generationRevision++; mocks.generationListeners.forEach(listener => listener()); });
const setup = () => { const notify = vi.fn(), navigate = vi.fn(); const view = render(<ArtistLibrary notify={notify} onNavigateToPlayground={navigate} />); return { ...view, notify, navigate }; };

it('确认一张费用后固定目标版本/模板，取消不投递，自己的样张才有封面重新生成入口', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [{ ...template, id: 'old', tag: 'alpha artist', pack: 'v45', imageUrl: '/api/assets/old.png', createdAt: 1 }] });
  const { navigate } = setup();
  await screen.findByTestId('cover-alpha artist');
  const card = screen.getByRole('button', { name: '选择画师：alpha artist' });
  const regenerate = within(card).getByRole('button', { name: '重新生成样张' });
  expect(regenerate.closest('.mobile-gallery-frame')).not.toBeNull(); expect(regenerate.getAttribute('data-agent-action')).toBe('business');
  mocks.confirm.mockResolvedValueOnce(false); await act(async () => fireEvent.click(regenerate));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce()); expect(mocks.begin).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole('button', { name: '重新生成样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith('alpha artist', 'v45', template, 'synthetic-key', 3, true, true, expect.any(Function)));
  expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ rememberKey: 'artist-sample.generate', message: expect.stringContaining('1 张') }));
  expect(card.getAttribute('aria-pressed')).toBe('false'); expect(navigate).not.toHaveBeenCalled();
});

it('后台完成新样张即时加入对应卡片，切版/刷新保留原样张；归档失败重试不重新收费', async () => {
  const { navigate } = setup(); await screen.findByTestId('cover-alpha artist');
  mocks.states.set('v45:alpha artist', { target: { tag: 'alpha artist', pack: 'v45' }, phase: 'saved', sample: { ...template, id: 'sample-v45-new', tag: 'alpha artist', pack: 'v45', imageUrl: '/api/assets/new.png', createdAt: 10 } });
  mocks.generatedSamples = [mocks.states.get('v45:alpha artist').sample]; publishGeneration();
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-own-ids')).toBe('sample-v45-new');
  switchCard('alpha artist', 'v5'); expect(screen.getByTestId('cover-alpha artist').getAttribute('data-own')).toBe('0');
  switchCard('alpha artist', 'v45'); expect(screen.getByTestId('cover-alpha artist').getAttribute('data-own')).toBe('1');
  mocks.states.set('v45:alpha artist', { target: { tag: 'alpha artist', pack: 'v45' }, phase: 'save_failed', item: { id: 'history-real' }, error: '合成保存失败' }); publishGeneration();
  fireEvent.click(screen.getByRole('button', { name: '重试保存样张' }));
  expect(mocks.retry).toHaveBeenCalledWith('alpha artist', 'v45'); expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});

it('已有图包也能以本次新Seed生成独立样张，不触发缺图入口或跳实验室', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const { navigate } = setup(); const cover = await screen.findByTestId('cover-alpha artist');
  expect(within(cover).queryByRole('button', { name: '补充样张' })).toBeNull();
  fireEvent.click(within(cover).getByRole('button', { name: '生成样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith('alpha artist', 'v45', template, 'synthetic-key', 3, true, true, expect.any(Function)));
  expect(navigate).not.toHaveBeenCalled();
});

it.each(['hidden', 'key-change'])('费用确认期间%s不迟到提交，已确认任务状态不由页面卸载取消', async change => {
  let approve!: (value: boolean) => void;
  mocks.confirm.mockReturnValue(new Promise(resolve => { approve = resolve; }));
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const notify = vi.fn();
  const view = render(<ImageActivityContext.Provider value><ArtistLibrary notify={notify} /></ImageActivityContext.Provider>);
  await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click(within(await screen.findByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  if (change === 'key-change') mocks.key = 'different-key';
  else view.rerender(<ImageActivityContext.Provider value={false}><ArtistLibrary notify={notify} /></ImageActivityContext.Provider>);
  await act(async () => approve(true));
  expect(mocks.begin).not.toHaveBeenCalled();
});
const sampleCards = () => screen.queryAllByRole('button', { name: /^选择画师：/ });
const disableSampleFilter = () => { fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.click(screen.getByRole('checkbox', { name: '只看有样张' })); fireEvent.keyDown(window, { key: 'Escape' }); };
const switchCard = (tag: string, pack: 'v45' | 'v5') => fireEvent.click(within(screen.getByTestId('cover-' + tag)).getByRole('button', { name: '卡片 ' + pack }));

it.each([390, 1280])('宽度%s下单卡切到缺图版本保留卡片、选择和搜索，顶部切换清单卡覆盖', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack + '-one', tags: pack === 'v45' ? ['alpha artist', 'beta artist'] : ['beta artist'] }));
  const { unmount } = setup();
  const alpha = await screen.findByRole('button', { name: '选择画师：alpha artist' });
  fireEvent.click(alpha);
  const beta = screen.getByRole('button', { name: '选择画师：beta artist' });
  switchCard('alpha artist', 'v5');
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' })).toBe(alpha);
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-packed')).toBe('false');
  expect(screen.getByTestId('cover-alpha artist').parentElement?.className).toContain('mobile-gallery-frame md:aspect-[2/3]');
  expect(screen.getByTestId('cover-alpha artist').parentElement?.className).not.toContain('h-32');
  expect(within(alpha).getByRole('button', { name: '补充样张' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择画师：beta artist' })).toBe(beta);
  expect(screen.getByTestId('cover-beta artist').getAttribute('data-pack')).toBe('v45');
  expect(screen.getByRole('button', { name: 'V4.5' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'V4.5' }));
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-pack')).toBe('v45');
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  switchCard('beta artist', 'v5');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
  fireEvent.click(beta);
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  fireEvent.click(screen.getByRole('button', { name: 'V4.5' }));
  expect(screen.getByTestId('cover-beta artist').getAttribute('data-pack')).toBe('v45');
  expect(beta.getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('beta');
  expect(mocks.status).toHaveBeenCalledOnce();
  unmount(); setup();
  expect((await screen.findByTestId('cover-alpha artist')).getAttribute('data-pack')).toBe('v45');
});

it('单卡按对应版本取自建样张和目录revision，有图不显示补图入口', async () => {
  const v5Template = { ...template, params: { ...template.params, model: 'nai-diffusion-5-full' } };
  mocks.data.mockResolvedValue({ templates: { v45: template, v5: v5Template }, samples: [
    { id: 'v45-own', tag: 'alpha artist', pack: 'v45', imageUrl: '/own-v45.png', createdAt: 1, ...template },
    { id: 'v5-old', tag: 'alpha artist', pack: 'v5', imageUrl: '/own-v5-old.png', createdAt: 2, ...v5Template },
    { id: 'v5-new', tag: 'alpha artist', pack: 'v5', imageUrl: '/own-v5-new.png', createdAt: 3, ...v5Template },
  ] });
  const { navigate } = setup();
  const cover = await screen.findByTestId('cover-alpha artist');
  expect(cover.getAttribute('data-own-ids')).toBe('v45-own');
  switchCard('alpha artist', 'v5');
  expect(cover.getAttribute('data-revision')).toBe('v5-one');
  expect(cover.getAttribute('data-own-ids')).toBe('v5-new,v5-old');
  expect(within(cover).queryByRole('button', { name: '补充样张' })).toBeNull();
  expect(navigate).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});

it('单卡缺模板配置固定该卡画师与版本，后续全页切换不会改写补图目标', async () => {
  const { navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter(); const cover = await screen.findByTestId('cover-missing artist');
  switchCard('missing artist', 'v5');
  fireEvent.click(within(cover).getByRole('button', { name: '补充样张' }));
  expect(screen.getByRole('dialog').textContent).toContain('missing artist v5');
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenLastCalledWith('missing artist', 'v5', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-5-full' }) }), 'synthetic-key', 3, true, false, expect.any(Function)));
  expect(navigate).not.toHaveBeenCalled();
});

it('另一版本目录等待期间切卡不伪造图片，迟到旧读取不能覆盖新revision', async () => {
  let resolveOld!: (value: any) => void;
  mocks.catalog.mockImplementation((pack: string) => pack === 'v5' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ pack, revision: 'v45-one', tags: ['alpha artist'] }));
  setup(); const cover = await screen.findByTestId('cover-alpha artist');
  switchCard('alpha artist', 'v5');
  expect(cover.getAttribute('data-packed')).toBe('false');
  expect(within(cover).getByText('正在读取样张…')).toBeTruthy();
  expect(within(cover).queryByRole('img')).toBeNull();
  const nextStatus = status(); nextStatus.packs[1].revision = 'v5-two';
  mocks.status.mockResolvedValue(nextStatus);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack === 'v5' ? 'v5-two' : 'v45-one', tags: ['alpha artist'] }));
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(cover.getAttribute('data-revision')).toBe('v5-two'));
  await act(async () => resolveOld({ pack: 'v5', revision: 'v5-one', tags: ['beta artist'] }));
  expect(cover.getAttribute('data-revision')).toBe('v5-two');
  expect(cover.getAttribute('data-packed')).toBe('true');
});

it('另一包读取失败不影响全页有图列表，单卡显示对应错误；解除关联清掉失效目录', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => { if (pack === 'v5') throw new Error('V5 合成目录失败'); return { pack, revision: 'v45-one', tags: ['alpha artist'] }; });
  setup(); const cover = await screen.findByTestId('cover-alpha artist');
  switchCard('alpha artist', 'v5');
  expect(within(cover).getByText('V5 合成目录失败')).toBeTruthy();
  expect(cover.getAttribute('data-packed')).toBe('false');
  expect(sampleCards()).toHaveLength(1);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack + '-one', tags: ['alpha artist'] }));
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(cover.getAttribute('data-packed')).toBe('true'));
  const unlinked = status(); unlinked.packs[1].phase = 'unconfigured';
  mocks.status.mockResolvedValue(unlinked);
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(cover.getAttribute('data-packed')).toBe('false'));
  expect(cover.getAttribute('data-revision')).toBe('');
  expect(within(cover).getByText('该模型尚未配置样张图包')).toBeTruthy();
  expect(sampleCards()).toHaveLength(1);
});

it('单卡切换复用按版本记录的真实比例，抽卡范围不跟单卡缺图变化', async () => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry' }));
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: pack + '-one', tags: pack === 'v45' ? ['alpha artist', 'beta artist'] : ['alpha artist'] }));
  setup(); const alpha = await screen.findByRole('button', { name: '选择画师：alpha artist' });
  const loadRatio = (width: number, height: number) => {
    const img = within(alpha).getByRole('img'); Object.defineProperties(img, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } }); fireEvent.load(img);
  };
  loadRatio(600, 800);
  await waitFor(() => expect((screen.getByTestId('cover-alpha artist').parentElement as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('750 / 1000'));
  switchCard('alpha artist', 'v5'); loadRatio(800, 600);
  await waitFor(() => expect((screen.getByTestId('cover-alpha artist').parentElement as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('1333 / 1000'));
  switchCard('alpha artist', 'v45');
  expect((screen.getByTestId('cover-alpha artist').parentElement as HTMLElement).style.getPropertyValue('--mobile-image-ratio')).toBe('750 / 1000');
  switchCard('beta artist', 'v5');
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(2);
  expect(screen.getByTestId('cover-beta artist').getAttribute('data-packed')).toBe('false');
  expect(screen.getByRole('button', { name: '返回完整目录' })).toBeTruthy();
});

it('收藏只筛选真实词库，未展示页的收藏仍可找到；旧收藏与快照不读取、不写入或删除', async () => {
  const late = { name: 'late artist', chinese: '后页画师', postCount: 5 };
  mocks.dictionary.mockResolvedValue([...entries, late]);
  const oldFavorites = JSON.stringify(['missing artist', 'legacy-only']);
  const oldDetails = JSON.stringify({ 'legacy-only': { name: 'legacy-only', chinese: '旧快照' } });
  localStorage.setItem('nai_fav_artists', oldFavorites); localStorage.setItem('nai_artist_favorite_details', oldDetails);
  const get = vi.spyOn(Storage.prototype, 'getItem'), set = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem');
  mocks.collection = [
    { sourceType: 'artist', sourceId: 'alpha artist' }, { sourceType: 'artist', sourceId: late.name },
    { sourceType: 'artist', sourceId: 'legacy-only' }, { sourceType: 'artist', sourceId: 'beta artist', archived: true },
    { sourceType: 'danbooru', sourceId: 'missing artist' },
  ];
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏画师' })); fireEvent.keyDown(window, { key: 'Escape' });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist', '选择画师：late artist']);
  expect(screen.getByText('后页画师')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '后页' } });
  expect(sampleCards()).toHaveLength(1); expect(screen.getByTestId('cover-late artist')).toBeTruthy();
  act(() => {
    mocks.collection = [{ sourceType: 'artist', sourceId: late.name, archived: true }, { sourceType: 'artist', sourceId: late.name }];
    mocks.collectionListeners.forEach(listener => listener());
  });
  expect(sampleCards()).toHaveLength(1);
  act(() => {
    mocks.collection = mocks.collection.map(item => ({ ...item, archived: true }));
    mocks.collectionListeners.forEach(listener => listener());
  });
  expect(sampleCards()).toHaveLength(0);
  const legacyKeys = ['nai_fav_artists', 'nai_artist_favorite_details'];
  for (const spy of [get, set, remove]) expect(spy.mock.calls.filter(([key]) => legacyKeys.includes(key))).toEqual([]);
  get.mockRestore();
  expect(localStorage.getItem('nai_fav_artists')).toBe(oldFavorites);
  expect(localStorage.getItem('nai_artist_favorite_details')).toBe(oldDetails);
});

it.each(['masonry', 'portrait', 'square'] as const)('%s画师布局跟随全局5列，角色覆盖不串页，自己的覆盖可清除', async layout => {
  setMobileImageDisplayPreferences({ layout, columns: 3, desktopColumns: 5 });
  setMobileImageDisplayPreferences({ layout: 'square', columns: 1, desktopColumns: 1 }, 'characters');
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  const expectColumns = (count: number) => {
    if (layout === 'masonry') expect(screen.getByTestId('masonry').getAttribute('data-columns')).toBe(String(count));
    else expect((container.querySelector('.workspace-artist-grid') as HTMLElement).style.getPropertyValue('--mobile-gallery-columns')).toBe(String(count));
  };
  expectColumns(5);
  act(() => setMobileImageDisplayPreferences({ layout, columns: 1, desktopColumns: 2 }, 'artists'));
  expectColumns(2);
  expect(getMobileImageDisplayPreferences('characters').desktopColumns).toBe(1);
  act(() => clearImageDisplayPageOverride('artists'));
  expectColumns(5);
});

it.each([390, 1280])('宽度 %s 默认只显示当前包与真实词库交集，model segmented常驻，旧封面和未知包key不冒充样张', async width => {
  vi.stubGlobal('innerWidth', width);
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  expect(sampleCards()).toHaveLength(1); expect(screen.queryByTestId('cover-unknown archive key')).toBeNull();
  const model = screen.getByRole('group', { name: '画师样张模型' }); expect(container.querySelector('header')!.contains(model)).toBe(true);
  expect(screen.getByRole('button', { name: 'V4.5' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.dictionary).toHaveBeenCalledOnce(); expect(mocks.catalog).toHaveBeenCalledWith('v45');
});

it('来源切换保留搜索、选中Tag与focus，选择保存本端，匹配字典不会因第一页无图而空', async () => {
  mocks.page.mockResolvedValue({ entries: [entries[2]], total: 300, page: 0, pageCount: 3, pageSize: 100 });
  const { unmount } = setup();
  fireEvent.click(await screen.findByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  expect(mocks.focus).toHaveBeenLastCalledWith('alpha artist');
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  await waitFor(() => expect(screen.getByTestId('cover-alpha artist').getAttribute('data-pack')).toBe('v5'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.focus).toHaveBeenLastCalledWith('alpha artist'); expect(localStorage.getItem('nai_artist_sample_pack')).toBe('v5');
  unmount(); setup(); expect(screen.getByRole('button', { name: 'V5' }).getAttribute('aria-pressed')).toBe('true');
});

it.each([390, 1280])('宽度%s时图包样张和自建样张点击都选择画师，分享控件不选择，抽卡列表仍可选择', async width => {
  vi.stubGlobal('innerWidth', width);
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry' }));
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'own-beta', tag: 'beta artist', pack: 'v45', imageUrl: '/own.png', createdAt: 1, ...template }] });
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-image-class')).toBe('h-full w-full object-contain');
  const alpha = screen.getByRole('button', { name: '选择画师：alpha artist' });
  fireEvent.click(screen.getByRole('img', { name: 'alpha artist' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(alpha).getByText('alpha artist'));
  expect(alpha.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('img', { name: 'alpha artist' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(alpha).getByRole('button', { name: '收藏' }));
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  const beta = screen.getByRole('button', { name: '选择画师：beta artist' });
  fireEvent.keyDown(beta, { key: 'Enter' }); expect(beta.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(beta, { key: ' ' }); expect(beta.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  const gachaCard = sampleCards()[0];
  const gachaImage = within(gachaCard).queryByRole('img');
  const wasSelected = gachaCard.getAttribute('aria-pressed');
  if (gachaImage) fireEvent.click(gachaImage);
  else fireEvent.click(gachaCard);
  expect(gachaCard.getAttribute('aria-pressed')).not.toBe(wasSelected);
  expect(container.querySelectorAll('[data-testid^="cover-"]').length).toBeGreaterThan(0);
});

it('关闭只看样张可以发现缺图Tag，补充按已保存模板确认一张费用后在原卡生成，不跳实验室', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const { navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click(within(await screen.findByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith('missing artist', 'v45', template, 'synthetic-key', 3, true, false, expect.any(Function))); expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '选择画师：missing artist' }).getAttribute('aria-pressed')).toBe('false');
});

it('没有模板首次配置后带入准确目标，打开和取消不自动生成', async () => {
  const { notify, navigate } = setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click(within(await screen.findByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  expect(screen.getByRole('dialog', { name: '补图生成设置' })).toBeTruthy();
  expect(notify).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'V5' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith('missing artist', 'v45', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-4-5-full' }) }), 'synthetic-key', 3, true, false, expect.any(Function)));
  expect(navigate).not.toHaveBeenCalled();
});

it('未配置图包仍可显示当前pack自建样张，变更事件重新读取而不清搜索', async () => {
  mocks.status.mockResolvedValue(status('unconfigured'));
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'own', tag: 'beta artist', pack: 'v45', imageUrl: '/synthetic.png', createdAt: 1, ...template }] });
  setup(); await screen.findByTestId('cover-beta artist');
  expect(sampleCards()).toHaveLength(1); expect(mocks.catalog).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('beta');
});

it.each(['indexing', 'error'])('来源%s状态清楚且不读未就绪图包目录', async phase => {
  mocks.status.mockResolvedValue(status(phase, phase === 'error' ? '合成索引损坏' : undefined));
  setup();
  await screen.findByText(phase === 'indexing' ? '样张索引中：25%' : '合成索引损坏');
  expect(mocks.catalog).not.toHaveBeenCalled(); expect(sampleCards()).toHaveLength(0);
});

it('来源unconfigured时展示完整目录但不读未就绪图包目录', async () => {
  mocks.status.mockResolvedValue(status('unconfigured'));
  setup();
  await waitFor(() => expect(sampleCards()).toHaveLength(3));
  expect(mocks.catalog).not.toHaveBeenCalled();
  expect(screen.queryByText('该模型尚未配置样张图包')).toBeNull();
});

it('超过100个样张时复用轻量分页，搜索和收藏可命中未展示的后续页，抽卡不发词库位置请求', async () => {
  const full = Array.from({ length: 150 }, (_, index) => ({ name: 'artist-' + index, chinese: '', postCount: 150 - index }));
  mocks.dictionary.mockResolvedValue(full); mocks.catalog.mockImplementation(async (pack: string) => ({ pack, revision: 'many', tags: full.map(entry => entry.name) }));
  setup(); await waitFor(() => expect(sampleCards()).toHaveLength(100));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' })); expect(sampleCards()).toHaveLength(150);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'artist-149' } }); expect(sampleCards()).toHaveLength(1);
  expect(screen.getByTestId('cover-artist-149')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } }); disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(12);
  expect(sampleCards().every(card => full.some(entry => card.getAttribute('aria-label') === '选择画师：' + entry.name))).toBe(true);
  expect(mocks.page).toHaveBeenCalledOnce();
});

it('无法读取图包时明确反馈，但关闭样张筛选仍能浏览Tag词库', async () => {
  mocks.status.mockRejectedValue(new Error('本地图包仅支持电脑端及局域网访问'));
  setup(); await screen.findByText('本地图包仅支持电脑端及局域网访问'); disableSampleFilter();
  expect(await screen.findByTestId('cover-missing artist')).toBeTruthy();
});

const downloadingStatus = (stage: 'downloading' | 'verifying' | 'paused' | 'error', phase = 'unconfigured') => ({
  ...status(phase), packs: status(phase).packs.map(pack => ({ ...pack, managed: true, download: { stage, receivedBytes: 25, totalBytes: 100, error: stage === 'error' ? '合成网络错误' : undefined } })),
});
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

it('关闭设置无需广播，在库页跟随下载、校验、索引到就绪自动展示并停止轮询', async () => {
  mocks.status.mockResolvedValueOnce(downloadingStatus('downloading'))
    .mockResolvedValueOnce(downloadingStatus('verifying'))
    .mockResolvedValueOnce(status('indexing')).mockResolvedValue(status());
  vi.useFakeTimers(); await act(async () => { setup(); });
  expect(screen.getByText('图包下载中：25%')).toBeTruthy();
  expect(screen.queryByText('该模型尚未配置样张图包')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getAllByText('图包下载中：25%')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  await poll(); expect(screen.getByText('正在校验图包…')).toBeTruthy();
  expect(mocks.catalog).not.toHaveBeenCalled();
  await poll(); expect(screen.getByText('样张索引中：25%')).toBeTruthy();
  await poll(); expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(mocks.status).toHaveBeenCalledTimes(4); expect(mocks.catalog).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.status).toHaveBeenCalledTimes(4); expect(mocks.control).not.toHaveBeenCalled();
});

it('任一包下载时轮询，短暂状态失败保留旧样张、搜索及多选，再读就绪后停止', async () => {
  const background = status();
  const working = { ...background, packs: background.packs.map(pack => pack.id === 'v5' ? { ...pack, phase: 'unconfigured', download: { stage: 'downloading', receivedBytes: 25, totalBytes: 100 } } : pack) };
  mocks.status.mockResolvedValueOnce(working).mockRejectedValueOnce(new Error('合成读取失败')).mockResolvedValue(status());
  vi.useFakeTimers(); await act(async () => { setup(); });
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  await poll();
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  await poll(); expect(mocks.status).toHaveBeenCalledTimes(3);
  await poll(); expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(mocks.control).not.toHaveBeenCalled();
});

it.each(['paused', 'error'] as const)('图包下载%s显示真实状态，暂停与错误不轮询或自动启动下载', async stage => {
  mocks.status.mockResolvedValue(downloadingStatus(stage));
  vi.useFakeTimers(); await act(async () => { setup(); });
  const message = stage === 'paused' ? '图包下载已暂停：25%' : '图包下载失败：合成网络错误';
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText('该模型尚未配置样张图包')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getAllByText(message)).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.status).toHaveBeenCalledOnce(); expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
});
it.each([390, 1280])('宽度%s顶栏仅一个画师库设置齿轮，两版模板保存均不绑定画师或进入实验室', async width => {
  vi.stubGlobal('innerWidth', width); const { navigate } = setup(); await screen.findByTestId('cover-alpha artist');
  const card = screen.getByRole('button', { name: '选择画师：alpha artist' });
  expect(screen.queryByRole('button', { name: '抽卡设置' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '画师库设置' })).toHaveLength(1);
  const gear = screen.getByRole('button', { name: '画师库设置' });
  expect(within(gear).getByText('画师库设置')).toBeTruthy();
  expect(gear.parentElement?.className).toContain('[&_button>span]:!inline');
  expect(gear.parentElement).not.toBe(screen.getByRole('button', { name: '随机选画师' }).parentElement);
  for (const version of ['V4.5', 'V5']) {
    gear.focus(); fireEvent.click(gear);
    const settings = await screen.findByRole('dialog', { name: '画师库设置' });
    expect(within(settings).getByRole('combobox', { name: '随机方式' })).toBeTruthy();
    expect(within(settings).getByRole('combobox', { name: '数量' })).toBeTruthy();
    fireEvent.click(within(settings).getByRole('button', { name: version + ' 补图生成设置' }));
    const dialog = await screen.findByRole('dialog', { name: '补图生成设置' });
    expect(screen.queryByRole('dialog', { name: '画师库设置' })).toBeNull();
    expect(document.activeElement).toBe(gear);
    expect(dialog.textContent).toContain(version === 'V5' ? 'v5' : 'v45'); expect(dialog.textContent).not.toContain('alpha artist');
    expect(screen.queryByRole('button', { name: '保存并生成样张' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存配置' }));
    expect(screen.queryByRole('dialog', { name: '补图生成设置' })).toBeNull();
  }
  expect(navigate).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  disableSampleFilter();
  fireEvent.click(within(screen.getByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenLastCalledWith('missing artist', 'v45', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-4-5-full' }) }), 'synthetic-key', 3, true, false, expect.any(Function)));
  expect(navigate).not.toHaveBeenCalled(); expect(card.getAttribute('aria-pressed')).toBe('false');
  switchCard('missing artist', 'v5');
  fireEvent.click(within(screen.getByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenLastCalledWith('missing artist', 'v5', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-5-full' }) }), 'synthetic-key', 3, true, false, expect.any(Function)));
});

it('手机设置先退出底部面板历史层并归还齿轮焦点，再打开版本模板，不叠弹层', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => { window.history.replaceState(null, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
  setup(); await screen.findByTestId('cover-alpha artist');
  const gear = screen.getByRole('button', { name: '画师库设置' }); gear.focus(); fireEvent.click(gear);
  const panel = await screen.findByRole('dialog', { name: '画师库设置' });
  expect(window.history.state.__naiMobileLayer).toMatch(/^sheet-/);
  fireEvent.click(within(panel).getByRole('button', { name: 'V5 补图生成设置' }));
  await screen.findByRole('dialog', { name: '补图生成设置' });
  expect(back).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog', { name: '画师库设置' })).toBeNull();
  expect(document.activeElement).toBe(gear); expect(mocks.prepare).not.toHaveBeenCalled();
});

it('搜索忽略首尾空格与下划线，粘贴带空格的画师名不会清空结果', async () => {
  setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  alpha_artist  ' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(1));
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
});

it('只看样张搜不到时可直接在全部画师中继续搜索', async () => {
  setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(await screen.findByText('没有匹配的画师样张')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '在全部画师中搜索' }));
  expect(await screen.findByText('没有匹配的画师')).toBeTruthy();
  expect(screen.getByRole('button', { name: '清除搜索' })).toBeTruthy();
});

it('全目录搜索无结果时给出空态并可直接清除搜索', async () => {
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(await screen.findByText('没有匹配的画师')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''));
  await waitFor(() => expect(sampleCards().length).toBeGreaterThan(0));
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
});

it('全目录搜索失败显示错误，重试后恢复真实结果', async () => {
  mocks.search.mockRejectedValueOnce(new Error('合成搜索失败'));
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  expect(await screen.findByText('搜索画师失败，请稍后重试')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist']));
});

it('画师目录首次加载失败显示错误与重试，重试后恢复列表', async () => {
  mocks.page.mockRejectedValueOnce(new Error('合成目录失败'));
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  expect(await screen.findByText('画师目录不可用，请在全局设置更新 Tag 词库。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toContain('选择画师：alpha artist'));
});

it('加载更多画师失败给出明确提示，重试后继续追加且不重复请求', async () => {
  const first = { entries: entries.slice(0, 2), page: 0, pageCount: 2, pageSize: 2, total: 3 };
  const second = { entries: [entries[2]], page: 1, pageCount: 2, pageSize: 2, total: 3 };
  mocks.page.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('合成分页失败')).mockResolvedValue(second);
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  await waitFor(() => expect(sampleCards()).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(await screen.findByText('加载更多画师失败，请重试')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByTestId('cover-missing artist')).toBeTruthy());
  expect(sampleCards()).toHaveLength(3);
});

it('画师卡片名称保留完整 title，长名称可悬浮查看', async () => {
  setup(); await screen.findByTestId('cover-alpha artist');
  const card = screen.getByRole('button', { name: '选择画师：alpha artist' });
  expect(within(card).getByText('alpha artist').getAttribute('title')).toBe('alpha artist');
});

it('搜索结果超过展示上限时明确提示，不静默截断', async () => {
  mocks.search.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ name: 'bulk artist ' + index, chinese: '', postCount: 1 })));
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bulk' } });
  expect(await screen.findByText('仅显示前 200 条结果，请缩小搜索范围')).toBeTruthy();
  expect(sampleCards()).toHaveLength(200);
});

it('当前样张包未配置时默认展示完整目录，用户关闭样张筛选后记住选择', async () => {
  mocks.status.mockResolvedValue({ available: true, canManage: true, packs: ['v45', 'v5'].map(id => ({ id, label: id, filename: id + '.tar', phase: 'unconfigured', progress: 0, count: 0, revision: '' })) });
  setup();
  await screen.findByTestId('cover-missing artist');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  const checkbox = screen.getByRole('checkbox', { name: '只看有样张' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(localStorage.getItem('nai_artist_only_samples')).toBe('true');
});
