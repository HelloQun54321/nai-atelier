/**
 * 漫画分镜多边形几何、折线切割、Figma 级智能吸附与切分保图核心算法。
 *
 * 致谢说明：
 * 本模块的折线拐弯切分（splitPanelAlongPath）、边中点与顶点防自交约束、
 * 等距格缝测量与斜边投影/平行四边形对称吸附（snapPanelDrag / snapPanelAngle）、
 * 凹多边形安全角标定位（placeComicPanelBadge）等交互几何算法，
 * 参考并改编自开源项目 @YILING0013/novelai_local_web（GNU AGPL-3.0）
 * https://github.com/YILING0013/novelai_local_web
 */

import type { ComicPanelImage, ComicPoint } from './comicTypes';

export interface ComicSnapGuide {
  a: ComicPoint;
  b: ComicPoint;
  measure?: boolean;
}

export interface ComicCutSnapHit {
  panelId: string;
  edgeIndex: number;
  point: ComicPoint;
  distancePx: number;
}

export interface ComicPanelBadgePlacement {
  x: number;
  y: number;
  scale: number;
}

export interface NormalizedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PxPoint {
  x: number;
  y: number;
}

const DEFAULT_NORM_BOUNDS: NormalizedBounds = {
  minX: 0,
  minY: 0,
  maxX: 1,
  maxY: 1,
};

const PX_EPSILON = 1e-4;

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

const toPxPoints = (points: ComicPoint[], pageW: number, pageH: number): PxPoint[] =>
  points.map(pt => ({ x: pt.x * pageW, y: pt.y * pageH }));

const toNormPoints = (points: PxPoint[], pageW: number, pageH: number): ComicPoint[] => {
  const safeW = Math.max(1, pageW);
  const safeH = Math.max(1, pageH);
  return points.map(pt => ({
    x: Math.min(1, Math.max(0, round4(pt.x / safeW))),
    y: Math.min(1, Math.max(0, round4(pt.y / safeH))),
  }));
};

const pxBounds = (points: PxPoint[]): { x: number; y: number; width: number; height: number } => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

export const signedAreaPx = (points: PxPoint[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

const sideOfLinePx = (start: PxPoint, end: PxPoint, point: PxPoint): number =>
  (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);

const onSegmentPx = (start: PxPoint, end: PxPoint, point: PxPoint, tol = PX_EPSILON): boolean => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const crossTol = Math.max(tol, len * tol);
  if (Math.abs(sideOfLinePx(start, end, point)) > crossTol) return false;
  return point.x >= Math.min(start.x, end.x) - tol
    && point.x <= Math.max(start.x, end.x) + tol
    && point.y >= Math.min(start.y, end.y) - tol
    && point.y <= Math.max(start.y, end.y) + tol;
};

const segmentsIntersectPx = (a: PxPoint, b: PxPoint, c: PxPoint, d: PxPoint): boolean => {
  if (onSegmentPx(a, b, c) || onSegmentPx(a, b, d) || onSegmentPx(c, d, a) || onSegmentPx(c, d, b)) {
    return true;
  }
  return (sideOfLinePx(a, b, c) > 0) !== (sideOfLinePx(a, b, d) > 0)
    && (sideOfLinePx(c, d, a) > 0) !== (sideOfLinePx(c, d, b) > 0);
};

export const isPointStrictlyInsidePolygonPx = (points: PxPoint[], point: PxPoint): boolean => {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    if (onSegmentPx(start, end, point, 0.05)) return false;
    if (
      (start.y > point.y) !== (end.y > point.y)
      && point.x < start.x + ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y)
    ) {
      inside = !inside;
    }
  }
  return inside;
};

export const isUsablePolygonPx = (points: PxPoint[], minimumSizePx = 20): boolean => {
  if (points.length < 3 || Math.abs(signedAreaPx(points)) < minimumSizePx * minimumSizePx) {
    return false;
  }
  const box = pxBounds(points);
  if (box.width < minimumSizePx || box.height < minimumSizePx) {
    return false;
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < minimumSizePx / 12) return false;
    if (onSegmentPx(a, b, c, 0.25) || onSegmentPx(b, c, a, 0.25)) return false;
    for (let other = i + 2; other < points.length; other++) {
      if (i === 0 && other === points.length - 1) continue;
      if (segmentsIntersectPx(a, b, points[other], points[(other + 1) % points.length])) {
        return false;
      }
    }
  }
  return true;
};

const clampPtToBoundsPx = (pt: PxPoint, boundsPx: { minX: number; minY: number; maxX: number; maxY: number }): PxPoint => ({
  x: Math.max(boundsPx.minX, Math.min(boundsPx.maxX, pt.x)),
  y: Math.max(boundsPx.minY, Math.min(boundsPx.maxY, pt.y)),
});

