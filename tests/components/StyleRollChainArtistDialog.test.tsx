// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { StyleRollChainArtistDialog } from '../../components/roll/StyleRollChainArtistDialog';
import { ImageActivityProvider } from '../../components/SmartImage';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { setMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';

const mocks = vi.hoisted(() => ({ load: vi.fn(), extract: vi.fn(), ensure: vi.fn(), runtime: null as any, favorites: new Set<string>(), favoriteChanged: undefined as undefined | (() => void) }));
vi.mock('../../services/naiRuntime', async original => { const actual = await original<typeof import('../../services/naiRuntime')>(); return { ...actual, useNaiRuntime: () => mocks.runtime || actual.DEFAULT_NAI_RUNTIME }; });
vi.mock('../../services/collectionFavorites', async original => ({ ...await original<typeof import('../../services/collectionFavorites')>(), ensureCollection: mocks.ensure, collectionTargetActive: ({ sourceId }: any) => mocks.favorites.has(sourceId), subscribeCollection: (listener: () => void) => { mocks.favoriteChanged = listener; return () => { mocks.favoriteChanged = undefined; }; } }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.load } }));
vi.mock('../../services/styleRollChainArtists', async original => {
  const actual = await original<typeof import('../../services/styleRollChainArtists')>();
  return { ...actual, extractRollChainArtistTags: mocks.extract.mockImplementation(actual.extractRollChainArtistTags) };
});
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className, thumbnailVariant, onLoad }: any) => <img src={src} alt={alt} className={className} data-thumbnail-variant={thumbnailVariant} onLoad={onLoad} /> }));
const chain = (id: string, prompt: string, type: any = 'style'): PromptChain => ({
  id, type, name: `串 ${id}`, basePrompt: prompt, negativePrompt: 'artist:negative', modules: [], tags: [], description: '',
  params: createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, previewImage: `/${id}.png`, userId: 'synthetic', createdAt: 1, updatedAt: 1,
});
const known = new Set(['alpha', 'beta']);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.runtime = null; mocks.favorites.clear(); mocks.favoriteChanged = undefined;
  mocks.ensure.mockReset(); mocks.ensure.mockResolvedValue(undefined);
  setMobileImageDisplayPreferences({ layout: 'masonry', columns: 2, desktopColumns: 'auto' }, 'chains');
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe(target: Element) { this.callback([{ target, contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  mocks.load.mockResolvedValue([chain('a', '1.3::artist:alpha, artist:beta::'), chain('b', 'artist:beta, artist:gamma'), chain('empty', 'landscape')]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = (options = {}) => {
  const props = { knownArtists: known, blocked: [] as string[], onConfirm: vi.fn(), onClose: vi.fn(), ...options };
  return { ...render(<StyleRollChainArtistDialog {...props} />), props };
};
const dismissFor = (target: Element) => {
  const top = screen.queryByRole('dialog', { name: '画师 Tag' }) || screen.queryByRole('dialog', { name: '筛选' });
  if (top && !top.contains(target)) fireEvent.keyDown(window, { key: 'Escape' });
};
const click = (target: Element) => { dismissFor(target); fireEvent.click(target); };
const change = (target: Element, event: object) => { dismissFor(target); fireEvent.change(target, event); };
const openArtists = () => { const button = screen.getByRole('button', { name: '画师 Tag' }); if (button.getAttribute('aria-expanded') !== 'true') click(button); };
const artist = (name: string) => { openArtists(); return screen.getByRole('checkbox', { name }); };
const artists = (name: string) => { openArtists(); return screen.getAllByRole('checkbox', { name }); };
const findArtist = async (name: string) => { await waitFor(() => expect(screen.getByRole('button', { name: '画师 Tag' })).toHaveProperty('disabled', false)); return artist(name); };
const openFilters = () => { const button = screen.getByRole('button', { name: '筛选' }); if (button.getAttribute('aria-expanded') !== 'true') click(button); };
const filterButton = (name: string) => { openFilters(); return screen.getByRole('button', { name }); };
const filterSelect = (name: string) => { openFilters(); return screen.getByRole('combobox', { name }); };

it('操作全部位于图库上方，画师勾选浮层不插入图片布局，Escape先关闭浮层并归还焦点', async () => {
  const { props } = setup(); click(await screen.findByRole('checkbox', { name: '串 a' }));
  const main = screen.getByRole('dialog', { name: '从风格串提取' });
  const gallery = main.querySelector('.chain-masonry')!.parentElement!;
  expect(main.querySelector('footer')).toBeNull(); expect(main.lastElementChild).toBe(gallery);
  for (const label of ['使用画师库', '使用全部风格串', '设为抽取来源']) {
    expect(screen.getByRole('button', { name: label }).compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.queryByRole('checkbox', { name: 'alpha' })).toBeNull();
  const children = [...main.children], trigger = screen.getByRole('button', { name: '画师 Tag' });
  trigger.focus(); click(trigger);
  const popup = screen.getByRole('dialog', { name: '画师 Tag' });
  expect(main.contains(popup)).toBe(false); expect([...main.children]).toEqual(children); expect(main.lastElementChild).toBe(gallery);
  click(within(popup).getByRole('checkbox', { name: 'alpha' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '画师 Tag' })).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('dialog', { name: '从风格串提取' })).toBe(main); expect(props.onClose).not.toHaveBeenCalled();
  click(screen.getByRole('button', { name: '筛选' })); expect(screen.getByRole('dialog', { name: '筛选' })).toBeTruthy();
  click(trigger); expect(screen.queryByRole('dialog', { name: '筛选' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'alpha' })).toHaveProperty('checked', false);
  fireEvent.keyDown(window, { key: 'Escape' }); click(screen.getByRole('button', { name: '关闭' }));
  expect(props.onClose).toHaveBeenCalledOnce(); expect(props.onConfirm).not.toHaveBeenCalled();
});

it('多串同名画师累计机会，每串去重且一次确认替换来源，不传配置', async () => {
  const { props } = setup({ blocked: ['gamma'] });
  await screen.findByRole('checkbox', { name: '串 a' });
  expect(document.querySelector('img')!.getAttribute('src')).toBe('/a.png');
  click(screen.getByRole('checkbox', { name: '串 a' })); click(screen.getByRole('checkbox', { name: '串 b' }));
  expect(artists('beta')).toHaveLength(1);
  expect(artist('alpha')).toHaveProperty('disabled', false);
  expect(artist('gamma')).toHaveProperty('disabled', true);
  expect(screen.getByText('未识别到画师 Tag')).toBeTruthy();
  click(screen.getByRole('button', { name: '取消全选' })); expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  click(screen.getByRole('button', { name: '全选' }));
  click(screen.getByRole('button', { name: '设为抽取来源' })); click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ chainIds: ['a', 'b'], artists: [{ tag: 'alpha', count: 1 }, { tag: 'beta', count: 2 }] });
});

it('增删来源动态更新次数，取消勾选仅排除该画师，不改变其余机会', async () => {
  mocks.load.mockResolvedValue([chain('a', 'artist:alpha, artist:alpha, artist:beta'), chain('b', 'artist:beta, artist:gamma')]);
  const { props } = setup(); click(await screen.findByRole('checkbox', { name: '串 a' })); click(screen.getByRole('checkbox', { name: '串 b' }));
  expect(artist('beta').parentElement?.textContent).toContain('出现 2 次');
  click(screen.getByRole('checkbox', { name: '串 a' }));
  expect(artist('beta').parentElement?.textContent).toContain('出现 1 次');
  click(artist('gamma')); click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['b'], artists: [{ tag: 'beta', count: 1 }] });
});

it('来源画师超过64仍可确认，不受单张人数限制', async () => {
  mocks.load.mockResolvedValue([chain('many', Array.from({ length: 70 }, (_, i) => `artist:artist${i}`).join(', '))]);
  const { props } = setup(); click(await screen.findByRole('checkbox', { name: '串 many' }));
  click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm.mock.calls[0][0].artists).toHaveLength(70); expect(screen.queryByRole('alert')).toBeNull();
});

