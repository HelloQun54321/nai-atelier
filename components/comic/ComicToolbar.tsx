import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Brush,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid,
  LayoutTemplate,
  Layers,
  Lock,
  Magnet,
  MessageCircle,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Scissors,
  Sparkles,
  SquarePlus,
  Sticker,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { COMIC_LAYOUT_TEMPLATES, COMIC_PAPER_PRESETS } from '../../services/comic/comicGeometry';
import type {
  ComicCreationMode,
  ComicLayerId,
  ComicPageDraft,
  ComicTool,
} from '../../services/comic/comicTypes';
import { IconButton, InlineSpinner, ToolbarButton, ToolbarDivider } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { AnchoredToolbarPopover } from '../ToolbarPopover';

interface ComicToolbarProps {
  draft: ComicPageDraft;
  activeTool: ComicTool;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  inspectorOpen: boolean;
  onSelectTool: (tool: ComicTool) => void;
  onChangeTitle: (title: string) => void;
  onChangeMode: (mode: ComicCreationMode) => void;
  onSelectPaperPreset: (presetId: string) => void;
  onApplyTemplate: (templateId: string) => void;
  onToggleSnap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (nextZoom: number) => void;
  onZoomFit: () => void;
  onToggleLayerVisible: (layerId: ComicLayerId) => void;
  onToggleLayerLocked: (layerId: ComicLayerId) => void;
  onMoveLayerOrder: (layerId: ComicLayerId, direction: 'up' | 'down') => void;
  onToggleInspector: () => void;
  onExport: () => void;
  onBack?: () => void;
}

const TOOL_ITEMS: Array<{ id: ComicTool; label: string; icon: React.ElementType; desktopOnly?: boolean }> = [
  { id: 'select', label: '选择与移动', icon: MousePointer2 },
  { id: 'draw-panel', label: '自由拉框', icon: SquarePlus, desktopOnly: true },
  { id: 'slice', label: '两点一刀切分', icon: Scissors, desktopOnly: true },
  { id: 'brush', label: '画笔', icon: Brush, desktopOnly: true },
  { id: 'eraser', label: '橡皮擦', icon: Eraser, desktopOnly: true },
  { id: 'bubble', label: '添加气泡', icon: MessageCircle },
  { id: 'text', label: '添加文字', icon: Type },
  { id: 'sticker', label: '添加贴纸', icon: Sticker },
];

const LAYER_LABELS: Record<ComicLayerId, string> = {
  panels: '分镜画格',
  drawing: '手绘涂鸦',
  bubbles: '气泡与文字',
  stickers: '效果贴纸',
};

