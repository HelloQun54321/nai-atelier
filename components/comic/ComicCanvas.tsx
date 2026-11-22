import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Magnet, Maximize2, MessageCircle, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import {
  clampAnchorCoord,
  doesSegmentIntersectPolygon,
  getPanelBoundingBox,
  hitTestPanel,
  rectToPolygon,
  rotatePointAround,
  snapComicPoint,
} from '../../services/comic/comicGeometry';
import {
  buildComicBubbleRenderModel,
  COMIC_BUBBLE_SHAPES,
  computeAutoFitFontSize,
  getBubbleShapeMeta,
  resolveComicFont,
  seededUnit,
} from '../../services/comic/comicArtwork';
import {
  resolveActiveDrawingLayerId,
  resolveEffectiveLayerProps,
  syncComicLayerStack,
} from '../../services/comic/comicLayers';
import type { ComicAiZonePlan } from '../../services/comic/comicAiPageEngine';
import { getGuidePanelPolygon } from '../../services/comic/comicLayoutTemplateRenderer';
import type { ComicBubbleCandidate } from '../../services/comic/comicBubbleDetector';
import { clampInpaintRect, type ComicInpaintDraft, type ComicInpaintRect } from '../../services/comic/comicInpaintEngine';
import type {
  ComicAnchor,
  ComicBlendMode,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicImageLayerItem,
  ComicPageDraft,
  ComicPanel,
  ComicPoint,
  ComicSelection,
  ComicStickerItem,
  ComicStroke,
  ComicTool,
} from '../../services/comic/comicTypes';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';

