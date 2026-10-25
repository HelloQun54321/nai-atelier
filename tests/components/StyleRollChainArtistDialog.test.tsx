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

it('多串同名画师累计机会，每串去重且一次确认替换来源，不传配置', async () => {
  const { props } = setup({ blocked: ['gamma'] });
  await screen.findByRole('checkbox', { name: '串 a' });
  expect(document.querySelector('img')!.getAttribute('src')).toBe('/a.png');
  fireEvent.click(screen.getByRole('checkbox', { name: '串 a' })); fireEvent.click(screen.getByRole('checkbox', { name: '串 b' }));
  expect(screen.getAllByRole('checkbox', { name: 'beta' })).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'alpha' })).toHaveProperty('disabled', false);
  expect(screen.getByRole('checkbox', { name: 'gamma' })).toHaveProperty('disabled', true);
  expect(screen.getByText('未识别到画师 Tag')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消全选' })); expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' })); fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ chainIds: ['a', 'b'], artists: [{ tag: 'alpha', count: 1 }, { tag: 'beta', count: 2 }] });
});

it('增删来源动态更新次数，取消勾选仅排除该画师，不改变其余机会', async () => {
  mocks.load.mockResolvedValue([chain('a', 'artist:alpha, artist:alpha, artist:beta'), chain('b', 'artist:beta, artist:gamma')]);
  const { props } = setup(); fireEvent.click(await screen.findByRole('checkbox', { name: '串 a' })); fireEvent.click(screen.getByRole('checkbox', { name: '串 b' }));
  expect(screen.getByRole('checkbox', { name: 'beta' }).parentElement?.textContent).toContain('出现 2 次');
  fireEvent.click(screen.getByRole('checkbox', { name: '串 a' }));
  expect(screen.getByRole('checkbox', { name: 'beta' }).parentElement?.textContent).toContain('出现 1 次');
  fireEvent.click(screen.getByRole('checkbox', { name: 'gamma' })); fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['b'], artists: [{ tag: 'beta', count: 1 }] });
});

it('来源画师超过64仍可确认，不受单张人数限制', async () => {
  mocks.load.mockResolvedValue([chain('many', Array.from({ length: 70 }, (_, i) => `artist:artist${i}`).join(', '))]);
  const { props } = setup(); fireEvent.click(await screen.findByRole('checkbox', { name: '串 many' }));
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm.mock.calls[0][0].artists).toHaveLength(70); expect(screen.queryByRole('alert')).toBeNull();
});

