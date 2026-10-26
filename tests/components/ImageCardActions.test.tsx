// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageCardActions, imageCardActionLayout } from '../../components/ImageCardActions';

let queuedFrames = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  queuedFrames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queuedFrames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queuedFrames.delete(id));
});
const flushLayout = () => { const callbacks = [...queuedFrames.values()]; queuedFrames.clear(); callbacks.forEach(callback => callback(0)); };

afterEach(() => { cleanup(); delete document.documentElement.dataset.galleryFrostedCaption; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const base = { width: 320, height: 180, count: 5, buttonWidth: 32, buttonHeight: 32, gap: 8, inset: 8, bottom: 60, leftWidth: 40, leftBottom: 40 };

it('名称上方放满右列后，从左列顶部继续；竖图保持一列', () => {
  expect(imageCardActionLayout(base).rows).toBe(2);
  expect(imageCardActionLayout({ ...base, height: 200 }).rows).toBe(3);
  expect(imageCardActionLayout({ ...base, height: 400 }).rows).toBe(5);
  expect(imageCardActionLayout({ ...base, bottom: 0 }).rows).toBe(4);
});

it('44px 触控按钮不缩小，极窄卡片避开左上删除后补足高度', () => {
  const result = imageCardActionLayout({ ...base, width: 100, height: 50, buttonWidth: 44, buttonHeight: 44, leftWidth: 52, leftBottom: 52 });
  expect(result).toEqual({ rows: 5, top: 60, minHeight: 380 });
});

it('单列动作按三行布局并为标题与翻图留出完整高度，默认多按钮仍沿用换列', () => {
  const single = imageCardActionLayout({ ...base, count: 3, bottom: 100, singleColumn: true });
  expect(single.rows).toBe(3);
  expect(single.top + single.rows * (base.buttonHeight + base.gap) - base.gap).toBeLessThanOrEqual(single.minHeight - 100 - base.inset);
  expect(imageCardActionLayout({ ...base, count: 12 }).rows).toBe(2);
});

it('不同宽高、按钮数和底栏高度下，所有按钮均在封面内且避开标题与左侧操作', () => {
  for (const width of [80, 100, 160, 240, 480]) for (const height of [24, 80, 160, 360]) {
    for (const size of [32, 44]) for (const count of [1, 3, 4, 5]) for (const bottom of [0, 48, 96]) {
      const input = { ...base, width, height, buttonWidth: size, buttonHeight: size, count, bottom, leftWidth: size + 8, leftBottom: size + 8 };
      const layout = imageCardActionLayout(input);
      const finalHeight = Math.max(height, layout.minHeight);
      for (let index = 0; index < count; index++) {
        const x = width - input.inset - size - Math.floor(index / layout.rows) * (size + input.gap);
        const y = layout.top + (index % layout.rows) * (size + input.gap);
        expect(x).toBeGreaterThanOrEqual(input.inset);
        expect(y + size).toBeLessThanOrEqual(finalHeight - bottom - input.inset);
        expect(x >= input.inset + input.leftWidth || y >= input.leftBottom + input.gap).toBe(true);
      }
    }
  }
});

function mockGeometry({ siblingActions = false, navigation = false, aspectRatio = 0 } = {}) {
  let width = 320, height = 180, caption = 60, size = 32;
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} });
  const frameRect = (frame: HTMLElement) => {
    if (!aspectRatio) return rect(0, 0, width, height);
    const minimum = parseFloat(frame.style.minHeight) || 0;
    // 模拟浏览器的比例约束：auto 宽度会由最小高度反推，明确的百分比宽度由列决定。
    const actualWidth = getComputedStyle(frame).width === '100%' ? width : Math.max(width, minimum * aspectRatio);
    return rect(0, 0, actualWidth, Math.max(actualWidth / aspectRatio, minimum));
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('mobile-gallery-frame')) return frameRect(this);
    if (this.classList.contains('gallery-card-caption')) {
      const frame = frameRect(this.parentElement!.querySelector('.mobile-gallery-frame')!);
      return rect(0, frame.height - caption, width, caption);
    }
    if (this.hasAttribute('data-image-action-left')) return rect(8, 8, size, size);
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('button, [data-image-action-item]') ? size : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('button, [data-image-action-item]') ? size : 0; });
  const callbacks: Array<() => void> = [];
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe = observe; unobserve = unobserve; disconnect = disconnect; });
  const draw = ({ busy = false, count = 5, saved = true, hasCaption = true, hasLeft = true, hasNavigation = navigation, children }: {
    busy?: boolean; count?: number; saved?: boolean; hasCaption?: boolean; hasLeft?: boolean; hasNavigation?: boolean; children?: React.ReactNode;
  } = {}) => {
    const actions = <ImageCardActions>{children ?? <><div className="image-share-actions">{['收藏', '下载', '复制', '实验室'].slice(0, count).map(label => <button key={label} disabled={busy} className={busy ? 'busy' : ''}>{busy ? <i /> : <b />}{label}</button>)}</div>{count > 4 && (saved ? <span data-image-action-item>已保存</span> : <button>保存</button>)}</>}</ImageCardActions>;
    return <div className={`gallery-image-card ${busy ? 'selected' : ''}`}><div className="gallery-card-visual">
      <div className="mobile-gallery-frame">{hasLeft && <button data-image-action-left>删除</button>}{!siblingActions && <div className="absolute inset-0">{actions}</div>}{hasNavigation && <button className="gallery-cover-navigation">翻图</button>}</div>
      <div className={hasCaption ? 'gallery-card-caption' : 'plain-caption'}>名称和模型</div>
    </div>{siblingActions && actions}</div>;
  };
  const view = render(draw());
  const frame = view.container.querySelector<HTMLElement>('.mobile-gallery-frame')!;
  const group = view.container.querySelector<HTMLElement>('.image-card-actions')!;
  return { ...view, draw, frame, group, observe, unobserve, disconnect, callbacks, resize: (next: { width?: number; height?: number; caption?: number; size?: number }) => {
    width = next.width ?? width; height = next.height ?? height; caption = next.caption ?? caption; size = next.size ?? size;
    act(() => { callbacks.forEach(callback => callback()); flushLayout(); });
  } };
}

