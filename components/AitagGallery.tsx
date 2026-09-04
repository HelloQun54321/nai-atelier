import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AitagCacheStatus,
  AitagImage,
  AitagWorkDetail,
  AitagWorkSummary,
  aitagService,
  buildAitagImageUrl,
  buildAitagPreviewUrl,
  extractAitagPrompt,
  getAitagGenerationLabels,
  getAitagMetadataText,
  getAitagModelLabel,
  getAitagType,
} from '../services/aitagService';
import { db } from '../services/dbService';
import { IMPORT_SESSION_KEY, parseNovelAIMetadata } from '../services/metadataService';
import { NAIParams, PromptChain, User } from '../types';
import { OriginalImage, SmartImage } from './SmartImage';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { MobileBottomSheet, MobileIconButton, useMobileHistoryLayer } from './MobileUI';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useStaleGuard } from './useStaleGuard';
import { ExternalLink, Filter, FlaskConical, Menu, Package, RefreshCw, Search, Star } from 'lucide-react';
import { FavoriteButton, IconButton, ToolbarButton, ToolbarLink, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel } from './DetailPanel';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { buildMediaUrl } from '../services/mobileImageCache';

interface AitagGalleryProps {
  active: boolean;
  currentUser: User;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onCreateArtistChain: (chain: PromptChain) => Promise<void>;
  onRefreshInspiration?: () => void;
}

const PAGE_SIZE = 60;
const FIRST_IMAGE_IDLE_DELAYS_MS = [1500, 3000, 6000];
/** 追加式自动加载的软上限：超过后停止自动追加，按钮可继续手动加载。 */
const AITAG_APPEND_LIMIT = 800;

const formatCount = (value?: number) => {
  const count = Number(value || 0);
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}w`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(count);
};

const getPixivUrl = (work: AitagWorkSummary) => `https://www.pixiv.net/artworks/${work.id}`;
const getAitagUrl = (work: AitagWorkSummary) => `https://aitag.win/i/${work.id}`;
type AitagSort = 'new' | 'monthly';
type AitagCardCacheLevel = 'full' | 'first-image' | 'none';
type AitagCacheFilter = 'all' | 'full' | 'first-image' | 'favorite';

const normalizeAitagRankMonth = (value?: string) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'older') return 'older';
  if (/^m\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `m${raw}`;
  return 'current';
};

const getAitagTimeRange = (sort: AitagSort, rankMonth: string) => (
  sort === 'monthly' ? normalizeAitagRankMonth(rankMonth) : 'all'
);

const uniqueUrls = (urls: string[]) => Array.from(new Set(urls.filter(Boolean)));

const parseAitagArrayField = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const detailHasFullyCachedImages = (detail?: AitagWorkDetail) => {
  if (detail?.isPreviewOnly) return false;
  const images = detail?.images || [];
  return images.length > 0 && images.every(image => Boolean(image.local_image_url));
};

const getAitagWorkImageCount = (work: AitagWorkSummary, detail?: AitagWorkDetail) => {
  const directCount = Number(work.image_count ?? work.imageCount ?? 0);
  if (directCount > 0) return directCount;

  const detailCount = detail?.images?.length || 0;
  if (detailCount > 0) return detailCount;

  const originalUrlsCount = parseAitagArrayField(work.original_urls ?? work.originalUrls).length;
  if (originalUrlsCount > 0) return originalUrlsCount;

  const imageUrlsCount = parseAitagArrayField(work.image_urls ?? work.imageUrls).length;
  if (imageUrlsCount > 0) return imageUrlsCount;

  return 0;
};

const getAitagCardCacheLevel = (work: AitagWorkSummary, detail?: AitagWorkDetail): AitagCardCacheLevel => {
  if (work.hasFullyCachedImages || detailHasFullyCachedImages(detail)) return 'full';
  if (work.localFirstImageUrl || work.local_cover_url) return 'first-image';
  return 'none';
};

const isAitagFavorite = (work: AitagWorkSummary) => {
  if (typeof work.isFavorite === 'boolean') return work.isFavorite;
  if (typeof work.is_favorite === 'boolean') return work.is_favorite;
  return Number(work.is_favorite || 0) === 1;
};

const needsFirstImageCacheRefresh = (work: AitagWorkSummary) => {
  if (work.localFirstImageUrl || work.local_cover_url) return false;
  // error 也允许重试：上游的 502 多为 Cloudflare 挑战/限流等瞬时故障，
  // 批量缓存侧有连续失败熔断，不会因此轰炸 aitag.win。
  return true;
};

const buildPreviewDetail = (work: AitagWorkSummary): AitagWorkDetail | null => {
  const firstImage = work.firstImage || work.first_image;
  if (!firstImage) return null;
  return {
    work,
    images: [firstImage],
    isPreviewOnly: true,
  };
};

/**
 * 首图候选全部加载失败后的占位：给出「重试」「打开原页」两个出口，避免只留灰块。
 * - 重试：重置 SmartImage 的 key（连同失败态一并清空），从候选列表第一个重新尝试；
 * - 打开原页：优先 aitag 原页（带 SPA 视口加载），fallback 到 Pixiv 原页。
 */
const AitagPreviewFallback: React.FC<{ work: AitagWorkSummary; onRetry: () => void }> = ({ work, onRetry }) => (
  // 卡片整体是 role="button"（点击/Enter 打开详情）：占位内的重试钮与原页链接都要拦掉
  // 键盘/点击冒泡，避免误开详情。原页链接 href 本身可 Tab 聚焦、Enter 在新标签打开。
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-100 px-3 dark:bg-gray-800">
    <span className="text-[11px] text-gray-400">图片加载失败</span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onRetry(); }}
        onKeyDown={event => { event.stopPropagation(); }}
        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        重试
      </button>
      <a
        href={getAitagUrl(work)}
        target="_blank"
        rel="noreferrer"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { event.stopPropagation(); }}
        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-indigo-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-400"
      >
        打开原页
      </a>
    </div>
  </div>
);

