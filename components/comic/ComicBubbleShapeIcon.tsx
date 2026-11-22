import React, { useMemo } from 'react';
import { buildComicBubbleRenderModel } from '../../services/comic/comicArtwork';
import type { ComicBubbleShape } from '../../services/comic/comicTypes';

interface ComicBubbleShapeIconProps {
  shape: ComicBubbleShape;
  className?: string;
}

/** 渲染 FramePlanner2 气泡形状的真实矢量微缩预览图（用于顶栏与右侧形状网格）。 */
export const ComicBubbleShapeIcon: React.FC<ComicBubbleShapeIconProps> = ({ shape, className = 'h-7 w-10' }) => {
  const model = useMemo(
    () => buildComicBubbleRenderModel(32, 20, 22, 13, shape, `preview-${shape}`, {
      enabled: shape === 'thought' || shape === 'ellipse-mind',
      tx: 52,
      ty: 38,
    }),
    [shape],
  );

  return (
    <svg viewBox="0 0 64 42" className={className} aria-hidden="true">
      {model.radialLines?.map((seg, idx) => (
        idx % 3 === 0 ? (
          <line
            key={idx}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            stroke="currentColor"
            strokeWidth={0.9}
            opacity={0.75}
          />
        ) : null
      ))}
      <path
        d={model.bodyPath}
        fill="currentColor"
        fillOpacity={0.14}
        stroke={model.strokeBody ? 'currentColor' : 'none'}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      {model.trailPaths?.map((tp, idx) => (
        <path
          key={idx}
          d={tp}
          fill="currentColor"
          fillOpacity={0.14}
          stroke="currentColor"
          strokeWidth={2}
        />
      ))}
      {model.overrunLines?.map((seg, idx) => (
        <line
          key={idx}
          x1={seg.x1}
          y1={seg.y1}
          x2={seg.x2}
          y2={seg.y2}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
};
