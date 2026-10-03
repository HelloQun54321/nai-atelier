export interface AgentRect { x: number; y: number; width: number; height: number }
export interface AgentPoint { x: number; y: number }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const agentRect = (value: unknown, width: number, height: number): AgentRect => {
  const rect = value as AgentRect;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('选区必须使用实际画布像素，且完整位于画布内');
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};
/** 对真实蒙版的副本操作；校验失败或指定区域之外的像素均保持不变。 */
export const paintAgentMask = (original: Uint8ClampedArray, width: number, height: number, args: Record<string, unknown>, clip?: AgentRect | null) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_194_304 || original.length !== width * height * 4) throw new Error('请先把底图规范化到支持的画布尺寸');
  const operation = String(args.operation), erase = operation === 'erase_rectangle' || args.erase === true;
  const shape = ['paint_rectangle', 'erase_rectangle', 'paint_ellipse'].includes(operation);
  if (!shape && !['brush_stroke', 'paint_polygon'].includes(operation)) throw new Error('不支持这个蒙版操作');
  const points = (args.points || []) as AgentPoint[];
  if (!shape && (!Array.isArray(points) || points.length < (operation === 'paint_polygon' ? 3 : 1) || points.length > 64 || points.some(point => !point || !finite(point.x) || !finite(point.y) || point.x < 0 || point.y < 0 || point.x > width || point.y > height))) throw new Error('请提供画布内的 1～64 个笔迹点，多边形至少三个点');
  const diameter = args.brushSize ?? 32;
  if (operation === 'brush_stroke' && (!finite(diameter) || diameter < 1 || diameter > 256)) throw new Error('笔刷尺寸必须在 1～256 像素之间');
  const radius = Number(diameter) / 2;
  const region = shape ? agentRect(args.rect, width, height) : { x: Math.max(0, Math.min(...points.map(point => point.x)) - radius), y: Math.max(0, Math.min(...points.map(point => point.y)) - radius), width: 0, height: 0 };
  const right = shape ? region.x + region.width : Math.min(width, Math.max(...points.map(point => point.x)) + radius), bottom = shape ? region.y + region.height : Math.min(height, Math.max(...points.map(point => point.y)) + radius);
  const boundary = clip ? agentRect(clip, width, height) : { x: 0, y: 0, width, height };
  const left = Math.max(0, Math.ceil(region.x), Math.ceil(boundary.x)), top = Math.max(0, Math.ceil(region.y), Math.ceil(boundary.y));
  const endX = Math.min(width, Math.ceil(right), Math.ceil(boundary.x + boundary.width)), endY = Math.min(height, Math.ceil(bottom), Math.ceil(boundary.y + boundary.height));
  const output = new Uint8ClampedArray(original); let changedPixels = 0;
  const inside = (x: number, y: number) => {
    if (operation === 'paint_ellipse') return ((x - region.x - region.width / 2) / (region.width / 2)) ** 2 + ((y - region.y - region.height / 2) / (region.height / 2)) ** 2 <= 1;
    if (shape) return true;
    if (operation === 'paint_polygon') {
      let result = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result; }
      return result;
    }
    return points.some((point, index) => { const previous = points[Math.max(0, index - 1)], dx = point.x - previous.x, dy = point.y - previous.y, length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((x - previous.x) * dx + (y - previous.y) * dy) / length)) : 0; return (x - previous.x - dx * t) ** 2 + (y - previous.y - dy * t) ** 2 <= radius * radius; });
  };
  for (let y = top; y < endY; y++) for (let x = left; x < endX; x++) {
    if (!inside(x + .5, y + .5)) continue;
    const index = (y * width + x) * 4, alpha = erase ? 0 : 255;
    if (output[index + 3] !== alpha) changedPixels++;
    output[index] = output[index + 1] = output[index + 2] = erase ? 0 : 255; output[index + 3] = alpha;
  }
  return { data: output, changedPixels };
};