it('屏蔽名单全角与转义括号同义识别，提取不能绕过屏蔽', async () => {
  mocks.load.mockResolvedValue([chain('normalized', 'artist:alpha_name, artist:beta_name(style), artist:gamma')]);
  const { props } = setup({ blocked: ['Ａlpha_Name', 'beta_name\\(style\\)'] });
  click(await screen.findByRole('checkbox', { name: '串 normalized' }));
  expect(artist('alpha name')).toHaveProperty('disabled', true);
  expect(artist('beta name (style)')).toHaveProperty('disabled', true);
  click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['normalized'], artists: [{ tag: 'gamma', count: 1 }] });
});

it('重开恢复来源及画师勾选，再确认替换次数；取消不应用，显式清除才回全库', async () => {
  const source = { chainIds: ['a', 'b'], artists: [{ tag: 'beta', count: 2 }] };
  const view = setup({ source }); await screen.findByRole('checkbox', { name: '串 a' });
  expect(screen.getByRole('checkbox', { name: '串 a' }).getAttribute('aria-checked')).toBe('true');
  expect(artist('beta')).toHaveProperty('checked', true);
  expect(artist('alpha')).toHaveProperty('checked', false);
  expect(artist('gamma')).toHaveProperty('checked', false);
  click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(view.props.onConfirm).toHaveBeenCalledWith(source); view.unmount();
  const cancelled = setup({ source }); await findArtist('beta');
  click(screen.getByRole('checkbox', { name: '串 b' })); click(screen.getByRole('button', { name: '关闭' }));
  expect(cancelled.props.onConfirm).not.toHaveBeenCalled(); cancelled.unmount();
  const empty = setup(); await screen.findByRole('checkbox', { name: '串 a' });
  expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  expect(empty.props.onConfirm).not.toHaveBeenCalled();
  click(screen.getByRole('button', { name: '使用画师库' })); expect(empty.props.onConfirm).toHaveBeenCalledExactlyOnceWith(undefined);
});

