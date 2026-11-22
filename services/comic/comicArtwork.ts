import type { ComicBubbleShape, ComicFontFamily } from './comicTypes';

export interface ComicFontOption {
  id: ComicFontFamily;
  label: string;
  cssFamily: string;
  defaultWeight: number;
}

export const COMIC_FONT_PRESETS: ComicFontOption[] = [
  {
    id: 'comic-sans',
    label: '漫画黑体',
    cssFamily: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    defaultWeight: 700,
  },
  {
    id: 'round',
    label: '圆体对话',
    cssFamily: '"YouYuan", "Hiragino Maru Gothic ProN", "Rounded Mplus 1c", "Microsoft YaHei UI", sans-serif',
    defaultWeight: 600,
  },
  {
    id: 'hand',
    label: '手写楷体',
    cssFamily: '"KaiTi", "STKaiti", "Kaiti SC", "BiauKai", serif',
    defaultWeight: 600,
  },
  {
    id: 'bold',
    label: '热血粗黑',
    cssFamily: '"SimHei", "Heiti SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    defaultWeight: 900,
  },
  {
    id: 'impact',
    label: '冲击拟声',
    cssFamily: '"Impact", "FZYaoti", "SimHei", "Microsoft YaHei", sans-serif',
    defaultWeight: 900,
  },
];

export const resolveComicFont = (fontFamily?: ComicFontFamily): ComicFontOption =>
  COMIC_FONT_PRESETS.find(f => f.id === fontFamily) || COMIC_FONT_PRESETS[0];

/** 基于 ID 生成稳定伪随机数 (0..1)，让每个手绘气泡拥有自然有机变化且重绘不抖动。 */
export const seededUnit = (seedStr: string, index: number): number => {
  let h = 2166136261 ^ index * 374761393;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
};

/**
 * 根据文字长度与气泡内接可用矩形动态计算最合适的字号：
 * 绝不让长台词被气泡框截断，字少时保持用户设定字号，字多时平滑缩小适配。
 */
export const computeAutoFitFontSize = (
  text: string,
  baseFontSize: number,
  innerWidth: number,
  innerHeight: number,
  writingMode: 'horizontal' | 'vertical',
): number => {
  const clean = text.trim();
  if (!clean) return baseFontSize;
  const lines = clean.split('\n');
  const minSize = 10;
  let size = Math.max(minSize, Math.min(84, baseFontSize));

  const fits = (candidate: number): boolean => {
    const lineStep = candidate * 1.24;
    const charStep = candidate * 1.04;
    if (writingMode === 'vertical') {
      const maxCharsPerCol = Math.max(1, Math.floor(innerHeight / charStep));
      let cols = 0;
      for (const line of lines) {
        const len = Math.max(1, Array.from(line).length);
        cols += Math.ceil(len / maxCharsPerCol);
      }
      return cols * lineStep <= innerWidth * 1.04;
    }
    const maxCharsPerRow = Math.max(1, Math.floor(innerWidth / charStep));
    let rows = 0;
    for (const line of lines) {
      const len = Math.max(1, Array.from(line).length);
      rows += Math.ceil(len / maxCharsPerRow);
    }
    return rows * lineStep <= innerHeight * 1.04;
  };

  while (size > minSize && !fits(size)) {
    size -= 1;
  }
  return size;
};

/**
 * 生成自然手绘感气泡轮廓点集/SVG Path（SVG 画布与 Canvas 导出共用同一几何，彻底消除机械对称感）：
 * - shout：非对称高低错落的漫画吼叫尖刺 + 内凹锋利弧线；
 * - thought：大小交替的蓬松手绘云朵瓣；
 * - oval：略带有机呼吸感的漫画圆框；
 * - caption：略带微倒角的漫画旁白方框。
 */
export const buildOrganicBubbleSvgPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shape: ComicBubbleShape,
  seedId = 'bubble',
): string => {
  if (shape === 'caption') {
    const cr = Math.min(8, rx * 0.12, ry * 0.18);
    const x0 = cx - rx;
    const x1 = cx + rx;
    const y0 = cy - ry;
    const y1 = cy + ry;
    return [
      `M ${(x0 + cr).toFixed(1)} ${y0.toFixed(1)}`,
      `L ${(x1 - cr).toFixed(1)} ${y0.toFixed(1)}`,
      `Q ${x1.toFixed(1)} ${y0.toFixed(1)} ${x1.toFixed(1)} ${(y0 + cr).toFixed(1)}`,
      `L ${x1.toFixed(1)} ${(y1 - cr).toFixed(1)}`,
      `Q ${x1.toFixed(1)} ${y1.toFixed(1)} ${(x1 - cr).toFixed(1)} ${y1.toFixed(1)}`,
      `L ${(x0 + cr).toFixed(1)} ${y1.toFixed(1)}`,
      `Q ${x0.toFixed(1)} ${y1.toFixed(1)} ${x0.toFixed(1)} ${(y1 - cr).toFixed(1)}`,
      `L ${x0.toFixed(1)} ${(y0 + cr).toFixed(1)}`,
      `Q ${x0.toFixed(1)} ${y0.toFixed(1)} ${(x0 + cr).toFixed(1)} ${y0.toFixed(1)} Z`,
    ].join(' ');
  }

  if (shape === 'shout') {
    // 14 个非对称强弱交替漫画爆发尖刺 + 内凹二次贝塞尔曲线，呈现真实手绘张力
    const spikes = 14;
    const outerPts: Array<{ x: number; y: number }> = [];
    const innerPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < spikes; i++) {
      const jitterA = (seededUnit(seedId, i * 3) - 0.5) * 0.14;
      const aOuter = ((i / spikes) * Math.PI * 2) + jitterA;
      const aInner = (((i + 0.5) / spikes) * Math.PI * 2) + (seededUnit(seedId, i * 3 + 1) - 0.5) * 0.08;
      const outerBoost = (i % 3 === 0 ? 1.24 : 1.06) + seededUnit(seedId, i * 3 + 2) * 0.14;
      const innerDip = 0.72 + seededUnit(seedId, i * 5 + 7) * 0.12;
      outerPts.push({ x: cx + Math.cos(aOuter) * rx * outerBoost, y: cy + Math.sin(aOuter) * ry * outerBoost });
      innerPts.push({ x: cx + Math.cos(aInner) * rx * innerDip, y: cy + Math.sin(aInner) * ry * innerDip });
    }
    let d = `M ${outerPts[0].x.toFixed(1)} ${outerPts[0].y.toFixed(1)} `;
    for (let i = 0; i < spikes; i++) {
      const inner = innerPts[i];
      const nextOuter = outerPts[(i + 1) % spikes];
      // 柔和内凹弧线过渡，形成日漫吼叫尖刺
      d += `Q ${inner.x.toFixed(1)} ${inner.y.toFixed(1)} ${nextOuter.x.toFixed(1)} ${nextOuter.y.toFixed(1)} `;
    }
    return `${d}Z`;
  }

  if (shape === 'thought') {
    // 10 瓣大小错落的蓬松手绘云朵
    const lobes = 10;
    const angles: number[] = [];
    for (let i = 0; i < lobes; i++) {
      angles.push((i / lobes) * Math.PI * 2 + (seededUnit(seedId, i * 2) - 0.5) * 0.08);
    }
    const basePts = angles.map((a, i) => {
      const rFactor = 0.82 + (i % 2 === 0 ? 0.05 : -0.02) + seededUnit(seedId, i * 4 + 1) * 0.05;
      return { x: cx + Math.cos(a) * rx * rFactor, y: cy + Math.sin(a) * ry * rFactor };
    });
    let d = `M ${basePts[0].x.toFixed(1)} ${basePts[0].y.toFixed(1)} `;
    for (let i = 0; i < lobes; i++) {
      const next = basePts[(i + 1) % lobes];
      const aMid = (angles[i] + (i === lobes - 1 ? angles[0] + Math.PI * 2 : angles[i + 1])) / 2;
      const puff = 1.12 + (i % 2 === 0 ? 0.1 : 0.02) + seededUnit(seedId, i * 6 + 3) * 0.08;
      const ctrlX = cx + Math.cos(aMid) * rx * puff;
      const ctrlY = cy + Math.sin(aMid) * ry * puff;
      d += `Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)} `;
    }
    return `${d}Z`;
  }

  // oval：标准漫画平滑椭圆
  return `M ${(cx - rx).toFixed(1)} ${cy.toFixed(1)} a ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(rx * 2).toFixed(1)} 0 a ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(-rx * 2).toFixed(1)} 0 Z`;
};

