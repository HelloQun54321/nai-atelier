import React from 'react';
import { Contrast, Eraser, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, NAIParams } from '../types';
import { DEFAULT_LAB_PAGE_LAYOUTS, LabPageLayout } from '../services/appearancePreferences';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { ImageEditNormalizationMode } from '../services/imageEdit';
import { ChainEditorParams } from './ChainEditorParams';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { LabModuleSection } from './LabModuleSection';
import { VibeManager } from './VibeManager';

interface ImageEditControlsProps {
  operation: ImageEditOperation;
  draft: LabImageEditDraft;
  layout?: LabPageLayout;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  selectableParams: NAIParams;
  strength: number;
  noise: number;
  brushSize: number;
  focused: boolean;
  minimumContextArea: number;
  tool: 'brush' | 'eraser';
  manualMaskEditing?: boolean;
  expansion: ImageEditCanvasExpansion;
  canvasSize?: { width: number; height: number };
  isBusy?: boolean;
  safeMode?: boolean;
  apiKey: string;
  notify: (message: string, type?: 'success' | 'error') => void;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onPromptSource: (source: LabImageEditDraft['promptSource']) => void;
  onDraftChange: (patch: Partial<LabImageEditDraft> & { maskData?: string }) => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStrengthChange: (value: number) => void;
  onNoiseChange: (value: number) => void;
  onBrushSizeChange: (value: number) => void;
  onFocusedChange: (value: boolean) => void;
  onMinimumContextAreaChange: (value: number) => void;
  onToolChange: (value: 'brush' | 'eraser') => void;
  onManualMaskEditingChange?: (value: boolean) => void;
  onClearMask: () => void;
  onInvertMask: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExpansionChange: (value: ImageEditCanvasExpansion) => void;
  onApplyOutpaint: () => void;
  onResetFocusedRect?: () => void;
  normalization?: { sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number } | null;
  onNormalize?: (mode: ImageEditNormalizationMode) => void;
}

const getOperationLabel = (operation: ImageEditOperation) => operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';

const getModuleOrder = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => layout.order.indexOf(moduleId);
const isModuleCollapsed = (layout: LabPageLayout, moduleId: keyof LabPageLayout['collapsed']) => Boolean(layout.collapsed[moduleId]);

