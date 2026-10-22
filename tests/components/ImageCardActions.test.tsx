// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageCardActions, imageCardActionLayout } from '../../components/ImageCardActions';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe = observe; disconnect = disconnect; });
  const actions = <ImageCardActions><div className="image-share-actions"><button>收藏</button><button>下载</button><button>复制</button></div><button>实验室</button><span data-image-action-item>已保存</span></ImageCardActions>;
  const view = render(<div className="gallery-image-card"><div className="gallery-card-visual">
    <div className="mobile-gallery-frame"><button data-image-action-left>删除</button>{!siblingActions && <div className="absolute inset-0">{actions}</div>}{navigation && <button className="gallery-cover-navigation">翻图</button>}</div>
    <div className="gallery-card-caption">名称和模型</div>
  </div>{siblingActions && actions}</div>);
  const frame = view.container.querySelector<HTMLElement>('.mobile-gallery-frame')!;
  const group = view.container.querySelector<HTMLElement>('.image-card-actions')!;
  return { ...view, frame, group, observe, disconnect, resize: (next: { width?: number; height?: number; caption?: number; size?: number }) => {
    width = next.width ?? width; height = next.height ?? height; caption = next.caption ?? caption; size = next.size ?? size;
    act(() => callbacks.forEach(callback => callback()));
  } };
}

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
