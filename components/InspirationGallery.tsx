import { DEFAULT_LAB_MODULE_ORDER, LabPageModuleId } from '../services/appearancePreferences';
import { t, useLanguage } from '../services/i18n';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, FolderPlus, GripVertical, Heart, Library, ListChecks, Pencil, Plus, Sparkles, Tags, Trash2, Upload, X } from 'lucide-react';
import { db } from '../services/dbService';
import { api } from '../services/api';
import { Inspiration, InspirationBoard, InspirationSourceType, NAIParams, PromptChain, User } from '../types';
import { extractMetadata, parseNovelAIMetadata } from '../services/metadataService';
import { createUuid } from '../services/id';
import { COLLECTION_SORT_LABELS, CollectionSort, collectionGroupKey, getCollectionTags, groupCollectionItems, normalizeInspirationTags, rememberCollectionFolder, sortCollectionGroups, sourceLabel } from '../services/inspirationUtils';
import { useConfirmDialog } from './ConfirmDialog';
import { EmptyState, IconButton, MediaCardShell, PageSpinner, ToolbarButton, ToolbarSearch, ToolbarSelect, WorkspaceToolbar } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS, TOOLBAR_MENU_CLASS, ToolbarPopover } from './ToolbarPopover';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { PressRevealSurface } from './PressRevealSurface';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { ImageActivityContext, SmartImage } from './SmartImage';
import { ImageShareOverlay } from './ImageShareActions';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { InspirationDetail } from './inspiration/InspirationDetail';
import { CollectionTagManager } from './inspiration/CollectionTagManager';
import { DetailSidePanel } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { CollectionFolderSelect, CollectionTagInput } from './inspiration/CollectionControls';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { BOARD_COLORS, canEditItem, CollectionButton, SmartCollection, sourceIcon, splitTags } from './inspiration/InspirationShared';

interface InspirationGalleryProps {
  currentUser: User;
  inspirationsData: Inspiration[] | null;
  labModuleOrder?: LabPageModuleId[];
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground?: () => void;
  chains?: PromptChain[];
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onSetChainCover?: (chainId: string, imageUrl: string) => Promise<void>;
}

interface UploadDraft { title: string; prompt: string; negativePrompt: string; tags: string; boardId: string; params?: NAIParams; }
const EMPTY_UPLOAD: UploadDraft = { title: '', prompt: '', negativePrompt: '', tags: '', boardId: '' };