const normBoundsToPx = (bounds: NormalizedBounds, pageW: number, pageH: number) => ({
  minX: bounds.minX * pageW,
  minY: bounds.minY * pageH,
  maxX: bounds.maxX * pageW,
  maxY: bounds.maxY * pageH,
});

export const moveNormalizedPolygonVertex = (
  points: ComicPoint[],
  index: number,
  targetNorm: ComicPoint,
  pageW: number,
  pageH: number,
  bounds: NormalizedBounds = DEFAULT_NORM_BOUNDS,
): ComicPoint[] | null => {
  if (index < 0 || index >= points.length) return null;
  const pxPts = toPxPoints(points, pageW, pageH);
  const bPx = normBoundsToPx(bounds, pageW, pageH);
  const moved = clampPtToBoundsPx({ x: targetNorm.x * pageW, y: targetNorm.y * pageH }, bPx);
  const candidate = pxPts.map((pt, i) => (i === index ? moved : pt));
  if (!isUsablePolygonPx(candidate)) return null;
  return toNormPoints(candidate, pageW, pageH);
};

export const moveNormalizedPolygonEdge = (
  points: ComicPoint[],
  edgeIndex: number,
  deltaNorm: ComicPoint,
  pageW: number,
  pageH: number,
  bounds: NormalizedBounds = DEFAULT_NORM_BOUNDS,
): ComicPoint[] | null => {
  if (points.length < 3 || edgeIndex < 0 || edgeIndex >= points.length) return null;
  const pxPts = toPxPoints(points, pageW, pageH);
  const bPx = normBoundsToPx(bounds, pageW, pageH);
  const nextIdx = (edgeIndex + 1) % pxPts.length;
  const a = pxPts[edgeIndex];
  const b = pxPts[nextIdx];
  const dx = Math.max(
    bPx.minX - Math.min(a.x, b.x),
    Math.min(bPx.maxX - Math.max(a.x, b.x), deltaNorm.x * pageW),
  );
  const dy = Math.max(
    bPx.minY - Math.min(a.y, b.y),
    Math.min(bPx.maxY - Math.max(a.y, b.y), deltaNorm.y * pageH),
  );
  const origSign = Math.sign(signedAreaPx(pxPts));
  const candidate = pxPts.map((pt, i) => (
    i === edgeIndex || i === nextIdx ? { x: pt.x + dx, y: pt.y + dy } : pt
  ));
  if (!isUsablePolygonPx(candidate) || (origSign !== 0 && Math.sign(signedAreaPx(candidate)) !== origSign)) {
    return null;
  }
  return toNormPoints(candidate, pageW, pageH);
};

export const moveNormalizedPolygon = (
  points: ComicPoint[],
  deltaNorm: ComicPoint,
  pageW: number,
  pageH: number,
  bounds: NormalizedBounds = DEFAULT_NORM_BOUNDS,
): ComicPoint[] => {
  if (!points.length) return points;
  const pxPts = toPxPoints(points, pageW, pageH);
  const bPx = normBoundsToPx(bounds, pageW, pageH);
  const frame = pxBounds(pxPts);
  const left = bPx.minX - frame.x;
  const right = bPx.maxX - frame.x - frame.width;
  const top = bPx.minY - frame.y;
  const bottom = bPx.maxY - frame.y - frame.height;
  const dx = Math.max(Math.min(left, right, 0), Math.min(Math.max(left, right, 0), deltaNorm.x * pageW));
  const dy = Math.max(Math.min(top, bottom, 0), Math.min(Math.max(top, bottom, 0), deltaNorm.y * pageH));
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return points;
  return toNormPoints(pxPts.map(pt => ({ x: pt.x + dx, y: pt.y + dy })), pageW, pageH);
};

export const rotateNormalizedPolygonPoints = (
  points: ComicPoint[],
  angleDeg: number,
  deltaNorm: ComicPoint,
  pageW: number,
  pageH: number,
): ComicPoint[] | null => {
  if (points.length < 3) return null;
  const pxPts = toPxPoints(points, pageW, pageH);
  const box = pxBounds(pxPts);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const moveX = deltaNorm.x * pageW;
  const moveY = deltaNorm.y * pageH;
  let rotated = pxPts.map(pt => ({
    x: cx + (pt.x - cx) * cos - (pt.y - cy) * sin + moveX,
    y: cy + (pt.x - cx) * sin + (pt.y - cy) * cos + moveY,
  }));
  const rBox = pxBounds(rotated);
  if (rBox.width > pageW + 0.01 || rBox.height > pageH + 0.01) return null;
  const dx = Math.max(-rBox.x, Math.min(0, pageW - rBox.x - rBox.width));
  const dy = Math.max(-rBox.y, Math.min(0, pageH - rBox.y - rBox.height));
  rotated = rotated.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
  return toNormPoints(rotated, pageW, pageH);
};

