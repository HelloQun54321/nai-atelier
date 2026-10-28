import React from 'react';
import { Copy, Crop, Eraser, ImagePlus, Lasso, MousePointer2, Pentagon, Redo2, RotateCcw, Scissors, SquareDashedMousePointer, Trash2, Undo2, X } from 'lucide-react';
import type { CanvasTool } from '../../services/canvasTypes';
import { IconButton, ToolbarButton } from '../DesignSystem';

export interface CanvasToolsProps {
  tool: CanvasTool; onToolChange: (tool: CanvasTool) => void;
  brushSize: number; onBrushSizeChange: (n: number) => void; onImport: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  hasSelection: boolean; hasDraftSelection?: boolean; hasLayer: boolean; onCopy: () => void; onCopyMerged: () => void;
  onCut: () => void; onDeleteSelection: () => void; onCropLayer: () => void;
  onCropCanvas: () => void; onClearSelection: () => void;
}

const buttonClass = '!h-9 !w-full !justify-start !px-2 !text-xs';
const tools = [
  ['move', '移动', MousePointer2], ['rectangle', '矩形选区', SquareDashedMousePointer],
  ['polygon', '多边形选区', Pentagon], ['lasso', '自由套索', Lasso],
  ['erase', '橡皮擦', Eraser], ['restore', '恢复笔刷', RotateCcw],
] as const;

export function CanvasTools(props: CanvasToolsProps) {
  const { tool, hasSelection, hasLayer } = props;
  return <div className="flex w-36 flex-col gap-1 p-2" aria-label="画布工具">
    <ToolbarButton className={buttonClass} onClick={props.onImport}><ImagePlus size={15} />导入图片</ToolbarButton>
    <div className="flex gap-1">
      <IconButton label="撤销" className="!h-9 !w-9" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={15} /></IconButton>
      <IconButton label="重做" className="!h-9 !w-9" disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={15} /></IconButton>
    </div>
    <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
    {tools.map(([value, label, Icon]) => <ToolbarButton key={value} active={tool === value} aria-pressed={tool === value} onClick={() => props.onToolChange(value)} className={buttonClass}><Icon size={15} />{label}</ToolbarButton>)}
    {(tool === 'erase' || tool === 'restore') && <label className="mt-1 flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">大小<input aria-label="笔刷大小" type="number" min={1} step={1} value={props.brushSize} onChange={e => { const n = Number(e.currentTarget.value); if (Number.isFinite(n) && n > 0) props.onBrushSizeChange(n); }} className="w-16 rounded border border-gray-200 bg-transparent px-1 py-1 dark:border-gray-700" /></label>}
    <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
    <ToolbarButton className={buttonClass} disabled={!hasSelection || !hasLayer} onClick={props.onCopy}><Copy size={15} />复制选区</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection} onClick={props.onCopyMerged}><Copy size={15} />复制合并内容</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection || !hasLayer} onClick={props.onCut}><Scissors size={15} />剪切选区</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection || !hasLayer} onClick={props.onDeleteSelection}><Trash2 size={15} />删除选区内容</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection || !hasLayer} onClick={props.onCropLayer}><Crop size={15} />剪裁图层</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection} onClick={props.onCropCanvas}><Crop size={15} />剪裁画布</ToolbarButton>
    <ToolbarButton className={buttonClass} disabled={!hasSelection && !props.hasDraftSelection} onClick={props.onClearSelection}><X size={15} />取消选区</ToolbarButton>
  </div>;
}
