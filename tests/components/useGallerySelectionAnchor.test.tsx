// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGallerySelectionAnchor } from '../../components/useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from '../../components/useKeepAliveScrollRestore';
import { ImageActivityContext } from '../../components/SmartImage';

const resizeCallbacks = new Set<() => void>();
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; });
let controls: ReturnType<typeof useGallerySelectionAnchor>;
let viewNumber = 0;
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 800, width: 800 } as DOMRect);
interface Geometry { height: number; total: number; tops: Record<string | number, number>; cardHeight: number }
const Harness = ({ selectedId, active = true, geometry, viewKey, ids = [1, 2] }: { selectedId: string | number | null; active?: boolean; geometry: Geometry; viewKey: string; ids?: (string | number)[] }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  controls = useGallerySelectionAnchor(rootRef, contentRef, selectedId, active);
  const saveScroll = useKeepAliveScrollRestore(rootRef, viewKey, { skipRestore: controls.hasAnchor });
  return <div data-testid="root" ref={node => {
    rootRef.current = node;
    if (!node) return;
    Object.defineProperties(node, {
      clientHeight: { configurable: true, get: () => geometry.height },
      scrollHeight: { configurable: true, get: () => geometry.total },
    });
    node.getBoundingClientRect = () => rect(100, geometry.height);
  }} onScroll={() => { controls.onScroll(); saveScroll(); }}>
    <div ref={contentRef}>{ids.map(id => <div key={id} data-gallery-work-id={id} ref={node => {
      if (node) node.getBoundingClientRect = () => rect(100 + geometry.tops[id] - (rootRef.current?.scrollTop ?? 0), geometry.cardHeight);
    }} />)}</div>
  </div>;
};

beforeEach(() => {
  vi.useFakeTimers();
  scrollTo.mockClear();
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  resizeCallbacks.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { resizeCallbacks.add(callback); }
    observe() {} unobserve() {}
    disconnect() { resizeCallbacks.delete(this.callback); }
  });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion;
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
const resize = () => act(() => { resizeCallbacks.forEach(callback => callback()); vi.advanceTimersByTime(32); });
const setup = (selectedId: number | null = 1) => {
  const geometry: Geometry = { height: 600, total: 4000, tops: { 1: 1800, 2: 2600 }, cardHeight: 300 };
  const viewKey = `selection-${viewNumber++}`;
  const draw = (id: number | null, active = true) => <ImageActivityContext.Provider value={active}><Harness selectedId={id} active={active} geometry={geometry} viewKey={viewKey} /></ImageActivityContext.Provider>;
  const view = render(draw(selectedId));
  return { ...view, root: view.getByTestId('root'), geometry, draw };
};

