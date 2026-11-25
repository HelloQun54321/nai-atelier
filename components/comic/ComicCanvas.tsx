import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, useLanguage } from '../../services/i18n';
import {
  clampAnchorCoord,
  doesSegmentIntersectPolygon,
  getPanelBoundingBox,
  hitTestPanel,
  pointInPolygon,
  rectToPolygon,
  rotatePointAround,
  snapComicPoint,
} from '../../services/comic/comicGeometry';
import {
  findCutIntersectionsWithPanel,
  isPointStrictlyInsidePolygonPx,
  moveNormalizedPolygon,
  moveNormalizedPolygonEdge,
  moveNormalizedPolygonVertex,
  placeComicPanelBadgePx,
  rotateNormalizedPolygonPoints,
  snapComicPanelAngle,
  snapComicPanelDrag,
  snapCutPointToPanels,
  type ComicCutSnapHit,
  type ComicSnapGuide,
} from '../../services/comic/comicSnapping';
import {
  buildComicBubbleRenderModel,
  computeAutoFitFontSize,
  resolveComicFont,
} from '../../services/comic/comicArtwork';
import { resolveBubbleTextBox } from '../../services/comic/comicAssets';
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
  ComicStroke,
  ComicTool,
} from '../../services/comic/comicTypes';
import { blendModeToCss, DrawingLayerCanvas, renderStickerSvg } from './ComicCanvasArtwork';
import { ComicBubbleFloatingBar, ComicPanelFloatingBar } from './ComicCanvasFloatingToolbars';
import { ComicCanvasZoomBar } from './ComicCanvasZoomBar';
import { ComicCanvasContextMenu } from './ComicCanvasContextMenu';

interface ComicCanvasProps {
  draft: ComicPageDraft;
  aiZonePlan?: ComicAiZonePlan;
  inpaintDraft?: ComicInpaintDraft | null;
  bubbleCandidates?: ComicBubbleCandidate[] | null;
  comparingOriginalAiImage?: boolean;
  activeTool: ComicTool;
  drawPanelAsOverlay?: boolean;
  selection: ComicSelection;
  zoom: number;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  generatingPanelId?: string | null;
  generatingAiPage?: boolean;
  generatingAiZoneIndex?: 0 | 1 | null;
  livePreviewImage?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSelectTool?: (tool: ComicTool) => void;
  onToggleLayersDrawer?: () => void;
  onSelect: (selection: ComicSelection) => void;
  onZoomChange: (nextZoom: number) => void;
  onZoomFit: () => void;
  onToggleSnap: () => void;
  onUpdatePanel: (panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit?: boolean) => void;
  onTogglePanelOverlay?: (panelId: string) => void;
  onTogglePanelBorderless?: (panelId: string) => void;
  onBringPanelOrder?: (panelId: string, mode: 'front' | 'back') => void;
  onDuplicatePanel?: (panelId: string) => void;
  onDeletePanel?: (panelId: string) => void;
  onUploadImageToPanel?: (panelId: string, file: File) => void;
  onOpenPanelHistoryPicker?: (panelId: string) => void;
  onMoveAiAnchor?: (anchorId: string, x: number, y: number, commit?: boolean) => void;
  onUpdateAiAnchor?: (anchorId: string, updater: (anchor: ComicAnchor) => ComicAnchor, commit?: boolean) => void;
  onDeleteAiAnchor?: (anchorId: string) => void;
  onConvertAnchorBubbleToVector?: (source: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string }) => void;
  onUpdateGuidePanel?: (guideId: string, patch: { x: number; y: number; width: number; height: number }, commit?: boolean) => void;
  onUpdateGuidePanelPoints?: (guideId: string, points: ComicPoint[], commit?: boolean) => void;
  onToggleGuidePanelFlag?: (guideId: string, flag: 'inset' | 'borderless' | 'bleed') => void;
  onDuplicateGuidePanel?: (guideId: string) => void;
  onDeleteGuidePanel?: (guideId: string) => void;
  onUpdateBreakoutZone?: (zoneId: string, patch: { x: number; y: number; width: number; height: number }, commit?: boolean) => void;
  onToggleBubbleCandidate?: (candidateId: string) => void;
  onWheelScalePanelImage?: (panelId: string, delta: number) => void;
  onChangeInpaintRect?: (rect: ComicInpaintRect) => void;
  onMoveInpaintAnchor?: (anchorId: string, x: number, y: number) => void;
  onAddPanel: (points: ComicPoint[], asOverlay?: boolean) => void;
  onSliceAtLine: (start: ComicPoint, end: ComicPoint) => void;
  onSlicePolygonPath?: (panelId: string, path: ComicPoint[]) => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
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
  | { kind: 'move-panel'; panelId: string; startPoint: ComicPoint; origPoints: ComicPoint[]; origRotation: number }
  | { kind: 'pan-image'; panelId: string; startPoint: ComicPoint; origOffsetX: number; origOffsetY: number }
  | { kind: 'vertex'; panelId: string; vertexIndex: number; startPoint: ComicPoint; origPoints: ComicPoint[]; rotation: number }
  | { kind: 'edge'; panelId: string; edgeIndex: number; startPoint: ComicPoint; origPoints: ComicPoint[]; rotation: number }
  | { kind: 'rotate-panel'; panelId: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'gesture-panel'; panelId: string; origPoints: ComicPoint[]; origRotation: number; startCenter: ComicPoint; startAngle: number }
  | { kind: 'move-anchor'; panelId: string; anchorId: string }
  | { kind: 'resize-panel-anchor-bubble'; panelId: string; anchorId: string; cx: number; cy: number }
  | { kind: 'move-ai-anchor'; anchorId: string }
  | { kind: 'resize-ai-anchor-bubble'; anchorId: string; cx: number; cy: number }
  | { kind: 'move-guide-panel'; guideId: string; startPoint: ComicPoint; origPoints: ComicPoint[] }
  | { kind: 'guide-vertex'; guideId: string; vertexIndex: number; startPoint: ComicPoint; origPoints: ComicPoint[] }
  | { kind: 'guide-edge'; guideId: string; edgeIndex: number; startPoint: ComicPoint; origPoints: ComicPoint[] }
  | { kind: 'rotate-guide-panel'; guideId: string; cx: number; cy: number; startAngle: number; baseOrientation: number; origPoints: ComicPoint[] }
  | { kind: 'gesture-guide-panel'; guideId: string; origPoints: ComicPoint[]; baseOrientation: number; startCenter: ComicPoint; startAngle: number }
  | { kind: 'move-breakout'; zoneId: string; dx: number; dy: number; width: number; height: number }
  | { kind: 'resize-breakout'; zoneId: string; origX: number; origY: number }
  | { kind: 'draw-inpaint'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'move-inpaint'; dx: number; dy: number; width: number; height: number }
  | { kind: 'resize-inpaint'; origX: number; origY: number }
  | { kind: 'move-inpaint-anchor'; anchorId: string }
  | { kind: 'draw-panel'; startPoint: ComicPoint; currentPoint: ComicPoint }
  | { kind: 'slice'; startPoint: ComicPoint; currentPoint: ComicPoint; snapPanelId?: string; snapStartPoint?: ComicPoint; crossedEnd?: ComicPoint; moved?: boolean }
  | { kind: 'move-bubble'; id: string; dx: number; dy: number; origX: number; origY: number; origRotation: number }
  | { kind: 'resize-bubble'; id: string; handle: ResizeHandleDir; startPoint: ComicPoint; origX: number; origY: number; origW: number; origH: number }
  | { kind: 'rotate-bubble'; id: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'gesture-bubble'; id: string; origX: number; origY: number; origRotation: number; startCenter: ComicPoint; startAngle: number }
  | { kind: 'move-bubble-tail'; id: string }
  | { kind: 'move-text'; id: string; dx: number; dy: number }
  | { kind: 'move-sticker'; id: string; dx: number; dy: number }
  | { kind: 'resize-sticker'; id: string; origX: number; origY: number }
  | { kind: 'move-image-layer'; id: string; dx: number; dy: number }
  | { kind: 'resize-image-layer'; id: string; handle: ResizeHandleDir; startPoint: ComicPoint; origX: number; origY: number; origW: number; origH: number }
  | { kind: 'rotate-image-layer'; id: string; cx: number; cy: number; startAngle: number; origRotation: number }
  | { kind: 'stroke'; drawingLayerId: string; stroke: ComicStroke };

type InlineEditState =
  | { kind: 'bubble'; id: string; value: string; openedAt?: number }
  | { kind: 'text'; id: string; value: string; openedAt?: number }
  | { kind: 'ai-anchor-bubble'; anchorId: string; value: string; openedAt?: number }
  | { kind: 'panel-anchor-bubble'; panelId: string; anchorId: string; value: string; openedAt?: number }
  | null;

