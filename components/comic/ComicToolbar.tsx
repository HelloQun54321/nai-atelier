import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Grid,
  LayoutTemplate,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { COMIC_LAYOUT_TEMPLATES, COMIC_PAPER_PRESETS } from '../../services/comic/comicGeometry';
import { COMIC_V5_MODELS } from '../../services/comic/comicPromptBuilder';
import type {
  ComicBubbleShape,
  ComicColorMode,
  ComicCreationMode,
  ComicDialogueMode,
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
  activeTool: ComicTool;
  activePanel?: ComicPanel;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  defaultStickerKind: ComicStickerKind;
  defaultBubbleShape: ComicBubbleShape;
  defaultBubbleWritingMode: 'horizontal' | 'vertical';
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  inspectorOpen: boolean;
  onChangeTitle: (title: string) => void;
  onChangeMode: (mode: ComicCreationMode) => void;
  onSelectPaperPreset: (presetId: string) => void;
  onSetCustomPaperSize: (width: number, height: number) => void;
  onApplyTemplate: (templateId: string) => void;
  onUpdatePageSettings: (patch: Partial<Pick<ComicPageDraft, 'v5Model' | 'steps' | 'colorMode' | 'dialogueMode' | 'gutterPx'>>) => void;
  onChangeBrush: (patch: { color?: string; size?: number; opacity?: number }) => void;
  onClearStrokes: () => void;
  onChangeDefaultStickerKind: (kind: ComicStickerKind) => void;
  onChangeDefaultBubbleStyle: (patch: { shape?: ComicBubbleShape; writingMode?: 'horizontal' | 'vertical' }) => void;
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

const BUBBLE_SHAPES: Array<{ id: ComicBubbleShape; label: string }> = [
  { id: 'oval', label: '椭圆' },
  { id: 'shout', label: '吼叫' },
  { id: 'thought', label: '思考' },
  { id: 'caption', label: '旁白' },
];

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
  activeTool,
  activePanel,
  brushColor,
  brushSize,
  brushOpacity,
  defaultStickerKind,
  defaultBubbleShape,
  defaultBubbleWritingMode,
  canUndo,
  canRedo,
  exporting,
  inspectorOpen,
  onChangeTitle,
  onChangeMode,
  onSelectPaperPreset,
  onSetCustomPaperSize,
  onApplyTemplate,
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
  const [customW, setCustomW] = useState(String(draft.width));
  const [customH, setCustomH] = useState(String(draft.height));
  const pageMenuBtnRef = useRef<HTMLButtonElement>(null);

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
    <header className="relative z-30 flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-gray-200/90 bg-white/95 px-3 py-1.5 backdrop-blur-md dark:border-gray-800/90 dark:bg-gray-900/95">
      {/* 左区：页面标题 + 模式切换 + 规格/模板入口 */}
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
        <input
          type="text"
          aria-label={t('漫画页标题')}
          value={draft.title}
          onChange={event => onChangeTitle(event.target.value)}
          placeholder={t('未命名漫画页')}
          className="h-8 w-28 min-w-0 rounded-lg border border-transparent bg-transparent px-1.5 text-sm font-bold text-gray-800 outline-none transition hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800 sm:w-32"
        />

        <div
          className="inline-flex flex-none rounded-lg border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/90"
          role="group"
          aria-label={t('创作模式')}
        >
          <button
            type="button"
            aria-pressed={draft.creationMode === 'manual'}
            onClick={() => onChangeMode('manual')}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${draft.creationMode === 'manual' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {t('手动逐格')}
          </button>
          <button
            type="button"
            aria-pressed={draft.creationMode === 'ai-page'}
            onClick={() => onChangeMode('ai-page')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${draft.creationMode === 'ai-page' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title={t('AI 整页锚点一图成型（含自动双区拼合）')}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>{t('AI 整页')}</span>
          </button>
        </div>

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

      {/* 中区：仿 PS 动态工具属性栏（随左侧竖工具栏实时切换，彻底填实顶栏中间空洞） */}
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

        {activeTool === 'bubble' && (
          <>
            <span className="font-semibold text-gray-600 dark:text-gray-300">{t('气泡框形')}</span>
            <div className="flex items-center gap-1">
              {BUBBLE_SHAPES.map(shape => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => onChangeDefaultBubbleStyle({ shape: shape.id })}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${defaultBubbleShape === shape.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {t(shape.label)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onChangeDefaultBubbleStyle({ writingMode: defaultBubbleWritingMode === 'vertical' ? 'horizontal' : 'vertical' })}
              className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {defaultBubbleWritingMode === 'vertical' ? t('默认竖排') : t('默认横排')}
            </button>
          </>
        )}

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
            <span className="font-semibold text-gray-600 dark:text-gray-300">{t('两点一刀切')}</span>
            <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <span>{t('格间距')}</span>
              <input
                type="range"
                min={0}
                max={36}
                value={draft.gutterPx}
                onChange={e => onUpdatePageSettings({ gutterPx: Number(e.target.value) })}
                className="w-20 accent-indigo-600"
              />
              <span className="w-8 font-mono text-[11px]">{draft.gutterPx}px</span>
            </label>
            <span className="text-[11px] text-gray-400">{t('拖线切分划过的画格 · Shift 锁 45°')}</span>
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
                  min={100}
                  max={250}
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
            <span className="text-[11px] text-gray-400">{t('格内移图：直接拖拽已成图的分镜格调整画面构图')}</span>
          )
        )}

        {activeTool === 'select' && (
          <span className="truncate text-[11px] text-gray-400">
            {t('选择 (V)：拖拽移动与调斜角 · 双击气泡/文字原地改字 · Delete 删除')}
          </span>
        )}
        {activeTool === 'hand' && (
          <span className="truncate text-[11px] text-gray-400">{t('抓手 (H)：左键拖拽直接平移画布，Ctrl+滚轮缩放')}</span>
        )}
        {activeTool === 'zoom' && (
          <span className="truncate text-[11px] text-gray-400">{t('缩放镜 (Z)：左键点击放大，按住 Alt 点击缩小')}</span>
        )}
        {activeTool === 'draw-panel' && (
          <span className="truncate text-[11px] text-gray-400">{t('自由拉框 (R)：在画布拖拽绘制新分镜格，自动对齐边缘')}</span>
        )}
        {activeTool === 'text' && (
          <span className="truncate text-[11px] text-gray-400">{t('自由文字 (T)：点击画布放置拟声词或效果字，双击修改内容')}</span>
        )}
      </div>

      {/* 右区：撤销重做 + 导出 PNG + 工作台收起 */}
      <div className="ml-auto flex flex-none items-center gap-1">
        <IconButton label={t('撤销')} disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t('重做')} disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </IconButton>

        <ToolbarButton
          tone="primary"
          disabled={exporting}
          onClick={onExport}
          aria-label={t('导出 PNG')}
          className="h-8! px-2.5! text-xs"
        >
          {exporting ? <InlineSpinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
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
            width={360}
          >
            <div className="space-y-3 p-1 text-xs">
              <div className="space-y-2 rounded-xl border border-gray-200/80 bg-gray-50/70 p-2.5 dark:border-gray-700/80 dark:bg-gray-800/50">
                <div className="grid grid-cols-3 gap-1">
                  {COMIC_V5_MODELS.map(model => {
                    const active = draft.v5Model === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => onUpdatePageSettings({
                          v5Model: model.id,
                          steps: model.id === 'nai-diffusion-5-full-medium' ? 14 : 23,
                        })}
                        className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-semibold transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        {shortModelLabel(model.id)}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: 'color', label: '全彩漫画' },
                    { id: 'monochrome', label: '黑白网点漫' },
                  ] as Array<{ id: ComicColorMode; label: string }>).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onUpdatePageSettings({ colorMode: item.id })}
                      className={`rounded-lg border px-2 py-1 font-semibold transition ${draft.colorMode === item.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                    >
                      {t(item.label)}
                    </button>
                  ))}
                </div>
                <select
                  aria-label={t('对白与气泡策略')}
                  value={draft.dialogueMode}
                  onChange={e => onUpdatePageSettings({ dialogueMode: e.target.value as ComicDialogueMode })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="clean-vector">{t('对白：无气泡纯画面 + 画布矢量气泡')}</option>
                  <option value="empty-bubble">{t('对白：空白气泡直出 + 后期嵌字')}</option>
                  <option value="ai-text">{t('对白：AI 锚点直出短字 / 拟声词')}</option>
                </select>
              </div>

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
                <div className="mb-1.5 flex items-center gap-1.5 font-bold text-gray-700 dark:text-gray-200">
                  <LayoutTemplate className="h-3.5 w-3.5 text-indigo-500" />
                  {t('一键分镜模板')}
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
                  {COMIC_LAYOUT_TEMPLATES.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => { onApplyTemplate(tpl.id); setPageMenuOpen(false); }}
                      className="flex w-full flex-col rounded-lg border border-gray-200/80 bg-white px-2.5 py-1.5 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
                    >
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{t(tpl.label)}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{t(tpl.description)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </AnchoredToolbarPopover>
        </ImagePreviewPortal>
      )}
    </header>
  );
};
