// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import * as libraryRandom from '../../services/libraryRandom';
import { useCatalogGroups } from '../../services/useCatalogGroups';
const groupMocks = vi.hoisted(() => ({ state: { revision: 0, groups: [] as { id: string; name: string }[], memberships: {} as Record<string, string[]> }, ready: true, error: '', realHook: undefined as typeof import('../../services/useCatalogGroups').useCatalogGroups | undefined, get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { ...((await original<typeof import('../../services/api')>()).api), get: groupMocks.get, put: groupMocks.put } }));
vi.mock('../../services/useCatalogGroups', async original => {
  const actual = await original<typeof import('../../services/useCatalogGroups')>();
  groupMocks.realHook = actual.useCatalogGroups;
  return { ...actual, useCatalogGroups: vi.fn() };
});
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollBlocklist: mocks.blockLoad, saveRollBlocklist: mocks.blockSave }));
import { executeAgentCommand, getAgentCommands } from '../../services/agentCommands';
import { ARTIST_SAMPLES_CHANGED } from '../../services/artistSamples';
import { ImageActivityContext } from '../../components/SmartImage';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { clearImageDisplayPageOverride, getMobileImageDisplayPreferences, setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { installPointerEvents, longPress } from '../support/touchEvents';
const mocks = vi.hoisted(() => ({ ensureCollection: vi.fn(), blockLoad: vi.fn(), blockSave: vi.fn(), status: vi.fn(), catalog: vi.fn(), dictionary: vi.fn(), data: vi.fn(), prepare: vi.fn(), begin: vi.fn(), key: 'synthetic-key', confirm: vi.fn(), states: new Map<string, any>(), generationListeners: new Set<() => void>(), generationRevision: 0, generatedSamples: [] as any[], retry: vi.fn(), page: vi.fn(), focus: vi.fn(), control: vi.fn(), usage: vi.fn(), historyListeners: new Set<(change: any) => void>(), historySubscribe: vi.fn(), collection: [] as { sourceType: string; sourceId: string; archived?: boolean; imageUrl?: string }[], collectionListeners: new Set<() => void>() }));
vi.mock('../../services/artistUsage', async original => ({ ...await original<typeof import('../../services/artistUsage')>(), getArtistUsage: mocks.usage }));
vi.mock('../../services/localHistory', async original => {
  const module = await original<typeof import('../../services/localHistory')>();
  const history = Object.assign(Object.create(Object.getPrototypeOf(module.localHistory)), module.localHistory, { subscribe: mocks.historySubscribe });
  return { ...module, localHistory: history };
});
vi.mock('../../services/anlasBudget', async original => ({ ...await original<typeof import('../../services/anlasBudget')>(), useAnlasBudget: () => ({ remaining: 100 }), estimateV45GenerationCost: () => 3 }));
vi.mock('../../services/naiUsage', async original => ({ ...await original<typeof import('../../services/naiUsage')>(), useNovelaiUsage: () => ({ info: null, refreshIfStale: async () => {} }) }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => undefined }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), beginArtistSampleGeneration: mocks.begin, readArtistSampleApiKey: () => mocks.key, getGeneratedArtistSamples: () => mocks.generatedSamples, getArtistSampleGeneration: (tag: string, pack: string) => mocks.states.get(pack + ':' + tag), artistSampleGenerationRevision: () => mocks.generationRevision, subscribeArtistSampleGeneration: (listener: () => void) => { mocks.generationListeners.add(listener); return () => { mocks.generationListeners.delete(listener); }; }, retryArtistSampleSave: mocks.retry }));
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog, getArtistSampleDictionary: mocks.dictionary, controlArtistSamplePack: mocks.control }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, prepareArtistSampleImport: mocks.prepare }));
vi.mock('../../components/ArtistSampleSettingsDialog', () => ({ ArtistSampleSettingsDialog: ({ tag, pack, generateAfterSave, enforceFreeStepLimit, onSaved, onClose }: any) => <div role="dialog" aria-label="补图生成设置" data-free-step-limit={enforceFreeStepLimit}><span>{tag} {pack}</span><button onClick={() => onSaved({ prompt: 'artist:{artist}', negativePrompt: '', params: { model: pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full', seed: 1 } })}>{generateAfterSave ? '保存并生成样张' : '保存配置'}</button><button onClick={onClose}>取消</button></div> }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getArtistDictionaryPage: mocks.page }));
vi.mock('../../services/collectionFavorites', () => ({ ensureCollection: mocks.ensureCollection, toggleArtistPreference: vi.fn(), collectionSnapshot: () => mocks.collection, subscribeCollection: (listener: () => void) => { mocks.collectionListeners.add(listener); return () => { mocks.collectionListeners.delete(listener); }; } }));
vi.mock('../../components/ArtistSampleCover', () => ({ ArtistSampleCover: ({ blocked, preferred, onBlock, notify, tag, pack, packTag, onPackChange, revision, hasPackSample, ownSamples, sampleStatusText, onSupplement, onGenerate, onImageLoad, imageClassName }: any) => <div data-testid={'cover-' + tag} data-blocked={blocked} data-preferred={preferred} data-pack={pack} data-pack-tag={packTag} data-revision={revision} data-packed={hasPackSample} data-own={ownSamples.length} data-own-ids={ownSamples.map((sample: any) => sample.id).join(',')} data-image-class={imageClassName}>
  <button aria-label={'屏蔽 ' + tag} onClick={event => { event.stopPropagation(); void onBlock().catch((error: Error) => notify(error.message, 'error')); }}>屏蔽</button>
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
const status = (phase = 'ready', error?: string) => ({ available: true, canManage: true, packs: ['v45', 'v5'].map(id => ({ id, model: id === 'v5' ? 'nai-diffusion-5-full' : undefined, label: id, filename: id + '.tar', phase, progress: 25, count: 2, revision: id + '-one', error })) });
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  groupMocks.state = { revision: 0, groups: [], memberships: {} }; groupMocks.ready = true; groupMocks.error = '';
  vi.mocked(useCatalogGroups).mockImplementation(() => ({ state: groupMocks.state, ready: groupMocks.ready, busy: false, error: groupMocks.error, reload: vi.fn(), save: vi.fn() }));
  groupMocks.get.mockImplementation(async () => structuredClone(groupMocks.state));
  groupMocks.put.mockImplementation(async (_path, next) => { groupMocks.state = { ...structuredClone(next), revision: next.revision + 1 }; return structuredClone(groupMocks.state); });
  mocks.key = 'synthetic-key'; mocks.begin.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(true); mocks.states.clear(); mocks.generationListeners.clear(); mocks.generationRevision = 0; mocks.generatedSamples = [];
  mocks.collection = []; mocks.collectionListeners.clear(); mocks.historyListeners.clear();
  mocks.ensureCollection.mockResolvedValue(undefined);
  mocks.historySubscribe.mockImplementation((listener: (change: any) => void) => { mocks.historyListeners.add(listener); return () => { mocks.historyListeners.delete(listener); }; });
  mocks.blockLoad.mockResolvedValue([]); mocks.blockSave.mockImplementation(async tags => tags);
  mocks.status.mockResolvedValue(status());
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pack === 'v45' ? ['alpha_artist'] : ['alpha_artist', 'beta artist'] }));
  mocks.dictionary.mockResolvedValue(entries); mocks.data.mockResolvedValue({ templates: {}, samples: [] });
  mocks.usage.mockResolvedValue({ byTag: new Map([
    ['alpha artist', { chains: 4, images: 2, lastAt: 30 }], ['beta artist', { chains: 2, images: 7, lastAt: 20 }], ['missing artist', { chains: 0, images: 1, lastAt: 10 }],
  ]), indexed: 3, total: 3 });
  mocks.page.mockResolvedValue({ entries, page: 0, pageCount: 1, pageSize: 100, total: entries.length });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo); else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo; });
const publishGeneration = () => act(() => { mocks.generationRevision++; mocks.generationListeners.forEach(listener => listener()); });
const setup = () => { const notify = vi.fn(), navigate = vi.fn(); const view = render(<ArtistLibrary notify={notify} onNavigateToPlayground={navigate} />); return { ...view, notify, navigate }; };

it('加载状态：普通画师目录分页未完成不能显示不可用，真实失败仍可重试', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  let fail!: (error: Error) => void;
  mocks.page.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  setup();
  await waitFor(() => expect(mocks.page).toHaveBeenCalled());
  expect(screen.queryByText('画师目录不可用，请在全局设置更新 Tag 词库。')).toBeNull();
  expect(screen.queryByText('没有匹配的画师')).toBeNull();
  expect(screen.getByText('正在加载画师…')).toBeTruthy();
  await act(async () => fail(new Error('合成分页失败')));
  expect(await screen.findByText('画师目录不可用，请在全局设置更新 Tag 词库。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('button', { name: /选择画师：alpha[ _]artist/ })).toBeTruthy();
});

it('加载状态：已有画师卡片刷新期间及失败后保留，成功空目录显示真空态', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  setup();
  await screen.findByRole('button', { name: /选择画师：alpha[ _]artist/ });
  let fail!: (error: Error) => void;
  mocks.page.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'least' } });
  expect(screen.getByRole('button', { name: /选择画师：alpha[ _]artist/ })).toBeTruthy();
  await act(async () => fail(new Error('合成刷新失败')));
  expect(screen.getByRole('button', { name: /选择画师：alpha[ _]artist/ })).toBeTruthy();
  const error = screen.getByRole('alert');
  mocks.page.mockResolvedValueOnce({ entries: [], page: 0, pageCount: 0, pageSize: 100, total: 0 });
  fireEvent.click(within(error).getByRole('button', { name: '重试' }));
  expect(await screen.findByText('没有匹配的画师')).toBeTruthy();
  expect(screen.queryByText('画师目录不可用，请在全局设置更新 Tag 词库。')).toBeNull();
});

it('加载状态：使用筛选不能把样张刷新读取或失败遮成无匹配', async () => {
  setup(); await screen.findByText('收录 4 串 · 生成 2 张');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'unused' } });
  await screen.findByText('没有匹配的画师');
  let fail!: (error: Error) => void;
  mocks.status.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  act(() => window.dispatchEvent(new Event('nai-artist-samples-changed')));
  expect(screen.queryByText('没有匹配的画师')).toBeNull();
  await act(async () => fail(new Error('合成样张状态失败')));
  expect(screen.queryByText('没有匹配的画师')).toBeNull();
  expect(screen.getAllByText('合成样张状态失败').length).toBeGreaterThan(0);
});

