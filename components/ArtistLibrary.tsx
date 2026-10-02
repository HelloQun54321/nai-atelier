import { appearanceScrollBehavior } from '../services/appearancePreferences';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Artist } from '../types';
import { compareLibraryTags } from '../services/tagLibrary';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { TagSelectionBar } from './TagSelectionBar';
import { ArtistDictionaryEntry, ArtistDictionarySort, getArtistDictionaryEntriesAt, getArtistDictionaryPage, searchArtistDictionary } from '../services/tagDictionary';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry } from './ShortestColumnMasonry';
import { ChevronDown, Dice5, LoaderCircle } from 'lucide-react';
import { ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { DanbooruCover } from './DanbooruCover';
import { danbooruService } from '../services/danbooruService';
import { TagCoverActions } from './TagCoverActions';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';

interface CartItem {
    name: string;
}

interface ArtistLibraryProps {
    // 既有封面只读展示，不在目录中生成或维护基准图。
    artistsData: Artist[] | null;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
}

type ArtistGachaMode = 'mixed' | 'uniform' | 'popular';

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ artistsData, notify, onNavigateToPlayground }) => {
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
                            const displayImg = artist.imageUrl || artist.previewUrl || artist.benchmarks?.[0] || '';

                            return (
                                <div
                                    key={artist.id}
                                    data-safe-mode-work="true"
                                    className={`mobile-gallery-item group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden border transition-colors cursor-pointer ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}
                                    onClick={() => toggleCart(artist.name)}
                                >
                                    <div className="mobile-gallery-frame md:aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': artistRatios[artist.id] ? `${Math.round(artistRatios[artist.id] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                                        <DanbooruCover
                                            tag={artist.name}
                                            kind="artist"
                                            alt={artist.chineseName || artist.name}
                                            fixedSrc={displayImg}
                                            onImageLoad={(width, height) => { const ratio = width / Math.max(1, height); if (Number.isFinite(ratio) && ratio > 0) setArtistRatios(previous => previous[artist.id] === ratio ? previous : { ...previous, [artist.id]: ratio }); }}
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                                        <TagCoverActions favorite={isFav} onToggleFavorite={() => toggleFav(artist)} />

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
                                        {artist.chineseName && <div data-safe-mode-title="true" className="mt-0.5 truncate text-micro text-gray-400" title={artist.chineseName}>{artist.chineseName}</div>}
                                        {typeof artist.postCount === 'number' && <div className="mt-0.5 text-micro font-mono text-gray-500" title="Danbooru 关联作品数">作品 {artist.postCount.toLocaleString('zh-CN')}</div>}
                                    </div>
                                </div>
                            )
    };

    const [searchTerm, setSearchTerm] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    // 收藏画师的展示快照（中文名/作品数）：词库画师是无限分页加载的，"只看收藏"若只在
    // 已加载子集里过滤，未加载页的收藏将永远不可见。收藏时落一份快照，筛选时按收藏清单渲染。
    const [favoriteArtistDetails, setFavoriteArtistDetails] = useState<Record<string, { name?: string; chinese?: string; postCount?: number }>>(() => {
        try { return JSON.parse(localStorage.getItem('nai_artist_favorite_details') || '{}'); }
        catch { return {}; }
    });
    const [showFavOnly, setShowFavOnly] = useState(false);
    const [usePrefix, setUsePrefix] = useState(true);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const onScrollRestore = useKeepAliveScrollRestore(scrollContainerRef, 'library');
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

    // 抽卡偏好
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
    const gachaGenerationRef = useRef(0);
    const leaveGacha = useCallback(() => {
        gachaGenerationRef.current++;
        setGachaArtists(null);
        setIsGachaLoading(false);
    }, []);
    useEffect(() => () => { gachaGenerationRef.current++; }, []);

    // View Settings
    const gridCols = 6;
    const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

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

    // 只读取浏览偏好；本页不读取 Key 或生成配置。
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
            // 清空搜索词时必须复位 loading：在途请求的 finally 会被上面递增的代际守卫拦下，不复位就永久转圈
            setIsCatalogLoading(false);
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

    const toggleFav = (artist: Artist, e?: React.MouseEvent) => {
        e?.stopPropagation();
        const wasFavorite = favorites.has(artist.name);
        const newFav = new Set(favorites);
        if (wasFavorite) newFav.delete(artist.name);
        else newFav.add(artist.name);
        setFavorites(newFav);
        localStorage.setItem('nai_fav_artists', JSON.stringify(Array.from(newFav)));
        setFavoriteArtistDetails(previous => {
            if (wasFavorite) {
                if (!(artist.name in previous)) return previous;
                const next = { ...previous };
                delete next[artist.name];
                try { localStorage.setItem('nai_artist_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
                return next;
            }
            const next = { ...previous, [artist.name]: { name: artist.name, chinese: artist.chineseName, postCount: artist.postCount } };
            try { localStorage.setItem('nai_artist_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
            return next;
        });
    };

    const toggleCart = (name: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (cart.find(i => i.name === name)) {
            setCart(cart.filter(i => i.name !== name));
        } else {
            setCart([...cart, { name }]);
        }
    };

    const formatTag = (item: CartItem) => (usePrefix ? 'artist:' : '') + item.name;

    const copyCart = async () => {
        try {
            await navigator.clipboard.writeText(cart.map(formatTag).join(', '));
            notify('画师 Tag 已复制');
        } catch {
            notify('复制失败，请检查浏览器剪贴板权限', 'error');
        }
    };

    const importCartToPlayground = () => {
        if (cart.length === 0) return;
        const str = cart.map(formatTag).join(', ');
        sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
            prompt: str,
            negativePrompt: '',
            mode: 'append-prompt',
        }));
        setCart([]);
        notify(`已把 ${cart.length} 位画师 Tag 送往实验室`);
        onNavigateToPlayground?.();
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

    // "只看收藏"（无搜索词、非抽卡）按收藏清单渲染：词库画师是无限分页加载的，
    // 按"已加载子集"过滤会让未加载页的收藏永远显示不出来。优先取本地已保存画师，
    // 其次取已加载词库条目，最后取收藏时落下的展示快照。
    const favoriteArtists = useMemo(() => {
        if (!showFavOnly || searchTerm.trim() || gachaArtists) return null;
        const persistedByName = new Map((artistsData || []).map(artist => [artist.name.toLowerCase(), artist]));
        const loadedByName = new Map(loadedCatalogArtists.map(entry => [entry.name, entry]));
        const result: Artist[] = [];
        for (const name of favorites) {
            const key = name.toLowerCase();
            const persisted = persistedByName.get(key);
            const entry = loadedByName.get(name);
            const snapshot = favoriteArtistDetails[name];
            result.push({
                id: persisted?.id || catalogArtistId(name),
                name,
                imageUrl: persisted?.imageUrl || '',
                previewUrl: persisted?.previewUrl,
                benchmarks: persisted?.benchmarks || [],
                chineseName: entry?.chinese ?? snapshot?.chinese ?? persisted?.chineseName,
                postCount: entry?.postCount ?? snapshot?.postCount ?? persisted?.postCount,
                catalogOnly: !persisted,
            });
        }
        return result.sort((left, right) => compareLibraryTags(left, right, artistSort));
    }, [artistSort, artistsData, favoriteArtistDetails, gachaArtists, loadedCatalogArtists, searchTerm, showFavOnly, favorites]);

    // 筛选结果保持稳定，收藏不受分页加载范围限制。
    const filteredArtists = useMemo(() => {
        if (favoriteArtists) return favoriteArtists;
        return availableArtists.filter(a => {
            if (showFavOnly && !favorites.has(a.name)) return false;
            if (searchTerm) {
                const query = searchTerm.toLowerCase();
                return a.name.toLowerCase().includes(query) || a.chineseName?.toLowerCase().includes(query);
            }
            return true;
        });
    }, [availableArtists, favoriteArtists, showFavOnly, favorites, searchTerm]);

    // 旧收藏没有展示快照：进入"只看收藏"时按名字向本地词库逐个检索补齐（串行 + 间隔，避免压垮词库读取）。
    // 词库中已查不到的记一个仅含名字的快照，避免每次进入都重复检索。
    useEffect(() => {
        if (!showFavOnly || searchTerm.trim() || gachaArtists) return;
        const missing = Array.from(favorites).filter(name => !favoriteArtistDetails[name]);
        if (!missing.length) return;
        let cancelled = false;
        void (async () => {
            for (const name of missing) {
                if (cancelled) return;
                try {
                    const results = await searchArtistDictionary(name, 5, artistSort);
                    if (cancelled) return;
                    const entry = results.find(item => item.name === name)
                        ?? results.find(item => item.name.toLowerCase() === name.toLowerCase());
                    setFavoriteArtistDetails(previous => {
                        if (previous[name] || cancelled) return previous;
                        const next = {
                            ...previous,
                            [name]: entry
                                ? { name: entry.name, chinese: entry.chinese, postCount: entry.postCount }
                                : { name },
                        };
                        try { localStorage.setItem('nai_artist_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
                        return next;
                    });
                } catch {
                    return; // 词库检索失败：中止本轮，下次进入筛选时继续补
                }
                await new Promise(resolve => window.setTimeout(resolve, 120));
            }
        })();
        return () => { cancelled = true; };
    }, [showFavOnly, searchTerm, gachaArtists, favorites, favoriteArtistDetails, artistSort]);

    // 目录预取：前 40 个画师提前查候选并固定缩略图缓存，不改写私人封面。
    // getCoverSet 合并相同请求并限流，正常结果缓存 14 天，空候选仅短期缓存。
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

    // 抽卡只读取本地 Tag 目录，不触发生图。

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

        const generation = ++gachaGenerationRef.current;
        setIsGachaLoading(true);
        setSearchTerm('');
        setShowFavOnly(false);
        localStorage.setItem('nai_artist_gacha_mode', gachaMode);
        localStorage.setItem('nai_artist_gacha_count', String(gachaCount));

        try {
            const recentIndices = new Set(recentGachaIndicesRef.current.flat());
            const selectedIndices = new Set<number>();
            const targetCount = Math.min(gachaCount, artistCatalogCount);
            let attempts = 0;
            while (selectedIndices.size < targetCount && attempts < 10_000) {
                attempts += 1;
                const index = drawGachaIndex(gachaMode, artistCatalogCount);
                if (!recentIndices.has(index)) selectedIndices.add(index);
            }
            for (let index = 0; selectedIndices.size < targetCount && index < artistCatalogCount; index++) {
                selectedIndices.add(index);
            }

            const indices = [...selectedIndices];
            const artists = await getArtistDictionaryEntriesAt(indices);
            if (generation !== gachaGenerationRef.current) return;
            setGachaArtists(artists);
            recentGachaIndicesRef.current = [...recentGachaIndicesRef.current, indices].slice(-5);
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: appearanceScrollBehavior() });
        } catch (error) {
            if (generation !== gachaGenerationRef.current) return;
            console.warn('Artist gacha failed:', error);
            notify('抽卡失败，请稍后重试', 'error');
        } finally {
            if (generation === gachaGenerationRef.current) setIsGachaLoading(false);
        }
    };

    const returnToCatalog = () => {
        setSearchTerm('');
        leaveGacha();
        requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: catalogScrollTopRef.current }));
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">

            {/* --- Controls Header --- */}
            <WorkspaceToolbar>
                <div className="relative min-w-0 flex-1">
                    <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); leaveGacha(); }} placeholder="搜索画师名称或 Tag" containerClassName="md:max-w-none!" className="pr-9" />
                    {isCatalogLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
                </div>
                <ToolbarPopover title="筛选画师" count={Number(artistSort !== 'popular') + Number(showFavOnly)}>
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold dark:text-white">排序<select aria-label="画师排序" value={artistSort} onChange={event => { setArtistSort(event.target.value as ArtistDictionarySort); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}>
                            <option value="popular">{searchTerm.trim() ? '相关性优先 · 热度高' : '热度从高到低'}</option><option value="least">{searchTerm.trim() ? '相关性优先 · 热度低' : '热度从低到高'}</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option>
                        </select></label>
                        <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={showFavOnly} onChange={event => { setShowFavOnly(event.target.checked); leaveGacha(); }} />只看收藏</label>
                        <button type="button" onClick={() => { setArtistSort('popular'); setShowFavOnly(false); leaveGacha(); }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">重置筛选</button>
                    </div>
                </ToolbarPopover>
                <div className="flex flex-none items-center border-l border-gray-200 pl-2 dark:border-gray-700">
                    <ToolbarButton aria-label={gachaArtists ? '再抽一批' : '随机抽卡'} onClick={() => void drawGacha()} disabled={isGachaLoading || artistCatalogCount <= 0} className="mobile-touch !rounded-r-none !border-r-0" tone="neutral">
                        {isGachaLoading ? <LoaderCircle className="animate-spin" /> : <Dice5 />}<span className="hidden sm:inline">{gachaArtists ? '再抽一批' : '随机抽卡'}</span>
                    </ToolbarButton>
                    <ToolbarPopover label="抽卡设置" title="画师抽卡设置" icon={<ChevronDown />} className="[&_button[aria-haspopup]]:rounded-l-none [&_button[aria-haspopup]>span]:hidden" width={320}>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-sm font-semibold dark:text-white">抽卡方式<select value={gachaMode} onChange={event => setGachaMode(event.target.value as ArtistGachaMode)} className={TOOLBAR_FIELD_CLASS}><option value="mixed">惊喜混合</option><option value="uniform">完全随机</option><option value="popular">热门画师</option></select></label>
                            <label className="text-sm font-semibold dark:text-white">数量<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className={TOOLBAR_FIELD_CLASS}><option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option></select></label>
                        </div>
                    </ToolbarPopover>
                </div>
            </WorkspaceToolbar>

            {gachaArtists && (
                <GalleryActiveStateBanner
                    count={filteredArtists.length}
                    entityName="画师"
                    showDrawAgain={false}
                    onDrawAgain={() => void drawGacha()}
                    onExit={returnToCatalog}
                    isLoading={isGachaLoading}
                />
            )}

            {/* --- Main Content Area --- */}
            <div ref={scrollContainerRef} onScroll={onScrollRestore} className="flex-1 overflow-y-auto p-4 md:p-6 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
                {imageDisplay.layout === 'masonry' ? (
                    <ShortestColumnMasonry<Artist>
                        items={filteredArtists}
                        columns={gridCols}
                        getItemKey={artist => String(artist.id)}
                        estimateItemHeight={estimateArtistCardHeight}
                        renderItem={renderArtistCard}
                    />
                ) : (
                    <div
                        className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-artist-grid`}
                        style={{ ...mobileGalleryStyle(imageDisplay), ...(isMobileViewport ? {} : { '--mobile-gallery-columns': gridCols }) }}
                    >
                        {filteredArtists.map(renderArtistCard)}
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

            <TagSelectionBar count={cart.length} unit="位画师" onClear={() => setCart([])} onCopy={copyCart} onImport={onNavigateToPlayground ? importCartToPlayground : undefined} />

        </div>
    );
};
