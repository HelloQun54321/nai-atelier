// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryDirectoryNavigation } from '../../components/PromptLibraryDirectoryNavigation';
import type { PromptLibraryTreeState } from '../../services/promptLibraryTree.mjs';
import type { PromptChain } from '../../types';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { createCombinationData, librarySectionOf } from '../../services/promptLibraryEntries';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const state: PromptLibraryTreeState = { revision: 1, nodes: [
  { id: 'people', parentId: null, name: '人物', target: 'character' },
  { id: 'clothes', parentId: 'people', name: '服装' },
  { id: 'shirt', parentId: 'clothes', name: '上衣' },
  { id: 'motion', parentId: 'people', name: '动作' },
  { id: 'world', parentId: null, name: '场景', target: 'global' },
] };
const entry = (id: string, ids: string[]): PromptChain => ({ id, type: 'preset', name: id, params: { _promptLibraryDirectoryIds: ids } } as unknown as PromptChain);
const original = { id: 'original', ...prepareCollectedPrompt('original source text', '原文') } as PromptChain;
const combination = { id: 'combination', ...createCombinationData('组合', { scene: { kind: 'scene', text: 'moonlight', filled: true } }) } as PromptChain;
const entries = [entry('both', ['clothes', 'shirt']), entry('motion', ['motion']), entry('none', []), entry('removed', ['deleted']), entry('both', ['clothes', 'shirt']), original, combination];
const props = () => ({ id: 'prompt-directories', state, entries, selectedIds: [], allSelected: true, unclassified: false, expanded: true, onSelect: vi.fn() });
const describedCount = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent;

it('目录导航沿用文件夹布局，父目录含后代计数去重，全部与未归类分别统计', () => {
  render(<PromptLibraryDirectoryNavigation {...props()} />);
  const aside = screen.getByRole('complementary', { name: '提示词目录导航' });
  expect(aside.id).toBe('prompt-directories');
  expect(aside.className).toContain('workspace-fixed-pane');
  expect(aside.className).toContain('workspace-category-navigation');
  expect(aside.className).toContain('directory-tree-navigation');
  expect(aside.className).toContain('md:w-52');
  expect(aside.className).toContain('md:overflow-y-auto');
  expect(describedCount(screen.getByRole('button', { name: '全部' }))).toBe('6');
  expect(describedCount(screen.getByRole('button', { name: '未归类' }))).toBe('2');
  expect(describedCount(screen.getByRole('button', { name: '人物' }))).toBe('2');
  expect(describedCount(screen.getByRole('button', { name: '人物 / 服装' }))).toBe('1');
  expect(describedCount(screen.getByRole('button', { name: '场景' }))).toBe('0');
});

it('全部统计真实原文和组合，混入风格串与角色资产不进入提示词库计数', () => {
  expect(librarySectionOf(original)).toBe('originals');
  expect(librarySectionOf(combination)).toBe('saved');
  const assets = [{ id: 'style', type: 'style', params: {} }, { id: 'character', type: 'character', params: {} }] as PromptChain[];
  render(<PromptLibraryDirectoryNavigation {...props()} entries={[...entries, ...assets]} />);
  expect(screen.getByText('提示词目录')).toBeTruthy();
  expect(describedCount(screen.getByRole('button', { name: '全部' }))).toBe('6');
  expect(describedCount(screen.getByRole('button', { name: '未归类' }))).toBe('2');
  expect(describedCount(screen.getByRole('button', { name: '人物' }))).toBe('2');
  expect(screen.getByRole('option', { name: '全部 (6)' })).toBeTruthy();
});

it('点击目录单独定位，展开箭头仅展开分支且在本端记忆，不改选择或资料', () => {
  const p = props(); const before = JSON.stringify(entries);
  const view = render(<PromptLibraryDirectoryNavigation {...p} />);
  expect(screen.queryByRole('button', { name: '人物 / 服装 / 上衣' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物 / 服装」' }));
  expect(screen.getByRole('button', { name: '人物 / 服装 / 上衣' })).toBeTruthy();
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '人物 / 服装 / 上衣' }));
  expect(p.onSelect).toHaveBeenLastCalledWith({ directoryIds: ['shirt'], allDirectories: false, unclassified: false });
  fireEvent.click(screen.getByRole('button', { name: '收起目录「人物」' }));
  expect(screen.queryByRole('button', { name: '人物 / 服装' })).toBeNull();
  expect(p.onSelect).toHaveBeenCalledOnce();
  view.unmount();
  render(<PromptLibraryDirectoryNavigation {...p} />);
  expect(screen.getByRole('button', { name: '展开目录「人物」' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物」' }));
  expect(screen.getByRole('button', { name: '人物 / 服装 / 上衣' })).toBeTruthy();
  expect(JSON.stringify(entries)).toBe(before);
});

it('保留旧多选的每个选中目录，根入口保持选择且无重复管理入口', () => {
  const p = props();
  render(<PromptLibraryDirectoryNavigation {...p} selectedIds={['shirt', 'world']} allSelected={false} />);
  expect(screen.getByRole('button', { name: '人物 / 服装 / 上衣' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '场景' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '人物' }).getAttribute('aria-current')).toBeNull();
  expect(screen.queryByRole('button', { name: '管理目录' })).toBeNull();
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '未归类' }));
  expect(p.onSelect).toHaveBeenLastCalledWith({ directoryIds: [], allDirectories: false, unclassified: true });
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect(p.onSelect).toHaveBeenLastCalledWith({ directoryIds: [], allDirectories: true, unclassified: false });
});