const prepareGroups = (memberships: Record<string, string[]>) => {
  groupMocks.state = { revision: 1, groups: [{ id: 'g1', name: '合成组' }, { id: 'g2', name: '另一组' }], memberships };
  localStorage.setItem('nai_catalog_groups_artist', JSON.stringify({ expanded: true, active: '*' }));
};
const artistDragData = () => {
  const values = new Map<string, string>();
  return { types: [] as string[], effectAllowed: 'all', dropEffect: 'none', setData(type: string, value: string) { values.set(type, value); this.types = [...values.keys()]; }, getData: (type: string) => values.get(type) || '' };
};
it('拖动画师图片冒泡到真实卡片加入分组，保留旧归属且重复拖动不写入、不选中或生图', async () => {
  prepareGroups({ 'artist:alpha artist': ['g2'] }); vi.mocked(useCatalogGroups).mockImplementation(groupMocks.realHook!);
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  const { notify } = setup();
  const image = await screen.findByRole('img', { name: 'alpha artist' });
  const card = screen.getByRole('button', { name: '选择画师：alpha artist' });
  await waitFor(() => expect(card.draggable).toBe(true));
  const target = within(screen.getByRole('complementary', { name: '分组导航' })).getByRole('button', { name: '合成组' });
  const transfer = artistDragData();
  fireEvent.dragStart(image, { dataTransfer: transfer });
  expect(transfer.types).toHaveLength(1);
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(fireEvent.dragOver(target, { dataTransfer: transfer })).toBe(false);
  fireEvent.drop(target, { dataTransfer: transfer });
  await waitFor(() => expect(groupMocks.put).toHaveBeenCalledOnce());
  await waitFor(() => expect(notify).toHaveBeenCalledWith('分组已保存', 'success'));
  expect(groupMocks.state.memberships['artist:alpha artist']).toEqual(['g2', 'g1']);
  const repeat = artistDragData(); fireEvent.dragStart(image, { dataTransfer: repeat }); fireEvent.drop(target, { dataTransfer: repeat });
  await act(async () => {});
  expect(groupMocks.put).toHaveBeenCalledOnce();
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-preferred')).toBe('true');
  expect(mocks.blockSave).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(1);
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).draggable).toBe(true);
});
it('拖动已选画师跨筛选加入全部cart，仅修改已选身份且保留其他分组和对象', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  prepareGroups({ 'artist:alpha artist': ['g1'], 'artist:beta artist': ['g2'], 'artist:missing artist': ['g1'] }); vi.mocked(useCatalogGroups).mockImplementation(groupMocks.realHook!);
  setup(); await screen.findByTestId('cover-beta artist');
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.click(screen.getByRole('button', { name: '选择画师：beta artist' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  await waitFor(() => expect(screen.queryByTestId('cover-beta artist')).toBeNull());
  const card = await screen.findByRole('button', { name: '选择画师：alpha artist' });
  const target = within(screen.getByRole('complementary', { name: '分组导航' })).getByRole('button', { name: '另一组' });
  const transfer = artistDragData(); fireEvent.dragStart(card, { dataTransfer: transfer }); fireEvent.drop(target, { dataTransfer: transfer });
  await waitFor(() => expect(groupMocks.put).toHaveBeenCalledOnce());
  expect(groupMocks.state.memberships).toEqual({ 'artist:alpha artist': ['g1', 'g2'], 'artist:beta artist': ['g2'], 'artist:missing artist': ['g1'] });
  expect(card.getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '选择画师：beta artist' }).getAttribute('aria-pressed')).toBe('true'));
  expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.blockSave).not.toHaveBeenCalled();
});
it('分组在完整目录先筛再分页，首屏外成员及图包独有名均可见', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  const full = Array.from({ length: 240 }, (_, index) => ({ name: 'artist-' + index, chinese: '', postCount: 240 - index }));
  mocks.dictionary.mockResolvedValue(full);
  mocks.page.mockResolvedValue({ entries: full.slice(0, 100), page: 0, pageCount: 3, pageSize: 100, total: 240 });
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['pack only'] }));
  prepareGroups({ 'artist:artist-239': ['g1'], 'artist:pack only': ['g1'], 'artist:ghost': ['g1'] });
  setup(); await screen.findByTestId('cover-artist-0');
  const navigation = screen.getByRole('complementary', { name: '分组导航' });
  await waitFor(() => expect(within(navigation).getByRole('option', { name: '全部 (241)' })).toBeTruthy());
  expect(within(navigation).getByRole('option', { name: '合成组 (2)' })).toBeTruthy();
  expect(within(navigation).getByRole('option', { name: '未分组 (239)' })).toBeTruthy();
  expect(screen.queryByTestId('cover-artist-239')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  await screen.findByTestId('cover-artist-239');
  expect(screen.getByTestId('cover-pack only')).toBeTruthy();
  expect(sampleCards()).toHaveLength(2);
  expect(mocks.page).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pack' } });
  expect(sampleCards()).toHaveLength(1);
  expect(within(navigation).getByRole('option', { name: '合成组 (2)' })).toBeTruthy();
  expect(within(navigation).getByRole('option', { name: '全部 (241)' })).toBeTruthy();
});
it('分组数量区分目录尚未读取与真实空库，不把旧归属幽灵记录计入', async () => {
  prepareGroups({ 'artist:ghost': ['g1'] });
  mocks.status.mockResolvedValue(status('unconfigured'));
  mocks.page.mockResolvedValue({ entries: [], total: 0, page: 0, pageCount: 0, pageSize: 100 });
  let finish!: (value: typeof entries) => void;
  mocks.dictionary.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setup();
  expect(screen.getByRole('option', { name: '全部 (—)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '合成组 (—)' })).toBeTruthy();
  await act(async () => { finish([]); });
  await waitFor(() => expect(screen.getByRole('option', { name: '全部 (0)' })).toBeTruthy());
  expect(screen.getByRole('option', { name: '合成组 (0)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '未分组 (0)' })).toBeTruthy();
});
it.each(['dictionary', 'catalog'])('分组数量在%s读取失败时保持未知，不把局部目录当全库', async source => {
  prepareGroups({ 'artist:alpha artist': ['g1'] });
  if (source === 'dictionary') mocks.dictionary.mockRejectedValueOnce(new Error('合成词库读取失败'));
  else mocks.catalog.mockImplementation(async () => { throw new Error('合成图包读取失败'); });
  setup();
  await waitFor(() => expect(mocks.dictionary).toHaveBeenCalled());
  if (source === 'catalog') await waitFor(() => expect(mocks.catalog).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.getByRole('option', { name: '全部 (—)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '合成组 (—)' })).toBeTruthy();
});
it('收藏作为独立目录切换，真实分组与搜索、样张和使用统计继续取交集', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  prepareGroups({ 'artist:alpha artist': ['g1'], 'artist:missing artist': ['g1'], 'artist:alpha_artist': ['g2'] });
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }, { sourceType: 'artist', sourceId: 'beta artist' }];
  setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  expect(sampleCards()).toHaveLength(2);
  setArtistScope('preferred');
  expect(sampleCards()).toHaveLength(2);
  setArtistScope('all');
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  openArtistFilters();
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'unused' } });
  expect(screen.getByTestId('cover-missing artist')).toBeTruthy();
  expect(sampleCards()).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  expect(sampleCards()).toHaveLength(0);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '只看有样张' }));
  expect(sampleCards()).toHaveLength(0);
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'all' } });
  expect(sampleCards()).toHaveLength(1);
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
});
it.each([390, 1280])('画师范围在%s宽度使用相同入口与选项', async width => {
  vi.stubGlobal('innerWidth', width);
  setup(); await screen.findByTestId('cover-alpha artist');
  const scope = getArtistScope();
  expect(Array.from(scope.options, option => [option.value, option.textContent])).toEqual([
    ['all', '全部画师'], ['blocked', '已屏蔽'],
  ]);
  expect(screen.getByRole('option', { name: /^收藏/ })).toBeTruthy();
});
it('偏好和屏蔽范围按现有名单即时更新，并保留无样张的屏蔽画师', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  mocks.blockLoad.mockResolvedValue(['missing artist']);
  setup(); await screen.findByTestId('cover-missing artist');
  setArtistScope('preferred');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist']);
  setArtistScope('blocked');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：missing artist']);
  act(() => {
    mocks.collection = [{ sourceType: 'artist', sourceId: 'beta_artist' }];
    mocks.collectionListeners.forEach(listener => listener());
  });
  setArtistScope('preferred');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：beta artist']);
  act(() => window.dispatchEvent(new CustomEvent('nai-roll-blocklist-changed', { detail: ['beta artist'] })));
  setArtistScope('blocked');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：beta artist']);
});
it('偏好范围读取失败显示状态并可重试，不闪空列表', async () => {
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  let reject!: (error: Error) => void;
  mocks.ensureCollection.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  setArtistScope('preferred');
  expect(screen.getByText('正在读取画师状态…')).toBeTruthy();
  await act(async () => reject(new Error('合成偏好读取失败')));
  expect(screen.getByText('画师状态读取失败')).toBeTruthy();
  expect(screen.queryByText('没有匹配的画师')).toBeNull();
  expect(screen.queryByText('仅显示前 200 条结果，请缩小搜索范围')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(screen.getByTestId('cover-alpha artist')).toBeTruthy());
});
it('切换画师范围退出随机批次，且不改动独立的随机排除设置', async () => {
  localStorage.setItem('nai_artist_gacha_exclude_favorites', 'true');
  localStorage.setItem('nai_artist_gacha_exclude_blocked', 'true');
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  mocks.blockLoad.mockResolvedValue(['missing artist']);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['alpha_artist', 'beta artist', 'missing artist'] }));
  setup(); await screen.findByTestId('cover-alpha artist');
  await waitFor(() => expect((screen.getByRole('button', { name: '随机选画师' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '返回完整目录' })).toBeTruthy());
  setArtistScope('blocked');
  expect(screen.queryByRole('button', { name: '返回完整目录' })).toBeNull();
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：missing artist']);
  fireEvent.click(screen.getByRole('button', { name: '画师库设置' }));
  expect((screen.getByRole('checkbox', { name: '抽取时排除已偏好画师' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: '抽取时排除已屏蔽画师' }) as HTMLInputElement).checked).toBe(true);
});
it('分组资料加载或失败不冒充全库，禁止使用未知分组池随机', async () => {
  prepareGroups({ 'artist:alpha artist': ['g1'] });
  localStorage.setItem('nai_catalog_groups_artist', JSON.stringify({ active: 'g1', expanded: false }));
  groupMocks.ready = false;
  const view = setup();
  await screen.findByText('正在加载画师…');
  expect(sampleCards()).toHaveLength(0);
  expect((screen.getByRole('button', { name: '随机选画师' }) as HTMLButtonElement).disabled).toBe(true);
  groupMocks.error = '合成分组读取失败';
  view.rerender(<ArtistLibrary notify={view.notify} onNavigateToPlayground={view.navigate} />);
  expect(screen.getByRole('alert').textContent).toContain('合成分组读取失败');
  expect(sampleCards()).toHaveLength(0);
});
it('分组收展保留选择，随机只抽当前组样张，切组退出随机且跨版本归属不变', async () => {
  prepareGroups({ 'artist:alpha artist': ['g1'], 'artist:beta artist': ['g2'] });
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.click(screen.getByRole('button', { name: '选择画师：alpha artist' }));
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.queryByRole('complementary', { name: '分组导航' })).toBeNull();
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(1);
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g2' } });
  expect(screen.queryByRole('button', { name: '再选一批' })).toBeNull();
  expect(screen.getByTestId('cover-beta artist')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'g1' } });
  fireEvent.click(screen.getByRole('button', { name: 'V4.5' }));
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect(screen.queryByTestId('cover-beta artist')).toBeNull();
});

