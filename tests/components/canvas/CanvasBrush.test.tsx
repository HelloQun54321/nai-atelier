// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasWorkspace } from '../../../components/canvas/CanvasWorkspace';
import { applyBrush, renderProject } from '../../../services/canvasEngine';
import { listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../../services/canvasStore';
import type { CanvasImageLayer, CanvasProject } from '../../../services/canvasTypes';

vi.mock('../../../services/canvasStore', () => ({ listCanvasProjects: vi.fn(), loadCanvasProject: vi.fn(), saveCanvasProject: vi.fn(), deleteCanvasProject: vi.fn(), exportCanvasProject: vi.fn(), importCanvasProject: vi.fn() }));
vi.mock('../../../services/canvasEngine', () => ({ renderProject: vi.fn(async () => document.createElement('canvas')), applyBrush: vi.fn(), copyCanvasSelection: vi.fn(), createImageLayer: vi.fn(), cropCanvasProject: vi.fn(), cropImageLayer: vi.fn(), hitCanvasLayer: vi.fn(), layerToProject: vi.fn((_layer, point) => point), projectToLayer: vi.fn() }));
vi.mock('../../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));

const layer: CanvasImageLayer = { id: 'layer', name: '图片', source: 'data:image/png;base64,AA==', width: 100, height: 100, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
const project: CanvasProject = { version: 1, id: 'project', name: '测试', width: 100, height: 100, background: { kind: 'transparent', color: '' }, layers: [layer], updatedAt: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCanvasProjects).mockResolvedValue([{ id: project.id, name: project.name, updatedAt: 1 }]);
  vi.mocked(loadCanvasProject).mockResolvedValue(project);
  vi.mocked(saveCanvasProject).mockResolvedValue();
  vi.mocked(applyBrush).mockImplementation(async (original, stroke) => ({ ...original, mask: stroke.mode }));
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), arc: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('笔刷交互', () => {
  it.each([['橡皮擦', 'erase'], ['恢复笔刷', 'restore']] as const)('%s 拖动时预览，松开才提交，并可一次撤销', async (label, mode) => {
    render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={async () => false} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择图层 图片' }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    const canvas = screen.getByLabelText('拼图画布') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 15 });
    const cursor = canvas.parentElement!.querySelector('[data-brush-cursor]') as HTMLElement;
    expect(cursor.style.left).toBe('10%');
    expect(cursor.style.top).toBe('15%');
    expect(cursor.style.width).toBe('32%');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 15 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 25 });
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.some(([, preview]) => preview?.stroke.mode === mode && preview.stroke.points.length === 2)).toBe(true));
    expect(applyBrush).not.toHaveBeenCalled();
    await act(async () => { fireEvent.pointerUp(canvas, { button: 0, clientX: 20, clientY: 25 }); });
    expect(applyBrush).toHaveBeenCalledWith(layer, { points: [{ x: 10, y: 15 }, { x: 20, y: 25 }], size: 32, mode }, null);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[0].layers[0].mask).toBeUndefined());
    fireEvent.pointerLeave(canvas);
    expect(canvas.parentElement!.querySelector('[data-brush-cursor]')).toBeNull();
  });

  it('渲染较慢时先显示已完成的预览，再只绘制最新待处理的笔迹', async () => {
    render(<CanvasWorkspace active notify={vi.fn()} onSendToLab={vi.fn()} confirmClose={async () => false} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择图层 图片' }));
    fireEvent.click(screen.getByRole('button', { name: '橡皮擦' }));
    const canvas = screen.getByLabelText('拼图画布') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => {});
    let finish!: (canvas: HTMLCanvasElement) => void;
    const pending = new Promise<HTMLCanvasElement>(resolve => { finish = resolve; });
    vi.mocked(renderProject).mockReturnValueOnce(pending);
    const context = canvas.getContext('2d')!;
    vi.mocked(context.drawImage).mockClear();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 15 });
    const count = vi.mocked(renderProject).mock.calls.length;
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 25 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 35 });
    expect(vi.mocked(renderProject)).toHaveBeenCalledTimes(count);
    await act(async () => finish(document.createElement('canvas')));
    expect(context.drawImage).toHaveBeenCalled();
    await waitFor(() => expect(vi.mocked(renderProject).mock.calls.at(-1)?.[1]?.stroke.points).toEqual([{ x: 10, y: 15 }, { x: 20, y: 25 }, { x: 30, y: 35 }]));
  });
});
