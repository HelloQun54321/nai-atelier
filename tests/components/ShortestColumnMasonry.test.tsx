// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShortestColumnMasonry } from '../../components/ShortestColumnMasonry';

let resize: (width: number) => void;
let frames: Map<number, FrameRequestCallback>;
const flushFrames = () => act(() => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(0));
});
beforeEach(() => {
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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

const installGeometry = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  const scroll = this.closest<HTMLElement>('[data-scroll]');
  const column = this.classList.contains('chain-masonry-column') ? this : this.parentElement?.classList.contains('chain-masonry-column') ? this.parentElement : null;
  const cards = column ? Array.from(column.children).filter(child => child.hasAttribute('data-height')) as HTMLElement[] : [];
  const heightOf = (card: HTMLElement) => Number(card.dataset.height);
  const scrollTop = scroll?.scrollTop || 0;
  const top = this.hasAttribute('data-scroll') ? 0 : -scrollTop + (column && this !== column ? cards.slice(0, cards.indexOf(this)).reduce((sum, card) => sum + heightOf(card) + 12, 0) : 0);
  const height = this.hasAttribute('data-scroll') ? 250 : column ? this === column ? cards.reduce((sum, card) => sum + heightOf(card) + 12, -12) : heightOf(this) : 1000;
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 1000, width: 1000, height, toJSON() {} } as DOMRect;
});

it.each([2, 5])('%d列真实比例返回后只整理屏幕下方尾部，补齐短列并保留可见节点和滚动位置', columnCount => {
  installGeometry();
  const cards = Array.from({ length: 40 }, (_, index) => String(index));
  const height = (item: string, loaded: boolean) => loaded && Number(item) % columnCount === 1 ? 100 : 300;
  const view = (loaded: boolean) => <div data-scroll style={{ overflowY: 'auto' }}><ShortestColumnMasonry items={cards} columns={columnCount} getItemKey={getItemKey}
    estimateItemHeight={item => height(item, loaded)} renderItem={item => <article data-height={height(item, loaded)} data-key={item}>{item}</article>} /></div>;
  const { container, rerender } = render(view(false));
  const columns = Array.from(container.querySelectorAll('.chain-masonry-column'));
  const visible = cards.slice(0, columnCount).map(item => container.querySelector(`[data-key="${item}"]`)!);
  const tops = visible.map(card => card.getBoundingClientRect().top);
  const scroll = container.querySelector<HTMLElement>('[data-scroll]')!;
  const before = columns.map(column => column.getBoundingClientRect().height);
  expect(new Set(before).size).toBe(1);
  rerender(view(true));
  const after = columns.map(column => column.getBoundingClientRect().height);
  expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(312);
  visible.forEach((card, index) => {
    expect(container.querySelector(`[data-key="${index}"]`)).toBe(card);
    expect(card.parentElement).toBe(columns[index]);
    expect(card.getBoundingClientRect().top).toBe(tops[index]);
  });
  expect(scroll.scrollTop).toBe(0);
  expect(container.querySelectorAll('[data-key]')).toHaveLength(40);
});

it('已经浏览后返回上方的卡片继续保留原列，尺寸更新不搬回已读内容', () => {
  installGeometry();
  const cards = Array.from({ length: 40 }, (_, index) => String(index));
  const view = (loaded: boolean) => <div data-scroll style={{ overflowY: 'auto' }}><ShortestColumnMasonry items={cards} columns={5} getItemKey={getItemKey}
    estimateItemHeight={item => loaded && Number(item) % 5 === 1 ? 100 : 300}
    renderItem={item => <article data-height={loaded && Number(item) % 5 === 1 ? 100 : 300} data-key={item}>{item}</article>} /></div>;
  const { container, rerender } = render(view(false));
  const scroll = container.querySelector<HTMLElement>('[data-scroll]')!;
  scroll.scrollTop = 650;
  act(() => scroll.dispatchEvent(new Event('scroll')));
  flushFrames();
  const seen = cards.slice(0, 15).map(item => container.querySelector(`[data-key="${item}"]`)!);
  const parents = seen.map(card => card.parentElement);
  scroll.scrollTop = 0;
  act(() => scroll.dispatchEvent(new Event('scroll')));
  rerender(view(true));
  seen.forEach((card, index) => {
    expect(container.querySelector(`[data-key="${index}"]`)).toBe(card);
    expect(card.parentElement).toBe(parents[index]);
  });
  expect(scroll.scrollTop).toBe(0);
});

it('千张卡片滚动只二分测量列边界，同帧合并且不响应其他容器滚动', () => {
  const measurements = installGeometry();
  const cards = Array.from({ length: 1000 }, (_, index) => String(index));
  const { container, unmount } = render(<>
    <div data-other style={{ overflowY: 'auto' }} />
    <div data-scroll style={{ overflowY: 'auto' }}><ShortestColumnMasonry items={cards} columns={5} getItemKey={getItemKey}
      estimateItemHeight={() => 300} renderItem={item => <article data-height="300" data-key={item}>{item}</article>} /></div>
  </>);
  const scroll = container.querySelector<HTMLElement>('[data-scroll]')!;
  measurements.mockClear();
  act(() => container.querySelector('[data-other]')!.dispatchEvent(new Event('scroll')));
  expect(frames.size).toBe(0);
  expect(measurements).not.toHaveBeenCalled();
  scroll.scrollTop = 30000;
  act(() => { for (let index = 0; index < 8; index++) scroll.dispatchEvent(new Event('scroll')); });
  expect(frames.size).toBe(1);
  expect(measurements).not.toHaveBeenCalled();
  flushFrames();
  const measuredCards = measurements.mock.contexts.filter(element => element instanceof HTMLElement && element.hasAttribute('data-key')).length;
  expect(measuredCards).toBeGreaterThan(0);
  expect(measuredCards).toBeLessThanOrEqual(40);
  act(() => scroll.dispatchEvent(new Event('scroll')));
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
});
