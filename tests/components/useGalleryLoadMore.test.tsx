// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGalleryLoadMore } from '../../components/useGalleryLoadMore';

class EndObserver {
  static instances: EndObserver[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { EndObserver.instances.push(this); }
  observe(target: Element) { this.targets.push(target); this.disconnected = false; }
  disconnect() { this.targets = []; this.disconnected = true; }
  intersect(states: boolean[]) {
    this.callback(this.targets.map((target, index) => ({ target, isIntersecting: states[index] ?? false } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

const List = ({ loadMore, enabled = true, grid = false, pendingWidth = false, groups = 1, count = 1, progress }: {
  loadMore: () => void; enabled?: boolean; grid?: boolean; pendingWidth?: boolean; groups?: number; count?: number; progress?: number;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useGalleryLoadMore(root, sentinel, enabled, loadMore, '600px 0px', progress);
  return <div ref={root} data-testid="scroll">
    {grid ? <div className="workspace-card-grid">{Array.from({ length: count }, (_, index) => <article key={index}>{index}</article>)}</div> : Array.from({ length: groups }, (_, group) => <div className="chain-masonry" key={group}>
      {!pendingWidth && Array.from({ length: 5 }, (_, column) => <div className="chain-masonry-column" key={column}>
        {Array.from({ length: count }, (_, index) => <article key={index}>{group}-{column}-{index}</article>)}<div data-masonry-load-end="true" data-group={group} />
      </div>)}
    </div>)}
    <div ref={sentinel} data-testid="bottom" />
  </div>;
};

beforeEach(() => { EndObserver.instances = []; vi.stubGlobal('IntersectionObserver', EndObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('最短列先到预取区域时追加，不等待最长列；同一轮多个列与DOM变化只请求一次', async () => {
  const loadMore = vi.fn();
  const { container } = render(<List loadMore={loadMore} />);
  const observer = EndObserver.instances[0];
  expect(observer.targets).toEqual([...container.querySelectorAll('[data-masonry-load-end]')]);
  expect(observer.targets).not.toContain(container.querySelector('[data-testid="bottom"]'));
  expect(observer.options).toEqual({ root: container.firstElementChild, rootMargin: '600px 0px' });
  act(() => observer.intersect([false, true, false, true, false]));
  expect(loadMore).toHaveBeenCalledTimes(1);
  container.querySelector('article')!.append(document.createElement('span'));
  await waitFor(() => expect(observer.targets).toHaveLength(5));
  act(() => observer.intersect([true, true, true, true, true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('首帧未测列宽时等待真实列尾，几何节点出现后自动接入观察', async () => {
  const loadMore = vi.fn();
  const { container, rerender } = render(<List loadMore={loadMore} pendingWidth />);
  const observer = EndObserver.instances[0];
  expect(observer.targets).toEqual([]);
  rerender(<List loadMore={loadMore} />);
  await waitFor(() => expect(observer.targets).toEqual([...container.querySelectorAll('[data-masonry-load-end]')]));
  act(() => observer.intersect([false, false, true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('分组列表只观察最后一组，避免前面日期组末尾可见时连续追加', () => {
  render(<List loadMore={vi.fn()} groups={2} />);
  expect(EndObserver.instances[0].targets).toHaveLength(5);
  expect(EndObserver.instances[0].targets.every(target => target.getAttribute('data-group') === '1')).toBe(true);
});

it('普通网格继续用原底部哨兵，loading或无更多时停止，下批就绪再启用', () => {
  const loadMore = vi.fn();
  const { container, rerender } = render(<List loadMore={loadMore} grid />);
  const original = EndObserver.instances[0];
  expect(original.targets).toEqual([container.querySelector('[data-testid="bottom"]')]);
  act(() => original.intersect([true]));
  rerender(<List loadMore={loadMore} grid enabled={false} />);
  expect(original.disconnected).toBe(true);
  expect(EndObserver.instances).toHaveLength(1);
  rerender(<List loadMore={loadMore} grid />);
  act(() => EndObserver.instances[1].intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(2);
});

it('没有IntersectionObserver时保留页面的手动更多入口且不启动观察', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  // 旧浏览器通常不存在这个属性，而不是存在但值为undefined。
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  render(<List loadMore={vi.fn()} />);
  expect(EndObserver.instances).toHaveLength(0);
});

it('十次无关渲染保留同一观察器并调用最新回调，图标更新不重新订阅或释放锁', async () => {
  const first = vi.fn();
  const latest = vi.fn();
  const { container, rerender } = render(<List loadMore={() => first()} />);
  const observer = EndObserver.instances[0];
  const observe = vi.spyOn(observer, 'observe');
  const disconnect = vi.spyOn(observer, 'disconnect');
  for (let index = 0; index < 10; index++) rerender(<List loadMore={() => latest()} />);
  act(() => observer.intersect([true, true]));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  await act(async () => { container.querySelector('article')!.replaceChildren(document.createElement('svg')); });
  act(() => observer.intersect([true]));
  expect(latest).toHaveBeenCalledTimes(1);
  expect(EndObserver.instances).toHaveLength(1);
  expect(observe).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
});

it.each([false, true])('真实追加卡片后继续加载，复用列尾／网格哨兵（grid=%s）', async grid => {
  const loadMore = vi.fn();
  const { rerender } = render(<List loadMore={loadMore} grid={grid} />);
  const observer = EndObserver.instances[0];
  const originalTargets = [...observer.targets];
  act(() => observer.intersect([true]));
  rerender(<List loadMore={loadMore} grid={grid} count={2} />);
  await act(async () => {});
  expect(observer.targets).toEqual(originalTargets);
  act(() => observer.intersect([true, true]));
  act(() => observer.intersect([true, true]));
  expect(loadMore).toHaveBeenCalledTimes(2);
  expect(EndObserver.instances).toHaveLength(1);
});

it('末组改变后解绑旧目标；卸载后迟到通知不再请求', async () => {
  const loadMore = vi.fn();
  const { rerender, unmount } = render(<List loadMore={loadMore} groups={2} />);
  const observer = EndObserver.instances[0];
  rerender(<List loadMore={loadMore} groups={1} />);
  await waitFor(() => expect(observer.targets.every(target => target.getAttribute('data-group') === '0')).toBe(true));
  const targets = [...observer.targets];
  unmount();
  expect(observer.disconnected).toBe(true);
  observer.targets = targets;
  act(() => observer.intersect([true]));
  expect(loadMore).not.toHaveBeenCalled();
});

it('请求失败且没有新卡片时保持锁，手动重试追加成功后恢复连续加载', async () => {
  const loadMore = vi.fn();
  const { rerender } = render(<List loadMore={loadMore} />);
  const observer = EndObserver.instances[0];
  act(() => observer.intersect([true]));
  rerender(<List loadMore={() => loadMore()} />);
  act(() => observer.intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
  rerender(<List loadMore={loadMore} count={2} />);
  await act(async () => {});
  act(() => observer.intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(2);
});

it('成功游标前进但空页／筛选／去重没有新增DOM时仍能继续；同进度重渲染不释放锁', () => {
  const loadMore = vi.fn();
  const { rerender } = render(<List loadMore={loadMore} grid count={0} progress={1} />);
  act(() => EndObserver.instances.at(-1)!.intersect([true]));
  rerender(<List loadMore={() => loadMore()} grid count={0} progress={1} />);
  act(() => EndObserver.instances.at(-1)!.intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
  rerender(<List loadMore={loadMore} grid count={0} progress={2} />);
  act(() => EndObserver.instances.at(-1)!.intersect([true]));
  act(() => EndObserver.instances.at(-1)!.intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(2);
});