export const rescaleNormalizedPointsOnCanvasResize = (
  points: ComicPoint[],
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
): ComicPoint[] => {
  const safeNewW = Math.max(1, newW);
  const safeNewH = Math.max(1, newH);
  return points.map(pt => ({
    x: round4((pt.x * oldW) / safeNewW),
    y: round4((pt.y * oldH) / safeNewH),
  }));
};

export const snapCutPointToPanels = (
  panels: Array<{ id: string; points: ComicPoint[] }>,
  pointNorm: ComicPoint,
  pageW: number,
  pageH: number,
  thresholdPx: number,
): ComicCutSnapHit | null => {
  const target = { x: pointNorm.x * pageW, y: pointNorm.y * pageH };
  let nearest: ComicCutSnapHit | null = null;
  for (const panel of panels) {
    const pxPts = toPxPoints(panel.points, pageW, pageH);
    for (let edgeIndex = 0; edgeIndex < pxPts.length; edgeIndex++) {
      const start = pxPts[edgeIndex];
      const end = pxPts[(edgeIndex + 1) % pxPts.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lenSq));
      const snapped = { x: start.x + t * dx, y: start.y + t * dy };
      const distancePx = Math.hypot(snapped.x - target.x, snapped.y - target.y);
      if (distancePx <= thresholdPx && (!nearest || distancePx < nearest.distancePx)) {
        nearest = {
          panelId: panel.id,
          edgeIndex,
          point: { x: snapped.x / pageW, y: snapped.y / pageH },
          distancePx,
        };
      }
    }
  }
  return nearest;
};

export const findCutIntersectionsWithPanel = (
  panelId: string,
  points: ComicPoint[],
  startNorm: ComicPoint,
  endNorm: ComicPoint,
  pageW: number,
  pageH: number,
): ComicCutSnapHit[] => {
  const start = { x: startNorm.x * pageW, y: startNorm.y * pageH };
  const end = { x: endNorm.x * pageW, y: endNorm.y * pageH };
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (Math.hypot(deltaX, deltaY) < 0.01) return [];

  const pxPts = toPxPoints(points, pageW, pageH);
  const eps = 1e-5;
  const hits: ComicCutSnapHit[] = [];

  for (let edgeIndex = 0; edgeIndex < pxPts.length; edgeIndex++) {
    const edgeStart = pxPts[edgeIndex];
    const edgeEnd = pxPts[(edgeIndex + 1) % pxPts.length];
    const edgeX = edgeEnd.x - edgeStart.x;
    const edgeY = edgeEnd.y - edgeStart.y;
    const denom = deltaX * edgeY - deltaY * edgeX;
    if (Math.abs(denom) < eps) continue;
    const offX = edgeStart.x - start.x;
    const offY = edgeStart.y - start.y;
    const along = (offX * edgeY - offY * edgeX) / denom;
    const across = (offX * deltaY - offY * deltaX) / denom;
    if (along < -eps || along > 1 + eps || across < -eps || across > 1 + eps) continue;
    if (across <= eps || across >= 1 - eps) {
      const vertex = across <= eps ? edgeIndex : (edgeIndex + 1) % pxPts.length;
      const prev = pxPts[(vertex + pxPts.length - 1) % pxPts.length];
      const next = pxPts[(vertex + 1) % pxPts.length];
      const prevSide = deltaX * (prev.y - start.y) - deltaY * (prev.x - start.x);
      const nextSide = deltaX * (next.y - start.y) - deltaY * (next.x - start.x);
      // 擦过顶点或沿边贴行时，相邻两边落在轨迹同一侧，不切开画格
      if (!(prevSide > eps && nextSide < -eps) && !(prevSide < -eps && nextSide > eps)) continue;
    }
    const hitPx = { x: start.x + along * deltaX, y: start.y + along * deltaY };
    const distancePx = Math.hypot(hitPx.x - start.x, hitPx.y - start.y);
    if (hits.some(item => Math.hypot(item.point.x * pageW - hitPx.x, item.point.y * pageH - hitPx.y) <= 0.25)) {
      continue;
    }
    hits.push({
      panelId,
      edgeIndex,
      point: { x: hitPx.x / pageW, y: hitPx.y / pageH },
      distancePx,
    });
  }
  return hits.sort((a, b) => a.distancePx - b.distancePx);
};

const projectPointOntoBorderPx = (border: PxPoint[], pt: PxPoint): PxPoint | null => {
  let bestPt: PxPoint | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < border.length; i++) {
    const a = border[i];
    const b = border[(i + 1) % border.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(proj.x - pt.x, proj.y - pt.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestPt = proj;
    }
  }
  return bestDist <= 4 ? bestPt : null;
};

