import { expect, it } from 'vitest';
import { paintAgentMask } from '../../services/agentCanvas';
const alpha = (data: Uint8ClampedArray, x: number, y: number) => data[(y * 8 + x) * 4 + 3];
it('矩形只修改目标像素，擦除保留其他笔迹与原始数组', () => {
  const original = new Uint8ClampedArray(8 * 8 * 4);
  const painted = paintAgentMask(original, 8, 8, { operation: 'paint_rectangle', rect: { x: 2, y: 2, width: 3, height: 4 } });
  expect(painted.changedPixels).toBe(12); expect(original.every(value => value === 0)).toBe(true);
  const erased = paintAgentMask(painted.data, 8, 8, { operation: 'erase_rectangle', rect: { x: 2, y: 2, width: 1, height: 1 } });
  expect(alpha(erased.data, 2, 2)).toBe(0); expect(alpha(erased.data, 3, 3)).toBe(255); expect(alpha(erased.data, 1, 2)).toBe(0);
});
it('Focused 裁切限制所有笔迹，多边形和连续笔刷支持局部绘制', () => {
  const empty = new Uint8ClampedArray(256), clip = { x: 3, y: 3, width: 2, height: 2 };
  const result = paintAgentMask(empty, 8, 8, { operation: 'paint_rectangle', rect: { x: 0, y: 0, width: 8, height: 8 } }, clip);
  expect(result.changedPixels).toBe(4); expect(alpha(result.data, 2, 3)).toBe(0);
  const polygon = paintAgentMask(empty, 8, 8, { operation: 'paint_polygon', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }] });
  expect(alpha(polygon.data, 1, 1)).toBe(255); expect(alpha(polygon.data, 7, 7)).toBe(0);
  const stroke = paintAgentMask(empty, 8, 8, { operation: 'brush_stroke', brushSize: 2, points: [{ x: 1, y: 4 }, { x: 7, y: 4 }] });
  expect(alpha(stroke.data, 4, 4)).toBe(255); expect(alpha(stroke.data, 4, 1)).toBe(0);
});
it('越界、非数字与过大的画布拒绝，原始蒙版不改变', () => {
  const empty = new Uint8ClampedArray(256);
  for (const rect of [{ x: -1, y: 0, width: 1, height: 1 }, { x: 7, y: 0, width: 2, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }]) expect(() => paintAgentMask(empty, 8, 8, { operation: 'paint_rectangle', rect })).toThrow();
  expect(() => paintAgentMask(empty, 8, 8, { operation: 'brush_stroke', points: [{ x: 4, y: 4 }], brushSize: 257 })).toThrow();
  expect(empty.every(value => value === 0)).toBe(true);
});

it('椭圆不会把包围框角落涂满，区域外的既有笔迹保留', () => {
  const original = new Uint8ClampedArray(256); original[3] = 255;
  const result = paintAgentMask(original, 8, 8, { operation: 'paint_ellipse', rect: { x: 1, y: 1, width: 6, height: 6 } });
  expect(alpha(result.data, 1, 1)).toBe(0); expect(alpha(result.data, 4, 4)).toBe(255); expect(alpha(result.data, 0, 0)).toBe(255);
});