export const ComicToolbar: React.FC<ComicToolbarProps> = ({
  draft,
  activeTool,
  zoom,
  canUndo,
  canRedo,
  exporting,
  inspectorOpen,
  onSelectTool,
  onChangeTitle,
  onChangeMode,
  onSelectPaperPreset,
  onApplyTemplate,
  onToggleSnap,
  onUndo,
  onRedo,
  onZoomChange,
  onZoomFit,
  onToggleLayerVisible,
  onToggleLayerLocked,
  onMoveLayerOrder,
  onToggleInspector,
  onExport,
  onBack,
}) => {
  useLanguage();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement>(null);
  const layersBtnRef = useRef<HTMLButtonElement>(null);

  const orderedLayers = (['panels', 'drawing', 'bubbles', 'stickers'] as ComicLayerId[])
    .sort((a, b) => (draft.layers[b]?.order ?? 0) - (draft.layers[a]?.order ?? 0));

  return (
    <header className="workspace-command-bar relative z-30 flex flex-none flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white/95 px-2 py-1.5 dark:border-gray-800/80 dark:bg-gray-900/95 md:px-4">
      {/* 左侧：手机返回 + 标题 + 纸张/模板 */}
      <div className="flex min-w-0 items-center gap-1.5">
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
          className="h-8 w-28 min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-sm font-bold text-gray-800 outline-none transition hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800 sm:w-36"
        />

        <div className="appearance-segmented inline-flex rounded-lg border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/90" role="group" aria-label={t('创作模式')}>
          <button
            type="button"
            data-appearance="control"
            aria-pressed={draft.creationMode === 'manual'}
            onClick={() => onChangeMode('manual')}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${draft.creationMode === 'manual' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {t('手动逐格')}
          </button>
          <button
            type="button"
            data-appearance="control"
            aria-pressed={draft.creationMode === 'ai-page'}
            onClick={() => onChangeMode('ai-page')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${draft.creationMode === 'ai-page' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title={t('AI 整页锚点编排（第二期上线）')}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span className="hidden sm:inline">{t('AI 整页')}</span>
          </button>
        </div>

        <button
          ref={templateBtnRef}
          type="button"
          data-appearance="control"
          aria-haspopup="dialog"
          aria-expanded={templateOpen}
          onClick={() => setTemplateOpen(open => !open)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{t('画幅与模板')}</span>
        </button>
      </div>

      <ToolbarDivider className="hidden md:block" />

      {/* 中间：画布整合工具组 */}
      <div className="flex items-center gap-0.5 rounded-xl border border-gray-200/80 bg-gray-50/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/70" role="toolbar" aria-label={t('漫画画布工具')}>
        {TOOL_ITEMS.map(item => {
          const Icon = item.icon;
          const active = activeTool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={t(item.label)}
              aria-pressed={active}
              title={t(item.label)}
              onClick={() => onSelectTool(item.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${item.desktopOnly ? 'hidden md:flex' : 'flex'} ${active ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {/* 吸附、撤销重做、图层 */}
      <div className="flex items-center gap-1">
        <IconButton
          label={t('边缘与网格吸附')}
          active={draft.snapEnabled}
          onClick={onToggleSnap}
          className="hidden md:inline-flex"
        >
          <Magnet className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t('撤销')} disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={t('重做')} disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </IconButton>

        <button
          ref={layersBtnRef}
          type="button"
          aria-label={t('图层面板')}
          aria-haspopup="dialog"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen(open => !open)}
          className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition ${layersOpen ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden lg:inline">{t('图层')}</span>
        </button>
      </div>

      {/* 右侧：缩放、右侧栏折叠、导出 PNG */}
      <div className="ml-auto flex items-center gap-1.5">
        <div className="hidden items-center gap-0.5 rounded-lg border border-gray-200/80 bg-gray-50/80 px-1 py-0.5 dark:border-gray-700/80 dark:bg-gray-800/80 lg:flex">
          <button
            type="button"
            aria-label={t('缩小画布')}
            onClick={() => onZoomChange(Math.max(0.25, Number((zoom - 0.1).toFixed(2))))}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('适配画布缩放')}
            onClick={onZoomFit}
            className="min-w-11 px-1 text-center text-xs font-mono text-gray-700 hover:text-indigo-600 dark:text-gray-200"
            title={t('点击恢复适配视口')}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label={t('放大画布')}
            onClick={() => onZoomChange(Math.min(2.5, Number((zoom + 0.1).toFixed(2))))}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('适应屏幕')}
            onClick={onZoomFit}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>

        <ToolbarButton
          tone="primary"
          disabled={exporting}
          onClick={onExport}
          aria-label={t('导出 PNG')}
          className="!h-8 !px-2.5 text-xs"
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

      {/* 画幅与分镜模板浮层 */}
      {templateOpen && (
        <ImagePreviewPortal>
          <AnchoredToolbarPopover
            title={t('画幅与分镜模板')}
            anchorRef={templateBtnRef}
            onClose={() => setTemplateOpen(false)}
            width={320}
          >
            <div className="space-y-3 p-1">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
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
                        onClick={() => { onSelectPaperPreset(preset.id); setTemplateOpen(false); }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        <div className="text-xs font-semibold">{t(preset.label)}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{preset.width} × {preset.height}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2.5 dark:border-gray-700">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200">
                  <LayoutTemplate className="h-3.5 w-3.5 text-indigo-500" />
                  {t('一键分镜模板（替换当前分镜格）')}
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
                  {COMIC_LAYOUT_TEMPLATES.map(tpl => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => { onApplyTemplate(tpl.id); setTemplateOpen(false); }}
                      className="flex w-full flex-col rounded-lg border border-gray-200/80 bg-white px-2.5 py-1.5 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
                    >
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{t(tpl.label)}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{t(tpl.description)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </AnchoredToolbarPopover>
        </ImagePreviewPortal>
      )}

      {/* 图层浮层 */}
      {layersOpen && (
        <ImagePreviewPortal>
          <AnchoredToolbarPopover
            title={t('图层管理')}
            anchorRef={layersBtnRef}
            onClose={() => setLayersOpen(false)}
            width={256}
          >
            <div className="p-0.5">
            <div className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">{t('图层顺序（上层优先显示）')}</div>
            <div className="space-y-1.5">
              {orderedLayers.map((layerId, index) => {
                const layer = draft.layers[layerId];
                return (
                  <div
                    key={layerId}
                    className="flex items-center justify-between gap-1 rounded-lg border border-gray-200/80 bg-gray-50/80 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800/80"
                  >
                    <span className={`min-w-0 flex-1 truncate font-medium ${layer.visible ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 line-through'}`}>
                      {t(LAYER_LABELS[layerId])}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={t('上移图层')}
                        disabled={index === 0}
                        onClick={() => onMoveLayerOrder(layerId, 'up')}
                        className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('下移图层')}
                        disabled={index === orderedLayers.length - 1}
                        onClick={() => onMoveLayerOrder(layerId, 'down')}
                        className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={layer.locked ? t('解锁图层') : t('锁定图层')}
                        onClick={() => onToggleLayerLocked(layerId)}
                        className={`rounded p-1 ${layer.locked ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        {layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        aria-label={layer.visible ? t('隐藏图层') : t('显示图层')}
                        onClick={() => onToggleLayerVisible(layerId)}
                        className={`rounded p-1 ${layer.visible ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </AnchoredToolbarPopover>
        </ImagePreviewPortal>
      )}
    </header>
  );
};