it.each([undefined, 'nai-diffusion-5-curated'])('V5 Full 不将模型来源%s的旧包当作Full目录', async model => {
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  const legacy = status(); legacy.packs[1].model = model; mocks.status.mockResolvedValue(legacy);
  setup(); await screen.findByText('当前图包未确认为 V5 Full，原文件已保留');
  expect(sampleCards()).toHaveLength(0); expect(mocks.catalog.mock.calls.some(call => call[0] === 'v5')).toBe(false);
  expect(screen.getByRole('button', { name: 'V5 Full' }).getAttribute('aria-pressed')).toBe('true');
});

it('V5 Full 状态与目录都须确认Full，自建Curated与缓存Curated不进入当前浏览且原资料保留', async () => {
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  const curated = { id: 'curated', tag: 'missing artist', pack: 'v5', imageUrl: '/curated.png', createdAt: 1, ...template, params: { ...template.params, model: 'nai-diffusion-5-curated' } };
  const full = { ...curated, id: 'full', tag: 'alpha artist', params: { ...template.params, model: 'nai-diffusion-5-full' } };
  const medium = { ...curated, id: 'medium', tag: 'beta artist', params: { ...template.params, model: 'nai-diffusion-5-full-medium' } };
  mocks.data.mockResolvedValue({ templates: {}, samples: [curated, full, medium] }); mocks.generatedSamples = [{ ...curated, id: 'cached-curated' }];
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-curated' : undefined, revision: pack + '-one', tags: ['missing artist'] }));
  setup(); await screen.findByTestId('cover-alpha artist');
  expect(screen.getByTestId('cover-alpha artist').getAttribute('data-own-ids')).toBe('full'); expect(screen.getByTestId('cover-beta artist').getAttribute('data-own-ids')).toBe('medium');
  expect(screen.queryByTestId('cover-missing artist')).toBeNull(); expect(sampleCards()).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(await screen.findByText('旧 Curated 样张已保留，不计入 Full 浏览')).toBeTruthy();
  expect(curated.params.model).toBe('nai-diffusion-5-curated'); expect(mocks.generatedSamples).toHaveLength(1);
});

