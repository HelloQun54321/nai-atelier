import React, { useEffect, useRef } from 'react';
import { resolveComicFont, seededUnit } from '../../services/comic/comicArtwork';
import type { ComicBlendMode, ComicStickerItem, ComicStroke } from '../../services/comic/comicTypes';

export const blendModeToCss = (mode: ComicBlendMode): React.CSSProperties['mixBlendMode'] =>
  mode === 'normal' ? 'normal' : mode;

/** 独立手绘图层渲染组件：支持每层独立橡皮擦（destination-out）、不透明度与 PS 混合模式。 */
export const DrawingLayerCanvas: React.FC<{
  strokes: ComicStroke[];
  activeStroke?: ComicStroke | null;
  pageW: number;
  pageH: number;
  opacity: number;
  blendMode: ComicBlendMode;
}> = ({ strokes, activeStroke, pageW, pageH, opacity, blendMode }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const list = activeStroke ? [...strokes, activeStroke] : strokes;
    for (const stroke of list) {
      if (!stroke.points.length) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.size;
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = stroke.opacity;
        ctx.strokeStyle = stroke.color;
      }
      ctx.beginPath();
      stroke.points.forEach((pt, idx) => {
        const x = pt.x * pageW;
        const y = pt.y * pageH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x * pageW + 0.1, stroke.points[0].y * pageH + 0.1);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [strokes, activeStroke, pageW, pageH]);

  return (
    <foreignObject
      x={0}
      y={0}
      width={pageW}
      height={pageH}
      style={{ pointerEvents: 'none', opacity, mixBlendMode: blendModeToCss(blendMode) }}
    >
      <canvas ref={ref} width={pageW} height={pageH} style={{ width: '100%', height: '100%', display: 'block' }} />
    </foreignObject>
  );
};

