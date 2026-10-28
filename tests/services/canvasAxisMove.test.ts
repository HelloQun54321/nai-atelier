import { describe, expect, it } from 'vitest';
import { createCanvasAxisMove, updateCanvasAxisMove } from '../../services/canvasAxisMove';

describe('画布移动方向约束', () => {
  it('根据屏幕距离和方向倾向判定，锁定后维持方向', () => {
    let state = createCanvasAxisMove({ x: 10, y: 20 }, true);
    state = updateCanvasAxisMove(state, { x: 20, y: 24 }, true, 0.5);
    expect(state.axis).toBe('pending');
    expect(state.delta).toEqual({ x: 0, y: 0 });
    state = updateCanvasAxisMove(state, { x: 24, y: 24 }, true, 0.5);
    expect(state.axis).toBe('x');
    expect(state.delta).toEqual({ x: 14, y: 0 });
    state = updateCanvasAxisMove(state, { x: 25, y: 80 }, true, 0.5);
    expect(state.axis).toBe('x');
    expect(state.delta).toEqual({ x: 15, y: 0 });
  });

  it('近对角线超过阈值后选择较大的方向，避免长时间停滞', () => {
    let state = createCanvasAxisMove({ x: 0, y: 0 }, true);
    state = updateCanvasAxisMove(state, { x: 9, y: 10 }, true, 1);
    expect(state.axis).toBe('pending');
    expect(state.delta).toEqual({ x: 0, y: 0 });
    state = updateCanvasAxisMove(state, { x: 13, y: 14 }, true, 1);
    expect(state.axis).toBe('y');
    expect(state.delta).toEqual({ x: 0, y: 14 });
  });

  it('松开 Shift 无跳动恢复自由移动，再次按下重新判定并从实际位置显示引导线', () => {
    let state = createCanvasAxisMove({ x: 100, y: 100 }, false);
    state = updateCanvasAxisMove(state, { x: 110, y: 105 }, false, 1);
    expect(state.delta).toEqual({ x: 10, y: 5 });
    state = updateCanvasAxisMove(state, { x: 110, y: 105 }, true, 1);
    expect(state.origin).toEqual({ x: 110, y: 105 });
    state = updateCanvasAxisMove(state, { x: 112, y: 125 }, true, 1);
    expect(state.delta).toEqual({ x: 10, y: 25 });
    state = updateCanvasAxisMove(state, { x: 112, y: 125 }, false, 1);
    expect(state.axis).toBeNull();
    expect(state.delta).toEqual({ x: 10, y: 25 });
    state = updateCanvasAxisMove(state, { x: 115, y: 127 }, false, 1);
    expect(state.delta).toEqual({ x: 13, y: 27 });
    state = updateCanvasAxisMove(state, { x: 115, y: 127 }, true, 1);
    expect(state.origin).toEqual({ x: 113, y: 127 });
    expect(state.delta).toEqual({ x: 13, y: 27 });
    state = updateCanvasAxisMove(state, { x: 125, y: 128 }, true, 1);
    expect(state.axis).toBe('x');
    expect(state.delta).toEqual({ x: 23, y: 27 });
  });
});
