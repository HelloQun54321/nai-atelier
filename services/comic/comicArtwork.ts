/**
 * 漫画矢量气泡、字体排版与手绘质感渲染引擎。
 *
 * 气泡几何算法移植自开源项目 jonigata/FramePlanner2（MIT License）
 * - 原仓库：https://github.com/jonigata/FramePlanner2
 * - 参考模块：src/lib/layeredCanvas/tools/draw/bubbleGraphic.ts、bubbleGeometry.ts、quickHull.ts
 * 针对无外部重型依赖（零 Paper.js）与 SVG/Canvas 2D 双端像素一致输出进行了 TypeScript 重写。
 */

import { lookupRegisteredComicFontFamily } from './comicFonts';
import type { ComicBubbleShape, ComicFontFamily } from './comicTypes';

export interface ComicFontPreset {
  id: ComicFontFamily;
  label: string;
  cssFamily: string;
  defaultWeight: number;
}

/** 系统内置回退字体（当用户尚未下载开源字体包或导入本机字体时兜底生效）。 */
export const COMIC_FONT_PRESETS: ComicFontPreset[] = [
  {
    id: 'comic-sans',
    label: '系统黑体（默认）',
    cssFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    defaultWeight: 700,
  },
  {
    id: 'round',
    label: '系统圆体',
    cssFamily: '"YouYuan", "Hiragino Maru Gothic ProN", "PingFang SC", "Microsoft YaHei", sans-serif',
    defaultWeight: 700,
  },
  {
    id: 'hand',
    label: '系统楷体',
    cssFamily: '"KaiTi", "STKaiti", "BiauKai", "Kaiti SC", serif',
    defaultWeight: 600,
  },
  {
    id: 'bold',
    label: '系统粗黑',
    cssFamily: '"SimHei", "Heiti SC", "Source Han Sans CN", "Microsoft YaHei", sans-serif',
    defaultWeight: 900,
  },
  {
    id: 'impact',
    label: '系统冲击拟声',
    cssFamily: '"Impact", "FZYaoti", "SimHei", "Microsoft YaHei", sans-serif',
    defaultWeight: 900,
  },
];

const FALLBACK_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export const resolveComicFont = (fontId?: ComicFontFamily): ComicFontPreset => {
  if (fontId) {
    const registeredFamily = lookupRegisteredComicFontFamily(fontId);
    if (registeredFamily) {
      const weight = fontId === 'smiley-sans' || fontId === 'lxgw-marker-gothic' ? 700 : 500;
      return {
        id: fontId,
        label: fontId,
        cssFamily: `"${registeredFamily}", ${FALLBACK_STACK}`,
        defaultWeight: weight,
      };
    }
  }
  return COMIC_FONT_PRESETS.find(item => item.id === fontId) || COMIC_FONT_PRESETS[0];
};

export interface ComicBubbleShapeMeta {
  id: ComicBubbleShape;
  label: string;
  supportsTail: boolean;
  isMindTrail?: boolean;
}

/** 完整替换自 FramePlanner2（MIT）的 12 款专业日漫气泡类型。 */
export const COMIC_BUBBLE_SHAPES: ComicBubbleShapeMeta[] = [
  { id: 'soft', label: '蓬松对白', supportsTail: true },
  { id: 'oval', label: '标准椭圆', supportsTail: true },
  { id: 'rounded', label: '圆角方框', supportsTail: true },
  { id: 'caption', label: '旁白方框', supportsTail: false },
  { id: 'shout', label: '爆裂吼叫', supportsTail: true },
  { id: 'harsh', label: '尖刺震惊', supportsTail: true },
  { id: 'thought', label: '思考云朵', supportsTail: true, isMindTrail: true },
  { id: 'ellipse-mind', label: '椭圆独白', supportsTail: true, isMindTrail: true },
  { id: 'polygon', label: '锐角多边', supportsTail: true },
  { id: 'concentration', label: '意识放射', supportsTail: false },
  { id: 'strokes', label: '手绘单线', supportsTail: false },
  { id: 'double-strokes', label: '心理双线', supportsTail: false },
];

export const getBubbleShapeMeta = (shape: ComicBubbleShape): ComicBubbleShapeMeta =>
  COMIC_BUBBLE_SHAPES.find(item => item.id === shape) || COMIC_BUBBLE_SHAPES[0];

type Vec2 = [number, number];

