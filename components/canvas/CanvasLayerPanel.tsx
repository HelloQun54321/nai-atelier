import React from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import type { CanvasImageLayer, CanvasProject } from '../../services/canvasTypes';
import { CanvasNumberField } from './CanvasNumberField';
import { CanvasNameField } from './CanvasNameField';

export interface CanvasLayerPanelProps {
  project: CanvasProject; selectedLayerId: string | null; onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<CanvasImageLayer>) => void;
  onMove: (id: string, direction: 'up' | 'down') => void; onDuplicate: (id: string) => void;
  onDelete: (id: string) => void; onResetCrop: (id: string) => void; onAddEmpty: () => void; onCenter: (id: string) => void;
}
const iconButton = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800';
const textButton = 'rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800';

/** 图层原点在素材左上角，镜像时补偿旋转后的尺寸以保持中心不动。 */
function flipLayer(layer: CanvasImageLayer, axis: 'horizontal' | 'vertical'): Partial<CanvasImageLayer> {
  const angle = layer.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (axis === 'horizontal') {
    const distance = layer.width * layer.scaleX;
    return { x: layer.x + cos * distance, y: layer.y + sin * distance, scaleX: -layer.scaleX };
  }
  const distance = layer.height * layer.scaleY;
  return { x: layer.x - sin * distance, y: layer.y + cos * distance, scaleY: -layer.scaleY };
}

export function CanvasLayerPanel({ project, selectedLayerId, onSelect, onPatch, onMove, onDuplicate, onDelete, onResetCrop, onAddEmpty, onCenter }: CanvasLayerPanelProps) {
  const selected = project.layers.find(layer => layer.id === selectedLayerId);
  const layers = [...project.layers].reverse();
  return <aside aria-label="图层面板" className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 p-2 text-gray-800 dark:border-gray-700 dark:text-gray-100">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">图层</h2><button type="button" aria-label="新建空图层" title="新建空图层" className={iconButton} onClick={onAddEmpty}><Plus size={16} /></button></div>
    <div className="space-y-1">{layers.map((layer, i) => <div key={layer.id} className={`rounded-lg p-1 ${selectedLayerId === layer.id ? 'bg-indigo-100 dark:bg-indigo-900/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onSelect(layer.id)} aria-label={`选择图层 ${layer.name}`} aria-pressed={selectedLayerId === layer.id} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {layer.source ? <img src={layer.source} alt="" className="h-9 w-9 shrink-0 rounded object-contain" /> : <span className="h-9 w-9 shrink-0 rounded bg-gray-100 dark:bg-gray-800" />}
          <span className="min-w-0 truncate text-xs">{layer.name}</span>
        </button>
        <button type="button" aria-label={`${layer.visible ? '隐藏' : '显示'}图层 ${layer.name}`} title={layer.visible ? '隐藏' : '显示'} className={iconButton} onClick={() => onPatch(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        <button type="button" aria-label={`${layer.locked ? '解锁' : '锁定'}图层 ${layer.name}`} title={layer.locked ? '解锁' : '锁定'} className={iconButton} onClick={() => onPatch(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock size={15} /> : <LockOpen size={15} />}</button>
      </div>
      {selectedLayerId === layer.id && <div className="mt-1 flex justify-end">
        <button type="button" aria-label="上移图层" title="上移图层" disabled={i === 0} className={iconButton} onClick={() => onMove(layer.id, 'up')}><ArrowUp size={15} /></button>
        <button type="button" aria-label="下移图层" title="下移图层" disabled={i === layers.length - 1} className={iconButton} onClick={() => onMove(layer.id, 'down')}><ArrowDown size={15} /></button>
        <button type="button" aria-label="复制图层" title="复制图层" className={iconButton} onClick={() => onDuplicate(layer.id)}><Copy size={15} /></button>
        <button type="button" aria-label="删除图层" title="删除图层" className={iconButton} onClick={() => onDelete(layer.id)}><Trash2 size={15} /></button>
      </div>}
    </div>)}</div>
    {selected && <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
      <CanvasNameField key={selected.id} label="图层名称" value={selected.name} onCommit={name => onPatch(selected.id, { name })} />
      <div className="grid grid-cols-2 gap-2">
        <CanvasNumberField label="位置 X" value={selected.x} disabled={selected.locked} onCommit={x => onPatch(selected.id, { x })} />
        <CanvasNumberField label="位置 Y" value={selected.y} disabled={selected.locked} onCommit={y => onPatch(selected.id, { y })} />
        <CanvasNumberField label="显示宽度" value={Math.round(selected.width * Math.abs(selected.scaleX) * 100) / 100} min={0.01} disabled={selected.locked} onCommit={width => onPatch(selected.id, { scaleX: (selected.scaleX < 0 ? -1 : 1) * width / selected.width })} />
        <CanvasNumberField label="显示高度" value={Math.round(selected.height * Math.abs(selected.scaleY) * 100) / 100} min={0.01} disabled={selected.locked} onCommit={height => onPatch(selected.id, { scaleY: (selected.scaleY < 0 ? -1 : 1) * height / selected.height })} />
        <CanvasNumberField label="旋转角度" value={selected.rotation} disabled={selected.locked} onCommit={rotation => onPatch(selected.id, { rotation })} />
        <CanvasNumberField label="不透明度 (%)" value={Math.round(selected.opacity * 100)} min={0} disabled={selected.locked} onCommit={opacity => onPatch(selected.id, { opacity: Math.min(100, opacity) / 100 })} />
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={textButton} disabled={selected.locked} onClick={() => onPatch(selected.id, flipLayer(selected, 'horizontal'))}><FlipHorizontal2 size={15} className="mr-1 inline" />水平镜像</button>
        <button type="button" className={textButton} disabled={selected.locked} onClick={() => onPatch(selected.id, flipLayer(selected, 'vertical'))}><FlipVertical2 size={15} className="mr-1 inline" />垂直镜像</button>
        <button type="button" className={textButton} disabled={selected.locked || (!selected.crops.length && !selected.pixelEdits?.some(edit => edit.kind === 'crop'))} onClick={() => onResetCrop(selected.id)}>恢复剪裁</button>
        <button type="button" className={textButton} disabled={selected.locked} onClick={() => onCenter(selected.id)}>移回中心</button>
      </div>
    </div>}
  </aside>;
}
