import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Copy, FileText, Layers, Pencil } from 'lucide-react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { FRAGMENT_LABELS, type PromptFragmentKind } from '../services/promptLibraryEntries';
import { filterPromptBrowseEntries, normalizeBrowseText, promptBrowseEntries, promptBrowseSummary, type PromptBrowseScope } from '../services/promptLibraryBrowse';
import { EmptyState, ToolbarButton, ToolbarSearch } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { PressRevealSurface } from './PressRevealSurface';
import { SmartImage } from './SmartImage';
import { DetailSidePanel } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { bilingualOf, contentRead } from '../services/contentRoll';
import { PromptLibraryTagEditor } from './PromptLibraryTagEditor';

const SCOPES = [['all', '全部'], ['items', '片段'], ['saved', '组合'], ['originals', '原文']] as const;
const MEMORY_KEY = 'nai-prompt-library-browse';
const SCROLL_KEY = 'nai-prompt-library-browse-scroll';
const readScroll = (): Partial<Record<PromptBrowseScope, number>> => {
  try {
    const value = JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}');
    return Object.fromEntries(SCOPES.flatMap(([key]) => Number.isFinite(value[key]) && value[key] >= 0 ? [[key, value[key]]] : []));
  } catch { return {}; }
};
const readMemory = (): { scope: PromptBrowseScope; kind: PromptFragmentKind | ''; sort: 'updated' | 'name' } => {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    const scope = SCOPES.some(([key]) => key === value.scope) ? value.scope : 'all';
    return { scope, kind: scope === 'items' && value.kind in FRAGMENT_LABELS ? value.kind : '', sort: value.sort === 'name' ? 'name' : 'updated' };
  } catch { return { scope: 'all', kind: '', sort: 'updated' }; }
};

export interface PromptLibraryBrowserProps {
  chains: PromptChain[];
  toolbarSlot: HTMLElement | null;
  onUse: (chain: PromptChain) => void;
  onOpen: (chain: PromptChain) => void;
  onManage?: () => void;
  onUpdateTags?: (chain: PromptChain, tags: string[]) => Promise<void>;
  focusEntryId?: string;
  notify: (message: string, kind?: 'success' | 'error') => void;
}

export const PromptBrowseHighlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const key = normalizeBrowseText(query);
  if (!key) return <>{text}</>;
  const matcher = new RegExp(key.split(' ').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi');
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index;
    parts.push(text.slice(offset, index), <mark key={index} className="rounded bg-amber-200/60 text-inherit dark:bg-amber-500/30">{match[0]}</mark>);
    offset = index + match[0].length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
};

