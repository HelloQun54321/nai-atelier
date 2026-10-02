// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';

const start = vi.hoisted(() => vi.fn());
vi.mock('../services/tagDictionaryUpdater', () => ({ getTagUpdateStatus: async () => ({ running: false, phase: 'idle', manifest: { count: 123, generatedAt: null } }), startTagUpdate: start }));
afterEach(cleanup);
it('词库窗口脱离设置容器，遮罩覆盖应用；关闭不启动更新', async () => {
  const view = render(<div className="agent-stage safe-mode dark"><div role="dialog" aria-modal="true" className="fixed z-[1250]"><div className="operation-dialog"><TagDictionaryUpdater notify={vi.fn()} /></div></div></div>);
  fireEvent.click(screen.getByRole('button', { name: '更新词库' }));
  await screen.findByText('123');
  const dialog = screen.getByRole('dialog', { name: 'Tag 补全词库' });
  expect(dialog.parentElement?.parentElement).toBe(view.container.firstElementChild);
  expect(dialog.closest('.safe-mode.dark')).toBe(view.container.firstElementChild);
  expect(dialog.parentElement?.classList.contains('backdrop-blur-sm')).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Tag 补全词库' })).toBeNull(); expect(start).not.toHaveBeenCalled();
});
