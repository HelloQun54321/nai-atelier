import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Copy, FileText, Folder, Layers, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { FRAGMENT_LABELS, type PromptFragmentKind } from '../services/promptLibraryEntries';
import { filterPromptBrowseEntries, normalizeBrowseText, promptBrowseEntries, promptBrowseSummary, type PromptBrowseScope } from '../services/promptLibraryBrowse';
import { EmptyState, ToolbarButton, ToolbarSearch } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { PressRevealSurface } from './PressRevealSurface';
import { SmartImage } from './SmartImage';
import { useMasonryColumnCount } from './ShortestColumnMasonry';
import { DetailImageStage, DetailSidePanel } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { bilingualOf, contentRead } from '../services/contentRoll';
import { PromptLibraryTagEditor } from './PromptLibraryTagEditor';
import { promptLibraryCategoryNames } from '../services/promptLibraryCategories';
import { getCustomChainTags } from '../services/chainTags';
import { ImageCardActions } from './ImageCardActions';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { createDefaultPromptLibraryTree, getPromptLibraryDirectoryPath, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, selectPromptLibraryDirectoryEntries, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { PromptLibraryDirectoryNavigation, type PromptLibraryDirectorySelection } from './PromptLibraryDirectoryNavigation';
import { getDirectoryDescendantIds } from '../services/directoryTree.mjs';
import { emptyPromptLibraryCategoryTree, projectPromptLibraryCategoryTree, promptLibraryCategoryLabel, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { PromptLibraryCategoryNavigation } from './PromptLibraryCategoryNavigation';

const SCOPES = [['items', '片段'], ['saved', '组合']] as const;
const MEMORY_KEY = 'nai-prompt-library-browse';
const SCROLL_KEY = 'nai-prompt-library-browse-scroll';
const EXPANDED_KEY = 'nai-prompt-library-directories-expanded';
const CATEGORIES_EXPANDED_KEY = 'nai-prompt-library-combination-categories-expanded';
const readScroll = (): Partial<Record<PromptBrowseScope, number>> => {
  try {
    const value = JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}');
    return Object.fromEntries(SCOPES.flatMap(([key]) => Number.isFinite(value[key]) && value[key] >= 0 ? [[key, value[key]]] : []));
  } catch { return {}; }
};
const readMemory = (directories: PromptLibraryTreeState): { scope: PromptBrowseScope; directoryIds: string[]; allDirectories: boolean; unclassified: boolean; combinationCategory: string | null; combinationUnclassified: boolean; sort: 'updated' | 'name' } => {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    const scope = SCOPES.some(([key]) => key === value.scope) ? value.scope : 'items';
    const candidateLegacyId = Object.hasOwn(LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, value.kind) ? LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[value.kind as keyof typeof LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS] : '';
    const legacyId = directories.nodes.some(node => node.id === candidateLegacyId) ? candidateLegacyId : '';
    const hasDirectoryPreference = Array.isArray(value.directoryIds) || !!legacyId;
    return { scope, combinationCategory: typeof value.combinationCategory === 'string' ? value.combinationCategory : null, combinationUnclassified: value.combinationUnclassified === true, directoryIds: Array.isArray(value.directoryIds) ? value.directoryIds.filter((id: unknown) => typeof id === 'string') : legacyId ? [legacyId] : [], allDirectories: typeof value.allDirectories === 'boolean' ? value.allDirectories : !hasDirectoryPreference, unclassified: value.unclassified === true, sort: value.sort === 'name' ? 'name' : 'updated' };
  } catch { return { scope: 'items', combinationCategory: null, combinationUnclassified: false, directoryIds: [], allDirectories: true, unclassified: false, sort: 'updated' }; }
};

