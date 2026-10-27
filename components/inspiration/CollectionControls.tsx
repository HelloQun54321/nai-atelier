import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { t } from '../../services/i18n';
import { getDirectoryPath } from '../../services/directoryTree.mjs';
import { DirectoryTreeChecklist } from '../DirectoryTreeChecklist';
import type { InspirationBoard } from '../../types';
import { ToolbarSearch } from '../DesignSystem';
import { AnchoredToolbarPopover } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { MobileBottomSheet } from '../MobileUI';

/** 候选统一使用项目面板；逗号输入时只替换最后一个标签。 */
export const CollectionTagInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & { value: string; suggestions: string[]; suggestionLabel?: (tag: string) => string; onPick?: (value: string) => void; inlineSuggestions?: boolean }> = ({ value, suggestions, suggestionLabel, onPick, inlineSuggestions = false, className, onBlur, ...props }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const pickingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const close = React.useCallback(() => { setOpen(false); pickingRef.current = false; }, []);
  useEffect(() => {
    const resize = () => { setMobile(window.innerWidth < 768); close(); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [close]);
  const prefix = value.slice(0, Math.max(value.lastIndexOf(','), value.lastIndexOf('，'), value.lastIndexOf('\n')) + 1);
  const existing = new Set(prefix.split(/[,，\n]+/).map(tag => tag.trim()));
  const available = suggestions.filter(tag => !existing.has(tag));
  const matches = available.filter(tag => `${tag} ${suggestionLabel?.(tag) || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const input = <input {...props} value={value} autoComplete="off" className={onPick ? 'min-w-0 w-full bg-transparent pr-7 outline-none' : className} onBlur={event => { if (!pickingRef.current && !anchorRef.current?.contains(event.relatedTarget as Node)) onBlur?.(event); }} />;
  const content = <div className="space-y-3">
    <ToolbarSearch aria-label={t('搜索标签')} placeholder={t('搜索标签')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="flex max-h-64 flex-wrap content-start gap-2 overflow-y-auto">
      {matches.map(tag => <button type="button" key={tag} onClick={() => { onPick?.(`${prefix}${prefix ? ' ' : ''}${tag}`); close(); }} className="mobile-touch max-w-full truncate rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:border-indigo-300 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300" title={suggestionLabel?.(tag) || tag}>#{suggestionLabel?.(tag) || tag}</button>)}
      {!matches.length && <p className="py-3 text-sm text-gray-400">{t('没有匹配的标签')}</p>}
    </div>
  </div>;
  return <>{onPick ? <span ref={anchorRef} className={`relative inline-flex items-center focus-within:border-indigo-400 ${className || ''}`}>{input}<button type="button" aria-label={t('选择已有标签')} title={t('选择已有标签')} aria-expanded={open} aria-haspopup={inlineSuggestions ? undefined : 'dialog'} disabled={props.disabled || props.readOnly || !available.length} onPointerDown={event => event.preventDefault()} onClick={() => { if (inlineSuggestions && open) { close(); return; } pickingRef.current = true; setQuery(''); setMobile(window.innerWidth < 768); setOpen(true); }} className="mobile-size-locked absolute right-0 top-0 flex h-full w-9 items-center justify-center rounded-r-[inherit] text-gray-400 outline-none hover:text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button></span> : input}
    {open && (inlineSuggestions ? <div className="appearance-group mt-2 rounded-xl p-3">{content}</div> : mobile ? <ImagePreviewPortal><MobileBottomSheet open title={t('选择已有标签')} onClose={close}>{content}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={t('选择已有标签')} width={320} onClose={close}>{content}</AnchoredToolbarPopover>)}
  </>;
};

export const CollectionFolderPicker: React.FC<{
  boards: InspirationBoard[]; value: string[]; mixedIds?: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabled?: boolean; iconOnly?: boolean; label?: string; className?: string;
}> = ({ boards, value, mixedIds = [], onToggle, disabled, iconOnly, label = '管理收藏夹', className = 'mobile-touch h-10 max-w-44 rounded-xl border border-gray-200 px-3 text-xs font-semibold dark:border-gray-800' }) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const close = React.useCallback(() => setOpen(false), []);
  useEffect(() => {
    const resize = () => { setMobile(window.innerWidth < 768); close(); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [close]);
  const content = <div className="space-y-3">
    <div className="max-h-72 space-y-1 overflow-y-auto">
      <DirectoryTreeChecklist nodes={boards} selectedIds={value} mixedIds={mixedIds} onToggle={onToggle} disabled={disabled} label={t(label)} />
      {!boards.length && <p className="py-3 text-sm text-gray-400">{t('暂无收藏夹')}</p>}
    </div>
    <button type="button" onClick={close} className="mobile-touch w-full rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white">{t('完成')}</button>
  </div>;
  return <><button ref={anchorRef} type="button" aria-label={t(label)} title={t(label)} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(value => !value)} className={`inline-flex min-w-0 flex-none items-center justify-center gap-2 disabled:opacity-40 ${className}`}><Folder className="h-4 w-4 flex-none" />{!iconOnly && <><span className="min-w-0 truncate">{value.length ? boards.filter(board => value.includes(board.id)).map(board => getDirectoryPath(boards, board.id).map(parent => parent.name).join(' / ')).join('、') : mixedIds.length ? t('部分选中') : t('未整理')}</span><ChevronDown className="h-3.5 w-3.5 flex-none" /></>}</button>
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={t(label)} onClose={close}>{content}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={t(label)} width={300} onClose={close}>{content}</AnchoredToolbarPopover>)}
  </>;
};
