import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Copy, ImagePlus, Layers, LoaderCircle, Trash2 } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { LocalGenItem, PromptChain } from '../types';
import { KINDS, META, contentRead, contentScopeOf, isContentRecord } from '../services/contentRoll';
import { promptLibraryHistoryImageUrl } from './PromptLibrary';
import { HistoryImagePicker } from './HistoryImagePicker';
import { SmartImage } from './SmartImage';
import { EmptyState, ToolbarButton, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS, ToolbarPopover } from './ToolbarPopover';

interface ContentRollLibraryProps {
  active: boolean;
  chains: PromptChain[];
  notify: (message: string, kind?: 'success' | 'error') => void;
  onLoad: (chain: PromptChain) => void;
  onRename: (chain: PromptChain, name: string) => Promise<void>;
  onDelete: (chain: PromptChain) => Promise<void>;
  onSetCover: (chain: PromptChain, url: string) => Promise<void>;
  embedded?: boolean;
  toolbarSlot?: HTMLElement | null;
}

/** 与条目共用工具栏和卡片密度；快照只读，载入仍交给同一套填入确认。 */
export const ContentRollLibrary: React.FC<ContentRollLibraryProps> = ({ active, chains, notify, onLoad, onRename, onDelete, onSetCover, embedded = false, toolbarSlot = null }) => {
  useLanguage();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [previewId, setPreviewId] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [coverFor, setCoverFor] = useState<PromptChain | null>(null);
  const renamePending = useRef(false);
  const renameCancelled = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resetScroll = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };

  const records = useMemo(() => chains.filter(isContentRecord).map(chain => {
    const read = contentRead((chain.params as { _rollContentSnapshot?: unknown } | undefined)?._rollContentSnapshot);
    const fields = KINDS.flatMap(kind => {
      const role = read.roles[0];
      const isRole = META[kind].scope === 'character';
      const provided = isRole ? role?.provided[kind] : read.global[kind]?.provided;
      const text = isRole ? role?.sections[kind] : read.global[kind]?.text;
      const negative = isRole ? role?.negatives[kind] : read.global[kind]?.negative;
      return provided ? [{ kind, text: text || '', negative }] : [];
    });
    return { chain, read, fields, scope: contentScopeOf(read) };
  }), [chains]);
  const shown = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records.filter(({ chain, fields, scope }) => !keyword || [chain.name, chain.description, ...(chain.tags || []), scope.label,
      ...fields.flatMap(field => [field.text, field.negative?.text, field.negative?.note])].join(' ').toLowerCase().includes(keyword))
      .sort((a, b) => sort === 'name' ? a.chain.name.localeCompare(b.chain.name) : Number(b.chain.updatedAt || 0) - Number(a.chain.updatedAt || 0));
  }, [records, query, sort]);

  const copySnapshot = async (chain: PromptChain) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify((chain.params as { _rollContentSnapshot?: unknown } | undefined)?._rollContentSnapshot, null, 2));
      notify(t('已复制这条记录的内容快照'));
    } catch { notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error'); }
  };
  const commitRename = async () => {
    if (!renaming || renamePending.current || renameCancelled.current) return;
    const target = records.find(item => item.chain.id === renaming.id)?.chain;
    const name = renaming.value.trim();
    if (!target || !name || name === target.name) { setRenaming(null); return; }
    renamePending.current = true;
    setBusy(target.id);
    try { await onRename(target, name); setRenaming(null); }
    catch { notify(t('改名失败，请重试'), 'error'); }
    finally { renamePending.current = false; setBusy(''); }
  };
  const remove = async (chain: PromptChain) => {
    setBusy(chain.id);
    try { await onDelete(chain); }
    catch { notify(t('删除失败，请稍后重试'), 'error'); }
    finally { setBusy(''); }
  };
  const toolbar = <>
    <ToolbarPopover title={t('筛选组合库')} width={280}>
      <label className="block text-xs font-semibold text-gray-500">{t('排序')}
        <select className={TOOLBAR_FIELD_CLASS} aria-label={t('排序')} value={sort} onChange={event => { setSort(event.target.value); resetScroll(); }}>
          <option value="updated">{t('最近更新')}</option><option value="name">{t('名称')}</option>
        </select>
      </label>
    </ToolbarPopover>
    <ToolbarSearch value={query} aria-label={t('搜索名称、标签或提示词')} placeholder={t('搜索名称、标签或提示词')}
      onChange={event => { setQuery(event.target.value); resetScroll(); }} containerClassName="md:max-w-none!" />
  </>;

  return <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950'} data-content-roll-library="true">
    {embedded ? toolbarSlot && createPortal(toolbar, toolbarSlot) : <WorkspaceChrome><WorkspaceToolbar>{toolbar}</WorkspaceToolbar></WorkspaceChrome>}
    <div ref={scrollRef} className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6">
      {shown.length ? <div className="content-library-grid items-start">
        {shown.map(({ chain, read, fields, scope }) => {
          const expanded = previewId === chain.id;
          return <article key={chain.id} data-content-roll-record={chain.id} data-safe-mode-work="true"
            className={`appearance-group overflow-hidden rounded-2xl border bg-white dark:bg-gray-900 ${expanded ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-800'}`}>
            <button type="button" aria-expanded={expanded} aria-controls={`content-preview-${chain.id}`} onClick={() => setPreviewId(expanded ? '' : chain.id)}
              className="flex w-full items-start gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-indigo-500">
              <span className="appearance-media flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800">
                {chain.previewImage ? <SmartImage src={chain.previewImage} alt={chain.name || t('封面')} thumbnailVariant="thumb-320" className="h-full w-full object-cover" containerClassName="h-full w-full" /> : <Layers className="h-6 w-6" />}
              </span>
              <span className="min-w-0 flex-1">
                <span data-safe-mode-title="true" className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">{chain.name || t('未命名')}</span>
                <span data-content-roll-scope={chain.id} className="mt-1 block text-xs text-indigo-600 dark:text-indigo-300">{scope.label || t('（没有可载入的内容）')}</span>
                <span className="mt-2 line-clamp-2 break-words text-xs leading-5 text-gray-500 dark:text-gray-400">{chain.description || fields.map(field => field.text).join(', ')}</span>
              </span>
              <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            <div className="flex items-center justify-between gap-2 px-4 pb-3">
              <span className="text-xs text-gray-400">{new Date(Number(chain.updatedAt || 0)).toLocaleDateString()}</span>
              <ToolbarButton disabled={!read.ok || !!busy} onClick={() => onLoad(chain)}>{t('载入组合')}</ToolbarButton>
            </div>
            {!read.ok && <p className="px-4 pb-3 text-xs text-amber-600 dark:text-amber-400">{t('这条记录不能按纯内容载入：{0}', [read.warnings[0] || ''])}</p>}
            {expanded && <div id={`content-preview-${chain.id}`} data-content-roll-preview={chain.id} className="border-t border-gray-200 p-4 dark:border-gray-800">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {renaming?.id === chain.id ? <input autoFocus aria-label={t('重命名这条记录')} value={renaming.value} disabled={!!busy} className={TOOLBAR_FIELD_CLASS}
                  onChange={event => setRenaming({ id: chain.id, value: event.target.value })} onBlur={() => void commitRename()}
                  onKeyDown={event => { if (event.key === 'Enter') void commitRename(); if (event.key === 'Escape') { renameCancelled.current = true; setRenaming(null); } }} />
                  : <ToolbarButton disabled={!!busy} onClick={() => { renameCancelled.current = false; setRenaming({ id: chain.id, value: chain.name }); }}>{t('改名')}</ToolbarButton>}
                <ToolbarButton disabled={!!busy} onClick={() => void copySnapshot(chain)} title={t('复制快照')} aria-label={t('复制快照')}><Copy /></ToolbarButton>
                <ToolbarButton disabled={!!busy} onClick={() => setCoverFor(chain)} data-content-roll-cover={chain.id} title={t('从历史选封面')} aria-label={t('从历史选封面')}><ImagePlus /></ToolbarButton>
                <ToolbarButton tone="danger" disabled={!!busy} onClick={() => void remove(chain)} title={t('删除')} aria-label={t('删除')}><Trash2 /></ToolbarButton>
                {busy === chain.id && <LoaderCircle className="h-4 w-4 animate-spin text-gray-400" />}
              </div>
              <div className="space-y-3">
                {fields.map(({ kind, text, negative }) => <div key={kind}>
                  <h3 className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t(META[kind].title)}</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-600 dark:text-gray-300">{text}</p>
                  {negative && (negative.text || negative.note) && <p className="mt-1 break-words text-xs text-amber-600 dark:text-amber-400">{negative.text ? t('内容负面：') + negative.text : ''}{negative.text && negative.note ? '；' : ''}{negative.note}</p>}
                </div>)}
              </div>
            </div>}
          </article>;
        })}
      </div> : <EmptyState icon={<Layers className="h-7 w-7" />} title={t(records.length ? '没有符合搜索条件的记录' : '组合库还是空的')}
        hint={records.length ? undefined : t('点击右上角「Roll 组合」，保存喜欢的搭配。')}
        action={records.length ? <ToolbarButton onClick={() => { setQuery(''); resetScroll(); }}>{t('清除筛选')}</ToolbarButton> : undefined} />}
    </div>
    <HistoryImagePicker open={active && !!coverFor} onClose={() => setCoverFor(null)} onSelect={async (item: LocalGenItem) => {
      const target = coverFor;
      setCoverFor(null);
      if (!target || !item?.id) return;
      setBusy(target.id);
      try { await onSetCover(target, promptLibraryHistoryImageUrl(String(item.id))); notify(t('封面已更新：历史图会由 Worker 转成独立资产，不受历史清理影响')); }
      catch (error) { notify(t('设置封面失败：{0}', [String((error as Error)?.message || error)]), 'error'); }
      finally { setBusy(''); }
    }} />
  </div>;
};
