import type { PreparedImageEdit } from '../imageEdit';
import { buildComicBubbleRenderModel, drawComicBubbleOnCanvas, type ComicBubbleRenderModel } from './comicArtwork';
import { getPanelBoundingBox, pointInPolygon, rectToPolygon } from './comicGeometry';
import { resolveEffectiveLayerProps, syncComicLayerStack } from './comicLayers';
import type { ComicAiCompiledZone, ComicAiZoneRect } from './comicAiPageEngine';
import type {
  ComicAiGuidePanel,
  ComicAiGutterStyle,
  ComicAiLayoutLockMode,
  ComicAnchor,
  ComicBreakoutZone,
  ComicBubbleShape,
  ComicPageDraft,
  ComicPoint,
  ComicStroke,
} from './comicTypes';

export const LAYOUT_LOCK_COLORS = {
  gutterWhite: '#ffffff',
  gutterFlashback: '#08080a',
  panelFillWhite: '#b6b9c0',
  panelFillFlashback: '#6d7380',
  borderColorWhite: '#0a0a0a',
  borderColorFlashback: '#ffffff',
  insetOuterBorderColor: '#ffffff',
  insetInnerBorderColor: '#0a0a0a',
  breakoutBorderColor: '#ffffff',
  breakoutFillWhite: '#dec6b4',
  breakoutFillMono: '#8e96a6',
  breakoutFillFlashback: '#9ca4b3',
  speedlineColor: '#5c606b',
  sfxFillColor: '#3f4450',
  sfxStrokeColor: '#ffffff',
} as const;

/** 相邻分镜分区渐变色板：打破潜空间同色平灰粘连，同时跳过纯白(>246)与纯黑(<24)。 */
export const LAYOUT_LOCK_PANEL_GRADIENTS = {
  color: [
    ['#7a9ec2', '#d7e5f2'],
    ['#e3a69d', '#f7dfd9'],
    ['#bfa57e', '#efe0c8'],
    ['#7f8ea8', '#c6d0de'],
    ['#80ad9a', '#d0e6dc'],
    ['#9b87a8', '#ddd2e6'],
  ] as ReadonlyArray<readonly [string, string]>,
  monochrome: [
    ['#4a5161', '#788091'],
    ['#d5dbe6', '#f0f3f7'],
    ['#687182', '#9ca5b6'],
    ['#c8d0de', '#eaeef5'],
  ] as ReadonlyArray<readonly [string, string]>,
  flashback: [
    ['#4b5160', '#70788a'],
    ['#7d8596', '#a8b0c0'],
    ['#5a6273', '#848ca0'],
    ['#6c7486', '#98a0b2'],
  ] as ReadonlyArray<readonly [string, string]>,
  insetColor: ['#f0c9ad', '#faebd7'] as readonly [string, string],
  insetMono: ['#dde2eb', '#f3f5f9'] as readonly [string, string],
  insetFlashback: ['#98a1b2', '#cfd6e3'] as readonly [string, string],
} as const;

export const LAYOUT_LOCK_DEFAULTS = {
  strengthColor: 0.85,
  strengthMonochrome: 0.82,
  strengthDiagonal: 0.80,
  strengthBreakout: 0.86,
  noiseColor: 0.05,
  noiseMonochrome: 0.04,
  borderWidthColor: 6,
  borderWidthMonochrome: 7,
  borderWidthFlashback: 5,
  insetOuterBorderWidth: 16,
  insetInnerBorderWidth: 5,
  breakoutBorderWidth: 12,
  minLockGutterPx: 24,
  speedlineAlpha: 0.55,
  grainAmplitude: 13,
  grainSkipWhiteAbove: 246,
  grainSkipBlackBelow: 24,
  bubbleSafeInsetRatio: 0.03,
} as const;

export interface ResolvedLayoutLockConfig {
  mode: ComicAiLayoutLockMode;
  enabled: boolean;
  autoTrimFrames: boolean;
  strength: number;
  noise: number;
  colorCorrect: false;
  addOriginalImage: boolean;
  gutterStyle: ComicAiGutterStyle;
}

/** 判定引导格是否包含三角形或大角度斜切边界（>18°），用于自动收紧锁框重绘强度。 */
export const hasSteepDiagonalPanels = (panels: ComicAiGuidePanel[]): boolean => {
  for (const panel of panels) {
    if (panel.inset) continue;
    const poly = getGuidePanelPolygon(panel);
    if (poly.length === 3) return true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const len = Math.hypot(dx, dy);
      if (len >= 0.12 && Math.min(dx, dy) / Math.max(dx, dy) > 0.32) {
        return true;
      }
    }
  }
  return false;
};

/** 判定引导格是否包含任意可察觉的斜边（>2.3°），供提示词引擎避开相互冲突的横平竖直网格词。 */
export const hasAnySlantedEdge = (panels: ComicAiGuidePanel[]): boolean => {
  for (const panel of panels) {
    const poly = getGuidePanelPolygon(panel);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const len = Math.hypot(dx, dy);
      if (len >= 0.08 && Math.min(dx, dy) / Math.max(dx, dy) > 0.04) {
        return true;
      }
    }
  }
  return false;
};

/**
 * 统一面板匹配优先级：画中画叠框（inset）优先，其次按外接面积从小到大，
 * 避免叠框里的角色/气泡锚点误匹配到底层整页背景格。
 */
export const sortGuidePanelsByPriority = (panels: ComicAiGuidePanel[]): ComicAiGuidePanel[] =>
  [...panels].sort((a, b) => {
    const insetDiff = Number(Boolean(b.inset)) - Number(Boolean(a.inset));
    if (insetDiff !== 0) return insetDiff;
    return (a.width * a.height) - (b.width * b.height);
  });

/**
 * 解析当前页面锁框参数（旧草稿 `'img2img'` 自动平滑迁入 `'infill'`）：
 * - `'infill'`（默认精准锁框，Variant C+）：单格全页 `0.95 / noise 0.02` 防水平腰斩，多格 `1.00 / noise 0`，关闭服务端原图回贴；
 * - `'txt2img'`（自由构图）：禁用锁框底图与掩码，交由纯文生图自由分镜构图。
 */
export const resolveLayoutLockConfig = (page: ComicPageDraft): ResolvedLayoutLockConfig => {
  const aiPage = page.aiPage;
  const mode: ComicAiLayoutLockMode = aiPage.layoutLockMode === 'txt2img' ? 'txt2img' : 'infill';
  const enabled = mode !== 'txt2img' && aiPage.guidePanels.length > 0;
  const autoTrimFrames = aiPage.autoTrimFrames !== false;
  const gutterStyle: ComicAiGutterStyle = aiPage.gutterStyle === 'black-flashback' ? 'black-flashback' : 'white';

  const regularCount = aiPage.guidePanels.filter(g => !g.inset).length;
  const hasInset = aiPage.guidePanels.some(g => Boolean(g.inset));
  const isSingleSplash = regularCount === 1 && !hasInset && (aiPage.breakoutZones?.length ?? 0) === 0;
  return {
    mode,
    enabled,
    autoTrimFrames,
    strength: isSingleSplash ? 0.95 : 1.0,
    noise: isSingleSplash ? 0.02 : 0,
    colorCorrect: false,
    addOriginalImage: false,
    gutterStyle,
  };
};

/** 返回引导格在整页归一化坐标 (0..1) 下的多边形顶点（向后兼容旧矩形，出血格紧贴画布边）。 */
export const getGuidePanelPolygon = (panel: ComicAiGuidePanel): ComicPoint[] => {
  const raw = panel.points && panel.points.length >= 3
    ? panel.points
    : rectToPolygon(panel.x, panel.y, panel.width, panel.height);
  if (!panel.bleed) return raw.map(pt => ({ x: pt.x, y: pt.y }));
  // 出血格：贴近画纸外缘的顶点直接外延至 0 / 1，不留外白边
  return raw.map(pt => ({
    x: pt.x <= 0.065 ? 0 : pt.x >= 0.935 ? 1 : pt.x,
    y: pt.y <= 0.065 ? 0 : pt.y >= 0.935 ? 1 : pt.y,
  }));
};