it('缺失来源明确提示，只按本次读到的资料重算且不自动回写', async () => {
  const source = { chainIds: ['a', 'gone'], artists: [{ tag: 'alpha', count: 20 }, { tag: 'gone artist', count: 3 }] };
  const { props } = setup({ source }); await findArtist('alpha');
  expect(screen.getByRole('status').textContent).toContain('有 1 条来源风格串不可用');
  expect(props.onConfirm).not.toHaveBeenCalled(); expect(source.artists[0].count).toBe(20);
  click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['a'], artists: [{ tag: 'alpha', count: 1 }] });
});

it('仅风格及旧无type条目，完整库分页可搜索末项，勾选不重复解析', async () => {
  const legacy = chain('legacy', 'artist:beta'); delete (legacy as Partial<PromptChain>).type;
  mocks.load.mockResolvedValue([...Array.from({ length: 1001 }, (_, i) => chain(String(i), 'artist:alpha')), legacy, chain('character', 'artist:bad', 'character'), chain('preset', 'artist:bad', 'preset')]);
  setup(); await screen.findByRole('checkbox', { name: '串 0' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(60); const parsed = mocks.extract.mock.calls.length;
  click(screen.getByRole('checkbox', { name: '串 0' })); click(artist('alpha'));
  expect(mocks.extract).toHaveBeenCalledTimes(parsed);
  change(screen.getByRole('searchbox'), { target: { value: '1000' } }); expect(screen.getByRole('checkbox', { name: '串 1000' })).toBeTruthy();
  change(screen.getByRole('searchbox'), { target: { value: 'legacy' } }); expect(screen.getByRole('checkbox', { name: '串 legacy' })).toBeTruthy();
  change(screen.getByRole('searchbox'), { target: { value: 'character' } }); expect(screen.queryByRole('checkbox', { name: '串 character' })).toBeNull();
});

it('有画师筛选与名称交集先于分页，过滤不丢选择且不重解析', async () => {
  mocks.load.mockResolvedValue([...Array.from({ length: 75 }, (_, i) => chain(`empty ${i}`, 'landscape')), chain('late artist', 'artist:beta')]);
  const { props } = setup(); await screen.findByRole('checkbox', { name: '串 empty 0' });
  expect(screen.getByRole('checkbox', { name: '只看有画师 Tag' })).toHaveProperty('checked', false);
  click(screen.getByRole('checkbox', { name: '只看有画师 Tag' }));
  const card = screen.getByRole('checkbox', { name: '串 late artist' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  fireEvent.keyDown(card, { key: 'Enter' });
  const count = mocks.extract.mock.calls.length;
  change(screen.getByRole('searchbox'), { target: { value: 'empty' } });
  expect(screen.getByText('没有匹配的风格串')).toBeTruthy();
  expect(artist('beta')).toHaveProperty('checked', true);
  click(screen.getByRole('checkbox', { name: '只看有画师 Tag' }));
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(60);
  change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('checkbox', { name: '串 late artist' }).getAttribute('aria-checked')).toBe('true');
  expect(mocks.extract).toHaveBeenCalledTimes(count);
  click(screen.getByRole('button', { name: '设为抽取来源' })); expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['late artist'], artists: [{ tag: 'beta', count: 1 }] });
});

it.each(['masonry', 'portrait', 'square'] as const)('大图卡复用chains的%s布局与安全模式样式，图像完整且清晰', async layout => {
  setMobileImageDisplayPreferences({ layout, columns: 2, desktopColumns: 3 }, 'chains');
  setup(); const card = await screen.findByRole('checkbox', { name: '串 a' });
  expect(screen.getByRole('dialog').className).toContain('max-w-7xl');
  expect(screen.getByRole('dialog').className).toContain('h-[94dvh]');
  expect(card.className).toContain('gallery-card-visual'); expect(card.getAttribute('data-safe-mode-work')).toBe('true');
  expect(card.querySelector('.gallery-card-caption [data-safe-mode-title]')?.textContent).toBe('串 a');
  const img = card.querySelector('img')!;
  expect(img.className).toContain('object-contain'); expect(img.getAttribute('data-thumbnail-variant')).toBe('thumb-640');
  expect(card.querySelector('.mobile-gallery-frame')?.className).not.toContain('h-14');
  if (layout === 'masonry') expect(card.closest<HTMLElement>('.chain-masonry')?.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  else {
    const grid = card.closest<HTMLElement>(`.mobile-gallery--${layout}`)!;
    expect(grid.style.getPropertyValue('--mobile-gallery-cols-desktop')).toBe('3');
    expect(grid.style.getPropertyValue('--mobile-gallery-columns')).toBe('3');
  }
});

it('自动列数按弹窗实际宽度留足约240像素，显式列数保持优先', async () => {
  setup(); const card = await screen.findByRole('checkbox', { name: '串 a' });
  expect(card.closest<HTMLElement>('.chain-masonry')?.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  act(() => setMobileImageDisplayPreferences({ layout: 'masonry', columns: 2, desktopColumns: 6 }, 'chains'));
  expect(card.closest<HTMLElement>('.chain-masonry')?.style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
});

it('模型收藏待实测与AND标签交集，收藏刷新仍保留已选来源和Tag草稿', async () => {
  const a = chain('a', 'artist:alpha'), b = chain('b', 'artist:beta'), c = chain('c', 'artist:gamma');
  a.tags = ['red', 'blue', '待实测', 'AITag']; b.tags = ['red', '待实测']; c.tags = ['red', 'blue'];
  mocks.load.mockResolvedValue([a, b, c]); mocks.favorites.add('a'); mocks.favorites.add('c');
  setup(); click(await screen.findByRole('checkbox', { name: '串 a' }));
  click(screen.getByRole('button', { name: '筛选' }));
  change(filterSelect('模型筛选'), { target: { value: a.params.model } });
  click(filterButton('只看收藏')); click(filterButton('只看待实测'));
  await screen.findByRole('checkbox', { name: '串 a' });
  click(filterButton('red')); click(filterButton('blue'));
  expect(screen.getByText('同时包含所选标签')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'AITag' })).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  expect(screen.getByText('匹配 1 条 · 共 3 条')).toBeTruthy();
  act(() => { mocks.favorites.delete('a'); mocks.favoriteChanged?.(); });
  expect(screen.getByText('没有匹配的风格串')).toBeTruthy(); expect(artist('alpha')).toHaveProperty('checked', true);
  click(filterButton('重置筛选'));
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(3);
  expect(screen.getByRole('checkbox', { name: '串 a' }).getAttribute('aria-checked')).toBe('true');
});

it('无封面旧收藏保留，有图旧标记服从共用收藏；动态模型和缺省旧资料匹配', async () => {
  const bare = chain('bare', 'artist:alpha'), stale = chain('stale', 'artist:beta'), future = chain('future', 'artist:gamma');
  bare.previewImage = undefined; delete (bare.params as Partial<typeof bare.params>).model;
  future.params.model = 'nai-diffusion-6-full';
  localStorage.setItem('nai_chain_favs', JSON.stringify(['bare', 'stale']));
  mocks.runtime = { ...DEFAULT_NAI_RUNTIME, models: [...DEFAULT_NAI_RUNTIME.models, 'nai-diffusion-6-full'] };
  mocks.load.mockResolvedValue([bare, stale, future]); setup(); await screen.findByRole('checkbox', { name: '串 bare' });
  click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getAllByRole('option').some(option => option.getAttribute('value') === 'nai-diffusion-6-full')).toBe(true);
  click(filterButton('只看收藏'));
  await screen.findByRole('checkbox', { name: '串 bare' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1); expect(screen.getByRole('checkbox', { name: '串 bare' })).toBeTruthy();
  change(filterSelect('模型筛选'), { target: { value: 'nai-diffusion-4-5-full' } });
  expect(screen.getByRole('checkbox', { name: '串 bare' })).toBeTruthy();
  click(filterButton('重置筛选'));
  change(filterSelect('模型筛选'), { target: { value: 'nai-diffusion-6-full' } });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1); expect(screen.getByRole('checkbox', { name: '串 future' })).toBeTruthy();
});

it('收藏仅启用时冷初始化，等待不误报空结果，失败可重试或关闭筛选', async () => {
  let finish!: () => void;
  mocks.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { mocks.favorites.add('a'); resolve(); }; }));
  setup(); await screen.findByRole('checkbox', { name: '串 a' }); expect(mocks.ensure).not.toHaveBeenCalled();
  click(screen.getByRole('button', { name: '筛选' })); click(filterButton('只看收藏'));
  expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText('没有匹配的风格串')).toBeNull();
  expect(screen.queryByText(/匹配 0 条/)).toBeNull();
  await act(async () => finish()); expect(screen.getByRole('checkbox', { name: '串 a' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: '串 b' })).toBeNull();
  click(filterButton('只看收藏')); mocks.ensure.mockRejectedValueOnce(new Error('合成收藏读取失败'));
  click(filterButton('只看收藏')); await screen.findByText('合成收藏读取失败');
  expect(screen.queryByText('没有匹配的风格串')).toBeNull(); const calls = mocks.ensure.mock.calls.length;
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '串' } }); expect(mocks.ensure).toHaveBeenCalledTimes(calls);
  click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('checkbox', { name: '串 a' });
  expect(mocks.ensure).toHaveBeenCalledTimes(calls + 1);
  click(filterButton('只看收藏')); expect(screen.getByRole('checkbox', { name: '串 b' })).toBeTruthy();
});

