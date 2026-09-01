// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageEditCanvas } from './ImageEditCanvas';

describe('ImageEditCanvas', () => {
  it('为安全模式标记编辑底图并保留编辑画布交互容器', () => {
    const { container } = render(React.createElement(ImageEditCanvas, {
      imageCanvasRef: React.createRef<HTMLCanvasElement>(),
      maskCanvasRef: React.createRef<HTMLCanvasElement>(),
      overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
      width: 832,
      height: 1216,
      focusedRect: null,
      focused: false,
      isLoading: false,
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    }));

    const target = container.querySelector('[data-safe-mode-canvas="true"]');
    expect(target?.getAttribute('data-safe-mode-work')).toBe('true');
    expect(target?.querySelector('canvas[data-safe-mode-image="true"]')).toBeTruthy();
  });

  it('不可编辑蒙版时让透明画布退出焦点并停止接收指针', () => {
    const { container } = render(React.createElement(ImageEditCanvas, {
      imageCanvasRef: React.createRef<HTMLCanvasElement>(),
      maskCanvasRef: React.createRef<HTMLCanvasElement>(),
      overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
      width: 832,
      height: 1216,
      focusedRect: { x: 100, y: 100, width: 300, height: 400 },
      focused: true,
      isLoading: false,
      maskEditable: false,
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    }));

    const mask = container.querySelector('canvas[aria-label="图片编辑画布"]');
    expect(mask?.getAttribute('tabindex')).toBe('-1');
    expect(mask?.getAttribute('aria-disabled')).toBe('true');
    expect(mask?.className).toContain('pointer-events-none');
    expect(mask?.className).toContain('cursor-default');
    expect(container.querySelector('[aria-label="移动 Focused 选区"]')).toBeNull();
  });

  it('支持放大、缩小、重置与展开全屏大画板精修模式', () => {
    const { container } = render(React.createElement(ImageEditCanvas, {
      imageCanvasRef: React.createRef<HTMLCanvasElement>(),
      maskCanvasRef: React.createRef<HTMLCanvasElement>(),
      overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
      width: 832,
      height: 1216,
      focusedRect: null,
      focused: false,
      isLoading: false,
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    }));

    expect(container.textContent).toContain('适应');
    const zoomInBtn = container.querySelector('button[title="放大"]') as HTMLButtonElement;
    const zoomResetBtn = container.querySelector('button[title="重置缩放 (适应视口)"]') as HTMLButtonElement;
    const fullscreenBtn = container.querySelector('button[title="展开全屏大画板"]') as HTMLButtonElement;

    expect(zoomInBtn).toBeTruthy();
    expect(zoomResetBtn).toBeTruthy();
    expect(fullscreenBtn).toBeTruthy();

    fireEvent.click(zoomInBtn);
    expect(container.textContent).toContain('150%');

    fireEvent.click(zoomResetBtn);
    expect(container.textContent).toContain('适应');

    fireEvent.click(fullscreenBtn);
    expect(container.textContent).toContain('全屏大画板精修');
    expect(container.textContent).toContain('完成 (Esc)');

    const exitBtn = container.querySelector('button[title="退出全屏精修"]') as HTMLButtonElement;
    fireEvent.click(exitBtn);
    expect(container.textContent).not.toContain('全屏大画板精修');
  });
});