export const ComicCanvas: React.FC<ComicCanvasProps> = ({
  draft,
  aiZonePlan,
  inpaintDraft,
  bubbleCandidates,
  comparingOriginalAiImage,
  activeTool,
  drawPanelAsOverlay = false,
  selection,
  zoom,
  brushColor,
  brushSize,
  brushOpacity,
  generatingPanelId,
  generatingAiPage,
  generatingAiZoneIndex,
  livePreviewImage,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSelectTool,
  onToggleLayersDrawer,
  onSelect,
  onZoomChange,
  onZoomFit,
  onToggleSnap,
  onUpdatePanel,
  onTogglePanelOverlay,
  onTogglePanelBorderless,
  onBringPanelOrder,
  onDuplicatePanel,
  onDeletePanel,
  onUploadImageToPanel,
  onOpenPanelHistoryPicker,
  onMoveAiAnchor,
  onUpdateAiAnchor,
  onDeleteAiAnchor,
  onConvertAnchorBubbleToVector,
  onUpdateGuidePanel,
  onUpdateGuidePanelPoints,
  onToggleGuidePanelFlag,
  onDuplicateGuidePanel,
  onDeleteGuidePanel,
  onUpdateBreakoutZone,
  onToggleBubbleCandidate,
  onWheelScalePanelImage,
  onChangeInpaintRect,
  onMoveInpaintAnchor,
  onAddPanel,
  onSliceAtLine,
  onSlicePolygonPath,
  onDuplicateSelection,
  onDeleteSelection,
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
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTapRef = useRef<{ key: string; time: number; x: number; y: number } | null>(null);
  const touchPointsRef = useRef<Map<number, ComicPoint>>(new Map());
  const panelUploadInputRef = useRef<HTMLInputElement>(null);
  const panelUploadTargetRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragAction | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number }>({});
  const [snapGuides, setSnapGuides] = useState<ComicSnapGuide[]>([]);
  const [rotationBadge, setRotationBadge] = useState<{ cx: number; cy: number; angle: number } | null>(null);
  const [activeCut, setActiveCut] = useState<{ panelId: string; points: ComicPoint[] } | null>(null);
  const [cutHover, setCutHover] = useState<ComicCutSnapHit | null>(null);
  const [cutCursor, setCutCursor] = useState<ComicPoint | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);

  useEffect(() => {
    setActiveCut(null);
    setCutHover(null);
    setCutCursor(null);
    setSnapGuides([]);
    setRotationBadge(null);
  }, [activeTool, draft.creationMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const openInlineEdit = (next: Exclude<InlineEditState, null>) => {
    setDrag(null);
    setInlineEdit({ ...next, openedAt: Date.now() });
  };

  useEffect(() => {
    if (!inlineEdit) return;
    const frame = window.requestAnimationFrame(() => {
      const el = inlineTextareaRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inlineEdit?.kind, inlineEdit && 'id' in inlineEdit ? inlineEdit.id : '', inlineEdit && 'anchorId' in inlineEdit ? inlineEdit.anchorId : '']);

  // 检测画布内元素双击（避免 pointerdown 拖拽捕获吞掉原生 dblclick）
  const checkDoubleTap = (key: string, clientX: number, clientY: number): boolean => {
    const prev = lastTapRef.current;
    const now = Date.now();
    if (prev && prev.key === key && now - prev.time < 420 && Math.hypot(clientX - prev.x, clientY - prev.y) < 12) {
      lastTapRef.current = null;
      return true;
    }
    lastTapRef.current = { key, time: now, x: clientX, y: clientY };
    return false;
  };

  const syncedDraft = useMemo(() => syncComicLayerStack(draft), [draft]);
  const layerStack = useMemo(() => syncedDraft.layerStack || [], [syncedDraft.layerStack]);
  const panelsLayerProps = useMemo(() => {
    const node = layerStack.find(n => n.kind === 'panels');
    return node ? resolveEffectiveLayerProps(node, layerStack) : { visible: true, locked: false, opacity: 1, blendMode: 'normal' as ComicBlendMode, depth: 0 };
  }, [layerStack]);

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

  const getEffectiveManualPoly = (panel: ComicPanel): ComicPoint[] => {
    if (!panel.rotation) return panel.points;
    const b = getPanelBoundingBox(panel.points, 1, 1);
    const center = { x: b.cx, y: b.cy };
    const aspect = pageW / Math.max(1, pageH);
    return panel.points.map(pt => rotatePointAround(pt, center, panel.rotation, aspect));
  };

  const editableCutPanels = useMemo(() => {
    if (draft.creationMode === 'ai-page') {
      const ordered = [
        ...draft.aiPage.guidePanels.filter(gp => gp.inset),
        ...draft.aiPage.guidePanels.filter(gp => !gp.inset),
      ];
      return ordered.map(gp => ({
        id: gp.id,
        points: getGuidePanelPolygon(gp),
        rotation: 0,
      }));
    }
    return [...sortedPanels]
      .reverse()
      .filter(panel => !panel.locked)
      .map(panel => ({
        id: panel.id,
        points: getEffectiveManualPoly(panel),
        rotation: panel.rotation,
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.aiPage.guidePanels, draft.creationMode, pageH, pageW, sortedPanels]);

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
    setContextMenu(null);
    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, toNormalizedPoint(event.clientX, event.clientY));
      if (touchPointsRef.current.size === 2 && drag) {
        const [a, b] = [...touchPointsRef.current.values()];
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const angle = (Math.atan2((b.y - a.y) * pageH, (b.x - a.x) * pageW) * 180) / Math.PI;
        if (drag.kind === 'move-panel' || drag.kind === 'rotate-panel') {
          const panel = draft.panels.find(p => p.id === drag.panelId);
          if (panel) {
            event.preventDefault();
            stageRef.current?.setPointerCapture?.(event.pointerId);
            setSnapGuides([]);
            setDrag({
              kind: 'gesture-panel',
              panelId: panel.id,
              origPoints: panel.points.map(pt => ({ ...pt })),
              origRotation: panel.rotation || 0,
              startCenter: center,
              startAngle: angle,
            });
            return;
          }
        } else if (drag.kind === 'move-guide-panel' || drag.kind === 'rotate-guide-panel') {
          const gp = draft.aiPage.guidePanels.find(g => g.id === drag.guideId);
          if (gp) {
            const poly = getGuidePanelPolygon(gp);
            const orientation = (Math.atan2((poly[1].y - poly[0].y) * pageH, (poly[1].x - poly[0].x) * pageW) * 180) / Math.PI;
            event.preventDefault();
            stageRef.current?.setPointerCapture?.(event.pointerId);
            setSnapGuides([]);
            setDrag({
              kind: 'gesture-guide-panel',
              guideId: gp.id,
              origPoints: poly,
              baseOrientation: orientation,
              startCenter: center,
              startAngle: angle,
            });
            return;
          }
        } else if (drag.kind === 'move-bubble' || drag.kind === 'rotate-bubble') {
          const bubble = draft.bubbles.find(item => item.id === drag.id);
          if (bubble) {
            event.preventDefault();
            stageRef.current?.setPointerCapture?.(event.pointerId);
            setDrag({
              kind: 'gesture-bubble',
              id: bubble.id,
              origX: bubble.x,
              origY: bubble.y,
              origRotation: bubble.rotation || 0,
              startCenter: center,
              startAngle: angle,
            });
            return;
          }
        }
      }
    }

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
      if (panelsLayerProps.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const siblingPolys = draft.creationMode === 'ai-page'
        ? draft.aiPage.guidePanels.map(getGuidePanelPolygon)
        : draft.panels.map(getEffectiveManualPoly);
      const snapPts = siblingPolys.map((pts, idx) => ({ id: String(idx), points: pts }) as ComicPanel);
      const snapped = snapComicPoint(pt, snapPts, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      setDrag({ kind: 'draw-panel', startPoint: snapped.point, currentPoint: snapped.point });
      return;
    }

    if (activeTool === 'slice') {
      if (panelsLayerProps.locked) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const thresholdPx = (event.pointerType === 'touch' ? 22 : 14) / Math.max(0.25, zoom);
      const candidates = activeCut
        ? editableCutPanels.filter(item => item.id === activeCut.panelId)
        : editableCutPanels;
      const near = snapCutPointToPanels(candidates, pt, pageW, pageH, thresholdPx);
      if (near && !activeCut) {
        onSelect(draft.creationMode === 'ai-page'
          ? { kind: 'guide-panel', id: near.panelId }
          : { kind: 'panel', id: near.panelId });
      }
      setCutHover(near);
      setCutCursor(near?.point || pt);
      setDrag({
        kind: 'slice',
        startPoint: near?.point || pt,
        currentPoint: near?.point || pt,
        snapPanelId: activeCut?.panelId || near?.panelId,
        snapStartPoint: activeCut ? undefined : near?.point,
        moved: false,
      });
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

    if (draft.creationMode === 'ai-page' && panelsLayerProps.visible && !inpaintDraft) {
      const orderedGuides = [
        ...draft.aiPage.guidePanels.filter(gp => gp.inset),
        ...draft.aiPage.guidePanels.filter(gp => !gp.inset),
      ];
      for (const gp of orderedGuides) {
        const poly = getGuidePanelPolygon(gp);
        if (pointInPolygon(pt, poly)) {
          onSelect({ kind: 'guide-panel', id: gp.id });
          if (!panelsLayerProps.locked && activeTool === 'select') {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({
              kind: 'move-guide-panel',
              guideId: gp.id,
              startPoint: pt,
              origPoints: poly.map(p => ({ ...p })),
            });
          }
          return;
        }
      }
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
                origRotation: panel.rotation || 0,
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
    const pt = toNormalizedPoint(event.clientX, event.clientY);
    if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, pt);
    }

    // 切割工具悬停预演：边界高亮 + 磁吸圆点 + 拐弯虚线与实时格缝带宽
    if (!drag && activeTool === 'slice') {
      const thresholdPx = (event.pointerType === 'touch' ? 22 : 14) / Math.max(0.25, zoom);
      const candidates = activeCut
        ? editableCutPanels.filter(item => item.id === activeCut.panelId)
        : editableCutPanels;
      let next = pt;
      if (activeCut && event.shiftKey) {
        const prev = activeCut.points[activeCut.points.length - 1];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        next = { x: prev.x + Math.cos(angle) * dist, y: prev.y + Math.sin(angle) * dist };
      }
      const near = snapCutPointToPanels(candidates, next, pageW, pageH, thresholdPx);
      setCutHover(near);
      setCutCursor(near?.point || (activeCut ? next : null));
      return;
    }

    if (!drag || drag.kind === 'pan-viewport') return;

    if (drag.kind === 'stroke') {
      setDrag({ ...drag, stroke: { ...drag.stroke, points: [...drag.stroke.points, pt] } });
      return;
    }

    if (drag.kind === 'draw-panel') {
      const siblingPolys = draft.creationMode === 'ai-page'
        ? draft.aiPage.guidePanels.map(getGuidePanelPolygon)
        : draft.panels.map(getEffectiveManualPoly);
      const snapPts = siblingPolys.map((pts, idx) => ({ id: String(idx), points: pts }) as ComicPanel);
      const snapped = snapComicPoint(pt, snapPts, draft.snapEnabled);
      setSnapGuide({ x: snapped.guideX, y: snapped.guideY });
      setDrag({ ...drag, currentPoint: snapped.point });
      return;
    }

    if (drag.kind === 'slice') {
      const origin = activeCut ? activeCut.points[activeCut.points.length - 1] : drag.startPoint;
      let next = pt;
      if (event.shiftKey) {
        const dx = pt.x - origin.x;
        const dy = pt.y - origin.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        next = { x: origin.x + Math.cos(angle) * dist, y: origin.y + Math.sin(angle) * dist };
      }
      const thresholdPx = (event.pointerType === 'touch' ? 22 : 14) / Math.max(0.25, zoom);
      const candidates = drag.snapPanelId
        ? editableCutPanels.filter(item => item.id === drag.snapPanelId)
        : editableCutPanels;
      const near = snapCutPointToPanels(candidates, next, pageW, pageH, thresholdPx);
      let crossedEnd = drag.crossedEnd;
      if (!activeCut && drag.snapPanelId && drag.snapStartPoint && !crossedEnd) {
        const target = editableCutPanels.find(item => item.id === drag.snapPanelId);
        if (target) {
          const hits = findCutIntersectionsWithPanel(target.id, target.points, drag.snapStartPoint, next, pageW, pageH);
          const farHit = hits.find(h => (
            Math.hypot((h.point.x - drag.snapStartPoint!.x) * pageW, (h.point.y - drag.snapStartPoint!.y) * pageH) >= 12
          ));
          if (farHit) crossedEnd = farHit.point;
        }
      }
      const moved = drag.moved || Math.hypot((pt.x - drag.startPoint.x) * pageW, (pt.y - drag.startPoint.y) * pageH) >= 5;
      setCutHover(near);
      setCutCursor(crossedEnd || near?.point || next);
      setDrag({ ...drag, currentPoint: near?.point || next, crossedEnd, moved });
      return;
    }

    if (drag.kind === 'gesture-panel' && touchPointsRef.current.size >= 2) {
      const [a, b] = [...touchPointsRef.current.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const angle = (Math.atan2((b.y - a.y) * pageH, (b.x - a.x) * pageW) * 180) / Math.PI;
      const dx = center.x - drag.startCenter.x;
      const dy = center.y - drag.startCenter.y;
      const siblings = draft.panels.filter(p => p.id !== drag.panelId).map(getEffectiveManualPoly);
      const snapped = snapComicPanelAngle(drag.origRotation + (angle - drag.startAngle), siblings, pageW, pageH, false, draft.snapEnabled);
      const nextPts = moveNormalizedPolygon(drag.origPoints, { x: dx, y: dy }, pageW, pageH);
      const box = getPanelBoundingBox(nextPts, pageW, pageH);
      setRotationBadge({ cx: box.cx, cy: box.cy, angle: snapped.angle });
      onUpdatePanel(drag.panelId, panel => ({
        ...panel,
        points: nextPts,
        rotation: Number(snapped.angle.toFixed(1)),
      }), false);
      return;
    }

    if (drag.kind === 'gesture-guide-panel' && touchPointsRef.current.size >= 2) {
      const [a, b] = [...touchPointsRef.current.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const angle = (Math.atan2((b.y - a.y) * pageH, (b.x - a.x) * pageW) * 180) / Math.PI;
      const dx = center.x - drag.startCenter.x;
      const dy = center.y - drag.startCenter.y;
      const siblings = draft.aiPage.guidePanels.filter(g => g.id !== drag.guideId).map(getGuidePanelPolygon);
      const snapped = snapComicPanelAngle(drag.baseOrientation + (angle - drag.startAngle), siblings, pageW, pageH, false, draft.snapEnabled);
      const rotated = rotateNormalizedPolygonPoints(drag.origPoints, snapped.angle - drag.baseOrientation, { x: dx, y: dy }, pageW, pageH);
      if (rotated) {
        const box = getPanelBoundingBox(rotated, pageW, pageH);
        setRotationBadge({ cx: box.cx, cy: box.cy, angle: snapped.angle });
        onUpdateGuidePanelPoints?.(drag.guideId, rotated, false);
      }
      return;
    }

    if (drag.kind === 'gesture-bubble' && touchPointsRef.current.size >= 2) {
      const [a, b] = [...touchPointsRef.current.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const angle = (Math.atan2((b.y - a.y) * pageH, (b.x - a.x) * pageW) * 180) / Math.PI;
      const nextRot = Math.max(-45, Math.min(45, Math.round(drag.origRotation + (angle - drag.startAngle))));
      const nx = Math.min(0.98, Math.max(0.02, drag.origX + (center.x - drag.startCenter.x)));
      const ny = Math.min(0.98, Math.max(0.02, drag.origY + (center.y - drag.startCenter.y)));
      onUpdateBubble?.(drag.id, cur => ({
        ...cur,
        x: nx,
        y: ny,
        tailX: cur.tailX + (nx - cur.x),
        tailY: cur.tailY + (ny - cur.y),
        rotation: nextRot,
      }), false);
      return;
    }

    if (drag.kind === 'vertex' || drag.kind === 'edge') {
      const thresholdPx = (event.pointerType === 'touch' ? 10 : 7) / Math.max(0.25, zoom);
      const snapEnabled = !event.altKey && draft.snapEnabled;
      const siblings = draft.panels.filter(p => p.id !== drag.panelId).map(getEffectiveManualPoly);
      let startNorm = drag.startPoint;
      let curNorm = pt;
      if (drag.rotation) {
        const origB = getPanelBoundingBox(drag.origPoints, 1, 1);
        const center = { x: origB.cx, y: origB.cy };
        const aspect = pageW / Math.max(1, pageH);
        startNorm = rotatePointAround(drag.startPoint, center, -drag.rotation, aspect);
        curNorm = rotatePointAround(pt, center, -drag.rotation, aspect);
      }
      const rawDelta = { x: curNorm.x - startNorm.x, y: curNorm.y - startNorm.y };
      const kind = drag.kind === 'vertex' ? 'vertex' : 'edge';
      const idx = drag.kind === 'vertex' ? drag.vertexIndex : drag.edgeIndex;
      const snapped = drag.rotation
        ? { delta: rawDelta, guides: [] as ComicSnapGuide[] }
        : snapComicPanelDrag({
          points: drag.origPoints,
          kind,
          index: idx,
          deltaNorm: rawDelta,
          siblingPolygons: siblings,
          pageW,
          pageH,
          thresholdPx,
          shift: event.shiftKey,
          enabled: snapEnabled,
        });
      const movedPts = drag.kind === 'vertex'
        ? moveNormalizedPolygonVertex(
          drag.origPoints,
          drag.vertexIndex,
          { x: drag.origPoints[drag.vertexIndex].x + snapped.delta.x, y: drag.origPoints[drag.vertexIndex].y + snapped.delta.y },
          pageW,
          pageH,
        )
        : moveNormalizedPolygonEdge(drag.origPoints, drag.edgeIndex, snapped.delta, pageW, pageH);
      if (movedPts) {
        setSnapGuides(snapped.guides);
        onUpdatePanel(drag.panelId, panel => ({ ...panel, points: movedPts }), false);
      } else {
        setSnapGuides([]);
      }
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

    if (drag.kind === 'move-guide-panel' || drag.kind === 'guide-vertex' || drag.kind === 'guide-edge') {
      const thresholdPx = (event.pointerType === 'touch' ? 10 : 7) / Math.max(0.25, zoom);
      const snapEnabled = !event.altKey && draft.snapEnabled;
      const siblings = draft.aiPage.guidePanels.filter(g => g.id !== drag.guideId).map(getGuidePanelPolygon);
      const rawDelta = { x: pt.x - drag.startPoint.x, y: pt.y - drag.startPoint.y };
      const snapKind = drag.kind === 'move-guide-panel' ? 'move' : drag.kind === 'guide-vertex' ? 'vertex' : 'edge';
      const idx = drag.kind === 'guide-vertex' ? drag.vertexIndex : drag.kind === 'guide-edge' ? drag.edgeIndex : 0;
      const snapped = snapComicPanelDrag({
        points: drag.origPoints,
        kind: snapKind,
        index: idx,
        deltaNorm: rawDelta,
        siblingPolygons: siblings,
        pageW,
        pageH,
        thresholdPx,
        shift: event.shiftKey,
        enabled: snapEnabled,
      });
      let nextPts: ComicPoint[] | null = null;
      if (drag.kind === 'move-guide-panel') {
        nextPts = moveNormalizedPolygon(drag.origPoints, snapped.delta, pageW, pageH);
      } else if (drag.kind === 'guide-vertex') {
        nextPts = moveNormalizedPolygonVertex(
          drag.origPoints,
          drag.vertexIndex,
          { x: drag.origPoints[drag.vertexIndex].x + snapped.delta.x, y: drag.origPoints[drag.vertexIndex].y + snapped.delta.y },
          pageW,
          pageH,
        );
      } else {
        nextPts = moveNormalizedPolygonEdge(drag.origPoints, drag.edgeIndex, snapped.delta, pageW, pageH);
      }
      if (nextPts) {
        setSnapGuides(snapped.guides);
        if (onUpdateGuidePanelPoints) {
          onUpdateGuidePanelPoints(drag.guideId, nextPts, false);
        } else {
          const b = getPanelBoundingBox(nextPts, 1, 1);
          onUpdateGuidePanel?.(drag.guideId, { x: b.minX, y: b.minY, width: b.width, height: b.height }, false);
        }
      } else {
        setSnapGuides([]);
      }
      return;
    }

    if (drag.kind === 'rotate-guide-panel') {
      const curAngle = (Math.atan2((pt.y - drag.cy) * pageH, (pt.x - drag.cx) * pageW) * 180) / Math.PI;
      const siblings = draft.aiPage.guidePanels.filter(g => g.id !== drag.guideId).map(getGuidePanelPolygon);
      const rawOrientation = drag.baseOrientation + (curAngle - drag.startAngle);
      const snapped = snapComicPanelAngle(rawOrientation, siblings, pageW, pageH, event.shiftKey, !event.altKey && draft.snapEnabled);
      const rotated = rotateNormalizedPolygonPoints(drag.origPoints, snapped.angle - drag.baseOrientation, { x: 0, y: 0 }, pageW, pageH);
      if (rotated) {
        setRotationBadge({ cx: drag.cx * pageW, cy: drag.cy * pageH, angle: snapped.angle });
        onUpdateGuidePanelPoints?.(drag.guideId, rotated, false);
      }
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
      const thresholdPx = (event.pointerType === 'touch' ? 10 : 7) / Math.max(0.25, zoom);
      const siblings = draft.panels.filter(p => p.id !== drag.panelId).map(getEffectiveManualPoly);
      const rawDelta = { x: pt.x - drag.startPoint.x, y: pt.y - drag.startPoint.y };
      const snapped = snapComicPanelDrag({
        points: drag.origPoints,
        kind: 'move',
        deltaNorm: rawDelta,
        siblingPolygons: siblings,
        pageW,
        pageH,
        thresholdPx,
        shift: event.shiftKey,
        enabled: !event.altKey && draft.snapEnabled,
      });
      const movedPts = moveNormalizedPolygon(drag.origPoints, snapped.delta, pageW, pageH);
      setSnapGuides(snapped.guides);
      onUpdatePanel(drag.panelId, panel => ({ ...panel, points: movedPts }), false);
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
      const siblings = draft.panels.filter(p => p.id !== drag.panelId).map(getEffectiveManualPoly);
      const rawRot = drag.origRotation + (angle - drag.startAngle);
      const snapped = snapComicPanelAngle(rawRot, siblings, pageW, pageH, event.shiftKey, !event.altKey && draft.snapEnabled);
      const nextRot = Number(snapped.angle.toFixed(1));
      setRotationBadge({ cx: drag.cx * pageW, cy: drag.cy * pageH, angle: nextRot });
      onUpdatePanel(drag.panelId, panel => ({ ...panel, rotation: nextRot }), false);
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
      setRotationBadge({ cx: drag.cx * pageW, cy: drag.cy * pageH, angle: nextRot });
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
      const targetImg = imageLayerMap.get(drag.id);
      const h = drag.handle;
      const dx = pt.x - drag.startPoint.x;
      const dy = pt.y - drag.startPoint.y;
      let nextW = drag.origW;
      let nextH = drag.origH;
      if (h.includes('e')) nextW = Math.min(1.5, Math.max(0.04, drag.origW + dx * 2));
      if (h.includes('w')) nextW = Math.min(1.5, Math.max(0.04, drag.origW - dx * 2));
      if (h.includes('s')) nextH = Math.min(1.5, Math.max(0.04, drag.origH + dy * 2));
      if (h.includes('n')) nextH = Math.min(1.5, Math.max(0.04, drag.origH - dy * 2));

      const isCorner = h.length === 2;
      const keepAspect = isCorner && ((targetImg?.lockAspect !== false) !== event.shiftKey);
      if (keepAspect && drag.origH > 0 && drag.origW > 0) {
        const scaleW = nextW / drag.origW;
        const scaleH = nextH / drag.origH;
        const uniform = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
        nextW = Math.min(1.5, Math.max(0.04, drag.origW * uniform));
        nextH = Math.min(1.5, Math.max(0.04, drag.origH * uniform));
      }
      onUpdateImageLayer?.(drag.id, cur => ({
        ...cur,
        width: Number(nextW.toFixed(3)),
        height: Number(nextH.toFixed(3)),
      }), false);
      return;
    }
    if (drag.kind === 'rotate-image-layer') {
      const angle = (Math.atan2((pt.y - drag.cy) * pageH, (pt.x - drag.cx) * pageW) * 180) / Math.PI;
      let nextRot = drag.origRotation + (angle - drag.startAngle);
      if (!event.altKey && Math.abs(nextRot % 15) < 2.5) nextRot = Math.round(nextRot / 15) * 15;
      while (nextRot > 180) nextRot -= 360;
      while (nextRot < -180) nextRot += 360;
      nextRot = Math.round(nextRot);
      setRotationBadge({ cx: drag.cx * pageW, cy: drag.cy * pageH, angle: nextRot });
      onUpdateImageLayer?.(drag.id, cur => ({ ...cur, rotation: nextRot }), false);
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

  const finishDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event?.pointerType === 'touch') {
      touchPointsRef.current.delete(event.pointerId);
      if (touchPointsRef.current.size === 1 && drag && (drag.kind === 'gesture-panel' || drag.kind === 'gesture-guide-panel' || drag.kind === 'gesture-bubble')) {
        const [, remaining] = [...touchPointsRef.current.entries()][0];
        if (drag.kind === 'gesture-panel') {
          const panel = draft.panels.find(p => p.id === drag.panelId);
          if (panel) {
            setRotationBadge(null);
            setDrag({ kind: 'move-panel', panelId: panel.id, startPoint: remaining, origPoints: panel.points.map(p => ({ ...p })), origRotation: panel.rotation });
            return;
          }
        } else if (drag.kind === 'gesture-guide-panel') {
          const gp = draft.aiPage.guidePanels.find(g => g.id === drag.guideId);
          if (gp) {
            setRotationBadge(null);
            setDrag({ kind: 'move-guide-panel', guideId: gp.id, startPoint: remaining, origPoints: getGuidePanelPolygon(gp) });
            return;
          }
        }
      }
    }
    if (!drag) return;
    if (drag.kind === 'stroke' && drag.stroke.points.length > 0) {
      onCommitStroke(drag.stroke, drag.drawingLayerId);
    } else if (drag.kind === 'draw-panel') {
      const minX = Math.min(drag.startPoint.x, drag.currentPoint.x);
      const minY = Math.min(drag.startPoint.y, drag.currentPoint.y);
      const w = Math.abs(drag.currentPoint.x - drag.startPoint.x);
      const h = Math.abs(drag.currentPoint.y - drag.startPoint.y);
      if (w > 0.04 && h > 0.04) {
        onAddPanel(rectToPolygon(minX, minY, w, h), drawPanelAsOverlay);
      }
    } else if (drag.kind === 'slice') {
      const thresholdPx = 14 / Math.max(0.25, zoom);
      const curPt = drag.currentPoint;
      if (activeCut) {
        const target = editableCutPanels.find(item => item.id === activeCut.panelId);
        if (target) {
          const nearEnd = snapCutPointToPanels([target], curPt, pageW, pageH, thresholdPx);
          const prevPt = activeCut.points[activeCut.points.length - 1];
          const hits = findCutIntersectionsWithPanel(target.id, target.points, prevPt, curPt, pageW, pageH);
          const boundaryEnd = hits[0]?.point || nearEnd?.point;
          const distFromStart = Math.hypot((curPt.x - activeCut.points[0].x) * pageW, (curPt.y - activeCut.points[0].y) * pageH);
          if (boundaryEnd && distFromStart >= 10 && onSlicePolygonPath) {
            onSlicePolygonPath(target.id, [...activeCut.points, boundaryEnd]);
            setActiveCut(null);
            setCutHover(null);
            setCutCursor(null);
          } else {
            const targetPx = target.points.map(p => ({ x: p.x * pageW, y: p.y * pageH }));
            if (isPointStrictlyInsidePolygonPx(targetPx, { x: curPt.x * pageW, y: curPt.y * pageH })) {
              const distFromPrev = Math.hypot((curPt.x - prevPt.x) * pageW, (curPt.y - prevPt.y) * pageH);
              if (distFromPrev >= 6) {
                setActiveCut({ ...activeCut, points: [...activeCut.points, curPt] });
                setCutHover(null);
                setCutCursor(curPt);
              }
            } else {
              setActiveCut(null);
              setCutHover(null);
              setCutCursor(null);
            }
          }
        } else {
          setActiveCut(null);
        }
      } else if (drag.snapPanelId && drag.snapStartPoint) {
        const target = editableCutPanels.find(item => item.id === drag.snapPanelId);
        if (target) {
          const nearEnd = snapCutPointToPanels([target], curPt, pageW, pageH, thresholdPx);
          const endPt = drag.crossedEnd || (
            nearEnd && Math.hypot((nearEnd.point.x - drag.snapStartPoint.x) * pageW, (nearEnd.point.y - drag.snapStartPoint.y) * pageH) >= 12
              ? nearEnd.point
              : undefined
          );
          if (endPt && onSlicePolygonPath) {
            onSlicePolygonPath(target.id, [drag.snapStartPoint, endPt]);
            setCutHover(null);
            setCutCursor(null);
          } else if (!drag.moved) {
            setActiveCut({ panelId: target.id, points: [drag.snapStartPoint] });
            setCutHover(null);
          } else {
            const targetPx = target.points.map(p => ({ x: p.x * pageW, y: p.y * pageH }));
            if (isPointStrictlyInsidePolygonPx(targetPx, { x: curPt.x * pageW, y: curPt.y * pageH })) {
              setActiveCut({ panelId: target.id, points: [drag.snapStartPoint, curPt] });
              setCutHover(null);
            } else if (Math.hypot(curPt.x - drag.startPoint.x, curPt.y - drag.startPoint.y) > 0.04) {
              onSliceAtLine(drag.startPoint, curPt);
            }
          }
        }
      } else if (Math.hypot(curPt.x - drag.startPoint.x, curPt.y - drag.startPoint.y) > 0.04) {
        onSliceAtLine(drag.startPoint, curPt);
      }
    } else if (
      drag.kind === 'move-panel'
      || drag.kind === 'vertex'
      || drag.kind === 'edge'
      || drag.kind === 'rotate-panel'
      || drag.kind === 'gesture-panel'
      || drag.kind === 'pan-image'
      || drag.kind === 'move-anchor'
      || drag.kind === 'resize-panel-anchor-bubble'
    ) {
      onUpdatePanel(drag.panelId, panel => panel, true);
    } else if (drag.kind === 'move-ai-anchor') {
      const anchor = draft.aiPage.anchors.find(item => item.id === drag.anchorId);
      if (anchor) onMoveAiAnchor?.(anchor.id, anchor.x, anchor.y, true);
    } else if (drag.kind === 'resize-ai-anchor-bubble') {
      onUpdateAiAnchor?.(drag.anchorId, cur => cur, true);
    } else if (
      drag.kind === 'move-guide-panel'
      || drag.kind === 'guide-vertex'
      || drag.kind === 'guide-edge'
      || drag.kind === 'rotate-guide-panel'
      || drag.kind === 'gesture-guide-panel'
    ) {
      const gp = draft.aiPage.guidePanels.find(item => item.id === drag.guideId);
      if (gp) {
        if (onUpdateGuidePanelPoints) {
          onUpdateGuidePanelPoints(gp.id, getGuidePanelPolygon(gp), true);
        } else {
          onUpdateGuidePanel?.(gp.id, { x: gp.x, y: gp.y, width: gp.width, height: gp.height }, true);
        }
      }
    } else if (drag.kind === 'move-breakout' || drag.kind === 'resize-breakout') {
      const bz = (draft.aiPage.breakoutZones || []).find(item => item.id === drag.zoneId);
      if (bz) onUpdateBreakoutZone?.(bz.id, { x: bz.x, y: bz.y, width: bz.width, height: bz.height }, true);
    } else if (drag.kind === 'move-bubble' || drag.kind === 'gesture-bubble') {
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
    } else if (drag.kind === 'move-image-layer' || drag.kind === 'resize-image-layer' || drag.kind === 'rotate-image-layer') {
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
    setSnapGuides([]);
    setRotationBadge(null);
  };

  const selectedPanel = selection?.kind === 'panel'
    ? draft.panels.find(p => p.id === selection.id)
    : selection?.kind === 'panel-anchor'
      ? draft.panels.find(p => p.id === selection.panelId)
      : undefined;

  const selectedGuidePanel = draft.creationMode === 'ai-page' && selection?.kind === 'guide-panel'
    ? draft.aiPage.guidePanels.find(gp => gp.id === selection.id)
    : undefined;

  const sliceTargetIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeCut) {
      ids.add(activeCut.panelId);
      return ids;
    }
    if (cutHover) ids.add(cutHover.panelId);
    if (drag?.kind !== 'slice') return ids;
    for (const item of editableCutPanels) {
      if (doesSegmentIntersectPolygon(drag.startPoint, drag.currentPoint, item.points)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [activeCut, cutHover, drag, editableCutPanels]);

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
          isCustomImage: Boolean(b.customImageUrl),
          fontSize: b.fontSize,
        };
      }
    }
    if (selection?.kind === 'ai-anchor' && draft.creationMode === 'ai-page') {
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
    if (selection?.kind === 'panel-anchor' && draft.creationMode === 'manual') {
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
  }, [bubbleMap, draft.aiPage.anchors, draft.creationMode, draft.panels, selection]);

  // 所见即所得原地编辑目标定位（支持正式矢量气泡、自由文字、AI/手动气泡锚点）
  const inlineEditTarget = useMemo(() => {
    if (!inlineEdit) return null;
    if (inlineEdit.kind === 'bubble') {
      const b = bubbleMap.get(inlineEdit.id);
      if (!b) return null;
      const bw = b.width * pageW;
      const bh = b.height * pageH;
      const textBox = resolveBubbleTextBox(b, b.x * pageW, b.y * pageH, bw / 2, bh / 2);
      const fontSize = computeAutoFitFontSize(inlineEdit.value || b.text, b.fontSize, textBox.width, textBox.height, b.writingMode);
      return {
        x: textBox.cx / pageW,
        y: textBox.cy / pageH,
        width: textBox.width / pageW,
        height: textBox.height / pageH,
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
        onPointerUp={e => finishDrag(e)}
        onPointerCancel={e => finishDrag(e)}
        className={`relative min-h-0 flex-1 overflow-auto ${isPanningMode ? (drag?.kind === 'pan-viewport' ? 'cursor-grabbing' : 'cursor-grab') : activeTool === 'zoom' ? 'cursor-zoom-in' : ''}`}
      >
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center px-6 pt-5 pb-20 md:px-8 md:pt-6 md:pb-20">
          <div
            ref={stageRef}
            role="application"
            aria-label={t('漫画分镜画布')}
            data-safe-mode-canvas={hasRenderedImages ? 'true' : undefined}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={e => finishDrag(e)}
            onPointerCancel={e => finishDrag(e)}
            onContextMenu={event => {
              event.preventDefault();
              event.stopPropagation();
              const pt = toNormalizedPoint(event.clientX, event.clientY);
              if (draft.creationMode === 'ai-page' && !inpaintDraft) {
                const ordered = [
                  ...draft.aiPage.guidePanels.filter(g => g.inset),
                  ...draft.aiPage.guidePanels.filter(g => !g.inset),
                ];
                const hit = ordered.find(g => pointInPolygon(pt, getGuidePanelPolygon(g)));
                if (hit) onSelect({ kind: 'guide-panel', id: hit.id });
              } else if (draft.creationMode === 'manual') {
                for (let i = sortedPanels.length - 1; i >= 0; i--) {
                  if (hitTestPanel(pt, sortedPanels[i], pageW, pageH)) {
                    onSelect({ kind: 'panel', id: sortedPanels[i].id });
                    break;
                  }
                }
              }
              const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : event.clientX;
              const maxY = typeof window !== 'undefined' ? window.innerHeight - 320 : event.clientY;
              setContextMenu({
                x: Math.max(8, Math.min(maxX, event.clientX)),
                y: Math.max(8, Math.min(maxY, event.clientY)),
              });
            }}
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

              {draft.paperPresetId === 'manga-spread' && (
                <line
                  x1={pageW / 2}
                  y1={0}
                  x2={pageW / 2}
                  y2={pageH}
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="10 8"
                  opacity={0.55}
                />
              )}

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
                                    const badgePos = placeComicPanelBadgePx(poly, pageW, pageH, 30, 20) || { x: b.minX + 10, y: b.minY + 10, scale: 1 };
                                    const pointsAttr = poly.map(pt => `${(pt.x * pageW).toFixed(1)},${(pt.y * pageH).toFixed(1)}`).join(' ');
                                    const badgeNum = String(idx + 1).padStart(2, '0');
                                    const isSliceHit = sliceTargetIds.has(gp.id);
                                    const isGuideSel = selection?.kind === 'guide-panel' && selection.id === gp.id;
                                    const baseFill = hasGenerated
                                      ? (isGuideSel ? 'rgba(99, 102, 241, 0.14)' : 'rgba(99, 102, 241, 0.06)')
                                      : (gp.fillColor?.trim() || (isFlashback ? '#3f4552' : '#eef1f6'));
                                    const strokeColor = isSliceHit
                                      ? '#ef4444'
                                      : isGuideSel
                                        ? '#4f46e5'
                                        : gp.inset
                                          ? '#d97706'
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
                                          strokeOpacity={isSliceHit || isGuideSel ? 0.95 : (hasGenerated ? 0.72 : (gp.borderless ? 0.55 : 0.78))}
                                          strokeWidth={isSliceHit || isGuideSel ? 4.5 : (aiPage.layoutLockMode !== 'txt2img' && !gp.borderless ? 4 : 2.5)}
                                          strokeDasharray={!isSliceHit && gp.borderless ? '8 6' : (aiPage.layoutLockMode !== 'txt2img' && !hasGenerated ? undefined : '10 6')}
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
                                        <g transform={`translate(${badgePos.x} ${badgePos.y}) scale(${badgePos.scale})`}>
                                          <rect
                                            x={0}
                                            y={0}
                                            width={30}
                                            height={20}
                                            rx={4}
                                            fill={gp.inset ? 'rgba(217, 119, 6, 0.92)' : isGuideSel ? 'rgba(79, 70, 229, 0.98)' : 'rgba(79, 70, 229, 0.88)'}
                                          />
                                          <text
                                            x={15}
                                            y={10}
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                            fontSize={11}
                                            fontWeight={700}
                                            fill="#ffffff"
                                          >
                                            {badgeNum}
                                          </text>
                                        </g>
                                        {!hasGenerated && (
                                          <>
                                            <text
                                              x={badgePos.x + 36 * badgePos.scale}
                                              y={badgePos.y + 10 * badgePos.scale}
                                              dominantBaseline="central"
                                              fontSize={13}
                                              fontWeight={700}
                                              fill={isFlashback ? '#e2e8f0' : '#334155'}
                                            >
                                              {gp.label}
                                              {gp.bleed ? ` · ${t('出血')}` : ''}
                                              {gp.inset ? ` · ${t('叠框')}` : ''}
                                              {gp.borderless ? ` · ${t('无框')}` : ''}
                                              {gp.speedlines ? ` · ${t('速度线')}` : ''}
                                            </text>
                                            {gp.summary && (
                                              <foreignObject x={b.minX + 14} y={badgePos.y + 26 * badgePos.scale} width={Math.max(40, b.width - 28)} height={Math.max(24, b.height - 48)}>
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
                                        <rect x={bx + 10} y={by + 10} width={108} height={26} rx={6} fill="rgba(225, 29, 72, 0.92)" />
                                        <text x={bx + 64} y={by + 23} textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700} fill="#ffffff">
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
                            {/* 空格分镜稿质感：凹多边形安全定位格号角标 + 居中画格名 */}
                            {!previewUrl && (() => {
                              const badgePos = placeComicPanelBadgePx(panel.points, pageW, pageH, 30, 20) || { x: bounds.minX + 10, y: bounds.minY + 10, scale: 1 };
                              return (
                                <g clipPath={`url(#comic-clip-${panel.id})`}>
                                  <g transform={`translate(${badgePos.x} ${badgePos.y}) scale(${badgePos.scale})`}>
                                    <rect
                                      x={0}
                                      y={0}
                                      width={30}
                                      height={20}
                                      rx={4}
                                      fill={panel.inset ? '#d97706' : isSelected ? '#4f46e5' : '#e2e8f0'}
                                    />
                                    <text
                                      x={15}
                                      y={10}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      fontSize={11}
                                      fontWeight={700}
                                      fill={panel.inset || isSelected ? '#ffffff' : '#64748b'}
                                    >
                                      {badgeNum}
                                    </text>
                                  </g>
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
                              );
                            })()}
                            {(() => {
                              const isBorderlessUnfilled = panel.borderWidth === 0 && !isSelected && !isSliceTarget && (!panel.image?.url || panel.inset);
                              return (
                                <polygon
                                  points={panel.points.map(p => `${p.x * pageW},${p.y * pageH}`).join(' ')}
                                  fill={isSliceTarget ? 'rgba(239,68,68,0.08)' : 'none'}
                                  stroke={isSliceTarget ? '#ef4444' : isSelected ? (panel.inset ? '#d97706' : '#4f46e5') : panel.inset ? '#d97706' : isBorderlessUnfilled ? '#94a3b8' : (panel.borderColor || '#111827')}
                                  strokeWidth={isSliceTarget || isSelected ? Math.max(panel.borderWidth, 4) : isBorderlessUnfilled ? 1.5 : panel.borderWidth}
                                  strokeDasharray={isSliceTarget ? '10 6' : isBorderlessUnfilled ? '8 6' : undefined}
                                  strokeLinejoin="miter"
                                />
                              );
                            })()}
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
                  const hw = w / 2;
                  const hh = h / 2;
                  const imgResizeHandles: Array<{ dir: ResizeHandleDir; hx: number; hy: number; cursor: string }> = [
                    { dir: 'nw', hx: cx - hw, hy: cy - hh, cursor: 'cursor-nwse-resize' },
                    { dir: 'n', hx: cx, hy: cy - hh, cursor: 'cursor-ns-resize' },
                    { dir: 'ne', hx: cx + hw, hy: cy - hh, cursor: 'cursor-nesw-resize' },
                    { dir: 'e', hx: cx + hw, hy: cy, cursor: 'cursor-ew-resize' },
                    { dir: 'se', hx: cx + hw, hy: cy + hh, cursor: 'cursor-nwse-resize' },
                    { dir: 's', hx: cx, hy: cy + hh, cursor: 'cursor-ns-resize' },
                    { dir: 'sw', hx: cx - hw, hy: cy + hh, cursor: 'cursor-nesw-resize' },
                    { dir: 'w', hx: cx - hw, hy: cy, cursor: 'cursor-ew-resize' },
                  ];
                  const flipTransform = (imgLayer.flipX || imgLayer.flipY)
                    ? `translate(${cx} ${cy}) scale(${imgLayer.flipX ? -1 : 1} ${imgLayer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
                    : undefined;
                  return (
                    <g
                      key={layerNode.id}
                      style={layerStyle}
                      transform={imgLayer.rotation ? `rotate(${imgLayer.rotation} ${cx} ${cy})` : undefined}
                      className={eff.locked ? 'pointer-events-none' : 'pointer-events-auto cursor-move'}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        onSelect({ kind: 'image', id: imgLayer.id });
                        stageRef.current?.setPointerCapture?.(event.pointerId);
                        setDrag({ kind: 'move-image-layer', id: imgLayer.id, dx: pt.x - imgLayer.x, dy: pt.y - imgLayer.y });
                      }}
                    >
                      <g transform={flipTransform}>
                        <image
                          href={imgLayer.url}
                          x={cx - hw}
                          y={cy - hh}
                          width={w}
                          height={h}
                          preserveAspectRatio="none"
                        />
                      </g>
                      {selected && !eff.locked && (
                        <>
                          <rect
                            x={cx - hw}
                            y={cy - hh}
                            width={w}
                            height={h}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth={2}
                          />
                          <line x1={cx} y1={cy - hh} x2={cx} y2={cy - hh - 26} stroke="#4f46e5" strokeWidth={2} />
                          <circle
                            cx={cx}
                            cy={cy - hh - 28}
                            r={8}
                            fill="#ffffff"
                            stroke="#4f46e5"
                            strokeWidth={2.5}
                            className="cursor-grab"
                            onPointerDown={event => {
                              event.stopPropagation();
                              const pt = toNormalizedPoint(event.clientX, event.clientY);
                              const startAngle = (Math.atan2((pt.y - imgLayer.y) * pageH, (pt.x - imgLayer.x) * pageW) * 180) / Math.PI;
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({
                                kind: 'rotate-image-layer',
                                id: imgLayer.id,
                                cx: imgLayer.x,
                                cy: imgLayer.y,
                                startAngle,
                                origRotation: imgLayer.rotation || 0,
                              });
                            }}
                          />
                          {imgResizeHandles.map(handle => (
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
                                  kind: 'resize-image-layer',
                                  id: imgLayer.id,
                                  handle: handle.dir,
                                  startPoint: pt,
                                  origX: imgLayer.x,
                                  origY: imgLayer.y,
                                  origW: imgLayer.width,
                                  origH: imgLayer.height,
                                });
                              }}
                            />
                          ))}
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

                  const hasCustomImage = Boolean(bubble.customImageUrl);
                  const model = buildComicBubbleRenderModel(cx, cy, rx, ry, bubble.shape, bubble.id, {
                    enabled: !hasCustomImage && bubble.hasTail && !isTransparentFill,
                    tx: localTx,
                    ty: localTy,
                  });
                  const fontMeta = resolveComicFont(bubble.fontFamily);
                  const textBox = resolveBubbleTextBox(bubble, cx, cy, rx, ry);
                  const fittedSize = computeAutoFitFontSize(
                    bubble.text,
                    bubble.fontSize,
                    textBox.width,
                    textBox.height,
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
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect({ kind: 'bubble', id: bubble.id });
                        openInlineEdit({ kind: 'bubble', id: bubble.id, value: bubble.text });
                      }}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        onSelect({ kind: 'bubble', id: bubble.id });
                        if (event.detail >= 2 || checkDoubleTap(`bubble:${bubble.id}`, event.clientX, event.clientY)) {
                          event.preventDefault();
                          openInlineEdit({ kind: 'bubble', id: bubble.id, value: bubble.text });
                          return;
                        }
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
                        setDrag({
                          kind: 'move-bubble',
                          id: bubble.id,
                          dx: pt.x - bubble.x,
                          dy: pt.y - bubble.y,
                          origX: bubble.x,
                          origY: bubble.y,
                          origRotation: bubble.rotation || 0,
                        });
                      }}
                    >
                      <g transform={bubble.rotation ? `rotate(${bubble.rotation} ${cx} ${cy})` : undefined}>
                        {hasCustomImage ? (
                          <g
                            transform={(bubble.flipX || bubble.flipY)
                              ? `translate(${cx} ${cy}) scale(${bubble.flipX ? -1 : 1} ${bubble.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
                              : undefined}
                          >
                            <image
                              href={bubble.customImageUrl}
                              x={cx - rx}
                              y={cy - ry}
                              width={rx * 2}
                              height={ry * 2}
                              preserveAspectRatio="none"
                            />
                          </g>
                        ) : (
                          <>
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
                          </>
                        )}

                        {!isInlineEditing && (
                          <foreignObject x={textBox.x} y={textBox.y} width={textBox.width} height={textBox.height}>
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

                      {selected && !eff.locked && !hasCustomImage && bubble.hasTail && model.supportsTail && !isTransparentFill && (
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
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect({ kind: 'text', id: item.id });
                        openInlineEdit({ kind: 'text', id: item.id, value: item.text });
                      }}
                      onPointerDown={event => {
                        if (isPanningMode || activeTool !== 'select' || eff.locked) return;
                        event.stopPropagation();
                        onSelect({ kind: 'text', id: item.id });
                        if (event.detail >= 2 || checkDoubleTap(`text:${item.id}`, event.clientX, event.clientY)) {
                          event.preventDefault();
                          openInlineEdit({ kind: 'text', id: item.id, value: item.text });
                          return;
                        }
                        const pt = toNormalizedPoint(event.clientX, event.clientY);
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
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect({ kind: 'ai-anchor', id: anchor.id });
                          openInlineEdit({ kind: 'ai-anchor-bubble', anchorId: anchor.id, value: anchor.bubbleText || '' });
                        }}
                        onPointerDown={event => {
                          if (isPanningMode || activeTool !== 'select') return;
                          event.stopPropagation();
                          onSelect({ kind: 'ai-anchor', id: anchor.id });
                          if (event.detail >= 2 || checkDoubleTap(`ai-anchor:${anchor.id}`, event.clientX, event.clientY)) {
                            event.preventDefault();
                            openInlineEdit({ kind: 'ai-anchor-bubble', anchorId: anchor.id, value: anchor.bubbleText || '' });
                            return;
                          }
                          setDrag({ kind: 'move-ai-anchor', anchorId: anchor.id });
                        }}
                      >
                        <path
                          d={model.bodyPath}
                          fill="rgba(255, 251, 235, 0.94)"
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
                                color: textVal ? '#111827' : '#78350f',
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
                        <rect x={cx - rx} y={cy - ry - 26} width={76} height={24} rx={5} fill={isSelected ? '#4f46e5' : '#d97706'} />
                        <text x={cx - rx + 38} y={cy - ry - 14} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill="#ffffff">
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
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect({ kind: 'panel-anchor', panelId: selectedPanel.id, id: anchor.id });
                          openInlineEdit({ kind: 'panel-anchor-bubble', panelId: selectedPanel.id, anchorId: anchor.id, value: anchor.bubbleText || '' });
                        }}
                        onPointerDown={event => {
                          if (isPanningMode || activeTool !== 'select') return;
                          event.stopPropagation();
                          onSelect({ kind: 'panel-anchor', panelId: selectedPanel.id, id: anchor.id });
                          if (event.detail >= 2 || checkDoubleTap(`panel-anchor:${selectedPanel.id}:${anchor.id}`, event.clientX, event.clientY)) {
                            event.preventDefault();
                            openInlineEdit({ kind: 'panel-anchor-bubble', panelId: selectedPanel.id, anchorId: anchor.id, value: anchor.bubbleText || '' });
                            return;
                          }
                          setDrag({ kind: 'move-anchor', panelId: selectedPanel.id, anchorId: anchor.id });
                        }}
                      >
                        <path
                          d={model.bodyPath}
                          fill="rgba(255, 251, 235, 0.94)"
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
                                color: textVal ? '#111827' : '#78350f',
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
                        <rect x={cx - rx} y={cy - ry - 26} width={76} height={24} rx={5} fill={isSelected ? '#4f46e5' : '#d97706'} />
                        <text x={cx - rx + 38} y={cy - ry - 14} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill="#ffffff">
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

              {/* Figma 级紫色智能吸附线与等距格缝测量标尺 */}
              {snapGuides.map((g, idx) => {
                const x1 = g.a.x * pageW;
                const y1 = g.a.y * pageH;
                const x2 = g.b.x * pageW;
                const y2 = g.b.y * pageH;
                const isVert = Math.abs(x1 - x2) < 0.5;
                return (
                  <g key={`sg-${idx}`} stroke="#a855f7" strokeWidth={1.75} fill="none">
                    <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={g.measure ? undefined : '5 4'} />
                    {g.measure && (
                      <>
                        <line x1={x1 - (isVert ? 4 : 0)} y1={y1 - (isVert ? 0 : 4)} x2={x1 + (isVert ? 4 : 0)} y2={y1 + (isVert ? 0 : 4)} />
                        <line x1={x2 - (isVert ? 4 : 0)} y1={y2 - (isVert ? 0 : 4)} x2={x2 + (isVert ? 4 : 0)} y2={y2 + (isVert ? 0 : 4)} />
                      </>
                    )}
                  </g>
                );
              })}

              {/* 旋转时居中显示实时度数标尺 */}
              {rotationBadge && (
                <g transform={`translate(${rotationBadge.cx} ${rotationBadge.cy})`}>
                  <rect x={-26} y={-13} width={52} height={26} rx={6} fill="rgba(15, 23, 42, 0.88)" stroke="#a5b4fc" strokeWidth={1.5} />
                  <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#ffffff">
                    {Math.round(((rotationBadge.angle % 360) + 360) % 360)}°
                  </text>
                </g>
              )}

              {drag?.kind === 'draw-panel' && (
                <rect
                  x={Math.min(drag.startPoint.x, drag.currentPoint.x) * pageW}
                  y={Math.min(drag.startPoint.y, drag.currentPoint.y) * pageH}
                  width={Math.abs(drag.currentPoint.x - drag.startPoint.x) * pageW}
                  height={Math.abs(drag.currentPoint.y - drag.startPoint.y) * pageH}
                  fill={drawPanelAsOverlay ? 'rgba(217, 119, 6, 0.14)' : 'rgba(79,70,229,0.12)'}
                  stroke={drawPanelAsOverlay ? '#d97706' : '#4f46e5'}
                  strokeWidth={3}
                  strokeDasharray="8 5"
                />
              )}

              {/* 切割工具边界高亮 + 折线拐弯轨迹 + 真实格缝宽带预演 */}
              {activeTool === 'slice' && (() => {
                const hoverPanel = cutHover ? editableCutPanels.find(item => item.id === cutHover.panelId) : undefined;
                const polyVertices = activeCut ? activeCut.points : [];
                const previewLine: ComicPoint[] = polyVertices.length > 0
                  ? (cutCursor ? [...polyVertices, cutCursor] : polyVertices)
                  : (drag?.kind === 'slice' ? [drag.startPoint, drag.currentPoint] : []);
                return (
                  <g>
                    {hoverPanel && cutHover && (() => {
                      const edgeA = hoverPanel.points[cutHover.edgeIndex];
                      const edgeB = hoverPanel.points[(cutHover.edgeIndex + 1) % hoverPanel.points.length];
                      if (!edgeA || !edgeB) return null;
                      return (
                        <line
                          x1={edgeA.x * pageW}
                          y1={edgeA.y * pageH}
                          x2={edgeB.x * pageW}
                          y2={edgeB.y * pageH}
                          stroke="#ef4444"
                          strokeWidth={4}
                          opacity={0.72}
                          strokeLinecap="round"
                        />
                      );
                    })()}
                    {previewLine.length > 1 && (
                      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                        {draft.gutterPx > 0 && (
                          <polyline
                            points={previewLine.map(pt => `${pt.x * pageW},${pt.y * pageH}`).join(' ')}
                            stroke="#ef4444"
                            strokeWidth={draft.gutterPx}
                            opacity={0.18}
                          />
                        )}
                        <polyline
                          points={previewLine.map(pt => `${pt.x * pageW},${pt.y * pageH}`).join(' ')}
                          stroke="#ef4444"
                          strokeWidth={3}
                          strokeDasharray="8 5"
                        />
                      </g>
                    )}
                    {polyVertices.map((pt, idx) => (
                      <circle key={`cut-pt-${idx}`} cx={pt.x * pageW} cy={pt.y * pageH} r={5.5} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />
                    ))}
                    {drag?.kind === 'slice' && !activeCut && (
                      <>
                        <circle cx={drag.startPoint.x * pageW} cy={drag.startPoint.y * pageH} r={5.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
                        <circle cx={drag.currentPoint.x * pageW} cy={drag.currentPoint.y * pageH} r={5.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
                      </>
                    )}
                    {cutHover && (
                      <circle cx={cutHover.point.x * pageW} cy={cutHover.point.y * pageH} r={6.5} fill="#ffffff" stroke="#ef4444" strokeWidth={2.5} />
                    )}
                  </g>
                );
              })()}
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
                {/* 统一引导格四边中点拖边手柄 + 顶点斜角手柄 + 顶部旋转柄 */}
                {activeTool === 'select' && selectedGuidePanel && !panelsLayerProps.locked && (() => {
                  const gpPoly = getGuidePanelPolygon(selectedGuidePanel);
                  const normBounds = getPanelBoundingBox(gpPoly, 1, 1);
                  const accentBorder = selectedGuidePanel.inset ? 'border-amber-600' : 'border-indigo-600';
                  const accentRot = selectedGuidePanel.inset ? 'border-amber-600 bg-amber-50 text-amber-700' : 'border-indigo-600 bg-indigo-50 text-indigo-700';
                  return (
                    <>
                      {gpPoly.map((vertex, idx) => {
                        const next = gpPoly[(idx + 1) % gpPoly.length];
                        const mid = { x: (vertex.x + next.x) / 2, y: (vertex.y + next.y) / 2 };
                        return (
                          <button
                            key={`gp-edge-${idx}`}
                            type="button"
                            aria-label={t('拖动第 {0} 条引导格边调大小', [idx + 1])}
                            title={t('拖动整条边调整宽窄')}
                            onPointerDown={event => {
                              event.stopPropagation();
                              const pt = toNormalizedPoint(event.clientX, event.clientY);
                              stageRef.current?.setPointerCapture?.(event.pointerId);
                              setDrag({
                                kind: 'guide-edge',
                                guideId: selectedGuidePanel.id,
                                edgeIndex: idx,
                                startPoint: pt,
                                origPoints: gpPoly.map(p => ({ ...p })),
                              });
                            }}
                            style={{ left: `${mid.x * 100}%`, top: `${mid.y * 100}%` }}
                            className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center bg-transparent"
                          >
                            <span className={`h-2.5 w-2.5 rounded-[2px] border-2 ${accentBorder} bg-white shadow-sm transition group-hover:scale-125`} />
                          </button>
                        );
                      })}
                      {gpPoly.map((vertex, idx) => (
                        <button
                          key={`gp-vertex-${idx}`}
                          type="button"
                          aria-label={t('拖动第 {0} 个引导格顶点', [idx + 1])}
                          title={t('拖动调整引导格斜角顶点（Alt 临时关闭吸附）')}
                          onPointerDown={event => {
                            event.stopPropagation();
                            const pt = toNormalizedPoint(event.clientX, event.clientY);
                            stageRef.current?.setPointerCapture?.(event.pointerId);
                            setDrag({
                              kind: 'guide-vertex',
                              guideId: selectedGuidePanel.id,
                              vertexIndex: idx,
                              startPoint: pt,
                              origPoints: gpPoly.map(p => ({ ...p })),
                            });
                          }}
                          style={{ left: `${vertex.x * 100}%`, top: `${vertex.y * 100}%` }}
                          className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-transparent"
                        >
                          <span className={`h-3.5 w-3.5 rounded-full border-2 ${accentBorder} bg-white shadow-sm transition group-hover:scale-125`} />
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label={t('旋转引导格')}
                        title={t('拖动旋转引导格（Shift 按 15° 吸附）')}
                        onPointerDown={event => {
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          const startAngle = (Math.atan2((pt.y - normBounds.cy) * pageH, (pt.x - normBounds.cx) * pageW) * 180) / Math.PI;
                          const orientation = (Math.atan2((gpPoly[1].y - gpPoly[0].y) * pageH, (gpPoly[1].x - gpPoly[0].x) * pageW) * 180) / Math.PI;
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({
                            kind: 'rotate-guide-panel',
                            guideId: selectedGuidePanel.id,
                            cx: normBounds.cx,
                            cy: normBounds.cy,
                            startAngle,
                            baseOrientation: orientation,
                            origPoints: gpPoly.map(p => ({ ...p })),
                          });
                        }}
                        style={{ left: `${normBounds.cx * 100}%`, top: `${Math.max(0.015, normBounds.minY - 26 / pageH) * 100}%` }}
                        className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-transparent"
                      >
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow-sm transition group-hover:scale-110 ${accentRot}`}>
                          ↻
                        </span>
                      </button>
                    </>
                  );
                })()}

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
                    const next = selectedPanel.points[(idx + 1) % selectedPanel.points.length];
                    const rotatedMid = rotatePointAround(
                      { x: (vertex.x + next.x) / 2, y: (vertex.y + next.y) / 2 },
                      center,
                      selectedPanel.rotation,
                      aspect,
                    );
                    return (
                      <button
                        key={`edge-${idx}`}
                        type="button"
                        aria-label={t('拖动第 {0} 条边调大小', [idx + 1])}
                        title={t('拖动整条边调整画格宽窄')}
                        onPointerDown={event => {
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({
                            kind: 'edge',
                            panelId: selectedPanel.id,
                            edgeIndex: idx,
                            startPoint: pt,
                            origPoints: selectedPanel.points.map(p => ({ ...p })),
                            rotation: selectedPanel.rotation || 0,
                          });
                        }}
                        style={{ left: `${rotatedMid.x * 100}%`, top: `${rotatedMid.y * 100}%` }}
                        className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center bg-transparent"
                      >
                        <span className="h-2.5 w-2.5 rounded-[2px] border-2 border-indigo-600 bg-white shadow-sm transition group-hover:scale-125" />
                      </button>
                    );
                  })}

                  {selectedPanel.points.map((vertex, idx) => {
                    const rotated = rotatePointAround(vertex, center, selectedPanel.rotation, aspect);
                    return (
                      <button
                        key={`vertex-${idx}`}
                        type="button"
                        aria-label={t('拖动第 {0} 个顶点调斜角', [idx + 1])}
                        title={t('拖动调整画格斜角顶点（Alt 临时关闭吸附）')}
                        onPointerDown={event => {
                          event.stopPropagation();
                          const pt = toNormalizedPoint(event.clientX, event.clientY);
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setDrag({
                            kind: 'vertex',
                            panelId: selectedPanel.id,
                            vertexIndex: idx,
                            startPoint: pt,
                            origPoints: selectedPanel.points.map(p => ({ ...p })),
                            rotation: selectedPanel.rotation || 0,
                          });
                        }}
                        style={{ left: `${rotated.x * 100}%`, top: `${rotated.y * 100}%` }}
                        className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-transparent"
                      >
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-indigo-600 bg-white shadow-sm transition group-hover:scale-125" />
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    aria-label={t('旋转分镜格')}
                    title={t('拖动旋转分镜格（Shift 按 15° 吸附）')}
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
                    className="group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-transparent"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-indigo-600 bg-indigo-50 text-[10px] font-bold text-indigo-700 shadow-sm transition group-hover:scale-110">
                      ↻
                    </span>
                  </button>
                </div>
              );
            })()}

            {/* 选格极简悬浮快捷条（手动格：上传/历史选图/叠框/移图/清图；AI 引导格：叠框/无框/出血/复制/删除） */}
            {activeTool === 'select' && !drag && !inlineEdit && !activeFloatingBubble && (
              <ComicPanelFloatingBar
                targetManual={draft.creationMode === 'manual' && selection?.kind === 'panel' && selectedPanel && !selectedPanel.locked && !panelsLayerProps.locked ? selectedPanel : null}
                targetGuide={draft.creationMode === 'ai-page' && !inpaintDraft && !(bubbleCandidates && bubbleCandidates.length > 0) && (draft.aiPage.showGuideOverlay || !draft.aiPage.generatedPageImage?.url) && selectedGuidePanel && !panelsLayerProps.locked ? selectedGuidePanel : null}
                getEffectiveManualPoly={getEffectiveManualPoly}
                onTriggerPanelUpload={panelId => {
                  panelUploadTargetRef.current = panelId;
                  panelUploadInputRef.current?.click();
                }}
                onOpenPanelHistoryPicker={onOpenPanelHistoryPicker}
                onTogglePanelOverlay={onTogglePanelOverlay}
                onSelectTool={onSelectTool}
                onUpdatePanel={onUpdatePanel}
                onToggleGuidePanelFlag={onToggleGuidePanelFlag}
                onDuplicateGuidePanel={onDuplicateGuidePanel}
                onDeleteGuidePanel={onDeleteGuidePanel}
              />
            )}

            {/* PS 上下文悬浮气泡迷你工具条：点击气泡立即可切换 12 种日漫框形、横竖排、尾巴、字号、复制、删除 */}
            {activeFloatingBubble && !inlineEdit && !drag && activeTool === 'select' && (
              <ComicBubbleFloatingBar
                fb={activeFloatingBubble}
                onUpdateBubble={onUpdateBubble}
                onDuplicateBubble={onDuplicateBubble}
                onDeleteBubble={onDeleteBubble}
                onUpdateAiAnchor={onUpdateAiAnchor}
                onDeleteAiAnchor={onDeleteAiAnchor}
                onUpdatePanel={onUpdatePanel}
                onSelectPanel={panelId => onSelect({ kind: 'panel', id: panelId })}
                onConvertAnchorBubbleToVector={onConvertAnchorBubbleToVector}
              />
            )}

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
                  ref={inlineTextareaRef}
                  autoFocus
                  aria-label={t('原地编辑文字')}
                  value={inlineEdit.value}
                  placeholder={t('输入台词…')}
                  onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                  onBlur={() => {
                    // 忽略刚打开 180ms 内由触发双击本身产生的瞬时失焦，避免刚弹出就被立刻关掉
                    if (inlineEdit.openedAt && Date.now() - inlineEdit.openedAt < 180) {
                      window.requestAnimationFrame(() => inlineTextareaRef.current?.focus());
                      return;
                    }
                    commitInlineEdit();
                  }}
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

      <ComicCanvasZoomBar
        snapEnabled={draft.snapEnabled}
        zoom={zoom}
        onToggleSnap={onToggleSnap}
        onZoomChange={onZoomChange}
        onZoomFit={onZoomFit}
      />

      {/* 隐藏的单格直接上传图片选择器（右键菜单与格上快捷条共用） */}
      <input
        ref={panelUploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-hidden="true"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0];
          const targetId = panelUploadTargetRef.current;
          panelUploadTargetRef.current = null;
          event.target.value = '';
          if (file && targetId) {
            onUploadImageToPanel?.(targetId, file);
          }
        }}
      />

      {/* 轻量化右键快捷菜单：围绕选定画格/引导格与高频画布操作提供就手动作，不常驻额外面板 */}
      {contextMenu && (
        <ComicCanvasContextMenu
          contextMenu={contextMenu}
          creationMode={draft.creationMode}
          selection={selection}
          selectedPanel={selectedPanel}
          selectedGuidePanel={selectedGuidePanel}
          canUndo={canUndo}
          canRedo={canRedo}
          onClose={() => setContextMenu(null)}
          onTriggerPanelUpload={onUploadImageToPanel ? panelId => {
            panelUploadTargetRef.current = panelId;
            panelUploadInputRef.current?.click();
          } : undefined}
          onOpenPanelHistoryPicker={onOpenPanelHistoryPicker}
          onTogglePanelOverlay={onTogglePanelOverlay}
          onTogglePanelBorderless={onTogglePanelBorderless}
          onSelectTool={onSelectTool}
          onBringPanelOrder={onBringPanelOrder}
          onDuplicatePanel={onDuplicatePanel}
          onDeletePanel={onDeletePanel}
          onToggleGuidePanelFlag={onToggleGuidePanelFlag}
          onDuplicateGuidePanel={onDuplicateGuidePanel}
          onDeleteGuidePanel={onDeleteGuidePanel}
          onToggleLayersDrawer={onToggleLayersDrawer}
          onZoomFit={onZoomFit}
          onZoomChange={onZoomChange}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      )}
    </div>
  );
};
