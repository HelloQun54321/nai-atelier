import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import {
  DanbooruPost,
  DanbooruTagCategory,
  danbooruAllTags,
  danbooruPromptTags,
  danbooruService,
  resolveDanbooruQuery,
  buildDanbooruFilterQuery,
} from '../services/danbooruService';
import { db } from '../services/dbService';
import { api } from '../services/api';
import { importDanbooruCoverAsDataUrl } from '../services/danbooruCoverImport';
import { copyTagText as copyText, externalImageAnalysis, type ExternalImageTags } from '../services/externalImageTags';
import { createUuid } from '../services/id';
import { IMPORT_SESSION_KEY, PendingImportData } from '../services/metadataService';
import { Inspiration, NAIParams, User } from '../types';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useStaleGuard } from './useStaleGuard';
import { EmptyState, PageSpinner, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel, DetailImageStage, TagChipGroup } from './DetailPanel';
import { ExternalImageTools } from './ExternalImageTools';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { useMobileHistoryLayer } from './MobileUI';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { SmartImage } from './SmartImage';
import { ImageShareOverlay } from './ImageShareActions';
import { PressRevealSurface } from './PressRevealSurface';
import { ViewableImage } from './ImageLightbox';
import { buildMediaUrl, getMobileOriginalUrl, selectThumbnailVariant } from '../services/mobileImageCache';
import { createMediaPrewarmSession } from '../services/mediaPrewarm';
import { galleryHistoryService, GalleryHistoryItem } from '../services/galleryHistoryService';
import { Clock } from 'lucide-react';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { matchesDanbooruImageFilters } from '../services/danbooruQuery';

