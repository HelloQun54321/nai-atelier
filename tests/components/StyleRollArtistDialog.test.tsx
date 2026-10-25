// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StyleRollArtistDialog } from '../../components/roll/StyleRollArtistDialog';
import { DEFAULT_ROLL_RULES, type RollRules } from '../../services/styleRoll';
import { installPointerEvents, longPress } from '../support/touchEvents';
import type { ArtistDictionaryEntry } from '../../services/tagDictionary';
import { ARTIST_SAMPLES_CHANGED, type ArtistOwnSample } from '../../services/artistSamples';
import { setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';

const mocks = vi.hoisted(() => ({ groupGet: vi.fn(), groupPut: vi.fn(), block: vi.fn(), favorite: vi.fn(), urls: vi.fn(), usage: vi.fn(), data: vi.fn(), status: vi.fn(), catalog: vi.fn(), lookup: vi.fn(), begin: vi.fn(), remove: vi.fn(), confirm: vi.fn(), refresh: undefined as undefined | (() => void), items: [] as any[] }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { ...(await original<typeof import('../../services/api')>()).api, get: mocks.groupGet, put: mocks.groupPut } }));
vi.mock('../../services/artistUsage', async original => ({ ...await original<typeof import('../../services/artistUsage')>(), getArtistUsage: mocks.usage }));
vi.mock('../../services/localHistory', () => ({ localHistory: { subscribe: (listener: () => void) => { mocks.refresh = listener; return () => { mocks.refresh = undefined; }; } } }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog, getArtistSampleLookup: mocks.lookup }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, deleteArtistSample: mocks.remove }));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), beginArtistSampleGeneration: mocks.begin, readArtistSampleApiKey: () => 'synthetic-key' }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/anlasBudget', async original => ({ ...await original<typeof import('../../services/anlasBudget')>(), useAnlasBudget: () => ({ remaining: 100 }), estimateV45GenerationCost: () => 3 }));
vi.mock('../../services/naiUsage', async original => ({ ...await original<typeof import('../../services/naiUsage')>(), useNovelaiUsage: () => ({ info: null, refreshIfStale: async () => {} }) }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => DEFAULT_NAI_RUNTIME }));
vi.mock('../../components/ShortestColumnMasonry', async original => ({ ...await original<typeof import('../../components/ShortestColumnMasonry')>(), ShortestColumnMasonry: ({ items, renderItem, columns }: any) => <div data-testid="masonry" data-columns={columns}>{items.map(renderItem)}</div> }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => mocks.items, subscribeCollection: () => () => {}, ensureCollection: async () => {}, toggleArtistPreference: mocks.favorite }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className, onLoad, previewTransform }: any) => <img src={src} alt={alt} className={className} onLoad={onLoad} data-preview-transform={previewTransform} /> }));
const ownSample = (tag: string, imageUrl: string, pack: 'v45' | 'v5' = 'v45', id = imageUrl): ArtistOwnSample => ({ ...createDefaultRollTemplate(DEFAULT_NAI_RUNTIME), id, tag, pack, imageUrl, createdAt: 1, params: { ...createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, model: pack === 'v5' ? 'nai-diffusion-5-full' : 'nai-diffusion-4-5-full' } });
beforeEach(() => {
  mocks.groupGet.mockResolvedValue({ revision: 1, groups: [], memberships: {} });
  mocks.groupPut.mockImplementation(async (_path, state) => ({ ...state, revision: state.revision + 1 }));
  mocks.catalog.mockReset();
  mocks.status.mockResolvedValue({ available: true, canManage: true, packs: [] });
  mocks.data.mockImplementation(async () => ({ templates: {}, samples: (await Promise.all((['v45', 'v5'] as const).map(async pack => [...await mocks.urls(pack)].map(([tag, url]: [string, string]) => ownSample(url.startsWith('/api/artist-samples/image?') ? new URLSearchParams(url.split('?')[1]).get('tag') || tag : tag, url, pack))))).flat() }));
  mocks.confirm.mockResolvedValue(true); mocks.remove.mockResolvedValue(undefined); mocks.begin.mockResolvedValue(undefined);
  mocks.lookup.mockImplementation(async (pack, tag) => ({ pack, tag, revision: 'synthetic', imageCount: 2, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks(); mocks.usage.mockResolvedValue({ byTag: new Map(), indexed: 0, total: 0 }); localStorage.clear(); mocks.items = []; mocks.urls.mockImplementation(async () => new Map([['alpha', '/api/assets/alpha.png']])); mocks.block.mockResolvedValue(undefined); mocks.favorite.mockResolvedValue(true); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const Fixture = ({ library = ['alpha', 'beta'].map(name => ({ name, chinese: '', postCount: 1 })), initialRules = DEFAULT_ROLL_RULES }: { library?: ArtistDictionaryEntry[]; initialRules?: RollRules }) => {
  const [pinned, setPinned] = useState<string[]>([]), [blocked, setBlocked] = useState<string[]>([]), [sampledOnly, setSampledOnly] = useState(false), [rules, setRules] = useState(initialRules);
  return <StyleRollArtistDialog library={library} pinned={pinned} onPinnedChange={setPinned} blocked={blocked} onBlockedChange={async tags => { await mocks.block(tags); setBlocked(tags); }} excluded={[]} onExcludedChange={() => {}} sampledOnly={sampledOnly} onSampledOnlyChange={setSampledOnly} rules={rules} onRulesChange={setRules} onClose={() => {}} />;
};

it.each(['masonry', 'portrait', 'square'] as const)('%s 布局与画师库共用偏好，瀑布流使用当前图片真实比例而非固定空框', async layout => {
  setMobileImageDisplayPreferences({ layout, columns: 2, desktopColumns: 3 }, 'artists');
  render(<Fixture />); const image = await screen.findByAltText('alpha');
  const frame = image.closest<HTMLElement>('.mobile-gallery-frame')!;
  expect(frame.classList.contains('aspect-[2/3]')).toBe(false);
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('2 / 3');
  if (layout === 'masonry') {
    expect(screen.getByTestId('masonry').getAttribute('data-columns')).toBe('3');
    expect(image.classList.contains('object-contain')).toBe(true);
  } else {
    expect(document.querySelector(`.mobile-gallery--${layout}`)).toBeTruthy();
    expect(screen.queryByTestId('masonry')).toBeNull();
  }
  Object.defineProperties(image, { naturalWidth: { value: 1000, configurable: true }, naturalHeight: { value: 800, configurable: true } });
  fireEvent.load(image);
  await waitFor(() => expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('1250 / 1000'));
  expect(frame.parentElement?.querySelector('.gallery-card-caption')?.classList.contains('!min-h-0')).toBe(false);
});

it('Roll 复用画师库翻页、确认删除及生成链路，各操作不锁定画师且不改写原样张', async () => {
  const newer = { ...ownSample('alpha', '/new.png', 'v45', 'new'), createdAt: 2 };
  const older = ownSample('alpha', '/old.png', 'v45', 'old');
  const template = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME);
  template.params.model = 'nai-diffusion-4-5-full';
  const data = { templates: { v45: template }, samples: [older, newer] }, original = structuredClone(data);
  mocks.data.mockResolvedValue(data);
  render(<Fixture />); await screen.findByAltText('alpha');
  const card = screen.getByRole('button', { name: '锁定画师：alpha' });
  const generate = within(card).getByRole('button', { name: '重新生成样张' });
  expect(generate.classList.contains('hover-reveal-md')).toBe(true);
  expect(within(card).getByRole('button', { name: '偏好画师：alpha' }).nextElementSibling).toBe(generate);
  expect(generate.nextElementSibling?.getAttribute('aria-label')).toContain('样张版本');
  expect(within(card).getByRole('img').getAttribute('src')).toBe('/new.png');
  fireEvent.click(within(card).getByRole('button', { name: '下一张' }));
  expect(within(card).getByRole('img').getAttribute('src')).toBe('/old.png');
  const remove = within(card).getByRole('button', { name: '删除当前样张' });
  expect(remove.parentElement?.classList.contains('md:top-11')).toBe(true);
  mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(remove);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.remove).not.toHaveBeenCalled();
  await waitFor(() => expect(remove).toHaveProperty('disabled', false));
  fireEvent.click(remove);
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ source: 'own', pack: 'v45', tag: 'alpha', id: 'old' }));
  await waitFor(() => expect(within(card).getByRole('img').getAttribute('src')).toBe('/new.png'));
  expect(within(card).queryByRole('button', { name: '下一张' })).toBeNull();
  mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(generate);
  await waitFor(() => expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ rememberKey: 'artist-sample.generate' })));
  expect(mocks.begin).not.toHaveBeenCalled();
  await waitFor(() => expect(generate).toHaveProperty('disabled', false));
  fireEvent.click(generate);
  await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith('alpha', 'v45', template, 'synthetic-key', 3, true, true, expect.any(Function)));
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
  expect(data).toEqual(original);
});