const cutStaysInsidePx = (border: PxPoint[], path: PxPoint[]): boolean =>
  path.slice(1).every((end, index) => {
    const start = path[index];
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (!isPointStrictlyInsidePolygonPx(border, mid)) return false;
    return border.every((a, edgeIndex) => {
      const b = border[(edgeIndex + 1) % border.length];
      if (!segmentsIntersectPx(start, end, a, b)) return true;
      if (index === 0 && onSegmentPx(a, b, start, 0.25)) return true;
      if (index === path.length - 2 && onSegmentPx(a, b, end, 0.25)) return true;
      return false;
    });
  });

export const splitNormalizedPolygonAlongPath = (
  points: ComicPoint[],
  pathNorm: ComicPoint[],
  gutterPx: number,
  pageW: number,
  pageH: number,
): [ComicPoint[], ComicPoint[]] | null => {
  if (points.length < 3 || pathNorm.length < 2) return null;
  const border = toPxPoints(points, pageW, pageH);
  const rawPath = toPxPoints(pathNorm, pageW, pageH);
  const snappedStart = projectPointOntoBorderPx(border, rawPath[0]);
  const snappedEnd = projectPointOntoBorderPx(border, rawPath[rawPath.length - 1]);
  if (!snappedStart || !snappedEnd) return null;
  if (Math.hypot(snappedEnd.x - snappedStart.x, snappedEnd.y - snappedStart.y) < 4) return null;

  const path: PxPoint[] = [snappedStart, ...rawPath.slice(1, -1), snappedEnd];
  if (!cutStaysInsidePx(border, path)) return null;

  const boundaryPosition = (point: PxPoint): number => {
    for (let i = 0; i < border.length; i++) {
      if (onSegmentPx(border[i], border[(i + 1) % border.length], point, 0.25)) {
        return i;
      }
    }
    return -1;
  };

  const walkBorder = (start: PxPoint, end: PxPoint): PxPoint[] | null => {
    const edge = boundaryPosition(start);
    const endEdge = boundaryPosition(end);
    if (edge < 0 || endEdge < 0) return null;
    const arc: PxPoint[] = [];
    const nextVertex = border[(edge + 1) % border.length];
    const sameEdgeForward = edge === endEdge
      && Math.hypot(end.x - nextVertex.x, end.y - nextVertex.y) < Math.hypot(start.x - nextVertex.x, start.y - nextVertex.y);
    if (sameEdgeForward) return arc;
    for (let step = 1; step <= border.length; step++) {
      const idx = (edge + step) % border.length;
      const vertex = border[idx];
      if (Math.hypot(vertex.x - end.x, vertex.y - end.y) <= 0.25) break;
      if (Math.hypot(vertex.x - start.x, vertex.y - start.y) > 0.25) arc.push(vertex);
      if (idx === endEdge) break;
    }
    return arc;
  };

  const halves: PxPoint[][] = [];
  for (const cutPath of [path, path.slice().reverse()]) {
    const arc = walkBorder(cutPath[cutPath.length - 1], cutPath[0]);
    if (!arc) return null;
    const outline = [...cutPath, ...arc];
    if (!isUsablePolygonPx(outline)) return null;
    if (gutterPx <= 0.01) {
      halves.push(outline);
      continue;
    }

    // 只把切口边向各自半区内部退让 halfGutter，并求相邻直线交点，完整保留外轮廓与折线拐角
    const direction = Math.sign(signedAreaPx(outline));
    const edges = outline.map((pt, idx) => {
      const next = outline[(idx + 1) % outline.length];
      const dx = next.x - pt.x;
      const dy = next.y - pt.y;
      const len = Math.max(1e-6, Math.hypot(dx, dy));
      const offset = idx < cutPath.length - 1 ? (direction * gutterPx) / (2 * len) : 0;
      return { x: pt.x - dy * offset, y: pt.y + dx * offset, dx, dy };
    });

    const inset = edges.map((edge, idx) => {
      const prev = edges[(idx + edges.length - 1) % edges.length];
      const det = prev.dx * edge.dy - prev.dy * edge.dx;
      if (Math.abs(det) <= 1e-4) return { x: edge.x, y: edge.y };
      const along = ((edge.x - prev.x) * prev.dy - (edge.y - prev.y) * prev.dx) / det;
      return { x: edge.x + along * edge.dx, y: edge.y + along * edge.dy };
    });

    const reversedEdge = inset.some((start, idx) => {
      const end = inset[(idx + 1) % inset.length];
      return (end.x - start.x) * edges[idx].dx + (end.y - start.y) * edges[idx].dy <= 0;
    });
    if (reversedEdge || !isUsablePolygonPx(inset) || !cutStaysInsidePx(border, inset.slice(0, cutPath.length))) {
      return null;
    }
    halves.push(inset);
  }

  return [
    toNormPoints(halves[0], pageW, pageH),
    toNormPoints(halves[1], pageW, pageH),
  ];
};

