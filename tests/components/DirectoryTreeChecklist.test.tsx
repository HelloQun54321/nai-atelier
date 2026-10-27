// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryTreeChecklist } from '../../components/DirectoryTreeChecklist';

afterEach(cleanup);
const nodes = [{ id: 'root', name: '根' }, { id: 'child', parentId: 'root', name: '子项' }, { id: 'other', name: '另一根' }];
it('显示独立多归属和部分选中，勾父项不自动勾后代', () => {
  const onToggle = vi.fn();
  render(<DirectoryTreeChecklist nodes={nodes} selectedIds={['other']} mixedIds={['child']} onToggle={onToggle} label="设置归属" />);
  const partial = screen.getByRole('checkbox', { name: '根 / 子项' }) as HTMLInputElement;
  expect(partial.indeterminate).toBe(true);
  expect(partial.getAttribute('aria-checked')).toBe('mixed');
  expect((screen.getByRole('checkbox', { name: '另一根' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '根' }));
  expect(onToggle).toHaveBeenCalledWith('root', true);
  expect(onToggle).toHaveBeenCalledOnce();
  expect(partial.checked).toBe(false);
});
it('禁用的多归属列表不能变更，空树保持基本可达', () => {
  const onToggle = vi.fn();
  const view = render(<DirectoryTreeChecklist nodes={nodes} selectedIds={[]} onToggle={onToggle} disabled label="归属" />);
  fireEvent.click(screen.getByRole('checkbox', { name: '根' }));
  expect(onToggle).not.toHaveBeenCalled();
  view.rerender(<DirectoryTreeChecklist nodes={[]} selectedIds={[]} onToggle={onToggle} label="归属" />);
  expect(screen.getByRole('group', { name: '归属' })).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
it('逐节点禁用保留树路径和其他节点操作', () => {
  const onToggle = vi.fn();
  render(<DirectoryTreeChecklist nodes={nodes} selectedIds={[]} disabledIds={['root']} onToggle={onToggle} />);
  const root = screen.getByRole('checkbox', { name: '根' }) as HTMLInputElement;
  expect(root.disabled).toBe(true); fireEvent.click(root);
  expect(onToggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '根 / 子项' }));
  expect(onToggle).toHaveBeenCalledWith('child', true);
});