export const ImageEditControls: React.FC<ImageEditControlsProps> = ({
  operation, draft, layout = DEFAULT_LAB_PAGE_LAYOUTS[operation], fileInputRef, selectableParams, strength, noise, brushSize, focused, minimumContextArea, tool, expansion, canvasSize = { width: 0, height: 0 }, isBusy = false, safeMode = false, apiKey, notify,
  onPromptChange, onNegativePromptChange, onPromptSource, onDraftChange, onFileChange, onStrengthChange, onNoiseChange, onBrushSizeChange, onFocusedChange,
  onMinimumContextAreaChange, onToolChange, manualMaskEditing = false, onManualMaskEditingChange = () => undefined, onClearMask, onInvertMask, onUndo, onRedo, onExpansionChange, onApplyOutpaint, onResetFocusedRect = () => undefined, normalization = null, onNormalize = () => undefined,
}) => {
  const runtime = useNaiRuntime();
  const modelInfo = getRuntimeNaiModelInfo(selectableParams.model, runtime);
  const supportsVibe = operation === 'image-to-image' && modelInfo.supportsVibes;
  const supportsCharacterReference = operation === 'image-to-image'
    ? modelInfo.supportsCharacterReferences
    : modelInfo.supportsCharacterReferenceInpainting;

  return <div className="chain-editor-main order-2 flex min-h-full w-full shrink-0 flex-col border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:order-1 lg:w-1/2 lg:flex-1 lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-24 md:p-6 md:pb-24">
      <LabModuleSection moduleId="prompt" label="提示词输入" order={getModuleOrder(layout, 'prompt')} defaultCollapsed={isModuleCollapsed(layout, 'prompt')}>
        <section className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100">提示词输入</label><span className="text-[10px] text-gray-400">{getOperationLabel(operation)} · 本次编辑独立保存</span></div>
            <textarea disabled={isBusy} value={draft.prompt} onChange={event => onPromptChange(event.target.value)} className="min-h-28 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="输入本次实际要生成的完整提示词" />
            <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => onPromptSource('current')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">当前完整 Prompt</button><button type="button" onClick={() => onPromptSource('style-only')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">仅保留风格串</button><button type="button" onClick={() => onPromptSource('history')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">历史 Prompt</button><button type="button" onClick={() => onPromptSource('custom')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">清空 Prompt</button></div>
          </div>
          <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">全局负面提示词<textarea disabled={isBusy} value={draft.negativePrompt} onChange={event => onNegativePromptChange(event.target.value)} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="输入本次负面提示词" /></label>
        </section>
      </LabModuleSection>

      <LabModuleSection moduleId="baseImage" label="底图与导入" order={getModuleOrder(layout, 'baseImage')} defaultCollapsed={isModuleCollapsed(layout, 'baseImage')}>
        <section className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/45">
          <div className="mb-3 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100">底图</label>{draft.baseImageSource === 'history' && <span className="truncate text-[10px] text-gray-400">历史图片</span>}</div>
          <div className="flex items-center gap-2"><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileChange} /><button disabled={isBusy} type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-xs font-semibold text-gray-700 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><ImagePlus className="h-4 w-4" />导入 PNG / JPEG / WebP</button><span className="text-[11px] text-gray-500 dark:text-gray-400">不会自动写入历史记录</span></div>
          {normalization && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"><div className="font-semibold">底图尺寸需要规范化</div><div className="mt-1 leading-5">当前 {normalization.sourceWidth} × {normalization.sourceHeight}，编辑接口建议使用 {normalization.targetWidth} × {normalization.targetHeight}。请选择处理方式后再生成。</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><button disabled={isBusy} type="button" onClick={() => onNormalize('crop')} className="rounded-md bg-amber-100 px-2 py-1.5 font-semibold hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/50 dark:hover:bg-amber-900">居中裁剪（推荐）</button><button disabled={isBusy} type="button" onClick={() => onNormalize('contain')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">完整保留并填充</button><button disabled={isBusy} type="button" onClick={() => onNormalize('stretch')} className="rounded-md bg-white/80 px-2 py-1.5 font-semibold hover:bg-white disabled:opacity-50 dark:bg-gray-900/60 dark:hover:bg-gray-900">直接缩放</button></div></div>}
        </section>
      </LabModuleSection>

      <LabModuleSection moduleId="params" label="参数设置" order={getModuleOrder(layout, 'params')} defaultCollapsed={isModuleCollapsed(layout, 'params')}>
        <ChainEditorParams params={selectableParams} setParams={params => onDraftChange({ params })} canEdit={!isBusy} markChange={() => undefined} hideResolution imageEditSize={canvasSize} mode={operation} />
      </LabModuleSection>

      <LabModuleSection moduleId="editSettings" label="编辑参数" order={getModuleOrder(layout, 'editSettings')} defaultCollapsed={isModuleCollapsed(layout, 'editSettings')}>
        <section className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/45">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">编辑参数</div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Strength <span className="float-right font-mono">{strength.toFixed(2)}</span><input disabled={isBusy} type="range" min="0" max="1" step="0.01" value={strength} onChange={event => onStrengthChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Noise <span className="float-right font-mono">{noise.toFixed(2)}</span><input disabled={isBusy} type="range" min="0" max="1" step="0.01" value={noise} onChange={event => onNoiseChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
          {operation === 'outpaint' && <>
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"><div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">扩展画布（像素）</div><div className="grid grid-cols-2 gap-2">{(['top', 'right', 'bottom', 'left'] as const).map(side => <label key={side} className="text-[11px] text-gray-500 dark:text-gray-400">{({ top: '上', right: '右', bottom: '下', left: '左' } as const)[side]}<input disabled={isBusy} type="number" min="0" step="64" value={expansion[side]} onChange={event => onExpansionChange({ ...expansion, [side]: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label>)}</div><button disabled={isBusy} type="button" onClick={onApplyOutpaint} className="mt-3 h-9 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">应用画布扩展</button></div>
            <button type="button" role="switch" aria-checked={manualMaskEditing} disabled={isBusy || safeMode} onClick={() => onManualMaskEditingChange(!manualMaskEditing)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-xs font-semibold text-gray-600 transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-700"><span><span className="block">手动调整蒙版</span><span className="mt-0.5 block text-[10px] font-normal text-gray-400">默认只生成新增边缘；开启后可用画笔修正接缝区域</span></span><span className={`relative h-5 w-9 flex-none rounded-full transition-colors ${manualMaskEditing ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${manualMaskEditing ? 'translate-x-4' : 'translate-x-0'}`} /></span></button>
          </>}
          {(operation === 'inpaint' || operation === 'outpaint' && manualMaskEditing) && <>
            {safeMode && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">安全模式已开启，蒙版画笔暂不可用；关闭安全模式后可继续编辑。</div>}
            {operation === 'inpaint' && <label className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>Focused Inpainting</span><input disabled={isBusy || safeMode} type="checkbox" checked={focused} onChange={event => onFocusedChange(event.target.checked)} className="h-4 w-4 accent-amber-500" /></label>}
            <div className="flex items-center gap-2"><button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('brush')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'brush' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}>画笔</button><button disabled={isBusy || safeMode} type="button" onClick={() => onToolChange('eraser')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs disabled:cursor-not-allowed disabled:opacity-45 ${tool === 'eraser' ? 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}><Eraser className="h-3.5 w-3.5" />橡皮擦</button></div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{focused ? '框选区域后在内部绘制蒙版' : '笔刷大小'} {!focused && <span className="float-right font-mono">{brushSize}px</span>}{!focused && <input disabled={isBusy || safeMode} type="range" min="8" max="512" step="4" value={brushSize} onChange={event => onBrushSizeChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-45" />}</label>
            {focused && <div className="space-y-2"><label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">最小上下文 <span className="float-right font-mono">{minimumContextArea}px</span><input disabled={isBusy || safeMode} type="range" min="32" max="96" step="8" value={minimumContextArea} onChange={event => onMinimumContextAreaChange(Number(event.target.value))} className="mt-2 w-full accent-amber-500 disabled:cursor-not-allowed disabled:opacity-45" /></label><button disabled={isBusy || safeMode} type="button" onClick={onResetFocusedRect} className="h-8 w-full rounded-lg bg-amber-50 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-950/30 dark:text-amber-300">重新框选区域</button></div>}
            <div className="grid grid-cols-4 gap-1"><button disabled={isBusy || safeMode} type="button" onClick={onUndo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="撤销"><RotateCcw className="h-4 w-4" /></button><button disabled={isBusy || safeMode} type="button" onClick={onRedo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="重做"><RotateCw className="h-4 w-4" /></button><button disabled={isBusy || safeMode} type="button" onClick={onClearMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="清空蒙版"><Trash2 className="h-4 w-4" /></button><button disabled={isBusy || safeMode} type="button" onClick={onInvertMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300 disabled:cursor-not-allowed disabled:opacity-45" title="反转蒙版"><Contrast className="h-4 w-4" /></button></div>
          </>}
        </section>
      </LabModuleSection>

      {supportsCharacterReference && <LabModuleSection moduleId="characterReference" label="角色参考" order={getModuleOrder(layout, 'characterReference')} defaultCollapsed={isModuleCollapsed(layout, 'characterReference')}>
        <CharacterReferenceManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} notify={notify} operation={operation} />
      </LabModuleSection>}

      {supportsVibe && <LabModuleSection moduleId="vibe" label="Vibe Transfer" order={getModuleOrder(layout, 'vibe')} defaultCollapsed={isModuleCollapsed(layout, 'vibe')}>
        <VibeManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} apiKey={apiKey} notify={notify} operation={operation} />
      </LabModuleSection>}
    </div>
  </div>;
};
