import type { CanvasBrushStroke, CanvasImageLayer, CanvasPoint, CanvasProject, CanvasSelection } from './canvasTypes';
import { createUuid } from './id';
import { pixelBrushEdit, pixelSelectionEdit, renderPixelEdits } from './canvasPixelEdits';

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (canvas.width !== width || canvas.height !== height) throw new Error('无法创建指定尺寸的画布');
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = canvas.getContext('2d');
  if (!result) throw new Error('无法创建画布绘图上下文');
  return result;
}

// 拖动时会频繁重绘，复用已解码图片；限制缓存数量，避免笔画产生的旧蒙版持续累积。
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const IMAGE_CACHE_LIMIT = 32;
function loadImage(source: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(source);
  if (cached) {
    imageCache.delete(source);
    imageCache.set(source, cached);
    return cached;
  }
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载图片'));
    image.src = source;
  });
  imageCache.set(source, loading);
  if (imageCache.size > IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value!);
  void loading.catch(() => { if (imageCache.get(source) === loading) imageCache.delete(source); });
  return loading;
}

function path(ctx: CanvasRenderingContext2D, points: CanvasPoint[]): void {
  ctx.beginPath();
  if (points.length) {
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }
}

function bounds(selection: CanvasSelection): { x: number; y: number; width: number; height: number } {
  if (selection.points.length < 3) throw new Error('选区至少需要三个点');
  let left = Infinity, top = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of selection.points) {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const x = Math.floor(left);
  const y = Math.floor(top);
  const right = Math.ceil(maxX);
  const bottom = Math.ceil(maxY);
  if (right <= x || bottom <= y) throw new Error('选区不能为空');
  return { x, y, width: right - x, height: bottom - y };
}

export async function createImageLayer(source: string, canvasWidth: number, canvasHeight: number, name = '图片'): Promise<CanvasImageLayer> {
  const image = await loadImage(source);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error('图片尺寸无效');
  const scale = Math.min(1, canvasWidth / width, canvasHeight / height);
  return { id: createUuid(), name, source, width, height, x: (canvasWidth - width * scale) / 2, y: (canvasHeight - height * scale) / 2, scaleX: scale, scaleY: scale, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
}

export function layerToProject(layer: CanvasImageLayer, point: CanvasPoint): CanvasPoint {
  const angle = layer.rotation * Math.PI / 180;
  const x = point.x * layer.scaleX;
  const y = point.y * layer.scaleY;
  return { x: layer.x + x * Math.cos(angle) - y * Math.sin(angle), y: layer.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

export function projectToLayer(layer: CanvasImageLayer, point: CanvasPoint): CanvasPoint {
  const angle = layer.rotation * Math.PI / 180;
  const x = point.x - layer.x;
  const y = point.y - layer.y;
  return { x: (x * Math.cos(angle) + y * Math.sin(angle)) / layer.scaleX, y: (-x * Math.sin(angle) + y * Math.cos(angle)) / layer.scaleY };
}

export interface CanvasBrushPreview { layerId: string; stroke: CanvasBrushStroke; selection: CanvasSelection | null }

async function layerBitmap(layer: CanvasImageLayer, preview?: CanvasBrushPreview): Promise<{ bitmap: HTMLCanvasElement; x: number; y: number }> {
  const bitmap = makeCanvas(layer.width, layer.height);
  const ctx = context(bitmap);
  const image = await loadImage(layer.source);
  ctx.save();
  for (const crop of layer.crops) {
    path(ctx, crop.points);
    ctx.clip();
  }
  ctx.drawImage(image, 0, 0, layer.width, layer.height);
  ctx.restore();
  const usesPixelEdits = Boolean(layer.pixelEdits?.length);
  const original = usesPixelEdits ? (() => { const result = makeCanvas(layer.width, layer.height); context(result).drawImage(bitmap, 0, 0); return result; })() : null;
  if ((!usesPixelEdits && preview) || layer.mask) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(!usesPixelEdits && preview ? await brushMask(layer, preview.stroke, preview.selection) : await loadImage(layer.mask!), 0, 0, layer.width, layer.height);
  }
  return original ? renderPixelEdits(layer, original, bitmap, preview ? pixelBrushEdit(layer, preview.stroke, preview.selection) : undefined) : { bitmap, x: 0, y: 0 };
}

/** 使用图层最终可见像素命中，透明区不会挡住下方图层。 */
export async function hitCanvasLayer(layer: CanvasImageLayer, point: CanvasPoint): Promise<boolean> {
  if (!layer.visible || layer.opacity <= 0) return false;
  const local = projectToLayer(layer, point);
  if (!layer.pixelEdits?.length && (local.x < 0 || local.y < 0 || local.x >= layer.width || local.y >= layer.height)) return false;
  const { bitmap, x, y } = await layerBitmap(layer);
  if (local.x < x || local.y < y || local.x >= x + bitmap.width || local.y >= y + bitmap.height) return false;
  return context(bitmap).getImageData(Math.floor(local.x - x), Math.floor(local.y - y), 1, 1).data[3] > 0;
}

export async function renderProject(project: CanvasProject, preview?: CanvasBrushPreview | null): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas(project.width, project.height);
  const ctx = context(canvas);
  if (project.background.kind === 'color') {
    ctx.fillStyle = project.background.color;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const { bitmap, x, y } = await layerBitmap(layer, preview?.layerId === layer.id ? preview : undefined);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.scaleX, layer.scaleY);
    ctx.drawImage(bitmap, x, y);
    ctx.restore();
  }
  return canvas;
}

