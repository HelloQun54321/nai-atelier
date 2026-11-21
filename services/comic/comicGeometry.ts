import {
  GENERATION_MAX_DIMENSION,
  GENERATION_MIN_DIMENSION,
  OPUS_FREE_PIXEL_LIMIT,
  RESOLUTION_STEP,
} from '../aspectRatio';
import { createUuid } from '../id';
import type {
  ComicLayerState,
  ComicPageDraft,
  ComicPanel,
  ComicPaperPreset,
  ComicPoint,
} from './comicTypes';

export const COMIC_PANEL_SOFT_MAX = 24;

export const COMIC_PAPER_PRESETS: ComicPaperPreset[] = [
  { id: 'manga-portrait', label: '日漫竖页', description: '经典单页 2:3（832×1216）', width: 832, height: 1216 },
  { id: 'manga-spread', label: '跨页横版', description: '双页跨幅 3:2（1216×832）', width: 1216, height: 832 },
  { id: 'webtoon-strip', label: '竖条漫', description: '长条分镜（832×2048）', width: 832, height: 2048 },
  { id: 'square-page', label: '方形画幅', description: '四格/绘本 1:1（1024×1024）', width: 1024, height: 1024 },
];

export interface ComicLayoutTemplate {
  id: string;
  label: string;
  description: string;
  buildPanels: (gutterX: number, gutterY: number) => ComicPanel[];
}

const makePanel = (
  name: string,
  points: ComicPoint[],
  zIndex: number,
  extra: Partial<ComicPanel> = {},
): ComicPanel => ({
  id: createUuid(),
  name,
  points,
  rotation: 0,
  zIndex,
  borderColor: '#111827',
  borderWidth: 3,
  backgroundColor: '#f8fafc',
  prompt: '',
  negativePrompt: '',
  anchors: [],
  useCoords: true,
  ...extra,
});

