
import React, { useCallback, useContext, useMemo, useState, useEffect, useRef } from 'react';
import { LocalHistoryDateRange, LocalHistoryPage, localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, PromptChain, User } from '../types';
import { PAGINATION_CONFIG } from '../config/pagination';
import { MobileBottomSheet, useMobileHistoryLayer } from './MobileUI';
import { extractMetadata, IMPORT_SESSION_KEY, parseNovelAIMetadata } from '../services/metadataService';
import { compilePrompt } from '../services/promptUtils';
import { ParamsViewer } from './ParamsViewer';
import { useConfirmDialog } from './ConfirmDialog';
import { ImageActivityContext, SmartImage } from './SmartImage';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { AlertTriangle, CalendarDays, ChevronDown, Clock3, Heart, Layers, ListChecks, LoaderCircle, Pencil, Save, Trash2 } from 'lucide-react';
import { CloseButton, EmptyState, FavoriteButton, IconButton, PageSpinner, ToolbarButton, WorkspaceToolbar } from './DesignSystem';
import { buildMediaUrl, canUseMediaGateway } from '../services/mobileImageCache';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useLowConsumption } from '../services/lowConsumption';
import { ImageShareActions } from './ImageShareActions';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { type HistoryBrowseOrder, type HistoryBrowseQuery } from '../services/historyBrowse';
import { HistoryBrowseControls } from './HistoryBrowseControls';
import { HistoryImageViewer } from './HistoryImageViewer';

interface GenHistoryProps {
    currentUser: User;
    chains: PromptChain[];
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onRefreshInspiration?: () => void;
}

const toDateInputValue = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatHistoryDay = (key: string) => {
    const today = toDateInputValue(new Date());
    const yesterday = toDateInputValue(new Date(Date.now() - 86400000));
    if (key === today) return '今天';
    if (key === yesterday) return '昨天';
    const date = new Date(`${key}T00:00:00`);
    return date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric', weekday: 'short' });
};

const HISTORY_THUMBNAIL_VARIANT = 'thumb-960';
const HISTORY_CARD_HOVER_ACTIONS = 'opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto transition-opacity';

const getDownloadFilename = (createdAt = Date.now()) => {
    const date = new Date(createdAt);
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    return `NAI-${timestamp}.png`;
};

const prewarmHistoryThumbnails = async (items: LocalGenItem[]) => {
    const sources = items.map(item => item.imageUrl).filter(canUseMediaGateway);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, sources.length) }, async () => {
        while (cursor < sources.length) {
            const source = sources[cursor++];
            try {
                const response = await fetch(buildMediaUrl(source, HISTORY_THUMBNAIL_VARIANT), {
                    cache: 'force-cache',
                    credentials: 'same-origin',
                });
                if (response.ok) await response.arrayBuffer();
            } catch {
                // Adjacent-page warming is best-effort and must not affect navigation.
            }
        }
    });
    await Promise.all(workers);
};

/**
 * 单张历史卡的展示比例：真实测量比（加载后纠正错误元数据）→ 有效 params 宽高比 → 默认 832/1216。
 * 防御 0/负数/NaN/Infinity/缺失；估算列高与卡片实渲染共用同一套逻辑。
 */