const AitagPreviewImage: React.FC<{ work: AitagWorkSummary; detail?: AitagWorkDetail; onImageLoad?: (width: number, height: number) => void }> = ({ work, detail, onImageLoad }) => {
  // 候选源只由这些标量字段决定：本地/远程封面 URL、首图对象里 local/remote 就绪情况与文件名、
  // work.id。合成一个值稳定的签名串作 useMemo 依赖——过去每次渲染新建数组 + join 依赖的
  // useEffect 会在“列表项更新/比例状态变更”等无关重渲染时把 index 重置回 0，
  // 已加载的图片因此反复重试闪断；现在只有在缓存推进（如首图本地化完成）时才重建候选。
  const firstImage = work.firstImage;
  const legacyFirstImage = work.first_image;
  const detailImage = detail?.images?.[0];
  const candidatesKey = [
    work.localFirstImageUrl || '',
    work.local_cover_url || '',
    work.remoteFirstImageUrl || '',
    work.remote_cover_url || '',
    firstImage?.local_image_url || '',
    firstImage?.remote_image_url || '',
    firstImage?.file_name || '',
    legacyFirstImage?.local_image_url || '',
    legacyFirstImage?.file_name || '',
    detailImage?.local_image_url || '',
    detailImage?.file_name || '',
    work.id,
  ].join('|');
  // 依赖用上面的标量签名串 candidatesKey 表达；函数体内引用的 work/detail 字段全部被其覆盖，
  // 不再逐字罗列（保持签名变化即重建的语义）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => uniqueUrls([
    work.localFirstImageUrl || '',
    work.local_cover_url || '',
    firstImage ? buildAitagImageUrl(firstImage) : '',
    legacyFirstImage ? buildAitagImageUrl(legacyFirstImage) : '',
    detailImage ? buildAitagImageUrl(detailImage) : '',
    work.remoteFirstImageUrl || '',
    work.remote_cover_url || '',
    buildAitagPreviewUrl(work),
  ]), [candidatesKey]);
  const [index, setIndex] = useState(0);
  // 显式重试意图：候选源变化时重置 index；用户点「重试」时把 key 重置以清掉 SmartImage 失败态
  const [retryKey, setRetryKey] = useState(0);

  // 候选列表（useMemo 身份稳定）真正变化时：当前 index 若已越界（如全部失败显示占位后，
  // 某候选才完成本地缓存并入列表），回到 0 从头尝试新的最优源；仍在界内则保持不动，
  // 交给 SmartImage 的 src 变化重置，避免把正在显示的图无谓重载。
  useEffect(() => {
    setIndex(current => (current >= candidates.length ? 0 : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const src = candidates[index] || '';

  if (!src) {
    return <div className="w-full h-full bg-gray-200 dark:bg-gray-800" />;
  }
  if (index >= candidates.length) {
    return <AitagPreviewFallback work={work} onRetry={() => { setIndex(0); setRetryKey(value => value + 1); }} />;
  }
  return (
    <SmartImage
      key={retryKey}
      src={src}
      alt=""
      className="w-full h-full object-cover"
      onLoad={event => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onImageLoad?.(image.naturalWidth, image.naturalHeight);
        }
      }}
      onError={() => {
        // 只在候选内前进：耗尽后不再自增，渲染上面的占位而不是空白
        setIndex(current => Math.min(current + 1, candidates.length));
      }}
    />
  );
};

interface AitagPageCache {
  items: AitagWorkSummary[];
  details: Record<number, AitagWorkDetail>;
  selectedId: number | null;
  q: string;
  prompt: string;
  sort: AitagSort;
  rankMonth: string;
  availableMonths: string[];
  cacheFilter: AitagCacheFilter;
  page: number;
  total: number;
  error: string | null;
  hasLoaded: boolean;
  cacheStatus: AitagCacheStatus | null;
  isOfflineCache: boolean;
}

let aitagPageCache: AitagPageCache = {
  items: [],
  details: {},
  selectedId: null,
  q: '',
  prompt: '',
  sort: 'new',
  rankMonth: 'current',
  availableMonths: [],
  cacheFilter: 'all',
  page: 1,
  total: 0,
  error: null,
  hasLoaded: false,
  cacheStatus: null,
  isOfflineCache: false,
};

const aitagRatioCache: Record<number, number> = {};

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

export const AitagGallery: React.FC<AitagGalleryProps> = ({ active, currentUser, notify, onNavigateToPlayground, onCreateArtistChain, onRefreshInspiration }) => {
  const imageDisplay = useMobileImageDisplayPreferences();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const hasLoadedRef = useRef(aitagPageCache.hasLoaded);
  const cancelPageInputRef = useRef(false);
  const cacheStatusRefreshTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<AitagWorkSummary[]>(() => aitagPageCache.items);
  const [details, setDetails] = useState<Record<number, AitagWorkDetail>>(() => aitagPageCache.details);
  const [selectedId, setSelectedId] = useState<number | null>(() => aitagPageCache.selectedId);
  const onMainScrollRestore = useKeepAliveScrollRestore(mainScrollRef, 'aitag', { trigger: selectedId });
  const [q, setQ] = useState(() => aitagPageCache.q);
  const [prompt, setPrompt] = useState(() => aitagPageCache.prompt);
  const [sort, setSort] = useState<AitagSort>(() => aitagPageCache.sort);
  const [rankMonth, setRankMonth] = useState(() => aitagPageCache.rankMonth);
  const [availableMonths, setAvailableMonths] = useState<string[]>(() => aitagPageCache.availableMonths);
  const [cacheFilter, setCacheFilter] = useState<AitagCacheFilter>(() => aitagPageCache.cacheFilter);
  const [page, setPage] = useState(() => aitagPageCache.page);
  const [total, setTotal] = useState(() => aitagPageCache.total);
  const [cacheStatus, setCacheStatus] = useState<AitagCacheStatus | null>(() => aitagPageCache.cacheStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => aitagPageCache.error);
  const [isOfflineCache, setIsOfflineCache] = useState(() => aitagPageCache.isOfflineCache);
  const [isPageInputOpen, setIsPageInputOpen] = useState(false);
  const [pageInputValue, setPageInputValue] = useState(String(aitagPageCache.page));
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');

  const selectedDetail = selectedId ? details[selectedId] : null;
  const selectedWork = selectedDetail?.work || items.find(item => item.id === selectedId) || null;
  const closeMobileDetail = useMobileHistoryLayer(Boolean(selectedWork), () => setSelectedId(null), 'aitag-detail');

  // 模型版本筛选：与「收藏」一致，作用于已加载/已缓存的条目（按首图元数据判断）。
  const [modelFilter, setModelFilter] = useState('');
  const getWorkModelLabel = (work: AitagWorkSummary) => {
    const image = work.firstImage || work.first_image;
    return image ? getAitagModelLabel(image) : '';
  };
  const modelOptions = useMemo(
    () => Array.from(new Set(items.map(getWorkModelLabel).filter(Boolean))).sort(),
    [items],
  );
  const visibleItems = modelFilter
    ? items.filter(work => getWorkModelLabel(work) === modelFilter)
    : items;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNextPage = page < totalPages;

  // 瀑布流（masonry 布局时）：图片加载后按真实宽高比完整显示，最短列分配互相补齐。
  const [aitagRatios, setAitagRatios] = useState<Record<number, number>>(() => aitagRatioCache);
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const estimateAitagCardHeight = React.useCallback((work: AitagWorkSummary, columnWidth: number) => {
    const ratio = aitagRatios[work.id] || aitagRatioCache[work.id] || 1;
    const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
    return imageHeight + 74; // 标题 + 收藏 + 元信息文本区
  }, [aitagRatios]);
  const renderAitagCard = (work: AitagWorkSummary) => {
    const type = getAitagType(work);
    const isSelected = selectedId === work.id;
    const isFavorite = isAitagFavorite(work);
    const detail = details[work.id];
    const imageCount = getAitagWorkImageCount(work, detail);
    const cacheLevel = getAitagCardCacheLevel(work, detail);
    const cardTone = cacheLevel === 'full'
      ? {
          card: 'bg-emerald-50/80 dark:bg-emerald-950/35',
          border: 'border-emerald-200 dark:border-emerald-800/80 hover:border-emerald-400 dark:hover:border-emerald-500',
          image: 'bg-emerald-100 dark:bg-emerald-950',
          marker: 'bg-emerald-500',
        }
      : cacheLevel === 'first-image'
        ? {
            card: 'bg-sky-50/70 dark:bg-sky-950/30',
            border: 'border-sky-200 dark:border-sky-800/75 hover:border-sky-400 dark:hover:border-sky-500',
            image: 'bg-sky-100 dark:bg-sky-950',
            marker: 'bg-sky-500',
          }
        : {
            card: 'bg-white dark:bg-gray-950',
            border: 'border-gray-200 dark:border-gray-800 hover:border-indigo-400',
            image: 'bg-gray-100 dark:bg-gray-800',
            marker: 'bg-transparent',
          };
    const measuredRatio = aitagRatios[work.id];
    const ratioStyle = measuredRatio ? `${Math.round(measuredRatio * 1000)} / 1000` : '1';
    return (
      <div
        key={work.id}
        data-safe-mode-work="true"
        role="button"
        tabIndex={0}
        onClick={() => loadDetail(work)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            loadDetail(work);
          }
        }}
        className={`mobile-gallery-item group relative text-left rounded-lg overflow-hidden border transition-colors flex flex-col ${cardTone.card} ${
          isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : cardTone.border
        }`}
      >
        <div className={`mobile-gallery-frame md:aspect-square relative overflow-hidden ${cardTone.image}`} style={{ '--mobile-image-ratio': ratioStyle } as React.CSSProperties}>
          <AitagPreviewImage
            work={work}
            detail={details[work.id]}
            onImageLoad={(width, height) => {
              const ratio = width / Math.max(1, height);
              if (Number.isFinite(ratio) && ratio > 0 && aitagRatios[work.id] !== ratio) {
                aitagRatioCache[work.id] = ratio;
                setAitagRatios(previous => (previous[work.id] === ratio ? previous : { ...previous, [work.id]: ratio }));
              }
            }}
          />
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold">
            {type || 'AI'}
          </div>
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px]">
            {imageCount}P
          </div>
        </div>
        <div className="p-3 flex-1">
          <div className="flex items-center gap-2">
            <div data-safe-mode-title="true" className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1">
              {work.title || `#${work.id}`}
            </div>
            {/* 卡片本身可点（含 Enter 键冒泡打开详情）：用外层 span 拦掉键盘冒泡，
                收藏按钮的鼠标点击已在 onClick 里 stopPropagation */}
            <span onKeyDownCapture={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}>
              <FavoriteButton
                overlay
                active={isFavorite}
                onClick={e => {
                  e.stopPropagation();
                  void toggleFavorite(work);
                }}
                className="flex-shrink-0"
              />
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 overflow-hidden">
            <span className="truncate">#{work.id}</span>
            <span className="whitespace-nowrap">阅 {formatCount(work.total_view)}</span>
            <span className="whitespace-nowrap">藏 {formatCount(work.total_bookmarks)}</span>
          </div>
        </div>
        <div className={`h-1 ${cardTone.marker}`} />
      </div>
    );
  };
  const cacheNeedsMoreData = isOfflineCache && visibleItems.length === 0;
  const isAitagConnected = !isOfflineCache && !error;
  const hasPendingFirstImageCache = visibleItems.some(needsFirstImageCacheRefresh);
  const allowBackgroundChecks = active && documentVisible;

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!isPageInputOpen) {
      setPageInputValue(String(page));
    }
  }, [page, isPageInputOpen]);

  const resetScrollPositions = () => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    onMainScrollRestore();
  };

  // 滚动接近列表底部自动加载下一页（追加模式，与 Pixiv 相同的哨兵机制）：
  // 追加完成后若哨兵仍在视口（用户停在底部/快速滚动）会立即再触发，
  // 实现不间断连续加载；内容增长使哨兵移出视口后自然停止。
  const appendingRef = useRef(false);
  const appendSentinelRef = useRef<HTMLDivElement>(null);
  const querySignatureRef = useRef('');
  // 每次 loadWorks 递增的序号：非追加路径（搜索/筛选/跳页）此前无竞态守卫，慢的旧响应
  // 会覆盖新结果并污染模块级 aitagPageCache；卸载后迟到的响应同样不该再写。
  const loadGuard = useStaleGuard();
  // 下一页投机预取：当前页稳定后后台请求下一页，哨兵触底追加时直接消费，
  // 把 JSON 往返从滚动路径上移走。签名与页码都匹配才可消费，过期预取自然作废。
  const prefetchedPageRef = useRef<{ signature: string; page: number; promise: Promise<any> } | null>(null);

  const buildPrefetchSignature = (sort: string, rankMonthValue: string, cacheFilterValue: string) =>
    `${q}|${prompt}|${sort}|${rankMonthValue}|${cacheFilterValue}`;
  const getQuerySignature = () => `${q}|${prompt}|${sort}|${rankMonth}|${cacheFilter}`;
  const appendNextPage = async (force = false) => {
    if (appendingRef.current || isLoading) return;
    if (!force && visibleItems.length >= AITAG_APPEND_LIMIT) return;
    appendingRef.current = true;
    try {
      // 追加循环只在开头取一次守卫序号，且每页让位给用户触发的新加载：
      // 此前每页都 begin()，会持续作废在途的用户搜索，导致搜索结果被静默丢弃
      const appendSeq = loadGuard.begin();
      // 当开启模型筛选（如 V5）时，稀疏命中文档会导致单页有效结果过少。
      // 采用自适应自动连拉（最多连续批拉 4 页，或满足新增至少 15 个符合筛选的作品），填补视口空白。
      let currentPageToLoad = page + 1;
      let currentTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const currentVisibleCount = visibleItems.length;
      const targetVisibleCount = modelFilter ? currentVisibleCount + 15 : currentVisibleCount + 1;
      const maxBatchPages = modelFilter ? 4 : 1;
      // 无有效 prompt 的作品被过滤后，整页可能零贡献；此时突破 maxBatchPages 继续连拉，
      // 直到拿到至少一条有效条目（另有上限保护），避免列表空白卡住。
      const maxSkippedPages = 6;
      let pagesFetched = 0;
      let skippedPages = 0;

      while (currentPageToLoad <= currentTotalPages && pagesFetched < maxBatchPages + (skippedPages > 0 ? maxSkippedPages : 0)) {
        if (!loadGuard.isCurrent(appendSeq)) break;
        const itemsBefore = aitagPageCache.items.length;
        const loadedCount = await loadWorks(currentPageToLoad, { append: true, silent: true, guardSeq: appendSeq });
        pagesFetched++;
        currentPageToLoad++;
        if (loadedCount === 0) break;
        // 该页条目全部因无有效 prompt 被过滤（零新增）：继续拉下一页填补空白
        if (aitagPageCache.items.length - itemsBefore === 0) {
          skippedPages++;
          currentTotalPages = Math.max(1, Math.ceil(aitagPageCache.total / PAGE_SIZE));
          continue;
        }
        // 如果在筛选模式下已凑足目标增量，则停止连续拉取
        if (!modelFilter || (aitagPageCache.items.filter(work => getWorkModelLabel(work) === modelFilter).length >= targetVisibleCount)) {
          break;
        }
        currentTotalPages = Math.max(1, Math.ceil(aitagPageCache.total / PAGE_SIZE));
      }
    } finally {
      appendingRef.current = false;
    }
  };
  useEffect(() => {
    const sentinel = appendSentinelRef.current;
    const root = mainScrollRef.current;
    if (!sentinel || !root || !hasNextPage || isLoading || visibleItems.length >= AITAG_APPEND_LIMIT) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void appendNextPage();
    }, { root, rootMargin: '1200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // appendNextPage/loadWorks 闭包随 visibleItems.length 重建，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNextPage, isLoading, visibleItems.length]);

  const loadWorks = async (
    targetPage = page,
    options: {
      resetScroll?: boolean;
      sortOverride?: AitagSort;
      rankMonthOverride?: string;
      cacheFilterOverride?: AitagCacheFilter;
      silent?: boolean;
      /** 追加模式：下一页内容接到当前列表下方（连续滚动），不替换不回顶。 */
      append?: boolean;
      /** 复用调用方的守卫序号（后台追加连拉共用一次 begin，让位用户加载）。 */
      guardSeq?: number;
    } = {}
  ) => {
    const isAppend = options.append === true;
    if (isAppend) {
      const signature = getQuerySignature();
      if (querySignatureRef.current !== signature) return;
    }
    // 追加模式复用 appendNextPage 的守卫序号，避免后台连拉作废用户的前台加载
    const mySeq = options.guardSeq ?? loadGuard.begin();
    const targetSort = options.sortOverride || sort;
    const targetRankMonth = options.rankMonthOverride || rankMonth;
    const targetTimeRange = getAitagTimeRange(targetSort, targetRankMonth);
    const targetCacheFilter = options.cacheFilterOverride || cacheFilter;
    const prefetchSignature = buildPrefetchSignature(targetSort, targetRankMonth, targetCacheFilter);
    if (!options.silent) setIsLoading(true);
    aitagPageCache = { ...aitagPageCache, error: null };
    setError(null);
    try {
      let data;
      let offline = false;
      // 命中投机预取（同签名同页）则直接消费；预取失败（null）回退正常请求
      const prefetched = prefetchedPageRef.current;
      if (prefetched && prefetched.signature === prefetchSignature && prefetched.page === targetPage) {
        prefetchedPageRef.current = null;
        data = await prefetched.promise;
      }
      if (!data) {
        try {
          if (targetCacheFilter === 'all') {
          data = await aitagService.search({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q,
            prompt,
            sort: targetSort,
            timeRange: targetTimeRange,
          });
        } else {
          data = await aitagService.searchCache({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q,
            prompt,
            sort: targetSort,
            cacheFilter: targetCacheFilter,
            timeRange: targetTimeRange,
          });
        }
      } catch (remoteError) {
        data = await aitagService.searchCache({
          page: targetPage,
          pageSize: PAGE_SIZE,
          q,
          prompt,
          sort: targetSort,
          cacheFilter: targetCacheFilter,
          timeRange: targetTimeRange,
        });
        offline = true;
        }
      }

      // 等待期间用户又触发了新的加载，或组件已卸载：丢弃过期结果，不写状态也不污染模块级缓存
      if (!loadGuard.isCurrent(mySeq)) return;

      const nextItems = Array.isArray(data.items) ? data.items : [];
      const reportedTotal = Number(data.total || 0);
      const nextTotal = offline ? Math.max(reportedTotal, total, targetPage * PAGE_SIZE) : reportedTotal;
      const nextPage = Number(data.page || targetPage);
      const nextStatus = data.status || null;
      const nextError = offline ? 'aitag.win 暂时不可用，正在使用本地缓存' : null;

      // 追加期间用户搜索/筛选/跳页（querySignature 已变化）：丢弃本次结果，避免拼接到错误列表上。
      if (isAppend && querySignatureRef.current !== getQuerySignature()) return;

      hasLoadedRef.current = true;
      aitagPageCache = {
        ...aitagPageCache,
        items: isAppend ? [...aitagPageCache.items, ...nextItems] : nextItems,
        total: nextTotal,
        page: nextPage,
        error: nextError,
        hasLoaded: true,
        cacheStatus: nextStatus,
        isOfflineCache: offline,
      };

      if (!isAppend) querySignatureRef.current = getQuerySignature();
      setItems(previous => (isAppend ? [...previous, ...nextItems] : nextItems));
      setTotal(nextTotal);
      setPage(nextPage);
      setCacheStatus(nextStatus);
      setIsOfflineCache(offline);
      setError(nextError);
      if (options.resetScroll) resetScrollPositions();

      // 当前页稳定后后台预取下一页：追加触底时直接消费，省掉 JSON 往返等待
      if (nextItems.length > 0) {
        const fetchPrefetchPage = (pageNumber: number) => targetCacheFilter === 'all'
          ? aitagService.search({ page: pageNumber, pageSize: PAGE_SIZE, q, prompt, sort: targetSort, timeRange: targetTimeRange })
          : aitagService.searchCache({ page: pageNumber, pageSize: PAGE_SIZE, q, prompt, sort: targetSort, cacheFilter: targetCacheFilter, timeRange: targetTimeRange });
        prefetchedPageRef.current = {
          signature: prefetchSignature,
          page: nextPage + 1,
          promise: fetchPrefetchPage(nextPage + 1).catch(() => null),
        };
      }
      return nextItems.length;
    } catch (e: unknown) {
      if (!loadGuard.isCurrent(mySeq)) return 0;
      const errMessage = e instanceof Error ? e.message : String(e);
      const nextError = errMessage || '本地没有这一页，且当前无法联网获取';
      aitagPageCache = { ...aitagPageCache, error: nextError };
      setError(nextError);
      notify('aitag 加载失败: ' + (errMessage || '未知错误'), 'error');
      return 0;
    } finally {
      // 过期的旧加载不得提前关掉新加载的 spinner
      if (!options.silent && loadGuard.isCurrent(mySeq)) setIsLoading(false);
    }
  };

  useEffect(() => {
    const refreshAgentChanges = (event: Event) => {
      const resource = (event as CustomEvent).detail?.resource;
      if (resource === 'aitag' && allowBackgroundChecks) void loadWorks(page, { silent: true });
    };
    window.addEventListener('nai-project-data-changed', refreshAgentChanges);
    return () => window.removeEventListener('nai-project-data-changed', refreshAgentChanges);
  });

  const refreshCacheStatus = async (targetSort = sort, targetRankMonth = rankMonth) => {
    const status = await aitagService.getCacheStatus({
      sort: targetSort,
      timeRange: getAitagTimeRange(targetSort, targetRankMonth),
    });
    setCacheStatus(status);
    aitagPageCache = { ...aitagPageCache, cacheStatus: status };
    return status;
  };

  const scheduleCacheStatusRefresh = () => {
    if (cacheStatusRefreshTimerRef.current !== null) {
      window.clearTimeout(cacheStatusRefreshTimerRef.current);
    }
    cacheStatusRefreshTimerRef.current = window.setTimeout(() => {
      cacheStatusRefreshTimerRef.current = null;
      refreshCacheStatus().catch(console.error);
    }, 800);
  };

  const mergeCachedFirstImageItems = (cachedItems: AitagWorkSummary[]) => {
    const cachedById = new Map(cachedItems.map(item => [Number(item.id), item]));
    setItems(prev => {
      let changed = false;
      const mergedItems = prev.map(item => {
        const cached = cachedById.get(Number(item.id));
        if (!cached) return item;
        changed = true;
        return { ...item, ...cached };
      });
      if (changed) {
        aitagPageCache = { ...aitagPageCache, items: mergedItems };
      }
      return changed ? mergedItems : prev;
    });
  };

  const refreshCurrentPageFromCache = async () => {
    const data = await aitagService.searchCache({
      page,
      pageSize: PAGE_SIZE,
      q,
      prompt,
      sort,
      cacheFilter,
      timeRange: getAitagTimeRange(sort, rankMonth),
    });
    const nextItems = Array.isArray(data.items) ? data.items : [];
    if (nextItems.length > 0) {
      mergeCachedFirstImageItems(nextItems);
      setCacheStatus(data.status || cacheStatus);
      aitagPageCache = { ...aitagPageCache, cacheStatus: data.status || cacheStatus };
    } else {
      await refreshCacheStatus();
    }
  };

  const refreshSelectedWorkFromCache = async (workId: number) => {
    const data = await aitagService.searchCache({
      page: 1,
      pageSize: 1,
      q: String(workId),
      prompt: '',
      sort,
      timeRange: getAitagTimeRange(sort, rankMonth),
    });
    const refreshedWork = (data.items || []).find(item => item.id === workId);
    if (!refreshedWork) return null;

    setItems(prev => {
      const nextItems = prev.map(item => item.id === workId ? { ...item, ...refreshedWork } : item);
      aitagPageCache = { ...aitagPageCache, items: nextItems };
      return nextItems;
    });
    setCacheStatus(data.status || cacheStatus);
    aitagPageCache = { ...aitagPageCache, cacheStatus: data.status || cacheStatus };
    return refreshedWork;
  };

  useEffect(() => {
    if (!hasLoadedRef.current) {
      loadWorks(1);
    } else {
      refreshCacheStatus().catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allowBackgroundChecks || isLoading || isOfflineCache || visibleItems.length === 0 || !hasPendingFirstImageCache) return;

    let cancelled = false;
    let idleRounds = 0;
    let pollRounds = 0;
    let cancelIdleDelay = () => {};
    const controller = new AbortController();
    const pendingIds = new Set(
      visibleItems
        .filter(needsFirstImageCacheRefresh)
        .map(item => Number(item.id))
        .filter(Number.isFinite)
    );

    const waitForFirstImages = async () => {
      while (!cancelled && pendingIds.size > 0 && pollRounds < 4) {
        pollRounds++;
        try {
          const data = await aitagService.waitForFirstImageCache({
            ids: Array.from(pendingIds),
            sort,
            timeRange: getAitagTimeRange(sort, rankMonth),
            timeoutMs: 3500,
            intervalMs: 1000,
            signal: controller.signal,
          });
          if (cancelled) return;
          const nextItems = Array.isArray(data.items) ? data.items : [];
          if (nextItems.length > 0) {
            idleRounds = 0;
            nextItems.forEach(item => pendingIds.delete(Number(item.id)));
            mergeCachedFirstImageItems(nextItems);
            if (data.status) {
              setCacheStatus(data.status);
              aitagPageCache = { ...aitagPageCache, cacheStatus: data.status };
            } else {
              scheduleCacheStatusRefresh();
            }
          } else {
            if (idleRounds >= FIRST_IMAGE_IDLE_DELAYS_MS.length) {
              await refreshCurrentPageFromCache().catch(console.error);
              return;
            }
            const delay = FIRST_IMAGE_IDLE_DELAYS_MS[idleRounds++];
            await new Promise<void>(resolve => {
              let settled = false;
              const finish = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve();
              };
              const timer = window.setTimeout(finish, delay);
              cancelIdleDelay = finish;
              if (cancelled) finish();
            });
            cancelIdleDelay = () => {};
          }
        } catch (e) {
          if (cancelled) return;
          await refreshCurrentPageFromCache().catch(console.error);
          return;
        }
      }
      if (!cancelled && pendingIds.size > 0) await refreshCurrentPageFromCache().catch(console.error);
    };

    waitForFirstImages().catch(console.error);
    return () => {
      cancelled = true;
      controller.abort();
      cancelIdleDelay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, prompt, sort, rankMonth, cacheFilter, isLoading, isOfflineCache, hasPendingFirstImageCache, allowBackgroundChecks]);

  useEffect(() => {
    if (!allowBackgroundChecks || !selectedId || !selectedDetail || selectedDetail.isPreviewOnly || detailHasFullyCachedImages(selectedDetail)) return;

    // 后台缓存进度签名：对比相邻两次轮询读到的作品缓存字段，判断是否有真实推进。
    // 只看内容不看对象引用——searchCache 每次返回的都是新对象，引用比较恒为“变化”。
    const cacheProgressKey = (work?: AitagWorkSummary | null) => {
      if (!work) return '';
      return [
        work.hasFullyCachedImages ? 1 : 0,
        work.hasCachedDetail ? 1 : 0,
        work.localFirstImageUrl || '',
        work.local_cover_url || '',
        work.firstImage?.local_image_url || '',
        work.first_image?.local_image_url || '',
        work.firstImageCachedAt || 0,
        work.cover_cached_at || 0,
        work.detailCachedAt || 0,
      ].join('|');
    };

    let isRefreshing = false;
    let unchangedRounds = 0;
    let lastSignature = cacheProgressKey(selectedDetail.work);

    const timer = window.setInterval(async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        const refreshedWork = await refreshSelectedWorkFromCache(selectedId);
        if (!refreshedWork?.hasFullyCachedImages) {
          // 尚未完整缓存：对比签名，连续 3 次无变化即停止轮询（后台可能永远完成不了，
          // 如上游失联的作品组），避免无限拉取缓存状态；有推进则归零继续等待。
          const signature = cacheProgressKey(refreshedWork);
          if (signature === lastSignature) {
            unchangedRounds += 1;
            if (unchangedRounds >= 3) window.clearInterval(timer);
          } else {
            lastSignature = signature;
            unchangedRounds = 0;
          }
          return;
        }

        const detail = await aitagService.getWork(selectedId);

        setDetails(prev => {
          const nextDetails = { ...prev, [selectedId]: detail };
          aitagPageCache = { ...aitagPageCache, details: nextDetails };
          return nextDetails;
        });
        setItems(prev => {
          const nextItems = prev.map(item => item.id === selectedId
            ? { ...item, hasCachedDetail: true, hasFullyCachedImages: detailHasFullyCachedImages(detail) }
            : item
          );
          aitagPageCache = { ...aitagPageCache, items: nextItems };
          return nextItems;
        });
        refreshCacheStatus().catch(console.error);
        window.clearInterval(timer);
      } catch (e) {
        console.error(e);
        // 拉取失败同样按“无推进”累计：避免因接口持续异常而无限轮询
        unchangedRounds += 1;
        if (unchangedRounds >= 3) window.clearInterval(timer);
      } finally {
        isRefreshing = false;
      }
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedDetail?.images.length, selectedDetail?.isPreviewOnly, allowBackgroundChecks]);

  useEffect(() => {
    aitagPageCache = {
      ...aitagPageCache,
      items,
      details,
      selectedId,
      q,
      prompt,
      sort,
      rankMonth,
      availableMonths,
      cacheFilter,
      page,
      total,
      error,
      cacheStatus,
      isOfflineCache,
      hasLoaded: hasLoadedRef.current,
    };
  }, [items, details, selectedId, q, prompt, sort, rankMonth, availableMonths, cacheFilter, page, total, error, cacheStatus, isOfflineCache]);

  useEffect(() => {
    let cancelled = false;
    aitagService.getMonths()
      .then(data => {
        if (cancelled) return;
        const months = Array.from(new Set((data.months || data.availableMonths || [])
          .map(month => String(month || '').trim())
          .filter(month => /^\d{4}-\d{2}$/.test(month))
        ));
        setAvailableMonths(months);
        aitagPageCache = { ...aitagPageCache, availableMonths: months };
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cacheStatusRefreshTimerRef.current !== null) {
        window.clearTimeout(cacheStatusRefreshTimerRef.current);
      }
    };
  }, []);

  const handleSearch = () => {
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSelectedId(null);
    loadWorks(1, { resetScroll: true });
  };

  const handleCacheFilterChange = (nextCacheFilter: AitagCacheFilter) => {
    if (nextCacheFilter === cacheFilter && !isLoading) return;
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setCacheFilter(nextCacheFilter);
    setSelectedId(null);
    loadWorks(1, { resetScroll: true, cacheFilterOverride: nextCacheFilter });
  };

  const handleSortChange = (nextSort: AitagSort) => {
    if (nextSort === sort && !isLoading) return;
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSort(nextSort);
    setSelectedId(null);
    loadWorks(1, { resetScroll: true, sortOverride: nextSort });
    refreshCacheStatus(nextSort).catch(console.error);
  };

  const handleRankMonthChange = (nextRankMonth: string) => {
    const normalized = normalizeAitagRankMonth(nextRankMonth);
    if (normalized === rankMonth && !isLoading) return;
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setRankMonth(normalized);
    setSelectedId(null);
    loadWorks(1, { resetScroll: true, rankMonthOverride: normalized });
    refreshCacheStatus(sort, normalized).catch(console.error);
  };

  const toggleFavorite = async (work: AitagWorkSummary) => {
    const nextFavorite = !isAitagFavorite(work);
    const now = Date.now();
    setItems(prev => {
      const nextItems = prev
        .map(item => item.id === work.id
          ? { ...item, isFavorite: nextFavorite, is_favorite: nextFavorite ? 1 : 0, favoriteAt: nextFavorite ? now : undefined, favorite_at: nextFavorite ? now : undefined }
          : item
        )
        .filter(item => cacheFilter !== 'favorite' || isAitagFavorite(item));
      aitagPageCache = { ...aitagPageCache, items: nextItems };
      return nextItems;
    });

    try {
      const result = await aitagService.setFavorite(work.id, nextFavorite, {
        sort,
        timeRange: getAitagTimeRange(sort, rankMonth),
      });
      if (result.item) {
        setItems(prev => {
          const nextItems = prev
            .map(item => item.id === work.id ? { ...item, ...result.item } : item)
            .filter(item => cacheFilter !== 'favorite' || isAitagFavorite(item));
          aitagPageCache = { ...aitagPageCache, items: nextItems };
          return nextItems;
        });
      }
    } catch (e: any) {
      loadWorks(page, { silent: true });
      notify(e.message || '加入灵感库失败', 'error');
    }
  };

  const submitPageInput = () => {
    if (cancelPageInputRef.current) {
      cancelPageInputRef.current = false;
      setIsPageInputOpen(false);
      setPageInputValue(String(page));
      return;
    }

    const targetPage = Number.parseInt(pageInputValue, 10);
    if (!Number.isFinite(targetPage)) {
      setIsPageInputOpen(false);
      setPageInputValue(String(page));
      return;
    }

    const nextPage = Math.max(1, Math.min(totalPages, targetPage));
    setIsPageInputOpen(false);
    setPageInputValue(String(nextPage));
    if (nextPage !== page) {
      loadWorks(nextPage, { resetScroll: true });
    }
  };

  const getDetail = async (work: AitagWorkSummary) => {
    const cached = details[work.id];
    if (cached && !cached.isPreviewOnly) return cached;

    const detail = await aitagService.getWork(work.id);
    setDetails(prev => {
      const nextDetails = { ...prev, [work.id]: detail };
      aitagPageCache = { ...aitagPageCache, details: nextDetails };
      return nextDetails;
    });
    setItems(prev => {
      const nextItems = prev.map(item => item.id === work.id
        ? {
            ...item,
            hasCachedDetail: true,
            hasFullyCachedImages: detailHasFullyCachedImages(detail),
          }
        : item
      );
      aitagPageCache = { ...aitagPageCache, items: nextItems };
      return nextItems;
    });
    refreshCacheStatus().catch(console.error);
    return detail;
  };

  const parseImageImportData = (image: AitagImage) => {
    const metadataText = getAitagMetadataText(image);
    if (!metadataText.trim()) {
      throw new Error('没有可导入的图片元数据');
    }

    return parseNovelAIMetadata(metadataText, defaultParams);
  };

  const getImageTitle = (image: AitagImage, index?: number) => {
    const title = selectedWork?.title?.trim() || `aitag-${image.work_id}`;
    return index === undefined ? title : `${title} P${index + 1}`;
  };

  const loadDetail = async (work: AitagWorkSummary) => {
    aitagPageCache = { ...aitagPageCache, selectedId: work.id };
    setSelectedId(work.id);
    if (details[work.id] && !details[work.id].isPreviewOnly) return;

    const previewDetail = buildPreviewDetail(work);
    if (previewDetail) {
      setDetails(prev => {
        const nextDetails = { ...prev, [work.id]: previewDetail };
        aitagPageCache = { ...aitagPageCache, details: nextDetails };
        return nextDetails;
      });
    }

    setIsDetailLoading(!previewDetail);
    try {
      await getDetail(work);
    } catch (e: any) {
      notify('作品详情加载失败: ' + (e.message || '未知错误'), 'error');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const importToPlayground = (image: AitagImage) => {
    try {
      const importData = parseImageImportData(image);
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(importData));
      notify('参数已导入实验室，正在跳转...');
      onNavigateToPlayground();
    } catch (e: any) {
      notify(e.message || '导入失败', 'error');
    }
  };

  const saveAsArtistChain = async (image: AitagImage, index: number) => {
    try {
      const importData = parseImageImportData(image);
      const now = Date.now();
      const chain: PromptChain = {
        id: `aitag-${image.work_id}-${image.file_name}`,
        userId: currentUser.id,
        username: currentUser.username,
        type: 'style',
        name: getImageTitle(image, index),
        description: `Imported from aitag #${image.work_id}`,
        tags: ['aitag', getAitagType(selectedWork || undefined)].filter(Boolean),
        previewImage: buildAitagImageUrl(image),
        basePrompt: importData.prompt,
        negativePrompt: importData.negativePrompt,
        modules: [],
        params: importData.params,
        variableValues: { subject: '' },
        createdAt: now,
        updatedAt: now,
      };

      await onCreateArtistChain(chain);
      notify('已保存到风格串');
    } catch (e: any) {
      notify(e.message || '保存失败', 'error');
    }
  };

  const saveToInspiration = async (image: AitagImage, index: number) => {
    try {
      const importData = parseImageImportData(image);
      await db.saveInspiration({
        id: createUuid(),
        userId: currentUser.id,
        username: currentUser.username,
        title: getImageTitle(image, index),
        imageUrl: buildAitagImageUrl(image),
        prompt: importData.prompt,
        negativePrompt: importData.negativePrompt,
        params: importData.params,
        tags: ['AITag', selectedWork ? getAitagType(selectedWork) : image.image_type].filter(Boolean),
        sourceType: 'aitag',
        sourceId: String(image.work_id),
        sourceUrl: selectedWork ? getAitagUrl(selectedWork) : `https://aitag.win/i/${image.work_id}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onRefreshInspiration?.();
      notify('已加入灵感库');
    } catch (e: any) {
      notify(e.message || '加入灵感库失败', 'error');
    }
  };

  return (
    <div className="aitag-workspace flex-1 min-h-0 flex flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar>
        <div className="flex w-full min-w-0 items-center gap-2 md:hidden">
          <span title={isAitagConnected ? '连接正常' : '当前使用本地缓存'} className={`h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleSearch(); }} placeholder="搜索 AITag 作品" />
          <MobileIconButton label="AITag 筛选" onClick={() => setShowMobileFilters(true)} className="border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><Menu className="h-5 w-5" /></MobileIconButton>
          <MobileIconButton label="刷新" onClick={() => loadWorks(1, { resetScroll: true })} disabled={isLoading} className="border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} /></MobileIconButton>
          <ImageTaggerAction notify={notify} />
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <span title={isAitagConnected ? 'aitag.win 连接正常' : 'aitag.win 暂时不可用'} className={`h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]' : 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleSearch(); }} placeholder="作品、作者、标题或标签，回车检索" containerClassName="min-w-[14rem] flex-1 md:max-w-none!" />
          <div className="relative flex-none">
            <ToolbarButton onClick={() => setShowDesktopFilters(value => !value)} className={showDesktopFilters ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!bg-indigo-950/40 dark:!text-indigo-400' : ''} aria-expanded={showDesktopFilters} aria-haspopup="dialog"><Filter className="h-4 w-4" />筛选</ToolbarButton>
            {showDesktopFilters && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDesktopFilters(false)} />
                <div role="dialog" aria-label="AITag 筛选" className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 hidden w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900 md:block">
                  <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900 dark:text-white">AITag 筛选</h2><button type="button" onClick={() => setShowDesktopFilters(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">×</button></div>
                  <label className="mb-3 block text-xs text-gray-500 dark:text-gray-400">Prompt 搜索<input value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { handleSearch(); setShowDesktopFilters(false); } }} placeholder="搜索 NovelAI 元数据 Prompt" className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white" /></label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="text-xs text-gray-500 dark:text-gray-400">缓存<select value={cacheFilter} onChange={e => handleCacheFilterChange(e.target.value as AitagCacheFilter)} disabled={isLoading} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="all">全部</option><option value="favorite">收藏</option><option value="full">已缓存全部</option><option value="first-image">已缓存首图</option></select></label>
                    <label className="text-xs text-gray-500 dark:text-gray-400">排序<select value={sort} onChange={e => handleSortChange(e.target.value as AitagSort)} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="new">最新</option><option value="monthly">月榜</option></select></label>
                    <label className="text-xs text-gray-500 dark:text-gray-400">月份<select value={sort === 'monthly' ? rankMonth : ''} onChange={e => handleRankMonthChange(e.target.value)} disabled={isLoading || sort !== 'monthly'} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="">无需月份</option><option value="current">当前月份</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">更早</option></select></label>
                  </div>
                  <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">模型版本（已加载条目）<select value={modelFilter} onChange={e => setModelFilter(e.target.value)} disabled={isLoading || modelOptions.length === 0} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="">全部</option>{modelOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label>
                  <button type="button" onClick={() => { handleSearch(); setShowDesktopFilters(false); }} className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500">应用筛选</button>
                </div>
              </>
            )}
          </div>
          <div className="ml-auto hidden items-center gap-2 text-xs text-gray-500 xl:flex"><span>已加载 {formatCount(visibleItems.length)} 条</span><span>共 {formatCount(total)} 条</span></div>
          <IconButton label="刷新" onClick={() => loadWorks(1, { resetScroll: true })} disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
          <ImageTaggerAction notify={notify} />
        </div>
      </WorkspaceToolbar>
      <MobileBottomSheet open={showMobileFilters} title="AITag 筛选" onClose={() => setShowMobileFilters(false)} footer={<button onClick={() => { handleSearch(); setShowMobileFilters(false); }} className="mobile-touch w-full rounded-xl bg-indigo-600 font-bold text-white">应用筛选</button>}>
        <div className="space-y-4">
          <label className="block text-sm font-bold dark:text-white">Prompt 搜索<input value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="搜索 NovelAI 元数据 Prompt" className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 font-normal dark:border-gray-800 dark:bg-gray-800" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-bold dark:text-white">缓存<select value={cacheFilter} onChange={event => handleCacheFilterChange(event.target.value as AitagCacheFilter)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal dark:border-gray-800 dark:bg-gray-800"><option value="all">全部</option><option value="favorite">收藏</option><option value="full">已缓存全部</option><option value="first-image">已缓存首图</option></select></label>
            <label className="text-sm font-bold dark:text-white">排序<select value={sort} onChange={event => handleSortChange(event.target.value as AitagSort)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal dark:border-gray-800 dark:bg-gray-800"><option value="new">最新</option><option value="monthly">月榜</option></select></label>
            <label className="text-sm font-bold dark:text-white">月份<select value={sort === 'monthly' ? rankMonth : ''} disabled={sort !== 'monthly'} onChange={event => handleRankMonthChange(event.target.value)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800"><option value="current">当前月份</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">更早</option></select></label>
          </div>
            <label className="text-sm font-bold dark:text-white">模型版本（已加载条目）<select value={modelFilter} onChange={event => setModelFilter(event.target.value)} disabled={modelOptions.length === 0} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800"><option value="">全部</option>{modelOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label>
          <div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">已加载 {formatCount(visibleItems.length)} 条 · 共 {formatCount(total)} 条</div>
        </div>
      </MobileBottomSheet>

      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selectedWork ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main
          ref={mainScrollRef}
          onScroll={onMainScrollRestore}
          className={`${selectedWork ? 'hidden lg:block' : 'block'} min-h-0 overflow-y-auto p-4 md:p-6`}
        >
          {error && (
            <div className={`mb-4 rounded border px-4 py-3 text-sm ${
              isOfflineCache
                ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'
            }`}>
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-sm">加载 aitag 数据中...</div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <div className="text-sm">{cacheNeedsMoreData ? '本地没有这一页，且当前无法联网获取' : '没有匹配结果'}</div>
            </div>
          ) : (
            imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                items={visibleItems}
                columns={masonryColumns}
                getItemKey={work => String(work.id)}
                estimateItemHeight={estimateAitagCardHeight}
                renderItem={renderAitagCard}
              />
            ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-aitag-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {visibleItems.map(renderAitagCard)}
            </div>
            )
          )}

          <div className="flex flex-col items-center gap-2 py-6">
            <div ref={appendSentinelRef} className="h-1 w-full" aria-hidden="true" />
            {visibleItems.length >= AITAG_APPEND_LIMIT && hasNextPage && (
              <button type="button" onClick={() => void appendNextPage(true)} disabled={isLoading} className="mobile-touch px-4 py-2 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-bold text-gray-600 dark:text-gray-300">
                已加载 {AITAG_APPEND_LIMIT} 条 · 继续加载更多
              </button>
            )}
            <div className="flex justify-center items-center gap-2 text-xs text-gray-500">
              <span>已加载 {formatCount(visibleItems.length)} 条 / 共 {formatCount(total)} 条 · 滚动浏览，可跳转</span>
              {isPageInputOpen ? (
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageInputValue}
                  autoFocus
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => setPageInputValue(e.target.value)}
                  onBlur={submitPageInput}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelPageInputRef.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  disabled={isLoading}
                  aria-label="输入页码跳转"
                  className="w-20 px-2 py-2 rounded border border-indigo-400 dark:border-indigo-500 bg-white dark:bg-gray-900 text-center text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    cancelPageInputRef.current = false;
                    setPageInputValue(String(page));
                    setIsPageInputOpen(true);
                  }}
                  disabled={isLoading}
                  title="点击输入页码跳转"
                  className="mobile-touch min-w-24 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
                >
                  跳到第 {page} 页
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-center pb-6 -mt-3">
            <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              <span title="当前筛选下已经成功保存到本地的第一张图数量">首图保存 {formatCount(cacheStatus?.firstImagesCount ?? cacheStatus?.coversCount ?? 0)}</span>
              <span title="已经点开并完整保存详情 JSON 的作品数">完整保存 {formatCount(cacheStatus?.detailsCount || 0)}</span>
              {isOfflineCache && <span className="text-amber-600 dark:text-amber-300">本地缓存模式</span>}
            </div>
          </div>
        </main>

        <DetailSidePanel
          open={Boolean(selectedWork)}
          title={selectedWork?.title || '作品详情'}
          sensitiveTitle
          subInfo={selectedWork ? `#${selectedWork.id} · ${getAitagType(selectedWork)}` : undefined}
          onBack={closeMobileDetail}
          onClose={() => setSelectedId(null)}
        >
          {!selectedWork ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
              选择左侧作品后，这里会显示所有图片和操作按钮
            </div>
          ) : isDetailLoading && !selectedDetail ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">加载详情中...</div>
          ) : selectedDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <ToolbarLink href={getAitagUrl(selectedWork)} target="_blank" rel="noreferrer"><ExternalLink />aitag 原页</ToolbarLink>
                <ToolbarLink href={getPixivUrl(selectedWork)} target="_blank" rel="noreferrer"><ExternalLink />Pixiv 原页</ToolbarLink>
              </div>
              {selectedDetail.images
                .slice()
                .sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }))
                .map((image, index) => {
                    const promptText = extractAitagPrompt(image);
                    const generationLabels = getAitagGenerationLabels(image);
                    const modelLabel = getAitagModelLabel(image);

                    return (
                      <div key={image.id || `${image.work_id}-${image.file_name}`} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden">
                        <OriginalImage src={buildAitagImageUrl(image)} alt="" className="w-full max-h-[62vh] object-contain bg-black/5 dark:bg-black/20" loading="lazy" />
                        <div className="p-3 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              {generationLabels.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {generationLabels.map(label => (
                                    <span key={label} className="rounded bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/20">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={modelLabel || image.image_type}>
                                P{index + 1}{modelLabel ? ` · ${modelLabel}` : ''}
                              </div>
                            </div>
                            <div className="flex flex-none gap-2">
                              <IconButton label="保存到风格串" onClick={() => saveAsArtistChain(image, index)}><Package /></IconButton>
                              <IconButton label="加入灵感库" tone="favorite" onClick={() => saveToInspiration(image, index)}><Star /></IconButton>
                              <IconButton label="导入实验室" tone="primary" onClick={() => importToPlayground(image)}><FlaskConical /></IconButton>
                              <ImageTaggerAction
                                notify={notify}
                                imageUrl={image.local_image_url || buildMediaUrl(buildAitagImageUrl(image), 'original')}
                                actionLabel="复制 {count} 个 Tag"
                                className="!w-10 !h-10"
                              />
                            </div>
                          </div>
                          <div className="text-xs font-mono text-gray-700 dark:text-gray-300 leading-relaxed bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-28 overflow-y-auto custom-scrollbar break-words">
                            {promptText || <span className="text-gray-400">暂无提示词</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              {selectedDetail.isPreviewOnly && (
                <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-700 dark:text-sky-200">
                  已显示本地首图，正在加载完整作品组...
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400">详情加载失败</div>
          )}
        </DetailSidePanel>
      </div>
    </div>
  );
};
