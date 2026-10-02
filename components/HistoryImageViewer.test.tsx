// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryImageViewer, clampImagePan } from './HistoryImageViewer';
import type { LocalGenItem } from '../types';

const item = { id: 'synthetic', imageUrl: '/synthetic.png', createdAt: 1000, prompt: 'synthetic', params: { model: 'nai-diffusion-4-5-full', width: 1000, height: 1000 } } as LocalGenItem;
class TestPointer extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, props: MouseEventInit & { pointerId?: number } = {}) { super(type, props); this.pointerId = props.pointerId || 1; }
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointer);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const setup = (detailsOpen = true) => {
  const onNavigate = vi.fn(), onClose = vi.fn(), onDetailsChange = vi.fn();
  const result = render(<div className="agent-stage safe-mode dark"><main className="isolate"><HistoryImageViewer item={item} index={1} total={4} navigating={false} favoritePending={false} detailsOpen={detailsOpen} onDetailsChange={onDetailsChange} onNavigate={onNavigate} onClose={onClose} onFavorite={vi.fn()} onDelete={vi.fn()} filename="synthetic.png" notify={vi.fn()}><input aria-label="合成标题" /><button>详情按钮</button></HistoryImageViewer></main></div>);
  const dialog = screen.getByRole('dialog', { name: '历史图片查看器' });
  const image = within(dialog).getByRole('img');
  return { ...result, dialog, image, stage: image.parentElement!, onNavigate, onClose, onDetailsChange };
};

describe('历史图片缩放与手势', () => {
  it('100% 使用实际像素尺寸，适应窗口复位，翻图快捷键不会抢输入/前景确认框', () => {
    const { image, dialog, onNavigate, onClose, container } = setup();
    expect(image.getAttribute('data-safe-mode-ignore')).toBe('true');
    expect(dialog.closest('main')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByLabelText('图片缩放比例').textContent).toBe('100%');
    expect(image.style.transform).toContain('scale(1.6666666666666667)');
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(image.style.transform).toContain('scale(1)');
    expect(screen.getByLabelText('图片缩放比例').textContent).toBe('60%');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(onNavigate).toHaveBeenCalledWith(1);
    const foreground = document.createElement('div'); foreground.setAttribute('role', 'alertdialog'); foreground.setAttribute('aria-modal', 'true'); foreground.className = 'fixed z-[2000]'; container.firstElementChild!.append(foreground);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).not.toHaveBeenCalled();
    foreground.remove(); fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  });
  it('适应窗口下左右滑动翻图，放大后的拖动只移动图片且受边界约束', () => {
    const { stage, image, onNavigate } = setup(false);
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 205, button: 0 });
    expect(onNavigate).toHaveBeenCalledWith(1); onNavigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 500, clientY: 600, button: 0 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 500, clientY: 600, button: 0 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(image.style.transform).toContain('translate(100px, 200px)');
  });
  it('双指放大/缩小不会在抬起手指时触发翻图，详情可以独立展开', () => {
    const { stage, onNavigate, onDetailsChange } = setup(false);
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 100 });
    expect(screen.getByLabelText('图片缩放比例').textContent).toBe('120%');
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 200, clientY: 100 });
    expect(screen.getByLabelText('图片缩放比例').textContent).toBe('60%');
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 20, clientY: 100 });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '图片详情' }));
    expect(onDetailsChange).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText('图片详情面板')).toBeNull();
  });
  it('缩放边界轴独立：小于视口的轴保持居中', () => {
    expect(clampImagePan({ x: 500, y: -500 }, 300, 600, { width: 800, height: 600 }, 2)).toEqual({ x: 0, y: -300 });
    expect(clampImagePan({ x: 500, y: 500 }, 300, 600, { width: 800, height: 600 }, 1)).toEqual({ x: 0, y: 0 });
  });
});
