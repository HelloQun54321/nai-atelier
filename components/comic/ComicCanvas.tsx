import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, useLanguage } from '../../services/i18n';
import {
  getPanelBoundingBox,
  hitTestPanel,
  rectToPolygon,
  snapComicPoint,
} from '../../services/comic/comicGeometry';
import type {
  ComicBubbleItem,
  ComicLayerId,
  ComicPageDraft,
  ComicPanel,
  ComicPoint,
  ComicSelection,
  ComicStickerItem,
  ComicStroke,
  ComicTool,
} from '../../services/comic/comicTypes';

interface ComicCanvasProps {
  draft: ComicPageDraft;
  activeTool: ComicTool;
  selection: ComicSelection;
  zoom: number;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  generatingPanelId?: string | null;
  livePreviewImage?: string | null;
  onSelect: (selection: ComicSelection) => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onAddPanel: (points: ComicPoint[]) => void;
  onSliceAtLine: (start: ComicPoint, end: ComicPoint) => void;
  onCommitStroke: (stroke: ComicStroke) => void;
  onAddBubbleAt: (point: ComicPoint) => void;
  onAddTextAt: (point: ComicPoint) => void;
  onAddStickerAt: (point: ComicPoint) => void;
  onMoveBubble: (id: string, x: number, y: number, commit?: boolean) => void;
  onMoveBubbleTail: (id: string, tailX: number, tailY: number, commit?: boolean) => void;
  onMoveText: (id: string, x: number, y: number, commit?: boolean) => void;
  onMoveSticker: (id: string, x: number, y: number, commit?: boolean) => void;
}

type DragAction =
  | { kind: 'move-panel'; panelId: string; startPoint: ComicPoint; origPoints: ComicPoint[] }
  | { kind: 'pan-image'; panelId: string; startPoint: ComicPoint; origOffsetX: number; origOffsetY: number }
  | { kind: 'vertex'; panelId: string; vertexIndex: number }
  | { kind: 'rotate-panel'; panelId: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'draw-panel'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'slice'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'move-bubble'; id: string; dx: number; dy: number }
  | { kind: 'move-bubble-tail'; id: string }
  | { kind: 'move-text'; id: string; dx: number; dy: number }
  | { kind: 'move-sticker'; id: string; dx: number; dy: number }
  | { kind: 'stroke'; stroke: ComicStroke };