interface ComicCanvasProps {
  draft: ComicPageDraft;
  aiZonePlan?: ComicAiZonePlan;
  inpaintDraft?: ComicInpaintDraft | null;
  bubbleCandidates?: ComicBubbleCandidate[] | null;
  comparingOriginalAiImage?: boolean;
  activeTool: ComicTool;
  selection: ComicSelection;
  zoom: number;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  generatingPanelId?: string | null;
  generatingAiPage?: boolean;
  generatingAiZoneIndex?: 0 | 1 | null;
  livePreviewImage?: string | null;
  onSelect: (selection: ComicSelection) => void;
  onZoomChange: (nextZoom: number) => void;
  onZoomFit: () => void;
  onToggleSnap: () => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onMoveAiAnchor?: (anchorId: string, x: number, y: number, commit?: boolean) => void;
  onUpdateAiAnchor?: (anchorId: string, updater: (anchor: ComicAnchor) => ComicAnchor, commit?: boolean) => void;
  onDeleteAiAnchor?: (anchorId: string) => void;
  onConvertAnchorBubbleToVector?: (source: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
  onUpdateGuidePanel?: (guideId: string, patch: { x: number; y: number; width: number; height: number }, commit?: boolean) => void;
  onUpdateBreakoutZone?: (zoneId: string, patch: { x: number; y: number; width: number; height: number }, commit?: boolean) => void;
  onToggleBubbleCandidate?: (candidateId: string) => void;
  onWheelScalePanelImage?: (panelId: string, delta: number) => void;
  onChangeInpaintRect?: (rect: ComicInpaintRect) => void;
  onMoveInpaintAnchor?: (anchorId: string, x: number, y: number) => void;
  onAddPanel: (points: ComicPoint[]) => void;
  onSliceAtLine: (start: ComicPoint, end: ComicPoint) => void;
  onCommitStroke: (stroke: ComicStroke, drawingLayerId?: string) => void;
  onAddBubbleAt: (point: ComicPoint) => void;
  onAddTextAt: (point: ComicPoint) => void;
  onAddStickerAt: (point: ComicPoint) => void;
  onUpdateBubble?: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onDuplicateBubble?: (id: string) => void;
  onDeleteBubble?: (id: string) => void;
  onMoveBubble: (id: string, x: number, y: number, commit?: boolean) => void;
  onResizeBubble: (id: string, width: number, height: number, commit?: boolean) => void;
  onEditBubbleText: (id: string, text: string, commit?: boolean) => void;
  onMoveBubbleTail: (id: string, tailX: number, tailY: number, commit?: boolean) => void;
  onMoveText: (id: string, x: number, y: number, commit?: boolean) => void;
  onEditFreeText: (id: string, text: string, commit?: boolean) => void;
  onMoveSticker: (id: string, x: number, y: number, commit?: boolean) => void;
  onResizeSticker: (id: string, width: number, height: number, commit?: boolean) => void;
  onUpdateImageLayer?: (id: string, updater: (item: ComicImageLayerItem) => ComicImageLayerItem, commit?: boolean) => void;
}

type ResizeHandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragAction =
  | { kind: 'pan-viewport'; startClientX: number; startClientY: number; startScrollLeft: number; startScrollTop: number }
  | { kind: 'move-panel'; panelId: string; startPoint: ComicPoint; origPoints: ComicPoint[] }
  | { kind: 'pan-image'; panelId: string; startPoint: ComicPoint; origOffsetX: number; origOffsetY: number }
  | { kind: 'vertex'; panelId: string; vertexIndex: number }
  | { kind: 'rotate-panel'; panelId: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'move-anchor'; panelId: string; anchorId: string }
  | { kind: 'resize-panel-anchor-bubble'; panelId: string; anchorId: string; cx: number; cy: number }
  | { kind: 'move-ai-anchor'; anchorId: string }
  | { kind: 'resize-ai-anchor-bubble'; anchorId: string; cx: number; cy: number }
  | { kind: 'move-guide-panel'; guideId: string; dx: number; dy: number; width: number; height: number }
  | { kind: 'resize-guide-panel'; guideId: string; origX: number; origY: number }
  | { kind: 'move-breakout'; zoneId: string; dx: number; dy: number; width: number; height: number }
  | { kind: 'resize-breakout'; zoneId: string; origX: number; origY: number }
  | { kind: 'draw-inpaint'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'move-inpaint'; dx: number; dy: number; width: number; height: number }
  | { kind: 'resize-inpaint'; origX: number; origY: number }
  | { kind: 'move-inpaint-anchor'; anchorId: string }
  | { kind: 'draw-panel'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'slice'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'move-bubble'; id: string; dx: number; dy: number }
  | { kind: 'resize-bubble'; id: string; handle: ResizeHandleDir; startPoint: ComicPoint; origX: number; origY: number; origW: number; origH: number }
  | { kind: 'rotate-bubble'; id: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'move-bubble-tail'; id: string }
  | { kind: 'move-text'; id: string; dx: number; dy: number }
  | { kind: 'move-sticker'; id: string; dx: number; dy: number }
  | { kind: 'resize-sticker'; id: string; origX: number; origY: number }
  | { kind: 'move-image-layer'; id: string; dx: number; dy: number }
  | { kind: 'resize-image-layer'; id: string; origX: number; origY: number }
  | { kind: 'stroke'; drawingLayerId: string; stroke: ComicStroke };

type InlineEditState =
  | { kind: 'bubble'; id: string; value: string }
  | { kind: 'text'; id: string; value: string }
  | { kind: 'ai-anchor-bubble'; anchorId: string; value: string }
  | { kind: 'panel-anchor-bubble'; panelId: string; anchorId: string; value: string }
  | null;

const blendModeToCss = (mode: ComicBlendMode): React.CSSProperties['mixBlendMode'] =>
  mode === 'normal' ? 'normal' : mode;

/** 独立手绘图层渲染组件：支持每层独立橡皮擦（destination-out）、不透明度与 PS 混合模式。 */
const DrawingLayerCanvas: React.FC<{
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

const renderStickerSvg = (sticker: ComicStickerItem, pageW: number, pageH: number) => {
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

export const ComicCanvas: React.FC<ComicCanvasProps> = ({
  draft,
  aiZonePlan,
  inpaintDraft,
  bubbleCandidates,
  comparingOriginalAiImage,
  activeTool,
  selection,
  zoom,
  brushColor,
  brushSize,
  brushOpacity,
  generatingPanelId,
  generatingAiPage,
  generatingAiZoneIndex,
  livePreviewImage,
  onSelect,
  onZoomChange,
  onZoomFit,
  onToggleSnap,
  onUpdatePanel,
  onMoveAiAnchor,
  onUpdateAiAnchor,
  onDeleteAiAnchor,
  onConvertAnchorBubbleToVector,
  onUpdateGuidePanel,
  onUpdateBreakoutZone,
  onToggleBubbleCandidate,
  onWheelScalePanelImage,
  onChangeInpaintRect,
  onMoveInpaintAnchor,
  onAddPanel,
  onSliceAtLine,
  onCommitStroke,
  onAddBubbleAt,
  onAddTextAt,
  onAddStickerAt,
  onUpdateBubble,
  onDuplicateBubble,
  onDeleteBubble,
  onMoveBubble,
  onResizeBubble,
  onEditBubbleText,
  onMoveBubbleTail,
  onMoveText,
  onEditFreeText,
  onMoveSticker,
  onResizeSticker,
  onUpdateImageLayer,
}) => {
  useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragAction | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number }>({});
  const [spacePressed, setSpacePressed] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false);

  const syncedDraft = useMemo(() => syncComicLayerStack(draft), [draft]);
  const layerStack = useMemo(() => syncedDraft.layerStack || [], [syncedDraft.layerStack]);
  const panelsLayerProps = useMemo(() => {
    const node = layerStack.find(n => n.kind === 'panels');
    return node ? resolveEffectiveLayerProps(node, layerStack) : { visible: true, locked: false, opacity: 1, blendMode: 'normal' as ComicBlendMode, depth: 0 };
  }, [layerStack]);

  // 切换选中目标时自动收起气泡快捷框形浮层
  useEffect(() => {
    setShapePopoverOpen(false);
  }, [selection?.kind, selection && 'id' in selection ? selection.id : '']);

  const pageW = draft.width;
  const pageH = draft.height;
  const displayW = Math.round(pageW * zoom);
  const displayH = Math.round(pageH * zoom);

  const sortedPanels = useMemo(
    () => [...draft.panels].sort((a, b) => a.zIndex - b.zIndex),
    [draft.panels],
  );

  // Space 空格键平移画布（编辑文字时禁用）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Ctrl/Cmd + 滚轮缩放画布；「格内移图 (M)」或 Alt + 滚轮直接微调选中画格的图内缩放
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (
        (activeTool === 'frame-image' || event.altKey)
        && draft.creationMode === 'manual'
        && selection?.kind === 'panel'
        && onWheelScalePanelImage
      ) {
        const panel = draft.panels.find(p => p.id === selection.id);
        if (panel?.image?.url) {
          event.preventDefault();
          const delta = event.deltaY < 0 ? 0.08 : -0.08;
          onWheelScalePanelImage(panel.id, delta);
          return;
        }
      }
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      onZoomChange(Math.max(0.25, Math.min(3, Number((zoom + delta).toFixed(2)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoomChange, activeTool, draft.creationMode, draft.panels, selection, onWheelScalePanelImage]);

  const toNormalizedPoint = (clientX: number, clientY: number): ComicPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0.5, y: 0.5 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const commitInlineEdit = () => {
    if (!inlineEdit) return;
    if (inlineEdit.kind === 'bubble') {
      onEditBubbleText(inlineEdit.id, inlineEdit.value, true);
    } else if (inlineEdit.kind === 'text') {
      onEditFreeText(inlineEdit.id, inlineEdit.value, true);
    } else if (inlineEdit.kind === 'ai-anchor-bubble') {
      onUpdateAiAnchor?.(inlineEdit.anchorId, cur => ({ ...cur, bubbleText: inlineEdit.value }), true);
    } else if (inlineEdit.kind === 'panel-anchor-bubble') {
      onUpdatePanel(inlineEdit.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.map(a => a.id === inlineEdit.anchorId ? { ...a, bubbleText: inlineEdit.value } : a),
      }), true);
    }
    setInlineEdit(null);
  };

  const isPanningMode = spacePressed || activeTool === 'hand';

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningMode || event.button === 1) {
      const scroller = scrollRef.current;
      if (!scroller) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        kind: 'pan-viewport',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: scroller.scrollLeft,
        startScrollTop: scroller.scrollTop,
      });
      return;
    }
    if (activeTool === 'zoom' && event.button === 0) {
      event.preventDefault();
      const delta = event.altKey ? -0.15 : 0.15;
      onZoomChange(Math.max(0.25, Math.min(3, Number((zoom + delta).toFixed(2)))));
    }
  };

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag?.kind === 'pan-viewport') {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startClientX);
      scroller.scrollTop = drag.startScrollTop - (event.clientY - drag.startClientY);
    }
  };

  const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningMode || activeTool === 'zoom' || event.button === 1) return;
    if (event.button !== 0) return;
    if (inlineEdit) commitInlineEdit();
    const pt = toNormalizedPoint(event.clientX, event.clientY);

    // AI 整页局部重绘模式：直接在画布上框选新的局部重绘矩形
    if (draft.creationMode === 'ai-page' && inpaintDraft && activeTool === 'select') {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind: 'draw-inpaint', startPoint: pt, currentPoint: pt });
      return;
    }

    if (activeTool === 'brush' || activeTool === 'eraser') {
      const targetDrawingId = resolveActiveDrawingLayerId(syncedDraft, selection);
      if (!targetDrawingId) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        kind: 'stroke',
        drawingLayerId: targetDrawingId,
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
      if (draft.creationMode !== 'manual' || panelsLayerProps.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const snapped = snapComicPoint(pt, draft.panels, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      setDrag({ kind: 'draw-panel', startPoint: snapped.point, currentPoint: snapped.point });
      return;
    }

    if (activeTool === 'slice') {
      // 同时支持手动逐格与 AI 整页模式的两点一刀斜切分镜
      if (panelsLayerProps.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind: 'slice', startPoint: pt, currentPoint: pt });
      return;
    }

    if (activeTool === 'bubble') {
      onAddBubbleAt(pt);
      return;
    }

    if (activeTool === 'text') {
      onAddTextAt(pt);
      return;
    }

    if (activeTool === 'sticker') {
      onAddStickerAt(pt);
      return;
    }

    if (draft.creationMode === 'manual' && panelsLayerProps.visible) {
      for (let i = sortedPanels.length - 1; i >= 0; i--) {
        const panel = sortedPanels[i];
        if (hitTestPanel(pt, panel, pageW, pageH)) {
          onSelect({ kind: 'panel', id: panel.id });
          if (!panelsLayerProps.locked && !panel.locked) {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            // 专门的「格内移图 (M)」或选择工具下按住 Alt 直接平移图内构图
            if ((activeTool === 'frame-image' || event.altKey) && panel.image?.url) {
              setDrag({
                kind: 'pan-image',
                panelId: panel.id,
                startPoint: pt,
                origOffsetX: panel.image.offsetX || 0,
                origOffsetY: panel.image.offsetY || 0,
              });
            } else if (activeTool === 'select') {
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
    if (activeTool === 'select') onSelect(null);
  };

  const handleStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.kind === 'pan-viewport') return;
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
      const targetPanel = draft.panels.find(p => p.id === drag.panelId);
      const siblings = draft.panels.filter(p => p.id !== drag.panelId);
      let localPt = pt;
      if (targetPanel?.rotation) {
        const bounds = getPanelBoundingBox(targetPanel.points, 1, 1);
        localPt = rotatePointAround(pt, { x: bounds.cx, y: bounds.cy }, -targetPanel.rotation, pageW / pageH);
      }
      const snapped = snapComicPoint(localPt, siblings, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      onUpdatePanel(drag.panelId, panel => ({
        ...panel,
        points: panel.points.map((v, idx) => (idx === drag.vertexIndex ? snapped.point : v)),
      }), false);
      return;
    }

    if (drag.kind === 'move-anchor') {
      const panel = draft.panels.find(p => p.id === drag.panelId);
      if (!panel) return;
      const bounds = getPanelBoundingBox(panel.points, 1, 1);
      const localPt = panel.rotation
        ? rotatePointAround(pt, { x: bounds.cx, y: bounds.cy }, -panel.rotation, pageW / pageH)
        : pt;
      const nx = clampAnchorCoord((localPt.x - bounds.minX) / Math.max(0.01, bounds.width));
      const ny = clampAnchorCoord((localPt.y - bounds.minY) / Math.max(0.01, bounds.height));
      onUpdatePanel(drag.panelId, current => ({
        ...current,
        anchors: current.anchors.map(a => a.id === drag.anchorId ? { ...a, x: nx, y: ny } : a),
      }), false);
      return;
    }

    if (drag.kind === 'move-ai-anchor') {
      onMoveAiAnchor?.(drag.anchorId, clampAnchorCoord(pt.x), clampAnchorCoord(pt.y), false);
      return;
    }

    if (drag.kind === 'move-guide-panel') {
      const x = Math.max(0.02, Math.min(0.98 - drag.width, pt.x - drag.dx));
      const y = Math.max(0.02, Math.min(0.98 - drag.height, pt.y - drag.dy));
      onUpdateGuidePanel?.(drag.guideId, {
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        width: drag.width,
        height: drag.height,
      }, false);
      return;
    }

    if (drag.kind === 'resize-guide-panel') {
      const width = Math.max(0.12, Math.min(0.98 - drag.origX, pt.x - drag.origX));
      const height = Math.max(0.10, Math.min(0.98 - drag.origY, pt.y - drag.origY));
      onUpdateGuidePanel?.(drag.guideId, {
        x: drag.origX,
        y: drag.origY,
        width: Math.round(width * 1000) / 1000,
        height: Math.round(height * 1000) / 1000,
      }, false);
      return;
    }

    if (drag.kind === 'move-breakout') {
      const x = Math.max(0.01, Math.min(0.99 - drag.width, pt.x - drag.dx));
      const y = Math.max(0.01, Math.min(0.99 - drag.height, pt.y - drag.dy));
      onUpdateBreakoutZone?.(drag.zoneId, {
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        width: drag.width,
        height: drag.height,
      }, false);
      return;
    }

    if (drag.kind === 'resize-breakout') {
      const width = Math.max(0.1, Math.min(0.99 - drag.origX, pt.x - drag.origX));
      const height = Math.max(0.1, Math.min(0.99 - drag.origY, pt.y - drag.origY));
      onUpdateBreakoutZone?.(drag.zoneId, {
        x: drag.origX,
        y: drag.origY,
        width: Math.round(width * 1000) / 1000,
        height: Math.round(height * 1000) / 1000,
      }, false);
      return;
    }

    if (drag.kind === 'draw-inpaint') {
      const next = {
        x: Math.min(drag.startPoint.x, pt.x),
        y: Math.min(drag.startPoint.y, pt.y),
        width: Math.abs(pt.x - drag.startPoint.x),
        height: Math.abs(pt.y - drag.startPoint.y),
      };
      setDrag({ ...drag, currentPoint: pt });
      if (next.width > 0.04 && next.height > 0.04) {
        onChangeInpaintRect?.(clampInpaintRect(next));
      }
      return;
    }

    if (drag.kind === 'move-inpaint') {
      onChangeInpaintRect?.(clampInpaintRect({
        x: pt.x - drag.dx,
        y: pt.y - drag.dy,
        width: drag.width,
        height: drag.height,
      }));
      return;
    }

    if (drag.kind === 'resize-inpaint') {
      onChangeInpaintRect?.(clampInpaintRect({
        x: drag.origX,
        y: drag.origY,
        width: Math.max(0.08, pt.x - drag.origX),
        height: Math.max(0.08, pt.y - drag.origY),
      }));
      return;
    }

    if (drag.kind === 'move-inpaint-anchor' && inpaintDraft) {
      const r = inpaintDraft.rect;
      const nx = clampAnchorCoord((pt.x - r.x) / Math.max(0.01, r.width));
      const ny = clampAnchorCoord((pt.y - r.y) / Math.max(0.01, r.height));
      onMoveInpaintAnchor?.(drag.anchorId, nx, ny);
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
    if (drag.kind === 'resize-bubble') {
      // PS 8 方向自由变换缩放（左右边只改宽，上下边只改高，四角同时改宽高）
      const h = drag.handle;
      const dx = pt.x - drag.startPoint.x;
      const dy = pt.y - drag.startPoint.y;
      let nextW = drag.origW;
      let nextH = drag.origH;
      if (h.includes('e')) nextW = Math.min(0.9, Math.max(0.08, drag.origW + dx * 2));
      if (h.includes('w')) nextW = Math.min(0.9, Math.max(0.08, drag.origW - dx * 2));
      if (h.includes('s')) nextH = Math.min(0.75, Math.max(0.06, drag.origH + dy * 2));
      if (h.includes('n')) nextH = Math.min(0.75, Math.max(0.06, drag.origH - dy * 2));
      onResizeBubble(drag.id, Number(nextW.toFixed(3)), Number(nextH.toFixed(3)), false);
      return;
    }
    if (drag.kind === 'rotate-bubble') {
      const angle = (Math.atan2((pt.y - drag.cy) * pageH, (pt.x - drag.cx) * pageW) * 180) / Math.PI;
      let nextRot = drag.origRotation + (angle - drag.startAngle);
      if (Math.abs(nextRot % 15) < 2.5) nextRot = Math.round(nextRot / 15) * 15;
      nextRot = Math.max(-45, Math.min(45, Math.round(nextRot)));
      onUpdateBubble?.(drag.id, cur => ({ ...cur, rotation: nextRot }), false);
      return;
    }
    if (drag.kind === 'move-bubble-tail') {
      onMoveBubbleTail(drag.id, Math.min(0.99, Math.max(0.01, pt.x)), Math.min(0.99, Math.max(0.01, pt.y)), false);
      return;
    }
    if (drag.kind === 'resize-ai-anchor-bubble') {
      const nextW = Math.min(0.85, Math.max(0.1, Math.abs(pt.x - drag.cx) * 2));
      const nextH = Math.min(0.6, Math.max(0.07, Math.abs(pt.y - drag.cy) * 2));
      onUpdateAiAnchor?.(drag.anchorId, cur => ({
        ...cur,
        bubbleWidth: Number(nextW.toFixed(3)),
        bubbleHeight: Number(nextH.toFixed(3)),
      }), false);
      return;
    }
    if (drag.kind === 'resize-panel-anchor-bubble') {
      const nextW = Math.min(0.85, Math.max(0.1, Math.abs(pt.x - drag.cx) * 2));
      const nextH = Math.min(0.6, Math.max(0.07, Math.abs(pt.y - drag.cy) * 2));
      onUpdatePanel(drag.panelId, panel => ({
        ...panel,
        anchors: panel.anchors.map(a => a.id === drag.anchorId ? {
          ...a,
          bubbleWidth: Number(nextW.toFixed(3)),
          bubbleHeight: Number(nextH.toFixed(3)),
        } : a),
      }), false);
      return;
    }
    if (drag.kind === 'move-image-layer') {
      onUpdateImageLayer?.(drag.id, cur => ({
        ...cur,
        x: Math.min(0.98, Math.max(0.02, pt.x - drag.dx)),
        y: Math.min(0.98, Math.max(0.02, pt.y - drag.dy)),
      }), false);
      return;
    }
    if (drag.kind === 'resize-image-layer') {
      const nextW = Math.min(1, Math.max(0.06, Math.abs(pt.x - drag.origX) * 2));
      const nextH = Math.min(1, Math.max(0.06, Math.abs(pt.y - drag.origY) * 2));
      onUpdateImageLayer?.(drag.id, cur => ({ ...cur, width: Number(nextW.toFixed(3)), height: Number(nextH.toFixed(3)) }), false);
      return;
    }
    if (drag.kind === 'move-text') {
      onMoveText(drag.id, Math.min(0.98, Math.max(0.02, pt.x - drag.dx)), Math.min(0.98, Math.max(0.02, pt.y - drag.dy)), false);
      return;
    }
    if (drag.kind === 'move-sticker') {
      onMoveSticker(drag.id, Math.min(0.98, Math.max(0.02, pt.x - drag.dx)), Math.min(0.98, Math.max(0.02, pt.y - drag.dy)), false);
      return;
    }
    if (drag.kind === 'resize-sticker') {
      const side = Math.min(0.9, Math.max(0.06, Math.max(Math.abs(pt.x - drag.origX), Math.abs(pt.y - drag.origY)) * 2));
      onResizeSticker(drag.id, Number(side.toFixed(3)), Number(side.toFixed(3)), false);
    }
  };

  const finishDrag = () => {
    if (!drag) return;
    if (drag.kind === 'stroke' && drag.stroke.points.length > 0) {
      onCommitStroke(drag.stroke, drag.drawingLayerId);
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
    } else if (drag.kind === 'move-panel' || drag.kind === 'vertex' || drag.kind === 'rotate-panel' || drag.kind === 'pan-image' || drag.kind === 'move-anchor' || drag.kind === 'resize-panel-anchor-bubble') {
      onUpdatePanel(drag.panelId, panel => panel, true);
    } else if (drag.kind === 'move-ai-anchor') {
      const anchor = draft.aiPage.anchors.find(item => item.id === drag.anchorId);
      if (anchor) onMoveAiAnchor?.(anchor.id, anchor.x, anchor.y, true);
    } else if (drag.kind === 'resize-ai-anchor-bubble') {
      onUpdateAiAnchor?.(drag.anchorId, cur => cur, true);
    } else if (drag.kind === 'move-guide-panel' || drag.kind === 'resize-guide-panel') {
      const gp = draft.aiPage.guidePanels.find(item => item.id === drag.guideId);
      if (gp) onUpdateGuidePanel?.(gp.id, { x: gp.x, y: gp.y, width: gp.width, height: gp.height }, true);
    } else if (drag.kind === 'move-breakout' || drag.kind === 'resize-breakout') {
      const bz = (draft.aiPage.breakoutZones || []).find(item => item.id === drag.zoneId);
      if (bz) onUpdateBreakoutZone?.(bz.id, { x: bz.x, y: bz.y, width: bz.width, height: bz.height }, true);
    } else if (drag.kind === 'move-bubble') {
      const b = draft.bubbles.find(item => item.id === drag.id);
      if (b) onMoveBubble(b.id, b.x, b.y, true);
    } else if (drag.kind === 'resize-bubble') {
      const b = draft.bubbles.find(item => item.id === drag.id);
      if (b) onResizeBubble(b.id, b.width, b.height, true);
    } else if (drag.kind === 'rotate-bubble') {
      onUpdateBubble?.(drag.id, cur => cur, true);
    } else if (drag.kind === 'move-bubble-tail') {
      const b = draft.bubbles.find(item => item.id === drag.id);
      if (b) onMoveBubbleTail(b.id, b.tailX, b.tailY, true);
    } else if (drag.kind === 'move-image-layer' || drag.kind === 'resize-image-layer') {
      onUpdateImageLayer?.(drag.id, cur => cur, true);
    } else if (drag.kind === 'move-text') {
      const txt = draft.texts.find(item => item.id === drag.id);
      if (txt) onMoveText(txt.id, txt.x, txt.y, true);
    } else if (drag.kind === 'move-sticker') {
      const st = draft.stickers.find(item => item.id === drag.id);
      if (st) onMoveSticker(st.id, st.x, st.y, true);
    } else if (drag.kind === 'resize-sticker') {
      const st = draft.stickers.find(item => item.id === drag.id);
      if (st) onResizeSticker(st.id, st.width, st.height, true);
    }
    setDrag(null);
    setSnapGuide({});
  };

  const selectedPanel = selection?.kind === 'panel'
    ? draft.panels.find(p => p.id === selection.id)
    : selection?.kind === 'panel-anchor'
      ? draft.panels.find(p => p.id === selection.panelId)
      : undefined;

  const sliceTargetIds = useMemo(() => {
    if (drag?.kind !== 'slice') return new Set<string>();
    const ids = new Set<string>();
    if (draft.creationMode === 'ai-page') {
      for (const gp of draft.aiPage.guidePanels) {
        const poly = getGuidePanelPolygon(gp);
        if (doesSegmentIntersectPolygon(drag.startPoint, drag.currentPoint, poly)) {
          ids.add(gp.id);
        }
      }
      return ids;
    }
    const aspect = pageW / Math.max(1, pageH);
    for (const panel of draft.panels) {
      if (panel.locked) continue;
      let s = drag.startPoint;
      let e = drag.currentPoint;
      if (panel.rotation) {
        const b = getPanelBoundingBox(panel.points, 1, 1);
        const c = { x: b.cx, y: b.cy };
        s = rotatePointAround(s, c, -panel.rotation, aspect);
        e = rotatePointAround(e, c, -panel.rotation, aspect);
      }
      if (doesSegmentIntersectPolygon(s, e, panel.points)) {
        ids.add(panel.id);
      }
    }
    return ids;
  }, [drag, draft.aiPage.guidePanels, draft.creationMode, draft.panels, pageW, pageH]);

  const cursorClass = isPanningMode
    ? (drag?.kind === 'pan-viewport' ? 'cursor-grabbing' : 'cursor-grab')
    : activeTool === 'zoom'
      ? 'cursor-zoom-in'
      : activeTool === 'frame-image'
        ? 'cursor-move'
        : activeTool === 'slice' || activeTool === 'draw-panel' || activeTool === 'brush' || activeTool === 'eraser'
          ? 'cursor-crosshair'
          : activeTool === 'bubble' || activeTool === 'text' || activeTool === 'sticker'
            ? 'cursor-copy'
            : 'cursor-default';

  const hasRenderedImages = draft.creationMode === 'ai-page'
    ? Boolean(
      draft.aiPage.generatedPageImage?.url
      || draft.aiPage.zoneImages?.['0']?.url
      || draft.aiPage.zoneImages?.['1']?.url
      || (syncedDraft.imageLayers?.length ?? 0) > 0
      || livePreviewImage,
    )
    : (draft.panels.some(p => Boolean(p.image?.url)) || (syncedDraft.imageLayers?.length ?? 0) > 0 || Boolean(livePreviewImage));

  const drawingMap = useMemo(() => new Map((syncedDraft.drawingLayers || []).map(d => [d.id, d])), [syncedDraft.drawingLayers]);
  const bubbleMap = useMemo(() => new Map(draft.bubbles.map(b => [b.id, b])), [draft.bubbles]);
  const textMap = useMemo(() => new Map(draft.texts.map(t => [t.id, t])), [draft.texts]);
  const stickerMap = useMemo(() => new Map(draft.stickers.map(s => [s.id, s])), [draft.stickers]);
  const imageLayerMap = useMemo(() => new Map((syncedDraft.imageLayers || []).map(img => [img.id, img])), [syncedDraft.imageLayers]);

  // 选中气泡（正式矢量气泡 OR 可视化气泡锚点）用于画布上的 PS 上下文悬浮迷你工具条
  const activeFloatingBubble = useMemo(() => {
    if (selection?.kind === 'bubble') {
      const b = bubbleMap.get(selection.id);
      if (b) {
        return {
          mode: 'vector' as const,
          id: b.id,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          shape: b.shape,
          writingMode: b.writingMode,
          hasTail: b.hasTail,
          fontSize: b.fontSize,
        };
      }
    }
    if (selection?.kind === 'ai-anchor') {
      const a = draft.aiPage.anchors.find(item => item.id === selection.id && item.kind === 'bubble');
      if (a) {
        return {
          mode: 'ai-anchor' as const,
          id: a.id,
          x: a.x,
          y: a.y,
          width: a.bubbleWidth ?? 0.24,
          height: a.bubbleHeight ?? 0.14,
          shape: (a.bubbleShape || 'soft') as ComicBubbleShape,
          writingMode: a.bubbleWritingMode || 'vertical',
          hasTail: true,
          fontSize: a.bubbleFontSize ?? 20,
        };
      }
    }
    if (selection?.kind === 'panel-anchor') {
      const p = draft.panels.find(item => item.id === selection.panelId);
      const a = p?.anchors.find(item => item.id === selection.id && item.kind === 'bubble');
      if (p && a) {
        const pb = getPanelBoundingBox(p.points, 1, 1);
        return {
          mode: 'panel-anchor' as const,
          panelId: p.id,
          id: a.id,
          x: pb.minX + a.x * pb.width,
          y: pb.minY + a.y * pb.height,
          width: a.bubbleWidth ?? Math.min(0.45, Math.max(0.18, pb.width * 0.48)),
          height: a.bubbleHeight ?? Math.min(0.32, Math.max(0.11, pb.height * 0.34)),
          shape: (a.bubbleShape || 'soft') as ComicBubbleShape,
          writingMode: a.bubbleWritingMode || 'vertical',
          hasTail: true,
          fontSize: a.bubbleFontSize ?? 19,
        };
      }
    }
    return null;
  }, [bubbleMap, draft.aiPage.anchors, draft.panels, selection]);

  // 所见即所得原地编辑目标定位（支持正式矢量气泡、自由文字、AI/手动气泡锚点）
  const inlineEditTarget = useMemo(() => {
    if (!inlineEdit) return null;
    if (inlineEdit.kind === 'bubble') {
      const b = bubbleMap.get(inlineEdit.id);
      if (!b) return null;
      const bw = b.width * pageW;
      const bh = b.height * pageH;
      const fontSize = computeAutoFitFontSize(inlineEdit.value || b.text, b.fontSize, bw * 0.68, bh * 0.66, b.writingMode);
      return {
        x: b.x,
        y: b.y,
        width: b.width * 0.72,
        height: b.height * 0.68,
        fontFamily: resolveComicFont(b.fontFamily).cssFamily,
        fontSize: Math.max(11, Math.round(fontSize * zoom)),
        color: b.textColor || '#111827',
        writingMode: b.writingMode,
        rotation: b.rotation || 0,
        transparent: true,
      };
    }
    if (inlineEdit.kind === 'text') {
      const txt = textMap.get(inlineEdit.id);
      if (!txt) return null;
      return {
        x: txt.x,
        y: txt.y,
        width: 0.28,
        height: 0.1,
        fontFamily: resolveComicFont(txt.fontFamily).cssFamily,
        fontSize: Math.max(12, Math.round(txt.fontSize * zoom)),
        color: txt.color || '#111827',
        writingMode: txt.writingMode || 'horizontal',
        rotation: txt.rotation || 0,
        transparent: false,
      };
    }
    if (inlineEdit.kind === 'ai-anchor-bubble') {
      const a = draft.aiPage.anchors.find(item => item.id === inlineEdit.anchorId);
      if (!a) return null;
      const w = a.bubbleWidth ?? 0.24;
      const h = a.bubbleHeight ?? 0.14;
      const writingMode = a.bubbleWritingMode || 'vertical';
      const fontSize = computeAutoFitFontSize(inlineEdit.value || a.bubbleText || '', a.bubbleFontSize ?? 20, w * pageW * 0.68, h * pageH * 0.66, writingMode);
      return {
        x: a.x,
        y: a.y,
        width: w * 0.72,
        height: h * 0.68,
        fontFamily: resolveComicFont('comic-sans').cssFamily,
        fontSize: Math.max(11, Math.round(fontSize * zoom)),
        color: '#111827',
        writingMode,
        rotation: 0,
        transparent: true,
      };
    }
    if (inlineEdit.kind === 'panel-anchor-bubble') {
      const p = draft.panels.find(item => item.id === inlineEdit.panelId);
      const a = p?.anchors.find(item => item.id === inlineEdit.anchorId);
      if (!p || !a) return null;
      const pb = getPanelBoundingBox(p.points, 1, 1);
      const w = a.bubbleWidth ?? Math.min(0.45, Math.max(0.18, pb.width * 0.48));
      const h = a.bubbleHeight ?? Math.min(0.32, Math.max(0.11, pb.height * 0.34));
      const writingMode = a.bubbleWritingMode || 'vertical';
      const fontSize = computeAutoFitFontSize(inlineEdit.value || a.bubbleText || '', a.bubbleFontSize ?? 19, w * pageW * 0.68, h * pageH * 0.66, writingMode);
      return {
        x: pb.minX + a.x * pb.width,
        y: pb.minY + a.y * pb.height,
        width: w * 0.72,
        height: h * 0.68,
        fontFamily: resolveComicFont('comic-sans').cssFamily,
        fontSize: Math.max(11, Math.round(fontSize * zoom)),
        color: '#111827',
        writingMode,
        rotation: 0,
        transparent: true,
      };
    }
    return null;
  }, [bubbleMap, draft.aiPage.anchors, draft.panels, inlineEdit, pageH, pageW, textMap, zoom]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100/70 dark:bg-slate-950/60"
      style={{
        // 细微绘图桌点阵底纹：去除纯色死空感，承托漫画画纸并透出工坊壁纸与液态玻璃
        backgroundImage: 'radial-gradient(circle, rgba(148, 163, 184, 0.24) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      {/* 安全滚动容器：w-max h-max min-w-full min-h-full 确保放大后顶部和左侧永远可完整滚动到边缘 */}
      <div
        ref={scrollRef}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`relative min-h-0 flex-1 overflow-auto ${isPanningMode ? (drag?.kind === 'pan-viewport' ? 'cursor-grabbing' : 'cursor-grab') : activeTool === 'zoom' ? 'cursor-zoom-in' : ''}`}
      >
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center p-6 pb-16 md:p-10 md:pb-16">
          <div
            ref={stageRef}
            role="application"
            aria-label={t('漫画分镜画布')}
            data-safe-mode-canvas={hasRenderedImages ? 'true' : undefined}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            style={{
              width: displayW,
              height: displayH,
              backgroundColor: draft.backgroundColor || '#ffffff',
            }}
            className={`relative flex-none touch-none select-none overflow-visible rounded-sm shadow-[0_18px_48px_rgba(0,0,0,0.28)] ring-1 ring-black/10 dark:ring-white/15 ${cursorClass}`}
          >
            <svg
              width={displayW}
              height={displayH}
              viewBox={`0 0 ${pageW} ${pageH}`}
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            >
              <defs>
                <clipPath id="comic-page-bounds">
                  <rect x={0} y={0} width={pageW} height={pageH} />
                </clipPath>
                {sortedPanels.map(panel => (
                  <clipPath key={panel.id} id={`comic-clip-${panel.id}`}>
                    <polygon points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')} />
                  </clipPath>
                ))}
              </defs>

              {layerStack.map(layerNode => {
                if (layerNode.kind === 'group') return null;
                const eff = resolveEffectiveLayerProps(layerNode, layerStack);
                if (!eff.visible || eff.opacity <= 0) return null;
                const layerStyle: React.CSSProperties = {
                  opacity: eff.opacity,
                  mixBlendMode: blendModeToCss(eff.blendMode),
                };

                if (layerNode.kind === 'panels') {
                  if (draft.creationMode === 'ai-page') {
                    const aiPage = draft.aiPage;
                    const displayBaseUrl = comparingOriginalAiImage && aiPage.originalGeneratedPageImage?.url
                      ? aiPage.originalGeneratedPageImage.url
                      : aiPage.generatedPageImage?.url;
                    const hasGenerated = Boolean(displayBaseUrl) || Boolean(aiPage.zoneImages?.['0']?.url || aiPage.zoneImages?.['1']?.url);
                    const showGuides = aiPage.showGuideOverlay || !displayBaseUrl;
                    const activeZoneRect = aiZonePlan?.zones[generatingAiZoneIndex ?? 0]?.rect || { x: 0, y: 0, width: 1, height: 1 };
                    return (
                      <g key={layerNode.id} clipPath="url(#comic-page-bounds)" style={layerStyle}>
                        {displayBaseUrl ? (
                          <image
                            href={displayBaseUrl}
                            x={0}
                            y={0}
                            width={pageW}
                            height={pageH}
                            preserveAspectRatio="xMidYMid slice"
                          />
                        ) : (
                          // 双区生成若只完成了其中一区，直接展示已保存的那半页成图，绝不丢失进度
                          aiZonePlan?.zones.map(zone => {
                            const savedZone = aiPage.zoneImages?.[String(zone.zoneIndex) as '0' | '1'];
                            if (!savedZone?.url) return null;
                            return (
                              <image
                                key={zone.zoneIndex}
                                href={savedZone.url}
                                x={zone.rect.x * pageW}
                                y={zone.rect.y * pageH}
                                width={zone.rect.width * pageW}
                                height={zone.rect.height * pageH}
                                preserveAspectRatio="xMidYMid slice"
                              />
                            );
                          })
                        )}
                        {generatingAiPage && livePreviewImage && (
                          <image
                            href={livePreviewImage}
                            x={activeZoneRect.x * pageW}
                            y={activeZoneRect.y * pageH}
                            width={activeZoneRect.width * pageW}
                            height={activeZoneRect.height * pageH}
                            preserveAspectRatio="xMidYMid slice"
                          />
                        )}
                        {generatingAiPage && (
                          <rect
                            x={activeZoneRect.x * pageW + 2}
                            y={activeZoneRect.y * pageH + 2}
                            width={Math.max(4, activeZoneRect.width * pageW - 4)}
                            height={Math.max(4, activeZoneRect.height * pageH - 4)}
                            fill="rgba(79,70,229,0.08)"
                            stroke="#4f46e5"
                            strokeWidth={4}
                            strokeDasharray="12 8"
                          />
                        )}
                        {showGuides && (
                          <g>
                            {(() => {
                              const isFlashback = aiPage.gutterStyle === 'black-flashback';
                              const orderedGuides = [
                                ...aiPage.guidePanels.map((gp, idx) => ({ gp, idx })).filter(item => !item.gp.inset),
                                ...aiPage.guidePanels.map((gp, idx) => ({ gp, idx })).filter(item => item.gp.inset),
                              ];
                              return (
                                <>
                                  {!hasGenerated && isFlashback && (
                                    <rect x={0} y={0} width={pageW} height={pageH} fill="#08080a" />
                                  )}
                                  {orderedGuides.map(({ gp, idx }) => {
                                    const poly = getGuidePanelPolygon(gp);
                                    const b = getPanelBoundingBox(poly, pageW, pageH);
                                    const pointsAttr = poly.map(pt => `${(pt.x * pageW).toFixed(1)},${(pt.y * pageH).toFixed(1)}`).join(' ');
                                    const badgeNum = String(idx + 1).padStart(2, '0');
                                    const isSliceHit = sliceTargetIds.has(gp.id);
                                    const baseFill = hasGenerated
                                      ? 'rgba(99, 102, 241, 0.06)'
                                      : (gp.fillColor?.trim() || (isFlashback ? '#3f4552' : '#eef1f6'));
                                    const strokeColor = isSliceHit
                                      ? '#ef4444'
                                      : gp.inset
                                        ? '#0a0a0a'
                                        : (isFlashback ? '#e2e8f0' : '#4f46e5');
                                    return (
                                      <g key={gp.id}>
                                        {gp.inset && !hasGenerated && (
                                          <polygon
                                            points={pointsAttr}
                                            fill="none"
                                            stroke="#ffffff"
                                            strokeWidth={14}
                                            strokeLinejoin="miter"
                                          />
                                        )}
                                        <polygon
                                          points={pointsAttr}
                                          fill={baseFill}
                                          stroke={strokeColor}
                                          strokeOpacity={isSliceHit ? 0.95 : (hasGenerated ? 0.72 : 0.78)}
                                          strokeWidth={isSliceHit ? 4 : (aiPage.layoutLockMode !== 'txt2img' ? 4 : 2.5)}
                                          strokeDasharray={aiPage.layoutLockMode !== 'txt2img' && !hasGenerated ? undefined : '10 6'}
                                        />
                                        {gp.speedlines && !hasGenerated && (
                                          <g opacity={0.35} stroke="#475569" strokeWidth={1.4}>
                                            {Array.from({ length: 16 }).map((_, rayIdx) => {
                                              const ang = (rayIdx / 16) * Math.PI * 2;
                                              const r1 = Math.min(b.width, b.height) * 0.22;
                                              const r2 = Math.min(b.width, b.height) * 0.46;
                                              return (
                                                <line
                                                  key={rayIdx}
                                                  x1={b.cx + Math.cos(ang) * r1}
                                                  y1={b.cy + Math.sin(ang) * r1}
                                                  x2={b.cx + Math.cos(ang) * r2}
                                                  y2={b.cy + Math.sin(ang) * r2}
                                                />
                                              );
                                            })}
                                          </g>
                                        )}
                                        <rect
                                          x={b.minX + 10}
                                          y={b.minY + 10}
                                          width={30}
                                          height={20}
                                          rx={4}
                                          fill={gp.inset ? 'rgba(147, 51, 234, 0.9)' : 'rgba(79, 70, 229, 0.88)'}
                                        />
                                        <text
                                          x={b.minX + 25}
                                          y={b.minY + 20}
                                          textAnchor="middle"
                                          dominantBaseline="central"
                                          fontSize={11}
                                          fontWeight={700}
                                          fill="#ffffff"
                                        >
                                          {badgeNum}
                                        </text>
                                        {!hasGenerated && (
                                          <>
                                            <text
                                              x={b.minX + 48}
                                              y={b.minY + 20}
                                              dominantBaseline="central"
                                              fontSize={13}
                                              fontWeight={700}
                                              fill={isFlashback ? '#e2e8f0' : '#334155'}
                                            >
                                              {gp.label}
                                              {gp.bleed ? ` · ${t('出血')}` : ''}
                                              {gp.inset ? ` · ${t('叠框')}` : ''}
                                              {gp.speedlines ? ` · ${t('速度线')}` : ''}
                                            </text>
                                            {gp.summary && (
                                              <foreignObject x={b.minX + 14} y={b.minY + 38} width={Math.max(40, b.width - 28)} height={Math.max(24, b.height - 48)}>
                                                <div
                                                  style={{
                                                    color: isFlashback ? '#cbd5e1' : '#64748b',
                                                    fontSize: '13px',
                                                    lineHeight: 1.4,
                                                    fontWeight: 500,
                                                    overflow: 'hidden',
                                                    userSelect: 'none',
                                                  }}
                                                >
                                                  {gp.summary}
                                                </div>
                                              </foreignObject>
                                            )}
                                          </>
                                        )}
                                      </g>
                                    );
                                  })}
                                  {(aiPage.breakoutZones || []).map((bz, idx) => {
                                    const bx = bz.x * pageW;
                                    const by = bz.y * pageH;
                                    const bw = bz.width * pageW;
                                    const bh = bz.height * pageH;
                                    const isSel = selection?.kind === 'breakout-zone' && selection.id === bz.id;
                                    return (
                                      <g key={`breakout-svg-${bz.id}`}>
                                        <rect
                                          x={bx}
                                          y={by}
                                          width={bw}
                                          height={bh}
                                          rx={16}
                                          fill={hasGenerated ? 'rgba(244, 63, 94, 0.08)' : (bz.tintColor?.trim() || 'rgba(182, 185, 192, 0.85)')}
                                          stroke="#ffffff"
                                          strokeWidth={12}
                                          strokeLinejoin="round"
                                        />
                                        <rect
                                          x={bx}
                                          y={by}
                                          width={bw}
                                          height={bh}
                                          rx={16}
                                          fill="none"
                                          stroke={isSel ? '#e11d48' : '#f43f5e'}
                                          strokeWidth={isSel ? 3.5 : 2.5}
                                          strokeDasharray="10 5"
                                        />
                                        <rect x={bx + 8} y={by + 8} width={82} height={20} rx={5} fill="rgba(225, 29, 72, 0.9)" />
                                        <text x={bx + 49} y={by + 18} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#ffffff">
                                          {t('破格前景')} {idx + 1}
                                        </text>
                                      </g>
                                    );
                                  })}
                                </>
                              );
                            })()}
                            {/* 自动/手动双区拆分可视分割线：让用户在生图前一眼看到免费双区的拼接缝 */}
                            {aiZonePlan && aiZonePlan.zones.length === 2 && (
                              aiZonePlan.effectiveSplit === 'dual-vertical' ? (
                                <g>
                                  <line
                                    x1={0}
                                    y1={aiZonePlan.splitRatio * pageH}
                                    x2={pageW}
                                    y2={aiZonePlan.splitRatio * pageH}
                                    stroke="#f43f5e"
                                    strokeWidth={3}
                                    strokeDasharray="12 7"
                                  />
                                  <rect
                                    x={pageW - 186}
                                    y={Math.max(6, aiZonePlan.splitRatio * pageH - 28)}
                                    width={176}
                                    height={22}
                                    rx={6}
                                    fill="rgba(244, 63, 94, 0.9)"
                                  />
                                  <text
                                    x={pageW - 98}
                                    y={Math.max(17, aiZonePlan.splitRatio * pageH - 17)}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fontSize={11}
                                    fontWeight={700}
                                    fill="#ffffff"
                                  >
                                    {`区 1 · ${aiZonePlan.zones[0].resolution.width}×${aiZonePlan.zones[0].resolution.height}`}
                                  </text>
                                  <rect
                                    x={pageW - 186}
                                    y={Math.min(pageH - 28, aiZonePlan.splitRatio * pageH + 6)}
                                    width={176}
                                    height={22}
                                    rx={6}
                                    fill="rgba(244, 63, 94, 0.9)"
                                  />
                                  <text
                                    x={pageW - 98}
                                    y={Math.min(pageH - 17, aiZonePlan.splitRatio * pageH + 17)}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fontSize={11}
                                    fontWeight={700}
                                    fill="#ffffff"
                                  >
                                    {`区 2 · ${aiZonePlan.zones[1].resolution.width}×${aiZonePlan.zones[1].resolution.height}`}
                                  </text>
                                </g>
                              ) : (
                                <g>
                                  <line
                                    x1={aiZonePlan.splitRatio * pageW}
                                    y1={0}
                                    x2={aiZonePlan.splitRatio * pageW}
                                    y2={pageH}
                                    stroke="#f43f5e"
                                    strokeWidth={3}
                                    strokeDasharray="12 7"
                                  />
                                  <rect
                                    x={Math.max(6, aiZonePlan.splitRatio * pageW - 166)}
                                    y={10}
                                    width={158}
                                    height={22}
                                    rx={6}
                                    fill="rgba(244, 63, 94, 0.9)"
                                  />
                                  <text
                                    x={Math.max(85, aiZonePlan.splitRatio * pageW - 87)}
                                    y={21}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fontSize={11}
                                    fontWeight={700}
                                    fill="#ffffff"
                                  >
                                    {`区 1 · ${aiZonePlan.zones[0].resolution.width}×${aiZonePlan.zones[0].resolution.height}`}
                                  </text>
                                  <rect
                                    x={Math.min(pageW - 164, aiZonePlan.splitRatio * pageW + 8)}
                                    y={10}
                                    width={158}
                                    height={22}
                                    rx={6}
                                    fill="rgba(244, 63, 94, 0.9)"
                                  />
                                  <text
                                    x={Math.min(pageW - 85, aiZonePlan.splitRatio * pageW + 87)}
                                    y={21}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fontSize={11}
                                    fontWeight={700}
                                    fill="#ffffff"
                                  >
                                    {`区 2 · ${aiZonePlan.zones[1].resolution.width}×${aiZonePlan.zones[1].resolution.height}`}
                                  </text>
                                </g>
                              )
                            )}
                          </g>
                        )}
                      </g>
                    );
                  }
                  return (
                    <g key={layerNode.id} style={layerStyle}>
                      {sortedPanels.map((panel, panelOrderIdx) => {
                        const bounds = getPanelBoundingBox(panel.points, pageW, pageH);
                        const isSelected = selection?.kind === 'panel' && selection.id === panel.id;
                        const isSliceTarget = sliceTargetIds.has(panel.id);
                        const isGeneratingThis = generatingPanelId === panel.id;
                        const previewUrl = isGeneratingThis && livePreviewImage ? livePreviewImage : panel.image?.url;
                        const imgW = panel.image?.width || bounds.width;
                        const imgH = panel.image?.height || bounds.height;
                        const coverScale = Math.max(bounds.width / Math.max(1, imgW), bounds.height / Math.max(1, imgH)) * (panel.image?.scale || 1);
                        const drawW = imgW * coverScale;
                        const drawH = imgH * coverScale;
                        const drawX = bounds.cx - drawW / 2 + (panel.image?.offsetX || 0) * bounds.width;
                        const drawY = bounds.cy - drawH / 2 + (panel.image?.offsetY || 0) * bounds.height;
                        const badgeNum = String(panelOrderIdx + 1).padStart(2, '0');

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
                            {/* 空格分镜稿质感：左上角精致格号角标 + 居中画格名 */}
                            {!previewUrl && (
                              <g clipPath={`url(#comic-clip-${panel.id})`}>
                                <rect
                                  x={bounds.minX + 10}
                                  y={bounds.minY + 10}
                                  width={30}
                                  height={20}
                                  rx={4}
                                  fill={isSelected ? '#4f46e5' : '#e2e8f0'}
                                />
                                <text
                                  x={bounds.minX + 25}
                                  y={bounds.minY + 20}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={11}
                                  fontWeight={700}
                                  fill={isSelected ? '#ffffff' : '#64748b'}
                                >
                                  {badgeNum}
                                </text>
                                <text
                                  x={bounds.cx}
                                  y={bounds.cy}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={Math.max(12, Math.min(26, Math.min(bounds.width, bounds.height) * 0.12))}
                                  fontWeight={600}
                                  fill="#94a3b8"
                                >
                                  {panel.name}
                                </text>
                              </g>
                            )}
                            <polygon
                              points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')}
                              fill={isSliceTarget ? 'rgba(239,68,68,0.08)' : 'none'}
                              stroke={isSliceTarget ? '#ef4444' : isSelected ? '#4f46e5' : (panel.borderColor || '#111827')}
                              strokeWidth={isSliceTarget || isSelected ? Math.max(panel.borderWidth, 4) : panel.borderWidth}
                              strokeDasharray={isSliceTarget ? '10 6' : undefined}
                              strokeLinejoin="miter"
                            />
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

                if (layerNode.kind === 'drawing' && layerNode.refId) {
                  const dl = drawingMap.get(layerNode.refId);
                  if (!dl) return null;
                  const activeStroke = drag?.kind === 'stroke' && drag.drawingLayerId === dl.id ? drag.stroke : null;
                  if (dl.strokes.length === 0 && !activeStroke) return null;
                  return (
                    <DrawingLayerCanvas
                      key={layerNode.id}
                      strokes={dl.strokes}
                      activeStroke={activeStroke}
                      pageW={pageW}
                      pageH={pageH}
                      opacity={eff.opacity}
                      blendMode={eff.blendMode}
                    />
                  );
                }

                if (layerNode.kind === 'image' && layerNode.refId) {
                  const imgLayer = imageLayerMap.get(layerNode.refId);
                  if (!imgLayer) return null;
                  const selected = selection?.kind === 'image' && selection.id === imgLayer.id;
                  const cx = imgLayer.x * pageW;
                  const cy = imgLayer.y * pageH;
                  const w = imgLayer.width * pageW;
                  const h = imgLayer.height * pageH;
                  return (
                    <g
                      key={layerNode.id}
                      style={layerStyle}
                      transform={imgLayer.rotation ? `rotate(${imgLayer.rotation} ${cx} ${cy})` : undefined}
                      className="pointer-events-auto cursor-move"
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        onSelect({ kind: 'image', id: imgLayer.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-image-layer', id: imgLayer.id, dx: pt.x - imgLayer.x, dy: pt.y - imgLayer.y });
                      }}
                    >
                      <image
                        href={imgLayer.url}
                        x={cx - w / 2}
                        y={cy - h / 2}
                        width={w}
                        height={h}
                        preserveAspectRatio="xMidYMid meet"
                      />
                      {selected && !eff.locked && (
                        <>
                          <rect
                            x={cx - w / 2}
                            y={cy - h / 2}
                            width={w}
                            height={h}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth={2}
                          />
                          <rect
                            x={cx + w / 2 - 7}
                            y={cy + h / 2 - 7}
                            width={14}
                            height={14}
                            rx={3}
                            fill="#4f46e5"
                            stroke="#ffffff"
                            strokeWidth={2}
                            className="cursor-nwse-resize"
                            onPointerDown={event => {
                              event.stopPropagation();
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({ kind: 'resize-image-layer', id: imgLayer.id, origX: imgLayer.x, origY: imgLayer.y });
                            }}
                          />
                        </>
                      )}
                    </g>
                  );
                }

                if (layerNode.kind === 'bubble' && layerNode.refId) {
                  const bubble = bubbleMap.get(layerNode.refId);
                  if (!bubble) return null;
                  const cx = bubble.x * pageW;
                  const cy = bubble.y * pageH;
                  const rx = (bubble.width * pageW) / 2;
                  const ry = (bubble.height * pageH) / 2;
                  const tx = bubble.tailX * pageW;
                  const ty = bubble.tailY * pageH;
                  const selected = selection?.kind === 'bubble' && selection.id === bubble.id;
                  const isInlineEditing = inlineEdit?.kind === 'bubble' && inlineEdit.id === bubble.id;
                  const isTransparentFill = !bubble.fillColor || bubble.fillColor === 'transparent';
                  const strokeColor = bubble.strokeWidth > 0 ? bubble.strokeColor : 'none';
                  const strokeW = bubble.strokeWidth;

                  let localTx = tx;
                  let localTy = ty;
                  if (bubble.rotation) {
                    const rad = (-bubble.rotation * Math.PI) / 180;
                    const dx = tx - cx;
                    const dy = ty - cy;
                    localTx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
                    localTy = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
                  }

                  const model = buildComicBubbleRenderModel(cx, cy, rx, ry, bubble.shape, bubble.id, {
                    enabled: bubble.hasTail && !isTransparentFill,
                    tx: localTx,
                    ty: localTy,
                  });
                  const fontMeta = resolveComicFont(bubble.fontFamily);
                  const fittedSize = computeAutoFitFontSize(
                    bubble.text,
                    bubble.fontSize,
                    rx * 1.54,
                    ry * 1.54,
                    bubble.writingMode,
                  );

                  const resizeHandles: Array<{ dir: ResizeHandleDir; hx: number; hy: number; cursor: string }> = [
                    { dir: 'nw', hx: cx - rx, hy: cy - ry, cursor: 'cursor-nwse-resize' },
                    { dir: 'n', hx: cx, hy: cy - ry, cursor: 'cursor-ns-resize' },
                    { dir: 'ne', hx: cx + rx, hy: cy - ry, cursor: 'cursor-nesw-resize' },
                    { dir: 'e', hx: cx + rx, hy: cy, cursor: 'cursor-ew-resize' },
                    { dir: 'se', hx: cx + rx, hy: cy + ry, cursor: 'cursor-nwse-resize' },
                    { dir: 's', hx: cx, hy: cy + ry, cursor: 'cursor-ns-resize' },
                    { dir: 'sw', hx: cx - rx, hy: cy + ry, cursor: 'cursor-nesw-resize' },
                    { dir: 'w', hx: cx - rx, hy: cy, cursor: 'cursor-ew-resize' },
                  ];

                  return (
                    <g
                      key={layerNode.id}
                      style={layerStyle}
                      className={eff.locked ? 'pointer-events-none' : 'pointer-events-auto cursor-move'}
                      onDoubleClick={event => {
                        if (eff.locked) return;
                        event.stopPropagation();
                        onSelect({ kind: 'bubble', id: bubble.id });
                        setInlineEdit({ kind: 'bubble', id: bubble.id, value: bubble.text });
                      }}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        onSelect({ kind: 'bubble', id: bubble.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-bubble', id: bubble.id, dx: pt.x - bubble.x, dy: pt.y - bubble.y });
                      }}
                    >
                      <g transform={bubble.rotation ? `rotate(${bubble.rotation} ${cx} ${cy})` : undefined}>
                        {model.radialLines && strokeW > 0 && (
                          <g opacity={0.72}>
                            {model.radialLines.map((seg, idx) => (
                              <line
                                key={idx}
                                x1={seg.x1}
                                y1={seg.y1}
                                x2={seg.x2}
                                y2={seg.y2}
                                stroke={strokeColor}
                                strokeWidth={Math.max(1, strokeW * 0.42)}
                                strokeLinecap="round"
                              />
                            ))}
                          </g>
                        )}

                        {model.tailPath && strokeW > 0 && model.strokeBody && (
                          <path
                            d={model.tailPath}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={strokeW * 2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        )}
                        {strokeW > 0 && model.strokeBody && (
                          <path
                            d={model.bodyPath}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={isTransparentFill ? strokeW : strokeW * 2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        )}
                        {model.tailPath && !isTransparentFill && (
                          <path d={model.tailPath} fill={bubble.fillColor} stroke="none" />
                        )}
                        {!isTransparentFill && (
                          <path d={model.bodyPath} fill={bubble.fillColor} stroke="none" />
                        )}

                        {model.trailPaths && model.trailPaths.map((tp, idx) => (
                          <g key={idx}>
                            {strokeW > 0 && (
                              <path d={tp} fill="none" stroke={strokeColor} strokeWidth={strokeW * 1.6} strokeLinejoin="round" />
                            )}
                            {!isTransparentFill && (
                              <path d={tp} fill={bubble.fillColor} stroke="none" />
                            )}
                          </g>
                        ))}

                        {model.overrunLines && strokeW > 0 && (
                          <g>
                            {model.overrunLines.map((seg, idx) => (
                              <line
                                key={idx}
                                x1={seg.x1}
                                y1={seg.y1}
                                x2={seg.x2}
                                y2={seg.y2}
                                stroke={strokeColor}
                                strokeWidth={Math.max(1.2, strokeW * 0.85)}
                                strokeLinecap="round"
                                opacity={0.92}
                              />
                            ))}
                          </g>
                        )}

                        {!isInlineEditing && (
                          <foreignObject x={cx - rx * 0.78} y={cy - ry * 0.78} width={rx * 1.56} height={ry * 1.56}>
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                color: bubble.textColor,
                                fontFamily: fontMeta.cssFamily,
                                fontSize: `${fittedSize}px`,
                                fontWeight: fontMeta.defaultWeight,
                                lineHeight: 1.22,
                                writingMode: bubble.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                                wordBreak: 'break-word',
                                overflow: 'hidden',
                                userSelect: 'none',
                              }}
                            >
                              {bubble.text}
                            </div>
                          </foreignObject>
                        )}

                        {/* PS 自由变换框：蓝色选框 + 8 方向缩放柄 + 顶部旋转柄 */}
                        {selected && !eff.locked && !isInlineEditing && (
                          <g>
                            <rect
                              x={cx - rx}
                              y={cy - ry}
                              width={rx * 2}
                              height={ry * 2}
                              fill="none"
                              stroke="#4f46e5"
                              strokeWidth={2}
                              strokeDasharray={isTransparentFill ? '6 4' : undefined}
                            />
                            {/* 顶部旋转连杆与圆柄 */}
                            <line x1={cx} y1={cy - ry} x2={cx} y2={cy - ry - 26} stroke="#4f46e5" strokeWidth={2} />
                            <circle
                              cx={cx}
                              cy={cy - ry - 28}
                              r={8}
                              fill="#ffffff"
                              stroke="#4f46e5"
                              strokeWidth={2.5}
                              className="cursor-grab"
                              onPointerDown={event => {
                                event.stopPropagation();
                                const pt = toNormalizedPoint(event.clientX, event.clientY);
                                const startAngle = (Math.atan2((pt.y - bubble.y) * pageH, (pt.x - bubble.x) * pageW) * 180) / Math.PI;
                                stageRef.current?.setPointerCapture?.(event.pointerId);
                                setDrag({
                                  kind: 'rotate-bubble',
                                  id: bubble.id,
                                  cx: bubble.x,
                                  cy: bubble.y,
                                  startAngle,
                                  origRotation: bubble.rotation || 0,
                                });
                              }}
                            />
                            {/* 8 方向缩放柄 */}
                            {resizeHandles.map(handle => (
                              <rect
                                key={handle.dir}
                                x={handle.hx - 5.5}
                                y={handle.hy - 5.5}
                                width={11}
                                height={11}
                                rx={2}
                                fill="#ffffff"
                                stroke="#4f46e5"
                                strokeWidth={2.2}
                                className={handle.cursor}
                                onPointerDown={event => {
                                  event.stopPropagation();
                                  const pt = toNormalizedPoint(event.clientX, event.clientY);
                                  stageRef.current?.setPointerCapture?.(event.pointerId);
                                  setDrag({
                                    kind: 'resize-bubble',
                                    id: bubble.id,
                                    handle: handle.dir,
                                    startPoint: pt,
                                    origX: bubble.x,
                                    origY: bubble.y,
                                    origW: bubble.width,
                                    origH: bubble.height,
                                  });
                                }}
                              />
                            ))}
                          </g>
                        )}
                      </g>

                      {selected && !eff.locked && bubble.hasTail && model.supportsTail && !isTransparentFill && (
                        <circle
                          cx={tx}
                          cy={ty}
                          r={8.5}
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
                }

                if (layerNode.kind === 'text' && layerNode.refId) {
                  const item = textMap.get(layerNode.refId);
                  if (!item) return null;
                  const cx = item.x * pageW;
                  const cy = item.y * pageH;
                  const selected = selection?.kind === 'text' && selection.id === item.id;
                  const isInlineEditing = inlineEdit?.kind === 'text' && inlineEdit.id === item.id;
                  return (
                    <g
                      key={layerNode.id}
                      style={layerStyle}
                      transform={`translate(${cx} ${cy}) rotate(${item.rotation})`}
                      className={eff.locked ? 'pointer-events-none' : 'pointer-events-auto cursor-move'}
                      onDoubleClick={event => {
                        if (eff.locked) return;
                        event.stopPropagation();
                        onSelect({ kind: 'text', id: item.id });
                        setInlineEdit({ kind: 'text', id: item.id, value: item.text });
                      }}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        onSelect({ kind: 'text', id: item.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-text', id: item.id, dx: pt.x - item.x, dy: pt.y - item.y });
                      }}
                    >
                      {!isInlineEditing && (
                        <text
                          x={0}
                          y={0}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontFamily={resolveComicFont(item.fontFamily || 'impact').cssFamily}
                          fontSize={item.fontSize}
                          fontWeight={item.bold ? 900 : 600}
                          fill={item.color}
                          stroke={item.strokeColor || undefined}
                          strokeWidth={item.strokeColor ? Math.max(2, item.fontSize * 0.14) : 0}
                          strokeLinejoin="round"
                          paintOrder="stroke"
                          style={{ writingMode: item.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb' }}
                        >
                          {item.text || t('双击编辑文字')}
                        </text>
                      )}
                      {selected && !eff.locked && (
                        <circle cx={0} cy={-item.fontSize * 0.9} r={6} fill="#4f46e5" stroke="#fff" strokeWidth={2} />
                      )}
                    </g>
                  );
                }

                if (layerNode.kind === 'sticker' && layerNode.refId) {
                  const sticker = stickerMap.get(layerNode.refId);
                  if (!sticker) return null;
                  const selected = selection?.kind === 'sticker' && selection.id === sticker.id;
                  const cx = sticker.x * pageW;
                  const cy = sticker.y * pageH;
                  const w = sticker.width * pageW;
                  const h = sticker.height * pageH;
                  return (
                    <g
                      key={layerNode.id}
                      style={layerStyle}
                      className={eff.locked ? 'pointer-events-none' : 'pointer-events-auto cursor-move'}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        onSelect({ kind: 'sticker', id: sticker.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-sticker', id: sticker.id, dx: pt.x - sticker.x, dy: pt.y - sticker.y });
                      }}
                    >
                      {renderStickerSvg(sticker, pageW, pageH)}
                      {selected && !eff.locked && (
                        <>
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
                          <rect
                            x={cx + w / 2 - 7}
                            y={cy + h / 2 - 7}
                            width={14}
                            height={14}
                            rx={3}
                            fill="#4f46e5"
                            stroke="#ffffff"
                            strokeWidth={2}
                            className="cursor-nwse-resize"
                            onPointerDown={event => {
                              event.stopPropagation();
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({ kind: 'resize-sticker', id: sticker.id, origX: sticker.x, origY: sticker.y });
                            }}
                          />
                        </>
                      )}
                    </g>
                  );
                }
                return null;
              })}

              {/* 可视化空间气泡锚点（直接在漫画画布显示真实半透明 FramePlanner2 气泡，单击选框、双击改字，彻底取代盲点橙色圆点） */}
              {draft.creationMode === 'ai-page' && !inpaintDraft && (draft.aiPage.showGuideOverlay || !draft.aiPage.generatedPageImage?.url) && (
                <g>
                  {draft.aiPage.anchors.filter(a => a.enabled && a.kind === 'bubble').map(anchor => {
                    const cx = anchor.x * pageW;
                    const cy = anchor.y * pageH;
                    const rx = ((anchor.bubbleWidth ?? 0.24) * pageW) / 2;
                    const ry = ((anchor.bubbleHeight ?? 0.14) * pageH) / 2;
                    const shape = (anchor.bubbleShape || 'soft') as ComicBubbleShape;
                    const writingMode = anchor.bubbleWritingMode || 'vertical';
                    const isSelected = selection?.kind === 'ai-anchor' && selection.id === anchor.id;
                    const isEditing = inlineEdit?.kind === 'ai-anchor-bubble' && inlineEdit.anchorId === anchor.id;
                    const model = buildComicBubbleRenderModel(cx, cy, rx, ry, shape, `ai-anchor-${anchor.id}`);
                    const textVal = anchor.bubbleText?.trim() || '';
                    const fittedSize = computeAutoFitFontSize(textVal || '双击输入台词', anchor.bubbleFontSize ?? 20, rx * 1.5, ry * 1.5, writingMode);
                    return (
                      <g
                        key={`vis-ai-bubble-${anchor.id}`}
                        opacity={0.88}
                        className="pointer-events-auto cursor-move"
                        onDoubleClick={event => {
                          event.stopPropagation();
                          onSelect({ kind: 'ai-anchor', id: anchor.id });
                          setInlineEdit({ kind: 'ai-anchor-bubble', anchorId: anchor.id, value: anchor.bubbleText || '' });
                        }}
                        onPointerDown={event => {
                          if (isPanningMode || activeTool !== 'select') return;
                          event.stopPropagation();
                          onSelect({ kind: 'ai-anchor', id: anchor.id });
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-ai-anchor', anchorId: anchor.id });
                        }}
                      >
                        <path
                          d={model.bodyPath}
                          fill="rgba(255, 251, 235, 0.9)"
                          stroke={isSelected ? '#4f46e5' : '#d97706'}
                          strokeWidth={isSelected ? 3.5 : 2.5}
                          strokeDasharray="8 5"
                          strokeLinejoin="round"
                        />
                        {!isEditing && (
                          <foreignObject x={cx - rx * 0.78} y={cy - ry * 0.78} width={rx * 1.56} height={ry * 1.56}>
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                color: textVal ? '#111827' : '#9ca3af',
                                fontSize: `${fittedSize}px`,
                                fontWeight: 700,
                                lineHeight: 1.22,
                                writingMode: writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                                wordBreak: 'break-word',
                                overflow: 'hidden',
                                userSelect: 'none',
                              }}
                            >
                              {textVal || t('双击输入台词')}
                            </div>
                          </foreignObject>
                        )}
                        <rect x={cx - rx} y={cy - ry - 20} width={56} height={18} rx={4} fill={isSelected ? '#4f46e5' : '#d97706'} />
                        <text x={cx - rx + 28} y={cy - ry - 11} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#ffffff">
                          {t('AI 气泡')}
                        </text>
                        {isSelected && (
                          <rect
                            x={cx + rx - 6.5}
                            y={cy + ry - 6.5}
                            width={13}
                            height={13}
                            rx={2.5}
                            fill="#ffffff"
                            stroke="#4f46e5"
                            strokeWidth={2.5}
                            className="cursor-nwse-resize"
                            onPointerDown={event => {
                              event.stopPropagation();
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({ kind: 'resize-ai-anchor-bubble', anchorId: anchor.id, cx: anchor.x, cy: anchor.y });
                            }}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {draft.creationMode === 'manual' && selectedPanel && (
                <g>
                  {selectedPanel.anchors.filter(a => a.enabled && a.kind === 'bubble').map(anchor => {
                    const pb = getPanelBoundingBox(selectedPanel.points, 1, 1);
                    const ax = pb.minX + anchor.x * pb.width;
                    const ay = pb.minY + anchor.y * pb.height;
                    const cx = ax * pageW;
                    const cy = ay * pageH;
                    const normW = anchor.bubbleWidth ?? Math.min(0.45, Math.max(0.18, pb.width * 0.48));
                    const normH = anchor.bubbleHeight ?? Math.min(0.32, Math.max(0.11, pb.height * 0.34));
                    const rx = (normW * pageW) / 2;
                    const ry = (normH * pageH) / 2;
                    const shape = (anchor.bubbleShape || 'soft') as ComicBubbleShape;
                    const writingMode = anchor.bubbleWritingMode || 'vertical';
                    const isSelected = selection?.kind === 'panel-anchor' && selection.panelId === selectedPanel.id && selection.id === anchor.id;
                    const isEditing = inlineEdit?.kind === 'panel-anchor-bubble' && inlineEdit.panelId === selectedPanel.id && inlineEdit.anchorId === anchor.id;
                    const model = buildComicBubbleRenderModel(cx, cy, rx, ry, shape, `panel-anchor-${anchor.id}`);
                    const textVal = anchor.bubbleText?.trim() || '';
                    const fittedSize = computeAutoFitFontSize(textVal || '双击输入台词', anchor.bubbleFontSize ?? 19, rx * 1.5, ry * 1.5, writingMode);
                    return (
                      <g
                        key={`vis-panel-bubble-${anchor.id}`}
                        opacity={0.88}
                        className="pointer-events-auto cursor-move"
                        onDoubleClick={event => {
                          event.stopPropagation();
                          onSelect({ kind: 'panel-anchor', panelId: selectedPanel.id, id: anchor.id });
                          setInlineEdit({ kind: 'panel-anchor-bubble', panelId: selectedPanel.id, anchorId: anchor.id, value: anchor.bubbleText || '' });
                        }}
                        onPointerDown={event => {
                          if (isPanningMode || activeTool !== 'select') return;
                          event.stopPropagation();
                          onSelect({ kind: 'panel-anchor', panelId: selectedPanel.id, id: anchor.id });
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-anchor', panelId: selectedPanel.id, anchorId: anchor.id });
                        }}
                      >
                        <path
                          d={model.bodyPath}
                          fill="rgba(255, 251, 235, 0.9)"
                          stroke={isSelected ? '#4f46e5' : '#d97706'}
                          strokeWidth={isSelected ? 3.5 : 2.5}
                          strokeDasharray="8 5"
                          strokeLinejoin="round"
                        />
                        {!isEditing && (
                          <foreignObject x={cx - rx * 0.78} y={cy - ry * 0.78} width={rx * 1.56} height={ry * 1.56}>
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                color: textVal ? '#111827' : '#9ca3af',
                                fontSize: `${fittedSize}px`,
                                fontWeight: 700,
                                lineHeight: 1.22,
                                writingMode: writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                                wordBreak: 'break-word',
                                overflow: 'hidden',
                                userSelect: 'none',
                              }}
                            >
                              {textVal || t('双击输入台词')}
                            </div>
                          </foreignObject>
                        )}
                        <rect x={cx - rx} y={cy - ry - 20} width={56} height={18} rx={4} fill={isSelected ? '#4f46e5' : '#d97706'} />
                        <text x={cx - rx + 28} y={cy - ry - 11} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#ffffff">
                          {t('气泡预演')}
                        </text>
                        {isSelected && (
                          <rect
                            x={cx + rx - 6.5}
                            y={cy + ry - 6.5}
                            width={13}
                            height={13}
                            rx={2.5}
                            fill="#ffffff"
                            stroke="#4f46e5"
                            strokeWidth={2.5}
                            className="cursor-nwse-resize"
                            onPointerDown={event => {
                              event.stopPropagation();
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({ kind: 'resize-panel-anchor-bubble', panelId: selectedPanel.id, anchorId: anchor.id, cx: ax, cy: ay });
                            }}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {snapGuide.x !== undefined && (
                <line x1={snapGuide.x * pageW} y1={0} x2={snapGuide.x * pageW} y2={pageH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6 4" />
              )}
              {snapGuide.y !== undefined && (
                <line x1={0} y1={snapGuide.y * pageH} x2={pageW} y2={snapGuide.y * pageH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6 4" />
              )}

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

            {draft.creationMode === 'ai-page' && inpaintDraft && (
              <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden">
                {/* 暗化未选中区，聚焦高亮红框重绘区 */}
                <div
                  style={{
                    left: `${inpaintDraft.rect.x * 100}%`,
                    top: `${inpaintDraft.rect.y * 100}%`,
                    width: `${inpaintDraft.rect.width * 100}%`,
                    height: `${inpaintDraft.rect.height * 100}%`,
                    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
                  }}
                  onPointerDown={event => {
                    if (isPanningMode || activeTool !== 'select') return;
                    event.stopPropagation();
                    const pt = toNormalizedPoint(event.clientX, event.clientY);
                    stageRef.current?.setPointerCapture?.(event.pointerId);
                    setDrag({
                      kind: 'move-inpaint',
                      dx: pt.x - inpaintDraft.rect.x,
                      dy: pt.y - inpaintDraft.rect.y,
                      width: inpaintDraft.rect.width,
                      height: inpaintDraft.rect.height,
                    });
                  }}
                  className="pointer-events-auto absolute cursor-move border-2 border-dashed border-rose-500 bg-rose-500/5"
                >
                  <span className="pointer-events-none absolute -top-6 left-0 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                    {t('单格局部重绘区（拖框移动 / 空白处重拉）')}
                  </span>

                  {/* 重绘区内部空间锚点 */}
                  {inpaintDraft.anchors.filter(a => a.enabled).map((anchor, idx) => {
                    const dotClass = anchor.kind === 'character' ? 'bg-blue-600'
                      : anchor.kind === 'scene' ? 'bg-emerald-600'
                        : anchor.kind === 'bubble' ? 'bg-amber-600'
                          : 'bg-purple-600';
                    return (
                      <button
                        key={anchor.id}
                        type="button"
                        aria-label={t('重绘锚点 {0}', [anchor.label])}
                        title={`${anchor.label} (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)})`}
                        onPointerDown={event => {
                          event.stopPropagation();
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-inpaint-anchor', anchorId: anchor.id });
                        }}
                        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                        className={`pointer-events-auto absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-md hover:scale-110 ${dotClass}`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}

                  {/* 右下角尺寸缩放把手 */}
                  <button
                    type="button"
                    aria-label={t('调整重绘区域大小')}
                    onPointerDown={event => {
                      event.stopPropagation();
                      stageRef.current?.setPointerCapture?.(event.pointerId);
                      setDrag({ kind: 'resize-inpaint', origX: inpaintDraft.rect.x, origY: inpaintDraft.rect.y });
                    }}
                    className="pointer-events-auto absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-rose-600 shadow"
                  />
                </div>
              </div>
            )}

            {/* 可视化气泡候选校对叠层：点击框可直接勾选/取消，彻底杜绝黑白漫误检乱塞占位字 */}
            {draft.creationMode === 'ai-page' && bubbleCandidates && bubbleCandidates.length > 0 && (
              <div className="pointer-events-none absolute inset-0 z-25">
                {bubbleCandidates.map((cand, idx) => (
                  <button
                    key={cand.id}
                    type="button"
                    aria-label={t('气泡候选 {0}', [idx + 1])}
                    aria-pressed={cand.selected}
                    onClick={event => {
                      event.stopPropagation();
                      onToggleBubbleCandidate?.(cand.id);
                    }}
                    style={{
                      left: `${(cand.x - cand.width / 2) * 100}%`,
                      top: `${(cand.y - cand.height / 2) * 100}%`,
                      width: `${cand.width * 100}%`,
                      height: `${cand.height * 100}%`,
                    }}
                    className={`pointer-events-auto absolute flex items-start justify-start rounded-lg border-2 p-1 text-left transition ${cand.selected ? 'border-emerald-500 bg-emerald-500/15 shadow-sm' : 'border-dashed border-slate-400/80 bg-slate-500/10 opacity-65 hover:opacity-100'}`}
                  >
                    <span className={`rounded px-1 py-0.5 text-[10px] font-bold text-white shadow ${cand.selected ? 'bg-emerald-600' : 'bg-slate-600'}`}>
                      {cand.selected ? '✓ ' : ''}{idx + 1}{cand.text ? ` · ${cand.text.slice(0, 6)}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {draft.creationMode === 'ai-page' && !inpaintDraft && !(bubbleCandidates && bubbleCandidates.length > 0) && (draft.aiPage.showGuideOverlay || !draft.aiPage.generatedPageImage?.url) && (
              <div className="pointer-events-none absolute inset-0 z-20">
                {/* 引导格拖拽移动与右下角缩放把手：引导框不再是只能看的摆设 */}
                {activeTool === 'select' && onUpdateGuidePanel && draft.aiPage.guidePanels.map((gp, idx) => (
                  <div
                    key={`guide-ctrl-${gp.id}`}
                    style={{
                      left: `${gp.x * 100}%`,
                      top: `${gp.y * 100}%`,
                      width: `${gp.width * 100}%`,
                      height: `${gp.height * 100}%`,
                    }}
                    className="pointer-events-none absolute"
                  >
                    <button
                      type="button"
                      aria-label={t('移动引导格 {0}', [gp.label || `第 ${idx + 1} 格`])}
                      title={t('拖拽移动引导格位置')}
                      onPointerDown={event => {
                        if (isPanningMode) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({
                          kind: 'move-guide-panel',
                          guideId: gp.id,
                          dx: pt.x - gp.x,
                          dy: pt.y - gp.y,
                          width: gp.width,
                          height: gp.height,
                        });
                      }}
                      className="pointer-events-auto absolute top-1.5 left-1.5 h-6 w-20 cursor-move rounded bg-transparent hover:bg-indigo-500/15"
                    />
                    <button
                      type="button"
                      aria-label={t('调整引导格 {0} 大小', [gp.label || `第 ${idx + 1} 格`])}
                      title={t('拖拽调整引导格宽高')}
                      onPointerDown={event => {
                        if (isPanningMode) return;
                        event.stopPropagation();
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'resize-guide-panel', guideId: gp.id, origX: gp.x, origY: gp.y });
                      }}
                      className="pointer-events-auto absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-indigo-500 shadow hover:scale-125"
                    />
                  </div>
                ))}

                {/* 破格前景块画布拖拽与右下角缩放把手 */}
                {activeTool === 'select' && onUpdateBreakoutZone && (draft.aiPage.breakoutZones || []).map((bz, idx) => (
                  <div
                    key={`breakout-ctrl-${bz.id}`}
                    style={{
                      left: `${bz.x * 100}%`,
                      top: `${bz.y * 100}%`,
                      width: `${bz.width * 100}%`,
                      height: `${bz.height * 100}%`,
                    }}
                    className="pointer-events-none absolute"
                  >
                    <button
                      type="button"
                      aria-label={t('移动破格前景块 {0}', [bz.label || `#${idx + 1}`])}
                      title={t('拖拽移动破格前景块位置')}
                      onPointerDown={event => {
                        if (isPanningMode) return;
                        event.stopPropagation();
                        onSelect({ kind: 'breakout-zone', id: bz.id });
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({
                          kind: 'move-breakout',
                          zoneId: bz.id,
                          dx: pt.x - bz.x,
                          dy: pt.y - bz.y,
                          width: bz.width,
                          height: bz.height,
                        });
                      }}
                      className="pointer-events-auto absolute top-1.5 left-1.5 h-6 w-24 cursor-move rounded bg-transparent hover:bg-rose-500/20"
                    />
                    <button
                      type="button"
                      aria-label={t('调整破格前景块 {0} 大小', [bz.label || `#${idx + 1}`])}
                      title={t('拖拽调整破格前景块宽高')}
                      onPointerDown={event => {
                        if (isPanningMode) return;
                        event.stopPropagation();
                        onSelect({ kind: 'breakout-zone', id: bz.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'resize-breakout', zoneId: bz.id, origX: bz.x, origY: bz.y });
                      }}
                      className="pointer-events-auto absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-rose-500 shadow hover:scale-125"
                    />
                  </div>
                ))}

                {draft.aiPage.anchors.map((anchor, idx) => {
                  // 气泡锚点已直接在 SVG 画布上渲染为所见即所得的真实漫画气泡，不再退化为无可视化圆点
                  if (anchor.kind === 'bubble') return null;
                  const isSelected = selection?.kind === 'ai-anchor' && selection.id === anchor.id;
                  const dotClass = anchor.kind === 'character' ? 'bg-blue-600'
                    : anchor.kind === 'scene' ? 'bg-emerald-600'
                      : 'bg-purple-600';
                  return (
                    <button
                      key={anchor.id}
                      type="button"
                      aria-label={t('整页锚点 {0}', [anchor.label])}
                      title={`${anchor.label} (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)})`}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select') return;
                        event.stopPropagation();
                        onSelect({ kind: 'ai-anchor', id: anchor.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-ai-anchor', anchorId: anchor.id });
                      }}
                      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                      className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center gap-1 rounded-full border-2 border-white bg-white/95 py-0.5 pl-0.5 pr-2 text-[11px] font-semibold text-gray-800 shadow-md transition hover:scale-105 dark:border-gray-900 dark:bg-gray-900/95 dark:text-gray-100 ${isSelected ? 'ring-2 ring-indigo-500 scale-105' : ''} ${anchor.enabled ? '' : 'opacity-45'}`}
                    >
                      <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white ${dotClass}`}>
                        {idx + 1}
                      </span>
                      <span className="max-w-24 truncate">{anchor.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {draft.creationMode === 'manual' && activeTool === 'select' && selectedPanel && !selectedPanel.locked && !panelsLayerProps.locked && (() => {
              const normBounds = getPanelBoundingBox(selectedPanel.points, 1, 1);
              const aspect = pageW / pageH;
              const center = { x: normBounds.cx, y: normBounds.cy };
              const rotHandleNorm = rotatePointAround(
                { x: normBounds.cx, y: Math.max(0.015, normBounds.minY - 26 / pageH) },
                center,
                selectedPanel.rotation,
                aspect,
              );
              return (
                <div className="pointer-events-none absolute inset-0 z-20">
                  {selectedPanel.anchors.filter(a => a.enabled && a.kind !== 'bubble').map((anchor, idx) => {
                    const localPt = {
                      x: normBounds.minX + anchor.x * normBounds.width,
                      y: normBounds.minY + anchor.y * normBounds.height,
                    };
                    const rotated = rotatePointAround(localPt, center, selectedPanel.rotation, aspect);
                    const colorClass = anchor.kind === 'character' ? 'bg-blue-600'
                      : anchor.kind === 'scene' ? 'bg-emerald-600'
                        : 'bg-purple-600';
                    return (
                      <button
                        key={anchor.id}
                        type="button"
                        aria-label={t('画布锚点 {0}', [anchor.label])}
                        title={`${anchor.label} (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)})`}
                        onPointerDown={event => {
                          event.stopPropagation();
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({ kind: 'move-anchor', panelId: selectedPanel.id, anchorId: anchor.id });
                        }}
                        style={{ left: `${rotated.x * 100}%`, top: `${rotated.y * 100}%` }}
                        className={`pointer-events-auto absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md hover:scale-110 ${colorClass}`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}

                  {selectedPanel.points.map((vertex, idx) => {
                    const rotated = rotatePointAround(vertex, center, selectedPanel.rotation, aspect);
                    return (
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
                        style={{ left: `${rotated.x * 100}%`, top: `${rotated.y * 100}%` }}
                        className="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-indigo-600 bg-white shadow-sm hover:scale-125"
                      />
                    );
                  })}

                  <button
                    type="button"
                    aria-label={t('旋转分镜格')}
                    title={t('拖动旋转分镜格')}
                    onPointerDown={event => {
                      event.stopPropagation();
                      const pt = toNormalizedPoint(event.clientX, event.clientY);
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
                    style={{ left: `${rotHandleNorm.x * 100}%`, top: `${rotHandleNorm.y * 100}%` }}
                    className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-indigo-600 bg-indigo-50 text-[10px] font-bold text-indigo-700 shadow-sm hover:scale-110"
                  >
                    ↻
                  </button>
                </div>
              );
            })()}

            {/* PS 上下文悬浮气泡迷你工具条：点击气泡立即可切换 12 种日漫框形、横竖排、尾巴、字号、复制、删除 */}
            {activeFloatingBubble && !inlineEdit && !drag && activeTool === 'select' && (() => {
              const fb = activeFloatingBubble;
              const anchorTop = Math.max(0.03, fb.y - fb.height / 2);
              const showBelow = anchorTop < 0.14;
              const barTopPct = showBelow ? Math.min(0.95, fb.y + fb.height / 2) * 100 : anchorTop * 100;
              const barLeftPct = Math.min(82, Math.max(18, fb.x * 100));
              const shapeMeta = getBubbleShapeMeta(fb.shape);

              const updateShape = (shape: ComicBubbleShape) => {
                if (fb.mode === 'vector') {
                  onUpdateBubble?.(fb.id, cur => ({ ...cur, shape }), true);
                } else if (fb.mode === 'ai-anchor') {
                  onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleShape: shape }), true);
                } else {
                  onUpdatePanel(fb.panelId, panel => ({
                    ...panel,
                    anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleShape: shape } : a),
                  }), true);
                }
                setShapePopoverOpen(false);
              };

              const toggleWritingMode = () => {
                const next = fb.writingMode === 'vertical' ? 'horizontal' : 'vertical';
                if (fb.mode === 'vector') {
                  onUpdateBubble?.(fb.id, cur => ({ ...cur, writingMode: next }), true);
                } else if (fb.mode === 'ai-anchor') {
                  onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleWritingMode: next }), true);
                } else {
                  onUpdatePanel(fb.panelId, panel => ({
                    ...panel,
                    anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleWritingMode: next } : a),
                  }), true);
                }
              };

              const adjustFontSize = (delta: number) => {
                const next = Math.max(12, Math.min(54, fb.fontSize + delta));
                if (fb.mode === 'vector') {
                  onUpdateBubble?.(fb.id, cur => ({ ...cur, fontSize: next }), true);
                } else if (fb.mode === 'ai-anchor') {
                  onUpdateAiAnchor?.(fb.id, cur => ({ ...cur, bubbleFontSize: next }), true);
                } else {
                  onUpdatePanel(fb.panelId, panel => ({
                    ...panel,
                    anchors: panel.anchors.map(a => a.id === fb.id ? { ...a, bubbleFontSize: next } : a),
                  }), true);
                }
              };

              const handleDelete = () => {
                if (fb.mode === 'vector') {
                  onDeleteBubble?.(fb.id);
                } else if (fb.mode === 'ai-anchor') {
                  onDeleteAiAnchor?.(fb.id);
                } else {
                  onUpdatePanel(fb.panelId, panel => ({
                    ...panel,
                    anchors: panel.anchors.filter(a => a.id !== fb.id),
                  }), true);
                  onSelect({ kind: 'panel', id: fb.panelId });
                }
              };

              return (
                <div
                  role="toolbar"
                  aria-label={t('气泡快捷编辑条')}
                  style={{
                    left: `${barLeftPct}%`,
                    top: `${barTopPct}%`,
                    transform: showBelow ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 14px))',
                  }}
                  onPointerDown={e => e.stopPropagation()}
                  className="appearance-panel absolute z-30 flex items-center gap-1 rounded-xl border border-gray-200/95 bg-white/95 px-1.5 py-1 shadow-xl backdrop-blur dark:border-gray-700/90 dark:bg-gray-900/95"
                >
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={t('切换气泡样式')}
                      onClick={() => setShapePopoverOpen(v => !v)}
                      className="flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-1.5 text-[11px] font-semibold text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <ComicBubbleShapeIcon shape={fb.shape} className="h-4 w-5 text-gray-800 dark:text-gray-100" />
                      <span className="max-w-16 truncate">{t(shapeMeta.label)}</span>
                    </button>
                    {shapePopoverOpen && (
                      <div className="appearance-panel absolute left-0 top-full z-40 mt-1.5 grid w-64 grid-cols-4 gap-1 rounded-xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-gray-700 dark:bg-gray-900/98">
                        {COMIC_BUBBLE_SHAPES.map(meta => (
                          <button
                            key={meta.id}
                            type="button"
                            onClick={() => updateShape(meta.id)}
                            className={`flex flex-col items-center rounded-lg border p-1 transition ${fb.shape === meta.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800'}`}
                          >
                            <ComicBubbleShapeIcon shape={meta.id} className="h-5 w-7" />
                            <span className="mt-0.5 w-full truncate text-center text-[9px] font-medium">{t(meta.label)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label={t('切换横排竖排')}
                    title={t('切换横排竖排')}
                    onClick={toggleWritingMode}
                    className="flex h-7 items-center rounded-lg px-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {fb.writingMode === 'vertical' ? t('竖排') : t('横排')}
                  </button>

                  {fb.mode === 'vector' && (
                    <button
                      type="button"
                      aria-label={t('切换气泡尾巴')}
                      title={t('切换气泡尾巴')}
                      onClick={() => onUpdateBubble?.(fb.id, cur => ({ ...cur, hasTail: !cur.hasTail }), true)}
                      className={`flex h-7 items-center rounded-lg px-1.5 text-[11px] font-semibold transition ${fb.hasTail ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                    >
                      {t('尾巴')}
                    </button>
                  )}

                  <div className="flex items-center rounded-lg border border-gray-200/80 dark:border-gray-700/80">
                    <button
                      type="button"
                      aria-label={t('缩小字号')}
                      onClick={() => adjustFontSize(-2)}
                      className="flex h-7 w-6 items-center justify-center text-[11px] font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      aria-label={t('放大字号')}
                      onClick={() => adjustFontSize(2)}
                      className="flex h-7 w-6 items-center justify-center border-l border-gray-200/80 text-[11px] font-bold text-gray-600 hover:bg-gray-100 dark:border-gray-700/80 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      A+
                    </button>
                  </div>

                  {fb.mode !== 'vector' && onConvertAnchorBubbleToVector && (
                    <button
                      type="button"
                      aria-label={t('转为正式矢量气泡')}
                      title={t('转为可精细调色与压层的正式漫画矢量气泡')}
                      onClick={() => onConvertAnchorBubbleToVector(
                        fb.mode === 'ai-anchor'
                          ? { kind: 'ai-anchor', anchorId: fb.id }
                          : { kind: 'panel-anchor', panelId: fb.panelId, anchorId: fb.id },
                      )}
                      className="flex h-7 items-center gap-1 rounded-lg bg-amber-500 px-2 text-[11px] font-semibold text-white hover:bg-amber-600"
                    >
                      <MessageCircle className="h-3 w-3" />
                      <span>{t('转正式气泡')}</span>
                    </button>
                  )}

                  {fb.mode === 'vector' && onDuplicateBubble && (
                    <button
                      type="button"
                      aria-label={t('复制气泡')}
                      title={t('复制气泡')}
                      onClick={() => onDuplicateBubble(fb.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={t('删除气泡')}
                    title={t('删除气泡')}
                    onClick={handleDelete}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })()}

            {/* 真·所见即所得气泡内原地文本编辑器：直接叠在气泡内部，同字体同排向 */}
            {inlineEdit && inlineEditTarget && (
              <div
                style={{
                  left: `${inlineEditTarget.x * 100}%`,
                  top: `${inlineEditTarget.y * 100}%`,
                  width: `${Math.max(12, inlineEditTarget.width * 100)}%`,
                  height: `${Math.max(8, inlineEditTarget.height * 100)}%`,
                  transform: `translate(-50%, -50%) rotate(${inlineEditTarget.rotation}deg)`,
                }}
                onPointerDown={e => e.stopPropagation()}
                className="absolute z-35 flex items-center justify-center"
              >
                <textarea
                  autoFocus
                  aria-label={t('原地编辑文字')}
                  value={inlineEdit.value}
                  placeholder={t('输入台词…')}
                  onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                  onBlur={commitInlineEdit}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); setInlineEdit(null); }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitInlineEdit(); }
                  }}
                  style={{
                    fontFamily: inlineEditTarget.fontFamily,
                    fontSize: `${inlineEditTarget.fontSize}px`,
                    color: inlineEditTarget.color,
                    writingMode: inlineEditTarget.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                  }}
                  className={`h-full w-full resize-none rounded-lg border-2 border-indigo-500/80 p-1 text-center font-bold leading-snug outline-none ${inlineEditTarget.transparent ? 'bg-white/75 backdrop-blur-[1px]' : 'bg-white/95 shadow-xl'}`}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右下角极简缩放与吸附悬浮胶囊（保留用户偏好的清爽形态） */}
      <div className="appearance-panel absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-full border border-gray-200/90 bg-white/92 px-1.5 py-1 shadow-md backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/92">
        <button
          type="button"
          aria-label={t('边缘与网格吸附')}
          aria-pressed={draft.snapEnabled}
          title={t('边缘与网格吸附')}
          onClick={onToggleSnap}
          className={`flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition ${draft.snapEnabled ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
        >
          <Magnet className="h-3 w-3" />
          <span className="hidden md:inline">{t('吸附')}</span>
        </button>
        <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        <button
          type="button"
          aria-label={t('缩小画布')}
          onClick={() => onZoomChange(Math.max(0.25, Number((zoom - 0.1).toFixed(2))))}
          className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={t('适配画布缩放')}
          onClick={onZoomFit}
          title={t('点击适应屏幕（也可用 Ctrl+滚轮缩放，抓手/空格平移）')}
          className="min-w-11 px-1 text-center font-mono text-xs font-semibold text-gray-700 hover:text-indigo-600 dark:text-gray-200"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label={t('放大画布')}
          onClick={() => onZoomChange(Math.min(3, Number((zoom + 0.1).toFixed(2))))}
          className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={t('适应屏幕')}
          title={t('适应屏幕')}
          onClick={onZoomFit}
          className="flex h-6 w-6 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
