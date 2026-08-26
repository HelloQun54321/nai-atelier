import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CircleUserRound, ExternalLink, FlaskConical, Heart, KeyRound, LogIn, RefreshCw, Search, Unplug, X } from 'lucide-react';
import { db } from '../services/dbService';
import { createUuid } from '../services/id';
import { IMPORT_SESSION_KEY, PendingImportData } from '../services/metadataService';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { NAIParams, User } from '../types';
import { IconButton, MediaCardShell, ToolbarButton, ToolbarLink, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel, DetailImageStage, TagChipGroup } from './DetailPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { SmartImage } from './SmartImage';
import {
  PixivConnectionStatus,
  PixivLoginError,
  PixivLoginState,
  PixivLoginStatus,
  PixivFeedMode,
  PixivIllust,
  buildPixivMediaUrl,
  buildPixivPreviewMediaUrl,
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

const PIXIV_LOGIN_ACTIVE = new Set<PixivLoginState>(['starting', 'awaiting-user', 'exchanging']);
const PIXIV_LOGIN_TERMINAL = new Set<PixivLoginState>(['connected', 'failed', 'canceled', 'timed-out']);
const PIXIV_LOGIN_SESSION_KEY = 'pixiv-login-session-id';
const isActiveLoginState = (state?: PixivLoginState) => Boolean(state && PIXIV_LOGIN_ACTIVE.has(state));

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
  const [loginSession, setLoginSession] = useState<PixivLoginStatus | null>(null);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [lanMode, setLanMode] = useState(false);
  const loadedRef = useRef(false);
  const feedRequestRef = useRef(0);
  const loginSessionRef = useRef<PixivLoginStatus | null>(null);
  const loginPollRef = useRef<number | null>(null);

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

  const clearLoginPoll = () => {
    if (loginPollRef.current !== null) {
      window.clearInterval(loginPollRef.current);
      loginPollRef.current = null;
    }
  };

  const applyLoginSession = (next: PixivLoginStatus | null) => {
    loginSessionRef.current = next;
    setLoginSession(next);
    if (!next) return;
    if (next.state === 'connected') {
      window.sessionStorage.removeItem(PIXIV_LOGIN_SESSION_KEY);
      return;
    }
    if (PIXIV_LOGIN_TERMINAL.has(next.state)) {
      window.sessionStorage.removeItem(PIXIV_LOGIN_SESSION_KEY);
      clearLoginPoll();
      setLoginMessage(next.message || (next.state === 'canceled' ? '已取消登录' : next.state === 'timed-out' ? '登录超时，请重试' : '登录失败，请重试'));
    }
  };

  const pollLogin = async (sessionId: string) => {
    try {
      const next = await pixivService.getPixivLoginStatus(sessionId);
      if (next.state === 'connected') {
        clearLoginPoll();
        window.sessionStorage.removeItem(PIXIV_LOGIN_SESSION_KEY);
        loginSessionRef.current = null;
        setLoginSession(null);
        setLoginMessage('');
        loadedRef.current = false;
        setItems([]);
        setNextCursor(null);
        await refreshStatus();
        void loadFeed('recommended', {});
        notify('Pixiv 登录成功');
      } else {
        applyLoginSession(next);
      }
    } catch (pollError) {
      clearLoginPoll();
      setLoginMessage(pollError instanceof Error ? pollError.message : '无法读取登录状态');
    }
  };

  const startLoginPolling = (sessionId: string) => {
    clearLoginPoll();
    loginPollRef.current = window.setInterval(() => {
      void pollLogin(sessionId);
    }, 1000);
  };

  const detectLanMode = async () => {
    try {
      const response = await fetch('/api/lan/status', { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json() as { required?: boolean };
      setLanMode(result.required === true);
    } catch {
      // 本机访问时不需要局域网密码，保持默认
    }
  };

  const handleStartLogin = async () => {
    if (loginBusy || lanMode || isActiveLoginState(loginSessionRef.current?.state)) return;
    setLoginBusy(true);
    setLoginMessage('');
    setCallbackUrl('');
    try {
      const session = await pixivService.startPixivLogin();
      window.sessionStorage.setItem(PIXIV_LOGIN_SESSION_KEY, session.id);
      applyLoginSession(session);
      if (isActiveLoginState(session.state)) startLoginPolling(session.id);
    } catch (startError) {
      const code = (startError as PixivLoginError).code;
      if (code === 'PIXIV_CONNECT_LOCAL_ONLY') {
        setLanMode(true);
        setLoginMessage('请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览');
      } else {
        setLoginMessage(startError instanceof Error ? startError.message : '登录启动失败');
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCompleteLogin = async (event: FormEvent) => {
    event.preventDefault();
    const session = loginSessionRef.current;
    const value = callbackUrl.trim();
    if (!session || !value || loginBusy) return;
    setLoginBusy(true);
    setLoginMessage('');
    try {
      const completed = await pixivService.completePixivLogin(session.id, value);
      if (completed.state !== 'connected') {
        applyLoginSession(completed);
        return;
      }
      clearLoginPoll();
      window.sessionStorage.removeItem(PIXIV_LOGIN_SESSION_KEY);
      loginSessionRef.current = null;
      setLoginSession(null);
      setCallbackUrl('');
      loadedRef.current = false;
      setItems([]);
      setNextCursor(null);
      await refreshStatus();
      notify('Pixiv 登录成功');
    } catch (completeError) {
      setLoginMessage(completeError instanceof Error ? completeError.message : '无法完成 Pixiv 登录');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCancelLogin = async () => {
    const session = loginSessionRef.current;
    if (!session || loginBusy) return;
    clearLoginPoll();
    setLoginMessage('');
    try {
      applyLoginSession(await pixivService.cancelPixivLogin(session.id));
    } catch (cancelError) {
      const code = (cancelError as PixivLoginError).code;
      if (code === 'PIXIV_CONNECT_LOCAL_ONLY') {
        setLanMode(true);
        setLoginMessage('请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览');
      } else {
        setLoginMessage(cancelError instanceof Error ? cancelError.message : '取消失败，请稍后重试');
      }
    }
  };

  useEffect(() => {
    if (active) {
      void refreshStatus();
      void detectLanMode();
      const savedId = window.sessionStorage.getItem(PIXIV_LOGIN_SESSION_KEY);
      if (savedId) {
        applyLoginSession({ id: savedId, state: 'awaiting-user', message: '正在等待登录…', expiresAt: Date.now() + 5 * 60 * 1000 });
        startLoginPolling(savedId);
      }
    } else {
      clearLoginPoll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => { clearLoginPoll(); }, []);

  // 下一页 feed 投机预取：当前页稳定后用 nextCursor 后台请求下一页（网关对 feed
  // 响应自动预热缩略图，等于 JSON 和图片一起备好）；点"加载更多"/触底时直接消费。
  const nextFeedPrefetchRef = useRef<{ mode: PixivFeedMode; cursor: string; promise: Promise<Awaited<ReturnType<typeof pixivService.feed>> | null> } | null>(null);

  const scheduleFeedPrefetch = (feedMode: PixivFeedMode, cursor: string | null | undefined, word: string, userId?: string) => {
    if (!cursor) return;
    const existing = nextFeedPrefetchRef.current;
    if (existing && existing.mode === feedMode && existing.cursor === cursor) return;
    const params: Record<string, string> = {};
    if (feedMode === 'search' && word) params.word = word;
    if (feedMode === 'user' && userId) params.user_id = userId;
    nextFeedPrefetchRef.current = {
      mode: feedMode,
      cursor,
      promise: pixivService.feed(feedMode, { cursor, params }).catch(() => null),
    };
  };

  const consumeFeedPrefetch = (feedMode: PixivFeedMode, cursor: string) => {
    const prefetch = nextFeedPrefetchRef.current;
    if (!prefetch || prefetch.mode !== feedMode || prefetch.cursor !== cursor) return null;
    nextFeedPrefetchRef.current = null;
    return prefetch.promise;
  };

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
      // 命中投机预取（同模式同游标）直接消费；预取失败（null）回退正常请求
      const prefetched = options.cursor ? await consumeFeedPrefetch(nextMode, options.cursor) : null;
      const result = prefetched || await pixivService.feed(nextMode, { cursor: options.cursor, params });
      if (requestId !== feedRequestRef.current) return;
      setMode(nextMode);
      setItems(previous => (options.cursor ? [...previous, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
      scheduleFeedPrefetch(nextMode, result.nextCursor, options.word || searchInput, options.user?.id);
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

  // 滚动接近列表底部时自动加载下一页（追加模式无限滚动）；按钮保留作兜底。
  const autoLoadSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = autoLoadSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !nextCursor || loadingMore) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { root, rootMargin: '1200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // loadMore 的闭包随 nextCursor/loadingMore/mode/searchInput 重建，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMore, mode, searchInput]);

  const openAuthorWorks = (userId: string, userName: string) => {
    void loadFeed('user', { user: { id: userId, name: userName } });
  };

  const openDetail = (illust: PixivIllust) => {
    setSelectedId(illust.id);
    setSelectedPage(0);
  };

  // 瀑布流（masonry 布局时）：图片按真实宽高比完整显示，最短列分配互相补齐。
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const getIllustRatio = (illust: PixivIllust) => {
    const ratio = Number(illust.width) / Math.max(1, Number(illust.height) || 1);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
  };
  const estimatePixivCardHeight = React.useCallback((illust: PixivIllust, columnWidth: number) => {
    const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, getIllustRatio(illust));
    return imageHeight + 52; // 标题 + 作者文本区
  }, []);
  const renderPixivCard = (illust: PixivIllust) => {
    const title = illust.title || `Pixiv #${illust.id}`;
    const ratio = `${illust.width || 3} / ${illust.height || 4}`;
    // 缩略图源优先 medium（540px，保持真实比例）：卡片显示宽度约 320px，
    // medium 仍是缩小显示不损清晰度，而 large（~1200px master，单张 0.3-1.5MB）
    // 会让每张封面的上游流量放大 5-10 倍。square 档是方形裁切版，仅作最后回退。
    // 原图不在卡片上升级加载——点开详情才加载原图（详情页自带 preview→original 链）。
    const previewSrc = illust.urls.medium || illust.urls.large || illust.urls.thumb;
    return <MediaCardShell key={illust.id} data-safe-mode-work="true" selected={selectedId === illust.id} className="mobile-gallery-item group relative flex-col">
      <button type="button" onClick={() => openDetail(illust)} className="block w-full text-left">
        <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}>
          <SmartImage
            src={previewSrc}
            alt={title}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-[10px] text-white">
            <span>♥ {formatCount(illust.totalBookmarks)}</span>
            {illust.pageCount > 1 && <span>{illust.pageCount} 页</span>}
          </div>
        </div>
        <div className="p-2.5">
          <p data-safe-mode-title="true" className="truncate text-xs font-bold">{title}</p>
          <p className="mt-1 truncate text-[10px] text-gray-500">{illust.user.name || `Pixiv #${illust.id}`}</p>
        </div>
      </button>
    </MediaCardShell>;
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
    const activeLogin = loginSession && isActiveLoginState(loginSession.state) ? loginSession : null;
    const waiting = Boolean(activeLogin) || loginBusy;
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
        <WorkspaceToolbar>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">Pixiv 图库</div>
          <IconButton label="重新检查连接状态" onClick={() => void refreshStatus()}><RefreshCw /></IconButton>
        </WorkspaceToolbar>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
              <KeyRound className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="text-center text-base font-black text-gray-800 dark:text-gray-100">Pixiv 图库</h2>
            <p className="mb-4 mt-1 text-center text-xs leading-relaxed text-gray-500">使用你平时的默认浏览器打开 Pixiv，保留已有的 Google、Pixiv 登录状态；账号密码只输入 Pixiv 官方页面。</p>

            {lanMode ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">请在运行 NAI Atelier 的电脑上登录；登录后手机可浏览</div>
            ) : (
              <ToolbarButton type="button" tone="primary" className="h-12 w-full text-base" disabled={waiting} onClick={() => void handleStartLogin()}>
                {waiting ? <><RefreshCw className="animate-spin" />等待完成…</> : <><LogIn />在默认浏览器登录</>}
              </ToolbarButton>
            )}

            {activeLogin && (
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                  {activeLogin.automaticCallback ? (
                    <>
                      <div className="font-bold">请在默认浏览器点击“继续使用此账号”</div>
                      <div className="mt-1">登录完成后保持白页片刻，NAI Atelier 会自动识别并完成连接。</div>
                    </>
                  ) : (
                    <div>{activeLogin.message || '当前无法自动识别登录结果'}</div>
                  )}
                </div>
                {!activeLogin.automaticCallback && (
                  <form onSubmit={handleCompleteLogin} className="space-y-2">
                    <input
                      type="text"
                      autoComplete="off"
                      value={callbackUrl}
                      onChange={event => setCallbackUrl(event.target.value)}
                      placeholder="备用：粘贴官方 callback 地址"
                      aria-label="Pixiv 登录完成地址"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs text-gray-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-indigo-500 dark:focus:bg-gray-900"
                    />
                    <ToolbarButton type="submit" tone="primary" className="w-full" disabled={!callbackUrl.trim() || loginBusy}><LogIn />完成连接</ToolbarButton>
                  </form>
                )}
                <ToolbarButton type="button" tone="danger" className="w-full" disabled={loginBusy} onClick={() => void handleCancelLogin()}><X />取消登录</ToolbarButton>
              </div>
            )}

            {loginMessage && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{loginMessage}</div>}
            {statusError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{statusError}</div>}

            <details className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700">
              <summary className="cursor-pointer select-none rounded-xl px-3 py-2 text-[11px] font-bold text-gray-500 hover:text-indigo-600 dark:text-gray-400">高级：手动连接</summary>
              <form onSubmit={handleConnect} className="border-t border-gray-100 p-3 dark:border-gray-800">
                <p className="mb-3 text-[11px] leading-relaxed text-gray-500">备用方式：粘贴 Pixiv App 的 refresh token。Token 仅以加密形式保存在本机 local-data，操作完成后立即清空。</p>
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
              </form>
            </details>
          </div>
          <p className="mt-4 max-w-sm text-center text-[11px] leading-relaxed text-gray-400">Pixiv 图库仅在本机媒体网关可用；推荐、搜索与榜单接口返回的内容原样展示，不做年龄分级过滤。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar>
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
            imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                items={items}
                columns={masonryColumns}
                getItemKey={illust => illust.id}
                estimateItemHeight={estimatePixivCardHeight}
                renderItem={renderPixivCard}
              />
            ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {items.map(renderPixivCard)}
            </div>
            )
          ) : !loading && <div className="flex min-h-72 flex-col items-center justify-center text-center text-sm text-gray-500"><p className="font-bold">没有找到作品</p><p className="mt-1 text-xs">请尝试其他关键词或榜单。</p></div>}

          {nextCursor && <div className="mt-5 flex items-center justify-center gap-3 pb-4">
            <ToolbarButton disabled={loadingMore} onClick={() => void loadMore()}><RefreshCw className={loadingMore ? 'animate-spin' : ''} />加载更多</ToolbarButton>
            <div ref={autoLoadSentinelRef} className="h-4 w-full max-w-40" aria-hidden="true" />
          </div>}
        </main>

        <DetailSidePanel
          open={Boolean(selected)}
          title={selected ? selected.title : '作品详情'}
          sensitiveTitle
          subInfo={selected ? `Pixiv #${selected.id} · ${selected.width}×${selected.height} · ${currentPageCount} 页` : undefined}
          onBack={closeMobileDetail}
          onClose={() => setSelectedId(null)}
        >
          {selected ? <div className="space-y-4">
            <DetailImageStage pager={{ page: selectedPage, count: currentPageCount, onPrev: () => setSelectedPage(value => Math.max(0, value - 1)), onNext: () => setSelectedPage(value => Math.min(currentPageCount - 1, value + 1)) }}>
              <SmartImage
                eager
                src={buildPixivPreviewMediaUrl(selected, selectedPage)}
                upgradeSrc={buildPixivMediaUrl(selected, selectedPage, 'original')}
                upgradeVariant="original"
                alt={`${selected.title} 第 ${selectedPage + 1} 页`}
                className="max-h-[62vh] w-full object-contain"
              />
            </DetailImageStage>
            {selected.type === 'ugoira' && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">动图（ugoira）：这里展示首帧，动画请到 Pixiv 查看。</div>}
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>♥ {formatCount(selected.totalBookmarks)}</span>
              <span>浏览 {formatCount(selected.totalViews)}</span>
              <span>{selected.user.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ToolbarButton tone="primary" onClick={() => importToPlayground(selected)}><FlaskConical />导入实验室</ToolbarButton>
              <ToolbarButton disabled={saving} onClick={() => void saveToInspiration(selected)}><Heart />{saving ? '保存中…' : '加入灵感库'}</ToolbarButton>
              <ToolbarButton onClick={() => openAuthorWorks(selected.user.id, selected.user.name)}><CircleUserRound />作者作品</ToolbarButton>
              <ToolbarLink href={pixivArtworkUrl(selected)} target="_blank" rel="noreferrer"><ExternalLink />打开 Pixiv</ToolbarLink>
            </div>
            <div className="flex items-center gap-2">
              <ImageTaggerAction notify={notify} imageUrl={buildPixivMediaUrl(selected, selectedPage, 'original')} actionLabel="复制 {count} 个 Tag" />
              <span className="text-[11px] text-gray-500">反推当前页图片（本地识别）</span>
            </div>
            {selected.tags.length > 0 && <section>
              <h3 className="mb-2 text-xs font-black text-gray-700 dark:text-gray-200">标签 · {selected.tags.length}</h3>
              <TagChipGroup chips={selected.tags.map(tag => ({ label: tag, onClick: () => { setSearchInput(tag); void loadFeed('search', { word: tag }); } }))} />
            </section>}
          </div> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">选择一张作品后查看图片、分页和导入操作。</div>}
        </DetailSidePanel>
      </div>
    </div>
  );
};
