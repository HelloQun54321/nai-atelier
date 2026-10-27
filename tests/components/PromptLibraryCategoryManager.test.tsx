// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptLibraryCategoryManager } from '../../components/PromptLibraryCategoryManager';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { readPromptLibraryTagNames } from '../../services/promptLibraryTags';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({ loadTree: vi.fn(), saveTree: vi.fn(), getChains: vi.fn(), getNames: vi.fn(), saveNames: vi.fn(), update: vi.fn(), confirm: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.getChains, getPromptLibraryTagNames: mocks.getNames, savePromptLibraryTagNames: mocks.saveNames, updateChain: mocks.update } }));
vi.mock('../../services/promptLibraryCategoryTree', async original => ({ ...await original<typeof import('../../services/promptLibraryCategoryTree')>(), loadPromptLibraryCategoryTree: mocks.loadTree, savePromptLibraryCategoryTree: mocks.saveTree }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
let chains: PromptChain[], names: string[];
let tree: import('../../services/promptLibraryCategoryTree').PromptLibraryCategoryTreeState;
const combo = (id: string, tags: string[]) => ({ id, ...createCombinationData(id, { scene: { kind: 'scene', text: 'night', filled: true } }), tags } as PromptChain);
beforeEach(() => {
  vi.clearAllMocks(); chains = []; names = []; tree = { revision: 0, nodes: [] };
  mocks.loadTree.mockImplementation(async () => tree);
  mocks.saveTree.mockImplementation(async next => { tree = { ...next, revision: next.revision + 1 }; return tree; });
  mocks.getChains.mockImplementation(async () => chains);
  mocks.getNames.mockImplementation(async () => names);
  mocks.saveNames.mockImplementation(async (next: string[]) => { names = [...new Set(next)]; return names; });
  mocks.update.mockImplementation(async (id, patch) => { chains = chains.map(chain => chain.id === id ? { ...chain, ...patch } : chain); });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => cleanup());
const setup = async (action: { initialParentId?: string | null; initialEditingId?: string } = {}) => {
  const snapshot = vi.fn(), changed = vi.fn(), close = vi.fn();
  const view = render(<PromptLibraryCategoryManager onClose={close} onSnapshot={snapshot} onChanged={changed} {...action} />);
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(false));
  return { snapshot, changed, close, view };
};
const openMerge = (target: string) => {
  fireEvent.click(screen.getByText('合并分类', { selector: 'summary' }));
  fireEvent.change(screen.getByRole('combobox', { name: '目标分类' }), { target: { value: target } });
  fireEvent.click(screen.getByRole('button', { name: '合并' }));
};

it('预建0条分类且不写组合，非法名称保留输入并明确报错', async () => {
  const { close } = await setup();
  const input = screen.getByRole('textbox', { name: '新分类名称' });
  fireEvent.change(input, { target: { value: '坏，分类' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  expect(mocks.saveNames).not.toHaveBeenCalled(); expect((input as HTMLInputElement).value).toBe('坏，分类');
  fireEvent.change(input, { target: { value: '  空分类  ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.saveNames).toHaveBeenCalledWith(['空分类']); expect(tree.nodes).toContainEqual({ id: '空分类', name: '空分类', parentId: null });
  expect(mocks.update).not.toHaveBeenCalled();
});

it('编辑窗口默认折叠合并，显式合并读取最新全部组合且只更新组合tags', async () => {
  chains = [combo('a', ['旧类', '目标', '__internal__']), { id: 'fragment', type: 'scene', tags: ['旧类'] } as PromptChain];
  names = ['目标', '空类'];
  const { changed, close } = await setup({ initialEditingId: '旧类' });
  expect(screen.queryByRole('complementary')).toBeNull(); expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.querySelector('details')?.open).toBe(false);
  expect(screen.getByRole('combobox', { name: '目标分类' }).closest('details')?.hasAttribute('open')).toBe(false);
  chains = [...chains, combo('later', ['旧类', '其他'])];
  openMerge('目标');
  await waitFor(() => expect(changed).toHaveBeenCalledWith('旧类', '目标'));
  expect(close).toHaveBeenCalledOnce(); expect(mocks.confirm.mock.calls[0][0].message).toContain('2 条组合');
  expect(mocks.update.mock.calls).toEqual([['a', { tags: ['目标', '__internal__'] }], ['later', { tags: ['目标', '其他'] }]]);
  expect(chains.find(chain => chain.id === 'fragment')?.tags).toEqual(['旧类']); expect(names).toEqual(['目标', '空类']);
});

it('取消合并确认不写入并保留名称、上级与目标草稿', async () => {
  names = ['来源', '目标', '父类']; tree.nodes = [{ id: '来源', name: '来源', parentId: '父类' }, { id: '父类', name: '父类', parentId: null }];
  const { close } = await setup({ initialEditingId: '来源' }); mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '未保存改名' } });
  openMerge('目标');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.saveTree).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).value).toBe('未保存改名');
  expect((screen.getByRole('combobox', { name: '上级分类' }) as HTMLSelectElement).value).toBe('父类');
  expect((screen.getByRole('combobox', { name: '目标分类' }) as HTMLSelectElement).value).toBe('目标');
});

it('合并可使用含逗号换行的旧长标签，保留目标原父级且不把旧标签写入严格名单', async () => {
  const legacy = '旧标签,原文\n' + 'x'.repeat(240);
  names = ['来源', '空分类']; chains = [combo('a', ['来源', '其他', '__internal__']), combo('b', [legacy, '来源'])];
  tree.nodes = [{ id: '空分类', name: '空分类', parentId: null }, { id: legacy, name: legacy, parentId: '空分类' }];
  const before = chains.map(chain => JSON.stringify(chain.params));
  mocks.saveNames.mockImplementation(async (next: string[]) => { names = readPromptLibraryTagNames(next); return names; });
  const { changed } = await setup({ initialEditingId: '来源' }); openMerge(legacy);
  await waitFor(() => expect(changed).toHaveBeenCalledWith('来源', legacy));
  expect(chains[0].tags).toEqual([legacy, '其他', '__internal__']); expect(chains[1].tags).toEqual([legacy]);
  expect(mocks.saveNames).toHaveBeenCalledWith(['空分类']); expect(names).toEqual(['空分类']);
  expect(tree.nodes.find(node => node.id === legacy)?.parentId).toBe('空分类'); expect(tree.nodes.some(node => node.id === '来源')).toBe(false);
  expect(chains.map(chain => JSON.stringify(chain.params))).toEqual(before); expect(screen.queryByRole('alert')).toBeNull();
});

it('部分失败回读事实，回读失败禁止再写，重载后保留输入并只处理剩余组合', async () => {
  chains = [combo('a', ['旧类']), combo('b', ['旧类'])]; names = ['旧类'];
  const { changed } = await setup({ initialEditingId: '旧类' });
  mocks.update.mockImplementationOnce(async () => { chains = [combo('a', ['新类']), combo('b', ['旧类'])]; })
    .mockImplementationOnce(async () => { mocks.getChains.mockRejectedValueOnce(new Error('回读断线')); throw new Error('保存中断'); });
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '新类' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('button', { name: '重新加载分类' });
  expect(screen.getByRole('alert').textContent).toContain('1/2'); expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载分类' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false));
  expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).value).toBe('新类');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith('旧类', '新类'));
  expect(mocks.update.mock.calls.slice(2)).toEqual([['b', { tags: ['新类'] }]]);
});

