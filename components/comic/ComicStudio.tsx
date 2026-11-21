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
import {
  COMIC_LAYOUT_TEMPLATES,
  COMIC_PANEL_SOFT_MAX,
  COMIC_PAPER_PRESETS,
  getPanelBoundingBox,
  rectToPolygon,
  slicePolygonByLine,
} from '../../services/comic/comicGeometry';
import { buildComicPanelGenerationInput } from '../../services/comic/comicPromptBuilder';
import { exportComicPageAndArchive } from '../../services/comic/comicExporter';
import { loadComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
import type {
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
  const [selection, setSelection] = useState<ComicSelection>(() => {
    const initial = loadComicDraft();
    return initial.panels[0] ? { kind: 'panel', id: initial.panels[0].id } : null;
  });
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
    if (next.kind === 'panel') {
      setInspectorTab(cur => (cur === 'layers' ? 'panel' : cur));
    } else {
      setInspectorTab('layers');
    }
  }, []);

  // 单格生图状态
  const [generatingPanelId, setGeneratingPanelId] = useState<string | null>(null);
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

  // 自动计算适配画布缩放
  const fitCanvasToViewport = useCallback((targetW = draft.width, targetH = draft.height) => {
    const host = canvasWrapRef.current;
    if (!host) return;
    const availW = Math.max(240, host.clientWidth - 48);
    const availH = Math.max(240, host.clientHeight - 48);
    const ratio = Math.min(availW / targetW, availH / targetH, 1.15);
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

  // 键盘快捷键：Undo/Redo、Delete/Backspace 删除选中项、Esc 切回选择
  useEffect(() => {
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
  }, [applyDraftChange, confirmAction, draft.gutterPx, draft.height, draft.panels, draft.width]);

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

  // 估算当前活跃分镜格费用（用于底部生成栏展示）
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
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        exporting={exporting}
        inspectorOpen={inspectorOpen}
        onChangeTitle={title => applyDraftChange(cur => ({ ...cur, title }), false)}
        onChangeMode={creationMode => applyDraftChange(cur => ({ ...cur, creationMode }), true)}
        onSelectPaperPreset={handleSelectPaperPreset}
        onSetCustomPaperSize={handleSetCustomPaperSize}
        onApplyTemplate={tplId => void handleApplyTemplate(tplId)}
        onUpdatePageSettings={patch => applyDraftChange(cur => ({ ...cur, ...patch }), true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleInspector={() => setInspectorOpen(open => !open)}
        onExport={() => void handleExport()}
        onBack={onBack}
      />

      {/* 两栏主工作区：左侧悬浮工具坞+纯净大画布 + 右侧固定三标签创作工作台 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div ref={canvasWrapRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ComicCanvas
            draft={draft}
            activeTool={activeTool}
            selection={selection}
            zoom={zoom}
            brushColor={brushColor}
            brushSize={brushSize}
            brushOpacity={brushOpacity}
            defaultStickerKind={defaultStickerKind}
            defaultBubbleShape={defaultBubbleShape}
            defaultBubbleWritingMode={defaultBubbleWritingMode}
            generatingPanelId={generatingPanelId}
            livePreviewImage={activeSession?.preview?.image || null}
            onSelectTool={setActiveTool}
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
            onSelect={handleSelectWithTab}
            onZoomChange={setZoom}
            onZoomFit={() => fitCanvasToViewport()}
            onToggleSnap={() => applyDraftChange(cur => ({ ...cur, snapEnabled: !cur.snapEnabled }), true)}
            onUpdatePanel={handleUpdatePanel}
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
          <div className="h-[46vh] w-full flex-none border-t border-gray-200 dark:border-gray-800 md:h-full md:w-[348px] md:border-t-0 lg:w-[380px]">
            <ComicInspector
              draft={draft}
              activeTab={inspectorTab}
              selection={selection}
              chains={chains}
              generatingPanelId={generatingPanelId}
              generationStageText={describeStage(activeSession)}
              estimatedCost={estimatedCost}
              onSelectTab={setInspectorTab}
              onSelect={handleSelectWithTab}
              onQuickAddPanel={() => handleAddPanel(rectToPolygon(0.18, 0.22, 0.64, 0.32))}
              onUpdateDraft={applyDraftChange}
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
