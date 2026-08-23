import React from 'react';
import { Contrast, Eraser, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, NAIParams } from '../types';
import { ChainEditorParams } from './ChainEditorParams';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { VibeManager } from './VibeManager';

interface ImageEditControlsProps {
  operation: ImageEditOperation;
  draft: LabImageEditDraft;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  selectableParams: NAIParams;
  strength: number;
  noise: number;
  brushSize: number;
  focused: boolean;
  minimumContextArea: number;
  tool: 'brush' | 'eraser';
  expansion: ImageEditCanvasExpansion;
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
  onClearMask: () => void;
  onInvertMask: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExpansionChange: (value: ImageEditCanvasExpansion) => void;
  onApplyOutpaint: () => void;
}

const getOperationLabel = (operation: ImageEditOperation) => operation === 'image-to-image' ? '图生图' : operation === 'inpaint' ? '局部重绘' : '扩图';

export const ImageEditControls: React.FC<ImageEditControlsProps> = ({
  operation, draft, fileInputRef, selectableParams, strength, noise, brushSize, focused, minimumContextArea, tool, expansion, apiKey, notify,
  onPromptChange, onNegativePromptChange, onPromptSource, onDraftChange, onFileChange, onStrengthChange, onNoiseChange, onBrushSizeChange, onFocusedChange,
  onMinimumContextAreaChange, onToolChange, onClearMask, onInvertMask, onUndo, onRedo, onExpansionChange, onApplyOutpaint,
}) => (
  <div className="chain-editor-main order-2 flex min-h-full w-full shrink-0 flex-col border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:order-1 lg:w-1/2 lg:flex-1 lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-24 md:p-6 md:pb-24">
      <section className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100">提示词输入</label><span className="text-[10px] text-gray-400">{getOperationLabel(operation)} · 本次编辑独立保存</span></div>
          <textarea value={draft.prompt} onChange={event => onPromptChange(event.target.value)} className="min-h-28 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="输入本次实际要生成的完整提示词" />
          <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => onPromptSource('current')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">当前完整 Prompt</button><button type="button" onClick={() => onPromptSource('style-only')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">仅保留风格串</button><button type="button" onClick={() => onPromptSource('history')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">历史 Prompt</button><button type="button" onClick={() => onPromptSource('custom')} className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">清空 Prompt</button></div>
        </div>
        <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">全局负面提示词<textarea value={draft.negativePrompt} onChange={event => onNegativePromptChange(event.target.value)} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-indigo-500/50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="输入本次负面提示词" /></label>
      </section>
      <section className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/45">
        <div className="mb-3 flex items-center justify-between gap-3"><label className="text-sm font-semibold text-gray-800 dark:text-gray-100">底图</label>{draft.baseImageSource === 'history' && <span className="truncate text-[10px] text-gray-400">历史图片</span>}</div>
        <div className="flex items-center gap-2"><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileChange} /><button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-xs font-semibold text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><ImagePlus className="h-4 w-4" />导入 PNG / JPEG / WebP</button><span className="text-[11px] text-gray-500 dark:text-gray-400">不会自动写入历史记录</span></div>
      </section>
      <ChainEditorParams params={selectableParams} setParams={params => onDraftChange({ params })} canEdit markChange={() => undefined} />
      <section className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/45">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">编辑参数</div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Strength <span className="float-right font-mono">{strength.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={strength} onChange={event => onStrengthChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Noise <span className="float-right font-mono">{noise.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={noise} onChange={event => onNoiseChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
        {operation !== 'image-to-image' && <>
          <label className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>Focused Inpainting</span><input type="checkbox" checked={focused} onChange={event => onFocusedChange(event.target.checked)} className="h-4 w-4 accent-amber-500" /></label>
          {!focused && <div className="flex items-center gap-2"><button type="button" onClick={() => onToolChange('brush')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs ${tool === 'brush' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}>画笔</button><button type="button" onClick={() => onToolChange('eraser')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs ${tool === 'eraser' ? 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}><Eraser className="h-3.5 w-3.5" />橡皮擦</button></div>}
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{focused ? '框选区域' : '笔刷大小'} {!focused && <span className="float-right font-mono">{brushSize}px</span>}{!focused && <input type="range" min="8" max="512" step="4" value={brushSize} onChange={event => onBrushSizeChange(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" />}</label>
          {focused && <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">最小参照范围 <span className="float-right font-mono">{Math.round(minimumContextArea * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={minimumContextArea} onChange={event => onMinimumContextAreaChange(Number(event.target.value))} className="mt-2 w-full accent-amber-500" /></label>}
          <div className="grid grid-cols-4 gap-1"><button type="button" onClick={onUndo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="撤销"><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={onRedo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="重做"><RotateCw className="h-4 w-4" /></button><button type="button" onClick={onClearMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="清空蒙版"><Trash2 className="h-4 w-4" /></button><button type="button" onClick={onInvertMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="反转蒙版"><Contrast className="h-4 w-4" /></button></div>
        </>}
        {operation === 'outpaint' && <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"><div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">扩展画布（像素）</div><div className="grid grid-cols-2 gap-2">{(['top', 'right', 'bottom', 'left'] as const).map(side => <label key={side} className="text-[11px] text-gray-500 dark:text-gray-400">{({ top: '上', right: '右', bottom: '下', left: '左' } as const)[side]}<input type="number" min="0" step="64" value={expansion[side]} onChange={event => onExpansionChange({ ...expansion, [side]: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900" /></label>)}</div><button type="button" onClick={onApplyOutpaint} className="mt-3 h-9 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500">应用画布扩展</button></div>}
      </section>
      <VibeManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} apiKey={apiKey} notify={notify} />
      <CharacterReferenceManager params={selectableParams} setParams={params => onDraftChange({ params })} markChange={() => undefined} notify={notify} />
    </div>
  </div>
);