const clipPolygonHalfPlanePx = (polygon: PxPoint[], origin: PxPoint, normal: PxPoint): PxPoint[] => {
  if (polygon.length < 3) return [];
  const signedDist = (p: PxPoint) => (p.x - origin.x) * normal.x + (p.y - origin.y) * normal.y;
  const output: PxPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];
    const currD = signedDist(curr);
    const prevD = signedDist(prev);
    const currIn = currD >= -0.01;
    const prevIn = prevD >= -0.01;
    if (currIn !== prevIn) {
      const denom = prevD - currD;
      if (Math.abs(denom) > 1e-6) {
        const t = prevD / denom;
        output.push({ x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t });
      }
    }
    if (currIn) output.push({ ...curr });
  }
  return output.filter((pt, idx, arr) => {
    const prev = arr[(idx + arr.length - 1) % arr.length];
    return Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.25;
  });
};

/**
 * 直线一刀切：优先按实际双交点走通用轮廓切分（同时支持凹多边形与常规凸多边形），
 * 若切线起止点跨越凹角或复杂形态，回退到像素级半平面裁剪。
 */
export const sliceAnyPolygonByLine = (
  points: ComicPoint[],
  startNorm: ComicPoint,
  endNorm: ComicPoint,
  gutterPx: number,
  pageW: number,
  pageH: number,
): [ComicPoint[], ComicPoint[]] | null => {
  const hits = findCutIntersectionsWithPanel('target', points, startNorm, endNorm, pageW, pageH);
  if (hits.length >= 2) {
    const split = splitNormalizedPolygonAlongPath(points, [hits[0].point, hits[1].point], gutterPx, pageW, pageH);
    if (split) return split;
  }

  const pxPts = toPxPoints(points, pageW, pageH);
  const start = { x: startNorm.x * pageW, y: startNorm.y * pageH };
  const end = { x: endNorm.x * pageW, y: endNorm.y * pageH };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const half = gutterPx * 0.5;
  const pos = clipPolygonHalfPlanePx(pxPts, { x: start.x + half * nx, y: start.y + half * ny }, { x: nx, y: ny });
  const neg = clipPolygonHalfPlanePx(pxPts, { x: start.x - half * nx, y: start.y - half * ny }, { x: -nx, y: -ny });
  if (!isUsablePolygonPx(pos) || !isUsablePolygonPx(neg)) return null;
  return [toNormPoints(pos, pageW, pageH), toNormPoints(neg, pageW, pageH)];
};

export interface SnapComicPanelDragOptions {
  points: ComicPoint[];
  kind: 'move' | 'edge' | 'vertex';
  index?: number;
  deltaNorm: ComicPoint;
  siblingPolygons: ComicPoint[][];
  pageW: number;
  pageH: number;
  thresholdPx?: number;
  shift?: boolean;
  enabled?: boolean;
  bounds?: NormalizedBounds;
}