/** 由气泡 ID 生成可复现的确定性伪随机序列（Mulberry32）。 */
export const createSeededRng = (seedKey: string): (() => number) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedKey.length; i++) {
    h ^= seedKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const seededUnit = (seed: string, index: number): number => {
  let h = 2166136261 ^ index;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
};

// ==================== FramePlanner2（MIT）几何核心原语 ====================

const superEllipsePoint2D = (rx: number, ry: number, n: number, angle: number): Vec2 => {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const exp = 2 / n;
  return [
    Math.sign(cosA) * (Math.abs(cosA) ** exp) * rx,
    Math.sign(sinA) * (Math.abs(sinA) ** exp) * ry,
  ];
};

const generateRandomAngles = (rng: () => number, count: number, jitterFactor = 0.5): number[] => {
  const angles: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = ((rng() - 0.5) / count) * jitterFactor;
    angles.push((i / count + jitter) * Math.PI * 2);
  }
  return angles;
};

const generateSuperEllipsePoints = (w: number, h: number, angles: number[], n = 3): Vec2[] =>
  angles.map(a => superEllipsePoint2D(w / 2, h / 2, n, a));

const perpendicular2D = ([x, y]: Vec2, sign = 1): Vec2 => [-y * sign, x * sign];

const normalize2D = ([x, y]: Vec2, len = 1): Vec2 => {
  const mag = Math.hypot(x, y);
  if (mag < 1e-6) return [0, 0];
  return [(x / mag) * len, (y / mag) * len];
};

const subdividePointsWithBump = (w: number, h: number, points: Vec2[], bumpFactor: number): Vec2[] => {
  const bump = Math.min(w, h) * bumpFactor;
  const result: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const mid: Vec2 = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
    const perp = normalize2D(perpendicular2D([p2[0] - p1[0], p2[1] - p1[1]]), bump);
    result.push(p1);
    result.push([mid[0] + perp[0], mid[1] + perp[1]]);
  }
  return result;
};

const jitterDistances = (rng: () => number, points: Vec2[], bump: number, jitter: number): Vec2[] =>
  points.map((pt, idx) => {
    if (idx % 2 !== 0) return pt;
    const dist = Math.hypot(pt[0], pt[1]);
    if (dist < 1e-6) return pt;
    const factor = 1 + bump + (rng() - 0.5) * jitter;
    return [pt[0] * factor, pt[1] * factor];
  });

/** 无状态 QuickHull 凸包（移植自 FramePlanner2 quickHull.ts）。 */
const quickHull2D = (points: Vec2[]): Vec2[] => {
  if (points.length <= 3) return [...points];
  let minPt = points[0];
  let maxPt = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < minPt[0]) minPt = points[i];
    if (points[i][0] > maxPt[0]) maxPt = points[i];
  }
  const hull: Vec2[] = [];
  const distFromLine = (pt: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - b[0]) * (pt[1] - a[1]) + (b[1] - a[1]) * (pt[0] - a[0]);

  const build = (a: Vec2, b: Vec2, subset: Vec2[]) => {
    let maxDist = 0;
    let farthest: Vec2 | null = null;
    const outer: Vec2[] = [];
    for (const pt of subset) {
      const d = distFromLine(pt, a, b);
      if (d > 1e-6) {
        outer.push(pt);
        if (d > maxDist) {
          maxDist = d;
          farthest = pt;
        }
      }
    }
    if (!farthest) {
      hull.push(a);
      return;
    }
    build(a, farthest, outer);
    build(farthest, b, outer);
  };

  build(minPt, maxPt, points);
  build(maxPt, minPt, points);
  return hull;
};

const extendLineSegment = (p0: Vec2, p1: Vec2, factor: number): [Vec2, Vec2] => {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  return [
    [p1[0] - dx * factor, p1[1] - dy * factor],
    [p0[0] + dx * factor, p0[1] + dy * factor],
  ];
};

const tailCoordToWorldCoord = (center: Vec2, tip: Vec2, mid: Vec2): Vec2 => [
  mid[0] * tip[0] + mid[1] * tip[1] + center[0],
  mid[0] * tip[1] - mid[1] * tip[0] + center[1],
];

const fmt = (n: number) => n.toFixed(1);

