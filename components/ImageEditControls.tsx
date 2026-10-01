import React from 'react';
import { ClipboardPaste, Contrast, Eraser, ImagePlus, Images, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, LocalGenItem, NAIParams } from '../types';
import { DEFAULT_LAB_PAGE_LAYOUTS, LabPageLayout } from '../services/appearancePreferences';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { ImageEditNormalizationMode, isSameOutpaintExpansion } from '../services/imageEdit';
import { ChainEditorParams } from './ChainEditorParams';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { ImageEditCanvas, ImageEditCanvasProps } from './ImageEditCanvas';
import { LabModuleSection } from './LabModuleSection';
import { OutpaintCanvasStage } from './OutpaintCanvasStage';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { VibeManager } from './VibeManager';
import { useLowConsumption } from '../services/lowConsumption';
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

const getOperationLabel = (operation: ImageEditOperation) => operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';

const getModuleOrder = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => layout.order.indexOf(moduleId);
const isModuleCollapsed = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => Boolean(layout.collapsed[moduleId]);

export const ImageEditControls: React.FC<ImageEditControlsProps> = ({
  operation, draft, layout = DEFAULT_LAB_PAGE_LAYOUTS[operation], fileInputRef, canvasProps, latestTextToImageItem, selectableParams, strength, noise, brushSize, focused, minimumContextArea, tool, expansion, outpaintSourceSize, isBusy = false, safeMode = false, tagAssistEnabled, forceEmptySeed = false, enforceFreeStepLimit = true, apiKey, baseImagePreview, notify,
  onPromptChange, onNegativePromptChange, onDraftChange, onFileChange, onPasteImage, onSelectImageSource, onStrengthChange, onNoiseChange, onBrushSizeChange, onFocusedChange,
  onMinimumContextAreaChange, onToolChange, manualMaskEditing = false, onManualMaskEditingChange = () => undefined, onClearMask, onInvertMask, onUndo, onRedo, onExpansionChange, onApplyOutpaint, onResetFocusedRect = () => undefined, normalization = null, onNormalize = () => undefined,
  mobileTab = 'canvas',
}) => {
  const selectedRatioId = draft.outpaintRatioId || (Object.values(draft.expansion).some(Boolean) ? 'custom' : '16:9');
  const sourceSize = outpaintSourceSize || { width: canvasProps.width, height: canvasProps.height };
  const appliedExpansion = draft.appliedExpansion || { top: 0, right: 0, bottom: 0, left: 0 };
  const expansionApplied = isSameOutpaintExpansion(expansion, appliedExpansion);
  const setCustomExpansion = (value: ImageEditCanvasExpansion) => {
    onDraftChange({ outpaintRatioId: 'custom' });
    onExpansionChange(value);
  };

  const runtime = useNaiRuntime();
  const modelInfo = getRuntimeNaiModelInfo(selectableParams.model, runtime);
  const lowConsumption = useLowConsumption();
  const supportsVibe = operation === 'image-to-image' && modelInfo.supportsVibes;
  const supportsCharacterReference = operation === 'image-to-image'
    ? modelInfo.supportsCharacterReferences
    : modelInfo.supportsCharacterReferenceInpainting;

  /** 蒙版画笔与操作工具栏：移动端挂在画板正下方，桌面端挂在编辑参数模块内 */
  const renderMaskToolbox = () => {
    if (!(operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing))) return null;
    return (
      <div className="space-y-3 pt-1">
        {safeMode && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-meta leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">安全模式已开启，蒙版画笔暂不可用；关闭安全模式后可继续编辑。</div>}
        <div className="flex items-center gap-2">
          <button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('brush')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'brush' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}>画笔</button>
          <button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('eraser')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'eraser' ? 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}><Eraser className="h-3.5 w-3.5" />橡皮擦</button>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{focused ? '框选区域后在内部绘制蒙版' : '笔刷大小'}</label>
            {!focused && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="8"
                  max="512"
                  step="4"
                  aria-label="笔刷大小数值"
                  disabled={isBusy || safeMode}
                  value={brushSize}
                  onChange={event => onBrushSizeChange(Math.max(8, Math.min(512, parseInt(event.target.value, 10) || 8)))}
                  className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
                />
                <span className="font-mono text-xs text-gray-400">px</span>
              </div>
            )}
          </div>
          {!focused && <input disabled={isBusy || safeMode} type="range" min="8" max="512" step="4" aria-label="笔刷大小" value={brushSize} onChange={event => onBrushSizeChange(Number(event.target.value))} className="w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-45" />}
        </div>
        {focused && (
          <button disabled={isBusy || safeMode} type="button" onClick={onResetFocusedRect} className="h-8 w-full rounded-lg bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-950/30 dark:text-amber-300">重新框选区域</button>
        )}
        <div className="grid grid-cols-4 gap-1">
          <button disabled={isBusy || safeMode} type="button" onClick={onUndo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="撤销"><RotateCcw className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onRedo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="重做"><RotateCw className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onClearMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="清空蒙版"><Trash2 className="h-4 w-4" /></button>
          <button disabled={isBusy || safeMode} type="button" onClick={onInvertMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="反转蒙版"><Contrast className="h-4 w-4" /></button>
        </div>
      </div>
    );
  };

  return <><div className="chain-editor-main order-2 flex min-h-full w-full shrink-0 flex-col border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:order-1 lg:w-1/2 lg:flex-1 lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-24 md:p-6 md:pb-24">
      <LabModuleSection moduleId="prompt" label="全局提示词" order={getModuleOrder(layout, 'prompt')} defaultCollapsed={isModuleCollapsed(layout, 'prompt')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {operation === 'outpaint' ? '扩图提示词' : operation === 'inpaint' ? '重绘提示词' : '图生图提示词'}
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-meta font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  {draft.promptSource === 'history' ? '底图原提示词' : draft.promptSource === 'current' ? '文生图提示词' : '自定义编辑提示词'}
                </span>
                <span className="text-micro text-gray-400">{getOperationLabel(operation)} · 独立保存</span>
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
                  ? '输入扩图提示词（建议保留原图场景描述，AI 将在扩展区域继续绘制）'
                  : operation === 'inpaint'
                  ? '输入重绘提示词（AI 将仅在涂抹区域根据提示词生成内容）'
                  : '输入图生图提示词'
              }
            />
          </div>
          <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">全局负面提示词<TagAutocompleteTextarea tagAssistEnabled={tagAssistEnabled} disabled={isBusy} value={draft.negativePrompt} onValueChange={onNegativePromptChange} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="输入本次负面提示词" /></label>
        </section>
      </LabModuleSection>

      <ChainEditorCharacters
        params={selectableParams}
        setParams={params => onDraftChange({ params })}
        characters={selectableParams.characters || []}
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
        updateCharacter={(index, patch) => onDraftChange({ params: { ...selectableParams,
          characters: (selectableParams.characters || []).map((character, currentIndex) => currentIndex === index ? { ...character, ...patch } : character),
        } })}
        removeCharacter={index => onDraftChange({ params: { ...selectableParams,
          characters: (selectableParams.characters || []).filter((_, currentIndex) => currentIndex !== index),
        } })}
        coordinateHint={operation === 'outpaint' ? '角色位置以原图为准，扩展画布后自动换算' : undefined}
      />

      <LabModuleSection moduleId="baseImage" label="底图与导入" order={getModuleOrder(layout, 'baseImage')} defaultCollapsed={isModuleCollapsed(layout, 'baseImage')} className={mobileTab === 'canvas' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-3">
          <div className="mb-3 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100">底图来源</label><span className="truncate text-micro text-gray-400">{draft.baseImageSource === 'history' ? '历史图片' : draft.baseImageSource === 'inspiration' ? '灵感库' : draft.baseImageSource === 'generated' ? '文生图结果' : draft.baseImageSource === 'upload' ? '本地上传' : draft.baseImageSource === 'clipboard' ? '剪贴板图片' : '尚未选择'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileChange} />
            <button disabled={isBusy} type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><ImagePlus className="h-4 w-4" />上传图片</button>
            <button disabled={isBusy || !latestTextToImageItem} type="button" onClick={() => latestTextToImageItem && onSelectImageSource(latestTextToImageItem, 'generated')} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" title={latestTextToImageItem ? '使用文生图最近一次生成结果' : '当前没有可用的文生图结果'}><Images className="h-4 w-4" />文生图最新</button>
            <button disabled={isBusy} type="button" onClick={onPasteImage} className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-1 text-xs sm:gap-2 sm:px-3 font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" title="粘贴剪贴板图片，也可在编辑区按 Ctrl+V"><ClipboardPaste className="h-4 w-4" />粘贴</button>
          </div>
          <div className="mt-2 text-meta text-gray-500 dark:text-gray-400">在历史、灵感库或其他模式复制图片后，可直接粘贴或在编辑区按 Ctrl+V；粘贴保留当前提示词与参数。</div>
          {operation === 'image-to-image' ? <>
            {baseImagePreview ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                <div className="relative flex items-center justify-center bg-black/5 p-3 dark:bg-black/20">
                  <img src={baseImagePreview} alt="图生图底图" className="max-h-64 w-auto max-w-full rounded-lg object-contain shadow" />
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-meta text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <span>当前底图 · {canvasProps.width} × {canvasProps.height}</span>
                  <span className="text-micro">生成结果在右侧预览</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white/70 px-3 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">图生图不需要绘制蒙版；请先上传图片、选择文生图最新结果或粘贴图片作为底图。</div>
            )}
            <div className="hidden" aria-hidden="true"><canvas ref={canvasProps.imageCanvasRef} /></div>
          </> : operation === 'outpaint' && !manualMaskEditing ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">智能画幅扩展</span>
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
                    四周 +128px
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 64, right: 64, bottom: 64, left: 64 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    四周 +64px
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 0, right: 128, bottom: 0, left: 128 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    左右 +128px
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCustomExpansion({ top: 0, right: 0, bottom: 0, left: 0 })}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-meta font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                  >
                    清零重置
                  </button>
                </div>

                {/* 四周像素精确数值调节 */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                    <label key={side} className="text-meta text-gray-500 dark:text-gray-400">
                      {({ top: '上 (top)', right: '右 (right)', bottom: '下 (bottom)', left: '左 (left)' } as const)[side]}
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
                  {expansionApplied && Object.values(appliedExpansion).some(Boolean) ? '画布扩展已应用' : Object.values(appliedExpansion).some(Boolean) ? '更新画布扩展' : '应用画布扩展'}
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
                  <span className="block">手动调整蒙版</span>
                  <span className="mt-0.5 block text-micro font-normal text-gray-400">自动重绘新增区域及原图边缘 32px；开启后可微调接缝蒙版</span>
                </span>
                <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${manualMaskEditing ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${manualMaskEditing ? 'translate-x-4' : 'translate-x-0'}`} />
                </span>
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">编辑画板</span>
                <span className="text-micro text-gray-400">{operation === 'inpaint' ? '绘制重绘区域' : '手动调整接缝蒙版'}</span>
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
                      <span className="block">手动调整蒙版</span>
                      <span className="mt-0.5 block text-micro font-normal text-gray-400">关闭后返回画幅模拟摆放台</span>
                    </span>
                    <span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${manualMaskEditing ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${manualMaskEditing ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          {normalization && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"><div className="font-semibold">底图尺寸需要规范化</div><div className="mt-1 leading-5">当前 {normalization.sourceWidth} × {normalization.sourceHeight}，编辑接口建议使用 {normalization.targetWidth} × {normalization.targetHeight}。请选择处理方式后再生成。</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><button disabled={isBusy} type="button" onClick={() => onNormalize('crop')} className="rounded-md bg-amber-100 px-2 py-1.5 font-semibold hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:hover:bg-amber-900">居中裁剪（推荐）</button><button disabled={isBusy} type="button" onClick={() => onNormalize('contain')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">完整保留并填充</button><button disabled={isBusy} type="button" onClick={() => onNormalize('stretch')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">直接缩放</button></div></div>}
        </section>
      </LabModuleSection>

      <LabModuleSection moduleId="params" label="参数设置" order={getModuleOrder(layout, 'params')} defaultCollapsed={isModuleCollapsed(layout, 'params')} className={mobileTab === 'params' ? 'block' : 'hidden lg:block'}>
        <ChainEditorParams params={selectableParams} setParams={params => onDraftChange({ params })} canEdit={!isBusy} markChange={() => undefined} hideResolution mode={operation} forceEmptySeed={forceEmptySeed} enforceFreeStepLimit={enforceFreeStepLimit} />
      </LabModuleSection>

      <LabModuleSection moduleId="editSettings" label="编辑参数" order={getModuleOrder(layout, 'editSettings')} defaultCollapsed={isModuleCollapsed(layout, 'editSettings')} className={mobileTab === 'params' ? 'block' : 'hidden lg:block'}>
        <section className="space-y-4">
          {operation === 'image-to-image' && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-meta leading-5 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-300">
              图生图按整张底图全尺寸计费（面积 × 步数 × Strength），<b>不享受免费档额度</b>；费用在生成前确认弹窗中展示。
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Strength</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                aria-label="Strength 数值"
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
                aria-label="Noise 数值"
                disabled={isBusy}
                value={Number(noise.toFixed(2))}
                onChange={event => onNoiseChange(Math.max(0, Math.min(1, parseFloat(event.target.value) || 0)))}
                className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-600 outline-none transition focus:border-indigo-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-indigo-400 dark:focus:border-indigo-400 dark:focus:bg-gray-900"
              />
            </div>
            <input disabled={isBusy} type="range" min="0" max="1" step="0.01" aria-label="Noise" value={noise} onChange={event => onNoiseChange(Number(event.target.value))} className="w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" />
          </div>
          {(operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing)) && <>
            {operation === 'inpaint' && (lowConsumption.enabled ? <p className="text-xs text-indigo-600 dark:text-indigo-300">低消耗仅使用 Focused 局部重绘，请先框选区域，再绘制蒙版。</p> : <label className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>Focused Inpainting</span><input disabled={isBusy || safeMode} type="checkbox" checked={focused} onChange={event => onFocusedChange(event.target.checked)} className="h-4 w-4 accent-amber-500" /></label>)}
            {focused && <div className="space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">最小上下文</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="32"
                      max="96"
                      step="8"
                      aria-label="最小上下文数值"
                      disabled={isBusy || safeMode}
                      value={minimumContextArea}
                      onChange={event => onMinimumContextAreaChange(Math.max(32, Math.min(96, parseInt(event.target.value, 10) || 32)))}
                      className="w-16 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-amber-600 outline-none transition focus:border-amber-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-amber-400 dark:focus:border-amber-400 dark:focus:bg-gray-900"
                    />
                    <span className="font-mono text-xs text-gray-400">px</span>
                  </div>
                </div>
                <input disabled={isBusy || safeMode} type="range" min="32" max="96" step="8" aria-label="最小上下文" value={minimumContextArea} onChange={event => onMinimumContextAreaChange(Number(event.target.value))} className="w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-45" />
              </div>
            </div>}
          </>}
        </section>
      </LabModuleSection>

      {supportsCharacterReference && !lowConsumption.enabled && <LabModuleSection moduleId="characterReference" label="角色参考" order={getModuleOrder(layout, 'characterReference')} defaultCollapsed={isModuleCollapsed(layout, 'characterReference')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <CharacterReferenceManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} notify={notify} operation={operation} />
      </LabModuleSection>}

      {supportsVibe && <LabModuleSection moduleId="vibe" label="Vibe Transfer" order={getModuleOrder(layout, 'vibe')} defaultCollapsed={isModuleCollapsed(layout, 'vibe')} className={mobileTab === 'prompt' ? 'block' : 'hidden lg:block'}>
        <VibeManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} apiKey={apiKey} notify={notify} operation={operation} />
      </LabModuleSection>}
    </div>
  </div>
  </>;
};