export interface PromptLibraryBrowserProps {
  chains: PromptChain[];
  toolbarSlot: HTMLElement | null;
  onUse: (chain: PromptChain) => void;
  onOpen: (chain: PromptChain) => void;
  onDelete?: (chain: PromptChain) => Promise<void>;
  onManage?: () => void;
  onExtract?: () => void;
  onUpdateTags?: (chain: PromptChain, tags: string[]) => Promise<void>;
  categoryNames?: string[];
  categoryTree?: PromptLibraryCategoryTreeState;
  onRenameCategory?: (id: string) => void;
  onDeleteCategory?: (id: string) => void;
  onCreateCategory?: (parentId: string | null) => void;
  onMoveCategory?: (id: string, parentId: string | null) => void;
  categoriesBusy?: boolean;
  directories?: PromptLibraryTreeState;
  onRenameDirectory?: (id: string) => void;
  onDeleteDirectory?: (id: string) => void;
  onCreateDirectory?: (parentId: string | null) => void;
  onMoveDirectory?: (id: string, parentId: string | null) => void;
  directoriesBusy?: boolean;
  categoryChange?: { from: string; to: string; token: number };
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
export const PromptLibraryBrowser: React.FC<PromptLibraryBrowserProps> = ({ chains, toolbarSlot, onUse, onOpen, onDelete, onManage, onExtract, onUpdateTags, categoryNames = [], categoryTree: suppliedCategoryTree, onCreateCategory, onRenameCategory, onDeleteCategory, onMoveCategory, categoriesBusy, directories: suppliedDirectories, onCreateDirectory, onRenameDirectory, onDeleteDirectory, onMoveDirectory, directoriesBusy, categoryChange, focusEntryId, notify }) => {
  useLanguage();
  const directories = useMemo(() => suppliedDirectories || createDefaultPromptLibraryTree(), [suppliedDirectories]);
  const [memory, setMemory] = useState(() => readMemory(directories));
  const navigationId = useId();
  const [directoriesExpanded, setDirectoriesExpanded] = useState(() => { try { return localStorage.getItem(EXPANDED_KEY) === 'true'; } catch { return false; } });
  const [categoriesExpanded, setCategoriesExpanded] = useState(() => { try { return localStorage.getItem(CATEGORIES_EXPANDED_KEY) === 'true'; } catch { return false; } });
  const navigationExpanded = memory.scope === 'saved' ? categoriesExpanded : directoriesExpanded;
  const toggleDirectories = () => {
    const expanded = !navigationExpanded;
    if (memory.scope === 'saved') setCategoriesExpanded(expanded); else setDirectoriesExpanded(expanded);
    try { localStorage.setItem(memory.scope === 'saved' ? CATEGORIES_EXPANDED_KEY : EXPANDED_KEY, String(expanded)); } catch { /* 本端存储受限时仍可切换。 */ }
  };
  const [query, setQuery] = useState('');
  const [scopeTags, setScopeTags] = useState<{ items: string[]; saved: string[] }>({ items: [], saved: [] });
  const tagScope = memory.scope === 'saved' ? 'saved' : 'items';
  const tags = scopeTags[tagScope];
  const setTags = (next: string[] | ((previous: string[]) => string[])) => setScopeTags(previous => ({ ...previous, [tagScope]: typeof next === 'function' ? next(previous[tagScope]) : next }));
  const [selectedId, setSelectedId] = useState('');
  const [wide, setWide] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [deletingId, setDeletingId] = useState('');
  const deleting = useRef(false);
  const imageDisplay = useMobileImageDisplayPreferences();
  const frostedCaption = useGalleryFrostedCaption();
  const appliedCategoryChange = useRef<number | undefined>(undefined);
  const focusedId = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridColumns = useMasonryColumnCount(imageDisplay, undefined, scrollRef, 180, !!selectedId);
  const scrollPositions = useRef(useMemo(readScroll, []));
  const entries = useMemo(() => promptBrowseEntries(chains), [chains]);
  const libraryChains = useMemo(() => entries.filter(entry => entry.section === 'items').map(entry => entry.chain), [entries]);
  const combinationChains = useMemo(() => entries.filter(entry => entry.section === 'saved').map(entry => entry.chain), [entries]);
  const categoryTree = useMemo(() => projectPromptLibraryCategoryTree(combinationChains, categoryNames, suppliedCategoryTree || emptyPromptLibraryCategoryTree()), [combinationChains, categoryNames, suppliedCategoryTree]);
  const selectedCategoryIds = useMemo(() => memory.combinationCategory === null ? null : getDirectoryDescendantIds(categoryTree.nodes, memory.combinationCategory), [categoryTree, memory.combinationCategory]);
  const categoryLabel = (name: string) => promptLibraryCategoryLabel(categoryTree, name);
  const scopeTotal = useMemo(() => entries.filter(entry => entry.section === memory.scope).length, [entries, memory.scope]);
  const directoryEntries = useMemo(() => memory.scope !== 'items' ? entries : (() => {
    const fragments = entries.filter(entry => isPromptLibraryFragmentEntry(entry.chain));
    const included = new Set((memory.allDirectories ? fragments.map(entry => entry.chain) : selectPromptLibraryDirectoryEntries(fragments.map(entry => entry.chain), directories, memory.directoryIds)).map(chain => chain.id));
    return entries.filter(entry => entry.section !== 'items' || included.has(entry.chain.id) || memory.unclassified && !getPromptLibraryEntryDirectoryIds(entry.chain, directories).length);
  })(), [entries, memory.scope, memory.allDirectories, memory.directoryIds, memory.unclassified, directories]);
  const folderEntries = useMemo(() => memory.scope !== 'saved' ? directoryEntries : directoryEntries.filter(entry => memory.combinationCategory !== null ? getCustomChainTags(entry.chain.tags).some(tag => selectedCategoryIds?.has(tag)) : !memory.combinationUnclassified || !getCustomChainTags(entry.chain.tags).length), [directoryEntries, memory.scope, memory.combinationCategory, memory.combinationUnclassified, selectedCategoryIds]);
  const shown = useMemo(() => filterPromptBrowseEntries(folderEntries, { ...memory, kind: '', query, tags }), [folderEntries, memory, query, tags]);
  const combinationTags = useMemo(() => promptLibraryCategoryNames(chains, [...categoryNames, ...categoryTree.nodes.map(node => node.name)]), [chains, categoryNames, categoryTree]);
  const tagOptions = useMemo(() => memory.scope === 'saved' ? combinationTags : [...new Set(libraryChains.flatMap(chain => getCustomChainTags(chain.tags)))].sort((a, b) => a.localeCompare(b)), [libraryChains, combinationTags, memory.scope]);
  const selected = entries.find(entry => entry.chain.id === selectedId);
  const selectedRead = selected?.section === 'saved' ? contentRead((selected.chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot) : null;
  const closeDetail = useMobileHistoryLayer(!!selected, () => setSelectedId(''), 'prompt-library-detail');
  useEffect(() => {
    if (!categoryChange || appliedCategoryChange.current === categoryChange.token) return;
    appliedCategoryChange.current = categoryChange.token;
    setScopeTags(previous => ({ ...previous, saved: [...new Set(previous.saved.map(tag => tag === categoryChange.from ? categoryChange.to : tag).filter(Boolean))] }));
    setMemory(previous => {
      if (previous.combinationCategory !== categoryChange.from) return previous;
      const next = { ...previous, combinationCategory: categoryChange.to || null };
      try { localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); } catch { /* 本端存储受限时仍同步当前选择。 */ }
      return next;
    });
  }, [categoryChange]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current[memory.scope] || 0;
  }, [memory.scope]);
  useEffect(() => {
    if (!focusEntryId || focusedId.current === focusEntryId || !entries.some(entry => entry.chain.id === focusEntryId)) return;
    focusedId.current = focusEntryId;
    const entry = entries.find(entry => entry.chain.id === focusEntryId)!;
    const scope = entry.section === 'saved' ? 'saved' : 'items';
    setQuery(''); setScopeTags(previous => ({ ...previous, [scope]: [] }));
    setMemory(previous => entry.section === 'saved' ? { ...previous, scope, combinationCategory: null, combinationUnclassified: false } : { ...previous, scope, directoryIds: [], allDirectories: true, unclassified: false });
    setSelectedId(focusEntryId);
  }, [focusEntryId, entries]);
  useEffect(() => {
    if (!selectedId) return;
    Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-prompt-library-entry]') || []).find(element => element.dataset.promptLibraryEntry === selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, shown, gridColumns]);
  useEffect(() => {
    if (!toolbarSlot) return;
    const update = () => { setWide(toolbarSlot.getBoundingClientRect().width >= 650); setMobile(window.innerWidth < 768); };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(toolbarSlot);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [toolbarSlot]);
  const resetScroll = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const updateMemory = (next: typeof memory, reset = true) => {
    if (reset) { scrollPositions.current[next.scope] = 0; resetScroll(); }
    setMemory(next);
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); } catch { /* 本端存储受限时仍可浏览。 */ }
  };
  const updateDirectoryMemory = (patch: PromptLibraryDirectorySelection) => {
    const scope = 'items' as const;
    scrollPositions.current[scope] = 0;
    resetScroll();
    setMemory(previous => {
      const next = { ...previous, scope, ...patch };
      try { localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); } catch { /* 本端存储受限时仍可浏览。 */ }
      return next;
    });
  };
  const setScope = (scope: PromptBrowseScope) => updateMemory({ ...memory, scope }, false);
  const directoryScope = memory.scope === 'items';
  const selectedDirectoryPath = memory.scope === 'saved' ? (memory.combinationCategory === null ? null : categoryLabel(memory.combinationCategory)) ?? t(memory.combinationUnclassified ? '未归类' : '全部') : memory.allDirectories ? t('全部') : memory.unclassified ? t('未归类') : memory.directoryIds.map(id => getPromptLibraryDirectoryPath(directories, id).map(node => node.name).join(' / ')).filter(Boolean).join('、');
  const filterIconOnly = mobile || !wide;
  const copy = async (text: string, message = '已复制提示词') => {
    try { await navigator.clipboard.writeText(text); notify(t(message)); }
    catch { notify(t('复制失败：浏览器拒绝了剪贴板权限'), 'error'); }
  };
  const remove = async (chain: PromptChain) => {
    if (!onDelete || deleting.current) return;
    deleting.current = true; setDeletingId(chain.id);
    try { await onDelete(chain); }
    catch (cause) { notify(t('删除失败：{0}', [cause instanceof Error ? cause.message : String(cause)]), 'error'); }
    finally { deleting.current = false; setDeletingId(''); }
  };
  const openManage = async (close: () => void, mobile: boolean, callback?: () => void) => {
    // 沿用标签管理的返回顺序，避免手机筛选层的异步返回关闭新窗口。
    const returned = mobile && window.history.state?.__naiMobileLayer?.startsWith('sheet-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    flushSync(close);
    if (returned) await returned;
    toolbarSlot?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
    callback?.();
  };
  const toolbar = <>
    <div className={!mobile && wide ? "prompt-library-navigation-tools flex shrink-0 items-center gap-1" : "contents"}>
    <ToolbarButton aria-label={t(navigationExpanded ? '收起目录' : '展开目录')} title={[t(navigationExpanded ? '收起目录' : '展开目录'), selectedDirectoryPath].filter(Boolean).join(' · ')} aria-expanded={navigationExpanded} aria-controls={navigationId} active={navigationExpanded || (directoryScope ? !memory.allDirectories || memory.unclassified : memory.combinationCategory !== null || memory.combinationUnclassified)} onClick={toggleDirectories} className="!h-11 !w-11 md:!h-10 md:!w-10"><Folder className="h-4 w-4" /></ToolbarButton>
    {!mobile && wide && <div role="tablist" aria-label={t('提示词库分区')} className="appearance-segmented flex h-11 min-w-0 flex-1 gap-0.5 rounded-xl p-0.5 md:h-10">
      {SCOPES.map(([scope, label], index) => <button key={scope} type="button" role="tab" aria-selected={memory.scope === scope} tabIndex={memory.scope === scope ? 0 : -1}
        onClick={() => setScope(scope)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % SCOPES.length : event.key === 'ArrowLeft' ? (index + SCOPES.length - 1) % SCOPES.length : event.key === 'Home' ? 0 : event.key === 'End' ? SCOPES.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setScope(SCOPES[next][0]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
        }} className={`appearance-segmented min-w-0 flex-1 whitespace-nowrap rounded-lg px-2 text-sm font-semibold ${memory.scope === scope ? 'bg-white text-indigo-600 dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>{t(label)}</button>)}
    </div>}
    {!mobile && !wide && <select aria-label={t('提示词库范围')} value={memory.scope} onChange={event => setScope(event.target.value as PromptBrowseScope)}
      className="appearance-input mobile-touch h-11 w-24 shrink-0 rounded-xl border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700 md:h-10">
      {SCOPES.map(([scope, label]) => <option key={scope} value={scope}>{t(label)}</option>)}
    </select>}
    </div>
    <ToolbarSearch value={query} aria-label={t('搜索名称、正文或标签')} placeholder={t(wide ? '搜索名称、正文或标签' : '搜索')}
      onChange={event => { setQuery(event.target.value); resetScroll(); }} className="!h-11 md:!h-10 max-[360px]:!pl-2" containerClassName="min-w-0 flex-1 md:max-w-none! max-[360px]:[&>svg]:hidden" />
    <ToolbarPopover label="筛选" title={t(memory.scope === 'saved' ? '筛选组合' : '筛选提示词库')} width={320} count={tags.length} iconOnly={filterIconOnly} iconTone={tags.length ? 'primary' : 'neutral'} className={`[&>button]:!h-11 md:[&>button]:!h-10 ${filterIconOnly ? '[&>button]:!w-11' : ''}`}>
      {(close, mobile) => <>
      {mobile && <label className="block text-xs font-semibold text-gray-500">{t('提示词库范围')}<select aria-label={t('提示词库范围')} value={memory.scope} onChange={event => setScope(event.target.value as PromptBrowseScope)} className={TOOLBAR_FIELD_CLASS}>{SCOPES.map(([scope, label]) => <option key={scope} value={scope}>{t(label)}</option>)}</select></label>}
      <fieldset className="mt-4"><legend className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-gray-500"><span>{t('自定义标签')}</span>
      </legend>
        {tags.length > 0 && <button type="button" className="mobile-touch mt-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setTags([]); resetScroll(); }}>{t('清除标签筛选')}</button>}
        <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">{tagOptions.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
          title={memory.scope === 'saved' ? categoryLabel(tag) : tag} className={`mobile-touch rounded-lg px-2 py-1 text-sm ${tags.includes(tag) ? 'bg-indigo-600 text-white' : 'appearance-group text-gray-600 dark:text-gray-300'}`}
          onClick={() => { setTags(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag]); resetScroll(); }}>{memory.scope === 'saved' ? categoryLabel(tag) : tag}</button>)}</div>
      </fieldset>
      <label className="mt-4 block text-xs font-semibold text-gray-500">{t('排序')}<select aria-label={t('排序')} value={memory.sort} className={TOOLBAR_FIELD_CLASS}
        onChange={event => updateMemory({ ...memory, sort: event.target.value as 'updated' | 'name' })}><option value="updated">{t('最近更新')}</option><option value="name">{t('名称')}</option></select></label>
      <div className="mt-4 flex flex-wrap gap-2"><ToolbarButton onClick={() => { setTags([]); setQuery(''); updateMemory({ ...memory }); }}>{t('重置筛选')}</ToolbarButton>
        {onManage && <ToolbarButton onClick={() => void openManage(close, mobile, onManage)}>{t('管理提示词')}</ToolbarButton>}{mobile && onExtract && <ToolbarButton onClick={() => void openManage(close, mobile, onExtract)}>{t('AI 提取分类')}</ToolbarButton>}</div>
      </>}
    </ToolbarPopover>
    <ToolbarCountCaption>{mobile ? `${t(SCOPES.find(([scope]) => scope === memory.scope)![1])} · ` : ''}{t('匹配 {0} 条 · 共 {1} 条', [shown.length, scopeTotal])}</ToolbarCountCaption>
  </>;
  return <>{toolbarSlot && createPortal(toolbar, toolbarSlot)}<div data-workspace-body className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row" style={{ '--workspace-chrome-height': '0px' } as React.CSSProperties}>
    {directoryScope ? <PromptLibraryDirectoryNavigation id={navigationId} state={directories} entries={libraryChains} selectedIds={memory.directoryIds} allSelected={memory.allDirectories} unclassified={memory.unclassified} onSelect={updateDirectoryMemory} expanded={directoriesExpanded} onRename={onRenameDirectory} onDelete={onDeleteDirectory} onCreate={onCreateDirectory} onMove={onMoveDirectory} disabled={directoriesBusy} /> : <PromptLibraryCategoryNavigation id={navigationId} chains={combinationChains} names={categoryNames} tree={categoryTree} selected={memory.combinationCategory} unclassified={memory.combinationUnclassified} expanded={categoriesExpanded} onRename={onRenameCategory} onDelete={onDeleteCategory} onCreate={onCreateCategory} onMove={onMoveCategory} disabled={categoriesBusy} onSelect={selection => updateMemory({ ...memory, combinationCategory: selection.category, combinationUnclassified: selection.unclassified })} />}
    <div className={`aitag-split relative grid min-h-0 min-w-0 flex-1 grid-cols-1 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
    <div ref={scrollRef} onScroll={event => {
      scrollPositions.current[memory.scope] = event.currentTarget.scrollTop;
      try { localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions.current)); } catch { /* 滚动记忆受限时保留本次会话位置。 */ }
    }} className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6">
      {shown.length ? <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-character-grid items-start`} style={mobileGalleryStyle(imageDisplay, gridColumns)}>{shown.map(entry => {
        const { chain, section, kind } = entry;
        const label = section === 'items' && kind ? FRAGMENT_LABELS[kind] : section === 'saved' ? '组合' : '原文';
        const summary = promptBrowseSummary(entry, query);
        const name = chain.name?.trim() || entry.summary.split(/[\r\n]/)[0].slice(0, 48) || t('未命名');
        const busy = deletingId === chain.id;
        return <PressRevealSurface as="article" key={chain.id} role="button" tabIndex={0} aria-label={t('查看{0}', [name])} aria-busy={busy} aria-disabled={busy} pressDisabled={busy}
          className="appearance-group gallery-image-card gallery-card-visual group relative flex flex-col overflow-hidden rounded-2xl bg-white text-left focus-visible:outline-2 focus-visible:outline-indigo-500 dark:bg-gray-900" style={{ display: frostedCaption ? 'grid' : undefined }} data-prompt-library-entry={chain.id} data-safe-mode-work="true"
          onClick={() => { if (!busy) setSelectedId(chain.id); }} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!busy) setSelectedId(chain.id); } }}>
          <div className={`appearance-media mobile-gallery-frame relative aspect-[2/3] w-full overflow-hidden ${chain.previewImage ? '' : 'bg-gray-100 dark:bg-gray-800'}`}>
              {chain.previewImage && <SmartImage src={chain.previewImage} alt={name} thumbnailVariant="thumb-320" className="h-full w-full object-cover" containerClassName="h-full w-full" />}
            {!chain.previewImage && <div className="absolute inset-0 flex flex-col items-center justify-center px-3 pt-3 text-center text-gray-500 dark:text-gray-400" style={{ paddingBottom: 'calc(var(--image-card-caption-height, 0px) + .75rem)' }}>
              {section === 'saved' ? <Layers className="h-8 w-8 shrink-0" /> : <FileText className="h-8 w-8 shrink-0" />}
              <p className="mt-2 min-h-0 line-clamp-3 break-words text-xs leading-5"><PromptBrowseHighlight text={summary || t('还没有提示词')} query={query} /></p>
            </div>}
            {onDelete && <div data-card-action="true" data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20">
              <button type="button" disabled={!!deletingId} aria-label={t('删除「{0}」', [name])} title={t('删除')} onClick={event => { event.stopPropagation(); void remove(chain); }}
                className="mobile-size-locked inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 md:h-8 md:w-8">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>
            </div>}
            <ImageCardActions>
              {chain.previewImage && <ImageShareActions variant="card" className="flex-col" imageUrl={chain.previewImage} filename={`${name || 'cover'}.png`} notify={notify}
                favorite={{ imageUrl: chain.previewImage, title: name, sourceType: 'other', sourceId: chain.id }} />}
              <button data-card-action type="button" disabled={busy} aria-label={t('编辑{0}', [name])} title={t('编辑')} onClick={event => { event.stopPropagation(); onOpen(chain); }} className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}><Pencil className="h-4 w-4" /></button>
              <button data-card-action type="button" disabled={busy} aria-label={section === 'saved' ? t('复制组合数据') : t('复制{0}', [name])} title={t(section === 'saved' ? '复制组合数据' : '复制提示词')}
                onClick={event => { event.stopPropagation(); void copy(section === 'saved' ? JSON.stringify((chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot, null, 2) : chain.basePrompt || entry.summary, section === 'saved' ? '已复制这条记录的内容快照' : '已复制提示词'); }} className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}><Copy className="h-4 w-4" /></button>
            </ImageCardActions>
          </div>
          <div className="gallery-card-caption min-w-0 p-3">
            <div className="flex items-center justify-between gap-2"><h3 data-safe-mode-title="true" className="min-w-0 truncate text-sm font-bold text-gray-800 dark:text-gray-100"><PromptBrowseHighlight text={name} query={query} /></h3>
              <span className="gallery-card-badge shrink-0 rounded px-1.5 py-0.5 text-micro text-indigo-600 dark:text-indigo-300">{t(label)}</span></div>
            {chain.previewImage && query.trim() && <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-gray-600 dark:text-gray-300"><PromptBrowseHighlight text={summary} query={query} /></p>}
            <div className="gallery-card-meta mt-2 flex items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap gap-1">{getCustomChainTags(chain.tags).slice(0, 3).map(tag => <span key={tag} className="gallery-card-badge max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400"><PromptBrowseHighlight text={tag} query={query} /></span>)}</div>
              <ToolbarButton data-card-action tone="primary" disabled={busy} onClick={event => { event.stopPropagation(); onUse(chain); }}>{t('使用')}</ToolbarButton></div>
          </div>
        </PressRevealSurface>;
      })}</div> : <EmptyState title={t(entries.length ? '没有匹配的提示词' : '提示词库还是空的')} hint={t(entries.length ? '换个关键词，或清除筛选。' : '粘贴收录提示词。')} />}
    </div>
    {selected && <DetailSidePanel open title={selected.chain.name || selected.summary.slice(0, 48) || t('未命名')} sensitiveTitle
      subInfo={t(selected.kind ? FRAGMENT_LABELS[selected.kind] : selected.section === 'saved' ? '组合' : '原文')}
      onClose={closeDetail} onBack={closeDetail} headerActions={<><ToolbarButton onClick={() => onOpen(selected.chain)}>{t('编辑')}</ToolbarButton><ToolbarButton tone="primary" onClick={() => onUse(selected.chain)}>{t('使用')}</ToolbarButton></>}>
      {selected.chain.previewImage && <DetailImageStage><SmartImage src={selected.chain.previewImage} alt={selected.chain.name}
        containerClassName="relative w-full overflow-hidden" className="block h-auto max-h-[40vh] w-full object-contain" /></DetailImageStage>}
      {selected.section === 'saved' && onUpdateTags ? <PromptLibraryTagEditor key={selected.chain.id} tags={getCustomChainTags(selected.chain.tags)} suggestions={combinationTags} suggestionLabel={categoryLabel} onSave={tags => onUpdateTags(selected.chain, tags)} />
        : <div className="mt-3 flex flex-wrap gap-1">{(selected.chain.tags || []).map(tag => <span key={tag} className="appearance-group rounded px-2 py-1 text-xs">{tag}</span>)}</div>}
      {selectedRead ? <>
        {selectedRead.items.map(item => <section key={item.unitId} className="mt-4"><h3 className="text-xs text-gray-500">{item.directoryPath.join(' / ') || item.directoryName}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>{item.negative && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{item.negative}</p>}{item.constraintNotes && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500">{item.constraintNotes}</p>}</section>)}
        {selectedRead.roles.map(role => <section key={role.key} className="mt-4"><h3 className="text-sm font-semibold">{role.name}</h3>{Object.entries(role.sections).map(([kind, text]) => <div key={kind} className="mt-3"><h4 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{text}</p>{role.negatives[kind]?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{role.negatives[kind].text}</p>}</div>)}</section>)}
        {Object.entries(selectedRead.global).filter(([, field]) => field.provided).map(([kind, field]) => <section key={kind} className="mt-4"><h3 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.text}</p>{field.negative?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{field.negative.text}</p>}</section>)}
      </> : <><h3 className="mt-4 text-xs text-gray-500">{t('提示词原文')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.basePrompt}</p>{bilingualOf(selected.chain) && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-500">{bilingualOf(selected.chain)}</p>}{selected.chain.negativePrompt && <><h3 className="mt-4 text-xs text-gray-500">{t('负面提示词')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.negativePrompt}</p></>}</>}
      {selected.chain.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-gray-500">{selected.chain.description}</p>}
    </DetailSidePanel>}
    </div>
    </div>
  </>;
};
