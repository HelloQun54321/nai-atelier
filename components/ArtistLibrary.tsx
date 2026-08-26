
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Artist, User } from '../types';
import { generateImage } from '../services/naiService'; // Import generation service
import { api } from '../services/api'; // Import api for updating
import { db } from '../services/dbService'; // Import DB to fetch config
import { ArtistLibraryConfig } from './ArtistLibraryConfig';
import { ArtistLibraryCart } from './ArtistLibraryCart';
import { ArtistDictionaryEntry, ArtistDictionarySort, getArtistDictionaryEntriesAt, getArtistDictionaryPage, searchArtistDictionary } from '../services/tagDictionary';
import { OriginalImage, SmartImage } from './SmartImage';
import { createUuid } from '../services/id';
import { MobileBottomSheet, MobileIconButton } from './MobileUI';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry } from './ShortestColumnMasonry';
import { Bot, ChevronDown, ClipboardList, Clock3, Dice5, Download, Grid3X3, Heart, List, LoaderCircle, Menu, MoreHorizontal, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { DanbooruCover } from './DanbooruCover';
import type { DanbooruCoverCandidate } from '../services/danbooruService';
import { danbooruService } from '../services/danbooruService';
import { importDanbooruCoverAsDataUrl } from '../services/danbooruCoverImport';
import { TagCoverActions } from './TagCoverActions';

interface CartItem {
    name: string;
    weight: number; // 0 normal, >0 {}, <0 []
}

interface ArtistLibraryProps {
    // New props for caching
    artistsData: Artist[] | null;
    onRefresh: () => Promise<void>;
    notify: (msg: string, type?: 'success' | 'error') => void;
    currentUser?: User | null; // Add current user prop for permission check
}

const compressImage = async (source: string, quality = 0.8): Promise<string> => {
    const response = await fetch(source);
    const sourceBlob = await response.blob();
    const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取压缩图片失败'));
        reader.readAsDataURL(blob);
    });
    const bitmap = await createImageBitmap(sourceBlob);
    try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return toDataUrl(sourceBlob);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            value => value ? resolve(value) : reject(new Error('图片压缩失败')),
            'image/jpeg',
            quality,
        ));
        return await toDataUrl(blob);
    } finally {
        bitmap.close();
    }
};

const LazyImage = SmartImage;

// --- Benchmark Config Interface ---
interface BenchmarkSlot {
    label: string;
    prompt: string;
}

interface BenchmarkConfig {
    slots: BenchmarkSlot[]; // Flexible slots
    negative: string;
    seed: number;
    steps: number;
    scale: number;
    interval?: number; // Added interval
}

const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
    slots: [
        {
            label: "面部",
            prompt: "masterpiece, best quality, 1girl, solo,\ncowboy shot, slight tilt head, three-quarter view,\nhand on face, peace sign, index finger raised, (dynamic pose),\ndetailed face, detailed eyes, blushing, happy, open mouth,\nmessy hair, hair ornament,\nwhite shirt, collarbone,\nsimple background, soft lighting, "
        },
        {
            label: "体态",
            prompt: "masterpiece, best quality, 1girl, solo,\nkneeling, from above, looking at viewer,\nbikini, wet skin, long hair, medium breasts, soft shading, clear form, (detailed anatomy:1.1), extremely detailed figure, \nstomach, navel, cleavage, collarbone, beautiful hands,\nthighs, barefoot,\nbeach, ocean, cinematic lighting, detailed characters, amazing quality, very aesthetic, absurdres, high detail, ultra-detailed,"
        },
        {
            label: "场景",
            prompt: "masterpiece, best quality, 1girl, solo,\nfull body, walking, looking back,\nfantasy clothes, cape, armor, holding sword,\nwind, hair blowing, petals,\nruins, forest, overgrown, detailed background, depth of field,\ndappled sunlight, atmospheric, intricate details,"
        }
    ],
    negative: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, censorbar, mosaic, censoring, bar censor, convenient censoring, bad anatomy, bad hands, text, error, missing fingers, crop,",
    seed: -1, // Random
    steps: 28,
    scale: 6,
    interval: 3000 // Default 3s
};

// Queue Item Interface
interface GenTask {
    uniqueId: string;
    artistId: string;
    artistName: string;
    slot: number;
}

