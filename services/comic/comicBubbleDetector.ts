import { createUuid } from '../id';
import type { ComicAnchor, ComicBubbleItem, ComicBubbleShape } from './comicTypes';

export interface DetectedWhiteBubble {
  /** 归一化中心 X (0..1) */
  x: number;
  /** 归一化中心 Y (0..1) */
  y: number;
  /** 归一化宽度 (0..1) */
  width: number;
  /** 归一化高度 (0..1) */
  height: number;
  /** 占整页面积比例 */
  areaRatio: number;
  /** 包围盒填充度 (0..1) */
  fillRatio: number;
}

export interface DetectWhiteBubblesOptions {
  /** 最小 RGB 亮度门槛（默认 232） */
  whiteThreshold?: number;
  /** 最大色差容忍（默认 22，过滤浅蓝/浅粉高亮） */
  maxChroma?: number;
  /** 最小面积占比（默认 0.0035） */
  minAreaRatio?: number;
  /** 最大面积占比（默认 0.22，过滤大块纯白空格） */
  maxAreaRatio?: number;
  /** 最多返回气泡数（默认 24） */
  maxCount?: number;
}

/**
 * 纯本地毫秒级纯白气泡连通域检测（直接操作像素数组，无任何外部依赖）：
 * - 自动剔除接触画纸外边缘的页面留白与格缝；
 * - 通过面积区间、长宽比、实心填充度与中心白度，精准筛选漫画对白气泡。
 */
