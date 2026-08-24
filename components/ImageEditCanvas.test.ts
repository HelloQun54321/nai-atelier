// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
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
      focusedRect: null,
      focused: false,
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
  });
});
