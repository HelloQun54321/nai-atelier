// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace } from '../../../components/canvas/CanvasWorkspace';
import { listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../../services/canvasStore';
import { hitCanvasLayer, renderProject } from '../../../services/canvasEngine';
import { moveCanvasSelection } from '../../../services/canvasPixelEdits';
import type { CanvasImageLayer, CanvasPoint, CanvasProject, CanvasSelection } from '../../../services/canvasTypes';

vi.mock('../../../services/canvasStore', () => ({ listCanvasProjects: vi.fn(), loadCanvasProject: vi.fn(), saveCanvasProject: vi.fn(), deleteCanvasProject: vi.fn(), exportCanvasProject: vi.fn(), importCanvasProject: vi.fn() }));
vi.mock('../../../services/canvasEngine', () => ({ renderProject: vi.fn(async () => document.createElement('canvas')), applyBrush: vi.fn(), copyCanvasSelection: vi.fn(), createImageLayer: vi.fn(), cropCanvasProject: vi.fn(), cropImageLayer: vi.fn(), hitCanvasLayer: vi.fn(), layerToProject: vi.fn((_layer, point) => point), projectToLayer: vi.fn((_layer, point) => point) }));
vi.mock('../../../services/canvasPixelEdits', () => ({ moveCanvasSelection: vi.fn((layer: CanvasImageLayer, selection: CanvasSelection, delta: CanvasPoint) => ({ ...layer, pixelEdits: [{ kind: 'move', points: selection.points, dx: delta.x, dy: delta.y }] })), pixelSelectionEdit: vi.fn() }));
vi.mock('../../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));

const layer: CanvasImageLayer = { id: 'layer', name: '角色', source: 'data:image/png;base64,AA==', width: 500, height: 400, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
const project: CanvasProject = { version: 1, id: 'axis-move', name: '轴线测试', width: 800, height: 600, background: { kind: 'color', color: '#fff' }, layers: [layer], updatedAt: 1 };
const selection = { points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }] };
class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCanvasProjects).mockResolvedValue([{ id: project.id, name: project.name, updatedAt: project.updatedAt }]);
  vi.mocked(loadCanvasProject).mockResolvedValue(project);
  vi.mocked(saveCanvasProject).mockResolvedValue();
  vi.mocked(hitCanvasLayer).mockResolvedValue(true);
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const context = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), arc: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const pointer = (canvas: HTMLCanvasElement, kind: 'down' | 'move' | 'up', x: number, y: number, shiftKey = false) => {
  const event = { pointerId: 1, button: 0, clientX: x, clientY: y, shiftKey };
  if (kind === 'down') fireEvent.pointerDown(canvas, event);
  else if (kind === 'move') fireEvent.pointerMove(canvas, event);
  else fireEvent.pointerUp(canvas, event);
};
const shift = (down: boolean) => down ? fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft', shiftKey: true }) : fireEvent.keyUp(window, { key: 'Shift', code: 'ShiftLeft', shiftKey: false });
const outline = (container: HTMLElement) => container.querySelector('path[style*="canvas-selection-march"]')?.getAttribute('d');
const axes = (container: HTMLElement) => [...container.querySelectorAll('[data-axis-guide]')].map(el => el.getAttribute('data-axis-guide') === 'x' ? 'horizontal' : 'vertical').sort();
const lastRenderedLayer = () => vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0];

async function setup(withSelection = true) {
  const view = render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={async () => false} />);
  const canvas = await screen.findByLabelText('拼图画布') as HTMLCanvasElement;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: '选择图层 角色' }));
  if (withSelection) {
    fireEvent.click(screen.getByRole('button', { name: '矩形选区' }));
    pointer(canvas, 'down', 10, 10); pointer(canvas, 'move', 80, 80); pointer(canvas, 'up', 80, 80);
  }
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  return { ...view, canvas };
}

describe('移动时 Shift 轴线约束', () => {
  it('选区水平锁定后保留所选轴，松开鼠标以受限位置提交，撤销与重做同步选框', async () => {
    const { canvas, container } = await setup();
    shift(true); pointer(canvas, 'down', 30, 30, true);
    expect(axes(container)).toEqual(['horizontal', 'vertical']);
    pointer(canvas, 'move', 60, 33, true);
    expect(axes(container)).toEqual(['horizontal']);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 30, y: 0 });
    pointer(canvas, 'move', 62, 100, true);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 32, y: 0 });
    pointer(canvas, 'up', 65, 110, true);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 35, y: 0 });
    expect(axes(container)).toEqual([]);
    expect(outline(container)).toBe('M 45 10 L 115 10 L 115 80 L 45 80 Z');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(outline(container)).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(outline(container)).toBe('M 45 10 L 115 10 L 115 80 L 45 80 Z');
    shift(false);
  });

  it('拖动途中按住和松开 Shift，指针静止时引导线立即出现或消失，并从当前位置继续自由移动', async () => {
    const { canvas, container } = await setup();
    pointer(canvas, 'down', 30, 30); pointer(canvas, 'move', 40, 40);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 10, y: 10 });
    shift(true);
    expect(axes(container)).toEqual(['horizontal', 'vertical']);
    pointer(canvas, 'move', 60, 43, true);
    expect(axes(container)).toEqual(['horizontal']);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 30, y: 10 });
    shift(false);
    expect(axes(container)).toEqual([]);
    expect(outline(container)).toBe('M 40 20 L 110 20 L 110 90 L 40 90 Z');
    pointer(canvas, 'move', 65, 48);
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, selection, { x: 35, y: 15 });
    pointer(canvas, 'up', 65, 48);
  });

  it('整层拖动可沿纵轴锁定，松开 Shift 后连续恢复自由移动', async () => {
    const { canvas, container } = await setup(false);
    pointer(canvas, 'down', 100, 100);
    await waitFor(() => expect(hitCanvasLayer).toHaveBeenCalled());
    await act(async () => {});
    pointer(canvas, 'move', 110, 110);
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 10, y: 10 }));
    shift(true);
    expect(axes(container)).toEqual(['horizontal', 'vertical']);
    pointer(canvas, 'move', 113, 140, true);
    expect(axes(container)).toEqual(['vertical']);
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 10, y: 40 }));
    shift(false);
    expect(axes(container)).toEqual([]);
    pointer(canvas, 'move', 118, 145);
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 15, y: 45 }));
    pointer(canvas, 'up', 118, 145);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 0, y: 0 }));
  });

  it('异步图层命中完成之前松开鼠标，仍按最后一次受限位移提交', async () => {
    const pending = deferred<boolean>();
    vi.mocked(hitCanvasLayer).mockReturnValue(pending.promise);
    const { canvas, container } = await setup(false);
    shift(true); pointer(canvas, 'down', 100, 100, true);
    pointer(canvas, 'move', 130, 103, true); pointer(canvas, 'up', 140, 108, true);
    expect(axes(container)).toEqual([]);
    await act(async () => pending.resolve(true));
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 40, y: 0 }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(lastRenderedLayer()).toMatchObject({ x: 0, y: 0 }));
    shift(false);
  });
});
