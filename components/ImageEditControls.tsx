import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { ClipboardPaste, Contrast, Eraser, ImagePlus, Images, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { ImageEditCanvasExpansion, ImageEditOperation, ImageToImageSizeMode, LabImageEditDraft, LocalGenItem, NAIParams } from '../types';
import { DEFAULT_LAB_PAGE_LAYOUTS, LabPageLayout } from '../services/appearancePreferences';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { getImageToImageOutputDimensions, IMAGE_EDIT_MAX_DIMENSION, IMAGE_EDIT_MIN_DIMENSION, ImageEditNormalizationMode, isSameOutpaintExpansion, validateImageEditDimensions } from '../services/imageEdit';
import { ChainEditorParams } from './ChainEditorParams';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { ImageEditCanvas, ImageEditCanvasProps } from './ImageEditCanvas';
import { LabModuleSection } from './LabModuleSection';
import { OutpaintCanvasStage } from './OutpaintCanvasStage';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { VibeManager } from './VibeManager';
import { ChainEditorCharacters } from './chain/ChainEditorCharacters';
import { createUuid } from '../services/id';

interface ImageEditControlsProps {
  operation: ImageEditOperation;
  draft: LabImageEditDraft;
  layout?: LabPageLayout;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  canvasProps: ImageEditCanvasProps;
  latestTextToImageItem?: LocalGenItem;
  selectableParams: NAIParams;
  strength: number;
  noise: number;
  brushSize: number;
  focused: boolean;
  minimumContextArea: number;
  tool: 'brush' | 'eraser';
  manualMaskEditing?: boolean;
  onManualMaskEditingChange?: (value: boolean) => void;
  expansion: ImageEditCanvasExpansion;
  outpaintSourceSize?: { width: number; height: number };
  isBusy?: boolean;
  safeMode?: boolean;
  tagAssistEnabled: boolean;
  forceEmptySeed?: boolean;
  enforceFreeStepLimit?: boolean;
  apiKey: string;
  /** 图生图模式底图缩略图（dataUrl），显示在底图来源区；右侧预览只显示结果。 */
  baseImagePreview?: string | null;
  notify: (message: string, type?: 'success' | 'error') => void;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onPromptSource?: (source: LabImageEditDraft['promptSource']) => void;
  onDraftChange: (patch: Partial<LabImageEditDraft> & { maskData?: string }) => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPasteImage: () => void;
  onSelectImageSource: (item: LocalGenItem, source: 'generated') => void;
  onStrengthChange: (value: number) => void;
  onNoiseChange: (value: number) => void;
  onBrushSizeChange: (value: number) => void;
  onFocusedChange: (value: boolean) => void;
  onMinimumContextAreaChange: (value: number) => void;
  onToolChange: (value: 'brush' | 'eraser') => void;
  onClearMask: () => void;
  onInvertMask: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExpansionChange: (value: ImageEditCanvasExpansion) => void;
  onApplyOutpaint: () => void;
  onResetFocusedRect?: () => void;
  normalization?: { sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number } | null;
  onNormalize?: (mode: ImageEditNormalizationMode) => void;
  /** 移动端当前选中的 Tab（canvas: 底图/画板/画布, prompt: 提示词与约束, params: 技术参数）。桌面端忽略此字段，全部展开展示。 */
  mobileTab?: 'canvas' | 'prompt' | 'params';
}

const getModuleOrder = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => layout.order.indexOf(moduleId);
const isModuleCollapsed = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => Boolean(layout.collapsed[moduleId]);

export const ImageEditControls: React.FC<ImageEditControlsProps> = ({
  operation, draft, layout = DEFAULT_LAB_PAGE_LAYOUTS[operation], fileInputRef, canvasProps, latestTextToImageItem, selectableParams, strength, noise, brushSize, focused, minimumContextArea, tool, expansion, outpaintSourceSize, isBusy = false, safeMode = false, tagAssistEnabled, forceEmptySeed = false, enforceFreeStepLimit = true, apiKey, baseImagePreview, notify,
  onPromptChange, onNegativePromptChange, onDraftChange, onFileChange, onPasteImage, onSelectImageSource, onStrengthChange, onNoiseChange, onBrushSizeChange, onFocusedChange,
  onMinimumContextAreaChange, onToolChange, manualMaskEditing = false, onManualMaskEditingChange = () => undefined, onClearMask, onInvertMask, onUndo, onRedo, onExpansionChange, onApplyOutpaint, onResetFocusedRect = () => undefined, normalization = null, onNormalize = () => undefined,
  mobileTab = 'canvas',
}) => {
  useLanguage();
  const selectedRatioId = draft.outpaintRatioId || (Object.values(draft.expansion).some(Boolean) ? 'custom' : '16:9');
  const sourceSize = outpaintSourceSize || { width: canvasProps.width, height: canvasProps.height };
  const appliedExpansion = draft.appliedExpansion || { top: 0, right: 0, bottom: 0, left: 0 };
  const expansionApplied = isSameOutpaintExpansion(expansion, appliedExpansion);
  const setCustomExpansion = (value: ImageEditCanvasExpansion) => {
    onDraftChange({ outpaintRatioId: 'custom' });
    onExpansionChange(value);
  };

  const runtime = useNaiRuntime();
  const sizeMode = draft.imageToImageSizeMode || 'original';
  const outputSize = getImageToImageOutputDimensions(canvasProps.width, canvasProps.height, sizeMode, selectableParams, runtime.freeMaxArea);
  const modelInfo = getRuntimeNaiModelInfo(selectableParams.model, runtime);
  const supportsVibe = operation === 'image-to-image' && modelInfo.supportsVibes;
  const supportsCharacterReference = operation === 'image-to-image'
    ? modelInfo.supportsCharacterReferences
    : modelInfo.supportsCharacterReferenceInpainting;

  /** 蒙版画笔与操作工具栏：桌面与移动端共用画板下方的控件。 */
  const renderMaskToolbox = () => {
    if (!(operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing))) return null;
    return (
      <div className="space-y-3 pt-1">
        {safeMode && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-meta leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">{t("安全模式下不可绘制蒙版")}</div>}
        <div className="flex items-center gap-2">
          <button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('brush')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'brush' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}>{t("画笔")}</button>
          <button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('eraser')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'eraser' ? 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}><Eraser className="h-3.5 w-3.5" />{t("橡皮擦")}</button>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("笔刷大小")}</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="8"
                max="512"
                step="4"
                aria-label={t("笔刷大小数值")}
                disabled={isBusy || safeMode}
                value={brushSize}
                onChange={event => onBrushSizeChange(Math.max(8, Math.min(512, parseInt(event.target.value, 10) || 8)))}
                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
              />
              <span className="font-mono text-xs text-gray-400">px</span>
            </div>
          </div>
          <input disabled={isBusy || safeMode} type="range" min="8" max="512" step="4" aria-label={t("笔刷大小")} value={brushSize} onChange={event => onBrushSizeChange(Number(event.target.value))} className="w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-45" />
        </div>
        {focused && (
          <button disabled={isBusy || safeMode} type="button" onClick={onResetFocusedRect} className="h-8 w-full rounded-lg bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-950/30 dark:text-amber-300">{t("重新框选区域")}</button>
        )}
        <div className="grid grid-cols-4 gap-1">
          <button disabled={isBusy || safeMode} type="button" onClick={onUndo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title={t("撤销")}><RotateCcw className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onRedo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title={t("重做")}><RotateCw className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onClearMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title={t("清空蒙版")}><Trash2 className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onInvertMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title={t("反转蒙版")}><Contrast className="h-4 w-4" /></button>
        </div>
      </div>
    );
  };

  return <><div className="chain-editor-main order-2 flex min-h-full w-full shrink-0 flex-col border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:order-1 lg:w-1/2 lg:flex-1 lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-36 md:p-6 md:pb-24">
      <LabModuleSection moduleId="prompt" label={t("全局提示词")} order={getModuleOrder(layout, 'prompt')} defaultCollapsed={isModuleCollapsed(layout, 'prompt')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {operation === 'outpaint' ? t("扩图提示词") : operation === 'inpaint' ? t("重绘提示词") : t("图生图提示词")}
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-meta font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  {draft.promptSource === 'history' ? t("底图原提示词") : draft.promptSource === 'current' ? t("文生图提示词") : t("自定义编辑提示词")}
                </span>

              </div>
            </div>
            <TagAutocompleteTextarea
              tagAssistEnabled={tagAssistEnabled}
              disabled={isBusy}
              value={draft.prompt}
              onValueChange={onPromptChange}
              className="min-h-28 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder={
                operation === 'outpaint'
                  ? t("扩图提示词")
                  : operation === 'inpaint'
                  ? t("重绘提示词")
                  : t("图生图提示词")
              }
            />
          </div>
          <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">{t("全局负面提示词")}<TagAutocompleteTextarea tagAssistEnabled={tagAssistEnabled} disabled={isBusy} value={draft.negativePrompt} onValueChange={onNegativePromptChange} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder={t("输入本次负面提示词")} /></label>
        </section>
      </LabModuleSection>

      <ChainEditorCharacters
        scopeKey={operation}
        params={selectableParams}
        setParams={params => onDraftChange({ params })}
        characters={selectableParams.characters || []}
        freeformPosition={modelInfo.freeformCharacterPosition}
        positionImage={baseImagePreview}
        positionSize={baseImagePreview ? sourceSize : undefined}
        canEdit={!isBusy}
        tagAssistEnabled={tagAssistEnabled}
        characterPresetSources={{}}
        markPresetSectionModified={() => undefined}
        markChange={() => undefined}
        activeLabLayout={layout}
        mobileEditorTab={mobileTab === 'prompt' ? 'character' : 'global'}
        addCharacter={() => {
          const characters = selectableParams.characters || [];
          const maximum = getRuntimeNaiModelInfo(selectableParams.model, runtime).maxCharacters;
          if (characters.length >= maximum) { notify(`当前模型最多支持 ${maximum} 个角色提示词`, 'error'); return; }
          onDraftChange({ params: { ...selectableParams, characters: [...characters, { id: createUuid(), prompt: '', negativePrompt: '', x: 0.5, y: 0.5 }] } });
        }}
        updateCharacter={(index, patch, useCoords) => onDraftChange({ params: { ...selectableParams,
          ...(useCoords !== undefined ? { useCoords } : {}),
          characters: (selectableParams.characters || []).map((character, currentIndex) => currentIndex === index ? { ...character, ...patch } : character),
        } })}
        removeCharacter={index => onDraftChange({ params: { ...selectableParams,
          characters: (selectableParams.characters || []).filter((_, currentIndex) => currentIndex !== index),
        } })}
        coordinateHint={operation === 'outpaint' ? t("按原图定位，扩图自动换算") : undefined}
      />

      <LabModuleSection moduleId="baseImage" label={t("底图与导入")} order={getModuleOrder(layout, 'baseImage')} defaultCollapsed={isModuleCollapsed(layout, 'baseImage')} className={mobileTab === 'canvas' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-3">
          <div className="mb-3 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100" title={draft.baseImageSource ? ({ history: t("历史图片"), inspiration: t("灵感库"), generated: t("文生图结果"), upload: t("本地上传"), clipboard: t("剪贴板图片") }[draft.baseImageSource]) : undefined}>{t("底图来源")}</label></div>
          <div className="grid grid-cols-3 gap-2">
            <input aria-label={t("上传当前模式底图")} ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileChange} />
            <button disabled={isBusy} type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><ImagePlus className="h-4 w-4" />{t("上传图片")}</button>
            <button disabled={isBusy || !latestTextToImageItem} type="button" onClick={() => latestTextToImageItem && onSelectImageSource(latestTextToImageItem, 'generated')} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" title={latestTextToImageItem ? operation === 'image-to-image' ? t("取用最新结果作为底图 · 保留当前配置") : t("取用最新结果及配置") : t("当前没有可用的文生图结果")}><Images className="h-4 w-4" />{t("文生图最新")}</button>
            <button disabled={isBusy} type="button" onClick={onPasteImage} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" title={operation === 'image-to-image' ? t("粘贴图片 · Ctrl+V · 保留当前配置") : t("粘贴图片 · Ctrl+V · 带入图片配置")}><ClipboardPaste className="h-4 w-4" />{t("粘贴")}</button>
          </div>
          {operation === 'image-to-image' ? <>
            {baseImagePreview ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                <div className="relative flex items-center justify-center bg-black/5 p-3 dark:bg-black/20">
                  <img src={baseImagePreview} alt={t("图生图底图")} className="max-h-64 w-auto max-w-full rounded-lg object-contain shadow" />
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-meta text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <span>{t("当前底图 · {0} × {1}", [canvasProps.width, canvasProps.height])}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white/70 px-3 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">{t("选择底图")}</div>
            )}
            <div className="hidden" aria-hidden="true"><canvas ref={canvasProps.imageCanvasRef} /></div>
          </> : operation === 'outpaint' && !manualMaskEditing ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("智能画幅扩展")}</span>
                  <span className="text-meta font-mono text-gray-400">
                    {sourceSize.width && sourceSize.height ? `${sourceSize.width} × ${sourceSize.height} ➔ ${sourceSize.width + expansion.left + expansion.right} × ${sourceSize.height + expansion.top + expansion.bottom}` : ''}
                  </span>
                </div>

                {/* 可视化画幅模拟摆放台（“布”与可拖拽原图） */}
                <OutpaintCanvasStage
                  sourceWidth={sourceSize.width}
                  sourceHeight={sourceSize.height}
                  baseImagePreview={baseImagePreview}
                  expansion={expansion}
                  onExpansionChange={onExpansionChange}
                  selectedRatioId={selectedRatioId}
                  onSelectRatioId={outpaintRatioId => onDraftChange({ outpaintRatioId })}
                  isBusy={isBusy}
                />

                {/* 快捷像素加减 */}
                <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 128, right: 128, bottom: 128, left: 128 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {t("四周 +128px")}</button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 64, right: 64, bottom: 64, left: 64 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {t("四周 +64px")}</button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 0, right: 128, bottom: 0, left: 128 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {t("左右 +128px")}</button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 0, right: 0, bottom: 0, left: 0 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {t("清零重置")}</button>
                </div>

                {/* 四周像素精确数值调节 */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                    <label key={side} className="text-meta text-gray-500 dark:text-gray-400">
                      {({ top: t("上 (top)"), right: t("右 (right)"), bottom: t("下 (bottom)"), left: t("左 (left)") } as const)[side]}
                      <input
                        disabled={isBusy}
                        type="number"
                        min="0"
                        step="64"
                        value={expansion[side]}
                        onChange={event => setCustomExpansion({ ...expansion, [side]: Math.max(0, Number(event.target.value) || 0) })}
                        className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                      />
                    </label>
                  ))}
                </div>
                <button
                  disabled={isBusy || expansionApplied}
                  type="button"
                  onClick={onApplyOutpaint}
                  className="mt-3 h-9 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow transition hover:bg-indigo-500 disabled:opacity-40"
                >
                  {expansionApplied && Object.values(appliedExpansion).some(Boolean) ? t("画布扩展已应用") : Object.values(appliedExpansion).some(Boolean) ? t("更新画布扩展") : t("应用画布扩展")}
                </button>
              </div>

              {/* 隐藏画布 ref 挂载 */}
              <div className="hidden" aria-hidden="true">
                <ImageEditCanvas {...canvasProps} />
              </div>

              {/* 手动调整蒙版开关 */}
              <button
                type="button"
                role="switch"
                aria-checked={manualMaskEditing}
                disabled={isBusy || safeMode}
                onClick={() => onManualMaskEditingChange(!manualMaskEditing)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-xs font-semibold text-gray-600 transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-700"
              >
                <span>
                  <span className="block">{t("手动调整蒙版")}</span>
                  <span className="mt-0.5 block text-micro font-normal text-gray-400">{t("自动蒙版：新增区域 + 32px 接缝")}</span>
                </span>
                <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${manualMaskEditing ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${manualMaskEditing ? 'translate-x-4' : 'translate-x-0'}`} />
                </span>
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("编辑画板")}</span>

              </div>
              <ImageEditCanvas {...canvasProps} />
              {/* 画板直接交互工具栏（画笔/橡皮擦/笔刷大小/撤销重做等） */}
              <div className="mt-3">
                {renderMaskToolbox()}
              </div>
              {operation === 'outpaint' && (
                <div className="mt-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={manualMaskEditing}
                    disabled={isBusy || safeMode}
                    onClick={() => onManualMaskEditingChange(!manualMaskEditing)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-xs font-semibold text-gray-600 transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-700"
                  >
                    <span>
                      <span className="block">{t("手动调整蒙版")}</span>
                    </span>
                    <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${manualMaskEditing ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${manualMaskEditing ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          {normalization && (operation !== 'image-to-image' || sizeMode === 'original') && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"><div className="font-semibold">{t("底图尺寸需要规范化")}</div><div className="mt-1 leading-5">{t("当前 {0} × {1}，需调整为 {2} × {3}", [normalization.sourceWidth, normalization.sourceHeight, normalization.targetWidth, normalization.targetHeight])}</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><button disabled={isBusy} type="button" onClick={() => onNormalize('crop')} className="rounded-md bg-amber-100 px-2 py-1.5 font-semibold hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:hover:bg-amber-900">{t("居中裁剪（推荐）")}</button><button disabled={isBusy} type="button" onClick={() => onNormalize('contain')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">{t("完整保留并填充")}</button><button disabled={isBusy} type="button" onClick={() => onNormalize('stretch')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">{t("直接缩放")}</button></div></div>}
        </section>
      </LabModuleSection>

      <LabModuleSection moduleId="params" label={t("参数设置")} order={getModuleOrder(layout, 'params')} defaultCollapsed={isModuleCollapsed(layout, 'params')} className={mobileTab === 'params' ? 'block' : 'hidden lg:block'}>
        {operation === 'image-to-image' && <div className="mb-4 space-y-2 text-xs">
          <label className="flex items-center justify-between gap-2 font-semibold text-gray-600 dark:text-gray-300">
            {t("输出尺寸")}<select aria-label={t("图生图输出尺寸")} disabled={isBusy} value={sizeMode} onChange={event => onDraftChange({ imageToImageSizeMode: event.target.value as ImageToImageSizeMode })} className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800">
              <option value="original">{t("保留底图尺寸")}</option>
              <option value="free">{t("等比缩至免费像素范围")}</option>
              <option value="custom">{t("自定义尺寸")}</option>
            </select>
          </label>
          {sizeMode === 'custom' && <div className="grid grid-cols-2 gap-2">
            {(['width', 'height'] as const).map(dimension => <label key={dimension} className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              {dimension === 'width' ? t("宽度") : t("高度")}
              <input type="number" aria-label={t("图生图输出{0}", [dimension === 'width' ? t('宽度') : t('高度')])} min={IMAGE_EDIT_MIN_DIMENSION} max={IMAGE_EDIT_MAX_DIMENSION} step={IMAGE_EDIT_MIN_DIMENSION} disabled={isBusy} value={selectableParams[dimension]} onChange={event => onDraftChange({ params: { ...selectableParams, [dimension]: Number(event.target.value) } })} className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800" />
            </label>)}
          </div>}
          {canvasProps.width > 0 && <div className="text-gray-500 dark:text-gray-400">{t("底图 {0} × {1} → 输出 {2} × {3}", [canvasProps.width, canvasProps.height, outputSize.width, outputSize.height])}</div>}
          {sizeMode === 'custom' && validateImageEditDimensions(outputSize.width, outputSize.height) && <div role="status" className="text-amber-700 dark:text-amber-300">{validateImageEditDimensions(outputSize.width, outputSize.height)}</div>}
          {sizeMode !== 'original' && <div className="text-gray-500 dark:text-gray-400">{t("等比保留底图，比例不同处填白。{0}", [sizeMode === 'free' && t("仅调整像素范围，实际费用见生成按钮。")])}</div>}
        </div>}
        <ChainEditorParams params={selectableParams} prompt={draft.prompt} setParams={params => onDraftChange({ params })} canEdit={!isBusy} markChange={() => undefined} hideResolution mode={operation} forceEmptySeed={forceEmptySeed} enforceFreeStepLimit={enforceFreeStepLimit} />
      </LabModuleSection>

      <LabModuleSection moduleId="editSettings" label={t("编辑参数")} order={getModuleOrder(layout, 'editSettings')} defaultCollapsed={isModuleCollapsed(layout, 'editSettings')} className={mobileTab === 'params' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Strength</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                aria-label={t("Strength 数值")}
                disabled={isBusy}
                value={Number(strength.toFixed(2))}
                onChange={event => onStrengthChange(Math.max(0, Math.min(1, parseFloat(event.target.value) || 0)))}
                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
              />
            </div>
            <input disabled={isBusy} type="range" min="0" max="1" step="0.01" aria-label="Strength" value={strength} onChange={event => onStrengthChange(Number(event.target.value))} className="w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Noise</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                aria-label={t("Noise 数值")}
                disabled={isBusy}
                value={Number(noise.toFixed(2))}
                onChange={event => onNoiseChange(Math.max(0, Math.min(1, parseFloat(event.target.value) || 0)))}
                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
              />
            </div>
            <input disabled={isBusy} type="range" min="0" max="1" step="0.01" aria-label="Noise" value={noise} onChange={event => onNoiseChange(Number(event.target.value))} className="w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" />
          </div>
          {(operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing)) && <>
            {operation === 'inpaint' && <label className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>{t("聚焦重绘")}</span><input disabled={isBusy || safeMode} type="checkbox" checked={focused} onChange={event => onFocusedChange(event.target.checked)} className="h-4 w-4 accent-amber-500" /></label>}
            {focused && <div className="space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("最小上下文")}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="32"
                      max="96"
                      step="8"
                      aria-label={t("最小上下文数值")}
                      disabled={isBusy || safeMode}
                      value={minimumContextArea}
                      onChange={event => onMinimumContextAreaChange(Math.max(32, Math.min(96, parseInt(event.target.value, 10) || 32)))}
                      className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-amber-600 outline-none transition focus:border-amber-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-amber-400 dark:focus:border-amber-400 dark:focus:bg-gray-900"
                    />
                    <span className="font-mono text-xs text-gray-400">px</span>
                  </div>
                </div>
                <input disabled={isBusy || safeMode} type="range" min="32" max="96" step="8" aria-label={t("最小上下文")} value={minimumContextArea} onChange={event => onMinimumContextAreaChange(Number(event.target.value))} className="w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-45" />
              </div>
            </div>}
          </>}
        </section>
      </LabModuleSection>

      {supportsCharacterReference && <LabModuleSection moduleId="characterReference" label={t("角色参考")} order={getModuleOrder(layout, 'characterReference')} defaultCollapsed={isModuleCollapsed(layout, 'characterReference')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <CharacterReferenceManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} notify={notify} operation={operation} />
      </LabModuleSection>}

      {supportsVibe && <LabModuleSection moduleId="vibe" label="Vibe Transfer" order={getModuleOrder(layout, 'vibe')} defaultCollapsed={isModuleCollapsed(layout, 'vibe')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <VibeManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} apiKey={apiKey} notify={notify} operation={operation} />
      </LabModuleSection>}
    </div>
  </div>
  </>;
};