it('V5 Full 已保存Curated模板在费用确认之前被拒绝，Agent也不误报启动', async () => {
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  const curated = { ...template, params: { ...template.params, model: 'nai-diffusion-5-curated' } };
  mocks.data.mockResolvedValue({ templates: { v5: curated }, samples: [] });
  const { notify, container } = setup(); await screen.findByTestId('cover-alpha artist');
  fireEvent.click(within(screen.getByTestId('cover-alpha artist')).getByRole('button', { name: '生成样张' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('画师样张仅支持 V5 Full', 'error'));
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled(); expect(curated.params.model).toBe('nai-diffusion-5-curated');
  await expect(executeAgentCommand(container, 'generate_artist_sample', { tag: 'alpha artist', pack: 'v5', agentPermissionMode: 'full' }, false)).rejects.toThrow('画师样张仅支持 V5 Full');
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('画师卡片触屏长按显露且不选中，普通点按选择，滑动和换版本收起辅助操作', async () => {
  setup(); const cover = await screen.findByTestId('cover-alpha artist');
  const card = screen.getByRole('button', { name: '选择画师：alpha artist' });
  longPress(cover);
  expect(card.getAttribute('data-press-revealed')).toBe('true'); expect(card.getAttribute('aria-pressed')).toBe('false');
  fireEvent.scroll(card); expect(card.getAttribute('data-press-revealed')).toBeNull();
  installPointerEvents(); vi.useFakeTimers();
  fireEvent.pointerDown(cover, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(100)); fireEvent.pointerUp(cover); fireEvent.click(cover, { detail: 1 });
  expect(card.getAttribute('aria-pressed')).toBe('true'); expect(card.getAttribute('data-press-revealed')).toBeNull();
  fireEvent.pointerDown(cover, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(cover, { pointerType: 'touch', clientX: 20, clientY: 35 });
  act(() => vi.advanceTimersByTime(450)); fireEvent.pointerUp(cover); fireEvent.click(cover, { detail: 1 });
  expect(card.getAttribute('aria-pressed')).toBe('true'); expect(card.getAttribute('data-press-revealed')).toBeNull();
  vi.useRealTimers(); longPress(cover); fireEvent.click(within(cover).getByRole('button', { name: '卡片 v5' }));
  expect(card.getAttribute('data-press-revealed')).toBeNull(); expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(mocks.begin).not.toHaveBeenCalled();
});

it.each([true, false])('补图模板沿用全局免费步数偏好：%s', async enforceFreeStepLimit => {
  render(<ArtistLibrary notify={vi.fn()} enforceFreeStepLimit={enforceFreeStepLimit} />);
  await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  fireEvent.click(within(await screen.findByTestId('cover-missing artist')).getByRole('button', { name: '补充样张' }));
  expect(screen.getByRole('dialog', { name: '补图生成设置' }).getAttribute('data-free-step-limit')).toBe(String(enforceFreeStepLimit));
  expect(mocks.begin).not.toHaveBeenCalled();
});

it.each(['usage-chains', 'usage-images'].flatMap(sort => [false, true].map(exclude => ({ sort, exclude }))))('统计排序$sort加载400位后随机只显示本次12位，排除=$exclude，再选仍为12位', async ({ sort, exclude }) => {
  const pool = Array.from({ length: 410 }, (_, i) => ({ name: `fourhundred${String(i).padStart(3, '0')}`, chinese: '', postCount: 1000 - i }));
  mocks.dictionary.mockResolvedValue(pool);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pool.map(entry => entry.name) }));
  mocks.usage.mockResolvedValue({ byTag: new Map([[pool[0].name, { chains: 999, images: 999, lastAt: 1 }]]), indexed: 1, total: 1 });
  localStorage.setItem('nai_artist_sort', sort); localStorage.setItem('nai_artist_gacha_count', '12'); localStorage.setItem('nai_artist_gacha_mode', 'uniform');
  if (exclude) {
    localStorage.setItem('nai_artist_gacha_exclude_favorites', 'true');
    mocks.collection = [{ sourceType: 'artist', sourceId: pool[0].name }];
  }
  setup(); await screen.findByText('收录 999 串 · 生成 999 张');
  disableSampleFilter();
  expect(sampleCards()).toHaveLength(100);
  for (let page = 0; page < 3; page++) fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(sampleCards()).toHaveLength(400);
  let random = 0; vi.spyOn(Math, 'random').mockImplementation(() => ((random++ % 410) + 0.1) / 410);
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  await waitFor(() => expect(screen.getByText('本次抽取 12 位')).toBeTruthy());
  expect(sampleCards()).toHaveLength(12);
  expect(screen.getByText('本次抽取 12 位')).toBeTruthy();
  const first = sampleCards().map(card => card.getAttribute('aria-label'));
  fireEvent.click(screen.getByRole('button', { name: '再选一批' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '再选一批' }) as HTMLButtonElement).disabled).toBe(false));
  expect(sampleCards()).toHaveLength(12);
  expect(screen.getByText('本次抽取 12 位')).toBeTruthy();
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).not.toEqual(first);
  if (exclude) expect(screen.queryByTestId('cover-' + pool[0].name)).toBeNull();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it.each(['mixed', 'uniform', 'popular'].flatMap(mode => [
  { favorites: false, blocked: false, excluded: [] },
  { favorites: true, blocked: false, excluded: [0] },
  { favorites: false, blocked: true, excluded: [0, 1] },
  { favorites: true, blocked: true, excluded: [0, 1] },
].map(options => ({ mode, ...options }))))('随机$mode按独立选项排除：偏好=$favorites / 屏蔽=$blocked，不足数量不补回', async ({ mode, favorites, blocked, excluded }) => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: entries.map(entry => entry.name) }));
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha_artist' }, { sourceType: 'artist', sourceId: 'missing artist', archived: true }, { sourceType: 'danbooru', sourceId: 'beta artist' }];
  mocks.blockLoad.mockResolvedValue(['alpha_artist', 'beta_artist']);
  localStorage.setItem('nai_artist_gacha_mode', mode);
  localStorage.setItem('nai_artist_gacha_exclude_favorites', String(favorites));
  localStorage.setItem('nai_artist_gacha_exclude_blocked', String(blocked));
  const draw = vi.spyOn(libraryRandom, 'drawLibraryIndices');
  setup(); await screen.findByTestId('cover-missing artist');
  const collectionReads = mocks.ensureCollection.mock.calls.length, blockReads = mocks.blockLoad.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  await waitFor(() => expect(screen.getByText(`本次抽取 ${3 - excluded.length} 位`)).toBeTruthy());
  expect(draw).toHaveBeenLastCalledWith(3, 12, mode, [], favorites || blocked ? new Set(excluded) : undefined);
  expect(sampleCards()).toHaveLength(3 - excluded.length);
  for (const index of excluded) expect(screen.queryByTestId('cover-' + entries[index].name)).toBeNull();
  expect(mocks.ensureCollection).toHaveBeenCalledTimes(collectionReads + Number(favorites));
  expect(mocks.blockLoad).toHaveBeenCalledTimes(blockReads + Number(blocked));
  expect(mocks.blockSave).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
});

it('排除选项默认关闭、独立保存并恢复，存储失败仍保留本次选择', async () => {
  const view = setup(); await screen.findByTestId('cover-alpha artist');
  const settings = () => fireEvent.click(screen.getByRole('button', { name: '画师库设置' }));
  settings();
  expect((screen.getByRole('checkbox', { name: '抽取时排除已偏好画师' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: '抽取时排除已屏蔽画师' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '抽取时排除已偏好画师' }));
  expect(localStorage.getItem('nai_artist_gacha_exclude_favorites')).toBe('true');
  expect(localStorage.getItem('nai_artist_gacha_exclude_blocked')).toBeNull();
  view.unmount(); setup(); await screen.findByTestId('cover-alpha artist'); settings();
  expect((screen.getByRole('checkbox', { name: '抽取时排除已偏好画师' }) as HTMLInputElement).checked).toBe(true);
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('合成存储不可用'); });
  fireEvent.click(screen.getByRole('checkbox', { name: '抽取时排除已屏蔽画师' }));
  expect((screen.getByRole('checkbox', { name: '抽取时排除已屏蔽画师' }) as HTMLInputElement).checked).toBe(true);
  set.mockRestore();
});

it.each(['favorites', 'blocked'])('排除%s等待最新名单，失败保留浏览条件并允许重试', async source => {
  localStorage.setItem('nai_artist_gacha_exclude_' + source, 'true');
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: entries.map(entry => entry.name) }));
  const { notify } = setup(); await screen.findByTestId('cover-beta artist');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  setArtistScope('preferred');
  let reject!: (error: Error) => void;
  const read = source === 'favorites' ? mocks.ensureCollection : mocks.blockLoad;
  read.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect((screen.getByRole('button', { name: '随机选画师' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('本次抽取 3 位')).toBeNull();
  await act(async () => reject(new Error('合成名单读取失败')));
  expect(notify).toHaveBeenCalledWith('合成名单读取失败', 'error');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  expect(screen.getByRole('combobox', { name: '选择分组' })).toHaveProperty('value', '#favorites');
  let resolve!: (value?: string[]) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  mocks.collection = [{ sourceType: 'artist', sourceId: 'beta_artist' }];
  await act(async () => resolve(source === 'blocked' ? ['beta_artist'] : undefined));
  expect(screen.getByText('本次抽取 1 位')).toBeTruthy();
  expect(screen.queryByTestId('cover-beta artist')).toBeNull();
  expect(screen.getByTestId('cover-alpha artist')).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it.each(['favorites', 'blocked'])('排除%s等待期间的名单更新优先于迟到旧响应', async source => {
  localStorage.setItem('nai_artist_gacha_exclude_' + source, 'true');
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: entries.map(entry => entry.name) }));
  setup(); await screen.findByTestId('cover-missing artist');
  let resolve!: (value?: string[]) => void;
  const read = source === 'favorites' ? mocks.ensureCollection : mocks.blockLoad;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  await act(async () => {
    if (source === 'favorites') {
      mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha_artist' }];
      mocks.collectionListeners.forEach(listener => listener());
    } else window.dispatchEvent(new CustomEvent('nai-roll-blocklist-changed', { detail: ['alpha_artist'] }));
    resolve(source === 'blocked' ? [] : undefined);
  });
  expect(screen.getByText('本次抽取 2 位')).toBeTruthy();
  expect(screen.queryByTestId('cover-alpha artist')).toBeNull();
  expect(screen.getByTestId('cover-beta artist')).toBeTruthy();
  expect(screen.getByTestId('cover-missing artist')).toBeTruthy();
});

