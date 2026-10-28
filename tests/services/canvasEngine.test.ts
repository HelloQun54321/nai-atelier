import { describe, expect, it, vi } from 'vitest';
import { createImageLayer, cropCanvasProject, cropImageLayer, hitCanvasLayer, layerToProject, projectToLayer } from '../../services/canvasEngine';
import type { CanvasImageLayer, CanvasPoint, CanvasProject } from '../../services/canvasTypes';

const layer: CanvasImageLayer = {
  id: 'one', name: '人物', source: 'data:image/png;base64,original', width: 100, height: 60,
  x: 127, y: 84, scaleX: -2, scaleY: 0.5, rotation: 37, opacity: 1,
  visible: true, locked: false, crops: [], mask: 'data:image/png;base64,mask',
};
const project: CanvasProject = {
  version: 1, id: 'project', name: '测试', width: 300, height: 200,
  background: { kind: 'color', color: '#fff' }, layers: [layer], updatedAt: 0,
};
function closePoint(actual: CanvasPoint, expected: CanvasPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('画布图形坐标', () => {
  it('旋转、非等比缩放和镜像坐标可双向还原', () => {
    for (const local of [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: -42, y: 13 }]) {
      closePoint(projectToLayer(layer, layerToProject(layer, local)), local);
    }
    const reflected = { ...layer, x: 20, y: 10, rotation: 90, scaleX: -2, scaleY: 3 };
    closePoint(layerToProject(reflected, { x: 4, y: 5 }), { x: 5, y: 2 });
  });

  it('矩形和不规则选区转换至局部坐标，累积剪裁并保留原始素材', () => {
    const shapes = [
      [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }],
      [{ x: 10, y: 10 }, { x: 29, y: 5 }, { x: 47, y: 32 }, { x: 22, y: 21 }, { x: 4, y: 34 }],
    ];
    let cropped = layer;
    for (const points of shapes) {
      const selection = { points: points.map(point => layerToProject(layer, point)) };
      cropped = cropImageLayer(cropped, selection);
    }
    expect(cropped.crops).toHaveLength(2);
    cropped.crops.forEach((crop, i) => crop.points.forEach((point, j) => closePoint(point, shapes[i][j])));
    expect(cropped.source).toBe(layer.source);
    expect(cropped.mask).toBe(layer.mask);
    expect(layer.crops).toEqual([]);
  });

  it('按选区外接像素边界剪裁画布，图层相对新画布偏移但内容不丢失', () => {
    const selection = { points: [{ x: 20.3, y: 10.6 }, { x: 99.1, y: 15 }, { x: 75, y: 80.2 }] };
    const result = cropCanvasProject(project, selection);
    expect([result.width, result.height]).toEqual([80, 71]);
    expect(result.layers[0]).toEqual({ ...layer, x: 107, y: 74 });
    const before = layerToProject(layer, { x: 32, y: 15 });
    const after = layerToProject(result.layers[0], { x: 32, y: 15 });
    closePoint(after, { x: before.x - 20, y: before.y - 10 });
    expect(project.layers[0]).toBe(layer);
  });

  it('空选区不能产生零尺寸工程或空剪裁', () => {
    const empty = { points: [{ x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 3 }] };
    expect(() => cropCanvasProject(project, empty)).toThrow();
    expect(() => cropImageLayer(layer, empty)).toThrow();
  });

  it('相同图片只解码一次，适配不放大并各自产生独立图层', async () => {
    let decodes = 0;
    class FakeImage {
      naturalWidth = 200;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { decodes += 1; queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      const first = await createImageLayer('data:image/cache-test', 100, 100);
      const second = await createImageLayer('data:image/cache-test', 400, 400);
      expect(decodes).toBe(1);
      expect(first).toMatchObject({ width: 200, height: 100, x: 0, y: 25, scaleX: 0.5, scaleY: 0.5 });
      expect(second).toMatchObject({ width: 200, height: 100, x: 100, y: 150, scaleX: 1, scaleY: 1 });
      expect(first.id).not.toBe(second.id);
    } finally { vi.unstubAllGlobals(); }
  });

  it('命中使用变换后的素材坐标及图层渲染后的 alpha，越界不绘制', async () => {
    const calls: string[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    const ctx = {
      save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
      clip: () => calls.push('clip'),
      drawImage: () => calls.push('draw'),
      globalCompositeOperation: 'source-over',
      getImageData: (x: number, y: number) => { calls.push(`pixel:${x},${y}`); return { data: [0, 0, 0, x === 10 ? 0 : 255] }; },
    };
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      const masked = { ...layer, source: 'data:image/hit-original', mask: 'data:image/hit-mask', crops: [{ points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 50 }] }] };
      expect(await hitCanvasLayer(masked, layerToProject(masked, { x: -1, y: 10 }))).toBe(false);
      expect(calls).toEqual([]);
      expect(await hitCanvasLayer(masked, layerToProject(masked, { x: 10.2, y: 20.2 }))).toBe(false);
      expect(calls).toEqual(['clip', 'draw', 'draw', 'pixel:10,20']);
      calls.length = 0;
      expect(await hitCanvasLayer(masked, layerToProject(masked, { x: 30.2, y: 20.2 }))).toBe(true);
      expect(calls).toContain('pixel:30,20');
      expect(await hitCanvasLayer({ ...masked, opacity: 0 }, layerToProject(masked, { x: 30, y: 20 }))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
