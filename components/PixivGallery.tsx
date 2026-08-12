import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleUserRound, ExternalLink, FlaskConical, Heart, KeyRound, RefreshCw, Search, Unplug, X } from 'lucide-react';
import { db } from '../services/dbService';
import { createUuid } from '../services/id';
import { IMPORT_SESSION_KEY, PendingImportData } from '../services/metadataService';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { NAIParams, User } from '../types';
import { IconButton, MediaCardShell, ToolbarButton, ToolbarLink, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { useMobileHistoryLayer } from './MobileUI';
import { OriginalImage, SmartImage } from './SmartImage';
import {
  PixivConnectionStatus,
  PixivFeedMode,
  PixivIllust,
  buildPixivMediaUrl,
  getPixivCurrentPageUrl,
  importPixivImageAsDataUrl,
  pixivArtworkUrl,
  pixivPageCount,
  pixivService,
} from '../services/pixivService';

interface PixivGalleryProps {
  active: boolean;
  currentUser: User;
  notify: (message: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onRefreshInspiration?: () => void;
}

const defaultParams: NAIParams = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
  useCoords: false,
  variety: false,
  cfgRescale: 0,
};

const feedTabs: { id: PixivFeedMode; label: string }[] = [
  { id: 'recommended', label: '推荐' },
  { id: 'day', label: '日榜' },
  { id: 'week', label: '周榜' },
  { id: 'month', label: '月榜' },
  { id: 'search', label: '搜索' },
];

const formatCount = (value: number) => new Intl.NumberFormat('zh-CN', {
  notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value);

export const PixivGallery: React.FC<PixivGalleryProps> = ({ active, currentUser, notify, onNavigateToPlayground, onRefreshInspiration }) => {
  const imageDisplay = useMobileImageDisplayPreferences();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PixivConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<PixivFeedMode>('recommended');
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState<PixivIllust[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [userContext, setUserContext] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const loadedRef = useRef(false);
  const feedRequestRef = useRef(0);

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId]);
  const closeMobileDetail = useMobileHistoryLayer(Boolean(selected), () => setSelectedId(null), 'pixiv-detail');
  const connected = Boolean(status?.connected);

  const refreshStatus = async () => {
    try {
      const next = await pixivService.status();
      setStatus(next);
      setStatusError('');
      if (next.connected && !loadedRef.current) void loadFeed('recommended', {});
    } catch (statusFailure) {
      setStatusError(statusFailure instanceof Error ? statusFailure.message : '无法读取 Pixiv 状态');
    }
  };

  useEffect(() => {
    if (active) void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const loadFeed = async (nextMode: PixivFeedMode, options: { cursor?: string; word?: string; user?: { id: string; name: string } } = {}) => {
    const requestId = ++feedRequestRef.current;
    if (options.cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const params: Record<string, string> = {};
      if (nextMode === 'search') params.word = options.word || searchInput;
      if (nextMode === 'user' && options.user) params.user_id = options.user.id;
      const result = await pixivService.feed(nextMode, { cursor: options.cursor, params });
      if (requestId !== feedRequestRef.current) return;
      setMode(nextMode);
      setItems(previous => (options.cursor ? [...previous, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
      if (!options.cursor) setUserContext(options.user || null);
      loadedRef.current = true;
      if (!options.cursor) {
        setSelectedId(current => (result.items.some(item => item.id === current) ? current : null));
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
      }
    } catch (loadError) {
      if (requestId !== feedRequestRef.current) return;
      const message = loadError instanceof Error ? loadError.message : 'Pixiv 加载失败';
      setError(message);
      notify(message, 'error');
    } finally {
      if (requestId === feedRequestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const submitSearch = (event?: FormEvent) => {
    event?.preventDefault();
    const word = searchInput.trim();
    if (!word) {
      notify('请输入 Pixiv 标签', 'error');
      return;
    }
    void loadFeed('search', { word });
  };

  const switchTab = (tab: PixivFeedMode) => {
    if (tab === mode && items.length) return;
    if (tab === 'search') {
      if (searchInput.trim()) void loadFeed('search', { word: searchInput.trim() });
      else {
        feedRequestRef.current += 1;
        setMode('search');
        setItems([]);
        setNextCursor(null);
        setSelectedId(null);
        setUserContext(null);
        setLoading(false);
        setLoadingMore(false);
      }
      return;
    }
    void loadFeed(tab, {});
  };

  const refreshCurrent = () => {
    if (mode === 'user' && userContext) void loadFeed('user', { user: userContext });
    else if (mode === 'search') void loadFeed('search', { word: searchInput });
    else void loadFeed(mode, {});
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    void loadFeed(mode, { cursor: nextCursor, ...(mode === 'search' ? { word: searchInput } : {}) });
  };

  const openAuthorWorks = (userId: string, userName: string) => {
    void loadFeed('user', { user: { id: userId, name: userName } });
  };

  const openDetail = (illust: PixivIllust) => {
    setSelectedId(illust.id);
    setSelectedPage(0);
  };

  const handleConnect = async (event: FormEvent) => {
    event.preventDefault();
    if (!refreshToken.trim()) {
      notify('请输入 Pixiv refresh token', 'error');
      return;
    }
    setConnecting(true);
    try {
      await pixivService.connect(refreshToken.trim());
      notify('Pixiv 已连接');
      loadedRef.current = false;
      setItems([]);
      setNextCursor(null);
      await refreshStatus();
    } catch (connectError) {
      notify(connectError instanceof Error ? connectError.message : '连接 Pixiv 失败', 'error');
    } finally {
      setRefreshToken('');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    feedRequestRef.current += 1;
    try {
      await pixivService.disconnect();
      setStatus(previous => (previous ? { ...previous, connected: false } : previous));
      setItems([]);
      setNextCursor(null);
      setSelectedId(null);
      setUserContext(null);
      setRefreshToken('');
      loadedRef.current = false;
      notify('已断开 Pixiv');
    } catch (disconnectError) {
      notify(disconnectError instanceof Error ? disconnectError.message : '断开 Pixiv 失败', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const importToPlayground = (illust: PixivIllust) => {
    const pending: PendingImportData = {
      prompt: illust.tags.join(', '),
      negativePrompt: '',
      params: defaultParams,
      mode: 'append-prompt',
    };
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(pending));
    notify('Pixiv 标签已送往实验室');
    onNavigateToPlayground();
  };

  const saveToInspiration = async (illust: PixivIllust) => {
    if (saving) return;
    setSaving(true);
    try {
      const pageUrl = getPixivCurrentPageUrl(illust, selectedPage);
      const imageUrl = await importPixivImageAsDataUrl(pageUrl);
      await db.saveInspiration({
        id: createUuid(),
        userId: currentUser.id,
        username: currentUser.username,
        title: illust.title || `Pixiv #${illust.id}`,
        imageUrl,
        prompt: illust.tags.join(', '),
        tags: ['Pixiv', ...illust.tags.slice(0, 8)],
        sourceType: 'pixiv',
        sourceId: illust.id,
        sourceUrl: pixivArtworkUrl(illust),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onRefreshInspiration?.();
      notify('已加入灵感库');
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const currentPageCount = selected ? pixivPageCount(selected) : 1;
  const headerText = mode === 'user' && userContext
    ? `画师：${userContext.name}`
    : mode === 'search'
      ? `搜索：${searchInput || 'Pixiv'}`
      : feedTabs.find(tab => tab.id === mode)?.label || 'Pixiv';

  if (!connected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
        <WorkspaceToolbar>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">Pixiv 图库</div>
          <IconButton label="重新检查连接状态" onClick={() => void refreshStatus()}><RefreshCw /></IconButton>
        </WorkspaceToolbar>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <form onSubmit={handleConnect} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              <h2 className="text-sm font-black text-gray-800 dark:text-gray-100">连接 Pixiv</h2>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-gray-500">输入 Pixiv App 的 refresh token。Token 仅以加密形式保存在本机 local-data，页面只在内存中临时持有，操作完成后立即清空。</p>
            <label className="mb-1 block text-[11px] font-bold text-gray-500 dark:text-gray-400" htmlFor="pixiv-refresh-token">Refresh token</label>
            <input
              id="pixiv-refresh-token"
              type="password"
              autoComplete="off"
              value={refreshToken}
              onChange={event => setRefreshToken(event.target.value)}
              placeholder="粘贴 refresh token"
              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-500 dark:focus:bg-gray-900"
            />
            <ToolbarButton type="submit" tone="primary" disabled={connecting} className="mt-3 w-full"><KeyRound />{connecting ? '连接中…' : '连接'}</ToolbarButton>
            {statusError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{statusError}</div>}
          </form>
          <p className="mt-4 max-w-sm text-center text-[11px] leading-relaxed text-gray-400">Pixiv 图库仅在本机媒体网关可用；推荐、搜索与榜单接口返回的内容原样展示，不做年龄分级过滤。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar className="relative z-20">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {feedTabs.map(tab => (
              <button key={tab.id} type="button" onClick={() => switchTab(tab.id)} className={`flex-none rounded-xl px-3 py-2 text-xs font-bold transition ${mode === tab.id ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'}`}>{tab.label}</button>
            ))}
            {userContext && <button type="button" onClick={() => void loadFeed('recommended', {})} className="flex-none rounded-xl px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300">返回推荐</button>}
          </div>
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
            <ToolbarSearch value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Pixiv 标签搜索" aria-label="搜索 Pixiv" />
            <ToolbarButton type="submit" tone="primary" disabled={loading}><Search />搜索</ToolbarButton>
          </form>
        </div>
        <IconButton label="刷新当前列表" onClick={() => void refreshCurrent()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /></IconButton>
        <IconButton label="断开 Pixiv 连接" tone="danger" onClick={() => void handleDisconnect()}><Unplug /></IconButton>
      </WorkspaceToolbar>

      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main ref={scrollRef} className={`${selected ? 'hidden xl:block' : 'block'} min-h-0 overflow-y-auto p-3 md:p-5`}>
          <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
            <span>{headerText}</span>
            <span>{items.length} 件作品{nextCursor ? ' · 可加载更多' : ''}</span>
          </div>

          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          {loading && !items.length ? <div className="flex min-h-72 items-center justify-center text-sm text-gray-400">正在读取 Pixiv…</div> : items.length ? (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {items.map(illust => {
                const title = illust.title || `Pixiv #${illust.id}`;
                return <MediaCardShell key={illust.id} selected={selectedId === illust.id} className="mobile-gallery-item group relative flex-col">
                  <button type="button" onClick={() => openDetail(illust)} className="block w-full text-left">
                    <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': '3 / 4' } as React.CSSProperties}>
                      <SmartImage src={illust.urls.thumb} alt={title} thumbnailVariant="thumb-640" />
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-[10px] text-white">
                        <span>♥ {formatCount(illust.totalBookmarks)}</span>
                        {illust.pageCount > 1 && <span>{illust.pageCount} 页</span>}
                      </div>
                    </div>
                    <div className="p-2.5">
                      <p className="truncate text-xs font-bold">{title}</p>
                      <p className="mt-1 truncate text-[10px] text-gray-500">{illust.user.name || `Pixiv #${illust.id}`}</p>
                    </div>
                  </button>
                </MediaCardShell>;
              })}
            </div>
          ) : !loading && <div className="flex min-h-72 flex-col items-center justify-center text-center text-sm text-gray-500"><p className="font-bold">没有找到作品</p><p className="mt-1 text-xs">请尝试其他关键词或榜单。</p></div>}

          {nextCursor && <div className="mt-5 flex items-center justify-center gap-3 pb-4">
            <ToolbarButton disabled={loadingMore} onClick={() => void loadMore()}><RefreshCw className={loadingMore ? 'animate-spin' : ''} />加载更多</ToolbarButton>
          </div>}
        </main>

        <aside className={`aitag-detail-panel ${selected ? 'aitag-detail-panel--open flex' : 'aitag-detail-panel--closed hidden'} fixed inset-0 z-[1050] min-h-0 flex-col border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 xl:static xl:z-auto xl:border-l`}>
          <div className="flex h-14 flex-none items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="返回" onClick={closeMobileDetail} className="mobile-touch xl:hidden"><ArrowLeft /></IconButton>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{selected ? selected.title : '作品详情'}</p>
                {selected && <p className="truncate text-[10px] text-gray-500">Pixiv #{selected.id} · {selected.width}×{selected.height} · {currentPageCount} 页</p>}
              </div>
            </div>
            <IconButton label="关闭" onClick={() => setSelectedId(null)} className="hidden xl:inline-flex"><X /></IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected ? <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30">
                <OriginalImage src={buildPixivMediaUrl(selected, selectedPage, 'original')} alt={`${selected.title} 第 ${selectedPage + 1} 页`} className="max-h-[62vh] w-full object-contain" />
              </div>
              {currentPageCount > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <IconButton label="上一页" disabled={selectedPage <= 0} onClick={() => setSelectedPage(value => Math.max(0, value - 1))}><ChevronLeft /></IconButton>
                  <span className="text-xs font-bold text-gray-500">{selectedPage + 1} / {currentPageCount}</span>
                  <IconButton label="下一页" disabled={selectedPage >= currentPageCount - 1} onClick={() => setSelectedPage(value => Math.min(currentPageCount - 1, value + 1))}><ChevronRight /></IconButton>
                </div>
              )}
              {selected.type === 'ugoira' && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">动图（ugoira）：这里展示首帧，动画请到 Pixiv 查看。</div>}
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>♥ {formatCount(selected.totalBookmarks)}</span>
                <span>浏览 {formatCount(selected.totalViews)}</span>
                <span>{selected.user.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ToolbarButton tone="primary" onClick={() => importToPlayground(selected)}><FlaskConical />导入实验室</ToolbarButton>
                <ToolbarButton disabled={saving} onClick={() => void saveToInspiration(selected)}><Heart />{saving ? '保存中…' : '加入灵感'}</ToolbarButton>
                <ToolbarButton onClick={() => openAuthorWorks(selected.user.id, selected.user.name)}><CircleUserRound />作者作品</ToolbarButton>
                <ToolbarLink href={pixivArtworkUrl(selected)} target="_blank" rel="noreferrer"><ExternalLink />打开 Pixiv</ToolbarLink>
              </div>
              {selected.tags.length > 0 && <section>
                <h3 className="mb-2 text-xs font-black text-gray-700 dark:text-gray-200">标签 · {selected.tags.length}</h3>
                <div className="flex flex-wrap gap-1.5">{selected.tags.map(tag => <button key={tag} type="button" onClick={() => { setSearchInput(tag); void loadFeed('search', { word: tag }); }} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{tag}</button>)}</div>
              </section>}
            </div> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">选择一张作品后查看图片、分页和导入操作。</div>}
          </div>
        </aside>
      </div>
    </div>
  );
};