it('改排除选项及偏好屏蔽状态保持当前批，全排除和读取失败均保留当前批', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: entries.map(entry => entry.name) }));
  const { notify } = setup(); await screen.findByTestId('cover-beta artist');
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  const first = sampleCards().map(card => card.getAttribute('aria-label'));
  fireEvent.click(screen.getByRole('button', { name: '画师库设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '抽取时排除已偏好画师' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '抽取时排除已屏蔽画师' })); fireEvent.keyDown(window, { key: 'Escape' });
  act(() => {
    mocks.collection = entries.map(entry => ({ sourceType: 'artist', sourceId: entry.name }));
    mocks.collectionListeners.forEach(listener => listener());
    window.dispatchEvent(new CustomEvent('nai-roll-blocklist-changed', { detail: ['alpha artist'] }));
  });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(first);
  mocks.blockLoad.mockResolvedValue(['alpha artist']);
  fireEvent.click(screen.getByRole('button', { name: '再选一批' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('排除后没有可抽取的画师，请调整抽取设置', 'error'));
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(first);
  mocks.blockLoad.mockRejectedValueOnce(new Error('合成屏蔽读取失败'));
  fireEvent.click(screen.getByRole('button', { name: '再选一批' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成屏蔽读取失败', 'error'));
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(first);
  mocks.collection = [{ sourceType: 'artist', sourceId: 'beta_artist' }];
  fireEvent.click(screen.getByRole('button', { name: '再选一批' }));
  await waitFor(() => expect(screen.getByText('本次抽取 1 位')).toBeTruthy());
  expect(screen.getByTestId('cover-missing artist')).toBeTruthy();
});

it('排除名单迟到时不覆盖切换版本后的目录', async () => {
  localStorage.setItem('nai_artist_gacha_exclude_favorites', 'true');
  setup(); await screen.findByTestId('cover-alpha artist');
  let resolve!: () => void;
  mocks.ensureCollection.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
  await screen.findByTestId('cover-beta artist');
  await act(async () => resolve());
  expect(screen.queryByRole('button', { name: '返回完整目录' })).toBeNull();
  expect(sampleCards()).toHaveLength(2);
  for (const cover of screen.getAllByTestId(/^cover-/)) expect(cover.getAttribute('data-pack')).toBe('v5');
});

it.each(['popular', 'least', 'name-asc', 'name-desc', 'usage-chains', 'usage-chains-asc', 'usage-images', 'usage-images-asc'].flatMap(sort => [true, false].map(onlySamples => ({ sort, onlySamples }))))('随机浏览固定本次集合：$sort / 只看样张=$onlySamples', async ({ sort, onlySamples }) => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ name: `random${i.toString().padStart(2, '0')}`, chinese: '', postCount: 100 - i }));
  const library = [...pool, { name: 'missing', chinese: '', postCount: 0 }];
  mocks.dictionary.mockResolvedValue(library);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pool.map(entry => entry.name) }));
  mocks.page.mockResolvedValue({ entries: library, page: 0, pageCount: 1, pageSize: 100, total: library.length });
  mocks.usage.mockResolvedValue({ byTag: new Map([[pool[0].name, { chains: 999, images: 999, lastAt: 1 }]]), indexed: 1, total: 1 });
  localStorage.setItem('nai_artist_sort', sort); localStorage.setItem('nai_artist_gacha_count', '6'); localStorage.setItem('nai_artist_gacha_mode', 'uniform');
  setup(); await screen.findByText('收录 999 串 · 生成 999 张');
  if (!onlySamples) disableSampleFilter();
  let random = 0; vi.spyOn(Math, 'random').mockImplementation(() => ((random++ % 30) + 0.1) / 30);
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(6);
  const first = sampleCards().map(card => card.getAttribute('aria-label'));
  fireEvent.click(screen.getByRole('button', { name: '再选一批' }));
  expect(sampleCards()).toHaveLength(6);
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).not.toEqual(first);
  expect(screen.queryByTestId('cover-missing')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回完整目录' }));
  expect(sampleCards()).toHaveLength(onlySamples ? 30 : 31);
  expect(mocks.begin).not.toHaveBeenCalled();
});

it.each([6, 12, 24])('随机抽取%s位会清除残留收录生成筛选，保留抽取数量和样张版本', async count => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ name: `pick${i}`, chinese: '', postCount: 100 - i }));
  mocks.dictionary.mockResolvedValue(pool); mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pool.map(entry => entry.name) }));
  mocks.usage.mockResolvedValue({ byTag: new Map([[pool[0].name, { chains: 999, images: 999, lastAt: 1 }]]), indexed: 1, total: 1 });
  localStorage.setItem('nai_artist_gacha_count', String(count)); localStorage.setItem('nai_artist_sample_pack', 'v5');
  setup(); await screen.findByText('收录 999 串 · 生成 999 张');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(count);
  for (const cover of screen.getAllByTestId(/^cover-/)) expect(cover.getAttribute('data-pack')).toBe('v5');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('combobox', { name: '图片生成' }) as HTMLSelectElement).value).toBe('all');
  expect(localStorage.getItem('nai_artist_gacha_count')).toBe(String(count));
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('向助手登记读取与生成画师样张的命令', async () => {
  const { container } = setup();
  const names = getAgentCommands(container).map(command => command.name);
  expect(names).toEqual(expect.arrayContaining(['get_artist_sample_status', 'generate_artist_sample']));
  const status = await executeAgentCommand(container, 'get_artist_sample_status', { tag: 'alpha artist' }, true) as { phase: string };
  expect(status.phase).toBe('idle');
});

it('助手生成画师样张复用页面费用确认与生成链路', async () => {
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  const result = await executeAgentCommand(container, 'generate_artist_sample', { tag: 'alpha artist', pack: 'v45' }, false) as { started: boolean };
  expect(result.started).toBe(true);
  await waitFor(() => expect(mocks.begin).toHaveBeenCalled());
});

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
  fireEvent.click(within(screen.getByRole('dialog', { name: '重试保存样张' })).getByRole('button', { name: '重试保存样张' }));
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
const getArtistScope = () => {
  if (!screen.queryByRole('combobox', { name: '画师范围' })) fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  return screen.getByRole('combobox', { name: '画师范围' }) as HTMLSelectElement;
};
const setArtistScope = (value: 'all' | 'preferred' | 'blocked') => {
  const scope = getArtistScope();
  fireEvent.change(scope, { target: { value: value === 'preferred' ? 'all' : value } });
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: value === 'preferred' ? '#favorites' : '*' } });
};

it('收藏目录按现有画师去重计数，保留本端选择并即时响应收藏归档', async () => {
  mocks.collection = [
    { sourceType: 'artist', sourceId: 'alpha artist', imageUrl: '/synthetic/old-cover.png' },
    { sourceType: 'artist', sourceId: 'alpha artist', imageUrl: '/synthetic/another.png' },
    { sourceType: 'artist', sourceId: 'beta artist', archived: true },
    { sourceType: 'artist', sourceId: 'deleted artist' },
  ];
  localStorage.setItem('nai_catalog_groups_artist', JSON.stringify({ active: '#favorites', expanded: true }));
  const view = setup();
  await screen.findByRole('option', { name: '收藏 (1)' });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist']);
  const options = Array.from(screen.getByRole('combobox', { name: '选择分组' }).querySelectorAll('option'));
  expect(options.slice(0, 3).map(option => option.value)).toEqual(['*', '', '#favorites']);
  expect(screen.queryByRole('button', { name: '重命名分组' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-match' } });
  expect(screen.getByRole('option', { name: '收藏 (1)' })).toBeTruthy();
  act(() => { mocks.collection = []; mocks.collectionListeners.forEach(listener => listener()); });
  expect(screen.getByRole('option', { name: '收藏 (0)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: '*' } });
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: '#favorites' } });
  view.unmount();
  mocks.collection = [{ sourceType: 'artist', sourceId: 'beta artist' }];
  setup();
  await screen.findByRole('option', { name: '收藏 (1)' });
  expect(screen.getByRole('combobox', { name: '选择分组' })).toHaveProperty('value', '#favorites');
});

it('收藏目录叠加屏蔽范围时，名单读取失败仍显示错误而不是空结果', async () => {
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }];
  mocks.blockLoad.mockRejectedValueOnce(Error('合成屏蔽名单失败'));
  setup(); await screen.findByTestId('cover-alpha artist');
  setArtistScope('blocked');
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: '#favorites' } });
  expect(screen.getByText('画师状态读取失败')).toBeTruthy();
  expect(screen.queryByText('没有匹配的画师')).toBeNull();
  mocks.blockLoad.mockResolvedValueOnce(['alpha artist']);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByTestId('cover-alpha artist');
  expect(sampleCards()).toHaveLength(1);
});
const openArtistFilters = () => { const button = screen.getByRole('button', { name: /^筛选/ }); if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button); };
const disableSampleFilter = () => { fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.click(screen.getByRole('checkbox', { name: '只看有样张' })); fireEvent.keyDown(window, { key: 'Escape' }); };
const switchCard = (tag: string, pack: 'v45' | 'v5') => fireEvent.click(within(screen.getByTestId('cover-' + tag)).getByRole('button', { name: '卡片 ' + pack }));