export const detectWhiteBubblesFromPixels = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectWhiteBubblesOptions = {},
): DetectedWhiteBubble[] => {
  if (width < 16 || height < 16 || data.length < width * height * 4) return [];

  const whiteThreshold = options.whiteThreshold ?? 232;
  const maxChroma = options.maxChroma ?? 22;
  const minAreaRatio = options.minAreaRatio ?? 0.0035;
  const maxAreaRatio = options.maxAreaRatio ?? 0.22;
  const maxCount = options.maxCount ?? 24;

  const totalPixels = width * height;
  const isWhite = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 200) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (minC >= whiteThreshold && maxC - minC <= maxChroma) {
      isWhite[i] = 1;
    }
  }

  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const results: DetectedWhiteBubble[] = [];

  for (let start = 0; start < totalPixels; start++) {
    if (!isWhite[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    let touchesBorder = false;

    while (head < tail) {
      const idx = queue[head++];
      const px = idx % width;
      const py = (idx - px) / width;

      count += 1;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px <= 1 || py <= 1 || px >= width - 2 || py >= height - 2) {
        touchesBorder = true;
      }

      if (px > 0) {
        const left = idx - 1;
        if (isWhite[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      }
      if (px + 1 < width) {
        const right = idx + 1;
        if (isWhite[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      }
      if (py > 0) {
        const up = idx - width;
        if (isWhite[up] && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      }
      if (py + 1 < height) {
        const down = idx + width;
        if (isWhite[down] && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
      }
    }

    if (touchesBorder) continue;
    const areaRatio = count / totalPixels;
    if (areaRatio < minAreaRatio || areaRatio > maxAreaRatio) continue;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const aspect = boxW / Math.max(1, boxH);
    if (aspect < 0.22 || aspect > 4.5) continue;

    const fillRatio = count / Math.max(1, boxW * boxH);
    if (fillRatio < 0.36) continue;

    const cxPx = Math.round(sumX / count);
    const cyPx = Math.round(sumY / count);
    // 中心点附近必须有白像素（排除中空白色画框）
    let centerWhite = false;
    for (let dy = -2; dy <= 2 && !centerWhite; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = Math.min(width - 1, Math.max(0, cxPx + dx));
        const ny = Math.min(height - 1, Math.max(0, cyPx + dy));
        if (isWhite[ny * width + nx]) { centerWhite = true; break; }
      }
    }
    if (!centerWhite) continue;

    results.push({
      x: Number(((minX + boxW / 2) / width).toFixed(4)),
      y: Number(((minY + boxH / 2) / height).toFixed(4)),
      width: Number((boxW / width).toFixed(4)),
      height: Number((boxH / height).toFixed(4)),
      areaRatio: Number(areaRatio.toFixed(4)),
      fillRatio: Number(fillRatio.toFixed(3)),
    });
  }

  // 按漫画阅读顺序（由上到下、同排从右到左）稳定排序
  return results
    .sort((a, b) => (Math.abs(a.y - b.y) > 0.08 ? a.y - b.y : b.x - a.x))
    .slice(0, maxCount);
};

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('加载成图失败，无法识别气泡'));
  img.src = url;
});

/**
 * 从已生成的漫画图片 URL 降采样读取像素并识别纯白气泡区域。
 */
export const detectWhiteBubblesFromImageUrl = async (
  imageUrl: string,
  options?: DetectWhiteBubblesOptions,
): Promise<DetectedWhiteBubble[]> => {
  const img = await loadImage(imageUrl);
  const maxSide = 560;
  const scale = Math.min(1, maxSide / Math.max(1, img.naturalWidth, img.naturalHeight));
  const w = Math.max(32, Math.round(img.naturalWidth * scale));
  const h = Math.max(32, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布初始化失败');
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return detectWhiteBubblesFromPixels(imageData.data, w, h, options);
};

/**
 * 将检测到的纯白气泡区域与剧本气泡锚点就近配对，生成无外框透明底的可编辑嵌字层：
 * - 保留 AI 原生绘制的自然气泡轮廓与尾巴，仅在气泡内部居中叠加高清可编辑文字；
 * - 用户可随时双击改字、拖动微调、切横竖排或改字号。
 */
export const buildEmbeddedBubbleTextItems = (
  detected: DetectedWhiteBubble[],
  bubbleAnchors: ComicAnchor[],
  existingBubbles: ComicBubbleItem[],
  options: { writingMode?: 'horizontal' | 'vertical'; pageHeight?: number } = {},
): { items: ComicBubbleItem[]; matchedCount: number; detectedCount: number } => {
  const writingMode = options.writingMode || 'vertical';
  const pageHeight = options.pageHeight || 1216;
  const activeAnchors = bubbleAnchors.filter(a => a.enabled && a.kind === 'bubble');

  // 贪心按最短距离配对 (detectedIndex, anchorIndex)
  const pairs: Array<{ dIdx: number; aIdx: number; dist: number }> = [];
  detected.forEach((d, dIdx) => {
    activeAnchors.forEach((a, aIdx) => {
      const dist = Math.hypot(d.x - a.x, d.y - a.y);
      if (dist <= 0.28) pairs.push({ dIdx, aIdx, dist });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);

  const usedDetected = new Set<number>();
  const usedAnchors = new Set<number>();
  const anchorForDetected = new Map<number, ComicAnchor>();
  for (const pair of pairs) {
    if (usedDetected.has(pair.dIdx) || usedAnchors.has(pair.aIdx)) continue;
    usedDetected.add(pair.dIdx);
    usedAnchors.add(pair.aIdx);
    anchorForDetected.set(pair.dIdx, activeAnchors[pair.aIdx]);
  }

  const items: ComicBubbleItem[] = [];
  const isDuplicateAt = (x: number, y: number) => existingBubbles.some(b => Math.hypot(b.x - x, b.y - y) < 0.035);

  detected.forEach((region, dIdx) => {
    if (isDuplicateAt(region.x, region.y)) return;
    const matched = anchorForDetected.get(dIdx);
    // 若用户已写了气泡锚点，优先保留匹配到的气泡及较明显的未匹配白泡
    const shape: ComicBubbleShape = matched?.bubbleShape || 'oval';
    const text = matched?.bubbleText?.trim() || '输入台词…';
    const approxBubblePx = Math.min(region.width * pageHeight, region.height * pageHeight);
    const fontSize = Math.max(15, Math.min(28, Math.round(approxBubblePx * 0.16)));

    items.push({
      id: createUuid(),
      shape,
      x: region.x,
      y: region.y,
      // 略微内缩留出原生气泡内边距，防止文字压到 AI 画的黑框线
      width: Math.max(0.08, Number((region.width * 0.84).toFixed(3))),
      height: Math.max(0.06, Number((region.height * 0.84).toFixed(3))),
      hasTail: false,
      tailX: Math.min(0.95, region.x + 0.05),
      tailY: Math.min(0.95, region.y + 0.08),
      text,
      writingMode,
      fontSize,
      textColor: '#111827',
      fillColor: 'transparent',
      strokeColor: '#111827',
      strokeWidth: 0,
      rotation: 0,
    });
  });

  // 未匹配到白泡但写了台词的气泡锚点：退回锚点原位落字，避免台词丢失
  activeAnchors.forEach((anchor, aIdx) => {
    if (usedAnchors.has(aIdx) || !anchor.bubbleText?.trim()) return;
    if (isDuplicateAt(anchor.x, anchor.y)) return;
    items.push({
      id: createUuid(),
      shape: anchor.bubbleShape || 'oval',
      x: anchor.x,
      y: anchor.y,
      width: 0.18,
      height: 0.11,
      hasTail: false,
      tailX: Math.min(0.95, anchor.x + 0.05),
      tailY: Math.min(0.95, anchor.y + 0.08),
      text: anchor.bubbleText.trim(),
      writingMode,
      fontSize: 20,
      textColor: '#111827',
      fillColor: 'transparent',
      strokeColor: '#111827',
      strokeWidth: 0,
      rotation: 0,
    });
  });

  return {
    items,
    matchedCount: anchorForDetected.size,
    detectedCount: detected.length,
  };
};