it('选中、保存状态与图标更新不重建观察器、不测尺寸或写布局，相同尺寸通知也不重复写入', async () => {
  const view = mockGeometry();
  const favorite = screen.getByRole('button', { name: '收藏' });
  favorite.focus();
  const rectRead = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  rectRead.mockClear(); view.observe.mockClear();
  const changes: MutationRecord[] = [];
  const writes = new MutationObserver(records => changes.push(...records));
  writes.observe(view.container, { attributes: true, subtree: true, attributeFilter: ['style', 'data-image-action-frame'] });
  view.rerender(view.draw({ busy: true }));
  await act(async () => {});
  expect(view.callbacks).toHaveLength(1);
  expect(view.disconnect).not.toHaveBeenCalled();
  expect(view.observe).not.toHaveBeenCalled();
  expect(rectRead).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '收藏' })).toBe(favorite);
  expect(document.activeElement).toBe(favorite);
  view.resize({});
  expect([...changes, ...writes.takeRecords()]).toHaveLength(0);
  writes.disconnect();
});

it('同一帧的重复尺寸通知只测一次，多张卡片先全部测量再写入，卸载取消待测项', () => {
  const view = mockGeometry();
  const second = render(view.draw());
  const frames = [view.frame, second.container.querySelector<HTMLElement>('.mobile-gallery-frame')!];
  const read = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  read.mockClear();
  act(() => { for (let i = 0; i < 4; i++) view.callbacks.forEach(callback => callback()); });
  expect(read).not.toHaveBeenCalled();
  act(flushLayout);
  expect(read.mock.contexts.filter(node => frames.some(frame => frame === node))).toHaveLength(2);
  const original = read.getMockImplementation()!;
  const observed: string[][] = [];
  read.mockImplementation(function (this: HTMLElement) {
    if (frames.includes(this)) observed.push(frames.map(frame => frame.style.minHeight));
    return original.call(this);
  });
  view.resize({ caption: 80 });
  expect(observed).toEqual([['108px', '108px'], ['108px', '108px']]);
  expect(frames.map(frame => frame.style.minHeight)).toEqual(['128px', '128px']);
  act(() => view.callbacks.forEach(callback => callback()));
  second.unmount(); view.unmount(); read.mockClear();
  act(flushLayout);
  expect(read).not.toHaveBeenCalled();
});

it('按钮增减与保存按钮替换为状态标记只调整当前观察目标，空操作恢复封面高度', async () => {
  const view = mockGeometry();
  view.resize({ width: 120, height: 80, size: 44 });
  const originalFavorite = screen.getByRole('button', { name: '收藏' });
  view.rerender(view.draw({ count: 3 }));
  await act(async () => {});
  expect(view.frame.style.minHeight).toBe('224px');
  expect(view.group.style.gridTemplateRows).toBe('repeat(3, 44px)');
  expect(view.unobserve).toHaveBeenCalled();
  view.rerender(view.draw({ saved: false }));
  await act(async () => {});
  const save = screen.getByRole('button', { name: '保存' });
  expect(view.observe).toHaveBeenCalledWith(save);
  view.rerender(view.draw());
  await act(async () => {});
  expect(view.unobserve).toHaveBeenCalledWith(save);
  expect(view.observe).toHaveBeenCalledWith(screen.getByText('已保存'));
  expect(screen.getByRole('button', { name: '收藏' })).toBe(originalFavorite);
  view.rerender(view.draw({ count: 0 }));
  await act(async () => {});
  expect(view.frame.style.minHeight).toBe('');
  expect(view.frame.hasAttribute('data-image-action-frame')).toBe(false);
  expect(view.group.style.gridTemplateRows).toBe('');
  expect(view.callbacks).toHaveLength(1);
  expect(view.disconnect).not.toHaveBeenCalled();
});

