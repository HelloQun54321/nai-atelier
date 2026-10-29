// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Inspiration, PromptChain } from '../../types';
import { PromptLibraryBrowser } from '../../components/PromptLibraryBrowser';
import { PromptLibraryHub } from '../../components/PromptLibrary';
import { PromptLibraryContext } from '../../components/PromptLibraryAccess';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';

const collection = vi.hoisted(() => ({ items: [] as Inspiration[], listeners: new Set<() => void>(), ensure: vi.fn(async () => {}) }));
vi.mock('../../services/collectionFavorites', () => ({
  collectionSnapshot: () => collection.items,
  subscribeCollection: (listener: () => void) => { collection.listeners.add(listener); return () => collection.listeners.delete(listener); },
  ensureCollection: collection.ensure,
}));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareActions: () => null, ImageShareOverlay: () => null }));
vi.mock('../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));
vi.mock('../../services/promptLibraryUsage', () => ({
  PROMPT_LIBRARY_USAGE_PAGE_SIZE: 24, PROMPT_LIBRARY_USAGE_PREVIEW_SIZE: 6,
  fetchPromptLibraryUsageSummary: async () => ({ items: [], linkedImages: 0, entries: 0 }),
  fetchPromptLibraryUsageImages: async () => ({ items: [], count: 0 }),
}));
const directories = { revision: 1, nodes: [{ id: 'clothes', parentId: null, name: '服装' }] };
const fragment = (id: string, name: string) => ({ id, ...createFragmentData(name, name, 'wardrobe'), previewImage: '/current/' + id, params: { _promptLibraryDirectoryIds: ['clothes'] } }) as PromptChain;
const chains = [fragment('first', '红衣'), fragment('second', '蓝衣'),
  { id: 'combo', ...createCombinationData('组合一', { scene: { kind: 'scene', text: 'garden', filled: true } }), previewImage: '/current/combo', tags: ['花园'] } as PromptChain];
const saved = (id: string, sourceId?: string, extra = {}) => ({ id, sourceType: 'other', sourceId, imageUrl: '/old/' + id, ...extra }) as Inspiration;
const notify = vi.fn();
function Browser() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <><div ref={setSlot} /><PromptLibraryBrowser chains={chains} directories={directories} toolbarSlot={slot} onUse={vi.fn()} onOpen={vi.fn()} notify={notify} /></>;
}
const managerKey = 'nai-prompt-library-manager-directory';
function Manager() {
  return <ConfirmDialogProvider><PromptLibraryContext.Provider value={{ chains, directories, save: vi.fn() }}><PromptLibraryHub chains={chains} onCreate={vi.fn()} onUpdateChain={vi.fn()} onDelete={vi.fn()} notify={notify} embedded /></PromptLibraryContext.Provider></ConfirmDialogProvider>;
}

