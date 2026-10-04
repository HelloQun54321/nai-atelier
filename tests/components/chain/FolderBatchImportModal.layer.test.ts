// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderBatchImportModal } from '../../../components/chain/FolderBatchImportModal';
import { api } from '../../../services/api';
import { db } from '../../../services/dbService';

vi.mock('../../../services/metadataService', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/metadataService')>(),
  extractMetadata: vi.fn(async (file: File) => JSON.stringify({ prompt: `synthetic ${file.name}`, steps: 28, width: 832, height: 1216 })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('批量导入遮罩与侧栏同处应用根层，关闭与卸载不操作文件或资料库', () => {
  const close = vi.fn();
  const props = { isOpen: true, existingChains: [], onClose: close, onSuccess: vi.fn(), notify: vi.fn() };
  const tree = (open: boolean) => React.createElement('div', { className: 'agent-stage safe-mode dark' },
    React.createElement('aside', { className: 'z-40' }, '侧边栏'),
    React.createElement('main', { className: 'isolate overflow-hidden' },
      React.createElement(FolderBatchImportModal, { ...props, isOpen: open }),
    ),
  );
  const view = render(tree(true));
  const stage = view.container.firstElementChild;
  const overlay = screen.getByRole('dialog', { name: '批量导入风格串' });
  expect(overlay.parentElement).toBe(stage);
  expect(overlay.closest('main')).toBeNull();
  expect(overlay.closest('.safe-mode.dark')).toBe(stage);
  for (const token of ['fixed', 'inset-0', 'z-[1300]', 'backdrop-blur-sm']) expect(overlay.classList.contains(token)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭批量导入' }));
  expect(close).toHaveBeenCalledOnce();
  expect(props.onSuccess).not.toHaveBeenCalled();
  view.rerender(tree(false));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('手机可从候选列表移除单项，保留其他勾选项，不上传、不写库、不删除原文件', async () => {
  vi.stubGlobal('innerWidth', 390);
  class PreviewURL extends URL {
    static createObjectURL = vi.fn((file: Blob) => `blob:synthetic-${(file as File).name}`);
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal('URL', PreviewURL);
  const upload = vi.spyOn(api, 'uploadFile').mockRejectedValue(new Error('测试禁止上传'));
  const save = vi.spyOn(db, 'createChain').mockRejectedValue(new Error('测试禁止写库'));
  const files = [new File(['first'], 'first.png', { type: 'image/png' }), new File(['second'], 'second.png', { type: 'image/png' })];
  render(React.createElement(FolderBatchImportModal, { isOpen: true, existingChains: [], onClose: vi.fn(), onSuccess: vi.fn(), notify: vi.fn() }));
  fireEvent.change(screen.getByLabelText('批量导入 PNG 图片'), { target: { files } });
  const remove = await screen.findByRole('button', { name: '移除导入候选：first' });
  expect(remove.classList.contains('hover-reveal-md')).toBe(true); expect(remove.className).not.toContain('hidden');
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '导入条目：first' })).toBeNull());
  expect(screen.getByRole('checkbox', { name: '导入条目：second' }).getAttribute('aria-checked')).toBe('true');
  expect(PreviewURL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-first.png');
  expect(upload).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(files.map(file => [file.name, file.size])).toEqual([['first.png', 5], ['second.png', 6]]);
});
