import {
  GENERATION_MAX_DIMENSION,
  GENERATION_MIN_DIMENSION,
  OPUS_FREE_PIXEL_LIMIT,
  RESOLUTION_STEP,
} from '../aspectRatio';
import { createUuid } from '../id';
import {
  COMIC_LAYOUT_TEMPLATES,
  COMIC_LAYOUT_TEMPLATE_CATEGORIES,
  rectToPolygon,
  type ComicLayoutTemplate,
  type ComicLayoutTemplateCategory,
  type ComicLayoutTemplateCategoryMeta,
} from './comicLayoutTemplates';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicLayerState,
  ComicPageDraft,
  ComicPanel,
  ComicPaperPreset,
  ComicPoint,
} from './comicTypes';

export {
  COMIC_LAYOUT_TEMPLATES,
  COMIC_LAYOUT_TEMPLATE_CATEGORIES,
  rectToPolygon,
  type ComicLayoutTemplate,
  type ComicLayoutTemplateCategory,
  type ComicLayoutTemplateCategoryMeta,
};

export const COMIC_PANEL_SOFT_MAX = 24;

export const COMIC_PAPER_PRESETS: ComicPaperPreset[] = [
  { id: 'manga-portrait', label: '日漫竖页', description: '经典单页 2:3（832×1216）', width: 832, height: 1216 },
  { id: 'manga-spread', label: '跨页横版', description: '双页跨幅 3:2（1216×832）', width: 1216, height: 832 },
  { id: 'webtoon-strip', label: '竖条漫', description: '长条分镜（832×2048）', width: 832, height: 2048 },
  { id: 'square-page', label: '方形画幅', description: '四格/绘本 1:1（1024×1024）', width: 1024, height: 1024 },
];

export const createDefaultLayers = (): ComicLayerState => ({
  panels: { visible: true, locked: false, order: 0 },
  drawing: { visible: true, locked: false, order: 1 },
  bubbles: { visible: true, locked: false, order: 2 },
  stickers: { visible: true, locked: false, order: 3 },
});

export type ComicTemplateScope = 'full' | 'left' | 'right';

export const remapNormalizedPointsToScope = (
  points: ComicPoint[],
  scope: ComicTemplateScope = 'full',
  gutterX = 0.012,
): ComicPoint[] => {
  if (scope === 'full') return points.map(pt => ({ ...pt }));
  const halfSpan = Math.max(0.2, 0.5 - gutterX * 0.6);
  const startX = scope === 'left' ? 0 : 1 - halfSpan;
  return points.map(pt => ({
    x: Math.round((startX + pt.x * halfSpan) * 10000) / 10000,
    y: pt.y,
  }));
};

export const buildTemplatePanelsForScope = (
  templateId = 'classic-4-121',
  pageWidth = 832,
  pageHeight = 1216,
  gutterPx = 14,
  scope: ComicTemplateScope = 'full',
): ComicPanel[] => {
  const gx = gutterPx / Math.max(1, pageWidth);
  const gy = gutterPx / Math.max(1, pageHeight);
  const template = COMIC_LAYOUT_TEMPLATES.find(item => item.id === templateId) || COMIC_LAYOUT_TEMPLATES[0];
  const localGx = scope === 'full' ? gx : gx * 2;
  return template.buildPanels(localGx, gy).map(panel => ({
    ...panel,
    points: remapNormalizedPointsToScope(panel.points, scope, gx),
  }));
};

export const createGuidePanelsFromTemplate = (
  templateId = 'classic-4-121',
  pageWidth = 832,
  pageHeight = 1216,
  gutterPx = 14,
  scope: ComicTemplateScope = 'full',
): ComicAiGuidePanel[] => {
  return buildTemplatePanelsForScope(templateId, pageWidth, pageHeight, gutterPx, scope).map((panel, idx) => {
    const b = getPanelBoundingBox(panel.points, 1, 1);
    const roundedPoints = panel.points.map(pt => ({
      x: Math.round(pt.x * 1000) / 1000,
      y: Math.round(pt.y * 1000) / 1000,
    }));
    return {
      id: createUuid(),
      label: panel.name || `第 ${idx + 1} 格`,
      summary: '',
      x: Math.round(b.minX * 1000) / 1000,
      y: Math.round(b.minY * 1000) / 1000,
      width: Math.round(b.width * 1000) / 1000,
      height: Math.round(b.height * 1000) / 1000,
      points: roundedPoints,
      ...(panel.bleed ? { bleed: true } : {}),
      ...(panel.inset ? { inset: true } : {}),
      ...(panel.borderWidth === 0 ? { borderless: true } : {}),
    };
  });
};

export const createInitialAiPagePlan = (
  pageWidth = 832,
  pageHeight = 1216,
  gutterPx = 14,
): ComicAiPagePlan => ({
  storyPrompt: '',
  targetPanelCount: 4,
  castCharacterIds: [],
  splitMode: 'auto',
  layoutHint: '4-panel manga page, 1-2-1 layout, crisp white gutters',
  guidePanels: createGuidePanelsFromTemplate('classic-4-121', pageWidth, pageHeight, gutterPx),
  anchors: [],
  showGuideOverlay: true,
  layoutLockMode: 'infill',
  autoTrimFrames: true,
  gutterStyle: 'white',
  carveBubbleHoles: true,
  projectSketchLayer: false,
  projectSfxText: false,
  sceneAtmosphere: '',
  breakoutZones: [],
});

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
    dialogueMode: 'empty-bubble',
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
    aiPage: createInitialAiPagePlan(preset.width, preset.height, gutterPx),
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
  const minExtent = Math.min(pageWidth, pageHeight) <= 2 ? 1e-6 : 1;
  const width = Math.max(minExtent, maxX - minX);
  const height = Math.max(minExtent, maxY - minY);
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
 * 判断线段 (a -> b) 是否与多边形相交（任一端点在内部或线段与多边形任一边相交）。
 * 用于「两点一刀切分」只切分用户切线实际划过的画格，不误伤页面其他区域的无关分镜。
 */
const segmentsIntersect = (p1: ComicPoint, p2: ComicPoint, p3: ComicPoint, p4: ComicPoint): boolean => {
  const cross = (o: ComicPoint, a: ComicPoint, b: ComicPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSegment = (a: ComicPoint, b: ComicPoint, p: ComicPoint) =>
    Math.min(a.x, b.x) - 1e-6 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-6
    && Math.min(a.y, b.y) - 1e-6 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-6;
  if (Math.abs(d1) < 1e-7 && onSegment(p3, p4, p1)) return true;
  if (Math.abs(d2) < 1e-7 && onSegment(p3, p4, p2)) return true;
  if (Math.abs(d3) < 1e-7 && onSegment(p1, p2, p3)) return true;
  if (Math.abs(d4) < 1e-7 && onSegment(p1, p2, p4)) return true;
  return false;
};

export const doesSegmentIntersectPolygon = (
  start: ComicPoint,
  end: ComicPoint,
  polygon: ComicPoint[],
): boolean => {
  if (polygon.length < 3) return false;
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (segmentsIntersect(start, end, a, b)) return true;
  }
  return false;
};

/**
 * 两点一刀切分多边形：沿 lineStart -> lineEnd 将凸多边形切为两块，
 * 并在切缝法线方向各退让半个 gutter 形成自然漫画留白间距。
 * 仅当切线段实际划过该多边形时才执行切分。
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
  if (!doesSegmentIntersectPolygon(lineStart, lineEnd, polygon)) return null;

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
