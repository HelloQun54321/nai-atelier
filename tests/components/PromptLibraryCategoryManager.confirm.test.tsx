// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryCategoryManager } from '../../components/PromptLibraryCategoryManager';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { isTopmostModal } from '../../components/useModalA11y';
import { createCombinationData } from '../../services/promptLibraryEntries';

const mocks = vi.hoisted(() => ({ loadTree: vi.fn(), saveTree: vi.fn(), getChains: vi.fn(), getNames: vi.fn(), saveNames: vi.fn(), update: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.getChains, getPromptLibraryTagNames: mocks.getNames, savePromptLibraryTagNames: mocks.saveNames, updateChain: mocks.update } }));
vi.mock('../../services/promptLibraryCategoryTree', async original => ({ ...await original<typeof import('../../services/promptLibraryCategoryTree')>(), loadPromptLibraryCategoryTree: mocks.loadTree, savePromptLibraryCategoryTree: mocks.saveTree }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it.each([320, 1280])('宽度 %s：真实确认框在分类编辑层之上，Escape仅取消确认，重命名可点选完成', async width => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: width < 1280 })));
  let tree = { revision: 0, nodes: [] as Array<{ id: string; name: string; parentId: string | null }> };
  mocks.loadTree.mockImplementation(async () => tree); mocks.saveTree.mockImplementation(async next => { tree = { ...next, revision: next.revision + 1 }; return tree; });
  let names = ['旧类'];
  let chains = [{ id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', text: 'night', filled: true } }, ['旧类']) }];
  mocks.getNames.mockImplementation(async () => names);
  mocks.getChains.mockImplementation(async () => chains);
  mocks.update.mockImplementation(async (id, updates) => { chains = chains.map(chain => chain.id === id ? { ...chain, ...updates } : chain); });
  mocks.saveNames.mockImplementation(async (tags: string[]) => { names = tags; return tags; });
  const close = vi.fn(), changed = vi.fn();
  render(<ConfirmDialogProvider><PromptLibraryCategoryManager initialEditingId="旧类" onClose={close} onSnapshot={vi.fn()} onChanged={changed} /></ConfirmDialogProvider>);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox', { name: '分类名称' }), { target: { value: '新类' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const confirmation = await screen.findByRole('alertdialog');
  const manager = screen.getByRole('dialog', { name: '编辑目录' });
  expect(isTopmostModal(confirmation)).toBe(true);
  expect(isTopmostModal(manager)).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getByRole('dialog', { name: '编辑目录' })).toBe(manager);
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const nextConfirmation = await screen.findByRole('alertdialog');
  expect(isTopmostModal(nextConfirmation)).toBe(true);
  fireEvent.click(within(nextConfirmation).getByRole('button', { name: '重命名' }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith('旧类', '新类'));
  expect(mocks.update).toHaveBeenCalledWith('combo', { tags: ['新类'] });
  expect(isTopmostModal(manager)).toBe(true);
});
