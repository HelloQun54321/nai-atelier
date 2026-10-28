import React from 'react';
import type { CanvasPoint } from '../../services/canvasTypes';

type Props = {
  width: number;
  height: number;
  origin: CanvasPoint;
  axis: 'x' | 'y' | null;
};

/** 显示移动方向的参考线；坐标与画布一致，线宽不随画布缩放。 */
export const CanvasAxisGuides: React.FC<Props> = ({ width, height, origin, axis }) => {
  const line = (direction: 'x' | 'y') => {
    const coordinates = direction === 'x'
      ? { x1: 0, y1: origin.y, x2: width, y2: origin.y }
      : { x1: origin.x, y1: 0, x2: origin.x, y2: height };
    return <g key={direction} data-axis-guide={direction}>
      <line {...coordinates} stroke="white" strokeWidth="4" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      <line {...coordinates} stroke="#1d4ed8" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
    </g>;
  };
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    {axis !== 'y' && line('x')}
    {axis !== 'x' && line('y')}
  </svg>;
};