it('屏蔽名单全角与转义括号同义识别，提取不能绕过屏蔽', async () => {
  mocks.load.mockResolvedValue([chain('normalized', 'artist:alpha_name, artist:beta_name(style), artist:gamma')]);
  const { props } = setup({ blocked: ['Ａlpha_Name', 'beta_name\\(style\\)'] });
  fireEvent.click(await screen.findByRole('checkbox', { name: '串 normalized' }));
  expect(screen.getByRole('checkbox', { name: 'alpha name' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('checkbox', { name: 'beta name (style)' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['normalized'], artists: [{ tag: 'gamma', count: 1 }] });
});

it('重开恢复来源及画师勾选，再确认替换次数；取消不应用，显式清除才回全库', async () => {
  const source = { chainIds: ['a', 'b'], artists: [{ tag: 'beta', count: 2 }] };
  const view = setup({ source }); await screen.findByRole('checkbox', { name: '串 a' });
  expect(screen.getByRole('checkbox', { name: '串 a' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: 'beta' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'alpha' })).toHaveProperty('checked', false);
  expect(screen.getByRole('checkbox', { name: 'gamma' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(view.props.onConfirm).toHaveBeenCalledWith(source); view.unmount();
  const cancelled = setup({ source }); await screen.findByRole('checkbox', { name: 'beta' });
  fireEvent.click(screen.getByRole('checkbox', { name: '串 b' })); fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(cancelled.props.onConfirm).not.toHaveBeenCalled(); cancelled.unmount();
  const empty = setup(); await screen.findByRole('checkbox', { name: '串 a' });
  expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  expect(empty.props.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '使用全部画师' })); expect(empty.props.onConfirm).toHaveBeenCalledExactlyOnceWith(undefined);
});

it('缺失来源明确提示，只按本次读到的资料重算且不自动回写', async () => {
  const source = { chainIds: ['a', 'gone'], artists: [{ tag: 'alpha', count: 20 }, { tag: 'gone artist', count: 3 }] };
  const { props } = setup({ source }); await screen.findByRole('checkbox', { name: 'alpha' });
  expect(screen.getByRole('status').textContent).toContain('有 1 条来源风格串不可用');
  expect(props.onConfirm).not.toHaveBeenCalled(); expect(source.artists[0].count).toBe(20);
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' }));
  expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['a'], artists: [{ tag: 'alpha', count: 1 }] });
});

it('仅风格及旧无type条目，完整库分页可搜索末项，勾选不重复解析', async () => {
  const legacy = chain('legacy', 'artist:beta'); delete (legacy as Partial<PromptChain>).type;
  mocks.load.mockResolvedValue([...Array.from({ length: 1001 }, (_, i) => chain(String(i), 'artist:alpha')), legacy, chain('character', 'artist:bad', 'character'), chain('preset', 'artist:bad', 'preset')]);
  setup(); await screen.findByRole('checkbox', { name: '串 0' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(60); const parsed = mocks.extract.mock.calls.length;
  fireEvent.click(screen.getByRole('checkbox', { name: '串 0' })); fireEvent.click(screen.getByRole('checkbox', { name: 'alpha' }));
  expect(mocks.extract).toHaveBeenCalledTimes(parsed);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '1000' } }); expect(screen.getByRole('checkbox', { name: '串 1000' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'legacy' } }); expect(screen.getByRole('checkbox', { name: '串 legacy' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'character' } }); expect(screen.queryByRole('checkbox', { name: '串 character' })).toBeNull();
});

it('有画师筛选与名称交集先于分页，过滤不丢选择且不重解析', async () => {
  mocks.load.mockResolvedValue([...Array.from({ length: 75 }, (_, i) => chain(`empty ${i}`, 'landscape')), chain('late artist', 'artist:beta')]);
  const { props } = setup(); await screen.findByRole('checkbox', { name: '串 empty 0' });
  expect(screen.getByRole('checkbox', { name: '只看有画师 Tag' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('checkbox', { name: '只看有画师 Tag' }));
  const card = screen.getByRole('checkbox', { name: '串 late artist' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  fireEvent.keyDown(card, { key: 'Enter' });
  const count = mocks.extract.mock.calls.length;
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'empty' } });
  expect(screen.getByText('没有匹配的风格串')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'beta' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '只看有画师 Tag' }));
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(60);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('checkbox', { name: '串 late artist' }).getAttribute('aria-checked')).toBe('true');
  expect(mocks.extract).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole('button', { name: '设为抽取来源' })); expect(props.onConfirm).toHaveBeenCalledWith({ chainIds: ['late artist'], artists: [{ tag: 'beta', count: 1 }] });
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
  setup(); fireEvent.click(await screen.findByRole('checkbox', { name: '串 a' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '模型筛选' }), { target: { value: a.params.model } });
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' })); fireEvent.click(screen.getByRole('button', { name: '只看待实测' }));
  await screen.findByRole('checkbox', { name: '串 a' });
  fireEvent.click(screen.getByRole('button', { name: 'red' })); fireEvent.click(screen.getByRole('button', { name: 'blue' }));
  expect(screen.getByText('同时包含所选标签')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'AITag' })).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  expect(screen.getByText('匹配 1 条 · 共 3 条')).toBeTruthy();
  act(() => { mocks.favorites.delete('a'); mocks.favoriteChanged?.(); });
  expect(screen.getByText('没有匹配的风格串')).toBeTruthy(); expect(screen.getByRole('checkbox', { name: 'alpha' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
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
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getAllByRole('option').some(option => option.getAttribute('value') === 'nai-diffusion-6-full')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
  await screen.findByRole('checkbox', { name: '串 bare' });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1); expect(screen.getByRole('checkbox', { name: '串 bare' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '模型筛选' }), { target: { value: 'nai-diffusion-4-5-full' } });
  expect(screen.getByRole('checkbox', { name: '串 bare' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '模型筛选' }), { target: { value: 'nai-diffusion-6-full' } });
  expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1); expect(screen.getByRole('checkbox', { name: '串 future' })).toBeTruthy();
});

it('收藏仅启用时冷初始化，等待不误报空结果，失败可重试或关闭筛选', async () => {
  let finish!: () => void;
  mocks.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { mocks.favorites.add('a'); resolve(); }; }));
  setup(); await screen.findByRole('checkbox', { name: '串 a' }); expect(mocks.ensure).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
  expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText('没有匹配的风格串')).toBeNull();
  expect(screen.queryByText(/匹配 0 条/)).toBeNull();
  await act(async () => finish()); expect(screen.getByRole('checkbox', { name: '串 a' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: '串 b' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' })); mocks.ensure.mockRejectedValueOnce(new Error('合成收藏读取失败'));
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' })); await screen.findByText('合成收藏读取失败');
  expect(screen.queryByText('没有匹配的风格串')).toBeNull(); const calls = mocks.ensure.mock.calls.length;
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '串' } }); expect(mocks.ensure).toHaveBeenCalledTimes(calls);
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('checkbox', { name: '串 a' });
  expect(mocks.ensure).toHaveBeenCalledTimes(calls + 1);
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' })); expect(screen.getByRole('checkbox', { name: '串 b' })).toBeTruthy();
});