it('收起不占导航空间，手机只显示紧凑路径选择器，嵌入窗口不应用页面顶部偏移', () => {
  const p = props(); const view = render(<PromptLibraryDirectoryNavigation {...p} expanded={false} />);
  expect(screen.queryByRole('complementary')).toBeNull();
  view.rerender(<PromptLibraryDirectoryNavigation {...p} embedded />);
  const aside = screen.getByRole('complementary');
  expect(aside.className).not.toContain('workspace-fixed-pane');
  expect(screen.getByRole('navigation').className).toContain('hidden');
  expect(screen.getByRole('navigation').className).toContain('md:block');
  const select = screen.getByRole('combobox', { name: '选择提示词目录' });
  expect(select.className).toContain('md:hidden');
  expect(within(select).getByRole('option', { name: '人物 / 服装 / 上衣 (1)' })).toBeTruthy();
  fireEvent.change(select, { target: { value: 'shirt' } });
  expect(p.onSelect).toHaveBeenCalledWith({ directoryIds: ['shirt'], allDirectories: false, unclassified: false });
});

it('旧多选混合未归类保持每项高亮，手机选择器不会误显示为单一目录', () => {
  render(<PromptLibraryDirectoryNavigation {...props()} selectedIds={['shirt']} allSelected={false} unclassified />);
  expect(screen.getByRole('button', { name: '人物 / 服装 / 上衣' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '未归类' }).getAttribute('aria-current')).toBe('page');
  expect((screen.getByRole('combobox', { name: '选择提示词目录' }) as HTMLSelectElement).value).toBe('#selected');
  expect(screen.getByRole('option', { name: '已选 2 个目录' })).toBeTruthy();
});

it('浏览导航拖动把真实节点与目标上级交给持久化回调，不修改条目或选择', () => {
  const move = vi.fn(); const p = props(); const before = JSON.stringify({ state, entries });
  const view = render(<PromptLibraryDirectoryNavigation {...p} onMove={move} />);
  const values = new Map<string, string>();
  const dataTransfer = { setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || '', get types() { return [...values.keys()]; }, effectAllowed: '', dropEffect: '' };
  const source = screen.getByRole('button', { name: '人物 / 服装' });
  const target = screen.getByRole('button', { name: '场景' });
  expect(source.getAttribute('draggable')).toBe('true');
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(move).toHaveBeenCalledWith('clothes', 'world');
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(JSON.stringify({ state, entries })).toBe(before);
  view.rerender(<PromptLibraryDirectoryNavigation {...p} onMove={move} disabled />);
  expect(screen.getByRole('button', { name: '人物 / 服装' }).getAttribute('draggable')).not.toBe('true');
});

it('共享标题加号在全部范围请求根层新增，选中深层目录时请求其子目录', () => {
  const create = vi.fn(); const p = props(); const before = JSON.stringify({ state, entries });
  const view = render(<PromptLibraryDirectoryNavigation {...p} onCreate={create} />);
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  expect(create).toHaveBeenLastCalledWith(null);
  view.rerender(<PromptLibraryDirectoryNavigation {...p} onCreate={create} allSelected={false} selectedIds={['shirt']} />);
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  expect(create).toHaveBeenLastCalledWith('shirt');
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(JSON.stringify({ state, entries })).toBe(before);
});

it('编辑删除仅在共享标题对当前目录发起，不增加逐行按钮', () => {
  const rename = vi.fn(); const remove = vi.fn();
  render(<PromptLibraryDirectoryNavigation {...props()} allSelected={false} selectedIds={['shirt']} onRename={rename} onDelete={remove} />);
  expect(screen.queryAllByRole('button', { name: /^重命名目录：/ })).toHaveLength(0);
  expect(screen.queryAllByRole('button', { name: /^删除目录：/ })).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重命名目录' }));
  fireEvent.click(screen.getByRole('button', { name: '删除目录' }));
  expect(rename).toHaveBeenCalledWith('shirt');
  expect(remove).toHaveBeenCalledWith('shirt');
});
