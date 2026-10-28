// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace } from '../../../components/canvas/CanvasWorkspace';
import { listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../../services/canvasStore';
import { renderProject, hitCanvasLayer } from '../../../services/canvasEngine';
import { moveCanvasSelection } from '../../../services/canvasPixelEdits';
import type { CanvasImageLayer, CanvasPoint, CanvasProject, CanvasSelection } from '../../../services/canvasTypes';

vi.mock('../../../services/canvasStore', () => ({ listCanvasProjects: vi.fn(), loadCanvasProject: vi.fn(), saveCanvasProject: vi.fn(), deleteCanvasProject: vi.fn(), exportCanvasProject: vi.fn(), importCanvasProject: vi.fn() }));
vi.mock('../../../services/canvasEngine', () => ({ renderProject: vi.fn(async () => document.createElement('canvas')), applyBrush: vi.fn(), copyCanvasSelection: vi.fn(), createImageLayer: vi.fn(), cropCanvasProject: vi.fn(), cropImageLayer: vi.fn(), hitCanvasLayer: vi.fn(), layerToProject: vi.fn((_layer, point) => point), projectToLayer: vi.fn((_layer, point) => point) }));
vi.mock('../../../services/canvasPixelEdits', () => ({ moveCanvasSelection: vi.fn((layer: CanvasImageLayer, selection: CanvasSelection, delta: CanvasPoint) => ({ ...layer, pixelEdits: [{ kind: 'move', points: selection.points, dx: delta.x, dy: delta.y }] })), pixelSelectionEdit: vi.fn() }));
vi.mock('../../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));

const layer: CanvasImageLayer = { id: 'layer', name: '角色', source: 'data:image/png;base64,AA==', width: 500, height: 400, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
const project: CanvasProject = { version: 1, id: 'selection-move', name: '选区移动测试', width: 800, height: 600, background: { kind: 'color', color: '#fff' }, layers: [layer], updatedAt: 1 };
class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCanvasProjects).mockResolvedValue([{ id: project.id, name: project.name, updatedAt: project.updatedAt }]);
  vi.mocked(loadCanvasProject).mockResolvedValue(project);
  vi.mocked(saveCanvasProject).mockResolvedValue();
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

const pointer = (canvas: HTMLCanvasElement, kind: 'down' | 'move' | 'up', x: number, y: number) => {
  const event = { pointerId: 1, button: 0, clientX: x, clientY: y };
  if (kind === 'down') fireEvent.pointerDown(canvas, event);
  else if (kind === 'move') fireEvent.pointerMove(canvas, event);
  else fireEvent.pointerUp(canvas, event);
};
const outline = (container: HTMLElement) => container.querySelector('path[style*="canvas-selection-march"]')?.getAttribute('d');
async function setup() {
  const view = render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={async () => false} />);
  const canvas = await screen.findByLabelText('拼图画布') as HTMLCanvasElement;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: '选择图层 角色' }));
  fireEvent.click(screen.getByRole('button', { name: '矩形选区' }));
  pointer(canvas, 'down', 10, 10); pointer(canvas, 'move', 80, 80); pointer(canvas, 'up', 80, 80);
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  return { ...view, canvas };
}

describe('选区像素移动交互', () => {
  it('拖动实时预览，松开后只产生一次历史记录，撤销与重做同步选区', async () => {
    const { canvas, container } = await setup();
    pointer(canvas, 'down', 30, 30); pointer(canvas, 'move', 50, 45);
    expect(outline(container)).toBe('M 30 25 L 100 25 L 100 95 L 30 95 Z');
    expect(moveCanvasSelection).toHaveBeenLastCalledWith(layer, { points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 80 }, { x: 10, y: 80 }] }, { x: 20, y: 15 });
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.some(([snapshot]) => snapshot.layers[0].pixelEdits?.[0]?.kind === 'move')).toBe(true));
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    pointer(canvas, 'up', 50, 45);
    expect(moveCanvasSelection).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0].pixelEdits?.[0]?.kind).toBe('move'));
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(outline(container)).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0].pixelEdits).toBeUndefined());
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(outline(container)).toBe('M 30 25 L 100 25 L 100 95 L 30 95 Z');
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0].pixelEdits?.[0]?.kind).toBe('move'));
  });
  it('选区外拖动不触发选中像素或图层移动', async () => {
    const { canvas, container } = await setup();
    pointer(canvas, 'down', 100, 100); pointer(canvas, 'move', 150, 150); pointer(canvas, 'up', 150, 150);
    expect(outline(container)).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    expect(moveCanvasSelection).not.toHaveBeenCalled();
    expect(hitCanvasLayer).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('拖动期间按 Esc 恢复原选区和画面，松开不提交', async () => {
    const { canvas, container } = await setup();
    pointer(canvas, 'down', 30, 30); pointer(canvas, 'move', 50, 45);
    expect(outline(container)).toBe('M 30 25 L 100 25 L 100 95 L 30 95 Z');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outline(container)).toBe('M 10 10 L 80 10 L 80 80 L 10 80 Z');
    pointer(canvas, 'up', 50, 45);
    expect(moveCanvasSelection).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0].pixelEdits).toBeUndefined());
  });
});
