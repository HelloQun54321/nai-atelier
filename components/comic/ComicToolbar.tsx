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
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { COMIC_LAYOUT_TEMPLATES, COMIC_PAPER_PRESETS } from '../../services/comic/comicGeometry';
import { COMIC_V5_MODELS } from '../../services/comic/comicPromptBuilder';
import type {
  ComicColorMode,
  ComicCreationMode,
  ComicDialogueMode,
  ComicPageDraft,
  ComicV5ModelId,
} from '../../services/comic/comicTypes';
import { IconButton, InlineSpinner, ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { AnchoredToolbarPopover } from '../ToolbarPopover';

interface ComicToolbarProps {
  draft: ComicPageDraft;
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  inspectorOpen: boolean;
  onChangeTitle: (title: string) => void;
  onChangeMode: (mode: ComicCreationMode) => void;
  onSelectPaperPreset: (presetId: string) => void;
  onSetCustomPaperSize: (width: number, height: number) => void;
  onApplyTemplate: (templateId: string) => void;
  onUpdatePageSettings: (patch: Partial<Pick<ComicPageDraft, 'v5Model' | 'steps' | 'colorMode' | 'dialogueMode'>>) => void;
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

export const ComicToolbar: React.FC<ComicToolbarProps> = ({
  draft,
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
    <header
      style={{ height: 'auto' }}
      className="workspace-command-bar h-auto! relative z-30 flex flex-none flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-2.5 py-1.5 dark:border-gray-800/80 dark:bg-gray-900/95 md:px-4"
    >
      {/* 左区：页面身份 + 创作模式 */}
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
          className="h-8 w-28 min-w-0 rounded-lg border border-transparent bg-transparent px-1.5 text-sm font-bold text-gray-800 outline-none transition hover:border-gray-200 focus:border-indigo-400 focus:bg-white dark:text-gray-100 dark:hover:border-gray-700 dark:focus:bg-gray-800 sm:w-36"
        />

        <div
          className="appearance-segmented inline-flex flex-none rounded-lg border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700/80 dark:bg-gray-800/90"
          role="group"
          aria-label={t('创作模式')}
        >
          <button
            type="button"
            data-appearance="control"
            aria-pressed={draft.creationMode === 'manual'}
            onClick={() => onChangeMode('manual')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'manual' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {t('手动逐格')}
          </button>
          <button
            type="button"
            data-appearance="control"
            aria-pressed={draft.creationMode === 'ai-page'}
            onClick={() => onChangeMode('ai-page')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${draft.creationMode === 'ai-page' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title={t('AI 整页锚点编排（第二期上线）')}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>{t('AI 整页')}</span>
          </button>
        </div>
      </div>

      {/* 中区：全局设定与画幅模板一体化摘要胶囊（收纳低频配置，清爽不占侧栏） */}
      <button
        ref={pageMenuBtnRef}
        type="button"
        data-appearance="control"
        aria-label={t('画幅与模板')}
        aria-haspopup="dialog"
        aria-expanded={pageMenuOpen}
        onClick={() => setPageMenuOpen(open => !open)}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-gray-200/90 bg-gray-50/90 px-3 text-xs font-medium text-gray-700 transition hover:border-indigo-400 hover:bg-white dark:border-gray-700/80 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-indigo-500 dark:hover:bg-gray-800"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
        <span className="truncate font-semibold">{shortModelLabel(draft.v5Model)}</span>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <span className="flex-none">{draft.colorMode === 'monochrome' ? t('黑白网点') : t('全彩')}</span>
        <span className="hidden text-gray-300 dark:text-gray-600 sm:inline">·</span>
        <span className="hidden font-mono text-[11px] text-gray-500 dark:text-gray-400 sm:inline">{draft.width}×{draft.height}</span>
        <span className="hidden text-gray-300 dark:text-gray-600 lg:inline">·</span>
        <span className="hidden text-indigo-600 dark:text-indigo-300 lg:inline">{t('模板')}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
      </button>

      {/* 右区：撤销重做 + 导出 PNG + 工作台收起 */}
      <div className="flex flex-none items-center gap-1">
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
              {/* 快捷 V5 模型与色彩/对白 */}
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

              {/* 纸张画幅与自定义宽高 */}
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

              {/* 分镜模板 */}
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
