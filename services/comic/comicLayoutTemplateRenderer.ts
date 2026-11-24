import { getPanelBoundingBox, pointInPolygon, rectToPolygon } from './comicGeometry';
import { resolveEffectiveLayerProps, syncComicLayerStack } from './comicLayers';
import type { ComicAiCompiledZone, ComicAiZoneRect } from './comicAiPageEngine';
import type {
  ComicAiGuidePanel,
  ComicAiGutterStyle,
  ComicAnchor,
  ComicBreakoutZone,
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
  enabled: boolean;
  strength: number;
  noise: number;
  colorCorrect: false;
  addOriginalImage: true;
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
 * 解析当前页面实测甜点参数：
 * - 含破格前景块：strength = 0.86
 * - 三角/大斜切分镜：strength = 0.80（压低重绘避免锐角斜线被拉平）
 * - 黑白网点漫：strength = 0.82, noise = 0.04
 * - 常规全彩模式：strength = 0.85, noise = 0.05
 */
export const resolveLayoutLockConfig = (page: ComicPageDraft): ResolvedLayoutLockConfig => {
  const aiPage = page.aiPage;
  const enabled = aiPage.layoutLockMode !== 'txt2img' && aiPage.guidePanels.length > 0;
  const hasBreakout = (aiPage.breakoutZones?.length ?? 0) > 0;
  const isMono = page.colorMode === 'monochrome';
  const defaultStrength = hasBreakout
    ? LAYOUT_LOCK_DEFAULTS.strengthBreakout
    : hasSteepDiagonalPanels(aiPage.guidePanels)
      ? LAYOUT_LOCK_DEFAULTS.strengthDiagonal
      : isMono
        ? LAYOUT_LOCK_DEFAULTS.strengthMonochrome
        : LAYOUT_LOCK_DEFAULTS.strengthColor;
  const rawStrength = aiPage.layoutLockStrength;
  const strength = typeof rawStrength === 'number' && Number.isFinite(rawStrength)
    ? Math.round(Math.min(0.94, Math.max(0.72, rawStrength)) * 100) / 100
    : defaultStrength;
  const noise = isMono ? LAYOUT_LOCK_DEFAULTS.noiseMonochrome : LAYOUT_LOCK_DEFAULTS.noiseColor;
  const gutterStyle: ComicAiGutterStyle = aiPage.gutterStyle === 'black-flashback' ? 'black-flashback' : 'white';
  return {
    enabled,
    strength,
    noise,
    colorCorrect: false,
    addOriginalImage: true,
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
  amplitude = LAYOUT_LOCK_DEFAULTS.grainAmplitude,
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

  // 收集可见手绘草图笔画（仅当开启「手绘草图引导」时）
  const sketchStrokes: ComicStroke[] = [];
  if (aiPage.projectSketchLayer) {
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
  }

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
  if (aiPage.projectSfxText && page.texts.length > 0) {
    const scaleFactor = width / Math.max(1, page.width * zone.rect.width);
    for (const item of page.texts) {
      if (!item.text.trim()) continue;
      const pos = mapPagePointToZonePixels({ x: item.x, y: item.y }, zone.rect, width, height);
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
  }

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