it('增减来源与逐项勾选复用已识别缓存，不重新解析已有来源', async () => {
  setup(); await screen.findByRole('checkbox', { name: '串 a' });
  const initial = mocks.extract.mock.calls.length;
  click(screen.getByRole('checkbox', { name: '串 a' })); click(screen.getByRole('checkbox', { name: '串 b' }));
  click(artist('alpha')); click(screen.getByRole('checkbox', { name: '串 a' }));
  expect(mocks.extract).toHaveBeenCalledTimes(initial);
  expect(artist('beta').parentElement?.textContent).toContain('出现 1 次');
});

it('随机从完整筛选结果无放回替换草稿，末页所选优先显示，确认后才应用来源', async () => {
  mocks.load.mockResolvedValue(Array.from({ length: 71 }, (_, i) => chain(String(i), `artist:tag${i}, artist:shared`)));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
  const view = setup(); await screen.findByRole('checkbox', { name: '串 0' });
  expect(screen.getByRole('spinbutton', { name: '随机选取风格串数量' })).toHaveProperty('value', '3');
  click(screen.getByRole('checkbox', { name: '串 1' })); click(artist('shared'));
  change(screen.getByRole('spinbutton'), { target: { value: '2' } }); click(screen.getByRole('button', { name: '随机选取' }));
  expect(screen.getByRole('checkbox', { name: '串 70' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: '串 0' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: '串 1' }).getAttribute('aria-checked')).toBe('false');
  expect(artist('shared')).toHaveProperty('checked', false);
  expect(view.props.onConfirm).not.toHaveBeenCalled(); const parsed = mocks.extract.mock.calls.length;
  click(screen.getByRole('button', { name: '随机选取' })); expect(mocks.extract).toHaveBeenCalledTimes(parsed);
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '串' } });
  expect(screen.queryByRole('checkbox', { name: '串 70' })).toBeNull();
  click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(view.props.onConfirm).toHaveBeenCalledWith({ chainIds: ['0', '70'], artists: [{ tag: 'tag0', count: 1 }, { tag: 'tag70', count: 1 }] });
  random.mockRestore();
});

