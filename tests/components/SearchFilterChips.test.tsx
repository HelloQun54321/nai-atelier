// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchFilterChips } from '../../components/SearchFilterChips';
import { ToolbarSearch } from '../../components/DesignSystem';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('按实测宽度保留输入位置，缩小时逐项收纳，放大后恢复，隐藏条件不参与键盘聚焦', () => {
  let width = 1000;
  const callbacks = new Set<() => void>();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-search-filter-chip') ? 80 : 44; });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { callbacks.add(callback); }
    observe() {} disconnect() {}
  });
  const onMore = vi.fn(), remove = vi.fn();
  const chips = ['月榜', '模型', '参考'].map(key => ({ key, label: key, onRemove: remove }));
  render(<ToolbarSearch aria-label="搜索"><SearchFilterChips chips={chips} expanded={false} onMore={onMore} /></ToolbarSearch>);
  const input = screen.getByRole('searchbox');
  const group = screen.getByRole('group', { name: '已生效的筛选条件' });
  expect(group.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
  expect(group.nextElementSibling).toBe(input);
  expect(screen.getAllByRole('button', { name: /移除筛选/ }).map(chip => chip.getAttribute('data-search-filter-chip'))).toEqual(['月榜', '模型', '参考']);
  expect(screen.getAllByRole('button', { name: /移除筛选/ })).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /查看其余/ })).toBeNull();
  width = 300;
  act(() => callbacks.forEach(callback => callback()));
  expect(screen.getAllByRole('button', { name: /移除筛选/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '查看其余 2 个筛选条件' }));
  expect(onMore).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[data-search-filter-chip="参考"]')?.getAttribute('tabindex')).toBe('-1');
  width = 140;
  act(() => callbacks.forEach(callback => callback()));
  expect(screen.queryByRole('button', { name: /移除筛选/ })).toBeNull();
  expect(screen.getByRole('button', { name: '查看其余 3 个筛选条件' })).toBeTruthy();
  width = 1000;
  act(() => callbacks.forEach(callback => callback()));
  expect(screen.getAllByRole('button', { name: /移除筛选/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '移除筛选：月榜' }));
  expect(remove).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(input);
});