it('增减来源与逐项勾选复用已识别缓存，不重新解析已有来源', async () => {
  setup(); await screen.findByRole('checkbox', { name: '串 a' });
  const initial = mocks.extract.mock.calls.length;
  fireEvent.click(screen.getByRole('checkbox', { name: '串 a' })); fireEvent.click(screen.getByRole('checkbox', { name: '串 b' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'alpha' })); fireEvent.click(screen.getByRole('checkbox', { name: '串 a' }));
  expect(mocks.extract).toHaveBeenCalledTimes(initial);
  expect(screen.getByRole('checkbox', { name: 'beta' }).parentElement?.textContent).toContain('出现 1 次');
});

it('搜索名称或说明不搜索Prompt，标签搜索完整选项且四种排序稳定', async () => {
  const a = chain('a', 'artist:alpha'), b = chain('b', 'artist:beta'), c = chain('c', 'artist:gamma');
  a.description = 'needle'; a.createdAt = 10; a.updatedAt = 30; b.createdAt = 20; b.updatedAt = 40; c.createdAt = 20; c.updatedAt = 0;
  a.tags = Array.from({ length: 14 }, (_, i) => `分类${i}`); b.tags = ['other'];
  mocks.load.mockResolvedValue([a, b, c]); setup(); await screen.findByRole('checkbox', { name: '串 a' });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: 'needle' } }); expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: 'artist:alpha' } }); expect(screen.getByText('没有匹配的风格串')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索风格串' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const names = () => screen.getAllByRole('checkbox', { name: /^串 / }).map(card => card.getAttribute('aria-label'));
  expect(names()).toEqual(['串 b', '串 a', '串 c']);
  fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'updated_asc' } }); expect(names()).toEqual(['串 c', '串 a', '串 b']);
  fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'created_desc' } }); expect(names()).toEqual(['串 b', '串 c', '串 a']);
  fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'created_asc' } }); expect(names()).toEqual(['串 a', '串 b', '串 c']);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索自定义标签' }), { target: { value: '分类13' } });
  expect(screen.getByRole('button', { name: '分类13' })).toBeTruthy(); expect(screen.queryByRole('button', { name: '分类0' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分类13' })); expect(screen.getAllByRole('checkbox', { name: /^串 / })).toHaveLength(1);
});

it('空自定义标签范围显示真实空态，不把系统标签当用户分类', async () => {
  const a = chain('a', 'artist:alpha'); a.tags = ['待实测', 'AITag', '__internal__']; mocks.load.mockResolvedValue([a]);
  setup(); await screen.findByRole('checkbox', { name: '串 a' }); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByText('暂无自定义标签')).toBeTruthy(); expect(screen.queryByRole('button', { name: '待实测' })).toBeNull();
});

it('读取失败不能确认，重试取得最新本地库；关闭后的迟到读取不应用', async () => {
  mocks.load.mockRejectedValueOnce(new Error('合成读取失败')); const view = setup();
  await screen.findByText('合成读取失败'); expect(screen.getByRole('button', { name: '设为抽取来源' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('checkbox', { name: '串 a' });
  expect(mocks.load).toHaveBeenCalledTimes(2); view.unmount();
  let finish!: (value: PromptChain[]) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = setup(); await screen.findByText('加载中…'); pending.unmount();
  await act(async () => finish([chain('late', 'artist:alpha')])); expect(pending.props.onConfirm).not.toHaveBeenCalled(); expect(screen.queryByText('串 late')).toBeNull();
});

it('真实Portal焦点圈禁与Escape归还只关闭提取层，取消不写来源', async () => {
  const apply = vi.fn();
  const Fixture = () => { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>打开</button>{open && <StyleRollChainArtistDialog knownArtists={known} blocked={[]} onConfirm={apply} onClose={() => setOpen(false)} />}</>; };
  render(<Fixture />); const trigger = screen.getByRole('button', { name: '打开' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog'); await screen.findByRole('checkbox', { name: '串 a' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  const cancel = within(dialog).getByRole('button', { name: '取消' }); cancel.focus();
  fireEvent.keyDown(window, { key: 'Tab' }); expect(dialog.contains(document.activeElement)).toBe(true);
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(apply).not.toHaveBeenCalled();
});

it('保活页面隐藏时释放窗口键盘且不能应用旧选择', async () => {
  const view = setup(); await screen.findByRole('checkbox', { name: '串 a' }); fireEvent.click(screen.getByRole('checkbox', { name: '串 a' }));
  view.rerender(<ImageActivityProvider active={false}><StyleRollChainArtistDialog {...view.props} /></ImageActivityProvider>);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(view.props.onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(view.props.onConfirm).not.toHaveBeenCalled();
});
