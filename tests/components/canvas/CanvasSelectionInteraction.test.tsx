// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace } from '../../../components/canvas/CanvasWorkspace';
import { listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../../services/canvasStore';
import type { CanvasProject } from '../../../services/canvasTypes';

vi.mock('../../../services/canvasStore', () => ({ listCanvasProjects: vi.fn(), loadCanvasProject: vi.fn(), saveCanvasProject: vi.fn(), deleteCanvasProject: vi.fn(), exportCanvasProject: vi.fn(), importCanvasProject: vi.fn() }));
vi.mock('../../../services/canvasEngine', () => ({ renderProject: vi.fn(async () => document.createElement('canvas')), applyBrush: vi.fn(), copyCanvasSelection: vi.fn(), createImageLayer: vi.fn(), cropCanvasProject: vi.fn(), cropImageLayer: vi.fn(), hitCanvasLayer: vi.fn(), layerToProject: vi.fn(), projectToLayer: vi.fn() }));
vi.mock('../../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));

const project: CanvasProject = { version: 1, id: 'selection-test', name: '选区测试', width: 800, height: 600, background: { kind: 'color', color: '#ffffff' }, layers: [], updatedAt: 1 };
class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCanvasProjects).mockResolvedValue([{ id: project.id, name: project.name, updatedAt: project.updatedAt }]);
  vi.mocked(loadCanvasProject).mockResolvedValue(project);
  vi.mocked(saveCanvasProject).mockResolvedValue();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  const view = render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={async () => false} />);
  const canvas = await screen.findByLabelText('拼图画布') as HTMLCanvasElement;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  return { ...view, canvas };
}
const pointer = (canvas: HTMLCanvasElement, kind: 'down' | 'move' | 'up', x: number, y: number, detail = 1) => {
  const event = { pointerId: 1, button: 0, clientX: x, clientY: y, detail };
  if (kind === 'down') fireEvent.pointerDown(canvas, event);
  else if (kind === 'move') fireEvent.pointerMove(canvas, event);
  else fireEvent.pointerUp(canvas, event);
};
const clickPoint = (canvas: HTMLCanvasElement, x: number, y: number, detail = 1) => { pointer(canvas, 'down', x, y, detail); pointer(canvas, 'up', x, y, detail); };
const locked = (container: HTMLElement) => container.querySelector('path[style*="canvas-selection-march"]');
const createRectangle = (canvas: HTMLCanvasElement) => {
  fireEvent.click(screen.getByRole('button', { name: '矩形选区' }));
  pointer(canvas, 'down', 10, 10); pointer(canvas, 'move', 80, 80); pointer(canvas, 'up', 80, 80);
};

describe('画布选区实际交互', () => {
  it('草绘新选区时 Esc 保留旧选区，再按 Esc 清除', async () => {
    const { canvas, container } = await mount();
    createRectangle(canvas);
    expect(locked(container)?.getAttribute('d')).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    fireEvent.click(screen.getByRole('button', { name: '多边形选区' }));
    clickPoint(canvas, 100, 100); pointer(canvas, 'move', 150, 130);
    expect([...canvas.parentElement!.querySelectorAll('svg path')].some(path => path.getAttribute('d')?.includes('L 150 130'))).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(locked(container)?.getAttribute('d')).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    expect([...canvas.parentElement!.querySelectorAll('svg path')].some(path => path.getAttribute('d')?.includes('L 150 130'))).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(locked(container)).toBeNull();
  });
  it('取消选区按钮可取消未完成的多边形，草绘不能启用裁剪', async () => {
    const { canvas } = await mount();
    fireEvent.click(screen.getByRole('button', { name: '多边形选区' }));
    clickPoint(canvas, 100, 100); pointer(canvas, 'move', 150, 150);
    expect((screen.getByRole('button', { name: '取消选区' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '剪裁画布' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消选区' }));
    expect(canvas.parentElement!.querySelectorAll('svg path')).toHaveLength(0);
  });
  it('零面积矩形不形成选区；自由套索释放时闭合', async () => {
    const { canvas, container } = await mount();
    fireEvent.click(screen.getByRole('button', { name: '矩形选区' }));
    clickPoint(canvas, 30, 30);
    expect(locked(container)).toBeNull();
    expect((screen.getByRole('button', { name: '剪裁画布' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '自由套索' }));
    pointer(canvas, 'down', 10, 10); pointer(canvas, 'move', 100, 10); pointer(canvas, 'move', 100, 100); pointer(canvas, 'up', 10, 100);
    expect(locked(container)?.getAttribute('d')).toBe('M 10 10 L 100 10 L 100 100 L 10 100 Z');
  });
  it('多边形鼠标跟随，并可点首点或双击闭合且不重复末点', async () => {
    const { canvas, container } = await mount();
    fireEvent.click(screen.getByRole('button', { name: '多边形选区' }));
    clickPoint(canvas, 10, 10); clickPoint(canvas, 100, 10); clickPoint(canvas, 100, 100);
    pointer(canvas, 'move', 30, 100);
    expect([...canvas.parentElement!.querySelectorAll('svg path')].some(path => path.getAttribute('d')?.includes('L 30 100'))).toBe(true);
    clickPoint(canvas, 10, 10);
    expect(locked(container)?.getAttribute('d')).toBe('M 10 10 L 100 10 L 100 100 Z');
    clickPoint(canvas, 200, 200); clickPoint(canvas, 300, 200); clickPoint(canvas, 300, 300);
    clickPoint(canvas, 200, 300, 1); clickPoint(canvas, 200, 300, 2); fireEvent.doubleClick(canvas, { clientX: 200, clientY: 300 });
    expect(locked(container)?.getAttribute('d')).toBe('M 200 200 L 300 200 L 300 300 L 200 300 Z');
  });
});