async function brushMask(layer: CanvasImageLayer, stroke: CanvasBrushStroke, selection: CanvasSelection | null): Promise<HTMLCanvasElement> {
  const mask = makeCanvas(layer.width, layer.height);
  const ctx = context(mask);
  if (layer.mask) ctx.drawImage(await loadImage(layer.mask), 0, 0, layer.width, layer.height);
  else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, layer.width, layer.height);
  }
  // 蒙版以素材像素保存，但笔迹与选区用画布坐标；逆变换同时处理镜像和非等比缩放。
  const origin = projectToLayer(layer, { x: 0, y: 0 });
  const xAxis = projectToLayer(layer, { x: 1, y: 0 });
  const yAxis = projectToLayer(layer, { x: 0, y: 1 });
  ctx.setTransform(xAxis.x - origin.x, xAxis.y - origin.y, yAxis.x - origin.x, yAxis.y - origin.y, origin.x, origin.y);
  if (selection) {
    path(ctx, selection.points);
    ctx.clip();
  }
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!stroke.points.length) return mask;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.stroke();
  return mask;
}

export async function applyBrush(layer: CanvasImageLayer, stroke: CanvasBrushStroke, selection: CanvasSelection | null): Promise<CanvasImageLayer> {
  if (!stroke.points.length) return layer;
  if (layer.pixelEdits?.length) return { ...layer, pixelEdits: [...layer.pixelEdits, pixelBrushEdit(layer, stroke, selection)] };
  const mask = await brushMask(layer, stroke, selection);
  return { ...layer, mask: mask.toDataURL('image/png') };
}

export function cropImageLayer(layer: CanvasImageLayer, selection: CanvasSelection): CanvasImageLayer {
  bounds(selection);
  if (layer.pixelEdits?.length) return pixelSelectionEdit(layer, selection, 'crop');
  return { ...layer, crops: [...layer.crops, { points: selection.points.map(point => projectToLayer(layer, point)) }] };
}

export function cropCanvasProject(project: CanvasProject, selection: CanvasSelection): CanvasProject {
  const area = bounds(selection);
  return { ...project, width: area.width, height: area.height, layers: project.layers.map(layer => ({ ...layer, x: layer.x - area.x, y: layer.y - area.y })) };
}

export async function copyCanvasSelection(project: CanvasProject, selection: CanvasSelection, layerId: string | null): Promise<CanvasImageLayer> {
  const area = bounds(selection);
  const rendered = await renderProject(layerId === null ? project : {
    ...project,
    background: { kind: 'transparent', color: '' },
    layers: project.layers.filter(layer => layer.id === layerId),
  });
  const copy = makeCanvas(area.width, area.height);
  const ctx = context(copy);
  ctx.translate(-area.x, -area.y);
  path(ctx, selection.points);
  ctx.clip();
  ctx.drawImage(rendered, 0, 0);
  return { id: createUuid(), name: layerId === null ? '合并复制' : '选区复制', source: copy.toDataURL('image/png'), width: area.width, height: area.height, x: area.x, y: area.y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
}