it('Full 图包翻页使用当前包真实物理页，切到缺图版本仍可打开同一补图设置而不生图', async () => {
  mocks.status.mockResolvedValue({ available: true, canManage: true, packs: [{ id: 'v45', phase: 'ready', revision: 'synthetic' }] });
  mocks.catalog.mockResolvedValue({ pack: 'v45', revision: 'synthetic', tags: ['alpha'] });
  mocks.data.mockResolvedValue({ templates: {}, samples: [], removedSamples: [{ source: 'pack', pack: 'v45', tag: 'alpha', revision: 'synthetic', index: 0, imageCount: 3 }] });
  mocks.lookup.mockResolvedValue({ pack: 'v45', tag: 'alpha', revision: 'synthetic', imageCount: 3 });
  render(<Fixture />); await screen.findByAltText('alpha');
  const card = screen.getByRole('button', { name: '锁定画师：alpha' });
  expect(within(card).getByRole('img').getAttribute('src')).toContain('index=1');
  expect(within(card).getByRole('img').getAttribute('data-preview-transform')).toBe('artist-sample-padding-v2');
  fireEvent.click(within(card).getByRole('button', { name: '下一张' }));
  expect(within(card).getByRole('img').getAttribute('src')).toContain('index=2');
  fireEvent.click(within(card).getByRole('button', { name: /样张版本/ }));
  expect(within(card).queryByRole('img')).toBeNull();
  expect(within(card).queryByRole('button', { name: '删除当前样张' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: '补充样张' }));
  await screen.findByRole('dialog', { name: '补图生成设置' });
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(card.getAttribute('aria-pressed')).toBe('false');
});

it('样张删除广播刷新两版封面，保留搜索锁定及当前卡版本', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师' }), { target: { value: 'alpha' } });
  mocks.urls.mockResolvedValue(new Map());
  act(() => window.dispatchEvent(new Event(ARTIST_SAMPLES_CHANGED)));
  await waitFor(() => expect(screen.queryByAltText('alpha')).toBeNull());
  expect(screen.getByRole('searchbox', { name: '搜索画师' })).toHaveProperty('value', 'alpha');
  expect(screen.getByRole('button', { name: '锁定画师：alpha' })).toHaveProperty('ariaPressed', 'true');
  expect(mocks.urls).toHaveBeenCalledTimes(4);
});

