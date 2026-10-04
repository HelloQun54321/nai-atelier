// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentContextRing } from '../../components/AgentContextRing';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('上下文浮层使用全局面板材质及明暗配色，缓存分隔线与次级文字同步适配', () => {
  render(<AgentContextRing usage={{ used: 4000, limit: 10000, cacheHitRate: 50 }} />);
  fireEvent.pointerEnter(screen.getByRole('meter'));
  const tooltip = screen.getByRole('tooltip');
  for (const style of ['appearance-panel', 'bg-white', 'dark:bg-gray-900', 'border-gray-200', 'dark:border-gray-700', 'text-gray-800', 'dark:text-gray-100', 'rounded-2xl']) expect(tooltip.classList.contains(style)).toBe(true);
  for (const item of [screen.getByText('上下文窗口：'), screen.getByText('40% 已用'), screen.getByText('缓存命中率：50.0%')]) {
    expect(item.classList.contains('text-gray-500')).toBe(true);
    expect(item.classList.contains('dark:text-gray-400')).toBe(true);
  }
  const cache = screen.getByText('缓存命中率：50.0%');
  expect(cache.classList.contains('border-gray-200')).toBe(true);
  expect(cache.classList.contains('dark:border-gray-700')).toBe(true);
});
it('悬停展示紧凑上下文卡片及缓存命中率，离开隐藏', () => {
  render(<AgentContextRing usage={{ used: 160000, limit: 258000, cacheHitRate: 80 }} />);
  const ring = screen.getByRole('meter'); fireEvent.pointerEnter(ring);
  const tooltip = screen.getByRole('tooltip'); expect(tooltip.textContent).toContain('62% 已用'); expect(tooltip.textContent).toContain('已用 160k 标记，共 258k'); expect(tooltip.textContent).toContain('缓存命中率：80.0%');
  expect(ring.getAttribute('aria-describedby')).toBe(tooltip.id); expect(ring.getAttribute('title')).toBe('');
  fireEvent.pointerLeave(ring); expect(screen.queryByRole('tooltip')).toBeNull();
});
it('键盘聚焦与触屏可读取，Esc 收起，缺失数据不显示虚假的 0%', () => {
  const view = render(<AgentContextRing />); const ring = screen.getByRole('img'); fireEvent.focus(ring);
  expect(screen.getByRole('tooltip').textContent).toContain('用量未知'); expect(screen.getByRole('tooltip').textContent).toContain('缓存命中率：未知');
  fireEvent.keyDown(ring, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(ring); expect(screen.getByRole('tooltip')).toBeTruthy(); fireEvent.blur(ring); expect(screen.queryByRole('tooltip')).toBeNull();
  view.rerender(<AgentContextRing usage={{ used: 4000, limit: 10000, cacheHitRate: 0 }} />); fireEvent.pointerEnter(screen.getByRole('meter'));
  expect(screen.getByRole('tooltip').textContent).toContain('缓存命中率：0.0%');
});
it('点按可固定和收起，移出不会误关已固定浮层，点击外部会关闭', () => {
  render(<AgentContextRing usage={{ used: 4000, limit: 10000 }} />); const ring = screen.getByRole('meter');
  fireEvent.focus(ring); fireEvent.click(ring); fireEvent.pointerLeave(ring);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.click(ring); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(ring); fireEvent.pointerDown(document.body); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focus(ring); fireEvent.keyDown(ring, { key: 'Enter' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.keyDown(ring, { key: ' ' }); expect(screen.getByRole('tooltip')).toBeTruthy();
});
it('手指接触不模拟鼠标悬停，点击后 pointerleave 不会立即关掉说明', () => {
  class TouchPointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerType = init.pointerType || ''; }
  }
  vi.stubGlobal('PointerEvent', TouchPointerEvent);
  render(<AgentContextRing usage={{ used: 4, limit: 10 }} />); const ring = screen.getByRole('meter');
  fireEvent.pointerEnter(ring, { pointerType: 'touch' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(ring); fireEvent.pointerLeave(ring, { pointerType: 'touch' }); expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.click(ring); expect(screen.queryByRole('tooltip')).toBeNull();
});
it('键盘焦点仍在圆环时，鼠标离开不抢走说明，失焦后关闭', () => {
  render(<AgentContextRing usage={{ used: 4, limit: 10 }} />); const ring = screen.getByRole('meter');
  act(() => ring.focus()); fireEvent.pointerEnter(ring); fireEvent.pointerLeave(ring);
  expect(screen.getByRole('tooltip')).toBeTruthy(); act(() => ring.blur()); expect(screen.queryByRole('tooltip')).toBeNull();
});