export const rectToPolygon = (x: number, y: number, w: number, h: number): ComicPoint[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export const createDefaultLayers = (): ComicLayerState => ({
  panels: { visible: true, locked: false, order: 0 },
  drawing: { visible: true, locked: false, order: 1 },
  bubbles: { visible: true, locked: false, order: 2 },
  stickers: { visible: true, locked: false, order: 3 },
});

export const COMIC_LAYOUT_TEMPLATES: ComicLayoutTemplate[] = [
  {
    id: 'classic-4-121',
    label: '经典 4 格（1-2-1）',
    description: '上宽格引入、中双格对切、下宽格收尾',
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const h1 = (usableH - gy * 2) * 0.30;
      const h2 = (usableH - gy * 2) * 0.36;
      const h3 = usableH - gy * 2 - h1 - h2;
      const wHalf = (usableW - gx) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, usableW, h1), 1),
        makePanel('第 2 格', rectToPolygon(m, m + h1 + gy, wHalf, h2), 2),
        makePanel('第 3 格', rectToPolygon(m + wHalf + gx, m + h1 + gy, wHalf, h2), 3),
        makePanel('第 4 格', rectToPolygon(m, m + h1 + h2 + gy * 2, usableW, h3), 4),
      ];
    },
  },
  {
    id: 'grid-2x2',
    label: '均衡 2×2 四格',
    description: '四等分叙事页，节奏平稳',
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const w = (1 - m * 2 - gx) / 2;
      const h = (1 - m * 2 - gy) / 2;
      return [
        makePanel('第 1 格', rectToPolygon(m, m, w, h), 1),
        makePanel('第 2 格', rectToPolygon(m + w + gx, m, w, h), 2),
        makePanel('第 3 格', rectToPolygon(m, m + h + gy, w, h), 3),
        makePanel('第 4 格', rectToPolygon(m + w + gx, m + h + gy, w, h), 4),
      ];
    },
  },
  {
    id: 'yonkoma-vertical',
    label: '竖排四格漫',
    description: '起承转合经典四格长条',
    buildPanels: (_gx, gy) => {
      const mx = 0.08;
      const my = 0.035;
      const w = 1 - mx * 2;
      const h = (1 - my * 2 - gy * 3) / 4;
      return [0, 1, 2, 3].map(idx =>
        makePanel(`第 ${idx + 1} 格`, rectToPolygon(mx, my + idx * (h + gy), w, h), idx + 1),
      );
    },
  },
  {
    id: 'dynamic-l-shape',
    label: '动感 L 型 4 格',
    description: '左高立绘格 + 右侧三连特写',
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const usableW = 1 - m * 2;
      const usableH = 1 - m * 2;
      const leftW = (usableW - gx) * 0.44;
      const rightW = usableW - gx - leftW;
      const rightH = (usableH - gy * 2) / 3;
      return [
        makePanel('主立绘格', rectToPolygon(m, m, leftW, usableH), 1),
        makePanel('右上格', rectToPolygon(m + leftW + gx, m, rightW, rightH), 2),
        makePanel('右中格', rectToPolygon(m + leftW + gx, m + rightH + gy, rightW, rightH), 3),
        makePanel('右下格', rectToPolygon(m + leftW + gx, m + (rightH + gy) * 2, rightW, rightH), 4),
      ];
    },
  },
  {
    id: 'slanted-action-5',
    label: '斜切动作 5 格',
    description: '带斜角分镜线的戏剧冲突构图',
    buildPanels: (gx, gy) => {
      const m = 0.04;
      const r = 1 - m;
      const y1 = 0.30;
      const y2 = 0.65;
      const skew = 0.045;
      const midX = 0.5;
      return [
        makePanel('开场宽格', [
          { x: m, y: m },
          { x: r, y: m },
          { x: r, y: y1 - skew },
          { x: m, y: y1 + skew },
        ], 1),
        makePanel('中左斜格', [
          { x: m, y: y1 + skew + gy },
          { x: midX - gx * 0.5 + 0.03, y: y1 + gy },
          { x: midX - gx * 0.5 - 0.03, y: y2 - gy },
          { x: m, y: y2 - gy },
        ], 2),
        makePanel('中右斜格', [
          { x: midX + gx * 0.5 + 0.03, y: y1 + gy - skew * 0.5 },
          { x: r, y: y1 - skew + gy },
          { x: r, y: y2 - gy },
          { x: midX + gx * 0.5 - 0.03, y: y2 - gy },
        ], 3),
        makePanel('下左格', rectToPolygon(m, y2, (r - m - gx) * 0.42, r - y2), 4),
        makePanel('下右格', rectToPolygon(m + (r - m - gx) * 0.42 + gx, y2, (r - m - gx) * 0.58, r - y2), 5),
      ];
    },
  },
  {
    id: 'inset-overlay',
    label: '主格 + 双特写叠框',
    description: '满页主画面配右上、右下特写画中画',
    buildPanels: () => [
      makePanel('主画面格', rectToPolygon(0.04, 0.04, 0.92, 0.92), 1),
      makePanel('特写叠框 1', rectToPolygon(0.56, 0.08, 0.36, 0.24), 2, { borderWidth: 4 }),
      makePanel('特写叠框 2', rectToPolygon(0.58, 0.66, 0.34, 0.24), 3, { borderWidth: 4 }),
    ],
  },
  {
    id: 'single-splash',
    label: '单格满页跨幅',
    description: '空白单格，适合自由一刀切分',
    buildPanels: () => [makePanel('第 1 格', rectToPolygon(0.04, 0.04, 0.92, 0.92), 1)],
  },
];

export const createInitialComicDraft = (templateId = 'classic-4-121'): ComicPageDraft => {
  const preset = COMIC_PAPER_PRESETS[0];
  const gutterPx = 14;
  const gx = gutterPx / preset.width;
  const gy = gutterPx / preset.height;
  const template = COMIC_LAYOUT_TEMPLATES.find(item => item.id === templateId) || COMIC_LAYOUT_TEMPLATES[0];
  return {
    version: 1,
    id: createUuid(),
    title: '未命名漫画页',
    paperPresetId: preset.id,
    width: preset.width,
    height: preset.height,
    backgroundColor: '#ffffff',
    gutterPx,
    creationMode: 'manual',
    dialogueMode: 'clean-vector',
    colorMode: 'color',
    v5Model: 'nai-diffusion-5-full',
    globalBasePrompt: '',
    globalNegativePrompt: '',
    steps: 23,
    scale: 5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    cfgRescale: 0,
    variety: false,
    qualityPresetId: 'standard',
    ucPresetId: 'light',
    panels: template.buildPanels(gx, gy),
    strokes: [],
    bubbles: [],
    texts: [],
    stickers: [],
    layers: createDefaultLayers(),
    snapEnabled: true,
    updatedAt: Date.now(),
  };
};

export interface PanelPixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export const getPanelBoundingBox = (
  points: ComicPoint[],
  pageWidth: number,
  pageHeight: number,
): PanelPixelBounds => {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const px = point.x * pageWidth;
    const py = point.y * pageHeight;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
};