const buildQuadraticLoopPath = (cx: number, cy: number, points: Vec2[], smoothed = false): string => {
  if (!points.length) return '';
  if (smoothed) {
    let d = '';
    for (let i = 0; i <= points.length; i++) {
      const p0 = points[i % points.length];
      const p1 = points[(i + 1) % points.length];
      const cpX = cx + (p0[0] + p1[0]) * 0.5;
      const cpY = cy + (p0[1] + p1[1]) * 0.5;
      if (i === 0) d += `M ${fmt(cpX)} ${fmt(cpY)} `;
      else d += `Q ${fmt(cx + p0[0])} ${fmt(cy + p0[1])} ${fmt(cpX)} ${fmt(cpY)} `;
    }
    return `${d}Z`;
  }
  let d = `M ${fmt(cx + points[0][0])} ${fmt(cy + points[0][1])} `;
  for (let i = 0; i < points.length; i += 2) {
    const p1 = points[(i + 1) % points.length];
    const p2 = points[(i + 2) % points.length];
    d += `Q ${fmt(cx + p1[0])} ${fmt(cy + p1[1])} ${fmt(cx + p2[0])} ${fmt(cy + p2[1])} `;
  }
  return `${d}Z`;
};

const buildPolygonLoopPath = (cx: number, cy: number, points: Vec2[]): string => {
  if (!points.length) return '';
  return `M ${points.map(p => `${fmt(cx + p[0])} ${fmt(cy + p[1])}`).join(' L ')} Z`;
};

const buildRoundedRectPath = (cx: number, cy: number, rx: number, ry: number, xStraight = 0.6, yStraight = 0.7): string => {
  const x0 = cx - rx;
  const x2 = cx + rx;
  const y0 = cy - ry;
  const y2 = cy + ry;
  const sx = xStraight * rx;
  const sy = yStraight * ry;
  return [
    `M ${fmt(cx + sx)} ${fmt(y0)}`,
    `L ${fmt(cx - sx)} ${fmt(y0)}`,
    `Q ${fmt(x0)} ${fmt(y0)} ${fmt(x0)} ${fmt(cy - sy)}`,
    `L ${fmt(x0)} ${fmt(cy + sy)}`,
    `Q ${fmt(x0)} ${fmt(y2)} ${fmt(cx - sx)} ${fmt(y2)}`,
    `L ${fmt(cx + sx)} ${fmt(y2)}`,
    `Q ${fmt(x2)} ${fmt(y2)} ${fmt(x2)} ${fmt(cy + sy)}`,
    `L ${fmt(x2)} ${fmt(cy - sy)}`,
    `Q ${fmt(x2)} ${fmt(y0)} ${fmt(cx + sx)} ${fmt(y0)}`,
    'Z',
  ].join(' ');
};

const buildEllipsePath = (cx: number, cy: number, rx: number, ry: number): string =>
  `M ${fmt(cx - rx)} ${fmt(cy)} a ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(rx * 2)} 0 a ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-rx * 2)} 0 Z`;

const buildMiniCloudPath = (cx: number, cy: number, radius: number, rng: () => number): string => {
  const d = radius * 2;
  const raw = generateSuperEllipsePoints(d, d, generateRandomAngles(rng, 6, 0.35), 2);
  const pts = subdividePointsWithBump(d, d, raw, -0.15);
  return buildQuadraticLoopPath(cx, cy, pts, false);
};

/**
 * 气泡完整渲染模型（FramePlanner2 算法统一输出，同时驱动 SVG 画布预览与 Canvas 2D 导出）。
 */
export interface ComicBubbleRenderModel {
  shape: ComicBubbleShape;
  bodyPath: string;
  tailPath?: string;
  trailPaths?: string[];
  /** concentration 意识气泡的放射渐变细线（局部坐标） */
  radialLines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** strokes / double-strokes 的延伸淡出手绘墨线（局部坐标） */
  overrunLines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** body 是否需要常规实线描边（concentration / strokes / double-strokes 有专属笔触层） */
  strokeBody: boolean;
  supportsTail: boolean;
}

/**
 * 生成 FramePlanner2 风格的漫画气泡弯曲尖尾（移植自 makeTrivialTailPath）。
 * 自动控制根部宽度与微弧弯曲度，与主体通过「先双描边后双填充」无缝融合，零接缝穿帮。
 */