it('完整目录分页保留全部词库画师并追加两包独有名称，切模型和批量取用不丢条目', async () => {
  const dictionary = Array.from({ length: 102 }, (_, index) => ({ name: `dictionary${String(index).padStart(3, '0')}`, chinese: '', postCount: 200 - index }));
  mocks.dictionary.mockResolvedValue(dictionary);
  mocks.page.mockImplementation(async (page: number) => ({ entries: dictionary.slice(page * 100, (page + 1) * 100), page, pageCount: 2, pageSize: 100, total: dictionary.length }));
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: [pack + '_exclusive'] }));
  setup(); await screen.findByTestId('cover-v45_exclusive'); disableSampleFilter();
  expect(sampleCards()).toHaveLength(100);
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  await waitFor(() => expect(sampleCards()).toHaveLength(102));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(sampleCards()).toHaveLength(104); expect(screen.getByText('共 104 位')).toBeTruthy();
  expect(sampleCards().map(card => card.getAttribute('aria-label')).filter(name => name?.includes('dictionary'))).toHaveLength(102);
  fireEvent.click(screen.getByRole('button', { name: '选择画师：v45_exclusive' }));
  fireEvent.click(screen.getByRole('button', { name: '选择画师：v5_exclusive' }));
  switchCard('v5_exclusive', 'v5');
  expect(screen.getByTestId('cover-v5_exclusive').getAttribute('data-packed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
  expect(sampleCards()).toHaveLength(104);
  expect(screen.getByRole('button', { name: '选择画师：v45_exclusive' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('cover-v45_exclusive').getAttribute('data-packed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY) || '{}').prompt).toBe('artist:v45_exclusive, artist:v5_exclusive');
  expect(mocks.dictionary).toHaveBeenCalledOnce();
  expect(mocks.page.mock.calls.map(call => call[0])).toEqual([0, 1]);
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('图包独有画师可在全部目录搜索、收藏和使用统计交集筛选，未知作品数不显示0', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['pack_only'] }));
  mocks.collection = [{ sourceType: 'artist', sourceId: 'pack only' }];
  mocks.usage.mockResolvedValue({ byTag: new Map([['pack only', { chains: 8, images: 0, lastAt: 1 }]]), indexed: 1, total: 1 });
  setup(); await screen.findByText('收录 8 串 · 生成 0 张');
  const cover = screen.getByTestId('cover-pack_only');
  expect(cover.getAttribute('data-preferred')).toBe('true');
  expect(within(screen.getByRole('button', { name: '选择画师：pack_only' })).queryByText('作品 0')).toBeNull();
  disableSampleFilter();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pack only' } });
  await screen.findByText('匹配 1 位');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：pack_only']);
  setArtistScope('preferred');
  openArtistFilters();
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains' } });
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：pack_only']);
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('归一化冲突时保留图包原名，pack图片与精确自建图都不会串给相似词库名称', async () => {
  const dictionary = [{ name: 'same_name', chinese: '', postCount: 2 }, { name: 'same name', chinese: '', postCount: 1 }];
  mocks.dictionary.mockResolvedValue(dictionary); mocks.page.mockResolvedValue({ entries: dictionary, page: 0, pageCount: 1, pageSize: 100, total: 2 });
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['SAME NAME'] }));
  mocks.data.mockResolvedValue({ templates: {}, samples: dictionary.map((entry, index) => ({ ...template, tag: entry.name, id: `own${index}`, pack: 'v45', imageUrl: `/own${index}`, createdAt: index })) });
  setup(); await screen.findByTestId('cover-SAME NAME');
  for (let index = 0; index < 2; index++) {
    const cover = screen.getByTestId('cover-' + dictionary[index].name);
    expect(cover.getAttribute('data-packed')).toBe('false'); expect(cover.getAttribute('data-own-ids')).toBe(`own${index}`);
  }
  expect(screen.getByTestId('cover-SAME NAME').getAttribute('data-pack-tag')).toBe('SAME NAME');
  expect(screen.getByTestId('cover-SAME NAME').getAttribute('data-own')).toBe('0');
  expect(sampleCards()).toHaveLength(3);
});

it('图包独有画师参与有图随机池，统计排序后仍只显示固定抽中集合', async () => {
  const dictionary = Array.from({ length: 5 }, (_, index) => ({ name: `known${index}`, chinese: '', postCount: 10 - index }));
  mocks.dictionary.mockResolvedValue([...dictionary, ...entries]);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: [...dictionary.map(entry => entry.name), 'pack_random'] }));
  localStorage.setItem('nai_artist_sort', 'usage-images'); localStorage.setItem('nai_artist_gacha_count', '6');
  setup(); await screen.findByTestId('cover-pack_random'); disableSampleFilter();
  expect(sampleCards()).toHaveLength(9);
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(6); expect(screen.getByText('本次抽取 6 位')).toBeTruthy();
  expect(screen.getByTestId('cover-pack_random').getAttribute('data-packed')).toBe('true');
  expect(screen.queryByTestId('cover-missing artist')).toBeNull();
  act(() => mocks.historyListeners.forEach(listener => listener({ type: 'update' })));
  await waitFor(() => expect(sampleCards()).toHaveLength(6));
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('移除最后一张样张后图包独有画师仍在完整目录，仅退出有图池', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['removed_pack_artist'] }));
  mocks.data.mockResolvedValue({ templates: {}, samples: [], removedSamples: [{ source: 'pack', pack: 'v45', tag: 'removed_pack_artist', revision: 'v45-one', index: 0, imageCount: 1 }] });
  setup(); await screen.findByText('没有匹配的画师样张');
  disableSampleFilter();
  expect(screen.getByTestId('cover-removed_pack_artist').getAttribute('data-packed')).toBe('false');
  expect(sampleCards()).toHaveLength(4); expect(mocks.begin).not.toHaveBeenCalled();
});

it.each([390, 1280])('宽度%s下单卡切到缺图版本保留卡片、选择和搜索，顶部切换清单卡覆盖', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pack === 'v45' ? ['alpha artist', 'beta artist'] : ['beta artist'] }));
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
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并生成样张' }));
  await waitFor(() => expect(mocks.begin).toHaveBeenLastCalledWith('missing artist', 'v5', expect.objectContaining({ params: expect.objectContaining({ model: 'nai-diffusion-5-full' }) }), 'synthetic-key', 3, true, false, expect.any(Function)));
  expect(navigate).not.toHaveBeenCalled();
});

it('另一版本目录等待期间切卡不伪造图片，迟到旧读取不能覆盖新revision', async () => {
  let resolveOld!: (value: any) => void;
  mocks.catalog.mockImplementation((pack: string) => pack === 'v5' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: 'v45-one', tags: ['alpha artist'] }));
  setup(); const cover = await screen.findByTestId('cover-alpha artist');
  switchCard('alpha artist', 'v5');
  expect(cover.getAttribute('data-packed')).toBe('false');
  expect(within(cover).getByText('正在读取样张…')).toBeTruthy();
  expect(within(cover).queryByRole('img')).toBeNull();
  const nextStatus = status(); nextStatus.packs[1].revision = 'v5-two';
  mocks.status.mockResolvedValue(nextStatus);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack === 'v5' ? 'v5-two' : 'v45-one', tags: ['alpha artist'] }));
  fireEvent(window, new Event(ARTIST_SAMPLES_CHANGED));
  await waitFor(() => expect(cover.getAttribute('data-revision')).toBe('v5-two'));
  await act(async () => resolveOld({ pack: 'v5', model: 'nai-diffusion-5-full', revision: 'v5-one', tags: ['beta artist'] }));
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
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['alpha artist'] }));
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
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pack === 'v45' ? ['alpha artist', 'beta artist'] : ['alpha artist'] }));
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
  setArtistScope('preferred');
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

it.each([390, 1280])('宽度 %s 当前包图包独有画师也显示样张，model segmented常驻且未知热度不造作品0', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pack === 'v45' ? ['alpha_artist', 'unknown archive key'] : ['alpha_artist', 'beta artist'] }));
  const { container } = setup();
  await screen.findByTestId('cover-alpha artist');
  expect(sampleCards()).toHaveLength(2);
  const extra = screen.getByRole('button', { name: '选择画师：unknown archive key' });
  expect(screen.getByTestId('cover-unknown archive key').getAttribute('data-packed')).toBe('true');
  expect(within(extra).queryByText('作品 0')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
  await waitFor(() => expect(screen.getByTestId('cover-alpha artist').getAttribute('data-pack')).toBe('v5'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('alpha');
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.focus).toHaveBeenLastCalledWith('alpha artist'); expect(localStorage.getItem('nai_artist_sample_pack')).toBe('v5');
  unmount(); setup(); expect(screen.getByRole('button', { name: 'V5 Full' }).getAttribute('aria-pressed')).toBe('true');
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
  fireEvent.click(screen.getByRole('button', { name: 'V5 Full' }));
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
  mocks.dictionary.mockResolvedValue(full); mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: 'many', tags: full.map(entry => entry.name) }));
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
it('偏好范围先筛完整画师目录，首批100项之后的偏好仍可直接找到', async () => {
  const full = Array.from({ length: 120 }, (_, index) => ({ name: 'paged artist ' + index, chinese: '', postCount: 120 - index }));
  mocks.dictionary.mockResolvedValue(full);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: 'paged', tags: full.map(entry => entry.name) }));
  mocks.collection = [{ sourceType: 'artist', sourceId: full[109].name }];
  setup(); await waitFor(() => expect(sampleCards()).toHaveLength(100));
  expect(screen.queryByTestId('cover-' + full[109].name)).toBeNull();
  setArtistScope('preferred');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：' + full[109].name]);
  expect(screen.getByTestId('cover-' + full[109].name)).toBeTruthy();
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
    expect((within(settings).getByRole('checkbox', { name: '抽取时排除已偏好画师' }) as HTMLInputElement).checked).toBe(false);
    expect((within(settings).getByRole('checkbox', { name: '抽取时排除已屏蔽画师' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(settings).getByRole('button', { name: (version === 'V5' ? 'V5 Full' : version) + ' 补图生成设置' }));
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
  fireEvent.click(within(panel).getByRole('button', { name: 'V5 Full 补图生成设置' }));
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

it('逗号OR搜索统一匹配当前版本有图池、图包独有名、收藏及统计筛选', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['alpha_artist', 'beta artist', 'pack_or'] }));
  mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha artist' }, { sourceType: 'artist', sourceId: 'pack_or' }];
  mocks.usage.mockResolvedValue({ byTag: new Map([['alpha artist', { chains: 1, images: 0, lastAt: 1 }], ['pack or', { chains: 2, images: 0, lastAt: 1 }]]), indexed: 2, total: 2 });
  render(<ArtistLibrary notify={vi.fn()} initialSearch={{ query: 'alpha_artist，画师乙, pack_or, alpha artist, ,unknown', token: 1 }} />);
  await screen.findByTestId('cover-pack_or');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist', '选择画师：beta artist', '选择画师：pack_or']);
  setArtistScope('preferred');
  openArtistFilters();
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist', '选择画师：pack_or']);
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains' } });
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：pack_or', '选择画师：alpha artist']);
  expect(screen.getByText('匹配 2 位')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '只看有样张' }));
  expect(sampleCards()).toHaveLength(2);
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('逗号OR全词库搜索支持英文和中文中间子串，重复命中去重且未知词不阻断图包独有结果', async () => {
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: ['alpha artist', 'pack_or'] }));
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  mocks.dictionary.mockResolvedValue([...entries, entries[0]]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' pha，师乙, pha, unknown,pack_or, , ' } });
  await waitFor(() => expect(screen.getByText('匹配 3 位')).toBeTruthy());
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist', '选择画师：beta artist', '选择画师：pack_or']);
  expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('搜索画师，多个词用逗号分隔');
});