interface DanbooruGalleryProps {
  active: boolean;
  currentUser: User;
  notify: (message: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onRefreshInspiration?: () => void;
}

const PAGE_SIZE = 40;
/** 追加式自动加载的软上限：超过后停止自动追加，按钮可继续手动加载。 */
const DANBOORU_APPEND_LIMIT = 800;
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

const categoryLabels: Record<DanbooruTagCategory, string> = {
  artist: '画师',
  copyright: '作品',
  character: '角色',
  general: '普通',
  meta: '元数据',
};

const formatCount = (value: number) => new Intl.NumberFormat('zh-CN', {
  notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value);

type DanbooruSort = 'rank' | 'score' | 'favcount' | 'latest';
type DanbooruRating = 'all' | 'g' | 's' | 'q' | 'e';
type DanbooruRatio = 'all' | 'portrait' | 'landscape' | 'square';

export const DanbooruGallery: React.FC<DanbooruGalleryProps> = ({ active, currentUser, notify, onNavigateToPlayground, onRefreshInspiration }) => {
  const imageDisplay = useMobileImageDisplayPreferences();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('order:rank');
  const [sort, setSort] = useState<DanbooruSort>('rank');
  const [rating, setRating] = useState<DanbooruRating>('all');
  const [ratio, setRatio] = useState<DanbooruRatio>('all');
  const [soloOnly, setSoloOnly] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<GalleryHistoryItem[]>([]);
  const [items, setItems] = useState<DanbooruPost[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const onScrollRestore = useKeepAliveScrollRestore(scrollRef, 'danbooru', { trigger: selectedId });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageInput, setPageInput] = useState('');
  const loadedRef = useRef(false);
  // 追加模式状态：当前查询/页码的同步镜像（防并发与跳页竞态）。
  const queryRef = useRef(query);
  const pageRef = useRef(page);
  const appendingRef = useRef(false);
  const loadGuard = useStaleGuard();
  const loadSeqRef = useRef(0);
  const activeRef = useRef(active); activeRef.current = active;
  const requestController = useRef<AbortController | null>(null);
  const prewarm = useRef<ReturnType<typeof createMediaPrewarmSession> | null>(null);
  if (!prewarm.current) prewarm.current = createMediaPrewarmSession();
  const nextPagePrefetchRef = useRef<{ query: string; page: number; controller: AbortController; promise: Promise<Awaited<ReturnType<typeof danbooruService.search>> | null> } | null>(null);

  const scheduleNextPagePrefetch = (query: string, page: number, hasMore: boolean) => {
    if (!activeRef.current || !hasMore || showHistory) return;
    const existing = nextPagePrefetchRef.current;
    if (existing && existing.query === query && existing.page === page + 1) return;
    existing?.controller.abort();
    const controller = new AbortController();
    const seq = loadSeqRef.current;
    const promise = danbooruService.search({ query, page: page + 1, limit: PAGE_SIZE, signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || !activeRef.current || !loadGuard.isCurrent(seq)) return null;
        prewarmSources(result.items.map(item => item.sampleUrl), seq);
        return result;
      })
      .catch(() => null);
    nextPagePrefetchRef.current = { query, page: page + 1, controller, promise };
  };

  const consumeNextPagePrefetch = (query: string, page: number) => {
    const prefetch = nextPagePrefetchRef.current;
    if (!prefetch || prefetch.query !== query || prefetch.page !== page) return null;
    return prefetch.promise.finally(() => {
      if (nextPagePrefetchRef.current === prefetch) nextPagePrefetchRef.current = null;
    });
  };

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId]);
  const closeMobileDetail = useMobileHistoryLayer(Boolean(selected), () => setSelectedId(null), 'danbooru-detail');

  // 只预热下一页的前两行；当前屏幕由 SmartImage 的显示请求优先加载。
  const prewarmSources = (sources: string[], seq: number) => {
    requestAnimationFrame(() => {
      if (!activeRef.current || !loadGuard.isCurrent(seq)) return;
      const frame = scrollRef.current?.querySelector<HTMLElement>('.mobile-gallery-frame');
      const width = frame?.clientWidth || 160;
      const columns = Math.max(1, Math.round((scrollRef.current?.clientWidth || window.innerWidth) / width));
      const variant = selectThumbnailVariant(width * Math.max(1, window.devicePixelRatio || 1));
      prewarm.current?.enqueue(sources.filter(Boolean).slice(0, Math.min(18, columns * 2)), variant);
    });
  };
  const cancelBackground = () => {
    requestController.current?.abort();
    nextPagePrefetchRef.current?.controller.abort();
    nextPagePrefetchRef.current = null;
    prewarm.current?.cancel();
  };

  // 记录足迹
  useEffect(() => {
    if (selected) {
      galleryHistoryService.recordView({
        id: `danbooru:${selected.id}`,
        source: 'danbooru',
        sourceId: selected.id,
        title: selected.tags.character[0] || selected.tags.artist[0] || `#${selected.id}`,
        artistName: selected.tags.artist[0],
        previewUrl: selected.previewUrl,
        sampleUrl: selected.sampleUrl,
        tags: danbooruPromptTags(selected).split(', ').filter(Boolean),
        width: selected.width,
        height: selected.height,
        score: selected.score,
        bookmarks: selected.favCount,
      });
    }
  }, [selected]);

  const loadHistory = () => {
    loadSeqRef.current = loadGuard.begin();
    cancelBackground();
    setLoading(false);
    const history = galleryHistoryService.getHistory('danbooru');
    setHistoryItems(history);
    setShowHistory(true);
  };

  const beginLoad = () => {
    const seq = loadGuard.begin();
    loadSeqRef.current = seq;
    cancelBackground();
    requestController.current = new AbortController();
    setLoading(true);
    setError('');
    return seq;
  };

  const load = async (nextQuery = query, nextPage = page, mySeq = beginLoad()) => {
    setShowHistory(false);
    try {
      const result = await danbooruService.search({ query: nextQuery, page: nextPage, limit: PAGE_SIZE, signal: requestController.current?.signal });
      if (!activeRef.current || !loadGuard.isCurrent(mySeq)) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setQuery(result.query);
      setPage(result.page);
      queryRef.current = result.query;
      pageRef.current = result.page;
      setSelectedId(current => result.items.some(item => item.id === current) ? current : null);
      loadedRef.current = true;
      scheduleNextPagePrefetch(result.query, result.page, result.hasMore);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch (loadError) {
      if (!loadGuard.isCurrent(mySeq)) return;
      const message = loadError instanceof Error ? loadError.message : 'Danbooru 查询失败';
      setError(message);
      notify(message, 'error');
    } finally {
      // 过期的旧加载不得提前关掉新加载的 spinner（会重建触底哨兵、提前打开追加闸门）
      if (loadGuard.isCurrent(mySeq)) setLoading(false);
    }
  };

  const handleApplyFilter = async (overrides: {
    sort?: DanbooruSort;
    rating?: DanbooruRating;
    ratio?: DanbooruRatio;
    soloOnly?: boolean;
    inputVal?: string;
  } = {}) => {
    const s = overrides.sort !== undefined ? overrides.sort : sort;
    const r = overrides.rating !== undefined ? overrides.rating : rating;
    const rat = overrides.ratio !== undefined ? overrides.ratio : ratio;
    const solo = overrides.soloOnly !== undefined ? overrides.soloOnly : soloOnly;
    const term = overrides.inputVal !== undefined ? overrides.inputVal : input;
    // 序号覆盖翻译、下载及追加整个链路，慢词典响应也不得发起过期查询。
    const mySeq = beginLoad();
    setShowHistory(false);

    if (overrides.sort !== undefined) setSort(s);
    if (overrides.rating !== undefined) setRating(r);
    if (overrides.ratio !== undefined) setRatio(rat);
    if (overrides.soloOnly !== undefined) setSoloOnly(solo);

    try {
      const resolvedTag = term.trim() ? await resolveDanbooruQuery(term.trim()) : '';
      if (!loadGuard.isCurrent(mySeq)) return;
      const finalQuery = buildDanbooruFilterQuery({
        query: resolvedTag,
        sort: s,
        rating: r,
        ratio: rat,
        subject: solo ? 'solo' : 'all',
      });
      await load(finalQuery || 'order:rank', 1, mySeq);
    } catch (e: any) {
      if (!loadGuard.isCurrent(mySeq)) return;
      const message = e?.message || '筛选查询失败';
      setError(message);
      // 请求还未发出时保留原筛选，避免界面宣称已应用无效条件。
      setSort(sort); setRating(rating); setRatio(ratio); setSoloOnly(soloOnly);
      notify(message, 'error');
    } finally {
      if (loadGuard.isCurrent(mySeq)) setLoading(false);
    }
  };

  // 排行榜与名额不足的 solo 查询在本地筛选；边界与普通搜索的上游条件一致。
  const displayedItems = useMemo(() => {
    if (showHistory) return items;
    return items.filter(post => matchesDanbooruImageFilters(post, { rating, ratio, subject: soloOnly ? 'solo' : 'all' }));
  }, [items, rating, ratio, showHistory, soloOnly]);
  // 自动加载：把下一页内容追加到当前列表下方（连续滚动、无切页感）。
  // 与 Pixiv/历史页一致；软上限后停止自动追加，按钮可继续手动加载。
  const appendNextPage = async (force = false) => {
    if (appendingRef.current || loading) return;
    if (!force && items.length >= DANBOORU_APPEND_LIMIT) return;
    const beforePage = pageRef.current;
    const beforeQuery = queryRef.current;
    const beforeSeq = loadSeqRef.current;
    appendingRef.current = true;
    try {
      // 优先消费投机预取的下一页（预取失败则回退正常请求）
      const prefetched = await consumeNextPagePrefetch(beforeQuery, beforePage + 1);
      if (!activeRef.current || !loadGuard.isCurrent(beforeSeq)) return;
      const result = prefetched || await danbooruService.search({ query: beforeQuery, page: beforePage + 1, limit: PAGE_SIZE, signal: requestController.current?.signal });
      // 加载期间用户搜索/跳页：丢弃本次结果，避免拼接到错误列表上。
      if (!activeRef.current || !loadGuard.isCurrent(beforeSeq) || pageRef.current !== beforePage || queryRef.current !== beforeQuery) return;
      setItems(previous => {
        const ids = new Set(previous.map(post => post.id));
        return [...previous, ...result.items.filter(post => !ids.has(post.id))];
      });
      setHasMore(result.hasMore);
      setPage(result.page);
      pageRef.current = result.page;
      // 延续下一页元数据预取，图片只预热前两行。
      scheduleNextPagePrefetch(beforeQuery, result.page, result.hasMore);
    } catch (appendError) {
      if (!loadGuard.isCurrent(beforeSeq)) return;
      const message = appendError instanceof Error ? appendError.message : 'Danbooru 加载失败';
      notify(message, 'error');
    } finally {
      appendingRef.current = false;
    }
  };

  useEffect(() => {
    if (!active) {
      loadSeqRef.current = loadGuard.begin(); cancelBackground(); setLoading(false);
    } else if (!loadedRef.current) void load(queryRef.current, pageRef.current);
    else {
      requestController.current = new AbortController();
      scheduleNextPagePrefetch(queryRef.current, pageRef.current, hasMore);
    }
    return () => cancelBackground();
    // 隐藏保留已完成列表，返回时只恢复下一页预取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 滚动接近列表底部自动加载下一页（追加模式，与 Pixiv 相同的哨兵机制）：
  // 追加完成后若哨兵仍在视口（用户停在底部/快速滚动）会立即再触发，
  // 实现不间断连续加载；内容增长使哨兵移出视口后自然停止。
  const appendSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = appendSentinelRef.current;
    const root = scrollRef.current;
    if (!active || !sentinel || !root || showHistory || !hasMore || loading || items.length >= DANBOORU_APPEND_LIMIT) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void appendNextPage();
    }, { root, rootMargin: '1200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // appendNextPage 闭包随 items.length 重建，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasMore, items.length, loading, page, showHistory]);

  // 瀑布流（masonry 布局时）：真实宽高比完整显示，最短列分配互相补齐。
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const getPostRatio = (post: DanbooruPost) => {
    const ratio = Number(post.width) / Math.max(1, Number(post.height) || 1);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
  };
  const estimateDanbooruCardHeight = React.useCallback((post: DanbooruPost, columnWidth: number) => {
    const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, getPostRatio(post));
    return imageHeight + 52; // 标题 + 作者文本区
  }, []);

  const renderDanbooruCard = (post: DanbooruPost) => {
    const title = post.tags.character[0] || post.tags.artist[0] || `#${post.id}`;
    const ratio = `${post.width || 3} / ${post.height || 4}`;
    return (
      <PressRevealSurface as="article"
        key={post.id}
        data-safe-mode-work="true"
        className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-lg border bg-white transition-[filter,box-shadow,border-color] duration-150 dark:bg-gray-800 ${selectedId !== null && selectedId !== post.id ? 'brightness-[.7]' : ''} ${
          selectedId === post.id ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'
        }`}
      >
        <button type="button" onClick={() => setSelectedId(post.id)} className="block w-full text-left">
          <div
            className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800"
            style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}
          >
            <SmartImage src={post.sampleUrl} alt={title.replaceAll('_', ' ')} />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-micro text-white">
              <span>♥ {formatCount(post.favCount)}</span>
              <span>▲ {formatCount(post.score)}</span>
            </div>
          </div>
          <div className="p-2.5">
            <p data-safe-mode-title="true" className="truncate text-xs font-bold">{title.replaceAll('_', ' ')}</p>
            <p className="mt-1 truncate text-micro text-gray-500">{post.tags.artist.slice(0, 2).join(', ').replaceAll('_', ' ') || `Danbooru #${post.id}`}</p>
          </div>
        </button>
        {post.sampleUrl && <ImageShareOverlay imageUrl={getMobileOriginalUrl(post.sampleUrl)} filename={`danbooru-${post.id}.${post.fileExt}`} notify={notify} />}
      </PressRevealSurface>
    );
  };

  const importToPlayground = (prompt: string) => {
    const pending: PendingImportData = { prompt, negativePrompt: '', params: defaultParams, mode: 'append-prompt' };
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(pending));
    notify('所选 Tag 已追加到实验室');
    onNavigateToPlayground();
  };

  const saveToInspiration = async (post: DanbooruPost, reverse?: ExternalImageTags, existing?: Inspiration): Promise<Inspiration> => {
    const analysis = externalImageAnalysis(danbooruAllTags(post), 0, reverse, existing);
    if (existing) {
      const updates = { analysis, ...(reverse ? { prompt: reverse.prompt } : {}) };
      await db.updateInspiration(existing.id, updates);
      onRefreshInspiration?.(); notify('已更新灵感库，原站与反推 Tag 分别保留');
      return { ...existing, ...updates };
    }
    const character = post.tags.character[0]?.replaceAll('_', ' ');
    const artist = post.tags.artist[0]?.replaceAll('_', ' ');
    const imageUrl = await importDanbooruCoverAsDataUrl(post.sampleUrl);
    const response = await api.post('/inspirations', {
      id: createUuid(),
      userId: currentUser.id,
      username: currentUser.username,
      title: character || artist || `Danbooru #${post.id}`,
      imageUrl,
      prompt: reverse?.prompt ?? danbooruPromptTags(post),
      analysis,
      tags: ['Danbooru', ...post.tags.character.slice(0, 3), ...post.tags.artist.slice(0, 2)],
      sourceType: 'danbooru',
      sourceId: String(post.id),
      sourceUrl: post.postUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    onRefreshInspiration?.();
    notify('已加入灵感库');
    return response.item;
  };

  const submitPageJump = (event?: FormEvent) => {
    event?.preventDefault();
    const value = Number(pageInput);
    if (!Number.isFinite(value) || value < 1) {
      notify('请输入有效页码', 'error');
      return;
    }
    setPageInput('');
    void load(query, Math.floor(value));
  };

  const submitSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    void handleApplyFilter({ inputVal: input });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar>
        <form onSubmit={submitSearch} className="min-w-0 flex-1"><ToolbarSearch value={input} onChange={event => setInput(event.target.value)} placeholder="输入中文或英文 Tag，回车搜索" aria-label="搜索 Danbooru" containerClassName="md:max-w-none!" /></form>
        <ToolbarPopover title="Danbooru 筛选" count={Number(sort !== 'rank') + Number(rating !== 'all') + Number(ratio !== 'all') + Number(soloOnly)}>
        <div className="space-y-4">
          <button type="button" onClick={() => void handleApplyFilter({ sort: 'rank', rating: 'all', ratio: 'all', soloOnly: false })} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">重置筛选</button>
          <label className="block text-sm font-bold dark:text-white">
            排序方式
            <select
              value={sort}
              onChange={event => { void handleApplyFilter({ sort: event.target.value as DanbooruSort }); }}
              className={TOOLBAR_FIELD_CLASS}
            >
              <option value="rank">综合热度</option>
              <option value="score">高分榜</option>
              <option value="favcount">收藏榜</option>
              <option value="latest">最新</option>
            </select>
          </label>
          <label className="block text-sm font-bold dark:text-white">
            评级范围
            <select
              value={rating}
              onChange={event => { void handleApplyFilter({ rating: event.target.value as DanbooruRating }); }}
              className={TOOLBAR_FIELD_CLASS}
            >
              <option value="all">全部评级</option>
              <option value="g">全年龄 G</option>
              <option value="s">微涩 S</option>
              <option value="q">擦边 Q</option>
              <option value="e">R-18 E</option>
            </select>
          </label>
          <label className="block text-sm font-bold dark:text-white">
            画幅比例
            <select
              value={ratio}
              onChange={event => { void handleApplyFilter({ ratio: event.target.value as DanbooruRatio }); }}
              className={TOOLBAR_FIELD_CLASS}
            >
              <option value="all">不限比例</option>
              <option value="portrait">竖屏</option>
              <option value="landscape">横屏</option>
              <option value="square">方图</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => { void handleApplyFilter({ soloOnly: !soloOnly }); }}
            className={`mobile-touch h-10 w-full rounded-xl border px-3 text-sm font-semibold transition-colors ${
              soloOnly
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {soloOnly ? '✓ 已启用仅单人 (solo)' : '启用仅单人 (solo)'}
          </button>
        </div>
        </ToolbarPopover>
        <ToolbarButton aria-label="浏览足迹" onClick={() => (showHistory ? void handleApplyFilter() : loadHistory())} tone={showHistory ? 'primary' : 'neutral'} className="mobile-touch border-l"><Clock /><span className="hidden sm:inline">足迹</span></ToolbarButton>
      </WorkspaceToolbar>

      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main ref={scrollRef} onScroll={onScrollRestore} className={`${selected ? 'hidden lg:block' : 'block'} min-h-0 overflow-y-auto p-3 md:p-5`}>
          {showHistory ? (
            <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
              <span className="font-bold text-gray-700 dark:text-gray-200">本地浏览足迹 ({historyItems.length} 条)</span>
              <button
                type="button"
                onClick={() => {
                  galleryHistoryService.clear('danbooru');
                  setHistoryItems([]);
                }}
                className="text-red-500 hover:underline"
              >
                清空足迹
              </button>
            </div>
          ) : (
            <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
              <span>
                {query === 'order:rank'
                  ? '综合热门推荐'
                  : query.startsWith('explore:popular_month')
                  ? '高分榜 · 月度热门'
                  : query.startsWith('explore:popular_week')
                  ? '收藏榜 · 本周精选'
                  : `检索：${query.replaceAll('_', ' ')}`}
              </span>
              <span>已加载 {displayedItems.length} 件{hasMore ? ' · 滚动继续加载' : ' · 已全部加载'}</span>
            </div>
          )}

          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

          {showHistory ? (
            historyItems.length ? (
              <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
                {historyItems.map(item => (
                  <PressRevealSurface as="article" key={item.id} className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-lg border bg-white transition-[filter,box-shadow,border-color] duration-150 dark:bg-gray-800 ${selectedId !== null && selectedId !== Number(item.sourceId) ? 'brightness-[.7]' : ''} ${selectedId === Number(item.sourceId) ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        const existing = items.find(p => p.id === Number(item.sourceId));
                        if (existing) {
                          setSelectedId(existing.id);
                        } else {
                          // 临时包装一个 post 以便在侧栏查看与操作
                          const dummyPost: DanbooruPost = {
                            id: Number(item.sourceId),
                            score: item.score || 0,
                            favCount: item.bookmarks || 0,
                            rating: 's',
                            fileExt: 'jpg',
                            previewUrl: item.previewUrl,
                            sampleUrl: item.sampleUrl,
                            sourceUrl: item.sampleUrl,
                            postUrl: `https://danbooru.donmai.us/posts/${item.sourceId}`,
                            tags: {
                              artist: item.artistName ? [item.artistName] : [],
                              copyright: [],
                              character: [item.title],
                              general: item.tags,
                              meta: [],
                            },
                            width: item.width || 800,
                            height: item.height || 1200,
                          };
                          setItems(prev => [dummyPost, ...prev]);
                          setSelectedId(dummyPost.id);
                        }
                      }}
                      className="block w-full text-left"
                    >
                      <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800">
                        <SmartImage src={item.sampleUrl} alt={item.title} />
                      </div>
                      <div className="p-2.5">
                        <p className="truncate text-xs font-bold">{item.title}</p>
                        <p className="mt-1 truncate text-micro text-gray-500">{item.artistName || `Danbooru #${item.sourceId}`}</p>
                      </div>
                    </button>
                    {item.sampleUrl && <ImageShareOverlay imageUrl={getMobileOriginalUrl(item.sampleUrl)} filename={`danbooru-${item.sourceId}.png`} notify={notify} />}
                  </PressRevealSurface>
                ))}
              </div>
            ) : (
              <EmptyState className="min-h-72 py-10" icon={<Clock className="h-8 w-8" />} title="暂无 Danbooru 浏览足迹" />
            )
          ) : loading && !displayedItems.length ? (
            <PageSpinner label="正在读取 Danbooru…" className="min-h-72" />
          ) : displayedItems.length ? (
            imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                stableColumns
                items={displayedItems}
                columns={masonryColumns}
                getItemKey={post => String(post.id)}
                estimateItemHeight={estimateDanbooruCardHeight}
                renderItem={renderDanbooruCard}
              />
            ) : (
              <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
                {displayedItems.map(renderDanbooruCard)}
              </div>
            )
          ) : !loading && (
            <EmptyState className="min-h-72 py-10" icon={<Search className="h-8 w-8" />} title="没有找到匹配图片" hint="请尝试放宽筛选条件或更换搜索词。" />
          )}

          {!showHistory && (
            <div className="mt-5 flex flex-col items-center gap-3 pb-4">
              <div ref={appendSentinelRef} className="h-1 w-full" aria-hidden="true" />
              {items.length >= DANBOORU_APPEND_LIMIT && hasMore && (
                <ToolbarButton onClick={() => void appendNextPage(true)}><RefreshCw className={appendingRef.current ? 'animate-spin' : ''} />已加载 {DANBOORU_APPEND_LIMIT} 件 · 继续加载更多</ToolbarButton>
              )}
              <form onSubmit={submitPageJump} className="flex items-center gap-2 text-xs text-gray-500">
                <span>滚动浏览 · 跳到第</span>
                <input
                  type="number"
                  min={1}
                  value={pageInput}
                  onChange={event => setPageInput(event.target.value)}
                  onFocus={event => event.currentTarget.select()}
                  aria-label="输入页码跳转"
                  className="h-9 w-16 rounded-lg border border-indigo-200 bg-white px-2 text-center text-sm font-bold text-indigo-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-indigo-900/60 dark:bg-gray-800 dark:text-indigo-300"
                />
                <span>页</span>
                <ToolbarButton type="submit" disabled={loading}>跳转</ToolbarButton>
              </form>
            </div>
          )}
        </main>

        <DetailSidePanel
          open={Boolean(selected)}
          title={selected ? `Danbooru #${selected.id}` : '作品详情'}
          sensitiveTitle
          subInfo={selected ? `${selected.width}×${selected.height} · ${selected.fileExt.toUpperCase()}` : undefined}
          sourceUrl={selected?.postUrl}
          onBack={closeMobileDetail}
          onClose={() => setSelectedId(null)}
        >
          {selected ? <div className="space-y-4">
            <DetailImageStage pressResetKey={selected.id}>
              <ViewableImage src={selected.sampleUrl} alt={`Danbooru #${selected.id}`} filename={`danbooru-${selected.id}.${selected.fileExt}`} notify={notify} className="max-h-[62vh] w-full object-contain" />
              {selected.sampleUrl && <ImageShareOverlay imageUrl={getMobileOriginalUrl(selected.sampleUrl)} filename={`danbooru-${selected.id}.${selected.fileExt}`} notify={notify} />}
            </DetailImageStage>
            <ExternalImageTools key={`danbooru:${selected.id}`} source="danbooru" sourceId={String(selected.id)} imageUrl={buildMediaUrl(selected.sampleUrl, 'original')}
              sourcePrompt={danbooruPromptTags(selected)} sourceCopy={danbooruAllTags(selected).join(', ')} onImport={importToPlayground} onSave={(reverse, existing) => saveToInspiration(selected, reverse, existing)} notify={notify}
              sourceTags={<>
                {(Object.keys(categoryLabels) as DanbooruTagCategory[]).map(category => selected.tags[category].length > 0 && <section key={category}>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-black text-gray-700 dark:text-gray-200">{categoryLabels[category]} · {selected.tags[category].length}</h3><button type="button" onClick={() => void copyText(selected.tags[category].join(', ')).then(() => notify(`已复制${categoryLabels[category]} Tag`))} className="text-micro text-gray-500 hover:text-indigo-500">复制</button></div>
              <TagChipGroup chips={selected.tags[category].map(tag => ({ label: tag.replaceAll('_', ' '), onClick: () => { setInput(tag); void handleApplyFilter({ inputVal: tag }); } }))} />
                </section>)}
              </>} />
          </div> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">选择作品</div>}
        </DetailSidePanel>
      </div>
    </div>
  );
};