export const buildCurvedTailPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tx: number,
  ty: number,
): string => {
  const vx = tx - cx;
  const vy = ty - cy;
  const dist = Math.hypot(vx, vy);
  if (dist < 1) return '';
  const w = rx * 2;
  const h = ry * 2;
  const area = w * h;
  const denom = Math.max(50000, dist * dist);
  const halfBase = Math.max(7, Math.min(Math.min(rx, ry) * 0.36, (area * 35) / denom));
  const v: Vec2 = [vx, vy];
  const vd1 = normalize2D(perpendicular2D(v, 1), halfBase);
  const vd2 = normalize2D(perpendicular2D(v, -1), halfBase);
  // 轻微弯曲的控制点（FramePlanner2 tailMid = [0.5, 0.08]）
  const mid: Vec2 = [0.5, 0.09];
  const m1 = tailCoordToWorldCoord(vd1, [vx - vd1[0], vy - vd1[1]], mid);
  const m2 = tailCoordToWorldCoord(vd2, [vx - vd2[0], vy - vd2[1]], [0.5, 0.04]);
  return [
    `M ${fmt(cx + vd1[0])} ${fmt(cy + vd1[1])}`,
    `Q ${fmt(cx + m1[0])} ${fmt(cy + m1[1])} ${fmt(tx)} ${fmt(ty)}`,
    `Q ${fmt(cx + m2[0])} ${fmt(cy + m2[1])} ${fmt(cx + vd2[0])} ${fmt(cy + vd2[1])}`,
    'Z',
  ].join(' ');
};

/** 兼容导出：按 FramePlanner2 算法生成任意气泡主体的 SVG Path。 */
export const buildOrganicBubbleSvgPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shape: ComicBubbleShape,
  seedId = 'bubble',
): string => buildComicBubbleRenderModel(cx, cy, rx, ry, shape, seedId).bodyPath;

/**
 * 构建 FramePlanner2 专业漫画气泡的完整几何模型（主体 + 弯曲尾巴/思考尾泡 + 意识线/手绘双线）。
 */
