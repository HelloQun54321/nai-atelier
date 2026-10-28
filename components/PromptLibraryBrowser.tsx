import type { PromptLibraryPanelActions } from './PromptLibrary';
import { getEntryPurposes, promptPurposeLabel, type PromptPurposeId } from '../services/promptPurposes.mjs';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Folder } from 'lucide-react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { FRAGMENT_LABELS, promptLibraryEntryLabel, type PromptFragmentKind } from '../services/promptLibraryEntries';
import { filterPromptBrowseEntries, normalizeBrowseText, promptBrowseEntries, promptBrowseSummary, type PromptBrowseScope } from '../services/promptLibraryBrowse';
import { EmptyState, ToolbarButton, ToolbarSearch } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { PromptLibraryCard, PromptLibraryGallery } from './PromptLibraryCard';
import { PromptPurposePicker } from './PromptPurposePicker';
import { ViewableImage } from './ImageLightbox';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { ImageActivityContext } from './SmartImage';
import { DetailImageStage, DetailSidePanel } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { bilingualOf, contentRead } from '../services/contentRoll';
import { PromptLibraryTagEditor } from './PromptLibraryTagEditor';
import { promptLibraryCategoryNames } from '../services/promptLibraryCategories';
import { getCustomChainTags } from '../services/chainTags';
import { ImageShareOverlay } from './ImageShareActions';
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
  renderEntryEditor?: (entry: PromptChain, controls: { onClose: () => void; actionsRef: React.MutableRefObject<PromptLibraryPanelActions | null> }) => React.ReactNode;
  selectionFocusEnabled?: boolean;
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
export const PromptLibraryBrowser: React.FC<PromptLibraryBrowserProps> = ({ chains, renderEntryEditor, selectionFocusEnabled = true, toolbarSlot, onUse, onOpen, onDelete, onManage, onExtract, onUpdateTags, categoryNames = [], categoryTree: suppliedCategoryTree, onCreateCategory, onRenameCategory, onDeleteCategory, onMoveCategory, categoriesBusy, directories: suppliedDirectories, onCreateDirectory, onRenameDirectory, onDeleteDirectory, onMoveDirectory, directoriesBusy, categoryChange, focusEntryId, notify }) => {
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
  const editorActions = useRef<PromptLibraryPanelActions | null>(null);
  const leaving = useRef(false);
  const [wide, setWide] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [deletingId, setDeletingId] = useState('');
  const deleting = useRef(false);
  const appliedCategoryChange = useRef<number | undefined>(undefined);
  const focusedId = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionAnchor = useGallerySelectionAnchor(scrollRef, scrollRef, selectedId || null, React.useContext(ImageActivityContext), selectionFocusEnabled);
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
  const shown = useMemo(() => filterPromptBrowseEntries(folderEntries, { ...memory, kind: '', query, tags: memory.scope === 'saved' ? tags : [], purposes: memory.scope === 'items' ? tags : [] }), [folderEntries, memory, query, tags]);
  const combinationTags = useMemo(() => promptLibraryCategoryNames(chains, [...categoryNames, ...categoryTree.nodes.map(node => node.name)]), [chains, categoryNames, categoryTree]);
  const selected = entries.find(entry => entry.chain.id === selectedId);
  const selectedRead = selected?.section === 'saved' ? contentRead((selected.chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot) : null;
  const finishClose = () => { selectionAnchor.preserveOnClose(); setSelectedId(''); };
  const leaveDetail = async () => {
    if (leaving.current) return false;
    leaving.current = true;
    try { return editorActions.current ? await editorActions.current.leave() : true; }
    finally { leaving.current = false; }
  };
  const closeDetail = useMobileHistoryLayer(!!selected, () => {
    if (editorActions.current) { void leaveDetail(); return false; }
    finishClose();
  }, 'prompt-library-detail');
  const selectEntry = async (chain: PromptChain) => {
    if (selectedId === chain.id) return;
    if (editorActions.current && !await leaveDetail()) return;
    selectionAnchor.prepareSelection(chain.id); setSelectedId(chain.id);
  };
  const handleUseEntry = async (chain: PromptChain) => {
    if (!editorActions.current || await leaveDetail()) onUse(chain);
  };
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
    void selectEntry(entry.chain);
  }, [focusEntryId, entries]);
  useEffect(() => {
    if (!toolbarSlot) return;
    const update = () => { setWide(toolbarSlot.getBoundingClientRect().width >= 650); setMobile(window.innerWidth < 768); };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(toolbarSlot);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [toolbarSlot]);
  const resetScroll = () => { selectionAnchor.clearAnchor(); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
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
      <div className="mt-4 space-y-2">
        {tags.length > 0 && <button type="button" className="mobile-touch text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setTags([]); resetScroll(); }}>{t('清除标签筛选')}</button>}
        {memory.scope === 'saved' ? <fieldset><legend className="text-xs font-semibold text-gray-500">{t('文件夹')}</legend>
          <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">{combinationTags.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
            title={categoryLabel(tag)} className={tags.includes(tag) ? 'mobile-touch rounded-lg bg-indigo-600 px-2 py-1 text-sm text-white' : 'appearance-group mobile-touch rounded-lg px-2 py-1 text-sm text-gray-600 dark:text-gray-300'}
            onClick={() => { setTags(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag]); resetScroll(); }}>{categoryLabel(tag)}</button>)}</div>
        </fieldset> : <PromptPurposePicker value={tags as PromptPurposeId[]} onChange={next => { setTags(next); resetScroll(); }} />}
      </div>
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
      selectionAnchor.onScroll();
      scrollPositions.current[memory.scope] = event.currentTarget.scrollTop;
      try { localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions.current)); } catch { /* 滚动记忆受限时保留本次会话位置。 */ }
    }} className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6">
      {shown.length ? <PromptLibraryGallery chains={shown.map(entry => entry.chain)} scrollRef={scrollRef} fitColumns={!!selectedId} resetKey={JSON.stringify([memory, query, tags])} renderCard={chain => {
        const entry = shown.find(item => item.chain.id === chain.id)!;
        const name = chain.name?.trim() || entry.summary.split(/[\r\n]/)[0].slice(0, 48) || t('未命名');
        const summary = promptBrowseSummary(entry, query);
        return <PromptLibraryCard chain={chain} label={promptLibraryEntryLabel(chain, directories)} selected={selectedId === chain.id}
          dimmed={selectionFocusEnabled && !!selectedId && selectedId !== chain.id} busy={deletingId === chain.id} deleteDisabled={!!deletingId}
          title={<PromptBrowseHighlight text={name} query={query} />} summary={!chain.previewImage || query.trim() ? <PromptBrowseHighlight text={summary || t('还没有提示词')} query={query} /> : undefined}
          tagContent={(entry.section === 'items' ? getEntryPurposes(chain).map(id => t(promptPurposeLabel(id))) : getCustomChainTags(chain.tags)).slice(0, 3).map(tag => <span key={tag} className="gallery-card-badge max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400"><PromptBrowseHighlight text={tag} query={query} /></span>)}
          onOpen={() => void selectEntry(chain)} onEdit={() => { if (entry.section === 'items' && renderEntryEditor) void selectEntry(chain); else if (!editorActions.current) onOpen(chain); else void leaveDetail().then(leave => { if (leave) onOpen(chain); }); }} onUse={() => void handleUseEntry(chain)}
          onDelete={onDelete ? () => void remove(chain) : undefined} notify={notify}
          onCopy={() => void copy(entry.section === 'saved' ? JSON.stringify((chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot, null, 2) : chain.basePrompt || entry.summary, entry.section === 'saved' ? '已复制这条记录的内容快照' : '已复制提示词')} />;
      }} /> : <EmptyState title={t(entries.length ? '没有匹配的提示词' : '提示词库还是空的')} hint={t(entries.length ? '换个关键词，或清除筛选。' : '粘贴收录提示词。')} />}
    </div>
    {selected && (selected.section === 'items' && renderEntryEditor ? renderEntryEditor(selected.chain, { onClose: finishClose, actionsRef: editorActions }) : <DetailSidePanel open title={selected.chain.name || selected.summary.slice(0, 48) || t('未命名')} sensitiveTitle
      subInfo={promptLibraryEntryLabel(selected.chain, directories)}
      onClose={closeDetail} onBack={closeDetail} headerActions={<><ToolbarButton onClick={() => onOpen(selected.chain)}>{t('编辑')}</ToolbarButton>{selected.section !== 'items' && <ToolbarButton tone="primary" onClick={() => onUse(selected.chain)}>{t('送到实验室')}</ToolbarButton>}</>}>
      {selected.chain.previewImage && <DetailImageStage pressResetKey={selected.chain.id}><ViewableImage src={selected.chain.previewImage} alt={selected.chain.name} notify={notify}
        favorite={{ imageUrl: selected.chain.previewImage, title: selected.chain.name, sourceType: 'other', sourceId: selected.chain.id }} className="block h-auto max-h-[40vh] w-full object-contain" />
        <ImageShareOverlay imageUrl={selected.chain.previewImage} filename={selected.chain.name + '.png'} notify={notify} favorite={{ imageUrl: selected.chain.previewImage, title: selected.chain.name, sourceType: 'other', sourceId: selected.chain.id }} />
      </DetailImageStage>}
      {selected.section === 'saved' && onUpdateTags ? <PromptLibraryTagEditor key={selected.chain.id} tags={getCustomChainTags(selected.chain.tags)} suggestions={combinationTags} suggestionLabel={categoryLabel} onSave={tags => onUpdateTags(selected.chain, tags)} />
        : <div className="mt-3 flex flex-wrap gap-1">{getEntryPurposes(selected.chain).map(id => t(promptPurposeLabel(id))).map(tag => <span key={tag} className="appearance-group rounded px-2 py-1 text-xs">{tag}</span>)}</div>}
      {selectedRead ? <>
        {selectedRead.items.map(item => <section key={item.unitId} className="mt-4"><h3 className="text-xs text-gray-500">{item.directoryPath.join(' / ') || item.directoryName}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>{item.negative && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{item.negative}</p>}{item.constraintNotes && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500">{item.constraintNotes}</p>}</section>)}
        {selectedRead.roles.map(role => <section key={role.key} className="mt-4"><h3 className="text-sm font-semibold">{role.name}</h3>{Object.entries(role.sections).map(([kind, text]) => <div key={kind} className="mt-3"><h4 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{text}</p>{role.negatives[kind]?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{role.negatives[kind].text}</p>}</div>)}</section>)}
        {Object.entries(selectedRead.global).filter(([, field]) => field.provided).map(([kind, field]) => <section key={kind} className="mt-4"><h3 className="text-xs text-gray-500">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.text}</p>{field.negative?.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{t('负面提示词')}：{field.negative.text}</p>}</section>)}
      </> : <><h3 className="mt-4 text-xs text-gray-500">{t('提示词原文')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.basePrompt}</p>{bilingualOf(selected.chain) && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-500">{bilingualOf(selected.chain)}</p>}{selected.chain.negativePrompt && <><h3 className="mt-4 text-xs text-gray-500">{t('负面提示词')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{selected.chain.negativePrompt}</p></>}</>}
      {selected.chain.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-gray-500">{selected.chain.description}</p>}
    </DetailSidePanel>)}
    </div>
    </div>
  </>;
};