/**
 * 根据单个分镜框的像素宽高比例，自动匹配最贴近且面积最大化的 Opus 免费分辨率：
 * - 宽高均为 64 的倍数；
 * - 总像素 width * height <= 1,048,576 (1MP)；
 * - 单边范围 [64, 2048]，极端细长格也自动钳位到免费合理长宽比。
 */
export const matchFreeOpusResolution = (
  panelWidthPx: number,
  panelHeightPx: number,
): { width: number; height: number } => {
  const safeW = Math.max(1, Number.isFinite(panelWidthPx) ? panelWidthPx : 832);
  const safeH = Math.max(1, Number.isFinite(panelHeightPx) ? panelHeightPx : 1216);
  const targetRatio = Math.min(4.5, Math.max(1 / 4.5, safeW / safeH));

  let bestW = 1024;
  let bestH = 1024;
  let bestScore = Infinity;

  // 枚举所有满足免费像素上限且接近满像素区的 64 对齐候选（最多 ~32×32 = 1024 次，微秒级）
  for (let w = RESOLUTION_STEP * 4; w <= GENERATION_MAX_DIMENSION; w += RESOLUTION_STEP) {
    const maxH = Math.min(
      GENERATION_MAX_DIMENSION,
      Math.floor(OPUS_FREE_PIXEL_LIMIT / w / RESOLUTION_STEP) * RESOLUTION_STEP,
    );
    if (maxH < RESOLUTION_STEP * 4) continue;
    // 对该宽度只需考察最接近目标比例的 1~2 个高像素候选
    const idealH = Math.round(w / targetRatio / RESOLUTION_STEP) * RESOLUTION_STEP;
    const candidates = new Set<number>([
      Math.min(maxH, Math.max(RESOLUTION_STEP * 4, idealH)),
      Math.min(maxH, Math.max(RESOLUTION_STEP * 4, idealH - RESOLUTION_STEP)),
      Math.min(maxH, Math.max(RESOLUTION_STEP * 4, idealH + RESOLUTION_STEP)),
      maxH,
    ]);
    for (const h of candidates) {
      const area = w * h;
      if (area > OPUS_FREE_PIXEL_LIMIT || h < GENERATION_MIN_DIMENSION || h > GENERATION_MAX_DIMENSION) continue;
      // 尽量保持高清晰度（优先 ≥ 75% 免费面积）同时严格贴合画框比例
      const ratioError = Math.abs(Math.log((w / h) / targetRatio));
      const areaPenalty = (1 - area / OPUS_FREE_PIXEL_LIMIT) * 0.25;
      const score = ratioError + areaPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestW = w;
        bestH = h;
      }
    }
  }
  return { width: bestW, height: bestH };
};

export const getPanelTargetResolution = (
  panel: ComicPanel,
  pageWidth: number,
  pageHeight: number,
): { width: number; height: number; isCustom: boolean } => {
  if (panel.customWidth && panel.customHeight) {
    return { width: panel.customWidth, height: panel.customHeight, isCustom: true };
  }
  const bounds = getPanelBoundingBox(panel.points, pageWidth, pageHeight);
  const matched = matchFreeOpusResolution(bounds.width, bounds.height);
  return { ...matched, isCustom: false };
};

const clipPolygonHalfPlane = (
  polygon: ComicPoint[],
  origin: ComicPoint,
  normal: ComicPoint,
): ComicPoint[] => {
  if (polygon.length < 3) return [];
  const signedDist = (p: ComicPoint) => (p.x - origin.x) * normal.x + (p.y - origin.y) * normal.y;
  const output: ComicPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];
    const currD = signedDist(curr);
    const prevD = signedDist(prev);
    const currInside = currD >= -1e-6;
    const prevInside = prevD >= -1e-6;
    if (currInside !== prevInside) {
      const denom = prevD - currD;
      if (Math.abs(denom) > 1e-9) {
        const t = prevD / denom;
        output.push({
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
        });
      }
    }
    if (currInside) output.push({ ...curr });
  }
  // 去掉几乎重合的相邻顶点
  return output.filter((pt, idx, arr) => {
    const prev = arr[(idx + arr.length - 1) % arr.length];
    return Math.hypot(pt.x - prev.x, pt.y - prev.y) > 1e-4;
  });
};