export const mapPagePointToZonePixels = (
  pt: ComicPoint,
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
): { x: number; y: number } => ({
  x: ((pt.x - zoneRect.x) / Math.max(0.05, zoneRect.width)) * width,
  y: ((pt.y - zoneRect.y) / Math.max(0.05, zoneRect.height)) * height,
});

export interface SafeBubbleHoleSpec {
  /** 整页归一化坐标下的安全避让椭圆（已向所属格内部内缩 ≥ 3%）。 */
  normCx: number;
  normCy: number;
  normRx: number;
  normRy: number;
  /** 投影到目标分区像素坐标后的椭圆参数。 */
  px: number;
  py: number;
  rx: number;
  ry: number;
}

/**
 * 为气泡锚点计算安全纯白避让椭圆：
 * 硬约束：椭圆外沿必须向所属分镜格内部安全内缩至少 3%，绝不贴死或跨过黑边框。
 */
export const computeSafeBubbleHoleEllipse = (
  anchor: ComicAnchor,
  guidePanels: ComicAiGuidePanel[],
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
): SafeBubbleHoleSpec | null => {
  if (anchor.kind !== 'bubble' || !anchor.enabled) return null;
  if (
    anchor.x < zoneRect.x - 0.02
    || anchor.x > zoneRect.x + zoneRect.width + 0.02
    || anchor.y < zoneRect.y - 0.02
    || anchor.y > zoneRect.y + zoneRect.height + 0.02
  ) {
    return null;
  }

  // 查找所属分镜格（画中画叠框与小格优先，多边形精确命中后按包围盒兜底）
  const orderedPanels = sortGuidePanelsByPriority(guidePanels);
  let host: ComicAiGuidePanel | undefined;
  for (const panel of orderedPanels) {
    const poly = getGuidePanelPolygon(panel);
    if (pointInPolygon({ x: anchor.x, y: anchor.y }, poly)) {
      host = panel;
      break;
    }
  }
  if (!host) {
    host = orderedPanels.find(p =>
      anchor.x >= p.x - 0.01 && anchor.x <= p.x + p.width + 0.01
      && anchor.y >= p.y - 0.01 && anchor.y <= p.y + p.height + 0.01,
    );
  }
  if (!host) return null;

  const poly = getGuidePanelPolygon(host);
  const b = getPanelBoundingBox(poly, 1, 1);
  // 内缩至少 3%（按页面与格宽较大保护量，保证与黑框清晰隔离）
  const padX = Math.max(LAYOUT_LOCK_DEFAULTS.bubbleSafeInsetRatio, b.width * 0.05);
  const padY = Math.max(LAYOUT_LOCK_DEFAULTS.bubbleSafeInsetRatio, b.height * 0.05);
  const safeMinX = b.minX + padX;
  const safeMaxX = b.maxX - padX;
  const safeMinY = b.minY + padY;
  const safeMaxY = b.maxY - padY;
  const availW = safeMaxX - safeMinX;
  const availH = safeMaxY - safeMinY;
  if (availW <= 0.04 || availH <= 0.03) return null;

  const desiredRx = Math.min((anchor.bubbleWidth ?? 0.22) * 0.44, availW * 0.46);
  const desiredRy = Math.min((anchor.bubbleHeight ?? 0.13) * 0.44, availH * 0.46);
  const normRx = Math.max(0.02, desiredRx);
  const normRy = Math.max(0.018, desiredRy);

  const normCx = Math.max(safeMinX + normRx, Math.min(safeMaxX - normRx, anchor.x));
  const normCy = Math.max(safeMinY + normRy, Math.min(safeMaxY - normRy, anchor.y));

  const centerPx = mapPagePointToZonePixels({ x: normCx, y: normCy }, zoneRect, width, height);
  const rx = (normRx / Math.max(0.05, zoneRect.width)) * width;
  const ry = (normRy / Math.max(0.05, zoneRect.height)) * height;
  if (rx < 6 || ry < 6) return null;

  return { normCx, normCy, normRx, normRy, px: centerPx.x, py: centerPx.y, rx, ry };
};

/**
 * 确定性选择性像素颗粒（固定种子 Mulberry32）：
 * 仅对非纯白（<=246）且非纯黑（>=24）的像素叠加 ±amplitude 亮度颗粒，
 * 保证纯白格缝与纯黑边框绝对锐利，同模板可复现。
 */
export const applyDeterministicSelectiveGrain = (
  data: Uint8ClampedArray,
  seed = 1337,
  amplitude: number = LAYOUT_LOCK_DEFAULTS.grainAmplitude,
): void => {
  let state = (seed >>> 0) || 1337;
  const nextRand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const skipWhite = LAYOUT_LOCK_DEFAULTS.grainSkipWhiteAbove;
  const skipBlack = LAYOUT_LOCK_DEFAULTS.grainSkipBlackBelow;
  const span = amplitude * 2 + 1;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > skipWhite && g > skipWhite && b > skipWhite) continue;
    if (r < skipBlack && g < skipBlack && b < skipBlack) continue;
    const delta = Math.floor(nextRand() * span) - amplitude;
    data[i] = Math.max(0, Math.min(255, r + delta));
    data[i + 1] = Math.max(0, Math.min(255, g + delta));
    data[i + 2] = Math.max(0, Math.min(255, b + delta));
  }
};

const tracePolygon = (ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>) => {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
};

const drawSpeedlinesInPanel = (
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.hypot(maxX - minX, maxY - minY) * 0.72;
  const innerR = Math.min(maxX - minX, maxY - minY) * 0.24;

  ctx.save();
  ctx.strokeStyle = LAYOUT_LOCK_COLORS.speedlineColor;
  ctx.globalAlpha = LAYOUT_LOCK_DEFAULTS.speedlineAlpha;
  ctx.lineCap = 'round';
  const rayCount = 44;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const startR = innerR * (0.85 + ((i * 7) % 5) * 0.08);
    ctx.lineWidth = i % 3 === 0 ? 2.4 : 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * startR, cy + Math.sin(angle) * startR);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.restore();
};

const drawSketchStrokesInZone = (
  ctx: CanvasRenderingContext2D,
  strokes: ComicStroke[],
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
  pageWidth: number,
) => {
  const scaleFactor = width / Math.max(1, pageWidth * zoneRect.width);
  for (const stroke of strokes) {
    if (!stroke.points.length || stroke.tool === 'eraser') continue;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = Math.max(0.15, Math.min(0.85, stroke.opacity * 0.72));
    ctx.lineWidth = Math.max(2, stroke.size * scaleFactor);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    stroke.points.forEach((pt, idx) => {
      const mapped = mapPagePointToZonePixels(pt, zoneRect, width, height);
      if (idx === 0) ctx.moveTo(mapped.x, mapped.y);
      else ctx.lineTo(mapped.x, mapped.y);
    });
    ctx.stroke();
    ctx.restore();
  }
};

const signedPolygonArea = (pts: Array<{ x: number; y: number }>): number => {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 / 2;
};

/**
 * 仅向内收缩非页面外缘的内部切缝边界，将细窄分镜缝扩宽至 ≥24px 安全净宽，
 * 避免潜空间 8× 下采样吞掉细白缝或斜切分界线。
 */
