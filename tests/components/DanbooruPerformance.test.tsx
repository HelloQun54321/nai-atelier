// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { computeShortestColumnAssignment, resolveMasonryColumnCount, ShortestColumnMasonry, useMasonryColumnCount } from '../../components/ShortestColumnMasonry';
import { mobileGalleryStyle, type MobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { useImageRatios } from '../../components/useImageRatios';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('自动列数按实际内容宽度收缩，忽略隐藏宽度；窄窗把明确桌面列数收敛到可读列宽', () => {
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 800);
  let resize!: (width: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = width => callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    observe() { resize(1100); }
    disconnect() {}
  });
  const preferences: MobileImageDisplayPreferences = { layout: 'portrait', columns: 'auto', desktopColumns: 'auto' };
  function Gallery({ value, override, minimumCardWidth }: { value: MobileImageDisplayPreferences; override?: number; minimumCardWidth?: number }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const count = useMasonryColumnCount(value, override, ref, minimumCardWidth);
    return <div ref={ref} data-testid="columns" style={mobileGalleryStyle(value, count)}>{count}</div>;
  }
  const { rerender } = render(<Gallery value={preferences} />);
  const expectColumns = (value: number) => {
    const grid = screen.getByTestId('columns'); expect(grid.textContent).toBe(String(value));
    expect(grid.style.getPropertyValue('--mobile-gallery-columns')).toBe(String(value));
  };
  expectColumns(5);
  act(() => resize(740)); expectColumns(3);
  act(() => resize(0)); expectColumns(3);
  act(() => resize(756)); expectColumns(4);
  act(() => resize(1400)); expectColumns(5);
  rerender(<Gallery value={preferences} minimumCardWidth={240} />); act(() => resize(840)); expectColumns(3);
  act(() => resize(500)); expectColumns(2);
  rerender(<Gallery value={preferences} />);
  // 明确 5 列在 760px 内容宽时收敛到 3 列（每列约 245px）；压到 300px 时只留 1 列，避免卡片比操作列还窄。
  rerender(<Gallery value={{ ...preferences, desktopColumns: 5 }} />); act(() => resize(760)); expectColumns(3);
  act(() => resize(300)); expectColumns(1);
  rerender(<Gallery value={preferences} override={6} />); expectColumns(6);
  rerender(<Gallery value={{ ...preferences, desktopColumns: 5 }} override={6} />); expectColumns(5);
  vi.stubGlobal('innerWidth', 390); act(() => window.dispatchEvent(new Event('resize'))); expectColumns(2);
  rerender(<Gallery value={{ ...preferences, columns: 1 }} />); expectColumns(1);
  rerender(<Gallery value={preferences} />);
  vi.stubGlobal('innerWidth', 700); vi.stubGlobal('innerHeight', 390); act(() => window.dispatchEvent(new Event('resize'))); expectColumns(3);
});
it('详情分栏打开时冻结容器宽度，列数不随临时挤压变化', () => {
  vi.stubGlobal('innerWidth', 1400); vi.stubGlobal('innerHeight', 800);
  let resize!: (width: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = width => callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    observe() { resize(1500); }
    disconnect() {}
  });
  const preferences: MobileImageDisplayPreferences = { layout: 'masonry', columns: 'auto', desktopColumns: 'auto' };
  function Gallery({ freeze }: { freeze: boolean }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const count = useMasonryColumnCount(preferences, undefined, ref, undefined, false, freeze);
    return <div ref={ref} data-testid="columns">{count}</div>;
  }
  const expectColumns = (value: number) => expect(screen.getByTestId('columns').textContent).toBe(String(value));
  const { rerender } = render(<Gallery freeze={false} />);
  act(() => resize(1500)); expectColumns(5);
  // 详情打开：effect 断开容器观察，并排面板挤窄容器也不再改列数。
  rerender(<Gallery freeze />); expectColumns(5);
  // 详情关闭：重新观察真实容器宽度后按需收敛。
  rerender(<Gallery freeze={false} />); act(() => resize(1500)); expectColumns(5);
  act(() => resize(900)); expectColumns(4);
});
it('桌面兜底列数不能覆盖明确偏好，手机列数与横屏始终遵循有效偏好', () => {
  const preferences: MobileImageDisplayPreferences = { layout: 'masonry', columns: 'auto', desktopColumns: 'auto' };
  expect(resolveMasonryColumnCount(preferences, 390, false, 6)).toBe(2);
  expect(resolveMasonryColumnCount({ ...preferences, columns: 1 }, 390, false, 6)).toBe(1);
  expect(resolveMasonryColumnCount({ ...preferences, columns: 3 }, 767, false, 6)).toBe(3);
  expect(resolveMasonryColumnCount(preferences, 700, true, 6)).toBe(3);
  expect(resolveMasonryColumnCount(preferences, 768, true, 6)).toBe(6);
  expect(resolveMasonryColumnCount({ ...preferences, desktopColumns: 5 }, 768, true, 6)).toBe(5);
  expect(resolveMasonryColumnCount({ ...preferences, desktopColumns: 2 }, 1600, false, 6)).toBe(2);
});