const bubblePathD = (cx: number, cy: number, rx: number, ry: number, shape: ComicBubbleItem['shape']): string => {
  if (shape === 'caption') {
    return `M ${cx - rx} ${cy - ry} H ${cx + rx} V ${cy + ry} H ${cx - rx} Z`;
  }
  if (shape === 'shout') {
    const spikes = 18;
    const pts: string[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * Math.PI) / spikes;
      const f = i % 2 === 0 ? 1.12 : 0.82;
      pts.push(`${i === 0 ? 'M' : 'L'} ${(cx + Math.cos(a) * rx * f).toFixed(1)} ${(cy + Math.sin(a) * ry * f).toFixed(1)}`);
    }
    return `${pts.join(' ')} Z`;
  }
  if (shape === 'thought') {
    const bumps = 12;
    let d = '';
    for (let i = 0; i < bumps; i++) {
      const a0 = (i / bumps) * Math.PI * 2;
      const a1 = ((i + 0.5) / bumps) * Math.PI * 2;
      const a2 = ((i + 1) / bumps) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * rx * 0.88;
      const y0 = cy + Math.sin(a0) * ry * 0.88;
      const xc = cx + Math.cos(a1) * rx * 1.12;
      const yc = cy + Math.sin(a1) * ry * 1.12;
      const x2 = cx + Math.cos(a2) * rx * 0.88;
      const y2 = cy + Math.sin(a2) * ry * 0.88;
      if (i === 0) d += `M ${x0.toFixed(1)} ${y0.toFixed(1)} `;
      d += `Q ${xc.toFixed(1)} ${yc.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
    }
    return `${d}Z`;
  }
  // oval
  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
};

const renderStickerSvg = (sticker: ComicStickerItem, pageW: number, pageH: number) => {
  const cx = sticker.x * pageW;
  const cy = sticker.y * pageH;
  const w = sticker.width * pageW;
  const h = sticker.height * pageH;
  const r = Math.min(w, h) / 2;

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${sticker.rotation})`} opacity={sticker.opacity}>
      {sticker.kind === 'speedlines' && Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        const inner = r * (0.48 + (i % 3) * 0.08);
        return (
          <line
            key={i}
            x1={Math.cos(a) * inner}
            y1={Math.sin(a) * inner}
            x2={Math.cos(a) * (w * 0.55)}
            y2={Math.sin(a) * (h * 0.55)}
            stroke={sticker.color}
            strokeWidth={Math.max(2, r * 0.04)}
            strokeLinecap="round"
          />
        );
      })}
      {sticker.kind === 'sweat' && (
        <path
          d={`M 0 ${-r * 0.85} C ${r * 0.65} ${-r * 0.05}, ${r * 0.6} ${r * 0.85}, 0 ${r * 0.85} C ${-r * 0.6} ${r * 0.85}, ${-r * 0.65} ${-r * 0.05}, 0 ${-r * 0.85} Z`}
          fill="#e0f2fe"
          stroke={sticker.color}
          strokeWidth={Math.max(2.5, r * 0.1)}
        />
      )}
      {sticker.kind === 'anger' && [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy], idx) => (
        <path
          key={idx}
          d={`M ${sx * r * 0.72} ${sy * r * 0.22} Q ${sx * r * 0.22} ${sy * r * 0.22} ${sx * r * 0.22} ${sy * r * 0.72}`}
          fill="none"
          stroke={sticker.color}
          strokeWidth={Math.max(3, r * 0.12)}
          strokeLinecap="round"
        />
      ))}
      {sticker.kind === 'sparkle' && (
        <polygon
          points={Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            const rad = i % 2 === 0 ? r * 0.9 : r * 0.25;
            return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
          }).join(' ')}
          fill={sticker.color}
        />
      )}
      {sticker.kind === 'shock' && [-2, -1, 0, 1, 2].map(i => (
        <polyline
          key={i}
          points={`${i * w * 0.16},${-h * 0.42} ${i * w * 0.16 + (i % 2 ? 4 : -4)},0 ${i * w * 0.16},${h * 0.42}`}
          fill="none"
          stroke={sticker.color}
          strokeWidth={Math.max(3, r * 0.11)}
          strokeLinecap="round"
        />
      ))}
      {sticker.kind === 'heart' && (
        <path
          d={`M 0 ${r * 0.75} C ${-r * 1.1} ${r * 0.1}, ${-r * 0.95} ${-r * 0.85}, 0 ${-r * 0.25} C ${r * 0.95} ${-r * 0.85}, ${r * 1.1} ${r * 0.1}, 0 ${r * 0.75} Z`}
          fill={sticker.color}
        />
      )}
      {(sticker.kind === 'exclamation' || sticker.kind === 'question') && (
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.round(r * 1.6)}
          fontWeight={900}
          fill={sticker.color}
          stroke="#ffffff"
          strokeWidth={Math.max(3, r * 0.14)}
          paintOrder="stroke"
        >
          {sticker.kind === 'exclamation' ? '!' : '?'}
        </text>
      )}
    </g>
  );
};

