import { PromptLibraryCaptureButton } from './PromptLibraryAccess';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { t, useLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';
import { ViewableImage } from './ImageLightbox';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AitagCacheStatus,
  AitagImage,
  AitagWorkDetail,
  AitagWorkSummary,
  aitagPromptHasArtistTags,
  aitagService,
  buildAitagChainDescription,
  buildAitagImageUrl,
  buildAitagPreviewUrl,
  extractAitagPrompt,
  getAitagGenerationLabels,
  getAitagMetadataText,
  getAitagModelLabel,
  getAitagSavedChainWorkIds,
  getAitagType,
  getAitagWorkPromptTexts,
  hasAitagLocalPromptTerms,
  matchesAitagPromptQuery,
  parseAitagAiJson,
  parseAitagPromptQuery,
} from '../services/aitagService';
import { getArtistSampleDictionary } from '../services/artistSamples';
import { normalizeRollArtistKey } from '../services/styleRollSeed';
import { IMPORT_SESSION_KEY, parseNovelAIMetadata, type BaseImageImport } from '../services/metadataService';
import { NAIParams, PromptChain, User, type ImageEditOperation } from '../types';
import { SmartImage } from './SmartImage';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { MobileBottomSheet, MobileIconButton, useMobileHistoryLayer } from './MobileUI';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useStaleGuard } from './useStaleGuard';
import { ExternalLink, Filter, FlaskConical, ImagePlus, Layers, LoaderCircle, X } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarLink, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel } from './DetailPanel';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGalleryLoadMore } from './useGalleryLoadMore';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { AnchoredToolbarPopover, ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageShareOverlay } from './ImageShareActions';
import { collectionSnapshot, subscribeCollection, aitagCollectionImages, type CollectionTarget } from '../services/collectionFavorites';
import { buildMediaUrl, getMobileOriginalUrl } from '../services/mobileImageCache';

interface AitagGalleryProps {
  active: boolean;
  selectionFocusEnabled?: boolean;
  currentUser: User;
  notify: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onNavigateToChains?: () => void;
  onCreateArtistChain: (chain: PromptChain, options?: { openEditor?: boolean }) => Promise<void>;
  onRefreshInspiration?: () => void;
  /** 当前风格串列表，用于筛选已保存到风格串的作品。 */
  chains?: PromptChain[];
}

const PAGE_SIZE = 60;
const FIRST_IMAGE_IDLE_DELAYS_MS = [1500, 3000, 6000];
/** 依赖元数据的筛选等待后台补齐首图信息的上限；超时后按无法判断处理，不再阻挡后续加载。 */
const METADATA_WAIT_MS = 120_000;

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
type AitagArtistFilter = 'all' | 'with' | 'without';
type AitagChainFilter = 'all' | 'saved' | 'unsaved';

/** 服务端查询条件签名：追加加载只接在同一组条件的结果之后。 */
const buildAitagQuerySignature = (q: string, prompt: string, sort: string, rankMonth: string, cacheFilter: string) =>
  `${q}|${prompt}|${sort}|${rankMonth}|${cacheFilter}`;

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

const getAitagImageRatio = (image?: AitagImage) => {
  const metadata = parseAitagAiJson(image?.ai_json);
  const comment = parseAitagAiJson(metadata?.Comment ?? metadata?.comment);
  const width = Number(comment?.width ?? metadata?.width);
  const height = Number(comment?.height ?? metadata?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : undefined;
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

/**
 * aitag.win 列表不带首图元数据，由后端逐个补齐；补齐前模型、画师串和提示词细筛无法判断。
 * 首图缓存失败（error）视为已有结论，不再等待。
 */
const isAitagMetadataPending = (work: AitagWorkSummary) => (
  !(work.firstImage || work.first_image)
  && String(work.firstImageStatus || work.cover_status || '').toLowerCase() !== 'error'
);

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
  <div className="appearance-media absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-100 px-3 dark:bg-gray-800">
    <span className="text-meta text-gray-400">{t("图片加载失败")}</span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onRetry(); }}
        onKeyDown={event => { event.stopPropagation(); }}
        className="appearance-group rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        {t("重试")}</button>
      <a
        href={getAitagUrl(work)}
        target="_blank"
        rel="noreferrer"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { event.stopPropagation(); }}
        className="appearance-group rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-indigo-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-400"
      >
        {t("打开原页")}</a>
    </div>
  </div>
);

