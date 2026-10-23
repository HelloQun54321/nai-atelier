// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShortestColumnMasonry } from '../../components/ShortestColumnMasonry';

let resize: (width: number) => void;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = width => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    observe() { resize(800); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const items = Array.from({ length: 60 }, (_, index) => String(index));
const getItemKey = (item: string) => item;

it('侧栏连续伸缩时保留图片节点、所属列和滚动位置，不逐帧估高或渲染卡片', () => {
  const estimateItemHeight = vi.fn(() => 100);
  const renderItem = vi.fn((item: string) => <img alt={item} src={`/synthetic/${item}.png`} />);
  const { container } = render(<ShortestColumnMasonry items={items} columns={4} getItemKey={getItemKey} estimateItemHeight={estimateItemHeight} renderItem={renderItem} />);
  const images = Array.from(container.querySelectorAll('img'));
  const parents = images.map(image => image.parentElement);
  container.scrollTop = 350;
  estimateItemHeight.mockClear();
  renderItem.mockClear();
  for (const width of [820, 840, 860, 880, 900, 920, 940, 948, 920, 880, 840, 800, 0, 800]) {
    act(() => resize(width));
    expect(Array.from(container.querySelectorAll('img'))).toEqual(images);
    expect(images.map(image => image.parentElement)).toEqual(parents);
    expect(container.scrollTop).toBe(350);
  }
  expect(renderItem).not.toHaveBeenCalled();
  expect(estimateItemHeight).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLElement>('.chain-masonry')?.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
});

it('伸缩后追加用最新列宽与实际列高，旧图片不搬列；列数及筛选重置仍生效', () => {
  const estimateItemHeight = vi.fn((_item: string, width: number) => width);
  const renderItem = (item: string) => <img alt={item} src={`/synthetic/${item}.png`} />;
  const props = { items: ['a', 'b'], columns: 2, getItemKey, estimateItemHeight, renderItem, resetKey: 'all' };
  const { container, rerender } = render(<ShortestColumnMasonry {...props} />);
  const oldImages = Array.from(container.querySelectorAll('img'));
  const columns = Array.from(container.querySelectorAll('.chain-masonry-column'));
  columns.forEach((column, index) => vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ height: index ? 200 : 700 } as DOMRect));
  act(() => resize(612));
  estimateItemHeight.mockClear();
  rerender(<ShortestColumnMasonry {...props} items={['a', 'b', 'c']} />);
  expect(estimateItemHeight).toHaveBeenCalledExactlyOnceWith('c', 300);
  expect(container.querySelector('img[alt="c"]')?.parentElement).toBe(columns[1]);
  oldImages.forEach((image, index) => expect(image.parentElement).toBe(columns[index]));
  rerender(<ShortestColumnMasonry {...props} items={['a', 'b', 'c']} columns={3} />);
  expect(container.querySelectorAll('.chain-masonry-column')).toHaveLength(3);
  expect(container.querySelector<HTMLElement>('.chain-masonry')?.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  estimateItemHeight.mockClear();
  rerender(<ShortestColumnMasonry {...props} resetKey="filtered" />);
  expect(estimateItemHeight).toHaveBeenCalledWith('a', 300);
  expect(estimateItemHeight).toHaveBeenCalledWith('b', 300);
  expect(container.querySelectorAll('img')).toHaveLength(2);
});

it('显式关闭稳定分列时仍按新宽度重新估算', () => {
  const estimateItemHeight = vi.fn((_item: string, width: number) => width);
  const props = { items, columns: 4, getItemKey, estimateItemHeight, renderItem: (item: string) => <span>{item}</span> };
  const { rerender } = render(<ShortestColumnMasonry {...props} />);
  act(() => resize(1036));
  rerender(<ShortestColumnMasonry {...props} stableColumns={false} />);
  estimateItemHeight.mockClear();
  act(() => resize(1236));
  expect(estimateItemHeight).toHaveBeenCalledTimes(items.length);
  expect(estimateItemHeight).toHaveBeenCalledWith('0', 300);
});
