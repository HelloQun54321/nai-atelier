import React, { useEffect, useRef, useState } from 'react';
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
import { MobileBottomSheet, MobileIconButton, useMobileHistoryLayer } from './MobileUI';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ArrowLeft, Filter, Menu, RefreshCw, Search, X } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ImageTaggerAction } from './ImageTaggerPanel';

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

const formatCount = (value?: number) => {
  const count = Number(value || 0);
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}w`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(count);
};

const getPixivUrl = (work: AitagWorkSummary) => `https://www.pixiv.net/artworks/${work.id}`;
const getAitagUrl = (work: AitagWorkSummary) => `https://aitag.win/i/${work.id}`;
type AitagSort = 'new' | 'monthly';
type AitagAiType = 'all' | 'nai' | 'sd' | 'comfyui';
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
  const status = String(work.firstImageStatus || work.cover_status || 'missing').toLowerCase();
  return status !== 'error';
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

const AitagPreviewImage: React.FC<{ work: AitagWorkSummary; detail?: AitagWorkDetail }> = ({ work, detail }) => {
  const candidates = uniqueUrls([
    work.localFirstImageUrl || '',
    work.local_cover_url || '',
    work.firstImage ? buildAitagImageUrl(work.firstImage) : '',
    work.first_image ? buildAitagImageUrl(work.first_image) : '',
    detail?.images?.[0] ? buildAitagImageUrl(detail.images[0]) : '',
    work.remoteFirstImageUrl || '',
    work.remote_cover_url || '',
    buildAitagPreviewUrl(work),
  ]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [candidates.join('|')]);

  const src = candidates[index] || '';

  if (!src) {
    return <div className="w-full h-full bg-gray-200 dark:bg-gray-800" />;
  }

  return (
    <SmartImage
      src={src}
      alt=""
      className="w-full h-full object-cover"
      onError={() => {
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
  aiType: AitagAiType;
  cacheFilter: AitagCacheFilter;
  page: number;
  total: number;
  error: string | null;
  mainScrollTop: number;
  detailScrollTop: number;
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
  aiType: 'nai',
  cacheFilter: 'all',
  page: 1,
  total: 0,
  error: null,
  mainScrollTop: 0,
  detailScrollTop: 0,
  hasLoaded: false,
  cacheStatus: null,
  isOfflineCache: false,
};

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
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedRef = useRef(aitagPageCache.hasLoaded);
  const didRestoreScrollRef = useRef(false);
  const cancelPageInputRef = useRef(false);
  const cacheStatusRefreshTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<AitagWorkSummary[]>(() => aitagPageCache.items);
  const [details, setDetails] = useState<Record<number, AitagWorkDetail>>(() => aitagPageCache.details);
  const [selectedId, setSelectedId] = useState<number | null>(() => aitagPageCache.selectedId);
  const [q, setQ] = useState(() => aitagPageCache.q);
  const [prompt, setPrompt] = useState(() => aitagPageCache.prompt);
  const [sort, setSort] = useState<AitagSort>(() => aitagPageCache.sort);
  const [rankMonth, setRankMonth] = useState(() => aitagPageCache.rankMonth);
  const [availableMonths, setAvailableMonths] = useState<string[]>(() => aitagPageCache.availableMonths);
  const [aiType, setAiType] = useState<AitagAiType>(() => aitagPageCache.aiType);
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
  const visibleItems = items;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNextPage = page < totalPages;
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

  const cacheScrollPositions = () => {
    if (mainScrollRef.current) {
      aitagPageCache.mainScrollTop = mainScrollRef.current.scrollTop;
    }
    if (detailScrollRef.current) {
      aitagPageCache.detailScrollTop = detailScrollRef.current.scrollTop;
    }
  };

  const resetScrollPositions = () => {
    aitagPageCache.mainScrollTop = 0;
    aitagPageCache.detailScrollTop = 0;
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  };

  const loadWorks = async (
    targetPage = page,
    options: {
      resetScroll?: boolean;
      aiTypeOverride?: AitagAiType;
      sortOverride?: AitagSort;
      rankMonthOverride?: string;
      cacheFilterOverride?: AitagCacheFilter;
      silent?: boolean;
    } = {}
  ) => {
    const targetAiType = options.aiTypeOverride || aiType;
    const targetSort = options.sortOverride || sort;
    const targetRankMonth = options.rankMonthOverride || rankMonth;
    const targetTimeRange = getAitagTimeRange(targetSort, targetRankMonth);
    const targetCacheFilter = options.cacheFilterOverride || cacheFilter;
    if (!options.silent) setIsLoading(true);
    aitagPageCache = { ...aitagPageCache, error: null };
    setError(null);
    try {
      let data;
      let offline = false;
      try {
        if (targetCacheFilter === 'all') {
          data = await aitagService.search({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q,
            prompt,
            sort: targetSort,
            aiType: targetAiType,
            timeRange: targetTimeRange,
          });
        } else {
          data = await aitagService.searchCache({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q,
            prompt,
            sort: targetSort,
            aiType: targetAiType,
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
          aiType: targetAiType,
          cacheFilter: targetCacheFilter,
          timeRange: targetTimeRange,
        });
        offline = true;
      }

      const nextItems = Array.isArray(data.items) ? data.items : [];
      const reportedTotal = Number(data.total || 0);
      const nextTotal = offline ? Math.max(reportedTotal, total, targetPage * PAGE_SIZE) : reportedTotal;
      const nextPage = Number(data.page || targetPage);
      const nextStatus = data.status || null;
      const nextError = offline ? 'aitag.win 暂时不可用，正在使用本地缓存' : null;

      hasLoadedRef.current = true;
      aitagPageCache = {
        ...aitagPageCache,
        items: nextItems,
        total: nextTotal,
        page: nextPage,
        error: nextError,
        hasLoaded: true,
        cacheStatus: nextStatus,
        isOfflineCache: offline,
      };

      setItems(nextItems);
      setTotal(nextTotal);
      setPage(nextPage);
      setCacheStatus(nextStatus);
      setIsOfflineCache(offline);
      setError(nextError);
      if (options.resetScroll) resetScrollPositions();
    } catch (e: any) {
      const nextError = e.message || '本地没有这一页，且当前无法联网获取';
      aitagPageCache = { ...aitagPageCache, error: nextError };
      setError(nextError);
      notify('aitag 加载失败: ' + (e.message || '未知错误'), 'error');
    } finally {
      if (!options.silent) setIsLoading(false);
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

  const refreshCacheStatus = async (targetSort = sort, targetAiType = aiType, targetRankMonth = rankMonth) => {
    const status = await aitagService.getCacheStatus({
      sort: targetSort,
      timeRange: getAitagTimeRange(targetSort, targetRankMonth),
      aiType: targetAiType,
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
      aiType,
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
      aiType,
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
            aiType,
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
  }, [page, q, prompt, sort, rankMonth, aiType, cacheFilter, isLoading, isOfflineCache, hasPendingFirstImageCache, allowBackgroundChecks]);

  useEffect(() => {
    if (!allowBackgroundChecks || !selectedId || !selectedDetail || selectedDetail.isPreviewOnly || detailHasFullyCachedImages(selectedDetail)) return;

    let isRefreshing = false;
    const timer = window.setInterval(async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        const refreshedWork = await refreshSelectedWorkFromCache(selectedId);
        if (!refreshedWork?.hasFullyCachedImages) return;

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
      aiType,
      cacheFilter,
      page,
      total,
      error,
      cacheStatus,
      isOfflineCache,
      hasLoaded: hasLoadedRef.current,
    };
  }, [items, details, selectedId, q, prompt, sort, rankMonth, availableMonths, aiType, cacheFilter, page, total, error, cacheStatus, isOfflineCache]);

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
    if (didRestoreScrollRef.current || !hasLoadedRef.current) return;
    didRestoreScrollRef.current = true;
    requestAnimationFrame(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = aitagPageCache.mainScrollTop;
      if (detailScrollRef.current) detailScrollRef.current.scrollTop = aitagPageCache.detailScrollTop;
    });
  }, [items.length, selectedDetail?.images.length]);

  useEffect(() => {
    return () => {
      if (cacheStatusRefreshTimerRef.current !== null) {
        window.clearTimeout(cacheStatusRefreshTimerRef.current);
      }
      cacheScrollPositions();
    };
  }, []);

  const handleSearch = () => {
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSelectedId(null);
    loadWorks(1, { resetScroll: true });
  };

  const handleAiTypeChange = (nextAiType: AitagAiType) => {
    if (nextAiType === aiType && !isLoading) return;
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setAiType(nextAiType);
    setSelectedId(null);
    loadWorks(1, { resetScroll: true, aiTypeOverride: nextAiType });
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
    refreshCacheStatus(nextSort, aiType).catch(console.error);
  };

  const handleRankMonthChange = (nextRankMonth: string) => {
    const normalized = normalizeAitagRankMonth(nextRankMonth);
    if (normalized === rankMonth && !isLoading) return;
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setRankMonth(normalized);
    setSelectedId(null);
    loadWorks(1, { resetScroll: true, rankMonthOverride: normalized });
    refreshCacheStatus(sort, aiType, normalized).catch(console.error);
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
      void db.logClientEvent({
        category: 'aitag',
        action: 'aitag_import_playground',
        resourceType: 'aitag_image',
        resourceId: `${image.work_id}/${image.file_name}`,
        message: `从 aitag 导入参数到实验室：${getImageTitle(image)}`,
        metadata: {
          workId: image.work_id,
          fileName: image.file_name,
          type: selectedWork ? getAitagType(selectedWork) : image.image_type,
          promptLength: importData.prompt.length,
          negativeLength: importData.negativePrompt.length,
          width: importData.params.width,
          height: importData.params.height,
          seed: importData.params.seed ?? 'random',
        },
      }).catch(console.error);
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
      notify('已保存到画师串');
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
      <WorkspaceToolbar className="relative z-20">
        <div className="flex gap-2 md:hidden">
          <span title={isAitagConnected ? '连接正常' : '当前使用本地缓存'} className={`mt-4 h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') handleSearch(); }} placeholder="搜索 AITag 作品" />
          <MobileIconButton label="AITag 筛选" onClick={() => setShowMobileFilters(true)} className="border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"><Menu className="h-5 w-5" /></MobileIconButton>
          <MobileIconButton label="刷新" onClick={() => loadWorks(page, { resetScroll: true })} disabled={isLoading} className="border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"><RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} /></MobileIconButton>
          <ImageTaggerAction notify={notify} />
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <span title={isAitagConnected ? 'aitag.win 连接正常' : 'aitag.win 暂时不可用'} className={`h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]' : 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') handleSearch(); }} placeholder="作品、作者、标题或标签" containerClassName="w-[23rem] flex-none" />
          <ToolbarSearch value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') handleSearch(); }} placeholder="Prompt" containerClassName="w-[18rem] flex-none" />
          <ToolbarButton onClick={() => setShowDesktopFilters(value => !value)} className={showDesktopFilters ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600' : ''}><Filter className="h-4 w-4" />筛选</ToolbarButton>
          <ToolbarButton tone="primary" onClick={handleSearch} disabled={isLoading}><Search className="h-4 w-4" />搜索</ToolbarButton>
          <div className="ml-auto hidden items-center gap-2 text-xs text-gray-500 xl:flex"><span>{page} / {totalPages} 页</span><span>{formatCount(total)} 条</span></div>
          <IconButton label="刷新" onClick={() => loadWorks(page, { resetScroll: true })} disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
          <ImageTaggerAction notify={notify} />
        </div>
        {showDesktopFilters && <div className="absolute right-5 top-full z-50 hidden w-[520px] rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800 md:block">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900 dark:text-white">AITag 筛选</h2><button type="button" onClick={() => setShowDesktopFilters(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">×</button></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500 dark:text-gray-400">类型<select value={aiType} onChange={e => handleAiTypeChange(e.target.value as AitagAiType)} disabled={isLoading} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-white"><option value="all">全部</option><option value="nai">NAI</option><option value="sd">SD</option><option value="comfyui">ComfyUI</option></select></label>
            <label className="text-xs text-gray-500 dark:text-gray-400">缓存<select value={cacheFilter} onChange={e => handleCacheFilterChange(e.target.value as AitagCacheFilter)} disabled={isLoading} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-white"><option value="all">全部</option><option value="favorite">收藏</option><option value="full">已缓存全部</option><option value="first-image">已缓存首图</option></select></label>
            <label className="text-xs text-gray-500 dark:text-gray-400">排序<select value={sort} onChange={e => handleSortChange(e.target.value as AitagSort)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-white"><option value="new">最新</option><option value="monthly">月榜</option></select></label>
            <label className="text-xs text-gray-500 dark:text-gray-400">月份<select value={sort === 'monthly' ? rankMonth : ''} onChange={e => handleRankMonthChange(e.target.value)} disabled={isLoading || sort !== 'monthly'} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-white"><option value="">无需月份</option><option value="current">当前月份</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">更早</option></select></label>
          </div>
          <button type="button" onClick={() => { handleSearch(); setShowDesktopFilters(false); }} className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500">应用筛选</button>
        </div>}
      </WorkspaceToolbar>
      <MobileBottomSheet open={showMobileFilters} title="AITag 筛选" onClose={() => setShowMobileFilters(false)} footer={<button onClick={() => { handleSearch(); setShowMobileFilters(false); }} className="mobile-touch w-full rounded-xl bg-indigo-600 font-bold text-white">应用筛选</button>}>
        <div className="space-y-4">
          <label className="block text-sm font-bold dark:text-white">Prompt 搜索<input value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="搜索 NAI/SD 元数据 Prompt" className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-700 dark:bg-gray-800" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-bold dark:text-white">类型<select value={aiType} onChange={event => handleAiTypeChange(event.target.value as AitagAiType)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-700 dark:bg-gray-800"><option value="all">全部</option><option value="nai">NAI</option><option value="sd">SD</option><option value="comfyui">ComfyUI</option></select></label>
            <label className="text-sm font-bold dark:text-white">缓存<select value={cacheFilter} onChange={event => handleCacheFilterChange(event.target.value as AitagCacheFilter)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-700 dark:bg-gray-800"><option value="all">全部</option><option value="favorite">收藏</option><option value="full">已缓存全部</option><option value="first-image">已缓存首图</option></select></label>
            <label className="text-sm font-bold dark:text-white">排序<select value={sort} onChange={event => handleSortChange(event.target.value as AitagSort)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-700 dark:bg-gray-800"><option value="new">最新</option><option value="monthly">月榜</option></select></label>
            <label className="text-sm font-bold dark:text-white">月份<select value={sort === 'monthly' ? rankMonth : ''} disabled={sort !== 'monthly'} onChange={event => handleRankMonthChange(event.target.value)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800"><option value="current">当前月份</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">更早</option></select></label>
          </div>
          <div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">第 {page} / {totalPages} 页 · 共 {formatCount(total)} 条</div>
        </div>
      </MobileBottomSheet>

      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selectedWork ? 'xl:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main
          ref={mainScrollRef}
          onScroll={cacheScrollPositions}
          className="min-h-0 overflow-y-auto p-4 md:p-6"
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
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-aitag-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {visibleItems.map(work => {
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

                return (
                  <div
                    key={work.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadDetail(work)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        loadDetail(work);
                      }
                    }}
                    className={`mobile-gallery-item group relative text-left rounded-lg overflow-hidden border transition-colors flex flex-col h-full ${cardTone.card} ${
                      isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : cardTone.border
                    }`}
                  >
                    <div className={`mobile-gallery-frame md:aspect-square relative overflow-hidden ${cardTone.image}`} style={{ '--mobile-image-ratio': '1' } as React.CSSProperties}>
                      <AitagPreviewImage work={work} detail={details[work.id]} />
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold">
                        {type || 'AI'}
                      </div>
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px]">
                        {imageCount}P
                      </div>
                    </div>
                    <div className="p-3 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1" title={work.title}>
                          {work.title || `#${work.id}`}
                        </div>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            toggleFavorite(work);
                          }}
                          onKeyDown={e => {
                            e.stopPropagation();
                          }}
                          title={isFavorite ? '取消收藏' : '收藏'}
                          aria-label={isFavorite ? '取消收藏' : '收藏'}
                          className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center shadow transition-colors ${
                            isFavorite
                              ? 'border-rose-400 bg-rose-500 text-white hover:bg-rose-400'
                              : 'border-white/60 bg-black/30 text-gray-500 dark:text-white/85 hover:bg-black/45 hover:text-gray-800 dark:hover:text-white'
                          }`}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.8 4.6c-1.7-1.7-4.5-1.7-6.2 0L12 7.2 9.4 4.6c-1.7-1.7-4.5-1.7-6.2 0s-1.7 4.5 0 6.2L12 19.6l8.8-8.8c1.7-1.7 1.7-4.5 0-6.2z" />
                          </svg>
                        </button>
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
              })}
            </div>
          )}

          <div className="flex justify-center items-center gap-2 py-6">
            <button
              onClick={() => loadWorks(Math.max(1, page - 1), { resetScroll: true })}
              disabled={isLoading || page <= 1}
              className="mobile-touch px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-50"
            >
              上一页
            </button>
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
                className="w-24 px-2 py-2 rounded border border-indigo-400 dark:border-indigo-500 bg-white dark:bg-gray-900 text-center text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
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
                className="mobile-touch min-w-24 px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
              >
                {page} / {totalPages}
              </button>
            )}
            <button
              onClick={() => loadWorks(page + 1, { resetScroll: true })}
              disabled={isLoading || !hasNextPage}
              className="mobile-touch px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
          <div className="flex justify-center pb-6 -mt-3">
            <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              <span title="当前筛选下已经成功保存到本地的第一张图数量">首图保存 {formatCount(cacheStatus?.firstImagesCount ?? cacheStatus?.coversCount ?? 0)}</span>
              <span title="已经点开并完整保存详情 JSON 的作品数">完整保存 {formatCount(cacheStatus?.detailsCount || 0)}</span>
              {isOfflineCache && <span className="text-amber-600 dark:text-amber-300">本地缓存模式</span>}
            </div>
          </div>
        </main>

        <aside className={`aitag-detail-panel ${selectedWork ? 'aitag-detail-panel--open flex md:flex' : 'aitag-detail-panel--closed hidden md:hidden'} fixed inset-0 z-[1050] min-h-0 flex-col border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 md:static md:z-auto md:border-t xl:border-l xl:border-t-0`}>
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-1">
              <MobileIconButton label="返回作品列表" onClick={closeMobileDetail} className="aitag-detail-back md:hidden"><ArrowLeft className="h-5 w-5" /></MobileIconButton>
              <div className="min-w-0">
              <div className="font-bold text-gray-900 dark:text-white truncate max-w-[300px]">
                {selectedWork?.title || '作品详情'}
              </div>
              {selectedWork && (
                <div className="text-xs text-gray-500 mt-0.5">#{selectedWork.id} · {getAitagType(selectedWork)}</div>
              )}
              </div>
            </div>
            {selectedWork && (
              <div className="flex items-center gap-2">
                <a href={getAitagUrl(selectedWork)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs hover:bg-gray-200 dark:hover:bg-gray-700">
                  aitag
                </a>
                <a href={getPixivUrl(selectedWork)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs hover:bg-gray-200 dark:hover:bg-gray-700">
                  Pixiv
                </a>
                <button type="button" onClick={() => setSelectedId(null)} className="hidden h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 md:flex" aria-label="关闭作品详情" title="关闭作品详情"><X className="h-4 w-4" /></button>
              </div>
            )}
          </div>

          <div
            ref={detailScrollRef}
            onScroll={cacheScrollPositions}
            className="flex-1 min-h-0 overflow-y-auto p-4"
          >
            {!selectedWork ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
                选择左侧作品后，这里会显示所有图片和操作按钮
              </div>
            ) : isDetailLoading && !selectedDetail ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">加载详情中...</div>
            ) : selectedDetail ? (
              <div className="space-y-4">
                {selectedDetail.images
                  .slice()
                  .sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }))
                  .map((image, index) => {
                    const promptText = extractAitagPrompt(image);
                    const generationLabels = getAitagGenerationLabels(image);
                    const modelLabel = getAitagModelLabel(image);

                    return (
                      <div key={image.id || `${image.work_id}-${image.file_name}`} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden">
                        <OriginalImage src={buildAitagImageUrl(image)} alt="" className="w-full max-h-[520px] object-contain bg-black/5 dark:bg-black/20" loading="lazy" />
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
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveAsArtistChain(image, index)}
                                title="保存到画师串"
                                aria-label="保存到画师串"
                                className="w-10 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow transition-colors"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                              </button>
                              <button
                                onClick={() => saveToInspiration(image, index)}
                                title="加入灵感库"
                                aria-label="加入灵感库"
                                className="w-10 h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex items-center justify-center shadow transition-colors"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.16c.969 0 1.371 1.24.588 1.81l-3.365 2.444a1 1 0 00-.364 1.118l1.285 3.956c.3.922-.755 1.688-1.539 1.118l-3.365-2.444a1 1 0 00-1.176 0L8.046 18.02c-.784.57-1.838-.196-1.539-1.118l1.285-3.956a1 1 0 00-.364-1.118L4.063 9.384c-.783-.57-.38-1.81.588-1.81h4.16a1 1 0 00.95-.69l1.286-3.957z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => importToPlayground(image)}
                                title="导入实验室"
                                aria-label="导入实验室"
                                className="w-10 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow transition-colors"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3h6m-5 0v5.5L4.8 18.1A2 2 0 006.55 21h10.9a2 2 0 001.75-2.9L14 8.5V3m-4 10h4" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="text-xs font-mono text-gray-700 dark:text-gray-300 leading-relaxed bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-28 overflow-y-auto custom-scrollbar break-words">
                            {promptText || <span className="text-gray-400">无 prompt_text</span>}
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
          </div>
        </aside>
      </div>
    </div>
  );
};
