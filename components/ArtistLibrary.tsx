
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
import { Bot, ClipboardList, Clock3, Dice5, Download, Grid3X3, Heart, List, LoaderCircle, Menu, RefreshCw, Settings2 } from 'lucide-react';
import { IconButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { DanbooruCover } from './DanbooruCover';
import type { DanbooruCoverCandidate } from '../services/danbooruService';
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
    const [currentTask, setCurrentTask] = useState<GenTask | null>(null);

    // Logs System
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [showLogs, setShowLogs] = useState(false);

    // Load data & Config
    useEffect(() => {
        const savedFav = localStorage.getItem('nai_fav_artists');
        if (savedFav) setFavorites(new Set(JSON.parse(savedFav)));

        const savedPrefix = localStorage.getItem('nai_use_prefix');
        if (savedPrefix !== null) setUsePrefix(savedPrefix === 'true');

        const savedHistory = localStorage.getItem('nai_copy_history');
        if (savedHistory) setHistory(JSON.parse(savedHistory));

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
            .catch(error => console.warn('Artist tag catalog is unavailable:', error))
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
            // The server downloads the chosen public image into project storage,
            // so this remains the cover even if Danbooru's CDN later changes it.
            await api.post('/artists', {
                id: artist.id,
                name: artist.name,
                imageUrl: candidate.sampleUrl,
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

    // (The rest of the file remains unchanged, omitted for brevity as per instructions to only include changes if possible, but minimal diff implies keeping context if necessary. I'll include the rest to be safe and runnable)
    // ... (Code for queueGeneration, retryFailedTasks, queueMissingGenerations, lightbox logic, etc.)

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
            <WorkspaceToolbar className="flex-col !items-stretch">

                <div className="flex gap-2 md:hidden">
                    <div className="relative min-w-0 flex-1">
                        <ToolbarSearch value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="搜索画师 Tag" />
                        {isCatalogLoading && <span className="absolute right-3 top-3.5 h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
                    </div>
                    <MobileIconButton label="筛选和工具" onClick={() => setShowMobileTools(true)} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><Menu className="h-5 w-5" /></MobileIconButton>
                    <ImageTaggerAction notify={notify} />
                    <MobileIconButton label={gachaArtists ? '再抽一批' : '随机抽卡'} onClick={() => void drawGacha()} disabled={isGachaLoading} className="bg-indigo-600 text-white"><Dice5 className="h-5 w-5" /></MobileIconButton>
                </div>
                {(isProcessing || taskQueue.length > 0) && <button onClick={() => setShowLogs(true)} className="mobile-touch flex items-center justify-between rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 md:hidden"><span>画师预览任务</span><span>等待 {taskQueue.length}{failedTasks.length ? ` · 失败 ${failedTasks.length}` : ''}</span></button>}

                <div className="workspace-toolbar hidden items-center gap-2 md:flex">
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

                    {/* Layout Toggle */}
                    <div className="flex flex-none items-center gap-1">
                        <button
                            onClick={() => setLayoutMode('grid')}
                            className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${layoutMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
                            title="网格视图"
                        >
                            <Grid3X3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => setLayoutMode('list')}
                            className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${layoutMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
                            title="展开视图 (实装一览)"
                        >
                            <List className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {/* Slider for Grid/List */}
                    <div className="flex items-center gap-2 flex-none md:w-36 px-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-800">
                        <span className="text-xs text-gray-400 font-mono">
                            {layoutMode === 'grid' ? `列:${gridCols}` : `宽:${listImgWidth}`}
                        </span>
                        {layoutMode === 'grid' ? (
                            <input
                                type="range"
                                min="3" max="15" step="1"
                                value={gridCols}
                                onChange={(e) => { setGridCols(parseInt(e.target.value)); localStorage.setItem('nai_artist_grid_columns', e.target.value); }}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-indigo-500"
                                title="调整每行显示的列数 (3-15)"
                            />
                        ) : (
                            <input
                                type="range"
                                min="80" max="400" step="10"
                                value={listImgWidth}
                                onChange={(e) => setListImgWidth(parseInt(e.target.value))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-indigo-500"
                                title="调整实装图宽度 (80-400px)"
                            />
                        )}
                    </div>

                    {/* Refresh locally persisted artists */}
                    {canManageArtists && (
                        <IconButton label="刷新画师列表" onClick={handleRefresh} disabled={isLoading}>
                            <RefreshCw className={isLoading ? 'animate-spin' : ''} />
                        </IconButton>
                    )}
                    <ImageTaggerAction notify={notify} />
                </div>

                <div className="hidden min-w-0 items-center gap-2 md:flex">
                    <div className="hidden min-w-0 truncate text-xs text-gray-400 dark:text-gray-500 2xl:block" title="画师名称来自每日更新的中英对照 Tag 词库；预览图保存在本地">
                        {searchTerm.trim() ? '搜索结果' : gachaArtists ? '抽卡结果' : '当前显示'} {filteredArtists.length.toLocaleString('zh-CN')}
                        {' · '}完整目录 {artistCatalogCount.toLocaleString('zh-CN')}
                        {' · '}本地预览 {artistsData?.length || 0}
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
                    {/* View Toggle (Only show in Grid mode, or keep for general settings) */}
                    {layoutMode === 'grid' && (
                        <div className="flex flex-none items-center gap-1">
                            <button
                                onClick={() => setViewMode('original')}
                                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'original' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
                            >
                                原图
                            </button>
                            <button
                                onClick={() => setViewMode('benchmark')}
                                className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'benchmark' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
                            >
                                实装
                            </button>
                        </div>
                    )}

                    {/* Config & Slots (Show Config button always, Slots only in Grid-Benchmark mode) */}
                    <div className="flex items-center gap-2 overflow-x-auto max-w-full">
                        <button
                            onClick={() => setShowConfig(true)}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex-shrink-0"
                            title="配置分组"
                        >
                            <Settings2 className="h-4 w-4" />
                        </button>

                        {layoutMode === 'grid' && viewMode === 'benchmark' && (
                            <div className="flex max-w-[220px] items-center gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-900">
                                {config.slots.map((slot, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setActiveSlot(index)}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 ${activeSlot === index ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
                                        title={slot.prompt}
                                    >
                                        {index + 1}. {slot.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Gacha + Actions (right cluster) */}
                    <div className="ml-auto flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900">
                            <select
                                value={gachaMode}
                                onChange={event => setGachaMode(event.target.value as ArtistGachaMode)}
                                className="rounded-md bg-transparent px-1.5 py-1 text-xs text-gray-600 outline-none dark:text-gray-300"
                                aria-label="抽卡模式"
                                title="选择画师抽卡模式"
                            >
                                <option value="mixed">惊喜混合</option>
                                <option value="uniform">完全随机</option>
                                <option value="popular">热门画师</option>
                            </select>
                            <select
                                value={gachaCount}
                                onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)}
                                className="rounded-md bg-transparent px-1 py-1 text-xs text-gray-600 outline-none dark:text-gray-300"
                                aria-label="抽卡数量"
                                title="选择每批抽取数量"
                            >
                                <option value={6}>6 位</option>
                                <option value={12}>12 位</option>
                                <option value={24}>24 位</option>
                            </select>
                            <button
                                type="button"
                                onClick={() => void drawGacha()}
                                disabled={isGachaLoading || artistCatalogCount <= 0}
                                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
                                title="从完整画师目录随机抽取，最近五批尽量不重复"
                            >
                                {isGachaLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Dice5 className="h-3.5 w-3.5" />}
                                {gachaArtists ? '再抽一批' : '随机抽卡'}
                            </button>
                            {gachaArtists && (
                                <button
                                    type="button"
                                    onClick={returnToCatalog}
                                    className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800"
                                    title="返回抽卡前的目录位置"
                                >
                                    返回目录
                                </button>
                            )}
                        </div>

                    {/* Settings Group */}
                    <div className="flex gap-2 items-center">
                        {/* Auto-Fill Button - Only show for admins */}
                        {isAdmin && (layoutMode === 'list' || viewMode === 'benchmark') && apiKey && (
                            <button
                                onClick={queueMissingGenerations}
                                title={layoutMode === 'list'
                                    ? "一键补全当前列表中所有画师的所有缺失槽位"
                                    : `一键补全当前列表中缺失 "Slot ${activeSlot + 1}: ${config.slots[activeSlot]?.label}" 的画师`
                                }
                            className="flex h-8 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                补全
                            </button>
                        )}

                        {/* Queue / Log Button */}
                        {(taskQueue.length > 0 || failedTasks.length > 0 || logs.length > 0) && (
                            <div className={`flex items-center gap-1 px-2 py-1 rounded border cursor-pointer select-none transition-colors ${failedTasks.length > 0
                                ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
                                : 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-100 dark:border-indigo-800'
                                }`}
                                onClick={() => setShowLogs(true)}
                                title="点击查看生成日志"
                            >
                                <span className={`text-xs font-mono ${failedTasks.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                    Wait:{taskQueue.length} {failedTasks.length > 0 && `| Fail:${failedTasks.length}`}
                                </span>
                                {/* Pause/Resume Button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsPaused(!isPaused); }}
                                    className={`w-5 h-5 flex items-center justify-center rounded hover:bg-white dark:hover:bg-black/20 ${isPaused ? 'text-yellow-600 animate-pulse' : 'text-indigo-600'}`}
                                    title={isPaused ? "恢复队列" : "暂停队列"}
                                >
                                    {isPaused ? (
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                    ) : (
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                                    )}
                                </button>
                                {isProcessing && !isPaused && <div className="w-2 h-2 rounded-full bg-green-500 animate-ping"></div>}
                            </div>
                        )}

                        <button
                            onClick={() => setShowImport(true)}
                            title="批量导入"
                            className="flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                            <Download className="h-4 w-4" />
                        </button>

                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            title="历史记录"
                            className="flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                            <Clock3 className="h-4 w-4" />
                        </button>

                        <button
                            onClick={() => setShowFavOnly(!showFavOnly)}
                            title="收藏"
                            className={`h-8 px-3 rounded-full border flex items-center transition-colors text-sm ${showFavOnly
                                ? 'bg-yellow-50 border-yellow-300 text-yellow-600 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-500'
                                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-400'
                                }`}
                        >
                            <Heart className={`h-4 w-4 ${showFavOnly ? 'fill-current' : ''}`} />
                        </button>
                    </div>
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
                    <div
                        className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-artist-grid md:pr-6`}
                        style={{ ...mobileGalleryStyle(imageDisplay), ...(isMobileViewport ? {} : { '--mobile-gallery-columns': gridCols }) }}
                    >
                        {filteredArtists.map((artist, idx) => {
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
                                    className={`mobile-gallery-item group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden border transition-colors cursor-pointer ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}
                                    onClick={() => toggleCart(artist.name)}
                                >
                                    <div className="mobile-gallery-frame md:aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': '2 / 3' } as React.CSSProperties}>
                                        {viewMode === 'original' ? (
                                            <DanbooruCover
                                                tag={artist.name}
                                                kind="artist"
                                                alt={artist.chineseName || artist.name}
                                                fixedSrc={displayImg}
                                                onCandidateChange={candidate => rememberCoverCandidate(artist.id, candidate)}
                                            />
                                        ) : displayImg && !isBenchmarkMissing ? (
                                            <LazyImage src={displayImg} alt={artist.name} />
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
                                        >
                                            <a href={`https://danbooru.donmai.us/posts?tags=${artist.name}`} target="_blank" rel="noreferrer" className="hidden md:block p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-blue-500 dark:text-blue-300 hover:text-blue-600 pointer-events-auto">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const slot = viewMode === 'benchmark' ? activeSlot : -1;
                                                    setLightboxState({ artistIdx: idx, slotIdx: slot });
                                                }}
                                                className="p-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur border border-gray-200 dark:border-white/20 shadow-sm text-gray-700 dark:text-white pointer-events-auto"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                                            </button>

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
                                        <div className={`text-xs md:text-sm font-bold truncate ${isSelected ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-300'}`}>{artist.name}</div>
                                        {artist.chineseName && <div className="mt-0.5 truncate text-[10px] text-gray-400" title={artist.chineseName}>{artist.chineseName}</div>}
                                        {typeof artist.postCount === 'number' && <div className="mt-0.5 text-[10px] font-mono text-gray-500" title="Danbooru 关联作品数">作品 {artist.postCount.toLocaleString('zh-CN')}</div>}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    /* --- EXPANDED LIST LAYOUT --- */
                    <div className="flex flex-col gap-4 md:pr-6">
                        {filteredArtists.map((artist, idx) => {
                            const isSelected = !!cart.find(c => c.name === artist.name);
                            const isFav = favorites.has(artist.name);

                            return (
                                <div
                                    key={artist.id}
                                    className={`bg-white dark:bg-gray-800 rounded-lg border p-4 ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
                                    onClick={() => toggleCart(artist.name)}
                                >
                                    <div className="flex justify-between items-center mb-3">
                                        <div className="flex items-center gap-3">
                                            <h3
                                                className={`font-bold text-lg md:text-xl cursor-pointer hover:underline ${isSelected ? 'text-indigo-600' : 'text-gray-900 dark:text-white'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleCart(artist.name);
                                                }}
                                            >
                                                {artist.name}
                                            </h3>
                                            {artist.chineseName && <span className="text-sm text-gray-400">{artist.chineseName}</span>}
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
            <div className={`fixed top-0 right-0 w-80 h-full bg-white dark:bg-gray-800 shadow-2xl z-40 transform transition-transform duration-300 border-l border-gray-200 dark:border-gray-700 flex flex-col ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <h3 className="flex items-center gap-2 font-bold text-gray-800 dark:text-white"><ClipboardList className="h-4 w-4" />复制历史</h3>
                    <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-white">×</button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {history.map((h, i) => (
                        <div key={i} onClick={() => { navigator.clipboard.writeText(h.text); notify('已复制') }} className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-500 cursor-pointer transition-colors">
                            <div className="text-xs text-gray-800 dark:text-gray-200 break-all line-clamp-3 font-mono">{h.text}</div>
                            <div className="text-[10px] text-gray-400 mt-2 text-right">{h.time}</div>
                        </div>
                    ))}
                    {history.length === 0 && <div className="text-center text-gray-400 mt-10">暂无历史</div>}
                </div>
                <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <button onClick={() => { setHistory([]); localStorage.setItem('nai_copy_history', '[]') }} className="w-full py-2 text-sm text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400">清空历史</button>
                </div>
            </div>
            {showHistory && <div className="fixed inset-0 z-30 bg-black/20 dark:bg-black/50 backdrop-blur-[1px]" onClick={() => setShowHistory(false)} />}

            {showLogs && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col max-h-[80vh]">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
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
                                        'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="mb-2 flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white"><Download className="h-5 w-5" />批量导入画师</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">粘贴你的画师串，支持 artist: 前缀和 {'{}'} [] 权重符号</p>
                        <textarea
                            className="w-full h-32 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            placeholder="例如：artist:wlop, {artist:nixeu}, [[shaluo]]"
                            value={importText}
                            onChange={e => setImportText(e.target.value)}
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setShowImport(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">取消</button>
                            <button onClick={handleImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-colors">导入</button>
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
