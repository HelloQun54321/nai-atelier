// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CharacterLibrary } from '../../components/CharacterLibrary';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import type { PromptChain } from '../../types';
const mocks = vi.hoisted(() => ({ page: vi.fn(), all: vi.fn(), at: vi.fn(), save: vi.fn(), coverCallbacks: new Map<string, any>(), collection: [] as any[], listeners: new Set<() => void>(), ensure: vi.fn(), favorite: vi.fn(), state: { revision: 1, groups: [{ id: 'one', name: '甲组' }, { id: 'two', name: '乙组' }], memberships: { 'catalog:late': ['one', 'two'], 'custom:custom': ['two'] } } }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: async () => structuredClone(mocks.state), put: async (_path: string, value: any) => { await mocks.save(value); mocks.state = { ...value, revision: value.revision + 1 }; return mocks.state; } } }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getCharacterDictionaryPage: mocks.page, getCharacterDictionaryEntries: mocks.all, getCharacterDictionaryEntriesAt: mocks.at, searchCharacterDictionary: async () => [] }));
vi.mock('../../services/collectionFavorites', async original => ({ ...await original<typeof import('../../services/collectionFavorites')>(), collectionSnapshot: () => mocks.collection, subscribeCollection: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); }, collectionTargetActive: () => false, ensureCollection: mocks.ensure, toggleCollectionTarget: mocks.favorite }));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: (props: any) => { const { tag, onEdit } = props; mocks.coverCallbacks.set(tag, props); return <span>{tag}{onEdit && <button type="button" aria-label={'编辑角色信息:' + tag} onClick={onEdit}>编辑</button>}</span>; } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 3, ShortestColumnMasonry: ({ items, renderItem }: any) => <div>{items.map(renderItem)}</div> }));
const entries = [{ name: 'early', chinese: '首页', postCount: 100 }, { name: 'late', chinese: '同名', postCount: 1 }, { name: 'other', chinese: '其他', postCount: 2 }];
const custom = { id: 'custom', name: '同名', type: 'character', basePrompt: 'custom content', negativePrompt: '', modules: [], tags: [], params: createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, variableValues: {}, createdAt: 1, updatedAt: 1, userId: 'owner', description: '' } as PromptChain;
beforeEach(() => {
  vi.clearAllMocks(); mocks.save.mockReset(); mocks.coverCallbacks.clear(); localStorage.clear();
  mocks.collection = []; mocks.listeners.clear(); mocks.ensure.mockReset().mockResolvedValue(undefined); mocks.favorite.mockReset().mockResolvedValue(true);
  mocks.state = { revision: 1, groups: [{ id: 'one', name: '甲组' }, { id: 'two', name: '乙组' }], memberships: { 'catalog:late': ['one', 'two'], 'custom:custom': ['two'] } };
  mocks.page.mockImplementation(async (page: number) => ({ entries: page ? entries.slice(1) : entries.slice(0, 1), page, pageCount: 2, pageSize: 1, total: 3 }));
  mocks.all.mockResolvedValue(entries); mocks.at.mockImplementation(async (indices: number[]) => indices.map(index => entries[index]));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IntersectionObserver', class { callback: IntersectionObserverCallback; constructor(callback: IntersectionObserverCallback) { this.callback = callback; } observe(target: Element) { if (target.classList.contains('bg-gray-200')) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = () => render(<CharacterLibrary chains={[custom]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
const select = async (id: string) => {
  if (!screen.queryByRole('combobox', { name: '选择分组' })) fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  await waitFor(() => expect(within(screen.getByRole('combobox', { name: '选择分组' })).getByRole('option', { name: /^甲组 \(/ })).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: id } });
};
it('来源目录与用户分组可切换，来源搜索按身份过滤且同名角色不混淆', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  setup(); await screen.findByRole('button', { name: '选择角色：同名' });
  await waitFor(() => expect(mocks.all).toHaveBeenCalledOnce());
  await select('one');
  await waitFor(() => expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(1));
  expect(screen.queryByRole('button', { name: '选择角色：首页' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await select('two');
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '选择角色：同名' }).getAttribute('data-gallery-work-id')).toBe('custom:custom');
  expect(screen.getByRole('button', { name: '自定义' }).getAttribute('aria-current')).toBe('page');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.queryByRole('button', { name: '选择角色：同名' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await select('two');
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2);
});

it('来源目录显示完整计数且随自定义角色新增删除即时更新，不写入分组或进入分组设置', async () => {
  const view = setup();
  await select('#source:catalog');
  expect(screen.getByRole('option', { name: 'danbooru (3)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '自定义 (1)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('option', { name: 'danbooru (3)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '自定义 (1)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await select('#source:custom');
  expect(screen.getAllByRole('button', { name: /选择角色：/ })).toHaveLength(1);
  view.rerender(<CharacterLibrary chains={[custom, { ...custom, id: 'new-custom', name: '新角色' }]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByRole('option', { name: '自定义 (2)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择角色：新角色' })).toBeTruthy();
  view.rerender(<CharacterLibrary chains={[custom]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByRole('option', { name: '自定义 (1)' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择角色：新角色' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重命名分组' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除分组' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '选择角色：同名' }));
  dragTo('custom:custom', '自定义');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.state.memberships['custom:custom']).toEqual(['two']);
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  expect(screen.queryByRole('checkbox', { name: 'danbooru' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '自定义' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(mocks.save).not.toHaveBeenCalled();
});
it('收展保留跨筛选选择，设组使用全部稳定键；切组退出随机但收展不退出', async () => {
  setup(); await select('two');
  await waitFor(() => expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2));
  screen.getAllByRole('button', { name: '选择角色：同名' }).forEach(card => fireEvent.click(card));
  await select('one');
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.getByRole('button', { name: '设置分组' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  expect(screen.getByRole('dialog', { name: '设置分组' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '甲组' }));
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships['custom:custom']).toEqual(['two', 'one']);
  expect(mocks.save.mock.calls[0][0].memberships['catalog:late']).toEqual(['one', 'two']);
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(screen.queryByRole('button', { name: '选择角色：首页' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.getByRole('button', { name: '再抽一批' })).toBeTruthy();
  await select('#source:custom'); expect(screen.getByRole('button', { name: '随机抽卡' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '设置分组' })).toBeTruthy();
});
it('全部仍分页加载，未分组随机只取没有分组的词库和自定义身份', async () => {
  setup(); await screen.findByRole('button', { name: '选择角色：首页' });
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2));
  await select(''); await waitFor(() => expect(screen.queryByRole('button', { name: '选择角色：同名' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(screen.queryByRole('button', { name: '选择角色：同名' })).toBeNull();
  expect(mocks.at).not.toHaveBeenCalled();
});

it('仅有自定义成员的组在混合随机下仍可抽取，不补入全词库', async () => {
  mocks.state.memberships = { 'catalog:late': ['one'], 'custom:custom': ['two'] };
  setup(); await select('two');
  await waitFor(() => expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(screen.getAllByRole('button', { name: /选择角色：/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  expect(mocks.at).not.toHaveBeenCalled();
});

it('danbooru来源下抽卡只包含词库角色，手机目录选项可选择两个来源', async () => {
  setup(); await select('#source:catalog');
  const selector = screen.getByRole('combobox', { name: '选择分组' });
  expect(within(selector).getByRole('option', { name: 'danbooru (3)' })).toBeTruthy();
  expect(within(selector).getByRole('option', { name: '自定义 (1)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  const mode = screen.getByRole('combobox', { name: '抽卡范围' }) as HTMLSelectElement;
  expect(mode.value).toBe('catalog'); expect(mode.disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  const drawn = screen.getAllByRole('button', { name: /选择角色：/ });
  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.every(card => card.getAttribute('data-gallery-work-id')?.startsWith('catalog:'))).toBe(true);
  expect(mocks.at).not.toHaveBeenCalled();
});

it('角色候选宽高先预估瀑布流比例，同一候选重渲染不覆盖图片自然尺寸', async () => {
  setup();
  const card = await screen.findByRole('button', { name: '选择角色：首页' });
  const frame = card.querySelector<HTMLElement>('.mobile-gallery-frame')!;
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('2 / 3');
  await act(async () => mocks.coverCallbacks.get('early').onCandidateChange({ id: 12, sampleUrl: '/sample.jpg', width: 1200, height: 800 }));
  await waitFor(() => expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('1500 / 1000'));
  await act(async () => mocks.coverCallbacks.get('early').onImageLoad(800, 1000));
  await waitFor(() => expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('800 / 1000'));
  await act(async () => mocks.coverCallbacks.get('early').onCandidateChange({ id: 12, sampleUrl: '/sample.jpg', width: 1200, height: 800 }));
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('800 / 1000');
});

it('分组只抽自定义不依赖完整Tag词库，词库读取失败仍只抽本组成员', async () => {
  mocks.state.memberships = { 'catalog:late': ['one'], 'custom:custom': ['two'] };
  mocks.all.mockRejectedValue(new Error('合成完整词库不可用'));
  const outside = { ...custom, id: 'outside', name: '组外角色' };
  render(<CharacterLibrary chains={[custom, outside]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  await select('two'); await screen.findByRole('button', { name: '重试' });
  expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '抽卡范围' }), { target: { value: 'custom' } });
  expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(screen.getAllByRole('button', { name: /选择角色：/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择角色：组外角色' })).toBeNull();
  expect(mocks.at).not.toHaveBeenCalled();
});

it('自定义来源在词库读取失败时仍可浏览和抽取自己的角色', async () => {
  mocks.all.mockRejectedValue(new Error('合成完整词库不可用'));
  const outside = { ...custom, id: 'outside', name: '另一自定义角色' };
  render(<CharacterLibrary chains={[custom, outside]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  await select('#source:custom');
  expect(screen.getAllByRole('button', { name: /选择角色：/ })).toHaveLength(2);
  expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  const mode = screen.getByRole('combobox', { name: '抽卡范围' }) as HTMLSelectElement;
  expect(mode.value).toBe('custom'); expect(mode.disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  const drawn = screen.getAllByRole('button', { name: /选择角色：/ });
  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.every(card => card.getAttribute('data-gallery-work-id')?.startsWith('custom:'))).toBe(true);
  expect(mocks.at).not.toHaveBeenCalled();
});

const transfer = () => {
  const values = new Map<string, string>();
  return { get types() { return [...values.keys()]; }, setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || '', effectAllowed: 'none', dropEffect: 'none' };
};
const dragTo = (key: string, name: string, source?: Element) => {
  const card = document.querySelector<HTMLElement>(`[data-gallery-work-id="${key}"]`)!;
  const target = within(screen.getByRole('complementary', { name: '分组导航' })).getByRole('button', { name: new RegExp('^' + name + '(?: [(]|$)') });
  const dataTransfer = transfer();
  expect(card.getAttribute('draggable')).toBe('true');
  fireEvent.dragStart(source ?? card, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); fireEvent.dragEnd(card, { dataTransfer });
};
it('单卡拖入精确目录身份，未选卡仅加入自己，同名自定义及提示词不变', async () => {
  const view = setup(); await select('*');
  const customCard = screen.getByRole('button', { name: '选择角色：同名' }); fireEvent.click(customCard);
  dragTo('catalog:early', '甲组');
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships['catalog:early']).toEqual(['one']);
  expect(mocks.save.mock.calls[0][0].memberships['custom:custom']).toEqual(['two']);
  expect(customCard.getAttribute('aria-pressed')).toBe('true');
  expect(custom.basePrompt).toBe('custom content');
  expect(view.container.querySelector('[data-gallery-work-id="catalog:early"]')?.getAttribute('aria-pressed')).toBe('false');
});
it('拖已选卡携带跨筛选全部选择，保留各自原组且拖动不切换选择', async () => {
  setup(); await select('two'); await waitFor(() => expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2));
  screen.getAllByRole('button', { name: '选择角色：同名' }).forEach(card => fireEvent.click(card));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(1);
  dragTo('catalog:late', '甲组');
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships['catalog:late']).toEqual(['one', 'two']);
  expect(mocks.save.mock.calls[0][0].memberships['custom:custom']).toEqual(['two', 'one']);
  expect(screen.getByRole('button', { name: '选择角色：同名' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(screen.getAllByRole('button', { name: '选择角色：同名' }).every(card => card.getAttribute('aria-pressed') === 'true')).toBe(true);
});
it('拖动失败保留条目与选择，可以重新拖入；不打开编辑或详情', async () => {
  const onSelect = vi.fn(), onCreate = vi.fn(), onNavigate = vi.fn();
  render(<CharacterLibrary chains={[{ ...custom, previewImage: '/api/assets/synthetic-character.png' }]} onCreate={onCreate} onSelect={onSelect} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={onNavigate} notify={vi.fn()} />);
  await select('*'); const card = screen.getByRole('button', { name: '选择角色：同名' }); fireEvent.click(card);
  const image = await within(card).findByRole('img', { name: '同名' });
  mocks.save.mockRejectedValueOnce(new Error('合成保存失败'));
  dragTo('custom:custom', '甲组', image);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: '设置分组' }).hasAttribute('disabled')).toBe(false));
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(mocks.state.memberships['custom:custom']).toEqual(['two']);
  dragTo('custom:custom', '甲组', image);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.state.memberships['custom:custom']).toEqual(['two', 'one']);
  expect(onSelect).not.toHaveBeenCalled(); expect(onCreate).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('展开按完整身份计数，搜索不缩小分组数，删除自定义不计旧归属且缓存完整名单', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  const view = setup(); await screen.findByRole('button', { name: '选择角色：首页' });
  await waitFor(() => expect(mocks.all).toHaveBeenCalledOnce());
  await select('two');
  await waitFor(() => expect(screen.getByRole('option', { name: '全部 (4)' })).toBeTruthy());
  expect(screen.getByRole('option', { name: '甲组 (1)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '乙组 (2)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '未分组 (2)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('option', { name: '乙组 (2)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(mocks.all).toHaveBeenCalledOnce();
  view.rerender(<CharacterLibrary chains={[]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByRole('option', { name: '全部 (3)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '乙组 (1)' })).toBeTruthy();
  expect(mocks.all).toHaveBeenCalledOnce();
});
it('完整目录未读和失败计数保持未知，空目录成功才显示有效零值', async () => {
  let resolve!: (value: typeof entries) => void;
  mocks.all.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
  const view = setup(); await screen.findByRole('button', { name: '选择角色：首页' });
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.getByRole('option', { name: '全部 (—)' })).toBeTruthy();
  await act(async () => resolve([]));
  await waitFor(() => expect(screen.getByRole('option', { name: '全部 (1)' })).toBeTruthy());
  expect(screen.getByRole('option', { name: '甲组 (0)' })).toBeTruthy();
  view.unmount(); localStorage.clear(); mocks.all.mockRejectedValueOnce(new Error('合成目录失败'));
  setup(); await screen.findByRole('button', { name: '选择角色：首页' });
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  await waitFor(() => expect(mocks.all).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('option', { name: '全部 (—)' })).toBeTruthy();
});


const variantFamily = [
  { name: 'ulrich_von_hutten_(azur_lane)', chinese: '胡滕', postCount: 90 },
  { name: 'ulrich_von_hutten_(dress)_(azur_lane)', chinese: '胡滕礼服', postCount: 30 },
];
it('词库角色铅笔首次保存个人覆写不跳页，再编辑和抽卡取用最新完整配方', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  const create = vi.fn(), update = vi.fn(), navigate = vi.fn(), selectEditor = vi.fn(), notify = vi.fn(), clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  function Harness() {
    const [chains, setChains] = React.useState<PromptChain[]>([]);
    create.mockImplementation(async (data: Partial<PromptChain>) => { setChains([{ ...data, id: 'saved-catalog', userId: 'owner', createdAt: 1, updatedAt: 1 } as PromptChain]); return 'saved-catalog'; });
    update.mockImplementation(async (id: string, patch: Partial<PromptChain>) => { setChains(current => current.map(chain => chain.id === id ? { ...chain, ...patch } : chain)); });
    return <CharacterLibrary chains={chains} onCreate={vi.fn()} onSelect={selectEditor} onDelete={vi.fn()} onUpdateChain={update} onCreateCatalogOverride={create} onNavigateToPlayground={navigate} notify={notify} />;
  }
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑角色信息:early' }));
  expect((screen.getByRole('textbox', { name: '角色 Tag' }) as HTMLInputElement).value).toBe('early');
  expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: '补充提示词' }), { target: { value: 'red eyes' } });
  fireEvent.change(screen.getByRole('combobox', { name: '负面提示词' }), { target: { value: 'extra arms' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑角色信息' })).toBeNull());
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0]).toMatchObject({ name: '首页', basePrompt: 'early', variableValues: { subject: 'red eyes' }, negativePrompt: 'extra arms', tags: ['__character_catalog__'], params: { _characterCatalogTag: 'early' } });
  expect(selectEditor).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '编辑角色信息:early' }));
  expect((screen.getByRole('combobox', { name: '补充提示词' }) as HTMLTextAreaElement).value).toBe('red eyes');
  fireEvent.change(screen.getByRole('combobox', { name: '补充提示词' }), { target: { value: 'blue eyes' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑角色信息' })).toBeNull());
  expect(update.mock.calls[0]).toEqual(['saved-catalog', expect.objectContaining({ basePrompt: 'early', variableValues: { subject: 'blue eyes' }, params: expect.objectContaining({ _characterCatalogTag: 'early' }) })]);
  await select('#source:catalog');
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  fireEvent.click(screen.getByRole('button', { name: '选择角色：首页' }));
  fireEvent.click(screen.getByRole('button', { name: '复制全部' }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('early, blue eyes'));
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(navigate).toHaveBeenCalledOnce();
  expect(mocks.coverCallbacks.get('early').favoriteRecipe).toMatchObject({ prompt: 'early, blue eyes', negativePrompt: 'extra arms' });
  expect(create).toHaveBeenCalledOnce(); expect(selectEditor).not.toHaveBeenCalled();
});

it('默认开启联动，等真实收藏就绪后从完整目录补齐旧收藏族，关闭持久化且不取消已有图片', async () => {
  let ready!: () => void;
  mocks.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
  mocks.all.mockResolvedValue(variantFamily);
  localStorage.setItem('nai_character_favorites', JSON.stringify(['catalog:' + variantFamily[1].name]));
  const view = setup(); await waitFor(() => expect(mocks.all).toHaveBeenCalledOnce());
  expect(mocks.favorite).not.toHaveBeenCalled();
  await act(async () => { mocks.collection = [{ sourceType: 'character', sourceId: variantFamily[0].name, archived: false }]; mocks.listeners.forEach(listener => listener()); ready(); });
  await waitFor(() => expect(mocks.favorite).toHaveBeenCalledOnce());
  expect(mocks.favorite.mock.calls[0][0].groupSourceIds).toEqual(variantFamily.map(entry => entry.name));
  expect(mocks.favorite.mock.calls[0][1]).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  const toggle = screen.getByRole('checkbox', { name: '同角色变体联动收藏' }) as HTMLInputElement;
  expect(toggle.checked).toBe(true); fireEvent.click(toggle);
  expect(localStorage.getItem('nai_character_link_variant_favorites')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(mocks.favorite).toHaveBeenCalledTimes(2));
  fireEvent.click(toggle);
  view.unmount(); mocks.all.mockClear(); setup();
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  expect((screen.getByRole('checkbox', { name: '同角色变体联动收藏' }) as HTMLInputElement).checked).toBe(false);
  expect(mocks.all).toHaveBeenCalledOnce(); expect(mocks.favorite).toHaveBeenCalledTimes(2);
});

it('已有族补齐失败不自动循环，设置显示错误且仅手动重试', async () => {
  mocks.all.mockResolvedValue(variantFamily);
  localStorage.setItem('nai_character_favorites', JSON.stringify(['catalog:' + variantFamily[0].name]));
  mocks.favorite.mockRejectedValueOnce(new Error('合成补齐失败')).mockResolvedValue(true);
  setup(); await waitFor(() => expect(mocks.favorite).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('合成补齐失败'));
  await act(async () => { mocks.listeners.forEach(listener => listener()); });
  expect(mocks.favorite).toHaveBeenCalledOnce();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(mocks.favorite).toHaveBeenCalledTimes(2));
  expect(mocks.favorite.mock.calls.every(call => call[1] === true)).toBe(true);
});


it('词库覆写首次回执失败后重放同创建身份，再更新新草稿且不重复创建', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  const create = vi.fn().mockRejectedValueOnce(new Error('合成回执丢失')).mockResolvedValue('same-created-id');
  const update = vi.fn(async () => {}), notify = vi.fn(), navigate = vi.fn();
  render(<CharacterLibrary chains={[]} onCreate={vi.fn()} onSelect={navigate} onDelete={vi.fn()} onUpdateChain={update} onCreateCatalogOverride={create} onNavigateToPlayground={navigate} notify={notify} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑角色信息:early' }));
  fireEvent.change(screen.getByRole('combobox', { name: '补充提示词' }), { target: { value: 'red eyes' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成回执丢失', 'error'));
  expect(screen.getByRole('dialog', { name: '编辑角色信息' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '补充提示词' }), { target: { value: 'blue eyes' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑角色信息' })).toBeNull());
  expect(create).toHaveBeenCalledTimes(2); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  expect(create.mock.calls[0][0].variableValues.subject).toBe('red eyes');
  expect(update).toHaveBeenCalledWith('same-created-id', expect.objectContaining({ variableValues: { subject: 'blue eyes' } }));
  expect(navigate).not.toHaveBeenCalled();
});

it('读取真实收藏失败不开始补齐，角色库设置展示错误并允许主动重读', async () => {
  mocks.all.mockResolvedValue(variantFamily);
  localStorage.setItem('nai_character_favorites', JSON.stringify(['catalog:' + variantFamily[0].name]));
  mocks.ensure.mockRejectedValueOnce(new Error('合成收藏读取失败')).mockResolvedValue(undefined);
  setup(); fireEvent.click(screen.getByRole('button', { name: '角色库设置' }));
  const error = await screen.findByRole('alert'); expect(error.textContent).toContain('合成收藏读取失败');
  expect(mocks.favorite).not.toHaveBeenCalled();
  fireEvent.click(within(error).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(mocks.favorite).toHaveBeenCalledOnce());
  expect(mocks.ensure).toHaveBeenCalledTimes(2); expect(mocks.favorite.mock.calls[0][1]).toBe(true);
});


it('收藏目录计数等待真实收藏就绪，使用完整有效身份且不随搜索缩小', async () => {
  let ready!: () => void;
  mocks.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
  localStorage.setItem('nai_character_favorites', JSON.stringify(['catalog:late', 'catalog:missing']));
  setup(); await select('#favorites');
  expect(screen.getByRole('option', { name: '收藏 (—)' })).toBeTruthy();
  expect(screen.queryByText('没有找到符合条件的角色')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('加载中');
  await act(async () => ready());
  await screen.findByRole('option', { name: '收藏 (1)' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not-found' } });
  expect(screen.getByRole('option', { name: '收藏 (1)' })).toBeTruthy();
  expect(mocks.favorite).not.toHaveBeenCalled();
});


it('旧词库覆写chainId收藏只读映射原Tag，参与收藏目录和已有族补齐', async () => {
  mocks.all.mockResolvedValue(variantFamily);
  const override = { ...custom, id: 'legacy-catalog-id', name: '胡滕', tags: ['__character_catalog__'], basePrompt: '历史改过的正文', params: { ...custom.params, _characterCatalogTag: variantFamily[0].name } };
  const oldFavorite = { sourceType: 'character', sourceId: override.id, archived: false, imageUrl: '/kept-old-cover.png' };
  mocks.collection = [oldFavorite];
  render(<CharacterLibrary chains={[override]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  await waitFor(() => expect(mocks.favorite).toHaveBeenCalledOnce());
  expect(mocks.favorite.mock.calls[0][0].groupSourceIds).toEqual(variantFamily.map(entry => entry.name));
  expect(mocks.favorite.mock.calls[0][1]).toBe(true);
  await select('#favorites');
  expect(screen.getByRole('button', { name: '选择角色：胡滕' }).getAttribute('data-gallery-work-id')).toBe('catalog:' + variantFamily[0].name);
  expect(screen.getByRole('option', { name: '收藏 (1)' })).toBeTruthy();
  expect(oldFavorite.sourceId).toBe('legacy-catalog-id'); expect(oldFavorite.imageUrl).toBe('/kept-old-cover.png');
});

it('手机词库详情的绝对定位封面由真实比例或2比3回退撑开，独立自定义图保持自然高度', () => {
  // jsdom 不计算绝对布局；精确检查同一详情容器的比例分支，防止再次移到无高度的内层。
  const source = readFileSync('components/CharacterLibrary.tsx', 'utf8');
  const detail = source.slice(source.indexOf('<MobileDetailView'));
  const cover = detail.slice(detail.indexOf('<PressRevealSurface'), detail.indexOf('</PressRevealSurface>'));
  expect(cover).toContain("style={{ aspectRatio: lightbox.kind === 'catalog' ? cardRatios[lightbox.key] || 2 / 3 : undefined }}");
  expect(cover.indexOf('style={{ aspectRatio:')).toBeLessThan(cover.indexOf('<DanbooruCover'));
});