/** 生成带有自然弯曲弧度的漫画气泡尾巴路径（不再是僵硬直三角形）。 */
export const buildCurvedTailPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tx: number,
  ty: number,
): string => {
  const angle = Math.atan2(ty - cy, tx - cx);
  const perp = angle + Math.PI / 2;
  const baseW = Math.max(8, Math.min(rx, ry) * 0.24);
  const startR = 0.55;
  const bx = cx + Math.cos(angle) * rx * startR;
  const by = cy + Math.sin(angle) * ry * startR;
  const p1x = bx + Math.cos(perp) * baseW;
  const p1y = by + Math.sin(perp) * baseW;
  const p2x = bx - Math.cos(perp) * baseW;
  const p2y = by - Math.sin(perp) * baseW;
  // 轻微弯曲的控制点，呈现日漫手绘尖尾感
  const c1x = (p1x + tx) * 0.5 + Math.cos(perp) * baseW * 0.25;
  const c1y = (p1y + ty) * 0.5 + Math.sin(perp) * baseW * 0.25;
  const c2x = (p2x + tx) * 0.5 + Math.cos(perp) * baseW * 0.12;
  const c2y = (p2y + ty) * 0.5 + Math.sin(perp) * baseW * 0.12;
  return `M ${p1x.toFixed(1)} ${p1y.toFixed(1)} Q ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)} Z`;
};