const AitagPreviewImage: React.FC<{ work: AitagWorkSummary; detail?: AitagWorkDetail; imageFit: 'contain' | 'cover'; onImageLoad?: (width: number, height: number) => void; onResolveFirstImage: () => void; notify: AitagGalleryProps['notify']; favorite: CollectionTarget; onFavoriteChange: (active: boolean) => void }> = ({ work, detail, imageFit, onImageLoad, onResolveFirstImage, notify, favorite, onFavoriteChange }) => {
  useLanguage();
  const firstImage = work.firstImage;
  const legacyFirstImage = work.first_image;
  const detailImage = detail?.images?.[0];
  // 详情缓存完成后的本地首图优先于远程源；按实际地址建立签名，
  // 无关的收藏／比例重渲染保留失败进度，新增本地源才重新选择。
  const candidates = uniqueUrls([
    work.localFirstImageUrl || '',
    work.local_cover_url || '',
    firstImage?.local_image_url || '',
    legacyFirstImage?.local_image_url || '',
    detailImage?.local_image_url || '',
    firstImage ? buildAitagImageUrl(firstImage) : '',
    legacyFirstImage ? buildAitagImageUrl(legacyFirstImage) : '',
    detailImage ? buildAitagImageUrl(detailImage) : '',
    work.remoteFirstImageUrl || '',
    work.remote_cover_url || '',
    buildAitagPreviewUrl(work),
  ]);
  const candidatesKey = JSON.stringify(candidates);
  const [candidatePosition, setCandidatePosition] = useState({ key: candidatesKey, index: 0 });
  // 缓存完成后的新候选优先从本地首图开始，旧候选的失败进度不能挡住新源。
  const index = candidatePosition.key === candidatesKey ? candidatePosition.index : 0;
  // 显式重试意图：候选源变化时重置 index；用户点「重试」时把 key 重置以清掉 SmartImage 失败态
  const [retryKey, setRetryKey] = useState(0);

  const src = candidates[index] || '';

  if (!candidates.length) {
    return <div className="appearance-media w-full h-full bg-gray-200 dark:bg-gray-800" />;
  }
  if (index >= candidates.length) {
    return <AitagPreviewFallback work={work} onRetry={() => { setCandidatePosition({ key: candidatesKey, index: 0 }); setRetryKey(value => value + 1); }} />;
  }
  return (<>
    <SmartImage
      key={retryKey}
      src={src}
      alt=""
      className={`w-full h-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
      onLoad={event => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onImageLoad?.(image.naturalWidth, image.naturalHeight);
        }
      }}
      onError={() => {
        // 只在候选内前进：耗尽后不再自增，渲染上面的占位而不是空白
        setCandidatePosition(current => ({ key: candidatesKey, index: Math.min((current.key === candidatesKey ? current.index : 0) + 1, candidates.length) }));
        // 列表猜测的 p0 未必存在；缺少首图元数据时复用详情请求取得真实文件名。
        if (index === candidates.length - 1 && !detailImage && !firstImage && !legacyFirstImage) {
          onResolveFirstImage();
        }
      }}
    />
    <ImageShareOverlay imageUrl={getMobileOriginalUrl(src)} filename={`aitag-${work.id}-p1.png`} notify={notify} favorite={favorite} onFavoriteChange={onFavoriteChange} />
  </>);
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
  /** 最近一次实际检索使用的关键词与提示词条件；输入框未提交的修改不显示为生效条件，也不参与本地细筛。 */
  appliedQ: string;
  appliedPrompt: string;
  modelFilter: string;
  artistFilter: AitagArtistFilter;
  chainFilter: AitagChainFilter;
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
  appliedQ: '',
  appliedPrompt: '',
  modelFilter: '',
  artistFilter: 'all',
  chainFilter: 'all',
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

export const AitagGallery: React.FC<AitagGalleryProps> = ({ active, selectionFocusEnabled = true, currentUser, notify, onNavigateToPlayground, onNavigateToChains, onCreateArtistChain, onRefreshInspiration, chains }) => {
  useLanguage();
  const imageDisplay = useMobileImageDisplayPreferences('aitag');
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const galleryContentRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(aitagPageCache.hasLoaded);
  const cancelPageInputRef = useRef(false);
  const cacheStatusRefreshTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<AitagWorkSummary[]>(() => aitagPageCache.items);
  const [details, setDetails] = useState<Record<number, AitagWorkDetail>>(() => aitagPageCache.details);
  const [selectedId, setSelectedId] = useState<number | null>(() => aitagPageCache.selectedId);
  const selectionAnchor = useGallerySelectionAnchor(mainScrollRef, galleryContentRef, selectedId, active, selectionFocusEnabled);
  const onMainScrollRestore = useKeepAliveScrollRestore(mainScrollRef, 'aitag', { skipRestore: selectionAnchor.hasAnchor });
  // 换作品从对应作品的详情位置起步；切页返回则保留同一作品的位置。
  useLayoutEffect(() => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  }, [selectedId]);
  const onDetailScrollRestore = useKeepAliveScrollRestore(detailScrollRef, `aitag-detail-${selectedId}`, { skipRestore: selectedId === null });
  const [q, setQ] = useState(() => aitagPageCache.q);
  const [prompt, setPrompt] = useState(() => aitagPageCache.prompt);
  const [sort, setSort] = useState<AitagSort>(() => aitagPageCache.sort);
  const [rankMonth, setRankMonth] = useState(() => aitagPageCache.rankMonth);
  const [availableMonths, setAvailableMonths] = useState<string[]>(() => aitagPageCache.availableMonths);
  const [cacheFilter, setCacheFilter] = useState<AitagCacheFilter>(() => aitagPageCache.cacheFilter);
  const [appliedQ, setAppliedQ] = useState(() => aitagPageCache.appliedQ);
  const [appliedPrompt, setAppliedPrompt] = useState(() => aitagPageCache.appliedPrompt);
  const [artistFilter, setArtistFilter] = useState<AitagArtistFilter>(() => aitagPageCache.artistFilter);
  const [chainFilter, setChainFilter] = useState<AitagChainFilter>(() => aitagPageCache.chainFilter);
  const [knownArtists, setKnownArtists] = useState<ReadonlySet<string> | null>(null);
  const [page, setPage] = useState(() => aitagPageCache.page);
  const [total, setTotal] = useState(() => aitagPageCache.total);
  const [cacheStatus, setCacheStatus] = useState<AitagCacheStatus | null>(() => aitagPageCache.cacheStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);
  const appendRun = useRef(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const savingImageRef = useRef<string | null>(null);
  const [savingImage, setSavingImage] = useState<string | null>(null);
  const savedBatchImages = useRef(new Set<string>());
  const batchDetailWork = useRef<number | null>(null);
  const [navigateAfterSave, setNavigateAfterSave] = useState(() => {
    try { return localStorage.getItem('nai_aitag_navigate_after_save') !== 'false'; } catch { return true; }
  });
  const [batchProgress, setBatchProgress] = useState<{ workId: number; completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(() => aitagPageCache.error);
  const [isOfflineCache, setIsOfflineCache] = useState(() => aitagPageCache.isOfflineCache);
  const [isPageInputOpen, setIsPageInputOpen] = useState(false);
  const [pageInputValue, setPageInputValue] = useState(String(aitagPageCache.page));
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');

  const selectedDetail = selectedId ? details[selectedId] : null;
  const selectedImages = useMemo(() => {
    if (!selectedDetail) return [];
    const favorites = aitagCollectionImages(selectedDetail);
    return selectedDetail.images
      .map((image, index) => ({ image, favorite: favorites[index] }))
      .sort((a, b) => a.image.file_name.localeCompare(b.image.file_name, undefined, { numeric: true }));
  }, [selectedDetail]);
  const selectedWork = selectedDetail?.work || items.find(item => item.id === selectedId) || null;
  const closeDetail = () => {
    batchDetailWork.current = null;
    selectionAnchor.preserveOnClose();
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSelectedId(null);
  };
  const closeMobileDetail = useMobileHistoryLayer(active && Boolean(selectedWork), closeDetail, 'aitag-detail');

  // 模型、画师串、风格串与提示词细筛作用于已加载/已缓存的条目（按首图或已加载详情的元数据判断），
  // 选项改变即时生效；服务端检索条件（关键词、提示词主条件、缓存、排序、月份）仍按页拉取。
  const [modelFilter, setModelFilter] = useState(() => aitagPageCache.modelFilter);
  const getWorkModelLabel = (work: AitagWorkSummary) => {
    const image = work.firstImage || work.first_image;
    return image ? getAitagModelLabel(image) : '';
  };
  const modelOptions = useMemo(
    () => Array.from(new Set(items.map(getWorkModelLabel).filter(Boolean))).sort(),
    [items],
  );
  const savedChainWorkIds = useMemo(() => getAitagSavedChainWorkIds(chains), [chains]);
  const promptQuery = useMemo(() => parseAitagPromptQuery(appliedPrompt), [appliedPrompt]);
  const remotePrompt = useMemo(() => parseAitagPromptQuery(prompt).remote, [prompt]);
  const hasLocalPromptTerms = hasAitagLocalPromptTerms(promptQuery);
  const metadataFilterActive = Boolean(modelFilter) || artistFilter !== 'all' || hasLocalPromptTerms;
  const hasLocalFilter = metadataFilterActive || chainFilter !== 'all';
  // 等待超时仍未补齐元数据的作品不再计为待定，避免一直暂停后续加载。
  const [metadataGiveUpIds, setMetadataGiveUpIds] = useState<ReadonlySet<number>>(() => new Set());
  const isWorkMetadataPending = (work: AitagWorkSummary) => (
    metadataFilterActive && !isOfflineCache && cacheFilter === 'all' && isAitagMetadataPending(work) && !metadataGiveUpIds.has(Number(work.id))
  );
  const pendingMetadataItems = metadataFilterActive ? items.filter(isWorkMetadataPending) : [];
  // 轮询循环跨多批运行，从这里读取最新的待补齐作品，补入尚未轮询的部分。
  const pendingMetadataIdsRef = useRef<number[]>([]);
  useEffect(() => {
    pendingMetadataIdsRef.current = pendingMetadataItems.map(item => Number(item.id)).filter(Number.isFinite);
  });
  // 裸画师名需要词库识别；只在启用画师串筛选时读取一次，读取前先按 artist: 等显式前缀判断。
  useEffect(() => {
    if (artistFilter === 'all' || knownArtists) return;
    let current = true;
    getArtistSampleDictionary()
      .then(entries => { if (current) setKnownArtists(new Set(entries.map(entry => normalizeRollArtistKey(entry.name)))); })
      .catch(() => { if (current) setKnownArtists(new Set()); });
    return () => { current = false; };
  }, [artistFilter, knownArtists]);
  const matchesLocalFilters = (work: AitagWorkSummary, ignoreChainFilter = false) => {
    const detail = details[work.id];
    // 没有任何元数据时无法判断模型、画师串或提示词，先隐藏，补齐后再按条件显示。
    if (metadataFilterActive && !(work.firstImage || work.first_image) && !(detail && !detail.isPreviewOnly && detail.images.length)) return false;
    if (modelFilter && getWorkModelLabel(work) !== modelFilter) return false;
    if (!ignoreChainFilter && chainFilter !== 'all' && savedChainWorkIds.has(Number(work.id)) !== (chainFilter === 'saved')) return false;
    if (artistFilter === 'all' && !hasLocalPromptTerms) return true;
    const texts = getAitagWorkPromptTexts(work, detail);
    if (artistFilter !== 'all' && texts.some(text => aitagPromptHasArtistTags(text, knownArtists)) !== (artistFilter === 'with')) return false;
    return matchesAitagPromptQuery(texts, promptQuery);
  };
  const visibleItems = hasLocalFilter ? items.filter(work => matchesLocalFilters(work)) : items;
  // 筛选或取消收藏移走当前作品时，不留下找不到目标的暗态与详情。
  useEffect(() => {
    if (!isLoading && selectedId !== null && !visibleItems.some(work => work.id === selectedId)) {
      // 本轮保存只改变「未存」归属时保留详情，供查看结果与重试；其他筛选仍正常清选。
      if (chainFilter === 'unsaved' && batchDetailWork.current === selectedId && items.some(work => work.id === selectedId && matchesLocalFilters(work, true))) return;
      selectionAnchor.clearAnchor();
      aitagPageCache = { ...aitagPageCache, selectedId: null };
      setSelectedId(null);
    }
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNextPage = page < totalPages;

  // 瀑布流（masonry 布局时）：图片加载后按真实宽高比完整显示，最短列分配互相补齐。
  const [aitagRatios, setAitagRatios] = useState<Record<number, number>>(() => ({ ...aitagRatioCache }));
  const masonryColumns = useMasonryColumnCount(imageDisplay, undefined, galleryContentRef);
  const frostedCaption = useGalleryFrostedCaption();
  const estimateAitagCardHeight = React.useCallback((work: AitagWorkSummary, columnWidth: number) => {
    const image = work.firstImage || work.first_image || details[work.id]?.images[0];
    const ratio = aitagRatios[work.id] || aitagRatioCache[work.id] || getAitagImageRatio(image) || 1;
    const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
    return imageHeight + (frostedCaption ? 2 : 70);
  }, [aitagRatios, details, frostedCaption]);
  const renderAitagCard = (work: AitagWorkSummary) => {
    const type = getAitagType(work);
    const isSelected = selectedId === work.id;
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
    const firstImage = work.firstImage || work.first_image || detail?.images[0];
    const measuredRatio = aitagRatios[work.id] || aitagRatioCache[work.id] || getAitagImageRatio(firstImage);
    const ratioStyle = measuredRatio ? `${Math.round(measuredRatio * 1000)} / 1000` : '1';
    return (
      <PressRevealSurface
        key={work.id}
        data-safe-mode-work="true"
        data-gallery-work-id={work.id}
        role="button"
        aria-pressed={isSelected}
        aria-label={t("查看作品 {0}", [work.title || `#${work.id}`])}
        tabIndex={0}
        onClick={() => loadDetail(work)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            loadDetail(work);
          }
        }}
        className={`mobile-gallery-item gallery-image-card gallery-card-visual group relative text-left rounded-lg overflow-hidden border transition-[filter,box-shadow,border-color] duration-150 flex flex-col ${cardTone.card} ${selectionFocusEnabled && selectedId !== null && !isSelected ? 'brightness-[.7]' : ''} ${
          isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : cardTone.border
        }`}
      >
        <div className={`mobile-gallery-frame md:aspect-square relative overflow-hidden ${cardTone.image}`} style={{ '--mobile-image-ratio': ratioStyle } as React.CSSProperties}>
          <AitagPreviewImage
            work={work}
            detail={details[work.id]}
            imageFit={imageDisplay.layout === 'masonry' ? 'contain' : 'cover'}
            notify={notify}
            favorite={{ imageUrl: '', sourceType: 'aitag', sourceId: String(work.id), title: work.title, groupSize: Number(work.image_count || work.imageCount || 1), getGroup: async () => aitagCollectionImages(await getDetail(work)) }}
            onFavoriteChange={active => updateWorkFavorite(work, active)}
            onResolveFirstImage={() => { void getDetail(work).catch(console.error); }}
            onImageLoad={(width, height) => {
              const ratio = width / Math.max(1, height);
              if (Number.isFinite(ratio) && ratio > 0 && aitagRatios[work.id] !== ratio) {
                aitagRatioCache[work.id] = ratio;
                setAitagRatios(previous => (previous[work.id] === ratio ? previous : { ...previous, [work.id]: ratio }));
              }
            }}
          />
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-micro font-bold">
            {type || 'AI'}
          </div>
          {!frostedCaption && <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-micro">
            {t('{0}页', [imageCount])}
          </div>}
        </div>
        <div className="gallery-card-caption p-3 flex-1">
          <div className="flex items-center gap-2">
            {cacheLevel !== 'none' && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${cardTone.marker}`} />}
            <div data-safe-mode-title="true" className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1">
              {work.title || `#${work.id}`}
            </div>
          </div>
          <div className="gallery-card-meta mt-1 flex min-w-0 items-center gap-2 text-meta text-gray-500 dark:text-gray-400 overflow-hidden">
            <span className="truncate">#{work.id}</span>
            <span className="whitespace-nowrap">{t("阅 {0}", [formatCount(work.total_view)])}</span>
            <span className="whitespace-nowrap">{t("藏 {0}", [formatCount(work.total_bookmarks)])}</span>
            {frostedCaption && <span className="ml-auto whitespace-nowrap">{t('{0}页', [imageCount])}</span>}
          </div>
        </div>
      </PressRevealSurface>
    );
  };
  const cacheNeedsMoreData = isOfflineCache && visibleItems.length === 0;
  const isAitagConnected = !isOfflineCache && !error;
  const hasPendingFirstImageCache = visibleItems.some(needsFirstImageCacheRefresh) || pendingMetadataItems.length > 0;
  // 一整页作品仍在等待元数据时暂停自动追加：继续拉页只会让后端排队补齐更多作品、频繁请求 aitag.win。
  const metadataBacklogFull = pendingMetadataItems.length >= PAGE_SIZE;
  const allowBackgroundChecks = active && documentVisible;
  const backgroundAllowedRef = useRef(allowBackgroundChecks);
  backgroundAllowedRef.current = allowBackgroundChecks;

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
    selectionAnchor.clearAnchor();
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    onMainScrollRestore();
  };

  // 滚动接近列表底部自动加载下一页（追加模式，与 Pixiv 相同的哨兵机制）：
  // 追加完成后若哨兵仍在视口（用户停在底部/快速滚动）会立即再触发，
  // 实现不间断连续加载；内容增长使哨兵移出视口后自然停止。
  const appendingRef = useRef(false);
  const appendSentinelRef = useRef<HTMLDivElement>(null);
  const querySignatureRef = useRef(aitagPageCache.hasLoaded
    ? buildAitagQuerySignature(aitagPageCache.q, aitagPageCache.prompt, aitagPageCache.sort, aitagPageCache.rankMonth, aitagPageCache.cacheFilter)
    : '');
  // 每次 loadWorks 递增的序号：非追加路径（搜索/筛选/跳页）此前无竞态守卫，慢的旧响应
  // 会覆盖新结果并污染模块级 aitagPageCache；卸载后迟到的响应同样不该再写。
  const loadGuard = useStaleGuard();
  useEffect(() => {
    if (allowBackgroundChecks) return;
    appendRun.current++; appendingRef.current = false;
    setIsAppending(false); setAppendError(null);
  }, [allowBackgroundChecks]);
  // 下一页投机预取：当前页稳定后后台请求下一页，哨兵触底追加时直接消费，
  // 把 JSON 往返从滚动路径上移走。签名与页码都匹配才可消费，过期预取自然作废。
  const prefetchedPageRef = useRef<{ signature: string; page: number; promise: Promise<any> } | null>(null);

  // 签名使用已生效的关键词与提示词：输入框里尚未提交的草稿不影响当前结果的追加加载。
  const getQuerySignature = () => buildAitagQuerySignature(appliedQ, appliedPrompt, sort, rankMonth, cacheFilter);
  const appliedRemotePrompt = useMemo(() => parseAitagPromptQuery(appliedPrompt).remote, [appliedPrompt]);
  const appendNextPage = async () => {
    if (!allowBackgroundChecks || appendingRef.current || isLoading || metadataBacklogFull) return;
    appendingRef.current = true;
    const run = ++appendRun.current;
    setIsAppending(true); setAppendError(null);
    try {
      // 追加循环只在开头取一次守卫序号，且每页让位给用户触发的新加载：
      // 此前每页都 begin()，会持续作废在途的用户搜索，导致搜索结果被静默丢弃
      const appendSeq = loadGuard.begin();
      // 开启本地筛选（模型、画师串、风格串或提示词细筛）时，稀疏命中会导致单页有效结果过少。
      // 采用自适应自动连拉（最多连续批拉 4 页，或满足新增至少 15 个符合筛选的作品），填补视口空白。
      let currentPageToLoad = page + 1;
      let currentTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      // 待补齐元数据的作品可能命中，计入潜在结果，避免为凑数连续拉取更多同样待定的页面。
      const countPotentialItems = (list: AitagWorkSummary[]) => list.filter(work => matchesLocalFilters(work) || isWorkMetadataPending(work)).length;
      const currentVisibleCount = hasLocalFilter ? countPotentialItems(items) : visibleItems.length;
      const targetVisibleCount = hasLocalFilter ? currentVisibleCount + 15 : currentVisibleCount + 1;
      const maxBatchPages = hasLocalFilter ? 4 : 1;
      // 无有效 prompt 的作品被过滤后，整页可能零贡献；此时突破 maxBatchPages 继续连拉，
      // 直到拿到至少一条有效条目（另有上限保护），避免列表空白卡住。
      const maxSkippedPages = 6;
      let pagesFetched = 0;
      let skippedPages = 0;

      while (currentPageToLoad <= currentTotalPages && pagesFetched < maxBatchPages + (skippedPages > 0 ? maxSkippedPages : 0)) {
        if (!loadGuard.isCurrent(appendSeq) || appendRun.current !== run) break;
        const itemsBefore = aitagPageCache.items.length;
        const loadedCount = await loadWorks(currentPageToLoad, { append: true, silent: true, guardSeq: appendSeq });
        if (!loadGuard.isCurrent(appendSeq) || appendRun.current !== run) break;
        pagesFetched++;
        currentPageToLoad++;
        if (loadedCount === undefined || loadedCount === 0) break;
        // 该页条目全部因无有效 prompt 被过滤（零新增）：继续拉下一页填补空白
        if (aitagPageCache.items.length - itemsBefore === 0) {
          skippedPages++;
          currentTotalPages = Math.max(1, Math.ceil(aitagPageCache.total / PAGE_SIZE));
          continue;
        }
        // 如果在筛选模式下已凑足目标增量，则停止连续拉取
        if (!hasLocalFilter || countPotentialItems(aitagPageCache.items) >= targetVisibleCount) {
          break;
        }
        currentTotalPages = Math.max(1, Math.ceil(aitagPageCache.total / PAGE_SIZE));
      }
    } finally {
      if (appendRun.current === run) { appendingRef.current = false; setIsAppending(false); }
    }
  };
  // 页码前进即重新监听：本地筛选可能让新一页全部被隐藏，卡片不变也要能继续追加。
  useGalleryLoadMore(mainScrollRef, appendSentinelRef, allowBackgroundChecks && hasNextPage && !isLoading && !isAppending && !appendError && !metadataBacklogFull, () => { void appendNextPage(); }, '1200px 0px', page);

  const loadWorks = async (
    targetPage = page,
    options: {
      resetScroll?: boolean;
      sortOverride?: AitagSort;
      rankMonthOverride?: string;
      cacheFilterOverride?: AitagCacheFilter;
      qOverride?: string;
      promptOverride?: string;
      silent?: boolean;
      /** 追加模式：下一页内容接到当前列表下方（连续滚动），不替换不回顶。 */
      append?: boolean;
      /** 复用调用方的守卫序号（后台追加连拉共用一次 begin，让位用户加载）。 */
      guardSeq?: number;
    } = {}
  ) => {
    const isAppend = options.append === true;
    if (!isAppend) {
      appendRun.current++; appendingRef.current = false;
      setIsAppending(false); setAppendError(null);
    }
    if (isAppend) {
      const signature = getQuerySignature();
      if (querySignatureRef.current !== signature) return;
    }
    // 追加模式复用 appendNextPage 的守卫序号，避免后台连拉作废用户的前台加载
    const mySeq = options.guardSeq ?? loadGuard.begin();
    const myAppendRun = appendRun.current;
    const isCurrent = () => loadGuard.isCurrent(mySeq) && (!isAppend || appendRun.current === myAppendRun);
    const targetSort = options.sortOverride || sort;
    const targetRankMonth = options.rankMonthOverride || rankMonth;
    const targetTimeRange = getAitagTimeRange(targetSort, targetRankMonth);
    const targetCacheFilter = options.cacheFilterOverride || cacheFilter;
    // 追加、静默刷新沿用已生效条件接续当前结果；主动检索才提交输入框里的草稿。
    const keepAppliedQuery = isAppend || options.silent === true;
    const targetQ = options.qOverride ?? (keepAppliedQuery ? appliedQ : q);
    const targetPrompt = options.promptOverride ?? (keepAppliedQuery ? appliedPrompt : prompt);
    const targetRemotePrompt = options.promptOverride !== undefined
      ? parseAitagPromptQuery(targetPrompt).remote
      : keepAppliedQuery ? appliedRemotePrompt : remotePrompt;
    // 签名按本次实际条件生成：覆盖值在下一次渲染才进入状态，旧值签名会让后续追加全部被丢弃。
    const prefetchSignature = buildAitagQuerySignature(targetQ, targetPrompt, targetSort, targetRankMonth, targetCacheFilter);
    if (!options.silent) setIsLoading(true);
    aitagPageCache = { ...aitagPageCache, error: null };
    setError(null);
    try {
      let data;
      let offline = isAppend && aitagPageCache.isOfflineCache;
      // 命中投机预取（同签名同页）则直接消费；预取失败（null）回退正常请求
      const prefetched = prefetchedPageRef.current;
      if (prefetched && prefetched.signature === prefetchSignature && prefetched.page === targetPage) {
        prefetchedPageRef.current = null;
        data = await prefetched.promise;
      }
      if (!isCurrent()) return;
      if (!data) {
        try {
          if (targetCacheFilter === 'all' && !offline) {
          data = await aitagService.search({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q: targetQ,
            prompt: targetRemotePrompt,
            sort: targetSort,
            timeRange: targetTimeRange,
          });
        } else {
          data = await aitagService.searchCache({
            page: targetPage,
            pageSize: PAGE_SIZE,
            q: targetQ,
            prompt: targetRemotePrompt,
            sort: targetSort,
            cacheFilter: targetCacheFilter,
            timeRange: targetTimeRange,
          });
        }
      } catch (remoteError) {
        if (!isCurrent()) return;
        data = await aitagService.searchCache({
          page: targetPage,
          pageSize: PAGE_SIZE,
          q: targetQ,
          prompt: targetRemotePrompt,
          sort: targetSort,
          cacheFilter: targetCacheFilter,
          timeRange: targetTimeRange,
        });
        offline = true;
        }
      }

      // 等待期间用户又触发了新的加载，或组件已卸载：丢弃过期结果，不写状态也不污染模块级缓存
      if (!isCurrent()) return;

      const nextItems = Array.isArray(data.items) ? data.items : [];
      const reportedTotal = Number(data.total || 0);
      const nextTotal = reportedTotal;
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
        ...(isAppend ? {} : { appliedQ: targetQ, appliedPrompt: targetPrompt }),
      };

      if (!isAppend) {
        querySignatureRef.current = prefetchSignature;
        setMetadataGiveUpIds(new Set());
        setAppliedQ(targetQ);
        setAppliedPrompt(targetPrompt);
      }
      setItems(previous => (isAppend ? [...previous, ...nextItems] : nextItems));
      setTotal(nextTotal);
      setPage(nextPage);
      setCacheStatus(nextStatus);
      setIsOfflineCache(offline);
      setError(nextError);
      if (options.resetScroll) resetScrollPositions();

      // 当前页稳定后后台预取下一页：追加触底时直接消费，省掉 JSON 往返等待
      if (nextItems.length > 0 && nextPage * PAGE_SIZE < nextTotal && backgroundAllowedRef.current) {
        const fetchPrefetchPage = (pageNumber: number) => targetCacheFilter === 'all' && !offline
          ? aitagService.search({ page: pageNumber, pageSize: PAGE_SIZE, q: targetQ, prompt: targetRemotePrompt, sort: targetSort, timeRange: targetTimeRange })
          : aitagService.searchCache({ page: pageNumber, pageSize: PAGE_SIZE, q: targetQ, prompt: targetRemotePrompt, sort: targetSort, cacheFilter: targetCacheFilter, timeRange: targetTimeRange });
        prefetchedPageRef.current = {
          signature: prefetchSignature,
          page: nextPage + 1,
          promise: fetchPrefetchPage(nextPage + 1).catch(() => null),
        };
      }
      return nextItems.length;
    } catch (e: unknown) {
      if (!isCurrent()) return 0;
      const errMessage = e instanceof Error ? e.message : String(e);
      const nextError = errMessage || '本地没有这一页，且当前无法联网获取';
      if (isAppend) { setAppendError(nextError); return 0; }
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
      q: appliedQ,
      prompt: appliedRemotePrompt,
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
    // 筛选把作品全部隐藏时仍要轮询待补齐元数据的作品，否则它们永远无法按条件显示。
    if (!allowBackgroundChecks || isLoading || isOfflineCache || (visibleItems.length === 0 && pendingMetadataItems.length === 0) || !hasPendingFirstImageCache) return;

    let cancelled = false;
    let idleRounds = 0;
    let pollRounds = 0;
    let cancelIdleDelay = () => {};
    const controller = new AbortController();
    // 被筛选暂时隐藏、等待元数据的作品优先轮询。接口单次最多一页，每批有结果后从最新列表补入
    // 尚未轮询的作品，超过一页的待补齐作品也会依次轮到；等待上限按作品各自计算。
    const metadataWaitIds = new Set<number>();
    const metadataReadyIds = new Set<number>();
    const metadataWaitStartedAt = new Map<number, number>();
    const pendingIds = new Set<number>();
    const refillMetadataWaits = () => {
      for (const id of pendingMetadataIdsRef.current) {
        if (pendingIds.size >= PAGE_SIZE) break;
        if (metadataWaitIds.has(id) || metadataReadyIds.has(id)) continue;
        metadataWaitIds.add(id);
        metadataWaitStartedAt.set(id, Date.now());
        pendingIds.add(id);
      }
    };
    refillMetadataWaits();
    for (const item of visibleItems) {
      if (pendingIds.size >= PAGE_SIZE) break;
      const id = Number(item.id);
      if (Number.isFinite(id) && needsFirstImageCacheRefresh(item)) pendingIds.add(id);
    }
    const hasMetadataWaits = () => [...pendingIds].some(id => metadataWaitIds.has(id) && !metadataReadyIds.has(id));
    const giveUpMetadata = (ids: number[]) => {
      ids.forEach(id => pendingIds.delete(id));
      if (!cancelled && ids.length) setMetadataGiveUpIds(previous => new Set([...previous, ...ids]));
    };
    const expireMetadataWaits = () => giveUpMetadata([...pendingIds].filter(id => (
      metadataWaitIds.has(id) && !metadataReadyIds.has(id) && Date.now() - (metadataWaitStartedAt.get(id) ?? 0) >= METADATA_WAIT_MS
    )));
    const giveUpRemainingMetadata = () => giveUpMetadata([...pendingIds].filter(id => metadataWaitIds.has(id) && !metadataReadyIds.has(id)));

    const waitForFirstImages = async () => {
      while (!cancelled && pendingIds.size > 0 && (pollRounds < 4 || hasMetadataWaits())) {
        if (!hasMetadataWaits()) pollRounds++;
        try {
          const data = await aitagService.waitForFirstImageCache({
            ids: Array.from(pendingIds),
            metadataIds: Array.from(pendingIds).filter(id => metadataWaitIds.has(id) && !metadataReadyIds.has(id)),
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
            nextItems.forEach(item => {
              const id = Number(item.id);
              if (!isAitagMetadataPending(item)) metadataReadyIds.add(id);
              if (!needsFirstImageCacheRefresh(item) || String(item.firstImageStatus || item.cover_status || '').toLowerCase() === 'error') pendingIds.delete(id);
            });
            mergeCachedFirstImageItems(nextItems);
            // 已有首图缓存却仍缺元数据的作品无法再等到结果，按无法判断处理，不占用待补齐名额。
            giveUpMetadata(nextItems.filter(item => isAitagMetadataPending(item) && (!needsFirstImageCacheRefresh(item) || String(item.firstImageStatus || item.cover_status || '').toLowerCase() === 'error')).map(item => Number(item.id)).filter(id => metadataWaitIds.has(id)));
            if (data.status) {
              setCacheStatus(data.status);
              aitagPageCache = { ...aitagPageCache, cacheStatus: data.status };
            } else {
              scheduleCacheStatusRefresh();
            }
          } else {
            if (idleRounds >= FIRST_IMAGE_IDLE_DELAYS_MS.length) {
              if (hasMetadataWaits()) {
                // 后端仍在逐个补齐：沿用最长间隔继续等待，不提前放弃隐藏的作品。
                idleRounds = FIRST_IMAGE_IDLE_DELAYS_MS.length - 1;
              } else {
                await refreshCurrentPageFromCache().catch(console.error);
                giveUpRemainingMetadata();
                return;
              }
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
          expireMetadataWaits();
          refillMetadataWaits();
        } catch (e) {
          if (cancelled) return;
          await refreshCurrentPageFromCache().catch(console.error);
          giveUpRemainingMetadata();
          return;
        }
      }
      if (!cancelled && pendingIds.size > 0) await refreshCurrentPageFromCache().catch(console.error);
      giveUpRemainingMetadata();
    };

    waitForFirstImages().catch(console.error);
    return () => {
      cancelled = true;
      controller.abort();
      cancelIdleDelay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedQ, appliedPrompt, sort, rankMonth, cacheFilter, isLoading, isOfflineCache, hasPendingFirstImageCache, metadataFilterActive, allowBackgroundChecks]);

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
      appliedQ,
      appliedPrompt,
      modelFilter,
      artistFilter,
      chainFilter,
      page,
      total,
      error,
      cacheStatus,
      isOfflineCache,
      hasLoaded: hasLoadedRef.current,
    };
  }, [items, details, selectedId, q, prompt, sort, rankMonth, availableMonths, cacheFilter, appliedQ, appliedPrompt, modelFilter, artistFilter, chainFilter, page, total, error, cacheStatus, isOfflineCache]);

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

  /** 本地筛选即时生效；主动改变条件时从新结果顶部开始浏览。 */
  const changeLocalFilter = (apply: () => void) => {
    batchDetailWork.current = null;
    apply();
    resetScrollPositions();
  };

  /** 清除单个服务端检索条件并立即重新检索；另一项回到已生效的值，不顺带提交未应用的草稿。 */
  const clearSearchText = (field: 'q' | 'prompt') => {
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSelectedId(null);
    const nextQ = field === 'q' ? '' : appliedQ;
    const nextPrompt = field === 'prompt' ? '' : appliedPrompt;
    setQ(nextQ);
    setPrompt(nextPrompt);
    loadWorks(1, { resetScroll: true, qOverride: nextQ, promptOverride: nextPrompt });
  };

  const resetFilters = () => {
    aitagPageCache = { ...aitagPageCache, selectedId: null };
    setSelectedId(null);
    setQ('');
    setPrompt('');
    setCacheFilter('all');
    setSort('new');
    setRankMonth('current');
    setModelFilter('');
    setArtistFilter('all');
    setChainFilter('all');
    loadWorks(1, { resetScroll: true, qOverride: '', promptOverride: '', cacheFilterOverride: 'all', sortOverride: 'new', rankMonthOverride: 'current' });
    refreshCacheStatus('new', 'current').catch(console.error);
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

  useEffect(() => {
    const sync = () => {
      const states = new Map<string, boolean>();
      for (const item of collectionSnapshot()) if (item.sourceType === 'aitag' && item.sourceId) states.set(item.sourceId, Boolean(states.get(item.sourceId) || !item.archived));
      setItems(previous => previous.map(work => states.has(String(work.id)) ? { ...work, isFavorite: states.get(String(work.id)), is_favorite: states.get(String(work.id)) ? 1 : 0 } : work).filter(work => cacheFilter !== 'favorite' || isAitagFavorite(work)));
    };
    sync(); return subscribeCollection(sync);
  }, [cacheFilter]);

  const updateWorkFavorite = (work: AitagWorkSummary, active: boolean) => {
    setItems(previous => {
      const next = previous.map(item => item.id === work.id ? { ...item, isFavorite: active, is_favorite: active ? 1 : 0 } : item).filter(item => cacheFilter !== 'favorite' || isAitagFavorite(item));
      aitagPageCache = { ...aitagPageCache, items: next };
      return next;
    });
    onRefreshInspiration?.();
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
      selectionAnchor.clearAnchor();
      aitagPageCache = { ...aitagPageCache, selectedId: null };
      setSelectedId(null);
      loadWorks(nextPage, { resetScroll: true });
    }
  };

  const getDetail = async (work: AitagWorkSummary, requireComplete = false) => {
    const cached = details[work.id];
    if (cached && !cached.isPreviewOnly && (!requireComplete || cached.images.length >= Math.max(getAitagWorkImageCount(work), getAitagWorkImageCount(cached.work)))) return cached;

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

  const loadDetail = async (work: AitagWorkSummary) => {
    if (work.id === selectedId) {
      closeMobileDetail();
      return;
    }
    batchDetailWork.current = null;
    aitagPageCache = { ...aitagPageCache, selectedId: work.id };
    selectionAnchor.prepareSelection(work.id);
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
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({ ...importData, mode: 'prompt-fragments', fullMetadata: true, targetMode: 'text-to-image' }));
      notify('参数已导入实验室，正在跳转...');
      onNavigateToPlayground();
    } catch (e: any) {
      notify(e.message || '导入失败', 'error');
    }
  };

  const sendBaseImage = (image: AitagImage, operation: ImageEditOperation) => {
    try {
      const payload: BaseImageImport = { mode: 'base-image', imageEditOperation: operation, baseImageUrl: getMobileOriginalUrl(buildAitagImageUrl(image)) };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload));
      onNavigateToPlayground();
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导入失败'), 'error');
    }
  };

  const buildImageChain = (image: AitagImage, index: number, work: AitagWorkSummary): PromptChain => {
    const importData = parseImageImportData(image);
    const now = Date.now();
    return {
      id: `aitag-${image.work_id}-${image.file_name}`, userId: currentUser.id, username: currentUser.username, type: 'style',
      name: `${work.title?.trim() || `aitag-${image.work_id}`} P${index + 1}`,
      description: buildAitagChainDescription(image.work_id), tags: [], previewImage: buildAitagImageUrl(image),
      basePrompt: importData.prompt, negativePrompt: importData.negativePrompt, modules: [], params: importData.params,
      variableValues: { subject: '' }, createdAt: now, updatedAt: now,
    };
  };

  const saveAsArtistChain = async (image: AitagImage, index: number) => {
    if (savingImageRef.current !== null) return;
    const imageKey = `${image.work_id}-${image.file_name}`;
    const openEditor = navigateAfterSave;
    savingImageRef.current = imageKey;
    setSavingImage(imageKey);
    try {
      const chain = buildImageChain(image, index, selectedWork!);
      await onCreateArtistChain(chain, { openEditor });
      notify('已保存到风格串');
    } catch (e: any) {
      notify(e.message || '保存失败', 'error');
    } finally {
      savingImageRef.current = null;
      setSavingImage(null);
    }
  };

  const saveWorkAsArtistChains = async () => {
    if (savingImageRef.current !== null || !selectedWork) return;
    const summary = items.find(item => item.id === selectedWork.id);
    const expectedCount = Math.max(getAitagWorkImageCount(selectedWork), summary ? getAitagWorkImageCount(summary) : 0);
    const work = { ...selectedWork, image_count: expectedCount };
    batchDetailWork.current = work.id;
    const navigateOnSuccess = navigateAfterSave;
    const navigateToChains = onNavigateToChains;
    savingImageRef.current = `batch-${work.id}`;
    setSavingImage(savingImageRef.current);
    setBatchProgress({ workId: work.id, completed: 0, total: 0 });
    try {
      const detail = await getDetail(work, true);
      const images = [...detail.images].sort((a, b) => a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
      if (detail.isPreviewOnly || images.length === 0 || images.length < Math.max(getAitagWorkImageCount(work), getAitagWorkImageCount(detail.work))) throw new Error(t('作品图片尚未完整加载，请稍后重试'));
      let successful = 0, failed = 0;
      const failedPages: string[] = [];
      let firstError = '';
      setBatchProgress({ workId: work.id, completed: 0, total: images.length });
      for (const [index, image] of images.entries()) {
        const key = `${work.id}-${image.file_name}`;
        if (savedBatchImages.current.has(key)) successful++;
        else {
          try {
            await onCreateArtistChain(buildImageChain(image, index, work), { openEditor: false });
            savedBatchImages.current.add(key); successful++;
          } catch (cause) {
            failed++; failedPages.push(`P${index + 1}`);
            if (!firstError) firstError = cause instanceof Error ? cause.message : t('保存失败');
          }
        }
        setBatchProgress({ workId: work.id, completed: index + 1, total: images.length });
      }
      if (failed === 0) for (const image of images) savedBatchImages.current.delete(`${work.id}-${image.file_name}`);
      const summary = t('批量保存完成：成功 {0} 张，失败 {1} 张', [successful, failed]);
      notify(failed ? `${summary} · ${failedPages.join(', ')} · ${t('保存失败：{0}', [firstError])}` : summary, failed ? 'error' : 'success');
      if (failed === 0 && navigateOnSuccess) navigateToChains?.();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t('保存失败'), 'error');
    } finally {
      savingImageRef.current = null; setSavingImage(null); setBatchProgress(null);
    }
  };

  const activeFilterCount = Number(Boolean(appliedPrompt.trim())) + Number(cacheFilter !== 'all') + Number(sort !== 'new') + Number(Boolean(modelFilter)) + Number(sort === 'monthly' && rankMonth !== 'current') + Number(artistFilter !== 'all') + Number(chainFilter !== 'all');
  const cacheFilterLabels: Record<AitagCacheFilter, string> = { all: '全部', favorite: '收藏', full: '已缓存全部', 'first-image': '已缓存首图' };
  const rankMonthLabel = rankMonth === 'older' ? t('更早') : rankMonth === 'current' ? t('当前月份') : rankMonth.replace(/^m/, '');
  // 已生效条件：关键词与提示词按最近一次实际检索显示，输入中的草稿不提前出现。
  const filterChips: Array<{ key: string; label: string; onRemove: () => void }> = [
    ...(appliedQ.trim() ? [{ key: 'q', label: t('关键词：{0}', [appliedQ.trim()]), onRemove: () => clearSearchText('q') }] : []),
    ...(appliedPrompt.trim() ? [{ key: 'prompt', label: t('提示词：{0}', [appliedPrompt.trim()]), onRemove: () => clearSearchText('prompt') }] : []),
    ...(cacheFilter !== 'all' ? [{ key: 'cache', label: t('缓存：{0}', [t(cacheFilterLabels[cacheFilter])]), onRemove: () => handleCacheFilterChange('all') }] : []),
    ...(sort === 'monthly' ? [{ key: 'sort', label: t('月榜：{0}', [rankMonthLabel]), onRemove: () => handleSortChange('new') }] : []),
    ...(modelFilter ? [{ key: 'model', label: t('模型：{0}', [t(modelFilter)]), onRemove: () => changeLocalFilter(() => setModelFilter('')) }] : []),
    ...(artistFilter !== 'all' ? [{ key: 'artist', label: artistFilter === 'with' ? t('含画师串') : t('无画师串'), onRemove: () => changeLocalFilter(() => setArtistFilter('all')) }] : []),
    ...(chainFilter !== 'all' ? [{ key: 'chain', label: chainFilter === 'saved' ? t('已存风格串') : t('未存风格串'), onRemove: () => changeLocalFilter(() => setChainFilter('all')) }] : []),
  ];
  const canResetFilters = filterChips.length > 0 || Boolean(q.trim()) || Boolean(prompt.trim());
  const renderLocalFilterSelects = (mobile: boolean) => {
    const labelClass = mobile ? 'text-sm font-bold dark:text-white' : 'text-xs text-gray-500 dark:text-gray-400';
    const selectClass = mobile
      ? 'mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800'
      : 'mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white';
    return <>
      <label className={`${labelClass} ${mobile ? 'col-span-2' : ''}`}>{t("模型版本（已加载条目）")}<select value={modelFilter} onChange={event => changeLocalFilter(() => setModelFilter(event.target.value))} disabled={(!mobile && isLoading) || modelOptions.length === 0} className={selectClass}><option value="">{t("全部")}</option>{modelOptions.map(label => <option key={label} value={label}>{t(label)}</option>)}</select></label>
      <label className={labelClass}>{t("画师串")}<select value={artistFilter} onChange={event => changeLocalFilter(() => setArtistFilter(event.target.value as AitagArtistFilter))} className={selectClass}><option value="all">{t("全部")}</option><option value="with">{t("含画师串")}</option><option value="without">{t("无画师串")}</option></select></label>
      <label className={labelClass}>{t("风格串")}<select value={chainFilter} onChange={event => changeLocalFilter(() => setChainFilter(event.target.value as AitagChainFilter))} className={selectClass}><option value="all">{t("全部")}</option><option value="saved">{t("已保存")}</option><option value="unsaved">{t("未保存")}</option></select></label>
    </>;
  };

  return (
    <div className="workspace-canvas aitag-workspace flex-1 min-h-0 flex flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceChrome>
<WorkspaceToolbar>
        <div className="flex w-full min-w-0 items-center gap-2 md:hidden">
          <span title={isAitagConnected ? t("连接正常") : t("当前使用本地缓存")} className={`h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleSearch(); }} placeholder={t("搜索 AITag 作品")} />
          <MobileIconButton label={activeFilterCount > 0 ? t("AITag 筛选 ") + activeFilterCount : t("AITag 筛选")} onClick={() => setShowMobileFilters(true)} className={activeFilterCount > 0 ? 'border border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}><Filter className="h-5 w-5" /></MobileIconButton>
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <span title={isAitagConnected ? t("aitag.win 连接正常") : t("aitag.win 暂时不可用")} className={`h-2.5 w-2.5 flex-none rounded-full ${isAitagConnected ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]' : 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]'}`} />
          <ToolbarSearch value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleSearch(); }} placeholder={t("作品、作者、标题或标签，回车检索")} containerClassName="min-w-[14rem] flex-1 md:max-w-none!" />
          <div ref={filterAnchorRef} className="relative flex-none">
            <ToolbarButton onClick={() => setShowDesktopFilters(value => !value)} className={activeFilterCount > 0 ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!bg-indigo-950/40 dark:!text-indigo-400' : ''} aria-label={activeFilterCount > 0 ? t("筛选 ") + activeFilterCount : t("筛选")} aria-expanded={showDesktopFilters} aria-haspopup="dialog"><Filter className="h-4 w-4" />{t("筛选")}{activeFilterCount > 0 ? " " + activeFilterCount : ""}</ToolbarButton>
            {showDesktopFilters && <AnchoredToolbarPopover anchorRef={filterAnchorRef} title={t("AITag 筛选")} width={544} onClose={() => setShowDesktopFilters(false)}>

            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-gray-900 dark:text-white">{t("AITag 筛选")}</h2><button type="button" onClick={() => setShowDesktopFilters(false)} className="appearance-group flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">×</button></div>
            <label className="mb-3 block text-xs text-gray-500 dark:text-gray-400">{t("提示词搜索")}<input value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { handleSearch(); setShowDesktopFilters(false); } }} placeholder={t("逗号分隔多个条件，- 开头排除")} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white" /></label>
            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-gray-500 dark:text-gray-400">{t("缓存")}<select value={cacheFilter} onChange={e => handleCacheFilterChange(e.target.value as AitagCacheFilter)} disabled={isLoading} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="all">{t("全部")}</option><option value="favorite">{t("收藏")}</option><option value="full">{t("已缓存全部")}</option><option value="first-image">{t("已缓存首图")}</option></select></label>
              <label className="text-xs text-gray-500 dark:text-gray-400">{t("排序")}<select value={sort} onChange={e => handleSortChange(e.target.value as AitagSort)} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="new">{t("最新")}</option><option value="monthly">{t("月榜")}</option></select></label>
              <label className="text-xs text-gray-500 dark:text-gray-400">{t("月份")}<select value={sort === 'monthly' ? rankMonth : ''} onChange={e => handleRankMonthChange(e.target.value)} disabled={isLoading || sort !== 'monthly'} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white"><option value="">{t("无需月份")}</option><option value="current">{t("当前月份")}</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">{t("更早")}</option></select></label>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">{renderLocalFilterSelects(false)}</div>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={resetFilters} disabled={!canResetFilters} className="px-1 text-xs font-bold text-indigo-600 disabled:opacity-40 dark:text-indigo-300">{t("重置筛选")}</button>
              <button type="button" onClick={() => { handleSearch(); setShowDesktopFilters(false); }} className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500">{t("应用筛选")}</button>
            </div>
            </AnchoredToolbarPopover>}
          </div>
          <div className="ml-auto hidden items-center gap-2 text-xs text-gray-500 xl:flex"><span>{t("已加载 {0} 条", [formatCount(visibleItems.length)])}</span><span>{t("共 {0} 条", [formatCount(total)])}</span></div>
        </div>
      </WorkspaceToolbar>
      <ImagePreviewPortal><MobileBottomSheet open={showMobileFilters} title={t("AITag 筛选")} onClose={() => setShowMobileFilters(false)} footer={<div className="flex items-center gap-3"><button type="button" onClick={() => { resetFilters(); setShowMobileFilters(false); }} disabled={!canResetFilters} className="mobile-touch px-2 text-sm font-bold text-indigo-600 disabled:opacity-40 dark:text-indigo-300">{t("重置筛选")}</button><button type="button" onClick={() => { handleSearch(); setShowMobileFilters(false); }} className="mobile-touch flex-1 rounded-xl bg-indigo-600 font-bold text-white">{t("应用筛选")}</button></div>}>
        <div className="space-y-4">
          <label className="block text-sm font-bold dark:text-white">{t("提示词搜索")}<input value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t("逗号分隔多个条件，- 开头排除")} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 font-normal dark:border-gray-800 dark:bg-gray-800" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-bold dark:text-white">{t("缓存")}<select value={cacheFilter} onChange={event => handleCacheFilterChange(event.target.value as AitagCacheFilter)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal dark:border-gray-800 dark:bg-gray-800"><option value="all">{t("全部")}</option><option value="favorite">{t("收藏")}</option><option value="full">{t("已缓存全部")}</option><option value="first-image">{t("已缓存首图")}</option></select></label>
            <label className="text-sm font-bold dark:text-white">{t("排序")}<select value={sort} onChange={event => handleSortChange(event.target.value as AitagSort)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal dark:border-gray-800 dark:bg-gray-800"><option value="new">{t("最新")}</option><option value="monthly">{t("月榜")}</option></select></label>
            <label className="text-sm font-bold dark:text-white">{t("月份")}<select value={sort === 'monthly' ? rankMonth : ''} disabled={sort !== 'monthly'} onChange={event => handleRankMonthChange(event.target.value)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-white px-2 font-normal disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800"><option value="current">{t("当前月份")}</option>{availableMonths.map(month => <option key={month} value={`m${month}`}>{month}</option>)}<option value="older">{t("更早")}</option></select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">{renderLocalFilterSelects(true)}</div>
          <div className="appearance-group rounded-xl bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t("已加载 {0} 条 · 共 {1} 条", [formatCount(visibleItems.length), formatCount(total)])}</div>
        </div>
      </MobileBottomSheet></ImagePreviewPortal>
      {filterChips.length > 0 && (
        <div role="group" aria-label={t("已生效的筛选条件")} className="flex h-11 flex-none items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-3 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/30 md:h-9 md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {filterChips.map(chip => (
              <button key={chip.key} type="button" onClick={chip.onRemove} disabled={isLoading && (chip.key === 'cache' || chip.key === 'sort')} aria-label={t("移除筛选：{0}", [chip.label])} title={chip.label} className="inline-flex h-8 max-w-[16rem] flex-none items-center gap-1 rounded-full border border-indigo-200 bg-white/70 pl-2.5 pr-1.5 font-medium text-indigo-700 hover:border-indigo-300 hover:bg-white disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50 md:h-6">
                <span className="truncate">{chip.label}</span><X aria-hidden="true" className="h-3.5 w-3.5 flex-none opacity-70" />
              </button>
            ))}
          </div>
          <button type="button" onClick={resetFilters} className="flex-none font-bold text-indigo-600 hover:underline dark:text-indigo-400">{t("清空全部")}</button>
        </div>
      )}

      <ToolbarCountCaption>{t(hasLocalFilter ? '已加载中匹配 {0} 条' : '已加载 {0} 条', [hasLoadedRef.current ? formatCount(visibleItems.length) : '—'])}{' · '}{t('共 {0} 条', [hasLoadedRef.current && !isOfflineCache ? formatCount(total) : '—'])}</ToolbarCountCaption>
      </WorkspaceChrome>
      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selectedWork ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main
          ref={mainScrollRef}
          onScroll={() => { selectionAnchor.onScroll(); onMainScrollRestore(); }}
          style={{ overflowAnchor: 'none' }}
          className={`${selectedWork ? 'hidden lg:block' : 'block'} workspace-scroll-viewport min-h-0 overflow-y-auto p-4 md:p-6`}
        >
          {error && (
            <div className={`mb-4 rounded border px-4 py-3 text-sm ${
              isOfflineCache
                ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'
            }`}>
              {t(error)}
            </div>
          )}

          <div ref={galleryContentRef} className={isLoading || visibleItems.length === 0 ? 'h-full' : undefined}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-sm">{t("加载 aitag 数据中...")}</div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <div className="text-sm">{cacheNeedsMoreData ? t("本地没有这一页，且当前无法联网获取") : pendingMetadataItems.length > 0 ? t("正在读取 {0} 个作品的元数据", [pendingMetadataItems.length]) : t("没有匹配结果")}</div>
              {filterChips.length > 0 && <ToolbarButton onClick={resetFilters} className="mt-3">{t("清除筛选")}</ToolbarButton>}
            </div>
          ) : (
            imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                items={visibleItems}
                columns={masonryColumns}
                getItemKey={work => String(work.id)}
                estimateItemHeight={estimateAitagCardHeight}
                renderItem={renderAitagCard}
                stableColumns
              />
            ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-aitag-grid`} style={mobileGalleryStyle(imageDisplay, masonryColumns)}>
              {visibleItems.map(renderAitagCard)}
            </div>
            )
          )}
          </div>

          <div className="flex flex-col items-center gap-2 py-6">
            <div ref={appendSentinelRef} className="h-1 w-full" aria-hidden="true" />
            {isAppending && <span role="status" className="flex items-center gap-1 text-xs text-gray-500"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />{t('正在加载更多…')}</span>}
            {appendError && <div role="alert" className="flex items-center gap-2 text-xs text-red-600 dark:text-red-300"><span>{appendError}</span><ToolbarButton onClick={() => void appendNextPage()}>{t('重试加载')}</ToolbarButton></div>}
            <div className="flex justify-center items-center gap-2 text-xs text-gray-500">
              <span>{t("已加载 {0} 条 / 共 {1} 条 · 滚动浏览，可跳转", [formatCount(visibleItems.length), formatCount(total)])}</span>
              {pendingMetadataItems.length > 0 && <span className="inline-flex items-center gap-1"><LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />{t("正在读取 {0} 个作品的元数据", [pendingMetadataItems.length])}</span>}
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
                  aria-label={t("输入页码跳转")}
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
                  title={t("点击输入页码跳转")}
                  className="appearance-group mobile-touch min-w-24 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
                >{t("跳到第 {0} 页", [page])}</button>
              )}
            </div>
          </div>
          <div className="flex justify-center pb-6 -mt-3">
            <div className="appearance-group flex flex-wrap justify-center items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              <span title={t("当前筛选下已经成功保存到本地的第一张图数量")}>{t("首图保存 {0}", [formatCount(cacheStatus?.firstImagesCount ?? cacheStatus?.coversCount ?? 0)])}</span>
              <span title={t("已经点开并完整保存详情 JSON 的作品数")}>{t("完整保存 {0}", [formatCount(cacheStatus?.detailsCount || 0)])}</span>
              {isOfflineCache && <span className="text-amber-600 dark:text-amber-300">{t("本地缓存模式")}</span>}
            </div>
          </div>
        </main>

        <DetailSidePanel
          open={Boolean(selectedWork)}
          title={selectedWork?.title || t("作品详情")}
          sensitiveTitle
          headerActions={selectedWork && <>
            <IconButton
              label={batchProgress?.workId === selectedWork.id && batchProgress.total > 0 ? t('批量保存风格串 {0}/{1}', [batchProgress.completed, batchProgress.total]) : t('批量保存风格串')}
              data-appearance={undefined}
              className="!border-transparent !bg-transparent !text-emerald-600 !shadow-none hover:!bg-transparent dark:!bg-transparent dark:!text-emerald-400 [&>svg]:!h-5 [&>svg]:!w-5"
              disabled={savingImage !== null}
              aria-busy={batchProgress?.workId === selectedWork.id}
              onClick={() => void saveWorkAsArtistChains()}
            >
              {batchProgress?.workId === selectedWork.id ? <LoaderCircle className="animate-spin" /> :
                <svg data-aitag-icon="batch-save" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H5a2 2 0 0 0-2 2v9M18 7H9a2 2 0 0 0-2 2v9" />
                  <path d="M12 11h7l3 3v7H12zM15 11v5h4v-5M15 21v-3h4v3" />
                </svg>}
            </IconButton>
            <IconButton
              label={t('保存后跳转')}
              data-appearance={undefined}
              className={`!border-transparent !bg-transparent !shadow-none hover:!bg-transparent dark:!bg-transparent [&>svg]:!h-5 [&>svg]:!w-5 ${navigateAfterSave ? '!text-indigo-600 dark:!text-indigo-400' : '!text-gray-400 dark:!text-gray-500'}`}
              aria-pressed={navigateAfterSave}
              disabled={savingImage !== null}
              onClick={() => {
                const next = !navigateAfterSave;
                setNavigateAfterSave(next);
                try { localStorage.setItem('nai_aitag_navigate_after_save', String(next)); }
                catch { /* 存储不可用时保留当前选择。 */ }
              }}
            >
              <svg data-aitag-icon="save-navigate" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 20H3V3h11l4 4v4M6 3v6h7V3M6 20v-7h5v7M14 16h9m-4-4 4 4-4 4" />
              </svg>
            </IconButton>
          </>}
          subInfo={selectedWork ? `#${selectedWork.id} · ${getAitagType(selectedWork)}` : undefined}
          onBack={closeMobileDetail}
          onClose={closeMobileDetail}
          bodyRef={detailScrollRef}
          onBodyScroll={onDetailScrollRestore}
        >
          {!selectedWork ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
              {t("选择作品")}</div>
          ) : isDetailLoading && !selectedDetail ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">{t("加载详情中...")}</div>
          ) : selectedDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <ToolbarLink href={getAitagUrl(selectedWork)} target="_blank" rel="noreferrer"><ExternalLink />{t("aitag 原页")}</ToolbarLink>
                <ToolbarLink href={getPixivUrl(selectedWork)} target="_blank" rel="noreferrer"><ExternalLink />{t("Pixiv 原页")}</ToolbarLink>
              </div>
              {selectedImages.map(({ image, favorite }, index) => {
                    const promptText = extractAitagPrompt(image);
                    const generationLabels = getAitagGenerationLabels(image);
                    const modelLabel = getAitagModelLabel(image);

                    return (
                      <div key={image.id || `${image.work_id}-${image.file_name}`} className="appearance-content appearance-card rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden">
                        <PressRevealSurface className="appearance-media group relative">
                          <ViewableImage src={buildAitagImageUrl(image)} alt={t("AITAG 作品图片")} filename={`aitag-${image.work_id}-p${index + 1}.png`} favorite={favorite} notify={notify} className="w-full max-h-[62vh] object-contain bg-black/5 dark:bg-black/20" loading="lazy" />
                          <ImageShareOverlay imageUrl={getMobileOriginalUrl(buildAitagImageUrl(image))} filename={`aitag-${image.work_id}-p${index + 1}.png`} favorite={favorite} notify={notify} />
                        </PressRevealSurface>
                        <div className="appearance-group p-3 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              {generationLabels.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {generationLabels.map(label => (
                                    <span key={label} className="rounded bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 text-meta font-medium text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/20">
                                      {t(label)}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={modelLabel || image.image_type}>
                                P{index + 1}{modelLabel ? ` · ${modelLabel}` : ''}
                              </div>
                            </div>
                            <div className="flex flex-none gap-2">
                              <IconButton label={t("保存到风格串")} tone="save" disabled={savingImage !== null} aria-busy={savingImage === `${image.work_id}-${image.file_name}`} onClick={() => saveAsArtistChain(image, index)}>{savingImage === `${image.work_id}-${image.file_name}` ? <LoaderCircle className="animate-spin" /> : <Layers />}</IconButton>
                              <IconButton label={t("导入实验室")} tone="primary" onClick={() => importToPlayground(image)}><FlaskConical /></IconButton>
                              <ToolbarPopover key={`${image.work_id}-${image.file_name}`} label="用作底图" title={t('用作底图')} icon={<ImagePlus />} iconOnly iconTone="edit" disabled={!buildAitagImageUrl(image)} width={208}>
                                {close => <>{([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const).map(([operation, label]) => <button key={operation} type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { close(); sendBaseImage(image, operation); }}><ImagePlus />{t(label)}</button>)}</>}
                              </ToolbarPopover>
                              {!promptText.trim() && <ImageTaggerAction
                                notify={notify}
                                imageUrl={image.local_image_url || buildMediaUrl(buildAitagImageUrl(image), 'original')}
                                actionLabel={t("复制 {count} 个 Tag")}
                                className="!w-10 !h-10"
                              />}
                            </div>
                          </div>
                          <div className="appearance-group text-xs font-mono text-gray-700 dark:text-gray-300 leading-relaxed bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-28 overflow-y-auto custom-scrollbar break-words">
                            <PromptLibraryCaptureButton text={promptText} />{promptText || <span className="text-gray-400">{t("暂无提示词")}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              {selectedDetail.isPreviewOnly && (
                <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-700 dark:text-sky-200">
                  {t("已显示本地首图，正在加载完整作品组...")}</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400">{t("详情加载失败")}</div>
          )}
        </DetailSidePanel>
      </div>
    </div>
  );
};
