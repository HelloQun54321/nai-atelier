import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { t } from '../../services/i18n';
import { db } from '../../services/dbService';
import { getRecentCollectionFolders } from '../../services/inspirationUtils';
import type { InspirationBoard } from '../../types';
import { ToolbarSearch } from '../DesignSystem';
import { AnchoredToolbarPopover } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { MobileBottomSheet } from '../MobileUI';

/** 原生候选支持键盘与触屏；逗号输入时只补全最后一个标签。 */
export const CollectionTagInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & { value: string; suggestions: string[]; onPick?: (value: string) => void }> = ({ value, suggestions, onPick, className, onBlur, ...props }) => {
  const id = useId();
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
  const input = <input {...props} value={value} list={id} autoComplete="off" className={onPick ? 'min-w-0 w-full bg-transparent pr-7 outline-none' : className} onBlur={event => { if (!pickingRef.current && !anchorRef.current?.contains(event.relatedTarget as Node)) onBlur?.(event); }} />;
  const content = <div className="space-y-3">
    <ToolbarSearch aria-label={t('搜索标签')} placeholder={t('搜索标签')} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="flex max-h-64 flex-wrap content-start gap-2 overflow-y-auto">
      {available.filter(tag => tag.toLowerCase().includes(query.trim().toLowerCase())).map(tag => <button type="button" key={tag} onClick={() => { onPick?.(`${prefix}${prefix ? ' ' : ''}${tag}`); close(); }} className="mobile-touch max-w-full truncate rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:border-indigo-300 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300" title={tag}>#{tag}</button>)}
      {!available.some(tag => tag.toLowerCase().includes(query.trim().toLowerCase())) && <p className="py-3 text-sm text-gray-400">{t('没有匹配的标签')}</p>}
    </div>
  </div>;
  return <>{onPick ? <span ref={anchorRef} className={`relative inline-flex items-center focus-within:border-indigo-400 ${className || ''}`}>{input}<button type="button" aria-label={t('选择已有标签')} title={t('选择已有标签')} aria-expanded={open} aria-haspopup="dialog" disabled={props.disabled || props.readOnly || !available.length} onPointerDown={event => event.preventDefault()} onClick={() => { pickingRef.current = true; setQuery(''); setMobile(window.innerWidth < 768); setOpen(true); }} className="mobile-size-locked absolute right-0 top-0 flex h-full w-9 items-center justify-center rounded-r-[inherit] text-gray-400 hover:text-indigo-600 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button></span> : input}<datalist id={id}>{available.map(tag => <option key={tag} value={`${prefix}${prefix ? ' ' : ''}${tag}`} />)}</datalist>
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={t('选择已有标签')} onClose={close}>{content}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={t('选择已有标签')} width={320} onClose={close}>{content}</AnchoredToolbarPopover>)}
  </>;
};

export const CollectionFolderSelect: React.FC<{
  value: string; onChange: (id: string) => void; boards?: InspirationBoard[]; disabled?: boolean; className?: string;
  notify: (message: string, type?: 'success' | 'error') => void;
}> = ({ value, onChange, boards, disabled, className = 'mobile-touch h-10 min-w-0 rounded-xl border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-950', notify }) => {
  const [loaded, setLoaded] = useState<InspirationBoard[]>([]);
  const [loading, setLoading] = useState(!boards);
  const [failed, setFailed] = useState(false);
  const [loadToken, setLoadToken] = useState(0);
  useEffect(() => {
    if (boards) return;
    let active = true;
    setLoading(true);
    void db.getInspirationBoards().then(items => { if (active) { setLoaded(items); setFailed(false); } })
      .catch(() => { if (active) { setFailed(true); notify('收藏夹加载失败', 'error'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [boards, loadToken]);
  const folders = boards || loaded;
  const recentIds = getRecentCollectionFolders();
  const recent = recentIds.flatMap(id => folders.filter(folder => folder.id === id));
  const remaining = folders.filter(folder => !recentIds.includes(folder.id));
  return <select aria-label={t('收藏夹')} aria-busy={loading} value={value} disabled={disabled || loading} className={className}
    onFocus={() => { if (failed) setLoadToken(token => token + 1); }} onChange={event => onChange(event.target.value)}>
    <option value="">{t('未整理')}</option>
    {value && !folders.some(folder => folder.id === value) && <option value={value}>{t('当前收藏夹')}</option>}
    {recent.length > 0 && <optgroup label={t('最近使用')}>{recent.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</optgroup>}
    {remaining.length > 0 && <optgroup label={t('全部收藏夹')}>{remaining.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</optgroup>}
  </select>;
};
