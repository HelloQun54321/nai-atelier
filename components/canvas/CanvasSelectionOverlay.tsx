import React from 'react';
import type { CanvasPoint, CanvasSelection } from '../../services/canvasTypes';

/** 去除重复端点，并拒绝无法形成区域的轮廓。 */
export const closeCanvasSelection = (points: CanvasPoint[]): CanvasSelection | null => {
  const distinct = points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.001);
  if (distinct.length > 1 && Math.hypot(distinct[0].x - distinct[distinct.length - 1].x, distinct[0].y - distinct[distinct.length - 1].y) <= 0.001) distinct.pop();
  if (distinct.length < 3) return null;
  const [first, second] = distinct;
  if (!distinct.slice(2).some(point => Math.abs((second.x - first.x) * (point.y - first.y) - (second.y - first.y) * (point.x - first.x)) > 0.000001)) return null;
  return { points: distinct };
};

type Props = { width: number; height: number; zoom: number; selection: CanvasSelection | null; draft: CanvasSelection | null; polygon: CanvasPoint[]; cursor: CanvasPoint | null };
const path = (points: CanvasPoint[], close = false) => points.length ? `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}${close ? ' Z' : ''}` : '';

export const CanvasSelectionOverlay: React.FC<Props> = ({ width, height, zoom, selection, draft, polygon, cursor }) => {
  const polygonPoints = cursor && polygon.length ? [...polygon, cursor] : polygon;
  const selectedPath = selection ? path(selection.points, true) : '';
  const draftPath = draft ? path(draft.points, true) : path(polygonPoints);
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <style>{'@keyframes canvas-selection-march { to { stroke-dashoffset: -10; } }'}</style>
    {selectedPath && <><path d={selectedPath} fill="none" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><path d={selectedPath} fill="none" stroke="#1d4ed8" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" style={{ animation: 'canvas-selection-march 0.8s linear infinite' }} /></>}
    {draftPath && <><path d={draftPath} fill="none" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><path d={draftPath} fill="none" stroke="#1d4ed8" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /></>}
    {polygon.length >= 3 && <circle cx={polygon[0].x} cy={polygon[0].y} r={5 / zoom} fill="white" stroke="#1d4ed8" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
  </svg>;
};
