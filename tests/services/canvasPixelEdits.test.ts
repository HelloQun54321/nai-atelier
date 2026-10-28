import { describe, expect, it, vi } from 'vitest';
import { layerToProject } from '../../services/canvasEngine';
import { moveCanvasSelection, pixelBrushEdit, pixelSelectionEdit } from '../../services/canvasPixelEdits';
import { exportCanvasProject, importCanvasProject } from '../../services/canvasStore';
import type { CanvasImageLayer, CanvasProject, CanvasSelection } from '../../services/canvasTypes';

const layer: CanvasImageLayer = { id: 'layer', name: '原图', source: 'data:image/png;base64,abc', mask: 'data:image/png;base64,def', width: 20, height: 10, x: 30, y: 40, scaleX: -2, scaleY: 3, rotation: 90, opacity: .5, visible: true, locked: false, crops: [] };
const selection: CanvasSelection = { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }].map(point => layerToProject(layer, point)) };
describe('图层像素编辑记录', () => {
  it('把画布中的移动量和选区转换为图层坐标，并保留原素材和蒙版', () => {
    const start = layerToProject(layer, { x: 0, y: 0 }), end = layerToProject(layer, { x: 22, y: -3 });
    const moved = moveCanvasSelection(layer, selection, { x: end.x - start.x, y: end.y - start.y });
    const edit = moved.pixelEdits![0]; expect(edit.kind).toBe('move');
    if (edit.kind !== 'move') return;
    expect(edit.dx).toBeCloseTo(22); expect(edit.dy).toBeCloseTo(-3);
    expect(edit.points[1].x).toBeCloseTo(5); expect(edit.points[2].y).toBeCloseTo(10);
    expect(moved.source).toBe(layer.source); expect(moved.mask).toBe(layer.mask);
    expect(layer.pixelEdits).toBeUndefined();
  });
  it('可依次记录移动、笔刷和剪裁，并在导出、导入后保留顺序', async () => {
    const moved = moveCanvasSelection(layer, selection, { x: 10, y: 0 });
    const brushed = { ...moved, pixelEdits: [...moved.pixelEdits!, pixelBrushEdit(moved, { points: [{ x: 2, y: 3 }], size: 8, mode: 'restore' }, selection)] };
    const cropped = pixelSelectionEdit(brushed, selection, 'crop');
    const project: CanvasProject = { version: 1, id: 'p', name: 'p', width: 100, height: 100, background: { kind: 'transparent', color: '' }, layers: [cropped], updatedAt: 1 };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ projects: [] })));
    try {
      const roundtrip = await importCanvasProject(await exportCanvasProject(project));
      expect(JSON.stringify(roundtrip.layers)).toBe(JSON.stringify(project.layers));
      expect(roundtrip.layers[0].pixelEdits?.map(edit => edit.kind)).toEqual(['move', 'brush', 'crop']);
    } finally { vi.unstubAllGlobals(); }
  });
});