const resolveHistoryImageRatio = (item: LocalGenItem, measuredRatio?: number) => {
    if (typeof measuredRatio === 'number' && Number.isFinite(measuredRatio) && measuredRatio > 0) return measuredRatio;
    const { width, height } = item.params || {};
    if (typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return width / height;
    return 832 / 1216;
};

/**
 * 生成历史卡片（React.memo）：瀑布流/网格大量卡片时避免每张卡片随父级重渲染整块重建。
 * 纯 props 化：状态（选中/待收藏）以布尔传入，回调都以 item 作第一参（父级稳定 useCallback，
 * 内容仅随对应状态/集合变化而重建），让 memo 浅比较在绝大多数无关渲染下直接短路。
 */
const HistoryCard = React.memo(function HistoryCard({
    item,
    measuredRatio,
    isSelected,
    selectionMode,
    isFavoritePending,
    onToggleSelect,
    onLongPressSelect,
    onOpen,
    onFavorite,
    onDelete,
    onImageLoadRatio,
    notify,
}: {
    item: LocalGenItem;
    /** 已加载测量的真实比例（纠正错误元数据），缺省时卡片用 params/默认比例兜底 */
    measuredRatio?: number;
    isSelected: boolean;
    selectionMode: boolean;
    isFavoritePending: boolean;
    onToggleSelect: (itemId: string) => void;
    onLongPressSelect: (itemId: string) => void;
    onOpen: (item: LocalGenItem) => void;
    onFavorite: (item: LocalGenItem, e: React.MouseEvent) => void;
    onDelete: (item: LocalGenItem, e: React.MouseEvent) => void;
    onImageLoadRatio: (itemId: string, ratio: number) => void;
    notify: GenHistoryProps['notify'];
}) {
    // 卡片自身的手势时间戳放在组件内：长按进入多选，结束时清除计时，避免误触选择。
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
    const cancelLongPress = () => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); };
    useEffect(() => () => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); }, []);

    // 图片区展示比例：真实测量比 → params → 默认；父级传下来时随真实比例更新（只影响这张卡）
    const ratio = useMemo(() => resolveHistoryImageRatio(item, measuredRatio), [item, measuredRatio]);

    const createdAt = useMemo(() => new Date(item.createdAt).toLocaleString(), [item.createdAt]);

    return (
        <div
            data-history-id={item.id}
            role="button"
            tabIndex={0}
            aria-label={`查看生成于 ${createdAt} 的图片`}
            className={`mobile-gallery-item group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border hover:border-indigo-500 transition-colors ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
            onPointerDown={event => {
                if (event.button !== 0) return;
                cancelLongPress();
                pointerStartRef.current = { x: event.clientX, y: event.clientY };
                longPressTriggeredRef.current = false;
                longPressTimerRef.current = window.setTimeout(() => {
                    longPressTriggeredRef.current = true;
                    onLongPressSelect(item.id);
                }, 550);
            }}
            onPointerUp={() => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); }}
            onPointerCancel={() => { if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current); }}
            onPointerLeave={cancelLongPress}
            onPointerMove={event => {
                const start = pointerStartRef.current;
                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelLongPress();
            }}
            onKeyDown={event => {
                if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                if (selectionMode) onToggleSelect(item.id); else onOpen(item);
            }}
            onClick={() => {
                if (longPressTriggeredRef.current) return;
                if (selectionMode) onToggleSelect(item.id);
                else onOpen(item);
            }}
        >
            <div className="mobile-gallery-frame md:aspect-square relative w-full overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': `${ratio}` } as React.CSSProperties}>
                <SmartImage src={item.imageUrl} thumbnailVariant={HISTORY_THUMBNAIL_VARIANT} alt={`生成于 ${createdAt} 的图片`} className="w-full h-full object-cover" onLoad={event => {
                    const image = event.currentTarget;
                    const imageRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
                    if (Number.isFinite(imageRatio) && imageRatio > 0) onImageLoadRatio(item.id, imageRatio);
                }} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                {selectionMode && <div className={`absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold shadow backdrop-blur transition ${isSelected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`}>{isSelected ? '✓' : ''}</div>}
                {!selectionMode && <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-2" onPointerDown={event => event.stopPropagation()}>
                    {isFavoritePending ? (
                        // 收藏写入中只替换心形，下载和复制仍能使用。
                        <span role="status" aria-label="正在更新收藏" className="pointer-events-none flex h-11 w-11 items-center justify-center rounded-full border border-white/60 bg-black/45 text-white shadow backdrop-blur md:h-8 md:w-8"><LoaderCircle className="h-4 w-4 animate-spin" /></span>
                    ) : (
                        <FavoriteButton overlay active={Boolean(item.isFavorite)} className="!h-11 !w-11 md:!h-8 md:!w-8" onClick={e => onFavorite(item, e)} />
                    )}
                    <ImageShareActions imageUrl={item.imageUrl} generationData={{ prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params }} filename={getDownloadFilename(item.createdAt)} notify={notify} variant="card" className={`flex-col ${HISTORY_CARD_HOVER_ACTIONS}`} />
                </div>}
                {!selectionMode && <div className={`absolute left-2 top-2 z-10 ${HISTORY_CARD_HOVER_ACTIONS}`} onPointerDown={event => event.stopPropagation()}>
                    <button type="button" onClick={e => onDelete(item, e)} className="mobile-size-locked flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-8 md:w-8" aria-label="删除历史图片" title="删除">
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>}
                <div className="absolute bottom-0 left-0 right-0 hidden p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-micro md:block md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
                    {createdAt}
                </div>
            </div>
            <div className="truncate px-2 py-2 text-meta text-gray-600 dark:text-gray-300 md:hidden">{createdAt}</div>
        </div>
    );
});

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, chains, notify, onNavigateToPlayground, onRefreshInspiration }) => {
    const lowConsumption = useLowConsumption();
    const confirmAction = useConfirmDialog();
    const imageDisplay = useMobileImageDisplayPreferences();
    const masonryColumns = useMasonryColumnCount(imageDisplay);
    // 与 CSS 768px 断点一致：手机端卡片底部有额外的时间文字行，计入预计高度
    const [isMobileViewport, setIsMobileViewport] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 768));
    useEffect(() => {
        const update = () => setIsMobileViewport(window.innerWidth < 768);
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    const [items, setItems] = useState<LocalGenItem[]>([]);
    // 图片加载后从文件真实尺寸得到的宽高比，用于纠正错误的 params.width/height（不修改数据库）
    const [actualImageRatios, setActualImageRatios] = useState<Record<string, number>>({});
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const itemsRef = useRef(items); itemsRef.current = items;
    const lightboxRef = useRef(lightbox); lightboxRef.current = lightbox;
    const returnItemRef = useRef<string | null>(null);
    const navigationRequestRef = useRef(0);
    const navigationBusyRef = useRef(false);
    const [isNavigating, setIsNavigating] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(() => window.innerWidth >= 768);
    const requestCloseLightbox = useMobileHistoryLayer(Boolean(lightbox), () => {
        lightboxRef.current = null; navigationRequestRef.current++; setLightbox(null);
    }, 'history-detail');
    const closeLightbox = () => {
        lightboxRef.current = null; navigationRequestRef.current++; requestCloseLightbox();
    };
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // 分页相关状态
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const loadingRef = useRef(false);
    const [jumpPage, setJumpPage] = useState('');
    const [desktopJumpPage, setDesktopJumpPage] = useState('1');
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [browseQuery, setBrowseQuery] = useState<HistoryBrowseQuery>({ sort: 'newest' });
    const [browseOptions, setBrowseOptions] = useState<Omit<HistoryBrowseOrder, 'ids'>>({ models: [], sources: [] });
    const [newImageCount, setNewImageCount] = useState(0);
    const dateRangeRef = useRef<LocalHistoryDateRange>({ sort: 'newest', browseKey: createUuid() });
    const historyChangeRef = useRef<(change: { type: string; id?: string; favorite?: boolean; external?: boolean }) => void>(() => {});
    const changeRequestRef = useRef(0);
    const [migrationProgress, setMigrationProgress] = useState<{ current: number; total: number } | null>(null);
    const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(new Set());
    // 缓存管理
    const pageCacheRef = useRef<Record<number, LocalGenItem[]>>({});
    const inflightPagesRef = useRef<Record<string, Promise<LocalHistoryPage>>>({});
    const currentPageRef = useRef(1);
    const loadRequestRef = useRef(0);
    const refreshPageRef = useRef<(page: number, force?: boolean) => Promise<void>>(async () => undefined);

    // 清理相关状态
    const [showCleanMenu, setShowCleanMenu] = useState(false);
    const managementAnchorRef = useRef<HTMLDivElement>(null);
    const [showPageMenu, setShowPageMenu] = useState(false);
    const [showCleanModal, setShowCleanModal] = useState(false);
    const [cleanMode, setCleanMode] = useState<'days' | 'count'>('days');
    const [cleanDays, setCleanDays] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_DAYS);
    const [cleanCount, setCleanCount] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_COUNT);
    const [cleanPreviewCount, setCleanPreviewCount] = useState(0);
    const [isPreparingImport, setIsPreparingImport] = useState(false);

    const getHistoryNegativePrompt = (item: LocalGenItem) => {
        return item.negativePrompt ?? '';
    };

    const getImportDataFromHistoryItem = async (item: LocalGenItem) => {
        const fallbackData = {
            prompt: item.prompt,
            negativePrompt: getHistoryNegativePrompt(item),
            params: item.params,
        };

        if (typeof item.basePrompt === 'string' || typeof item.subjectPrompt === 'string' || Array.isArray(item.modules)) {
            return {
                ...fallbackData,
                basePrompt: item.basePrompt || '',
                subjectPrompt: item.subjectPrompt || '',
                modules: item.modules || [],
            };
        }

        // Old local records did not store the split fields. If their linked
        // source chain still produces exactly the saved prompt, we can safely
        // recover the original split instead of guessing from tag wording.
        const source = item.sourceChainId && item.sourceChainId !== 'playground'
            ? chains.find(chain => chain.id === item.sourceChainId)
            : undefined;
        if (source) {
            const sourceSubject = source.variableValues?.subject || '';
            const compiled = compilePrompt(source, sourceSubject);
            const normalize = (value: string) => value.split(',').map(tag => tag.trim()).filter(Boolean).join(',');
            if (normalize(compiled) === normalize(item.prompt)) {
                return {
                    ...fallbackData,
                    basePrompt: source.basePrompt || '',
                    subjectPrompt: sourceSubject,
                    modules: source.modules || [],
                };
            }
        }

        if (Object.prototype.hasOwnProperty.call(item, 'negativePrompt')) {
            return fallbackData;
        }

        try {
            const response = await fetch(item.imageUrl);
            const blob = await response.blob();
            const file = new File([blob], 'history.png', { type: blob.type || 'image/png' });
            const rawMeta = await extractMetadata(file);
            if (!rawMeta) {
                return fallbackData;
            }

            return parseNovelAIMetadata(rawMeta, item.params);
        } catch (e) {
            console.warn('Failed to read history image metadata', e);
            return fallbackData;
        }
    };

    const { PAGE_SIZE } = PAGINATION_CONFIG;

    const setCacheState = (nextCache: Record<number, LocalGenItem[]>) => {
        pageCacheRef.current = nextCache;
    };

    const getHistoryQueryKey = () => {
        const range = dateRangeRef.current;
        return range.browseKey || '';
    };

    const trimCacheAroundPage = (centerPage: number, totalPages: number, extraPages: Record<number, LocalGenItem[]> = {}) => {
        const validPages = [centerPage - 1, centerPage, centerPage + 1].filter(page => page >= 1 && page <= totalPages);
        const nextCache: Record<number, LocalGenItem[]> = {};

        validPages.forEach(page => {
            const data = extraPages[page] ?? pageCacheRef.current[page];
            if (data) {
                nextCache[page] = data;
            }
        });

        setCacheState(nextCache);
    };

    // 获取页面数据（优先从缓存）
    const getPageData = async (page: number, force = false, includeCount = false): Promise<LocalHistoryPage> => {
        const cached = pageCacheRef.current[page];
        if (!force && cached && !includeCount) {
            return { items: cached };
        }

        const cacheKey = `${getHistoryQueryKey()}:${page}:${includeCount ? 'count' : 'items'}`;
        const inflight = inflightPagesRef.current[cacheKey];
        if (!force && inflight) {
            return inflight;
        }

        // then/catch 回调执行时 const 已完成赋值，自引用比较安全
        const request: Promise<LocalHistoryPage> = localHistory.getPage(page - 1, PAGE_SIZE, dateRangeRef.current, includeCount)
            .then(data => {
                if (inflightPagesRef.current[cacheKey] === request) {
                    delete inflightPagesRef.current[cacheKey];
                }
                return data;
            })
            .catch(error => {
                if (inflightPagesRef.current[cacheKey] === request) {
                    delete inflightPagesRef.current[cacheKey];
                }
                throw error;
            });

        inflightPagesRef.current[cacheKey] = request;
        return request;
    };

    const preloadPage = async (page: number, totalPages: number, centerPage: number) => {
        if (page < 1 || page > totalPages) {
            return;
        }

        try {
            const queryKey = getHistoryQueryKey();
            const { items: data } = await getPageData(page);

            if (currentPageRef.current !== centerPage || getHistoryQueryKey() !== queryKey) {
                return;
            }

            if (!pageCacheRef.current[page]) {
                const nextCache = {
                    ...pageCacheRef.current,
                    [page]: data,
                };
                setCacheState(nextCache);
                trimCacheAroundPage(centerPage, totalPages, nextCache);
            }
            window.setTimeout(() => {
                if (currentPageRef.current === centerPage && getHistoryQueryKey() === queryKey) void prewarmHistoryThumbnails(data);
            }, 2500);
        } catch (e) {
            console.warn('预加载页面失败:', e);
        }
    };

    // 跳转到指定页
    const goToPage = async (page: number, force: boolean = false) => {
        const requestId = ++loadRequestRef.current;
        loadingRef.current = true;
        setLoadFailed(false);
        setIsLoading(true);

        try {
            const range = dateRangeRef.current;
            if (!range.orderIds) {
                const order = await localHistory.getBrowseOrder(range);
                if (requestId !== loadRequestRef.current || range.browseKey !== getHistoryQueryKey()) return;
                dateRangeRef.current = { ...range, orderIds: order.ids };
                setBrowseOptions({ models: order.models, sources: order.sources });
            }
            const requestedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
            let pageResult = await getPageData(requestedPage, force, true);
            const count = Number(pageResult.count || 0);
            const calculatedTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
            const targetPage = Math.max(1, Math.min(requestedPage, calculatedTotalPages));

            if (requestId !== loadRequestRef.current) return;

            currentPageRef.current = targetPage;
            setCurrentPage(targetPage);
            setTotalPages(calculatedTotalPages);
            setTotalCount(count);

            if (targetPage !== requestedPage) pageResult = await getPageData(targetPage, force);
            const data = pageResult.items;
            if (requestId !== loadRequestRef.current) return;

            setItems(data);
            setAppendFailed(false);
            if (historyScrollRef.current) historyScrollRef.current.scrollTop = 0;
            // 更新缓存并清理
            const nextCache = {
                ...pageCacheRef.current,
                [targetPage]: data,
            };
            setCacheState(nextCache);
            trimCacheAroundPage(targetPage, calculatedTotalPages, nextCache);
            // 预加载相邻页面（当前页 +1 和 -1）
            if (targetPage > 1) {
                void preloadPage(targetPage - 1, calculatedTotalPages, targetPage);
            }
            if (targetPage < calculatedTotalPages) {
                void preloadPage(targetPage + 1, calculatedTotalPages, targetPage);
            }
        } catch (e) {
            console.error('加载页面失败:', e);
            if (requestId === loadRequestRef.current) {
                setLoadFailed(true);
                notify('加载失败，请重试', 'error');
            }
        } finally {
            if (requestId === loadRequestRef.current) {
                loadingRef.current = false;
                setIsLoading(false);
            }
        }
    };

    refreshPageRef.current = goToPage;

    // 自动翻页：把下一页内容追加到当前列表下方（与分页器跳页的整页替换不同）。
    // 追加模式不回顶、不替换，最新图始终留在列表顶部；用 ref 防并发与跳页竞态。
    const appendingRef = useRef(false);
    const appendingQueryRef = useRef('');
    const [isAppending, setIsAppending] = useState(false);
    const [appendFailed, setAppendFailed] = useState(false);
    const appendNextPage = async () => {
        if (appendingRef.current && appendingQueryRef.current === getHistoryQueryKey()) return;
        const order = dateRangeRef.current.orderIds || [];
        const lastId = itemsRef.current.at(-1)?.id;
        const lastIndex = lastId ? order.indexOf(lastId) : -1;
        if (lastIndex < 0 || lastIndex >= order.length - 1) return;
        appendingRef.current = true;
        const appendKey = getHistoryQueryKey();
        appendingQueryRef.current = appendKey; setIsAppending(true);
        try {
            const beforePage = currentPageRef.current;
            const queryKey = getHistoryQueryKey();
            const next = Math.floor((lastIndex + 1) / PAGE_SIZE) + 1;
            const { items: data } = await getPageData(next);
            // 加载期间用户跳页/筛选：丢弃本次结果，避免拼接到错误列表上。
            if (currentPageRef.current !== beforePage || getHistoryQueryKey() !== queryKey) return;
            const targetPage = Math.min(next, totalPages);
            if (targetPage !== next) return;
            currentPageRef.current = targetPage;
            setItems(previous => {
                const loaded = new Set(previous.map(item => item.id));
                return [...previous, ...data.filter(item => !loaded.has(item.id) && order.indexOf(item.id) > lastIndex)];
            });
            setCurrentPage(targetPage);
            const nextCache = { ...pageCacheRef.current, [targetPage]: data };
            setCacheState(nextCache);
            trimCacheAroundPage(targetPage, totalPages, nextCache);
            if (targetPage < totalPages) {
                void preloadPage(targetPage + 1, totalPages, targetPage);
            }
        } catch (e) {
            console.error('追加页面失败:', e);
            if (getHistoryQueryKey() === appendKey) { setAppendFailed(true); notify('加载失败，请重试', 'error'); }
        } finally {
            if (appendingQueryRef.current === appendKey) { appendingRef.current = false; setIsAppending(false); }
        }
    };

    // 滚动接近列表底部自动加载下一页（追加模式，与 Pixiv 相同的哨兵机制）：
    // 追加完成后若哨兵仍在视口（用户停在底部/快速滚动）会立即再触发，
    // 实现不间断连续加载；内容增长使哨兵移出视口后自然停止。
    const historyScrollRef = useRef<HTMLDivElement>(null);
    const onScrollRestore = useKeepAliveScrollRestore(historyScrollRef, 'history');
    const historyPageSentinelRef = useRef<HTMLDivElement>(null);

    const navigateToHistoryIndex = async (targetIndex: number): Promise<void> => {
        if (navigationBusyRef.current || !lightboxRef.current) return;
        const order = dateRangeRef.current.orderIds || [];
        const targetId = order[targetIndex];
        if (!targetId) return;
        const requestId = ++navigationRequestRef.current;
        const queryKey = getHistoryQueryKey();
        navigationBusyRef.current = true; setIsNavigating(true);
        try {
            const page = Math.floor(targetIndex / PAGE_SIZE) + 1;
            const cachedItem = itemsRef.current.find(item => item.id === targetId);
            const data = cachedItem ? [] : (await getPageData(page)).items;
            if (requestId !== navigationRequestRef.current || queryKey !== getHistoryQueryKey() || !lightboxRef.current) return;
            const target = cachedItem || data.find(item => item.id === targetId);
            if (!target) {
                await removeBrowseItems(new Set([targetId]));
                notify('这张历史图片已被移除', 'error');
                const remaining = dateRangeRef.current.orderIds || [];
                if (remaining.length) await navigateToHistoryIndex(Math.min(targetIndex, remaining.length - 1));
                else setLightbox(null);
                return;
            }
            if (data.length) {
                pageCacheRef.current[page] = data;
                setItems(previous => {
                    const merged = new Map(previous.map(item => [item.id, item]));
                    data.forEach(item => merged.set(item.id, item));
                    const positions = new Map(order.map((id, index) => [id, index]));
                    return [...merged.values()].filter(item => positions.has(item.id)).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
                });
                if (page > currentPageRef.current) { currentPageRef.current = page; setCurrentPage(page); }
            }
            returnItemRef.current = target.id;
            setPublishTitle('');
            setLightbox(target);
            const pages = Math.ceil(order.length / PAGE_SIZE);
            if (page < pages) void preloadPage(page + 1, pages, currentPageRef.current);
            if (page > 1) void preloadPage(page - 1, pages, currentPageRef.current);
        } catch (cause) {
            if (requestId === navigationRequestRef.current) notify(cause instanceof Error ? cause.message : '图片加载失败，请重试', 'error');
        } finally {
            if (requestId === navigationRequestRef.current) { navigationBusyRef.current = false; setIsNavigating(false); }
        }
    };

    const removeBrowseItems = async (removed: Set<string>): Promise<void> => {
        if (!dateRangeRef.current.orderIds?.some(id => removed.has(id))) return;
        const wasLoading = loadingRef.current;
        const oldOrder = dateRangeRef.current.orderIds || [];
        const active = lightboxRef.current;
        const activeIndex = active ? oldOrder.indexOf(active.id) : -1;
        const ids = oldOrder.filter(id => !removed.has(id));
        navigationRequestRef.current++; loadRequestRef.current++;
        navigationBusyRef.current = false; setIsNavigating(false);
        dateRangeRef.current = { ...dateRangeRef.current, orderIds: ids, browseKey: createUuid() };
        appendingRef.current = false; appendingQueryRef.current = ''; setIsAppending(false);
        setAppendFailed(false);
        setCacheState({}); inflightPagesRef.current = {};
        setItems(previous => previous.filter(item => !removed.has(item.id)));
        setTotalCount(ids.length); setTotalPages(Math.max(1, Math.ceil(ids.length / PAGE_SIZE)));
        if (wasLoading) await goToPage(Math.min(currentPageRef.current, Math.max(1, Math.ceil(ids.length / PAGE_SIZE))), true);
        if (active && removed.has(active.id)) {
            if (ids.length) await navigateToHistoryIndex(Math.min(Math.max(0, activeIndex), ids.length - 1));
            else setLightbox(null);
        }
        if (!active && itemsRef.current.every(item => removed.has(item.id)) && ids.length) {
            await goToPage(Math.min(currentPageRef.current, Math.ceil(ids.length / PAGE_SIZE)), true);
        }
    };

    // 返回定位到最后查看的作品；翻图过程中保留背景列表与同一筛选/随机会话。
    useEffect(() => {
        if (lightbox) return;
        navigationRequestRef.current++; navigationBusyRef.current = false; setIsNavigating(false);
        const id = returnItemRef.current;
        if (!id) return;
        returnItemRef.current = null;
        const frame = window.requestAnimationFrame(() => {
            const card = Array.from(historyScrollRef.current?.querySelectorAll<HTMLElement>('[data-history-id]') || []).find(node => node.dataset.historyId === id);
            card?.scrollIntoView?.({ block: 'nearest' }); card?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [lightbox]);

    historyChangeRef.current = change => {
        if (change.type !== 'add' && !change.external) return;
        if (change.type === 'delete' && change.id) { void removeBrowseItems(new Set([change.id])); return; }
        if (change.type === 'favorite' && change.id && typeof change.favorite === 'boolean') {
            if (dateRangeRef.current.favoriteOnly && !change.favorite) { void removeBrowseItems(new Set([change.id])); return; }
            patchFavoriteState(new Set([change.id]), change.favorite);
            if (!dateRangeRef.current.favoriteOnly || dateRangeRef.current.orderIds?.includes(change.id)) return;
        }
        const queryKey = getHistoryQueryKey();
        const requestId = ++changeRequestRef.current;
        void localHistory.getBrowseOrder(dateRangeRef.current).then(order => {
            if (queryKey !== getHistoryQueryKey() || requestId !== changeRequestRef.current) return;
            if (!dateRangeRef.current.orderIds) {
                dateRangeRef.current = { ...dateRangeRef.current, orderIds: order.ids, browseKey: createUuid() };
                setBrowseOptions({ models: order.models, sources: order.sources });
                setCacheState({}); inflightPagesRef.current = {};
                void refreshPageRef.current(1, true);
                return;
            }
            const current = dateRangeRef.current.orderIds || [];
            const nextIds = new Set(order.ids);
            const removed = current.filter(id => !nextIds.has(id));
            if (removed.length) void removeBrowseItems(new Set(removed));
            const existing = new Set(current);
            const added = order.ids.filter(id => !existing.has(id)).length;
            if (!added) return;
            const nearTop = (historyScrollRef.current?.scrollTop || 0) < 80;
            if (nearTop && !lightboxRef.current && dateRangeRef.current.sort === 'newest') {
                dateRangeRef.current = { ...dateRangeRef.current, orderIds: order.ids, browseKey: createUuid() };
                setCacheState({}); inflightPagesRef.current = {};
                setNewImageCount(0); void refreshPageRef.current(1, true);
            } else setNewImageCount(added);
        }).catch(() => { /* 后台更新失败不覆盖已加载图片；下一次数据事件会重新检查。 */ });
    };

    const showNewImages = () => {
        applyBrowseQuery({ ...browseQuery, sort: 'newest', seed: undefined });
    };
    useEffect(() => {
        const sentinel = historyPageSentinelRef.current;
        const root = historyScrollRef.current;
        if (!sentinel || !root || isLoading || isAppending || appendFailed || items.length === 0 || items.at(-1)?.id === dateRangeRef.current.orderIds?.at(-1)) return;
        if (!('IntersectionObserver' in window)) return;
        const observer = new IntersectionObserver(entries => {
            if (entries[0]?.isIntersecting) void appendNextPage();
        }, { root, rootMargin: '1200px 0px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
        // appendNextPage 闭包随 currentPage/isLoading 重建，无需列入依赖。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, isLoading, isAppending, appendFailed, totalPages, items.length]);

    const applyBrowseQuery = (query: HistoryBrowseQuery) => {
        navigationRequestRef.current++;
        navigationBusyRef.current = false; setIsNavigating(false);
        appendingRef.current = false; appendingQueryRef.current = ''; setIsAppending(false);
        setAppendFailed(false);
        loadRequestRef.current++;
        setNewImageCount(0);
        setBrowseQuery(query);
        setFavoriteOnly(Boolean(query.favoriteOnly));
        dateRangeRef.current = { ...query, browseKey: createUuid() };
        setCacheState({}); inflightPagesRef.current = {};
        currentPageRef.current = 1;
        exitSelectionMode();
        void goToPage(1, true);
    };

    const submitDesktopPageJump = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const page = Number.parseInt(desktopJumpPage, 10);
        if (!Number.isInteger(page) || page < 1 || page > totalPages) {
            notify(`请输入 1 到 ${totalPages} 之间的页码`, 'error');
            setDesktopJumpPage(String(currentPage));
            return;
        }
        void goToPage(page);
    };

    useEffect(() => {
        setDesktopJumpPage(String(currentPage));
    }, [currentPage]);

    // keep-alive 下组件只在首次挂载时加载一次：若当时数据源短暂异常（返回 0 条），
    // 页面会一直停留在空态直到手动刷新。视图重新激活且当前数据为空时自动重载。
    const viewActive = useContext(ImageActivityContext);
    const prevViewActiveRef = useRef(false);
    useEffect(() => {
        if (viewActive && !prevViewActiveRef.current && totalCount === 0) {
            void refreshPageRef.current(1, true);
        }
        prevViewActiveRef.current = viewActive;
    }, [totalCount, viewActive]);

    useEffect(() => {
        const unsubscribe = localHistory.subscribe(change => historyChangeRef.current(change));

        const initialize = async () => {
            setMigrationProgress({ current: 0, total: 0 });
            try {
                const migratedCount = await localHistory.prepare(setMigrationProgress);
                if (migratedCount > 0) {
                    notify(`已将 ${migratedCount} 张历史图片迁移到本地数据目录`);
                }
            } catch (e: any) {
                notify('历史图片迁移失败，浏览器原数据已保留: ' + (e?.message || '未知错误'), 'error');
            } finally {
                setMigrationProgress(null);
                void refreshPageRef.current(1, true);
            }
        };

        const refreshAgentChanges = () => historyChangeRef.current({ type: 'remote-takeover', external: true });
        window.addEventListener('nai-project-data-changed', refreshAgentChanges);
        void initialize();
        return () => {
            unsubscribe();
            window.removeEventListener('nai-project-data-changed', refreshAgentChanges);
        };
    }, []);

    const getDisplayedRange = () => {
        if (items.length === 0 || totalCount === 0) {
            return { start: 0, end: 0 };
        }

        const order = dateRangeRef.current.orderIds || [];
        const first = order.indexOf(items[0].id);
        const last = order.indexOf(items[items.length - 1].id);
        return { start: first + 1, end: last + 1 };
    };

    const handleDelete = async (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (await confirmAction({
            title: '删除这张历史图片？',
            message: '图片记录和本地图片文件将被永久删除，此操作无法撤销。',
            confirmLabel: '确认删除',
            tone: 'danger',
        })) {
            try {
                await localHistory.delete(id);
                await removeBrowseItems(new Set([id]));
            } catch (e: any) {
                notify('删除失败: ' + (e?.message || '未知错误'), 'error');
            }
        }
    };

    const handleBulkDelete = async () => {
        if (!selectedIds.size) return;
        if (!await confirmAction({ title: `删除选中的 ${selectedIds.size} 张图片？`, message: '这些历史记录和本地图片文件将被永久删除。', confirmLabel: '批量删除', tone: 'danger' })) return;
        try {
            const deleted = new Set<string>();
            try {
                for (const id of selectedIds) { await localHistory.delete(id); deleted.add(id); }
            } finally {
                if (deleted.size) await removeBrowseItems(deleted);
                setSelectedIds(previous => new Set([...previous].filter(id => !deleted.has(id))));
            }
            setSelectionMode(false);
            setSelectedIds(new Set());
            notify('选中的历史图片已删除');
        } catch (e: any) {
            // 部分删除成功也在此统一处理：选中集不清空，便于用户重试剩余项
            notify('批量删除失败: ' + (e?.message || '未知错误'), 'error');
        }
    };

    const patchFavoriteState = (ids: Set<string>, favorite: boolean) => {
        const favoriteAt = favorite ? Date.now() : undefined;
        const patchItems = (source: LocalGenItem[]) => source.map(item => {
            if (!ids.has(item.id)) return item;
            const updated = { ...item, isFavorite: favorite };
            if (favoriteAt) updated.favoriteAt = favoriteAt;
            else delete updated.favoriteAt;
            return updated;
        });
        setItems(patchItems);
        const nextCache = Object.fromEntries(
            Object.entries(pageCacheRef.current).map(([page, pageItems]) => [page, patchItems(pageItems)])
        );
        setCacheState(nextCache);
        setLightbox(current => current && ids.has(current.id) ? patchItems([current])[0] : current);
    };

    const setFavoritePending = (ids: Iterable<string>, pending: boolean) => {
        setPendingFavoriteIds(previous => {
            const next = new Set(previous);
            for (const id of ids) pending ? next.add(id) : next.delete(id);
            return next;
        });
    };

    const handleFavorite = async (item: LocalGenItem, event?: React.SyntheticEvent) => {
        event?.stopPropagation();
        if (pendingFavoriteIds.has(item.id)) return;
        const favorite = !item.isFavorite;
        const originalQueryKey = getHistoryQueryKey();
        setFavoritePending([item.id], true);
        try {
            await localHistory.setFavorite(item.id, favorite);
            if (dateRangeRef.current.favoriteOnly && !favorite) {
                await removeBrowseItems(new Set([item.id]));
            } else {
                patchFavoriteState(new Set([item.id]), favorite);
            }
            if (originalQueryKey !== getHistoryQueryKey() && !dateRangeRef.current.orderIds) historyChangeRef.current({ type: 'remote-takeover', external: true });
        } catch (e: any) {
            notify((favorite ? '收藏失败: ' : '取消收藏失败: ') + (e?.message || '未知错误'), 'error');
        } finally {
            setFavoritePending([item.id], false);
        }
    };

    const handleBulkFavorite = async (favorite: boolean) => {
        const ids = Array.from(selectedIds);
        if (!ids.length) return;
        setFavoritePending(ids, true);
        try {
            await localHistory.setFavorites(ids, favorite);
            if (dateRangeRef.current.favoriteOnly && !favorite) {
                await removeBrowseItems(new Set(ids));
            } else {
                patchFavoriteState(new Set(ids), favorite);
            }
            setSelectionMode(false);
            setSelectedIds(new Set());
            notify(favorite ? `已收藏 ${ids.length} 张历史图片` : `已取消收藏 ${ids.length} 张历史图片`);
        } catch (e: any) {
            notify((favorite ? '批量收藏失败: ' : '批量取消收藏失败: ') + (e?.message || '未知错误'), 'error');
        } finally {
            setFavoritePending(ids, false);
        }
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedIds(new Set());
    };

    const selectCurrentPage = () => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            items.forEach(item => next.add(item.id));
            return next;
        });
    };

    const invertCurrentPageSelection = () => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            items.forEach(item => next.has(item.id) ? next.delete(item.id) : next.add(item.id));
            return next;
        });
    };

    const handleClearAll = async () => {
        if (await confirmAction({
            title: '清空全部生成历史？',
            message: '所有历史记录和本地历史图片都会被永久删除，包括已收藏图片。此操作无法撤销。',
            confirmLabel: '确认清空',
            tone: 'danger',
        })) {
            try {
                await localHistory.clear();
                dateRangeRef.current = { ...dateRangeRef.current, orderIds: [], browseKey: createUuid() };
                setNewImageCount(0);
                loadRequestRef.current++;
                setItems([]);
                setTotalCount(0);
                setTotalPages(1);
                currentPageRef.current = 1;
                setCurrentPage(1);
                setCacheState({});
                inflightPagesRef.current = {};
                setLightbox(null);
                setShowCleanMenu(false);
            } catch (e: any) {
                notify('清空失败: ' + (e?.message || '未知错误'), 'error');
            }
        }
    };

    const handleCleanMenuClick = (mode: 'days' | 'count') => {
        setCleanMode(mode);
        setShowCleanMenu(false);
        setShowCleanModal(true);
        // 预览将删除的数量
        if (mode === 'days') {
            localHistory.countOlderThan(cleanDays).then(setCleanPreviewCount).catch(() => setCleanPreviewCount(0));
        } else {
            localHistory.getCount().then(count => {
                setCleanPreviewCount(Math.max(0, count - cleanCount));
            }).catch(() => setCleanPreviewCount(0));
        }
    };

    const handleCleanConfirm = async () => {
        try {
            const normalizedValue = Math.floor(cleanMode === 'days' ? cleanDays : cleanCount);
            if (!Number.isFinite(normalizedValue) || normalizedValue < 1) {
                notify(cleanMode === 'days' ? '请输入有效天数' : '请输入有效保留数量', 'error');
                return;
            }

            if (cleanMode === 'days') {
                await localHistory.deleteOlderThan(normalizedValue);
            } else {
                await localHistory.keepOnly(normalizedValue);
            }
            setShowCleanModal(false);
            // 清空缓存，强制刷新页面数据和总数
            setCacheState({});
            inflightPagesRef.current = {};
            dateRangeRef.current = { ...browseQuery, browseKey: createUuid() };
            await goToPage(1, true); // 强制重新加载第一页，刷新总数
            notify('清理完成');
        } catch (e: any) {
            notify('清理失败: ' + e.message, 'error');
        }
    };

    const handlePublish = async () => {
        if (!lightbox) return;
        if (!publishTitle.trim()) {
            notify('请输入标题', 'error');
            return;
        }
        setIsPublishing(true);
        try {
            const importData = await getImportDataFromHistoryItem(lightbox);
            await db.saveInspiration({
                id: createUuid(),
                title: publishTitle,
                imageUrl: lightbox.imageUrl,
                prompt: importData.prompt,
                negativePrompt: importData.negativePrompt,
                params: importData.params,
                userId: currentUser.id,
                username: currentUser.username,
                tags: ['生成历史'],
                sourceType: 'history',
                sourceId: lightbox.id,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            notify('已加入灵感库，稍后可继续分类整理');
            setIsPublishing(false);
            if (lightboxRef.current?.id === lightbox.id) {
                setPublishTitle(''); setLightbox(null); setShowSuccessModal(true);
            }
            onRefreshInspiration?.();
        } catch (e: any) {
            notify('加入灵感库失败: ' + e.message, 'error');
            setIsPublishing(false);
        }
    };

    const handleImportToEditor = async () => {
        if (!lightbox || isPreparingImport) return;

        setIsPreparingImport(true);
        try {
            const importData = await getImportDataFromHistoryItem(lightbox);
            if (lightboxRef.current?.id !== lightbox.id) return;
            sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(importData));
            setLightbox(null);
            notify('参数已准备就绪，正在跳转到编辑器...');
            onNavigateToPlayground?.();
        } catch (e: any) {
            notify('导入失败: ' + e.message, 'error');
        } finally {
            setIsPreparingImport(false);
        }
    };

    const handleOpenImageEditor = (item: LocalGenItem, reuseEditMask = false) => {
        sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
            mode: 'image-edit',
            prompt: item.prompt,
            negativePrompt: item.negativePrompt || '',
            params: item.params,
            baseImageUrl: item.imageUrl,
            parentHistoryId: item.id,
            imageEditOperation: lowConsumption.enabled ? 'inpaint' : item.edit?.operation || 'image-to-image',
            editMetadata: !lowConsumption.enabled || item.edit?.operation === 'inpaint' ? item.edit : undefined,
            reuseEditMask: reuseEditMask && (!lowConsumption.enabled || item.edit?.operation === 'inpaint'),
        }));
        setLightbox(null);
        onNavigateToPlayground?.();
    };

    const historyGroups = useMemo(() => {
        if (browseQuery.sort === 'random' || browseQuery.sort === 'favorite') return [{ key: 'ordered', label: '', items }];
        const groups = new Map<string, LocalGenItem[]>();
        items.forEach(item => {
            const key = toDateInputValue(new Date(item.createdAt));
            const group = groups.get(key) || [];
            group.push(item);
            groups.set(key, group);
        });
        return Array.from(groups, ([key, groupItems]) => ({ key, label: formatHistoryDay(key), items: groupItems }));
    }, [items, browseQuery.sort]);
    const selectionFavoritePending = Array.from(selectedIds).some(id => pendingFavoriteIds.has(id));

    // 历史卡预计高度：图片区（列宽 / 图片比例）+ 边框 2px + 列间 12px 间距；手机端另计底部时间行。
    const estimateHistoryCardHeight = useCallback(
        (item: LocalGenItem, columnWidth: number) => {
            // 估算高度 = 图区（列宽 / 展示比例）+ 手机底部时间行 + 边框 + 列距；与卡片实测共用同一比例解析
            const ratio = resolveHistoryImageRatio(item, actualImageRatios[item.id]);
            const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
            return imageHeight + (isMobileViewport ? 34 : 0) + 2 + 12;
        },
        [isMobileViewport, actualImageRatios],
    );

    // 卡片回调全部以 item 作参数、useCallback 保持稳定：某一张图加载完成/收藏状态变化时，
    // 其余卡片的 memo 浅比较直接短路，只有真正相关的卡片重渲染。
    const handleToggleSelect = useCallback((itemId: string) => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            next.has(itemId) ? next.delete(itemId) : next.add(itemId);
            return next;
        });
    }, []);

    const handleLongPressSelect = useCallback((itemId: string) => {
        // 长按进入多选并把当前卡片选中；已处于多选时仅累加选中，不重复开启
        setSelectionMode(true);
        setSelectedIds(previous => new Set(previous).add(itemId));
    }, []);

    const handleOpenHistoryItem = useCallback((item: LocalGenItem) => {
        returnItemRef.current = item.id;
        setPublishTitle('');
        setLightbox(item);
    }, []);

    const handleCardFavorite = useCallback((item: LocalGenItem, event: React.MouseEvent) => {
        void handleFavorite(item, event);
    }, [handleFavorite]);

    const handleCardDelete = useCallback((item: LocalGenItem, event: React.MouseEvent) => {
        void handleDelete(item.id, event);
    }, [handleDelete]);

    const handleImageLoadRatio = useCallback((itemId: string, ratio: number) => {
        setActualImageRatios(previous => (previous[itemId] === ratio ? previous : { ...previous, [itemId]: ratio }));
    }, []);

    const renderHistoryCard = (item: LocalGenItem) => (
        <HistoryCard
            key={item.id}
            item={item}
            measuredRatio={actualImageRatios[item.id]}
            isSelected={selectedIds.has(item.id)}
            selectionMode={selectionMode}
            isFavoritePending={pendingFavoriteIds.has(item.id)}
            onToggleSelect={handleToggleSelect}
            onLongPressSelect={handleLongPressSelect}
            onOpen={handleOpenHistoryItem}
            onFavorite={handleCardFavorite}
            onDelete={handleCardDelete}
            onImageLoadRatio={handleImageLoadRatio}
            notify={notify}
        />
    );

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <WorkspaceToolbar>
                <div className="history-toolbar-shell">
                    {selectionMode ? <>
                        <span className="flex-1 whitespace-nowrap text-sm font-semibold md:hidden">已选 {selectedIds.size} 张</span>
                        <ToolbarButton onClick={exitSelectionMode} className="md:hidden">完成</ToolbarButton>
                        <div className="history-selection-actions hidden flex-1 md:flex">
                            <span className="mr-auto flex-none text-xs font-semibold text-gray-600 dark:text-gray-300">多选模式 · 已选 {selectedIds.size} 张</span>
                            <ToolbarButton onClick={selectCurrentPage}>全选本页</ToolbarButton>
                            <ToolbarButton onClick={invertCurrentPageSelection}>反选本页</ToolbarButton>
                            <span aria-hidden="true" className="history-toolbar-divider" />
                            <ToolbarButton tone="favorite" onClick={() => void handleBulkFavorite(true)} disabled={!selectedIds.size || selectionFavoritePending}>收藏选中</ToolbarButton>
                            <ToolbarButton onClick={() => void handleBulkFavorite(false)} disabled={!selectedIds.size || selectionFavoritePending}>取消收藏</ToolbarButton>
                            <ToolbarButton tone="danger" onClick={() => void handleBulkDelete()} disabled={!selectedIds.size}>删除选中</ToolbarButton>
                            <ToolbarButton onClick={exitSelectionMode}>退出多选</ToolbarButton>
                        </div>
                    </> : <>
                        <HistoryBrowseControls query={browseQuery} options={browseOptions} mobile={isMobileViewport} onApply={applyBrowseQuery} />
                        <div className="history-toolbar-status">
                            {newImageCount > 0 && <ToolbarButton aria-label={`新增 ${newImageCount} 张图片 · 查看最新`} title={`新增 ${newImageCount} 张图片 · 查看最新`} onClick={showNewImages} className="history-new-image-action !px-2.5"><span className="history-new-image-label">新图</span><span className="tabular-nums">+{newImageCount}</span></ToolbarButton>}
                            <span className="history-result-count">{totalCount} 张</span>
                            <div ref={managementAnchorRef} className="relative">
                                <ToolbarButton aria-label={newImageCount ? `管理，新增 ${newImageCount} 张图片` : '管理'} title={migrationProgress ? migrationProgress.total > 0 ? `正在迁移浏览器历史 ${migrationProgress.current}/${migrationProgress.total}，请勿关闭页面…` : '正在检查浏览器历史…' : '历史管理'} className="history-management-button relative" onClick={() => setShowCleanMenu(value => !value)} disabled={migrationProgress !== null}>
                                    {migrationProgress ? <span role="status" aria-label="历史迁移进度"><LoaderCircle className="animate-spin" /></span> : <ListChecks />}<span className="history-management-label">管理</span><ChevronDown className="history-management-chevron" />
                                    {newImageCount > 0 && <span aria-hidden="true" className="history-new-image-badge">{newImageCount > 99 ? '99+' : '+' + newImageCount}</span>}
                                </ToolbarButton>
                                {showCleanMenu && !isMobileViewport && (
                                    <AnchoredToolbarPopover anchorRef={managementAnchorRef} title="历史管理" width={256} onClose={() => setShowCleanMenu(false)}>
                                        <button
                                            type="button"
                                            onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); setShowCleanMenu(false); }}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                                        >
                                            <ListChecks className="h-4 w-4" />批量选择图片
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => handleCleanMenuClick('days')}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                                        >
                                            <Clock3 className="h-4 w-4" />按时间清理历史…
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCleanMenuClick('count')}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                                        >
                                            <Layers className="h-4 w-4" />按数量保留最新…
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleClearAll}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm border-t border-gray-200 mt-2 pt-3 dark:border-gray-800 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                        >
                                            <Trash2 className="h-4 w-4" />清空全部
                                        </button>
                                    </AnchoredToolbarPopover>
                                )}
                            </div>
                        </div>
                    </>}
                </div>
            </WorkspaceToolbar>

            <ImagePreviewPortal><MobileBottomSheet open={showCleanMenu && isMobileViewport} title="历史管理" onClose={() => setShowCleanMenu(false)}>
                <div className="space-y-2">
                            {newImageCount > 0 && <ToolbarButton className="w-full" onClick={() => { setShowCleanMenu(false); showNewImages(); }}>新增 {newImageCount} 张图片 · 查看最新</ToolbarButton>}
                            <button onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); setShowCleanMenu(false); }} className="mobile-touch w-full rounded-xl bg-indigo-50 px-4 text-left text-sm font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">批量选择图片</button>
                            <button onClick={() => handleCleanMenuClick('days')} className="mobile-touch w-full rounded-xl bg-gray-100 px-4 text-left text-sm dark:bg-gray-800">删除指定天数以前的历史</button>
                            <button onClick={() => handleCleanMenuClick('count')} className="mobile-touch w-full rounded-xl bg-gray-100 px-4 text-left text-sm dark:bg-gray-800">只保留最近指定数量</button>
                            <button onClick={handleClearAll} className="mobile-touch w-full rounded-xl bg-red-50 px-4 text-left text-sm font-bold text-red-600 dark:bg-red-950/40 dark:text-red-400">清空全部历史</button>
                </div>
            </MobileBottomSheet></ImagePreviewPortal>

            <ImagePreviewPortal><MobileBottomSheet open={showPageMenu && isMobileViewport} title="跳转页码" onClose={() => setShowPageMenu(false)}>
                <div className="space-y-3">
                    <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                        <button onClick={() => { void goToPage(1); setShowPageMenu(false); }} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-600">首页</button>
                        <input type="number" min="1" max={totalPages} value={jumpPage} onChange={event => setJumpPage(event.target.value)} placeholder={`${currentPage} / ${totalPages}`} className="min-w-0 rounded-xl border border-gray-300 bg-white px-3 text-center dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
                        <button onClick={() => { void goToPage(totalPages); setShowPageMenu(false); }} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-600">尾页</button>
                    </div>
                    <button onClick={() => { const page = Number(jumpPage); if (page >= 1 && page <= totalPages) void goToPage(page); setJumpPage(''); setShowPageMenu(false); }} className="mobile-touch w-full rounded-xl bg-indigo-600 font-bold text-white">跳转</button>
                </div>
            </MobileBottomSheet></ImagePreviewPortal>

            <div ref={historyScrollRef} onScroll={onScrollRestore} className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {loadFailed && <div role="alert" className="mb-4 flex items-center justify-center gap-3 text-sm text-gray-500"><span>历史加载失败</span><ToolbarButton onClick={() => void goToPage(currentPageRef.current, true)}>重试</ToolbarButton></div>}
                {isLoading ? (
                    <PageSpinner label="加载中…" className="h-full" />
                ) : items.length === 0 ? (
                    <EmptyState
                        className="h-full py-10"
                        icon={favoriteOnly ? <Heart className="h-8 w-8" /> : <Clock3 className="h-8 w-8" />}
                        title={browseQuery.from || browseQuery.to || browseQuery.search || browseQuery.model || browseQuery.operation || browseQuery.source ? '没有符合条件的历史图片' : favoriteOnly ? '还没有收藏历史图片' : '暂无生成记录'}
                        hint={browseQuery.from || browseQuery.to || browseQuery.search || browseQuery.model || browseQuery.operation || browseQuery.source ? '调整筛选条件，或重置条件查看全部历史' : favoriteOnly ? '点击图片右上角的爱心即可收藏' : '在实验室中生成的图片会自动保存到历史记录'}
                    />
                ) : (
                    <>
                        <div className="space-y-6">
                          {historyGroups.map(group => <section key={group.key}>
                            {group.label && <div className="mb-2 flex items-center gap-2 py-1.5">
                              <CalendarDays className="h-4 w-4 text-indigo-500" />
                              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">{group.label}</h2>
                              <span className="text-xs text-gray-400">{group.items.length} 张</span>
                            </div>}
                            {imageDisplay.layout === 'masonry' ? (
                              <ShortestColumnMasonry
                                items={group.items}
                                columns={masonryColumns}
                                getItemKey={item => item.id}
                                estimateItemHeight={estimateHistoryCardHeight}
                                renderItem={renderHistoryCard}
                              />
                            ) : (
                              <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-history-grid`} style={mobileGalleryStyle(imageDisplay)}>
                                {group.items.map(renderHistoryCard)}
                              </div>
                            )}
                          </section>)}
                        </div>
                        {selectionMode && <div className="mobile-safe-bottom fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t border-gray-200 bg-white/95 p-2 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 md:hidden"><div className="mb-1 text-center text-xs font-bold dark:text-white">多选模式 · 已选 {selectedIds.size} 张</div><div className="grid grid-cols-3 gap-2"><button onClick={selectCurrentPage} className="mobile-touch rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">全选</button><button onClick={invertCurrentPageSelection} className="mobile-touch rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">反选</button><button onClick={exitSelectionMode} className="mobile-touch rounded-xl bg-gray-100 text-sm font-bold dark:bg-gray-800">退出</button><button onClick={() => void handleBulkFavorite(true)} disabled={!selectedIds.size || selectionFavoritePending} className="mobile-touch rounded-xl bg-rose-500 text-sm font-bold text-white disabled:opacity-40">收藏</button><button onClick={() => void handleBulkFavorite(false)} disabled={!selectedIds.size || selectionFavoritePending} className="mobile-touch rounded-xl bg-rose-50 text-sm font-bold text-rose-600 disabled:opacity-40 dark:bg-rose-950/40 dark:text-rose-300">取消收藏</button><button onClick={() => void handleBulkDelete()} disabled={!selectedIds.size} className="mobile-touch rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-40">删除</button></div></div>}
                        {/* 底部分页信息 */}
                        <div className="mt-12 md:mt-16">
                            {totalCount > 0 && <>
                                <div className="mx-auto mb-4 flex max-w-sm items-center justify-center gap-2">
                                <button onClick={() => setShowPageMenu(true)} className="mobile-touch rounded-lg text-sm font-bold text-indigo-600 dark:text-indigo-300 md:hidden">已加载 {items.length} 张 · 跳转页码</button>
                                <form onSubmit={submitDesktopPageJump} className="hidden items-center justify-center gap-1.5 md:flex">
                                    <span className="text-sm text-gray-500">滚动浏览 · 跳到第</span>
                                    <input type="number" min="1" max={totalPages} value={desktopJumpPage} onChange={event => setDesktopJumpPage(event.target.value)} onFocus={event => event.currentTarget.select()} aria-label="输入页码跳转" className="h-10 w-16 rounded-lg border border-indigo-200 bg-white px-2 text-center text-sm font-bold text-indigo-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-indigo-900/60 dark:bg-gray-800 dark:text-indigo-300" />
                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-300">/ {totalPages} 页</span>
                                </form>
                            </div>
                            <div ref={historyPageSentinelRef} data-history-load-more="true" className="h-1 w-full" aria-hidden="true" />
                            </>}
                            <div className="flex flex-col items-center justify-center py-6">
                                {appendFailed && <ToolbarButton onClick={() => { setAppendFailed(false); void appendNextPage(); }}>加载更多失败 · 重试</ToolbarButton>}
                                {isLoading ? (
                                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />加载中...</div>
                                ) : (
                                    <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                        <p>当前显示第 {getDisplayedRange().start} - {getDisplayedRange().end} 张</p>
                                        <p className="mt-1">已加载 {items.length} / {totalCount} 张{favoriteOnly ? '收藏' : ''}{isAppending ? ' · 正在加载更多…' : ''}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* 大图浏览保持同一查询索引，参数与操作按需展开。 */}
            {lightbox && <HistoryImageViewer
                item={lightbox}
                index={Math.max(0, dateRangeRef.current.orderIds?.indexOf(lightbox.id) ?? 0)}
                total={totalCount}
                navigating={isNavigating || isPublishing || isPreparingImport}
                favoritePending={pendingFavoriteIds.has(lightbox.id)}
                detailsOpen={detailsOpen}
                onDetailsChange={setDetailsOpen}
                onNavigate={delta => void navigateToHistoryIndex((dateRangeRef.current.orderIds?.indexOf(lightbox.id) ?? 0) + delta)}
                onClose={closeLightbox}
                onFavorite={() => void handleFavorite(lightbox)}
                onDelete={() => void handleDelete(lightbox.id)}
                filename={getDownloadFilename(lightbox.createdAt)}
                notify={notify}
            >
                            <div className="space-y-4">
                                {!lightbox.prompt?.trim() && <ImageTaggerAction notify={notify} imageUrl={buildMediaUrl(lightbox.imageUrl, 'original')} text label="识别图片 Tag" />}
                                <details open className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><summary className="mb-3 cursor-pointer text-xs font-semibold">提示词与生成参数</summary><ParamsViewer
                                    params={lightbox.params}
                                    prompt={lightbox.prompt}
                                    negativePrompt={getHistoryNegativePrompt(lightbox)}
                                    edit={lightbox.edit}
                                    notify={notify}
                                /></details>
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4 space-y-3 flex-shrink-0">
                                {/* 导入到编辑器 */}
                                <ToolbarButton tone="primary" className="w-full" onClick={handleImportToEditor} disabled={isPreparingImport}>
                                    <Save />
                                    {isPreparingImport ? '正在读取元数据...' : '导入到编辑器'}
                                </ToolbarButton>
                                <ToolbarButton className="w-full" onClick={() => handleOpenImageEditor(lightbox)}>
                                    <Pencil />
                                    {lowConsumption.enabled ? '局部重绘这张图片（清空旧蒙版）' : '编辑这张图片（清空旧蒙版）'}
                                </ToolbarButton>
                                {lightbox.edit?.maskAvailable && (!lowConsumption.enabled || lightbox.edit.operation === 'inpaint') && <ToolbarButton className="w-full" onClick={() => handleOpenImageEditor(lightbox, true)}>
                                    <Pencil />
                                    编辑并复用原蒙版
                                </ToolbarButton>}

                                <details className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg"><summary className="cursor-pointer text-sm font-semibold">加入灵感库</summary>
                                    <div className="mt-3 flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="为这张图取个标题..."
                                            className="flex-1 px-3 py-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 text-sm outline-none dark:text-white focus:border-indigo-500 transition-colors"
                                            value={publishTitle}
                                            onChange={e => setPublishTitle(e.target.value)}
                                        />
                                        <ToolbarButton tone="primary" onClick={handlePublish} disabled={isPublishing} className="whitespace-nowrap">
                                            {isPublishing ? '整理中' : '加入'}
                                        </ToolbarButton>
                                    </div>
                                </details>
                            </div>
            </HistoryImageViewer>}

            {/* Clean Modal */}
            {showCleanModal && (<ImagePreviewPortal>
                <div role="dialog" aria-modal="true" aria-label="确认清理历史" className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="appearance-panel bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-gray-200 dark:border-gray-800">
                        <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><AlertTriangle className="h-5 w-5 text-amber-500" />确认清理</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            {cleanMode === 'days'
                                ? `将删除 ${cleanDays} 天前的 ${cleanPreviewCount} 张图片`
                                : `按全部生成历史执行，将删除 ${cleanPreviewCount} 张，只保留最近 ${cleanCount} 张`
                            }
                        </p>
                        <p className="text-xs text-red-500 mb-4">此操作无法恢复</p>
                        <div className="mb-4">
                            {cleanMode === 'days' ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">天数</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanDays}
                                        onChange={e => {
                                            const value = Number(e.target.value);
                                            setCleanDays(value);
                                            if (Number.isFinite(value) && value >= 1) {
                                                localHistory.countOlderThan(value).then(setCleanPreviewCount);
                                            } else {
                                                setCleanPreviewCount(0);
                                            }
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">保留数量</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanCount}
                                        onChange={e => {
                                            const value = Number(e.target.value);
                                            setCleanCount(value);
                                            if (Number.isFinite(value) && value >= 1) {
                                                localHistory.getCount().then(count => {
                                                    setCleanPreviewCount(Math.max(0, count - value));
                                                });
                                            } else {
                                                setCleanPreviewCount(0);
                                            }
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCleanModal(false)}
                                className="flex-1 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl font-bold"
                            >
                                取消
                            </button>
                            <button
                                data-agent-action="business" onClick={handleCleanConfirm}
                                disabled={!Number.isFinite(cleanMode === 'days' ? cleanDays : cleanCount) || (cleanMode === 'days' ? cleanDays : cleanCount) < 1}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            </ImagePreviewPortal>)}

            {/* Success Modal */}
            {showSuccessModal && (<ImagePreviewPortal>
                <div role="dialog" aria-modal="true" aria-label="已加入灵感库" className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="appearance-panel bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col items-center text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center text-3xl mb-4">
                            ✨
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">已加入灵感库</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            图片与完整参数已保存，可前往灵感库继续添加灵感板、标签和备注。
                        </p>
                        <button
                            onClick={() => setShowSuccessModal(false)}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg transition-all"
                        >
                            确定
                        </button>
                    </div>
                </div>
            </ImagePreviewPortal>)}
        </div>
    );
};