it('瀑布流支持显式7列桌面偏好，自适应断点与手机上限保持原值', () => {
  const preferences: MobileImageDisplayPreferences = { layout: 'masonry', columns: 3, desktopColumns: 7 };
  expect(resolveMasonryColumnCount(preferences, 768, false)).toBe(7);
  expect(resolveMasonryColumnCount(preferences, 1600, false)).toBe(7);
  expect(resolveMasonryColumnCount({ ...preferences, desktopColumns: 'auto', columns: 'auto' }, 390, false)).toBe(2);
  expect(resolveMasonryColumnCount({ ...preferences, desktopColumns: 'auto', columns: 'auto' }, 700, true)).toBe(3);
  expect(resolveMasonryColumnCount({ ...preferences, desktopColumns: 'auto', columns: 'auto' }, 1600, false)).toBe(6);
});
it('真实瀑布流尺寸更新不重建旧卡片，重新排序按新顺序安排首列', () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 200 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const key = (value: string) => value;
  const card = (value: string) => <span data-testid={value}>{value}</span>;
  const view = (items: string[], tall = false) => <ShortestColumnMasonry columns={2} items={items} getItemKey={key} renderItem={card} estimateItemHeight={value => tall && value === 'a' ? 1000 : 100} />;
  const { rerender } = render(view(['a', 'b', 'c', 'd']));
  const original = screen.getByTestId('c'); const column = original.parentElement;
  rerender(view(['a', 'b', 'c', 'd', 'e'], true));
  expect(screen.getByTestId('c')).toBe(original); expect(original.parentElement).toBe(column);
  expect(screen.getByTestId('e').parentElement).toBe(screen.getByTestId('b').parentElement);
  rerender(view(['e', 'd', 'c', 'b', 'a'], true));
  expect(screen.getByTestId('e').parentElement).toBe(column);
});
it('默认瀑布流在侧栏反复挤压时保留所有图片节点，主动改变列数仍重新分列', () => {
  let resize!: (width: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = width => callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    observe() { resize(612); }
    disconnect() {}
  });
  const items = ['a', 'b', 'c', 'd'];
  const view = (columns: number) => <ShortestColumnMasonry columns={columns} items={items} getItemKey={value => value}
    estimateItemHeight={(value, width) => value === 'a' ? width * 2 : width + (value === 'b' ? 160 : 0)}
    renderItem={value => <img data-testid={value} src={`/synthetic/${value}.png`} />} />;
  const { container, rerender } = render(view(2));
  const images = items.map(value => screen.getByTestId(value));
  const columns = images.map(image => image.parentElement);
  for (const width of [500, 400, 312, 0, 400, 612, 312, 612]) {
    act(() => resize(width));
    items.forEach((value, index) => {
      expect(screen.getByTestId(value)).toBe(images[index]);
      expect(images[index].parentElement).toBe(columns[index]);
    });
  }
  rerender(view(3));
  const newColumns = container.querySelectorAll('.chain-masonry-column');
  expect(newColumns).toHaveLength(3);
  items.slice(0, 3).forEach((value, index) => expect(screen.getByTestId(value).parentElement).toBe(newColumns[index]));
});
it('尺寸返回保留旧卡片所在列，新卡片仍选择当前最短列', () => {
  const old = new Map<string, number>(); const items = ['a', 'b', 'c', 'd'];
  computeShortestColumnAssignment(items, 2, () => 100, 100, { previous: new Map(), next: old, key: key => key });
  const next = new Map<string, number>();
  const columns = computeShortestColumnAssignment([...items, 'e'], 2, key => key === 'a' ? 1000 : 100, 100, { previous: old, next, key: key => key });
  for (const key of items) expect(next.get(key)).toBe(old.get(key));
  expect(columns[1]).toEqual(['b', 'd', 'e']);
});
it('尾部追加优先真实短列，计入间距，迟到尺寸与宽度变化不搬动旧卡片', () => {
  let resize!: (width: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = width => callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    observe() { resize(1000); }
    disconnect() {}
  });
  const key = (value: string) => value;
  const renderItem = (value: string) => <img data-testid={value} src={`/synthetic/${value}.png`} />;
  const initial = ['a', 'b', 'c', 'd', 'e'];
  const view = (items: string[], tall = false, resetKey = 'all') => <ShortestColumnMasonry columns={5} items={items} getItemKey={key}
    renderItem={renderItem} resetKey={resetKey} estimateItemHeight={value => tall && value !== 'e' ? 500 : 100} />;
  const { container, rerender } = render(view(initial));
  const columns = Array.from(container.querySelectorAll<HTMLElement>('.chain-masonry-column'));
  const images = initial.map(value => screen.getByTestId(value));
  // 标题/磨砂布局与迟到横竖图让实高与估高相反：第五列在屏幕上明显最短。
  columns.forEach((column, index) => vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => ({ height: index === 4 ? 100 : 800 } as DOMRect)));
  rerender(view([...initial, 'f', 'g', 'h']));
  for (const value of ['f', 'g', 'h']) expect(screen.getByTestId(value).parentElement).toBe(columns[4]);
  initial.forEach((value, index) => { expect(screen.getByTestId(value)).toBe(images[index]); expect(images[index].parentElement).toBe(columns[index]); });
  rerender(view([...initial, 'f', 'g', 'h'], true));
  act(() => resize(760));
  initial.forEach((value, index) => expect(screen.getByTestId(value)).toBe(images[index]));
  // 下一批再次读取最新实高，而非沿用上一轮估高；此时第一列更短。
  vi.mocked(columns[0].getBoundingClientRect).mockReturnValue({ height: 50 } as DOMRect);
  rerender(view([...initial, 'f', 'g', 'h', 'i'], true));
  expect(screen.getByTestId('i').parentElement).toBe(columns[0]);
  // 查询条件变化但结果恰好前缀相同，也必须清掉旧分列。
  rerender(view([...initial, 'f', 'g', 'h', 'i', 'j'], true, 'new-filter'));
  expect(screen.getByTestId('g').parentElement).toBe(columns[0]);
});
it('每列末尾提供不增加列高或间距的绝对定位分页标记', () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 600 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const { container } = render(<ShortestColumnMasonry columns={3} items={['a', 'b', 'c', 'd']}
    getItemKey={value => value} estimateItemHeight={() => 100} renderItem={value => <span>{value}</span>} />);
  const columns = container.querySelectorAll<HTMLElement>('.chain-masonry-column');
  expect(columns).toHaveLength(3);
  expect(container.querySelectorAll('[data-masonry-load-end="true"]')).toHaveLength(3);
  for (const column of columns) {
    const marker = column.lastElementChild as HTMLElement;
    expect(column.style.position).toBe('relative');
    expect(marker.dataset.masonryLoadEnd).toBe('true');
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.style.position).toBe('absolute');
    expect(marker.style.bottom).toBe('0px');
    expect(marker.style.width).toBe('1px');
    expect(marker.style.height).toBe('1px');
  }
});
it('切换筛选重新最短列分配，首行五列之后不会沿用筛选前的第一列堆叠', () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1000 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const items = Array.from({ length: 30 }, (_, index) => String(index));
  const filtered = items.filter((_, index) => index < 5 || index % 5 === 0);
  const view = (values: string[]) => <ShortestColumnMasonry columns={5} items={values} getItemKey={value => value}
    estimateItemHeight={() => 100} renderItem={value => <span data-testid={`filtered-${value}`}>{value}</span>} />;
  const { container, rerender } = render(view(items));
  const expectBalanced = (values: string[]) => {
    const columns = container.querySelectorAll('.chain-masonry-column');
    values.forEach((value, index) => expect(screen.getByTestId(`filtered-${value}`).parentElement).toBe(columns[index % 5]));
  };
  expectBalanced(items);
  for (let count = 0; count < 3; count++) {
    rerender(view(filtered)); expectBalanced(filtered);
    rerender(view(items)); expectBalanced(items);
  }
});
it.each([
  [['x', 'a', 'b', 'c', 'd'], [0, 1, 0, 0, 0]],
  [['z', 'b', 'c', 'd'], [0, 1, 0, 1]],
] as const)('中途插入或替换卡片后重新平衡：%s', (items, expectedColumns) => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 200 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const view = (values: readonly string[]) => <ShortestColumnMasonry columns={2} items={values} getItemKey={value => value}
    estimateItemHeight={value => value === 'a' ? 1000 : 100} renderItem={value => <span data-testid={`changed-${value}`}>{value}</span>} />;
  const { container, rerender } = render(view(['a', 'b', 'c', 'd']));
  rerender(view(items));
  const columns = container.querySelectorAll('.chain-masonry-column');
  items.forEach((value, index) => expect(screen.getByTestId(`changed-${value}`).parentElement).toBe(columns[expectedColumns[index]]));
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

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));