export const InspirationGallery: React.FC<InspirationGalleryProps> = ({ currentUser, inspirationsData, onRefresh, notify, onNavigateToPlayground, labModuleOrder = DEFAULT_LAB_MODULE_ORDER }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const imageDisplay = useMobileImageDisplayPreferences();
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadReadRef = useRef(0);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const galleryContentRef = useRef<HTMLDivElement>(null);
  const active = useContext(ImageActivityContext);
  const [boards, setBoards] = useState<InspirationBoard[]>([]);
  const [collection, setCollection] = useState<SmartCollection>('all');
  const [boardId, setBoardId] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<InspirationSourceType | ''>('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
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
  const selectionAnchor = useGallerySelectionAnchor(mainScrollRef, galleryContentRef, workGroup, active);
  const onMainScrollRestore = useKeepAliveScrollRestore(mainScrollRef, 'inspiration', { skipRestore: selectionAnchor.hasAnchor });
  const closeGroup = useMobileHistoryLayer(Boolean(workGroup), () => { selectionAnchor.preserveOnClose(); setWorkGroup(null); }, 'collection-work');
  const [uploadOpen, setUploadOpen] = useState(false);
  const uploadDialogRef = useModalA11y<HTMLDivElement>(uploadOpen);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(EMPTY_UPLOAD);
  const [busy, setBusy] = useState('');
  const [boardEditor, setBoardEditor] = useState<{ id?: string; name: string; color: string } | null>(null);
  const boardDialogRef = useModalA11y<HTMLDivElement>(Boolean(boardEditor));
  const [bulkTag, setBulkTag] = useState('');
  useEffect(() => {
    if (!boardEditor) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy !== 'board' && isTopmostModal(boardDialogRef.current)) { event.preventDefault(); setBoardEditor(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [boardEditor, busy, boardDialogRef]);
  useEffect(() => {
    if (!uploadOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy !== 'upload' && isTopmostModal(uploadDialogRef.current)) setUploadOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [uploadOpen, busy]);
  const items = useMemo(() => (inspirationsData || []).map(item => ({ ...item, tags: getCollectionTags(item) })), [inspirationsData]);
  const editableIds = useMemo(() => new Set(items.filter(item => !item.archived && currentUser.role !== 'guest' && canEditItem(item, currentUser)).map(item => item.id)), [items, currentUser.id, currentUser.role]);
  const selectedItems = useMemo(() => items.filter(item => editableIds.has(item.id) && selectedIds.has(item.id)), [items, editableIds, selectedIds]);
  const selectedWorks = new Set(selectedItems.map(collectionGroupKey)).size;
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
  useEffect(() => () => { if (uploadPreview.startsWith('blob:')) URL.revokeObjectURL(uploadPreview); }, [uploadPreview]);

  const counts = useMemo(() => ({
    all: items.filter(item => !item.archived).length,
    unorganized: items.filter(item => !item.archived && !item.boardId).length,
  }), [items]);

  const allTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    (tagNames || []).forEach(tag => tagCounts.set(tag, 0));
    items.forEach(item => (item.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    return Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items, tagNames]);
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

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return items.filter(item => {
      if (item.archived) return false;
      if (collection === 'unorganized' && item.boardId) return false;
      if (sourceFilter && (item.sourceType || 'other') !== sourceFilter) return false;
      if (boardId && item.boardId !== boardId) return false;
      if (!tagFilter.every(tag => (item.tags || []).includes(tag))) return false;
      if (query && ![item.title, item.prompt, item.negativePrompt, ...(item.tags || [])].join('\n').toLowerCase().includes(query)) return false;
      return true;
    }).sort((a, b) => {
      return b.createdAt - a.createdAt;
    });
  }, [items, collection, boardId, sourceFilter, tagFilter, debouncedSearch]);

  const groups = useMemo(() => sortCollectionGroups(groupCollectionItems(filtered), sort), [filtered, sort]);
  const allGroups = useMemo(() => new Map(groupCollectionItems(items.filter(item => !item.archived)).map(group => [collectionGroupKey(group[0]), group])), [items]);
  const openedGroup = workGroup ? allGroups.get(workGroup) : undefined;
  useEffect(() => {
    if (workGroup && !openedGroup) setWorkGroup(null);
  }, [workGroup, openedGroup]);

  const setUploadValue = <K extends keyof UploadDraft>(key: K, value: UploadDraft[K]) => setUploadDraft(previous => ({ ...previous, [key]: value }));

  const saveBoard = async () => {
    if (!boardEditor?.name.trim()) return;
    setBusy('board');
    try {
      if (boardEditor.id) await db.updateInspirationBoard(boardEditor.id, { name: boardEditor.name.trim(), color: boardEditor.color });
      else await db.createInspirationBoard({ id: createUuid(), userId: currentUser.id, name: boardEditor.name.trim(), color: boardEditor.color, sortOrder: boards.length, createdAt: Date.now(), updatedAt: Date.now() });
      const wasEdit = Boolean(boardEditor.id); setBoardEditor(null); await loadBoards(); notify(wasEdit ? '收藏夹已更新' : '收藏夹已创建');
    } catch (error: any) { notify(error.message || '收藏夹保存失败', 'error'); }
    finally { setBusy(''); }
  };

  const reorderBoard = async (id: string, targetId: string) => {
    if (boardOrderSavingRef.current || busy || currentUser.role === 'guest') return;
    const from = boards.findIndex(board => board.id === id);
    const to = boards.findIndex(board => board.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const previous = boards;
    const reordered = [...boards];
    reordered.splice(to, 0, ...reordered.splice(from, 1));
    const next = reordered.map((board, sortOrder) => ({ ...board, sortOrder }));
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
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-collection-folder]'));
    const target = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left && event.clientX <= rect.right;
    });
    const targetId = target?.dataset.collectionFolder || '';
    if (drag.targetId !== targetId) { drag.targetId = targetId; setBoardDrag({ id: drag.id, targetId }); }
  };

  const deleteBoard = async (board: InspirationBoard) => {
    if (!await confirmAction({ title: `删除“${board.name}”？`, message: '收藏夹内作品不会删除，它们会回到“未整理”。', confirmLabel: '删除收藏夹', tone: 'danger' })) return;
    try { await db.deleteInspirationBoard(board.id); if (boardId === board.id) setBoardId(''); await Promise.all([loadBoards(), onRefresh()]); notify('收藏夹已删除'); }
    catch (error: any) { notify(error.message || '删除失败', 'error'); }
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return notify('只支持 PNG、JPEG 或 WebP 图片', 'error');
    if (!file.size || file.size > 12 * 1024 * 1024) return notify('收藏图片不能超过 12 MB', 'error');
    if (uploadPreview.startsWith('blob:')) URL.revokeObjectURL(uploadPreview);
    const readId = ++uploadReadRef.current;
    setBusy('metadata'); setUploadFile(file); setUploadPreview(URL.createObjectURL(file));
    setUploadDraft(previous => ({ ...previous, title: file.name.replace(/\.[^/.]+$/, ''), prompt: '', negativePrompt: '', params: undefined }));
    try {
      const metadata = await extractMetadata(file);
      if (metadata && readId === uploadReadRef.current) {
        const parsed = parseNovelAIMetadata(metadata);
        setUploadDraft(previous => ({ ...previous, ...parsed }));
      }
    }
    catch { /* metadata is optional */ }
    finally { if (readId === uploadReadRef.current) setBusy(''); }
  };

  const upload = async () => {
    if (busy) return;
    if (!uploadFile || !uploadDraft.title.trim()) return notify('请选择图片并填写标题', 'error');
    setBusy('upload');
    try {
      const uploaded = await api.uploadFile(uploadFile, 'inspirations');
      await db.saveInspiration({ id: createUuid(), userId: currentUser.id, username: currentUser.username, title: uploadDraft.title.trim(), imageUrl: uploaded.url, prompt: uploadDraft.prompt, negativePrompt: uploadDraft.negativePrompt, params: uploadDraft.params, tags: splitTags(uploadDraft.tags), boardId: uploadDraft.boardId || undefined, sourceType: 'upload', createdAt: Date.now(), updatedAt: Date.now() });
      rememberCollectionFolder(uploadDraft.boardId);
      setUploadOpen(false); setUploadFile(null); setUploadPreview(''); setUploadDraft(EMPTY_UPLOAD); await onRefresh(); notify('已加入收藏库');
    } catch (error: any) { notify(error.message || '上传失败', 'error'); }
    finally { setBusy(''); }
  };

  const toggleSelected = (ids: string[]) => {
    if (!selectionMode || busy) return;
    const selectable = ids.filter(id => editableIds.has(id));
    setSelectedIds(previous => {
      const next = new Set(previous); const remove = selectable.every(id => next.has(id));
      selectable.forEach(id => { if (remove) next.delete(id); else next.add(id); });
      return next;
    });
  };
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
  const moveToFolder = async (ids: string[], target: string) => {
    if (movingRef.current || busy || (target && !boardNameById.has(target))) return;
    const movable = items.filter(item => ids.includes(item.id) && canEditItem(item, currentUser) && (item.boardId || '') !== target).map(item => item.id);
    if (!movable.length) return;
    movingRef.current = true; setBusy('bulk');
    try {
      await db.bulkUpdateInspirations(movable, { boardId: target });
      rememberCollectionFolder(target); setSelectedIds(new Set()); await onRefresh();
      notify(target ? '已移动到收藏夹' : '已移至未整理');
    } catch (error: any) { notify(error.message || '移动失败', 'error'); }
    finally { movingRef.current = false; setBusy(''); }
  };
  const folderDropProps = (target: string): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: event => {
      event.preventDefault();
      if (!draggedIdsRef.current.length || busy) { event.dataTransfer.dropEffect = 'none'; return; }
      event.dataTransfer.dropEffect = 'move'; setDropTarget(target);
    },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); },
    onDrop: event => {
      event.preventDefault(); event.stopPropagation();
      if (!draggedIdsRef.current.length) return;
      const ids = draggedIdsRef.current; draggedIdsRef.current = []; setDropTarget(null);
      void moveToFolder(ids, target);
    },
  });
  const addBulkTags = async () => {
    const additions = splitTags(bulkTag); if (!additions.length || !selectedIds.size) return; setBusy('bulk');
    try { await Promise.all(items.filter(item => selectedIds.has(item.id)).map(item => db.updateInspiration(item.id, { tags: getCollectionTags({ ...item, tags: [...(item.tags || []), ...additions] }) }))); setBulkTag(''); setSelectedIds(new Set()); await onRefresh(); notify('标签已添加'); }
    catch (error: any) { notify(error.message || '标签添加失败', 'error'); }
    finally { setBusy(''); }
  };
  const deleteCollected = async (ids: string[]) => {
    if (busy || deletingRef.current) return;
    const editableIds = items.filter(item => ids.includes(item.id) && !item.archived && canEditItem(item, currentUser)).map(item => item.id);
    if (!editableIds.length) return;
    deletingRef.current = true;
    try {
      if (!await confirmAction({ title: '取消 ' + editableIds.length + ' 张图片的收藏？', message: '原图与已有分类信息会保留。', confirmLabel: '取消收藏', tone: 'danger' })) return;
      setBusy('bulk'); await db.bulkDeleteInspirations(editableIds);
      setSelectedIds(previous => new Set([...previous].filter(id => !editableIds.includes(id))));
      await onRefresh(); notify('已取消收藏');
    } catch (error: any) { notify(error.message || '取消收藏失败', 'error'); }
    finally { deletingRef.current = false; setBusy(''); }
  };

  const activeFilterCount = Number(collection !== 'all') + Number(Boolean(boardId)) + Number(Boolean(sourceFilter)) + tagFilter.length;
  const filterChip = (label: string, remove: () => void) => <button key={label} type="button" aria-label={t('取消筛选：{0}', [label])} onClick={remove} className="mobile-touch inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-indigo-50 px-2 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{label}<X className="h-3 w-3" /></button>;
  const renderBoardActions = (board: InspirationBoard) => <div data-card-action="true" className="hover-reveal-md absolute right-1 flex items-center gap-1 rounded-lg bg-white dark:bg-gray-900">
    <button type="button" disabled={busy === 'board-order'} aria-label={t("编辑收藏夹：{0}", [board.name])} title={t("编辑名称 / 颜色")} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800" onClick={() => setBoardEditor({ id: board.id, name: board.name, color: board.color || '#6366f1' })}><Pencil className="h-4 w-4" /></button>
    <button type="button" disabled={busy === 'board-order'} aria-label={t("删除收藏夹：{0}", [board.name])} title={t("删除收藏夹")} className="mobile-touch flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50" onClick={() => { void deleteBoard(board); }}><Trash2 className="h-4 w-4" /></button>
  </div>;
  const renderBoardRow = (board: InspirationBoard) => <PressRevealSurface key={board.id} data-collection-folder={board.id} {...folderDropProps(board.id)} className={`group relative flex items-center rounded-xl border ${boardDrag?.id === board.id ? 'opacity-50' : ''} ${boardDrag?.targetId === board.id && boardDrag.id !== board.id ? 'ring-2 ring-indigo-500' : ''} ${dropTarget === board.id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20 dark:bg-indigo-950' : boardId === board.id ? 'border-gray-200 bg-white text-indigo-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300' : 'border-transparent hover:bg-white dark:hover:bg-gray-800'}`}>
    <button type="button" data-card-action="true" data-agent-interaction="drag" aria-label={t("排序收藏夹：{0}", [board.name])} title={t("拖动排序；上下方向键调整")}
      disabled={boards.length < 2 || currentUser.role === 'guest'} aria-disabled={Boolean(busy) || boards.length < 2 || currentUser.role === 'guest'}
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
        const target = boards[boards.findIndex(candidate => candidate.id === board.id) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) void reorderBoard(board.id, target.id);
      }}><GripVertical className="h-3.5 w-3.5" /></button>
    <button type="button" aria-label={t("选择收藏夹：{0}", [board.name])} aria-pressed={boardId === board.id} onClick={() => { setBoardId(board.id); setCollection('all'); setSourceFilter(''); }} className="mobile-touch flex h-10 min-w-0 flex-1 items-center gap-2 pl-1 pr-3 text-left text-sm font-semibold"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: board.color }} /><span className="truncate">{board.name}</span><span className="ml-auto text-micro text-gray-400">{items.filter(item => item.boardId === board.id && !item.archived).length}</span></button>{renderBoardActions(board)}
  </PressRevealSurface>;
  const renderNavigation = () => <div>
    <p className="mb-2 px-2 text-meta font-bold text-gray-400">{t('全局')}</p>
    <div className="space-y-1">
      <CollectionButton active={collection === 'all' && !boardId && !sourceFilter} count={counts.all} icon={<Heart />} label={t('全部')} onClick={() => { setCollection('all'); setBoardId(''); setSourceFilter(''); }} />
      <div {...folderDropProps('')} className={dropTarget === '' ? 'rounded-xl ring-2 ring-indigo-500' : ''}><CollectionButton active={collection === 'unorganized'} count={counts.unorganized} icon={<Library />} label={t('未整理')} onClick={() => { setCollection('unorganized'); setBoardId(''); setSourceFilter(''); }} /></div>
    </div>
    <div className="my-4 border-t border-gray-200 dark:border-gray-800" />
    <p className="mb-2 px-2 text-meta font-bold text-gray-400">{t('来源')}</p>
    <div className="space-y-1">{availableSources.map(source => { const Icon = sourceIcon(source); return <CollectionButton key={source} active={sourceFilter === source} count={sourceCounts[source] || 0} icon={<Icon />} label={t(sourceLabel(source))} onClick={() => { setSourceFilter(source); setBoardId(''); setCollection('all'); }} />; })}</div>
    <div className="my-4 border-t border-gray-200 dark:border-gray-800" />
    <div className="mb-2 flex items-center justify-between px-2"><span className="text-meta font-bold text-gray-400">{t('自定义收藏夹')}</span><button type="button" disabled={busy === 'board-order'} aria-label={t('新建收藏夹')} onClick={() => setBoardEditor({ name: '', color: BOARD_COLORS[boards.length % BOARD_COLORS.length] })} className="mobile-touch flex h-8 w-8 items-center justify-center text-indigo-600"><FolderPlus className="h-4 w-4" /></button></div>
    <div data-collection-folders="true" className="space-y-1">{boards.map(renderBoardRow)}{!boards.length && <button type="button" onClick={() => setBoardEditor({ name: '', color: BOARD_COLORS[0] })} className="mobile-touch w-full rounded-xl border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-400 dark:border-gray-700">{t('创建第一个收藏夹')}</button>}</div>
  </div>;
  const renderFilterControls = (mobile: boolean) => <div className="grid grid-cols-2 gap-3">
    {mobile && <div className="col-span-2" role="group" aria-label={t('收藏筛选')}>{renderNavigation()}</div>}
    {mobile && <label className="col-span-2 text-sm font-bold text-gray-600 dark:text-gray-300">{t('排序')}<select aria-label={t('收藏排序')} value={sort} onChange={event => setSort(event.target.value as CollectionSort)} className={TOOLBAR_FIELD_CLASS}>{Object.entries(COLLECTION_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
    <section className="col-span-2 min-w-0 space-y-3">
      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('标签（同时满足）')}</h3>
      <ToolbarSearch aria-label={t('搜索标签')} placeholder={t('搜索已有标签')} value={tagQuery} onChange={event => setTagQuery(event.target.value)} containerClassName="md:max-w-none!" />
      <div role="group" aria-label={t('标签')} className="custom-scrollbar flex max-h-52 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain">
        {matchingTags.map(([tag]) => {
          const selected = tagFilter.includes(tag);
          return <button type="button" key={tag} aria-pressed={selected} title={tag} onClick={() => setTagFilter(previous => previous.includes(tag) ? previous.filter(value => value !== tag) : [...previous, tag])} className={`mobile-touch inline-flex max-w-full items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-indigo-200 hover:text-indigo-600 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300'}`}><span className="min-w-0 truncate">#{tag}</span></button>;
        })}
        {!matchingTags.length && <p className="py-3 text-xs text-gray-400">{t('没有匹配的标签')}</p>}
      </div>
    </section>
  </div>;

  const estimateCollectionCardHeight = React.useCallback((group: Inspiration[], columnWidth: number) => {
    const item = group[0];
    return Math.max(1, columnWidth) * (item.params?.height || 1216) / Math.max(1, item.params?.width || 832)
      + (item.tags?.length ? 72 : 48);
  }, []);
  const renderCollectionCard = (group: Inspiration[]) => {
    const item = group[0]; const ids = group.map(image => image.id);
    const isGroup = group.length > 1 || Boolean(item.sourceId && (item.sourceType === 'aitag' || item.sourceType === 'pixiv') && Number(item.analysis?.collectionGroupSize) > 1);
    const title = isGroup ? item.title.replace(/ · \d+$/, '') : item.title;
    const selectedCount = ids.filter(id => selectedIds.has(id)).length;
    const selected = selectedCount === ids.length;
    const partial = selectedCount > 0 && !selected;
    return <MediaCardShell pressReveal pressDisabled={selectionMode} style={{ contentVisibility: 'visible' }} key={item.id} data-safe-mode-work="true" data-gallery-work-id={collectionGroupKey(item)} selected={selected || partial || workGroup === collectionGroupKey(item)} className={`group relative flex flex-col transition-[filter,box-shadow,border-color] duration-150 ${workGroup && workGroup !== collectionGroupKey(item) ? 'brightness-[.7]' : ''}`}
      draggable={canEditItem(item, currentUser) && !busy}
      onDragStart={event => {
        if (busy || ['touch', 'pen'].includes(event.currentTarget.dataset.pressInput || '') || !canEditItem(item, currentUser) || (event.target as Element).closest('[data-card-action]')) { event.preventDefault(); return; }
        draggedIdsRef.current = selected ? items.filter(candidate => selectedIds.has(candidate.id) && canEditItem(candidate, currentUser)).map(candidate => candidate.id) : ids;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-nai-collection-items', JSON.stringify(draggedIdsRef.current));
      }} onDragEnd={() => { draggedIdsRef.current = []; setDropTarget(null); }}>
      <div className="mobile-gallery-frame relative overflow-hidden md:aspect-square" style={{ '--mobile-image-ratio': `${item.params?.width || 832} / ${item.params?.height || 1216}` } as React.CSSProperties}>
        <button type="button" title={canEditItem(item, currentUser) ? t('拖动到收藏夹') : undefined} disabled={selectionMode && (Boolean(busy) || !canEditItem(item, currentUser))} onClick={() => selectionMode ? toggleSelected(ids) : setWorkGroup(collectionGroupKey(item))} className="absolute inset-0 block h-full w-full text-left"><SmartImage src={item.imageUrl} alt={title} thumbnailVariant="thumb-320" /></button>
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-black/65 px-2 py-1 text-xs font-bold text-white">{t('{0}页', [group.length])}</span>
        {selectionMode && editableIds.has(item.id) && <button data-card-action="true" type="button" aria-pressed={partial ? 'mixed' : selected} title={partial ? t('部分选中') : undefined} disabled={Boolean(busy)} onClick={() => toggleSelected(ids)} className={`mobile-size-locked absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold shadow backdrop-blur transition ${selected || partial ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`} aria-label={t("选择收藏")}>{selected ? '✓' : partial ? '−' : ''}</button>}
        {!selectionMode && canEditItem(item, currentUser) && <button data-card-action="true" type="button" aria-label={t("删除收藏")} title={t("删除")} disabled={Boolean(busy)} onClick={event => { event.stopPropagation(); void deleteCollected(ids); }} className="hover-reveal-md mobile-size-locked absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 md:h-8 md:w-8"><Trash2 className="h-4 w-4" /></button>}
        {!selectionMode && <ImageShareOverlay imageUrl={getMobileOriginalUrl(item.imageUrl)} generationData={item.params ? { prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params } : undefined} filename={`${title || 'inspiration'}.png`} favorite={{ imageUrl: item.imageUrl, collectionId: item.id, ...(isGroup ? { sourceType: item.sourceType, sourceId: item.sourceId, groupSize: group.length, getGroup: async () => group.map(image => ({ ...image, collectionId: image.id })) } : {}) }} notify={notify} />}
      </div>
      <button type="button" disabled={selectionMode && (Boolean(busy) || !canEditItem(item, currentUser))} onClick={() => selectionMode ? toggleSelected(ids) : setWorkGroup(collectionGroupKey(item))} className="min-w-0 flex-1 p-3 text-left"><div className="flex items-start gap-2"><h3 data-safe-mode-title="true" className="min-w-0 flex-1 truncate text-sm font-black text-gray-950 dark:text-white">{title}</h3></div>{(item.tags || []).length > 0 && <div className="mt-2 flex gap-1 overflow-hidden">{item.tags?.slice(0, 3).map(tag => <span key={tag} className="max-w-24 truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-mini font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">#{tag}</span>)}{(item.tags?.length || 0) > 3 && <span className="text-mini text-gray-400">+{(item.tags?.length || 0) - 3}</span>}</div>}</button>
    </MediaCardShell>;
  };

  return <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
    <WorkspaceToolbar>
      {selectionMode ? <>
        <div role="group" aria-label={t("收藏批量操作")} className="flex h-full min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <b className="flex-none text-xs font-semibold text-gray-600 dark:text-gray-300">{t("已选 {0} 个作品，共 {1} 页", [selectedWorks, selectedItems.length])}</b>
          <ToolbarButton aria-label={t("全选筛选结果")} disabled={Boolean(busy)} onClick={() => selectFiltered()} className="mobile-touch !px-2.5">{t("全选筛选结果")}</ToolbarButton>
          <ToolbarButton aria-label={t("反选筛选结果")} disabled={Boolean(busy)} onClick={() => selectFiltered(true)} className="mobile-touch !px-2.5">{t("反选筛选结果")}</ToolbarButton>
          <ToolbarButton disabled={Boolean(busy) || !selectedIds.size} onClick={() => setSelectedIds(new Set())} className="mobile-touch !px-2.5">{t("清空选择")}</ToolbarButton>
          <select aria-label={t('移动到收藏夹')} disabled={Boolean(busy) || !selectedIds.size} defaultValue="" onChange={event => { if (event.target.value) void moveToFolder(Array.from(selectedIds), event.target.value === '__none' ? '' : event.target.value); event.target.value = ''; }} className="mobile-touch h-10 w-32 flex-none rounded-xl border border-gray-200 bg-white px-2 text-xs dark:border-gray-800 dark:bg-gray-900"><option value="" disabled>{t("移动到…")}</option><option value="__none">{t("未整理")}</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
          <div className="flex flex-none overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><CollectionTagInput aria-label={t("添加标签")} onPick={setBulkTag} disabled={Boolean(busy) || !selectedIds.size} value={bulkTag} suggestions={allTags.map(([tag]) => tag)} onChange={event => setBulkTag(event.target.value)} placeholder={t("添加标签")} className="mobile-touch h-10 w-28 bg-transparent px-2 text-xs outline-none" /><button type="button" disabled={Boolean(busy) || !selectedIds.size || !bulkTag.trim()} onClick={() => void addBulkTags()} className="mobile-touch border-l border-gray-200 px-2 text-xs font-bold text-indigo-600 disabled:opacity-40 dark:border-gray-800 dark:text-indigo-300">{t("添加")}</button></div>
          <ToolbarButton tone="danger" aria-label={t("取消收藏")} disabled={Boolean(busy) || !selectedIds.size} onClick={() => void deleteCollected(Array.from(selectedIds))} className="mobile-touch ml-auto !px-2.5"><Trash2 /><span>{t("取消收藏")}</span></ToolbarButton>
        </div>
        <ToolbarButton aria-label={t("退出多选")} title={t("退出多选")} onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }} className="mobile-touch !px-2.5"><X /><span className="hidden sm:inline">{t("退出多选")}</span></ToolbarButton>
      </> : <>
      <ToolbarSearch value={search} onChange={event => setSearch(event.target.value)} aria-label={t("搜索标题、提示词或标签…")} placeholder={t("搜索标题、提示词或标签…")} containerClassName="min-w-0 flex-1 md:max-w-none!">
        {tagFilter.length > 0 && <div role="group" aria-label={t('标签（同时满足）')} className="flex min-w-0 max-w-[50%] flex-none items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tagFilter.map(tag => filterChip(`#${tag}`, () => setTagFilter(previous => previous.filter(value => value !== tag))))}
        </div>}
      </ToolbarSearch>
      <ToolbarPopover title={t("筛选收藏")} count={mobile => activeFilterCount - (mobile ? 0 : Number(collection !== 'all') + Number(Boolean(boardId)))} width={360}>
        {(close, mobile) => <div className="space-y-4">{renderFilterControls(mobile)}<div className="flex items-center justify-between"><button type="button" onClick={() => { setTagFilter([]); setTagQuery(''); setSourceFilter(''); if (mobile) { setBoardId(''); setCollection('all'); } }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">{t("重置筛选")}</button><button type="button" onClick={close} className="mobile-touch rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white">{t("确认")}</button></div></div>}
      </ToolbarPopover>
      <ToolbarSelect label="收藏排序" icon={<ArrowDownUp />} value={sort} containerClassName="hidden md:inline-flex" className="w-auto!" onChange={event => setSort(event.target.value as CollectionSort)}>{Object.entries(COLLECTION_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</ToolbarSelect>
      <ToolbarPopover label="管理" title={t("收藏管理")} icon={<ListChecks />} width={256}>
        {close => <>
          <button type="button" disabled={Boolean(busy)} onClick={() => { close(); setTagManagerOpen(true); }} className={TOOLBAR_MENU_CLASS + ' disabled:opacity-40'}><Tags />{t("管理标签")}</button>
          <button type="button" disabled={Boolean(busy) || !filtered.some(item => editableIds.has(item.id))} onClick={() => { close(); if (workGroup) closeGroup(); setSelectedIds(new Set()); setSelectionMode(true); }} className={TOOLBAR_MENU_CLASS + ' disabled:opacity-40'}><ListChecks />{t("批量选择图片")}</button>
        </>}
      </ToolbarPopover>
      <ToolbarButton tone="primary" aria-label={t("加入收藏库")} onClick={() => setUploadOpen(true)} className="mobile-touch !px-2.5 md:!px-3"><Plus /><span className="hidden sm:inline">{t("加入收藏库")}</span></ToolbarButton>
      </>}
    </WorkspaceToolbar>

    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-44 flex-none overflow-y-auto border-r border-gray-200 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-900/60 md:block">
        {renderNavigation()}
      </aside>

      <div className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 ${openedGroup ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
      <main ref={mainScrollRef} onScroll={() => { selectionAnchor.onScroll(); onMainScrollRestore(); }} className={`${openedGroup ? 'hidden lg:block' : 'block'} min-w-0 overflow-y-auto`}>
        <div ref={galleryContentRef}>
        {inspirationsData === null ? <PageSpinner className="min-h-[45vh]" /> : filtered.length > 0 ? <div className="p-3 md:p-5">
          {imageDisplay.layout === 'masonry' ? (
            <ShortestColumnMasonry
              stableColumns
              items={groups}
              columns={masonryColumns}
              getItemKey={group => collectionGroupKey(group[0])}
              estimateItemHeight={estimateCollectionCardHeight}
              renderItem={renderCollectionCard}
            />
          ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {groups.map(renderCollectionCard)}
            </div>
          )}
        </div> : (
          <EmptyState
            className="min-h-[45vh] px-6"
            icon={<Sparkles className="h-8 w-8" />}
            title={t("这里还没有匹配的收藏")}
            hint={t("点击图片上的爱心收藏，再拖入收藏夹整理。")}
            action={<button type="button" onClick={() => setUploadOpen(true)} className="mobile-touch rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">{t("加入第一条收藏")}</button>}
          />
        )}
        </div>
      </main>
      {openedGroup && <DetailSidePanel key={workGroup} open title={openedGroup.length > 1 || Number(openedGroup[0].analysis?.collectionGroupSize) > 1 ? openedGroup[0].title.replace(/ · \d+$/, '') : openedGroup[0].title} sensitiveTitle subInfo={t('{0}页', [openedGroup.length])} sourceUrl={openedGroup[0].sourceUrl} onBack={closeGroup} onClose={closeGroup}>
        <div className="space-y-4">{openedGroup.map(image => <InspirationDetail key={image.id} item={image} items={items} tagNames={tagNames || []} labModuleOrder={labModuleOrder} currentUser={currentUser} notify={notify} onClose={closeGroup} onRefresh={onRefresh} onNavigateToPlayground={onNavigateToPlayground} />)}</div>
      </DetailSidePanel>}
      </div>
    </div>



    {tagManagerOpen && <CollectionTagManager items={items} tagNames={tagNames} onSaveTagNames={saveTagNames} onReloadTagNames={loadTagNames} currentUser={currentUser} notify={notify} onRefresh={onRefresh} onClose={() => setTagManagerOpen(false)} onTagChanged={(from, to) => {
      setTagFilter(previous => normalizeInspirationTags(previous.map(tag => tag === from ? to || '' : tag)));
      setTagQuery(previous => previous === from ? to || '' : previous);
    }} />}

    {boardEditor && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-center md:p-4" onClick={() => setBoardEditor(null)}><div ref={boardDialogRef} role="dialog" aria-modal="true" aria-label={boardEditor.id ? t("编辑收藏夹") : t("新建收藏夹")} className="appearance-panel ui-sheet-enter mobile-safe-bottom w-full max-w-sm rounded-t-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl" onClick={event => event.stopPropagation()}><h2 className="text-lg font-black">{boardEditor.id ? t("编辑收藏夹") : t("新建收藏夹")}</h2><input autoFocus value={boardEditor.name} onChange={event => setBoardEditor({ ...boardEditor, name: event.target.value })} placeholder={t("例如：电影感光影")} className="mt-4 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950" /><div className="mt-4 flex gap-2">{BOARD_COLORS.map(color => <button key={color} type="button" aria-pressed={boardEditor.color === color} onClick={() => setBoardEditor({ ...boardEditor, color })} className={`mobile-size-locked h-8 w-8 rounded-full transition ${boardEditor.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-gray-900' : ''}`} style={{ backgroundColor: color }} aria-label={t("颜色 {0}", [color])} />)}</div><div className="mt-6 grid grid-cols-2 gap-3 md:flex md:justify-end"><button type="button" onClick={() => setBoardEditor(null)} className="mobile-touch rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-600 dark:border-gray-800 dark:text-gray-300">{t("取消")}</button><button type="button" disabled={!boardEditor.name.trim() || busy === 'board'} onClick={() => void saveBoard()} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 disabled:opacity-40">{busy === 'board' ? t("正在保存…") : t("保存")}</button></div></div></div></ImagePreviewPortal>}

    {uploadOpen && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-5" onClick={() => setUploadOpen(false)}><div ref={uploadDialogRef} role="dialog" aria-modal="true" aria-label={t("加入收藏库")} className="operation-dialog ui-modal-enter flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}><header className="operation-header flex flex-none items-center justify-between border-b border-gray-200 px-5 dark:border-gray-800"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-500">{t("手动收录")}</p><h2 className="text-xl font-black">{t("加入收藏库")}</h2></div><IconButton label={t("关闭")} onClick={() => setUploadOpen(false)}><X /></IconButton></header><div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[260px_1fr]"><button type="button" disabled={busy === 'upload'} onClick={() => fileInputRef.current?.click()} className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">{uploadPreview ? <img src={uploadPreview} alt={t("上传预览")} className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-2 text-sm font-bold text-gray-400"><Upload className="h-7 w-7" />{t("选择图片")}<span className="text-micro font-normal">{t("PNG / JPEG / WebP，最多 12 MB")}</span></span>}</button><input aria-label={t("上传收藏图片")} disabled={busy === 'upload'} ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void chooseFile(event.target.files?.[0])} /><fieldset disabled={busy === 'metadata' || busy === 'upload'} className="space-y-3"><label><span className="mb-1 block text-xs font-bold text-gray-500">{t("标题")}</span><input data-safe-mode-title="true" value={uploadDraft.title} onChange={event => setUploadValue('title', event.target.value)} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950" /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block text-xs font-bold text-gray-500">{t("收藏夹")}</span><CollectionFolderSelect value={uploadDraft.boardId} onChange={id => setUploadValue('boardId', id)} boards={boards} notify={notify} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950" /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">{t("标签")}</span><CollectionTagInput onPick={value => setUploadValue('tags', value)} suggestions={allTags.map(([tag]) => tag)} value={uploadDraft.tags} onChange={event => setUploadValue('tags', event.target.value)} placeholder={t("构图, 光影")} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950" /></label></div><label><span className="mb-1 block text-xs font-bold text-gray-500">{t("提示词")}</span><textarea value={uploadDraft.prompt} onChange={event => setUploadValue('prompt', event.target.value)} className="min-h-24 w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs dark:border-gray-800 dark:bg-gray-950" /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">{t("负面提示词")}</span><textarea value={uploadDraft.negativePrompt} onChange={event => setUploadValue('negativePrompt', event.target.value)} className="min-h-16 w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs dark:border-gray-800 dark:bg-gray-950" /></label></fieldset></div><footer className="operation-footer grid flex-none grid-cols-2 gap-3 border-t border-gray-200 dark:border-gray-800 md:flex md:justify-end"><button type="button" onClick={() => setUploadOpen(false)} className="mobile-touch rounded-xl border border-gray-200 px-5 text-sm font-bold text-gray-600 dark:border-gray-800 dark:text-gray-300">{t("取消")}</button><button type="button" disabled={!uploadFile || !uploadDraft.title.trim() || Boolean(busy)} onClick={() => void upload()} className="mobile-touch rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 disabled:opacity-40">{busy === 'metadata' ? t("正在读取图片…") : busy === 'upload' ? t("正在保存…") : t("加入收藏库")}</button></footer></div></div></ImagePreviewPortal>}

  </div>;
};