export const snapComicPanelDrag = ({
  points,
  kind,
  index = 0,
  deltaNorm,
  siblingPolygons,
  pageW,
  pageH,
  thresholdPx = 7,
  shift = false,
  enabled = true,
  bounds = DEFAULT_NORM_BOUNDS,
}: SnapComicPanelDragOptions): { delta: ComicPoint; guides: ComicSnapGuide[] } => {
  const safeW = Math.max(1, pageW);
  const safeH = Math.max(1, pageH);
  const pxPts = toPxPoints(points, safeW, safeH);
  const adjusted: PxPoint = { x: deltaNorm.x * safeW, y: deltaNorm.y * safeH };

  const lockedAxis: 'x' | 'y' | null = shift
    ? (Math.abs(adjusted.x) > Math.abs(adjusted.y) ? 'y' : 'x')
    : null;
  if (lockedAxis) adjusted[lockedAxis] = 0;

  if (!enabled || !pxPts.length) {
    const guides: ComicSnapGuide[] = [];
    if (lockedAxis && pxPts[index]) {
      const origin = pxPts[index];
      guides.push({
        a: { x: origin.x / safeW, y: origin.y / safeH },
        b: { x: (origin.x + adjusted.x) / safeW, y: (origin.y + adjusted.y) / safeH },
      });
    }
    return {
      delta: { x: adjusted.x / safeW, y: adjusted.y / safeH },
      guides,
    };
  }

  const moving = kind === 'vertex'
    ? [pxPts[index]]
    : kind === 'edge'
      ? [pxPts[index], pxPts[(index + 1) % pxPts.length]]
      : pxPts;
  const anchors: PxPoint[] = moving.map(pt => ({ x: pt.x + adjusted.x, y: pt.y + adjusted.y }));
  if (kind !== 'vertex') {
    const box = pxBounds(anchors);
    anchors.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  const bPx = normBoundsToPx(bounds, safeW, safeH);
  const pageTargetPoly: PxPoint[] = [
    { x: bPx.minX, y: bPx.minY },
    { x: bPx.maxX, y: bPx.minY },
    { x: bPx.maxX, y: bPx.maxY },
    { x: bPx.minX, y: bPx.maxY },
  ];
  // 补充常见安全边距基准（4% 与页面中线）
  const marginX = safeW * 0.04;
  const marginY = safeH * 0.04;
  const siblingPxPolys = siblingPolygons.map(poly => toPxPoints(poly, safeW, safeH));
  const targets = [pageTargetPoly, ...siblingPxPolys];
  const fixed = kind === 'move'
    ? []
    : pxPts.filter((_, i) => i !== index && (kind !== 'edge' || i !== (index + 1) % pxPts.length));
  const targetPoints: PxPoint[] = [
    ...fixed,
    { x: marginX, y: marginY },
    { x: safeW - marginX, y: safeH - marginY },
    { x: safeW / 2, y: safeH / 2 },
  ];
  for (const polygon of targets) {
    if (!polygon.length) continue;
    const box = pxBounds(polygon);
    targetPoints.push(
      ...polygon,
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
  }

  // 四边形拖动单个顶点时推算平行四边形对称角，拉歪后能一键吸回规整平行四边形
  let symmetric: PxPoint | undefined;
  if (kind === 'vertex' && pxPts.length === 4) {
    const previous = pxPts[(index + 3) % 4];
    const next = pxPts[(index + 1) % 4];
    const opposite = pxPts[(index + 2) % 4];
    symmetric = {
      x: previous.x + next.x - opposite.x,
      y: previous.y + next.y - opposite.y,
    };
    targetPoints.push(symmetric);
  }

  type BestAxisMatch = {
    offset: number;
    anchor?: PxPoint;
    target?: PxPoint;
    guides?: Array<{ a: PxPoint; b: PxPoint; measure?: boolean }>;
  };
  const best: { x: BestAxisMatch | null; y: BestAxisMatch | null } = { x: null, y: null };

  for (const axis of ['x', 'y'] as const) {
    if (axis === lockedAxis) continue;
    for (const anchor of anchors) {
      for (const target of targetPoints) {
        const offset = target[axis] - anchor[axis];
        if (Math.abs(offset) <= thresholdPx && (!best[axis] || Math.abs(offset) < Math.abs(best[axis]!.offset))) {
          best[axis] = { offset, anchor, target };
        }
      }
    }
  }

  const rawGuides: Array<{ a: PxPoint; b: PxPoint; measure?: boolean }> = [];

  // 整框移动时优先吸附同行/同列邻框的居中留白或重复格缝间距
  if (kind === 'move' && siblingPxPolys.length > 0) {
    const box = pxBounds(anchors);
    const boxes = siblingPxPolys.filter(p => p.length > 0).map(pxBounds);
    for (const axis of ['x', 'y'] as const) {
      if (axis === lockedAxis) continue;
      const other = axis === 'x' ? 'y' : 'x';
      const size = axis === 'x' ? 'width' : 'height';
      const crossSize = axis === 'x' ? 'height' : 'width';
      const neighbors = boxes.filter(b => (
        Math.min(b[other] + b[crossSize], box[other] + box[crossSize]) > Math.max(b[other], box[other])
      ));
      const before = neighbors
        .filter(b => b[axis] + b[size] <= box[axis] + thresholdPx)
        .sort((a, b) => b[axis] + b[size] - (a[axis] + a[size]));
      const after = neighbors
        .filter(b => b[axis] >= box[axis] + box[size] - thresholdPx)
        .sort((a, b) => a[axis] - b[axis]);
      const cross = box[other] + box[crossSize] / 2;
      const measure = (from: number, to: number) => ({
        a: (axis === 'x' ? { x: from, y: cross } : { x: cross, y: from }),
        b: (axis === 'x' ? { x: to, y: cross } : { x: cross, y: to }),
        measure: true,
      });

      const candidates: Array<{ value: number; guides: Array<{ a: PxPoint; b: PxPoint; measure?: boolean }> }> = [];
      if (before[0] && after[0]) {
        const end = before[0][axis] + before[0][size];
        const start = after[0][axis];
        const gap = (start - end - box[size]) / 2;
        if (gap >= 0) {
          candidates.push({
            value: end + gap,
            guides: [measure(end, end + gap), measure(start - gap, start)],
          });
        }
      }
      if (before.length > 1) {
        const end = before[0][axis] + before[0][size];
        const previousEnd = before[1][axis] + before[1][size];
        const gap = before[0][axis] - previousEnd;
        if (gap >= 0) {
          candidates.push({
            value: end + gap,
            guides: [measure(previousEnd, before[0][axis]), measure(end, end + gap)],
          });
        }
      }
      if (after.length > 1) {
        const end = after[0][axis] + after[0][size];
        const gap = after[1][axis] - end;
        if (gap >= 0) {
          candidates.push({
            value: after[0][axis] - gap - box[size],
            guides: [measure(end, after[1][axis]), measure(after[0][axis] - gap, after[0][axis])],
          });
        }
      }
      for (const candidate of candidates) {
        const offset = candidate.value - box[axis];
        if (
          Math.abs(offset) <= thresholdPx
          && (
            !best[axis]
            || Math.abs(offset) < Math.abs(best[axis]!.offset)
            || (Math.abs(Math.abs(offset) - Math.abs(best[axis]!.offset)) < 0.01 && !best[axis]!.guides)
          )
        ) {
          best[axis] = { offset, guides: candidate.guides };
        }
      }
    }
  }

  for (const axis of ['x', 'y'] as const) {
    if (best[axis]) adjusted[axis] += best[axis]!.offset;
  }

  for (const axis of ['x', 'y'] as const) {
    const match = best[axis];
    if (!match) continue;
    if (match.guides) {
      rawGuides.push(...match.guides);
      continue;
    }
    if (match.anchor && match.target) {
      const other = axis === 'x' ? 'y' : 'x';
      const cross = match.anchor[other] + (best[other]?.offset || 0);
      rawGuides.push({
        a: axis === 'x'
          ? { x: match.target.x, y: Math.min(cross, match.target.y) - thresholdPx * 2 }
          : { x: Math.min(cross, match.target.x) - thresholdPx * 2, y: match.target.y },
        b: axis === 'x'
          ? { x: match.target.x, y: Math.max(cross, match.target.y) + thresholdPx * 2 }
          : { x: Math.max(cross, match.target.x) + thresholdPx * 2, y: match.target.y },
      });
    }
  }

  if (kind === 'vertex' && !lockedAxis) {
    const anchor = { x: pxPts[index].x + deltaNorm.x * safeW, y: pxPts[index].y + deltaNorm.y * safeH };
    if (symmetric && Math.hypot(anchor.x - symmetric.x, anchor.y - symmetric.y) <= thresholdPx) {
      const adjX = symmetric.x - pxPts[index].x;
      const adjY = symmetric.y - pxPts[index].y;
      const guides = [
        { a: pxPts[(index + 3) % 4], b: symmetric },
        { a: symmetric, b: pxPts[(index + 1) % 4] },
      ];
      return {
        delta: { x: adjX / safeW, y: adjY / safeH },
        guides: guides.map(g => ({
          a: { x: g.a.x / safeW, y: g.a.y / safeH },
          b: { x: g.b.x / safeW, y: g.b.y / safeH },
        })),
      };
    }

    // 斜边正交投影吸附
    let nearest: { p: PxPoint; distance: number; a: PxPoint; b: PxPoint } | undefined;
    for (const polygon of targets) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / lenSq));
        const p = { x: a.x + t * dx, y: a.y + t * dy };
        const distance = Math.hypot(p.x - anchor.x, p.y - anchor.y);
        if (distance <= thresholdPx && (!nearest || distance < nearest.distance)) {
          nearest = { p, distance, a, b };
        }
      }
    }
    if (nearest && ((!best.x && !best.y) || nearest.distance < Math.hypot(best.x?.offset || 0, best.y?.offset || 0))) {
      return {
        delta: {
          x: (nearest.p.x - pxPts[index].x) / safeW,
          y: (nearest.p.y - pxPts[index].y) / safeH,
        },
        guides: [{
          a: { x: nearest.a.x / safeW, y: nearest.a.y / safeH },
          b: { x: nearest.b.x / safeW, y: nearest.b.y / safeH },
        }],
      };
    }
  }

  if (lockedAxis && moving[0]) {
    rawGuides.push({
      a: moving[0],
      b: { x: moving[0].x + adjusted.x, y: moving[0].y + adjusted.y },
    });
  }

  return {
    delta: { x: adjusted.x / safeW, y: adjusted.y / safeH },
    guides: rawGuides.map(g => ({
      a: { x: g.a.x / safeW, y: g.a.y / safeH },
      b: { x: g.b.x / safeW, y: g.b.y / safeH },
      ...(g.measure ? { measure: true } : {}),
    })),
  };
};