it('使用量升降序和收录生成交集包含零值，保留锁定与偏好并重置分页', async () => {
  const library = Array.from({ length: 65 }, (_, i) => ({ name: `artist${String(i).padStart(2, '0')}`, chinese: '', postCount: 100 - i }));
  mocks.items = [{ sourceType: 'artist', sourceId: 'artist00' }];
  mocks.usage.mockResolvedValue({ byTag: new Map([
    ['artist00', { chains: 2, images: 0, lastAt: 1 }], ['artist01', { chains: 1, images: 4, lastAt: 1 }],
    ['artist64', { chains: 3, images: 7, lastAt: 1 }],
  ]), indexed: 7, total: 7 });
  localStorage.setItem('nai_artist_sort', 'usage-images');
  render(<Fixture library={library} />);
  await waitFor(() => expect(screen.getByText('收录 3 串 · 生成 7 张')).toBeTruthy());
  const order = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')?.split('：')[1]);
  expect(order().slice(0, 2)).toEqual(['artist64', 'artist01']);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：artist00' }));
  fireEvent.click(screen.getByRole('button', { name: '加载更多' })); expect(order()).toHaveLength(65);
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 500;
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains' } });
  expect(order().slice(0, 3)).toEqual(['artist64', 'artist00', 'artist01']); expect(order()).toHaveLength(60); expect(gallery.scrollTop).toBe(0);
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-chains-asc' } });
  expect(order()[0]).toBe('artist02');
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'usage-images-asc' } });
  expect(order()[0]).toBe('artist00');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  expect(order()).toEqual(['artist00']);
  expect(screen.getByRole('button', { name: '锁定画师：artist00' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '取消偏好画师：artist00' })).toBeTruthy();
  expect(mocks.favorite).not.toHaveBeenCalled(); expect(mocks.block).not.toHaveBeenCalled();
});

it('统计未知显示横杠且禁用筛选，失败重试和历史刷新不阻止普通选择', async () => {
  let reject!: (error: Error) => void;
  mocks.usage.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  render(<Fixture />); await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('正在统计画师使用…')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getAllByText('收录 — 串 · 生成 — 张')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  reject(new Error('unavailable')); await screen.findByText('画师使用统计暂不可用');
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'name-desc' } });
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '重试统计' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement).disabled).toBe(false));
  expect(screen.getAllByText('收录 0 串 · 生成 0 张')).toHaveLength(2);
  mocks.refresh?.(); await waitFor(() => expect(mocks.usage).toHaveBeenCalledTimes(3));
});

it('使用筛选有可见标题，刷新等待和失败时继续保留上次完整排序及筛选', async () => {
  mocks.usage.mockResolvedValueOnce({ byTag: new Map([['beta', { chains: 2, images: 3, lastAt: 1 }]]), indexed: 1, total: 1 });
  localStorage.setItem('nai_artist_sort', 'usage-images');
  render(<Fixture />); await screen.findByText('收录 2 串 · 生成 3 张');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('风格串收录').tagName).toBe('P');
  expect(screen.getByText('图片生成').tagName).toBe('P');
  const filter = screen.getByRole('combobox', { name: '风格串收录' }) as HTMLSelectElement;
  fireEvent.change(filter, { target: { value: 'used' } });
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  let reject!: (error: Error) => void;
  mocks.usage.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
  mocks.refresh?.(); await screen.findByText('正在统计画师使用…');
  expect(filter.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  reject(new Error('refresh failed')); await screen.findByText('画师使用统计暂不可用');
  expect(filter.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  const sort = screen.getByRole('combobox', { name: '画师排序' });
  expect(sort.parentElement?.classList.contains('max-w-[44vw]')).toBe(true);
  expect(sort.classList.contains('truncate')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' })).toBeTruthy();
  expect(filter.value).toBe('all');
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
});

it.each([390, 1280])('宽度 %s：爱心下面切单卡版本，保留另一张图片、滚动、锁定及偏好，不刷新目录', async width => {
  vi.stubGlobal('innerWidth', width);
  mocks.urls.mockImplementation(async pack => new Map(pack === 'v45' ? [['alpha', '/v45-alpha.png'], ['beta', '/v45-beta.png']] : [['alpha', '/v5-alpha.png']]));
  mocks.items = [{ sourceType: 'artist', sourceId: 'alpha' }];
  render(<Fixture />); await screen.findByAltText('alpha');
  const alpha = screen.getByRole('button', { name: '锁定画师：alpha' }), beta = screen.getByRole('button', { name: '锁定画师：beta' });
  const betaImage = within(beta).getByRole('img');
  fireEvent.click(alpha); fireEvent.click(beta);
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 480;
  const version = within(alpha).getByRole('button', { name: '样张版本 V4.5，切换为 V5 Full' });
  expect(within(alpha).getByRole('button', { name: '取消偏好画师：alpha' }).nextElementSibling).toBe(within(alpha).getByRole('button', { name: '重新生成样张' }));
  expect(within(alpha).getByRole('button', { name: '重新生成样张' }).nextElementSibling).toBe(version);
  fireEvent.keyDown(version, { key: 'Enter' }); fireEvent.click(version);
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v5-alpha.png');
  expect(within(beta).getByRole('img')).toBe(betaImage); expect(betaImage.getAttribute('src')).toBe('/v45-beta.png');
  expect(gallery.scrollTop).toBe(480); expect(alpha.getAttribute('aria-pressed')).toBe('true');
  expect(within(alpha).getByRole('button', { name: '取消偏好画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(beta).getByRole('button', { name: /样张版本/ }));
  expect(within(beta).queryByRole('img')).toBeNull(); expect(within(beta).getByText(/暂无样张$/)).toBeTruthy();
  expect(beta.getAttribute('aria-pressed')).toBe('true'); expect(screen.getByRole('button', { name: '锁定画师：alpha' })).toBe(alpha);
  expect(mocks.urls).toHaveBeenCalledTimes(2); expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
});

it('Roll 打开时沿用画师库默认版本，单卡切换不改全局选择', async () => {
  localStorage.setItem('nai_artist_sample_pack', 'v5');
  mocks.urls.mockImplementation(async pack => new Map([['alpha', `/${pack}-alpha.png`]]));
  render(<Fixture />); await screen.findByAltText('alpha');
  const alpha = screen.getByRole('button', { name: '锁定画师：alpha' });
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v5-alpha.png');
  fireEvent.click(within(alpha).getByRole('button', { name: '样张版本 V5 Full，切换为 V4.5' }));
  expect(within(alpha).getByRole('img').getAttribute('src')).toBe('/v45-alpha.png');
  expect(localStorage.getItem('nai_artist_sample_pack')).toBe('v5');
});

it('复用画师库四种排序，排序重置滚动且保留锁定、筛选和输入资料', async () => {
  const library = [{ name: 'alpha', chinese: '', postCount: 20 }, { name: 'beta', chinese: '', postCount: 10 }, { name: 'charlie', chinese: '', postCount: 30 }];
  const before = structuredClone(library); mocks.items = library.slice(0, 2).map(entry => ({ sourceType: 'artist', sourceId: entry.name }));
  render(<Fixture library={library} />); await screen.findByAltText('alpha');
  const order = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')?.split('：')[1]);
  expect(order()).toEqual(['charlie', 'alpha', 'beta']);
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!; gallery.scrollTop = 500;
  const select = screen.getByRole('combobox', { name: '画师排序' });
  fireEvent.change(select, { target: { value: 'least' } });
  expect(order()).toEqual(['beta', 'alpha', 'charlie']); expect(gallery.scrollTop).toBe(0);
  fireEvent.change(select, { target: { value: 'name-asc' } }); expect(order()).toEqual(['alpha', 'beta', 'charlie']);
  fireEvent.change(select, { target: { value: 'name-desc' } }); expect(order()).toEqual(['charlie', 'beta', 'alpha']);
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' })); expect(order()).toEqual(['beta', 'alpha']);
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  expect(library).toEqual(before); expect(localStorage.getItem('nai_roll_artist_sort')).toBe('name-desc');
  expect(mocks.favorite).not.toHaveBeenCalled(); expect(mocks.block).not.toHaveBeenCalled();
});

it('样张与缺图空封面同时可见，点击封面只锁定 Tag', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  expect(screen.getByText(/暂无样张$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：beta' }));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' }));
  expect(screen.getByText(/暂无样张$/)).toBeTruthy();
  expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
});

it('屏蔽成功后卡片留在列表，移除锁定；失败保留原状态', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  fireEvent.click(screen.getByRole('button', { name: '屏蔽画师：alpha' }));
  await screen.findByRole('button', { name: '取消屏蔽画师：alpha' });
  expect(screen.getByAltText('alpha')).toBeTruthy();
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('false');
  mocks.block.mockRejectedValueOnce(new Error('保存屏蔽失败'));
  fireEvent.click(screen.getByRole('button', { name: '取消屏蔽画师：alpha' }));
  await screen.findByText('保存屏蔽失败');
  expect(screen.getByRole('button', { name: '取消屏蔽画师：alpha' })).toBeTruthy();
});

it('两个角分别是屏蔽和偏好，缺图也可收藏，用户可改倍率和保底', async () => {
  render(<Fixture />); await screen.findByAltText('alpha');
  const favorite = screen.getByRole('button', { name: '偏好画师：beta' });
  expect(favorite.parentElement?.className).toContain('right-2');
  expect(screen.getByRole('button', { name: '屏蔽画师：beta' }).className).toContain('left-2');
  fireEvent.click(favorite); await waitFor(() => expect(mocks.favorite).toHaveBeenCalledWith('beta', '', undefined));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '抽取设置' }));
  fireEvent.change(screen.getByLabelText('偏好抽中倍率'), { target: { value: '4.5' } });
  fireEvent.change(screen.getByLabelText('每串偏好保底人数'), { target: { value: '2' } });
  expect(screen.getByLabelText('偏好抽中倍率')).toHaveProperty('value', '4.5');
  expect(screen.getByLabelText('每串偏好保底人数')).toHaveProperty('value', '2');
});