export const insetLockPolygonForWideGutter = (
  pts: Array<{ x: number; y: number }>,
  extraInsetPerSide: number,
  width: number,
  height: number,
  isBleed = false,
): Array<{ x: number; y: number }> => {
  if (extraInsetPerSide <= 0.25 || pts.length < 3) return pts;
  const origArea = signedPolygonArea(pts);
  if (Math.abs(origArea) < 1) return pts;
  const inwardSign = origArea >= 0 ? 1 : -1;

  const marginX = width * 0.055;
  const marginY = height * 0.055;
  const touchesCanvasEdge = (p: { x: number; y: number }) =>
    p.x <= 2 || p.x >= width - 2 || p.y <= 2 || p.y >= height - 2;

  const isOuterEdge = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    if (isBleed && (touchesCanvasEdge(a) || touchesCanvasEdge(b))) return true;
    return (
      (a.x <= marginX && b.x <= marginX)
      || (a.x >= width - marginX && b.x >= width - marginX)
      || (a.y <= marginY && b.y <= marginY)
      || (a.y >= height - marginY && b.y >= height - marginY)
    );
  };

  interface ShiftedEdgeLine {
    nx: number;
    ny: number;
    c: number;
    inset: number;
  }

  const lines: ShiftedEdgeLine[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty);
    if (len < 1e-4) return pts;
    const nx = inwardSign * (-ty / len);
    const ny = inwardSign * (tx / len);
    const inset = isOuterEdge(a, b) ? 0 : extraInsetPerSide;
    lines.push({
      nx,
      ny,
      c: nx * a.x + ny * a.y + inset,
      inset,
    });
  }

  const maxMiterOffset = extraInsetPerSide * 3.2;
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = lines[(i - 1 + pts.length) % pts.length];
    const curr = lines[i];
    const orig = pts[i];
    const det = prev.nx * curr.ny - prev.ny * curr.nx;
    if (Math.abs(det) < 1e-4) {
      result.push({
        x: orig.x + ((prev.nx * prev.inset + curr.nx * curr.inset) / 2),
        y: orig.y + ((prev.ny * prev.inset + curr.ny * curr.inset) / 2),
      });
      continue;
    }
    const ix = (prev.c * curr.ny - prev.ny * curr.c) / det;
    const iy = (prev.nx * curr.c - prev.c * curr.nx) / det;
    if (!Number.isFinite(ix) || !Number.isFinite(iy)) return pts;
    const dx = ix - orig.x;
    const dy = iy - orig.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxMiterOffset && maxMiterOffset > 0) {
      const ratio = maxMiterOffset / dist;
      result.push({ x: orig.x + dx * ratio, y: orig.y + dy * ratio });
    } else {
      result.push({ x: ix, y: iy });
    }
  }

  const newArea = signedPolygonArea(result);
  if (newArea * origArea <= 0 || Math.abs(newArea) < Math.abs(origArea) * 0.35) {
    return pts;
  }
  return result;
};

const pickPanelGradientPair = (
  panelIndex: number,
  isInset: boolean,
  isFlashback: boolean,
  isMono: boolean,
): readonly [string, string] => {
  if (isInset) {
    return isFlashback
      ? LAYOUT_LOCK_PANEL_GRADIENTS.insetFlashback
      : isMono
        ? LAYOUT_LOCK_PANEL_GRADIENTS.insetMono
        : LAYOUT_LOCK_PANEL_GRADIENTS.insetColor;
  }
  const palette = isFlashback
    ? LAYOUT_LOCK_PANEL_GRADIENTS.flashback
    : isMono
      ? LAYOUT_LOCK_PANEL_GRADIENTS.monochrome
      : LAYOUT_LOCK_PANEL_GRADIENTS.color;
  return palette[panelIndex % palette.length];
};

const resolveLockPanelFillStyle = (
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  explicitFillColor: string | undefined,
  panelIndex: number,
  isInset: boolean,
  isFlashback: boolean,
  isMono: boolean,
): string | CanvasGradient => {
  if (explicitFillColor?.trim()) return explicitFillColor.trim();
  const [startHex, endHex] = pickPanelGradientPair(panelIndex, isInset, isFlashback, isMono);
  if (typeof ctx.createLinearGradient !== 'function' || pts.length < 3) return startHex;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (Math.hypot(maxX - minX, maxY - minY) < 4) return startHex;
  const gradient = ctx.createLinearGradient(minX, minY, maxX, maxY);
  gradient.addColorStop(0, startHex);
  gradient.addColorStop(1, endHex);
  return gradient;
};

const drawRoundedRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const drawBreakoutZone = (
  ctx: CanvasRenderingContext2D,
  bz: ComicBreakoutZone,
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
  defaultFill: string,
) => {
  const topLeft = mapPagePointToZonePixels({ x: bz.x, y: bz.y }, zoneRect, width, height);
  const bottomRight = mapPagePointToZonePixels({ x: bz.x + bz.width, y: bz.y + bz.height }, zoneRect, width, height);
  const x = topLeft.x;
  const y = topLeft.y;
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;
  if (w < 8 || h < 8 || x + w < 0 || y + h < 0 || x > width || y > height) return false;

  ctx.save();
  drawRoundedRectPath(ctx, x, y, w, h, Math.min(28, Math.min(w, h) * 0.16));
  ctx.lineJoin = 'round';
  ctx.lineWidth = LAYOUT_LOCK_DEFAULTS.breakoutBorderWidth * 2;
  ctx.strokeStyle = LAYOUT_LOCK_COLORS.breakoutBorderColor;
  ctx.stroke();
  ctx.fillStyle = bz.tintColor?.trim() || defaultFill;
  ctx.fill();
  ctx.restore();
  return true;
};

export interface RenderedComicLayoutTemplate {
  dataUrl: string;
  width: number;
  height: number;
  panelCount: number;
  insetCount: number;
  breakoutCount: number;
  bubbleHoleCount: number;
}

/**
 * 渲染 V5 图生图（img2img）硬锁分镜底图（精确匹配当前分区免费分辨率）：
 * 1. 纸张格缝底色（纯白 #ffffff / 黑底回忆杀 #08080a）
 * 2. 常规分镜格（含出血格、自定义氛围底色、粗黑框或回忆杀白框）
 * 3. 格内可选增强层（放射速度线 / 手绘层粗色块引导，严格裁剪在分镜多边形内）
 * 4. 画中画叠框（16px 白外边 + 5px 黑内框）
 * 5. 可选气泡纯白避让椭圆（严格内缩 ≥ 3% 远离黑框）
 * 6. 破格前景块（最顶层，高反差默认底色 + 12px 圆角白外边）
 * 7. 可选 SFX 手绘底字轻压
 * 8. 确定性选择性像素颗粒（严格跳过纯白 >246 与纯黑 <24，保证格缝与黑框锐利）
 */
const collectVisibleSketchStrokes = (page: ComicPageDraft): ComicStroke[] => {
  const sketchStrokes: ComicStroke[] = [];
  if (!page.aiPage.projectSketchLayer) return sketchStrokes;
  const synced = syncComicLayerStack(page);
  const stack = synced.layerStack || [];
  const drawingMap = new Map((synced.drawingLayers || []).map(d => [d.id, d]));
  for (const node of stack) {
    if (node.kind !== 'drawing' || !node.refId) continue;
    const eff = resolveEffectiveLayerProps(node, stack);
    if (!eff.visible || eff.opacity <= 0) continue;
    const dl = drawingMap.get(node.refId);
    if (dl?.strokes.length) sketchStrokes.push(...dl.strokes);
  }
  if (!sketchStrokes.length && page.strokes.length) {
    sketchStrokes.push(...page.strokes);
  }
  return sketchStrokes;
};

