import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { t, useLanguage } from '../services/i18n';
import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDownUp, Folder, GripVertical, ListChecks, Plus, Sparkles, Tags, Trash2, X } from 'lucide-react';
import { db } from '../services/dbService';
import { DirectoryTreeNavigation } from './DirectoryTreeNavigation';
import { DirectoryNodeDialog } from './DirectoryNodeDialog';
import { getDirectoryDescendantIds, getDirectoryPath } from '../services/directoryTree.mjs';
import { Inspiration, InspirationBoard, InspirationSourceType, PromptChain, User } from '../types';
import { createUuid } from '../services/id';
import { COLLECTION_SORT_LABELS, CollectionSort, collectionGroupKey, getCollectionBoardIds, getCollectionTags, groupCollectionItems, normalizeInspirationTags, rememberCollectionFolder, sortCollectionGroups, sourceLabel } from '../services/inspirationUtils';
import { useConfirmDialog } from './ConfirmDialog';
import { EmptyState, PageSpinner, ToolbarButton, ToolbarSearch, ToolbarSelect, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS, ToolbarPopover } from './ToolbarPopover';
import { SearchFilterChips } from './SearchFilterChips';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { ImageActivityContext } from './SmartImage';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { InspirationDetail } from './inspiration/InspirationDetail';
import { CollectionCard } from './inspiration/CollectionCard';
import { CollectionTagManager } from './inspiration/CollectionTagManager';
import { CollectionImportDialog } from './inspiration/CollectionImportDialog';
import { DetailSidePanel } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { CollectionFolderPicker, CollectionTagInput } from './inspiration/CollectionControls';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGalleryLoadMore } from './useGalleryLoadMore';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { useImageRatios } from './useImageRatios';
import { BOARD_COLORS, canEditItem, CollectionButton, SmartCollection, sourceIcon, splitTags } from './inspiration/InspirationShared';

interface InspirationGalleryProps {
  selectionFocusEnabled?: boolean;
  currentUser: User;
  inspirationsData: Inspiration[] | null;
  onRefresh: () => Promise<void>;
  onImportRefresh?: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground?: () => void;
  chains?: PromptChain[];
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onSetChainCover?: (chainId: string, imageUrl: string) => Promise<void>;
}

const collectionCardKey = (group: Inspiration[]) => collectionGroupKey(group[0]);
/** 首屏只渲染一批作品组：收藏库可能上百组，全量渲染会让进入页面卡住数秒。 */
const COLLECTION_RENDER_BATCH = 60;

const isLocalFileDrag = (data: DataTransfer) => Array.from(data.types || []).includes('Files') || Boolean(data.files?.length);