/** 将同一套有机气泡路径绘制到 Canvas 2D 上下文（导出 PNG 与画布预览 100% 一致）。 */
export const traceOrganicBubbleCanvas = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shape: ComicBubbleShape,
  seedId = 'bubble',
): void => {
  if (typeof Path2D !== 'undefined') {
    const path = new Path2D(buildOrganicBubbleSvgPath(cx, cy, rx, ry, shape, seedId));
    ctx.beginPath();
    // 借用原生 Path2D 直接填充/描边更精准，调用方如需 ctx 路径可改用辅助函数；此处退化走手工指令兼容旧环境
    void path;
  }
  ctx.beginPath();
  if (shape === 'caption') {
    const cr = Math.min(8, rx * 0.12, ry * 0.18);
    const x0 = cx - rx;
    const x1 = cx + rx;
    const y0 = cy - ry;
    const y1 = cy + ry;
    ctx.moveTo(x0 + cr, y0);
    ctx.lineTo(x1 - cr, y0);
    ctx.quadraticCurveTo(x1, y0, x1, y0 + cr);
    ctx.lineTo(x1, y1 - cr);
    ctx.quadraticCurveTo(x1, y1, x1 - cr, y1);
    ctx.lineTo(x0 + cr, y1);
    ctx.quadraticCurveTo(x0, y1, x0, y1 - cr);
    ctx.lineTo(x0, y0 + cr);
    ctx.quadraticCurveTo(x0, y0, x0 + cr, y0);
    ctx.closePath();
    return;
  }
  if (shape === 'shout') {
    const spikes = 14;
    const outerPts: Array<{ x: number; y: number }> = [];
    const innerPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < spikes; i++) {
      const jitterA = (seededUnit(seedId, i * 3) - 0.5) * 0.14;
      const aOuter = ((i / spikes) * Math.PI * 2) + jitterA;
      const aInner = (((i + 0.5) / spikes) * Math.PI * 2) + (seededUnit(seedId, i * 3 + 1) - 0.5) * 0.08;
      const outerBoost = (i % 3 === 0 ? 1.24 : 1.06) + seededUnit(seedId, i * 3 + 2) * 0.14;
      const innerDip = 0.72 + seededUnit(seedId, i * 5 + 7) * 0.12;
      outerPts.push({ x: cx + Math.cos(aOuter) * rx * outerBoost, y: cy + Math.sin(aOuter) * ry * outerBoost });
      innerPts.push({ x: cx + Math.cos(aInner) * rx * innerDip, y: cy + Math.sin(aInner) * ry * innerDip });
    }
    ctx.moveTo(outerPts[0].x, outerPts[0].y);
    for (let i = 0; i < spikes; i++) {
      const inner = innerPts[i];
      const nextOuter = outerPts[(i + 1) % spikes];
      ctx.quadraticCurveTo(inner.x, inner.y, nextOuter.x, nextOuter.y);
    }
    ctx.closePath();
    return;
  }
  if (shape === 'thought') {
    const lobes = 10;
    const angles: number[] = [];
    for (let i = 0; i < lobes; i++) {
      angles.push((i / lobes) * Math.PI * 2 + (seededUnit(seedId, i * 2) - 0.5) * 0.08);
    }
    const basePts = angles.map((a, i) => {
      const rFactor = 0.82 + (i % 2 === 0 ? 0.05 : -0.02) + seededUnit(seedId, i * 4 + 1) * 0.05;
      return { x: cx + Math.cos(a) * rx * rFactor, y: cy + Math.sin(a) * ry * rFactor };
    });
    ctx.moveTo(basePts[0].x, basePts[0].y);
    for (let i = 0; i < lobes; i++) {
      const next = basePts[(i + 1) % lobes];
      const aMid = (angles[i] + (i === lobes - 1 ? angles[0] + Math.PI * 2 : angles[i + 1])) / 2;
      const puff = 1.12 + (i % 2 === 0 ? 0.1 : 0.02) + seededUnit(seedId, i * 6 + 3) * 0.08;
      ctx.quadraticCurveTo(cx + Math.cos(aMid) * rx * puff, cy + Math.sin(aMid) * ry * puff, next.x, next.y);
    }
    ctx.closePath();
    return;
  }
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
};

export const traceCurvedTailCanvas = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tx: number,
  ty: number,
): void => {
  const angle = Math.atan2(ty - cy, tx - cx);
  const perp = angle + Math.PI / 2;
  const baseW = Math.max(8, Math.min(rx, ry) * 0.24);
  const bx = cx + Math.cos(angle) * rx * 0.55;
  const by = cy + Math.sin(angle) * ry * 0.55;
  const p1x = bx + Math.cos(perp) * baseW;
  const p1y = by + Math.sin(perp) * baseW;
  const p2x = bx - Math.cos(perp) * baseW;
  const p2y = by - Math.sin(perp) * baseW;
  const c1x = (p1x + tx) * 0.5 + Math.cos(perp) * baseW * 0.25;
  const c1y = (p1y + ty) * 0.5 + Math.sin(perp) * baseW * 0.25;
  const c2x = (p2x + tx) * 0.5 + Math.cos(perp) * baseW * 0.12;
  const c2y = (p2y + ty) * 0.5 + Math.sin(perp) * baseW * 0.12;
  ctx.beginPath();
  ctx.moveTo(p1x, p1y);
  ctx.quadraticCurveTo(c1x, c1y, tx, ty);
  ctx.quadraticCurveTo(c2x, c2y, p2x, p2y);
  ctx.closePath();
};