it('目录读取失败不保存空目录，重试可恢复', async () => {
  mocks.getNames.mockRejectedValueOnce(new Error('断线'));
  render(<PromptLibraryCategoryManager onClose={vi.fn()} onSnapshot={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByRole('button', { name: '重新加载分类' }); expect(mocks.saveNames).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新加载分类' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '新分类名称' }).hasAttribute('disabled')).toBe(false));
});

it('编辑上级排除自身与后代，移动不写组合标签或快照', async () => {
  names = ['父类', '子类', '孙类', '其他']; chains = [combo('a', ['子类'])];
  tree = { revision: 4, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }, { id: '孙类', name: '孙类', parentId: '子类' }, { id: '其他', name: '其他', parentId: null }] };
  const before = JSON.stringify(chains), { view } = await setup({ initialEditingId: '父类' });
  expect(Array.from((screen.getByRole('combobox', { name: '上级分类' }) as HTMLSelectElement).options).map(option => option.value)).toEqual(['', '其他']);
  view.unmount(); const { close } = await setup({ initialEditingId: '子类' });
  fireEvent.change(screen.getByRole('combobox', { name: '上级分类' }), { target: { value: '其他' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(tree.nodes.find(node => node.id === '子类')?.parentId).toBe('其他');
  expect(JSON.stringify(chains)).toBe(before); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.saveNames).not.toHaveBeenCalled();
});

it('树保存失败保留来源元数据和输入，重试不重复改组合并恢复原父级', async () => {
  names = ['父类', '旧类']; chains = [combo('a', ['旧类'])];
  tree = { revision: 3, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '旧类', name: '旧类', parentId: '父类' }] };
  const { changed } = await setup({ initialEditingId: '旧类' }); mocks.saveTree.mockRejectedValueOnce(new Error('树写入中断'));
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '新类' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('树写入中断'); expect(names).toContain('旧类'); expect(tree.nodes.find(node => node.id === '旧类')?.parentId).toBe('父类');
  expect(changed).not.toHaveBeenCalled(); expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).value).toBe('新类');
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(changed).toHaveBeenCalledWith('旧类', '新类'));
  expect(mocks.update).toHaveBeenCalledOnce(); expect(tree.nodes.find(node => node.id === '新类')?.parentId).toBe('父类'); expect(names).not.toContain('旧类');
});

