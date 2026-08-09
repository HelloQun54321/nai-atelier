import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, CheckSquare, Clock, FolderPlus, Library, Pencil, Pin, Plus, RefreshCw, Search, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { db } from '../services/dbService';
import { api } from '../services/api';
import { Inspiration, InspirationBoard, InspirationSourceType, NAIParams, PromptChain, User } from '../types';
import { extractMetadata, parseNovelAIMetadata } from '../services/metadataService';
import { createUuid } from '../services/id';
import { normalizeInspirationTags, sourceLabel } from '../services/inspirationUtils';
import { useConfirmDialog } from './ConfirmDialog';
import { IconButton, MediaCardShell, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { SmartImage } from './SmartImage';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { InspirationDetail } from './inspiration/InspirationDetail';
import { BOARD_COLORS, canEditItem, CollectionButton, SmartCollection, SortMode, sourceIcon, splitTags } from './inspiration/InspirationShared';

interface InspirationGalleryProps {
  currentUser: User;
  inspirationsData: Inspiration[] | null;
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground?: () => void;
  chains?: PromptChain[];
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onSetChainCover?: (chainId: string, imageUrl: string) => Promise<void>;
}

interface UploadDraft { title: string; prompt: string; negativePrompt: string; notes: string; tags: string; boardId: string; }
const EMPTY_UPLOAD: UploadDraft = { title: '', prompt: '', negativePrompt: '', notes: '', tags: '', boardId: '' };

export const InspirationGallery: React.FC<InspirationGalleryProps> = ({ currentUser, inspirationsData, onRefresh, notify, onNavigateToPlayground, chains = [], onCreateArtistChain, onSetChainCover }) => {
  const confirmAction = useConfirmDialog();
  const imageDisplay = useMobileImageDisplayPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [boards, setBoards] = useState<InspirationBoard[]>([]);
  const [collection, setCollection] = useState<SmartCollection>('all');
  const [boardId, setBoardId] = useState('');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState(0);
  const [sort, setSort] = useState<SortMode>('created');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Inspiration | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(EMPTY_UPLOAD);
  const [busy, setBusy] = useState('');
  const [boardEditor, setBoardEditor] = useState<{ id?: string; name: string; color: string } | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const [mobileFilters, setMobileFilters] = useState(false);
  const items = inspirationsData || [];

  const loadBoards = async () => {
    try { setBoards(await db.getInspirationBoards()); }
    catch (error: any) { notify(error.message || '灵感板加载失败', 'error'); }
  };
  useEffect(() => { void loadBoards(); }, []);
  useEffect(() => () => { if (uploadPreview.startsWith('blob:')) URL.revokeObjectURL(uploadPreview); }, [uploadPreview]);

  const counts = useMemo(() => ({
    all: items.filter(item => !item.archived).length,
    unorganized: items.filter(item => !item.archived && !item.boardId && !(item.tags || []).length && !item.notes).length,
    pinned: items.filter(item => !item.archived && item.isPinned).length,
    recent: items.filter(item => !item.archived && item.lastUsedAt).length,
    archived: items.filter(item => item.archived).length,
  }), [items]);

  const allTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    items.forEach(item => (item.tags || []).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    return Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80);
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      if (collection === 'archived') { if (!item.archived) return false; } else if (item.archived) return false;
      if (collection === 'unorganized' && (item.boardId || (item.tags || []).length || item.notes)) return false;
      if (collection === 'pinned' && !item.isPinned) return false;
      if (collection === 'recent' && !item.lastUsedAt) return false;
      if (collection.startsWith('source:') && item.sourceType !== collection.slice(7)) return false;
      if (boardId && item.boardId !== boardId) return false;
      if (tagFilter && !(item.tags || []).includes(tagFilter)) return false;
      if (ratingFilter && (item.rating || 0) < ratingFilter) return false;
      if (query && ![item.title, item.prompt, item.negativePrompt, item.notes, ...(item.tags || [])].join('\n').toLowerCase().includes(query)) return false;
      return true;
    }).sort((a, b) => {
      if (a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned);
      if (sort === 'used') return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      if (sort === 'popular') return (b.useCount || 0) - (a.useCount || 0);
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      return b.createdAt - a.createdAt;
    });
  }, [items, collection, boardId, tagFilter, ratingFilter, search, sort]);

  const setUploadValue = <K extends keyof UploadDraft>(key: K, value: UploadDraft[K]) => setUploadDraft(previous => ({ ...previous, [key]: value }));
  const refreshAll = async () => { setBusy('refresh'); try { await Promise.all([onRefresh(), loadBoards()]); } finally { setBusy(''); } };

  const saveBoard = async () => {
    if (!boardEditor?.name.trim()) return;
    setBusy('board');
    try {
      if (boardEditor.id) await db.updateInspirationBoard(boardEditor.id, { name: boardEditor.name.trim(), color: boardEditor.color });
      else await db.createInspirationBoard({ id: createUuid(), userId: currentUser.id, name: boardEditor.name.trim(), color: boardEditor.color, sortOrder: boards.length, createdAt: Date.now(), updatedAt: Date.now() });
      const wasEdit = Boolean(boardEditor.id); setBoardEditor(null); await loadBoards(); notify(wasEdit ? '灵感板已更新' : '灵感板已创建');
    } catch (error: any) { notify(error.message || '灵感板保存失败', 'error'); }
    finally { setBusy(''); }
  };

  const deleteBoard = async (board: InspirationBoard) => {
    if (!await confirmAction({ title: `删除“${board.name}”？`, message: '板内灵感不会删除，它们会回到“未整理”。', confirmLabel: '删除灵感板', tone: 'danger' })) return;
    try { await db.deleteInspirationBoard(board.id); if (boardId === board.id) setBoardId(''); await Promise.all([loadBoards(), onRefresh()]); notify('灵感板已删除'); }
    catch (error: any) { notify(error.message || '删除失败', 'error'); }
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return notify('只支持 PNG、JPEG 或 WebP 图片', 'error');
    if (!file.size || file.size > 12 * 1024 * 1024) return notify('灵感图片不能超过 12 MB', 'error');
    if (uploadPreview.startsWith('blob:')) URL.revokeObjectURL(uploadPreview);
    setUploadFile(file); setUploadPreview(URL.createObjectURL(file)); setUploadValue('title', file.name.replace(/\.[^/.]+$/, ''));
    try { const metadata = await extractMetadata(file); if (metadata) { const parsed = parseNovelAIMetadata(metadata); setUploadDraft(previous => ({ ...previous, prompt: parsed.prompt, negativePrompt: parsed.negativePrompt })); } }
    catch { /* metadata is optional */ }
  };

  const upload = async () => {
    if (!uploadFile || !uploadDraft.title.trim()) return notify('请选择图片并填写标题', 'error');
    setBusy('upload');
    try {
      let params: NAIParams | undefined;
      if (uploadDraft.prompt.trim()) { try { params = parseNovelAIMetadata(uploadDraft.prompt).params; } catch { /* prompt only */ } }
      const uploaded = await api.uploadFile(uploadFile, 'inspirations');
      await db.saveInspiration({ id: createUuid(), userId: currentUser.id, username: currentUser.username, title: uploadDraft.title.trim(), imageUrl: uploaded.url, prompt: uploadDraft.prompt, negativePrompt: uploadDraft.negativePrompt, params, notes: uploadDraft.notes, tags: splitTags(uploadDraft.tags), boardId: uploadDraft.boardId || undefined, sourceType: 'upload', createdAt: Date.now(), updatedAt: Date.now() });
      setUploadOpen(false); setUploadFile(null); setUploadPreview(''); setUploadDraft(EMPTY_UPLOAD); await onRefresh(); notify('已加入灵感库');
    } catch (error: any) { notify(error.message || '上传失败', 'error'); }
    finally { setBusy(''); }
  };

  const toggleSelected = (id: string) => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const runBulkUpdate = async (updates: Partial<Inspiration>, success: string) => {
    if (!selectedIds.size) return; setBusy('bulk');
    try { await db.bulkUpdateInspirations(Array.from(selectedIds), updates); setSelectedIds(new Set()); await onRefresh(); notify(success); }
    catch (error: any) { notify(error.message || '批量操作失败', 'error'); }
    finally { setBusy(''); }
  };
  const addBulkTags = async () => {
    const additions = splitTags(bulkTag); if (!additions.length || !selectedIds.size) return; setBusy('bulk');
    try { await Promise.all(items.filter(item => selectedIds.has(item.id)).map(item => db.updateInspiration(item.id, { tags: normalizeInspirationTags([...(item.tags || []), ...additions]) }))); setBulkTag(''); setSelectedIds(new Set()); await onRefresh(); notify('标签已添加'); }
    catch (error: any) { notify(error.message || '标签添加失败', 'error'); }
    finally { setBusy(''); }
  };
  const deleteSelected = async () => {
    if (!selectedIds.size || !await confirmAction({ title: `删除 ${selectedIds.size} 条灵感？`, message: '此操作不可撤销。被其他资料引用的原图会安全保留。', confirmLabel: '删除', tone: 'danger' })) return;
    setBusy('bulk'); try { await db.bulkDeleteInspirations(Array.from(selectedIds)); setSelectedIds(new Set()); await onRefresh(); notify('已删除选中灵感'); }
    catch (error: any) { notify(error.message || '删除失败', 'error'); } finally { setBusy(''); }
  };

  const selectedItems = items.filter(item => selectedIds.has(item.id));
  const allSelectedPinned = selectedItems.length > 0 && selectedItems.every(item => item.isPinned);
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(item => item.archived);
  const activeTitle = boardId ? boards.find(board => board.id === boardId)?.name : collection === 'all' ? '全部灵感' : collection === 'unorganized' ? '未整理' : collection === 'pinned' ? '已置顶' : collection === 'recent' ? '最近使用' : collection === 'archived' ? '已归档' : sourceLabel(collection.slice(7) as InspirationSourceType);

  return <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
    <WorkspaceToolbar className="relative z-30 flex-wrap">
      <div className="mr-1 hidden items-center gap-2 md:flex"><Library className="h-5 w-5 text-indigo-600" /><div><h1 className="text-sm font-black leading-none text-gray-950 dark:text-white">灵感库</h1><p className="mt-1 text-[10px] text-gray-400">精选、整理、复用</p></div></div>
      <ToolbarSearch value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题、Prompt、备注或标签" containerClassName="min-w-[180px]" />
      <ToolbarButton onClick={() => setMobileFilters(!mobileFilters)} className="md:hidden"><Search />筛选</ToolbarButton>
      <ToolbarButton onClick={() => setSelectedIds(selectedIds.size ? new Set() : new Set(filtered.filter(item => canEditItem(item, currentUser)).map(item => item.id)))} tone={selectedIds.size ? 'primary' : 'neutral'}><CheckSquare />{selectedIds.size ? `${selectedIds.size} 项` : '选择'}</ToolbarButton>
      <IconButton label="刷新灵感库" disabled={busy === 'refresh'} onClick={() => void refreshAll()}><RefreshCw className={busy === 'refresh' ? 'animate-spin' : ''} /></IconButton>
      <ToolbarButton tone="primary" onClick={() => setUploadOpen(true)}><Plus />加入灵感</ToolbarButton>
    </WorkspaceToolbar>

    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-60 flex-none overflow-y-auto border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 md:block">
        <div className="mb-2 px-2 text-[11px] font-black uppercase tracking-widest text-gray-400">智能分类</div>
        <div className="space-y-1">
          <CollectionButton active={collection === 'all'} count={counts.all} icon={<Library />} label="全部灵感" onClick={() => { setCollection('all'); setBoardId(''); }} />
          <CollectionButton active={collection === 'unorganized'} count={counts.unorganized} icon={<Sparkles />} label="未整理" onClick={() => { setCollection('unorganized'); setBoardId(''); }} />
          <CollectionButton active={collection === 'pinned'} count={counts.pinned} icon={<Pin />} label="已置顶" onClick={() => { setCollection('pinned'); setBoardId(''); }} />
          <CollectionButton active={collection === 'recent'} count={counts.recent} icon={<Clock />} label="最近使用" onClick={() => { setCollection('recent'); setBoardId(''); }} />
          <CollectionButton active={collection === 'archived'} count={counts.archived} icon={<Archive />} label="已归档" onClick={() => { setCollection('archived'); setBoardId(''); }} />
        </div>

        <div className="mb-2 mt-6 flex items-center justify-between px-2"><span className="text-[11px] font-black uppercase tracking-widest text-gray-400">灵感板</span><button type="button" onClick={() => setBoardEditor({ name: '', color: BOARD_COLORS[boards.length % BOARD_COLORS.length] })} className="text-indigo-600" aria-label="新建灵感板"><FolderPlus className="h-4 w-4" /></button></div>
        <div className="space-y-1">
          {boards.map(board => <div key={board.id} className={`group flex items-center rounded-xl ${boardId === board.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}><button type="button" onClick={() => { setBoardId(board.id); setCollection('all'); }} className="flex h-10 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm font-semibold"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: board.color }} /><span className="truncate">{board.name}</span><span className="ml-auto text-[10px] text-gray-400">{items.filter(item => item.boardId === board.id && !item.archived).length}</span></button><button type="button" onClick={() => setBoardEditor({ id: board.id, name: board.name, color: board.color || '#6366f1' })} className="hidden h-8 w-8 items-center justify-center text-gray-400 group-hover:flex" aria-label="编辑灵感板"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void deleteBoard(board)} className="hidden h-8 w-8 items-center justify-center text-gray-400 hover:text-red-500 group-hover:flex" aria-label="删除灵感板"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
          {!boards.length && <button type="button" onClick={() => setBoardEditor({ name: '', color: BOARD_COLORS[0] })} className="w-full rounded-xl border border-dashed border-gray-300 px-3 py-4 text-xs text-gray-400 dark:border-gray-700">创建第一个灵感板</button>}
        </div>

        <div className="mb-2 mt-6 px-2 text-[11px] font-black uppercase tracking-widest text-gray-400">来源</div>
        <div className="space-y-1">{(['history', 'aitag', 'upload', 'agent'] as InspirationSourceType[]).map(source => { const SourceIcon = sourceIcon(source); return <CollectionButton key={source} active={collection === `source:${source}`} count={items.filter(item => !item.archived && item.sourceType === source).length} icon={<SourceIcon />} label={sourceLabel(source)} onClick={() => { setCollection(`source:${source}`); setBoardId(''); }} />; })}</div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={`${mobileFilters ? 'grid' : 'hidden'} sticky top-0 z-20 gap-2 border-b border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 md:grid md:grid-cols-[minmax(150px,1fr)_minmax(130px,1fr)_130px_140px] md:px-5`}>
          <div className="flex gap-2 md:hidden"><select value={collection} onChange={event => { setCollection(event.target.value as SmartCollection); setBoardId(''); }} className="h-10 min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="all">全部灵感</option><option value="unorganized">未整理</option><option value="pinned">已置顶</option><option value="recent">最近使用</option><option value="archived">已归档</option><option value="source:history">来源：生成历史</option><option value="source:aitag">来源：AITag</option><option value="source:upload">来源：手动上传</option><option value="source:agent">来源：项目 Agent</option></select><button type="button" onClick={() => setBoardEditor({ name: '', color: BOARD_COLORS[boards.length % BOARD_COLORS.length] })} className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-gray-300 text-indigo-600 dark:border-gray-700" aria-label="新建灵感板"><FolderPlus className="h-4 w-4" /></button></div>
          <select value={boardId} onChange={event => { setBoardId(event.target.value); setCollection('all'); }} className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">全部灵感板</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
          <select value={tagFilter} onChange={event => setTagFilter(event.target.value)} className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="">全部标签</option>{allTags.map(([tag, count]) => <option key={tag} value={tag}>{tag} ({count})</option>)}</select>
          <select value={ratingFilter} onChange={event => setRatingFilter(Number(event.target.value))} className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="0">全部评分</option><option value="1">1 星以上</option><option value="2">2 星以上</option><option value="3">3 星以上</option><option value="4">4 星以上</option><option value="5">5 星</option></select>
          <select value={sort} onChange={event => setSort(event.target.value as SortMode)} className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="created">最近收藏</option><option value="used">最近使用</option><option value="popular">使用最多</option><option value="rating">评分最高</option></select>
        </div>

        {selectedIds.size > 0 && <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/70 md:px-5">
          <b className="mr-1 text-sm text-indigo-800 dark:text-indigo-200">已选 {selectedIds.size} 项</b>
          <select defaultValue="" onChange={event => { if (event.target.value) void runBulkUpdate({ boardId: event.target.value === '__none' ? '' : event.target.value }, '已移动到灵感板'); event.target.value = ''; }} className="h-9 rounded-lg border border-indigo-200 bg-white px-2 text-xs dark:border-indigo-800 dark:bg-gray-900"><option value="" disabled>移动到…</option><option value="__none">未整理</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
          <div className="flex h-9 overflow-hidden rounded-lg border border-indigo-200 bg-white dark:border-indigo-800 dark:bg-gray-900"><input value={bulkTag} onChange={event => setBulkTag(event.target.value)} placeholder="添加标签" className="w-28 bg-transparent px-2 text-xs outline-none" /><button type="button" onClick={() => void addBulkTags()} className="border-l border-indigo-200 px-2 text-xs font-bold text-indigo-600 dark:border-indigo-800">添加</button></div>
          <button type="button" onClick={() => void runBulkUpdate({ isPinned: !allSelectedPinned }, allSelectedPinned ? '已取消置顶' : '已置顶')} className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold dark:border-indigo-800 dark:bg-gray-900">{allSelectedPinned ? '取消置顶' : '置顶'}</button>
          <button type="button" onClick={() => void runBulkUpdate({ archived: !allSelectedArchived }, allSelectedArchived ? '已恢复' : '已归档')} className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold dark:border-indigo-800 dark:bg-gray-900">{allSelectedArchived ? '恢复' : '归档'}</button>
          <button type="button" onClick={() => void deleteSelected()} className="ml-auto h-9 rounded-lg bg-red-600 px-3 text-xs font-bold text-white"><Trash2 className="mr-1 inline h-3.5 w-3.5" />删除</button>
        </div>}

        <div className="flex items-center justify-between px-3 pb-2 pt-4 md:px-5"><div><h2 className="text-base font-black text-gray-950 dark:text-white">{activeTitle}</h2><p className="mt-0.5 text-xs text-gray-400">{filtered.length} 条结果 · 当前结果立即请求缩略图，不再分批等待</p></div>{(search || boardId || tagFilter || ratingFilter) && <button type="button" onClick={() => { setSearch(''); setBoardId(''); setTagFilter(''); setRatingFilter(0); setCollection('all'); }} className="text-xs font-bold text-indigo-600">清除筛选</button>}</div>

        {filtered.length > 0 ? <div className={`${mobileGalleryClassName(imageDisplay)} p-3 md:grid-cols-3 md:p-5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6`} style={mobileGalleryStyle(imageDisplay)}>
          {filtered.map(item => {
            const SourceIcon = sourceIcon(item.sourceType); const selected = selectedIds.has(item.id);
            return <MediaCardShell key={item.id} selected={selected} className="group relative flex flex-col">
              <div className="mobile-gallery-frame relative overflow-hidden md:aspect-square" style={{ '--mobile-image-ratio': `${item.params?.width || 832} / ${item.params?.height || 1216}` } as React.CSSProperties}>
                <button type="button" onClick={() => selectedIds.size ? toggleSelected(item.id) : setDetail(item)} className="absolute inset-0 block h-full w-full text-left"><SmartImage src={item.imageUrl} alt={item.title} eager thumbnailVariant="thumb-320" /></button>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2"><span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur"><SourceIcon className="h-3 w-3" />{sourceLabel(item.sourceType)}</span>{item.isPinned && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white shadow"><Pin className="h-3.5 w-3.5 fill-current" /></span>}</div>
                <button type="button" onClick={() => toggleSelected(item.id)} className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur ${item.isPinned ? 'top-11' : ''} ${selected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/50 bg-black/35 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100'}`} aria-label="选择灵感">{selected ? <Check className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}</button>
                {item.archived && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45"><span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white">已归档</span></div>}
              </div>
              <button type="button" onClick={() => setDetail(item)} className="min-w-0 flex-1 p-3 text-left"><div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 truncate text-sm font-black text-gray-950 dark:text-white">{item.title}</h3>{(item.rating || 0) > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-500"><Star className="h-3 w-3 fill-current" />{item.rating}</span>}</div>{item.notes ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{item.notes}</p> : <p className="mt-1 truncate font-mono text-[10px] text-gray-400">{item.prompt || '尚未填写 Prompt'}</p>}{(item.tags || []).length > 0 && <div className="mt-2 flex gap-1 overflow-hidden">{item.tags?.slice(0, 3).map(tag => <span key={tag} className="max-w-24 truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">#{tag}</span>)}{(item.tags?.length || 0) > 3 && <span className="text-[9px] text-gray-400">+{(item.tags?.length || 0) - 3}</span>}</div>}<div className="mt-2 flex items-center justify-between text-[10px] text-gray-400"><span>{boards.find(board => board.id === item.boardId)?.name || '未整理'}</span><span>使用 {item.useCount || 0} 次</span></div></button>
            </MediaCardShell>;
          })}
        </div> : <div className="flex min-h-[45vh] flex-col items-center justify-center px-6 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 text-indigo-500 dark:bg-indigo-950/40"><Sparkles className="h-8 w-8" /></div><h3 className="mt-4 text-lg font-black text-gray-900 dark:text-white">这里还没有匹配的灵感</h3><p className="mt-2 max-w-sm text-sm text-gray-500">从生成历史快速收藏，再在这里补充板、标签和备注；也可以直接上传参考图。</p><button type="button" onClick={() => setUploadOpen(true)} className="mt-5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">加入第一条灵感</button></div>}
      </main>
    </div>

    {boardEditor && <div className="fixed inset-0 z-[1060] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setBoardEditor(null)}><div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-900" onClick={event => event.stopPropagation()}><h2 className="text-lg font-black">{boardEditor.id ? '编辑灵感板' : '新建灵感板'}</h2><input autoFocus value={boardEditor.name} onChange={event => setBoardEditor({ ...boardEditor, name: event.target.value })} placeholder="例如：电影感光影" className="mt-4 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950" /><div className="mt-4 flex gap-2">{BOARD_COLORS.map(color => <button key={color} type="button" onClick={() => setBoardEditor({ ...boardEditor, color })} className={`h-8 w-8 rounded-full transition ${boardEditor.color === color ? 'ring-2 ring-offset-2 dark:ring-offset-gray-900' : ''}`} style={{ backgroundColor: color }} aria-label={`颜色 ${color}`} />)}</div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setBoardEditor(null)} className="h-10 rounded-xl px-4 text-sm font-bold text-gray-500">取消</button><button type="button" disabled={!boardEditor.name.trim() || busy === 'board'} onClick={() => void saveBoard()} className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-40">保存</button></div></div></div>}

    {uploadOpen && <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-5" onClick={() => setUploadOpen(false)}><div className="h-[100dvh] w-full max-w-3xl overflow-y-auto bg-white p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl dark:bg-gray-900 md:h-auto md:max-h-[92vh] md:rounded-3xl md:p-6" onClick={event => event.stopPropagation()}><header className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-500">手动收录</p><h2 className="text-xl font-black">加入灵感库</h2></div><IconButton label="关闭" onClick={() => setUploadOpen(false)}><X /></IconButton></header><div className="mt-5 grid gap-5 md:grid-cols-[260px_1fr]"><button type="button" onClick={() => fileInputRef.current?.click()} className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">{uploadPreview ? <img src={uploadPreview} alt="上传预览" className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-2 text-sm font-bold text-gray-400"><Upload className="h-7 w-7" />选择图片<span className="text-[10px] font-normal">PNG / JPEG / WebP，最多 12 MB</span></span>}</button><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void chooseFile(event.target.files?.[0])} /><div className="space-y-3"><label><span className="mb-1 block text-xs font-bold text-gray-500">标题</span><input value={uploadDraft.title} onChange={event => setUploadValue('title', event.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950" /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block text-xs font-bold text-gray-500">灵感板</span><select value={uploadDraft.boardId} onChange={event => setUploadValue('boardId', event.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950"><option value="">未整理</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label><label><span className="mb-1 block text-xs font-bold text-gray-500">标签</span><input value={uploadDraft.tags} onChange={event => setUploadValue('tags', event.target.value)} placeholder="构图, 光影" className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950" /></label></div><label><span className="mb-1 block text-xs font-bold text-gray-500">备注</span><textarea value={uploadDraft.notes} onChange={event => setUploadValue('notes', event.target.value)} className="min-h-20 w-full rounded-xl border border-gray-300 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-950" /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">正面 Prompt</span><textarea value={uploadDraft.prompt} onChange={event => setUploadValue('prompt', event.target.value)} className="min-h-24 w-full rounded-xl border border-gray-300 bg-white p-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-950" /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">负面 Prompt</span><textarea value={uploadDraft.negativePrompt} onChange={event => setUploadValue('negativePrompt', event.target.value)} className="min-h-16 w-full rounded-xl border border-gray-300 bg-white p-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-950" /></label></div></div><footer className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setUploadOpen(false)} className="h-11 rounded-xl px-5 text-sm font-bold text-gray-500">取消</button><button type="button" disabled={!uploadFile || !uploadDraft.title.trim() || busy === 'upload'} onClick={() => void upload()} className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white disabled:opacity-40">{busy === 'upload' ? '正在保存…' : '加入灵感库'}</button></footer></div></div>}

    {detail && <InspirationDetail item={detail} items={items} boards={boards} currentUser={currentUser} chains={chains} notify={notify} onClose={() => setDetail(null)} onRefresh={onRefresh} onNavigateToPlayground={onNavigateToPlayground} onCreateArtistChain={onCreateArtistChain} onSetChainCover={onSetChainCover} onOpenItem={setDetail} />}
  </div>;
};