describe('作品选择定位', () => {
  it('点击只启动一次平滑滚动，中间帧及重渲染不改写终点，布局变化平滑更新终点', () => {
    const { root, geometry, rerender, draw } = setup(null);
    const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') root.scrollTop = options.top!; });
    Object.defineProperty(root, 'scrollTo', { configurable: true, value: scroll });
    rerender(draw(1));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 1650, behavior: 'smooth' });
    expect(root.scrollTop).toBe(0);
    root.scrollTop = 800; fireEvent.scroll(root);
    rerender(draw(1)); resize();
    expect(root.scrollTop).toBe(800); expect(scroll).toHaveBeenCalledOnce();
    geometry.tops[1] += 200; resize();
    expect(scroll).toHaveBeenLastCalledWith({ top: 1850, behavior: 'smooth' });
    expect(root.scrollTop).toBe(800);
    root.scrollTop = 1850; fireEvent.scroll(root);
    geometry.tops[1] += 100; resize();
    expect(scroll).toHaveBeenLastCalledWith({ top: 1950, behavior: 'instant' });
    expect(root.scrollTop).toBe(1950);
  });

  it.each(['wheel', 'touchstart', 'pointerdown'])('动画中 %s 停止自动滚动并保留用户调整的位置', input => {
    const { root, geometry, rerender, draw } = setup(null);
    const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') root.scrollTop = options.top!; });
    Object.defineProperty(root, 'scrollTo', { configurable: true, value: scroll });
    rerender(draw(1)); root.scrollTop = 800; fireEvent.scroll(root);
    fireEvent(root, new Event(input, { bubbles: true }));
    expect(scroll).toHaveBeenLastCalledWith({ top: 800, behavior: 'instant' });
    root.scrollTop = 950; fireEvent.scroll(root);
    act(() => vi.advanceTimersByTime(32));
    geometry.tops[1] += 100; resize();
    expect(root.scrollTop).toBe(1050);
  });

  it('动画中搜索重置停止旧动画，后续图片重排不拉动新列表', () => {
    const { root, geometry, rerender, draw } = setup(null);
    const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') root.scrollTop = options.top!; });
    Object.defineProperty(root, 'scrollTo', { configurable: true, value: scroll });
    rerender(draw(1)); root.scrollTop = 800; fireEvent.scroll(root);
    controls.clearAnchor();
    expect(scroll).toHaveBeenLastCalledWith({ top: 800, behavior: 'instant' });
    root.scrollTop = 0; fireEvent.scroll(root); rerender(draw(null));
    geometry.tops[1] += 200; resize();
    expect(root.scrollTop).toBe(0);
  });

  it('动画中切页不向隐藏列表写滚动，返回时直接恢复作品位置', () => {
    const { root, geometry, rerender, draw } = setup(null);
    const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') root.scrollTop = options.top!; });
    Object.defineProperty(root, 'scrollTo', { configurable: true, value: scroll });
    rerender(draw(1)); root.scrollTop = 800; fireEvent.scroll(root);
    geometry.height = 0; rerender(draw(1, false));
    expect(scroll).toHaveBeenCalledOnce();
    root.scrollTop = 0; fireEvent.scroll(root); geometry.tops[1] += 200;
    geometry.height = 600; rerender(draw(1));
    expect(scroll).toHaveBeenLastCalledWith({ top: 1850, behavior: 'instant' });
    expect(root.scrollTop).toBe(1850);
  });

  it('动画途中关闭保留当时位置，换作品仍从当前位置平滑滚动', () => {
    const { root, geometry, rerender, draw } = setup(null);
    const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') root.scrollTop = options.top!; });
    Object.defineProperty(root, 'scrollTo', { configurable: true, value: scroll });
    rerender(draw(1)); root.scrollTop = 800; fireEvent.scroll(root);
    rerender(draw(2));
    expect(scroll).toHaveBeenLastCalledWith({ top: 2450, behavior: 'smooth' });
    root.scrollTop = 1200; fireEvent.scroll(root);
    controls.preserveOnClose(); geometry.tops[2] += 300;
    rerender(draw(null)); resize();
    expect(scroll).toHaveBeenLastCalledWith({ top: 1500, behavior: 'instant' });
    expect(root.scrollTop).toBe(1500);
  });

  it.each([['reduced', false], ['off', false], ['full', true]])('项目动画=%s，系统减少动画=%s 时直接定位', (motion, reduced) => {
    document.documentElement.dataset.motion = motion as string;
    vi.mocked(window.matchMedia).mockReturnValue({ matches: reduced } as MediaQueryList);
    const { rerender, draw } = setup(null);
    rerender(draw(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1650, behavior: 'instant' });
  });

  it('收藏组 JSON 标识与带引号的资源名也能准确定位，不解释为 CSS 选择器', () => {
    const id = '["aitag","sample\\name",null]';
    const geometry: Geometry = { height: 600, total: 4000, tops: { [id]: 1800 }, cardHeight: 300 };
    const view = render(<Harness selectedId={id} geometry={geometry} ids={[id]} viewKey={`string-selection-${viewNumber++}`} />);
    expect(view.getByTestId('root').scrollTop).toBe(1650);
  });

  it('以列表可视高度居中，详情展开后按新卡片位置而非旧 scrollTop 补偿', () => {
    const { root, geometry } = setup();
    expect(root.scrollTop).toBe(1650);
    geometry.tops[1] = 2300;
    geometry.cardHeight = 200;
    resize();
    expect(root.scrollTop).toBe(2100);
  });

  it('直接选择另一张作品，切换平滑滚动的居中目标', () => {
    const { root, rerender, draw } = setup();
    rerender(draw(2));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2450, behavior: 'smooth' });
    expect(root.scrollTop).toBe(2450);
  });

  it('上方图片异步改变高度，即使总高度不变也补偿选中作品', async () => {
    const { root, geometry } = setup();
    geometry.tops[1] += 220;
    await act(async () => { root.querySelector('[data-gallery-work-id="2"]')!.setAttribute('style', 'height: 350px'); });
    act(() => vi.advanceTimersByTime(32));
    expect(root.scrollTop).toBe(1870);
  });

  it('主动滚动不拉回中央，后续重排保留用户移动后的屏幕高度', () => {
    const { root, geometry, rerender, draw } = setup();
    fireEvent.wheel(root, { deltaY: 200 });
    root.scrollTop = 1850;
    fireEvent.scroll(root);
    act(() => vi.advanceTimersByTime(32));
    rerender(draw(1));
    expect(root.scrollTop).toBe(1850);
    geometry.tops[1] += 120;
    resize();
    expect(root.scrollTop).toBe(1970);
  });

  it('点击新作品时，前一个指针事件不覆盖新作品的居中目标', () => {
    const { root, geometry, rerender, draw } = setup();
    fireEvent.pointerDown(root);
    rerender(draw(2));
    act(() => vi.advanceTimersByTime(32));
    geometry.tops[2] += 100;
    resize();
    expect(root.scrollTop).toBe(2550);
  });

  it('关闭详情后的变宽重排保持旧作品高度，像素恢复定时器不争抢位置', () => {
    const { root, geometry, rerender, draw } = setup();
    fireEvent.scroll(root);
    controls.preserveOnClose();
    geometry.tops[1] = 2200;
    rerender(draw(null));
    resize();
    act(() => vi.advanceTimersByTime(500));
    expect(root.scrollTop).toBe(2050);
    root.scrollTop = 2100;
    fireEvent.scroll(root);
    geometry.tops[1] += 300;
    resize();
    expect(root.scrollTop).toBe(2100);
  });

  it('真实指针点击关闭时，待执行的输入回调不覆盖关闭前的位置', () => {
    const { root, geometry, rerender, draw } = setup();
    fireEvent.pointerDown(root);
    controls.preserveOnClose();
    geometry.tops[1] += 400;
    rerender(draw(null));
    act(() => vi.advanceTimersByTime(32));
    geometry.tops[1] += 100;
    resize();
    expect(root.scrollTop).toBe(2150);
  });

  it('切换页面时忽略隐藏清零，返回重新居中同一作品', () => {
    const { root, geometry, rerender, draw } = setup();
    geometry.height = 0;
    rerender(draw(1, false));
    root.scrollTop = 0;
    fireEvent.scroll(root);
    geometry.height = 600;
    geometry.tops[1] = 2400;
    rerender(draw(1));
    expect(root.scrollTop).toBe(2250);
  });

  it('窄屏详情隐藏列表时不写滚动，关闭详情后定位到原作品', () => {
    const { root, geometry, rerender, draw } = setup(null);
    geometry.height = 0;
    rerender(draw(1));
    expect(root.scrollTop).toBe(0);
    controls.preserveOnClose();
    geometry.height = 600;
    rerender(draw(null));
    expect(root.scrollTop).toBe(1650);
  });

  it('首尾作品受滚动边界限制时不产生负数或超出末尾的定位', () => {
    const { root, geometry } = setup();
    geometry.tops[1] = 0;
    resize();
    expect(root.scrollTop).toBe(0);
    geometry.tops[1] = 3800;
    resize();
    expect(root.scrollTop).toBe(3400);
  });

  it('无选中作品时继续使用原有像素恢复，关闭后切页也不丢位置', () => {
    const { root, geometry, rerender, draw } = setup();
    fireEvent.scroll(root);
    controls.preserveOnClose();
    rerender(draw(null));
    fireEvent.scroll(root);
    geometry.height = 0;
    rerender(draw(null, false));
    root.scrollTop = 0;
    fireEvent.scroll(root);
    geometry.height = 600;
    rerender(draw(null));
    expect(root.scrollTop).toBe(1650);
  });

  it('搜索重置清掉锚点，旧作品后续加载不再拉动新结果列表', () => {
    const { root, geometry, rerender, draw } = setup();
    controls.clearAnchor();
    root.scrollTop = 0;
    fireEvent.scroll(root);
    rerender(draw(null));
    geometry.tops[1] += 300;
    resize();
    expect(root.scrollTop).toBe(0);
  });
});
