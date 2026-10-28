// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} }));
import { ContentRollLibrary } from '../../components/ContentRollLibrary';
import { LibraryDialog } from '../../components/PromptLibraryAccess';
import { PromptLibraryEntryEditor } from '../../components/PromptLibrary';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { isTopmostModal } from '../../components/useModalA11y';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import { contentSnapshotOf } from '../../services/contentRoll';
import type { PromptChain } from '../../types';

const history = [{ id: 'synthetic-image', imageUrl: '/api/local-history/synthetic-image/image', prompt: 'blue coat', createdAt: 1, params: { width: 640, height: 960 } }];
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: async () => ({ items: history, count: 1 }), subscribe: () => () => {} } }));
vi.mock('../../services/promptLibraryUsage', () => ({
  PROMPT_LIBRARY_USAGE_PAGE_SIZE: 24, PROMPT_LIBRARY_USAGE_PREVIEW_SIZE: 6,
  fetchPromptLibraryUsageSummary: async () => ({ items: [], linkedImages: 0, entries: 0 }),
  fetchPromptLibraryUsageImages: async () => ({ items: [], count: 0 }),
}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/prompt-library-links/images?')) return Response.json({ items: history, count: 1 });
    throw new Error('封面回归禁止真实网络请求');
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const combination = { id: 'synthetic-combination', type: 'preset', name: '合成组合', tags: [], params: { ...LAB_DEFAULT_PARAMS,
  _rollContentSnapshot: contentSnapshotOf({ picks: { wardrobe: { kind: 'wardrobe', filled: true, text: 'blue coat' } } }, '2026-10-27'),
} } as unknown as PromptChain;

it.each([1280, 390])('%spx 组合封面选择位于管理窗口上方，关闭只退出选图，保存沿用原回调', async width => {
  vi.stubGlobal('innerWidth', width);
  const close = vi.fn(), save = vi.fn(async () => {});
  render(<LibraryDialog title="管理提示词" onClose={close}><ContentRollLibrary active embedded chains={[combination]} notify={vi.fn()}
    onLoad={vi.fn()} onRename={vi.fn(async () => {})} onDelete={vi.fn(async () => {})} onSetCover={save} /></LibraryDialog>);
  fireEvent.click(screen.getByRole('button', { name: '查看合成组合' }));
  fireEvent.click(screen.getByRole('button', { name: '从历史选封面' }));
  const picker = await screen.findByRole('dialog', { name: '选择历史图片' });
  const manager = screen.getByRole('dialog', { name: '管理提示词' });
  const layer = picker.closest<HTMLElement>('.fixed')!;
  expect(Number(layer.style.zIndex)).toBeGreaterThan(Number(/z-\[(\d+)\]/.exec(manager.parentElement!.className)?.[1]));
  expect(isTopmostModal(picker)).toBe(true);
  fireEvent.click(within(picker).getByRole('button', { name: '关闭历史图片选择' }));
  expect(screen.queryByRole('dialog', { name: '选择历史图片' })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '从历史选封面' }));
  const next = await screen.findByRole('dialog', { name: '选择历史图片' });
  fireEvent.click(await within(next).findByRole('button', { name: /^选择历史生成图片，/ }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(combination, '/api/local-history/synthetic-image/image'));
  expect(close).not.toHaveBeenCalled();
});

it('片段封面选择与清除只提交显式修改，正文和生成参数保留', async () => {
  const entry: PromptChain = { id: 'synthetic-fragment', userId: 'owner', name: '合成片段', type: 'wardrobe', description: '', basePrompt: 'blue coat', negativePrompt: 'red coat',
    modules: [], previewImage: '/synthetic/old.png', tags: [], params: { ...LAB_DEFAULT_PARAMS, seed: 42 }, createdAt: 1, updatedAt: 1 };
  const update = vi.fn(async () => {}), close = vi.fn();
  const view = render(<ConfirmDialogProvider><PromptLibraryEntryEditor entry={entry} chains={[entry]} onCreate={vi.fn()}
    onUpdateChain={update} onDelete={vi.fn()} notify={vi.fn()} onClose={close} /></ConfirmDialogProvider>);
  fireEvent.click(screen.getByRole('button', { name: '从历史选图' }));
  const picker = await screen.findByRole('dialog', { name: '选择历史图片' });
  fireEvent.click(await within(picker).findByRole('button', { name: /^选择历史生成图片，/ }));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(entry.id, expect.objectContaining({
    previewImage: '/api/local-history/synthetic-image/image', basePrompt: entry.basePrompt,
    negativePrompt: entry.negativePrompt, params: expect.objectContaining({ seed: 42 }),
  })));
  view.unmount();
  const clear = vi.fn(async () => {});
  render(<ConfirmDialogProvider><PromptLibraryEntryEditor entry={entry} chains={[entry]} onCreate={vi.fn()}
    onUpdateChain={clear} onDelete={vi.fn()} notify={vi.fn()} onClose={vi.fn()} /></ConfirmDialogProvider>);
  fireEvent.click(screen.getByRole('button', { name: '清除' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(clear).toHaveBeenCalledWith(entry.id, expect.objectContaining({ previewImage: '' })));
});
