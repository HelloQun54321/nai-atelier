import type { CanvasBrushStroke, CanvasImageLayer, CanvasPixelEdit, CanvasPoint, CanvasSelection } from './canvasTypes';

const toLocal = (layer: CanvasImageLayer, point: CanvasPoint): CanvasPoint => {
  const angle = layer.rotation * Math.PI / 180;
  const x = point.x - layer.x, y = point.y - layer.y;
  return { x: (x * Math.cos(angle) + y * Math.sin(angle)) / layer.scaleX, y: (-x * Math.sin(angle) + y * Math.cos(angle)) / layer.scaleY };
};

export function moveCanvasSelection(layer: CanvasImageLayer, selection: CanvasSelection, delta: CanvasPoint): CanvasImageLayer {
  const origin = toLocal(layer, { x: 0, y: 0 });
  const offset = toLocal(layer, delta);
  const edit: CanvasPixelEdit = { kind: 'move', points: selection.points.map(point => toLocal(layer, point)), dx: offset.x - origin.x, dy: offset.y - origin.y };
  return { ...layer, pixelEdits: [...layer.pixelEdits || [], edit] };
}

export function pixelBrushEdit(layer: CanvasImageLayer, stroke: CanvasBrushStroke, selection: CanvasSelection | null): CanvasPixelEdit {
  const origin = toLocal(layer, { x: 0, y: 0 });
  const x = toLocal(layer, { x: 1, y: 0 });
  const y = toLocal(layer, { x: 0, y: 1 });
  return { kind: 'brush', stroke, selection, transform: [x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y, origin.x, origin.y] };
}

export function pixelSelectionEdit(layer: CanvasImageLayer, selection: CanvasSelection, kind: 'erase-selection' | 'crop'): CanvasImageLayer {
  const edit: CanvasPixelEdit = { kind, points: selection.points.map(point => toLocal(layer, point)) };
  return { ...layer, pixelEdits: [...layer.pixelEdits || [], edit] };
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  if (output.width !== width || output.height !== height) throw new Error('无法创建选区编辑画布');
  return output;
}
function context(output: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = output.getContext('2d'); if (!result) throw new Error('无法创建选区编辑画布'); return result;
}
function path(ctx: CanvasRenderingContext2D, points: CanvasPoint[]): void {
  ctx.beginPath(); if (!points.length) return; ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y); ctx.closePath();
}
function copy(source: HTMLCanvasElement): HTMLCanvasElement {
  const result = canvas(source.width, source.height); context(result).drawImage(source, 0, 0); return result;
}

/** 对原始、已遮罩位图同时重放移动，保留恢复笔刷需要的原始像素。 */
export function renderPixelEdits(layer: CanvasImageLayer, original: HTMLCanvasElement, masked: HTMLCanvasElement, preview?: CanvasPixelEdit): { bitmap: HTMLCanvasElement; x: number; y: number } {
  const edits = preview ? [...layer.pixelEdits || [], preview] : layer.pixelEdits || [];
  let left = 0, top = 0, right = layer.width, bottom = layer.height;
  for (const edit of edits) if (edit.kind === 'move') for (const point of edit.points) {
    left = Math.min(left, point.x + edit.dx); top = Math.min(top, point.y + edit.dy);
    right = Math.max(right, point.x + edit.dx); bottom = Math.max(bottom, point.y + edit.dy);
  }
  left = Math.floor(left); top = Math.floor(top); right = Math.ceil(right); bottom = Math.ceil(bottom);
  const recovered = canvas(right - left, bottom - top), visible = canvas(right - left, bottom - top);
  context(recovered).drawImage(original, -left, -top); context(visible).drawImage(masked, -left, -top);
  const withLocal = (ctx: CanvasRenderingContext2D) => ctx.setTransform(1, 0, 0, 1, -left, -top);
  const move = (target: HTMLCanvasElement, edit: Extract<CanvasPixelEdit, { kind: 'move' }>) => {
    const old = copy(target), ctx = context(target);
    ctx.save(); withLocal(ctx); path(ctx, edit.points); ctx.clip(); ctx.clearRect(left, top, target.width, target.height); ctx.restore();
    ctx.save(); withLocal(ctx); ctx.translate(edit.dx, edit.dy); path(ctx, edit.points); ctx.clip(); ctx.drawImage(old, left, top); ctx.restore();
  };
  for (const edit of edits) {
    if (edit.kind === 'move') { move(recovered, edit); move(visible, edit); continue; }
    if (edit.kind === 'crop' || edit.kind === 'erase-selection') {
      for (const target of edit.kind === 'crop' ? [recovered, visible] : [visible]) {
        const ctx = context(target); ctx.save(); withLocal(ctx); path(ctx, edit.points);
        if (edit.kind === 'crop') { ctx.globalCompositeOperation = 'destination-in'; ctx.fill(); }
        else { ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); }
        ctx.restore();
      }
      continue;
    }
    const mask = canvas(visible.width, visible.height), maskCtx = context(mask);
    const [a, b, c, d, e, f] = edit.transform; maskCtx.setTransform(a, b, c, d, e - left, f - top);
    if (edit.selection) { path(maskCtx, edit.selection.points); maskCtx.clip(); }
    const points = edit.stroke.points; if (!points.length) continue;
    maskCtx.strokeStyle = '#fff'; maskCtx.fillStyle = '#fff'; maskCtx.lineWidth = edit.stroke.size; maskCtx.lineCap = 'round'; maskCtx.lineJoin = 'round';
    maskCtx.beginPath(); maskCtx.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) maskCtx.lineTo(point.x, point.y);
    if (points.length === 1) { maskCtx.arc(points[0].x, points[0].y, edit.stroke.size / 2, 0, Math.PI * 2); maskCtx.fill(); } else maskCtx.stroke();
    const ctx = context(visible);
    if (edit.stroke.mode === 'erase') { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask, 0, 0); ctx.restore(); }
    else {
      const restored = copy(recovered), restoredCtx = context(restored); restoredCtx.globalCompositeOperation = 'destination-in'; restoredCtx.drawImage(mask, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(restored, 0, 0); ctx.restore();
    }
  }
  return { bitmap: visible, x: left, y: top };
}