export const ComicCanvas: React.FC<ComicCanvasProps> = ({
  draft,
  activeTool,
  selection,
  zoom,
  brushColor,
  brushSize,
  brushOpacity,
  generatingPanelId,
  livePreviewImage,
  onSelect,
  onUpdatePanel,
  onAddPanel,
  onSliceAtLine,
  onCommitStroke,
  onAddBubbleAt,
  onAddTextAt,
  onAddStickerAt,
  onMoveBubble,
  onMoveBubbleTail,
  onMoveText,
  onMoveSticker,
}) => {
  useLanguage();
  const stageRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<DragAction | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number }>({});

  const pageW = draft.width;
  const pageH = draft.height;
  const displayW = Math.round(pageW * zoom);
  const displayH = Math.round(pageH * zoom);

  const sortedPanels = useMemo(
    () => [...draft.panels].sort((a, b) => a.zIndex - b.zIndex),
    [draft.panels],
  );

  // 将所有已保存笔迹 + 当前正在画的笔迹渲染到透明手绘 Canvas 层
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!draft.layers.drawing?.visible) return;
    const allStrokes = drag?.kind === 'stroke' ? [...draft.strokes, drag.stroke] : draft.strokes;
    for (const stroke of allStrokes) {
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
  }, [draft.strokes, draft.layers.drawing?.visible, drag, pageW, pageH]);

  const toNormalizedPoint = (clientX: number, clientY: number): ComicPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0.5, y: 0.5 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pt = toNormalizedPoint(event.clientX, event.clientY);

    if (activeTool === 'brush' || activeTool === 'eraser') {
      if (draft.layers.drawing?.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        kind: 'stroke',
        stroke: {
          id: `stroke_${Date.now()}`,
          tool: activeTool,
          color: brushColor,
          size: brushSize,
          opacity: brushOpacity,
          points: [pt],
        },
      });
      return;
    }

    if (activeTool === 'draw-panel') {
      if (draft.layers.panels?.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const snapped = snapComicPoint(pt, draft.panels, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      setDrag({ kind: 'draw-panel', startPoint: snapped.point, currentPoint: snapped.point });
      return;
    }

    if (activeTool === 'slice') {
      if (draft.layers.panels?.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind: 'slice', startPoint: pt, currentPoint: pt });
      return;
    }

    if (activeTool === 'bubble') {
      if (!draft.layers.bubbles?.locked) onAddBubbleAt(pt);
      return;
    }

    if (activeTool === 'text') {
      if (!draft.layers.bubbles?.locked) onAddTextAt(pt);
      return;
    }

    if (activeTool === 'sticker') {
      if (!draft.layers.stickers?.locked) onAddStickerAt(pt);
      return;
    }

    // select tool: 命中检测（按 zIndex 倒序命中顶层分镜格）
    if (draft.layers.panels?.visible) {
      for (let i = sortedPanels.length - 1; i >= 0; i--) {
        const panel = sortedPanels[i];
        if (hitTestPanel(pt, panel, pageW, pageH)) {
          onSelect({ kind: 'panel', id: panel.id });
          if (!draft.layers.panels?.locked && !panel.locked) {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            // 按住 Alt 拖动已填图格内构图平移；普通拖动移动画格位置
            if (event.altKey && panel.image?.url) {
              setDrag({
                kind: 'pan-image',
                panelId: panel.id,
                startPoint: pt,
                origOffsetX: panel.image.offsetX || 0,
                origOffsetY: panel.image.offsetY || 0,
              });
            } else {
              setDrag({
                kind: 'move-panel',
                panelId: panel.id,
                startPoint: pt,
                origPoints: panel.points.map(p => ({ ...p })),
              });
            }
          }
          return;
        }
      }
    }
    onSelect(null);
  };

  const handleStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const pt = toNormalizedPoint(event.clientX, event.clientY);

    if (drag.kind === 'stroke') {
      setDrag({ ...drag, stroke: { ...drag.stroke, points: [...drag.stroke.points, pt] } });
      return;
    }

    if (drag.kind === 'draw-panel') {
      const snapped = snapComicPoint(pt, draft.panels, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      setDrag({ ...drag, currentPoint: snapped.point });
      return;
    }

    if (drag.kind === 'slice') {
      // Shift 锁定水平/垂直/45°切线
      let next = pt;
      if (event.shiftKey) {
        const dx = pt.x - drag.startPoint.x;
        const dy = pt.y - drag.startPoint.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        next = { x: drag.startPoint.x + Math.cos(angle) * dist, y: drag.startPoint.y + Math.sin(angle) * dist };
      }
      setDrag({ ...drag, currentPoint: next });
      return;
    }

    if (drag.kind === 'vertex') {
      const siblings = draft.panels.filter(p => p.id !== drag.panelId);
      const snapped = snapComicPoint(pt, siblings, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      onUpdatePanel(drag.panelId, panel => ({
        ...panel,
        points: panel.points.map((v, idx) => (idx === drag.vertexIndex ? snapped.point : v)),
      }), false);
      return;
    }

    if (drag.kind === 'move-panel') {
      const dx = pt.x - drag.startPoint.x;
      const dy = pt.y - drag.startPoint.y;
      const siblings = draft.panels.filter(p => p.id !== drag.panelId);
      const firstMoved = { x: drag.origPoints[0].x + dx, y: drag.origPoints[0].y + dy };
      const snapped = snapComicPoint(firstMoved, siblings, draft.snapEnabled);
      const adjDx = snapped.point.x - drag.origPoints[0].x;
      const adjDy = snapped.point.y - drag.origPoints[0].y;
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      onUpdatePanel(drag.panelId, panel => ({
        ...panel,
        points: drag.origPoints.map(v => ({
          x: Math.min(0.99, Math.max(0.01, v.x + adjDx)),
          y: Math.min(0.99, Math.max(0.01, v.y + adjDy)),
        })),
      }), false);
      return;
    }

    if (drag.kind === 'pan-image') {
      const panel = draft.panels.find(p => p.id === drag.panelId);
      if (!panel) return;
      const bounds = getPanelBoundingBox(panel.points, 1, 1);
      const dx = (pt.x - drag.startPoint.x) / Math.max(0.05, bounds.width);
      const dy = (pt.y - drag.startPoint.y) / Math.max(0.05, bounds.height);
      onUpdatePanel(drag.panelId, current => current.image ? ({
        ...current,
        image: {
          ...current.image,
          offsetX: Math.max(-1.5, Math.min(1.5, drag.origOffsetX + dx)),
          offsetY: Math.max(-1.5, Math.min(1.5, drag.origOffsetY + dy)),
        },
      }) : current, false);
      return;
    }

    if (drag.kind === 'rotate-panel') {
      const angle = (Math.atan2((pt.y - drag.cy) * pageH, (pt.x - drag.cx) * pageW) * 180) / Math.PI;
      let nextRot = drag.origRotation + (angle - drag.startAngle);
      if (Math.abs(nextRot % 15) < 2) nextRot = Math.round(nextRot / 15) * 15;
      onUpdatePanel(drag.panelId, panel => ({ ...panel, rotation: Math.round(nextRot) }), false);
      return;
    }

    if (drag.kind === 'move-bubble') {
      onMoveBubble(drag.id, Math.min(0.98, Math.max(0.02, pt.x - drag.dx)), Math.min(0.98, Math.max(0.02, pt.y - drag.dy)), false);
      return;
    }
    if (drag.kind === 'move-bubble-tail') {
      onMoveBubbleTail(drag.id, Math.min(0.99, Math.max(0.01, pt.x)), Math.min(0.99, Math.max(0.01, pt.y)), false);
      return;
    }
    if (drag.kind === 'move-text') {
      onMoveText(drag.id, Math.min(0.98, Math.max(0.02, pt.x - drag.dx)), Math.min(0.98, Math.max(0.02, pt.y - drag.dy)), false);
      return;
    }
    if (drag.kind === 'move-sticker') {
      onMoveSticker(drag.id, Math.min(0.98, Math.max(0.02, pt.x - drag.dx)), Math.min(0.98, Math.max(0.02, pt.y - drag.dy)), false);
    }
  };

  const finishDrag = () => {
    if (!drag) return;
    if (drag.kind === 'stroke' && drag.stroke.points.length > 0) {
      onCommitStroke(drag.stroke);
    } else if (drag.kind === 'draw-panel') {
      const minX = Math.min(drag.startPoint.x, drag.currentPoint.x);
      const minY = Math.min(drag.startPoint.y, drag.currentPoint.y);
      const w = Math.abs(drag.currentPoint.x - drag.startPoint.x);
      const h = Math.abs(drag.currentPoint.y - drag.startPoint.y);
      if (w > 0.04 && h > 0.04) {
        onAddPanel(rectToPolygon(minX, minY, w, h));
      }
    } else if (drag.kind === 'slice') {
      if (Math.hypot(drag.currentPoint.x - drag.startPoint.x, drag.currentPoint.y - drag.startPoint.y) > 0.04) {
        onSliceAtLine(drag.startPoint, drag.currentPoint);
      }
    } else if (drag.kind === 'move-panel' || drag.kind === 'vertex' || drag.kind === 'rotate-panel' || drag.kind === 'pan-image') {
      onUpdatePanel(drag.panelId, panel => panel, true);
    } else if (drag.kind === 'move-bubble') {
      const b = draft.bubbles.find(item => item.id === drag.id);
      if (b) onMoveBubble(b.id, b.x, b.y, true);
    } else if (drag.kind === 'move-bubble-tail') {
      const b = draft.bubbles.find(item => item.id === drag.id);
      if (b) onMoveBubbleTail(b.id, b.tailX, b.tailY, true);
    } else if (drag.kind === 'move-text') {
      const txt = draft.texts.find(item => item.id === drag.id);
      if (txt) onMoveText(txt.id, txt.x, txt.y, true);
    } else if (drag.kind === 'move-sticker') {
      const st = draft.stickers.find(item => item.id === drag.id);
      if (st) onMoveSticker(st.id, st.x, st.y, true);
    }
    setDrag(null);
    setSnapGuide({});
  };

  const orderedLayers = (['panels', 'drawing', 'bubbles', 'stickers'] as ComicLayerId[])
    .filter(id => draft.layers[id]?.visible !== false)
    .sort((a, b) => (draft.layers[a]?.order ?? 0) - (draft.layers[b]?.order ?? 0));

  const selectedPanel = selection?.kind === 'panel'
    ? draft.panels.find(p => p.id === selection.id)
    : undefined;

  const cursorClass = activeTool === 'slice' || activeTool === 'draw-panel'
    ? 'cursor-crosshair'
    : activeTool === 'brush' || activeTool === 'eraser'
      ? 'cursor-crosshair'
      : activeTool === 'bubble' || activeTool === 'text' || activeTool === 'sticker'
        ? 'cursor-copy'
        : 'cursor-default';

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-gray-100/90 p-4 dark:bg-gray-950/90 md:p-8">
      <div
        ref={stageRef}
        role="application"
        aria-label={t('漫画分镜画布')}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        style={{
          width: displayW,
          height: displayH,
          backgroundColor: draft.backgroundColor || '#ffffff',
        }}
        className={`relative flex-none touch-none select-none overflow-visible rounded-sm shadow-2xl ring-1 ring-gray-300 dark:ring-gray-700 ${cursorClass}`}
      >
        {/* 主矢量与画面渲染层 */}
        <svg
          width={displayW}
          height={displayH}
          viewBox={`0 0 ${pageW} ${pageH}`}
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            {sortedPanels.map(panel => (
              <clipPath key={panel.id} id={`comic-clip-${panel.id}`}>
                <polygon points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')} />
              </clipPath>
            ))}
          </defs>

          {orderedLayers.map(layerId => {
            if (layerId === 'panels') {
              return (
                <g key="panels">
                  {sortedPanels.map(panel => {
                    const bounds = getPanelBoundingBox(panel.points, pageW, pageH);
                    const isSelected = selection?.kind === 'panel' && selection.id === panel.id;
                    const isGeneratingThis = generatingPanelId === panel.id;
                    const previewUrl = isGeneratingThis && livePreviewImage ? livePreviewImage : panel.image?.url;
                    const imgW = panel.image?.width || bounds.width;
                    const imgH = panel.image?.height || bounds.height;
                    const coverScale = Math.max(bounds.width / Math.max(1, imgW), bounds.height / Math.max(1, imgH)) * (panel.image?.scale || 1);
                    const drawW = imgW * coverScale;
                    const drawH = imgH * coverScale;
                    const drawX = bounds.cx - drawW / 2 + (panel.image?.offsetX || 0) * bounds.width;
                    const drawY = bounds.cy - drawH / 2 + (panel.image?.offsetY || 0) * bounds.height;

                    return (
                      <g
                        key={panel.id}
                        transform={panel.rotation ? `rotate(${panel.rotation} ${bounds.cx} ${bounds.cy})` : undefined}
                      >
                        <polygon
                          points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')}
                          fill={panel.backgroundColor || '#f8fafc'}
                        />
                        {previewUrl && (
                          <g clipPath={`url(#comic-clip-${panel.id})`}>
                            <image
                              href={previewUrl}
                              x={isGeneratingThis && livePreviewImage ? bounds.minX : drawX}
                              y={isGeneratingThis && livePreviewImage ? bounds.minY : drawY}
                              width={isGeneratingThis && livePreviewImage ? bounds.width : drawW}
                              height={isGeneratingThis && livePreviewImage ? bounds.height : drawH}
                              preserveAspectRatio="xMidYMid slice"
                            />
                          </g>
                        )}
                        {/* 空格提示序号 */}
                        {!previewUrl && (
                          <text
                            x={bounds.cx}
                            y={bounds.cy}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={Math.max(16, Math.min(34, bounds.width * 0.08))}
                            fontWeight={700}
                            fill="#94a3b8"
                          >
                            {panel.name}
                          </text>
                        )}
                        {/* 画格边框 */}
                        <polygon
                          points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')}
                          fill="none"
                          stroke={isSelected ? '#4f46e5' : (panel.borderColor || '#111827')}
                          strokeWidth={isSelected ? Math.max(panel.borderWidth, 4) : panel.borderWidth}
                          strokeLinejoin="miter"
                        />
                        {/* 锚点预览圆点（选中格时显示） */}
                        {isSelected && panel.anchors.filter(a => a.enabled).map((anchor, idx) => {
                          const ax = bounds.minX + anchor.x * bounds.width;
                          const ay = bounds.minY + anchor.y * bounds.height;
                          const color = anchor.kind === 'character' ? '#2563eb'
                            : anchor.kind === 'scene' ? '#059669'
                              : anchor.kind === 'bubble' ? '#d97706'
                                : '#9333ea';
                          return (
                            <g key={anchor.id}>
                              <circle cx={ax} cy={ay} r={11} fill={color} stroke="#ffffff" strokeWidth={2.5} />
                              <text x={ax} y={ay} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#ffffff">
                                {idx + 1}
                              </text>
                            </g>
                          );
                        })}
                        {isGeneratingThis && (
                          <g clipPath={`url(#comic-clip-${panel.id})`}>
                            <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="rgba(79,70,229,0.12)" />
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            }

            if (layerId === 'bubbles') {
              return (
                <g key="bubbles">
                  {draft.bubbles.map(bubble => {
                    const cx = bubble.x * pageW;
                    const cy = bubble.y * pageH;
                    const rx = (bubble.width * pageW) / 2;
                    const ry = (bubble.height * pageH) / 2;
                    const tx = bubble.tailX * pageW;
                    const ty = bubble.tailY * pageH;
                    const angle = Math.atan2(ty - cy, tx - cx);
                    const baseW = Math.min(rx, ry) * 0.22;
                    const selected = selection?.kind === 'bubble' && selection.id === bubble.id;
                    return (
                      <g
                        key={bubble.id}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={event => {
                          if (activeTool !== 'select' || draft.layers.bubbles?.locked) return;
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          onSelect({ kind: 'bubble', id: bubble.id });
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-bubble', id: bubble.id, dx: pt.x - bubble.x, dy: pt.y - bubble.y });
                        }}
                      >
                        {bubble.hasTail && bubble.shape !== 'caption' && bubble.shape !== 'thought' && (
                          <polygon
                            points={`${cx + Math.cos(angle - Math.PI / 2) * baseW},${cy + Math.sin(angle - Math.PI / 2) * baseW} ${tx},${ty} ${cx + Math.cos(angle + Math.PI / 2) * baseW},${cy + Math.sin(angle + Math.PI / 2) * baseW}`}
                            fill={bubble.fillColor}
                            stroke={selected ? '#4f46e5' : bubble.strokeColor}
                            strokeWidth={bubble.strokeWidth}
                          />
                        )}
                        {bubble.hasTail && bubble.shape === 'thought' && [0.65, 0.85].map((ratio, idx) => (
                          <circle
                            key={idx}
                            cx={cx + (tx - cx) * ratio}
                            cy={cy + (ty - cy) * ratio}
                            r={idx === 0 ? Math.min(rx, ry) * 0.16 : Math.min(rx, ry) * 0.1}
                            fill={bubble.fillColor}
                            stroke={selected ? '#4f46e5' : bubble.strokeColor}
                            strokeWidth={bubble.strokeWidth}
                          />
                        ))}
                        <g transform={bubble.rotation ? `rotate(${bubble.rotation} ${cx} ${cy})` : undefined}>
                          <path
                            d={bubblePathD(cx, cy, rx, ry, bubble.shape)}
                            fill={bubble.fillColor}
                            stroke={selected ? '#4f46e5' : bubble.strokeColor}
                            strokeWidth={selected ? Math.max(bubble.strokeWidth, 3) : bubble.strokeWidth}
                          />
                          <foreignObject x={cx - rx * 0.8} y={cy - ry * 0.8} width={rx * 1.6} height={ry * 1.6}>
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                color: bubble.textColor,
                                fontSize: `${bubble.fontSize}px`,
                                fontWeight: 600,
                                lineHeight: 1.25,
                                writingMode: bubble.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                                wordBreak: 'break-word',
                                overflow: 'hidden',
                                userSelect: 'none',
                              }}
                            >
                              {bubble.text}
                            </div>
                          </foreignObject>
                        </g>
                        {/* 气泡尾巴尖端可拖拽控制点 */}
                        {selected && bubble.hasTail && bubble.shape !== 'caption' && (
                          <circle
                            cx={tx}
                            cy={ty}
                            r={9}
                            fill="#f59e0b"
                            stroke="#ffffff"
                            strokeWidth={2.5}
                            className="cursor-grab"
                            onPointerDown={event => {
                              event.stopPropagation();
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({ kind: 'move-bubble-tail', id: bubble.id });
                            }}
                          />
                        )}
                      </g>
                    );
                  })}

                  {draft.texts.map(item => {
                    const cx = item.x * pageW;
                    const cy = item.y * pageH;
                    const selected = selection?.kind === 'text' && selection.id === item.id;
                    return (
                      <g
                        key={item.id}
                        transform={`translate(${cx} ${cy}) rotate(${item.rotation})`}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={event => {
                          if (activeTool !== 'select' || draft.layers.bubbles?.locked) return;
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          onSelect({ kind: 'text', id: item.id });
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-text', id: item.id, dx: pt.x - item.x, dy: pt.y - item.y });
                        }}
                      >
                        <text
                          x={0}
                          y={0}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={item.fontSize}
                          fontWeight={item.bold ? 800 : 600}
                          fill={item.color}
                          stroke={item.strokeColor || undefined}
                          strokeWidth={item.strokeColor ? Math.max(2, item.fontSize * 0.14) : 0}
                          paintOrder="stroke"
                          style={{ writingMode: item.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb' }}
                        >
                          {item.text || t('双击编辑文字')}
                        </text>
                        {selected && (
                          <circle cx={0} cy={-item.fontSize * 0.9} r={6} fill="#4f46e5" stroke="#fff" strokeWidth={2} />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            }

            if (layerId === 'stickers') {
              return (
                <g key="stickers">
                  {draft.stickers.map(sticker => {
                    const selected = selection?.kind === 'sticker' && selection.id === sticker.id;
                    const cx = sticker.x * pageW;
                    const cy = sticker.y * pageH;
                    const w = sticker.width * pageW;
                    const h = sticker.height * pageH;
                    return (
                      <g
                        key={sticker.id}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={event => {
                          if (activeTool !== 'select' || draft.layers.stickers?.locked) return;
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          onSelect({ kind: 'sticker', id: sticker.id });
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-sticker', id: sticker.id, dx: pt.x - sticker.x, dy: pt.y - sticker.y });
                        }}
                      >
                        {renderStickerSvg(sticker, pageW, pageH)}
                        {selected && (
                          <rect
                            x={cx - w / 2}
                            y={cy - h / 2}
                            width={w}
                            height={h}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            }
            return null;
          })}

          {/* 吸附参考线 */}
          {snapGuide.x !== undefined && (
            <line x1={snapGuide.x * pageW} y1={0} x2={snapGuide.x * pageW} y2={pageH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6 4" />
          )}
          {snapGuide.y !== undefined && (
            <line x1={0} y1={snapGuide.y * pageH} x2={pageW} y2={snapGuide.y * pageH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6 4" />
          )}

          {/* 自由拉框实时预览 */}
          {drag?.kind === 'draw-panel' && (
            <rect
              x={Math.min(drag.startPoint.x, drag.currentPoint.x) * pageW}
              y={Math.min(drag.startPoint.y, drag.currentPoint.y) * pageH}
              width={Math.abs(drag.currentPoint.x - drag.startPoint.x) * pageW}
              height={Math.abs(drag.currentPoint.y - drag.startPoint.y) * pageH}
              fill="rgba(79,70,229,0.12)"
              stroke="#4f46e5"
              strokeWidth={3}
              strokeDasharray="8 5"
            />
          )}

          {/* 两点一刀切分预览线 */}
          {drag?.kind === 'slice' && (
            <g>
              <line
                x1={drag.startPoint.x * pageW}
                y1={drag.startPoint.y * pageH}
                x2={drag.currentPoint.x * pageW}
                y2={drag.currentPoint.y * pageH}
                stroke="#ef4444"
                strokeWidth={3.5}
                strokeDasharray="10 6"
              />
              <circle cx={drag.startPoint.x * pageW} cy={drag.startPoint.y * pageH} r={6} fill="#ef4444" />
              <circle cx={drag.currentPoint.x * pageW} cy={drag.currentPoint.y * pageH} r={6} fill="#ef4444" />
            </g>
          )}
        </svg>

        {/* 手绘笔刷/橡皮透明层 */}
        <canvas
          ref={drawCanvasRef}
          width={pageW}
          height={pageH}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{
            zIndex: (draft.layers.drawing?.order ?? 1) > (draft.layers.panels?.order ?? 0) ? 10 : 1,
          }}
        />

        {/* 选中分镜格顶点拖拽把手（支持任意斜角）与旋转把手（桌面端显示） */}
        {activeTool === 'select' && selectedPanel && !selectedPanel.locked && !draft.layers.panels?.locked && (() => {
          const bounds = getPanelBoundingBox(selectedPanel.points, displayW, displayH);
          return (
            <div className="pointer-events-none absolute inset-0 z-20 hidden md:block">
              {selectedPanel.points.map((vertex, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={t('拖动第 {0} 个顶点调斜角', [idx + 1])}
                  title={t('拖动调整画格斜角顶点')}
                  onPointerDown={event => {
                    event.stopPropagation();
                    stageRef.current?.setPointerCapture?.(event.pointerId);
                    setDrag({ kind: 'vertex', panelId: selectedPanel.id, vertexIndex: idx });
                  }}
                  style={{
                    left: `${vertex.x * 100}%`,
                    top: `${vertex.y * 100}%`,
                  }}
                  className="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-indigo-600 bg-white shadow-sm hover:scale-125"
                />
              ))}
              {/* 顶部旋转手柄 */}
              <button
                type="button"
                aria-label={t('旋转分镜格')}
                title={t('拖动旋转分镜格')}
                onPointerDown={event => {
                  event.stopPropagation();
                  const pt = toNormalizedPoint(event.clientX, event.clientY);
                  const normBounds = getPanelBoundingBox(selectedPanel.points, 1, 1);
                  const startAngle = (Math.atan2((pt.y - normBounds.cy) * pageH, (pt.x - normBounds.cx) * pageW) * 180) / Math.PI;
                  stageRef.current?.setPointerCapture?.(event.pointerId);
                  setDrag({
                    kind: 'rotate-panel',
                    panelId: selectedPanel.id,
                    cx: normBounds.cx,
                    cy: normBounds.cy,
                    startAngle,
                    origRotation: selectedPanel.rotation || 0,
                  });
                }}
                style={{
                  left: `${bounds.cx}px`,
                  top: `${Math.max(-22, bounds.minY - 22)}px`,
                }}
                className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-indigo-600 bg-indigo-50 text-[10px] font-bold text-indigo-700 shadow-sm hover:scale-110"
              >
                ↻
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
