import { createUuid } from '../id';
import type { ComicAnchor, ComicBubbleItem, ComicBubbleShape, ComicColorMode } from './comicTypes';

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
  /** 外沿深色描边封闭度 (0..1)，真实气泡通常有明显黑/深色描边包围 */
  borderInkRatio: number;
  /** 综合置信度 (0..1) */
  confidence: number;
}

export interface ComicBubbleCandidate extends DetectedWhiteBubble {
  id: string;
  selected: boolean;
  text: string;
  shape: ComicBubbleShape;
  matchedAnchorId?: string;
}

export interface DetectWhiteBubblesOptions {
  colorMode?: ComicColorMode;
  whiteThreshold?: number;
  maxChroma?: number;
  minAreaRatio?: number;
  maxAreaRatio?: number;
  minBorderInkRatio?: number;
  maxCount?: number;
}

/**
 * 纯本地气泡连通域检测（彩漫/黑白网点漫自适应）：
 * - 彩漫放宽米白/淡阴影容差，避免暖白气泡漏检；
 * - 黑白漫启用外沿墨线封闭度（borderInkRatio）过滤人物白衣与无框留白；
 * - 允许极轻微贴近画框边缘的气泡（仅剔除大面积连通外框白边）。
 */
export const detectWhiteBubblesFromPixels = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectWhiteBubblesOptions = {},
): DetectedWhiteBubble[] => {
  if (width < 16 || height < 16 || data.length < width * height * 4) return [];

  const isMono = options.colorMode === 'monochrome';
  const whiteThreshold = options.whiteThreshold ?? (isMono ? 234 : 218);
  const maxChroma = options.maxChroma ?? (isMono ? 18 : 34);
  const minAreaRatio = options.minAreaRatio ?? 0.0035;
  const maxAreaRatio = options.maxAreaRatio ?? 0.22;
  const minBorderInkRatio = options.minBorderInkRatio ?? (isMono ? 0.30 : 0.16);
  const maxCount = options.maxCount ?? 24;

  const totalPixels = width * height;
  const isWhite = new Uint8Array(totalPixels);
  const luma = new Uint8Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const a = data[o + 3];
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    luma[i] = (r * 77 + g * 150 + b * 29) >> 8;
    if (a < 200) continue;
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
    let borderTouches = 0;
    let edgePixels = 0;
    let inkedEdgePixels = 0;

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
      if (px === 0 || py === 0 || px === width - 1 || py === height - 1) {
        borderTouches += 1;
      }

      let isBoundary = false;
      let hasDarkNeighbor = false;

      const checkNeighbor = (nx: number, ny: number) => {
        const nIdx = ny * width + nx;
        if (isWhite[nIdx]) {
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        } else {
          isBoundary = true;
          if (luma[nIdx] < 170) hasDarkNeighbor = true;
        }
      };

      if (px > 0) checkNeighbor(px - 1, py);
      if (px + 1 < width) checkNeighbor(px + 1, py);
      if (py > 0) checkNeighbor(px, py - 1);
      if (py + 1 < height) checkNeighbor(px, py + 1);

      if (isBoundary) {
        edgePixels += 1;
        // 若紧邻 1px 是抗锯齿浅灰，多外探 1px 看是否有真实描边墨线
        if (!hasDarkNeighbor) {
          for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && luma[ny * width + nx] < 160) {
              hasDarkNeighbor = true;
              break;
            }
          }
        }
        if (hasDarkNeighbor) inkedEdgePixels += 1;
      }
    }

    // 大面积贴着画纸外框的是页边距或外白缝，直接排除；仅轻微贴边几像素的贴边气泡保留
    if (borderTouches > Math.max(8, Math.round(Math.min(width, height) * 0.08))) continue;
    const areaRatio = count / totalPixels;
    if (areaRatio < minAreaRatio || areaRatio > maxAreaRatio) continue;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const aspect = boxW / Math.max(1, boxH);
    if (aspect < 0.22 || aspect > 4.5) continue;

    const fillRatio = count / Math.max(1, boxW * boxH);
    if (fillRatio < 0.36) continue;

    const borderInkRatio = edgePixels > 0 ? inkedEdgePixels / edgePixels : 0;
    if (borderInkRatio < minBorderInkRatio) continue;

    const cxPx = Math.round(sumX / count);
    const cyPx = Math.round(sumY / count);
    let centerWhite = false;
    for (let dy = -2; dy <= 2 && !centerWhite; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = Math.min(width - 1, Math.max(0, cxPx + dx));
        const ny = Math.min(height - 1, Math.max(0, cyPx + dy));
        if (isWhite[ny * width + nx]) { centerWhite = true; break; }
      }
    }
    if (!centerWhite) continue;

    const confidence = Math.min(
      1,
      Number((borderInkRatio * 0.6 + Math.min(1, fillRatio / 0.75) * 0.4).toFixed(3)),
    );

    results.push({
      x: Number(((minX + boxW / 2) / width).toFixed(4)),
      y: Number(((minY + boxH / 2) / height).toFixed(4)),
      width: Number((boxW / width).toFixed(4)),
      height: Number((boxH / height).toFixed(4)),
      areaRatio: Number(areaRatio.toFixed(4)),
      fillRatio: Number(fillRatio.toFixed(3)),
      borderInkRatio: Number(borderInkRatio.toFixed(3)),
      confidence,
    });
  }

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
 * 构建可视化校对候选列表：
 * - 先在画布上以候选框展示，默认只勾选命中剧本锚点（或无锚点时高置信度）的气泡；
 * - 用户逐个勾选、改台词并确认后才真正写入画布，彻底避免误检乱塞占位字。
 */
