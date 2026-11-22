import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelRightOpen, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import {
  estimateImageEditCost,
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
  getGuidePanelPolygon,
  renderComicZoneLayoutTemplate,
  resolveLayoutLockConfig,
} from '../../services/comic/comicLayoutTemplateRenderer';
import {
  commitBubbleCandidates,
  detectWhiteBubblesFromImageUrl,
  prepareBubbleCandidates,
  type ComicBubbleCandidate,
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
  createInitialComicDraft,
  getPanelBoundingBox,
  rectToPolygon,
  rotatePointAround,
  slicePolygonByLine,
} from '../../services/comic/comicGeometry';
import {
  deleteCustomComicTemplate,
  instantiateCustomTemplatePanels,
  loadCustomComicTemplates,
  saveCustomComicTemplate,
  type ComicCustomTemplate,
} from '../../services/comic/comicCustomTemplates';
import {
  deleteComicFont,
  downloadBuiltinComicFont,
  FALLBACK_BUILTIN_FONTS,
  fetchComicFontsStatus,
  uploadCustomComicFont,
  type ComicFontCatalogState,
} from '../../services/comic/comicFonts';
import { getBubbleShapeMeta } from '../../services/comic/comicArtwork';
import {
  appendStrokeToDrawingLayer,
  createDrawingLayerInDraft,
  createGroupLayerInDraft,
  createImageLayerInDraft,
  deleteLayerInDraft,
  duplicateLayerInDraft,
  mergeLayerDownInDraft,
  reorderLayerStack,
  resolveActiveDrawingLayerId,
  syncComicLayerStack,
} from '../../services/comic/comicLayers';
import { buildComicPanelGenerationInput, parseDanbooruCastId } from '../../services/comic/comicPromptBuilder';
import {
  exportComicBookAsZip,
  exportComicBookProjectJson,
  exportComicPageAndArchive,
} from '../../services/comic/comicExporter';
import {
  createComicBook,
  DEFAULT_COMIC_BOOK_ID,
  DEFAULT_COMIC_BOOK_TITLE,
  type ComicBook,
} from '../../services/comic/comicBookshelf';
import {
  comicBookshelfService,
  readActiveBookPointer,
  readLocalBookshelfCache,
  writeActiveBookPointer,
  writeLocalBookshelfCache,
} from '../../services/comic/comicBookshelfService';
import { loadComicDraft, normalizeComicDraft, saveComicDraft } from '../../services/comic/comicStorage';
import type {
  ComicAiGuidePanel,
  ComicAiPagePlan,
  ComicAnchor,
  ComicBubbleItem,
  ComicBubbleShape,
  ComicImageLayerItem,
  ComicLayerNode,
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
import { ComicBookshelfModal } from './ComicBookshelfModal';
import { ComicCanvas } from './ComicCanvas';
import { ComicInspector, type ComicInspectorTab } from './ComicInspector';
import { ComicLayersPanel } from './ComicLayersPanel';
import { ComicPageStrip } from './ComicPageStrip';
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
  const [books, setBooks] = useState<ComicBook[]>(() => {
    const cached = readLocalBookshelfCache();
    if (cached.length > 0) return cached;
    return [createComicBook(DEFAULT_COMIC_BOOK_TITLE, [draft], {
      id: DEFAULT_COMIC_BOOK_ID,
      description: '默认随手创作与单页草稿合集',
    })];
  });
  const [activeBookId, setActiveBookId] = useState<string>(() => {
    const pointer = readActiveBookPointer();
    const cached = readLocalBookshelfCache();
    if (pointer.bookId && cached.some(b => b.id === pointer.bookId)) return pointer.bookId;
    return cached[0]?.id || DEFAULT_COMIC_BOOK_ID;
  });
  const [bookshelfOpen, setBookshelfOpen] = useState(false);
  const [bookshelfSynced, setBookshelfSynced] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [zipProgressText, setZipProgressText] = useState('');
  const dirtyBeforeServerLoadRef = useRef(false);
  const booksRef = useRef(books);
  booksRef.current = books;

  const [undoStack, setUndoStack] = useState<ComicPageDraft[]>([]);
  const [redoStack, setRedoStack] = useState<ComicPageDraft[]>([]);
  const [activeTool, setActiveTool] = useState<ComicTool>('select');
  const [selection, setSelection] = useState<ComicSelection>(() => (
    draft.panels[0] ? { kind: 'panel', id: draft.panels[0].id } : null
  ));
  const [inspectorTab, setInspectorTab] = useState<ComicInspectorTab>(() => (
    draft.globalBasePrompt.trim() ? 'panel' : 'style'
  ));
  const [pageStripOpen, setPageStripOpen] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  ));
  const [layersDrawerOpen, setLayersDrawerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  ));
  const [zoom, setZoom] = useState(0.62);
  const [exporting, setExporting] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<ComicCustomTemplate[]>(() => loadCustomComicTemplates());

  // 画笔、贴纸与气泡默认参数
  const [brushColor, setBrushColor] = useState('#111827');
  const [brushSize, setBrushSize] = useState(6);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [defaultStickerKind, setDefaultStickerKind] = useState<ComicStickerKind>('speedlines');
  const [defaultBubbleShape, setDefaultBubbleShape] = useState<ComicBubbleShape>('soft');
  const [defaultBubbleWritingMode, setDefaultBubbleWritingMode] = useState<'horizontal' | 'vertical'>('vertical');
  const [fontCatalog, setFontCatalog] = useState<ComicFontCatalogState>({
    fonts: FALLBACK_BUILTIN_FONTS,
    customFonts: [],
    serverReachable: false,
  });
  const [downloadingFontId, setDownloadingFontId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchComicFontsStatus().then(state => {
      if (!cancelled) setFontCatalog(state);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSelectWithTab = useCallback((next: ComicSelection) => {
    setSelection(next);
    if (!next) return;
    if (next.kind === 'panel' || next.kind === 'ai-anchor' || next.kind === 'panel-anchor' || next.kind === 'breakout-zone') {
      setInspectorTab('panel');
    } else if (next.kind === 'bubble' || next.kind === 'text' || next.kind === 'sticker' || next.kind === 'image') {
      setInspectorTab('layers');
    }
  }, []);

  // 单格生图与 AI 整页生图 / 局部重绘 / 气泡校对 / 整页批生成状态
  const [generatingPanelId, setGeneratingPanelId] = useState<string | null>(null);
  const [batchGeneratingManual, setBatchGeneratingManual] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState('');
  const [lastGeneratedSeed, setLastGeneratedSeed] = useState<number | undefined>(undefined);
  const [planningAiStoryboard, setPlanningAiStoryboard] = useState(false);
  const [preserveGuideLayout, setPreserveGuideLayout] = useState(true);
  const [generatingAiPage, setGeneratingAiPage] = useState(false);
  const [detectingBubbles, setDetectingBubbles] = useState(false);
  const [bubbleCandidates, setBubbleCandidates] = useState<ComicBubbleCandidate[] | null>(null);
  const [comparingOriginalAiImage, setComparingOriginalAiImage] = useState(false);
  const [inpaintingAiPage, setInpaintingAiPage] = useState(false);
  const [inpaintDraft, setInpaintDraft] = useState<ComicInpaintDraft | null>(null);
  const [generatingAiZoneIndex, setGeneratingAiZoneIndex] = useState<0 | 1 | null>(null);
  const [aiGenerationStageText, setAiGenerationStageText] = useState('');
  const aiCancelRequestedRef = useRef(false);
  const activeSessionRef = useRef<GenerationSeriesSession | null>(null);
  const [, setSessionTick] = useState(0);

  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // 启动时从 D1 书架同步作品与页序（离线或未重启后端时优雅保留本地缓存）
  useEffect(() => {
    let cancelled = false;
    void comicBookshelfService.loadBooks().then(({ books: loaded, syncedToServer }) => {
      if (cancelled || !loaded.length) return;
      setBookshelfSynced(syncedToServer);
      if (dirtyBeforeServerLoadRef.current) return;
      setBooks(loaded);
      const pointer = readActiveBookPointer();
      const targetBook = loaded.find(b => b.id === pointer.bookId) || loaded[0];
      const targetPage = targetBook.pages.find(p => p.id === pointer.pageId) || targetBook.pages[0];
      setActiveBookId(targetBook.id);
      if (targetPage) {
        setDraft(targetPage);
        setSelection(targetPage.panels[0] ? { kind: 'panel', id: targetPage.panels[0].id } : null);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 跨重启自动留稿 + 同步当前页回写所属 D1 书架作品（防抖 600ms，与实验室草稿完全隔离）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveComicDraft(draft);
      writeActiveBookPointer(activeBookId, draft.id);
      let updatedBook: ComicBook | null = null;
      const nextBooks = booksRef.current.map(book => {
        if (book.id !== activeBookId) return book;
        const idx = book.pages.findIndex(p => p.id === draft.id);
        const nextPages = idx >= 0
          ? book.pages.map((p, i) => (i === idx ? draft : p))
          : [...book.pages, draft];
        updatedBook = { ...book, pages: nextPages, updatedAt: Date.now() };
        return updatedBook;
      });
      if (updatedBook) {
        setBooks(nextBooks);
        writeLocalBookshelfCache(nextBooks);
        void comicBookshelfService.saveBook(updatedBook).then(res => {
          if (res.syncedToServer) setBookshelfSynced(true);
          if (res.error) notify(res.error, 'error');
        });
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, activeBookId, notify]);

  // 订阅后台生成进度与流式预览帧
  useEffect(() => subscribeGenerationSeries(() => {
    setSessionTick(tick => tick + 1);
  }), []);

  // 自动计算更舒展的画布初始缩放（底部预留 88px 避开悬浮缩放胶囊，让漫画纸底边完整清爽呈现）
  const fitCanvasToViewport = useCallback((targetW = draft.width, targetH = draft.height) => {
    const host = canvasWrapRef.current;
    if (!host) return;
    const availW = Math.max(240, host.clientWidth - 48);
    const availH = Math.max(240, host.clientHeight - 88);
    const ratio = Math.min(availW / targetW, availH / targetH, 1.25);
    setZoom(Math.max(0.25, Math.round(ratio * 100) / 100));
  }, [draft.width, draft.height]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitCanvasToViewport());
    return () => window.cancelAnimationFrame(frame);
  }, [fitCanvasToViewport, inspectorOpen]);

  const applyDraftChange = useCallback((updater: (current: ComicPageDraft) => ComicPageDraft, commit = true) => {
    dirtyBeforeServerLoadRef.current = true;
    setDraft(current => {
      const rawNext = updater(current);
      if (rawNext === current) return current;
      const next = syncComicLayerStack(rawNext);
      if (commit) {
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
    } else if (selection.kind === 'breakout-zone') {
      applyDraftChange(cur => ({
        ...cur,
        aiPage: {
          ...cur.aiPage,
          breakoutZones: (cur.aiPage.breakoutZones || []).filter(bz => bz.id !== selection.id),
        },
      }), true);
      setSelection(null);
    } else if (selection.kind === 'panel-anchor') {
      applyDraftChange(cur => ({
        ...cur,
        panels: cur.panels.map(p => (
          p.id === selection.panelId
            ? { ...p, anchors: p.anchors.filter(a => a.id !== selection.id) }
            : p
        )),
      }), true);
      setSelection({ kind: 'panel', id: selection.panelId });
    } else if (selection.kind === 'bubble') {
      applyDraftChange(cur => ({ ...cur, bubbles: cur.bubbles.filter(b => b.id !== selection.id) }), true);
      setSelection(null);
    } else if (selection.kind === 'text') {
      applyDraftChange(cur => ({ ...cur, texts: cur.texts.filter(item => item.id !== selection.id) }), true);
      setSelection(null);
    } else if (selection.kind === 'sticker') {
      applyDraftChange(cur => ({ ...cur, stickers: cur.stickers.filter(item => item.id !== selection.id) }), true);
      setSelection(null);
    } else if (selection.kind === 'image') {
      applyDraftChange(cur => ({ ...cur, imageLayers: (cur.imageLayers || []).filter(item => item.id !== selection.id) }), true);
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
    if (draft.creationMode === 'ai-page') {
      let slicedCount = 0;
      const nextGuides: ComicAiGuidePanel[] = [];
      for (const gp of draft.aiPage.guidePanels) {
        const poly = getGuidePanelPolygon(gp);
        const split = slicePolygonByLine(poly, start, end, gx, gy);
        if (split && nextGuides.length + 2 <= COMIC_PANEL_SOFT_MAX) {
          slicedCount += 1;
          const b0 = getPanelBoundingBox(split[0], 1, 1);
          const b1 = getPanelBoundingBox(split[1], 1, 1);
          nextGuides.push({
            ...gp,
            x: Math.round(b0.minX * 1000) / 1000,
            y: Math.round(b0.minY * 1000) / 1000,
            width: Math.round(b0.width * 1000) / 1000,
            height: Math.round(b0.height * 1000) / 1000,
            points: split[0].map(pt => ({ x: Math.round(pt.x * 1000) / 1000, y: Math.round(pt.y * 1000) / 1000 })),
          });
          nextGuides.push({
            ...gp,
            id: createUuid(),
            label: `${gp.label}-分格`,
            x: Math.round(b1.minX * 1000) / 1000,
            y: Math.round(b1.minY * 1000) / 1000,
            width: Math.round(b1.width * 1000) / 1000,
            height: Math.round(b1.height * 1000) / 1000,
            points: split[1].map(pt => ({ x: Math.round(pt.x * 1000) / 1000, y: Math.round(pt.y * 1000) / 1000 })),
          });
        } else {
          nextGuides.push(gp);
        }
      }
      if (slicedCount > 0) {
        applyDraftChange(current => ({
          ...current,
          aiPage: {
            ...current.aiPage,
            targetPanelCount: nextGuides.length,
            guidePanels: nextGuides,
            showGuideOverlay: true,
          },
        }), true);
        notify(t('已沿切线斜切 {0} 个 AI 分镜引导格', [slicedCount]));
      } else {
        notify(t('切线未穿过可切分的分镜格'), 'error');
      }
      return;
    }

    const aspect = draft.width / Math.max(1, draft.height);
    let slicedCount = 0;
    const nextPanels: ComicPanel[] = [];
    for (const panel of draft.panels) {
      if (panel.locked) {
        nextPanels.push(panel);
        continue;
      }
      // 旋转过的画格：把切线两端点逆旋转进该格局部坐标空间再切分，两半继承原角度
      let localStart = start;
      let localEnd = end;
      if (panel.rotation) {
        const b = getPanelBoundingBox(panel.points, 1, 1);
        const center = { x: b.cx, y: b.cy };
        localStart = rotatePointAround(start, center, -panel.rotation, aspect);
        localEnd = rotatePointAround(end, center, -panel.rotation, aspect);
      }
      const split = slicePolygonByLine(panel.points, localStart, localEnd, gx, gy);
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
      notify(t('切线未穿过可切分的分镜格'), 'error');
    }
  }, [applyDraftChange, draft.aiPage.guidePanels, draft.creationMode, draft.gutterPx, draft.height, draft.panels, draft.width, notify]);

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

  const handleSaveCustomTemplate = useCallback((label: string) => {
    const panelsToSave: ComicPanel[] = draft.creationMode === 'ai-page'
      ? draft.aiPage.guidePanels.map((gp, idx) => ({
        id: gp.id,
        name: gp.label || `第 ${idx + 1} 格`,
        points: rectToPolygon(gp.x, gp.y, gp.width, gp.height),
        rotation: 0,
        borderColor: '#111827',
        borderWidth: 4,
        backgroundColor: '#f8fafc',
        prompt: '',
        negativePrompt: '',
        anchors: [],
        useCoords: true,
        zIndex: idx,
      }))
      : draft.panels;
    if (!panelsToSave.length) {
      notify(t('当前页面没有可保存的分镜格'), 'error');
      return;
    }
    const next = saveCustomComicTemplate(label, panelsToSave);
    setCustomTemplates(next);
    notify(t('已保存自定义模板「{0}」', [label]));
  }, [draft.aiPage.guidePanels, draft.creationMode, draft.panels, notify]);

  const handleApplyCustomTemplate = useCallback(async (templateId: string) => {
    const template = customTemplates.find(item => item.id === templateId);
    if (!template) return;
    if (draft.creationMode === 'ai-page') {
      const nextGuides: ComicAiGuidePanel[] = template.panels.map((p, idx) => {
        const box = getPanelBoundingBox(p.points, 1, 1);
        return {
          id: createUuid(),
          label: p.name || `第 ${idx + 1} 格`,
          summary: '',
          x: box.minX,
          y: box.minY,
          width: box.width,
          height: box.height,
        };
      });
      applyDraftChange(current => ({
        ...current,
        aiPage: {
          ...current.aiPage,
          targetPanelCount: Math.max(2, Math.min(8, nextGuides.length)),
          guidePanels: nextGuides,
          showGuideOverlay: true,
        },
      }), true);
      notify(t('已套用自定义模板「{0}」为 AI 参考分镜格', [template.label]));
      return;
    }
    const hasImages = draft.panels.some(p => Boolean(p.image?.url));
    if (hasImages) {
      const ok = await confirmAction({
        title: t('套用自定义模板「{0}」？', [template.label]),
        message: t('切换模板将重置当前页面的分镜框与格内图片（可随时撤销 Ctrl+Z）。'),
        confirmLabel: t('确认套用'),
      });
      if (!ok) return;
    }
    applyDraftChange(current => ({
      ...current,
      panels: instantiateCustomTemplatePanels(template),
    }), true);
    setSelection(null);
  }, [applyDraftChange, confirmAction, customTemplates, draft.creationMode, draft.panels, notify]);

  const handleDeleteCustomTemplate = useCallback((templateId: string) => {
    setCustomTemplates(deleteCustomComicTemplate(templateId));
    notify(t('已删除自定义模板'));
  }, [notify]);

  const handleApplyStyleChain = useCallback((chain: PromptChain) => {
    applyDraftChange(current => ({
      ...current,
      styleChainId: chain.id,
      globalBasePrompt: chain.basePrompt || '',
      globalNegativePrompt: chain.negativePrompt || '',
    }), true);
    notify(t('已载入风格串「{0}」', [chain.name]));
  }, [applyDraftChange, notify]);

  // ==================== 仿 Photoshop 独立图层栈操作 ====================
  // 在「图层」标签内点选图层时仅同步画布选中态，停留在当前图层标签方便连续调混合模式/不透明度/排序
  const handleSelectLayer = useCallback((node: ComicLayerNode) => {
    if (node.kind === 'panels') {
      setSelection(draft.panels[0] ? { kind: 'panel', id: draft.panels[0].id } : null);
    } else if (node.kind === 'drawing' && node.refId) {
      setSelection({ kind: 'drawing', id: node.refId });
    } else if (node.kind === 'bubble' && node.refId) {
      setSelection({ kind: 'bubble', id: node.refId });
    } else if (node.kind === 'text' && node.refId) {
      setSelection({ kind: 'text', id: node.refId });
    } else if (node.kind === 'sticker' && node.refId) {
      setSelection({ kind: 'sticker', id: node.refId });
    } else if (node.kind === 'image' && node.refId) {
      setSelection({ kind: 'image', id: node.refId });
    } else if (node.kind === 'group') {
      setSelection({ kind: 'group', id: node.id });
    }
  }, [draft.panels]);

  const handleUpdateLayerNode = useCallback((layerId: string, updater: (node: ComicLayerNode) => ComicLayerNode, commit = true) => {
    applyDraftChange(current => {
      const synced = syncComicLayerStack(current);
      return {
        ...synced,
        layerStack: (synced.layerStack || []).map(node => (node.id === layerId ? updater(node) : node)),
      };
    }, commit);
  }, [applyDraftChange]);

  const handleReorderLayer = useCallback((sourceId: string, targetId: string, position: 'above' | 'below' | 'inside') => {
    applyDraftChange(current => {
      const synced = syncComicLayerStack(current);
      const nextStack = reorderLayerStack(synced.layerStack || [], sourceId, targetId, position);
      return { ...synced, layerStack: nextStack };
    }, true);
  }, [applyDraftChange]);

  const handleCreateDrawingLayer = useCallback(() => {
    const res = createDrawingLayerInDraft(draft);
    applyDraftChange(() => res.draft, true);
    setSelection({ kind: 'drawing', id: res.drawingId });
    notify(t('已新建手绘图层'));
  }, [applyDraftChange, draft, notify]);

  const handleImportImageLayer = useCallback(async (file: File) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(t('读取图片文件失败')));
        reader.readAsDataURL(file);
      });
      if (!dataUrl) return;
      let width = 0.55;
      let height = 0.55;
      try {
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
          img.onerror = () => reject(new Error('load failed'));
          img.src = dataUrl;
        });
        const imgAspect = dims.w / Math.max(1, dims.h);
        const pageAspect = draft.width / Math.max(1, draft.height);
        const normAspect = imgAspect / pageAspect;
        if (normAspect >= 1) {
          width = 0.65;
          height = Math.min(0.85, Math.max(0.12, Number((width / normAspect).toFixed(3))));
        } else {
          height = 0.65;
          width = Math.min(0.85, Math.max(0.12, Number((height * normAspect).toFixed(3))));
        }
      } catch {
        // 测试或无图像解码环境回退默认方框尺寸
      }
      const cleanName = file.name.replace(/\.[^.]+$/, '') || t('导入图片');
      const res = createImageLayerInDraft(draft, {
        name: cleanName,
        url: dataUrl,
        width,
        height,
      });
      applyDraftChange(() => res.draft, true);
      setSelection({ kind: 'image', id: res.imageItem.id });
      notify(t('已导入图片图层「{0}」', [cleanName]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导入图片图层失败'), 'error');
    }
  }, [applyDraftChange, draft, notify]);

  const handleCreateGroupLayer = useCallback((wrapLayerId?: string) => {
    const res = createGroupLayerInDraft(draft, wrapLayerId);
    applyDraftChange(() => res.draft, true);
    setSelection({ kind: 'group', id: res.group.id });
    notify(t('已新建图层组'));
  }, [applyDraftChange, draft, notify]);

  const handleDuplicateLayer = useCallback((layerId: string) => {
    const res = duplicateLayerInDraft(draft, layerId);
    if (!res.newLayer) return;
    applyDraftChange(() => res.draft, true);
    handleSelectLayer(res.newLayer);
    notify(t('已复制图层'));
  }, [applyDraftChange, draft, handleSelectLayer, notify]);

  const handleMergeLayerDown = useCallback((layerId: string) => {
    const res = mergeLayerDownInDraft(draft, layerId);
    if (res.merged) {
      applyDraftChange(() => res.draft, true);
      notify(t('已向下合并图层'));
    } else {
      notify(t('当前图层无法与下方图层合并（支持相邻手绘图层合并或解散图层组）'), 'error');
    }
  }, [applyDraftChange, draft, notify]);

  const handleDeleteLayer = useCallback((layerId: string) => {
    const res = deleteLayerInDraft(draft, layerId);
    if (res.deleted) {
      applyDraftChange(() => res.draft, true);
      setSelection(null);
      notify(t('已删除图层'));
    } else {
      notify(t('分镜底图与最后一个手绘图层不可删除'), 'error');
    }
  }, [applyDraftChange, draft, notify]);

  const handleDuplicateBubble = useCallback((bubbleId: string) => {
    const source = draft.bubbles.find(b => b.id === bubbleId);
    if (!source) return;
    const dx = Math.min(0.92 - source.x, 0.03);
    const dy = Math.min(0.92 - source.y, 0.03);
    const clone: ComicBubbleItem = {
      ...structuredClone(source),
      id: createUuid(),
      x: source.x + dx,
      y: source.y + dy,
      tailX: Math.min(0.98, source.tailX + dx),
      tailY: Math.min(0.98, source.tailY + dy),
    };
    applyDraftChange(cur => ({ ...cur, bubbles: [...cur.bubbles, clone] }), true);
    handleSelectWithTab({ kind: 'bubble', id: clone.id });
  }, [applyDraftChange, draft.bubbles, handleSelectWithTab]);

  const handleUpdateImageLayer = useCallback((id: string, updater: (item: ComicImageLayerItem) => ComicImageLayerItem, commit = true) => {
    applyDraftChange(cur => ({
      ...cur,
      imageLayers: (cur.imageLayers || []).map(item => (item.id === id ? updater(item) : item)),
    }), commit);
  }, [applyDraftChange]);

  const handleDeleteImageLayer = useCallback((id: string) => {
    applyDraftChange(cur => ({
      ...cur,
      imageLayers: (cur.imageLayers || []).filter(item => item.id !== id),
    }), true);
    setSelection(null);
  }, [applyDraftChange]);

  const handleClearActiveDrawingLayer = useCallback(() => {
    applyDraftChange(cur => {
      const synced = syncComicLayerStack(cur);
      const targetId = resolveActiveDrawingLayerId(synced, selection);
      return {
        ...synced,
        strokes: [],
        drawingLayers: (synced.drawingLayers || []).map(d => (
          !targetId || d.id === targetId ? { ...d, strokes: [] } : d
        )),
      };
    }, true);
  }, [applyDraftChange, selection]);

  const preferredMangaFontId = useMemo(() => {
    const installed = fontCatalog.fonts.find(f => f.installed);
    if (installed) return installed.id;
    if (fontCatalog.customFonts[0]) return fontCatalog.customFonts[0].id;
    return 'comic-sans';
  }, [fontCatalog]);

  const handleDownloadFont = useCallback(async (id: string) => {
    setDownloadingFontId(id);
    try {
      const next = await downloadBuiltinComicFont(id);
      setFontCatalog(next);
      const found = next.fonts.find(f => f.id === id);
      notify(t('开源字体「{0}」已缓存至本地，现已立即可用', [found?.name || id]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('下载开源字体失败（请确认本地后端已重启且网络可达）'), 'error');
    } finally {
      setDownloadingFontId(null);
    }
  }, [notify]);

  const handleUploadCustomFont = useCallback(async (file: File) => {
    try {
      const { imported, state } = await uploadCustomComicFont(file);
      setFontCatalog(state);
      // 若当前正选中气泡或文字，直接一键应用新导入字体
      if (selection?.kind === 'bubble') {
        applyDraftChange(cur => ({
          ...cur,
          bubbles: cur.bubbles.map(b => b.id === selection.id ? { ...b, fontFamily: imported.id } : b),
        }), true);
      } else if (selection?.kind === 'text') {
        applyDraftChange(cur => ({
          ...cur,
          texts: cur.texts.map(item => item.id === selection.id ? { ...item, fontFamily: imported.id } : item),
        }), true);
      }
      notify(imported.localOnly
        ? t('已在本次会话载入本机字体「{0}」（重启本地后端后可永久缓存）', [imported.name])
        : t('已导入并缓存本机字体「{0}」', [imported.name]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导入本机字体失败'), 'error');
    }
  }, [applyDraftChange, notify, selection]);

  const handleDeleteFont = useCallback(async (id: string) => {
    try {
      const next = await deleteComicFont(id);
      setFontCatalog(next);
      notify(t('已移除缓存字体'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('移除字体失败'), 'error');
    }
  }, [notify]);

  const handleAddBubbleAt = useCallback((pt: ComicPoint) => {
    const shapeMeta = getBubbleShapeMeta(defaultBubbleShape);
    const created: ComicBubbleItem = {
      id: createUuid(),
      shape: defaultBubbleShape,
      x: pt.x,
      y: pt.y,
      width: 0.28,
      height: 0.15,
      hasTail: shapeMeta.supportsTail,
      tailX: Math.min(0.95, pt.x + 0.08),
      tailY: Math.min(0.95, pt.y + 0.12),
      text: '输入台词…',
      writingMode: defaultBubbleWritingMode,
      fontFamily: preferredMangaFontId,
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
  }, [applyDraftChange, defaultBubbleShape, defaultBubbleWritingMode, handleSelectWithTab, preferredMangaFontId]);

  const handleAddTextAt = useCallback((pt: ComicPoint) => {
    const created: ComicTextItem = {
      id: createUuid(),
      x: pt.x,
      y: pt.y,
      text: '砰！',
      writingMode: 'horizontal',
      fontFamily: fontCatalog.fonts.find(f => f.id === 'smiley-sans' && f.installed)?.id || preferredMangaFontId,
      fontSize: 38,
      color: '#111827',
      strokeColor: '#ffffff',
      rotation: 0,
      bold: true,
    };
    applyDraftChange(cur => ({ ...cur, texts: [...cur.texts, created] }), true);
    handleSelectWithTab({ kind: 'text', id: created.id });
    setActiveTool('select');
  }, [applyDraftChange, fontCatalog.fonts, handleSelectWithTab, preferredMangaFontId]);

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
    const opusTier = novelaiSubscription.info?.tier ?? 3;
    const isOpus = opusTier >= 3;
    const exhausted = novelaiSubscription.info?.usage?.isNegative === true;
    const lockCfg = resolveLayoutLockConfig(draft);
    return aiZonePlan.zones.reduce((sum, zone) => {
      const compiled = buildAiPageZoneRequest(draft, zone, aiZonePlan.zones.length);
      if (lockCfg.enabled) {
        return sum + estimateImageEditCost(
          compiled.params,
          'image-to-image',
          lockCfg.strength,
          false,
          opusTier,
          exhausted,
          { width: zone.resolution.width, height: zone.resolution.height },
        );
      }
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

  const handleUpdateAiAnchor = useCallback((anchorId: string, updater: (anchor: ComicAnchor) => ComicAnchor, commit = true) => {
    handleUpdateAiPage(cur => ({
      ...cur,
      anchors: cur.anchors.map(a => a.id === anchorId ? updater(a) : a),
    }), commit);
  }, [handleUpdateAiPage]);

  const handleDeleteAiAnchor = useCallback((anchorId: string) => {
    handleUpdateAiPage(cur => ({
      ...cur,
      anchors: cur.anchors.filter(a => a.id !== anchorId),
    }), true);
    setSelection(cur => (cur?.kind === 'ai-anchor' && cur.id === anchorId ? null : cur));
  }, [handleUpdateAiPage]);

  const handleUpdateGuidePanel = useCallback((
    guideId: string,
    patch: { x: number; y: number; width: number; height: number },
    commit = false,
  ) => {
    handleUpdateAiPage(cur => ({
      ...cur,
      guidePanels: cur.guidePanels.map(gp => {
        if (gp.id !== guideId) return gp;
        // 若引导格已斜切为多边形，移动或缩放时按比例同步映射顶点，保持斜切形态不丢
        if (gp.points && gp.points.length >= 3) {
          const oldW = Math.max(1e-4, gp.width);
          const oldH = Math.max(1e-4, gp.height);
          const nextPoints = gp.points.map(pt => ({
            x: Math.round((patch.x + ((pt.x - gp.x) / oldW) * patch.width) * 1000) / 1000,
            y: Math.round((patch.y + ((pt.y - gp.y) / oldH) * patch.height) * 1000) / 1000,
          }));
          return { ...gp, ...patch, points: nextPoints };
        }
        return { ...gp, ...patch };
      }),
    }), commit);
  }, [handleUpdateAiPage]);

  const handleUpdateBreakoutZone = useCallback((
    zoneId: string,
    patch: { x: number; y: number; width: number; height: number },
    commit = false,
  ) => {
    handleUpdateAiPage(cur => ({
      ...cur,
      breakoutZones: (cur.breakoutZones || []).map(bz => (bz.id === zoneId ? { ...bz, ...patch } : bz)),
    }), commit);
  }, [handleUpdateAiPage]);

  const handleWheelScalePanelImage = useCallback((panelId: string, delta: number) => {
    handleUpdatePanel(panelId, panel => {
      if (!panel.image) return panel;
      const nextScale = Math.max(1, Math.min(2.5, Number(((panel.image.scale || 1) + delta).toFixed(2))));
      return { ...panel, image: { ...panel.image, scale: nextScale } };
    }, false);
  }, [handleUpdatePanel]);

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
        .map(id => {
          const custom = chains.find(c => c.id === id);
          if (custom) {
            return {
              name: custom.name,
              prompt: [custom.basePrompt, custom.variableValues?.subject].filter(Boolean).join(', '),
            };
          }
          const db = parseDanbooruCastId(id);
          if (db) {
            return { name: db.label, prompt: db.prompt };
          }
          return null;
        })
        .filter((item): item is { name: string; prompt: string } => Boolean(item));

      const existingGuidePanels = preserveGuideLayout && draft.aiPage.guidePanels.length > 0
        ? draft.aiPage.guidePanels.map(gp => ({
          label: gp.label,
          x: gp.x,
          y: gp.y,
          width: gp.width,
          height: gp.height,
        }))
        : undefined;

      const planned = await promptAgentService.planComicStoryboard({
        storyPrompt: story,
        targetPanelCount: existingGuidePanels ? existingGuidePanels.length : draft.aiPage.targetPanelCount,
        width: draft.width,
        height: draft.height,
        colorMode: draft.colorMode,
        dialogueMode: draft.dialogueMode,
        castCharacters,
        existingGuidePanels,
        preserveExistingLayout: preserveGuideLayout,
      });

      const nextGuides: ComicAiGuidePanel[] = planned.guidePanels.map((gp, idx) => {
        const prev = existingGuidePanels ? draft.aiPage.guidePanels[idx] : undefined;
        return {
          id: prev?.id || createUuid(),
          label: gp.label,
          summary: gp.summary,
          visualNote: gp.visualNote || '',
          x: gp.x,
          y: gp.y,
          width: gp.width,
          height: gp.height,
          ...(prev?.points ? { points: prev.points } : {}),
          ...(prev?.bleed ? { bleed: true } : {}),
          ...(prev?.inset ? { inset: true } : {}),
          ...(prev?.speedlines ? { speedlines: true } : {}),
          ...(prev?.fillColor ? { fillColor: prev.fillColor } : {}),
        };
      });
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
  }, [applyDraftChange, chains, draft.aiPage.castCharacterIds, draft.aiPage.guidePanels, draft.aiPage.storyPrompt, draft.aiPage.targetPanelCount, draft.colorMode, draft.dialogueMode, draft.height, draft.width, notify, preserveGuideLayout]);

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
        hasTail: getBubbleShapeMeta(shape).supportsTail,
        tailX: Math.min(0.95, anchor.x + 0.06),
        tailY: Math.min(0.95, anchor.y + 0.09),
        text: anchor.bubbleText?.trim() || '输入台词…',
        writingMode: defaultBubbleWritingMode,
        fontFamily: preferredMangaFontId,
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
  }, [applyDraftChange, defaultBubbleShape, defaultBubbleWritingMode, draft.aiPage.anchors, draft.bubbles, handleSelectWithTab, notify, preferredMangaFontId]);

  const handleConvertSingleAnchorBubbleToVector = useCallback((
    target: { kind: 'ai-anchor'; anchorId: string } | { kind: 'panel-anchor'; panelId: string; anchorId: string },
  ) => {
    let x = 0.5;
    let y = 0.5;
    let width = 0.26;
    let height = 0.14;
    let anchor: ComicAnchor | undefined;
    if (target.kind === 'ai-anchor') {
      anchor = draft.aiPage.anchors.find(a => a.id === target.anchorId);
      if (!anchor) return;
      x = anchor.x;
      y = anchor.y;
      width = anchor.bubbleWidth ?? 0.24;
      height = anchor.bubbleHeight ?? 0.14;
    } else {
      const panel = draft.panels.find(p => p.id === target.panelId);
      anchor = panel?.anchors.find(a => a.id === target.anchorId);
      if (!panel || !anchor) return;
      const pb = getPanelBoundingBox(panel.points, 1, 1);
      x = pb.minX + anchor.x * pb.width;
      y = pb.minY + anchor.y * pb.height;
      width = anchor.bubbleWidth ?? Math.min(0.45, Math.max(0.18, pb.width * 0.48));
      height = anchor.bubbleHeight ?? Math.min(0.32, Math.max(0.11, pb.height * 0.34));
    }

    const shape: ComicBubbleShape = anchor.bubbleShape || defaultBubbleShape;
    const created: ComicBubbleItem = {
      id: createUuid(),
      shape,
      x,
      y,
      width,
      height,
      hasTail: getBubbleShapeMeta(shape).supportsTail,
      tailX: anchor.bubbleTailX ?? Math.min(0.95, x + 0.06),
      tailY: anchor.bubbleTailY ?? Math.min(0.95, y + height / 2 + 0.05),
      text: anchor.bubbleText?.trim() || '输入台词…',
      writingMode: anchor.bubbleWritingMode || defaultBubbleWritingMode,
      fontFamily: preferredMangaFontId,
      fontSize: anchor.bubbleFontSize ?? 22,
      textColor: '#111827',
      fillColor: '#ffffff',
      strokeColor: '#111827',
      strokeWidth: 3,
      rotation: 0,
    };

    applyDraftChange(cur => ({
      ...cur,
      bubbles: [...cur.bubbles, created],
      ...(target.kind === 'ai-anchor'
        ? {
          aiPage: {
            ...cur.aiPage,
            anchors: cur.aiPage.anchors.filter(a => a.id !== target.anchorId),
          },
        }
        : {
          panels: cur.panels.map(p => (
            p.id === target.panelId
              ? { ...p, anchors: p.anchors.filter(a => a.id !== target.anchorId) }
              : p
          )),
        }),
    }), true);
    handleSelectWithTab({ kind: 'bubble', id: created.id });
    notify(t('已转为正式矢量漫画气泡，可在图层面板与画布自由编辑'));
  }, [applyDraftChange, defaultBubbleShape, defaultBubbleWritingMode, draft.aiPage.anchors, draft.panels, handleSelectWithTab, notify, preferredMangaFontId]);

  // 抽离双区无缝拼合与归档逻辑（供全页生成、单区重画与手动重拼共用）
  const stitchAndCommitZones = useCallback(async (
    z0: { url: string; historyId?: string; width: number; height: number },
    z1: { url: string; historyId?: string; width: number; height: number },
    nextZoneMap: Partial<Record<'0' | '1', { url: string; historyId?: string; width: number; height: number }>>,
    toastMessage: string,
  ) => {
    setAiGenerationStageText(t('正在无缝拼合双区整页…'));
    const splitAxis = aiZonePlan.effectiveSplit === 'dual-horizontal' ? 'dual-horizontal' : 'dual-vertical';
    const stitchBg = draft.aiPage.gutterStyle === 'black-flashback' ? '#08080a' : draft.backgroundColor;
    const stitchedBlob = await stitchAiZoneImages(
      [z0.url, z1.url],
      splitAxis,
      aiZonePlan.splitRatio,
      draft.width,
      draft.height,
      stitchBg,
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

    const finalImage = {
      url: finalUrl,
      historyId: finalHistoryId,
      width: draft.width,
      height: draft.height,
      zoneHistoryIds: [z0.historyId, z1.historyId].filter((id): id is string => Boolean(id)),
    };
    setComparingOriginalAiImage(false);
    handleUpdateAiPage(cur => ({
      ...cur,
      zoneImages: nextZoneMap,
      generatedPageImage: finalImage,
      originalGeneratedPageImage: finalImage,
      showGuideOverlay: false,
    }), true);
    notify(toastMessage);
  }, [aiZonePlan.effectiveSplit, aiZonePlan.splitRatio, draft, handleUpdateAiPage, notify]);

  const handleRestitchAiZones = useCallback(async () => {
    const z0 = draft.aiPage.zoneImages?.['0'];
    const z1 = draft.aiPage.zoneImages?.['1'];
    if (!z0?.url || !z1?.url) {
      notify(t('请先完成区 1 与区 2 生图后再拼合'), 'error');
      return;
    }
    setGeneratingAiPage(true);
    try {
      await stitchAndCommitZones(z0, z1, { '0': z0, '1': z1 }, t('双区已重新无缝拼合并归档'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('双区拼合失败'), 'error');
    } finally {
      setGeneratingAiPage(false);
      setAiGenerationStageText('');
    }
  }, [draft.aiPage.zoneImages, notify, stitchAndCommitZones]);

  // 核心：AI 整页锚点一图成型（支持整页或单区重画；每区完成后立即保存，绝不丢失已完成分区）
  const handleGenerateAiPage = useCallback(async (onlyZoneIndex?: 0 | 1) => {
    if (generatingPanelId || generatingAiPage || inpaintingAiPage) {
      notify(t('当前已有生图任务正在运行，请等待完成'), 'error');
      return;
    }
    const targetZones = onlyZoneIndex !== undefined
      ? aiZonePlan.zones.filter(z => z.zoneIndex === onlyZoneIndex)
      : aiZonePlan.zones;
    if (!targetZones.length) return;
    if (targetZones.some(z => z.guardLevel === 'hard-exceeded')) {
      notify(t('单区锚点超过 24 槽硬上限，请先切换双区或精简锚点'), 'error');
      return;
    }

    // 双区一致性修复：未锁种子时自动生成本页共享临时 Seed，让上下/左右两区保持统一光照与画风
    const sharedSeed = draft.seed !== undefined
      ? draft.seed
      : (aiZonePlan.zones.length > 1 ? Math.floor(Math.random() * 2_000_000_000) : undefined);
    const lockCfg = resolveLayoutLockConfig(draft);

    const compiledZones = targetZones.map(zone => ({
      zone,
      compiled: buildAiPageZoneRequest(draft, zone, aiZonePlan.zones.length, { sharedSeed }),
    }));
    const hasAnyContent = compiledZones.some(z => z.compiled.prompt.trim() || (z.compiled.params.characters?.length ?? 0) > 0);
    if (!hasAnyContent) {
      notify(t('请先编排锚点或填写全页画风提示词后再生成'), 'error');
      return;
    }

    let submitKey = readActiveApiKey();
    const firstZone = compiledZones[0];
    const firstCompiled = firstZone.compiled;
    const opusBaseCost = lockCfg.enabled
      ? estimateImageEditCost(
        firstCompiled.params,
        'image-to-image',
        lockCfg.strength,
        false,
        3,
        false,
        { width: firstZone.zone.resolution.width, height: firstZone.zone.resolution.height },
      )
      : estimateV45GenerationCost(firstCompiled.params, true, false);
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
      perUseChannel
        ? 0
        : lockCfg.enabled
          ? estimateImageEditCost(
            item.compiled.params,
            'image-to-image',
            lockCfg.strength,
            false,
            opusTier,
            exhausted,
            { width: item.zone.resolution.width, height: item.zone.resolution.height },
          )
          : estimateV45GenerationCost(item.compiled.params, opusTier >= 3, exhausted)
    ));
    const totalCost = zoneCosts.reduce((acc, c) => acc + c, 0);

    if (totalCost > 0) {
      const approved = await confirmAction({
        rememberKey: 'comic.ai-page-paid',
        rememberScope: { cost: totalCost, model: firstCompiled.params.model, zones: compiledZones.length },
        title: t('确认消耗 Anlas 生成 AI 整页'),
        message: compiledZones.length === 2
          ? t('本次自动双区拼合将依次生成 2 张图，合计预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(totalCost, firstCompiled.params.model)])
          : t('本次生成预计消耗 {0}。确认后才会向 NovelAI 提交。', [formatGenerationCostLabel(totalCost, firstCompiled.params.model)]),
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
      const nextZoneMap: Partial<Record<'0' | '1', { url: string; historyId?: string; width: number; height: number }>> = {
        ...(draft.aiPage.zoneImages || {}),
      };
      let completedCount = 0;

      for (let idx = 0; idx < compiledZones.length; idx++) {
        if (aiCancelRequestedRef.current) break;
        const { zone, compiled } = compiledZones[idx];
        const zoneCost = zoneCosts[idx];
        setGeneratingAiZoneIndex(zone.zoneIndex);
        setAiGenerationStageText(aiZonePlan.zones.length === 2
          ? t('区 {0}/2 · {1} 生成中…', [zone.zoneIndex + 1, zone.label])
          : lockCfg.enabled ? t('硬锁分镜整页生成中…') : t('整页生成中…'));

        // 核心升级：硬锁版式模式渲染「纯白/黑底格缝 + 粗边框 + 中性灰确定性轻颗粒」底图走 V5 img2img
        const layoutTemplate = lockCfg.enabled
          ? renderComicZoneLayoutTemplate(draft, zone, { seed: sharedSeed ?? 1337 })
          : null;

        const descriptor = await buildGenerationJobDescriptor({
          operation: layoutTemplate ? 'image-to-image' : 'text-to-image',
          prompt: compiled.prompt,
          negative: compiled.negative,
          params: compiled.params,
          approvedCost: zoneCost,
          stream: generationStreamPreview,
          forceEmptySeed: sharedSeed !== undefined ? false : forceEmptySeed,
          apiKey: submitKey,
          estimatedCost: zoneCost,
          ...(layoutTemplate
            ? {
              edit: {
                image: layoutTemplate.dataUrl,
                strength: lockCfg.strength,
                noise: lockCfg.noise,
              },
            }
            : {}),
          history: {
            basePrompt: draft.globalBasePrompt,
            subjectPrompt: draft.aiPage.storyPrompt || zone.label,
            sourceChainId: draft.styleChainId || 'comic',
            sourceChainName: aiZonePlan.zones.length === 2
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
        if (saved?.params?.seed !== undefined) setLastGeneratedSeed(saved.params.seed);
        if (!result.success || !saved?.imageUrl) {
          if (result.outcome === 'cancelled' || aiCancelRequestedRef.current) {
            if (completedCount > 0 && aiZonePlan.zones.length === 2) {
              notify(t('已取消后续生成，已完成的分区成图已保留'));
            }
            return;
          }
          notify(result.error || t('{0}生成失败', [zone.label]), 'error');
          return;
        }

        const zoneImg = {
          url: saved.imageUrl,
          historyId: saved.id,
          width: saved.params?.width || zone.resolution.width,
          height: saved.params?.height || zone.resolution.height,
        };
        completedCount += 1;
        const zoneKey = String(zone.zoneIndex) as '0' | '1';
        nextZoneMap[zoneKey] = zoneImg;

        // 每区完成立刻落稿保存，中途失败或取消绝不丢失已出好的区
        if (aiZonePlan.zones.length === 2) {
          handleUpdateAiPage(cur => ({
            ...cur,
            zoneImages: { ...(cur.zoneImages || {}), [zoneKey]: zoneImg },
          }), true);
        }
      }

      if (aiCancelRequestedRef.current || completedCount === 0) return;

      if (aiZonePlan.zones.length === 1) {
        const only = nextZoneMap['0'];
        if (!only) return;
        const finalImg = {
          ...only,
          zoneHistoryIds: only.historyId ? [only.historyId] : undefined,
        };
        setComparingOriginalAiImage(false);
        handleUpdateAiPage(cur => ({
          ...cur,
          generatedPageImage: finalImg,
          originalGeneratedPageImage: finalImg,
          showGuideOverlay: false,
        }), true);
        notify(t('AI 整页漫画生成完成，已可叠加气泡嵌字或导出'));
      } else if (nextZoneMap['0']?.url && nextZoneMap['1']?.url) {
        await stitchAndCommitZones(
          nextZoneMap['0'],
          nextZoneMap['1'],
          nextZoneMap,
          onlyZoneIndex !== undefined
            ? t('区 {0} 重画完成并已与另一区无缝重拼', [onlyZoneIndex + 1])
            : t('双区免费生成并无缝拼合完成，整页成品已归档至历史'),
        );
      } else {
        notify(t('已完成区 {0} 生成，可继续点击生成另一区后自动拼合', [(onlyZoneIndex ?? 0) + 1]));
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
    inpaintingAiPage,
    notify,
    novelaiSubscription,
    stitchAndCommitZones,
  ]);

  // 空白气泡识别：先在画布弹出可视化候选框供用户勾选与改词，确认后再嵌字
  const handleAutoDetectWhiteBubbles = useCallback(async () => {
    const imgUrl = draft.aiPage.generatedPageImage?.url;
    if (!imgUrl) {
      notify(t('请先生成 AI 整页图片后再识别空白气泡'), 'error');
      return;
    }
    setDetectingBubbles(true);
    try {
      const detected = await detectWhiteBubblesFromImageUrl(imgUrl, { colorMode: draft.colorMode });
      const candidates = prepareBubbleCandidates(detected, draft.aiPage.anchors, draft.bubbles);
      if (!candidates.length) {
        notify(t('未识别到新的气泡候选区，可用左侧气泡工具手动添加'), 'error');
        return;
      }
      setInpaintDraft(null);
      setBubbleCandidates(candidates);
      notify(t('识别到 {0} 个候选气泡，请在画布或右侧勾选并核对台词后点击确认', [candidates.length]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('识别气泡失败'), 'error');
    } finally {
      setDetectingBubbles(false);
    }
  }, [draft.aiPage.anchors, draft.aiPage.generatedPageImage?.url, draft.bubbles, draft.colorMode, notify]);

  const handleConfirmBubbleCandidates = useCallback(() => {
    if (!bubbleCandidates) return;
    const items = commitBubbleCandidates(bubbleCandidates, {
      writingMode: defaultBubbleWritingMode,
      pageHeight: draft.height,
    }).map(item => ({ ...item, fontFamily: preferredMangaFontId }));
    setBubbleCandidates(null);
    if (!items.length) return;
    applyDraftChange(cur => ({
      ...cur,
      bubbles: [...cur.bubbles, ...items],
    }), true);
    handleSelectWithTab({ kind: 'bubble', id: items[0].id });
    notify(t('已按校对结果嵌字 {0} 处（双击画布文字可随时修改）', [items.length]));
  }, [applyDraftChange, bubbleCandidates, defaultBubbleWritingMode, draft.height, handleSelectWithTab, notify, preferredMangaFontId]);

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
        forceEmptySeed: draft.seed !== undefined ? false : forceEmptySeed,
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
      if (saved?.params?.seed !== undefined) setLastGeneratedSeed(saved.params.seed);
      if (result.success && saved?.imageUrl) {
        setComparingOriginalAiImage(false);
        handleUpdateAiPage(cur => ({
          ...cur,
          originalGeneratedPageImage: cur.originalGeneratedPageImage || cur.generatedPageImage,
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
        notify(t('单格局部重绘完成并已无缝回贴（可随时对比或恢复初始原图）'));
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
        forceEmptySeed: draft.seed !== undefined ? false : forceEmptySeed,
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
      if (saved?.params?.seed !== undefined) setLastGeneratedSeed(saved.params.seed);
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

  // 一键依次生成本页所有（或尚未出图的）手动分镜格
  const handleGenerateAllPanels = useCallback(async () => {
    if (generatingPanelId || generatingAiPage || inpaintingAiPage || batchGeneratingManual) {
      notify(t('当前已有生图任务正在运行，请等待完成'), 'error');
      return;
    }
    if (!draft.panels.length) return;
    const emptyPanels = draft.panels.filter(p => !p.image?.url);
    const targetPanels = emptyPanels.length > 0 ? emptyPanels : draft.panels;
    if (emptyPanels.length === 0) {
      const ok = await confirmAction({
        title: t('重新生成本页全部 {0} 个分镜格？', [draft.panels.length]),
        message: t('当前所有分镜格都已有图片，确认后将依次重新生成全部画格（可随时点击停止，已生成结果会保留）。'),
        confirmLabel: t('全部重画'),
      });
      if (!ok) return;
    }

    const compiledList = targetPanels.map(panel => ({
      panel,
      compiled: buildComicPanelGenerationInput(draft, panel),
    }));
    const exceeded = compiledList.find(item => item.compiled.guard.level === 'hard-exceeded');
    if (exceeded) {
      notify(t('「{0}」锚点超过 24 槽硬上限，请先精简后再批量生成', [exceeded.panel.name]), 'error');
      return;
    }
    const playable = compiledList.filter(item => item.compiled.prompt.trim() || (item.compiled.params.characters?.length ?? 0) > 0);
    if (!playable.length) {
      notify(t('请先填写全页画风或各格画面描述后再生成'), 'error');
      return;
    }

    let submitKey = readActiveApiKey();
    const firstParams = playable[0].compiled.params;
    const opusBaseCost = estimateV45GenerationCost(firstParams, true, false);
    const poolCheck = await prepareGenerationWithPool({
      model: firstParams.model,
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
      : await usageForCostEstimate(novelaiSubscription.info?.usage, () => novelaiSubscription.refresh(), firstParams.model);

    const costs = playable.map(item => (
      perUseChannel ? 0 : estimateV45GenerationCost(item.compiled.params, opusTier >= 3, exhausted)
    ));
    const totalCost = costs.reduce((acc, c) => acc + c, 0);
    if (totalCost > 0) {
      const approved = await confirmAction({
        rememberKey: 'comic.batch-panels-paid',
        rememberScope: { cost: totalCost, model: firstParams.model, count: playable.length },
        title: t('确认消耗 Anlas 批量生成整页分镜'),
        message: t('本次将依次生成 {0} 个分镜格，合计预计消耗 {1}。确认后开始生成。', [
          playable.length,
          formatGenerationCostLabel(totalCost, firstParams.model),
        ]),
        confirmLabel: t('消耗 {0} 点生成', [totalCost]),
        tone: 'danger',
      });
      if (!approved) return;
    }

    aiCancelRequestedRef.current = false;
    setBatchGeneratingManual(true);
    let doneCount = 0;

    try {
      for (let i = 0; i < playable.length; i++) {
        if (aiCancelRequestedRef.current) break;
        const { panel, compiled } = playable[i];
        const cost = costs[i];
        setGeneratingPanelId(panel.id);
        setSelection({ kind: 'panel', id: panel.id });
        setBatchProgressText(t('批量生成 {0}/{1} · {2}', [i + 1, playable.length, panel.name]));

        const descriptor = await buildGenerationJobDescriptor({
          operation: 'text-to-image',
          prompt: compiled.prompt,
          negative: compiled.negative,
          params: compiled.params,
          approvedCost: cost,
          stream: generationStreamPreview,
          forceEmptySeed: draft.seed !== undefined ? false : forceEmptySeed,
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

        const unsubApproval = subscribeGenerationSeries(() => {
          if (session.state === 'awaiting_confirmation' && session.awaiting) {
            const nextCost = session.awaiting.cost;
            void confirmAction({
              title: t('费用变化确认'),
              message: t('上游计费已更新为 {0} Anlas，是否继续生成「{1}」？', [nextCost, panel.name]),
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
        if (saved?.params?.seed !== undefined) setLastGeneratedSeed(saved.params.seed);

        if (result.success && saved?.imageUrl) {
          const bounds = getPanelBoundingBox(panel.points, draft.width, draft.height);
          handleUpdatePanel(panel.id, current => ({
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
          doneCount += 1;
        } else if (result.outcome === 'cancelled' || aiCancelRequestedRef.current) {
          break;
        } else {
          notify(t('「{0}」生成失败：{1}', [panel.name, result.error || '未知错误']), 'error');
        }
      }

      if (doneCount > 0) {
        notify(aiCancelRequestedRef.current
          ? t('已停止批量生成，已完成 {0}/{1} 格', [doneCount, playable.length])
          : t('整页分镜生成完成（共 {0} 格）', [doneCount]));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('批量生成分镜失败'), 'error');
    } finally {
      activeSessionRef.current = null;
      setGeneratingPanelId(null);
      setBatchGeneratingManual(false);
      setBatchProgressText('');
    }
  }, [
    batchGeneratingManual,
    confirmAction,
    draft,
    forceEmptySeed,
    generatingAiPage,
    generatingPanelId,
    generationStreamPreview,
    handleUpdatePanel,
    inpaintingAiPage,
    notify,
    novelaiSubscription,
  ]);

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

  // 第四期：两级漫画书架管理（作品/话 CRUD、多页新增/复制/排页/删除与批量打包导出 ZIP）
  const persistBooks = useCallback((nextBooks: ComicBook[], changedBook?: ComicBook) => {
    setBooks(nextBooks);
    writeLocalBookshelfCache(nextBooks);
    if (changedBook) {
      void comicBookshelfService.saveBook(changedBook).then(res => {
        if (res.syncedToServer) setBookshelfSynced(true);
        if (res.error) notify(res.error, 'error');
      });
    }
  }, [notify]);

  const switchToPage = useCallback((bookId: string, page: ComicPageDraft) => {
    dirtyBeforeServerLoadRef.current = true;
    setActiveBookId(bookId);
    setDraft(page);
    setUndoStack([]);
    setRedoStack([]);
    setInpaintDraft(null);
    setSelection(page.panels[0] ? { kind: 'panel', id: page.panels[0].id } : null);
    writeActiveBookPointer(bookId, page.id);
    fitCanvasToViewport(page.width, page.height);
  }, [fitCanvasToViewport]);

  const handleSelectBook = useCallback((bookId: string) => {
    const target = booksRef.current.find(b => b.id === bookId);
    if (!target || !target.pages[0]) return;
    switchToPage(target.id, target.pages[0]);
  }, [switchToPage]);

  const handleSelectPage = useCallback((bookId: string, pageId: string) => {
    const targetBook = booksRef.current.find(b => b.id === bookId);
    const targetPage = targetBook?.pages.find(p => p.id === pageId);
    if (targetBook && targetPage) switchToPage(targetBook.id, targetPage);
  }, [switchToPage]);

  const handleCreateBook = useCallback((title: string) => {
    const firstPage = createInitialComicDraft();
    firstPage.title = '第 1 页';
    const created = createComicBook(title, [firstPage]);
    const nextBooks = [created, ...booksRef.current];
    persistBooks(nextBooks, created);
    switchToPage(created.id, firstPage);
    notify(t('已新建作品「{0}」', [created.title]));
  }, [notify, persistBooks, switchToPage]);

  const handleRenameBook = useCallback((bookId: string, nextTitle: string) => {
    let updated: ComicBook | undefined;
    const nextBooks = booksRef.current.map(b => {
      if (b.id !== bookId) return b;
      updated = { ...b, title: nextTitle, updatedAt: Date.now() };
      return updated;
    });
    if (updated) persistBooks(nextBooks, updated);
  }, [persistBooks]);

  const handleDeleteBook = useCallback(async (bookId: string) => {
    if (booksRef.current.length <= 1) return;
    const target = booksRef.current.find(b => b.id === bookId);
    if (!target) return;
    const ok = await confirmAction({
      title: t('删除漫画作品「{0}」？', [target.title]),
      message: t('删除后该作品内的 {0} 页排版将被移除（已生成的单格原图和整页成品仍保留在生成历史中，并释放回收站引用保护）。', [target.pages.length]),
      confirmLabel: t('确认删除'),
      tone: 'danger',
    });
    if (!ok) return;
    const nextBooks = booksRef.current.filter(b => b.id !== bookId);
    persistBooks(nextBooks);
    void comicBookshelfService.deleteBook(bookId);
    if (activeBookId === bookId && nextBooks[0]?.pages[0]) {
      switchToPage(nextBooks[0].id, nextBooks[0].pages[0]);
    }
    notify(t('已删除作品「{0}」', [target.title]));
  }, [activeBookId, confirmAction, notify, persistBooks, switchToPage]);

  const handleAddPageToBook = useCallback((bookId: string) => {
    const target = booksRef.current.find(b => b.id === bookId);
    if (!target) return;
    const refPage = target.pages[target.pages.length - 1] || draft;
    const created = createInitialComicDraft();
    created.title = `第 ${target.pages.length + 1} 页`;
    // 继承当前话的画幅、风格串、V5 模型、色彩策略、出场角色 DNA、格缝风格、锁框模式、统一光照与可选锁定 Seed，实现跨页连载不换脸
    created.paperPresetId = refPage.paperPresetId;
    created.width = refPage.width;
    created.height = refPage.height;
    created.creationMode = refPage.creationMode;
    created.colorMode = refPage.colorMode;
    created.dialogueMode = refPage.dialogueMode;
    created.v5Model = refPage.v5Model;
    created.styleChainId = refPage.styleChainId;
    created.globalBasePrompt = refPage.globalBasePrompt;
    created.globalNegativePrompt = refPage.globalNegativePrompt;
    if (refPage.seed !== undefined) created.seed = refPage.seed;
    created.aiPage = {
      ...created.aiPage,
      castCharacterIds: [...(refPage.aiPage.castCharacterIds || [])],
      gutterStyle: refPage.aiPage.gutterStyle || 'white',
      layoutLockMode: refPage.aiPage.layoutLockMode || 'img2img',
      ...(refPage.aiPage.layoutLockStrength !== undefined ? { layoutLockStrength: refPage.aiPage.layoutLockStrength } : {}),
      ...(refPage.aiPage.sceneAtmosphere ? { sceneAtmosphere: refPage.aiPage.sceneAtmosphere } : {}),
    };
    let updated: ComicBook | undefined;
    const nextBooks = booksRef.current.map(b => {
      if (b.id !== bookId) return b;
      updated = { ...b, pages: [...b.pages, created], updatedAt: Date.now() };
      return updated;
    });
    if (updated) persistBooks(nextBooks, updated);
    switchToPage(bookId, created);
    notify(t('已新增「{0}」（自动沿用当前话画风）', [created.title]));
  }, [draft, notify, persistBooks, switchToPage]);

  const handleDuplicatePageInBook = useCallback((bookId: string, pageId: string) => {
    const target = booksRef.current.find(b => b.id === bookId);
    const source = target?.pages.find(p => p.id === pageId);
    if (!target || !source) return;
    const clone: ComicPageDraft = {
      ...structuredClone(source),
      id: createUuid(),
      title: `${source.title || '漫画页'} 副本`,
      updatedAt: Date.now(),
    };
    const idx = target.pages.findIndex(p => p.id === pageId);
    const nextPages = [...target.pages];
    nextPages.splice(idx + 1, 0, clone);
    let updated: ComicBook | undefined;
    const nextBooks = booksRef.current.map(b => {
      if (b.id !== bookId) return b;
      updated = { ...b, pages: nextPages, updatedAt: Date.now() };
      return updated;
    });
    if (updated) persistBooks(nextBooks, updated);
    switchToPage(bookId, clone);
    notify(t('已复制漫画页'));
  }, [notify, persistBooks, switchToPage]);

  const handleDeletePageInBook = useCallback(async (bookId: string, pageId: string) => {
    const target = booksRef.current.find(b => b.id === bookId);
    if (!target || target.pages.length <= 1) return;
    const page = target.pages.find(p => p.id === pageId);
    const ok = await confirmAction({
      title: t('删除「{0}」？', [page?.title || '该漫画页']),
      message: t('删除后该页排版将从本话移除（生成历史原图不受影响）。'),
      confirmLabel: t('删除页'),
      tone: 'danger',
    });
    if (!ok) return;
    const nextPages = target.pages.filter(p => p.id !== pageId);
    let updated: ComicBook | undefined;
    const nextBooks = booksRef.current.map(b => {
      if (b.id !== bookId) return b;
      updated = { ...b, pages: nextPages, updatedAt: Date.now() };
      return updated;
    });
    if (updated) persistBooks(nextBooks, updated);
    if (draft.id === pageId && nextPages[0]) {
      switchToPage(bookId, nextPages[0]);
    }
  }, [confirmAction, draft.id, persistBooks, switchToPage]);

  const handleReorderPageInBook = useCallback((bookId: string, fromIndex: number, toIndex: number) => {
    const target = booksRef.current.find(b => b.id === bookId);
    if (!target) return;
    if (toIndex < 0 || toIndex >= target.pages.length || fromIndex === toIndex) return;
    const nextPages = [...target.pages];
    const [moved] = nextPages.splice(fromIndex, 1);
    nextPages.splice(toIndex, 0, moved);
    let updated: ComicBook | undefined;
    const nextBooks = booksRef.current.map(b => {
      if (b.id !== bookId) return b;
      updated = { ...b, pages: nextPages, updatedAt: Date.now() };
      return updated;
    });
    if (updated) persistBooks(nextBooks, updated);
  }, [persistBooks]);

  const handleExportBookZip = useCallback(async (book: ComicBook) => {
    setExportingZip(true);
    setZipProgressText(t('准备打包…'));
    try {
      // 确保导出包含当前正在编辑的实时草稿
      const latestBook: ComicBook = book.id === activeBookId
        ? { ...book, pages: book.pages.map(p => (p.id === draft.id ? draft : p)) }
        : book;
      const receipt = await exportComicBookAsZip(latestBook, (cur, total) => {
        setZipProgressText(t('导出 {0}/{1} 页…', [cur, total]));
      });
      notify(t('已打包导出整话 {0}（共 {1} 页）', [receipt.filename, receipt.pageCount]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('整话打包导出失败'), 'error');
    } finally {
      setExportingZip(false);
      setZipProgressText('');
    }
  }, [activeBookId, draft, notify]);

  const handleExportBookProject = useCallback((book: ComicBook) => {
    const latestBook: ComicBook = book.id === activeBookId
      ? { ...book, pages: book.pages.map(p => (p.id === draft.id ? draft : p)) }
      : book;
    const filename = exportComicBookProjectJson(latestBook);
    notify(t('已导出可编辑工程包 {0}', [filename]));
  }, [activeBookId, draft, notify]);

  const handleImportBookProject = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rawBook = (parsed && typeof parsed === 'object' && parsed.book && typeof parsed.book === 'object')
        ? parsed.book as Record<string, unknown>
        : parsed;
      const rawPages = Array.isArray(rawBook?.pages)
        ? rawBook.pages
        : (rawBook && rawBook.version === 1 ? [rawBook] : []);
      if (!rawPages.length) {
        notify(t('无法识别工程文件：缺少有效的漫画页数据'), 'error');
        return;
      }
      const normalizedPages = rawPages.map((rawPage, idx) => {
        const page = normalizeComicDraft(rawPage);
        return {
          ...page,
          id: createUuid(),
          title: page.title || `第 ${idx + 1} 页`,
          updatedAt: Date.now(),
        };
      });
      const baseTitle = typeof rawBook?.title === 'string' && rawBook.title.trim()
        ? rawBook.title.trim()
        : file.name.replace(/\.comic\.json$/i, '').replace(/\.json$/i, '') || t('导入作品');
      const imported = createComicBook(baseTitle, normalizedPages, {
        description: typeof rawBook?.description === 'string' ? rawBook.description : '',
      });
      const nextBooks = [imported, ...booksRef.current];
      persistBooks(nextBooks, imported);
      switchToPage(imported.id, imported.pages[0]);
      setBookshelfOpen(false);
      notify(t('已导入工程「{0}」（共 {1} 页）', [imported.title, imported.pages.length]));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导入工程文件失败，请确认文件格式正确'), 'error');
    }
  }, [notify, persistBooks, switchToPage]);

  const activeBook = books.find(b => b.id === activeBookId) || books[0];
  const activePageIndex = Math.max(0, activeBook?.pages.findIndex(p => p.id === draft.id) ?? 0);

  const handleChangeCreationMode = useCallback((creationMode: ComicPageDraft['creationMode']) => {
    applyDraftChange(cur => ({ ...cur, creationMode }), true);
    setInspectorTab('panel');
    setInpaintDraft(null);
    setSelection(creationMode === 'manual' && draft.panels[0] ? { kind: 'panel', id: draft.panels[0].id } : null);
  }, [applyDraftChange, draft.panels]);

  const activeSession = activeSessionRef.current;

  return (
    <div data-agent-view="comic" className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <ComicToolbar
        draft={draft}
        bookTitle={activeBook?.title}
        pageIndex={activePageIndex}
        pageTotal={activeBook?.pages.length || 1}
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
        pageStripOpen={pageStripOpen}
        inspectorOpen={inspectorOpen}
        onTogglePageStrip={() => setPageStripOpen(open => !open)}
        onOpenBookshelf={() => setBookshelfOpen(true)}
        onChangeTitle={title => applyDraftChange(cur => ({ ...cur, title }), false)}
        onSelectPaperPreset={handleSelectPaperPreset}
        onSetCustomPaperSize={handleSetCustomPaperSize}
        onApplyTemplate={tplId => void handleApplyTemplate(tplId)}
        customTemplates={customTemplates}
        onSaveCustomTemplate={handleSaveCustomTemplate}
        onApplyCustomTemplate={tplId => void handleApplyCustomTemplate(tplId)}
        onDeleteCustomTemplate={handleDeleteCustomTemplate}
        onUpdatePageSettings={patch => applyDraftChange(cur => ({ ...cur, ...patch }), true)}
        onChangeBrush={patch => {
          if (patch.color !== undefined) setBrushColor(patch.color);
          if (patch.size !== undefined) setBrushSize(patch.size);
          if (patch.opacity !== undefined) setBrushOpacity(patch.opacity);
        }}
        onClearStrokes={handleClearActiveDrawingLayer}
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

      {/* 轻量化三栏布局：[左侧作品组漫画缩略图条] | [宽敞画布 + 底部悬浮轻工具条] | [右侧三步顺序操作栏] */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {pageStripOpen && (
          <ComicPageStrip
            book={activeBook}
            activePageId={draft.id}
            notify={notify}
            onSelectPage={handleSelectPage}
            onAddPage={handleAddPageToBook}
            onDuplicatePage={handleDuplicatePageInBook}
            onDeletePage={(bookId, pageId) => void handleDeletePageInBook(bookId, pageId)}
            onOpenBookshelf={() => setBookshelfOpen(true)}
            onCollapse={() => setPageStripOpen(false)}
          />
        )}

        <div ref={canvasWrapRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <ComicCanvas
            draft={draft}
            aiZonePlan={aiZonePlan}
            inpaintDraft={inpaintDraft}
            bubbleCandidates={bubbleCandidates}
            comparingOriginalAiImage={comparingOriginalAiImage}
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
            onUpdateAiAnchor={handleUpdateAiAnchor}
            onDeleteAiAnchor={handleDeleteAiAnchor}
            onConvertAnchorBubbleToVector={handleConvertSingleAnchorBubbleToVector}
            onUpdateGuidePanel={handleUpdateGuidePanel}
            onUpdateBreakoutZone={handleUpdateBreakoutZone}
            onToggleBubbleCandidate={id => setBubbleCandidates(cur => cur ? cur.map(c => c.id === id ? { ...c, selected: !c.selected } : c) : cur)}
            onWheelScalePanelImage={handleWheelScalePanelImage}
            onChangeInpaintRect={rect => setInpaintDraft(cur => cur ? { ...cur, rect } : cur)}
            onMoveInpaintAnchor={(anchorId, x, y) => setInpaintDraft(cur => cur ? {
              ...cur,
              anchors: cur.anchors.map(a => a.id === anchorId ? { ...a, x, y } : a),
            } : cur)}
            onAddPanel={handleAddPanel}
            onSliceAtLine={handleSliceAtLine}
            onCommitStroke={(stroke: ComicStroke, drawingLayerId?: string) => applyDraftChange(
              cur => appendStrokeToDrawingLayer(
                cur,
                drawingLayerId || resolveActiveDrawingLayerId(cur, selection) || 'draw-1',
                stroke,
              ),
              true,
            )}
            onAddBubbleAt={handleAddBubbleAt}
            onAddTextAt={handleAddTextAt}
            onAddStickerAt={handleAddStickerAt}
            onUpdateBubble={(id, updater, commit = true) => applyDraftChange(cur => ({
              ...cur,
              bubbles: cur.bubbles.map(b => b.id === id ? updater(b) : b),
            }), commit)}
            onDuplicateBubble={handleDuplicateBubble}
            onDeleteBubble={id => {
              applyDraftChange(cur => ({ ...cur, bubbles: cur.bubbles.filter(b => b.id !== id) }), true);
              setSelection(null);
            }}
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
            onUpdateImageLayer={handleUpdateImageLayer}
          />

          {/* 底部悬浮轻工具胶囊（仅常驻 5 个高频工具，低频工具与图层叠加收入「···」菜单；中屏靠左避让右下角缩放条，宽屏居中） */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex xl:inset-x-0 xl:left-auto xl:justify-center xl:px-3">
            <ComicToolRail
              activeTool={activeTool}
              foregroundColor={brushColor}
              layerCount={draft.layerStack?.length ?? 2}
              layersDrawerOpen={layersDrawerOpen}
              onSelectTool={setActiveTool}
              onChangeForegroundColor={setBrushColor}
              onToggleLayersDrawer={() => setLayersDrawerOpen(open => !open)}
            />
          </div>

          {/* 低频「图层与叠加图片」按需浮层：不再占用右侧主标签 */}
          {layersDrawerOpen && (
            <div className="appearance-panel absolute top-3 right-3 bottom-16 z-30 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200/90 bg-white/95 shadow-2xl backdrop-blur-md dark:border-gray-700/90 dark:bg-gray-900/95">
              <div className="flex flex-none items-center justify-between border-b border-gray-200/80 px-3 py-2 dark:border-gray-800/80">
                <span className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('图层与叠加图片')}</span>
                <button
                  type="button"
                  aria-label={t('关闭图层浮层')}
                  onClick={() => setLayersDrawerOpen(false)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ComicLayersPanel
                  draft={draft}
                  selection={selection}
                  collapsed={false}
                  dockMode="tab"
                  onToggleCollapsed={() => setLayersDrawerOpen(false)}
                  onSelectLayer={handleSelectLayer}
                  onUpdateLayerNode={handleUpdateLayerNode}
                  onReorderLayer={handleReorderLayer}
                  onCreateDrawingLayer={handleCreateDrawingLayer}
                  onImportImageLayer={file => void handleImportImageLayer(file)}
                  onCreateGroupLayer={handleCreateGroupLayer}
                  onDuplicateLayer={handleDuplicateLayer}
                  onMergeLayerDown={handleMergeLayerDown}
                  onDeleteLayer={handleDeleteLayer}
                />
              </div>
            </div>
          )}
        </div>

        {!inspectorOpen && (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="fixed right-3 bottom-16 z-30 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg transition hover:bg-indigo-500 md:hidden"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            <span>{t('编辑与生图')}</span>
          </button>
        )}

        {inspectorOpen && (
          <>
            <div
              aria-hidden="true"
              onClick={() => setInspectorOpen(false)}
              className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[1px] md:hidden"
            />
            <div className="fixed inset-x-0 bottom-0 z-40 flex h-[74dvh] flex-col overflow-hidden rounded-t-2xl border-t border-gray-200 shadow-2xl dark:border-gray-800 md:static md:z-auto md:h-full md:w-[356px] md:flex-none md:rounded-none md:border-t-0 md:shadow-none lg:w-[388px] xl:w-[404px]">
              <div className="appearance-panel flex flex-none items-center justify-between border-b border-gray-200/80 px-3.5 py-2 md:hidden dark:border-gray-800/80">
                <span className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('漫画属性与生图')}</span>
                <button
                  type="button"
                  aria-label={t('收起属性面板')}
                  onClick={() => setInspectorOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <ComicInspector
                  draft={draft}
                  aiZonePlan={aiZonePlan}
                  inpaintDraft={inpaintDraft}
                  bubbleCandidates={bubbleCandidates}
                  preserveGuideLayout={preserveGuideLayout}
                  comparingOriginalAiImage={comparingOriginalAiImage}
                  activeTab={inspectorTab}
                  selection={selection}
                  chains={chains}
                  generatingPanelId={generatingPanelId}
                  batchGeneratingManual={batchGeneratingManual}
                  batchProgressText={batchProgressText}
                  lastGeneratedSeed={lastGeneratedSeed}
                  planningAiStoryboard={planningAiStoryboard}
                  generatingAiPage={generatingAiPage}
                  detectingBubbles={detectingBubbles}
                  inpaintingAiPage={inpaintingAiPage}
                  aiGenerationStageText={aiGenerationStageText}
                  generationStageText={describeStage(activeSession)}
                  estimatedCost={estimatedCost}
                  aiEstimatedCost={aiEstimatedCost}
                  notify={notify}
                  onSelectTab={setInspectorTab}
                  onChangeMode={handleChangeCreationMode}
                  onSelect={handleSelectWithTab}
                  onQuickAddPanel={() => handleAddPanel(rectToPolygon(0.18, 0.22, 0.64, 0.32))}
                  onUpdateDraft={applyDraftChange}
                  onUpdateAiPage={handleUpdateAiPage}
                  onTogglePreserveGuideLayout={setPreserveGuideLayout}
                  onPlanAiStoryboard={() => void handlePlanAiStoryboard()}
                  onInitAiFromTemplate={handleInitAiFromTemplate}
                  onConvertBubbleAnchorsToVector={handleConvertBubbleAnchorsToVector}
                  onAutoDetectWhiteBubbles={() => void handleAutoDetectWhiteBubbles()}
                  onToggleBubbleCandidate={id => setBubbleCandidates(cur => cur ? cur.map(c => c.id === id ? { ...c, selected: !c.selected } : c) : cur)}
                  onEditBubbleCandidateText={(id, text) => setBubbleCandidates(cur => cur ? cur.map(c => c.id === id ? { ...c, text } : c) : cur)}
                  onBulkSelectBubbleCandidates={mode => setBubbleCandidates(cur => cur ? cur.map(c => ({
                    ...c,
                    selected: mode === 'all' ? true : mode === 'none' ? false : Boolean(c.text.trim()),
                  })) : cur)}
                  onConfirmBubbleCandidates={handleConfirmBubbleCandidates}
                  onCancelBubbleCandidates={() => setBubbleCandidates(null)}
                  onToggleCompareOriginalAiImage={() => setComparingOriginalAiImage(v => !v)}
                  onRestoreOriginalAiImage={() => {
                    if (!draft.aiPage.originalGeneratedPageImage) return;
                    setComparingOriginalAiImage(false);
                    handleUpdateAiPage(cur => ({
                      ...cur,
                      generatedPageImage: cur.originalGeneratedPageImage,
                    }), true);
                    notify(t('已恢复为局部重绘前的初始 AI 整页原图'));
                  }}
                  onOpenInpaint={handleOpenInpaint}
                  onCloseInpaint={() => setInpaintDraft(null)}
                  onUpdateInpaintDraft={updater => setInpaintDraft(cur => cur ? updater(cur) : cur)}
                  onRunInpaint={() => void handleRunInpaint()}
                  onGenerateAiPage={() => void handleGenerateAiPage()}
                  onGenerateAiZone={z => void handleGenerateAiPage(z)}
                  onRestitchAiZones={() => void handleRestitchAiZones()}
                  onApplyStyleChain={handleApplyStyleChain}
                  onUpdatePanel={handleUpdatePanel}
                  onDuplicatePanel={handleDuplicatePanel}
                  onDeletePanel={handleDeletePanel}
                  onBringPanelOrder={handleBringPanelOrder}
                  onGeneratePanel={id => void handleGeneratePanel(id)}
                  onGenerateAllPanels={() => void handleGenerateAllPanels()}
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
                  onUpdateImageLayer={handleUpdateImageLayer}
                  onDeleteImageLayer={handleDeleteImageLayer}
                  onConvertSingleAnchorBubbleToVector={handleConvertSingleAnchorBubbleToVector}
                  fontCatalog={fontCatalog}
                  downloadingFontId={downloadingFontId}
                  onDownloadFont={id => void handleDownloadFont(id)}
                  onUploadCustomFont={file => void handleUploadCustomFont(file)}
                  onDeleteFont={id => void handleDeleteFont(id)}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <ComicBookshelfModal
        open={bookshelfOpen}
        books={books}
        activeBookId={activeBookId}
        activePageId={draft.id}
        syncedToServer={bookshelfSynced}
        exportingZip={exportingZip}
        zipProgressText={zipProgressText}
        onClose={() => setBookshelfOpen(false)}
        onSelectBook={handleSelectBook}
        onSelectPage={handleSelectPage}
        onCreateBook={handleCreateBook}
        onRenameBook={handleRenameBook}
        onDeleteBook={id => void handleDeleteBook(id)}
        onAddPage={handleAddPageToBook}
        onDuplicatePage={handleDuplicatePageInBook}
        onDeletePage={(bookId, pageId) => void handleDeletePageInBook(bookId, pageId)}
        onReorderPage={handleReorderPageInBook}
        onExportBookZip={book => void handleExportBookZip(book)}
        onExportBookProject={handleExportBookProject}
        onImportBookProject={file => void handleImportBookProject(file)}
      />
    </div>
  );
};