it.each([390, 1280])('宽度 %s：偏好倍率滑条与数字双向同步，回到1倍不改保底锁定或偏好', async width => {
  vi.stubGlobal('innerWidth', width);
  render(<Fixture initialRules={{ ...DEFAULT_ROLL_RULES, preferredMinArtists: 1 }} />);
  await screen.findByAltText('alpha');
  fireEvent.click(screen.getByRole('button', { name: '抽取设置' }));
  const slider = screen.getByRole('slider', { name: '偏好抽中倍率滑条' });
  const number = screen.getByRole('spinbutton', { name: '偏好抽中倍率' });
  expect(slider).toHaveProperty('value', '1'); expect(slider).toHaveProperty('min', '1');
  expect(slider).toHaveProperty('max', '100'); expect(slider).toHaveProperty('step', '0.1');
  fireEvent.change(slider, { target: { value: '4.5' } }); expect(number).toHaveProperty('value', '4.5');
  fireEvent.change(number, { target: { value: '12.3' } }); expect(slider).toHaveProperty('value', '12.3');
  fireEvent.change(slider, { target: { value: '1' } }); expect(number).toHaveProperty('value', '1');
  expect(screen.getByRole('spinbutton', { name: '每串偏好保底人数' })).toHaveProperty('value', '1');
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('false');
  expect(mocks.favorite).not.toHaveBeenCalled(); expect(mocks.block).not.toHaveBeenCalled();
});

it('已存大倍率不截断，数字扩大滑条范围后拖回低倍率也不收缩跳动', async () => {
  render(<Fixture initialRules={{ ...DEFAULT_ROLL_RULES, preferredMultiplier: 250 }} />);
  await screen.findByAltText('alpha');
  const settings = screen.getByRole('button', { name: '抽取设置' }); fireEvent.click(settings);
  const slider = screen.getByRole('slider', { name: '偏好抽中倍率滑条' });
  const number = screen.getByRole('spinbutton', { name: '偏好抽中倍率' });
  expect(slider).toHaveProperty('value', '250'); expect(slider).toHaveProperty('max', '250');
  fireEvent.change(number, { target: { value: '500.5' } });
  expect(slider).toHaveProperty('max', '500.5'); expect(slider).toHaveProperty('value', '500.5');
  fireEvent.change(slider, { target: { value: '2.5' } });
  expect(number).toHaveProperty('value', '2.5'); expect(slider).toHaveProperty('max', '500.5');
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(settings);
  expect(screen.getByRole('slider', { name: '偏好抽中倍率滑条' })).toHaveProperty('value', '2.5');
});