it('不同随机值产生不同无重复集合，遵循名称和标签交集及可用Tag约束', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => chain(String(i), i === 4 ? 'artist:blocked' : i === 5 ? 'landscape' : `artist:tag${i}`));
  for (const row of rows) row.tags = ['allowed']; rows[0].tags = ['other'];
  mocks.load.mockResolvedValue(rows); const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const { props } = setup({ blocked: ['blocked'] }); await screen.findByRole('checkbox', { name: '串 0' });
  click(screen.getByRole('button', { name: '筛选' })); click(filterButton('allowed'));
  fireEvent.keyDown(window, { key: 'Escape' }); change(screen.getByRole('spinbutton'), { target: { value: '2' } });
  click(screen.getByRole('button', { name: '随机选取' }));
  const selected = () => screen.getAllByRole('checkbox', { name: /^串 / }).filter(card => card.getAttribute('aria-checked') === 'true').map(card => card.getAttribute('aria-label'));
  expect(selected()).toEqual(['串 1', '串 2']);
  random.mockReturnValue(0.999); click(screen.getByRole('button', { name: '随机选取' }));
  expect(new Set(selected())).toEqual(new Set(['串 3', '串 1'])); expect(selected()).toHaveLength(2);
  expect(props.onConfirm).not.toHaveBeenCalled();
  click(screen.getByRole('button', { name: '关闭' })); expect(props.onConfirm).not.toHaveBeenCalled(); random.mockRestore();
});