/** 渲染日漫效果贴纸 SVG（集中线、汗滴、青筋、星芒、惊叹/问号、震惊线、爱心）。 */
export const renderStickerSvg = (sticker: ComicStickerItem, pageW: number, pageH: number) => {
  const cx = sticker.x * pageW;
  const cy = sticker.y * pageH;
  const w = sticker.width * pageW;
  const h = sticker.height * pageH;
  const r = Math.min(w, h) / 2;

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${sticker.rotation})`} opacity={sticker.opacity}>
      {sticker.kind === 'speedlines' && Array.from({ length: 42 }, (_, i) => {
        // 漫画 G 笔外粗内尖锥形集中线（疏密自然错落，告别机械等距细棒）
        const jitter = (seededUnit(sticker.id, i * 3) - 0.5) * 0.08;
        const a = (i / 42) * Math.PI * 2 + jitter;
        const inner = r * (0.42 + seededUnit(sticker.id, i * 3 + 1) * 0.24);
        const outerX = w * 0.54;
        const outerY = h * 0.54;
        const halfSpread = 0.012 + seededUnit(sticker.id, i * 3 + 2) * 0.022;
        const tipX = Math.cos(a) * inner;
        const tipY = Math.sin(a) * inner;
        const b1x = Math.cos(a - halfSpread) * outerX;
        const b1y = Math.sin(a - halfSpread) * outerY;
        const b2x = Math.cos(a + halfSpread) * outerX;
        const b2y = Math.sin(a + halfSpread) * outerY;
        return (
          <polygon
            key={i}
            points={`${tipX.toFixed(1)},${tipY.toFixed(1)} ${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}`}
            fill={sticker.color}
          />
        );
      })}
      {sticker.kind === 'sweat' && (
        <g>
          <path
            d={`M 0 ${-r * 0.92} C ${r * 0.58} ${-r * 0.08}, ${r * 0.68} ${r * 0.88}, 0 ${r * 0.88} C ${-r * 0.68} ${r * 0.88}, ${-r * 0.58} ${-r * 0.08}, 0 ${-r * 0.92} Z`}
            fill="#e0f2fe"
            stroke={sticker.color}
            strokeWidth={Math.max(2.5, r * 0.11)}
            strokeLinejoin="round"
          />
          {/* 日漫冷汗内部高光月牙 */}
          <path
            d={`M ${-r * 0.18} ${-r * 0.15} C ${-r * 0.34} ${r * 0.15}, ${-r * 0.28} ${r * 0.52}, ${-r * 0.04} ${r * 0.58}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={Math.max(2.5, r * 0.14)}
            strokeLinecap="round"
          />
        </g>
      )}
      {sticker.kind === 'anger' && (
        <g>
          {/* 双层白底外描边 + 锋利收笔青筋 */}
          {[[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy], idx) => (
            <g key={idx}>
              <path
                d={`M ${sx * r * 0.78} ${sy * r * 0.18} Q ${sx * r * 0.2} ${sy * r * 0.2} ${sx * r * 0.18} ${sy * r * 0.78}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth={Math.max(5.5, r * 0.22)}
                strokeLinecap="round"
              />
              <path
                d={`M ${sx * r * 0.78} ${sy * r * 0.18} Q ${sx * r * 0.2} ${sy * r * 0.2} ${sx * r * 0.18} ${sy * r * 0.78}`}
                fill="none"
                stroke={sticker.color}
                strokeWidth={Math.max(3, r * 0.13)}
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
      )}
      {sticker.kind === 'sparkle' && (
        <g>
          {/* 主四角流光星芒 + 左上/右下伴星 */}
          <path
            d={`M 0 ${-r * 0.95} Q ${r * 0.08} ${-r * 0.08} ${r * 0.95} 0 Q ${r * 0.08} ${r * 0.08} 0 ${r * 0.95} Q ${-r * 0.08} ${r * 0.08} ${-r * 0.95} 0 Q ${-r * 0.08} ${-r * 0.08} 0 ${-r * 0.95} Z`}
            fill={sticker.color}
            stroke="#ffffff"
            strokeWidth={Math.max(2, r * 0.06)}
            paintOrder="stroke"
          />
          <path
            transform={`translate(${r * 0.56} ${-r * 0.56}) scale(0.36)`}
            d={`M 0 ${-r} Q ${r * 0.12} ${-r * 0.12} ${r} 0 Q ${r * 0.12} ${r * 0.12} 0 ${r} Q ${-r * 0.12} ${r * 0.12} ${-r} 0 Q ${-r * 0.12} ${-r * 0.12} 0 ${-r} Z`}
            fill={sticker.color}
          />
          <circle cx={-r * 0.55} cy={r * 0.52} r={Math.max(2, r * 0.09)} fill={sticker.color} />
        </g>
      )}
      {sticker.kind === 'shock' && [-3, -2, -1, 0, 1, 2, 3].map(i => {
        const x = i * w * 0.12;
        const lenFactor = 0.72 + (Math.abs(i) % 2) * 0.22;
        const thick = Math.max(2, r * (0.045 + (3 - Math.abs(i)) * 0.015));
        return (
          <polygon
            key={i}
            points={`${(x - thick).toFixed(1)},${(-h * 0.45 * lenFactor).toFixed(1)} ${(x + thick).toFixed(1)},${(-h * 0.45 * lenFactor).toFixed(1)} ${(x + (i % 2 ? 2 : -2)).toFixed(1)},${(h * 0.46 * lenFactor).toFixed(1)}`}
            fill={sticker.color}
          />
        );
      })}
      {sticker.kind === 'heart' && (
        <g>
          <path
            d={`M 0 ${r * 0.78} C ${-r * 1.1} ${r * 0.12}, ${-r * 0.95} ${-r * 0.85}, 0 ${-r * 0.24} C ${r * 0.95} ${-r * 0.85}, ${r * 1.1} ${r * 0.12}, 0 ${r * 0.78} Z`}
            fill={sticker.color}
            stroke="#ffffff"
            strokeWidth={Math.max(2.5, r * 0.09)}
            paintOrder="stroke"
          />
          <path
            d={`M ${-r * 0.48} ${-r * 0.25} Q ${-r * 0.42} ${-r * 0.48} ${-r * 0.22} ${-r * 0.45}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={Math.max(2.2, r * 0.1)}
            strokeLinecap="round"
          />
        </g>
      )}
      {(sticker.kind === 'exclamation' || sticker.kind === 'question') && (
        <g transform="rotate(-8)">
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={resolveComicFont('impact').cssFamily}
            fontSize={Math.round(r * 1.7)}
            fontWeight={900}
            fill={sticker.color}
            stroke="#ffffff"
            strokeWidth={Math.max(4, r * 0.22)}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {sticker.kind === 'exclamation' ? '!' : '?'}
          </text>
        </g>
      )}
    </g>
  );
};