export const buildComicBubbleRenderModel = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shape: ComicBubbleShape,
  seedId = 'bubble',
  tail?: { enabled: boolean; tx: number; ty: number },
): ComicBubbleRenderModel => {
  const w = Math.max(8, rx * 2);
  const h = Math.max(8, ry * 2);
  const rng = createSeededRng(`${shape}:${seedId}`);
  const meta = getBubbleShapeMeta(shape);

  let bodyPath = '';
  let strokeBody = true;
  let radialLines: ComicBubbleRenderModel['radialLines'];
  let overrunLines: ComicBubbleRenderModel['overrunLines'];

  switch (shape) {
    case 'caption': {
      // FramePlanner2 square：干净利落的日漫旁白框
      bodyPath = `M ${fmt(cx - rx)} ${fmt(cy - ry)} L ${fmt(cx + rx)} ${fmt(cy - ry)} L ${fmt(cx + rx)} ${fmt(cy + ry)} L ${fmt(cx - rx)} ${fmt(cy + ry)} Z`;
      break;
    }
    case 'rounded': {
      // FramePlanner2 rounded（xStraight=0.6, yStraight=0.7）
      bodyPath = buildRoundedRectPath(cx, cy, rx, ry, 0.6, 0.7);
      break;
    }
    case 'soft':
    case 'thought': {
      // FramePlanner2 soft / soft-mind（superEllipse=3, bumpCount=8, bumpDepth=0.06, smoothing=true）
      const raw = generateSuperEllipsePoints(w, h, generateRandomAngles(rng, 8, 0.35), 3);
      const bumped = subdividePointsWithBump(w, h, raw, -0.065);
      bodyPath = buildQuadraticLoopPath(cx, cy, bumped, true);
      break;
    }
    case 'shout': {
      // FramePlanner2 shout（superEllipse=3, bumpCount=10, bumpSharp=0.16, angleJitter=0.5, depthJitter=0.5）
      const angles = generateRandomAngles(rng, 10, 0.48);
      const raw = generateSuperEllipsePoints(w * 0.86, h * 0.86, angles, 3);
      const bumped = subdividePointsWithBump(w * 0.86, h * 0.86, raw, 0.16);
      const spiked = jitterDistances(rng, bumped, 0.16, 0.45);
      bodyPath = buildQuadraticLoopPath(cx, cy, spiked, false);
      break;
    }
    case 'harsh': {
      // FramePlanner2 harsh（superEllipse=3, bumpCount=15, bumpDepth=0.07, angleJitter=0.1）
      const angles = generateRandomAngles(rng, 15, 0.14);
      const raw = generateSuperEllipsePoints(w * 0.94, h * 0.94, angles, 3);
      const jagged = subdividePointsWithBump(w * 0.94, h * 0.94, raw, 0.075);
      bodyPath = buildPolygonLoopPath(cx, cy, jagged);
      break;
    }
    case 'polygon': {
      // FramePlanner2 polygon（QuickHull 凸包，vertexCount=7, superEllipse=3, angleJitter=0.4）
      const raw = generateSuperEllipsePoints(w, h, generateRandomAngles(rng, 7, 0.4), 3);
      const hull = quickHull2D(raw);
      bodyPath = buildPolygonLoopPath(cx, cy, hull);
      break;
    }
    case 'concentration': {
      // FramePlanner2 concentration：放射渐变细线 + 内部实心椭圆（无硬黑边框）
      bodyPath = buildEllipsePath(cx, cy, rx * 0.84, ry * 0.84);
      strokeBody = false;
      const lineCount = 110;
      const lineLen = 1.28;
      radialLines = [];
      for (let i = 0; i < lineCount; i++) {
        const a = (i / lineCount) * Math.PI * 2;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        radialLines.push({
          x1: cx + cosA * rx * 0.82,
          y1: cy + sinA * ry * 0.82,
          x2: cx + cosA * rx * lineLen,
          y2: cy + sinA * ry * lineLen,
        });
      }
      break;
    }
    case 'strokes':
    case 'double-strokes': {
      // FramePlanner2 strokes / double-strokes：QuickHull 多边形 + 出头淡出单/双墨线
      const isDouble = shape === 'double-strokes';
      const raw = generateSuperEllipsePoints(w * 0.94, h * 0.94, generateRandomAngles(rng, 10, 0.45), 3);
      const hull = quickHull2D(raw);
      bodyPath = buildPolygonLoopPath(cx, cy, hull);
      strokeBody = false;
      const overRun = isDouble ? 1.24 : 1.2;
      const interval = Math.min(w, h) * 0.042;
      overrunLines = [];
      for (let i = 0; i < hull.length; i++) {
        const p0 = hull[i];
        const p1 = hull[(i + 1) % hull.length];
        const [q0, q1] = extendLineSegment(p0, p1, overRun);
        overrunLines.push({
          x1: cx + q0[0],
          y1: cy + q0[1],
          x2: cx + q1[0],
          y2: cy + q1[1],
        });
        if (isDouble) {
          const [nx, ny] = normalize2D(perpendicular2D([p1[0] - p0[0], p1[1] - p0[1]]), interval);
          overrunLines.push({
            x1: cx + q0[0] + nx,
            y1: cy + q0[1] + ny,
            x2: cx + q1[0] + nx,
            y2: cy + q1[1] + ny,
          });
        }
      }
      break;
    }
    case 'oval':
    case 'ellipse-mind':
    default: {
      bodyPath = buildEllipsePath(cx, cy, rx, ry);
      break;
    }
  }

  let tailPath: string | undefined;
  let trailPaths: string[] | undefined;

  if (tail?.enabled && meta.supportsTail) {
    if (meta.isMindTrail) {
      // FramePlanner2 addMind：4 颗由近到远渐小的手绘小云朵思考泡
      const trailSpec: Array<[number, number]> = [
        [0.42, 0.14],
        [0.62, 0.10],
        [0.80, 0.068],
        [0.95, 0.045],
      ];
      const baseR = Math.min(rx, ry);
      const midPt = tailCoordToWorldCoord([cx, cy], [tail.tx - cx, tail.ty - cy], [0.22, 0.06]);
      trailPaths = trailSpec.map(([ratio, rScale]) => {
        const px = midPt[0] + (tail.tx - midPt[0]) * ratio;
        const py = midPt[1] + (tail.ty - midPt[1]) * ratio;
        const radius = Math.max(3, baseR * rScale * 1.3);
        return buildMiniCloudPath(px, py, radius, rng);
      });
    } else {
      tailPath = buildCurvedTailPath(cx, cy, rx, ry, tail.tx, tail.ty);
    }
  }

  return {
    shape,
    bodyPath,
    tailPath,
    trailPaths,
    radialLines,
    overrunLines,
    strokeBody,
    supportsTail: meta.supportsTail,
  };
};