export const snapComicPanelAngle = (
  angleDeg: number,
  siblingPolygons: ComicPoint[][],
  pageW: number,
  pageH: number,
  shift = false,
  enabled = true,
): { angle: number; snapped: boolean } => {
  if (shift) return { angle: Math.round(angleDeg / 15) * 15, snapped: true };
  if (!enabled) return { angle: angleDeg, snapped: false };
  const targets = [0, 90];
  for (const poly of siblingPolygons) {
    const pxPts = toPxPoints(poly, pageW, pageH);
    for (let i = 0; i < pxPts.length; i++) {
      const a = pxPts[i];
      const b = pxPts[(i + 1) % pxPts.length];
      targets.push((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    }
  }
  let correction = 3;
  let snapped = false;
  for (const target of targets) {
    const diff = (((target - angleDeg) % 180) + 270) % 180 - 90;
    if (Math.abs(diff) <= Math.abs(correction)) {
      correction = diff;
      snapped = true;
    }
  }
  return { angle: snapped ? angleDeg + correction : angleDeg, snapped };
};

export const placeComicPanelBadgePx = (
  points: ComicPoint[],
  pageW: number,
  pageH: number,
  badgeW = 30,
  badgeH = 20,
): ComicPanelBadgePlacement | null => {
  if (points.length < 3) return null;
  const pxPts = toPxPoints(points, pageW, pageH);
  const box = pxBounds(pxPts);
  const edges = pxPts.map((start, idx) => [start, pxPts[(idx + 1) % pxPts.length]] as const);
  const radius = Math.hypot(badgeW, badgeH) / 2;
  let best: ComicPanelBadgePlacement | null = null;

  const check = (x: number, y: number): ComicPanelBadgePlacement | null => {
    if (!isPointStrictlyInsidePolygonPx(pxPts, { x, y })) return null;
    let clearance = Infinity;
    for (const [start, end] of edges) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lenSq)) : 0;
      clearance = Math.min(clearance, Math.hypot(x - start.x - t * dx, y - start.y - t * dy));
    }
    const scale = Math.max(0.55, Math.min(1, clearance / (radius + 0.5)));
    const placement: ComicPanelBadgePlacement = {
      x: x - (badgeW * scale) / 2,
      y: y - (badgeH * scale) / 2,
      scale,
    };
    if (!best || placement.scale > best.scale) best = placement;
    return scale === 1 ? placement : null;
  };

  const top = box.y + 8 + badgeH / 2;
  const topLeft = check(box.x + 8 + badgeW / 2, top);
  if (topLeft) return topLeft;

  const levels = [...new Set(pxPts.map(pt => pt.y))].sort((a, b) => a - b);
  const rows = [
    top,
    ...levels.slice(1).map((y, idx) => (levels[idx] + y) / 2),
  ].sort((a, b) => a - b);

  for (const y of rows) {
    const crossings = edges
      .flatMap(([a, b]) => ((a.y > y) !== (b.y > y) ? [a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)] : []))
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = crossings[i];
      const middle = (left + crossings[i + 1]) / 2;
      const placed = check(Math.min(left + radius + 8, middle), y) || check(middle, y);
      if (placed) return placed;
    }
  }
  return best;
};

