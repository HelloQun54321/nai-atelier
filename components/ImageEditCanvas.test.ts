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
});
