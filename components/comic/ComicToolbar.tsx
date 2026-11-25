import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  BookmarkPlus,
  ChevronDown,
  Download,
  Grid,
  LayoutGrid,
  LayoutTemplate,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { COMIC_BUBBLE_SHAPES } from '../../services/comic/comicArtwork';
import {
  COMIC_LAYOUT_TEMPLATES,
  COMIC_LAYOUT_TEMPLATE_CATEGORIES,
  COMIC_PAPER_PRESETS,
  type ComicLayoutTemplateCategory,
  type ComicTemplateScope,
} from '../../services/comic/comicGeometry';
import type { ComicCustomAsset } from '../../services/comic/comicAssets';
import type { ComicCustomTemplate } from '../../services/comic/comicCustomTemplates';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';
import {
  ComicTemplatePreview,
  getBuiltinTemplatePreviewPanels,
  toPreviewPanelsFromCustom,
} from './ComicTemplatePreview';
import type {
  ComicBubbleShape,
  ComicPageDraft,
  ComicPanel,
  ComicStickerKind,
  ComicTool,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import { IconButton, InlineSpinner, ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { AnchoredToolbarPopover } from '../ToolbarPopover';

interface ComicToolbarProps {
  draft: ComicPageDraft;
  bookTitle?: string;
  pageIndex?: number;
  pageTotal?: number;
  activeTool: ComicTool;
  drawPanelAsOverlay?: boolean;
  activePanel?: ComicPanel;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  defaultStickerKind: ComicStickerKind;
  defaultBubbleShape: ComicBubbleShape;
  defaultCustomBubbleAssetId?: string | null;
  customBubbleAssets?: ComicCustomAsset[];
  defaultBubbleWritingMode: 'horizontal' | 'vertical';
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  pageStripOpen?: boolean;
  inspectorOpen: boolean;
  onTogglePageStrip?: () => void;
  onOpenBookshelf?: () => void;
  onChangeTitle: (title: string) => void;
  onSelectPaperPreset: (presetId: string) => void;
  onSetCustomPaperSize: (width: number, height: number) => void;
  onApplyTemplate: (templateId: string, scope?: ComicTemplateScope) => void;
  customTemplates: ComicCustomTemplate[];
  onSaveCustomTemplate: (label: string) => void;
  onApplyCustomTemplate: (templateId: string, scope?: ComicTemplateScope) => void;
  onDeleteCustomTemplate: (templateId: string) => void;
  onChangeDrawPanelAsOverlay?: (overlay: boolean) => void;
  onUpdatePageSettings: (patch: Partial<Pick<ComicPageDraft, 'v5Model' | 'steps' | 'colorMode' | 'dialogueMode' | 'gutterPx'>>) => void;
  onChangeBrush: (patch: { color?: string; size?: number; opacity?: number }) => void;
  onClearStrokes: () => void;
  onChangeDefaultStickerKind: (kind: ComicStickerKind) => void;
  onChangeDefaultBubbleStyle: (patch: { shape?: ComicBubbleShape; customAssetId?: string | null; writingMode?: 'horizontal' | 'vertical' }) => void;
  onUpdateActivePanelImage?: (patch: { scale?: number; reset?: boolean }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleInspector: () => void;
  onExport: () => void;
  onBack?: () => void;
}

const shortModelLabel = (model: ComicV5ModelId): string => {
  if (model === 'nai-diffusion-5-full-medium') return 'V5 Medium';
  if (model === 'nai-diffusion-5-curated') return 'V5 Curated';
  return 'V5 High';
};

const STICKER_KINDS: Array<{ id: ComicStickerKind; label: string }> = [
  { id: 'speedlines', label: '集中线' },
  { id: 'sweat', label: '汗滴' },
  { id: 'anger', label: '怒筋' },
  { id: 'sparkle', label: '星芒' },
  { id: 'exclamation', label: '!' },
  { id: 'question', label: '?' },
  { id: 'shock', label: '震惊线' },
  { id: 'heart', label: '爱心' },
];

export const ComicToolbar: React.FC<ComicToolbarProps> = ({
  draft,
  bookTitle,
  pageIndex = 0,
  pageTotal = 1,
  activeTool,
  drawPanelAsOverlay = false,
  activePanel,
  brushColor,
  brushSize,
  brushOpacity,
  defaultStickerKind,
  defaultBubbleShape,
  defaultCustomBubbleAssetId = null,
  customBubbleAssets = [],
  defaultBubbleWritingMode,
  canUndo,
  canRedo,
  exporting,
  pageStripOpen = true,
  inspectorOpen,
  onTogglePageStrip,
  onOpenBookshelf,
  onChangeTitle,
  onSelectPaperPreset,
  onSetCustomPaperSize,
  onApplyTemplate,
  customTemplates,
  onSaveCustomTemplate,
  onApplyCustomTemplate,
  onDeleteCustomTemplate,
  onChangeDrawPanelAsOverlay,
  onUpdatePageSettings,
  onChangeBrush,
  onClearStrokes,
  onChangeDefaultStickerKind,
  onChangeDefaultBubbleStyle,
  onUpdateActivePanelImage,
  onUndo,
  onRedo,
  onToggleInspector,
  onExport,
  onBack,
}) => {
  useLanguage();
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [bubbleShapeMenuOpen, setBubbleShapeMenuOpen] = useState(false);
  const [customW, setCustomW] = useState(String(draft.width));
  const [customH, setCustomH] = useState(String(draft.height));
  const [newTemplateName, setNewTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState<'all' | ComicLayoutTemplateCategory>('all');
  const [templateScope, setTemplateScope] = useState<ComicTemplateScope>('full');
  const [wideTemplatesOpen, setWideTemplatesOpen] = useState(false);
  const pageMenuBtnRef = useRef<HTMLButtonElement>(null);
  const isSpreadPaper = draft.paperPresetId === 'manga-spread';

  useEffect(() => {
    if (!isSpreadPaper) setTemplateScope('full');
  }, [isSpreadPaper]);

  useEffect(() => {
    if (!wideTemplatesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWideTemplatesOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wideTemplatesOpen]);

  useEffect(() => {
    if (activeTool !== 'bubble') setBubbleShapeMenuOpen(false);
  }, [activeTool]);

  useEffect(() => {
    setCustomW(String(draft.width));
    setCustomH(String(draft.height));
  }, [draft.width, draft.height]);

  const applyCustomSize = () => {
    const w = Math.max(256, Math.min(4096, Math.round(Number(customW) || draft.width)));
    const h = Math.max(256, Math.min(4096, Math.round(Number(customH) || draft.height)));
    onSetCustomPaperSize(w, h);
    setPageMenuOpen(false);
  };

  return (
    <header className="appearance-panel relative z-30 flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-gray-200/80 bg-white/90 px-3 py-1.5 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/90">
      {/* 左区：作品条开关 + 书架 + 页面标题 + 规格/模板入口 */}
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <IconButton
            label={t('返回实验室')}
            onClick={onBack}
            className="flex-none md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        )}
        {onTogglePageStrip && !pageStripOpen && (
          <IconButton
            label={t('展开漫画页条')}
            onClick={onTogglePageStrip}
            className="hidden flex-none md:inline-flex"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        )}
        {onOpenBookshelf && (
          <button
            type="button"
            aria-label={t('打开漫画书架')}
            title={t('管理作品/话、页序、连续阅读与批量打包导出')}
            onClick={onOpenBookshelf}
            className="inline-flex h-8 max-w-36 flex-none items-center gap-1.5 rounded-lg border border-gray-200/90 bg-gray-50/90 px-2 text-xs font-semibold text-gray-700 transition hover:border-indigo-400 hover:bg-white hover:text-indigo-600 dark:border-gray-700/80 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-indigo-500"
          >
            <BookOpen className="h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
            <span className="truncate">{bookTitle || t('速写单页集')}</span>
            <span className="flex-none font-mono text-[10px] text-gray-400">{pageIndex + 1}/{Math.max(1, pageTotal)}</span>
          </button>
        )}
        <input
          type="text"
          aria-label={t('漫画页标题')}
          value={draft.title}
          onChange={event => onChangeTitle(event.target.value)}
          placeholder={t('未命名漫画页')}
          className="h-8 w-28 min-w-0 rounded-lg border border-transparent bg-transparent px-1.5 text-sm font-bold text-gray-800 outline-none transition hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800 sm:w-36"
        />

        <button
          ref={pageMenuBtnRef}
          type="button"
          aria-label={t('画幅与模板')}
          aria-haspopup="dialog"
          aria-expanded={pageMenuOpen}
          onClick={() => setPageMenuOpen(open => !open)}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg border border-gray-200/90 bg-gray-50/90 px-2.5 text-xs font-medium text-gray-700 transition hover:border-indigo-400 hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-indigo-500 dark:hover:bg-gray-800"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
          <span className="font-semibold">{shortModelLabel(draft.v5Model)}</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span>{draft.colorMode === 'monochrome' ? t('黑白') : t('全彩')}</span>
          <span className="hidden text-gray-300 dark:text-gray-600 sm:inline">·</span>
          <span className="hidden font-mono text-[11px] text-gray-500 dark:text-gray-400 sm:inline">{draft.width}×{draft.height}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
        </button>
      </div>

      {/* 中区：仅在启用具体画布工具（画笔/气泡/贴纸/切格/移图等）时按需展示对应选项，默认态留白清爽 */}
      {activeTool !== 'select' && (
      <div className="hidden min-w-0 flex-1 items-center gap-2 border-l border-gray-200/90 pl-3 text-xs dark:border-gray-800 lg:flex">
        {(activeTool === 'brush' || activeTool === 'eraser') && (
          <>
            <span className="font-semibold text-gray-600 dark:text-gray-300">
              {activeTool === 'brush' ? t('画笔') : t('橡皮')}
            </span>
            <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <span>{t('粗细')}</span>
              <input
                type="range"
                min={2}
                max={64}
                value={brushSize}
                onChange={e => onChangeBrush({ size: Number(e.target.value) })}
                className="w-20 accent-indigo-600"
              />
              <span className="w-8 font-mono text-[11px]">{brushSize}px</span>
            </label>
            {activeTool === 'brush' && (
              <>
                <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                  <span>{t('透明度')}</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(brushOpacity * 100)}
                    onChange={e => onChangeBrush({ opacity: Number(e.target.value) / 100 })}
                    className="w-16 accent-indigo-600"
                  />
                  <span className="w-8 font-mono text-[11px]">{Math.round(brushOpacity * 100)}%</span>
                </label>
                <div className="flex items-center gap-1">
                  {['#111827', '#ffffff', '#ef4444', '#2563eb', '#f59e0b', '#10b981'].map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => onChangeBrush({ color })}
                      style={{ backgroundColor: color }}
                      className={`h-4 w-4 rounded-full border ${brushColor === color ? 'border-indigo-500 ring-2 ring-indigo-300' : 'border-gray-300 dark:border-gray-600'}`}
                    />
                  ))}
                </div>
              </>
            )}
            {draft.strokes.length > 0 && (
              <button
                type="button"
                onClick={onClearStrokes}
                className="ml-1 inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-0.5 text-[11px] font-medium text-red-500 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3 w-3" /> {t('清手绘层')}
              </button>
            )}
          </>
        )}

        {activeTool === 'bubble' && (() => {
          const currentCustomBubble = defaultCustomBubbleAssetId
            ? customBubbleAssets.find(a => a.id === defaultCustomBubbleAssetId)
            : undefined;
          const currentShape = COMIC_BUBBLE_SHAPES.find(s => s.id === defaultBubbleShape) || COMIC_BUBBLE_SHAPES[0];
          return (
            <>
              <span className="flex-none font-semibold text-gray-600 dark:text-gray-300">{t('气泡框形')}</span>
              <div className="relative flex-none">
                <button
                  type="button"
                  aria-expanded={bubbleShapeMenuOpen}
                  aria-haspopup="listbox"
                  onClick={() => setBubbleShapeMenuOpen(v => !v)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-indigo-400/80 bg-indigo-50/70 px-2 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100/70 dark:border-indigo-500/70 dark:bg-indigo-950/60 dark:text-indigo-200"
                >
                  {currentCustomBubble ? (
                    <img src={currentCustomBubble.url} alt="" className="h-4 w-5 flex-none object-contain" />
                  ) : (
                    <ComicBubbleShapeIcon shape={currentShape.id} className="h-4 w-5 flex-none" />
                  )}
                  <span className="max-w-24 truncate whitespace-nowrap">
                    {currentCustomBubble ? currentCustomBubble.name : t(currentShape.label)}
                  </span>
                  <ChevronDown className="h-3 w-3 flex-none opacity-75" aria-hidden="true" />
                </button>
                {bubbleShapeMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setBubbleShapeMenuOpen(false)} />
                    <div
                      role="listbox"
                      aria-label={t('选择默认气泡框形')}
                      className="absolute left-0 top-full z-50 mt-1.5 w-72 space-y-2 rounded-xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="grid grid-cols-4 gap-1">
                        {COMIC_BUBBLE_SHAPES.map(shape => (
                          <button
                            key={shape.id}
                            type="button"
                            role="option"
                            aria-selected={!defaultCustomBubbleAssetId && defaultBubbleShape === shape.id}
                            onClick={() => {
                              onChangeDefaultBubbleStyle({ shape: shape.id, customAssetId: null });
                              setBubbleShapeMenuOpen(false);
                            }}
                            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-[10px] font-medium transition ${!defaultCustomBubbleAssetId && defaultBubbleShape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/70 dark:text-indigo-200' : 'border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50 dark:text-slate-200 dark:hover:border-gray-700 dark:hover:bg-gray-800'}`}
                          >
                            <ComicBubbleShapeIcon shape={shape.id} className="h-5 w-7" />
                            <span className="w-full truncate text-center">{t(shape.label)}</span>
                          </button>
                        ))}
                      </div>
                      {customBubbleAssets.length > 0 && (
                        <div className="border-t border-gray-200/80 pt-1.5 dark:border-slate-700">
                          <div className="mb-1 px-1 text-[10px] font-semibold text-gray-400">{t('自定义气泡')}</div>
                          <div className="grid max-h-36 grid-cols-4 gap-1 overflow-y-auto">
                            {customBubbleAssets.map(asset => (
                              <button
                                key={asset.id}
                                type="button"
                                role="option"
                                aria-selected={defaultCustomBubbleAssetId === asset.id}
                                onClick={() => {
                                  onChangeDefaultBubbleStyle({ customAssetId: asset.id });
                                  setBubbleShapeMenuOpen(false);
                                }}
                                className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-[10px] font-medium transition ${defaultCustomBubbleAssetId === asset.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/70 dark:text-indigo-200' : 'border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50 dark:text-slate-200 dark:hover:border-gray-700 dark:hover:bg-gray-800'}`}
                              >
                                <img src={asset.url} alt={asset.name} className="h-5 w-7 object-contain" />
                                <span className="w-full truncate text-center">{asset.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => onChangeDefaultBubbleStyle({ writingMode: defaultBubbleWritingMode === 'vertical' ? 'horizontal' : 'vertical' })}
                className="flex-none whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                {defaultBubbleWritingMode === 'vertical' ? t('默认竖排') : t('默认横排')}
              </button>
            </>
          );
        })()}

        {activeTool === 'sticker' && (
          <>
            <span className="flex-none font-semibold text-gray-600 dark:text-gray-300">{t('贴纸样式')}</span>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {STICKER_KINDS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeDefaultStickerKind(item.id)}
                  className={`flex-none rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${defaultStickerKind === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </>
        )}

        {activeTool === 'slice' && (
          <>
            <span className="font-semibold text-gray-600 dark:text-gray-300">{t('一刀切分')}</span>
            <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <span>{t('格间距')}</span>
              <input
                type="range"
                min={0}
                max={48}
                value={draft.gutterPx}
                onChange={e => onUpdatePageSettings({ gutterPx: Number(e.target.value) })}
                className="w-20 accent-indigo-600"
              />
              <span className="w-8 font-mono text-[11px]">{draft.gutterPx}px</span>
            </label>
            <span className="text-[11px] text-gray-400">{t('吸边可拐弯折线切 · 拖线一刀切 · Shift 锁 45°')}</span>
          </>
        )}

        {activeTool === 'frame-image' && (
          activePanel?.image?.url ? (
            <>
              <span className="font-semibold text-gray-600 dark:text-gray-300">{t('格内构图')} · {activePanel.name}</span>
              <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <span>{t('缩放')}</span>
                <input
                  type="range"
                  min={50}
                  max={400}
                  value={Math.round((activePanel.image.scale || 1) * 100)}
                  onChange={e => onUpdateActivePanelImage?.({ scale: Number(e.target.value) / 100 })}
                  className="w-24 accent-indigo-600"
                />
                <span className="w-10 font-mono text-[11px]">{Math.round((activePanel.image.scale || 1) * 100)}%</span>
              </label>
              <button
                type="button"
                onClick={() => onUpdateActivePanelImage?.({ reset: true })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RotateCcw className="h-3 w-3" /> {t('归位')}
              </button>
            </>
          ) : (
            <span className="text-[11px] text-gray-400">{t('拖拽画格调整构图')}</span>
          )
        )}

        {activeTool === 'hand' && (
          <span className="truncate text-[11px] text-gray-400">{t('拖拽平移 · Ctrl+滚轮缩放')}</span>
        )}
        {activeTool === 'zoom' && (
          <span className="truncate text-[11px] text-gray-400">{t('点击放大 · Alt+点击缩小')}</span>
        )}
        {activeTool === 'draw-panel' && (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-600 dark:text-gray-300">{t('绘制模式')}</span>
            <button
              type="button"
              aria-pressed={!drawPanelAsOverlay}
              onClick={() => onChangeDrawPanelAsOverlay?.(false)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${!drawPanelAsOverlay ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
            >
              {t('普通画格')}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(drawPanelAsOverlay)}
              onClick={() => onChangeDrawPanelAsOverlay?.(true)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${drawPanelAsOverlay ? 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-950/60 dark:text-amber-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
            >
              {t('叠加画框 (Shift+R)')}
            </button>
          </div>
        )}
        {activeTool === 'text' && (
          <span className="truncate text-[11px] text-gray-400">{t('点击放置 · 双击编辑')}</span>
        )}
      </div>
      )}

      {/* 右区：撤销重做 + 导出 PNG + 工作台收起 */}
      <div className="ml-auto flex flex-none items-center gap-1">
        <IconButton label={t('撤销')} disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t('重做')} disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </IconButton>

        <ToolbarButton
          tone="neutral"
          disabled={exporting}
          onClick={onExport}
          aria-label={t('导出 PNG')}
          className="h-8! px-2.5! text-xs"
        >
          {exporting ? <InlineSpinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
          <span className="hidden sm:inline">{exporting ? t('导出中…') : t('导出 PNG')}</span>
        </ToolbarButton>

        <IconButton
          label={inspectorOpen ? t('收起属性面板') : t('展开属性面板')}
          active={inspectorOpen}
          onClick={onToggleInspector}
        >
          {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </IconButton>
      </div>

      {/* 页面设定 + 画幅 + 分镜模板一体化浮层 */}
      {pageMenuOpen && (
        <ImagePreviewPortal>
          <AnchoredToolbarPopover
            title={t('页面规格与分镜模板')}
            anchorRef={pageMenuBtnRef}
            onClose={() => setPageMenuOpen(false)}
            width={416}
          >
            <div className="space-y-3 p-1 text-xs">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 font-bold text-gray-700 dark:text-gray-200">
                  <Grid className="h-3.5 w-3.5 text-indigo-500" />
                  {t('纸张画幅')}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {COMIC_PAPER_PRESETS.map(preset => {
                    const active = draft.paperPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => { onSelectPaperPreset(preset.id); setPageMenuOpen(false); }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        <div className="font-semibold">{t(preset.label)}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{preset.width} × {preset.height}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-gray-200/80 bg-gray-50/70 p-1.5 dark:border-gray-700 dark:bg-gray-800/60">
                  <input
                    type="number"
                    aria-label={t('自定义画幅宽度')}
                    min={256}
                    max={4096}
                    step={64}
                    value={customW}
                    onChange={e => setCustomW(e.target.value)}
                    className="w-20 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <span className="text-gray-400">×</span>
                  <input
                    type="number"
                    aria-label={t('自定义画幅高度')}
                    min={256}
                    max={4096}
                    step={64}
                    value={customH}
                    onChange={e => setCustomH(e.target.value)}
                    className="w-20 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={applyCustomSize}
                    className="ml-auto rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
                  >
                    {t('应用')}
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2.5 dark:border-gray-700">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-gray-700 dark:text-gray-200">
                    <LayoutTemplate className="h-3.5 w-3.5 text-indigo-500" />
                    {t('一键分镜模板')}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPageMenuOpen(false);
                      setWideTemplatesOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                  >
                    <LayoutGrid className="h-3 w-3" />
                    {t('大图浏览')}
                  </button>
                </div>

                {isSpreadPaper && (
                  <div className="mb-2 flex items-center gap-1 rounded-lg border border-indigo-200/70 bg-indigo-50/40 p-1 text-[11px] dark:border-indigo-900/60 dark:bg-indigo-950/20">
                    <span className="px-1 font-medium text-gray-500 dark:text-gray-400">{t('对开页区域')}</span>
                    {([
                      { id: 'full', label: '整页' },
                      { id: 'left', label: '左半页' },
                      { id: 'right', label: '右半页' },
                    ] as Array<{ id: ComicTemplateScope; label: string }>).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={templateScope === item.id}
                        onClick={() => setTemplateScope(item.id)}
                        className={`flex-1 rounded-md px-2 py-0.5 font-semibold transition ${templateScope === item.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                      >
                        {t(item.label)}
                      </button>
                    ))}
                  </div>
                )}

                {/* 个人自定义分镜模板保存与复用 */}
                <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-indigo-200/70 bg-indigo-50/40 p-1.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                  <input
                    type="text"
                    aria-label={t('自定义模板名称')}
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    placeholder={t('将当前分镜存为模板…')}
                    className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const label = newTemplateName.trim() || `${draft.title || t('自定义分镜')} (${draft.creationMode === 'ai-page' ? draft.aiPage.guidePanels.length : draft.panels.length}${t('格')})`;
                      onSaveCustomTemplate(label);
                      setNewTemplateName('');
                    }}
                    className="inline-flex flex-none items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    <BookmarkPlus className="h-3 w-3" /> {t('存为模板')}
                  </button>
                </div>

                {/* 分镜分类切换 */}
                <div className="mb-2 flex flex-wrap items-center gap-1">
                  {([
                    { id: 'all', label: '全部', count: COMIC_LAYOUT_TEMPLATES.length },
                    ...COMIC_LAYOUT_TEMPLATE_CATEGORIES.map(cat => ({
                      id: cat.id,
                      label: cat.label,
                      count: COMIC_LAYOUT_TEMPLATES.filter(tpl => tpl.category === cat.id).length,
                    })),
                  ] as Array<{ id: 'all' | ComicLayoutTemplateCategory; label: string; count: number }>).map(cat => {
                    const active = templateCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setTemplateCategory(cat.id)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                      >
                        {t(cat.label)} ({cat.count})
                      </button>
                    );
                  })}
                </div>

                <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
                  {customTemplates.length > 0 && (
                    <div className="space-y-1">
                      <div className="px-1 text-[10px] font-semibold text-indigo-500">{t('我的自定义模板')} ({customTemplates.length})</div>
                      {customTemplates.map(tpl => (
                        <div
                          key={tpl.id}
                          className="flex items-center gap-2 rounded-lg border border-indigo-200/80 bg-indigo-50/30 px-2 py-1 dark:border-indigo-900/60 dark:bg-indigo-950/20"
                        >
                          <ComicTemplatePreview panels={toPreviewPanelsFromCustom(tpl.panels)} className="h-9 w-auto" />
                          <button
                            type="button"
                            onClick={() => { onApplyCustomTemplate(tpl.id, templateScope); setPageMenuOpen(false); }}
                            className="flex min-w-0 flex-1 flex-col text-left"
                          >
                            <span className="truncate font-semibold text-gray-800 dark:text-gray-100">{tpl.label}</span>
                            <span className="text-[10px] text-gray-500 dark:text-gray-400">{t('自定义 {0} 格布局', [tpl.panels.length])}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={t('删除自定义模板 {0}', [tpl.label])}
                            onClick={() => onDeleteCustomTemplate(tpl.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    {COMIC_LAYOUT_TEMPLATES
                      .filter(tpl => templateCategory === 'all' || tpl.category === templateCategory)
                      .map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          title={t(tpl.description)}
                          onClick={() => { onApplyTemplate(tpl.id, templateScope); setPageMenuOpen(false); }}
                          className="flex flex-col items-center gap-1 rounded-lg border border-gray-200/80 bg-white p-1.5 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
                        >
                          <ComicTemplatePreview panels={getBuiltinTemplatePreviewPanels(tpl)} className="h-14 w-auto" />
                          <span className="w-full truncate text-[11px] font-semibold text-gray-800 dark:text-gray-100">{t(tpl.label)}</span>
                          <span className="text-[10px] text-gray-500 dark:text-gray-400">{t('{0} 格', [tpl.panelCount])}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </AnchoredToolbarPopover>
        </ImagePreviewPortal>
      )}

      {/* 大图分镜模板库弹窗：宽敞多列预览所有分镜样式，支持对开页指定左/右半页独立套用 */}
      {wideTemplatesOpen && (
        <ImagePreviewPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
            onClick={() => setWideTemplatesOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('漫画分镜模板库')}
              onClick={e => e.stopPropagation()}
              className="appearance-panel flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/80 px-4 py-3 dark:border-gray-800/80">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('漫画分镜模板库')}</h2>
                  <span className="text-xs text-gray-400">{t('共 {0} 套预设', [COMIC_LAYOUT_TEMPLATES.length])}</span>
                </div>
                {isSpreadPaper && (
                  <div className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/70 p-0.5 text-xs dark:border-indigo-900/60 dark:bg-indigo-950/30">
                    {([
                      { id: 'full', label: '整页' },
                      { id: 'left', label: '左半页' },
                      { id: 'right', label: '右半页' },
                    ] as Array<{ id: ComicTemplateScope; label: string }>).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={templateScope === item.id}
                        onClick={() => setTemplateScope(item.id)}
                        className={`rounded-md px-2.5 py-1 font-semibold transition ${templateScope === item.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'}`}
                      >
                        {t(item.label)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={t('关闭模板库')}
                  onClick={() => setWideTemplatesOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200/70 px-4 py-2 dark:border-gray-800/70">
                {([
                  { id: 'all', label: '全部', count: COMIC_LAYOUT_TEMPLATES.length },
                  ...COMIC_LAYOUT_TEMPLATE_CATEGORIES.map(cat => ({
                    id: cat.id,
                    label: cat.label,
                    count: COMIC_LAYOUT_TEMPLATES.filter(tpl => tpl.category === cat.id).length,
                  })),
                ] as Array<{ id: 'all' | ComicLayoutTemplateCategory; label: string; count: number }>).map(cat => {
                  const active = templateCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setTemplateCategory(cat.id)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    >
                      {t(cat.label)} ({cat.count})
                    </button>
                  );
                })}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {customTemplates.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-indigo-600 dark:text-indigo-300">{t('我的自定义模板')} ({customTemplates.length})</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {customTemplates.map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => { onApplyCustomTemplate(tpl.id, templateScope); setWideTemplatesOpen(false); }}
                          className="flex flex-col items-center gap-2 rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3 text-center transition hover:border-indigo-500 hover:bg-indigo-50 dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40"
                        >
                          <ComicTemplatePreview
                            panels={toPreviewPanelsFromCustom(tpl.panels)}
                            className={draft.width > draft.height ? 'aspect-[4/3] w-full' : 'aspect-[3/4] w-24'}
                          />
                          <div className="w-full truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{tpl.label}</div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('自定义 {0} 格布局', [tpl.panels.length])}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {COMIC_LAYOUT_TEMPLATES
                    .filter(tpl => templateCategory === 'all' || tpl.category === templateCategory)
                    .map(tpl => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => { onApplyTemplate(tpl.id, templateScope); setWideTemplatesOpen(false); }}
                        className="flex flex-col items-center gap-2 rounded-xl border border-gray-200/90 bg-white p-3 text-center transition hover:-translate-y-0.5 hover:border-indigo-400 hover:bg-indigo-50/40 hover:shadow-md dark:border-gray-700 dark:bg-gray-800/90 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
                      >
                        <ComicTemplatePreview
                          panels={getBuiltinTemplatePreviewPanels(tpl)}
                          className={draft.width > draft.height ? 'aspect-[4/3] w-full' : 'aspect-[3/4] w-24'}
                        />
                        <div className="w-full truncate text-xs font-bold text-gray-800 dark:text-gray-100">{t(tpl.label)}</div>
                        <div className="line-clamp-2 text-[11px] text-gray-500 dark:text-gray-400">{t(tpl.description)}</div>
                        <div className="text-[10px] font-medium text-indigo-600 dark:text-indigo-300">{t('{0} 格', [tpl.panelCount])}</div>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </ImagePreviewPortal>
      )}
    </header>
  );
};