/**
 * 切分已有图像的画格时，让切开后的两个子格分别继承并换算原图位置与缩放，
 * 确保画面连贯跨在两格中（不再清空新格原图）。
 */
export const preservePanelImageAfterSplit = (
  image: ComicPanelImage,
  origPoints: ComicPoint[],
  nextPoints: ComicPoint[],
  pageW: number,
  pageH: number,
): ComicPanelImage => {
  const safeW = Math.max(1, pageW);
  const safeH = Math.max(1, pageH);
  const oldBounds = pxBounds(toPxPoints(origPoints, safeW, safeH));
  const newBounds = pxBounds(toPxPoints(nextPoints, safeW, safeH));
  if (oldBounds.width < 1 || oldBounds.height < 1 || newBounds.width < 1 || newBounds.height < 1) {
    return { ...image };
  }

  const imgW = image.width || oldBounds.width;
  const imgH = image.height || oldBounds.height;
  const oldCover = Math.max(oldBounds.width / Math.max(1, imgW), oldBounds.height / Math.max(1, imgH)) * (image.scale || 1);
  const drawW = imgW * oldCover;
  const drawH = imgH * oldCover;
  const oldCx = oldBounds.x + oldBounds.width / 2;
  const oldCy = oldBounds.y + oldBounds.height / 2;
  const drawCx = oldCx + (image.offsetX || 0) * oldBounds.width;
  const drawCy = oldCy + (image.offsetY || 0) * oldBounds.height;

  const newBaseCover = Math.max(newBounds.width / Math.max(1, imgW), newBounds.height / Math.max(1, imgH));
  const newScale = Math.max(0.25, Math.min(6, oldCover / Math.max(1e-6, newBaseCover)));
  const newCx = newBounds.x + newBounds.width / 2;
  const newCy = newBounds.y + newBounds.height / 2;
  const offsetX = (drawCx - newCx) / newBounds.width;
  const offsetY = (drawCy - newCy) / newBounds.height;

  // 若子格太窄，略微保守保留；正常情况下精确还原 drawW / drawH 与图像中心
  if (!Number.isFinite(drawW) || !Number.isFinite(drawH) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return { ...image };
  }
  return {
    ...image,
    scale: Math.round(newScale * 1000) / 1000,
    offsetX: Math.round(offsetX * 1000) / 1000,
    offsetY: Math.round(offsetY * 1000) / 1000,
  };
};