it.each(['0', '-1', '1.5', '', '4'])('随机数量%s非法或不足时保留原选择，不静默少抽', async value => {
  const { props } = setup(); click(await screen.findByRole('checkbox', { name: '串 a' }));
  change(screen.getByRole('spinbutton'), { target: { value } }); click(screen.getByRole('button', { name: '随机选取' }));
  expect(screen.getByRole('checkbox', { name: '串 a' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('alert').textContent).toContain(value === '4' ? '当前可随机选取 2 条风格串' : '请填写正整数');
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('所有可用Tag被取消后不进入随机池，资料与收藏未就绪或隐藏禁止随机', async () => {
  let finish!: (value: PromptChain[]) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = setup(); expect(screen.getByRole('button', { name: '随机选取' })).toHaveProperty('disabled', true);
  await act(async () => finish([chain('a', 'artist:alpha')])); click(screen.getByRole('checkbox', { name: '串 a' }));
  click(artist('alpha')); change(screen.getByRole('spinbutton'), { target: { value: '1' } });
  click(screen.getByRole('button', { name: '随机选取' })); expect(screen.getByRole('alert').textContent).toContain('当前可随机选取 0 条');
  mocks.ensure.mockRejectedValueOnce(new Error('合成收藏错误')); click(screen.getByRole('button', { name: '筛选' })); click(filterButton('只看收藏'));
  expect(screen.getByRole('button', { name: '随机选取' })).toHaveProperty('disabled', true); await screen.findByText('合成收藏错误');
  expect(screen.getByRole('button', { name: '随机选取' })).toHaveProperty('disabled', true);
  view.rerender(<ImageActivityProvider active={false}><StyleRollChainArtistDialog {...view.props} /></ImageActivityProvider>);
  expect(screen.getByRole('button', { name: '随机选取', hidden: true })).toHaveProperty('disabled', true); expect(view.props.onConfirm).not.toHaveBeenCalled();
});

it('使用全部风格串越过筛选分页和旧勾选，跨串频次去重且一次直接应用', async () => {
  const all = Array.from({ length: 65 }, (_, index) => chain(String(index), 'artist:Ａlpha_Name, artist:alpha name, artist:blocked'));
  all[0].negativePrompt = 'artist:negative'; all[0].modules = [{ id: 'off', name: '停用', content: 'artist:disabled', isActive: false }];
  const legacy = chain('legacy', 'artist:beta'); delete (legacy as Partial<PromptChain>).type;
  mocks.load.mockResolvedValue([...all, legacy, chain('character', 'artist:character', 'character'), chain('preset', 'artist:preset', 'preset')]);
  const { props } = setup({ blocked: ['blocked'] }); await screen.findByRole('checkbox', { name: '串 0' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(60);
  click(screen.getByRole('checkbox', { name: '串 0' })); click(artist('alpha name'));
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '无匹配筛选' } }); expect(screen.getByText('没有匹配的风格串')).toBeTruthy();
  click(screen.getByRole('button', { name: '使用全部风格串' })); click(screen.getByRole('button', { name: '使用全部风格串' }));
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ chainIds: [...all.map(item => item.id), 'legacy'], artists: [{ tag: 'alpha name', count: 65 }, { tag: 'beta', count: 1 }] });
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(mocks.extract.mock.calls).toHaveLength(66);
  expect(new Set(mocks.extract.mock.calls.map(([item]) => item.id)).size).toBe(66);
});

it('全库没有可用画师时保留当前source和草稿，不关闭或回退画师库', async () => {
  const source = { chainIds: ['empty'], artists: [] };
  mocks.load.mockResolvedValue([chain('empty', 'artist:blocked, landscape')]);
  const { props } = setup({ source, blocked: ['blocked'] });
  click(await screen.findByRole('checkbox', { name: '串 empty' }));
  click(screen.getByRole('button', { name: '使用全部风格串' }));
  expect(screen.getByRole('alert').textContent).toBe('风格串中没有可用的画师 Tag');
  expect(props.onConfirm).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  expect(source).toEqual({ chainIds: ['empty'], artists: [] });
  expect(screen.getByRole('checkbox', { name: '串 empty' }).getAttribute('aria-checked')).toBe('false');
});

it('整库动作不依赖收藏读取，但资料加载失败和隐藏不能应用', async () => {
  mocks.ensure.mockRejectedValueOnce(new Error('合成收藏失败'));
  const view = setup(); await screen.findByRole('checkbox', { name: '串 a' });
  click(screen.getByRole('button', { name: '筛选' })); click(filterButton('只看收藏'));
  await screen.findByText('合成收藏失败'); expect(screen.getByRole('button', { name: '使用全部风格串' })).toHaveProperty('disabled', false);
  click(screen.getByRole('button', { name: '使用全部风格串' })); expect(view.props.onConfirm).toHaveBeenCalledOnce(); view.unmount();
  let finish!: (value: PromptChain[]) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = setup(); expect(screen.getByRole('button', { name: '使用全部风格串' })).toHaveProperty('disabled', true);
  pending.rerender(<ImageActivityProvider active={false}><StyleRollChainArtistDialog {...pending.props} /></ImageActivityProvider>);
  await act(async () => finish([chain('late', 'artist:alpha')]));
  expect(screen.getByRole('button', { name: '使用全部风格串', hidden: true })).toHaveProperty('disabled', true); expect(pending.props.onConfirm).not.toHaveBeenCalled(); pending.unmount();
  mocks.load.mockRejectedValueOnce(new Error('合成资料失败')); const failed = setup(); await screen.findByText('合成资料失败');
  expect(screen.getByRole('button', { name: '使用全部风格串' })).toHaveProperty('disabled', true); expect(failed.props.onConfirm).not.toHaveBeenCalled();
});

it('搜索名称或说明不搜索Prompt，标签搜索完整选项且四种排序稳定', async () => {
  const a = chain('a', 'artist:alpha'), b = chain('b', 'artist:beta'), c = chain('c', 'artist:gamma');
  a.description = 'needle'; a.createdAt = 10; a.updatedAt = 30; b.createdAt = 20; b.updatedAt = 40; c.createdAt = 20; c.updatedAt = 0;
  a.tags = Array.from({ length: 14 }, (_, i) => `分类${i}`); b.tags = ['other'];
  mocks.load.mockResolvedValue([a, b, c]); setup(); await screen.findByRole('checkbox', { name: '串 a' });
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: 'needle' } }); expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: 'artist:alpha' } }); expect(screen.getByText('没有匹配的风格串')).toBeTruthy();
  change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '' } });
  click(screen.getByRole('button', { name: '筛选' }));
  const names = () => screen.getAllByRole('checkbox', { name: /^串 / }).map(card => card.getAttribute('aria-label'));
  expect(names()).toEqual(['串 b', '串 a', '串 c']);
  change(filterSelect('排序'), { target: { value: 'updated_asc' } }); expect(names()).toEqual(['串 c', '串 a', '串 b']);
  change(filterSelect('排序'), { target: { value: 'created_desc' } }); expect(names()).toEqual(['串 b', '串 c', '串 a']);
  change(filterSelect('排序'), { target: { value: 'created_asc' } }); expect(names()).toEqual(['串 a', '串 b', '串 c']);
  change(screen.getByRole('searchbox', { name: '搜索自定义标签' }), { target: { value: '分类13' } });
  expect(filterButton('分类13')).toBeTruthy(); expect(screen.queryByRole('button', { name: '分类0' })).toBeNull();
  click(filterButton('分类13')); expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
});