it('收藏库已有的画师会直接显示偏好，并可按偏好筛选', async () => {
  mocks.items = [{ sourceType: 'artist', sourceId: 'beta', archived: false }];
  render(<Fixture />); await screen.findByAltText('alpha');
  expect(screen.getByRole('button', { name: '取消偏好画师：beta' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' }));
  expect(screen.queryByRole('button', { name: '锁定画师：alpha' })).toBeNull();
  expect(screen.getByRole('button', { name: '锁定画师：beta' })).toBeTruthy();
});

it.each([390, 1280])('宽度 %s：参数以独立小卡片弹出，关闭保留输入、选择及原图片节点', async width => {
  vi.stubGlobal('innerWidth', width);
  render(<Fixture />); const image = await screen.findByAltText('alpha');
  expect(screen.queryByRole('spinbutton', { name: '偏好抽中倍率' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Roll 画师' }).querySelector('aside')).toBeNull();
  expect(screen.queryByText('1 倍不加权，0 位不保底；已锁定的偏好计入保底，不足时停止。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：alpha' }));
  const settings = screen.getByRole('button', { name: '抽取设置' });
  fireEvent.click(settings);
  const panel = screen.getByRole('dialog', { name: '抽取设置' });
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!;
  expect(panel.classList.contains('appearance-popover')).toBe(true);
  expect(panel.style.width).toBe('320px');
  expect(panel.style.position || panel.className).toContain('fixed');
  expect(screen.getByRole('dialog', { name: 'Roll 画师' }).contains(panel)).toBe(false);
  expect(gallery.contains(panel)).toBe(false);
  fireEvent.change(screen.getByRole('spinbutton', { name: '偏好抽中倍率' }), { target: { value: '2.5' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('spinbutton', { name: '偏好抽中倍率' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Roll 画师' })).toBeTruthy();
  expect(screen.getByAltText('alpha')).toBe(image);
  fireEvent.click(settings);
  expect(screen.getByRole('spinbutton', { name: '偏好抽中倍率' })).toHaveProperty('value', '2.5');
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' }); gallery.scrollTop = 600;
  fireEvent.click(screen.getByRole('button', { name: '已锁定' }));
  expect(gallery.scrollTop).toBe(0);
  expect(screen.queryByRole('button', { name: '锁定画师：beta' })).toBeNull();
});

it('卡片复用角色卡图文结构和图库动效，点击名字与键盘选择保持一致', async () => {
  installPointerEvents(); render(<Fixture />); const image = await screen.findByAltText('alpha');
  const card = image.closest('article')!;
  expect(card.classList.contains('gallery-image-card')).toBe(true);
  expect(card.classList.contains('press-reveal-surface')).toBe(true);
  expect(image.closest('.mobile-gallery-frame')).toBeTruthy();
  expect(card.classList.contains('gallery-card-visual')).toBe(true);
  expect(card.querySelector(':scope > .gallery-card-caption > p')?.textContent).toBe('alpha');
  expect(card.querySelector(':scope > .mobile-gallery-frame')).toBeTruthy();
  fireEvent.pointerEnter(card, { pointerType: 'mouse' });
  expect(card.getAttribute('data-press-input')).toBe('mouse');
  fireEvent.pointerEnter(card, { pointerType: 'touch' });
  expect(card.getAttribute('data-press-input')).toBe('touch');
  fireEvent.click(within(card).getByText('alpha', { exact: true }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(card, { key: 'Enter' });
  expect(card.getAttribute('aria-pressed')).toBe('false');
});

it('触屏长按显露版本切换，换版本后收起；普通点按锁定，滑动不显露', async () => {
  installPointerEvents(); render(<Fixture />);
  const image = await screen.findByAltText('alpha');
  const card = image.closest('article')!;
  const getVersion = () => within(card).getByRole('button', { name: /样张版本 .*切换为/ });

  longPress(card);
  expect(card.getAttribute('data-press-revealed')).toBe('true');
  expect(card.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(getVersion());
  await waitFor(() => expect(card.getAttribute('data-press-revealed')).toBeNull());
  expect(getVersion().getAttribute('aria-label')).toBe('样张版本 V5 Full，切换为 V4.5');
  expect(card.getAttribute('aria-pressed')).toBe('false');

  vi.useFakeTimers();
  fireEvent.pointerDown(card, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.pointerUp(card, { pointerType: 'touch' });
  fireEvent.click(card, { detail: 1 });
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(card.getAttribute('data-press-revealed')).toBeNull();

  fireEvent.pointerDown(card, { pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 40, clientY: 20 });
  act(() => vi.advanceTimersByTime(500));
  fireEvent.pointerUp(card, { pointerType: 'touch' });
  fireEvent.click(card, { detail: 1 });
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(card.getAttribute('data-press-revealed')).toBeNull();
  vi.useRealTimers();
});

it('图包-only原名可固定且保留归一冲突条目，未知热度不会冒充最低热度', async () => {
  const library = [{ name: 'a_b', chinese: '词库中文', postCount: 100 }, { name: 'a b', chinese: '', postCount: 0, postCountKnown: false }, { name: 'pack_only', chinese: '', postCount: 0, postCountKnown: false }, { name: 'known zero', chinese: '', postCount: 0 }];
  localStorage.setItem('nai_roll_artist_sort', 'least');
  render(<Fixture library={library} />);
  await screen.findByRole('button', { name: '锁定画师：pack_only' });
  const names = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')!.slice('锁定画师：'.length));
  expect(names().slice(0, 2)).toEqual(['known zero', 'a_b']);
  expect(screen.getByRole('button', { name: '锁定画师：a b' })).toBeTruthy();
  expect(screen.getByText('词库中文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '锁定画师：pack_only' }));
  expect(screen.getByRole('button', { name: '锁定画师：pack_only' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(screen.getByRole('combobox', { name: '画师排序' }), { target: { value: 'name-asc' } });
  expect(names().at(-1)).toBe('pack_only');
  expect(screen.getByRole('button', { name: '锁定画师：pack_only' }).getAttribute('aria-pressed')).toBe('true');
});

it('归一化冲突时仅精确图包Tag显示图片，另一原名安全无图', async () => {
  const url = '/api/artist-samples/image?pack=v45&tag=foo_bar&index=0&revision=synthetic';
  mocks.urls.mockResolvedValue(new Map([['foo bar', url]]));
  render(<Fixture library={[{ name: 'foo_bar', chinese: '', postCount: 1 }, { name: 'foo bar', chinese: '', postCount: 0, postCountKnown: false }]} />);
  const exact = screen.getByRole('button', { name: '锁定画师：foo_bar' });
  const ambiguous = screen.getByRole('button', { name: '锁定画师：foo bar' });
  await waitFor(() => expect(exact.querySelector('img')?.getAttribute('src')).toBe(url));
  expect(ambiguous.querySelector('img')).toBeNull();
  expect(within(ambiguous).getByText(/暂无样张$/)).toBeTruthy();
  fireEvent.click(within(exact).getByRole('button', { name: '样张版本 V4.5，切换为 V5 Full' }));
  expect(within(exact).getByRole('button', { name: '样张版本 V5 Full，切换为 V4.5' })).toBeTruthy();
  expect(within(ambiguous).getByRole('button', { name: '样张版本 V4.5，切换为 V5 Full' })).toBeTruthy();
});

it('逗号多词按OR合并原名，支持中英文逗号与译名并忽略重复空项', async () => {
  const alpha = { name: 'alpha_tag', chinese: '蓝色画家', postCount: 30 };
  const library = [alpha, { name: 'beta_tag', chinese: '红色画家', postCount: 20 }, { name: 'gamma', chinese: '', postCount: 10 }, { ...alpha }];
  render(<Fixture library={library} />);
  const search = screen.getByRole('searchbox', { name: '搜索画师' });
  expect(search.getAttribute('placeholder')).toBe('搜索画师，多个词用逗号分隔');
  const names = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')!.slice('锁定画师：'.length));
  fireEvent.change(search, { target: { value: ' ALPHA TAG ，红色, alpha_tag, alpha， , ' } });
  expect(names()).toEqual(['alpha_tag', 'beta_tag']);
  expect(screen.getByText('匹配 2 位')).toBeTruthy();
  fireEvent.change(search, { target: { value: '红色' } }); expect(names()).toEqual(['beta_tag']);
  fireEvent.change(search, { target: { value: '， , ， ' } }); expect(names()).toEqual(['alpha_tag', 'beta_tag', 'gamma']);
  expect(screen.getByText('共 3 位')).toBeTruthy();
  expect(mocks.block).not.toHaveBeenCalled(); expect(mocks.favorite).not.toHaveBeenCalled();
});

it('多词搜索仍与偏好锁定屏蔽和使用统计取交集，搜索不改任何状态', async () => {
  const library = ['alpha_tag', 'beta_tag', 'gamma'].map((name, index) => ({ name, chinese: '', postCount: 30 - index }));
  mocks.items = [{ sourceType: 'artist', sourceId: 'alpha_tag' }, { sourceType: 'artist', sourceId: 'beta_tag' }];
  mocks.usage.mockResolvedValue({ byTag: new Map([['alpha tag', { chains: 2, images: 0, lastAt: 1 }], ['beta tag', { chains: 1, images: 1, lastAt: 1 }]]), indexed: 2, total: 2 });
  const onPinnedChange = vi.fn(), onBlockedChange = vi.fn(), onExcludedChange = vi.fn(), onRulesChange = vi.fn(), onSampledOnlyChange = vi.fn();
  render(<StyleRollArtistDialog library={library} pinned={['beta_tag']} onPinnedChange={onPinnedChange} blocked={['alpha_tag']} onBlockedChange={onBlockedChange} excluded={[]} onExcludedChange={onExcludedChange} sampledOnly={false} onSampledOnlyChange={onSampledOnlyChange} rules={DEFAULT_ROLL_RULES} onRulesChange={onRulesChange} onClose={() => {}} />);
  await screen.findByText('收录 2 串 · 生成 0 张');
  const names = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label')!.slice('锁定画师：'.length));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师' }), { target: { value: ' ALPHA TAG，beta_tag, gamma ' } });
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' })); expect(names()).toEqual(['alpha_tag', 'beta_tag']);
  fireEvent.click(screen.getByRole('button', { name: '已锁定' })); expect(names()).toEqual(['beta_tag']);
  expect(screen.getByRole('button', { name: '锁定画师：beta_tag' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '已屏蔽' })); expect(names()).toEqual(['alpha_tag']);
  fireEvent.click(screen.getByRole('button', { name: '全部画师' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '风格串收录' }), { target: { value: 'used' } });
  fireEvent.change(screen.getByRole('combobox', { name: '图片生成' }), { target: { value: 'unused' } });
  expect(names()).toEqual(['alpha_tag']);
  for (const callback of [onPinnedChange, onBlockedChange, onExcludedChange, onRulesChange, onSampledOnlyChange]) expect(callback).not.toHaveBeenCalled();
  expect(mocks.favorite).not.toHaveBeenCalled();
});


it('Roll分组浏览与原搜索、偏好、屏蔽取交集，不改固定名单或抽取规则', async () => {
  mocks.groupGet.mockResolvedValue({ revision: 1, groups: [{ id: 'g', name: '测试组' }], memberships: { 'artist:alpha_tag': ['g'], 'artist:beta_tag': ['g'] } });
  mocks.items = [{ sourceType: 'artist', sourceId: 'beta_tag' }];
  const library = ['alpha_tag', 'beta_tag', 'gamma'].map(name => ({ name, chinese: '', postCount: 1 }));
  const onPinnedChange = vi.fn(), onBlockedChange = vi.fn(), onExcludedChange = vi.fn(), onRulesChange = vi.fn(), onSampledOnlyChange = vi.fn();
  render(<StyleRollArtistDialog library={library} pinned={['beta_tag']} onPinnedChange={onPinnedChange} blocked={['alpha_tag']} onBlockedChange={onBlockedChange} excluded={[]} onExcludedChange={onExcludedChange} sampledOnly={false} onSampledOnlyChange={onSampledOnlyChange} rules={DEFAULT_ROLL_RULES} onRulesChange={onRulesChange} onClose={() => {}} />);
  await waitFor(() => expect(mocks.groupGet).toHaveBeenCalledWith('/catalog-groups/artist', expect.anything()));
  expect(screen.queryByRole('complementary', { name: '分组导航' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(await screen.findByLabelText('选择分组'), { target: { value: 'g' } });
  const names = () => screen.getAllByRole('button', { name: /^锁定画师：/ }).map(card => card.getAttribute('aria-label'));
  expect(names()).toEqual(['锁定画师：alpha_tag', '锁定画师：beta_tag']);
  fireEvent.click(screen.getByRole('button', { name: '偏好画师' })); expect(names()).toEqual(['锁定画师：beta_tag']);
  fireEvent.click(screen.getByRole('button', { name: '已屏蔽' })); expect(names()).toEqual(['锁定画师：alpha_tag']);
  fireEvent.click(screen.getByRole('button', { name: '全部画师' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师' }), { target: { value: 'beta' } });
  expect(names()).toEqual(['锁定画师：beta_tag']);
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(names()).toEqual(['锁定画师：beta_tag']);
  expect(JSON.parse(localStorage.getItem('nai_catalog_groups_roll-artists')!).active).toBe('g');
  expect(localStorage.getItem('nai_catalog_groups_artist')).toBeNull();
  for (const callback of [onPinnedChange, onBlockedChange, onExcludedChange, onRulesChange, onSampledOnlyChange]) expect(callback).not.toHaveBeenCalled();
});

it('分组筛选先覆盖完整目录再分页，精确原名区分同义画师且设组仅包含库内固定项', async () => {
  const library = Array.from({ length: 82 }, (_, index) => ({ name: 'artist_' + index, chinese: '', postCount: 100 - index }));
  library.push({ name: 'artist 80', chinese: '', postCount: 1 });
  mocks.groupGet.mockResolvedValue({ revision: 1, groups: [{ id: 'g', name: '末页组' }], memberships: { 'artist:artist_80': ['g'], 'artist:artist_81': ['g'] } });
  const onPinnedChange = vi.fn();
  render(<StyleRollArtistDialog library={library} pinned={['artist_80', 'artist 80', 'missing']} onPinnedChange={onPinnedChange} blocked={[]} onBlockedChange={mocks.block} excluded={[]} onExcludedChange={vi.fn()} sampledOnly={false} onSampledOnlyChange={vi.fn()} rules={DEFAULT_ROLL_RULES} onRulesChange={vi.fn()} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '设置分组' })).toHaveProperty('disabled', false));
  expect(screen.queryByRole('button', { name: '锁定画师：artist_80' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(screen.getByLabelText('选择分组'), { target: { value: 'g' } });
  expect(screen.getByRole('button', { name: '锁定画师：artist_80' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '锁定画师：artist_81' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '锁定画师：artist 80' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  const management = screen.getByRole('dialog', { name: '设置分组' });
  expect(within(management).getByText('已选 2 项')).toBeTruthy();
  fireEvent.click(within(management).getByRole('checkbox', { name: '末页组' }));
  fireEvent.click(within(management).getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.groupPut).toHaveBeenCalledOnce());
  const memberships = mocks.groupPut.mock.calls[0][1].memberships;
  expect(memberships['artist:missing']).toBeUndefined();
  expect(Object.keys(memberships)).toContain('artist:artist 80');
  expect(onPinnedChange).not.toHaveBeenCalled();
});


it('分组元数据更新不重置全部画师浏览的已加载页与滚动', async () => {
  const library = Array.from({ length: 82 }, (_, index) => ({ name: 'entry_' + index, chinese: '', postCount: 100 - index }));
  render(<Fixture library={library} />);
  await waitFor(() => expect(mocks.groupGet).toHaveBeenCalledWith('/catalog-groups/artist', expect.anything()));
  expect(screen.queryByRole('button', { name: '锁定画师：entry_80' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  expect(screen.getByRole('button', { name: '锁定画师：entry_80' })).toBeTruthy();
  const gallery = document.querySelector<HTMLElement>('[data-roll-artist-gallery]')!;
  gallery.scrollTop = 640;
  act(() => window.dispatchEvent(new CustomEvent('nai-catalog-groups-updated', { detail: {
    kind: 'artist', state: { revision: 2, groups: [{ id: 'new', name: '新分组' }], memberships: {} },
  } })));
  expect(gallery.scrollTop).toBe(640);
  expect(screen.getByRole('button', { name: '锁定画师：entry_80' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.getByRole('option', { name: '新分组 (0)' })).toBeTruthy();
});


it.each([false, true])('真实Roll卡片拖入分组：固定来源=%s，追加归属且不改变任何抽取状态', async selected => {
  const state = { revision: 1, groups: [{ id: 'old', name: '原组' }, { id: 'target', name: '目标组' }], memberships: { 'artist:alpha': ['old'], 'artist:beta': ['old'] } };
  mocks.groupGet.mockResolvedValue(state);
  const onPinnedChange = vi.fn(), onBlockedChange = vi.fn(), onExcludedChange = vi.fn(), onRulesChange = vi.fn(), onSampledOnlyChange = vi.fn();
  render(<StyleRollArtistDialog library={['alpha', 'beta', 'gamma'].map(name => ({ name, chinese: '', postCount: 1 }))} pinned={['alpha', 'beta']} onPinnedChange={onPinnedChange} blocked={[]} onBlockedChange={onBlockedChange} excluded={[]} onExcludedChange={onExcludedChange} sampledOnly={false} onSampledOnlyChange={onSampledOnlyChange} rules={DEFAULT_ROLL_RULES} onRulesChange={onRulesChange} onClose={() => {}} />);
  const source = screen.getByRole('button', { name: selected ? '锁定画师：alpha' : '锁定画师：gamma' });
  await waitFor(() => expect(source.draggable).toBe(true));
  const dragOrigin = selected ? await within(source).findByRole('img') : source;
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  const navigation = screen.getByRole('complementary', { name: '分组导航' });
  const destination = within(navigation).getByRole('button', { name: '目标组' });
  const values = new Map<string, string>();
  const transfer = { get types() { return [...values.keys()]; }, setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) || '', effectAllowed: '', dropEffect: '' };
  // 开始拖动后取消，旧拖动令牌失效；无归属写入。
  fireEvent.dragStart(dragOrigin, { dataTransfer: transfer });
  fireEvent.dragEnd(source, { dataTransfer: transfer });
  fireEvent.drop(destination, { dataTransfer: transfer });
  expect(mocks.groupPut).not.toHaveBeenCalled();
  for (const name of ['全部', '未分组']) {
    fireEvent.dragStart(dragOrigin, { dataTransfer: transfer });
    fireEvent.drop(within(navigation).getByRole('button', { name }), { dataTransfer: transfer });
  }
  expect(mocks.groupPut).not.toHaveBeenCalled();
  fireEvent.dragStart(dragOrigin, { dataTransfer: transfer });
  fireEvent.dragOver(destination, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe('copy');
  fireEvent.drop(destination, { dataTransfer: transfer });
  await waitFor(() => expect(mocks.groupPut).toHaveBeenCalledOnce());
  const expected = selected
    ? { 'artist:alpha': ['old', 'target'], 'artist:beta': ['old', 'target'] }
    : { 'artist:alpha': ['old'], 'artist:beta': ['old'], 'artist:gamma': ['target'] };
  expect(mocks.groupPut).toHaveBeenCalledWith('/catalog-groups/artist', expect.objectContaining({ memberships: expected }));
  await waitFor(() => expect(destination).toHaveProperty('disabled', false));
  expect(screen.queryByRole('alert')).toBeNull();
  // 同组再次拖入不重复保存。
  fireEvent.dragStart(dragOrigin, { dataTransfer: transfer }); fireEvent.drop(destination, { dataTransfer: transfer });
  expect(mocks.groupPut).toHaveBeenCalledOnce();
  for (const callback of [onPinnedChange, onBlockedChange, onExcludedChange, onRulesChange, onSampledOnlyChange, mocks.favorite, mocks.begin]) expect(callback).not.toHaveBeenCalled();
});


it('Roll分组计数使用未筛选完整真实目录，分页外和资料变化均反映但不计临时固定项', async () => {
  const library = Array.from({ length: 82 }, (_, index) => ({ name: 'count_' + index, chinese: '', postCount: 100 - index }));
  const memberships = Object.fromEntries(library.map(entry => ['artist:' + entry.name, ['g']]));
  memberships['artist:ghost'] = ['g'];
  mocks.groupGet.mockResolvedValue({ revision: 1, groups: [{ id: 'g', name: '完整组' }], memberships });
  const props = { library, pinned: ['ghost'], onPinnedChange: vi.fn(), blocked: ['unknown'], onBlockedChange: mocks.block, excluded: [], onExcludedChange: vi.fn(), sampledOnly: false, onSampledOnlyChange: vi.fn(), rules: DEFAULT_ROLL_RULES, onRulesChange: vi.fn(), onClose: vi.fn() };
  const view = render(<StyleRollArtistDialog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  await screen.findByRole('option', { name: '完整组 (82)' });
  expect(screen.getByRole('option', { name: '全部 (82)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '未分组 (0)' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '锁定画师：count_80' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师' }), { target: { value: 'count_0' } });
  expect(screen.getAllByRole('button', { name: /^锁定画师：/ })).toHaveLength(1);
  expect(screen.getByRole('option', { name: '完整组 (82)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '已锁定' }));
  expect(screen.queryByRole('button', { name: /^锁定画师：/ })).toBeNull();
  expect(screen.getByRole('option', { name: '完整组 (82)' })).toBeTruthy();
  view.rerender(<StyleRollArtistDialog {...props} library={[...library, { name: 'new_actual', chinese: '', postCount: 0 }]} />);
  expect(screen.getByRole('option', { name: '全部 (83)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '完整组 (82)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '未分组 (1)' })).toBeTruthy();
  expect(props.onPinnedChange).not.toHaveBeenCalled(); expect(props.onRulesChange).not.toHaveBeenCalled();
});

it('Roll目录或样张读取中及真实目录读取失败时分组计数未知，恢复后显示真实数', async () => {
  let resolveSamples!: (value: { templates: Record<string, never>; samples: [] }) => void;
  mocks.data.mockImplementationOnce(() => new Promise(resolve => { resolveSamples = resolve; }));
  mocks.groupGet.mockResolvedValue({ revision: 1, groups: [{ id: 'g', name: '未知组' }], memberships: { 'artist:alpha': ['g'] } });
  const props = { library: [{ name: 'alpha', chinese: '', postCount: 1 }], pinned: [], onPinnedChange: vi.fn(), blocked: [], onBlockedChange: mocks.block, excluded: [], onExcludedChange: vi.fn(), sampledOnly: false, onSampledOnlyChange: vi.fn(), rules: DEFAULT_ROLL_RULES, onRulesChange: vi.fn(), onClose: vi.fn() };
  const view = render(<StyleRollArtistDialog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  await screen.findByRole('option', { name: '未知组 (—)' });
  await act(async () => { resolveSamples({ templates: {}, samples: [] }); });
  await screen.findByRole('option', { name: '未知组 (1)' });
  view.rerender(<StyleRollArtistDialog {...props} loading />);
  expect(screen.getByRole('option', { name: '未知组 (—)' })).toBeTruthy();
  view.rerender(<StyleRollArtistDialog {...props} libraryError="合成目录失败" />);
  expect(screen.getByRole('option', { name: '未知组 (—)' })).toBeTruthy();
  view.rerender(<StyleRollArtistDialog {...props} />);
  expect(screen.getByRole('option', { name: '未知组 (1)' })).toBeTruthy();
});