/** 汇总只读卡片；详情与管理继续使用原有编辑组件。 */
export const PromptLibraryBrowser: React.FC<PromptLibraryBrowserProps> = ({ chains, toolbarSlot, onUse, onOpen, onManage, onUpdateTags, focusEntryId, notify }) => {
  useLanguage();
  const [memory, setMemory] = useState(readMemory);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [wide, setWide] = useState(false);
  const focusedId = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(useMemo(readScroll, []));
  const entries = useMemo(() => promptBrowseEntries(chains), [chains]);
  const shown = useMemo(() => filterPromptBrowseEntries(entries, { ...memory, query, tags }), [entries, memory, query, tags]);
  const tagOptions = useMemo(() => [...new Set(entries.flatMap(entry => entry.chain.tags || []))].sort((a, b) => a.localeCompare(b)), [entries]);
  const selected = entries.find(entry => entry.chain.id === selectedId);
  const selectedRead = selected?.section === 'saved' ? contentRead((selected.chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot) : null;
  const closeDetail = useMobileHistoryLayer(!!selected, () => setSelectedId(''), 'prompt-library-detail');
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current[memory.scope] || 0;
  }, [memory.scope]);
  useEffect(() => {
    if (!focusEntryId || focusedId.current === focusEntryId || !entries.some(entry => entry.chain.id === focusEntryId)) return;
    focusedId.current = focusEntryId;
    setQuery(''); setTags([]); setMemory(previous => ({ ...previous, scope: 'all', kind: '' })); setSelectedId(focusEntryId);
  }, [focusEntryId, entries]);
  useEffect(() => {
    if (!selectedId) return;
    Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-prompt-library-entry]') || []).find(element => element.dataset.promptLibraryEntry === selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, shown]);
  useEffect(() => {
    if (!toolbarSlot) return;
    const update = () => setWide(toolbarSlot.getBoundingClientRect().width >= 650);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(toolbarSlot);
    return () => observer?.disconnect();
  }, [toolbarSlot]);
  const resetScroll = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const updateMemory = (next: typeof memory, reset = true) => {
    if (reset) { scrollPositions.current[next.scope] = 0; resetScroll(); }
    setMemory(next);
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); } catch { /* 本端存储受限时仍可浏览。 */ }
  };
  const setScope = (scope: PromptBrowseScope) => updateMemory({ ...memory, scope, kind: scope === 'items' ? memory.kind : '' }, false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); notify(t('已复制提示词')); }
    catch { notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error'); }
  };
  const openManage = async (close: () => void, mobile: boolean) => {
    // 沿用标签管理的返回顺序，避免手机筛选层的异步返回关闭新窗口。
    const returned = mobile && window.history.state?.__naiMobileLayer?.startsWith('sheet-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    flushSync(close);
    if (returned) await returned;
    toolbarSlot?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
    onManage?.();
  };
  const toolbar = <>
    {wide && <div role="tablist" aria-label={t('提示词库分区')} className="appearance-segmented flex h-11 shrink-0 gap-0.5 rounded-xl p-0.5 md:h-10">
      {SCOPES.map(([scope, label], index) => <button key={scope} type="button" role="tab" aria-selected={memory.scope === scope} tabIndex={memory.scope === scope ? 0 : -1}
        onClick={() => setScope(scope)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % SCOPES.length : event.key === 'ArrowLeft' ? (index + SCOPES.length - 1) % SCOPES.length : event.key === 'Home' ? 0 : event.key === 'End' ? SCOPES.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setScope(SCOPES[next][0]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
        }} className={`appearance-segmented whitespace-nowrap rounded-lg px-2 text-sm font-semibold ${memory.scope === scope ? 'bg-white text-indigo-600 dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>{t(label)}</button>)}
    </div>}
    {!wide && <select aria-label={t('提示词库范围')} value={memory.scope} onChange={event => setScope(event.target.value as PromptBrowseScope)}
      className="appearance-input mobile-touch h-11 w-14 shrink-0 rounded-xl border border-gray-200 bg-transparent px-1 text-sm dark:border-gray-700 md:h-10">
      {SCOPES.map(([scope, label]) => <option key={scope} value={scope}>{t(label)}</option>)}
    </select>}
    <ToolbarSearch value={query} aria-label={t('搜索名称、正文或标签')} placeholder={t(wide ? '搜索名称、正文或标签' : '搜索')}
      onChange={event => { setQuery(event.target.value); resetScroll(); }} className="!h-11 md:!h-10" containerClassName="min-w-0 flex-1 md:max-w-none!" />
    <ToolbarPopover title={t(memory.scope === 'saved' ? '筛选组合' : '筛选提示词库')} width={300} count={tags.length + Number(!!memory.kind)} iconOnly={!wide} iconTone={tags.length || memory.kind ? 'primary' : 'neutral'} className={`[&>button]:!h-11 md:[&>button]:!h-10 ${!wide ? '[&>button]:!w-11' : ''}`}>
      {(close, mobile) => <>
      {(memory.scope === 'all' || memory.scope === 'items') && <label className="block text-xs font-semibold text-gray-500">{t('用途')}<select aria-label={t('片段用途')} value={memory.kind} className={TOOLBAR_FIELD_CLASS}
        onChange={event => updateMemory({ ...memory, kind: event.target.value as PromptFragmentKind | '', scope: event.target.value ? 'items' : memory.scope })}>
        <option value="">{t('全部用途')}</option>{Object.entries(FRAGMENT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{t(label)}</option>)}
      </select></label>}
      <fieldset className="mt-4"><legend className="text-xs font-semibold text-gray-500">{t('自定义标签')}</legend>
        {tags.length > 0 && <button type="button" className="mobile-touch mt-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setTags([]); resetScroll(); }}>{t('清除标签筛选')}</button>}
        <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">{tagOptions.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
          className={`mobile-touch rounded-lg px-2 py-1 text-sm ${tags.includes(tag) ? 'bg-indigo-600 text-white' : 'appearance-group text-gray-600 dark:text-gray-300'}`}
          onClick={() => { setTags(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag]); resetScroll(); }}>{tag}</button>)}</div>
      </fieldset>
      <label className="mt-4 block text-xs font-semibold text-gray-500">{t('排序')}<select aria-label={t('排序')} value={memory.sort} className={TOOLBAR_FIELD_CLASS}
        onChange={event => updateMemory({ ...memory, sort: event.target.value as 'updated' | 'name' })}><option value="updated">{t('最近更新')}</option><option value="name">{t('名称')}</option></select></label>
      <div className="mt-4 flex flex-wrap gap-2"><ToolbarButton onClick={() => { setTags([]); setQuery(''); updateMemory({ ...memory, kind: '' }); }}>{t('重置筛选')}</ToolbarButton>
        {onManage && <ToolbarButton onClick={() => void openManage(close, mobile)}>{t('管理提示词')}</ToolbarButton>}</div>
      </>}
    </ToolbarPopover>
    <ToolbarCountCaption>{t('匹配 {0} 条 · 共 {1} 条', [shown.length, entries.length])}</ToolbarCountCaption>
  </>;
  return <>{toolbarSlot && createPortal(toolbar, toolbarSlot)}<div className={`flex min-h-0 flex-1 ${selected ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,40%)]' : ''}`}>
    <div ref={scrollRef} onScroll={event => {
      scrollPositions.current[memory.scope] = event.currentTarget.scrollTop;
      try { localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions.current)); } catch { /* 滚动记忆受限时保留本次会话位置。 */ }
    }} className="workspace-scroll-viewport min-h-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6">
      {shown.length ? <div className="content-library-grid items-start">{shown.map(entry => {
        const { chain, section, kind } = entry;
        const label = section === 'items' && kind ? FRAGMENT_LABELS[kind] : section === 'saved' ? '组合' : '原文';
        const summary = promptBrowseSummary(entry, query);
        const name = chain.name?.trim() || entry.summary.split(/[\r\n]/)[0].slice(0, 48) || t('未命名');
        return <PressRevealSurface as="article" key={chain.id} className="appearance-group group relative overflow-hidden rounded-2xl bg-white p-3 dark:bg-gray-900" data-prompt-library-entry={chain.id} data-safe-mode-work="true">
          <button type="button" aria-label={t('查看{0}', [name])} className="flex w-full items-start gap-3 text-left" onClick={() => setSelectedId(chain.id)}>
            <span className="appearance-media flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800">
              {chain.previewImage ? <SmartImage src={chain.previewImage} alt={name} thumbnailVariant="thumb-320" className="h-full w-full object-cover" containerClassName="h-full w-full" /> : section === 'saved' ? <Layers className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
            </span>
            <span className="min-w-0 flex-1"><span data-safe-mode-title="true" className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100"><PromptBrowseHighlight text={name} query={query} /></span>
              <span className="mt-1 block text-xs text-indigo-600 dark:text-indigo-300">{t(label)}</span>
              <span className="mt-2 line-clamp-3 break-words text-xs leading-5 text-gray-600 dark:text-gray-300"><PromptBrowseHighlight text={summary} query={query} /></span>
            </span>
          </button>
          <div className="mt-2 flex items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap gap-1">{(chain.tags || []).slice(0, 3).map(tag => <span key={tag} className="max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400"><PromptBrowseHighlight text={tag} query={query} /></span>)}</div>
            <ToolbarButton onClick={() => onUse(chain)}>{t('使用')}</ToolbarButton></div>
          <div className="hover-reveal-md absolute right-2 top-2 flex gap-1">
            <button data-card-action type="button" aria-label={t('编辑{0}', [name])} onClick={() => onOpen(chain)} className="mobile-touch appearance-surface flex h-11 w-11 items-center justify-center rounded-full md:h-9 md:w-9"><Pencil className="h-4 w-4" /></button>
            <button data-card-action type="button" aria-label={section === 'saved' ? t('复制组合数据') : t('复制{0}', [name])} onClick={() => void copy(section === 'saved' ? JSON.stringify((chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot, null, 2) : chain.basePrompt || entry.summary)} className="mobile-touch appearance-surface flex h-11 w-11 items-center justify-center rounded-full md:h-9 md:w-9"><Copy className="h-4 w-4" /></button>
          </div>
        </PressRevealSurface>;
      })}</div> : <EmptyState title={t(entries.length ? '没有匹配的提示词' : '提示词库还是空的')} hint={t(entries.length ? '换个关键词，或清除筛选。' : '粘贴收录提示词。')} />}
    </div>
    {selected && <DetailSidePanel open title={selected.chain.name || selected.summary.slice(0, 48) || t('未命名')} sensitiveTitle
      subInfo={t(selected.kind ? FRAGMENT_LABELS[selected.kind] : selected.section === 'saved' ? '组合' : '原文')}
      onClose={closeDetail} onBack={closeDetail} headerActions={<><ToolbarButton onClick={() => onOpen(selected.chain)}>{t('编辑')}</ToolbarButton><ToolbarButton tone="primary" onClick={() => onUse(selected.chain)}>{t('使用')}</ToolbarButton></>}>
      {selected.chain.previewImage && <SmartImage src={selected.chain.previewImage} alt={selected.chain.name} className="max-h-[40vh] w-full rounded-xl object-contain" />}
      {selected.section === 'saved' && onUpdateTags ? <PromptLibraryTagEditor key={selected.chain.id} tags={selected.chain.tags || []} suggestions={tagOptions} onSave={tags => onUpdateTags(selected.chain, tags)} />
        : <div className="mt-3 flex flex-wrap gap-1">{(selected.chain.tags || []).map(tag => <span key={tag} className="appearance-group rounded px-2 py-1 text-xs">{tag}</span>)}</div>}
      {selectedRead ? <>
        {selectedRead.roles.map(role => <section key={role.key} className="mt-4"><h3 className="text-sm font-semibold">{role.name}</h3>{Object.entries(role.sections).map(([kind, text]) => <div key={kind} className="mt-3"><h4 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{text}</p>{role.negatives[kind]?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{role.negatives[kind].text}</p>}</div>)}</section>)}
        {Object.entries(selectedRead.global).filter(([, field]) => field.provided).map(([kind, field]) => <section key={kind} className="mt-4"><h3 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.text}</p>{field.negative?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{field.negative.text}</p>}</section>)}
      </> : <><h3 className="mt-4 text-xs text-gray-500">{t('提示词原文')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.basePrompt}</p>{bilingualOf(selected.chain) && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-500">{bilingualOf(selected.chain)}</p>}{selected.chain.negativePrompt && <><h3 className="mt-4 text-xs text-gray-500">{t('负面提示词')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.negativePrompt}</p></>}</>}
      {selected.chain.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-gray-500">{selected.chain.description}</p>}
    </DetailSidePanel>}
    </div>
  </>;
};