export const prepareBubbleCandidates = (
  detected: DetectedWhiteBubble[],
  bubbleAnchors: ComicAnchor[],
  existingBubbles: ComicBubbleItem[],
): ComicBubbleCandidate[] => {
  const activeAnchors = bubbleAnchors.filter(a => a.enabled && a.kind === 'bubble');
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

  const isDuplicateAt = (x: number, y: number) => existingBubbles.some(b => Math.hypot(b.x - x, b.y - y) < 0.035);
  const hasScriptAnchors = activeAnchors.length > 0;
  const candidates: ComicBubbleCandidate[] = [];

  detected.forEach((region, dIdx) => {
    if (isDuplicateAt(region.x, region.y)) return;
    const matched = anchorForDetected.get(dIdx);
    candidates.push({
      ...region,
      id: createUuid(),
      selected: matched ? true : (!hasScriptAnchors && region.confidence >= 0.62),
      text: matched?.bubbleText?.trim() || '',
      shape: matched?.bubbleShape || 'oval',
      matchedAnchorId: matched?.id,
    });
  });

  // 未检测到对应白泡但写了台词的锚点，也作为候选供用户勾选补位
  activeAnchors.forEach((anchor, aIdx) => {
    if (usedAnchors.has(aIdx) || !anchor.bubbleText?.trim()) return;
    if (isDuplicateAt(anchor.x, anchor.y)) return;
    candidates.push({
      id: createUuid(),
      x: anchor.x,
      y: anchor.y,
      width: 0.18,
      height: 0.11,
      areaRatio: 0.02,
      fillRatio: 0.78,
      borderInkRatio: 0.5,
      confidence: 0.75,
      selected: true,
      text: anchor.bubbleText.trim(),
      shape: anchor.bubbleShape || 'oval',
      matchedAnchorId: anchor.id,
    });
  });

  return candidates;
};

/** 将用户校对勾选后的候选气泡正式转为透明无框可编辑文字层。 */
export const commitBubbleCandidates = (
  candidates: ComicBubbleCandidate[],
  options: { writingMode?: 'horizontal' | 'vertical'; pageHeight?: number } = {},
): ComicBubbleItem[] => {
  const writingMode = options.writingMode || 'vertical';
  const pageHeight = options.pageHeight || 1216;
  return candidates
    .filter(c => c.selected)
    .map(region => {
      const approxBubblePx = Math.min(region.width * pageHeight, region.height * pageHeight);
      const fontSize = Math.max(15, Math.min(28, Math.round(approxBubblePx * 0.17)));
      return {
        id: createUuid(),
        shape: region.shape || 'oval',
        x: region.x,
        y: region.y,
        width: Math.max(0.08, Number((region.width * 0.84).toFixed(3))),
        height: Math.max(0.06, Number((region.height * 0.84).toFixed(3))),
        hasTail: false,
        tailX: Math.min(0.95, region.x + 0.05),
        tailY: Math.min(0.95, region.y + 0.08),
        text: region.text.trim() || '输入台词…',
        writingMode,
        fontFamily: 'comic-sans',
        fontSize,
        textColor: '#111827',
        fillColor: 'transparent',
        strokeColor: '#111827',
        strokeWidth: 0,
        rotation: 0,
      };
    });
};

/** 兼容直接生成调用：沿用新候选筛选算法。 */
export const buildEmbeddedBubbleTextItems = (
  detected: DetectedWhiteBubble[],
  bubbleAnchors: ComicAnchor[],
  existingBubbles: ComicBubbleItem[],
  options: { writingMode?: 'horizontal' | 'vertical'; pageHeight?: number } = {},
): { items: ComicBubbleItem[]; matchedCount: number; detectedCount: number } => {
  const candidates = prepareBubbleCandidates(detected, bubbleAnchors, existingBubbles);
  const items = commitBubbleCandidates(candidates, options);
  const matchedCount = candidates.filter(c => Boolean(c.matchedAnchorId)).length;
  return { items, matchedCount, detectedCount: detected.length };
};