export const InspirationGallery: React.FC<InspirationGalleryProps> = ({ currentUser, inspirationsData, onRefresh, onImportRefresh, notify, onNavigateToPlayground, selectionFocusEnabled = true }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const imageDisplay = useMobileImageDisplayPreferences('favorites');
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const galleryContentRef = useRef<HTMLDivElement>(null);
  const masonryColumns = useMasonryColumnCount(imageDisplay, undefined, galleryContentRef);
  const active = useContext(ImageActivityContext);
  const [boards, setBoards] = useState<InspirationBoard[]>([]);
  const navigationId = useId();
  const [navigationExpanded, setNavigationExpanded] = useState(() => { try { return localStorage.getItem('nai-collection-navigation-expanded') === 'true'; } catch { return false; } });
  const toggleNavigation = () => setNavigationExpanded(previous => {
    const next = !previous;
    try { localStorage.setItem('nai-collection-navigation-expanded', String(next)); } catch { /* 本端偏好不可写时仍可收展。 */ }
    return next;
  });
  const [collection, setCollection] = useState<SmartCollection>('all');
  const [boardId, setBoardId] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<InspirationSourceType | ''>('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagNames, setTagNames] = useState<string[] | null>(null);
  const [sort, setSort] = useState<CollectionSort>(() => {
    try { const saved = localStorage.getItem('nai-collection-sort'); return saved && Object.keys(COLLECTION_SORT_LABELS).includes(saved) ? saved as CollectionSort : 'newest'; }
    catch { return 'newest'; }
  });
  useEffect(() => { try { localStorage.setItem('nai-collection-sort', sort); } catch { /* 排序偏好不可写不影响当前浏览。 */ } }, [sort]);
  const draggedIdsRef = useRef<string[]>([]);
  const movingRef = useRef(false);
  const boardOrderSavingRef = useRef(false);
  const boardDragRef = useRef<{ id: string; pointerId: number; targetId: string } | null>(null);
  const [boardDrag, setBoardDrag] = useState<{ id: string; targetId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [workGroup, setWorkGroup] = useState<string | null>(null);
  const selectionAnchor = useGallerySelectionAnchor(mainScrollRef, galleryContentRef, workGroup, active, selectionFocusEnabled);
  const resultKey = JSON.stringify([collection, boardId, search, sourceFilter, [...tagFilter].sort(), sort]);
  const onMainScrollRestore = useKeepAliveScrollRestore(mainScrollRef, 'inspiration', { skipRestore: selectionAnchor.hasAnchor, resetKey: resultKey, onReset: selectionAnchor.clearAnchor });
  const closeGroup = useMobileHistoryLayer(Boolean(workGroup), () => { selectionAnchor.preserveOnClose(); setWorkGroup(null); }, 'collection-work');
  const { prepareSelection } = selectionAnchor;
  const openGroup = useCallback((key: string) => { prepareSelection(key); setWorkGroup(key); }, [prepareSelection]);
  const [importRequest, setImportRequest] = useState<{ files: File[]; boardId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [boardEditor, setBoardEditor] = useState<{ id?: string; name: string; color: string; parentId: string | null } | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const items = useMemo(() => (inspirationsData || []).map(item => ({ ...item, tags: getCollectionTags(item) })), [inspirationsData]);
  const editableIds = useMemo(() => new Set(items.filter(item => !item.archived && currentUser.role !== 'guest' && canEditItem(item, currentUser)).map(item => item.id)), [items, currentUser.id, currentUser.role]);
  const selectedItems = useMemo(() => items.filter(item => editableIds.has(item.id) && selectedIds.has(item.id)), [items, editableIds, selectedIds]);
  const selectedWorks = useMemo(() => new Set(selectedItems.map(collectionGroupKey)).size, [selectedItems]);
  useEffect(() => {
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => editableIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [editableIds]);

  const loadBoards = async () => {
    try { setBoards(await db.getInspirationBoards()); }
    catch (error: any) { notify(error.message || '收藏夹加载失败', 'error'); }
  };
  const loadTagNames = async () => {
    try { setTagNames(await db.getCollectionTagNames()); }
    catch (error: any) { setTagNames(null); notify(error.message || t('标签加载失败'), 'error'); }
  };
  const saveTagNames = async (tags: string[]) => { setTagNames(await db.saveCollectionTagNames(tags)); };
  useEffect(() => { void loadBoards(); void loadTagNames(); }, []);

  const counts = useMemo(() => ({
    all: items.filter(item => !item.archived).length,
    unorganized: items.filter(item => !item.archived && !getCollectionBoardIds(item).length).length,
  }), [items]);

  const allTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    (tagNames || []).forEach(tag => tagCounts.set(tag, 0));
    items.forEach(item => (item.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    return Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items, tagNames]);
  const detailTagSuggestions = useMemo(() => allTags.map(([tag]) => tag).sort((a, b) => a.localeCompare(b)), [allTags]);
  const matchingTags = useMemo(() => allTags.filter(([tag]) => tag.toLowerCase().includes(tagQuery.trim().toLowerCase())), [allTags, tagQuery]);

  // 搜索防抖：击键不再即时触发对全量 items 的过滤重算
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // 侧栏来源计数与收藏夹名称查找：避免每次渲染 O(来源数×items) 与每卡 O(boards)
  const sourceCounts = useMemo(() => {
    const result: Record<string, number> = {};
    items.forEach(item => {
      if (item.archived) return;
      const key = item.sourceType || 'other';
      result[key] = (result[key] || 0) + 1;
    });
    return result;
  }, [items]);
  const availableSources = useMemo(() => {
    return (['history', 'aitag', 'danbooru', 'pixiv', 'upload', 'agent', 'artist', 'character', 'chain', 'other'] as InspirationSourceType[])
      .filter(source => (sourceCounts[source] || 0) > 0 || source === sourceFilter);
  }, [sourceCounts, sourceFilter]);
  const boardNameById = useMemo(() => new Map(boards.map(board => [board.id, board.name])), [boards]);
  const boardAncestors = useMemo(() => new Map(boards.map(board => [board.id, getDirectoryPath(boards, board.id).map(parent => parent.id)])), [boards]);
  const filteredBoardIds = useMemo(() => boardId ? getDirectoryDescendantIds(boards, boardId) : null, [boards, boardId]);
  const boardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach(item => {
      if (item.archived) return;
      const ancestors = new Set(getCollectionBoardIds(item).flatMap(id => boardAncestors.get(id) || []));
      ancestors.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    });
    return counts;
  }, [items, boardAncestors]);

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return items.filter(item => {
      if (item.archived) return false;
      if (collection === 'unorganized' && getCollectionBoardIds(item).length) return false;
      if (sourceFilter && (item.sourceType || 'other') !== sourceFilter) return false;
      if (filteredBoardIds && !getCollectionBoardIds(item).some(id => filteredBoardIds.has(id))) return false;
      if (!tagFilter.every(tag => (item.tags || []).includes(tag))) return false;
      if (query && ![item.title, item.prompt, item.negativePrompt, ...(item.tags || [])].join('\n').toLowerCase().includes(query)) return false;
      return true;
    }).sort((a, b) => {
      return b.createdAt - a.createdAt;
    });
  }, [items, collection, filteredBoardIds, sourceFilter, tagFilter, debouncedSearch]);

  const groups = useMemo(() => sortCollectionGroups(groupCollectionItems(filtered), sort), [filtered, sort]);
  const allGroups = useMemo(() => new Map(groupCollectionItems(items.filter(item => !item.archived)).map(group => [collectionGroupKey(group[0]), group])), [items]);
  const [visibleCount, setVisibleCount] = useState(COLLECTION_RENDER_BATCH);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setVisibleCount(COLLECTION_RENDER_BATCH); }, [resultKey]);
  useGalleryLoadMore(mainScrollRef, loadMoreSentinelRef, visibleCount < groups.length, () => setVisibleCount(count => count + COLLECTION_RENDER_BATCH), '600px 0px');
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  const openedGroup = workGroup ? allGroups.get(workGroup) : undefined;
  useEffect(() => {
    if (workGroup && !openedGroup) setWorkGroup(null);
  }, [workGroup, openedGroup]);


  const saveBoard = async () => {
    if (!boardEditor?.name.trim()) return;
    setBusy('board');
    try {
      if (boardEditor.id) await db.updateInspirationBoard(boardEditor.id, { name: boardEditor.name.trim(), color: boardEditor.color, parentId: boardEditor.parentId });
      else await db.createInspirationBoard({ id: createUuid(), userId: currentUser.id, name: boardEditor.name.trim(), color: boardEditor.color, parentId: boardEditor.parentId, sortOrder: boards.filter(board => (board.parentId || null) === boardEditor.parentId).length, createdAt: Date.now(), updatedAt: Date.now() });
      const wasEdit = Boolean(boardEditor.id); setBoardEditor(null); await loadBoards(); notify(wasEdit ? '收藏夹已更新' : '收藏夹已创建');
    } catch (error: any) { await loadBoards(); notify(error.message || '收藏夹保存失败', 'error'); }
    finally { setBusy(''); }
  };

  const moveBoard = async (id: string, parentId: string | null) => {
    const board = boards.find(board => board.id === id);
    if (!board || (board.parentId || null) === parentId || boardOrderSavingRef.current || busy || currentUser.role === 'guest') return;
    boardOrderSavingRef.current = true; setBusy('board-move');
    try {
      await db.updateInspirationBoard(id, { parentId });
      await loadBoards(); notify('收藏夹已更新');
    } catch (error: any) { await loadBoards(); notify(error.message || '收藏夹保存失败', 'error'); }
    finally { boardOrderSavingRef.current = false; setBusy(''); }
  };

  const reorderBoard = async (id: string, targetId: string) => {
    if (boardOrderSavingRef.current || busy || currentUser.role === 'guest') return;
    const from = boards.findIndex(board => board.id === id);
    const to = boards.findIndex(board => board.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    if ((boards[from].parentId || null) !== (boards[to].parentId || null)) return;
    const previous = boards;
    const reordered = boards.filter(board => (board.parentId || null) === (boards[from].parentId || null));
    const siblingFrom = reordered.findIndex(board => board.id === id);
    const siblingTo = reordered.findIndex(board => board.id === targetId);
    reordered.splice(siblingTo, 0, ...reordered.splice(siblingFrom, 1));
    const siblingPositions = new Map(reordered.map((board, sortOrder) => [board.id, sortOrder]));
    let siblingIndex = 0;
    const next = boards.map(board => siblingPositions.has(board.id) ? { ...reordered[siblingIndex], sortOrder: siblingIndex++ } : board);
    const positions = new Map(next.map(board => [board.id, board.sortOrder]));
    boardOrderSavingRef.current = true; setBusy('board-order'); setBoards(next);
    try {
      for (const board of previous) {
        const sortOrder = positions.get(board.id)!;
        if (sortOrder !== board.sortOrder) await db.updateInspirationBoard(board.id, { sortOrder });
      }
    } catch (error: any) {
      setBoards(previous);
      await loadBoards();
      notify(error.message || '收藏夹排序保存失败', 'error');
    } finally { boardOrderSavingRef.current = false; setBusy(''); }
  };
  const cancelBoardDrag = () => { boardDragRef.current = null; setBoardDrag(null); };
  const moveBoardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = boardDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const list = event.currentTarget.closest<HTMLElement>('[data-collection-folders]');
    if (!list) return;
    const scroller = list.closest<HTMLElement>('.overflow-y-auto');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY < bounds.top + 24) scroller.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 24) scroller.scrollTop += 12;
    }
    const parentId = boards.find(board => board.id === drag.id)?.parentId || null;
    const siblings = new Set(boards.filter(board => (board.parentId || null) === parentId).map(board => board.id));
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-collection-folder]')).filter(row => siblings.has(row.dataset.collectionFolder || ''));
    const target = rows.find(row => {
      const rect = row.closest('.directory-tree-row')!.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left && event.clientX <= rect.right;
    });
    const targetId = target?.dataset.collectionFolder || '';
    if (drag.targetId !== targetId) { drag.targetId = targetId; setBoardDrag({ id: drag.id, targetId }); }
  };

  const deleteBoard = async (board: InspirationBoard) => {
    if (!await confirmAction({ rememberKey: 'collection-board.delete', title: `删除“${board.name}”？`, message: '仅移除本收藏夹归属，作品与其他归属保留；没有其他归属的作品会回到“未整理”。子收藏夹将提升到本夹的上级。', confirmLabel: '删除收藏夹', tone: 'danger' })) return;
    try { await db.deleteInspirationBoard(board.id); if (boardId === board.id) setBoardId(''); await Promise.all([loadBoards(), onRefresh()]); notify('收藏夹已删除'); }
    catch (error: any) { await loadBoards(); notify(error.message || '删除失败', 'error'); }
  };

  const openImport = (files: File[] = [], target = boardId) => {
    if (currentUser.role === 'guest' || busy || importRequest || boardEditor || tagManagerOpen || !active) return;
    setImportRequest({ files, boardId: target });
  };
  const fileDropProps: React.HTMLAttributes<HTMLDivElement> = {
    // 画廊只整理已有作品；外部文件不导入，也不交给浏览器默认打开。
    onDragOver: event => {
      if (draggedIdsRef.current.length || !isLocalFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    },
    onDrop: event => {
      if (!isLocalFileDrag(event.dataTransfer)) return;
      event.preventDefault();
    },
  };

  const toggleSelected = useCallback((ids: string[]) => {
    if (!selectionMode || busy) return;
    const selectable = ids.filter(id => editableIds.has(id));
    setSelectedIds(previous => {
      const next = new Set(previous); const remove = selectable.every(id => next.has(id));
      selectable.forEach(id => { if (remove) next.delete(id); else next.add(id); });
      return next;
    });
  }, [selectionMode, busy, editableIds]);
  const selectFiltered = (invert = false) => {
    if (busy) return;
    setSelectedIds(previous => {
      const next = new Set(previous);
      groups.forEach(group => {
        const ids = group.map(item => item.id).filter(id => editableIds.has(id));
        const remove = invert && ids.every(id => previous.has(id));
        ids.forEach(id => { if (remove) next.delete(id); else next.add(id); });
      });
      return next;
    });
  };
  const updateFolderMembership = async (ids: string[], target: string, checked: boolean) => {
    if (movingRef.current || busy || !boardNameById.has(target)) return;
    const movable = items.filter(item => ids.includes(item.id) && !item.archived && canEditItem(item, currentUser) && getCollectionBoardIds(item).includes(target) !== checked).map(item => item.id);
    if (!movable.length) return;
    movingRef.current = true; setBusy('bulk');
    try {
      await db.bulkUpdateInspirations(movable, checked ? { addBoardIds: [target] } : { removeBoardIds: [target] });
      if (checked) rememberCollectionFolder(target);
      await onRefresh(); notify('收藏夹已更新');
    } catch (error: any) { notify(error.message || '收藏夹更新失败', 'error'); }
    finally { movingRef.current = false; setBusy(''); }
  };
  const renderFolderPicker = (images: Inspiration[], label = '管理收藏夹', iconOnly = false) => {
    const editable = images.filter(image => editableIds.has(image.id));
    const counts = new Map<string, number>();
    editable.forEach(image => getCollectionBoardIds(image).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
    return <CollectionFolderPicker boards={boards} value={Array.from(counts).filter(([, count]) => count === editable.length).map(([id]) => id)} mixedIds={Array.from(counts).filter(([, count]) => count < editable.length).map(([id]) => id)} disabled={Boolean(busy) || !editable.length} label={label} iconOnly={iconOnly} onToggle={(id, checked) => { void updateFolderMembership(editable.map(image => image.id), id, checked); }} />;
  };
  const folderDropProps = (target: string): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: event => {
      event.preventDefault();
      if (!draggedIdsRef.current.length || busy) { event.dataTransfer.dropEffect = 'none'; return; }
      event.dataTransfer.dropEffect = 'copy'; setDropTarget(target);
    },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); },
    onDrop: event => {
      event.preventDefault(); event.stopPropagation();
      if (!draggedIdsRef.current.length) return;
      const ids = draggedIdsRef.current; draggedIdsRef.current = []; setDropTarget(null);
      void updateFolderMembership(ids, target, true);
    },
  });
  const addBulkTags = async () => {
    const additions = splitTags(bulkTag); if (!additions.length || !selectedIds.size) return; setBusy('bulk');
    try { await Promise.all(items.filter(item => selectedIds.has(item.id)).map(item => db.updateInspiration(item.id, { tags: getCollectionTags({ ...item, tags: [...(item.tags || []), ...additions] }) }))); setBulkTag(''); setSelectedIds(new Set()); await onRefresh(); notify('标签已添加'); }
    catch (error: any) { notify(error.message || '标签添加失败', 'error'); }
    finally { setBusy(''); }
  };
  const deleteCollected = useCallback(async (ids: string[]) => {
    if (busy || deletingRef.current) return;
    const editableIds = items.filter(item => ids.includes(item.id) && !item.archived && canEditItem(item, currentUser)).map(item => item.id);
    if (!editableIds.length) return;
    deletingRef.current = true;
    try {
      if (!await confirmAction({ rememberKey: 'collection.unfavorite-batch', title: '取消 ' + editableIds.length + ' 张图片的收藏？', message: '原图与已有分类信息会保留。', confirmLabel: '取消收藏', tone: 'danger' })) return;
      setBusy('bulk'); await db.bulkDeleteInspirations(editableIds);
      setSelectedIds(previous => new Set([...previous].filter(id => !editableIds.includes(id))));
      await onRefresh(); notify('已取消收藏');
    } catch (error: any) { notify(error.message || '取消收藏失败', 'error'); }
    finally { deletingRef.current = false; setBusy(''); }
  }, [busy, items, currentUser, confirmAction, onRefresh, notify]);

  const activeFilterCount = Number(collection !== 'all') + Number(Boolean(boardId)) + Number(Boolean(sourceFilter)) + tagFilter.length;
  const tagChips = tagFilter.map(tag => ({ key: tag, label: `#${tag}`, onRemove: () => setTagFilter(previous => previous.filter(value => value !== tag)) }));
  const renderBoardHandle = (board: InspirationBoard) => <button type="button" data-card-action="true" data-agent-interaction="drag" aria-label={t("排序收藏夹：{0}", [board.name])} title={t("拖动排序；上下方向键调整")}
      disabled={boards.filter(candidate => (candidate.parentId || null) === (board.parentId || null)).length < 2 || currentUser.role === 'guest'} aria-disabled={Boolean(busy)}
      className="mobile-touch flex h-10 w-6 shrink-0 touch-none items-center justify-center rounded-lg text-gray-400 hover:text-indigo-600 active:cursor-grabbing disabled:opacity-20 aria-disabled:opacity-20 cursor-grab dark:hover:text-indigo-300"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false || busy || boardOrderSavingRef.current) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        boardDragRef.current = { id: board.id, pointerId: event.pointerId, targetId: board.id };
        setBoardDrag({ id: board.id, targetId: board.id });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={moveBoardDrag}
      onPointerUp={event => {
        const drag = boardDragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        cancelBoardDrag();
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (drag.targetId) void reorderBoard(drag.id, drag.targetId);
      }}
      onPointerCancel={cancelBoardDrag} onLostPointerCapture={cancelBoardDrag}
      onKeyDown={event => {
        if (event.key === 'Escape') { cancelBoardDrag(); return; }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const siblings = boards.filter(candidate => (candidate.parentId || null) === (board.parentId || null));
        const target = siblings[siblings.findIndex(candidate => candidate.id === board.id) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) void reorderBoard(board.id, target.id);
      }}><GripVertical className="h-3.5 w-3.5" /></button>;
  const renderNavigation = () => <div data-collection-folders="true">
    <DirectoryTreeNavigation label={t('收藏夹目录')} title={t('自定义收藏夹')} nodes={boards} expanded embedded preferenceKey="nai-collection-tree-branches" selectedId={boardId || (collection === 'unorganized' ? '' : '*')}
      selectedIds={sourceFilter ? [] : undefined} createLabel={t('新建收藏夹')} renameLabel={t('编辑收藏夹')} deleteLabel={t('删除收藏夹')}
      counts={boardCounts} totalCount={counts.all} unclassifiedCount={counts.unorganized} allLabel={t('全部')} unclassifiedLabel={t('未整理')} disabled={Boolean(busy)}
      onSelect={id => { setBoardId(id === '*' || !id ? '' : id); setCollection(id === '' ? 'unorganized' : 'all'); setSourceFilter(''); }}
      onMove={currentUser.role === 'guest' ? undefined : (id, parentId) => { void moveBoard(id, parentId); }}
      onCreate={currentUser.role === 'guest' ? undefined : parentId => setBoardEditor({ name: '', color: BOARD_COLORS[boards.length % BOARD_COLORS.length], parentId })}
      onRename={currentUser.role === 'guest' ? undefined : id => { const board = boards.find(board => board.id === id); if (board) setBoardEditor({ id, name: board.name, color: board.color || '#6366f1', parentId: board.parentId || null }); }}
      onDelete={currentUser.role === 'guest' ? undefined : id => { const board = boards.find(board => board.id === id); if (board) void deleteBoard(board); }}
      nodeLeading={id => { const board = boards.find(board => board.id === id); return board ? renderBoardHandle(board) : undefined; }}
      nodeProps={id => { const board = boards.find(board => board.id === id); return board ? { ...folderDropProps(id), 'data-collection-folder': id, 'aria-label': t('选择收藏夹：{0}', [board.name]), 'aria-pressed': boardId === id, style: { '--collection-folder-color': board.color || '#6366f1' } as React.CSSProperties, className: `[&>svg]:[color:var(--collection-folder-color)] ${boardDrag?.id === id ? 'opacity-50' : ''} ${boardDrag?.targetId === id && boardDrag.id !== id ? 'ring-2 ring-indigo-500' : ''} ${dropTarget === id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20 dark:bg-indigo-950' : ''}` } : { 'aria-label': id === '*' ? `${t('全部')} ${counts.all}` : `${t('未整理')} ${counts.unorganized}`, 'aria-pressed': id === '*' ? collection === 'all' && !boardId && !sourceFilter : collection === 'unorganized' }; }}
      header={<><p className="mb-2 px-2 text-meta font-bold text-gray-400">{t('来源')}</p><div className="mb-4 space-y-1">{availableSources.map(source => { const Icon = sourceIcon(source); return <CollectionButton key={source} active={sourceFilter === source} count={sourceCounts[source] || 0} icon={<Icon />} label={t(sourceLabel(source))} onClick={() => { setSourceFilter(source); setBoardId(''); setCollection('all'); }} />; })}</div></>} />
  </div>;
  const renderFilterControls = (mobile: boolean, onManageTags: () => void) => <div className="grid grid-cols-2 gap-3">
    {mobile && <div className="col-span-2" role="group" aria-label={t('收藏筛选')}>{renderNavigation()}</div>}
    {mobile && <label className="col-span-2 text-sm font-bold text-gray-600 dark:text-gray-300">{t('排序')}<select aria-label={t('收藏排序')} value={sort} onChange={event => setSort(event.target.value as CollectionSort)} className={TOOLBAR_FIELD_CLASS}>{Object.entries(COLLECTION_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
    <section className="col-span-2 min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('标签（同时满足）')}</h3>
        <button type="button" disabled={Boolean(busy)} onClick={onManageTags} className="mobile-touch inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"><Tags className="h-3.5 w-3.5" />{t('管理标签')}</button>
      </div>
      <ToolbarSearch aria-label={t('搜索标签')} placeholder={t('搜索已有标签')} value={tagQuery} onChange={event => setTagQuery(event.target.value)} containerClassName="md:max-w-none!" />
      <div role="group" aria-label={t('标签')} className="custom-scrollbar flex max-h-52 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain">
        {matchingTags.map(([tag]) => {
          const selected = tagFilter.includes(tag);
          return <button type="button" key={tag} aria-pressed={selected} title={tag} onClick={() => setTagFilter(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag])} className={`mobile-touch inline-flex max-w-full items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300' : 'appearance-group border-gray-200 bg-gray-50 text-gray-600 hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300'}`}><span className="min-w-0 truncate">#{tag}</span></button>;
        })}
        {!matchingTags.length && <p className="py-3 text-xs text-gray-400">{t('没有匹配的标签')}</p>}
      </div>
    </section>
  </div>;

  const frostedCaption = useGalleryFrostedCaption();
  const [imageRatios, updateImageRatio] = useImageRatios();
  const estimateCollectionCardHeight = React.useCallback((group: Inspiration[], columnWidth: number) => {
    const item = group[0];
    const ratio = imageRatios[item.id] || (item.params?.width && item.params?.height ? item.params.width / item.params.height : 832 / 1216);
    return Math.max(1, columnWidth) / ratio
      + (frostedCaption ? 2 : item.tags?.length ? 72 : 48);
  }, [frostedCaption, imageRatios]);
  const startCardDrag = useCallback((event: React.DragEvent<HTMLElement>, ids: string[], selected: boolean) => {
    draggedIdsRef.current = selected ? items.filter(item => selectedIds.has(item.id) && canEditItem(item, currentUser)).map(item => item.id) : ids;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-nai-collection-items', JSON.stringify(draggedIdsRef.current));
  }, [items, selectedIds, currentUser]);
  const endCardDrag = useCallback(() => { draggedIdsRef.current = []; setDropTarget(null); }, []);
  const renderCollectionCard = (group: Inspiration[]) => <CollectionCard key={group[0].id} group={group} currentUser={currentUser}
    selectedCount={group.filter(item => selectedIds.has(item.id)).length} focused={workGroup === collectionCardKey(group)}
    selectionMode={selectionMode} busy={Boolean(busy)} frostedCaption={frostedCaption} masonry={imageDisplay.layout === 'masonry'} imageRatio={imageRatios[group[0].id]}
    notify={notify} onOpen={openGroup} onToggle={toggleSelected} onDelete={deleteCollected} onImageRatio={updateImageRatio}
    onDragStart={startCardDrag} onDragEnd={endCardDrag} />;

  return <div {...fileDropProps} data-collection-file-dropzone="true" className="workspace-canvas relative flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
    <WorkspaceChrome>
<WorkspaceToolbar>
      <ToolbarButton aria-label={t(navigationExpanded ? '收起收藏分类' : '展开收藏分类')} aria-expanded={navigationExpanded} aria-controls={navigationId}
        title={[t(navigationExpanded ? '收起收藏分类' : '展开收藏分类'), boardId ? boards.find(board => board.id === boardId)?.name || t('收藏夹') : sourceFilter ? t(sourceLabel(sourceFilter)) : t(collection === 'unorganized' ? '未整理' : '全部')].join(' · ')}
        active={navigationExpanded || collection !== 'all' || Boolean(boardId) || Boolean(sourceFilter)} onClick={toggleNavigation} className="hidden md:inline-flex"><Folder /></ToolbarButton>
      {selectionMode ? <>
        <div role="group" aria-label={t("收藏批量操作")} className="flex h-full min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <b className="flex-none text-xs font-semibold text-gray-600 dark:text-gray-300">{t("已选 {0} 个作品，共 {1} 页", [selectedWorks, selectedItems.length])}</b>
          <ToolbarButton aria-label={t("全选筛选结果")} disabled={Boolean(busy)} onClick={() => selectFiltered()} className="mobile-touch !px-2.5">{t("全选筛选结果")}</ToolbarButton>
          <ToolbarButton aria-label={t("反选筛选结果")} disabled={Boolean(busy)} onClick={() => selectFiltered(true)} className="mobile-touch !px-2.5">{t("反选筛选结果")}</ToolbarButton>
          <ToolbarButton disabled={Boolean(busy) || !selectedIds.size} onClick={() => setSelectedIds(new Set())} className="mobile-touch !px-2.5">{t("清空选择")}</ToolbarButton>
          {renderFolderPicker(selectedItems)}
          <div className="appearance-group flex flex-none overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><CollectionTagInput aria-label={t("添加标签")} onPick={setBulkTag} disabled={Boolean(busy) || !selectedIds.size} value={bulkTag} suggestions={allTags.map(([tag]) => tag)} onChange={event => setBulkTag(event.target.value)} placeholder={t("添加标签")} className="mobile-touch h-10 w-28 bg-transparent px-2 text-xs outline-none" /><button type="button" disabled={Boolean(busy) || !selectedIds.size || !bulkTag.trim()} onClick={() => void addBulkTags()} className="mobile-touch border-l border-gray-200 px-2 text-xs font-bold text-indigo-600 disabled:opacity-40 dark:border-gray-800 dark:text-indigo-300">{t("添加")}</button></div>
          <ToolbarButton tone="danger" aria-label={t("取消收藏")} disabled={Boolean(busy) || !selectedIds.size} onClick={() => void deleteCollected(Array.from(selectedIds))} className="mobile-touch ml-auto !px-2.5"><Trash2 /><span>{t("取消收藏")}</span></ToolbarButton>
        </div>
        <ToolbarButton aria-label={t("退出多选")} title={t("退出多选")} onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }} className="mobile-touch !px-2.5"><X /><span className="hidden sm:inline">{t("退出多选")}</span></ToolbarButton>
      </> : <>
      <ToolbarSearch value={search} onChange={event => setSearch(event.target.value)} aria-label={t("搜索标题、提示词或标签…")} placeholder={t("搜索标题、提示词或标签…")} containerClassName="h-11 min-w-0 flex-1 md:h-10 md:max-w-none!" className="h-full! min-h-0!">
        <SearchFilterChips chips={tagChips} expanded={showFilters} onMore={() => setShowFilters(true)} />
      </ToolbarSearch>
      <ToolbarPopover title={t("筛选收藏")} open={showFilters} onOpenChange={setShowFilters} count={mobile => activeFilterCount - (mobile ? 0 : Number(collection !== 'all') + Number(Boolean(boardId)))} width={360}>
        {(close, mobile) => <div className="space-y-4">{renderFilterControls(mobile, () => {
          // 先卸载筛选层并归还焦点，再打开标签管理，避免两层抢焦点和返回操作。
          flushSync(close); setTagManagerOpen(true);
        })}<div className="flex items-center justify-between"><button type="button" onClick={() => { setTagFilter([]); setTagQuery(''); setSourceFilter(''); if (mobile) { setBoardId(''); setCollection('all'); } }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">{t("重置筛选")}</button><button type="button" onClick={close} className="mobile-touch rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white">{t("确认")}</button></div></div>}
      </ToolbarPopover>
      <ToolbarSelect label="收藏排序" icon={<ArrowDownUp />} value={sort} containerClassName="hidden md:inline-flex" className="w-auto!" onChange={event => setSort(event.target.value as CollectionSort)}>{Object.entries(COLLECTION_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</ToolbarSelect>
      <ToolbarButton aria-label={t('批量选择图片')} title={t('批量选择图片')} disabled={Boolean(busy) || !filtered.some(item => editableIds.has(item.id))} onClick={() => { if (workGroup) closeGroup(); setSelectedIds(new Set()); setSelectionMode(true); }} className="mobile-touch !px-2.5 md:!px-3"><ListChecks /><span className="hidden sm:inline">{t('多选')}</span></ToolbarButton>
      <ToolbarButton tone="primary" aria-label={t("加入收藏库")} disabled={currentUser.role === 'guest' || Boolean(busy)} onClick={() => openImport()} className="mobile-touch !px-2.5 md:!px-3"><Plus /><span className="hidden sm:inline">{t("加入收藏库")}</span></ToolbarButton>
      </>}
    </WorkspaceToolbar>
    {inspirationsData !== null && <ToolbarCountCaption>{t(activeFilterCount || debouncedSearch.trim() ? '匹配 {0} 组' : '共 {0} 组', [groups.length])} · {t('当前 {0} 张', [filtered.length])}</ToolbarCountCaption>}

    </WorkspaceChrome>
    <div data-workspace-body className="flex min-h-0 flex-1">
      <aside id={navigationId} hidden={!navigationExpanded} aria-label={t('收藏分类')} className={navigationExpanded ? "workspace-fixed-pane workspace-category-navigation appearance-panel min-h-0 hidden w-52 flex-none overflow-y-auto border-r border-gray-200 p-3 dark:border-gray-800 md:block" : "hidden"}>
        {navigationExpanded && renderNavigation()}
      </aside>

      <div className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 ${openedGroup ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
      <main ref={mainScrollRef} onScroll={() => { selectionAnchor.onScroll(); onMainScrollRestore(); }} className={`${openedGroup ? 'hidden lg:block' : 'block'} workspace-scroll-viewport min-w-0 overflow-y-auto`}>
        <div ref={galleryContentRef} data-collection-focused={Boolean(selectionFocusEnabled && workGroup) || undefined} className="p-3 md:p-5">
        {inspirationsData === null ? <PageSpinner className="min-h-[45vh]" /> : filtered.length > 0 ? <>
          {imageDisplay.layout === 'masonry' ? (
            <ShortestColumnMasonry
              resetKey={resultKey}
              stableColumns
              items={visibleGroups}
              columns={masonryColumns}
              getItemKey={collectionCardKey}
              estimateItemHeight={estimateCollectionCardHeight}
              renderItem={renderCollectionCard}
            />
          ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay, masonryColumns)}>
              {visibleGroups.map(renderCollectionCard)}
            </div>
          )}
          {visibleCount < groups.length && <div className="flex justify-center py-6"><button type="button" onClick={() => setVisibleCount(count => count + COLLECTION_RENDER_BATCH)} className="appearance-group mobile-touch rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">{t("加载更多（{0}）", [groups.length - visibleCount])}</button><div ref={loadMoreSentinelRef} className="h-4 w-full max-w-40" aria-hidden="true" /></div>}
        </> : (
          <EmptyState
            className="min-h-[45vh] px-6"
            icon={<Sparkles className="h-8 w-8" />}
            title={t("这里还没有匹配的收藏")}
            hint={t("点击图片上的爱心收藏，再拖入收藏夹整理。")}
            action={<button type="button" disabled={currentUser.role === 'guest' || Boolean(busy)} onClick={() => openImport()} className="mobile-touch rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">{t("加入第一条收藏")}</button>}
          />
        )}
        </div>
      </main>
      {openedGroup && <DetailSidePanel key={workGroup} open title={openedGroup.length > 1 || Number(openedGroup[0].analysis?.collectionGroupSize) > 1 ? openedGroup[0].title.replace(/ · \d+$/, '') : openedGroup[0].title} sensitiveTitle subInfo={t('{0}页', [openedGroup.length])} sourceUrl={openedGroup[0].sourceUrl} headerActions={openedGroup.length > 1 ? renderFolderPicker(openedGroup, '管理整组收藏夹', true) : undefined} onBack={closeGroup} onClose={closeGroup}>
        <div className="space-y-4">{openedGroup.map(image => <InspirationDetail key={image.id} item={image} boards={boards} tagSuggestions={detailTagSuggestions} currentUser={currentUser} notify={notify} onClose={closeGroup} onRefresh={onRefresh} onNavigateToPlayground={onNavigateToPlayground} />)}</div>
      </DetailSidePanel>}
      </div>
    </div>



    {tagManagerOpen && <CollectionTagManager items={items} tagNames={tagNames} onSaveTagNames={saveTagNames} onReloadTagNames={loadTagNames} currentUser={currentUser} notify={notify} onRefresh={onRefresh} onClose={() => setTagManagerOpen(false)} onTagChanged={(from, to) => {
      setTagFilter(previous => normalizeInspirationTags(previous.map(tag => tag === from ? to || '' : tag)));
      setTagQuery(previous => previous === from ? to || '' : previous);
    }} />}

    {boardEditor && <DirectoryNodeDialog title={boardEditor.id ? t('编辑收藏夹') : t('新建收藏夹')} nodes={boards} name={boardEditor.name} parentId={boardEditor.parentId || ''} editingId={boardEditor.id} busy={busy === 'board'} nameLabel={t('名称')} namePlaceholder={t('例如：电影感光影')} parentLabel={t('上级收藏夹')} rootLabel={t('根目录')} onNameChange={name => setBoardEditor({ ...boardEditor, name })} onParentChange={parentId => setBoardEditor({ ...boardEditor, parentId: parentId || null })} onSubmit={saveBoard} onClose={() => setBoardEditor(null)}><div className="mt-4 flex gap-2">{BOARD_COLORS.map(color => <button key={color} type="button" disabled={busy === 'board'} aria-pressed={boardEditor.color === color} onClick={() => setBoardEditor({ ...boardEditor, color })} className={`mobile-size-locked h-8 w-8 rounded-full transition ${boardEditor.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-gray-900' : ''}`} style={{ backgroundColor: color }} aria-label={t("颜色 {0}", [color])} />)}</div></DirectoryNodeDialog>}

    {importRequest && <CollectionImportDialog currentUser={currentUser} boards={boards} tagSuggestions={allTags.map(([tag]) => tag)} initialFiles={importRequest.files} initialBoardId={importRequest.boardId} onClose={() => setImportRequest(null)} onRefresh={onImportRefresh || onRefresh} notify={notify} />}

  </div>;
};
