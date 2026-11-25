import type { PromptLibraryPanelActions } from './PromptLibrary';
import { getEntryPurposes, promptPurposeLabel, type PromptPurposeId } from '../services/promptPurposes.mjs';
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Check, Copy, Folder, FolderInput, Heart, ImagePlus, ListChecks, RefreshCw, Tags, Trash2, X } from 'lucide-react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { FRAGMENT_LABELS, getPromptCardBadges, getPromptEntryCopyText, isPromptLibraryCharacterProjection, parsePromptLibraryTags, projectCustomCharacterAsCombination, promptLibraryEntryLabel, type PromptFragmentKind } from '../services/promptLibraryEntries';
import { filterPromptBrowseEntries, normalizeBrowseText, promptBrowseEntries, promptBrowseSummary, type PromptBrowseScope } from '../services/promptLibraryBrowse';
import { EmptyState, PageSpinner, SegmentedControl, ToolbarButton, ToolbarSearch } from './DesignSystem';
import { LibraryDialog, PromptLibraryReadStatus, usePromptLibrary, type PromptLibraryReadState } from './PromptLibraryAccess';
import { FilterPanelFooter, FilterToggleButton, TOOLBAR_FIELD_CLASS, TOOLBAR_LABEL_CLASS, ToolbarPopover } from './ToolbarPopover';
import { ToolbarCountBadge } from './ToolbarCountBadge';
import { PromptLibraryCard, PromptLibraryGallery } from './PromptLibraryCard';
import { ViewableImage } from './ImageLightbox';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { ImageActivityContext } from './SmartImage';
import { DetailImageStage, DetailSidePanel } from './DetailPanel';
import { MobileOverflowMenu, useMobileHistoryLayer } from './MobileUI';
import { bilingualOf, contentRead } from '../services/contentRoll';
import { PromptLibraryTagEditor } from './PromptLibraryTagEditor';
import { CollectionTagInput } from './inspiration/CollectionControls';
import { promptLibraryCategoryNames } from '../services/promptLibraryCategories';
import { getCustomChainTags } from '../services/chainTags';
import { ImageShareOverlay } from './ImageShareActions';
import { createDefaultPromptLibraryTree, getPromptLibraryDirectoryPath, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, selectPromptLibraryDirectoryEntries, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { PROMPT_LIBRARY_ENTRY_DRAG_TYPE, PromptLibraryDirectoryNavigation, type PromptLibraryDirectorySelection } from './PromptLibraryDirectoryNavigation';
import { DirectoryTreeChecklist } from './DirectoryTreeChecklist';
import { getDirectoryDescendantIds } from '../services/directoryTree.mjs';
import { emptyPromptLibraryCategoryTree, listPromptLibraryCustomCharacters, PROMPT_LIBRARY_CHARACTER_ROOT, projectPromptLibraryCategoryTree, promptLibraryCategoryLabel, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { PromptLibraryCategoryNavigation } from './PromptLibraryCategoryNavigation';
import { usePromptLibraryFavorites } from './usePromptLibraryFavorites';
import { usePromptLibraryCoverActions } from './usePromptLibraryCoverActions';
import { promptLibraryCoverContent } from '../services/promptLibraryCoverTemplate';
import { fetchPromptLibraryUsageSummary } from '../services/promptLibraryUsage';
import { useConfirmDialog } from './ConfirmDialog';

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

const readMemory = (directories: PromptLibraryTreeState): { scope: PromptBrowseScope; directoryIds: string[]; allDirectories: boolean; unclassified: boolean; favorites: boolean; combinationFavorites: boolean; combinationCategory: string | null; combinationUnclassified: boolean; sort: 'updated' | 'name' } => {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    const scope = SCOPES.some(([key]) => key === value.scope) ? value.scope : 'items';
    const candidateLegacyId = Object.hasOwn(LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, value.kind) ? LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[value.kind as keyof typeof LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS] : '';
    const legacyId = directories.nodes.some(node => node.id === candidateLegacyId) ? candidateLegacyId : '';
    const hasDirectoryPreference = Array.isArray(value.directoryIds) || !!legacyId;
    const directoryIds = Array.isArray(value.directoryIds) ? value.directoryIds.filter((id: unknown) => typeof id === 'string') : legacyId ? [legacyId] : [];
    const unclassified = value.unclassified === true;
    const allDirectories = typeof value.allDirectories === 'boolean' ? (value.allDirectories || (!directoryIds.length && !unclassified)) : !hasDirectoryPreference;
    return { scope, favorites: value.favorites === true, combinationFavorites: value.combinationFavorites === true, combinationCategory: typeof value.combinationCategory === 'string' ? value.combinationCategory : null, combinationUnclassified: value.combinationUnclassified === true, directoryIds, allDirectories, unclassified, sort: value.sort === 'name' ? 'name' : 'updated' };
  } catch { return { scope: 'items', favorites: false, combinationFavorites: false, combinationCategory: null, combinationUnclassified: false, directoryIds: [], allDirectories: true, unclassified: false, sort: 'updated' }; }
};

export interface PromptLibraryBrowserProps extends PromptLibraryReadState {
  chains: PromptChain[];
  renderEntryEditor?: (entry: PromptChain, controls: { onClose: () => void; actionsRef: React.MutableRefObject<PromptLibraryPanelActions | null> }) => React.ReactNode;
  selectionFocusEnabled?: boolean;
  toolbarSlot: HTMLElement | null;
  onUse: (chain: PromptChain) => void;
  onOpen: (chain: PromptChain) => void;
  /** 投影卡「另存为新组合」：载入搭配但不绑定原角色 id。 */
  onSaveAs?: (chain: PromptChain) => void;
  onDelete?: (chain: PromptChain) => Promise<void>;
  onBulkDelete?: (ids: string[], onProgress: (completed: number) => void) => Promise<{ remainingIds: string[]; errorCount: number }>;
  onMoveEntriesToDirectory?: (ids: string[], targetDirectoryId: string) => Promise<void>;
  onBatchUpdateDirectories?: (ids: string[], changes: Record<string, boolean>) => Promise<void>;
  onBatchUpdateTags?: (ids: string[], tags: string[]) => Promise<void>;
  onClearCover?: (chain: PromptChain) => Promise<void>;
  onExtract?: () => void;
  onUpdateTags?: (chain: PromptChain, tags: string[]) => Promise<void>;
  onSelectingChange?: (selecting: boolean) => void;
  onActiveDirectoryIdsChange?: (directoryIds: string[]) => void;
  registerCoverSettingsOpener?: (opener: (() => void) | null) => void;
  registerSelectionStarter?: (starter: (() => void) | null, available?: boolean) => void;
  categoryNames?: string[];
  categoryTree?: PromptLibraryCategoryTreeState;
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

/** 汇总浏览卡片；角色投影与组合同夹，支持多选整理、拖拽归类与右侧就地编辑。 */
export const PromptLibraryBrowser: React.FC<PromptLibraryBrowserProps> = ({
  chains,
  chainsLoading: suppliedChainsLoading,
  chainsError: suppliedChainsError,
  onRetryChains: suppliedRetryChains,
  renderEntryEditor,
  selectionFocusEnabled = true,
  toolbarSlot,
  onUse,
  onOpen,
  onSaveAs,
  onDelete,
  onBulkDelete,
  onMoveEntriesToDirectory,
  onBatchUpdateDirectories,
  onBatchUpdateTags,
  onClearCover,
  onExtract,
  onUpdateTags,
  onSelectingChange,
  onActiveDirectoryIdsChange,
  registerCoverSettingsOpener,
  registerSelectionStarter,
  categoryNames = [],
  categoryTree: suppliedCategoryTree,
  categoriesBusy,
  directories: suppliedDirectories,
  onCreateDirectory,
  onRenameDirectory,
  onDeleteDirectory,
  onMoveDirectory,
  directoriesBusy,
  categoryChange,
  focusEntryId,
  notify,
}) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const library = usePromptLibrary();
  const pageActive = React.useContext(ImageActivityContext);
  const coverActions = usePromptLibraryCoverActions({ active: pageActive !== false, notify });
  const chainsLoading = suppliedChainsLoading ?? library?.chainsLoading;
  const chainsError = suppliedChainsError ?? library?.chainsError;
  const onRetryChains = suppliedRetryChains ?? library?.onRetryChains;
  const countsPending = !!(chainsLoading || chainsError);
  const directories = useMemo(() => suppliedDirectories || createDefaultPromptLibraryTree(), [suppliedDirectories]);
  const [memory, setMemory] = useState(() => readMemory(directories));
  const navigationId = useId();
  const [directoriesExpanded, setDirectoriesExpanded] = useState(() => { try { return localStorage.getItem(EXPANDED_KEY) === 'true'; } catch { return false; } });
  const [categoriesExpanded, setCategoriesExpanded] = useState(() => { try { return localStorage.getItem(CATEGORIES_EXPANDED_KEY) === 'true'; } catch { return false; } });
  const navigationExpanded = memory.scope === 'saved' ? categoriesExpanded : directoriesExpanded;
  const setNavigationOpen = (expanded: boolean) => {
    if (memory.scope === 'saved') setCategoriesExpanded(expanded); else setDirectoriesExpanded(expanded);
    try { localStorage.setItem(memory.scope === 'saved' ? CATEGORIES_EXPANDED_KEY : EXPANDED_KEY, String(expanded)); } catch { /* 本端存储受限时仍可切换。 */ }
  };
  const toggleDirectories = () => setNavigationOpen(!navigationExpanded);

  const [query, setQuery] = useState('');
  const [scopeTags, setScopeTags] = useState<{ items: string[]; saved: string[] }>({ items: [], saved: [] });
  const [coverFilter, setCoverFilter] = useState<'all' | 'with' | 'without'>('all');
  const tagScope = memory.scope === 'saved' ? 'saved' : 'items';
  const tags = scopeTags[tagScope];
  const setTags = (next: string[] | ((previous: string[]) => string[])) => setScopeTags(previous => ({ ...previous, [tagScope]: typeof next === 'function' ? next(previous[tagScope]) : next }));

  const [selectedId, setSelectedId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [batchDirOpen, setBatchDirOpen] = useState(false);
  const [batchDirChanges, setBatchDirChanges] = useState<Record<string, boolean>>({});
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagDraft, setBatchTagDraft] = useState('');
  const [usageById, setUsageById] = useState<Map<string, number>>(() => new Map());
  const [copiedDetail, setCopiedDetail] = useState(false);

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
  const aliveRef = useRef(true);
  const copyDetailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (copyDetailTimer.current) clearTimeout(copyDetailTimer.current);
    };
  }, []);

  const refreshUsage = useCallback(async () => {
    if (typeof fetch !== 'function') return;
    try {
      const summary = await fetchPromptLibraryUsageSummary();
      if (!aliveRef.current) return;
      setUsageById(new Map(summary.items.map(row => [row.chainId, row.count])));
    } catch { /* 摘要读取失败仅隐藏计数胶囊，不打扰浏览。 */ }
  }, []);

  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  useEffect(() => {
    const handleVisibility = () => { if (!document.hidden) void refreshUsage(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refreshUsage]);

  const characterProjections = useMemo(() => listPromptLibraryCustomCharacters(chains)
    .map(item => chains.find(chain => chain.id === item.id && chain.type === 'character'))
    .filter((chain): chain is PromptChain => !!chain)
    .map(chain => projectCustomCharacterAsCombination(chain, PROMPT_LIBRARY_CHARACTER_ROOT)), [chains]);
  const entries = useMemo(() => {
    const base = promptBrowseEntries(chains, directories);
    const seen = new Set(base.map(entry => entry.chain.id));
    return [...base, ...promptBrowseEntries(characterProjections, directories).filter(entry => !seen.has(entry.chain.id))];
  }, [chains, characterProjections, directories]);

  const favorites = usePromptLibraryFavorites(chains);
  const favoritesSelected = memory.scope === 'saved' ? memory.combinationFavorites : memory.favorites;
  const isFragmentScope = (entry: { section: string }) => entry.section === 'items' || entry.section === 'originals';
  const libraryChains = useMemo(() => entries.filter(isFragmentScope).map(entry => entry.chain), [entries]);
  const combinationChains = useMemo(() => entries.filter(entry => entry.section === 'saved').map(entry => entry.chain), [entries]);
  const customCharacters = useMemo(() => listPromptLibraryCustomCharacters(chains), [chains]);
  const categoryTree = useMemo(() => projectPromptLibraryCategoryTree(combinationChains, categoryNames, suppliedCategoryTree || emptyPromptLibraryCategoryTree(), customCharacters), [combinationChains, categoryNames, suppliedCategoryTree, customCharacters]);
  const selectedCategoryIds = useMemo(() => memory.combinationCategory === null ? null : getDirectoryDescendantIds(categoryTree.nodes, memory.combinationCategory), [categoryTree, memory.combinationCategory]);
  const folderIds = useMemo(() => new Set(categoryTree.nodes.map(node => node.id)), [categoryTree]);
  const categoryLabel = useCallback((name: string) => promptLibraryCategoryLabel(categoryTree, name), [categoryTree]);
  const scopeTotal = useMemo(() => entries.filter(entry => memory.scope === 'items' ? isFragmentScope(entry) : entry.section === memory.scope).length, [entries, memory.scope]);

  const directoryEntries = useMemo(() => memory.scope !== 'items' ? entries : (() => {
    const fragments = entries.filter(entry => isPromptLibraryFragmentEntry(entry.chain));
    const included = new Set((memory.allDirectories ? fragments.map(entry => entry.chain) : selectPromptLibraryDirectoryEntries(fragments.map(entry => entry.chain), directories, memory.directoryIds)).map(chain => chain.id));
    return entries.filter(entry => {
      if (!isFragmentScope(entry)) return false;
      const inDirectory = entry.section === 'originals'
        ? (memory.allDirectories || memory.unclassified)
        : (included.has(entry.chain.id) || (memory.unclassified && !getPromptLibraryEntryDirectoryIds(entry.chain, directories).length));
      return inDirectory && (!memory.favorites || !!favorites.ids?.has(entry.chain.id));
    });
  })(), [entries, memory.scope, memory.allDirectories, memory.directoryIds, memory.unclassified, memory.favorites, favorites.ids, directories]);

  const folderEntries = useMemo(() => memory.scope !== 'saved' ? directoryEntries : directoryEntries.filter(entry => {
    if (memory.combinationFavorites && !favorites.ids?.has(entry.chain.id)) return false;
    const tags = getCustomChainTags(entry.chain.tags);
    if (memory.combinationCategory !== null) return tags.some(tag => selectedCategoryIds?.has(tag));
    if (!memory.combinationUnclassified) return true;
    return !tags.some(tag => folderIds.has(tag));
  }), [directoryEntries, memory.scope, memory.combinationCategory, memory.combinationUnclassified, memory.combinationFavorites, favorites.ids, selectedCategoryIds, folderIds]);

  const shown = useMemo(() => {
    const base = filterPromptBrowseEntries(folderEntries, {
      ...memory,
      scope: memory.scope === 'items' ? 'all' : 'saved',
      kind: '',
      query,
      tags: memory.scope === 'saved' ? tags : [],
      purposes: [],
    }, directories);
    if (coverFilter === 'with') return base.filter(entry => Boolean(entry.chain.previewImage));
    if (coverFilter === 'without') return base.filter(entry => !entry.chain.previewImage);
    return base;
  }, [folderEntries, memory, query, tags, coverFilter, directories]);

  const combinationTags = useMemo(() => categoryTree.nodes.map(node => node.name), [categoryTree]);
  const selected = entries.find(entry => entry.chain.id === selectedId);
  const selectedRead = selected?.section === 'saved' ? contentRead((selected.chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot) : null;
  const finishClose = useCallback(() => { selectionAnchor.preserveOnClose(); setSelectedId(''); }, [selectionAnchor]);
  const leaveDetail = useCallback(async () => {
    if (leaving.current) return false;
    leaving.current = true;
    try { return editorActions.current ? await editorActions.current.leave() : true; }
    finally { leaving.current = false; }
  }, []);
  const closeDetail = useMobileHistoryLayer(!!selected, () => {
    if (editorActions.current) { void leaveDetail(); return false; }
    finishClose();
  }, 'prompt-library-detail');

  const selectEntry = async (chain: PromptChain) => {
    if (selectedId === chain.id) return;
    if (editorActions.current && !await leaveDetail()) return;
    setCopiedDetail(false);
    selectionAnchor.prepareSelection(chain.id);
    setSelectedId(chain.id);
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
    const entry = entries.find(item => item.chain.id === focusEntryId)!;
    const scope = entry.section === 'saved' ? 'saved' : 'items';
    setQuery(''); setCoverFilter('all'); setScopeTags(previous => ({ ...previous, [scope]: [] }));
    setMemory(previous => entry.section === 'saved' ? { ...previous, scope, combinationCategory: null, combinationUnclassified: false, combinationFavorites: false } : { ...previous, scope, directoryIds: [], allDirectories: true, unclassified: false, favorites: false });
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

  useEffect(() => { onSelectingChange?.(selecting); }, [selecting, onSelectingChange]);
  useEffect(() => {
    if (!onActiveDirectoryIdsChange) return;
    onActiveDirectoryIdsChange(memory.scope === 'items' && !memory.allDirectories && !memory.unclassified ? memory.directoryIds : []);
  }, [memory.scope, memory.allDirectories, memory.unclassified, memory.directoryIds, onActiveDirectoryIdsChange]);

  useEffect(() => {
    registerCoverSettingsOpener?.(coverActions.openCoverSettings);
    return () => registerCoverSettingsOpener?.(null);
  }, [registerCoverSettingsOpener, coverActions.openCoverSettings]);

  const canMultiSelect = Boolean(onBulkDelete || onBatchUpdateDirectories || onBatchUpdateTags);
  const selectedEntries = useMemo(() => shown.map(item => item.chain).filter(chain => selectedIds.has(chain.id)), [shown, selectedIds]);
  const selectedCombinationEntries = useMemo(() => selectedEntries.filter(chain => !isPromptLibraryCharacterProjection(chain)), [selectedEntries]);

  const beginSelection = useCallback(async () => {
    if (bulkBusy || !shown.length || !canMultiSelect) return;
    if (selectedId) {
      if (editorActions.current && !await leaveDetail()) return;
      finishClose();
    }
    setSelectedIds(new Set());
    setSelecting(true);
  }, [bulkBusy, shown.length, canMultiSelect, selectedId, leaveDetail, finishClose]);

  useEffect(() => {
    registerSelectionStarter?.(canMultiSelect ? () => { void beginSelection(); } : null, shown.length > 0 && !bulkBusy);
  }, [registerSelectionStarter, canMultiSelect, beginSelection, shown.length, bulkBusy]);

  useEffect(() => () => registerSelectionStarter?.(null), [registerSelectionStarter]);

  const toggleSelected = (id: string) => {
    if (bulkBusy) return;
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
  const setScope = (scope: PromptBrowseScope) => {
    if (selecting) {
      setSelecting(false);
      setSelectedIds(new Set());
    }
    updateMemory({ ...memory, scope }, false);
  };
  const toggleFavorites = () => updateMemory(memory.scope === 'saved' ? { ...memory, combinationFavorites: !memory.combinationFavorites } : { ...memory, favorites: !memory.favorites });
  const directoryScope = memory.scope === 'items';
  const selectedDirectoryPath = memory.scope === 'saved'
    ? (memory.combinationCategory === null ? null : categoryLabel(memory.combinationCategory)) ?? t(memory.combinationUnclassified ? '未归类' : '全部')
    : memory.allDirectories ? t('全部') : memory.unclassified ? t('未归类') : memory.directoryIds.map(id => getPromptLibraryDirectoryPath(directories, id).map(node => node.name).join(' / ')).filter(Boolean).join('、');

  const remove = async (chain: PromptChain) => {
    if (!onDelete || deleting.current) return;
    deleting.current = true; setDeletingId(chain.id);
    try { await onDelete(chain); void refreshUsage(); }
    catch (cause) { notify(t('删除失败：{0}', [cause instanceof Error ? cause.message : String(cause)]), 'error'); }
    finally { deleting.current = false; setDeletingId(''); }
  };

  const handleBulkDeleteSelected = async () => {
    if (!onBulkDelete || bulkBusy || !selectedEntries.length) return;
    const hasCharacter = selectedEntries.some(isPromptLibraryCharacterProjection);
    const ids = selectedEntries.map(chain => chain.id);
    if (!await confirmAction({
      rememberKey: 'prompt-library.delete-batch',
      title: t('删除 {0} 条？', [ids.length]),
      message: hasCharacter
        ? t('将永久删除所选提示词与自定义角色及其封面引用，其他历史原图保留。此操作无法撤销。')
        : t('将永久删除所选提示词记录及其封面、参考图引用，其他历史原图保留。此操作无法撤销。'),
      confirmLabel: t('确认删除'),
      tone: 'danger',
    })) return;
    setBulkBusy(true);
    setBulkProgress({ completed: 0, total: ids.length });
    try {
      const result = await onBulkDelete(ids, completed => setBulkProgress({ completed, total: ids.length }));
      const deleted = ids.length - result.remainingIds.length;
      setSelectedIds(new Set(result.remainingIds));
      if (!result.remainingIds.length && !result.errorCount) setSelecting(false);
      void refreshUsage();
      notify(
        result.remainingIds.length
          ? t('已删除 {0} 条，{1} 条未删除', [deleted, result.remainingIds.length])
          : result.errorCount
            ? t('已删除 {0} 条，{1} 项请求返回异常，请检查结果', [deleted, result.errorCount])
            : t('已删除 {0} 条', [deleted]),
        result.remainingIds.length || result.errorCount ? 'error' : 'success',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : t('批量删除失败，请稍后重试'), 'error');
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  };

  const openBatchDirectories = () => {
    setBatchDirChanges({});
    setBatchDirOpen(true);
  };

  const saveBatchDirectories = async () => {
    if (!onBatchUpdateDirectories || !selectedEntries.length || !Object.keys(batchDirChanges).length || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBatchUpdateDirectories(selectedEntries.map(chain => chain.id), batchDirChanges);
      setBatchDirOpen(false);
      setBatchDirChanges({});
    } catch (error) {
      notify(error instanceof Error ? error.message : t('保存失败，请稍后重试'), 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const openBatchTags = () => {
    setBatchTagDraft('');
    setBatchTagOpen(true);
  };

  const saveBatchTags = async () => {
    if (!onBatchUpdateTags || !selectedCombinationEntries.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBatchUpdateTags(selectedCombinationEntries.map(chain => chain.id), parsePromptLibraryTags(batchTagDraft));
      setBatchTagOpen(false);
      setBatchTagDraft('');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('标签更新失败'), 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const copyDetailText = async (chain: PromptChain) => {
    const text = getPromptEntryCopyText(chain);
    if (!text) { notify(t('还没有提示词'), 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDetail(true);
      if (copyDetailTimer.current) clearTimeout(copyDetailTimer.current);
      copyDetailTimer.current = setTimeout(() => setCopiedDetail(false), 1500);
      notify(t('已复制提示词'));
    } catch {
      notify(t('复制失败，请手动选择文本'), 'error');
    }
  };

  const openFromFilter = async (close: () => void, isMobileFilter: boolean, callback?: () => void) => {
    // 沿用筛选层返回顺序，避免手机异步返回关掉后续弹层。
    const returned = isMobileFilter && window.history.state?.__naiMobileLayer?.startsWith('sheet-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    flushSync(close);
    if (returned) await returned;
    toolbarSlot?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
    callback?.();
  };

  const filterCount = (memory.scope === 'saved' ? tags.length : 0) + Number(favoritesSelected) + Number(coverFilter !== 'all');
  const activeFilters = filterCount > 0 || memory.sort !== 'updated';
  const emptyFiltersActive = filterCount > 0 || Boolean(query) || (directoryScope ? !memory.allDirectories || memory.unclassified : memory.combinationCategory !== null || memory.combinationUnclassified);

  const resetAllFilters = () => {
    setTags([]);
    setQuery('');
    setCoverFilter('all');
    updateMemory(
      memory.scope === 'saved'
        ? { ...memory, combinationFavorites: false, combinationCategory: null, combinationUnclassified: false, sort: 'updated' }
        : { ...memory, favorites: false, directoryIds: [], allDirectories: true, unclassified: false, sort: 'updated' },
    );
  };

  const toolbar = selecting ? (
    <>
      <div role="group" aria-label={t('批量操作')} className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-clip whitespace-nowrap">
        <b aria-live="polite" className="flex-none text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-300" title={bulkProgress ? t('正在删除 {0}/{1}', [bulkProgress.completed, bulkProgress.total]) : t('已选 {0} 条', [selectedEntries.length])}>
          {bulkProgress
            ? <><span className="md:hidden">{bulkProgress.completed}/{bulkProgress.total}</span><span className="hidden md:inline">{t('正在删除 {0}/{1}', [bulkProgress.completed, bulkProgress.total])}</span></>
            : <><span className="md:hidden">{selectedEntries.length}</span><span className="hidden md:inline">{t('已选 {0} 条', [selectedEntries.length])}</span></>}
        </b>
        <ToolbarButton aria-label={t('全选筛选结果')} title={t('全选筛选结果')} disabled={bulkBusy} onClick={() => setSelectedIds(new Set(shown.map(entry => entry.chain.id)))} className="mobile-touch !px-2.5 max-md:hidden">{t('全选筛选结果')}</ToolbarButton>
        <ToolbarButton aria-label={t('反选筛选结果')} title={t('反选筛选结果')} disabled={bulkBusy} onClick={() => setSelectedIds(previous => new Set(shown.filter(entry => !previous.has(entry.chain.id)).map(entry => entry.chain.id)))} className="mobile-touch !px-2.5 max-md:hidden">{t('反选筛选结果')}</ToolbarButton>
        <ToolbarButton aria-label={t('清空选择')} title={t('清空选择')} disabled={bulkBusy || !selectedEntries.length} onClick={() => setSelectedIds(new Set())} className="mobile-touch !px-2.5 max-md:hidden">{t('清空选择')}</ToolbarButton>
        {directoryScope && onBatchUpdateDirectories && (
          <ToolbarButton aria-label={t('设置文件夹')} title={t('设置文件夹')} disabled={bulkBusy || directoriesBusy || !selectedEntries.length} onClick={openBatchDirectories} className="mobile-touch !px-2.5">
            <FolderInput /><span className="toolbar-responsive-label hidden md:inline">{t('设置文件夹')}</span>
          </ToolbarButton>
        )}
        {!directoryScope && onBatchUpdateTags && (
          <ToolbarButton aria-label={t('编辑标签')} title={t('编辑标签')} disabled={bulkBusy || !selectedCombinationEntries.length} onClick={openBatchTags} className="mobile-touch !px-2.5">
            <Tags /><span className="toolbar-responsive-label hidden md:inline">{t('编辑标签')}</span>
          </ToolbarButton>
        )}
        <ToolbarButton aria-label={t('生成封面')} title={t('生成封面')} disabled={bulkBusy || !selectedEntries.length} onClick={() => coverActions.requestCoversBatch(selectedEntries)} className="mobile-touch !px-2.5">
          <ImagePlus /><span className="toolbar-responsive-label hidden md:inline">{t('生成封面')}</span>
        </ToolbarButton>
        {onBulkDelete && (
          <ToolbarButton tone="danger" aria-label={t('删除')} title={t('删除')} disabled={bulkBusy || !selectedEntries.length} onClick={() => void handleBulkDeleteSelected()} className="mobile-touch ml-auto !px-2.5">
            <Trash2 /><span className="toolbar-responsive-label hidden md:inline">{t('删除')}</span>
          </ToolbarButton>
        )}
      </div>
      <MobileOverflowMenu className="md:hidden" items={[
        { label: '全选筛选结果', disabled: bulkBusy, onClick: () => setSelectedIds(new Set(shown.map(entry => entry.chain.id))) },
        { label: '反选筛选结果', disabled: bulkBusy, onClick: () => setSelectedIds(previous => new Set(shown.filter(entry => !previous.has(entry.chain.id)).map(entry => entry.chain.id))) },
        { label: '清空选择', disabled: bulkBusy || !selectedEntries.length, onClick: () => setSelectedIds(new Set()) },
      ]} />
      <ToolbarButton aria-label={t('退出多选')} title={t('退出多选')} disabled={bulkBusy} onClick={() => { setSelectedIds(new Set()); setSelecting(false); }} className="mobile-touch !px-2.5">
        <X /><span className="toolbar-responsive-label hidden md:inline">{t('退出多选')}</span>
      </ToolbarButton>
    </>
  ) : (
    <>
      <ToolbarButton data-agent-action="browse" aria-label={t(navigationExpanded ? '收起目录' : '展开目录')} title={[t(navigationExpanded ? '收起目录' : '展开目录'), selectedDirectoryPath || t('全部目录')].filter(Boolean).join(' · ')} aria-expanded={navigationExpanded} aria-controls={navigationId} active={navigationExpanded || (directoryScope ? !memory.allDirectories || memory.unclassified : memory.combinationCategory !== null || memory.combinationUnclassified)} onClick={toggleDirectories} className="mobile-touch !px-2.5 md:!px-3"><Folder className="h-4 w-4" /><span className="hidden max-w-24 truncate md:inline">{selectedDirectoryPath || t('全部目录')}</span></ToolbarButton>
      {!mobile && wide && <SegmentedControl ariaLabel={t('提示词库分区')} value={memory.scope} onChange={setScope} options={SCOPES.map(([scope, label]) => ({ value: scope, label }))} />}
      {!mobile && !wide && <select aria-label={t('提示词库范围')} value={memory.scope} onChange={event => setScope(event.target.value as PromptBrowseScope)}
        className="appearance-input mobile-touch h-10 w-24 shrink-0 rounded-xl border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700">
        {SCOPES.map(([scope, label]) => <option key={scope} value={scope}>{t(label)}</option>)}
      </select>}
      <ToolbarPopover label="筛选" title={t(memory.scope === 'saved' ? '筛选组合' : '筛选提示词库')} width={320} count={filterCount} active={activeFilters}>
        {(close, isMobileFilter) => <div className="space-y-3.5">
          <FilterToggleButton active={favoritesSelected} tone="rose" icon={<Heart className={favoritesSelected ? 'fill-current' : ''} />} onClick={toggleFavorites}>{t('只看收藏')}</FilterToggleButton>
          <div>
            <span className={TOOLBAR_LABEL_CLASS}>{t('封面')}</span>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="group" aria-label={t('封面')}>
              <FilterToggleButton active={coverFilter === 'all'} onClick={() => { setCoverFilter('all'); resetScroll(); }}>{t('全部')}</FilterToggleButton>
              <FilterToggleButton active={coverFilter === 'with'} onClick={() => { setCoverFilter('with'); resetScroll(); }}>{t('封面')}</FilterToggleButton>
              <FilterToggleButton active={coverFilter === 'without'} onClick={() => { setCoverFilter('without'); resetScroll(); }}>{t('无封面')}</FilterToggleButton>
            </div>
          </div>
          {isMobileFilter && <label className={TOOLBAR_LABEL_CLASS}>{t('提示词库范围')}<select aria-label={t('提示词库范围')} value={memory.scope} onChange={event => setScope(event.target.value as PromptBrowseScope)} className={TOOLBAR_FIELD_CLASS}>{SCOPES.map(([scope, label]) => <option key={scope} value={scope}>{t(label)}</option>)}</select></label>}
          {memory.scope === 'saved' && (
            <div className="space-y-2">
              {tags.length > 0 && <button type="button" className="mobile-touch text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setTags([]); resetScroll(); }}>{t('清除标签筛选')}</button>}
              <fieldset><legend className={TOOLBAR_LABEL_CLASS}>{t('文件夹')}</legend>
                <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">{combinationTags.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
                  title={categoryLabel(tag)} className={tags.includes(tag) ? 'mobile-touch rounded-lg bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-2 py-1 text-sm text-white' : 'appearance-group mobile-touch rounded-lg px-2 py-1 text-sm text-gray-600 dark:text-gray-300'}
                  onClick={() => { setTags(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag]); resetScroll(); }}>{categoryLabel(tag)}</button>)}</div>
              </fieldset>
            </div>
          )}
          <label className={TOOLBAR_LABEL_CLASS}>{t('排序')}<select aria-label={t('排序')} value={memory.sort} className={TOOLBAR_FIELD_CLASS}
            onChange={event => updateMemory({ ...memory, sort: event.target.value as 'updated' | 'name' })}><option value="updated">{t('最近更新')}</option><option value="name">{t('名称')}</option></select></label>
          <FilterPanelFooter onReset={() => { setTags([]); setQuery(''); setCoverFilter('all'); updateMemory(memory.scope === 'saved' ? { ...memory, combinationFavorites: false } : { ...memory, favorites: false }); }}>
            <ToolbarButton onClick={() => { close(); coverActions.openCoverSettings(); }}>{t('封面生成设置')}</ToolbarButton>
            {isMobileFilter && onExtract && <ToolbarButton onClick={() => void openFromFilter(close, isMobileFilter, onExtract)}>{t('AI 提取分类')}</ToolbarButton>}
          </FilterPanelFooter>
        </div>}
      </ToolbarPopover>
      <ToolbarSearch value={query} trailing={!countsPending && <ToolbarCountBadge inline total={scopeTotal} loaded={shown.length} />} aria-label={t('搜索名称、正文或标签')} placeholder={t(wide ? '搜索名称、正文或标签' : '搜索')}
        onChange={event => { setQuery(event.target.value); resetScroll(); }} className="max-[360px]:!pl-2" containerClassName="min-w-0 flex-1 md:max-w-none! max-[360px]:[&>svg]:hidden" />
      {canMultiSelect && (
        <ToolbarButton className="max-md:hidden !px-2.5" disabled={bulkBusy || !shown.length} onClick={() => void beginSelection()} aria-label={t('多选')} title={t('多选')}>
          <ListChecks className="h-4 w-4" /><span className="toolbar-responsive-label hidden xl:inline">{t('多选')}</span>
        </ToolbarButton>
      )}
    </>
  );

  // 计算批量目录设置弹窗的勾选与半选态
  const batchSelectedDirIds: string[] = [];
  const batchMixedDirIds: string[] = [];
  if (batchDirOpen) {
    for (const node of directories.nodes) {
      const count = selectedEntries.filter(chain => getPromptLibraryEntryDirectoryIds(chain, directories).includes(node.id)).length;
      const touched = Object.hasOwn(batchDirChanges, node.id);
      if (touched ? batchDirChanges[node.id] : count === selectedEntries.length) batchSelectedDirIds.push(node.id);
      if (!touched && count > 0 && count < selectedEntries.length) batchMixedDirIds.push(node.id);
    }
  }

  return <>
    {toolbarSlot && createPortal(toolbar, toolbarSlot)}
    <div data-workspace-body className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row" style={{ '--workspace-chrome-height': '0px' } as React.CSSProperties}>
      {directoryScope ? (
        <PromptLibraryDirectoryNavigation
          id={navigationId}
          state={directories}
          entries={libraryChains}
          countsPending={countsPending}
          selectedIds={memory.directoryIds}
          allSelected={memory.allDirectories}
          unclassified={memory.unclassified}
          onSelect={updateDirectoryMemory}
          expanded={directoriesExpanded}
          onRename={onRenameDirectory}
          onDelete={onDeleteDirectory}
          onCreate={onCreateDirectory}
          onMove={onMoveDirectory}
          onDropEntries={onMoveEntriesToDirectory}
          onRequestClose={() => setNavigationOpen(false)}
          disabled={directoriesBusy || bulkBusy}
        />
      ) : (
        <PromptLibraryCategoryNavigation
          id={navigationId}
          chains={combinationChains}
          customCharacters={customCharacters}
          countsPending={countsPending}
          names={categoryNames}
          tree={categoryTree}
          selected={memory.combinationCategory}
          unclassified={memory.combinationUnclassified}
          expanded={categoriesExpanded}
          disabled={categoriesBusy || bulkBusy}
          onRequestClose={() => setNavigationOpen(false)}
          onSelect={selection => updateMemory({ ...memory, combinationCategory: selection.category, combinationUnclassified: selection.unclassified })}
        />
      )}
      <div className={`aitag-split relative grid min-h-0 min-w-0 flex-1 grid-cols-1 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <div
          ref={scrollRef}
          onScroll={event => {
            selectionAnchor.onScroll();
            scrollPositions.current[memory.scope] = event.currentTarget.scrollTop;
            try { localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions.current)); } catch { /* 滚动记忆受限时保留本次会话位置。 */ }
          }}
          className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-28 md:p-6"
        >
          {shown.length ? (
            <PromptLibraryGallery
              chains={shown.map(entry => entry.chain)}
              scrollRef={scrollRef}
              fitColumns={!!selectedId}
              freezeColumns={Boolean(selected)}
              resetKey={JSON.stringify([memory, query, tags, coverFilter])}
              renderCard={chain => {
                const entry = shown.find(item => item.chain.id === chain.id)!;
                const name = chain.name?.trim() || entry.summary.split(/[\r\n]/)[0].slice(0, 48) || t('未命名');
                const summary = promptBrowseSummary(entry, query);
                const bilingual = !chain.previewImage ? bilingualOf(chain) : '';
                void coverActions.revision;
                const coverGeneration = coverActions.getGeneration(chain.id);
                const coverBusy = coverActions.isBusy(chain.id);
                const draggableCard = Boolean(directoryScope && onMoveEntriesToDirectory && !directoriesBusy && !bulkBusy);
                return (
                  <PromptLibraryCard
                    chain={chain}
                    label={promptLibraryEntryLabel(chain, directories)}
                    selected={!selecting && selectedId === chain.id}
                    selecting={selecting}
                    checked={selectedIds.has(chain.id)}
                    onToggleSelect={() => toggleSelected(chain.id)}
                    dimmed={!selecting && selectionFocusEnabled && !!selectedId && selectedId !== chain.id}
                    busy={deletingId === chain.id}
                    deleteDisabled={!!deletingId || bulkBusy}
                    draggable={draggableCard}
                    onDragStart={draggableCard ? event => {
                      const ids = selecting && selectedIds.has(chain.id) ? selectedEntries.map(item => item.id) : [chain.id];
                      event.dataTransfer.setData(PROMPT_LIBRARY_ENTRY_DRAG_TYPE, JSON.stringify(ids));
                      event.dataTransfer.effectAllowed = 'link';
                    } : undefined}
                    title={<PromptBrowseHighlight text={name} query={query} />}
                    summary={<PromptBrowseHighlight text={summary || t('还没有提示词')} query={query} />}
                    bilingualPreview={bilingual && bilingual !== summary ? bilingual : undefined}
                    badges={getPromptCardBadges(chain, directories, categoryLabel)}
                    copyText={getPromptEntryCopyText(chain)}
                    usageCount={usageById.get(chain.id) || 0}
                    onOpen={() => void selectEntry(chain)}
                    onDelete={onDelete ? () => void remove(chain) : undefined}
                    onClearCover={onClearCover && chain.previewImage ? () => onClearCover(chain) : undefined}
                    notify={notify}
                    coverGeneration={coverGeneration}
                    coverBusy={coverBusy}
                    coverDisabled={!promptLibraryCoverContent(chain)}
                    onGenerateCover={() => coverActions.requestCover(chain)}
                    onManageCoverGeneration={coverActions.manageGeneration}
                  />
                );
              }}
            />
          ) : countsPending ? (
            <PromptLibraryReadStatus chainsLoading={chainsLoading} chainsError={chainsError} onRetryChains={onRetryChains} />
          ) : favoritesSelected && favorites.status !== 'ready' ? (
            favorites.status === 'error' ? <EmptyState title={t('收藏库加载失败，请稍后重试')} /> : <PageSpinner />
          ) : (
            <EmptyState
              title={t(entries.length ? '没有匹配的提示词' : '提示词库还是空的')}
              hint={t(entries.length ? '换个关键词，或清除筛选。' : '粘贴收录提示词。')}
              action={emptyFiltersActive ? <ToolbarButton onClick={resetAllFilters}>{t('清除筛选')}</ToolbarButton> : undefined}
            />
          )}
        </div>
        {coverActions.settingsDialog}
        {selected && (selected.section === 'items' && renderEntryEditor ? (
          renderEntryEditor(selected.chain, { onClose: finishClose, actionsRef: editorActions })
        ) : (
          <DetailSidePanel
            open
            title={selected.chain.name || selected.summary.slice(0, 48) || t('未命名')}
            sensitiveTitle
            subInfo={promptLibraryEntryLabel(selected.chain, directories)}
            onClose={closeDetail}
            onBack={closeDetail}
            headerActions={
              <>
                <ToolbarButton onClick={() => void copyDetailText(selected.chain)} aria-label={t('复制提示词')} title={t('复制提示词')}>
                  {copiedDetail ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  <span className="hidden sm:inline">{t('复制')}</span>
                </ToolbarButton>
                <ToolbarButton onClick={() => onOpen(selected.chain)}>{t('编辑')}</ToolbarButton>
                {isPromptLibraryCharacterProjection(selected.chain) && (
                  <ToolbarButton onClick={() => (onSaveAs || onOpen)(selected.chain)}>{t('另存为新组合')}</ToolbarButton>
                )}
                {selected.section !== 'items' && (
                  <ToolbarButton tone="primary" onClick={() => onUse(selected.chain)}>{t('送到实验室')}</ToolbarButton>
                )}
              </>
            }
          >
            {selected.chain.previewImage ? (
              <div className="space-y-2">
                <DetailImageStage pressResetKey={selected.chain.id}>
                  <ViewableImage
                    src={selected.chain.previewImage}
                    alt={selected.chain.name}
                    notify={notify}
                    favorite={{ imageUrl: selected.chain.previewImage, title: selected.chain.name, sourceType: 'other', sourceId: selected.chain.id }}
                    className="block h-auto max-h-[40vh] w-full object-contain"
                  />
                  <ImageShareOverlay
                    imageUrl={selected.chain.previewImage}
                    filename={selected.chain.name + '.png'}
                    notify={notify}
                    favorite={{ imageUrl: selected.chain.previewImage, title: selected.chain.name, sourceType: 'other', sourceId: selected.chain.id }}
                  />
                </DetailImageStage>
                <div className="flex justify-end">
                  <ToolbarButton disabled={coverActions.isBusy(selected.chain.id) || !promptLibraryCoverContent(selected.chain)} onClick={() => coverActions.requestCover(selected.chain, true)}>
                    <RefreshCw className="h-3.5 w-3.5" /><span>{t('重新生成封面')}</span>
                  </ToolbarButton>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200/80 bg-gray-50/70 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/60">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('暂无封面')}</span>
                <ToolbarButton disabled={coverActions.isBusy(selected.chain.id) || !promptLibraryCoverContent(selected.chain)} onClick={() => coverActions.requestCover(selected.chain)}>
                  <ImagePlus className="h-3.5 w-3.5" /><span>{t('生成封面')}</span>
                </ToolbarButton>
              </div>
            )}
            {selected.section === 'saved' && onUpdateTags && !isPromptLibraryCharacterProjection(selected.chain) ? (
              <PromptLibraryTagEditor
                key={selected.chain.id}
                tags={getCustomChainTags(selected.chain.tags)}
                suggestions={combinationTags}
                suggestionLabel={categoryLabel}
                onSave={nextTags => onUpdateTags(selected.chain, nextTags)}
              />
            ) : (
              <div className="mt-3 flex flex-wrap gap-1">
                {(isPromptLibraryCharacterProjection(selected.chain)
                  ? getCustomChainTags(selected.chain.tags)
                  : getEntryPurposes(selected.chain, directories).map(id => t(promptPurposeLabel(id)))
                ).map(tag => (
                  <span key={tag} className="appearance-group rounded px-2 py-1 text-xs">{tag}</span>
                ))}
              </div>
            )}
            {selectedRead?.ok ? (
              <div className="mt-4 space-y-2.5">
                {selectedRead.items.map(item => (
                  <section key={item.itemId || `${item.scope}:${item.unitId}:${item.directoryPath.join('/')}`} className="appearance-group rounded-xl border border-gray-200/80 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {item.directoryPath.join(' / ') || item.directoryName || t(FRAGMENT_LABELS[item.unitId as PromptFragmentKind] || item.unitId)}
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm">{item.text}</p>
                    {item.negative && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-amber-700 dark:text-amber-300">{t('负面提示词')}：{item.negative}</p>}
                    {item.constraintNotes && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500">{item.constraintNotes}</p>}
                  </section>
                ))}
                {selectedRead.roles.map(role => (
                  <section key={role.key} className="appearance-group rounded-xl border border-gray-200/80 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <h3 className="text-sm font-semibold">{role.name}</h3>
                    {Object.entries(role.sections).map(([kind, text]) => (
                      <div key={kind} className="mt-2.5">
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h4>
                        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm">{text}</p>
                        {role.negatives[kind]?.text && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-700 dark:text-amber-300">{t('负面提示词')}：{role.negatives[kind].text}</p>}
                        {role.negatives[kind]?.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500">{role.negatives[kind].note}</p>}
                      </div>
                    ))}
                  </section>
                ))}
                {Object.entries(selectedRead.global).filter(([, field]) => field.provided).map(([kind, field]) => (
                  <section key={kind} className="appearance-group rounded-xl border border-gray-200/80 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-900/60">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t(FRAGMENT_LABELS[kind as PromptFragmentKind] || kind)}</h3>
                    <p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm">{field.text}</p>
                    {field.negative?.text && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-amber-700 dark:text-amber-300">{t('负面提示词')}：{field.negative.text}</p>}
                    {field.negative?.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500">{field.negative.note}</p>}
                  </section>
                ))}
              </div>
            ) : (
              <>
                <h3 className="mt-4 text-xs text-gray-500">{t('提示词原文')}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm">{selected.chain.basePrompt || t('还没有提示词')}</p>
                {bilingualOf(selected.chain) && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-500">{bilingualOf(selected.chain)}</p>}
                {selected.chain.negativePrompt && (
                  <>
                    <h3 className="mt-4 text-xs text-gray-500">{t('负面提示词')}</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm">{selected.chain.negativePrompt}</p>
                  </>
                )}
              </>
            )}
            {selected.chain.description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-gray-500">{selected.chain.description}</p>}
          </DetailSidePanel>
        ))}
      </div>
    </div>
    {batchDirOpen && (
      <LibraryDialog title="设置文件夹" busy={bulkBusy} onClose={() => { if (!bulkBusy) setBatchDirOpen(false); }}>
        <p className="text-sm text-gray-500">{t('已选 {0} 条', [selectedEntries.length])}</p>
        <div className="max-h-72 overflow-y-auto">
          <DirectoryTreeChecklist
            collapsible
            nodes={directories.nodes}
            selectedIds={batchSelectedDirIds}
            mixedIds={batchMixedDirIds}
            disabled={bulkBusy}
            onToggle={(id, nextChecked) => setBatchDirChanges(previous => ({ ...previous, [id]: nextChecked }))}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <ToolbarButton disabled={bulkBusy} onClick={() => setBatchDirOpen(false)}>{t('取消')}</ToolbarButton>
          <ToolbarButton tone="primary" disabled={bulkBusy || !Object.keys(batchDirChanges).length} onClick={() => void saveBatchDirectories()}>
            <FolderInput className="h-4 w-4" />{t('保存')}
          </ToolbarButton>
        </div>
      </LibraryDialog>
    )}
    {batchTagOpen && (
      <LibraryDialog title="编辑标签" busy={bulkBusy} onClose={() => { if (!bulkBusy) setBatchTagOpen(false); }}>
        <p className="text-sm text-gray-500">{t('已选 {0} 条', [selectedCombinationEntries.length])}</p>
        <CollectionTagInput
          aria-label={t('编辑自定义标签')}
          value={batchTagDraft}
          disabled={bulkBusy}
          className={TOOLBAR_FIELD_CLASS}
          suggestions={combinationTags}
          suggestionLabel={categoryLabel}
          inlineSuggestions
          onChange={event => setBatchTagDraft(event.target.value)}
          onPick={setBatchTagDraft}
        />
        <div className="flex justify-end gap-2 pt-2">
          <ToolbarButton disabled={bulkBusy} onClick={() => setBatchTagOpen(false)}>{t('取消')}</ToolbarButton>
          <ToolbarButton tone="save" disabled={bulkBusy} onClick={() => void saveBatchTags()}>
            {t(bulkBusy ? '保存中…' : '保存标签')}
          </ToolbarButton>
        </div>
      </LibraryDialog>
    )}
  </>;
};
