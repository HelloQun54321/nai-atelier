// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryDirectoryDialog } from '../../components/PromptLibraryDirectoryDialog';
import type { PromptLibraryTreeState } from '../../services/promptLibraryTree.mjs';

afterEach(() => { cleanup(); localStorage.clear(); });

const tree: PromptLibraryTreeState = { revision: 6, nodes: [
  { id: 'root', parentId: null, name: '人物', target: 'character' },
  { id: 'deep', parentId: 'root', name: '服装' },
  { id: 'leaf', parentId: 'deep', name: '袖口' },
  { id: 'other', parentId: null, name: '画面', target: 'global' },
] };

it.each([null, 'deep'])('紧凑新建以指定上级 %s 保存一次即关闭，不进入批次管理', async initialParentId => {
  const save = vi.fn(async (next: PromptLibraryTreeState) => next); const close = vi.fn();
  const original = JSON.stringify(tree);
  render(<PromptLibraryDirectoryDialog state={tree} initialParentId={initialParentId} onSave={save} onClose={close} />);
  const dialog = screen.getByRole('dialog', { name: '新建目录' });
  expect(dialog.className).toContain('max-w-md');
  expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '保存目录' })).toBeNull();
  expect(screen.queryByRole('navigation')).toBeNull();
  expect((screen.getByRole('combobox', { name: '上级目录' }) as HTMLSelectElement).value).toBe(initialParentId || '');
  expect(screen.getByText('目录目标范围', { selector: 'summary' }).closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '新目录' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  const next = save.mock.calls[0][0];
  expect(next.revision).toBe(6);
  expect(next.nodes.slice(0, tree.nodes.length)).toEqual(tree.nodes);
  expect(next.nodes.at(-1)).toMatchObject({ name: '新目录', parentId: initialParentId });
  expect(next.nodes.at(-1)).not.toHaveProperty('target');
  expect(JSON.stringify(tree)).toBe(original);
});

it.each(['character', 'global', ''] as const)('紧凑编辑修改名称上级并正确保留或设置目标 %s', async target => {
  const initial: PromptLibraryTreeState = { ...tree, nodes: tree.nodes.map(node => node.id === 'deep' ? { ...node, target: 'character' as const } : node) };
  const save = vi.fn(async (next: PromptLibraryTreeState) => next);
  render(<PromptLibraryDirectoryDialog state={initial} editingId="deep" onSave={save} onClose={vi.fn()} />);
  expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('服装');
  const parent = screen.getByRole('combobox', { name: '上级目录' });
  expect(within(parent).queryByRole('option', { name: '人物 / 服装' })).toBeNull();
  expect(within(parent).queryByRole('option', { name: '人物 / 服装 / 袖口' })).toBeNull();
  const summary = screen.getByText('目录目标范围', { selector: 'summary' });
  expect(summary.closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '衣装' } });
  fireEvent.change(parent, { target: { value: 'other' } });
  if (target !== 'character') {
    fireEvent.click(summary);
    expect((screen.getByRole('combobox', { name: '目录目标范围' }) as HTMLSelectElement).value).toBe('character');
    fireEvent.change(screen.getByRole('combobox', { name: '目录目标范围' }), { target: { value: target } });
  }
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const next = save.mock.calls[0][0];
  expect(next.nodes.find(node => node.id === 'deep')).toEqual({ id: 'deep', parentId: 'other', name: '衣装', ...(target ? { target } : {}) });
  expect(next.nodes.filter(node => node.id !== 'deep')).toEqual(initial.nodes.filter(node => node.id !== 'deep'));
});

it('保存失败保持名称上级和目标，冲突重读后只在主动保存时用新revision重试', async () => {
  const close = vi.fn(); const save = vi.fn().mockRejectedValueOnce(new Error('目录已在其他窗口更新，请重新读取后再保存')).mockImplementationOnce(async (next: PromptLibraryTreeState) => next);
  let update!: (value: PromptLibraryTreeState) => void;
  const latest: PromptLibraryTreeState = { revision: 7, nodes: [...tree.nodes, { id: 'remote', parentId: null, name: '远端新增' }] };
  const reload = vi.fn(async () => update(latest));
  const Harness = () => {
    const [state, setState] = React.useState(tree); update = setState;
    return <PromptLibraryDirectoryDialog state={state} initialParentId="deep" onSave={save} onReload={reload} onClose={close} />;
  };
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '保留输入' } });
  fireEvent.click(screen.getByText('目录目标范围', { selector: 'summary' }));
  fireEvent.change(screen.getByRole('combobox', { name: '目录目标范围' }), { target: { value: 'global' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('保留输入');
  fireEvent.click(screen.getByRole('button', { name: '重新读取目录' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(save).toHaveBeenCalledOnce();
  expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('保留输入');
  expect((screen.getByRole('combobox', { name: '上级目录' }) as HTMLSelectElement).value).toBe('deep');
  expect((screen.getByRole('combobox', { name: '目录目标范围' }) as HTMLSelectElement).value).toBe('global');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save.mock.calls[1][0].revision).toBe(7);
  expect(save.mock.calls[1][0].nodes).toEqual(expect.arrayContaining([latest.nodes.at(-1)]));
  expect(save.mock.calls[1][0].nodes.at(-1).id).toBe(save.mock.calls[0][0].nodes.at(-1).id);
});

it('同一上级的重名仍明确拒绝，不调用保存服务', async () => {
  const save = vi.fn();
  render(<PromptLibraryDirectoryDialog state={tree} initialParentId="root" onSave={save} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '服装' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(screen.getByRole('alert').textContent).toContain('同名');
  expect(save).not.toHaveBeenCalled();
});