const drawSfxTextInZone = (
  ctx: CanvasRenderingContext2D,
  page: ComicPageDraft,
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
): void => {
  if (!page.aiPage.projectSfxText || page.texts.length === 0) return;
  const scaleFactor = width / Math.max(1, page.width * zoneRect.width);
  for (const item of page.texts) {
    if (!item.text.trim()) continue;
    const pos = mapPagePointToZonePixels({ x: item.x, y: item.y }, zoneRect, width, height);
    if (pos.x < -40 || pos.x > width + 40 || pos.y < -40 || pos.y > height + 40) continue;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.globalAlpha = 0.78;
    const fontSize = Math.max(14, Math.round(item.fontSize * scaleFactor));
    ctx.font = `${item.bold ? '900' : '700'} ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.16));
    ctx.strokeStyle = LAYOUT_LOCK_COLORS.sfxStrokeColor;
    ctx.strokeText(item.text, 0, 0);
    ctx.fillStyle = LAYOUT_LOCK_COLORS.sfxFillColor;
    ctx.fillText(item.text, 0, 0);
    ctx.restore();
  }
};

export const renderComicZoneLayoutTemplate = (
  page: ComicPageDraft,
  zone: ComicAiCompiledZone,
  options?: { seed?: number; canvas?: HTMLCanvasElement },
): RenderedComicLayoutTemplate => {
  const width = Math.max(64, Math.round(zone.resolution.width));
  const height = Math.max(64, Math.round(zone.resolution.height));
  const canvas = options?.canvas ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法初始化分镜底图画布');

  const aiPage = page.aiPage;
  const isFlashback = aiPage.gutterStyle === 'black-flashback';
  const isMono = page.colorMode === 'monochrome';
  const defaultBreakoutFill = isFlashback
    ? LAYOUT_LOCK_COLORS.breakoutFillFlashback
    : isMono
      ? LAYOUT_LOCK_COLORS.breakoutFillMono
      : LAYOUT_LOCK_COLORS.breakoutFillWhite;
  const panelBorderColor = isFlashback ? LAYOUT_LOCK_COLORS.borderColorFlashback : LAYOUT_LOCK_COLORS.borderColorWhite;
  const panelBorderWidth = isFlashback
    ? LAYOUT_LOCK_DEFAULTS.borderWidthFlashback
    : isMono
      ? LAYOUT_LOCK_DEFAULTS.borderWidthMonochrome
      : LAYOUT_LOCK_DEFAULTS.borderWidthColor;
  const zoneScale = Math.min(
    width / Math.max(1, page.width * zone.rect.width),
    height / Math.max(1, page.height * zone.rect.height),
  );
  const extraInsetPerSide = Math.max(0, (LAYOUT_LOCK_DEFAULTS.minLockGutterPx - (page.gutterPx || 14)) / 2) * zoneScale;

  const sketchStrokes = collectVisibleSketchStrokes(page);

  // 1. 纸张格缝底色
  ctx.fillStyle = isFlashback ? LAYOUT_LOCK_COLORS.gutterFlashback : LAYOUT_LOCK_COLORS.gutterWhite;
  ctx.fillRect(0, 0, width, height);

  // 取全部引导格（含跨边界或局部落入当前区的格），分常规格与画中画叠框
  const allGuides = aiPage.guidePanels;
  const regularGuides = allGuides.filter(g => !g.inset);
  const insetGuides = allGuides.filter(g => g.inset);
  const shouldWidenInternalGutters = regularGuides.length > 1 && extraInsetPerSide > 0.25;

  const renderPanel = (gp: ComicAiGuidePanel, isInset: boolean, colorIdx: number): boolean => {
    const poly = getGuidePanelPolygon(gp);
    const rawPxPts = poly.map(pt => mapPagePointToZonePixels(pt, zone.rect, width, height));
    const xs = rawPxPts.map(p => p.x);
    const ys = rawPxPts.map(p => p.y);
    if (Math.max(...xs) < -2 || Math.min(...xs) > width + 2 || Math.max(...ys) < -2 || Math.min(...ys) > height + 2) {
      return false;
    }

    const pxPts = !isInset && shouldWidenInternalGutters
      ? insetLockPolygonForWideGutter(rawPxPts, extraInsetPerSide, width, height, Boolean(gp.bleed))
      : rawPxPts;

    // 4a. 画中画叠框先描 16px 纯白外边
    if (isInset) {
      ctx.save();
      tracePolygon(ctx, pxPts);
      ctx.lineJoin = 'miter';
      ctx.lineWidth = LAYOUT_LOCK_DEFAULTS.insetOuterBorderWidth * 2;
      ctx.strokeStyle = LAYOUT_LOCK_COLORS.insetOuterBorderColor;
      ctx.stroke();
      ctx.restore();
    }

    // 2. 格内填充分区渐变色阶（相邻格冷暖/明暗拉开反差）或自定义氛围底色
    ctx.save();
    tracePolygon(ctx, pxPts);
    ctx.fillStyle = resolveLockPanelFillStyle(ctx, pxPts, gp.fillColor, colorIdx, isInset, isFlashback, isMono);
    ctx.fill();

    // 3. 格内可选增强层（裁剪在对应分镜多边形内）
    if (gp.speedlines || sketchStrokes.length > 0) {
      ctx.save();
      tracePolygon(ctx, pxPts);
      ctx.clip();
      if (gp.speedlines) drawSpeedlinesInPanel(ctx, pxPts);
      if (sketchStrokes.length > 0) {
        drawSketchStrokesInZone(ctx, sketchStrokes, zone.rect, width, height, page.width);
      }
      ctx.restore();
    }

    // 边框描边（无框引导区不描黑边框，仅保留填充区与格缝）
    if (isInset || !gp.borderless) {
      tracePolygon(ctx, pxPts);
      ctx.lineJoin = 'miter';
      if (isInset) {
        ctx.lineWidth = LAYOUT_LOCK_DEFAULTS.insetInnerBorderWidth;
        ctx.strokeStyle = LAYOUT_LOCK_COLORS.insetInnerBorderColor;
      } else {
        ctx.lineWidth = panelBorderWidth;
        ctx.strokeStyle = panelBorderColor;
      }
      ctx.stroke();
    }
    ctx.restore();
    return true;
  };

  let panelCount = 0;
  for (let i = 0; i < regularGuides.length; i++) {
    if (renderPanel(regularGuides[i], false, i)) panelCount += 1;
  }

  let insetCount = 0;
  for (let i = 0; i < insetGuides.length; i++) {
    if (renderPanel(insetGuides[i], true, i)) insetCount += 1;
  }

  // 5. 气泡纯白无噪点避让椭圆（严格内缩 ≥ 3%，禁止贴死或跨过黑边框）
  let bubbleHoleCount = 0;
  if (aiPage.carveBubbleHoles) {
    for (const anchor of aiPage.anchors) {
      const hole = computeSafeBubbleHoleEllipse(anchor, allGuides, zone.rect, width, height);
      if (!hole) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(hole.px, hole.py, hole.rx, hole.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = LAYOUT_LOCK_COLORS.gutterWhite;
      ctx.fill();
      ctx.restore();
      bubbleHoleCount += 1;
    }
  }

  // 6. 破格前景块（叠在所有分镜边框最上层，高反差默认底色 + 12px 圆角白外边）
  let breakoutCount = 0;
  for (const bz of aiPage.breakoutZones || []) {
    if (drawBreakoutZone(ctx, bz, zone.rect, width, height, defaultBreakoutFill)) {
      breakoutCount += 1;
    }
  }

  // 7. 可选 SFX 手绘底字投影
  drawSfxTextInZone(ctx, page, zone.rect, width, height);

  // 8. 确定性选择性像素颗粒（严格跳过纯白 >246 与纯黑 <24）
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    if (imgData?.data?.length) {
      applyDeterministicSelectiveGrain(imgData.data, options?.seed ?? 1337, LAYOUT_LOCK_DEFAULTS.grainAmplitude);
      ctx.putImageData(imgData, 0, 0);
    }
  } catch {
    // 某些简化 mock canvas 未实现 getImageData 时优雅降级
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    panelCount,
    insetCount,
    breakoutCount,
    bubbleHoleCount,
  };
};

// ==================== V5 Infill Variant C+ 精准锁框引擎 ====================

export interface InfillMaskGeometryParams {
  guideOutPx: number;
  maskExpandPx: number;
  covThreshold: number;
  borderWidth: number;
}

/**
 * 按当前画布缩放后的实际格缝宽度，自适应选择安全的 Variant C+ 几何参数：
 * - 极窄格缝 (<20px，如工坊默认 14px 或 12px 少女漫细缝)：不向格缝外扩掩码、提高块覆盖门槛，确保相邻格在 1/8 空间绝不粘连；
 * - 宽格缝 (>=20px)：启用 +8px 护城河、+3px 斜边掩码外扩、0.28 块覆盖门槛与 8px 矢量切齐框线，消除斜切边缘白齿。
 */
export const resolveInfillMaskGeometryParams = (effectiveGutterPx: number): InfillMaskGeometryParams => {
  if (effectiveGutterPx < 20) {
    return {
      guideOutPx: Math.min(8, Math.max(5, Math.ceil(effectiveGutterPx / 2) + 1)),
      maskExpandPx: 0,
      covThreshold: 0.42,
      borderWidth: effectiveGutterPx <= 13 ? 4 : 6,
    };
  }
  return {
    guideOutPx: 8,
    maskExpandPx: 3,
    covThreshold: 0.28,
    borderWidth: 8,
  };
};

/**
 * 将任意高分辨率前景遮罩严格量化到 1/8 潜在空间网格并最近邻恢复原尺寸：
 * - 块内前景像素占比 >= covThreshold 置 255，否则置 0；
 * - 输出严格二值不透明 RGBA（0 或 255，灰阶像素数为 0），契合 V5 Infill 底层采样铁律。
 */
export const quantizeCoverageBlockMaskRgba = (
  interiorRgba: ArrayLike<number>,
  width: number,
  height: number,
  covThreshold = 0.3,
): { maskBinary: Uint8Array; maskRgba: Uint8ClampedArray } => {
  const mw = Math.max(8, Math.round(width / 8));
  const mh = Math.max(8, Math.round(height / 8));
  const blockMask = new Uint8Array(mw * mh);

  for (let by = 0; by < mh; by++) {
    const y0 = Math.floor((by * height) / mh);
    const y1 = Math.min(height, Math.floor(((by + 1) * height) / mh));
    for (let bx = 0; bx < mw; bx++) {
      const x0 = Math.floor((bx * width) / mw);
      const x1 = Math.min(width, Math.floor(((bx + 1) * width) / mw));
      let total = 0;
      let white = 0;
      for (let y = y0; y < y1; y++) {
        const rowOff = y * width;
        for (let x = x0; x < x1; x++) {
          const p = (rowOff + x) * 4;
          total += 1;
          if (interiorRgba[p] > 127 && interiorRgba[p + 3] > 127) white += 1;
        }
      }
      blockMask[by * mw + bx] = total > 0 && white / total >= covThreshold ? 1 : 0;
    }
  }

  const maskBinary = new Uint8Array(width * height);
  const maskRgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const by = Math.min(mh - 1, Math.floor((y * mh) / height));
    const bRow = by * mw;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const bx = Math.min(mw - 1, Math.floor((x * mw) / width));
      const bit = blockMask[bRow + bx];
      const i = rowOff + x;
      maskBinary[i] = bit;
      const v = bit ? 255 : 0;
      const p = i * 4;
      maskRgba[p] = v;
      maskRgba[p + 1] = v;
      maskRgba[p + 2] = v;
      maskRgba[p + 3] = 255;
    }
  }
  return { maskBinary, maskRgba };
};

/**
 * 逆向像素锁回贴 Alpha 蒙版：
 * - 所有 maskBinary===0 像素输出严格 alpha=0，由原图 100% 比特无损保留（消除多次重绘 VAE 漂移）；
 * - 仅在 maskBinary===1 内缘保持 featherPx 像素紧凑线性羽化，内部直接全量采用生成图。
 */
export const buildReversePixelLockMaskAlpha = (
  maskBinary: ArrayLike<number>,
  width: number,
  height: number,
  featherPx = 2,
): Uint8ClampedArray => {
  const alpha = new Uint8ClampedArray(width * height);
  const r = Math.max(0, Math.round(featherPx));

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowOff + x;
      if (maskBinary[i] === 0) {
        alpha[i] = 0;
        continue;
      }
      if (r === 0) {
        alpha[i] = 255;
        continue;
      }
      let minZeroDist = r + 1;
      const dyStart = Math.max(-r, -y);
      const dyEnd = Math.min(r, height - 1 - y);
      const dxStart = Math.max(-r, -x);
      const dxEnd = Math.min(r, width - 1 - x);
      for (let dy = dyStart; dy <= dyEnd; dy++) {
        const nRow = (y + dy) * width;
        const absDy = Math.abs(dy);
        for (let dx = dxStart; dx <= dxEnd; dx++) {
          if (maskBinary[nRow + x + dx] === 0) {
            const d = Math.max(Math.abs(dx), absDy);
            if (d < minZeroDist) minZeroDist = d;
          }
        }
      }
      alpha[i] = minZeroDist <= r ? Math.round((minZeroDist / (r + 1)) * 255) : 255;
    }
  }
  return alpha;
};

export interface HardLockedZoneBubbleSpec {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  model: ComicBubbleRenderModel;
}

/** 收集当前生成区或重绘裁剪区内需要硬锁纯白的气泡与旁白框几何。 */
export const collectHardLockedZoneBubbles = (
  page: ComicPageDraft,
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
): HardLockedZoneBubbleSpec[] => {
  if (page.aiPage.carveBubbleHoles === false || page.dialogueMode === 'ai-text') {
    return [];
  }
  const margin = 0.08;
  const inZone = (nx: number, ny: number) =>
    nx >= zoneRect.x - margin
    && nx <= zoneRect.x + zoneRect.width + margin
    && ny >= zoneRect.y - margin
    && ny <= zoneRect.y + zoneRect.height + margin;

  const specs: HardLockedZoneBubbleSpec[] = [];
  const anchorCenters: Array<{ x: number; y: number }> = [];

  for (const anchor of page.aiPage.anchors) {
    if (anchor.kind !== 'bubble' || !anchor.enabled) continue;
    if (!inZone(anchor.x, anchor.y)) continue;
    const center = mapPagePointToZonePixels({ x: anchor.x, y: anchor.y }, zoneRect, width, height);
    const rx = ((anchor.bubbleWidth ?? 0.22) / Math.max(0.05, zoneRect.width)) * width * 0.5;
    const ry = ((anchor.bubbleHeight ?? 0.13) / Math.max(0.05, zoneRect.height)) * height * 0.5;
    if (rx < 6 || ry < 6) continue;
    const shape = (anchor.bubbleShape || 'oval') as ComicBubbleShape;
    const tailPt = anchor.bubbleTailX !== undefined && anchor.bubbleTailY !== undefined
      ? mapPagePointToZonePixels({ x: anchor.bubbleTailX, y: anchor.bubbleTailY }, zoneRect, width, height)
      : null;
    const model = buildComicBubbleRenderModel(
      center.x,
      center.y,
      rx,
      ry,
      shape,
      `ai-lock-${anchor.id}`,
      tailPt ? { enabled: true, tx: tailPt.x, ty: tailPt.y } : undefined,
    );
    specs.push({ id: anchor.id, cx: center.x, cy: center.y, rx, ry, rotation: 0, model });
    anchorCenters.push({ x: anchor.x, y: anchor.y });
  }

  const synced = syncComicLayerStack(page);
  const stack = synced.layerStack || [];
  const bubbleMap = new Map(page.bubbles.map(b => [b.id, b]));
  for (const node of stack) {
    if (node.kind !== 'bubble' || !node.refId) continue;
    const eff = resolveEffectiveLayerProps(node, stack);
    if (!eff.visible || eff.opacity <= 0) continue;
    const bubble = bubbleMap.get(node.refId);
    if (!bubble || !inZone(bubble.x, bubble.y)) continue;
    if (!bubble.fillColor || bubble.fillColor === 'transparent') continue;
    if (anchorCenters.some(c => Math.hypot(c.x - bubble.x, c.y - bubble.y) < 0.025)) continue;

    const center = mapPagePointToZonePixels({ x: bubble.x, y: bubble.y }, zoneRect, width, height);
    const rx = (bubble.width / Math.max(0.05, zoneRect.width)) * width * 0.5;
    const ry = (bubble.height / Math.max(0.05, zoneRect.height)) * height * 0.5;
    if (rx < 6 || ry < 6) continue;

    let tailArg: { enabled: boolean; tx: number; ty: number } | undefined;
    if (bubble.hasTail) {
      const tailPx = mapPagePointToZonePixels({ x: bubble.tailX, y: bubble.tailY }, zoneRect, width, height);
      let tx = tailPx.x;
      let ty = tailPx.y;
      if (Math.abs(bubble.rotation) > 0.05) {
        const rad = (-bubble.rotation * Math.PI) / 180;
        const dx = tx - center.x;
        const dy = ty - center.y;
        tx = center.x + dx * Math.cos(rad) - dy * Math.sin(rad);
        ty = center.y + dx * Math.sin(rad) + dy * Math.cos(rad);
      }
      tailArg = { enabled: true, tx, ty };
    }
    const model = buildComicBubbleRenderModel(center.x, center.y, rx, ry, bubble.shape, bubble.id, tailArg);
    specs.push({ id: bubble.id, cx: center.x, cy: center.y, rx, ry, rotation: bubble.rotation || 0, model });
  }

  return specs;
};

/** 复用 FramePlanner2 渲染模型绘制硬锁气泡（底图黑边白底 / 掩码挖空 / 修边复原）。 */
export const drawHardLockedBubbleOnCanvas = (
  ctx: CanvasRenderingContext2D,
  spec: HardLockedZoneBubbleSpec,
  mode: 'base' | 'mask-cut' | 'trim-cut',
): void => {
  ctx.save();
  if (Math.abs(spec.rotation) > 0.05) {
    ctx.translate(spec.cx, spec.cy);
    ctx.rotate((spec.rotation * Math.PI) / 180);
    ctx.translate(-spec.cx, -spec.cy);
  }
  if (mode === 'trim-cut') {
    ctx.globalCompositeOperation = 'destination-out';
    drawComicBubbleOnCanvas(ctx, spec.model, {
      fillColor: '#ffffff',
      strokeColor: spec.model.strokeBody ? '#ffffff' : 'transparent',
      strokeWidth: spec.model.strokeBody ? 6 : 0,
      cx: spec.cx,
      cy: spec.cy,
      rx: spec.rx,
      ry: spec.ry,
    });
  } else if (mode === 'mask-cut') {
    drawComicBubbleOnCanvas(ctx, spec.model, {
      fillColor: '#000000',
      strokeColor: '#000000',
      strokeWidth: spec.model.strokeBody ? 4 : 0,
      cx: spec.cx,
      cy: spec.cy,
      rx: spec.rx,
      ry: spec.ry,
    });
  } else {
    drawComicBubbleOnCanvas(ctx, spec.model, {
      fillColor: '#ffffff',
      strokeColor: '#0a0a0a',
      strokeWidth: 6,
      cx: spec.cx,
      cy: spec.cy,
      rx: spec.rx,
      ry: spec.ry,
    });
  }
  ctx.restore();
};

const createScratchCanvas = (width: number, height: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
};

const canvasToPngBlobSafe = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (blob) return blob;
  }
  const res = await fetch(canvas.toDataURL('image/png'));
  return res.blob();
};

const traceBreakoutRect = (
  ctx: CanvasRenderingContext2D,
  bz: ComicBreakoutZone,
  zoneRect: ComicAiZoneRect,
  width: number,
  height: number,
): boolean => {
  const tl = mapPagePointToZonePixels({ x: bz.x, y: bz.y }, zoneRect, width, height);
  const br = mapPagePointToZonePixels({ x: bz.x + bz.width, y: bz.y + bz.height }, zoneRect, width, height);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  if (w < 8 || h < 8 || br.x < 0 || br.y < 0 || tl.x > width || tl.y > height) return false;
  drawRoundedRectPath(ctx, tl.x, tl.y, w, h, Math.min(28, Math.min(w, h) * 0.16));
  return true;
};

export interface RenderedComicInfillTemplate {
  baseDataUrl: string;
  maskDataUrl: string;
  preparedEdit: PreparedImageEdit;
  width: number;
  height: number;
  panelCount: number;
  insetCount: number;
  bubbleCount: number;
  maskParams: InfillMaskGeometryParams;
}

/**
 * 渲染 V5 Infill Variant C+ 精准锁框原料（底图 + 1/8 严格二值块掩码 + 零成本平滑矢量修边回贴）：
 * 1. 底图仅在格框外侧绘制平滑矢量黑护城河（杜绝 8×8 锯齿块内侵），悬浮画中画白光环外加 6px 深色稳边；
 * 2. 单大格自动铺微梯度渐变避免模型腰斩分格；破格前景区自动开闸门免阻挡；
 * 3. 硬锁空白气泡使用 FramePlanner2 黑边白底并在掩码精确挖空；
 * 4. 启用 autoTrimFrames 时构建无损耗矢量修边层（悬浮画中画永远叠在常规格框之上），出图后秒级切齐白缝。
 */
export const renderComicZoneInfillTemplate = async (
  page: ComicPageDraft,
  zone: ComicAiCompiledZone,
  options?: { seed?: number },
): Promise<RenderedComicInfillTemplate> => {
  const width = Math.max(64, Math.round(zone.resolution.width));
  const height = Math.max(64, Math.round(zone.resolution.height));
  const aiPage = page.aiPage;
  const isFlashback = aiPage.gutterStyle === 'black-flashback';
  const autoTrimFrames = aiPage.autoTrimFrames !== false;
  const gutterColor = isFlashback ? LAYOUT_LOCK_COLORS.gutterFlashback : '#ffffff';
  const zoneScale = Math.min(
    width / Math.max(1, page.width * zone.rect.width),
    height / Math.max(1, page.height * zone.rect.height),
  );
  const effectiveGutterPx = (page.gutterPx || 14) * zoneScale;
  const maskParams = resolveInfillMaskGeometryParams(effectiveGutterPx);

  const regularGuides = aiPage.guidePanels.filter(g => !g.inset);
  const insetGuides = aiPage.guidePanels.filter(g => g.inset);
  const isSingleSplash = regularGuides.length === 1 && insetGuides.length === 0 && (aiPage.breakoutZones?.length ?? 0) === 0;
  const breakouts = aiPage.breakoutZones || [];
  const bubbles = collectHardLockedZoneBubbles(page, zone.rect, width, height);
  const sketchStrokes = collectVisibleSketchStrokes(page);

  const inZonePoly = (gp: ComicAiGuidePanel) => {
    const pts = getGuidePanelPolygon(gp).map(pt => mapPagePointToZonePixels(pt, zone.rect, width, height));
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    if (Math.max(...xs) < -2 || Math.min(...xs) > width + 2 || Math.max(...ys) < -2 || Math.min(...ys) > height + 2) {
      return null;
    }
    return pts;
  };
  const regPolys = regularGuides.map(gp => ({ gp, pts: inZonePoly(gp) })).filter((x): x is { gp: ComicAiGuidePanel; pts: Array<{ x: number; y: number }> } => x.pts !== null);
  const insetPolys = insetGuides.map(gp => ({ gp, pts: inZonePoly(gp) })).filter((x): x is { gp: ComicAiGuidePanel; pts: Array<{ x: number; y: number }> } => x.pts !== null);
  const insetHaloPx = effectiveGutterPx >= 20 ? 20 : 16;

  // 1. 生成 Variant C+ 底图
  const baseCanvas = createScratchCanvas(width, height);
  const bCtx = baseCanvas.getContext('2d');
  if (!bCtx) throw new Error('无法初始化精准锁框底图画布');
  bCtx.fillStyle = gutterColor;
  bCtx.fillRect(0, 0, width, height);

  // 1a. 常规格填充（全页大单格启用淡竖向渐变 + 确定性颗粒防腰斩）
  for (const { gp, pts } of regPolys) {
    bCtx.save();
    tracePolygon(bCtx, pts);
    if (gp.fillColor?.trim()) {
      bCtx.fillStyle = gp.fillColor.trim();
    } else if (isSingleSplash) {
      const grad = bCtx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#e8ecf3');
      grad.addColorStop(1, '#f4e8dc');
      bCtx.fillStyle = grad;
    } else {
      bCtx.fillStyle = '#ffffff';
    }
    bCtx.fill();
    if (gp.speedlines || sketchStrokes.length > 0) {
      bCtx.save();
      tracePolygon(bCtx, pts);
      bCtx.clip();
      if (gp.speedlines) drawSpeedlinesInPanel(bCtx, pts);
      if (sketchStrokes.length > 0) drawSketchStrokesInZone(bCtx, sketchStrokes, zone.rect, width, height, page.width);
      bCtx.restore();
    }
    bCtx.restore();
  }

  if (isSingleSplash) {
    try {
      const imgData = bCtx.getImageData(0, 0, width, height);
      applyDeterministicSelectiveGrain(imgData.data, options?.seed ?? 4242, 10);
      bCtx.putImageData(imgData, 0, 0);
    } catch {
      // mock 环境跳过
    }
  }

  // 1b. 常规格平滑外扩矢量暗带（或黑底双外白框）
  const guideCanvas = createScratchCanvas(width, height);
  const gCtx = guideCanvas.getContext('2d');
  if (gCtx) {
    gCtx.lineJoin = 'miter';
    for (const { gp, pts } of regPolys) {
      if (gp.borderless && (isFlashback || !autoTrimFrames)) continue;
      gCtx.save();
      tracePolygon(gCtx, pts);
      if (isFlashback) {
        gCtx.strokeStyle = '#ffffff';
        gCtx.lineWidth = 18;
      } else {
        gCtx.strokeStyle = '#0a0a0a';
        gCtx.lineWidth = maskParams.guideOutPx * 2;
      }
      gCtx.stroke();
      gCtx.restore();
    }
    // 严格剔除常规格内部与破格区（仅保留外侧护城河 / 外白边）
    gCtx.globalCompositeOperation = 'destination-out';
    gCtx.fillStyle = '#000000';
    for (const { pts } of regPolys) {
      tracePolygon(gCtx, pts);
      gCtx.fill();
    }
    for (const bz of breakouts) {
      if (traceBreakoutRect(gCtx, bz, zone.rect, width, height)) gCtx.fill();
    }
    bCtx.drawImage(guideCanvas, 0, 0);
  }

  // 常规格 2px 平滑内接缝（破格区覆盖前绘制，无框区域跳过）
  for (const { gp, pts } of regPolys) {
    if (gp.borderless) continue;
    bCtx.save();
    tracePolygon(bCtx, pts);
    bCtx.lineJoin = 'miter';
    bCtx.strokeStyle = '#0a0a0a';
    bCtx.lineWidth = isFlashback ? 4 : 2;
    bCtx.stroke();
    bCtx.restore();
  }

  // 1c. 破格前景区开启白色通行闸门
  for (const bz of breakouts) {
    bCtx.save();
    if (traceBreakoutRect(bCtx, bz, zone.rect, width, height)) {
      bCtx.fillStyle = '#ffffff';
      bCtx.fill();
    }
    bCtx.restore();
  }

  // 1d. 悬浮画中画叠框（最外深色稳边 -> 白色隔离光环 -> 内侧护城河 -> 白底 + 2px内线）
  for (const { gp, pts } of insetPolys) {
    bCtx.save();
    bCtx.lineJoin = 'miter';
    tracePolygon(bCtx, pts);
    bCtx.strokeStyle = isFlashback ? '#ffffff' : '#0a0a0a';
    bCtx.lineWidth = isFlashback ? 18 : (insetHaloPx + 6) * 2;
    bCtx.stroke();

    if (!isFlashback) {
      tracePolygon(bCtx, pts);
      bCtx.strokeStyle = '#ffffff';
      bCtx.lineWidth = insetHaloPx * 2;
      bCtx.stroke();

      const inGuideCanvas = createScratchCanvas(width, height);
      const igCtx = inGuideCanvas.getContext('2d');
      if (igCtx) {
        tracePolygon(igCtx, pts);
        igCtx.lineJoin = 'miter';
        igCtx.strokeStyle = '#0a0a0a';
        igCtx.lineWidth = 14;
        igCtx.stroke();
        igCtx.globalCompositeOperation = 'destination-out';
        tracePolygon(igCtx, pts);
        igCtx.fill();
        bCtx.drawImage(inGuideCanvas, 0, 0);
      }
    }

    tracePolygon(bCtx, pts);
    bCtx.fillStyle = gp.fillColor?.trim() || '#ffffff';
    bCtx.fill();
    if (gp.speedlines || sketchStrokes.length > 0) {
      bCtx.save();
      tracePolygon(bCtx, pts);
      bCtx.clip();
      if (gp.speedlines) drawSpeedlinesInPanel(bCtx, pts);
      if (sketchStrokes.length > 0) drawSketchStrokesInZone(bCtx, sketchStrokes, zone.rect, width, height, page.width);
      bCtx.restore();
    }
    tracePolygon(bCtx, pts);
    bCtx.strokeStyle = '#0a0a0a';
    bCtx.lineWidth = isFlashback ? 4 : 2;
    bCtx.stroke();
    bCtx.restore();
  }

  // 1e. SFX 融画底字与顶层硬锁气泡
  drawSfxTextInZone(bCtx, page, zone.rect, width, height);
  for (const bub of bubbles) {
    drawHardLockedBubbleOnCanvas(bCtx, bub, 'base');
  }

  // 2. 构建高分辨率内部遮罩并量化至 1/8 严格二值块掩码
  const interiorCanvas = createScratchCanvas(width, height);
  const mCtx = interiorCanvas.getContext('2d');
  if (!mCtx) throw new Error('无法初始化精准锁框掩码画布');
  mCtx.fillStyle = '#000000';
  mCtx.fillRect(0, 0, width, height);
  mCtx.fillStyle = '#ffffff';
  mCtx.strokeStyle = '#ffffff';
  mCtx.lineJoin = 'miter';

  for (const { gp, pts } of regPolys) {
    tracePolygon(mCtx, pts);
    mCtx.fill();
    if (maskParams.maskExpandPx > 0 && !gp.borderless) {
      mCtx.lineWidth = maskParams.maskExpandPx * 2;
      mCtx.stroke();
    }
  }
  for (const bz of breakouts) {
    if (traceBreakoutRect(mCtx, bz, zone.rect, width, height)) mCtx.fill();
  }
  for (const { pts } of insetPolys) {
    mCtx.save();
    tracePolygon(mCtx, pts);
    mCtx.fillStyle = '#000000';
    mCtx.strokeStyle = '#000000';
    mCtx.lineWidth = isFlashback ? 18 : (insetHaloPx + 5) * 2;
    mCtx.fill();
    mCtx.stroke();
    mCtx.restore();

    tracePolygon(mCtx, pts);
    mCtx.fillStyle = '#ffffff';
    mCtx.fill();
    if (maskParams.maskExpandPx > 0) {
      mCtx.strokeStyle = '#ffffff';
      mCtx.lineWidth = maskParams.maskExpandPx * 2;
      mCtx.stroke();
    }
  }
  for (const bub of bubbles) {
    drawHardLockedBubbleOnCanvas(mCtx, bub, 'mask-cut');
  }

  const mImg = mCtx.getImageData(0, 0, width, height);
  const { maskRgba } = quantizeCoverageBlockMaskRgba(mImg.data, width, height, maskParams.covThreshold);
  const quantMaskCanvas = createScratchCanvas(width, height);
  const qCtx = quantMaskCanvas.getContext('2d');
  if (!qCtx) throw new Error('无法写入二值块掩码');
  const qImg = qCtx.createImageData(width, height);
  qImg.data.set(maskRgba);
  qCtx.putImageData(qImg, 0, 0);

  const baseDataUrl = baseCanvas.toDataURL('image/png');
  const maskDataUrl = quantMaskCanvas.toDataURL('image/png');

  // 3. 零成本平滑矢量修边层（严格把悬浮画中画叠在常规框线之上，并彻底绕开破格区与硬锁气泡）
  let preparedEdit: PreparedImageEdit;
  if (autoTrimFrames) {
    const trimOrigCanvas = createScratchCanvas(width, height);
    const toCtx = trimOrigCanvas.getContext('2d');
    const trimMaskCanvas = createScratchCanvas(width, height);
    const tmCtx = trimMaskCanvas.getContext('2d');
    if (!toCtx || !tmCtx) throw new Error('无法构建矢量修边合成层');

    // trimOriginalCanvas：纯净格缝底 + 锐利矢量边框 + 顶层悬浮框光环 + 顶层气泡
    toCtx.fillStyle = gutterColor;
    toCtx.fillRect(0, 0, width, height);
    const regTrimBorderW = isFlashback ? Math.max(4, maskParams.borderWidth - 2) : maskParams.borderWidth;
    if (isFlashback) {
      const fbRim = createScratchCanvas(width, height);
      const frCtx = fbRim.getContext('2d');
      if (frCtx) {
        frCtx.strokeStyle = '#ffffff';
        frCtx.lineWidth = 18;
        frCtx.lineJoin = 'miter';
        for (const { gp, pts } of regPolys) {
          if (gp.borderless) continue;
          tracePolygon(frCtx, pts);
          frCtx.stroke();
        }
        frCtx.globalCompositeOperation = 'destination-out';
        frCtx.fillStyle = '#000000';
        for (const { pts } of regPolys) {
          tracePolygon(frCtx, pts);
          frCtx.fill();
        }
        toCtx.drawImage(fbRim, 0, 0);
      }
    }
    for (const { gp, pts } of regPolys) {
      if (gp.borderless) continue;
      toCtx.save();
      tracePolygon(toCtx, pts);
      toCtx.lineJoin = 'miter';
      toCtx.strokeStyle = '#0a0a0a';
      toCtx.lineWidth = regTrimBorderW;
      toCtx.stroke();
      toCtx.restore();
    }
    // 悬浮画中画排在最顶层遮断底层格线
    for (const { pts } of insetPolys) {
      toCtx.save();
      toCtx.lineJoin = 'miter';
      tracePolygon(toCtx, pts);
      toCtx.fillStyle = gutterColor;
      toCtx.strokeStyle = gutterColor;
      toCtx.lineWidth = insetHaloPx * 2;
      toCtx.fill();
      toCtx.stroke();
      if (isFlashback) {
        tracePolygon(toCtx, pts);
        toCtx.strokeStyle = '#ffffff';
        toCtx.lineWidth = 18;
        toCtx.stroke();
      }
      tracePolygon(toCtx, pts);
      toCtx.strokeStyle = '#0a0a0a';
      toCtx.lineWidth = regTrimBorderW;
      toCtx.stroke();
      toCtx.restore();
    }
    for (const bub of bubbles) {
      drawHardLockedBubbleOnCanvas(toCtx, bub, 'base');
    }

    // trimCompositeMaskCanvas：alpha=255 保留 AI 画面，alpha=0 切回平滑格缝/框线/气泡
    tmCtx.clearRect(0, 0, width, height);
    tmCtx.fillStyle = '#ffffff';
    for (const { pts } of regPolys) {
      tracePolygon(tmCtx, pts);
      tmCtx.fill();
    }
    tmCtx.save();
    tmCtx.globalCompositeOperation = 'destination-out';
    tmCtx.strokeStyle = '#ffffff';
    tmCtx.lineJoin = 'miter';
    tmCtx.lineWidth = regTrimBorderW;
    for (const { gp, pts } of regPolys) {
      if (gp.borderless) continue;
      tracePolygon(tmCtx, pts);
      tmCtx.stroke();
    }
    tmCtx.restore();

    for (const { pts } of insetPolys) {
      tmCtx.save();
      tmCtx.globalCompositeOperation = 'destination-out';
      tmCtx.fillStyle = '#ffffff';
      tmCtx.strokeStyle = '#ffffff';
      tmCtx.lineJoin = 'miter';
      tmCtx.lineWidth = insetHaloPx * 2;
      tracePolygon(tmCtx, pts);
      tmCtx.fill();
      tmCtx.stroke();
      tmCtx.restore();

      tmCtx.save();
      tmCtx.fillStyle = '#ffffff';
      tracePolygon(tmCtx, pts);
      tmCtx.fill();
      tmCtx.globalCompositeOperation = 'destination-out';
      tmCtx.strokeStyle = '#ffffff';
      tmCtx.lineJoin = 'miter';
      tmCtx.lineWidth = regTrimBorderW;
      tracePolygon(tmCtx, pts);
      tmCtx.stroke();
      tmCtx.restore();
    }

    tmCtx.save();
    tmCtx.fillStyle = '#ffffff';
    for (const bz of breakouts) {
      if (traceBreakoutRect(tmCtx, bz, zone.rect, width, height)) tmCtx.fill();
    }
    tmCtx.restore();

    for (const bub of bubbles) {
      drawHardLockedBubbleOnCanvas(tmCtx, bub, 'trim-cut');
    }

    const [originalImage, compositeMask] = await Promise.all([
      canvasToPngBlobSafe(trimOrigCanvas),
      canvasToPngBlobSafe(trimMaskCanvas),
    ]);
    preparedEdit = {
      image: baseDataUrl,
      mask: maskDataUrl,
      originalImage,
      compositeMask,
      requestWidth: width,
      requestHeight: height,
      sourceWidth: width,
      sourceHeight: height,
    };
  } else {
    preparedEdit = {
      image: baseDataUrl,
      mask: maskDataUrl,
      originalImage: await canvasToPngBlobSafe(baseCanvas),
      requestWidth: width,
      requestHeight: height,
      sourceWidth: width,
      sourceHeight: height,
    };
  }

  return {
    baseDataUrl,
    maskDataUrl,
    preparedEdit,
    width,
    height,
    panelCount: regPolys.length,
    insetCount: insetPolys.length,
    bubbleCount: bubbles.length,
    maskParams,
  };
};
