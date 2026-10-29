import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { collectionSnapshot, ensureCollection, readLegacyFavoriteIds, subscribeCollection } from '../services/collectionFavorites';
import { t, useLanguage, getLanguage } from '../services/i18n';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PromptChain, ChainType } from '../types';
import { MobileBottomSheet, MobileIconButton } from './MobileUI';
import { SmartImage } from './SmartImage';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import { ImageCardActions } from './ImageCardActions';
import type { ChainSimilaritySession } from './chain/ChainSimilarityDialog';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { Check, EyeOff, FileOutput, Filter, FlaskConical, FolderUp, Heart, Image, Link2, ListChecks, Package, Pencil, Plus, ScanSearch, Tags, Trash2, User, X } from 'lucide-react';
import { ToolbarButton, ToolbarSearch, WorkspacePageState, WorkspaceChrome, WorkspaceToolbar, isUntestedChain } from './DesignSystem';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { DEFAULT_NAI_MODEL, getNaiModelDisplayLabel, getSelectableNaiModels } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useRestoreListAnchor } from './useRestoreListAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGalleryLoadMore } from './useGalleryLoadMore';
import { FolderBatchImportModal } from './chain/FolderBatchImportModal';
import { StyleCollectorControl } from './StyleCollectorControl';
import { useStChatu8Selection, wisdomEntryLabel } from '../services/stChatu8Sync';
import { useStChatu8Preferences } from '../services/stChatu8Preferences';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';
import { WisdomSyncToolbar } from './WisdomSyncToolbar';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PressRevealSurface } from './PressRevealSurface';
import { ChainInfoModal, UpdateChainInfo } from './chain/ChainInfoModal';
import { ChainTagManager } from './chain/ChainTagManager';
import { getCustomChainTags } from '../services/chainTags';
import { useConfirmDialog } from './ConfirmDialog';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { useChainFolders } from '../services/useChainFolders';
import { folderContains, getChainFolderIds, updateChainFolderMemberships } from '../services/chainFolders';
import { CHAIN_FOLDER_DRAG_TYPE, ChainFolderMembershipDialog, ChainFolderNavigation } from './chain/ChainFolders';
import { Folder, FolderInput } from 'lucide-react';
import { DIRECTORY_FAVORITES_ID } from './DirectoryTreeNavigation';

const ChainSimilarityDialog = React.lazy(() => import('./chain/ChainSimilarityDialog').then(module => ({ default: module.ChainSimilarityDialog })));
const StyleBundleDialog = React.lazy(() => import('./chain/StyleBundleDialog').then(module => ({ default: module.StyleBundleDialog })));

