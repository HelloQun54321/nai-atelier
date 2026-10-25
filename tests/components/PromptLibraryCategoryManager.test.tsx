// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptLibraryCategoryManager } from '../../components/PromptLibraryCategoryManager';
import { createCombinationData } from '../../services/promptLibraryEntries';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({ getChains: vi.fn(), getNames: vi.fn(), saveNames: vi.fn(), update: vi.fn(), confirm: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.getChains, getPromptLibraryTagNames: mocks.getNames, savePromptLibraryTagNames: mocks.saveNames, updateChain: mocks.update } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
let chains: PromptChain[], names: string[];
const combo = (id: string, tags: string[]) => ({ id, ...createCombinationData(id, { scene: { kind: 'scene', text: 'night', filled: true } }), tags } as PromptChain);
beforeEach(() => {
  vi.clearAllMocks(); chains = []; names = [];
  mocks.getChains.mockImplementation(async () => chains);
  mocks.getNames.mockImplementation(async () => names);
  mocks.saveNames.mockImplementation(async (next: string[]) => { names = [...new Set(next)]; return names; });
  mocks.update.mockImplementation(async (id, patch) => { chains = chains.map(chain => chain.id === id ? { ...chain, ...patch } : chain); });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(() => cleanup());
const setup = async () => {
  const snapshot = vi.fn(), changed = vi.fn();
  render(<PromptLibraryCategoryManager onClose={vi.fn()} onSnapshot={snapshot} onChanged={changed} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '新分类名称' }).hasAttribute('disabled')).toBe(false));
  return { snapshot, changed };
};

it('预建0条分类且不写组合，非法名称保留输入并明确报错', async () => {
  await setup();
  const input = screen.getByRole('textbox', { name: '新分类名称' });
  fireEvent.change(input, { target: { value: '坏，分类' } });
  fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
  await screen.findByRole('alert');
  expect(mocks.saveNames).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe('坏，分类');
  fireEvent.change(input, { target: { value: '  空分类  ' } });
  fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
  await screen.findByRole('button', { name: '重命名分类：空分类' });
  expect(mocks.saveNames).toHaveBeenCalledWith(['空分类']);
  expect(screen.getByText('0条')).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('显式合并读取最新全部组合，确认实际条数，仅写tags并保留同名片段', async () => {
  chains = [combo('a', ['旧类', '目标', '__internal__']), { id: 'fragment', type: 'scene', tags: ['旧类'] } as PromptChain];
  names = ['目标', '空类'];
  const { changed } = await setup();
  chains = [...chains, combo('later', ['旧类', '其他'])];
  fireEvent.click(screen.getByRole('button', { name: '合并分类：旧类' }));
  fireEvent.change(screen.getByRole('combobox', { name: '目标分类' }), { target: { value: '目标' } });
  fireEvent.click(screen.getByRole('button', { name: '合并' }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith('旧类', '目标'));
  expect(mocks.confirm.mock.calls[0][0].message).toContain('2 条组合');
  expect(mocks.update.mock.calls).toEqual([['a', { tags: ['目标', '__internal__'] }], ['later', { tags: ['目标', '其他'] }]]);
  expect(chains.find(chain => chain.id === 'fragment')?.tags).toEqual(['旧类']);
  expect(names).toEqual(['目标', '空类']);
});

it('部分失败回读事实，回读失败禁止再写，重载后保留输入并只处理剩余组合', async () => {
  chains = [combo('a', ['旧类']), combo('b', ['旧类'])]; names = ['旧类'];
  const { changed } = await setup();
  mocks.update.mockImplementationOnce(async () => { chains = [combo('a', ['新类']), combo('b', ['旧类'])]; })
    .mockImplementationOnce(async () => { mocks.getChains.mockRejectedValueOnce(new Error('回读断线')); throw new Error('保存中断'); });
  fireEvent.click(screen.getByRole('button', { name: '重命名分类：旧类' }));
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '新类' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('button', { name: '重新加载分类' });
  expect(screen.getByRole('alert').textContent).toContain('1/2');
  expect(changed).not.toHaveBeenCalled();
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
  await screen.findByRole('button', { name: '重新加载分类' });
  expect(mocks.saveNames).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新加载分类' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '新分类名称' }).hasAttribute('disabled')).toBe(false));
});
