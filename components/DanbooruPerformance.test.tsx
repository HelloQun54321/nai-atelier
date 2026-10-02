// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { computeShortestColumnAssignment, ShortestColumnMasonry } from './ShortestColumnMasonry';
import { useImageRatios } from './useImageRatios';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('真实瀑布流尺寸更新不重建旧卡片，重新排序按新顺序安排首列', () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 200 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const key = (value: string) => value;
  const card = (value: string) => <span data-testid={value}>{value}</span>;
  const view = (items: string[], tall = false) => <ShortestColumnMasonry stableColumns columns={2} items={items} getItemKey={key} renderItem={card} estimateItemHeight={value => tall && value === 'a' ? 1000 : 100} />;
  const { rerender } = render(view(['a', 'b', 'c', 'd']));
  const original = screen.getByTestId('c'); const column = original.parentElement;
  rerender(view(['a', 'b', 'c', 'd', 'e'], true));
  expect(screen.getByTestId('c')).toBe(original); expect(original.parentElement).toBe(column);
  expect(screen.getByTestId('e').parentElement).toBe(screen.getByTestId('b').parentElement);
  rerender(view(['e', 'd', 'c', 'b', 'a'], true));
  expect(screen.getByTestId('e').parentElement).toBe(column);
});
it('尺寸返回保留旧卡片所在列，新卡片仍选择当前最短列', () => {
  const old = new Map<string, number>(); const items = ['a', 'b', 'c', 'd'];
  computeShortestColumnAssignment(items, 2, () => 100, 100, { previous: new Map(), next: old, key: key => key });
  const next = new Map<string, number>();
  const columns = computeShortestColumnAssignment([...items, 'e'], 2, key => key === 'a' ? 1000 : 100, 100, { previous: old, next, key: key => key });
  for (const key of items) expect(next.get(key)).toBe(old.get(key));
  expect(columns[1]).toEqual(['b', 'd', 'e']);
});
it('同帧多张图片仅更新一次父状态，重复尺寸和非法尺寸不会改变状态', () => {
  const callbacks: FrameRequestCallback[] = [];
  const raf = vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const { result } = renderHook(() => useImageRatios());
  act(() => { result.current[1]('a', 800, 400); result.current[1]('b', 400, 800); result.current[1]('bad', 0, 0); });
  expect(raf).toHaveBeenCalledTimes(1); expect(result.current[0]).toEqual({});
  act(() => callbacks.shift()!(0)); expect(result.current[0]).toEqual({ a: 2, b: 0.5 });
  const before = result.current[0];
  act(() => result.current[1]('a', 800, 400)); act(() => callbacks.shift()!(0)); expect(result.current[0]).toBe(before);
});