it('文件夹固定标题：片段管理器只让目录列表滚动，标题动作留在滚动区外', async () => {
  const create = vi.fn(), rename = vi.fn(), remove = vi.fn();
  localStorage.setItem(managerKey, JSON.stringify({ directoryIds: ['clothes'], allDirectories: false, unclassified: false, favorites: false }));
  render(<ConfirmDialogProvider><PromptLibraryContext.Provider value={{ chains, directories, save: vi.fn(), onCreateDirectory: create, onRenameDirectory: rename, onDeleteDirectory: remove }}><PromptLibraryHub chains={chains} onCreate={vi.fn()} onUpdateChain={vi.fn()} onDelete={vi.fn()} notify={notify} embedded /></PromptLibraryContext.Provider></ConfirmDialogProvider>);
  const aside = screen.getByRole('complementary', { name: '提示词目录导航' });
  const wrapper = aside.parentElement!;
  const viewport = aside.querySelector<HTMLElement>('.directory-tree-scroll-viewport')!;
  const header = aside.querySelector<HTMLElement>('.directory-tree-header')!;
  expect(wrapper.classList.contains('md:overflow-hidden')).toBe(true);
  expect(wrapper.classList.contains('md:flex-col')).toBe(true);
  expect(wrapper.classList.contains('md:overflow-y-auto')).toBe(false);
  expect(aside.classList.contains('md:h-full')).toBe(true);
  expect(aside.classList.contains('overflow-hidden')).toBe(true);
  expect(viewport.classList.contains('md:overflow-y-auto')).toBe(true);
  expect(viewport.classList.contains('md:flex-1')).toBe(true);
  expect(viewport.contains(header)).toBe(false);
  expect(header.parentElement).toBe(aside);
  for (const name of ['新建目录', '重命名目录', '删除目录']) {
    const button = screen.getByRole('button', { name });
    expect(header.contains(button)).toBe(true);
    expect(viewport.contains(button)).toBe(false);
    fireEvent.click(button);
  }
  expect(create).toHaveBeenCalledWith('clothes');
  expect(rename).toHaveBeenCalledWith('clothes');
  expect(remove).toHaveBeenCalledWith('clothes');
  await waitFor(() => expect(collection.ensure).toHaveBeenCalled());
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nai-prompt-library-directories-expanded', 'true');
  localStorage.setItem('nai-prompt-library-combination-categories-expanded', 'true');
  collection.ensure.mockReset().mockResolvedValue(undefined);
  collection.items = [saved('old-first', 'first'), saved('duplicate-first', 'first'), saved('archived-second', 'second', { archived: true }), saved('old-combo', 'combo'), saved('deleted', 'gone')];
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const count = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent;

it('片段与组合收藏按原对象去重，换封面仍保留，搜索取交集，取消收藏即时更新', async () => {
  const view = render(<Browser />);
  await waitFor(() => expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('1'));
  expect(screen.getByRole('option', { name: '收藏 (1)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(screen.getByRole('button', { name: '查看红衣' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看蓝衣' })).toBeNull();
  expect(screen.getByRole('button', { name: '收起目录' }).title).toContain('收藏');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '蓝衣' } });
  expect(screen.queryByRole('button', { name: '查看红衣' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.change(screen.getByRole('combobox', { name: '选择组合分类' }), { target: { value: '#favorites' } });
  expect(screen.getByRole('button', { name: '查看组合一' })).toBeTruthy();
  expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('1');
  act(() => { collection.items = collection.items.map(item => item.sourceId === 'combo' ? { ...item, archived: true } : item); collection.listeners.forEach(listener => listener()); });
  expect(screen.queryByRole('button', { name: '查看组合一' })).toBeNull();
  expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('0');
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect(screen.getByRole('button', { name: '查看组合一' })).toBeTruthy();
  view.unmount();
  expect(collection.listeners.size).toBe(0);
});

it('仅缺来源身份的旧收藏回退图片地址，明确属于其它对象的图片不串收藏', async () => {
  collection.items = [saved('legacy', undefined, { imageUrl: chains[0].previewImage }), saved('someone-else', 'other-object', { imageUrl: chains[1].previewImage })];
  render(<Browser />);
  await waitFor(() => expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('1'));
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value: '#favorites' } });
  expect(screen.getByRole('button', { name: '查看红衣' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看蓝衣' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai-prompt-library-browse')!).directoryIds).toEqual([]);
});

it('收藏读取失败保留未知计数并明确显示失败，不显示零匹配', async () => {
  collection.ensure.mockRejectedValue(new Error('synthetic failure'));
  render(<Browser />);
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(await screen.findByText('收藏库加载失败，请稍后重试')).toBeTruthy();
  expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('?');
  expect(screen.queryByText('没有匹配的提示词')).toBeNull();
});

it('首次读取失败后共享收藏成功更新快照，目录重新核实并恢复真实收藏', async () => {
  collection.ensure.mockRejectedValueOnce(new Error('synthetic failure'));
  render(<Browser />);
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  await screen.findByText('收藏库加载失败，请稍后重试');
  expect(collection.ensure).toHaveBeenCalledTimes(1);
  expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('?');
  act(() => { collection.items = [saved('fresh-first', 'first')]; collection.listeners.forEach(listener => listener()); });
  await waitFor(() => expect(screen.getByRole('button', { name: '查看红衣' })).toBeTruthy());
  expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('1');
  expect(screen.queryByText('收藏库加载失败，请稍后重试')).toBeNull();
  expect(collection.ensure).toHaveBeenCalledTimes(2);
});

it('管理片段沿用同一收藏快照和手机选择器，不改原条目或触发写入', async () => {
  const create = vi.fn(), before = JSON.stringify(chains);
  render(<ConfirmDialogProvider><PromptLibraryContext.Provider value={{ chains, directories, save: vi.fn() }}><PromptLibraryHub chains={chains} onCreate={create} onUpdateChain={vi.fn()} onDelete={vi.fn()} notify={notify} embedded /></PromptLibraryContext.Provider></ConfirmDialogProvider>);
  await waitFor(() => expect(count(screen.getByRole('button', { name: '收藏' }))).toBe('1'));
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value: '#favorites' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: '片段：蓝衣' })).toBeNull());
  expect(screen.getByRole('button', { name: '片段：红衣' })).toBeTruthy();
  expect(JSON.stringify(chains)).toBe(before);
  expect(create).not.toHaveBeenCalled();
});

