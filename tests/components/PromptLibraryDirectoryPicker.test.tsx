// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultPromptLibraryTree } from '../../services/promptLibraryTree.mjs';
import { PromptLibraryDirectoryPicker } from '../../components/PromptLibraryDirectoryPicker';
afterEach(cleanup);

it('默认收起目录，摘要保留选中路径；展开与收起分支不修改归属', () => {
  const change = vi.fn();
  const view = render(<PromptLibraryDirectoryPicker state={createDefaultPromptLibraryTree()} selectedIds={['person-appearance']} onChange={change} />);
  const details = view.container.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toContain('人物整体 / 外貌与身体');
  fireEvent.click(screen.getByText('选择目录'));
  expect(details.open).toBe(true);
  expect(screen.queryByRole('checkbox', { name: '人物整体 / 外貌与身体' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物整体」' }));
  expect((screen.getByRole('checkbox', { name: '人物整体 / 外貌与身体' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '收起目录「人物整体」' }));
  expect(change).not.toHaveBeenCalled();
  expect(details.querySelector('summary')?.textContent).toContain('人物整体 / 外貌与身体');
});

it('默认全选可切成单目录，选择父目录后取消子目录会保留同级分支', () => {
  const state = createDefaultPromptLibraryTree();
  const change = vi.fn(); const allChange = vi.fn();
  const Harness = () => {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [allSelected, setAllSelected] = useState(true);
    return <PromptLibraryDirectoryPicker state={state} selectedIds={selectedIds} allSelected={allSelected}
      onChange={ids => { change(ids); setSelectedIds(ids); }} onAllChange={value => { allChange(value); setAllSelected(value); }} />;
  };
  const view = render(<Harness />);
  fireEvent.click(screen.getByText('选择目录'));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物整体」' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '人物整体 / 外貌与身体' }));
  expect(allChange).toHaveBeenLastCalledWith(false);
  expect(change).toHaveBeenLastCalledWith(['person-appearance']);
  fireEvent.click(screen.getByRole('checkbox', { name: '人物整体' }));
  expect(change).toHaveBeenLastCalledWith(['person']);
  fireEvent.click(screen.getByRole('checkbox', { name: '人物整体 / 外貌与身体' }));
  expect(change).toHaveBeenLastCalledWith(['person-wardrobe', 'person-pose', 'person-expression']);
  view.unmount();
});

it('父目录筛选覆盖后代，切换目标时保留完整路径并禁用其他范围', () => {
  const state = createDefaultPromptLibraryTree();
  const change = vi.fn();
  render(<PromptLibraryDirectoryPicker state={state} selectedIds={[]} onChange={change} allSelected={false} target="character" />);
  fireEvent.click(screen.getByText('选择目录'));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物整体」' }));
  const person = screen.getByRole('checkbox', { name: '人物整体' });
  expect(person.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('checkbox', { name: '人物整体 / 外貌与身体' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '场景环境' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(person);
  expect(change).toHaveBeenCalledWith(['person']);
});

it('未归类是独立选择，不混入目录ID', () => {
  const state = createDefaultPromptLibraryTree();
  const change = vi.fn(); const unclassified = vi.fn();
  render(<PromptLibraryDirectoryPicker state={state} selectedIds={[]} onChange={change} includeUnclassified onUnclassifiedChange={unclassified} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '未归类' }));
  expect(unclassified).toHaveBeenCalledWith(true);
  expect(change).not.toHaveBeenCalled();
});

it('深层目录缩进封顶，手机仍能看到名称与勾选框', () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `node-${index}`, parentId: index ? `node-${index - 1}` : null, name: `层级${index}` }));
  const state = { revision: 0, nodes };
  const path = nodes.map(node => node.name).join(' / ');
  render(<PromptLibraryDirectoryPicker state={state} selectedIds={[]} onChange={vi.fn()} includeAll={false} />);
  fireEvent.click(screen.getByText('选择目录'));
  for (let index = 0; index < nodes.length - 1; index++) fireEvent.click(screen.getByRole('button', { name: `展开目录「${nodes.slice(0, index + 1).map(node => node.name).join(' / ')}」` }));
  const checkbox = screen.getByRole('checkbox', { name: path });
  expect(checkbox.closest('label')?.parentElement?.style.paddingLeft).toBe('84px');
  expect(checkbox.parentElement?.textContent).toContain('层级11');
});

it('混合目标的父目录不可选，允许目录限制仍显示完整路径且禁用不允许项', () => {
  const state = { revision: 0, nodes: [
    { id: 'root', parentId: null, name: '混合', target: 'global' as const },
    { id: 'character', parentId: 'root', name: '人物', target: 'character' as const },
    { id: 'deep', parentId: 'character', name: '眼睛' },
    { id: 'global', parentId: 'root', name: '场景' },
  ] };
  const change = vi.fn();
  const view = render(<PromptLibraryDirectoryPicker state={state} target="character" directoryIds={['deep']} selectedIds={[]} onChange={change} />);
  fireEvent.click(screen.getByText('选择目录'));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「混合」' }));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「混合 / 人物」' }));
  expect(screen.getByRole('checkbox', { name: '混合' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('checkbox', { name: '混合 / 人物' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('checkbox', { name: '混合 / 场景' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('checkbox', { name: '混合 / 人物 / 眼睛' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '混合 / 场景' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '混合 / 人物 / 眼睛' }));
  expect(change).toHaveBeenCalledWith(['deep']);
  view.unmount();
});
