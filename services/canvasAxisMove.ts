import type { CanvasPoint } from './canvasTypes';

export type CanvasMoveAxis = 'pending' | 'x' | 'y' | null;

export interface CanvasAxisMoveState {
  /** 当前实际显示的相对拖动起点位移。 */
  delta: CanvasPoint;
  /** Shift 生效时实际拖拽锚点的位置，作为引导线交点。 */
  origin: CanvasPoint;
  axis: CanvasMoveAxis;
  shift: boolean;
  lastPoint: CanvasPoint;
  originDelta: CanvasPoint;
  dragStart: CanvasPoint;
  pointerOrigin: CanvasPoint;
}

export const createCanvasAxisMove = (point: CanvasPoint, shift: boolean): CanvasAxisMoveState => ({
  delta: { x: 0, y: 0 }, origin: point, axis: shift ? 'pending' : null,
  shift, lastPoint: point, originDelta: { x: 0, y: 0 }, dragStart: point, pointerOrigin: point,
});

/** 在键盘状态变化处重设基准，让释放或再次按住 Shift 时画面不会跳动。 */
export const updateCanvasAxisMove = (previous: CanvasAxisMoveState, point: CanvasPoint, shift: boolean, zoom: number): CanvasAxisMoveState => {
  const changed = shift !== previous.shift;
  const originDelta = changed ? previous.delta : previous.originDelta;
  const origin = changed ? { x: previous.dragStart.x + originDelta.x, y: previous.dragStart.y + originDelta.y } : previous.origin;
  const pointerOrigin = changed ? previous.lastPoint : previous.pointerOrigin;
  let axis: CanvasMoveAxis = changed ? (shift ? 'pending' : null) : previous.axis;
  const dx = point.x - pointerOrigin.x;
  const dy = point.y - pointerOrigin.y;

  if (axis === 'pending') {
    const distance = Math.hypot(dx, dy) * zoom;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (distance >= 6 && (ax >= ay * 1.2 || ay >= ax * 1.2 || distance >= 18)) {
      axis = ax >= ay ? 'x' : 'y';
    }
  }
  const delta = axis === 'pending' ? originDelta
    : axis === 'x' ? { x: originDelta.x + dx, y: originDelta.y }
      : axis === 'y' ? { x: originDelta.x, y: originDelta.y + dy }
        : { x: originDelta.x + dx, y: originDelta.y + dy };
  return { delta, origin, axis, shift, lastPoint: point, originDelta, dragStart: previous.dragStart, pointerOrigin };
};