it('管理片段收藏选择卸载后恢复，管理浏览记忆不覆盖主页面', async () => {
  const browserMemory = JSON.stringify({ scope: 'saved', combinationCategory: '花园', combinationFavorites: false });
  localStorage.setItem('nai-prompt-library-browse', browserMemory);
  const view = render(<Manager />);
  await screen.findByRole('option', { name: '收藏 (1)' });
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value: '#favorites' } });
  await waitFor(() => expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '#favorites'));
  view.unmount();
  render(<Manager />);
  await screen.findByRole('button', { name: '片段：红衣' });
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '#favorites');
  expect(screen.queryByRole('button', { name: '片段：蓝衣' })).toBeNull();
  expect(localStorage.getItem('nai-prompt-library-browse')).toBe(browserMemory);
});

it.each(['clothes', '', '*'])('管理片段目录选择「%s」覆盖原收藏状态并独立恢复', async value => {
  localStorage.setItem(managerKey, JSON.stringify({ directoryIds: [], allDirectories: false, unclassified: false, favorites: true }));
  const view = render(<Manager />);
  await screen.findByRole('button', { name: '片段：红衣' });
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem(managerKey)!).favorites).toBe(false));
  view.unmount();
  render(<Manager />);
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', value);
  expect(JSON.parse(localStorage.getItem(managerKey)!)).toEqual({ directoryIds: value === 'clothes' ? ['clothes'] : [], allDirectories: value === '*', unclassified: value === '', favorites: false });
  if (value !== '') expect(screen.getByRole('button', { name: '片段：蓝衣' })).toBeTruthy();
  expect(localStorage.getItem('nai-prompt-library-browse')).toBeNull();
});

it('管理片段具体目录与全部来回切换，只恢复最后一次选择', async () => {
  let view = render(<Manager />);
  for (const value of ['clothes', '*', 'clothes']) {
    fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(managerKey)!).directoryIds).toEqual(value === '*' ? [] : ['clothes']));
    view.unmount(); view = render(<Manager />);
    expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', value);
  }
});

it.each([
  '{invalid',
  JSON.stringify({ directoryIds: ['deleted'], allDirectories: false, unclassified: false, favorites: false }),
  JSON.stringify({ directoryIds: [], allDirectories: true, unclassified: false, favorites: true }),
  JSON.stringify({ directoryIds: [], allDirectories: false, unclassified: false, favorites: false }),
])('管理片段无效浏览偏好回到全部：%s', value => {
  localStorage.setItem(managerKey, value);
  render(<Manager />);
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '*');
  expect(screen.getByRole('button', { name: '片段：蓝衣' })).toBeTruthy();
});

it('管理片段本端存储受限时仍能切换，重开回到全部', async () => {
  const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) { if (key === managerKey) throw Error('合成读取受限'); return originalGet.call(this, key); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (key === managerKey) throw Error('合成写入受限'); originalSet.call(this, key, value); });
  const view = render(<Manager />);
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '*');
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value: '#favorites' } });
  await waitFor(() => expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '#favorites'));
  view.unmount(); render(<Manager />);
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', '*');
});

it('管理片段拒绝离开未保存详情时保留当前目录和持久偏好', async () => {
  const current = JSON.stringify({ directoryIds: ['clothes'], allDirectories: false, unclassified: false, favorites: false });
  localStorage.setItem(managerKey, current);
  render(<Manager />);
  fireEvent.click(screen.getByRole('button', { name: '片段：红衣' }));
  fireEvent.change(screen.getByRole('textbox', { name: '片段名称' }), { target: { value: '未保存草稿' } });
  fireEvent.change(screen.getByRole('combobox', { name: '选择提示词目录' }), { target: { value: '#favorites' } });
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '片段名称' })).toHaveProperty('value', '未保存草稿'));
  expect(screen.getByRole('combobox', { name: '选择提示词目录' })).toHaveProperty('value', 'clothes');
  expect(localStorage.getItem(managerKey)).toBe(current);
});