it('空自定义标签范围显示真实空态，不把系统标签当用户分类', async () => {
  const a = chain('a', 'artist:alpha'); a.tags = ['待实测', 'AITag', '__internal__']; mocks.load.mockResolvedValue([a]);
  setup(); await screen.findByRole('checkbox', { name: '串 a' }); click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('暂无自定义标签')).toBeTruthy(); expect(screen.queryByRole('button', { name: '待实测' })).toBeNull();
});

it('读取失败不能确认，重试取得最新本地库；关闭后的迟到读取不应用', async () => {
  mocks.load.mockRejectedValueOnce(new Error('合成读取失败')); const view = setup();
  await screen.findByText('合成读取失败'); expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('checkbox', { name: '串 a' });
  expect(mocks.load).toHaveBeenCalledTimes(2); view.unmount();
  let finish!: (value: PromptChain[]) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = setup(); await screen.findByText('加载中…'); pending.unmount();
  await act(async () => finish([chain('late', 'artist:alpha')])); expect(pending.props.onConfirm).not.toHaveBeenCalled(); expect(screen.queryByText('串 late')).toBeNull();
});

it('真实Portal焦点圈禁与Escape归还只关闭提取层，取消不写来源', async () => {
  const apply = vi.fn();
  const Fixture = () => { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>打开</button>{open && <StyleRollChainArtistDialog knownArtists={known} blocked={[]} onConfirm={apply} onClose={() => setOpen(false)} />}</>; };
  render(<Fixture />); const trigger = screen.getByRole('button', { name: '打开' }); trigger.focus(); click(trigger);
  const dialog = await screen.findByRole('dialog'); await screen.findByRole('checkbox', { name: '串 a' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  const lastCard = within(dialog).getByRole('checkbox', { name: '串 empty' }); lastCard.focus();
  fireEvent.keyDown(window, { key: 'Tab' }); expect(dialog.contains(document.activeElement)).toBe(true);
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(apply).not.toHaveBeenCalled();
});

it('保活页面隐藏时释放窗口键盘且不能应用旧选择', async () => {
  const view = setup(); await screen.findByRole('checkbox', { name: '串 a' }); click(screen.getByRole('checkbox', { name: '串 a' }));
  view.rerender(<ImageActivityProvider active={false}><StyleRollChainArtistDialog {...view.props} /></ImageActivityProvider>);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(view.props.onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(view.props.onConfirm).not.toHaveBeenCalled();
});
