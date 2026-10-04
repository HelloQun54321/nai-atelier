// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderBatchImportModal } from '../../../components/chain/FolderBatchImportModal';

afterEach(cleanup);

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