interface ChainListProps {
  chains: PromptChain[];
  type: ChainType; // New Prop to filter view
  onCreate: (name: string, desc: string, type: ChainType, folderId?: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void> | void;
  onBulkDelete?: (ids: string[], onProgress: (completed: number) => void) => Promise<{ remainingIds: string[]; errorCount: number }>;
  onRefresh: () => void;
  onBundleImported?: () => Promise<void>;
  onReloadTags?: () => Promise<void>;
  onUpdateChain: UpdateChainInfo;
  /** 整串送入实验室：复用历史／灵感页的 sessionStorage 导入通道后跳转。 */
  onNavigateToPlayground?: () => void;
  isLoading: boolean;
  loadError?: string;
  notify: (msg: string, type?: 'success' | 'error') => void;
  isGuest?: boolean;
  returnTargetId?: string;
}

const chainPreviewRatio = (chain: PromptChain, measured?: number) => {
  if (!chain.previewImage) return 4 / 3;
  if (measured) return measured;
  // 封面尚未加载时用生成尺寸预留，真实封面比例返回后优先替换；无封面仍用横向占位。
  const { width, height } = chain.params || {};
  return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 4 / 3;
};

export const ChainList: React.FC<ChainListProps> = ({ chains, type, onCreate, onSelect, onDelete, onBulkDelete, onRefresh, onBundleImported, onReloadTags, onUpdateChain, onNavigateToPlayground, notify, isLoading, loadError, isGuest = false, returnTargetId }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const RENDER_BATCH_SIZE = 60;
  const imageDisplay = useMobileImageDisplayPreferences('chains');
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [infoChain, setInfoChain] = useState<PromptChain | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [similarityOpen, setSimilarityOpen] = useState(false);
  const [bundleScope, setBundleScope] = useState<'all' | 'filtered' | 'selected' | null>(null);
  const similaritySession = useRef<ChainSimilaritySession | null>(null);
  const folderStore = useChainFolders(type === 'style' && !isGuest);
  const [selectedFolder, setSelectedFolder] = useState(() => { try { return localStorage.getItem('nai-style-folder-selection') ?? '*'; } catch { return '*'; } });
  const [foldersExpanded, setFoldersExpanded] = useState(() => { try { return localStorage.getItem('nai-style-folders-expanded') === 'true'; } catch { return false; } });
  const toggleFolders = () => setFoldersExpanded(previous => { const next = !previous; try { localStorage.setItem('nai-style-folders-expanded', String(next)); } catch { /* 本端存储不可用时仍可展开。 */ } return next; });
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const activeFolder = type === 'style' && !isGuest && (selectedFolder === DIRECTORY_FAVORITES_ID || folderStore.ready && !folderStore.error) ? selectedFolder : '*';
  const matchingFolderIds = useMemo(() => new Set(folderStore.state.folders.filter(folder => folderContains(folderStore.state.folders, activeFolder, folder.id)).map(folder => folder.id)), [folderStore.state.folders, activeFolder]);
  const selectFolder = (id: string) => { setSelectedFolder(id); try { localStorage.setItem('nai-style-folder-selection', id); } catch { /* 浏览仍可继续。 */ } };
  useEffect(() => {
    if (folderStore.ready && selectedFolder && selectedFolder !== '*' && selectedFolder !== DIRECTORY_FAVORITES_ID && !folderStore.state.folders.some(folder => folder.id === selectedFolder)) selectFolder('*');
  }, [folderStore.ready, folderStore.state.folders, selectedFolder]);
  const setFolderMemberships = async (ids: string[], changes: Record<string, boolean>) => {
    if (!ids.length) return;
    try {
      await folderStore.save(updateChainFolderMemberships(folderStore.state, ids, changes)); setMoveIds(null);
      notify(t('已更新 {0} 条风格串的文件夹', [ids.length]), 'success');
    } catch (cause) { notify(cause instanceof Error ? cause.message : '设置文件夹失败，请重试', 'error'); }
  };
  const [sortOption, setSortOption] = useState<'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc'>('updated_desc');
  const [favOnly, setFavOnly] = useState(false);
  const favoritesOnly = type === 'style' && !isGuest ? activeFolder === DIRECTORY_FAVORITES_ID : favOnly;
  const [untestedOnly, setUntestedOnly] = useState(false);
  const [isFolderImportOpen, setIsFolderImportOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesError, setFavoritesError] = useState('');
  const [favoritesRetry, setFavoritesRetry] = useState(0);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH_SIZE);
  const syncPreferences = useStChatu8Preferences(!isGuest && type === 'style');
  const canSync = !isGuest && type === 'style' && syncPreferences.enabled;
  const syncSelection = useStChatu8Selection(canSync, chains, notify);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ completed: number; total: number } | null>(null);
  const bulkDeletingRef = useRef(false);
  const bulkOperationRef = useRef(0);
  const selecting = selectionMode && type === 'style' && !isGuest;

  useEffect(() => {
    bulkOperationRef.current++;
    bulkDeletingRef.current = false;
    setSelectionMode(false); setSelectedIds(new Set()); setBulkDeleteBusy(false); setDeleteProgress(null);
    setTagManagerOpen(false);
    setSimilarityOpen(false);
    setBundleScope(null);
    similaritySession.current = null;
  }, [type, isGuest]);

  const legacyFavorites = useRef(new Set<string>());
  // 无封面旧标记继续可筛选；共用收藏按对象身份保留已换封面的条目。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      legacyFavorites.current = readLegacyFavoriteIds('nai_chain_favs');
      setFavorites(new Set(legacyFavorites.current));
    } catch (e) {
      console.error('Failed to load chain favorites', e);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = new Set(legacyFavorites.current);
      const saved = collectionSnapshot().filter(item => !item.archived);
      for (const chain of chains) {
        if (saved.some(item => (item.sourceType === (chain.type === 'character' ? 'character' : 'chain') && item.sourceId === chain.id) || (!item.sourceId && chain.previewImage && (item.imageUrl === chain.previewImage || item.analysis?.collectionOriginalUrl === chain.previewImage)))) next.add(chain.id);
        else if (chain.previewImage) next.delete(chain.id);
      }
      setFavorites(next);
    };
    let cancelled = false;
    const unsubscribe = subscribeCollection(() => { sync(); setFavoritesReady(true); setFavoritesError(''); });
    sync();
    setFavoritesError('');
    void ensureCollection().then(() => { if (!cancelled) { sync(); setFavoritesReady(true); } }).catch(() => { if (!cancelled) { setFavoritesReady(false); setFavoritesError(t('收藏库加载失败，请稍后重试')); } });
    return () => { cancelled = true; unsubscribe(); };
  }, [chains, favoritesRetry]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    if (type === 'style' && folderStore.state.folders.some(folder => folder.id === activeFolder)) onCreate(newName, newDesc, type, activeFolder);
    else onCreate(newName, newDesc, type);
    setIsModalOpen(false);
    setNewName('');
    setNewDesc('');
  };

  /**
   * 风格串 → 实验室：整串的基础提示词、主体正文、风格模块、角色槽位与生成参数一并投递。
   * 实验室按临时伪链处理，不改动原串；sessionStorage 通道与历史／灵感页导入一致，
   * 即使实验室已常驻（keep-alive），externalImportToken 也会触发它重新消费。
   */
  const sendToPlayground = (chain: PromptChain) => {
    try {
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
        targetMode: 'text-to-image',
        basePrompt: chain.basePrompt || '',
        subjectPrompt: chain.variableValues?.subject || '',
        modules: chain.modules || [],
        negativePrompt: chain.negativePrompt || '',
        params: chain.params,
      }));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('发送到实验室失败，请重试'), 'error');
      return;
    }
    notify(t('已把「{0}」发送到实验室', [chain.name]));
    onNavigateToPlayground?.();
  };

  const handleDelete = async (chain: PromptChain) => {
    if (!await confirmAction({
      rememberKey: type === 'character' ? 'character.delete' : 'chain.delete',
      title: t('删除“{0}”？', [chain.name]),
      message: type === 'character' ? t('该自定义角色将被永久删除，此操作无法撤销。') : t('该风格串将被永久删除，此操作无法撤销。'),
      confirmLabel: t('确认删除'),
      tone: 'danger',
    })) return false;
    try {
      await onDelete(chain.id);
      return true;
    } catch {
      notify('删除失败，请稍后重试', 'error');
      return false;
    }
  };

  // 模型筛选：选项固定为可选模型清单（注册表 + 网关同步的新模型），与链表内容无关。
  const runtime = useNaiRuntime();
  const modelFilterOptions = useMemo(() => getSelectableNaiModels(runtime), [runtime]);

  // 从当前资料类型的完整列表生成选项，编辑／导入后即时更新，不被其他筛选缩掉。
  const typeChains = useMemo(() => chains.filter(chain => chain.type === type || (!chain.type && type === 'style')), [chains, type]);
  const customTagOptions = useMemo(() => [...new Set(typeChains
    .flatMap(chain => getCustomChainTags(chain.tags)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [typeChains]);
  useEffect(() => {
    // 管理回读后先映射已选标签，避免重命名期间被旧的筛选清理逻辑摘除。
    if (tagManagerOpen) return;
    setSelectedTags(current => {
      const next = new Set([...current].filter(tag => customTagOptions.includes(tag)));
      return next.size === current.size ? current : next;
    });
  }, [customTagOptions, tagManagerOpen]);
  const visibleTagOptions = customTagOptions.filter(tag => customTagOptions.length <= 12 || tag.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const toggleTag = (tag: string) => setSelectedTags(current => {
    const next = new Set(current);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    return next;
  });
  const openTagManager = async () => {
    const mobile = showMobileFilters;
    // 手机筛选关闭会异步返回上一层，先等返回完成再登记管理层。
    const returned = mobile && window.history.state?.__naiMobileLayer?.startsWith('sheet-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    flushSync(() => { setShowDesktopFilters(false); setShowMobileFilters(false); });
    if (returned) await returned;
    (mobile ? mobileFilterTriggerRef.current : filterAnchorRef.current?.querySelector('button'))?.focus({ preventScroll: true });
    setTagManagerOpen(true);
  };

  // 自定义标签可组合筛选；待实测独立于用户分类。
  const filteredChains = useMemo(() => {
    return chains
      .filter(c =>
        (c.type === type || (!c.type && type === 'style')) && // Backward compat: default to style if no type
        (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         c.description.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      .filter(c => !favoritesOnly || favorites.has(c.id))
      .filter(c => !untestedOnly || isUntestedChain(c))
      .filter(c => !selectedModel || (c.params?.model?.trim() || DEFAULT_NAI_MODEL) === selectedModel)
      .filter(c => type !== 'style' || isGuest || activeFolder === '*' || activeFolder === DIRECTORY_FAVORITES_ID || (activeFolder === '' ? !getChainFolderIds(folderStore.state, c.id).length : getChainFolderIds(folderStore.state, c.id).some(folder => matchingFolderIds.has(folder))))
      .filter(c => {
        if (selectedTags.size === 0) return true;
        const tags = new Set(getCustomChainTags(c.tags));
        return [...selectedTags].every(tag => tags.has(tag));
      })
      .filter(c => selecting || syncSelection.accepts(c.id))
      .slice()
      .sort((a, b) => {
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        const ua = a.updatedAt || ca;
        const ub = b.updatedAt || cb;
        switch (sortOption) {
          case 'created_asc':
            return ca - cb;
          case 'created_desc':
            return cb - ca;
          case 'updated_asc':
            return ua - ub;
          case 'updated_desc':
          default:
            return ub - ua;
        }
      });
  }, [chains, type, searchTerm, favoritesOnly, untestedOnly, favorites, selectedModel, selectedTags, sortOption, selecting, syncSelection.open, syncSelection.view, syncSelection.recordFilter, syncSelection.entries, activeFolder, matchingFolderIds, folderStore.state, isGuest]);

  // 批量删除只针对当前筛选；隐藏项与已消失项不保留选择。
  const selectedChains = filteredChains.filter(chain => selectedIds.has(chain.id));
  useEffect(() => {
    if (!selecting || bulkDeleteBusy) return;
    const visibleIds = new Set(filteredChains.map(chain => chain.id));
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => visibleIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [filteredChains, selecting, bulkDeleteBusy]);
  const toggleSelected = (id: string) => {
    if (bulkDeletingRef.current || folderStore.busy) return;
    setSelectedIds(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const beginSelection = () => {
    if (isGuest || type !== 'style' || syncSelection.busy || !onBulkDelete) return;
    syncSelection.cancel(); setShowDesktopFilters(false); setShowMobileFilters(false); setInfoChain(null);
    setSelectedIds(new Set()); setSelectionMode(true);
  };
  const deleteSelected = async () => {
    if (!onBulkDelete || bulkDeletingRef.current || folderStore.busy || !selectedChains.length) return;
    const ids = selectedChains.map(chain => chain.id);
    const operation = ++bulkOperationRef.current;
    bulkDeletingRef.current = true; setBulkDeleteBusy(true);
    try {
      if (!await confirmAction({ rememberKey: 'chain.delete-batch', title: t('删除 {0} 条风格串？', [ids.length]), message: t('所选风格串将被永久删除，此操作无法撤销。'), confirmLabel: t('确认删除'), tone: 'danger' })
        || operation !== bulkOperationRef.current) return;
      setDeleteProgress({ completed: 0, total: ids.length });
      const result = await onBulkDelete(ids, completed => {
        if (operation === bulkOperationRef.current) setDeleteProgress({ completed, total: ids.length });
      });
      if (operation !== bulkOperationRef.current) return;
      setSelectedIds(new Set(result.remainingIds));
      const deleted = ids.length - result.remainingIds.length;
      notify(result.remainingIds.length ? t('已删除 {0} 条，{1} 条未删除', [deleted, result.remainingIds.length])
        : result.errorCount ? t('已删除 {0} 条，{1} 项请求返回异常，请检查结果', [deleted, result.errorCount])
          : t('已删除 {0} 条风格串', [deleted]), result.remainingIds.length || result.errorCount ? 'error' : 'success');
    } catch (error) {
      if (operation === bulkOperationRef.current) notify(error instanceof Error ? error.message : t('批量删除失败，请稍后重试'), 'error');
    } finally {
      if (operation === bulkOperationRef.current) { bulkDeletingRef.current = false; setBulkDeleteBusy(false); setDeleteProgress(null); }
    }
  };

  const resultKey = JSON.stringify([type, searchTerm, favOnly, untestedOnly, selectedModel, [...selectedTags].sort(), sortOption, syncSelection.view, syncSelection.recordFilter, syncSelection.open, type === 'style' ? activeFolder : '*']);
  useEffect(() => setVisibleCount(RENDER_BATCH_SIZE), [resultKey]);
  const expandedReturnTarget = useRef<string | undefined>(undefined);
  const returnResultKey = useRef(resultKey);
  useEffect(() => {
    if (returnResultKey.current !== resultKey) {
      returnResultKey.current = resultKey;
      expandedReturnTarget.current = returnTargetId;
      return;
    }
    if (!returnTargetId) { expandedReturnTarget.current = undefined; return; }
    if (expandedReturnTarget.current === returnTargetId) return;
    const targetIndex = filteredChains.findIndex(chain => chain.id === returnTargetId);
    if (targetIndex >= 0) {
      expandedReturnTarget.current = returnTargetId;
      setVisibleCount(count => Math.max(count, targetIndex + 1));
    }
  }, [filteredChains, returnTargetId, resultKey]);
  const visibleChains = filteredChains.slice(0, visibleCount);

  // 滚动接近列表底部自动追加一批；按钮保留作兜底。
  const chainScrollRef = useRef<HTMLDivElement>(null);
  const masonryColumns = useMasonryColumnCount(imageDisplay, undefined, chainScrollRef);
  const chainLoadSentinelRef = useRef<HTMLDivElement>(null);
  useRestoreListAnchor(chainScrollRef, returnTargetId, `${visibleCount}:${filteredChains.length}`, resultKey);
  const onScrollRestore = useKeepAliveScrollRestore(chainScrollRef, 'list', { resetKey: resultKey });
  useGalleryLoadMore(chainScrollRef, chainLoadSentinelRef, visibleCount < filteredChains.length, () => setVisibleCount(count => count + RENDER_BATCH_SIZE), '600px 0px', visibleCount);

  // 卡片预计高度用于新卡分列；尺寸返回只修正高度，旧卡保留原列。
  const frostedCaption = useGalleryFrostedCaption();
  const estimateChainCardHeight = useCallback(
    (chain: PromptChain, columnWidth: number) => {
      const ratio = chainPreviewRatio(chain, previewRatios[chain.id]);
      return Math.max(1, columnWidth) / Math.max(0.1, ratio) + (frostedCaption ? 2 : 50) + (syncSelection.open && syncSelection.entries.has(chain.id) ? 78 : 0);
    },
    [previewRatios, syncSelection.open, syncSelection.entries, frostedCaption],
  );

  const renderChainCard = (chain: PromptChain) => (
    <PressRevealSurface pressDisabled={syncSelection.open || selecting} key={chain.id} data-safe-mode-work="true" data-return-item-id={chain.id}
      role={selecting || syncSelection.selecting ? 'checkbox' : 'button'}
      data-agent-action={selecting || syncSelection.selecting ? 'select' : 'browse'}
      aria-label={selecting ? t('选择风格串：{0}', [chain.name]) : syncSelection.selecting ? t("智慧姬同步：{0}", [chain.name]) : t("打开{0}：{1}", [chain.type === 'character' ? t('自定义角色') : t('风格串'), chain.name])}
      aria-checked={selecting ? selectedIds.has(chain.id) : syncSelection.selecting ? syncSelection.selected.has(chain.id) : undefined}
      aria-disabled={selecting ? bulkDeleteBusy : syncSelection.selecting ? syncSelection.busy || !syncSelection.available.has(chain.id) : undefined}
      tabIndex={0}
      draggable={type === 'style' && !isGuest && !syncSelection.open && folderStore.ready && !folderStore.busy && !bulkDeleteBusy}
      onDragStart={event => { event.dataTransfer.setData(CHAIN_FOLDER_DRAG_TYPE, JSON.stringify(selecting && selectedIds.has(chain.id) ? selectedChains.map(item => item.id) : [chain.id])); event.dataTransfer.effectAllowed = 'link'; }}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (selecting) toggleSelected(chain.id); else if (syncSelection.selecting) syncSelection.toggle(chain.id); else onSelect(chain.id); } }}
      onClick={() => selecting ? toggleSelected(chain.id) : syncSelection.selecting ? syncSelection.toggle(chain.id) : onSelect(chain.id)}
      className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group bg-white dark:bg-gray-850 border border-gray-200 dark:border-gray-800/80 hover:border-indigo-500 dark:hover:border-indigo-500/50 rounded-xl overflow-hidden transition-[border-color,box-shadow,transform] duration-200 hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selecting && selectedIds.has(chain.id) || syncSelection.selecting && syncSelection.selected.has(chain.id) ? '!border-indigo-500 ring-2 ring-indigo-500/20' : ''} ${syncSelection.selecting && !isStChatu8ExportableChain(chain) ? '!cursor-default opacity-60' : ''}`}>
      {syncSelection.selecting && syncSelection.available.has(chain.id) && <span aria-hidden="true" className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg border shadow-sm ${syncSelection.selected.has(chain.id) ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-400 bg-white/90 text-transparent dark:border-gray-500 dark:bg-gray-900/90'}`}><Check className="h-4 w-4" /></span>}
      {syncSelection.selecting && !isStChatu8ExportableChain(chain) && <span className="absolute right-2 top-2 z-10 rounded-lg bg-white/90 px-2 py-1 text-xs text-gray-500 shadow-sm dark:bg-gray-900/90 dark:text-gray-400">{t("仅 V4.5 / V5")}</span>}

      {/* Preview Image */}
      <div
          className="appearance-media mobile-gallery-frame md:aspect-square bg-gray-200 dark:bg-gray-900 relative border-b border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
          style={{ '--mobile-image-ratio': String(chainPreviewRatio(chain, previewRatios[chain.id])) } as React.CSSProperties}
      >
          {selecting && <span aria-hidden="true" className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur ${selectedIds.has(chain.id) ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`}><Check className="h-4 w-4" /></span>}
          {!selecting && !syncSelection.open && !isGuest && <div data-card-action="true" data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20">
            <button type="button" onClick={event => { event.stopPropagation(); void handleDelete(chain); }} className="mobile-size-locked flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8" aria-label={t('删除：{0}', [chain.name])} title={t('删除')}><Trash2 className="h-4 w-4" /></button>
          </div>}
          {/* 图片取用与编辑共同换列；无封面时仍保留编辑。 */}
          {!selecting && !syncSelection.open && (chain.previewImage || !isGuest) && <ImageCardActions>
            {chain.previewImage && <ImageShareActions variant="card" className="flex-col" imageUrl={getMobileOriginalUrl(chain.previewImage)} filename={`${chain.name || 'cover'}.png`} notify={notify} favorite={{ imageUrl: chain.previewImage, title: chain.name, sourceType: chain.type === 'character' ? 'character' : 'chain', sourceId: chain.id, prompt: chain.basePrompt, negativePrompt: chain.negativePrompt, params: chain.params }} />}
            {!isGuest && type === 'style' && <button type="button" onClick={event => { event.stopPropagation(); sendToPlayground(chain); }} className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition`} title={t("发送到实验室")} aria-label={t("发送到实验室：{0}", [chain.name])}><FlaskConical className="h-4 w-4" /></button>}
            {!isGuest && <button type="button" onClick={event => { event.stopPropagation(); setInfoChain(chain); }} className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition`} title={t("编辑信息")} aria-label={t("编辑{0}信息：{1}", [chain.type === 'character' ? t('自定义角色') : t('风格串'), chain.name])}><Pencil className="h-4 w-4" /></button>}
          </ImageCardActions>}
          {chain.previewImage ? (
              <div className="w-full h-full relative group/img">
                  <SmartImage
                      src={chain.previewImage}
                      alt={chain.name}
                      className="w-full h-full object-contain"
                      onLoad={event => {
                        const image = event.currentTarget;
                        const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
                        if (Number.isFinite(ratio) && ratio > 0 && previewRatios[chain.id] !== ratio) setPreviewRatios(previous => ({ ...previous, [chain.id]: ratio }));
                      }}
                  />
              </div>
          ) : (
              <div className="text-gray-400 dark:text-gray-700">
                   {type === 'character' ? (
                      <User className="h-12 w-12" strokeWidth={1.5} />
                   ) : (
                      <Image className="h-12 w-12" strokeWidth={1.5} />
                   )}
              </div>
          )}
      </div>

      <div className="gallery-card-caption flex h-12 flex-col justify-center px-3">
        {/* 待实测状态贴着作品名放在标题栏内，不再压在封面底部。 */}
        {isUntestedChain(chain) && (
          <div
            className="gallery-chain-status mb-0.5 flex w-fit max-w-full items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px text-micro font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
            title={t("待实测：在此风格串生成后自动去除")}
          >
            <EyeOff aria-hidden="true" className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
            <span>{t("待实测")}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <h3 data-safe-mode-title="true" className="w-full truncate pr-1 text-sm font-bold text-gray-900 dark:text-gray-100 md:pr-2" title={chain.name}>{chain.name}</h3>
          <span className="gallery-card-badge ml-1 flex-shrink-0 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-micro font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300" title={t("生成模型")}>{getNaiModelDisplayLabel(chain.params?.model)}</span>
        </div>
      </div>
      {syncSelection.open && syncSelection.entries.has(chain.id) && <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs font-medium ${syncSelection.entries.get(chain.id)?.status === 'synced' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>{wisdomEntryLabel(syncSelection.entries.get(chain.id)!)}</span>
          {syncSelection.view !== 'pick' && <div className="flex flex-none gap-2">
            {syncSelection.entries.get(chain.id)?.status === 'pending' ? <>
              {syncSelection.entries.get(chain.id)?.error && isStChatu8ExportableChain(chain) && <button type="button" disabled={syncSelection.busy} onClick={() => void syncSelection.actOnEntries('requeue', [chain.id])} className="min-h-8 text-xs text-indigo-600 disabled:opacity-40 dark:text-indigo-300" aria-label={t("重试：{0}", [chain.name])}>{t("重试")}</button>}
              <button type="button" disabled={syncSelection.busy} onClick={() => void syncSelection.actOnEntries('remove', [chain.id])} className="min-h-8 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 dark:text-gray-400 dark:hover:text-white" aria-label={t("移出待同步：{0}", [chain.name])}>{t("移出")}</button>
            </> : <button type="button" disabled={syncSelection.busy || !isStChatu8ExportableChain(chain)} onClick={() => void syncSelection.actOnEntries('requeue', [chain.id])} className="min-h-8 text-xs text-indigo-600 disabled:opacity-40 dark:text-indigo-300" aria-label={t("重新加入待同步：{0}", [chain.name])}>{t("重新加入")}</button>}
          </div>}
        </div>
        {syncSelection.entries.get(chain.id)?.error && <p className="truncate text-xs text-red-500" title={t(syncSelection.entries.get(chain.id)?.error)}>{t(syncSelection.entries.get(chain.id)?.error)}</p>}
        {!isStChatu8ExportableChain(chain) && <p className="text-xs text-gray-400">{t("当前模型不可同步")}</p>}
        {syncSelection.view === 'records' && <p className="truncate text-micro text-gray-400">{t("最近核对 {0}", [new Date(syncSelection.entries.get(chain.id)!.lastVerifiedAt).toLocaleString(getLanguage())])}</p>}
      </div>}
    </PressRevealSurface>
  );

  const title = type === 'character' ? t('我的自定义角色') : t('我的风格串');
  const createLabel = type === 'character' ? '新建自定义角色' : '新建风格串';
  const filterCount = Number(Boolean(selectedModel)) + Number((type !== 'style' || isGuest) && favOnly) + Number(untestedOnly) + selectedTags.size;
  const filtersActive = filterCount > 0 || sortOption !== 'updated_desc';
  const countCaptionFiltered = filterCount > 0 || !!searchTerm || syncSelection.open && syncSelection.view !== 'pick';
  const countCaptionTotal = syncSelection.open && syncSelection.view !== 'pick'
    ? typeChains.filter(chain => syncSelection.accepts(chain.id)).length
    : typeChains.length;
  const resetFilters = () => {
    setSelectedModel(''); setFavOnly(false); setUntestedOnly(false); setSortOption('updated_desc'); setSelectedTags(new Set()); setTagSearch('');
  };
  // 桌面弹层与手机抽屉共享筛选内容，切换视图也保持同一份筛选状态。
  const filterContent = <div className="space-y-4">
    <div className="flex items-center justify-between"><span className="text-xs text-gray-500 dark:text-gray-400">{filterCount > 0 ? t("{0} 项筛选已启用", [filterCount]) : t("全部资料")}</span>{filtersActive && <button type="button" onClick={resetFilters} className="mobile-touch px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{t("重置筛选")}</button>}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("排序")}<select aria-label={t("排序")} value={sortOption} onChange={event => setSortOption(event.target.value as typeof sortOption)} className="mobile-touch mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800"><option value="updated_desc">{t("最近更新")}</option><option value="updated_asc">{t("最早更新")}</option><option value="created_desc">{t("最近创建")}</option><option value="created_asc">{t("最早创建")}</option></select></label>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("模型")}<select aria-label={t("模型筛选")} value={selectedModel} onChange={event => setSelectedModel(event.target.value)} className="mobile-touch mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800"><option value="">{t("全部模型")}</option>{modelFilterOptions.map(model => <option key={model.id} value={model.id}>{t(model.label)}</option>)}</select></label>
    </div>
    <div className={`grid gap-2 ${type === 'style' && !isGuest ? 'grid-cols-1' : 'grid-cols-2'}`}>
      <button type="button" aria-pressed={untestedOnly} onClick={() => setUntestedOnly(value => !value)} className={`mobile-touch flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${untestedOnly ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'appearance-group bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><EyeOff className="h-4 w-4" />{t("只看待实测")}</button>
      {(type !== 'style' || isGuest) && <button type="button" aria-pressed={favOnly} onClick={() => setFavOnly(value => !value)} className={`mobile-touch flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${favOnly ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'appearance-group bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><Heart className={`h-4 w-4 ${favOnly ? 'fill-current' : ''}`} />{t("只看收藏")}</button>}
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("自定义标签")}</span><div className="flex items-center gap-1">{selectedTags.size > 0 && <button type="button" onClick={() => setSelectedTags(new Set())} className="mobile-touch px-2 text-xs text-gray-500 dark:text-gray-400">{t("清除标签筛选")}</button>}{!isGuest && <button type="button" disabled={syncSelection.busy} onClick={() => void openTagManager()} className="mobile-touch inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"><Tags className="h-3.5 w-3.5" />{t('管理标签')}</button>}</div></div>
      {customTagOptions.length > 12 && <input aria-label={t("搜索自定义标签")} placeholder={t("搜索标签")} value={tagSearch} onChange={event => setTagSearch(event.target.value)} className="mobile-touch mb-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />}
      {customTagOptions.length === 0 ? <p className="text-xs text-gray-400">{isLoading ? t('加载中…') : loadError ? t(loadError) : t("暂无自定义标签，可在卡片铅笔中添加")}</p> : <div className="max-h-40 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{visibleTagOptions.map(tag => <button key={tag} type="button" aria-pressed={selectedTags.has(tag)} onClick={() => toggleTag(tag)} className={`mobile-touch max-w-full break-words rounded-full border px-3 py-1.5 text-xs ${selectedTags.has(tag) ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'appearance-group border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{tag}</button>)}</div>{visibleTagOptions.length === 0 && <p className="py-1 text-xs text-gray-400">{t("没有匹配的标签")}</p>}</div>}
      {selectedTags.size > 1 && <p className="mt-2 text-xs text-gray-400">{t("同时包含所选标签")}</p>}
    </div>
  </div>;

  return (
    <div className="workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col">
        <WorkspaceChrome>
<WorkspaceToolbar>
          {selecting ? <>
            <div role="group" aria-label={t('风格串批量操作')} className="flex h-full min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <b aria-live="polite" className="flex-none text-xs font-semibold text-gray-600 dark:text-gray-300">{deleteProgress ? t('正在删除 {0}/{1}', [deleteProgress.completed, deleteProgress.total]) : t('已选 {0} 条', [selectedChains.length])}</b>
              <ToolbarButton disabled={bulkDeleteBusy} onClick={() => setSelectedIds(new Set(filteredChains.map(chain => chain.id)))} className="mobile-touch !px-2.5">{t('全选筛选结果')}</ToolbarButton>
              <ToolbarButton disabled={bulkDeleteBusy} onClick={() => setSelectedIds(previous => new Set(filteredChains.filter(chain => !previous.has(chain.id)).map(chain => chain.id)))} className="mobile-touch !px-2.5">{t('反选筛选结果')}</ToolbarButton>
              <ToolbarButton disabled={bulkDeleteBusy || !selectedChains.length} onClick={() => setSelectedIds(new Set())} className="mobile-touch !px-2.5">{t('清空选择')}</ToolbarButton>
              <ToolbarButton disabled={bulkDeleteBusy || !selectedChains.length} onClick={() => setBundleScope('selected')} className="mobile-touch !px-2.5"><FileOutput /><span>{t('导出已选')}</span></ToolbarButton>
              <ToolbarButton disabled={bulkDeleteBusy || folderStore.busy || !folderStore.ready || Boolean(folderStore.error) || !selectedChains.length} onClick={() => setMoveIds(selectedChains.map(chain => chain.id))} className="mobile-touch !px-2.5"><FolderInput />{t('设置文件夹')}</ToolbarButton>
              <ToolbarButton tone="danger" disabled={bulkDeleteBusy || !selectedChains.length} onClick={() => void deleteSelected()} className="mobile-touch ml-auto !px-2.5"><Trash2 /><span>{t('删除')}</span></ToolbarButton>
            </div>
            <ToolbarButton aria-label={t('退出多选')} title={t('退出多选')} disabled={bulkDeleteBusy} onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }} className="mobile-touch !px-2.5"><X /><span className="hidden sm:inline">{t('退出多选')}</span></ToolbarButton>
          </> : <>
          {!isGuest && type === 'style' && <ToolbarButton data-agent-action="browse" aria-label={t(foldersExpanded ? '收起文件夹' : '展开文件夹')} title={[t(foldersExpanded ? '收起文件夹' : '展开文件夹'), activeFolder === '*' ? t('全部') : activeFolder === '' ? t('未整理') : activeFolder === DIRECTORY_FAVORITES_ID ? t('收藏') : folderStore.state.folders.find(folder => folder.id === activeFolder)?.name || t('全部')].join(' · ')} aria-expanded={foldersExpanded} active={foldersExpanded || activeFolder !== '*'} disabled={folderStore.busy} onClick={toggleFolders}><Folder className="h-4 w-4" /></ToolbarButton>}
          <ToolbarSearch value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder={t("搜索{0}", [title])} containerClassName="min-w-0 flex-1 md:max-w-none!" />
          <div className="hidden flex-none items-center gap-2 md:flex">
            <div ref={filterAnchorRef} className="relative flex-none">
              <ToolbarButton active={filtersActive} onClick={() => setShowDesktopFilters(value => !value)} title={t("筛选与排序")} aria-label={t("筛选{0}", [filterCount > 0 ? ` ${filterCount}` : ''])} aria-expanded={showDesktopFilters} aria-haspopup="dialog"><Filter className="h-4 w-4" /><span className="hidden xl:inline">{t("筛选{0}", [filterCount > 0 ? ` ${filterCount}` : ''])}</span></ToolbarButton>
              {showDesktopFilters && <AnchoredToolbarPopover anchorRef={filterAnchorRef} title={t("筛选与排序")} onClose={() => setShowDesktopFilters(false)}>{filterContent}</AnchoredToolbarPopover>}
            </div>
            {canSync && <div className="border-l border-gray-200 pl-2 dark:border-gray-700"><ToolbarButton onClick={syncSelection.open ? syncSelection.cancel : syncSelection.begin} disabled={syncSelection.busy && !syncSelection.open} title={t("挑选风格串、待同步与同步记录")} aria-label={t("智慧姬同步{0}", [syncSelection.savedCount > 0 ? ` ${syncSelection.savedCount}` : ''])} aria-expanded={syncSelection.open}><Link2 className="h-4 w-4" /><span className="hidden xl:inline">{t("智慧姬同步{0}", [syncSelection.savedCount > 0 ? ` ${syncSelection.savedCount}` : ''])}</span></ToolbarButton></div>}
          </div>
          <div className="flex flex-none gap-1 md:hidden">
              <MobileIconButton label={t("筛选与排序")} onClick={event => { mobileFilterTriggerRef.current = event.currentTarget; setShowMobileFilters(true); }} className={`border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 ${filtersActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-300'}`}><Filter className="h-5 w-5" /></MobileIconButton>
            {canSync && <MobileIconButton label={t("智慧姬同步（待同步 {0}）", [syncSelection.savedCount])} onClick={syncSelection.open ? syncSelection.cancel : syncSelection.begin} disabled={syncSelection.busy && !syncSelection.open} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"><Link2 className="h-5 w-5" /></MobileIconButton>}
          </div>
          {!isGuest && type === 'style' && onBulkDelete && <ToolbarButton aria-label={t('批量选择风格串')} title={t('批量选择风格串')} disabled={syncSelection.busy} onClick={beginSelection}>
            <ListChecks className="h-4 w-4" /><span className="hidden xl:inline">{t('多选')}</span>
          </ToolbarButton>}
          {!isGuest && type === 'style' && <ToolbarButton aria-label={t('查找相似')} title={t('查找相似')} onClick={() => setSimilarityOpen(true)}>
            <ScanSearch className="h-4 w-4" /><span className="hidden xl:inline">{t('查找相似')}</span>
          </ToolbarButton>}
          {!isGuest && <div className="flex flex-none items-center gap-1 border-l border-gray-200 pl-2 dark:border-gray-700 md:gap-2">
            {type === 'style' && <ToolbarButton onClick={() => setBundleScope('all')} title={t('风格串分享包')} aria-label={t('风格串分享包')}><Package className="h-4 w-4" /><span className="hidden xl:inline">{t('分享包')}</span></ToolbarButton>}
            {type === 'style' && <StyleCollectorControl onSaved={onRefresh} notify={notify} />}
            <div className="hidden items-center gap-2 md:flex">
              {type === 'style' && <ToolbarButton onClick={() => setIsFolderImportOpen(true)} title={t("从本地文件夹批量读取 NovelAI 原图为风格串")} aria-label={t("批量导入")}><FolderUp className="h-4 w-4" /><span className="hidden xl:inline">{t("批量导入")}</span></ToolbarButton>}
              <ToolbarButton tone="primary" onClick={() => setIsModalOpen(true)} aria-label={t(createLabel)} title={t(createLabel)}><Plus className="h-4 w-4" /><span className="hidden xl:inline">{t(createLabel)}</span></ToolbarButton>
            </div>
            <div className="flex gap-1 md:hidden">
              {type === 'style' && <MobileIconButton label={t("批量导入")} onClick={() => setIsFolderImportOpen(true)} className="border border-gray-200 bg-white text-indigo-600 dark:border-gray-800 dark:bg-gray-900 dark:text-indigo-400"><FolderUp className="h-5 w-5" /></MobileIconButton>}
              <MobileIconButton label={t(createLabel)} onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white"><Plus className="h-5 w-5" /></MobileIconButton>
            </div>
          </div>}
          </>}
        </WorkspaceToolbar>
        {!isLoading && !loadError && <ToolbarCountCaption>{countCaptionFiltered
          ? t('匹配 {0} 条 · 共 {1} 条', [filteredChains.length, countCaptionTotal])
          : t('共 {0} 条', [filteredChains.length])}</ToolbarCountCaption>}

        {!selecting && canSync && syncSelection.open && <WisdomSyncToolbar sync={syncSelection} filteredIds={filteredChains.map(chain => chain.id)} />}

        <ImagePreviewPortal><MobileBottomSheet open={showMobileFilters} title={t("筛选与排序")} onClose={() => setShowMobileFilters(false)}>{filterContent}</MobileBottomSheet></ImagePreviewPortal>

        </WorkspaceChrome>
        <div data-workspace-body className="flex min-h-0 flex-1 flex-col md:flex-row">
        {type === 'style' && !isGuest && <ChainFolderNavigation expanded={foldersExpanded} store={folderStore} selected={activeFolder} onSelect={selectFolder} chainIds={chains.filter(chain => chain.type === 'style' || !chain.type).map(chain => chain.id)} countsPending={Boolean((isLoading || loadError) && !chains.length)} favoriteCount={favoritesReady && !((isLoading || loadError) && !chains.length) ? new Set(chains.filter(chain => (chain.type === 'style' || !chain.type) && favorites.has(chain.id)).map(chain => chain.id)).size : '—'} onMove={(ids, folder) => setFolderMemberships(ids, { [folder]: true })} notify={notify} disabled={bulkDeleteBusy || syncSelection.busy} />}
        <div ref={chainScrollRef} onScroll={onScrollRestore} className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">
          {filteredChains.length > 0 && (isLoading || loadError) && <div role={loadError && !isLoading ? 'alert' : 'status'} className="mb-3 text-center text-sm text-gray-500">{isLoading ? t('加载中…') : t(loadError || '')}{!isLoading && loadError && <button type="button" onClick={onRefresh} className="mobile-touch ml-2 underline">{t('重试')}</button>}</div>}
          {filteredChains.length === 0 && (isLoading || loadError) ? <WorkspacePageState role={loadError && !isLoading ? 'alert' : 'status'} className="py-20 text-center text-sm text-gray-500">{isLoading ? t('加载中…') : t(loadError || '')}{!isLoading && loadError && <button type="button" onClick={onRefresh} className="mobile-touch ml-2 underline">{t('重试')}</button>}</WorkspacePageState> : activeFolder === DIRECTORY_FAVORITES_ID && !favoritesReady ? <WorkspacePageState role={favoritesError ? 'alert' : 'status'} className="py-20 text-center text-sm text-gray-500">{favoritesError || t('加载中…')}{favoritesError && <button type="button" className="mobile-touch ml-2 underline" onClick={() => setFavoritesRetry(value => value + 1)}>{t('重新加载')}</button>}</WorkspacePageState> : filteredChains.length === 0 ? (
            <WorkspacePageState className="appearance-group text-center py-20 bg-gray-100 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700">
              <p className="text-gray-500 text-sm mb-4">{syncSelection.open ? syncSelection.view === 'pending' ? t("没有符合筛选条件的待同步风格串，可在「挑选风格串」中加入。") : syncSelection.view === 'records' ? t("没有符合筛选条件的同步记录，接收确认后会显示在这里。") : t("没有符合筛选条件的风格串。") : t("暂无数据")}</p>
              {!isGuest && !selecting && !syncSelection.open && <button onClick={() => setIsModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">{t(createLabel)}</button>}
            </WorkspacePageState>
          ) : (
            /* Grid Layout */
            <>
            {imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                resetKey={resultKey}
                items={visibleChains}
                columns={masonryColumns}
                getItemKey={chain => chain.id}
                estimateItemHeight={estimateChainCardHeight}
                renderItem={renderChainCard}
              />
            ) : (
              <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-chain-grid`} style={mobileGalleryStyle(imageDisplay, masonryColumns)}>
                {visibleChains.map(renderChainCard)}
              </div>
            )}
            {visibleCount < filteredChains.length && <div className="flex justify-center py-6"><button type="button" onClick={() => setVisibleCount(count => count + RENDER_BATCH_SIZE)} className="appearance-group mobile-touch rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">{t("加载更多（{0}）", [filteredChains.length - visibleCount])}</button><div ref={chainLoadSentinelRef} className="h-4 w-full max-w-40" aria-hidden="true" /></div>}
            </>
          )}
        </div>
        </div>
      </div>

      {/* Simple Create Modal */}
      {bundleScope && type === 'style' && !isGuest && <React.Suspense fallback={null}><StyleBundleDialog chains={typeChains} filteredChains={filteredChains} selectedChains={selectedChains} initialScope={bundleScope} onViewFolder={id => { selectFolder(id); setBundleScope(null); }} onClose={() => setBundleScope(null)} onImported={onBundleImported || onRefresh} notify={notify} /></React.Suspense>}
      {similarityOpen && <React.Suspense fallback={null}><ChainSimilarityDialog chains={typeChains} filteredChains={filteredChains} onClose={() => setSimilarityOpen(false)} onOpenChain={onSelect} onDelete={handleDelete} sessionRef={similaritySession} /></React.Suspense>}
      {isModalOpen && (
        <ImagePreviewPortal><div role="dialog" aria-modal="true" aria-label={t(createLabel)} className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="appearance-panel bg-white dark:bg-gray-800 rounded-xl p-6 md:p-8 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">{t(createLabel)}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{t("名称")}</label>
                <input
                  type="text"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={type === 'character' ? t("例如：新角色") : t("例如：新风格串")}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{t("描述")}</label>
                <textarea
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={type === 'character' ? t("描述这个角色的用途...") : t("描述这个风格串的用途...")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">{t("取消")}</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">{t("创建")}</button>
            </div>
          </div>
        </div>
      </ImagePreviewPortal>)}

      {infoChain && <ChainInfoModal key={infoChain.id} chain={infoChain} onSave={onUpdateChain} onClose={() => setInfoChain(null)} notify={notify} />}
      {moveIds && type === 'style' && <ChainFolderMembershipDialog store={folderStore} ids={moveIds} onSave={setFolderMemberships} onClose={() => setMoveIds(null)} />}
      {tagManagerOpen && !isGuest && <ChainTagManager key={type} chains={typeChains} isLoading={isLoading} loadError={loadError} onRefresh={onReloadTags || onRefresh} onClose={() => setTagManagerOpen(false)} notify={notify} onTagChanged={(from, to) => setSelectedTags(current => new Set([...current].flatMap(tag => tag === from ? to ? [to] : [] : [tag])))} />}
      {/* Folder Batch Import Modal */}
      <FolderBatchImportModal
        isOpen={isFolderImportOpen}
        existingChains={chains}
        onClose={() => setIsFolderImportOpen(false)}
        onSuccess={onRefresh}
        notify={notify}
      />
    </div>
  );
};