const drawSvgPathOnCanvas = (
  ctx: CanvasRenderingContext2D,
  pathData: string,
  mode: 'fill' | 'stroke',
): void => {
  if (!pathData) return;
  if (typeof Path2D !== 'undefined') {
    const p = new Path2D(pathData);
    if (mode === 'fill') ctx.fill(p);
    else ctx.stroke(p);
    return;
  }
  // 兼容无 Path2D 的测试环境回退
  ctx.beginPath();
  if (mode === 'fill') ctx.fill();
  else ctx.stroke();
};

/**
 * 将 FramePlanner2 渲染模型直接绘制到 Canvas 2D（导出 PNG 与 SVG 预览 100% 像素一致）。
 */
export const drawComicBubbleOnCanvas = (
  ctx: CanvasRenderingContext2D,
  model: ComicBubbleRenderModel,
  style: {
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  },
): void => {
  const isTransparent = !style.fillColor || style.fillColor === 'transparent';
  const hasStroke = style.strokeWidth > 0 && style.strokeColor !== 'transparent';

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1. 意识放射细线（底层）
  if (model.radialLines?.length && hasStroke) {
    ctx.save();
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = Math.max(1, style.strokeWidth * 0.42);
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    for (const seg of model.radialLines) {
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. 常规气泡：先双倍描边（尾巴 + 主体），再双填充（尾巴 + 主体），实现 FramePlanner2 级无缝融合
  if (hasStroke && model.strokeBody) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth * 2;
    if (model.tailPath) drawSvgPathOnCanvas(ctx, model.tailPath, 'stroke');
    drawSvgPathOnCanvas(ctx, model.bodyPath, 'stroke');
  }
  if (!isTransparent) {
    ctx.fillStyle = style.fillColor;
    if (model.tailPath) drawSvgPathOnCanvas(ctx, model.tailPath, 'fill');
    drawSvgPathOnCanvas(ctx, model.bodyPath, 'fill');
  }

  // 3. 思考云朵 4 颗渐变尾泡
  if (model.trailPaths?.length) {
    for (const tp of model.trailPaths) {
      if (hasStroke) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = style.strokeWidth * 1.6;
        drawSvgPathOnCanvas(ctx, tp, 'stroke');
      }
      if (!isTransparent) {
        ctx.fillStyle = style.fillColor;
        drawSvgPathOnCanvas(ctx, tp, 'fill');
      }
    }
  }

  // 4. 手绘单线 / 心理双线（两端淡出的过冲笔触）
  if (model.overrunLines?.length && hasStroke) {
    ctx.save();
    ctx.lineWidth = Math.max(1.2, style.strokeWidth * 0.85);
    for (const seg of model.overrunLines) {
      const grad = ctx.createLinearGradient(seg.x1, seg.y1, seg.x2, seg.y2);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.14, style.strokeColor);
      grad.addColorStop(0.86, style.strokeColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
};

/**
 * 按气泡内可用区域自动缩小字号，防止长台词超出或被截断。
 * 若原字号已能轻松放下则保持不变；超出时平滑缩小至合适大小（最低 10px）。
 */
export const computeAutoFitFontSize = (
  text: string,
  requestedFontSize: number,
  boxWidthPx: number,
  boxHeightPx: number,
  writingMode: 'horizontal' | 'vertical',
): number => {
  const clean = text.trim();
  if (!clean) return requestedFontSize;
  const usableW = Math.max(24, boxWidthPx * 0.72);
  const usableH = Math.max(24, boxHeightPx * 0.72);
  const lines = clean.split('\n');

  let size = Math.max(10, requestedFontSize);
  while (size > 10) {
    const lineStep = size * 1.26;
    if (writingMode === 'vertical') {
      const charsPerCol = Math.max(1, Math.floor(usableH / (size * 1.08)));
      const totalCols = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerCol)), 0);
      if (totalCols * lineStep <= usableW) break;
    } else {
      let totalRows = 0;
      for (const line of lines) {
        let visualUnits = 0;
        for (const ch of line) {
          visualUnits += /[\x00-\x7f]/.test(ch) ? 0.56 : 1.02;
        }
        const unitsPerRow = Math.max(1, usableW / size);
        totalRows += Math.max(1, Math.ceil(Math.max(1, visualUnits) / unitsPerRow));
      }
      if (totalRows * lineStep <= usableH) break;
    }
    size -= 1;
  }
  return Math.max(10, size);
};