it('从主导航带初始父级进入聚焦新建，关闭重开根层不残留父级或名称', async () => {
  names = ['父类', '子类']; tree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }] };
  const props = { onClose: vi.fn(), onSnapshot: vi.fn(), onChanged: vi.fn() };
  const view = render(<PromptLibraryCategoryManager {...props} initialParentId="子类" />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).value).toBe('子类');
  expect(screen.queryByRole('complementary', { name: '组合分类导航' })).toBeNull(); expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '新分类名称' }), { target: { value: '未保存' } }); view.unmount();
  render(<PromptLibraryCategoryManager {...props} initialParentId={null} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).value).toBe(''); expect((screen.getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).value).toBe(''); expect(mocks.saveTree).not.toHaveBeenCalled();
});


it('普通新建只显示共享紧凑表单，保存失败保留草稿，成功保存子类后关闭', async () => {
  names = ['父类']; tree = { revision: 2, nodes: [{ id: '父类', name: '父类', parentId: null }] };
  const close = vi.fn(); render(<PromptLibraryCategoryManager initialParentId="父类" onClose={close} onSnapshot={vi.fn()} onChanged={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: '新分类名称' }); await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  expect(screen.queryByRole('searchbox')).toBeNull(); expect(screen.queryByRole('complementary')).toBeNull(); expect(screen.queryByRole('button', { name: /合并分类/ })).toBeNull();
  fireEvent.change(input, { target: { value: '子类' } }); mocks.saveTree.mockRejectedValueOnce(new Error('暂时断线')); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('暂时断线'); expect((input as HTMLInputElement).value).toBe('子类'); expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(tree.nodes.find(node => node.id === '子类')?.parentId).toBe('父类'); expect(mocks.update).not.toHaveBeenCalled();
});