export const polygonArea = (points: ComicPoint[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

/**
 * 两点一刀切分多边形：沿 lineStart -> lineEnd 将凸多边形切为两块，
 * 并在切缝法线方向各退让半个 gutter 形成自然漫画留白间距。
 */
export const slicePolygonByLine = (
  polygon: ComicPoint[],
  lineStart: ComicPoint,
  lineEnd: ComicPoint,
  gutterNormX: number,
  gutterNormY: number,
): [ComicPoint[], ComicPoint[]] | null => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;

  // 单位法线
  const nx = -dy / len;
  const ny = dx / len;
  const halfGapX = (gutterNormX * 0.5) * nx;
  const halfGapY = (gutterNormY * 0.5) * ny;

  const posOrigin = { x: lineStart.x + halfGapX, y: lineStart.y + halfGapY };
  const negOrigin = { x: lineStart.x - halfGapX, y: lineStart.y - halfGapY };

  const polyA = clipPolygonHalfPlane(polygon, posOrigin, { x: nx, y: ny });
  const polyB = clipPolygonHalfPlane(polygon, negOrigin, { x: -nx, y: -ny });

  if (polyA.length < 3 || polyB.length < 3) return null;
  if (polygonArea(polyA) < 0.002 || polygonArea(polyB) < 0.002) return null;
  return [polyA, polyB];
};

export const rotatePointAround = (
  point: ComicPoint,
  center: ComicPoint,
  angleDeg: number,
  aspectRatio = 1,
): ComicPoint => {
  if (!angleDeg) return point;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 按像素纵横比旋转避免非正方形页面拉扁
  const dx = (point.x - center.x) * aspectRatio;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin) / aspectRatio,
    y: center.y + (dx * sin + dy * cos),
  };
};

export const pointInPolygon = (point: ComicPoint, polygon: ComicPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const hitTestPanel = (
  point: ComicPoint,
  panel: ComicPanel,
  pageWidth: number,
  pageHeight: number,
): boolean => {
  if (!panel.points.length) return false;
  if (!panel.rotation) return pointInPolygon(point, panel.points);
  const bounds = getPanelBoundingBox(panel.points, 1, 1);
  const unrotated = rotatePointAround(point, { x: bounds.cx, y: bounds.cy }, -panel.rotation, pageWidth / pageHeight);
  return pointInPolygon(unrotated, panel.points);
};

export interface SnapResult {
  point: ComicPoint;
  guideX?: number;
  guideY?: number;
}

/** 网格、页边距与兄弟分镜边缘吸附。 */
export const snapComicPoint = (
  point: ComicPoint,
  siblingPanels: ComicPanel[],
  enabled: boolean,
  threshold = 0.015,
): SnapResult => {
  const clamped = {
    x: Math.min(0.99, Math.max(0.01, point.x)),
    y: Math.min(0.99, Math.max(0.01, point.y)),
  };
  if (!enabled) return { point: clamped };

  const xTargets = new Set<number>([0.04, 0.5, 0.96]);
  const yTargets = new Set<number>([0.04, 0.5, 0.96]);
  for (const panel of siblingPanels) {
    for (const vertex of panel.points) {
      xTargets.add(vertex.x);
      yTargets.add(vertex.y);
    }
  }

  let bestX = clamped.x;
  let guideX: number | undefined;
  let minDx = threshold;
  for (const target of xTargets) {
    const dx = Math.abs(clamped.x - target);
    if (dx < minDx) {
      minDx = dx;
      bestX = target;
      guideX = target;
    }
  }

  let bestY = clamped.y;
  let guideY: number | undefined;
  let minDy = threshold;
  for (const target of yTargets) {
    const dy = Math.abs(clamped.y - target);
    if (dy < minDy) {
      minDy = dy;
      bestY = target;
      guideY = target;
    }
  }

  // 若未吸附到参考线，轻微吸附到 2% 细网格
  if (guideX === undefined) {
    const gridX = Math.round(clamped.x * 50) / 50;
    if (Math.abs(clamped.x - gridX) < 0.006) bestX = gridX;
  }
  if (guideY === undefined) {
    const gridY = Math.round(clamped.y * 50) / 50;
    if (Math.abs(clamped.y - gridY) < 0.006) bestY = gridY;
  }

  return { point: { x: bestX, y: bestY }, guideX, guideY };
};

export const clampAnchorCoord = (value: number): number =>
  Math.round(Math.min(0.98, Math.max(0.02, Number.isFinite(value) ? value : 0.5)) * 1000) / 1000;