interface LogEntry {
    time: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

type ArtistGachaMode = 'mixed' | 'uniform' | 'popular';

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ artistsData, onRefresh, notify, currentUser }) => {
    const imageDisplay = useMobileImageDisplayPreferences();
    // 瀑布流（masonry 布局时）：封面按真实宽高比完整显示，最短列分配互相补齐。
    const [artistRatios, setArtistRatios] = useState<Record<string, number>>({});
    const estimateArtistCardHeight = React.useCallback((artist: (typeof filteredArtists)[number], columnWidth: number) => {
      const ratio = artistRatios[artist.id] || 2 / 3;
      const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
      return imageHeight + 78; // 名称 + 中文名 + 作品数文本区
    }, [artistRatios]);
    const renderArtistCard = (artist: (typeof filteredArtists)[number]) => {
                            const isSelected = !!cart.find(c => c.name === artist.name);
                            const isFav = favorites.has(artist.name);
                            let displayImg = artist.imageUrl || artist.benchmarks?.[0] || artist.previewUrl || '';
                            let isBenchmarkMissing = false;

                            if (viewMode === 'benchmark') {
                                if (artist.benchmarks && artist.benchmarks[activeSlot]) {
                                    displayImg = artist.benchmarks[activeSlot];
                                } else if (activeSlot === 0 && artist.previewUrl) {
                                    displayImg = artist.previewUrl;
                                } else {
                                    isBenchmarkMissing = true;
                                }
                            }

                            const isTaskPending = taskQueue.some(t => t.artistId === artist.id);
                            const isTaskRunning = currentTask?.artistId === artist.id;
                            const isTaskFailed = failedTasks.some(t => t.artistId === artist.id);

                            return (
                                <div
                                    key={artist.id}
                                    data-safe-mode-work="true"
                                    className={`mobile-gallery-item group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden border transition-colors cursor-pointer ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}
                                    onClick={() => toggleCart(artist.name)}
                                >
                                    <div className="mobile-gallery-frame md:aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': artistRatios[artist.id] ? `${Math.round(artistRatios[artist.id] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                                        {viewMode === 'original' ? (
                                            <DanbooruCover
                                                tag={artist.name}
                                                kind="artist"
                                                alt={artist.chineseName || artist.name}
                                                fixedSrc={displayImg}
                                                onCandidateChange={candidate => rememberCoverCandidate(artist.id, candidate)}
                                                onImageLoad={(width, height) => { const r = width / Math.max(1, height); if (Number.isFinite(r) && r > 0) setArtistRatios(previous => (previous[artist.id] === r ? previous : { ...previous, [artist.id]: r })); }}
                                            />
                                        ) : displayImg && !isBenchmarkMissing ? (
                                            <LazyImage src={displayImg} alt={artist.name} onLoad={event => { const img = event.currentTarget; if (img.naturalWidth > 0 && img.naturalHeight > 0) { const r = img.naturalWidth / img.naturalHeight; if (Number.isFinite(r) && r > 0) setArtistRatios(previous => (previous[artist.id] === r ? previous : { ...previous, [artist.id]: r })); } }} />
                                        ) : <DanbooruCover tag={artist.name} kind="artist" alt={artist.chineseName || artist.name} />}
                                        {(isTaskPending || isTaskRunning || isTaskFailed) && (
                                            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10">
                                                {isTaskRunning ? (
                                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
                                                ) : isTaskFailed ? (
                                                    <div className="text-white text-xs font-bold bg-red-500 px-2 py-1 rounded">Failed</div>
                                                ) : (
                                                    <div className="text-white text-xs font-bold bg-indigo-500 px-2 py-1 rounded">Queue</div>
                                                )}
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                                        <TagCoverActions
                                            favorite={isFav}
                                            onToggleFavorite={() => toggleFav(artist.name)}
                                            candidate={viewMode === 'original' ? coverCandidates[artist.id] : null}
                                            onSetCover={viewMode === 'original' ? candidate => setDanbooruCover(artist, candidate) : undefined}
                                            pinPlacement="bottom-right"
                                        >
                                            {isAdmin && viewMode === 'benchmark' && apiKey && (
                                                <>
                                                    <button
                                                        onClick={(e) => queueGeneration(artist, [activeSlot], e)}
                                                        className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-purple-600 hover:text-purple-500"
                                                        title={`生成当前组 (Slot ${activeSlot + 1})`}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                    </button>
                                                    <button
                                                        onClick={(e) => queueGeneration(artist, config.slots.map((_, i) => i), e)}
                                                        className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm pointer-events-auto text-green-600 hover:text-green-500"
                                                        title={`一键生成全部 ${config.slots.length} 组`}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" /></svg>
                                                    </button>
                                                </>
                                            )}
                                        </TagCoverActions>

                                        {isSelected && (
                                            <div className="absolute inset-0 border-4 border-indigo-500/80 pointer-events-none">
                                                <div className="absolute top-2 left-2 bg-indigo-600 text-white p-1 rounded-full shadow-lg">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-2 md:p-3 bg-white dark:bg-gray-800 text-center border-t border-gray-100 dark:border-gray-700">
                                        <div data-safe-mode-title="true" className={`text-xs md:text-sm font-bold truncate ${isSelected ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-300'}`}>{artist.name}</div>
                                        {artist.chineseName && <div data-safe-mode-title="true" className="mt-0.5 truncate text-[10px] text-gray-400" title={artist.chineseName}>{artist.chineseName}</div>}
                                        {typeof artist.postCount === 'number' && <div className="mt-0.5 text-[10px] font-mono text-gray-500" title="Danbooru 关联作品数">作品 {artist.postCount.toLocaleString('zh-CN')}</div>}
                                    </div>
                                </div>
                            )
                        
    };

    const [searchTerm, setSearchTerm] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [coverCandidates, setCoverCandidates] = useState<Record<string, DanbooruCoverCandidate | null>>({});
    const [showFavOnly, setShowFavOnly] = useState(false);
    const [usePrefix, setUsePrefix] = useState(true);
    const [lightboxState, setLightboxState] = useState<{ artistIdx: number, slotIdx: number } | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadedCatalogArtists, setLoadedCatalogArtists] = useState<ArtistDictionaryEntry[]>([]);
    const [catalogSearchResults, setCatalogSearchResults] = useState<ArtistDictionaryEntry[]>([]);
    const [artistCatalogCount, setArtistCatalogCount] = useState(0);
    const [isCatalogLoading, setIsCatalogLoading] = useState(true);
    const [isLoadingMoreCatalog, setIsLoadingMoreCatalog] = useState(false);
    const [hasMoreCatalog, setHasMoreCatalog] = useState(false);
    const [artistSort, setArtistSort] = useState<ArtistDictionarySort>(() => {
        const saved = localStorage.getItem('nai_artist_sort');
        return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' ? saved : 'popular';
    });
    const catalogSearchRequestRef = useRef(0);
    const catalogSentinelRef = useRef<HTMLDivElement>(null);
    const nextCatalogPageRef = useRef(0);
    const catalogPageCountRef = useRef(0);
    const catalogPageLoadingRef = useRef(false);
    const catalogLoadGenerationRef = useRef(0);
    const artistSortRef = useRef<ArtistDictionarySort>(artistSort);

    // New State for features
    const [history, setHistory] = useState<{ text: string, time: string }[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [importText, setImportText] = useState('');
    const [gachaCount, setGachaCount] = useState<6 | 12 | 24>(() => {
        const saved = Number(localStorage.getItem('nai_artist_gacha_count'));
        return saved === 6 || saved === 24 ? saved : 12;
    });
    const [gachaMode, setGachaMode] = useState<ArtistGachaMode>(() => {
        const saved = localStorage.getItem('nai_artist_gacha_mode');
        return saved === 'uniform' || saved === 'popular' ? saved : 'mixed';
    });
    const [gachaArtists, setGachaArtists] = useState<ArtistDictionaryEntry[] | null>(null);
    const [isGachaLoading, setIsGachaLoading] = useState(false);
    const recentGachaIndicesRef = useRef<number[][]>([]);
    const catalogScrollTopRef = useRef(0);

    // Layout State
    const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');

    // View Settings
    // Grid: Columns (3-15)
    const [gridCols, setGridCols] = useState(() => Number(localStorage.getItem('nai_artist_grid_columns')) || 6);
    const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
    const [showMobileTools, setShowMobileTools] = useState(false);
    const [showDisplayTools, setShowDisplayTools] = useState(false);
    const [showGachaTools, setShowGachaTools] = useState(false);
    const [showMoreTools, setShowMoreTools] = useState(false);

    useEffect(() => {
        const media = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsMobileViewport(media.matches);
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, []);

    useEffect(() => {
        const syncAgentFavorites = () => {
            try {
                const saved = JSON.parse(localStorage.getItem('nai_fav_artists') || '[]');
                setFavorites(new Set(Array.isArray(saved) ? saved : []));
            } catch { setFavorites(new Set()); }
        };
        window.addEventListener('nai-agent-artist-favorites-change', syncAgentFavorites);
        return () => window.removeEventListener('nai-agent-artist-favorites-change', syncAgentFavorites);
    }, []);
    // List: Image Width (px)
    const [listImgWidth, setListImgWidth] = useState(128);

    // Benchmark / Preview Mode State
    const [viewMode, setViewMode] = useState<'original' | 'benchmark'>('original');
    const [activeSlot, setActiveSlot] = useState<number>(0); // Index of config.slots

    // Benchmark Settings
    const [showConfig, setShowConfig] = useState(false);
    const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_BENCHMARK_CONFIG);

    const [apiKey, setApiKey] = useState('');
    
    // Personal mode: the local owner always manages this library.
    const isAdmin = true;
    const canManageArtists = true;

    // Queue System
    const [taskQueue, setTaskQueue] = useState<GenTask[]>([]);
    const [failedTasks, setFailedTasks] = useState<GenTask[]>([]); // New: Failed Queue
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    // 队列生命周期：卸载后不再启动新任务（进行中的生成允许完成并落库，避免浪费已扣费额度）；
    // 暂停需要用 ref 才能在节流等待结束时被旧闭包感知。
    const queueAliveRef = useRef(true);
    const isPausedRef = useRef(false);
    useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
    useEffect(() => () => { queueAliveRef.current = false; }, []);
    const [currentTask, setCurrentTask] = useState<GenTask | null>(null);

    // Logs System
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    // Load data & Config
    useEffect(() => {
        // localStorage 可能被并发写入损坏（如 Agent 面板写 nai_fav_artists），解析失败时回退为空
        const savedFav = localStorage.getItem('nai_fav_artists');
        if (savedFav) {
            try {
                const parsed = JSON.parse(savedFav);
                setFavorites(new Set(Array.isArray(parsed) ? parsed : []));
            } catch { setFavorites(new Set()); }
        }

        const savedPrefix = localStorage.getItem('nai_use_prefix');
        if (savedPrefix !== null) setUsePrefix(savedPrefix === 'true');

        const savedHistory = localStorage.getItem('nai_copy_history');
        if (savedHistory) {
            try {
                const parsed = JSON.parse(savedHistory);
                setHistory(Array.isArray(parsed) ? parsed : []);
            } catch { setHistory([]); }
        }

        // Load Config from Server (Public)
        db.getBenchmarkConfig().then(cfg => {
            if (cfg) setConfig(cfg);
        }).catch(err => {
            console.error("Failed to load benchmark config from server", err);
            // Fallback to local storage if server fails (backward compat)
            const savedConfig = localStorage.getItem('nai_benchmark_config');
            if (savedConfig) {
                try {
                    const parsed = JSON.parse(savedConfig);
                    if (!parsed.slots || parsed.slots.length === 0) parsed.slots = DEFAULT_BENCHMARK_CONFIG.slots;
                    setConfig(parsed);
                } catch (e) { }
            }
        });

        // API Key 安全存储策略：
        // 1. 优先从 sessionStorage 读取（会话级，关闭标签页即清除）
        // 2. 其次从 localStorage 读取（持久化，用户明确选择"记住"）
        // 注意：前端无法真正保护存储的密钥，"记住"功能意味着用户接受风险
        const sessionKey = sessionStorage.getItem('nai_api_key');
        if (sessionKey) {
            setApiKey(sessionKey);
        } else {
            const savedKey = localStorage.getItem('nai_api_key');
            if (savedKey) {
                setApiKey(savedKey);
            }
        }
    }, []);

    const loadNextCatalogPage = useCallback(async () => {
        if (catalogPageLoadingRef.current || nextCatalogPageRef.current >= catalogPageCountRef.current) return;
        const generation = catalogLoadGenerationRef.current;
        catalogPageLoadingRef.current = true;
        setIsLoadingMoreCatalog(true);
        try {
            const result = await getArtistDictionaryPage(nextCatalogPageRef.current, artistSortRef.current);
            if (generation !== catalogLoadGenerationRef.current) return;
            setLoadedCatalogArtists(previous => [...previous, ...result.entries]);
            nextCatalogPageRef.current = result.page + 1;
            setHasMoreCatalog(nextCatalogPageRef.current < result.pageCount);
        } catch (error) {
            console.warn('Unable to load more artist tags:', error);
        } finally {
            if (generation === catalogLoadGenerationRef.current) {
                catalogPageLoadingRef.current = false;
                setIsLoadingMoreCatalog(false);
            }
        }
    }, []);

    useEffect(() => {
        artistSortRef.current = artistSort;
        localStorage.setItem('nai_artist_sort', artistSort);
        const generation = ++catalogLoadGenerationRef.current;
        catalogPageLoadingRef.current = true;
        nextCatalogPageRef.current = 0;
        catalogPageCountRef.current = 0;
        setLoadedCatalogArtists([]);
        setHasMoreCatalog(false);
        setIsCatalogLoading(true);
        setIsLoadingMoreCatalog(false);
        scrollContainerRef.current?.scrollTo({ top: 0 });
        let cancelled = false;
        getArtistDictionaryPage(0, artistSort)
            .then(result => {
                if (cancelled || generation !== catalogLoadGenerationRef.current) return;
                setLoadedCatalogArtists(result.entries);
                setArtistCatalogCount(result.total);
                nextCatalogPageRef.current = 1;
                catalogPageCountRef.current = result.pageCount;
                setHasMoreCatalog(result.pageCount > 1);
            })
            .catch(error => {
                console.warn('Artist tag catalog is unavailable:', error);
                notify('画师 Tag 目录加载失败：请先在“全局设置 → Tag 词库”中安装/更新词库数据', 'error');
            })
            .finally(() => {
                if (!cancelled && generation === catalogLoadGenerationRef.current) {
                    catalogPageLoadingRef.current = false;
                    setIsCatalogLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [artistSort]);

    useEffect(() => {
        const query = searchTerm.trim();
        const requestId = ++catalogSearchRequestRef.current;
        if (!query) {
            setCatalogSearchResults([]);
            return;
        }

        setIsCatalogLoading(true);
        const timer = window.setTimeout(() => {
            searchArtistDictionary(query, 200, artistSort)
                .then(results => {
                    if (requestId === catalogSearchRequestRef.current) setCatalogSearchResults(results);
                })
                .catch(error => {
                    if (requestId === catalogSearchRequestRef.current) setCatalogSearchResults([]);
                    console.warn('Artist tag search failed:', error);
                })
                .finally(() => {
                    if (requestId === catalogSearchRequestRef.current) setIsCatalogLoading(false);
                });
        }, 180);
        return () => window.clearTimeout(timer);
    }, [artistSort, searchTerm]);

    useEffect(() => {
        if (searchTerm.trim() || gachaArtists || !hasMoreCatalog) return;
        const sentinel = catalogSentinelRef.current;
        const root = scrollContainerRef.current;
        if (!sentinel || !root) return;

        const observer = new IntersectionObserver(entries => {
            if (entries[0]?.isIntersecting) void loadNextCatalogPage();
        }, { root, rootMargin: '800px 0px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [gachaArtists, hasMoreCatalog, loadNextCatalogPage, searchTerm]);

    // API Key 存储状态：是否记住（持久化到 localStorage）
    const [rememberApiKey, setRememberApiKey] = useState(() => {
        return localStorage.getItem('nai_api_key') !== null;
    });

    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        // 始终存入 sessionStorage（会话级）
        sessionStorage.setItem('nai_api_key', val);
        // 仅在用户选择"记住"时持久化到 localStorage
        if (rememberApiKey) {
            localStorage.setItem('nai_api_key', val);
        } else {
            localStorage.removeItem('nai_api_key');
        }
        window.dispatchEvent(new CustomEvent<string>('nai-api-key-changed', { detail: val }));
    };

    useEffect(() => {
        const syncApiKey = (event: Event) => {
            const nextValue = event instanceof CustomEvent
                ? String(event.detail || '')
                : (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
            setApiKey(nextValue);
            setRememberApiKey(localStorage.getItem('nai_api_key') !== null);
        };
        window.addEventListener('nai-api-key-changed', syncApiKey);
        window.addEventListener('storage', syncApiKey);
        return () => {
            window.removeEventListener('nai-api-key-changed', syncApiKey);
            window.removeEventListener('storage', syncApiKey);
        };
    }, []);

    const handleRememberKeyChange = (remember: boolean) => {
        setRememberApiKey(remember);
        if (remember && apiKey) {
            // 用户选择记住，持久化当前 Key（用户需自行承担风险）
            localStorage.setItem('nai_api_key', apiKey);
        } else {
            // 用户取消记住，清除 localStorage
            localStorage.removeItem('nai_api_key');
        }
    };

    const handleRefresh = async () => {
        setIsLoading(true);
        await onRefresh();
        setIsLoading(false);
    };

    const setDanbooruCover = async (artist: Artist, candidate: DanbooruCoverCandidate) => {
        try {
            // 先通过本机媒体网关读取原图，再提交 data URL；Worker 只负责存储不再直连 Danbooru CDN
            const coverDataUrl = await importDanbooruCoverAsDataUrl(candidate.sampleUrl);
            await api.post('/artists', {
                id: artist.id,
                name: artist.name,
                imageUrl: coverDataUrl,
                previewUrl: artist.previewUrl,
                benchmarks: artist.benchmarks || [],
            });
            await onRefresh();
            notify(`已将当前热门图设为“${artist.chineseName || artist.name}”的封面`);
        } catch (error) {
            notify(`设置封面失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
            throw error;
        }
    };

    const rememberCoverCandidate = useCallback((artistId: string, candidate: DanbooruCoverCandidate | null) => {
        setCoverCandidates(previous => previous[artistId]?.id === candidate?.id ? previous : { ...previous, [artistId]: candidate });
    }, []);

    const addToHistory = (text: string) => {
        const newEntry = { text, time: new Date().toLocaleTimeString() };
        const newHistory = [newEntry, ...history.filter(h => h.text !== text)].slice(30);
        setHistory(newHistory);
        localStorage.setItem('nai_copy_history', JSON.stringify(newHistory));
    };

    const toggleFav = (name: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        const newFav = new Set(favorites);
        if (newFav.has(name)) newFav.delete(name);
        else newFav.add(name);
        setFavorites(newFav);
        localStorage.setItem('nai_fav_artists', JSON.stringify(Array.from(newFav)));
    };

    const toggleCart = (name: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (cart.find(i => i.name === name)) {
            setCart(cart.filter(i => i.name !== name));
        } else {
            setCart([...cart, { name, weight: 0 }]);
        }
    };

    const updateWeight = (index: number, delta: number) => {
        const newCart = [...cart];
        let w = newCart[index].weight + delta;
        if (w > 3) w = 3;
        if (w < -3) w = -3;
        newCart[index].weight = w;
        setCart(newCart);
    };

    const formatTag = (item: CartItem) => {
        let s = (usePrefix ? 'artist:' : '') + item.name;
        if (item.weight > 0) s = "{".repeat(item.weight) + s + "}".repeat(item.weight);
        if (item.weight < 0) s = "[".repeat(Math.abs(item.weight)) + s + "]".repeat(Math.abs(item.weight));
        return s;
    };

    const copyCart = () => {
        const str = cart.map(formatTag).join(', ');
        navigator.clipboard.writeText(str);
        addToHistory(str);
        notify('组合串已复制！');
    };

    const catalogArtistId = (name: string) => {
        let hash = 2166136261;
        for (let index = 0; index < name.length; index++) {
            hash ^= name.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `catalog-${(hash >>> 0).toString(16)}`;
    };

    const availableArtists = useMemo(() => {
        const catalogEntries = searchTerm.trim() ? catalogSearchResults : (gachaArtists || loadedCatalogArtists);
        const persistedByName = new Map((artistsData || []).map(artist => [artist.name.toLowerCase(), artist]));
        const included = new Set<string>();
        const result: Artist[] = [];

        for (const entry of catalogEntries) {
            const key = entry.name.toLowerCase();
            const persisted = persistedByName.get(key);
            included.add(key);
            result.push({
                id: persisted?.id || catalogArtistId(entry.name),
                name: entry.name,
                imageUrl: persisted?.imageUrl || '',
                previewUrl: persisted?.previewUrl,
                benchmarks: persisted?.benchmarks || [],
                chineseName: entry.chinese,
                postCount: entry.postCount,
                catalogOnly: !persisted
            });
        }

        if (!gachaArtists) {
            for (const artist of [...(artistsData || [])].sort((a, b) => a.name.localeCompare(b.name))) {
                const key = artist.name.toLowerCase();
                if (included.has(key)) continue;
                result.push({
                    ...artist,
                    catalogOnly: false
                });
            }
        }

        return result;
    }, [artistsData, catalogSearchResults, gachaArtists, loadedCatalogArtists, searchTerm]);

    // MEMOIZED Filtered Artists to prevent stutter during layout changes
    const filteredArtists = useMemo(() => {
        return availableArtists.filter(a => {
            if (showFavOnly && !favorites.has(a.name)) return false;
            if (searchTerm) {
                const query = searchTerm.toLowerCase();
                return a.name.toLowerCase().includes(query) || a.chineseName?.toLowerCase().includes(query);
            }
            return true;
        });
    }, [availableArtists, showFavOnly, favorites, searchTerm]);

    // 目录预取：当前页可见画师（前 40 个）的封面候选提前请求并固定保存（pin），
    // 滚动/浏览时封面秒出；getCoverSet 自带 14 天缓存与 300ms 串行限流，不重复打 Danbooru API。
    const coverPrewarmedRef = useRef(new Set<string>());
    useEffect(() => {
        if (gachaArtists) return;
        const targets = filteredArtists
            .filter(artist => !coverPrewarmedRef.current.has(artist.name))
            .slice(0, 40);
        if (!targets.length) return;
        for (const artist of targets) {
            coverPrewarmedRef.current.add(artist.name);
            void danbooruService.getCoverSet(artist.name, 'artist').then(set => {
                const src = set.representative?.sampleUrl || set.candidates?.[0]?.sampleUrl;
                if (!src) return;
                fetch('/api/media/prewarm', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sources: [src], pin: true }),
                }).catch(() => {});
            }).catch(() => {});
        }
    }, [filteredArtists, gachaArtists]);

    // --- New Features Logic ---

    const drawGachaIndex = (mode: ArtistGachaMode, total: number) => {
        if (mode === 'uniform') return Math.floor(Math.random() * total);
        if (mode === 'popular') return Math.min(total - 1, Math.floor(Math.pow(Math.random(), 2.3) * total));
        const activePoolSize = Math.min(20_000, total);
        return Math.random() < 0.7
            ? Math.floor(Math.random() * activePoolSize)
            : Math.floor(Math.random() * total);
    };

    const drawGacha = async () => {
        if (artistCatalogCount <= 0 || isGachaLoading) return;
        if (!gachaArtists) catalogScrollTopRef.current = scrollContainerRef.current?.scrollTop || 0;

        setIsGachaLoading(true);
        setSearchTerm('');
        setShowFavOnly(false);
        localStorage.setItem('nai_artist_gacha_mode', gachaMode);
        localStorage.setItem('nai_artist_gacha_count', String(gachaCount));

        try {
            const recentIndices = new Set(recentGachaIndicesRef.current.flat());
            const selectedIndices = new Set<number>();
            let attempts = 0;
            while (selectedIndices.size < gachaCount && attempts < 10_000) {
                attempts += 1;
                const index = drawGachaIndex(gachaMode, artistCatalogCount);
                if (!recentIndices.has(index)) selectedIndices.add(index);
            }
            while (selectedIndices.size < gachaCount) {
                selectedIndices.add(drawGachaIndex(gachaMode, artistCatalogCount));
            }

            const indices = [...selectedIndices];
            const artists = await getArtistDictionaryEntriesAt(indices);
            setGachaArtists(artists);
            recentGachaIndicesRef.current = [...recentGachaIndicesRef.current, indices].slice(-5);
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
            console.warn('Artist gacha failed:', error);
            notify('抽卡失败，请稍后重试', 'error');
        } finally {
            setIsGachaLoading(false);
        }
    };

    const returnToCatalog = () => {
        setSearchTerm('');
        setGachaArtists(null);
        requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: catalogScrollTopRef.current }));
    };

    const handleImport = () => {
        const tags = importText.split(/[,，\n]/).map(s => s.trim()).filter(s => s);
        const newItems: CartItem[] = [];

        tags.forEach(raw => {
            let name = raw.replace(/^artist:/i, '');
            let weight = 0;

            // Simple brace counting
            const openBraces = (name.match(/\{/g) || []).length;
            const closeBraces = (name.match(/\}/g) || []).length;
            const openBrackets = (name.match(/\[/g) || []).length;
            const closeBrackets = (name.match(/\]/g) || []).length;

            if (openBraces > 0 && openBraces === closeBraces) {
                weight = openBraces;
                name = name.replace(/[\{\}]/g, '');
            } else if (openBrackets > 0 && openBrackets === closeBrackets) {
                weight = -openBrackets;
                name = name.replace(/[\[\]]/g, '');
            }

            // Match with known artists
            const matched = availableArtists.find(a => a.name.toLowerCase() === name.toLowerCase());
            if (matched) {
                // Avoid duplicates in batch
                if (!newItems.find(i => i.name === matched.name)) {
                    newItems.push({ name: matched.name, weight });
                }
            }
        });

        // Merge with cart
        const finalCart = [...cart];
        newItems.forEach(item => {
            if (!finalCart.find(c => c.name === item.name)) {
                finalCart.push(item);
            }
        });
        setCart(finalCart);
        setShowImport(false);
        setImportText('');
        notify(`已导入 ${newItems.length} 位画师`);
    };

    // --- Config Modal Logic (Refactored to separate component) ---
    const saveConfig = async (newConfig: BenchmarkConfig) => {
        // Basic validation
        if (newConfig.slots.length === 0) {
            notify('至少需要一个测试分组', 'error');
            return;
        }
        // Apply Draft to Real Config & Save to Server
        setConfig(newConfig);

        try {
            await db.saveBenchmarkConfig(newConfig);
            notify('配置已保存 (同步至云端)');
        } catch (e) {
            console.error(e);
            notify('保存失败，仅本地生效', 'error');
            localStorage.setItem('nai_benchmark_config', JSON.stringify(newConfig)); // Fallback
        }

        // Safety: if active slot was deleted, reset to 0
        if (activeSlot >= newConfig.slots.length) {
            setActiveSlot(0);
        }

        setShowConfig(false);
    };

    // Helper Log
    const addLog = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        const entry: LogEntry = {
            time: new Date().toLocaleTimeString(),
            message: msg,
            type
        };
        setLogs(prev => [entry, ...prev].slice(0, 100)); // Keep last 100 logs
        console.log(`[Queue] ${msg}`);
    };

    // --- Queue Processor ---
    useEffect(() => {
        const processNext = async () => {
            // Check Pause state
            if (isProcessing || taskQueue.length === 0 || isPaused) return;

            // Delay to prevent 429 (Throttle)
            setIsProcessing(true);
            // Use configured interval, default to 2000ms if missing
            const delay = config.interval && config.interval > 500 ? config.interval : 2000;
            await new Promise(res => setTimeout(res, delay));

            // 等待期间组件已卸载或队列被暂停：不再启动新的生成
            if (!queueAliveRef.current || isPausedRef.current) {
                setIsProcessing(false);
                return;
            }

            const task = taskQueue[0];
            setCurrentTask(task);
            let generatedObjectUrl = '';

            try {
                // Find the artist info
                const artist = artistsData?.find(a => a.id === task.artistId)
                    || availableArtists.find(a => a.id === task.artistId)
                    || { id: task.artistId, name: task.artistName, imageUrl: '', benchmarks: [], catalogOnly: true };
                if (!artist) {
                    throw new Error(`Artist ID ${task.artistId} not found`);
                }

                // Actual generation Logic
                const slot = config.slots[task.slot];
                if (!slot) throw new Error(`Slot config missing for index ${task.slot}`);

                const slotPrompt = slot.prompt;
                const prompt = `artist:${artist.name}, ${slotPrompt}`;
                const negative = config.negative;
                // Pass -1 (Random) or configured seed
                const seed = config.seed;

                // Generate
                const result = await generateImage(apiKey, prompt, negative, {
                    width: 832, height: 1216, steps: config.steps, scale: config.scale, sampler: 'k_euler_ancestral', seed: seed,
                    qualityToggle: true, ucPreset: 0
                });
                generatedObjectUrl = result.image;

                // Compress before upload (Save Space!)
                const compressedImg = await compressImage(result.image, 0.8);

                // Construct update payload
                // Fetch FRESH benchmarks from current state to avoid overwrites if multiple tasks ran
                const currentBenchmarks = artist.benchmarks ? [...artist.benchmarks] : (artist.previewUrl ? [artist.previewUrl] : []);

                // Pad array if needed
                while (currentBenchmarks.length <= task.slot) currentBenchmarks.push("");
                currentBenchmarks[task.slot] = compressedImg;

                await api.post('/artists', {
                    id: artist.id,
                    name: artist.name,
                    imageUrl: artist.imageUrl,
                    previewUrl: artist.previewUrl,
                    benchmarks: currentBenchmarks
                });

                // Refresh UI
                await onRefresh();
                addLog(`Generated & Compressed: ${artist.name} (Slot ${task.slot + 1})`, 'success');
                void db.logClientEvent({
                    category: 'generation',
                    action: 'artist_benchmark_generate',
                    resourceType: 'artist',
                    resourceId: artist.id,
                    message: `生成画师基准图：${artist.name} / ${slot.label || `Slot ${task.slot + 1}`}`,
                    metadata: {
                        artistName: artist.name,
                        slot: task.slot,
                        slotLabel: slot.label,
                        seed: result.seed ?? seed ?? 'random',
                        steps: config.steps,
                        scale: config.scale,
                        promptLength: prompt.length,
                        negativeLength: negative.length,
                    },
                }).catch(console.error);

            } catch (err: any) {
                const errMsg = err.message || JSON.stringify(err);
                const is429 = errMsg.includes('429') || errMsg.includes('Concurrent') || errMsg.includes('locked');

                if (is429) {
                    addLog('Rate Limit (429) detected. Cooling down for 60s...', 'error');
                    await new Promise(res => setTimeout(res, 60000));
                }

                const artistName = artistsData?.find(a => a.id === task.artistId)?.name || task.artistName || 'Unknown';
                const logMsg = is429
                    ? `Rate Limit (429) for ${artistName}. Task moved to Retry Queue.`
                    : `Failed: ${artistName} - ${errMsg}`;

                addLog(logMsg, 'error');
                void db.logClientEvent({
                    category: 'generation',
                    action: 'artist_benchmark_generate',
                    status: 'error',
                    resourceType: 'artist',
                    resourceId: task.artistId,
                    message: logMsg,
                    metadata: {
                        artistId: task.artistId,
                        artistName,
                        slot: task.slot,
                        error: errMsg,
                        isRateLimited: is429,
                    },
                }).catch(console.error);

                // Move to Failed Queue instead of discarding
                setFailedTasks(prev => [...prev, task]);

                if (!is429) {
                    notify(`生成失败: ${artistName}`, 'error');
                }
            } finally {
                if (generatedObjectUrl.startsWith('blob:')) URL.revokeObjectURL(generatedObjectUrl);
                // Remove done task and loop
                setTaskQueue(prev => prev.slice(1));
                setCurrentTask(null);
                setIsProcessing(false);
            }
        };

        processNext();
    }, [taskQueue, isProcessing, isPaused, apiKey, config, artistsData, availableArtists, onRefresh, notify]);

    // Add tasks to queue
    const queueGeneration = (artist: Artist, slots: number[], e: React.MouseEvent) => {
        e.stopPropagation();
        if (!apiKey) {
            notify('请先在设置中配置 API Key', 'error');
            setShowConfig(true); // Open config modal
            return;
        }

        const newTasks = slots.map(s => ({
            uniqueId: createUuid(),
            artistId: artist.id,
            artistName: artist.name,
            slot: s
        }));

        setTaskQueue(prev => [...prev, ...newTasks]);
        notify(`已添加 ${newTasks.length} 个任务到队列`);
    };

    const retryFailedTasks = () => {
        if (failedTasks.length === 0) return;
        setTaskQueue(prev => [...prev, ...failedTasks]);
        setFailedTasks([]);
        addLog(`Retrying ${failedTasks.length} failed tasks`, 'info');
        notify(`已重新加入 ${failedTasks.length} 个失败任务`);
    };

    const queueMissingGenerations = () => {
        if (!apiKey) {
            notify('请先在设置中配置 API Key', 'error');
            setShowConfig(true);
            return;
        }

        const newTasks: GenTask[] = [];
        let existsCount = 0;

        // Determine target slots to check
        // If List mode, check ALL slots. If Grid mode, only check activeSlot.
        const targetSlots = layoutMode === 'list'
            ? config.slots.map((_, i) => i)
            : [activeSlot];

        // Scan currently filtered list
        for (const artist of filteredArtists) {
            for (const slotIndex of targetSlots) {
                // Check if image exists for slotIndex
                let hasImage = false;
                if (slotIndex === 0) {
                    // Slot 0: Check benchmark[0] OR legacy previewUrl
                    if (artist.previewUrl) hasImage = true;
                    else if (artist.benchmarks && artist.benchmarks[0]) hasImage = true;
                } else {
                    // Other slots: Check benchmark[slotIndex]
                    if (artist.benchmarks && artist.benchmarks[slotIndex]) hasImage = true;
                }

                if (!hasImage) {
                    // Check if already queued
                    const isQueued = taskQueue.some(t => t.artistId === artist.id && t.slot === slotIndex) ||
                        failedTasks.some(t => t.artistId === artist.id && t.slot === slotIndex) ||
                        (currentTask?.artistId === artist.id && currentTask?.slot === slotIndex);

                    if (!isQueued) {
                        newTasks.push({
                            uniqueId: createUuid(),
                            artistId: artist.id,
                            artistName: artist.name,
                            slot: slotIndex
                        });
                    } else {
                        existsCount++;
                    }
                }
            }
        }

        if (newTasks.length === 0) {
            if (existsCount > 0) notify('缺失项已在队列中', 'error');
            else notify('当前列表无缺失项', 'success');
            return;
        }

        setTaskQueue(prev => [...prev, ...newTasks]);
        notify(`已添加 ${newTasks.length} 个补全任务`);
    };

    // --- Lightbox Navigation Logic ---
    const navigateLightbox = useCallback((direction: 'next' | 'prev') => {
        setLightboxState(current => {
            if (!current) return null;
            let { artistIdx, slotIdx } = current;
            const totalArtists = filteredArtists.length;
            const totalSlots = config.slots.length;

            if (layoutMode === 'grid') {
                // Grid Mode: Iterate Artists, Keep Slot Context
                // If we are in 'original' view, keep slotIdx as -1.
                // If we are in 'benchmark' view, keep slotIdx as current (usually activeSlot, which is handled by setLightboxState logic)
                if (direction === 'next') {
                    artistIdx = (artistIdx + 1) % totalArtists;
                } else {
                    artistIdx = (artistIdx - 1 + totalArtists) % totalArtists;
                }
            } else {
                // List Mode: Iterate Slots then Artists
                if (direction === 'next') {
                    if (slotIdx < totalSlots - 1) {
                        slotIdx++;
                    } else {
                        artistIdx = (artistIdx + 1) % totalArtists;
                        slotIdx = -1; // Reset to Original of next artist
                    }
                } else {
                    if (slotIdx > -1) {
                        slotIdx--;
                    } else {
                        artistIdx = (artistIdx - 1 + totalArtists) % totalArtists;
                        slotIdx = totalSlots - 1; // Go to last slot of prev artist
                    }
                }
            }
            return { artistIdx, slotIdx };
        });
    }, [filteredArtists.length, config.slots.length, layoutMode]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!lightboxState) return;
            if (e.key === 'ArrowRight') navigateLightbox('next');
            if (e.key === 'ArrowLeft') navigateLightbox('prev');
            if (e.key === 'Escape') setLightboxState(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxState, navigateLightbox]);

    // Helper to get current lightbox image details
    const currentLightboxImage = useMemo(() => {
        if (!lightboxState) return null;
        const artist = filteredArtists[lightboxState.artistIdx];
        if (!artist) return null;

        const { slotIdx } = lightboxState;
        if (slotIdx === -1) {
            const src = artist.imageUrl || artist.benchmarks?.[0] || artist.previewUrl;
            return src ? { src, name: artist.name } : null;
        }
        // Fallback logic for slot 0 to use legacy previewUrl if benchmark array is empty
        const src = artist.benchmarks?.[slotIdx] || (slotIdx === 0 ? artist.previewUrl : null);
        const slotName = config.slots[slotIdx]?.label || `Slot ${slotIdx + 1}`;

        return src ? { src, name: `${artist.name} - ${slotName}` } : null;
    }, [lightboxState, filteredArtists, config.slots]);


    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">

            {/* --- Controls Header --- */}
            <WorkspaceToolbar>

                <div className="flex gap-2 md:hidden">
                    <div className="relative min-w-0 flex-1">
                        <ToolbarSearch value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="搜索画师 Tag" />
                        {isCatalogLoading && <span className="absolute right-3 top-3.5 h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
                    </div>
                    <MobileIconButton label="筛选和工具" onClick={() => setShowMobileTools(true)} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><Menu className="h-5 w-5" /></MobileIconButton>
                    <ImageTaggerAction notify={notify} />
                    <MobileIconButton label={gachaArtists ? '再抽一批' : '随机抽卡'} onClick={() => void drawGacha()} disabled={isGachaLoading} className="bg-indigo-600 text-white"><Dice5 className="h-5 w-5" /></MobileIconButton>
                </div>
                <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
                    {/* Primary search */}
                    <div className="relative min-w-0 flex-1">
                        <ToolbarSearch
                            type="text"
                            placeholder="搜索全部画师 Tag（支持中文）..."
                            className="pr-12"
                            containerClassName="md:max-w-none!"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">
                            {isCatalogLoading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" /> : filteredArtists.length.toLocaleString('zh-CN')}
                        </div>
                    </div>

                    <select
                        value={artistSort}
                        onChange={event => setArtistSort(event.target.value as ArtistDictionarySort)}
                        disabled={!!gachaArtists}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none hover:border-indigo-400 focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
                        title={gachaArtists ? '返回目录后可调整排序' : '画师目录排序'}
                    >
                        <option value="popular">热度：高到低</option>
                        <option value="least">热度：低到高</option>
                        <option value="name-asc">名称：A → Z</option>
                        <option value="name-desc">名称：Z → A</option>
                    </select>
                    <div className="relative flex flex-none items-center">
                        <ToolbarButton onClick={() => void drawGacha()} disabled={isGachaLoading || artistCatalogCount <= 0} className="!rounded-r-none !border-r-0 !bg-indigo-600 !text-white hover:!bg-indigo-500">
                            {isGachaLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Dice5 className="h-4 w-4" />}{gachaArtists ? '再抽一批' : '随机抽卡'}
                        </ToolbarButton>
                        <IconButton label="抽卡设置" onClick={() => setShowGachaTools(value => !value)} className="!rounded-l-none" aria-expanded={showGachaTools}><ChevronDown /></IconButton>
                        {showGachaTools && <div role="dialog" aria-label="随机抽卡设置" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                            <div className="grid grid-cols-2 gap-2"><label className="text-xs text-gray-500">抽卡方式<select value={gachaMode} onChange={event => setGachaMode(event.target.value as ArtistGachaMode)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value="mixed">惊喜混合</option><option value="uniform">完全随机</option><option value="popular">热门画师</option></select></label><label className="text-xs text-gray-500">数量<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"><option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option></select></label></div>
                            {gachaArtists && <button type="button" onClick={() => { returnToCatalog(); setShowGachaTools(false); }} className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">返回完整目录</button>}
                        </div>}
                    </div>

                    <div className="relative flex-none">
                        <IconButton label="显示设置" onClick={() => setShowDisplayTools(value => !value)} aria-expanded={showDisplayTools}><SlidersHorizontal /></IconButton>
                        {showDisplayTools && <div role="dialog" aria-label="画师显示设置" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setLayoutMode('grid')} className={`rounded-lg px-3 py-2 text-sm ${layoutMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}><Grid3X3 className="mr-1 inline h-4 w-4" />网格</button><button type="button" onClick={() => setLayoutMode('list')} className={`rounded-lg px-3 py-2 text-sm ${layoutMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}><List className="mr-1 inline h-4 w-4" />展开</button></div>
                            {layoutMode === 'grid' && <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setViewMode('original')} className={`rounded-lg px-3 py-2 text-sm ${viewMode === 'original' ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>原图</button><button type="button" onClick={() => setViewMode('benchmark')} className={`rounded-lg px-3 py-2 text-sm ${viewMode === 'benchmark' ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>实装</button></div>}
                            <label className="mt-3 block text-xs text-gray-500">{layoutMode === 'grid' ? `每行 ${gridCols} 列` : `图片宽度 ${listImgWidth}px`}<input type="range" min={layoutMode === 'grid' ? 3 : 80} max={layoutMode === 'grid' ? 15 : 400} step={layoutMode === 'grid' ? 1 : 10} value={layoutMode === 'grid' ? gridCols : listImgWidth} onChange={event => layoutMode === 'grid' ? (setGridCols(Number(event.target.value)), localStorage.setItem('nai_artist_grid_columns', event.target.value)) : setListImgWidth(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
                            {layoutMode === 'grid' && viewMode === 'benchmark' && <label className="mt-3 block text-xs text-gray-500">实装槽位<select value={activeSlot} onChange={event => setActiveSlot(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">{config.slots.map((slot, index) => <option key={index} value={index}>{index + 1}. {slot.label}</option>)}</select></label>}
                            <button type="button" onClick={() => { setShowDisplayTools(false); setShowConfig(true); }} className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"><Settings2 className="mr-1 inline h-4 w-4" />管理分组与槽位</button>
                        </div>}
                    </div>

                    {(taskQueue.length > 0 || failedTasks.length > 0) && <div className={`flex h-9 flex-none items-center overflow-hidden rounded-lg border text-xs font-bold ${failedTasks.length ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30' : 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-950/30'}`}><button type="button" onClick={() => setShowLogs(true)} className="h-full px-2">等待 {taskQueue.length}{failedTasks.length ? ` · 失败 ${failedTasks.length}` : ''}</button><button type="button" onClick={() => setIsPaused(value => !value)} className={`flex h-full w-8 items-center justify-center border-l border-current/15 ${isPaused ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40' : ''}`} aria-label={isPaused ? '恢复画师预览队列' : '暂停画师预览队列'} title={isPaused ? '恢复队列' : '暂停队列'}>{isPaused ? <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> : <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>}</button></div>}
                    {canManageArtists && <IconButton label="刷新画师列表" onClick={handleRefresh} disabled={isLoading}><RefreshCw className={isLoading ? 'animate-spin' : ''} /></IconButton>}
                    <ImageTaggerAction notify={notify} />
                    <IconButton label={showFavOnly ? '显示全部画师' : '只看收藏'} onClick={() => setShowFavOnly(value => !value)} className={showFavOnly ? '!border-yellow-300 !bg-yellow-50 !text-yellow-600 dark:!bg-yellow-950/30' : ''}><Heart className={showFavOnly ? 'fill-current' : ''} /></IconButton>
                    <div className="relative flex-none">
                        <IconButton label="更多工具" onClick={() => setShowMoreTools(value => !value)} aria-expanded={showMoreTools}><MoreHorizontal /></IconButton>
                        {showMoreTools && <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                            {isAdmin && (layoutMode === 'list' || viewMode === 'benchmark') && apiKey && <button type="button" onClick={() => { queueMissingGenerations(); setShowMoreTools(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">补全缺失预览</button>}
                            <button type="button" onClick={() => { setShowImport(true); setShowMoreTools(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Download className="h-4 w-4" />批量导入</button>
                            <button type="button" onClick={() => { setShowHistory(true); setShowMoreTools(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Clock3 className="h-4 w-4" />历史记录</button>
                            <button type="button" onClick={() => { setShowLogs(true); setShowMoreTools(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><ClipboardList className="h-4 w-4" />任务与日志</button>
                        </div>}
                    </div>
                </div>
            </WorkspaceToolbar>

            {/* ... rest of the component (sidebar, main content, lightbox, logs, modals) remains mostly the same, 
          only ensure variable names match and the file is complete ... */}

            <MobileBottomSheet open={showMobileTools} title="画师 Tag 工具" onClose={() => setShowMobileTools(false)}>
                <div className="space-y-5">
                    <label className="block text-sm font-bold dark:text-white">排序<select value={artistSort} onChange={event => setArtistSort(event.target.value as ArtistDictionarySort)} disabled={Boolean(gachaArtists)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-800"><option value="popular">热度从高到低</option><option value="least">热度从低到高</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option></select></label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm font-bold dark:text-white">抽卡方式<select value={gachaMode} onChange={event => setGachaMode(event.target.value as ArtistGachaMode)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-600 dark:bg-gray-800"><option value="mixed">冷热混合</option><option value="popular">热门画师</option><option value="uniform">完全随机</option></select></label>
                        <label className="text-sm font-bold dark:text-white">抽卡数量<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-600 dark:bg-gray-800"><option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option></select></label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setViewMode(value => value === 'original' ? 'benchmark' : 'original')} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">{viewMode === 'original' ? '原始预览' : '基准图模式'}</button>
                        <button onClick={() => setShowFavOnly(value => !value)} className={`mobile-touch rounded-xl text-sm ${showFavOnly ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}>★ 只看收藏</button>
                        <button onClick={() => { setShowMobileTools(false); setShowConfig(true); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">画师配置</button>
                        <button onClick={() => { setShowMobileTools(false); setShowHistory(true); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">复制历史</button>
                        <button onClick={() => { setShowMobileTools(false); setShowImport(true); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">批量导入</button>
                        <button onClick={() => { setShowMobileTools(false); setShowLogs(true); }} className="mobile-touch rounded-xl bg-gray-100 text-sm dark:bg-gray-800">任务队列</button>
                    </div>
                    {gachaArtists && <button onClick={() => { returnToCatalog(); setShowMobileTools(false); }} className="mobile-touch w-full rounded-xl border border-gray-300 text-sm dark:border-gray-600">返回完整目录</button>}
                    <div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">当前显示 {filteredArtists.length.toLocaleString('zh-CN')} · 手机固定双列</div>
                </div>
            </MobileBottomSheet>

            {/* --- Main Content Area --- */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                    </div>
                )}

                {layoutMode === 'grid' ? (
                    /* --- GRID LAYOUT (Dynamic Columns using gridCols) --- */
                    imageDisplay.layout === 'masonry' ? (
                    <ShortestColumnMasonry
                        items={filteredArtists}
                        columns={gridCols}
                        getItemKey={artist => String(artist.id)}
                        estimateItemHeight={estimateArtistCardHeight}
                        renderItem={renderArtistCard}
                    />
                ) : (
                    <div
                        className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-artist-grid md:pr-6`}
                        style={{ ...mobileGalleryStyle(imageDisplay), ...(isMobileViewport ? {} : { '--mobile-gallery-columns': gridCols }) }}
                    >
                        {filteredArtists.map(renderArtistCard)}
                    </div>
                    )
                ) : (
                    /* --- EXPANDED LIST LAYOUT --- */
                    <div className="flex flex-col gap-4 md:pr-6">
                        {filteredArtists.map((artist, idx) => {
                            const isSelected = !!cart.find(c => c.name === artist.name);
                            const isFav = favorites.has(artist.name);

                            return (
                                <div
                                    key={artist.id}
                                    data-safe-mode-work="true"
                                    className={`bg-white dark:bg-gray-800 rounded-lg border p-4 ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
                                    onClick={() => toggleCart(artist.name)}
                                >
                                    <div className="flex justify-between items-center mb-3">
                                        <div className="flex items-center gap-3">
                                            <h3
                                                data-safe-mode-title="true"
                                                className={`font-bold text-lg md:text-xl cursor-pointer hover:underline ${isSelected ? 'text-indigo-600' : 'text-gray-900 dark:text-white'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleCart(artist.name);
                                                }}
                                            >
                                                {artist.name}
                                            </h3>
                                            {artist.chineseName && <span data-safe-mode-title="true" className="text-sm text-gray-400">{artist.chineseName}</span>}
                                            {typeof artist.postCount === 'number' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-300">作品 {artist.postCount.toLocaleString('zh-CN')}</span>}
                                            <button onClick={(e) => toggleFav(artist.name, e)} className={`${isFav ? 'text-yellow-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
                                                <svg className="w-5 h-5" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.563.044.8.77.38 1.178l-4.244 4.134a.563.563 0 00-.153.476l1.24 5.376c.13.565-.487 1.01-.967.756L12 18.232l-4.894 3.08c-.48.254-1.097-.19-.967-.756l1.24-5.376a.563.563 0 00-.153-.476L2.985 10.575c-.42-.408-.183-1.134.38-1.178l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
                                            </button>
                                            <a href={`https://danbooru.donmai.us/posts?tags=${artist.name}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                        </div>
                                        {isAdmin && apiKey && (
                                            <button
                                                onClick={(e) => queueGeneration(artist, config.slots.map((_, i) => i), e)}
                                                className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded hover:bg-green-100 dark:hover:bg-green-900/50 flex items-center gap-1 border border-green-200 dark:border-green-800"
                                                title="生成所有实装"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                Generate All
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar flex-nowrap items-stretch">
                                        <div
                                            className="flex flex-col gap-1 flex-shrink-0 group relative transition-all"
                                            style={{ width: `${listImgWidth}px` }}
                                        >
                                            <div className="aspect-[2/3] rounded-lg overflow-hidden relative cursor-zoom-in" onClick={() => setLightboxState({ artistIdx: idx, slotIdx: -1 })}>
                                                {artist.imageUrl || artist.benchmarks?.[0] || artist.previewUrl ? (
                                                    <LazyImage src={artist.imageUrl || artist.benchmarks?.[0] || artist.previewUrl || ''} alt="本地预览" />
                                                ) : (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-400 dark:bg-gray-900">
                                                        <span className="text-xs">尚无预览</span>
                                                        {apiKey && (
                                                            <button type="button" onClick={(event) => queueGeneration(artist, [0], event)} className="mt-2 rounded bg-indigo-600 px-2 py-1 text-[10px] text-white">生成</button>
                                                        )}
                                                    </div>
                                                )}
                                                <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                            </div>
                                            <span className="text-[10px] text-center font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">本地预览</span>
                                        </div>

                                        {config.slots.map((slot, i) => {
                                            const img = artist.benchmarks?.[i];
                                            const taskRunning = currentTask?.artistId === artist.id && currentTask?.slot === i;
                                            const taskPending = taskQueue.some(t => t.artistId === artist.id && t.slot === i);
                                            const taskFailed = failedTasks.some(t => t.artistId === artist.id && t.slot === i);
                                            const displayImg = img || (i === 0 ? artist.previewUrl : null);

                                            return (
                                                <div
                                                    key={i}
                                                    className="flex flex-col gap-1 flex-shrink-0 group relative transition-all"
                                                    style={{ width: `${listImgWidth}px` }}
                                                >
                                                    <div className="aspect-[2/3] bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden relative border border-gray-200 dark:border-gray-700">
                                                        {displayImg ? (
                                                            <div className="w-full h-full cursor-zoom-in" onClick={() => setLightboxState({ artistIdx: idx, slotIdx: i })}>
                                                                <LazyImage src={displayImg} alt={slot.label} />
                                                            </div>
                                                        ) : (
                                                            <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                                                <span className="text-xl">?</span>
                                                            </div>
                                                        )}
                                                        {(taskPending || taskRunning || taskFailed) && (
                                                            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-10 pointer-events-none">
                                                                {taskRunning ? (
                                                                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>
                                                                ) : taskFailed ? (
                                                                    <span className="text-[10px] bg-red-500 text-white px-1 rounded">Failed</span>
                                                                ) : (
                                                                    <span className="text-[10px] bg-indigo-500 text-white px-1 rounded">Queue</span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {isAdmin && apiKey && !taskRunning && !taskPending && (
                                                            <div className="absolute bottom-1 right-1 transition-opacity opacity-0 group-hover:opacity-100 z-10">
                                                                <button
                                                                    onClick={(e) => queueGeneration(artist, [i], e)}
                                                                    className="p-1.5 bg-black/60 hover:bg-black/80 backdrop-blur rounded-full text-white transition-colors shadow-sm"
                                                                    title={`生成 ${slot.label}`}
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-center text-gray-500 dark:text-gray-400 truncate px-1 font-medium" title={slot.label}>{slot.label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!searchTerm.trim() && !gachaArtists && (
                    <div ref={catalogSentinelRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-gray-400">
                        {isLoadingMoreCatalog ? (
                            <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />正在加载更多画师…</span>
                        ) : hasMoreCatalog ? (
                            <button type="button" onClick={() => void loadNextCatalogPage()} className="rounded-full border border-gray-300 px-4 py-2 hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">继续向下滚动加载更多</button>
                        ) : artistCatalogCount > 0 ? (
                            <span>已加载完整画师目录</span>
                        ) : null}
                    </div>
                )}
            </div>

            <ArtistLibraryCart
                cart={cart}
                setCart={setCart}
                updateWeight={updateWeight}
                toggleCart={toggleCart}
                copyCart={copyCart}
                formatTag={formatTag}
            />

            {currentLightboxImage && (
                <div className="fixed inset-0 z-50 bg-white/95 dark:bg-black/95 flex items-center justify-center backdrop-blur-sm select-none" onClick={() => setLightboxState(null)}>
                    <div
                        className="absolute left-0 top-0 bottom-0 w-[20%] z-20 flex items-center justify-start pl-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                        onClick={(e) => { e.stopPropagation(); navigateLightbox('prev'); }}
                    >
                        <div className="p-2 rounded-full bg-white/10 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-8 h-8 text-gray-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </div>
                    </div>

                    <div className="relative max-w-full max-h-full p-4 flex flex-col items-center pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                        <OriginalImage
                            src={currentLightboxImage.src}
                            alt={currentLightboxImage.name}
                            className="max-w-full max-h-[85vh] rounded shadow-2xl object-contain cursor-pointer"
                            onClick={() => setLightboxState(null)}
                        />
                        <div className="mt-4 text-center">
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white drop-shadow-md">{currentLightboxImage.name}</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">点击图片或背景关闭 | 左右点击翻页 | 键盘 ← → 切换</p>
                        </div>
                    </div>

                    <div
                        className="absolute right-0 top-0 bottom-0 w-[20%] z-20 flex items-center justify-end pr-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                        onClick={(e) => { e.stopPropagation(); navigateLightbox('next'); }}
                    >
                        <div className="p-2 rounded-full bg-white/10 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-8 h-8 text-gray-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </div>

                    <button
                        className="absolute top-4 right-4 z-30 p-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white bg-white/10 rounded-full backdrop-blur"
                        onClick={() => setLightboxState(null)}
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}

            {/* History, Logs, Import Modal rendering kept ... */}
            <div className={`fixed top-0 right-0 w-80 h-full bg-white dark:bg-gray-900 shadow-2xl z-40 transform transition-transform duration-300 border-l border-gray-200 dark:border-gray-800 flex flex-col ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <h3 className="flex items-center gap-2 font-bold text-gray-800 dark:text-white"><ClipboardList className="h-4 w-4" />复制历史</h3>
                    <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-white">×</button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {history.map((h, i) => (
                        <div key={i} onClick={() => { navigator.clipboard.writeText(h.text); notify('已复制') }} className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-500 cursor-pointer transition-colors">
                            <div className="text-xs text-gray-800 dark:text-gray-200 break-all line-clamp-3 font-mono">{h.text}</div>
                            <div className="text-[10px] text-gray-400 mt-2 text-right">{h.time}</div>
                        </div>
                    ))}
                    {history.length === 0 && <div className="text-center text-gray-400 mt-10">暂无历史</div>}
                </div>
                <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                    <button onClick={() => { setHistory([]); localStorage.setItem('nai_copy_history', '[]') }} className="w-full py-2 text-sm text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400">清空历史</button>
                </div>
            </div>
            {showHistory && <div className="fixed inset-0 z-30 bg-black/20 dark:bg-black/50 backdrop-blur-[1px]" onClick={() => setShowHistory(false)} />}

            {showLogs && (
                <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col max-h-[80vh]">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">任务日志</h3>
                            <button onClick={() => setShowLogs(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white">✕</button>
                        </div>
                        {failedTasks.length > 0 && (
                            <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-lg flex justify-between items-center">
                                <span className="text-sm text-red-700 dark:text-red-300 font-bold">{failedTasks.length} 个任务失败</span>
                                <button
                                    onClick={retryFailedTasks}
                                    className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded font-bold shadow-sm"
                                >
                                    重试所有失败任务
                                </button>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto space-y-2 bg-gray-50 dark:bg-gray-950 p-2 rounded border border-gray-200 dark:border-gray-800">
                            {logs.length === 0 && <div className="text-center text-gray-400 py-4 text-xs">暂无日志</div>}
                            {logs.map((log, i) => (
                                <div key={i} className={`p-2 rounded text-xs font-mono border ${log.type === 'error' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400' :
                                    log.type === 'success' ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900/50 text-green-600 dark:text-green-400' :
                                        'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                                    }`}>
                                    <span className="opacity-50 mr-2">[{log.time}]</span>
                                    {log.message}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showImport && (
                <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-800 p-6">
                        <h3 className="mb-2 flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><Download className="h-5 w-5" />批量导入画师</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">粘贴你的风格串，支持 artist: 前缀和 {'{}'} [] 权重符号</p>
                        <textarea
                            className="w-full h-32 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl p-3 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            placeholder="例如：artist:wlop, {artist:nixeu}, [[shaluo]]"
                            value={importText}
                            onChange={e => setImportText(e.target.value)}
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setShowImport(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">取消</button>
                            <button onClick={handleImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg transition-colors">导入</button>
                        </div>
                    </div>
                </div>
            )}

            <ArtistLibraryConfig
                show={showConfig}
                onClose={() => setShowConfig(false)}
                onSave={saveConfig}
                initialConfig={config}
                apiKey={apiKey}
                onApiKeyChange={handleApiKeyChange}
                rememberApiKey={rememberApiKey}
                onRememberApiKeyChange={handleRememberKeyChange}
                notify={notify}
            />
        </div>
    );
};
