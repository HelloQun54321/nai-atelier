// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CharacterLibrary } from '../../components/CharacterLibrary';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import type { PromptChain } from '../../types';
const mocks = vi.hoisted(() => ({ page: vi.fn(), all: vi.fn(), at: vi.fn(), save: vi.fn(), state: { revision: 1, groups: [{ id: 'one', name: '甲组' }, { id: 'two', name: '乙组' }], memberships: { 'catalog:late': ['one', 'two'], 'custom:custom': ['two'] } } }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: async () => structuredClone(mocks.state), put: async (_path: string, value: any) => { await mocks.save(value); mocks.state = { ...value, revision: value.revision + 1 }; return mocks.state; } } }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), getCharacterDictionaryPage: mocks.page, getCharacterDictionaryEntries: mocks.all, getCharacterDictionaryEntriesAt: mocks.at, searchCharacterDictionary: async () => [] }));
vi.mock('../../services/collectionFavorites', async original => ({ ...await original<typeof import('../../services/collectionFavorites')>(), collectionSnapshot: () => [], subscribeCollection: () => () => {}, collectionTargetActive: () => false }));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: ({ tagName }: any) => <span>{tagName}</span> }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 3, ShortestColumnMasonry: ({ items, renderItem }: any) => <div>{items.map(renderItem)}</div> }));
const entries = [{ name: 'early', chinese: '首页', postCount: 100 }, { name: 'late', chinese: '同名', postCount: 1 }, { name: 'other', chinese: '其他', postCount: 2 }];
const custom = { id: 'custom', name: '同名', type: 'character', basePrompt: 'custom content', negativePrompt: '', modules: [], tags: [], params: createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, variableValues: {}, createdAt: 1, updatedAt: 1, userId: 'owner', description: '' } as PromptChain;
beforeEach(() => {
  vi.clearAllMocks(); mocks.save.mockReset(); localStorage.clear();
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
it('跨分页的精确角色身份参与多组，搜索与范围取交集，不混同名自定义', async () => {
  setup(); await screen.findByRole('button', { name: '选择角色：同名' });
  expect(mocks.all).not.toHaveBeenCalled();
  await select('one');
  await waitFor(() => expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(1));
  expect(screen.queryByRole('button', { name: '选择角色：首页' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'late' } });
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await select('two');
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '角色范围' }), { target: { value: 'custom' } });
  expect(screen.getAllByRole('button', { name: '选择角色：同名' })).toHaveLength(1);
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
  await select('two'); expect(screen.getByRole('button', { name: '随机抽卡' })).toBeTruthy();
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

it('分组只抽自定义不依赖完整Tag词库，词库读取失败仍只抽本组成员', async () => {
  mocks.state.memberships = { 'catalog:late': ['one'], 'custom:custom': ['two'] };
  mocks.all.mockRejectedValue(new Error('合成完整词库不可用'));
  const outside = { ...custom, id: 'outside', name: '组外角色' };
  render(<CharacterLibrary chains={[custom, outside]} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})} onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  await select('two'); await screen.findByRole('button', { name: '重试' });
  expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '抽卡设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '抽卡范围' }), { target: { value: 'custom' } });
  expect(screen.getByRole('button', { name: '随机抽卡' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(screen.getAllByRole('button', { name: /选择角色：/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: '选择角色：同名' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择角色：组外角色' })).toBeNull();
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
  const view = setup(); await screen.findByRole('button', { name: '选择角色：首页' });
  expect(mocks.all).not.toHaveBeenCalled();
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
