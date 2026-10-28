import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { isTopmostModal, useModalA11y } from '../useModalA11y';

export interface CanvasNewProjectDialogProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string, width: number, height: number) => void;
}
export interface CanvasOpenProjectDialogProps {
  open: boolean;
  busy?: boolean;
  projects: Array<{ id: string; name: string; updatedAt: number; thumbnail?: string }>;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function DialogFrame({ label, onClose, busy = false, children }: React.PropsWithChildren<{ label: string; onClose: () => void; busy?: boolean }>) {
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [dialogRef]);
  return <div className="ui-backdrop-enter fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-busy={busy} aria-label={label} className="appearance-panel ui-modal-enter flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"><h2 className="text-base font-semibold">{label}</h2><IconButton label="关闭" className="!h-9 !w-9" disabled={busy} onClick={onClose}><X /></IconButton></header>
      {children}
    </div>
  </div>;
}

function NewProjectContent({ onClose, onCreate, busy = false }: Omit<CanvasNewProjectDialogProps, 'open'>) {
  const [name, setName] = useState('未命名画布');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const positiveInteger = (value: string) => /^\d+$/.test(value) && Number.isInteger(Number(value)) && Number(value) > 0;
  const valid = name.trim().length > 0 && positiveInteger(width) && positiveInteger(height);
  const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-950/70 dark:text-gray-100';
  return <DialogFrame label="新建画布工程" onClose={onClose} busy={busy}>
    <form onSubmit={event => { event.preventDefault(); if (valid && !busy) onCreate(name.trim(), Number(width), Number(height)); }}>
      <div className="grid gap-3 p-4">
        <label className="grid gap-1 text-sm text-gray-700 dark:text-gray-300">工程名称<input disabled={busy} value={name} onChange={event => setName(event.currentTarget.value)} className={inputClass} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm text-gray-700 dark:text-gray-300">画布宽度<input type="number" min="1" step="1" disabled={busy} value={width} onChange={event => setWidth(event.currentTarget.value)} className={inputClass} /></label>
          <label className="grid gap-1 text-sm text-gray-700 dark:text-gray-300">画布高度<input type="number" min="1" step="1" disabled={busy} value={height} onChange={event => setHeight(event.currentTarget.value)} className={inputClass} /></label>
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700"><ToolbarButton disabled={busy} onClick={onClose}>取消</ToolbarButton><ToolbarButton type="submit" tone="primary" disabled={busy || !valid}>新建</ToolbarButton></footer>
    </form>
  </DialogFrame>;
}

export function CanvasNewProjectDialog({ open, busy = false, onClose, onCreate }: CanvasNewProjectDialogProps) {
  return open ? <ImagePreviewPortal><NewProjectContent busy={busy} onClose={onClose} onCreate={onCreate} /></ImagePreviewPortal> : null;
}

function OpenProjectContent({ projects, onClose, onOpen, onDelete, busy = false }: Omit<CanvasOpenProjectDialogProps, 'open'>) {
  return <DialogFrame label="打开画布工程" onClose={onClose} busy={busy}>
    <div className="min-h-0 overflow-y-auto p-4">
      {projects.length === 0 ? <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">暂无画布工程</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {projects.map(project => <div key={project.id} className="appearance-group relative min-w-0 rounded-xl border border-gray-200 p-1 dark:border-gray-700">
          <button type="button" disabled={busy} aria-label={`打开工程 ${project.name}`} onClick={() => onOpen(project.id)} className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">
            <span className="appearance-media flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">{project.thumbnail ? <img src={project.thumbnail} alt="" className="h-full w-full object-contain" /> : <ImageIcon aria-hidden="true" className="h-8 w-8 text-gray-400 dark:text-gray-500" />}</span>
            <span className="block truncate px-1 py-2 pr-9 text-sm">{project.name}</span>
          </button>
          <button type="button" disabled={busy} aria-label={`关闭画布 ${project.name}`} title={`关闭画布 ${project.name}`} onClick={() => onDelete(project.id)} className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-lg text-red-600 outline-none hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/60"><X size={17} /></button>
        </div>)}
      </div>}
    </div>
  </DialogFrame>;
}

export function CanvasOpenProjectDialog({ open, busy = false, projects, onClose, onOpen, onDelete }: CanvasOpenProjectDialogProps) {
  return open ? <ImagePreviewPortal><OpenProjectContent busy={busy} projects={projects} onClose={onClose} onOpen={onOpen} onDelete={onDelete} /></ImagePreviewPortal> : null;
}
