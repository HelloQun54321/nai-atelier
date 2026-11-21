import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import {
  estimateV45GenerationCost,
  formatGenerationCostLabel,
  usageForCostEstimate,
} from '../../services/anlasBudget';
import { getNaiChannelMode } from '../../services/naiChannel';
import { prepareGenerationWithPool } from '../../services/naiKeyPool';
import { buildGenerationJobDescriptor } from '../../services/naiService';
import { useNovelaiUsage } from '../../services/naiUsage';
import {
  approveGenerationSeries,
  beginGenerationSeries,
  stopGenerationSeriesSession,
  subscribeGenerationSeries,
  type GenerationSeriesSession,
} from '../../services/generationSeries';
import { createUuid } from '../../services/id';
import { localHistory } from '../../services/localHistory';
import { promptAgentService } from '../../services/promptAgent';
import {
  buildAiPageZoneRequest,
  planComicAiZones,
  stitchAiZoneImages,
} from '../../services/comic/comicAiPageEngine';
import {
  buildEmbeddedBubbleTextItems,
  detectWhiteBubblesFromImageUrl,
} from '../../services/comic/comicBubbleDetector';
import {
  buildComicInpaintRequest,
  clampInpaintRect,
  createRectInpaintMaskDataUrl,
  loadImageAsDataUrl,
  type ComicInpaintDraft,
  type ComicInpaintRect,
} from '../../services/comic/comicInpaintEngine';
import {
  COMIC_LAYOUT_TEMPLATES,
  COMIC_PANEL_SOFT_MAX,
  COMIC_PAPER_PRESETS,
  createGuidePanelsFromTemplate,
  getPanelBoundingBox,
  rectToPolygon,
  slicePolygonByLine,
} from '../../services/comic/comicGeometry';
import { buildComicPanelGenerationInput } from '../../services/comic/comicPromptBuilder';
import { exportComicPageAndArchive } from '../../services/comic/comicExporter';
import { loadComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicLayerId,
  ComicPageDraft,
  ComicPanel,
  ComicPoint,
  ComicSelection,
  ComicStickerItem,
  ComicStickerKind,
  ComicStroke,
  ComicTextItem,
  ComicTool,
} from '../../services/comic/comicTypes';
import { useConfirmDialog } from '../ConfirmDialog';
import { ComicCanvas } from './ComicCanvas';
import { ComicInspector, type ComicInspectorTab } from './ComicInspector';
import { ComicToolRail } from './ComicToolRail';
import { ComicToolbar } from './ComicToolbar';

const MAX_UNDO_STACK = 50;
const COMIC_GEN_SCOPE = 'comic-studio';

export interface ComicStudioProps {
  chains: PromptChain[];
  notify: (message: string, type?: 'success' | 'error') => void;
  forceEmptySeed?: boolean;
  generationStreamPreview?: boolean;
  onBack?: () => void;
}

