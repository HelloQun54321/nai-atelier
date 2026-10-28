import React from 'react';
import type { CanvasProject } from '../../services/canvasTypes';
import { CanvasNumberField } from './CanvasNumberField';
import { CanvasNameField } from './CanvasNameField';
import { ToolbarButton } from '../DesignSystem';

export interface CanvasProjectPanelProps {
  project: CanvasProject; savingState: 'saved' | 'saving' | 'error'; onRename: (name: string) => void; onRetry?: () => void;
  onNew: () => void; onOpen: () => void; onImportProject: () => void; onExportProject: () => void;
  onExportPng: () => void; onExportJpeg: () => void; onSendToLab: () => void;
  onResize: (width: number, height: number) => void; onBackground: (color: string | null) => void;
}
const button = '!h-9 !px-2 !text-xs hover:!border-gray-400 hover:!bg-gray-200 hover:!text-gray-900 hover:shadow-md dark:hover:!border-gray-500 dark:hover:!bg-gray-700 dark:hover:!text-white';

export function CanvasProjectPanel(props: CanvasProjectPanelProps) {
  const { project } = props;
  const state = { saved: '已保存', saving: '保存中', error: '保存失败' }[props.savingState];
  return <header aria-label="画布工程" className="appearance-surface flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
    <div className="w-36"><CanvasNameField key={project.id} label="工程名称" value={project.name} onCommit={props.onRename} /></div>
    <span role="status" className={`self-center text-xs ${props.savingState === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{state}</span>
    {props.savingState === 'error' && props.onRetry && <ToolbarButton className={button} onClick={props.onRetry}>重试保存</ToolbarButton>}
    <div className="flex flex-wrap items-center gap-1">
      <ToolbarButton className={button} onClick={props.onNew}>新建工程</ToolbarButton><ToolbarButton className={button} onClick={props.onOpen}>打开画布</ToolbarButton>
      <ToolbarButton className={button} onClick={props.onImportProject}>导入工程</ToolbarButton><ToolbarButton className={button} onClick={props.onExportProject}>导出工程</ToolbarButton>
      <ToolbarButton className={button} onClick={props.onExportPng}>导出 PNG</ToolbarButton><ToolbarButton className={button} onClick={props.onExportJpeg}>导出 JPEG</ToolbarButton>
      <ToolbarButton tone="primary" className="!h-9 !px-2 !text-xs hover:!border-indigo-400 hover:!bg-indigo-400 hover:shadow-md dark:hover:!border-indigo-400 dark:hover:!bg-indigo-400" onClick={props.onSendToLab}>送往实验室</ToolbarButton>
    </div>
    <div className="flex items-end gap-2">
      <div className="w-20"><CanvasNumberField label="画布宽度" value={project.width} integer min={1} onCommit={width => props.onResize(width, project.height)} /></div>
      <div className="w-20"><CanvasNumberField label="画布高度" value={project.height} integer min={1} onCommit={height => props.onResize(project.width, height)} /></div>
      <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">背景<select aria-label="画布背景" value={project.background.kind} onChange={e => props.onBackground(e.currentTarget.value === 'transparent' ? null : project.background.color)} className="h-8 rounded-lg border border-gray-200 bg-transparent px-2 dark:border-gray-700"><option value="transparent">透明</option><option value="color">纯色</option></select></label>
      {project.background.kind === 'color' && <input aria-label="背景颜色" type="color" value={project.background.color} onChange={e => props.onBackground(e.currentTarget.value)} className="h-8 w-9 cursor-pointer rounded border border-gray-200 bg-transparent dark:border-gray-700" />}
    </div>
  </header>;
}