it('样张状态不可用时完整词库缓存仍能独立搜索英文和中文中间子串', async () => {
  localStorage.setItem('nai_artist_only_samples', 'false');
  mocks.status.mockRejectedValue(new Error('本地图包仅支持电脑端及局域网访问'));
  setup(); await screen.findByTestId('cover-missing artist');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pha，师乙,pha' } });
  await screen.findByText('匹配 2 位');
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist', '选择画师：beta artist']);
  expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
});

it('逗号OR搜索忽略迟到的旧整组响应，只有逗号空项时回普通目录并恢复计数和加载入口', async () => {
  let resolveOld!: (result: typeof entries) => void;
  mocks.page.mockResolvedValue({ entries: entries.slice(0, 2), page: 0, pageCount: 2, pageSize: 2, total: 3 });
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  mocks.dictionary.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha,beta' } });
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  await waitFor(() => expect(screen.getByText('匹配 1 位')).toBeTruthy());
  expect(screen.getByTestId('cover-missing artist')).toBeTruthy();
  await act(async () => { resolveOld(entries); });
  expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：missing artist']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' ， ,   ,，' } });
  await waitFor(() => expect(screen.getByText('已加载 2 位')).toBeTruthy());
  expect(sampleCards()).toHaveLength(2); expect(screen.getByRole('button', { name: '继续向下滚动加载更多' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull();
});

it('自动连续加载：逗号OR结果去重排序后遍历全部250位', async () => {
  const pool = Array.from({ length: 250 }, (_, index) => ({ name: `multi artist ${String(index).padStart(3, '0')}`, chinese: '', postCount: index + 1 }));
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  mocks.dictionary.mockResolvedValue([...pool, ...pool.slice(100, 150)]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'multi，artist,multi,unknown' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(100));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(sampleCards()).toHaveLength(200);
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(sampleCards()).toHaveLength(250);
  expect(new Set(sampleCards().map(card => card.getAttribute('aria-label'))).size).toBe(250);
  expect(sampleCards()[0].getAttribute('aria-label')).toBe('选择画师：multi artist 249');
  expect(sampleCards()[249].getAttribute('aria-label')).toBe('选择画师：multi artist 000');
});

it('逗号空项在有图池按普通目录分页，清空和随机后不会残留搜索语义', async () => {
  const pool = Array.from({ length: 150 }, (_, index) => ({ name: `comma artist ${index}`, chinese: '', postCount: 1 }));
  mocks.dictionary.mockResolvedValue(pool);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: pool.map(entry => entry.name) }));
  setup(); await waitFor(() => expect(sampleCards()).toHaveLength(100));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ',， , ' } });
  expect(screen.getByText('已加载 100 位')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  expect(sampleCards()).toHaveLength(150); expect(screen.getByText('共 150 位')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not found,artist 149' } });
  expect(sampleCards()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '随机选画师' }));
  expect(sampleCards()).toHaveLength(12); expect(screen.getByText('本次抽取 12 位')).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
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
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  mocks.dictionary.mockRejectedValueOnce(new Error('合成搜索失败'));
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

it('自动连续加载：搜索超过200位仍可触底到真实末尾', async () => {
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); } disconnect() {} });
  setup(); await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  mocks.dictionary.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ name: 'bulk artist ' + index, chinese: '', postCount: 1 })));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bulk' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(201));
  expect(screen.queryByRole('button', { name: '继续向下滚动加载更多' })).toBeNull();
});