it('紧凑编辑改名与上级一次保存，树失败回读后保留新上级并只更新剩余标签', async () => {
  names = ['旧类', '原父', '新父']; chains = [combo('a', ['旧类', '其他', '__internal__'])];
  tree = { revision: 3, nodes: [{ id: '旧类', name: '旧类', parentId: '原父' }, { id: '原父', name: '原父', parentId: null }, { id: '新父', name: '新父', parentId: null }] };
  const before = JSON.stringify(chains[0].params), close = vi.fn(), changed = vi.fn();
  render(<PromptLibraryCategoryManager initialEditingId="旧类" onClose={close} onSnapshot={vi.fn()} onChanged={changed} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('combobox', { name: '上级分类' }) as HTMLSelectElement).value).toBe('原父'); expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '新类' } }); fireEvent.change(screen.getByRole('combobox', { name: '上级分类' }), { target: { value: '新父' } });
  mocks.saveTree.mockRejectedValueOnce(new Error('树失败')); fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByRole('alert');
  expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).value).toBe('新类'); expect((screen.getByRole('combobox', { name: '上级分类' }) as HTMLSelectElement).value).toBe('新父'); expect(close).not.toHaveBeenCalled();
  expect(mocks.saveTree.mock.calls[0][0].nodes).toContainEqual({ id: '新类', name: '新类', parentId: '新父' });
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.update).toHaveBeenCalledOnce(); expect(tree.nodes.find(node => node.id === '新类')?.parentId).toBe('新父'); expect(changed).toHaveBeenCalledWith('旧类', '新类'); expect(chains[0].tags).toEqual(['新类', '其他', '__internal__']); expect(JSON.stringify(chains[0].params)).toBe(before);
});

it('紧凑编辑旧特殊标签只变上级无需新名称校验或标签改写', async () => {
  const legacy = '旧标签,换行\n长' + 'x'.repeat(220); names = ['父类']; chains = [combo('a', [legacy])];
  tree = { revision: 1, nodes: [{ id: legacy, name: legacy, parentId: null }, { id: '父类', name: '父类', parentId: null }] };
  const close = vi.fn(); render(<PromptLibraryCategoryManager initialEditingId={legacy} onClose={close} onSnapshot={vi.fn()} onChanged={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('combobox', { name: '上级分类' }), { target: { value: '父类' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(tree.nodes.find(node => node.id === legacy)?.parentId).toBe('父类'); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.saveNames).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('主导航直接删除只确认一次且不显示管理列表，取消和成功都关闭', async () => {
  names = ['父类', '子类']; chains = [combo('a', ['父类', '子类', '__internal__'])];
  tree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }] };
  const close = vi.fn(), changed = vi.fn(); mocks.confirm.mockResolvedValueOnce(false);
  const view = render(<PromptLibraryCategoryManager initialDeletingId="父类" onClose={close} onSnapshot={vi.fn()} onChanged={changed} />);
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.update).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount(); close.mockClear();
  render(<PromptLibraryCategoryManager initialDeletingId="父类" onClose={close} onSnapshot={vi.fn()} onChanged={changed} />);
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(changed).toHaveBeenCalledWith('父类', ''); expect(chains[0].tags).toEqual(['子类', '__internal__']); expect(tree.nodes.find(node => node.id === '子类')?.parentId).toBeNull();
});

it('直接删除部分失败保留事实，错误反馈等待明确重试后只解除剩余标签', async () => {
  names = ['父类']; chains = [combo('a', ['父类']), combo('b', ['父类'])];
  const close = vi.fn(); let retry!: (value: boolean) => void;
  mocks.confirm.mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise<boolean>(resolve => { retry = resolve; })).mockResolvedValue(true);
  mocks.update.mockImplementationOnce(async () => { chains = [combo('a', []), combo('b', ['父类'])]; }).mockRejectedValueOnce(new Error('写入中断'));
  render(<PromptLibraryCategoryManager initialDeletingId="父类" onClose={close} onSnapshot={vi.fn()} onChanged={vi.fn()} />);
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.confirm.mock.calls[1][0]).toMatchObject({ confirmLabel: '重试', cancelLabel: '关闭' }); expect(mocks.confirm.mock.calls[1][0].message).toContain('1/2'); expect(mocks.update).toHaveBeenCalledTimes(2); expect(close).not.toHaveBeenCalled();
  retry(true); await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(mocks.update.mock.calls.slice(2)).toEqual([['b', { tags: [] }]]); expect(chains.every(chain => !chain.tags?.includes('父类'))).toBe(true);
});