const readActiveApiKey = (): string => {
  try {
    return (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
  } catch {
    return '';
  }
};

const describeStage = (session: GenerationSeriesSession | null): string => {
  if (!session) return '';
  if (session.state === 'waiting') return t('排队中…');
  if (session.state === 'preparing') return t('准备中…');
  if (session.state === 'saving') return t('保存中…');
  if (session.state === 'paused') return t('已暂停');
  if (session.state === 'awaiting_confirmation') return t('等待确认费用…');
  if (session.preview?.step !== undefined && session.steps > 0) {
    return `${t('采样')} ${session.preview.step}/${session.steps}`;
  }
  return t('生成中…');
};

const buildGuidePanelsForCount = (
  count: number,
  gutterPx: number,
  width: number,
  height: number,
): ComicAiGuidePanel[] => {
  if (count === 4) return createGuidePanelsFromTemplate('classic-4-121', width, height, gutterPx);
  const margin = 0.04;
  const gx = Math.max(0.012, gutterPx / Math.max(1, width));
  const gy = Math.max(0.012, gutterPx / Math.max(1, height));
  const usableW = 1 - margin * 2;
  const usableH = 1 - margin * 2;
  if (count === 3) {
    const h = (usableH - gy * 2) / 3;
    return [0, 1, 2].map(i => ({
      id: createUuid(),
      label: `第 ${i + 1} 格`,
      summary: '',
      x: margin,
      y: margin + i * (h + gy),
      width: usableW,
      height: h,
    }));
  }
  const cols = 2;
  const rows = Math.max(2, Math.ceil(count / cols));
  const cellW = (usableW - gx * (cols - 1)) / cols;
  const cellH = (usableH - gy * (rows - 1)) / rows;
  const result: ComicAiGuidePanel[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const isLastOdd = i === count - 1 && count % 2 === 1;
    result.push({
      id: createUuid(),
      label: `第 ${i + 1} 格`,
      summary: '',
      x: isLastOdd ? margin : margin + c * (cellW + gx),
      y: margin + r * (cellH + gy),
      width: isLastOdd ? usableW : cellW,
      height: cellH,
    });
  }
  return result;
};

export const ComicStudio: React.FC<ComicStudioProps> = ({
  chains,
  notify,
  forceEmptySeed = false,
  generationStreamPreview = true,
  onBack,
}) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const novelaiSubscription = useNovelaiUsage();

  const [draft, setDraft] = useState<ComicPageDraft>(() => loadComicDraft());
  const [undoStack, setUndoStack] = useState<ComicPageDraft[]>([]);
  const [redoStack, setRedoStack] = useState<ComicPageDraft[]>([]);
  const [activeTool, setActiveTool] = useState<ComicTool>('select');
  const [selection, setSelection] = useState<ComicSelection>(() => (
    draft.panels[0] ? { kind: 'panel', id: draft.panels[0].id } : null
  ));
  const [inspectorTab, setInspectorTab] = useState<ComicInspectorTab>('panel');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [zoom, setZoom] = useState(0.62);
  const [exporting, setExporting] = useState(false);

  // 画笔、贴纸与气泡默认参数
  const [brushColor, setBrushColor] = useState('#111827');
  const [brushSize, setBrushSize] = useState(6);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [defaultStickerKind, setDefaultStickerKind] = useState<ComicStickerKind>('speedlines');
  const [defaultBubbleShape, setDefaultBubbleShape] = useState<ComicBubbleShape>('oval');
  const [defaultBubbleWritingMode, setDefaultBubbleWritingMode] = useState<'horizontal' | 'vertical'>('vertical');

  const handleSelectWithTab = useCallback((next: ComicSelection) => {
    setSelection(next);
    if (!next) return;
    if (next.kind === 'panel' || next.kind === 'ai-anchor') {
      setInspectorTab(cur => (cur === 'layers' ? 'panel' : cur));
    } else {
      setInspectorTab('layers');
    }
  }, []);

  // 单格生图与 AI 整页生图 / 局部重绘状态
  const [generatingPanelId, setGeneratingPanelId] = useState<string | null>(null);
  const [planningAiStoryboard, setPlanningAiStoryboard] = useState(false);
  const [generatingAiPage, setGeneratingAiPage] = useState(false);
  const [detectingBubbles, setDetectingBubbles] = useState(false);
  const [inpaintingAiPage, setInpaintingAiPage] = useState(false);
  const [inpaintDraft, setInpaintDraft] = useState<ComicInpaintDraft | null>(null);
  const [generatingAiZoneIndex, setGeneratingAiZoneIndex] = useState<0 | 1 | null>(null);
  const [aiGenerationStageText, setAiGenerationStageText] = useState('');
  const aiCancelRequestedRef = useRef(false);
  const activeSessionRef = useRef<GenerationSeriesSession | null>(null);
  const [, setSessionTick] = useState(0);

  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // 跨重启自动留稿（防抖 400ms，与实验室草稿完全隔离）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveComicDraft(draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // 订阅后台生成进度与流式预览帧
  useEffect(() => subscribeGenerationSeries(() => {
    setSessionTick(tick => tick + 1);
  }), []);

  // 自动计算更舒展的画布初始缩放（让漫画页饱满居中成为视觉主角）
  const fitCanvasToViewport = useCallback((targetW = draft.width, targetH = draft.height) => {
    const host = canvasWrapRef.current;
    if (!host) return;
    const availW = Math.max(240, host.clientWidth - 44);
    const availH = Math.max(240, host.clientHeight - 44);
    const ratio = Math.min(availW / targetW, availH / targetH, 1.25);
    setZoom(Math.max(0.25, Math.round(ratio * 100) / 100));
  }, [draft.width, draft.height]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitCanvasToViewport());
    return () => window.cancelAnimationFrame(frame);
  }, [fitCanvasToViewport]);

  const applyDraftChange = useCallback((updater: (current: ComicPageDraft) => ComicPageDraft, commit = true) => {
    setDraft(current => {
      const next = updater(current);
      if (commit && next !== current) {
        setUndoStack(stack => [...stack.slice(-(MAX_UNDO_STACK - 1)), current]);
        setRedoStack([]);
      }
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(stack => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setDraft(current => {
        setRedoStack(r => [...r.slice(-(MAX_UNDO_STACK - 1)), current]);
        return previous;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack(stack => {
      if (!stack.length) return stack;
      const next = stack[stack.length - 1];
      setDraft(current => {
        setUndoStack(u => [...u.slice(-(MAX_UNDO_STACK - 1)), current]);
        return next;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const handleDeletePanel = useCallback((panelId: string) => {
    applyDraftChange(current => ({
      ...current,
      panels: current.panels.filter(p => p.id !== panelId),
    }), true);
    setSelection(cur => (cur?.kind === 'panel' && cur.id === panelId ? null : cur));
  }, [applyDraftChange]);

  const handleDeleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'panel') {
      handleDeletePanel(selection.id);
    } else if (selection.kind === 'ai-anchor') {
      applyDraftChange(cur => ({
        ...cur,
        aiPage: {
          ...cur.aiPage,
          anchors: cur.aiPage.anchors.filter(a => a.id !== selection.id),
        },
      }), true);
      setSelection(null);
    } else if (selection.kind === 'bubble') {
      applyDraftChange(cur => ({ ...cur, bubbles: cur.bubbles.filter(b => b.id !== selection.id) }), true);
      setSelection(null);
    } else if (selection.kind === 'text') {
      applyDraftChange(cur => ({ ...cur, texts: cur.texts.filter(item => item.id !== selection.id) }), true);
      setSelection(null);
    } else if (selection.kind === 'sticker') {
      applyDraftChange(cur => ({ ...cur, stickers: cur.stickers.filter(item => item.id !== selection.id) }), true);
      setSelection(null);
    }
  }, [applyDraftChange, handleDeletePanel, selection]);

  // 键盘快捷键：Undo/Redo、Delete/Backspace 删除、Esc 切回选择、PS 单键工具快切
  useEffect(() => {
    const toolShortcutMap: Record<string, ComicTool> = {
      v: 'select',
      h: 'hand',
      z: 'zoom',
      r: 'draw-panel',
      c: 'slice',
      m: 'frame-image',
      b: 'bubble',
      t: 'text',
      s: 'sticker',
      p: 'brush',
      e: 'eraser',
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if (isEditingText) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection) {
          event.preventDefault();
          handleDeleteSelection();
        }
        return;
      }
      if (event.key === 'Escape') {
        setActiveTool('select');
        setSelection(null);
        setInpaintDraft(null);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const mapped = toolShortcutMap[event.key.toLowerCase()];
        if (mapped) {
          event.preventDefault();
          setActiveTool(mapped);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelection, selection]);

  const handleUpdatePanel = useCallback((panelId: string, updater: (panel: ComicPanel) => ComicPanel, commit = true) => {
    applyDraftChange(current => ({
      ...current,
      panels: current.panels.map(p => (p.id === panelId ? updater(p) : p)),
    }), commit);
  }, [applyDraftChange]);

  const handleAddPanel = useCallback((points: ComicPoint[]) => {
    if (draft.panels.length >= COMIC_PANEL_SOFT_MAX) {
      notify(t('单页最多添加 {0} 个分镜格，以免画布过于拥挤', [COMIC_PANEL_SOFT_MAX]), 'error');
      return;
    }
    const maxZ = draft.panels.reduce((acc, p) => Math.max(acc, p.zIndex), 0);
    const created: ComicPanel = {
      id: createUuid(),
      name: `第 ${draft.panels.length + 1} 格`,
      points,
      rotation: 0,
      zIndex: maxZ + 1,
      borderColor: '#111827',
      borderWidth: 3,
      backgroundColor: '#f8fafc',
      prompt: '',
      negativePrompt: '',
      anchors: [],
      useCoords: true,
    };
    applyDraftChange(current => ({ ...current, panels: [...current.panels, created] }), true);
    setSelection({ kind: 'panel', id: created.id });
    setActiveTool('select');
  }, [applyDraftChange, draft.panels, notify]);

  const handleSliceAtLine = useCallback((start: ComicPoint, end: ComicPoint) => {
    const gx = draft.gutterPx / draft.width;
    const gy = draft.gutterPx / draft.height;
    let slicedCount = 0;
    const nextPanels: ComicPanel[] = [];
    for (const panel of draft.panels) {
      if (panel.locked || panel.rotation !== 0) {
        nextPanels.push(panel);
        continue;
      }
      const split = slicePolygonByLine(panel.points, start, end, gx, gy);
      if (split && nextPanels.length + 2 <= COMIC_PANEL_SOFT_MAX) {
        slicedCount += 1;
        nextPanels.push({ ...panel, points: split[0] });
        nextPanels.push({
          ...panel,
          id: createUuid(),
          name: `${panel.name}-分格`,
          points: split[1],
          zIndex: panel.zIndex + 1,
          image: undefined,
        });
      } else {
        nextPanels.push(panel);
      }
    }
    if (slicedCount > 0) {
      applyDraftChange(current => ({ ...current, panels: nextPanels }), true);
      notify(t('已沿切线切分 {0} 个分镜格', [slicedCount]));
    } else {
      notify(t('切线未穿过可切分的分镜格（旋转后的画格请先归零再切分）'), 'error');
    }
  }, [applyDraftChange, draft.gutterPx, draft.height, draft.panels, draft.width, notify]);

  const handleDuplicatePanel = useCallback((panelId: string) => {
    if (draft.panels.length >= COMIC_PANEL_SOFT_MAX) {
      notify(t('已达单页分镜格上限'), 'error');
      return;
    }
    const target = draft.panels.find(p => p.id === panelId);
    if (!target) return;
    const maxZ = draft.panels.reduce((acc, p) => Math.max(acc, p.zIndex), 0);
    const clone: ComicPanel = {
      ...structuredClone(target),
      id: createUuid(),
      name: `${target.name} 副本`,
      zIndex: maxZ + 1,
      points: target.points.map(pt => ({ x: Math.min(0.96, pt.x + 0.03), y: Math.min(0.96, pt.y + 0.03) })),
    };
    applyDraftChange(current => ({ ...current, panels: [...current.panels, clone] }), true);
    setSelection({ kind: 'panel', id: clone.id });
  }, [applyDraftChange, draft.panels, notify]);

  const handleSetCustomPaperSize = useCallback((width: number, height: number) => {
    applyDraftChange(current => ({
      ...current,
      paperPresetId: 'custom',
      width,
      height,
    }), true);
    fitCanvasToViewport(width, height);
  }, [applyDraftChange, fitCanvasToViewport]);

  const handleBringPanelOrder = useCallback((panelId: string, mode: 'front' | 'back') => {
    applyDraftChange(current => {
      const zValues = current.panels.map(p => p.zIndex);
      const nextZ = mode === 'front' ? Math.max(0, ...zValues) + 1 : Math.min(1, ...zValues) - 1;
      return {
        ...current,
        panels: current.panels.map(p => (p.id === panelId ? { ...p, zIndex: nextZ } : p)),
      };
    }, true);
  }, [applyDraftChange]);

  const handleSelectPaperPreset = useCallback((presetId: string) => {
    const preset = COMIC_PAPER_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    applyDraftChange(current => ({
      ...current,
      paperPresetId: preset.id,
      width: preset.width,
      height: preset.height,
    }), true);
    fitCanvasToViewport(preset.width, preset.height);
  }, [applyDraftChange, fitCanvasToViewport]);

  const handleApplyTemplate = useCallback(async (templateId: string) => {
    const template = COMIC_LAYOUT_TEMPLATES.find(item => item.id === templateId);
    if (!template) return;
    if (draft.creationMode === 'ai-page') {
      const nextGuides = createGuidePanelsFromTemplate(templateId, draft.width, draft.height, draft.gutterPx);
      applyDraftChange(current => ({
        ...current,
        aiPage: {
          ...current.aiPage,
          targetPanelCount: nextGuides.length,
          guidePanels: nextGuides,
          showGuideOverlay: true,
        },
      }), true);
      notify(t('已套用「{0}」为 AI 整页构图引导区', [template.label]));
      return;
    }
    const hasImages = draft.panels.some(p => Boolean(p.image?.url));
    if (hasImages) {
      const ok = await confirmAction({
        title: t('套用新分镜模板？'),
        message: t('套用模板会替换当前页面的分镜格布局（已生成的单格原图仍保留在生成历史中，也可随时撤销）。'),
        confirmLabel: t('确认套用'),
      });
      if (!ok) return;
    }
    const gx = draft.gutterPx / draft.width;
    const gy = draft.gutterPx / draft.height;
    applyDraftChange(current => ({
      ...current,
      panels: template.buildPanels(gx, gy),
    }), true);
    setSelection(null);
  }, [applyDraftChange, confirmAction, draft.creationMode, draft.gutterPx, draft.height, draft.panels, draft.width, notify]);

  const handleApplyStyleChain = useCallback((chain: PromptChain) => {
    applyDraftChange(current => ({
      ...current,
      styleChainId: chain.id,
      globalBasePrompt: chain.basePrompt || '',
      globalNegativePrompt: chain.negativePrompt || '',
    }), true);
    notify(t('已载入风格串「{0}」', [chain.name]));
  }, [applyDraftChange, notify]);

  const handleToggleLayerVisible = useCallback((layerId: ComicLayerId) => {
    applyDraftChange(current => ({
      ...current,
      layers: { ...current.layers, [layerId]: { ...current.layers[layerId], visible: !current.layers[layerId].visible } },
    }), true);
  }, [applyDraftChange]);

  const handleToggleLayerLocked = useCallback((layerId: ComicLayerId) => {
    applyDraftChange(current => ({
      ...current,
      layers: { ...current.layers, [layerId]: { ...current.layers[layerId], locked: !current.layers[layerId].locked } },
    }), true);
  }, [applyDraftChange]);

  const handleMoveLayerOrder = useCallback((layerId: ComicLayerId, direction: 'up' | 'down') => {
    applyDraftChange(current => {
      const ordered = (['panels', 'drawing', 'bubbles', 'stickers'] as ComicLayerId[])
        .sort((a, b) => (current.layers[b]?.order ?? 0) - (current.layers[a]?.order ?? 0));
      const idx = ordered.indexOf(layerId);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= ordered.length) return current;
      const nextOrder = [...ordered];
      [nextOrder[idx], nextOrder[swapIdx]] = [nextOrder[swapIdx], nextOrder[idx]];
      const nextLayers = { ...current.layers };
      nextOrder.forEach((id, rank) => {
        nextLayers[id] = { ...nextLayers[id], order: nextOrder.length - 1 - rank };
      });
      return { ...current, layers: nextLayers };
    }, true);
  }, [applyDraftChange]);

  const handleAddBubbleAt = useCallback((pt: ComicPoint) => {
    const created: ComicBubbleItem = {
      id: createUuid(),
      shape: defaultBubbleShape,
      x: pt.x,
      y: pt.y,
      width: 0.28,
      height: 0.14,
      hasTail: defaultBubbleShape !== 'caption',
      tailX: Math.min(0.95, pt.x + 0.08),
      tailY: Math.min(0.95, pt.y + 0.11),
      text: '输入台词…',
      writingMode: defaultBubbleWritingMode,
      fontSize: 22,
      textColor: '#111827',
      fillColor: '#ffffff',
      strokeColor: '#111827',
      strokeWidth: 3,
      rotation: 0,
    };
    applyDraftChange(cur => ({ ...cur, bubbles: [...cur.bubbles, created] }), true);
    handleSelectWithTab({ kind: 'bubble', id: created.id });
    setActiveTool('select');
  }, [applyDraftChange, defaultBubbleShape, defaultBubbleWritingMode, handleSelectWithTab]);

  const handleAddTextAt = useCallback((pt: ComicPoint) => {
    const created: ComicTextItem = {
      id: createUuid(),
      x: pt.x,
      y: pt.y,
      text: '砰！',
      writingMode: 'horizontal',
      fontSize: 38,
      color: '#111827',
      strokeColor: '#ffffff',
      rotation: 0,
      bold: true,
    };
    applyDraftChange(cur => ({ ...cur, texts: [...cur.texts, created] }), true);
    handleSelectWithTab({ kind: 'text', id: created.id });
    setActiveTool('select');
  }, [applyDraftChange, handleSelectWithTab]);

  const handleAddStickerAt = useCallback((pt: ComicPoint) => {
    const created: ComicStickerItem = {
      id: createUuid(),
      kind: defaultStickerKind,
      x: pt.x,
      y: pt.y,
      width: defaultStickerKind === 'speedlines' ? 0.42 : 0.14,
      height: defaultStickerKind === 'speedlines' ? 0.42 : 0.14,
      rotation: 0,
      color: defaultStickerKind === 'anger' || defaultStickerKind === 'heart' ? '#ef4444' : '#111827',
      opacity: 1,
    };
    applyDraftChange(cur => ({ ...cur, stickers: [...cur.stickers, created] }), true);
    handleSelectWithTab({ kind: 'sticker', id: created.id });
    setActiveTool('select');
  }, [applyDraftChange, defaultStickerKind, handleSelectWithTab]);

  // 估算当前活跃分镜格费用与 AI 整页总费用（用于底部生成栏展示）
  const selectedPanelForCost = (selection?.kind === 'panel'
    ? draft.panels.find(p => p.id === selection.id)
    : undefined) || draft.panels[0];
  const estimatedCost = useMemo(() => {
    if (!selectedPanelForCost) return 0;
    const compiled = buildComicPanelGenerationInput(draft, selectedPanelForCost);
    const isOpus = (novelaiSubscription.info?.tier ?? 3) >= 3;
    const exhausted = novelaiSubscription.info?.usage?.isNegative === true;
    return estimateV45GenerationCost(compiled.params, isOpus, exhausted);
  }, [draft, selectedPanelForCost, novelaiSubscription.info]);

  const aiZonePlan = useMemo(() => planComicAiZones(draft), [draft]);
  const aiEstimatedCost = useMemo(() => {
    const isOpus = (novelaiSubscription.info?.tier ?? 3) >= 3;
    const exhausted = novelaiSubscription.info?.usage?.isNegative === true;
    return aiZonePlan.zones.reduce((sum, zone) => {
      const compiled = buildAiPageZoneRequest(draft, zone, aiZonePlan.zones.length);
      return sum + estimateV45GenerationCost(compiled.params, isOpus, exhausted);
    }, 0);
  }, [aiZonePlan, draft, novelaiSubscription.info]);

  const handleUpdateAiPage = useCallback((updater: (aiPage: ComicAiPagePlan) => ComicAiPagePlan, commit = true) => {
    applyDraftChange(current => ({
      ...current,
      aiPage: updater(current.aiPage),
    }), commit);
  }, [applyDraftChange]);

  const handleMoveAiAnchor = useCallback((anchorId: string, x: number, y: number, commit = false) => {
    handleUpdateAiPage(cur => ({
      ...cur,
      anchors: cur.anchors.map(a => a.id === anchorId ? { ...a, x, y } : a),
    }), commit);
  }, [handleUpdateAiPage]);

  const handleInitAiFromTemplate = useCallback(() => {
    const nextGuides = buildGuidePanelsForCount(
      draft.aiPage.targetPanelCount || 4,
      draft.gutterPx,
      draft.width,
      draft.height,
    );
    handleUpdateAiPage(cur => ({
      ...cur,
      guidePanels: nextGuides,
      showGuideOverlay: true,
    }), true);
    notify(t('已按 {0} 格重置 AI 构图引导区', [nextGuides.length]));
  }, [draft.aiPage.targetPanelCount, draft.gutterPx, draft.height, draft.width, handleUpdateAiPage, notify]);

  const handlePlanAiStoryboard = useCallback(async () => {
    const story = draft.aiPage.storyPrompt.trim();
    if (!story) {
      notify(t('请先输入本页剧情描述'), 'error');
      return;
    }
    setPlanningAiStoryboard(true);
    try {
      const castCharacters = draft.aiPage.castCharacterIds
        .map(id => chains.find(c => c.id === id))
        .filter((c): c is PromptChain => Boolean(c))
        .map(c => ({
          name: c.name,
          prompt: [c.basePrompt, c.variableValues?.subject].filter(Boolean).join(', '),
        }));

      const planned = await promptAgentService.planComicStoryboard({
        storyPrompt: story,
        targetPanelCount: draft.aiPage.targetPanelCount,
        width: draft.width,
        height: draft.height,
        colorMode: draft.colorMode,
        dialogueMode: draft.dialogueMode,
        castCharacters,
      });

      const nextGuides: ComicAiGuidePanel[] = planned.guidePanels.map(gp => ({
        id: createUuid(),
        label: gp.label,
        summary: gp.summary,
        x: gp.x,
        y: gp.y,
        width: gp.width,
        height: gp.height,
      }));
      const nextAnchors = planned.anchors.map(a => ({
        id: createUuid(),
        kind: a.kind,
        label: a.label,
        prompt: a.prompt,
        negativePrompt: a.negativePrompt || '',
        x: a.x,
        y: a.y,
        enabled: a.enabled !== false,
        ...(a.bubbleShape ? { bubbleShape: a.bubbleShape } : {}),
        ...(a.bubbleText ? { bubbleText: a.bubbleText } : {}),
      }));

      applyDraftChange(current => ({
        ...current,
        title: (!current.title || current.title === '未命名漫画页') && planned.title
          ? planned.title
          : current.title,
        aiPage: {
          ...current.aiPage,
          layoutHint: planned.layoutHint || current.aiPage.layoutHint,
          guidePanels: nextGuides.length > 0 ? nextGuides : current.aiPage.guidePanels,
          anchors: nextAnchors,
          showGuideOverlay: true,
        },
      }), true);

      if (nextAnchors[0]) {
        setSelection({ kind: 'ai-anchor', id: nextAnchors[0].id });
      }
      const modelSuffix = planned.model ? `（${planned.model}）` : '';
      notify(t('AI 已编排 {0} 个引导格与 {1} 个空间锚点{2}', [nextGuides.length, nextAnchors.length, modelSuffix]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('AI 分镜编排失败，请检查创作助手模型配置'), 'error');
    } finally {
      setPlanningAiStoryboard(false);
    }
  }, [applyDraftChange, chains, draft.aiPage.castCharacterIds, draft.aiPage.storyPrompt, draft.aiPage.targetPanelCount, draft.colorMode, draft.dialogueMode, draft.height, draft.width, notify]);

  const handleConvertBubbleAnchorsToVector = useCallback(() => {
    const bubbleAnchors = draft.aiPage.anchors.filter(a => a.enabled && a.kind === 'bubble');
    if (!bubbleAnchors.length) {
      notify(t('当前没有可转换的气泡锚点'), 'error');
      return;
    }
    const created: ComicBubbleItem[] = [];
    for (const anchor of bubbleAnchors) {
      const duplicate = draft.bubbles.some(b => Math.hypot(b.x - anchor.x, b.y - anchor.y) < 0.03);
      if (duplicate) continue;
      const shape: ComicBubbleShape = anchor.bubbleShape || defaultBubbleShape;
      created.push({
        id: createUuid(),
        shape,
        x: anchor.x,
        y: anchor.y,
        width: 0.24,
        height: 0.12,
        hasTail: shape !== 'caption',
        tailX: Math.min(0.95, anchor.x + 0.06),
        tailY: Math.min(0.95, anchor.y + 0.09),
        text: anchor.bubbleText?.trim() || '输入台词…',
        writingMode: defaultBubbleWritingMode,
        fontSize: 20,
        textColor: '#111827',
        fillColor: '#ffffff',
        strokeColor: '#111827',
        strokeWidth: 3,
        rotation: 0,
      });
    }
    if (!created.length) {
      notify(t('对应位置的气泡已存在于矢量层中'));
      return;
    }
    applyDraftChange(cur => ({
      ...cur,
      bubbles: [...cur.bubbles, ...created],
    }), true);
    handleSelectWithTab({ kind: 'bubble', id: created[0].id });
    notify(t('已将 {0} 个气泡锚点转为可编辑矢量气泡', [created.length]));
  }, [applyDraftChange, defaultBubbleShape, defaultBubbleWritingMode, draft.aiPage.anchors, draft.bubbles, handleSelectWithTab, notify]);

  // 核心：AI 整页锚点一图成型（单区直出或自动双区无缝拼合，走统一 Key 池 / Opus 守卫 / 单并发队列）
  const handleGenerateAiPage = useCallback(async () => {
    if (generatingPanelId || generatingAiPage) {
      notify(t('当前已有生图任务正在运行，请等待完成'), 'error');
      return;
    }
    if (aiZonePlan.overallLevel === 'hard-exceeded') {
      notify(t('单区锚点超过 24 槽硬上限，请先切换双区或精简锚点'), 'error');
      return;
    }

    const compiledZones = aiZonePlan.zones.map(zone => ({
      zone,
      compiled: buildAiPageZoneRequest(draft, zone, aiZonePlan.zones.length),
    }));
    const hasAnyContent = compiledZones.some(z => z.compiled.prompt.trim() || (z.compiled.params.characters?.length ?? 0) > 0);
    if (!hasAnyContent) {
      notify(t('请先编排锚点或填写全页画风提示词后再生成'), 'error');
      return;
    }

    let submitKey = readActiveApiKey();
    const firstCompiled = compiledZones[0].compiled;
    const opusBaseCost = estimateV45GenerationCost(firstCompiled.params, true, false);
    const poolCheck = await prepareGenerationWithPool({
      model: firstCompiled.params.model,
      estimatedCostWithOpus: opusBaseCost,
    });
    if (poolCheck.pooled) {
      if (!poolCheck.ok) {
        notify(poolCheck.message || t('Key 池当前无可用免费额度'), 'error');
        return;
      }
      submitKey = poolCheck.key;
    }
    if (!submitKey) {
      notify(t('请先在全局设置中配置 NovelAI API Key'), 'error');
      return;
    }

    const perUseChannel = getNaiChannelMode() === 'per-use';
    const opusTier = poolCheck.pooled ? (poolCheck.info?.tier ?? 3) : (novelaiSubscription.info?.tier ?? 3);
    const exhausted = poolCheck.pooled
      ? poolCheck.info?.usage?.isNegative === true
      : await usageForCostEstimate(novelaiSubscription.info?.usage, () => novelaiSubscription.refresh(), firstCompiled.params.model);

    const zoneCosts = compiledZones.map(item => (
      perUseChannel ? 0 : estimateV45GenerationCost(item.compiled.params, opusTier >= 3, exhausted)
    ));
    const totalCost = zoneCosts.reduce((acc, c) => acc + c, 0);

    if (totalCost > 0) {
      const approved = await confirmAction({
        rememberKey: 'comic.ai-page-paid',
        rememberScope: { cost: totalCost, model: firstCompiled.params.model, zones: compiledZones.length },
        title: t('确认消耗 Anlas 生成 AI 整页'),
        message: compiledZones.length === 2
          ? t('本次自动双区拼合将依次生成 2 张图，合计预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(totalCost, firstCompiled.params.model)])
          : t('本次整页生成预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(totalCost, firstCompiled.params.model)]),
        confirmLabel: t('消耗 {0} 点生成', [totalCost]),
        tone: 'danger',
      });
      if (!approved) return;
    }

    const firstWarning = compiledZones.flatMap(z => z.compiled.warnings)[0];
    if (firstWarning) notify(firstWarning);

    aiCancelRequestedRef.current = false;
    setGeneratingAiPage(true);

    try {
      const zoneResults: Array<{ url: string; historyId?: string; width: number; height: number }> = [];
      for (let idx = 0; idx < compiledZones.length; idx++) {
        if (aiCancelRequestedRef.current) break;
        const { zone, compiled } = compiledZones[idx];
        const zoneCost = zoneCosts[idx];
        setGeneratingAiZoneIndex(zone.zoneIndex);
        setAiGenerationStageText(compiledZones.length === 2
          ? t('区 {0}/2 · {1} 生成中…', [idx + 1, zone.label])
          : t('整页生成中…'));

        const descriptor = await buildGenerationJobDescriptor({
          operation: 'text-to-image',
          prompt: compiled.prompt,
          negative: compiled.negative,
          params: compiled.params,
          approvedCost: zoneCost,
          stream: generationStreamPreview,
          forceEmptySeed,
          apiKey: submitKey,
          estimatedCost: zoneCost,
          history: {
            basePrompt: draft.globalBasePrompt,
            subjectPrompt: draft.aiPage.storyPrompt || zone.label,
            sourceChainId: draft.styleChainId || 'comic',
            sourceChainName: compiledZones.length === 2
              ? `漫画整页 · ${draft.title || '未命名漫画页'} · ${zone.label}`
              : `漫画整页 · ${draft.title || '未命名漫画页'}`,
            sourceChainType: 'comic',
          },
        });

        const { session, settle } = beginGenerationSeries({
          scope: COMIC_GEN_SCOPE,
          key: submitKey,
          count: 1,
          agent: false,
          descriptor,
        });
        activeSessionRef.current = session;

        const unsubApproval = subscribeGenerationSeries(() => {
          if (session.state === 'awaiting_confirmation' && session.awaiting) {
            const nextCost = session.awaiting.cost;
            void confirmAction({
              title: t('费用变化确认'),
              message: t('上游计费已更新为 {0} Anlas，是否继续生成 {1}？', [nextCost, zone.label]),
              confirmLabel: t('继续生成'),
              tone: 'danger',
            }).then(ok => {
              if (ok) void approveGenerationSeries(session, nextCost);
              else {
                aiCancelRequestedRef.current = true;
                stopGenerationSeriesSession(session);
              }
            });
          }
        });

        const result = await settle;
        unsubApproval();
        activeSessionRef.current = null;

        const saved = session.lastSavedItem;
        if (!result.success || !saved?.imageUrl) {
          if (result.outcome === 'cancelled' || aiCancelRequestedRef.current) {
            return;
          }
          notify(result.error || t('{0}生成失败', [zone.label]), 'error');
          return;
        }
        zoneResults.push({
          url: saved.imageUrl,
          historyId: saved.id,
          width: saved.params?.width || zone.resolution.width,
          height: saved.params?.height || zone.resolution.height,
        });
      }

      if (aiCancelRequestedRef.current || zoneResults.length !== compiledZones.length) return;

      if (zoneResults.length === 1) {
        const only = zoneResults[0];
        handleUpdateAiPage(cur => ({
          ...cur,
          generatedPageImage: {
            url: only.url,
            historyId: only.historyId,
            width: only.width,
            height: only.height,
            zoneHistoryIds: only.historyId ? [only.historyId] : undefined,
          },
          showGuideOverlay: false,
        }), true);
        notify(t('AI 整页漫画生成完成，已可叠加气泡嵌字或导出'));
      } else {
        setAiGenerationStageText(t('正在无缝拼合双区整页…'));
        const splitAxis = aiZonePlan.effectiveSplit === 'dual-horizontal' ? 'dual-horizontal' : 'dual-vertical';
        const stitchedBlob = await stitchAiZoneImages(
          [zoneResults[0].url, zoneResults[1].url],
          splitAxis,
          aiZonePlan.splitRatio,
          draft.width,
          draft.height,
          draft.backgroundColor,
          draft.gutterPx,
        );

        let finalUrl = '';
        let finalHistoryId: string | undefined;
        try {
          const archived = await localHistory.add(
            stitchedBlob,
            draft.aiPage.storyPrompt || `[AI 漫画双区拼合] ${draft.title || '未命名漫画页'}`,
            {
              model: draft.v5Model,
              width: draft.width,
              height: draft.height,
              steps: draft.steps,
              scale: draft.scale,
              sampler: draft.sampler,
              noiseSchedule: draft.noiseSchedule,
              qualityPresetId: draft.qualityPresetId,
              ucPresetId: draft.ucPresetId,
            },
            draft.globalNegativePrompt,
            {
              sourceChainId: draft.styleChainId || 'comic',
              sourceChainName: `漫画整页拼合 · ${draft.title || '未命名漫画页'}`,
              sourceChainType: 'comic',
            },
          );
          finalUrl = archived.imageUrl;
          finalHistoryId = archived.id;
        } catch {
          finalUrl = URL.createObjectURL(stitchedBlob);
        }

        handleUpdateAiPage(cur => ({
          ...cur,
          generatedPageImage: {
            url: finalUrl,
            historyId: finalHistoryId,
            width: draft.width,
            height: draft.height,
            zoneHistoryIds: zoneResults.map(z => z.historyId).filter((id): id is string => Boolean(id)),
          },
          showGuideOverlay: false,
        }), true);
        notify(t('双区免费生成并无缝拼合完成，整页成品已归档至历史'));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('AI 整页生成失败'), 'error');
    } finally {
      activeSessionRef.current = null;
      setGeneratingAiPage(false);
      setGeneratingAiZoneIndex(null);
      setAiGenerationStageText('');
    }
  }, [
    aiZonePlan,
    confirmAction,
    draft,
    forceEmptySeed,
    generatingAiPage,
    generatingPanelId,
    generationStreamPreview,
    handleUpdateAiPage,
    notify,
    novelaiSubscription,
  ]);

  // 第三期核心 1：纯前端毫秒级纯白气泡连通域自动识别并贴入可编辑文字层
  const handleAutoDetectWhiteBubbles = useCallback(async () => {
    const imgUrl = draft.aiPage.generatedPageImage?.url;
    if (!imgUrl) {
      notify(t('请先生成 AI 整页图片后再识别空白气泡'), 'error');
      return;
    }
    setDetectingBubbles(true);
    try {
      const detected = await detectWhiteBubblesFromImageUrl(imgUrl);
      const built = buildEmbeddedBubbleTextItems(
        detected,
        draft.aiPage.anchors,
        draft.bubbles,
        { writingMode: defaultBubbleWritingMode, pageHeight: draft.height },
      );
      if (!built.items.length) {
        notify(t('未识别到新的纯白气泡区域（或对应位置已有嵌字），可手动用气泡工具补充'), 'error');
        return;
      }
      applyDraftChange(cur => ({
        ...cur,
        bubbles: [...cur.bubbles, ...built.items],
      }), true);
      handleSelectWithTab({ kind: 'bubble', id: built.items[0].id });
      notify(t('识别到 {0} 个纯白气泡，已自动嵌字 {1} 处（双击画布文字可随时修改）', [built.detectedCount, built.items.length]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('自动识别纯白气泡失败'), 'error');
    } finally {
      setDetectingBubbles(false);
    }
  }, [applyDraftChange, defaultBubbleWritingMode, draft.aiPage.anchors, draft.aiPage.generatedPageImage?.url, draft.bubbles, draft.height, handleSelectWithTab, notify]);

  // 第三期核心 2：开启单格局部重绘（可一键对齐某引导格，并自动带入该格内的已有锚点）
  const handleOpenInpaint = useCallback((guidePanel?: ComicAiGuidePanel) => {
    const rect: ComicInpaintRect = guidePanel
      ? clampInpaintRect({ x: guidePanel.x, y: guidePanel.y, width: guidePanel.width, height: guidePanel.height })
      : { x: 0.08, y: 0.08, width: 0.84, height: 0.34 };
    // 把落在该引导格内的已有整页锚点映射为重绘区局部锚点，方便直接微调动作与表情
    const localAnchors = draft.aiPage.anchors
      .filter(a => a.enabled && a.x >= rect.x - 0.02 && a.x <= rect.x + rect.width + 0.02 && a.y >= rect.y - 0.02 && a.y <= rect.y + rect.height + 0.02)
      .map(a => ({
        ...a,
        id: createUuid(),
        x: Math.max(0.05, Math.min(0.95, (a.x - rect.x) / Math.max(0.05, rect.width))),
        y: Math.max(0.05, Math.min(0.95, (a.y - rect.y) / Math.max(0.05, rect.height))),
      }));
    setInpaintDraft(prev => ({
      rect,
      prompt: prev?.prompt || guidePanel?.summary || '',
      negativePrompt: prev?.negativePrompt || '',
      strength: prev?.strength ?? 0.85,
      focused: prev?.focused ?? true,
      anchors: localAnchors,
    }));
    setActiveTool('select');
  }, [draft.aiPage.anchors]);

  // 第三期核心 2：执行单格蒙版局部重绘（走统一 Key 池、Opus 守卫、付费确认与后端无缝回贴）
  const handleRunInpaint = useCallback(async () => {
    const baseUrl = draft.aiPage.generatedPageImage?.url;
    if (!baseUrl || !inpaintDraft) return;
    if (generatingPanelId || generatingAiPage || inpaintingAiPage) {
      notify(t('当前已有生图任务正在运行，请等待完成'), 'error');
      return;
    }

    const compiled = buildComicInpaintRequest(draft, inpaintDraft);
    if (!compiled.prompt.trim() && !(compiled.params.characters?.length)) {
      notify(t('请填写重绘区域描述或添加至少一个重绘锚点'), 'error');
      return;
    }

    let submitKey = readActiveApiKey();
    const opusBaseCost = estimateV45GenerationCost(compiled.params, true, false);
    const poolCheck = await prepareGenerationWithPool({
      model: compiled.params.model,
      estimatedCostWithOpus: opusBaseCost,
    });
    if (poolCheck.pooled) {
      if (!poolCheck.ok) {
        notify(poolCheck.message || t('Key 池当前无可用免费额度'), 'error');
        return;
      }
      submitKey = poolCheck.key;
    }
    if (!submitKey) {
      notify(t('请先在全局设置中配置 NovelAI API Key'), 'error');
      return;
    }

    const perUseChannel = getNaiChannelMode() === 'per-use';
    const opusTier = poolCheck.pooled ? (poolCheck.info?.tier ?? 3) : (novelaiSubscription.info?.tier ?? 3);
    const exhausted = poolCheck.pooled
      ? poolCheck.info?.usage?.isNegative === true
      : await usageForCostEstimate(novelaiSubscription.info?.usage, () => novelaiSubscription.refresh(), compiled.params.model);
    const cost = perUseChannel ? 0 : estimateV45GenerationCost(compiled.params, opusTier >= 3, exhausted);

    if (cost > 0) {
      const approved = await confirmAction({
        rememberKey: 'comic.inpaint-paid',
        rememberScope: { cost, model: compiled.params.model },
        title: t('确认消耗 Anlas 进行单格局部重绘'),
        message: t('本次局部重绘预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(cost, compiled.params.model)]),
        confirmLabel: t('消耗 {0} 点重绘', [cost]),
        tone: 'danger',
      });
      if (!approved) return;
    }

    if (compiled.warnings.length > 0) notify(compiled.warnings[0]);

    setInpaintingAiPage(true);
    setAiGenerationStageText(t('准备重绘蒙版…'));
    try {
      const base = await loadImageAsDataUrl(baseUrl);
      const maskDataUrl = createRectInpaintMaskDataUrl(base.width, base.height, inpaintDraft.rect);
      const safeRect = clampInpaintRect(inpaintDraft.rect);
      const padX = safeRect.width * 0.12;
      const padY = safeRect.height * 0.12;
      const fx = Math.max(0, safeRect.x - padX);
      const fy = Math.max(0, safeRect.y - padY);
      const fw = Math.min(1 - fx, safeRect.width + padX * 2);
      const fh = Math.min(1 - fy, safeRect.height + padY * 2);
      const focusedRect = {
        x: Math.round(fx * base.width),
        y: Math.round(fy * base.height),
        width: Math.max(64, Math.round(fw * base.width)),
        height: Math.max(64, Math.round(fh * base.height)),
      };

      setAiGenerationStageText(t('单格局部重绘中…'));
      const descriptor = await buildGenerationJobDescriptor({
        operation: 'inpaint',
        prompt: compiled.prompt,
        negative: compiled.negative,
        params: compiled.params,
        approvedCost: cost,
        stream: generationStreamPreview,
        forceEmptySeed,
        apiKey: submitKey,
        estimatedCost: cost,
        edit: {
          image: base.dataUrl,
          mask: maskDataUrl,
          strength: compiled.strength,
          noise: 0,
          focused: compiled.focused,
          focusedRect,
        },
        history: {
          basePrompt: draft.globalBasePrompt,
          subjectPrompt: inpaintDraft.prompt || '漫画单格局部重绘',
          sourceChainId: draft.styleChainId || 'comic',
          sourceChainName: `漫画局部重绘 · ${draft.title || '未命名漫画页'}`,
          sourceChainType: 'comic',
        },
      });

      const { session, settle } = beginGenerationSeries({
        scope: COMIC_GEN_SCOPE,
        key: submitKey,
        count: 1,
        agent: false,
        descriptor,
      });
      activeSessionRef.current = session;

      const unsubApproval = subscribeGenerationSeries(() => {
        if (session.state === 'awaiting_confirmation' && session.awaiting) {
          const nextCost = session.awaiting.cost;
          void confirmAction({
            title: t('费用变化确认'),
            message: t('上游计费已更新为 {0} Anlas，是否继续单格重绘？', [nextCost]),
            confirmLabel: t('继续重绘'),
            tone: 'danger',
          }).then(ok => {
            if (ok) void approveGenerationSeries(session, nextCost);
            else stopGenerationSeriesSession(session);
          });
        }
      });

      const result = await settle;
      unsubApproval();
      const saved = session.lastSavedItem;
      if (result.success && saved?.imageUrl) {
        handleUpdateAiPage(cur => ({
          ...cur,
          generatedPageImage: {
            url: saved.imageUrl,
            historyId: saved.id,
            width: saved.params?.width || base.width,
            height: saved.params?.height || base.height,
            zoneHistoryIds: cur.generatedPageImage?.zoneHistoryIds,
          },
          showGuideOverlay: false,
        }), true);
        setInpaintDraft(null);
        notify(t('单格局部重绘完成并已无缝回贴（可随时 Ctrl+Z 撤销）'));
      } else if (result.outcome !== 'cancelled') {
        notify(result.error || t('单格局部重绘失败'), 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('单格局部重绘失败'), 'error');
    } finally {
      activeSessionRef.current = null;
      setInpaintingAiPage(false);
      setAiGenerationStageText('');
    }
  }, [
    confirmAction,
    draft,
    forceEmptySeed,
    generatingAiPage,
    generatingPanelId,
    generationStreamPreview,
    handleUpdateAiPage,
    inpaintDraft,
    inpaintingAiPage,
    notify,
    novelaiSubscription,
  ]);

  // 核心：单格 V5 生图（走工坊统一 Key 池、Opus 守卫与后端单并发队列）
  const handleGeneratePanel = useCallback(async (panelId: string) => {
    const panel = draft.panels.find(p => p.id === panelId);
    if (!panel) return;
    if (generatingPanelId) {
      notify(t('当前已有分镜格正在生成，请等待完成'), 'error');
      return;
    }

    const compiled = buildComicPanelGenerationInput(draft, panel);
    if (compiled.guard.level === 'hard-exceeded') {
      notify(t('单次生图最多 24 个锚点，请先精简锚点'), 'error');
      return;
    }
    if (!compiled.prompt.trim() && !(compiled.params.characters?.length)) {
      notify(t('请先填写全页画风或本格画面描述后再生成'), 'error');
      return;
    }

    let submitKey = readActiveApiKey();
    const opusBaseCost = estimateV45GenerationCost(compiled.params, true, false);
    const poolCheck = await prepareGenerationWithPool({
      model: compiled.params.model,
      estimatedCostWithOpus: opusBaseCost,
    });
    if (poolCheck.pooled) {
      if (!poolCheck.ok) {
        notify(poolCheck.message || t('Key 池当前无可用免费额度'), 'error');
        return;
      }
      submitKey = poolCheck.key;
    }
    if (!submitKey) {
      notify(t('请先在全局设置中配置 NovelAI API Key'), 'error');
      return;
    }

    const perUseChannel = getNaiChannelMode() === 'per-use';
    const opusTier = poolCheck.pooled ? (poolCheck.info?.tier ?? 3) : (novelaiSubscription.info?.tier ?? 3);
    const exhausted = poolCheck.pooled
      ? poolCheck.info?.usage?.isNegative === true
      : await usageForCostEstimate(novelaiSubscription.info?.usage, () => novelaiSubscription.refresh(), compiled.params.model);
    const cost = perUseChannel ? 0 : estimateV45GenerationCost(compiled.params, opusTier >= 3, exhausted);

    if (cost > 0) {
      const approved = await confirmAction({
        rememberKey: 'comic.generation-paid',
        rememberScope: { cost, model: compiled.params.model },
        title: t('确认消耗 Anlas 生成分镜格'),
        message: t('本次生成预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(cost, compiled.params.model)]),
        confirmLabel: t('消耗 {0} 点生成', [cost]),
        tone: 'danger',
      });
      if (!approved) return;
    }

    if (compiled.warnings.length > 0) {
      notify(compiled.warnings[0]);
    }

    setGeneratingPanelId(panelId);
    try {
      const descriptor = await buildGenerationJobDescriptor({
        operation: 'text-to-image',
        prompt: compiled.prompt,
        negative: compiled.negative,
        params: compiled.params,
        approvedCost: cost,
        stream: generationStreamPreview,
        forceEmptySeed,
        apiKey: submitKey,
        estimatedCost: cost,
        history: {
          basePrompt: draft.globalBasePrompt,
          subjectPrompt: panel.prompt,
          sourceChainId: draft.styleChainId || 'comic',
          sourceChainName: `漫画 · ${draft.title || '未命名漫画页'} · ${panel.name}`,
          sourceChainType: 'comic',
        },
      });

      const { session, settle } = beginGenerationSeries({
        scope: COMIC_GEN_SCOPE,
        key: submitKey,
        count: 1,
        agent: false,
        descriptor,
      });
      activeSessionRef.current = session;

      // 监听可能出现的费用上涨拦截并弹出确认
      const unsubApproval = subscribeGenerationSeries(() => {
        if (session.state === 'awaiting_confirmation' && session.awaiting) {
          const nextCost = session.awaiting.cost;
          void confirmAction({
            title: t('费用变化确认'),
            message: t('上游计费已更新为 {0} Anlas，是否继续生成该分镜格？', [nextCost]),
            confirmLabel: t('继续生成'),
            tone: 'danger',
          }).then(ok => {
            if (ok) void approveGenerationSeries(session, nextCost);
            else stopGenerationSeriesSession(session);
          });
        }
      });

      const result = await settle;
      unsubApproval();
      const saved = session.lastSavedItem;
      const bounds = getPanelBoundingBox(panel.points, draft.width, draft.height);
      if (result.success && saved?.imageUrl) {
        handleUpdatePanel(panelId, current => ({
          ...current,
          image: {
            url: saved.imageUrl,
            historyId: saved.id,
            width: saved.params?.width || compiled.params.width || bounds.width,
            height: saved.params?.height || compiled.params.height || bounds.height,
            offsetX: 0,
            offsetY: 0,
            scale: 1,
          },
        }), true);
        notify(t('「{0}」生图完成并已填入分镜框', [panel.name]));
      } else if (result.outcome !== 'cancelled') {
        notify(result.error || t('单格生成失败'), 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('单格生成失败'), 'error');
    } finally {
      activeSessionRef.current = null;
      setGeneratingPanelId(null);
    }
  }, [confirmAction, draft, forceEmptySeed, generatingPanelId, generationStreamPreview, handleUpdatePanel, notify, novelaiSubscription]);

  const handleCancelGeneration = useCallback(() => {
    aiCancelRequestedRef.current = true;
    if (activeSessionRef.current) {
      stopGenerationSeriesSession(activeSessionRef.current);
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const receipt = await exportComicPageAndArchive(draft);
      if (receipt.archiveError) {
        notify(t('已导出 {0}（历史归档失败：{1}）', [receipt.filename, receipt.archiveError]), 'error');
      } else {
        notify(t('已导出 {0} 并归档至生成历史', [receipt.filename]));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导出 PNG 失败'), 'error');
    } finally {
      setExporting(false);
    }
  }, [draft, notify]);

  const activeSession = activeSessionRef.current;

  return (
    <div data-agent-view="comic" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <ComicToolbar
        draft={draft}
        activeTool={activeTool}
        activePanel={selectedPanelForCost}
        brushColor={brushColor}
        brushSize={brushSize}
        brushOpacity={brushOpacity}
        defaultStickerKind={defaultStickerKind}
        defaultBubbleShape={defaultBubbleShape}
        defaultBubbleWritingMode={defaultBubbleWritingMode}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        exporting={exporting}
        inspectorOpen={inspectorOpen}
        onChangeTitle={title => applyDraftChange(cur => ({ ...cur, title }), false)}
        onChangeMode={creationMode => {
          applyDraftChange(cur => ({ ...cur, creationMode }), true);
          setInspectorTab('panel');
          setInpaintDraft(null);
        }}
        onSelectPaperPreset={handleSelectPaperPreset}
        onSetCustomPaperSize={handleSetCustomPaperSize}
        onApplyTemplate={tplId => void handleApplyTemplate(tplId)}
        onUpdatePageSettings={patch => applyDraftChange(cur => ({ ...cur, ...patch }), true)}
        onChangeBrush={patch => {
          if (patch.color !== undefined) setBrushColor(patch.color);
          if (patch.size !== undefined) setBrushSize(patch.size);
          if (patch.opacity !== undefined) setBrushOpacity(patch.opacity);
        }}
        onClearStrokes={() => applyDraftChange(cur => ({ ...cur, strokes: [] }), true)}
        onChangeDefaultStickerKind={setDefaultStickerKind}
        onChangeDefaultBubbleStyle={patch => {
          if (patch.shape !== undefined) setDefaultBubbleShape(patch.shape);
          if (patch.writingMode !== undefined) setDefaultBubbleWritingMode(patch.writingMode);
        }}
        onUpdateActivePanelImage={patch => {
          if (!selectedPanelForCost) return;
          handleUpdatePanel(selectedPanelForCost.id, p => {
            if (!p.image) return p;
            if (patch.reset) return { ...p, image: { ...p.image, offsetX: 0, offsetY: 0, scale: 1 } };
            return { ...p, image: { ...p.image, ...(patch.scale !== undefined ? { scale: patch.scale } : {}) } };
          }, Boolean(patch.reset));
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleInspector={() => setInspectorOpen(open => !open)}
        onExport={() => void handleExport()}
        onBack={onBack}
      />

      {/* 经典 PS 4 列工作区：[全局导航] | [满高竖工具栏] | [点阵绘图桌漫画区] | [右侧宽敞操作区] */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <ComicToolRail
          activeTool={activeTool}
          foregroundColor={brushColor}
          onSelectTool={setActiveTool}
          onChangeForegroundColor={setBrushColor}
        />

        <div ref={canvasWrapRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ComicCanvas
            draft={draft}
            aiZonePlan={aiZonePlan}
            inpaintDraft={inpaintDraft}
            activeTool={activeTool}
            selection={selection}
            zoom={zoom}
            brushColor={brushColor}
            brushSize={brushSize}
            brushOpacity={brushOpacity}
            generatingPanelId={generatingPanelId}
            generatingAiPage={generatingAiPage}
            generatingAiZoneIndex={generatingAiZoneIndex}
            livePreviewImage={activeSession?.preview?.image || null}
            onSelect={handleSelectWithTab}
            onZoomChange={setZoom}
            onZoomFit={() => fitCanvasToViewport()}
            onToggleSnap={() => applyDraftChange(cur => ({ ...cur, snapEnabled: !cur.snapEnabled }), true)}
            onUpdatePanel={handleUpdatePanel}
            onMoveAiAnchor={handleMoveAiAnchor}
            onChangeInpaintRect={rect => setInpaintDraft(cur => cur ? { ...cur, rect } : cur)}
            onMoveInpaintAnchor={(anchorId, x, y) => setInpaintDraft(cur => cur ? {
              ...cur,
              anchors: cur.anchors.map(a => a.id === anchorId ? { ...a, x, y } : a),
            } : cur)}
            onAddPanel={handleAddPanel}
            onSliceAtLine={handleSliceAtLine}
            onCommitStroke={(stroke: ComicStroke) => applyDraftChange(cur => ({ ...cur, strokes: [...cur.strokes, stroke] }), true)}
            onAddBubbleAt={handleAddBubbleAt}
            onAddTextAt={handleAddTextAt}
            onAddStickerAt={handleAddStickerAt}
            onMoveBubble={(id, x, y, commit = false) => applyDraftChange(cur => ({
              ...cur,
              bubbles: cur.bubbles.map(b => b.id === id ? { ...b, x, y, tailX: b.tailX + (x - b.x), tailY: b.tailY + (y - b.y) } : b),
            }), commit)}
            onResizeBubble={(id, width, height, commit = false) => applyDraftChange(cur => ({
              ...cur,
              bubbles: cur.bubbles.map(b => b.id === id ? { ...b, width, height } : b),
            }), commit)}
            onEditBubbleText={(id, text, commit = true) => applyDraftChange(cur => ({
              ...cur,
              bubbles: cur.bubbles.map(b => b.id === id ? { ...b, text } : b),
            }), commit)}
            onMoveBubbleTail={(id, tailX, tailY, commit = false) => applyDraftChange(cur => ({
              ...cur,
              bubbles: cur.bubbles.map(b => b.id === id ? { ...b, tailX, tailY } : b),
            }), commit)}
            onMoveText={(id, x, y, commit = false) => applyDraftChange(cur => ({
              ...cur,
              texts: cur.texts.map(item => item.id === id ? { ...item, x, y } : item),
            }), commit)}
            onEditFreeText={(id, text, commit = true) => applyDraftChange(cur => ({
              ...cur,
              texts: cur.texts.map(item => item.id === id ? { ...item, text } : item),
            }), commit)}
            onMoveSticker={(id, x, y, commit = false) => applyDraftChange(cur => ({
              ...cur,
              stickers: cur.stickers.map(item => item.id === id ? { ...item, x, y } : item),
            }), commit)}
            onResizeSticker={(id, width, height, commit = false) => applyDraftChange(cur => ({
              ...cur,
              stickers: cur.stickers.map(item => item.id === id ? { ...item, width, height } : item),
            }), commit)}
          />
        </div>

        {inspectorOpen && (
          <div className="h-[46vh] w-full flex-none border-t border-gray-200 dark:border-gray-800 md:h-full md:w-[376px] md:border-t-0 lg:w-[416px] xl:w-[440px]">
            <ComicInspector
              draft={draft}
              aiZonePlan={aiZonePlan}
              inpaintDraft={inpaintDraft}
              activeTab={inspectorTab}
              selection={selection}
              chains={chains}
              generatingPanelId={generatingPanelId}
              planningAiStoryboard={planningAiStoryboard}
              generatingAiPage={generatingAiPage}
              detectingBubbles={detectingBubbles}
              inpaintingAiPage={inpaintingAiPage}
              aiGenerationStageText={aiGenerationStageText}
              generationStageText={describeStage(activeSession)}
              estimatedCost={estimatedCost}
              aiEstimatedCost={aiEstimatedCost}
              onSelectTab={setInspectorTab}
              onSelect={handleSelectWithTab}
              onQuickAddPanel={() => handleAddPanel(rectToPolygon(0.18, 0.22, 0.64, 0.32))}
              onUpdateDraft={applyDraftChange}
              onUpdateAiPage={handleUpdateAiPage}
              onPlanAiStoryboard={() => void handlePlanAiStoryboard()}
              onInitAiFromTemplate={handleInitAiFromTemplate}
              onConvertBubbleAnchorsToVector={handleConvertBubbleAnchorsToVector}
              onAutoDetectWhiteBubbles={() => void handleAutoDetectWhiteBubbles()}
              onOpenInpaint={handleOpenInpaint}
              onCloseInpaint={() => setInpaintDraft(null)}
              onUpdateInpaintDraft={updater => setInpaintDraft(cur => cur ? updater(cur) : cur)}
              onRunInpaint={() => void handleRunInpaint()}
              onGenerateAiPage={() => void handleGenerateAiPage()}
              onApplyStyleChain={handleApplyStyleChain}
              onUpdatePanel={handleUpdatePanel}
              onDuplicatePanel={handleDuplicatePanel}
              onDeletePanel={handleDeletePanel}
              onBringPanelOrder={handleBringPanelOrder}
              onGeneratePanel={id => void handleGeneratePanel(id)}
              onCancelGeneration={handleCancelGeneration}
              onUpdateBubble={(id, updater, commit = true) => applyDraftChange(cur => ({
                ...cur,
                bubbles: cur.bubbles.map(b => b.id === id ? updater(b) : b),
              }), commit)}
              onDeleteBubble={id => {
                applyDraftChange(cur => ({ ...cur, bubbles: cur.bubbles.filter(b => b.id !== id) }), true);
                setSelection(null);
              }}
              onUpdateText={(id, updater, commit = true) => applyDraftChange(cur => ({
                ...cur,
                texts: cur.texts.map(item => item.id === id ? updater(item) : item),
              }), commit)}
              onDeleteText={id => {
                applyDraftChange(cur => ({ ...cur, texts: cur.texts.filter(item => item.id !== id) }), true);
                setSelection(null);
              }}
              onUpdateSticker={(id, updater, commit = true) => applyDraftChange(cur => ({
                ...cur,
                stickers: cur.stickers.map(item => item.id === id ? updater(item) : item),
              }), commit)}
              onDeleteSticker={id => {
                applyDraftChange(cur => ({ ...cur, stickers: cur.stickers.filter(item => item.id !== id) }), true);
                setSelection(null);
              }}
              onToggleLayerVisible={handleToggleLayerVisible}
              onToggleLayerLocked={handleToggleLayerLocked}
              onMoveLayerOrder={handleMoveLayerOrder}
            />
          </div>
        )}
      </div>
    </div>
  );
};