it('当前样张包未配置时默认展示完整目录，用户关闭样张筛选后记住选择', async () => {
  mocks.status.mockResolvedValue({ available: true, canManage: true, packs: ['v45', 'v5'].map(id => ({ id, model: id === 'v5' ? 'nai-diffusion-5-full' : undefined, label: id, filename: id + '.tar', phase: 'unconfigured', progress: 0, count: 0, revision: '' })) });
  setup();
  await screen.findByTestId('cover-missing artist');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  const checkbox = screen.getByRole('checkbox', { name: '只看有样张' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(localStorage.getItem('nai_artist_only_samples')).toBe('true');
});

it('画师库与 Roll 共用屏蔽名单，失败保持原状，屏蔽后不隐藏卡片或改变选择', async () => {
  mocks.blockLoad.mockResolvedValue(['beta_artist']);
  const { notify } = setup(); const cover = await screen.findByTestId('cover-alpha artist');
  mocks.blockSave.mockRejectedValueOnce(new Error('合成屏蔽失败'));
  fireEvent.click(screen.getByRole('button', { name: '屏蔽 alpha artist' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成屏蔽失败', 'error'));
  expect(cover.getAttribute('data-blocked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '屏蔽 alpha artist' }));
  await waitFor(() => expect(cover.getAttribute('data-blocked')).toBe('true'));
  expect(mocks.blockSave).toHaveBeenLastCalledWith(['beta_artist', 'alpha artist']);
  expect(screen.getByRole('button', { name: '选择画师：alpha artist' }).getAttribute('aria-pressed')).toBe('false');
  act(() => window.dispatchEvent(new CustomEvent('nai-roll-blocklist-changed', { detail: [] })));
  expect(cover.getAttribute('data-blocked')).toBe('false');
});

it('无论选择0/1/多位画师都不显示样张操作入口，单卡版本、偏好与选择仍独立', async () => {
  setup(); const alphaCover = await screen.findByTestId('cover-alpha artist'); disableSampleFilter();
  const alpha = screen.getByRole('button', { name: '选择画师：alpha artist' });
  const beta = screen.getByRole('button', { name: '选择画师：beta artist' });
  expect(screen.queryByRole('button', { name: '样张操作' })).toBeNull();
  expect(alpha.getAttribute('aria-pressed')).toBe('false'); expect(beta.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(alpha);
  expect(alpha.getAttribute('aria-pressed')).toBe('true');
  switchCard('alpha artist', 'v5');
  expect(alphaCover.getAttribute('data-pack')).toBe('v5'); expect(alpha.getAttribute('aria-pressed')).toBe('true');
  act(() => { mocks.collection = [{ sourceType: 'artist', sourceId: 'alpha_artist' }]; mocks.collectionListeners.forEach(listener => listener()); });
  expect(alphaCover.getAttribute('data-preferred')).toBe('true');
  fireEvent.click(beta);
  expect(alpha.getAttribute('aria-pressed')).toBe('true'); expect(beta.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(alpha);
  expect(alpha.getAttribute('aria-pressed')).toBe('false'); expect(beta.getAttribute('aria-pressed')).toBe('true');
  expect(alphaCover.getAttribute('data-preferred')).toBe('true');
  expect(screen.queryByRole('button', { name: '样张操作' })).toBeNull();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('画师卡片显示留存风格串与图片统计，缺图 Tag 也有统计行', async () => {
  setup();
  await screen.findByText('收录 4 串 · 生成 2 张');
  disableSampleFilter();
  const card = await screen.findByRole('button', { name: '选择画师：missing artist' });
  expect(within(card).getByText('收录 0 串 · 生成 1 张')).toBeTruthy();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('统计排序基于全量词库而不是当前已加载的目录页', async () => {
  mocks.page.mockResolvedValue({ entries: entries.slice(0, 1), page: 0, pageCount: 3, pageSize: 1, total: 3 });
  setup();
  await screen.findByText('收录 4 串 · 生成 2 张');
  disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  const select = screen.getByRole('combobox', { name: '画师排序' });
  expect((screen.getByRole('option', { name: '生成图片数从高到低' }) as HTMLOptionElement).disabled).toBe(false);
  fireEvent.change(select, { target: { value: 'usage-images' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：beta artist', '选择画师：alpha artist', '选择画师：missing artist',
  ]));
  fireEvent.change(select, { target: { value: 'usage-chains' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：alpha artist', '选择画师：beta artist', '选择画师：missing artist',
  ]));
  fireEvent.change(select, { target: { value: 'usage-images-asc' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：missing artist', '选择画师：alpha artist', '选择画师：beta artist',
  ]));
  fireEvent.change(select, { target: { value: 'usage-chains-asc' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：missing artist', '选择画师：beta artist', '选择画师：alpha artist',
  ]));
  expect(mocks.page).toHaveBeenCalledTimes(1);
});

it('使用统计筛选先筛完整目录，支持零值交集并保留搜索与收藏条件', async () => {
  const allEntries = [
    ...entries,
    { name: 'unused artist', chinese: '未收录画师', postCount: 1 },
  ];
  mocks.dictionary.mockResolvedValue(allEntries);
  mocks.page.mockResolvedValue({ entries: allEntries.slice(0, 1), page: 0, pageCount: 4, pageSize: 1, total: allEntries.length });
  mocks.usage.mockResolvedValue({ byTag: new Map([
    ['alpha artist', { chains: 4, images: 2, lastAt: 30 }],
    ['beta artist', { chains: 2, images: 7, lastAt: 20 }],
    ['missing artist', { chains: 0, images: 0, lastAt: 10 }],
  ]), indexed: 4, total: 4 });
  setup(); await screen.findByText('收录 4 串 · 生成 2 张'); disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  const chains = screen.getByRole('combobox', { name: '风格串收录' });
  const images = screen.getByRole('combobox', { name: '图片生成' });
  expect((screen.getByRole('option', { name: '收录串数从低到高' }) as HTMLOptionElement).disabled).toBe(false);
  fireEvent.change(chains, { target: { value: 'unused' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：missing artist', '选择画师：unused artist',
  ]));
  fireEvent.change(images, { target: { value: 'unused' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：missing artist', '选择画师：unused artist']));
  fireEvent.change(images, { target: { value: 'used' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([]));
  expect(screen.getByText('没有匹配的画师')).toBeTruthy();
  fireEvent.change(chains, { target: { value: 'all' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual([
    '选择画师：alpha artist', '选择画师：beta artist',
  ]));
  fireEvent.change(images, { target: { value: 'all' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist']));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  act(() => { mocks.collection = [{ sourceType: 'artist', sourceId: 'beta_artist' }]; mocks.collectionListeners.forEach(listener => listener()); });
  setArtistScope('preferred');
  openArtistFilters();
  fireEvent.change(chains, { target: { value: 'used' } });
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：beta artist']));
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  await waitFor(() => expect(sampleCards()).toHaveLength(0));
  expect(screen.getByRole('combobox', { name: '选择分组' })).toHaveProperty('value', '#favorites');
  setArtistScope('all');
  await waitFor(() => expect(sampleCards().map(card => card.getAttribute('aria-label'))).toEqual(['选择画师：alpha artist']));
  expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('combobox', { name: '图片生成' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('统计筛选后的样张计数使用匹配数，不沿用未筛选样张池的分页状态', async () => {
  const allEntries = Array.from({ length: 150 }, (_, index) => ({ name: `sample artist ${index}`, chinese: '', postCount: 1 }));
  mocks.dictionary.mockResolvedValue(allEntries);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: allEntries.map(entry => entry.name) }));
  mocks.page.mockResolvedValue({ entries: allEntries.slice(0, 100), page: 0, pageCount: 2, pageSize: 100, total: allEntries.length });
  mocks.usage.mockResolvedValue({ byTag: new Map([
    ['sample artist 0', { chains: 1, images: 0, lastAt: 2 }],
    ['sample artist 1', { chains: 2, images: 0, lastAt: 1 }],
  ]), indexed: 150, total: 150 });
  setup(); await screen.findByRole('button', { name: '选择画师：sample artist 0' });
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(2));
  expect(screen.getByText('匹配 2 位')).toBeTruthy();
  expect(screen.queryByText('已加载 2 位')).toBeNull();
});

it('统计筛选切换重置首批分页上限', async () => {
  const allEntries = Array.from({ length: 500 }, (_, index) => ({ name: `paged artist ${index}`, chinese: '', postCount: 1 }));
  mocks.dictionary.mockResolvedValue(allEntries);
  mocks.catalog.mockImplementation(async (pack: string) => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack + '-one', tags: allEntries.map(entry => entry.name) }));
  mocks.usage.mockResolvedValue({ byTag: new Map(allEntries.slice(0, 250).map((entry, index) => [entry.name, { chains: 1, images: 0, lastAt: index }])), indexed: 500, total: 500 });
  setup(); await screen.findByRole('button', { name: '选择画师：paged artist 0' });
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(false));
  const chains = screen.getByRole('combobox', { name: '风格串收录' });
  fireEvent.change(chains, { target: { value: 'used' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(100));
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  await waitFor(() => expect(sampleCards()).toHaveLength(200));
  fireEvent.change(chains, { target: { value: 'unused' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(100));
  expect(screen.getByText('已加载中匹配 100 位')).toBeTruthy();
});

it('统计读取失败保持未知并可重试；重新进入时重新读取，不触发生成', async () => {
  mocks.usage.mockRejectedValueOnce(new Error('合成统计读取失败'));
  setup();
  const card = await screen.findByRole('button', { name: '选择画师：alpha artist' });
  expect(within(card).getByText('收录 — 串 · 生成 — 张')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.click(await screen.findByRole('button', { name: '重试统计' }));
  await screen.findByText('收录 4 串 · 生成 2 张');
  expect(mocks.usage).toHaveBeenCalledTimes(2);
});

it('页面重新进入时重新读取统计，废弃请求不会覆盖新结果或触发生成', async () => {
  let finishOld!: (value: { byTag: Map<string, { chains: number; images: number; lastAt: number }>; indexed: number; total: number }) => void;
  mocks.usage.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([['alpha artist', { chains: 9, images: 8, lastAt: 40 }]]), indexed: 3, total: 3 });
  const view = render(<ImageActivityContext.Provider value><ArtistLibrary notify={vi.fn()} /></ImageActivityContext.Provider>);
  await waitFor(() => expect(mocks.usage).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect((screen.getByRole('option', { name: '生成图片数从高到低' }) as HTMLOptionElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '图片生成' }) as HTMLSelectElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  const oldSignal = mocks.usage.mock.calls[0][0] as AbortSignal;
  view.rerender(<ImageActivityContext.Provider value={false}><ArtistLibrary notify={vi.fn()} /></ImageActivityContext.Provider>);
  expect(oldSignal.aborted).toBe(true);
  view.rerender(<ImageActivityContext.Provider value><ArtistLibrary notify={vi.fn()} /></ImageActivityContext.Provider>);
  await screen.findByText('收录 9 串 · 生成 8 张');
  await act(async () => finishOld({ byTag: new Map([['alpha artist', { chains: 1, images: 1, lastAt: 1 }]]), indexed: 3, total: 3 }));
  expect(screen.getByText('收录 9 串 · 生成 8 张')).toBeTruthy();
  await waitFor(() => expect(mocks.usage).toHaveBeenCalledTimes(2));
  expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('删除生成图片后重新读取当前留存数，不触发生成', async () => {
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([['alpha artist', { chains: 4, images: 2, lastAt: 30 }]]), indexed: 3, total: 3 });
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([['alpha artist', { chains: 4, images: 1, lastAt: 20 }]]), indexed: 3, total: 3 });
  setup();
  await screen.findByText('收录 4 串 · 生成 2 张');
  act(() => mocks.historyListeners.forEach(listener => listener({ type: 'delete' })));
  await screen.findByText('收录 4 串 · 生成 1 张');
  expect(mocks.usage).toHaveBeenCalledTimes(2);
  expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('统计刷新期间沿用上次完整快照，完成后按最新数据更新筛选结果', async () => {
  let finishRefresh!: (value: { byTag: Map<string, { chains: number; images: number; lastAt: number }>; indexed: number; total: number }) => void;
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([
    ['alpha artist', { chains: 4, images: 2, lastAt: 30 }],
    ['beta artist', { chains: 2, images: 7, lastAt: 20 }],
  ]), indexed: 3, total: 3 });
  mocks.usage.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  setup(); await screen.findByText('收录 4 串 · 生成 2 张'); disableSampleFilter();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  const images = screen.getByRole('combobox', { name: '图片生成' });
  fireEvent.change(images, { target: { value: 'used' } });
  await waitFor(() => expect(sampleCards()).toHaveLength(2));
  act(() => mocks.historyListeners.forEach(listener => listener({ type: 'delete' })));
  expect((screen.getByRole('combobox', { name: '图片生成' }) as HTMLSelectElement).disabled).toBe(true);
  expect(sampleCards()).toHaveLength(2);
  await act(async () => finishRefresh({ byTag: new Map(), indexed: 3, total: 3 }));
  await waitFor(() => expect(sampleCards()).toHaveLength(0));
  expect((screen.getByRole('combobox', { name: '图片生成' }) as HTMLSelectElement).value).toBe('used');
});
