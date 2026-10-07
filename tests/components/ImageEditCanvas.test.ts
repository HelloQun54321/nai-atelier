// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageEditCanvas } from '../../components/ImageEditCanvas';

afterEach(cleanup);

describe('ImageEditCanvas', () => {
  it('聚焦选区的移动与缩放操作统一中文名称', () => {
    const onFocusedInteractionStart = vi.fn();
    render(React.createElement(ImageEditCanvas, {
      imageCanvasRef: React.createRef<HTMLCanvasElement>(), maskCanvasRef: React.createRef<HTMLCanvasElement>(), overlayCanvasRef: React.createRef<HTMLCanvasElement>(),
      width: 832, height: 1216, focusedRect: { x: 64, y: 64, width: 256, height: 256 }, focused: true, isLoading: false,
      onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onFocusedInteractionStart,
    }));
    fireEvent.pointerDown(screen.getByRole('button', { name: '移动聚焦重绘选区' }));
    expect(onFocusedInteractionStart).toHaveBeenLastCalledWith(expect.anything(), 'move');
    fireEvent.pointerDown(screen.getByRole('button', { name: '调整聚焦重绘选区大小' }));
    expect(onFocusedInteractionStart).toHaveBeenLastCalledWith(expect.anything(), 'resize');
  });

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
    expect(container.querySelector('[aria-label="移动聚焦重绘选区"]')).toBeNull();
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
    expect(screen.getByRole('dialog', { name: '全屏大画板精修' }).textContent).toContain('完成 (Esc)');
    expect(container.textContent).not.toContain('全屏大画板精修');

    const exitBtn = screen.getByTitle('退出全屏精修');
    fireEvent.click(exitBtn);
    expect(container.textContent).not.toContain('全屏大画板精修');
  });

  it('全屏往返保留三个画布节点、引用和缩放事件，卸载移除根层内容', () => {
    const refs = [React.createRef<HTMLCanvasElement>(), React.createRef<HTMLCanvasElement>(), React.createRef<HTMLCanvasElement>()];
    const view = render(React.createElement('div', { className: 'agent-stage safe-mode dark' },
      React.createElement('aside', { className: 'relative z-40' }, '侧边栏'),
      React.createElement('main', { className: 'isolate overflow-hidden' }, React.createElement(ImageEditCanvas, {
        imageCanvasRef: refs[0], maskCanvasRef: refs[1], overlayCanvasRef: refs[2], width: 832, height: 1216,
        focusedRect: null, focused: false, isLoading: false, onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(),
      })),
    ));
    const canvases = refs.map(ref => ref.current);
    const stage = view.container.firstElementChild;
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByTitle('展开全屏大画板'));
      const dialog = screen.getByRole('dialog', { name: '全屏大画板精修' });
      expect(dialog.closest('main')).toBeNull();
      expect(dialog.parentElement?.parentElement).toBe(stage);
      expect(dialog.closest('.safe-mode.dark')).toBe(stage);
      expect(dialog.classList.contains('z-[1250]')).toBe(true);
      expect(refs.map(ref => ref.current)).toEqual(canvases);
      fireEvent.wheel(dialog.querySelector('.overflow-auto')!, { ctrlKey: true, deltaY: -1 });
      expect(dialog.textContent).toContain(i === 0 ? '125%' : '150%');
      const confirm = document.createElement('div');
      confirm.setAttribute('role', 'alertdialog');
      confirm.setAttribute('aria-modal', 'true');
      confirm.className = 'fixed z-[1800]';
      document.body.appendChild(confirm);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByRole('dialog', { name: '全屏大画板精修' })).toBeTruthy();
      confirm.remove();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(refs.map(ref => ref.current)).toEqual(canvases);
      expect(canvases[0]?.closest('main')).toBeTruthy();
    }
    fireEvent.click(screen.getByTitle('展开全屏大画板'));
    view.unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refs.every(ref => ref.current === null)).toBe(true);
  });
});
