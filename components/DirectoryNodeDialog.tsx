import React, { useContext, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getDirectoryDescendantIds, type DirectoryTreeNode } from '../services/directoryTree.mjs';
import { t, useLanguage } from '../services/i18n';
import { ToolbarButton } from './DesignSystem';
import { DirectoryTreeSelect } from './DirectoryTreeSelect';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useMobileHistoryLayer } from './MobileUI';
import { ImageActivityContext } from './SmartImage';
import { isTopmostModal, useModalA11y } from './useModalA11y';

export interface DirectoryNodeDialogProps {
  title: string;
  nodes: DirectoryTreeNode[];
  name: string;
  parentId: string;
  editingId?: string;
  busy?: boolean;
  disabled?: boolean;
  error?: string;
  onNameChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  nameLabel?: string;
  namePlaceholder?: string;
  parentLabel?: string;
  rootLabel?: string;
  maxLength?: number;
  children?: React.ReactNode;
}

const field = 'mobile-touch w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';

export function DirectoryNodeDialog(props: DirectoryNodeDialogProps) {
  return <ImagePreviewPortal><DirectoryNodeDialogContent {...props} /></ImagePreviewPortal>;
}

function DirectoryNodeDialogContent({ title, nodes, name, parentId, editingId, busy = false, disabled = false, error, onNameChange, onParentChange, onSubmit, onClose, nameLabel, namePlaceholder, parentLabel, rootLabel, maxLength, children }: DirectoryNodeDialogProps) {
  useLanguage();
  const active = useContext(ImageActivityContext);
  const ref = useModalA11y<HTMLDivElement>(active);
  const nameRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!active) { focused.current = false; return; }
    if (!focused.current && !busy && !disabled && isTopmostModal(ref.current)) {
      nameRef.current?.focus();
      focused.current = document.activeElement === nameRef.current;
    }
  }, [active, busy, disabled, ref]);
  const close = () => { if (!active || busy || !isTopmostModal(ref.current)) return false; onClose(); };
  const requestClose = useMobileHistoryLayer(active, close, 'directory-node');
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(ref.current)) {
        event.preventDefault();
        if (!busy) requestClose();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, busy, requestClose, ref]);
  const locked = busy || disabled;
  return <div hidden={!active} className={active ? 'fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm' : 'hidden'} onMouseDown={event => { if (event.target === event.currentTarget && active && !busy && isTopmostModal(ref.current)) requestClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(title)} aria-busy={busy} className="appearance-panel max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(title)}</h2><ToolbarButton aria-label={t('关闭')} disabled={busy} onClick={requestClose}><X /></ToolbarButton></div>
      <form onSubmit={event => { event.preventDefault(); if (active && !locked && name.trim() && isTopmostModal(ref.current)) void onSubmit(); }}>
        <label className="mb-3 block text-xs text-gray-500">{nameLabel ?? t('名称')}<input ref={nameRef} aria-label={nameLabel ?? t('名称')} placeholder={namePlaceholder} maxLength={maxLength} value={name} disabled={locked} onChange={event => onNameChange(event.target.value)} className={`${field} mt-2`} /></label>
        <label className="block text-xs text-gray-500">{parentLabel ?? t('上级目录')}<DirectoryTreeSelect nodes={nodes} rootLabel={rootLabel ?? t('顶层')} excludeIds={editingId ? [...getDirectoryDescendantIds(nodes, editingId)] : []} aria-label={parentLabel ?? t('上级目录')} value={parentId} disabled={locked} onChange={event => onParentChange(event.target.value)} className={`${field} mt-2`} /></label>
        {children}
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{t(error)}</p>}
        <div className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={busy} onClick={requestClose}>{t('取消')}</ToolbarButton><ToolbarButton type="submit" disabled={locked || !name.trim()} tone="primary">{t('保存')}</ToolbarButton></div>
      </form>
    </div>
  </div>;
}
