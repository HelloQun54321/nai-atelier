// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { computeShortestColumnAssignment, resolveMasonryColumnCount, ShortestColumnMasonry } from '../../components/ShortestColumnMasonry';
import type { MobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { useImageRatios } from '../../components/useImageRatios';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('两类目录桌面六列只覆盖桌面，手机列数与横屏仍遵循图片偏好', () => {
  const preferences: MobileImageDisplayPreferences = { layout: 'masonry', columns: 'auto', desktopColumns: 'auto' };
  expect(resolveMasonryColumnCount(preferences, 390, false, 6)).toBe(2);
  expect(resolveMasonryColumnCount({ ...preferences, columns: 1 }, 390, false, 6)).toBe(1);
  expect(resolveMasonryColumnCount({ ...preferences, columns: 3 }, 767, false, 6)).toBe(3);
  expect(resolveMasonryColumnCount(preferences, 700, true, 6)).toBe(3);
  expect(resolveMasonryColumnCount(preferences, 768, true, 6)).toBe(6);
});
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
it('真实瀑布流隐藏时保留卡片身份和列，返回与切页不因零宽度清空列表', () => {
  let resize!: (width: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = width => callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    observe() { resize(390); }
    disconnect() {}
  });
  const items = ['a', 'b', 'c', 'd'];
  const { container } = render(<ShortestColumnMasonry stableColumns columns={2} items={items} getItemKey={value => value} estimateItemHeight={() => 100} renderItem={value => <img data-testid={value} src={`/synthetic/${value}.png`} />} />);
  const cards = items.map(value => screen.getByTestId(value));
  const columns = cards.map(card => card.parentElement);
  for (const width of [0, 390, 0, 640]) {
    act(() => resize(width));
    items.forEach((value, index) => {
      expect(screen.getByTestId(value)).toBe(cards[index]);
      expect(cards[index].parentElement).toBe(columns[index]);
    });
    expect(container.querySelectorAll('.chain-masonry-column')).toHaveLength(2);
  }
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