it('子组件自身增添按钮、标题类型切换和翻图按钮出现仍更新换列与避让', async () => {
  const view = mockGeometry({ siblingActions: true });
  const Sharing = () => {
    const [extra, setExtra] = React.useState(false);
    return <><button onClick={() => setExtra(value => !value)}>切换操作</button>{extra && <button>新增操作</button>}</>;
  };
  view.rerender(view.draw({ children: <Sharing /> }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '切换操作' }));
  await act(async () => {});
  expect(view.observe).toHaveBeenCalledWith(screen.getByRole('button', { name: '新增操作' }));
  view.rerender(view.draw({ hasNavigation: true }));
  await act(async () => {});
  expect(view.group.style.gridTemplateRows).toBe('repeat(1, 32px)');
  expect(view.frame.style.minHeight).toBe('148px');
  view.rerender(view.draw({ hasCaption: false, hasLeft: false }));
  await act(async () => {});
  expect(view.group.style.gridTemplateRows).toBe('repeat(4, 32px)');
  expect(view.frame.style.minHeight).toBe('48px');
  view.rerender(view.draw());
  await act(async () => {});
  expect(view.frame.style.minHeight).toBe('108px');
  expect(view.callbacks).toHaveLength(1);
});

it('磨砂信息栏开关仍重新取避让范围，卸载释放全部观察与布局', () => {
  const view = mockGeometry();
  act(() => {
    document.documentElement.dataset.galleryFrostedCaption = 'false';
    window.dispatchEvent(new Event('nai-gallery-caption-change'));
  });
  expect(view.callbacks).toHaveLength(2);
  expect(view.disconnect).toHaveBeenCalledTimes(1);
  expect(view.frame.style.minHeight).toBe('108px');
  view.unmount();
  expect(view.disconnect).toHaveBeenCalledTimes(2);
  expect(view.frame.style.minHeight).toBe('');
  expect(view.frame.hasAttribute('data-image-action-frame')).toBe(false);
});

it.each([false, true])('实测图片与标题布局，支持操作在图片内部或卡片外层（%s）', siblingActions => {
  const view = mockGeometry({ siblingActions });
  const favorite = screen.getByRole('button', { name: '收藏' });
  favorite.focus();
  expect(view.group.style.gridTemplateRows).toBe('repeat(2, 32px)');
  expect(view.frame.style.minHeight).toBe('108px');
  view.resize({ caption: 80 });
  expect(view.group.style.gridTemplateRows).toBe('repeat(2, 32px)');
  expect(view.frame.style.minHeight).toBe('128px');
  view.resize({ caption: 0, height: 180 });
  expect(view.group.style.gridTemplateRows).toBe('repeat(4, 32px)');
  view.resize({ width: 120, height: 80, size: 44 });
  expect(view.group.style.gridTemplateRows).toBe('repeat(5, 44px)');
  expect(view.frame.style.minHeight).toBe('268px');
  expect(screen.getByRole('button', { name: '收藏' })).toBe(favorite);
  expect(document.activeElement).toBe(favorite);
  view.unmount();
  expect(view.disconnect).toHaveBeenCalled();
  expect(view.frame.style.minHeight).toBe('');
});

it('画师卡片为底部翻图和名称同时留位，状态图标也计入换列', () => {
  const view = mockGeometry({ navigation: true });
  expect(view.group.style.gridTemplateRows).toBe('repeat(1, 32px)');
  expect(view.frame.style.getPropertyValue('--image-card-caption-height')).toBe('60px');
  expect(view.frame.style.minHeight).toBe('148px');
  expect(view.observe).toHaveBeenCalledWith(screen.getByRole('button', { name: '翻图' }));
});

it.each([false, true])('补高后的尺寸反馈稳定收敛，封面不反向撑宽卡片（外层操作：%s）', siblingActions => {
  const sheet = document.createElement('style');
  sheet.textContent = readFileSync(resolve('index.css'), 'utf8').match(/\.mobile-gallery-frame\[data-image-action-frame\]\s*\{[^}]+\}/)?.[0] || '';
  document.head.append(sheet);
  try {
    const view = mockGeometry({ siblingActions, aspectRatio: 2 });
    for (const width of [230, 120, 320]) {
      const samples: number[][] = [];
      for (let tick = 0; tick < 8; tick++) {
        view.resize({ width });
        const bounds = view.frame.getBoundingClientRect();
        samples.push([bounds.width, bounds.height]);
      }
      expect(samples.slice(-3)).toEqual(Array(3).fill(samples.at(-1)));
      expect(samples.at(-1)![0]).toBe(width);
      const rows = Number(view.group.style.gridTemplateRows.match(/repeat\((\d+)/)![1]);
      const bottom = 8 + rows * 40 - 8;
      expect(bottom).toBeLessThanOrEqual(samples.at(-1)![1] - 60 - 8);
    }
  } finally {
    sheet.remove();
  }
});
