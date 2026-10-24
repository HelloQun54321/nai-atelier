import { drawLibraryIndices } from '../services/libraryRandom';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { collectionSnapshot, ensureCollection, subscribeCollection } from '../services/collectionFavorites';
import { localHistory } from '../services/localHistory';
import { loadRollBlocklist, ROLL_BLOCKLIST_CHANGED, saveRollBlocklist } from '../services/styleRollApi';
import { normalizeRollArtistKey } from '../services/styleRollSeed';
import { artistUsageCount, compareArtistUsage, getArtistUsage, isArtistUsageSort, matchesArtistUsage, type ArtistBrowseSort, type ArtistUsageFilter, type ArtistUsageIndex } from '../services/artistUsage';
import { t, useLanguage, getLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';
import { useImageRatios } from './useImageRatios';
import { appearanceScrollBehavior } from '../services/appearancePreferences';

import React, { useContext, useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { compareLibraryTags, matchesArtistSearch, parseArtistSearchTerms } from '../services/tagLibrary';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { TagSelectionBar } from './TagSelectionBar';
import { ArtistDictionaryEntry, ArtistDictionarySort, getArtistDictionaryPage } from '../services/tagDictionary';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { Check, Dice5, LoaderCircle, Settings2 } from 'lucide-react';
import { ToolbarButton, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { useArtistSampleActions, ArtistSampleGenerationStatus } from './useArtistSampleActions';
import { indexArtistSampleGallery } from '../services/artistSampleGallery';
import { ArtistSampleCover } from './ArtistSampleCover';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleCatalog, getArtistSampleDictionary, getArtistSampleStatus, mergeArtistSampleDictionary, isArtistOwnSampleForPack, isArtistSampleSourceForPack, normalizeArtistSampleTag, type ArtistSampleCatalog, type ArtistSamplePack, type ArtistSampleStatus } from '../services/artistSamples';
import { getArtistSampleData, validateArtistSampleTemplate, type ArtistSampleData } from '../services/artistSampleDrafts';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';
import { ImageActivityContext } from './SmartImage';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGalleryLoadMore } from './useGalleryLoadMore';

import { artistSampleGenerationBusy, artistSampleGenerationRevision, getArtistSampleGeneration, getGeneratedArtistSamples, readArtistSampleApiKey, subscribeArtistSampleGeneration } from '../services/artistSampleGeneration';
import { useAgentCommand } from '../services/agentCommands';

interface CartItem {
    name: string;
}

interface ArtistLibraryProps {
    selectionFocusEnabled?: boolean;
    enforceFreeStepLimit?: boolean;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onOpenRoll?: (tags: string[]) => void;
    /** 从 Roll 详情跳转时带入画师名，复用现有搜索。 */
    initialSearch?: { query: string; token: number } | null;
}

type ArtistGachaMode = 'mixed' | 'uniform' | 'popular';
type ArtistLibrarySort = ArtistBrowseSort;
type ArtistUsageState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; index: ArtistUsageIndex };
const dictionarySort = (sort: ArtistLibrarySort): ArtistDictionarySort => isArtistUsageSort(sort) ? 'popular' : sort;
const SAMPLE_PACKS = ['v45', 'v5'] as const;
const SEARCH_RESULT_LIMIT = 200;
const ONLY_SAMPLES_KEY = 'nai_artist_only_samples';
const readOnlySamples = () => localStorage.getItem(ONLY_SAMPLES_KEY) !== 'false';

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ notify, onNavigateToPlayground, onOpenRoll, initialSearch, selectionFocusEnabled = true, enforceFreeStepLimit = true }) => {
  useLanguage();
    useSyncExternalStore(subscribeArtistSampleGeneration, artistSampleGenerationRevision);
    const [samplePack, setSamplePack] = useState<ArtistSamplePack>(() => localStorage.getItem('nai_artist_sample_pack') === 'v5' ? 'v5' : 'v45');
    const [cardPacks, setCardPacks] = useState<Partial<Record<string, ArtistSamplePack>>>({});
    const [blockedArtists, setBlockedArtists] = useState<string[]>([]);
    const [blockSaving, setBlockSaving] = useState(false);
    const blockSavingRef = useRef(false);
    const blockedKeys = useMemo(() => new Set(blockedArtists.map(normalizeRollArtistKey)), [blockedArtists]);
    const toggleBlockedArtist = async (tag: string) => {
        if (blockSavingRef.current) return;
        blockSavingRef.current = true; setBlockSaving(true);
        try {
            const current = await loadRollBlocklist(), key = normalizeRollArtistKey(tag);
            const next = current.some(value => normalizeRollArtistKey(value) === key) ? current.filter(value => normalizeRollArtistKey(value) !== key) : [...current, tag];
            setBlockedArtists(await saveRollBlocklist(next));
        } finally { blockSavingRef.current = false; setBlockSaving(false); }
    };
    const [onlySamples, setOnlySamples] = useState(readOnlySamples);
    const updateOnlySamples = (value: boolean) => { setOnlySamples(value); try { localStorage.setItem(ONLY_SAMPLES_KEY, String(value)); } catch { /* 存储不可用时仍保留本次选择。 */ } };
    const [sampleStatus, setSampleStatus] = useState<ArtistSampleStatus | null>(null);
    const [sampleCatalogs, setSampleCatalogs] = useState<Partial<Record<ArtistSamplePack, ArtistSampleCatalog>>>({});
    const [catalogErrors, setCatalogErrors] = useState<Partial<Record<ArtistSamplePack, string>>>({});
    const [sampleData, setSampleData] = useState<ArtistSampleData>({ templates: {}, samples: [] });
    const [sampleDictionary, setSampleDictionary] = useState<ArtistDictionaryEntry[]>([]);
    const [sampleLoading, setSampleLoading] = useState(true);
    const [sampleError, setSampleError] = useState('');
    const [sampleRefresh, setSampleRefresh] = useState(0);
    const [sampleLimit, setSampleLimit] = useState(100);
    const getSampleStatusText = (pack: ArtistSamplePack) => {
      const currentPackStatus = sampleStatus?.packs.find(item => item.id === pack);
      const download = currentPackStatus?.download;
      const downloadPercent = download && download.totalBytes > 0 ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100)) : 0;
      return sampleError || catalogErrors[pack] || (sampleLoading && (!currentPackStatus || (currentPackStatus.phase === 'ready' && isArtistSampleSourceForPack(pack, currentPackStatus) && !sampleCatalogs[pack])) ? t('正在读取样张…')
        : download?.stage === 'downloading' ? t('图包下载中：{0}%', [downloadPercent])
        : download?.stage === 'verifying' ? t('正在校验图包…')
        : download?.stage === 'paused' ? t('图包下载已暂停：{0}%', [downloadPercent])
        : download?.stage === 'error' ? `${t('图包下载失败')}${download.error ? `：${download.error}` : ''}`
        : currentPackStatus?.phase === 'indexing' ? t('样张索引中：{0}%', [Math.round(currentPackStatus.progress)])
        : currentPackStatus?.phase === 'error' ? currentPackStatus.error || t('样张索引异常')
        : currentPackStatus?.phase === 'ready' && !isArtistSampleSourceForPack(pack, currentPackStatus) ? t('当前图包未确认为 V5 Full，原文件已保留')
        : currentPackStatus?.phase === 'ready' ? t('已读取 {0} 个样张 Tag', [currentPackStatus.count])
        : t('该模型尚未配置样张图包'));
    };
    const currentPackStatus = sampleStatus?.packs.find(pack => pack.id === samplePack);
    const download = currentPackStatus?.download;
    const sampleStatusText = getSampleStatusText(samplePack);
    const currentSampleError = sampleError || catalogErrors[samplePack];
    const generatedSamples = getGeneratedArtistSamples();
    const hasLegacyV5Samples = [...sampleData.samples, ...generatedSamples].some(sample => sample.pack === 'v5' && sample.params?.model?.startsWith('nai-diffusion-5-curated'));
    const libraryDictionary = useMemo(() => mergeArtistSampleDictionary(sampleDictionary, SAMPLE_PACKS.flatMap(pack => sampleCatalogs[pack]?.tags || [])), [sampleDictionary, sampleCatalogs]);
    const packOnlyArtists = useMemo(() => {
        const names = new Set(sampleDictionary.map(entry => entry.name));
        return libraryDictionary.filter(entry => !names.has(entry.name));
    }, [sampleDictionary, libraryDictionary]);
    const samplesByPack = useMemo(() => indexArtistSampleGallery(libraryDictionary, sampleData, sampleCatalogs, generatedSamples), [sampleData, libraryDictionary, sampleCatalogs, generatedSamples]);
    const sampledArtists = useMemo(() => [...new Map([...samplesByPack[samplePack].packed, ...samplesByPack[samplePack].ownArtists].map(entry => [entry.name, entry])).values()], [samplesByPack, samplePack]);
    const imageDisplay = useMobileImageDisplayPreferences('artists');
    // 瀑布流（masonry 布局时）：封面按真实宽高比完整显示，最短列分配互相补齐。
    const [artistRatios, updateImageRatio] = useImageRatios();
    const frostedCaption = useGalleryFrostedCaption();
    const estimateArtistCardHeight = React.useCallback((artist: (typeof filteredArtists)[number], columnWidth: number) => {
      const ratio = artistRatios[`${cardPacks[artist.name] || samplePack}:${artist.name}`] || 2 / 3;
      const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
      return imageHeight + (frostedCaption ? 2 : 92);
    }, [artistRatios, frostedCaption, cardPacks, samplePack]);
    const renderArtistCard = (artist: (typeof filteredArtists)[number]) => {
                            const isSelected = !!cart.find(c => c.name === artist.name);
                            const effectivePack = cardPacks[artist.name] || samplePack;
                            const samples = samplesByPack[effectivePack];
                            const artistOwnSamples = samples.ownNames.has(artist.name) ? samples.own.filter(sample => sample.tag === artist.name || (!samples.ownTags.has(artist.name) && normalizeArtistSampleTag(sample.tag) === normalizeArtistSampleTag(artist.name))) : [];
                            const ratioKey = `${effectivePack}:${artist.name}`;
                            const generation = getArtistSampleGeneration(artist.name, effectivePack);
                            const busy = artistSampleGenerationBusy(generation) || requestingTarget === ratioKey;

                            return (
                                <PressRevealSurface
                                    key={artist.name}
                                    pressResetKey={effectivePack}
                                    data-gallery-work-id={artist.name}
                                    data-safe-mode-work="true"
                                    role="button"
                                    data-agent-action="select"
                                    aria-label={t("选择画师：{0}", [artist.name])}
                                    aria-pressed={isSelected}
                                    tabIndex={0}
                                    className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden border transition-[filter,box-shadow,border-color] duration-150 cursor-pointer ${selectionFocusEnabled && cart.length > 0 && !isSelected ? 'brightness-[.7]' : ''} ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}
                                    onClick={() => toggleCart(artist.name)}
                                    onKeyDown={event => {
                                        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                                        event.preventDefault(); toggleCart(artist.name);
                                    }}
                                >
                                    <div className="appearance-media mobile-gallery-frame md:aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': artistRatios[ratioKey] ? `${Math.round(artistRatios[ratioKey] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                                        <ArtistSampleCover
                                            generation={generation}
                                            pending={busy}
                                            preferred={favoriteKeys.has(normalizeRollArtistKey(artist.name))}
                                            blocked={blockedKeys.has(normalizeRollArtistKey(artist.name))}
                                            blockPending={blockSaving}
                                            onBlock={() => toggleBlockedArtist(artist.name)}
                                            tag={artist.name}
                                            pack={effectivePack}
                                            onPackChange={pack => setCardPacks(previous => ({ ...previous, [artist.name]: pack }))}
                                            revision={sampleCatalogs[effectivePack]?.revision || ''}
                                            hasPackSample={samples.packedNames.has(artist.name)}
                                            packTag={samples.packTagNames.has(artist.name) ? artist.name : samples.normalizedPackTags.get(normalizeArtistSampleTag(artist.name))}
                                            sampleStatusText={onlySamples && !sampleCatalogs[effectivePack] ? getSampleStatusText(effectivePack) : undefined}
                                            ownSamples={artistOwnSamples}
                                            removedSamples={sampleData.removedSamples}
                                            onDelete={removeSample}
                                            alt={artist.chinese || artist.name}
                                            onSupplement={() => { supplementSample(artist.name, effectivePack); }}
                                            onGenerate={() => { supplementSample(artist.name, effectivePack, true); }}
                                            imageClassName={imageDisplay.layout === 'masonry' ? 'h-full w-full object-contain' : undefined}
                                            notify={notify}
                                            onImageLoad={(width, height) => updateImageRatio(ratioKey, width, height)}
                                        />
                                        {isSelected && (
                                            <div className="absolute inset-0 border-4 border-indigo-500/80 pointer-events-none" />
                                        )}
                                    </div>
                                    <div className="gallery-card-caption p-2 md:p-3 bg-white dark:bg-gray-800 text-center border-t border-gray-100 dark:border-gray-700">
                                        <div data-safe-mode-title="true" title={artist.name} className={`text-xs md:text-sm font-bold truncate ${isSelected ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-300'}`}>{isSelected && <Check aria-hidden="true" className="mr-1 inline h-3 w-3" strokeWidth={4} />}{artist.name}</div>
                                        {artist.chinese && <div data-safe-mode-title="true" className="mt-0.5 truncate text-micro text-gray-400" title={artist.chinese}>{artist.chinese}</div>}
                                        {artist.postCountKnown !== false && Number.isFinite(artist.postCount) && <div className="gallery-card-meta mt-0.5 text-micro font-mono text-gray-500" title={t("Danbooru 关联作品数")}>{t("作品 {0}", [artist.postCount.toLocaleString(getLanguage())])}</div>}
                                        <div className="gallery-card-meta mt-0.5 truncate text-micro tabular-nums text-gray-500" title={usageIndex ? t('收录 {0} 串 · 生成 {1} 张', [artistUsageCount(artist.name, usageIndex, 'chains'), artistUsageCount(artist.name, usageIndex, 'images')]) : usageState.status === 'loading' ? t('正在统计画师使用…') : undefined}>
                                            {usageIndex
                                                ? t('收录 {0} 串 · 生成 {1} 张', [artistUsageCount(artist.name, usageIndex, 'chains'), artistUsageCount(artist.name, usageIndex, 'images')])
                                                : t('收录 — 串 · 生成 — 张')}
                                        </div>
                                    </div>
                                    <ArtistSampleGenerationStatus tag={artist.name} pack={effectivePack} generation={generation} busy={busy} hasOwnSamples={artistOwnSamples.length > 0} supplementSample={supplementSample} manageGeneration={manageGeneration} />
                                </PressRevealSurface>
                            )
    };

    const [searchTerm, setSearchTerm] = useState('');
    const searchTerms = useMemo(() => parseArtistSearchTerms(searchTerm), [searchTerm]);
    const hasSearch = searchTerms.length > 0;
    const [cart, setCart] = useState<CartItem[]>([]);
    const [focusedName, setFocusedName] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const favoriteKeys = useMemo(() => new Set([...favorites].map(normalizeRollArtistKey)), [favorites]);
    const [showFavOnly, setShowFavOnly] = useState(false);
    const [usePrefix, setUsePrefix] = useState(true);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const agentRootRef = useRef<HTMLDivElement>(null);
    const active = useContext(ImageActivityContext);
    const { requesting, requestingTarget, removeSample, supplementSample, manageGeneration, setSampleSettings, settingsDialog } = useArtistSampleActions({ active, data: sampleData, setData: setSampleData, notify, enforceFreeStepLimit });
    const activeRef = useRef(active); activeRef.current = active;
    useEffect(() => { activeRef.current = active; return () => { activeRef.current = false; }; }, [active]);
    const [usageState, setUsageState] = useState<ArtistUsageState>({ status: 'loading' });
    const usageIndexRef = useRef<ArtistUsageIndex | null>(null);
    const usageIndex = usageState.status === 'ready' ? usageState.index : usageIndexRef.current;
    const [usageRetry, setUsageRetry] = useState(0);
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        let current = true;
        setUsageState({ status: 'loading' });
        void getArtistUsage(controller.signal).then(index => {
            if (current) { usageIndexRef.current = index; setUsageState({ status: 'ready', index }); }
        }).catch(() => {
            if (current && !controller.signal.aborted) setUsageState({ status: 'error' });
        });
        return () => { current = false; controller.abort(); };
    }, [active, usageRetry]);
    useEffect(() => active ? localHistory.subscribe(() => setUsageRetry(current => current + 1)) : undefined, [active]);
    useEffect(() => {
        let cancelled = false;
        const changed = (event: Event) => { cancelled = true; setBlockedArtists((event as CustomEvent<string[]>).detail); };
        window.addEventListener(ROLL_BLOCKLIST_CHANGED, changed);
        if (active) void loadRollBlocklist().then(tags => { if (!cancelled) setBlockedArtists(tags); }).catch(error => { if (!cancelled) notify(error.message, 'error'); });
        return () => { cancelled = true; window.removeEventListener(ROLL_BLOCKLIST_CHANGED, changed); };
    }, [active, notify]);
    const librarySettingsRef = useRef<HTMLDivElement>(null);
    const openTemplateSettings = (pack: ArtistSamplePack, close: () => void) => {
        // 手机面板先退回其历史层，再开配置，避免返回事件把新窗口一起关闭。
        const returned = window.history.state?.__naiMobileLayer?.startsWith('sheet-')
            ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
        flushSync(close);
        const open = () => {
            if (!activeRef.current) return;
            librarySettingsRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus({ preventScroll: true });
            setSampleSettings({ pack, generateAfterSave: false });
        };
        if (returned) void returned.then(open); else open();
    };
    const openSampleSettings = () => window.dispatchEvent(new CustomEvent('nai-open-global-settings', { detail: { section: 'maintenance' } }));
    useEffect(() => {
        const changed = () => setSampleRefresh(current => current + 1);
        window.addEventListener(ARTIST_SAMPLES_CHANGED, changed);
        return () => window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed);
    }, []);
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setSampleLoading(true); setSampleError(''); setCatalogErrors({});
        void Promise.all([getArtistSampleStatus(), getArtistSampleData(), getArtistSampleDictionary()]).then(async ([status, data, dictionary]) => {
            if (cancelled) return;
            setSampleStatus(status); setSampleData(current => ({ ...data, removedSamples: [...new Map([...(current.removedSamples || []), ...(data.removedSamples || [])].map(removal => [JSON.stringify(removal), removal])).values()] })); setSampleDictionary(dictionary);
            // 当前包尚未配置、也没有任何自建样张时先展示完整目录；下载／索引进行中仍保留样张视图和真实进度。
            if (localStorage.getItem(ONLY_SAMPLES_KEY) === null && !data.samples.some(sample => sample.pack === 'v45' || isArtistOwnSampleForPack(sample)) && status.packs.every(pack => (pack.phase === 'unconfigured' || !isArtistSampleSourceForPack(pack.id, pack)) && (!pack.download || pack.download.stage === 'missing'))) setOnlySamples(false);
            // 新状态确认失效时立即清掉旧目录；两包独立就绪，不让另一包失败阻塞当前卡片。
            setSampleCatalogs(previous => Object.fromEntries(Object.entries(previous).filter(([id, catalog]) => status.packs.some(pack => pack.id === id && pack.phase === 'ready' && pack.revision === catalog.revision && isArtistSampleSourceForPack(pack.id, pack) && isArtistSampleSourceForPack(pack.id, catalog)))));
            await Promise.all(SAMPLE_PACKS.map(async pack => {
                const packStatus = status.packs.find(item => item.id === pack);
                if (packStatus?.phase !== 'ready' || !isArtistSampleSourceForPack(pack, packStatus)) return;
                try {
                    const catalog = await getArtistSampleCatalog(pack);
                    if (!isArtistSampleSourceForPack(pack, catalog)) throw new Error(t('当前图包未确认为 V5 Full，原文件已保留'));
                    if (!cancelled) setSampleCatalogs(previous => ({ ...previous, [pack]: catalog }));
                } catch (error) {
                    if (cancelled) return;
                    setSampleCatalogs(previous => { const next = { ...previous }; delete next[pack]; return next; });
                    setCatalogErrors(previous => ({ ...previous, [pack]: error instanceof Error ? error.message : t('样张读取失败') }));
                }
            }));
        }).catch(error => { if (!cancelled) setSampleError(error instanceof Error ? error.message : t('样张读取失败')); })
            .finally(() => { if (!cancelled) setSampleLoading(false); });
        return () => { cancelled = true; };
    }, [active, sampleRefresh]);
    useEffect(() => {
        if (!active || !sampleStatus?.packs.some(pack => pack.phase === 'indexing' || ['downloading', 'verifying'].includes(pack.download?.stage || ''))) return;
        const timer = window.setInterval(() => setSampleRefresh(current => current + 1), 2000);
        return () => window.clearInterval(timer);
    }, [active, sampleStatus]);
    const selectionAnchor = useGallerySelectionAnchor(scrollContainerRef, scrollContainerRef, cart.some(item => item.name === focusedName) ? focusedName : null, active, selectionFocusEnabled);
    const [loadedCatalogArtists, setLoadedCatalogArtists] = useState<ArtistDictionaryEntry[]>([]);
    const [catalogSearchResults, setCatalogSearchResults] = useState<ArtistDictionaryEntry[]>([]);
    const [artistCatalogCount, setArtistCatalogCount] = useState(0);
    const [isCatalogLoading, setIsCatalogLoading] = useState(true);
    const [isLoadingMoreCatalog, setIsLoadingMoreCatalog] = useState(false);
    const [hasMoreCatalog, setHasMoreCatalog] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [catalogRetry, setCatalogRetry] = useState(0);
    const [searchError, setSearchError] = useState('');
    const [searchRetry, setSearchRetry] = useState(0);
    const [loadMoreError, setLoadMoreError] = useState('');
    const [artistSort, setArtistSort] = useState<ArtistLibrarySort>(() => {
        const saved = localStorage.getItem('nai_artist_sort');
        return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' || isArtistUsageSort(saved || '') ? saved as ArtistLibrarySort : 'popular';
    });
    const [chainUsageFilter, setChainUsageFilter] = useState<ArtistUsageFilter>('all');
    const [imageUsageFilter, setImageUsageFilter] = useState<ArtistUsageFilter>('all');
    const serverArtistSort = dictionarySort(artistSort);
    const statsSortReady = usageState.status === 'ready' && libraryDictionary.length > 0;
    const usageFiltersActive = chainUsageFilter !== 'all' || imageUsageFilter !== 'all';
    const localUsageBrowse = isArtistUsageSort(artistSort) || usageFiltersActive;
    const resultKey = JSON.stringify([searchTerm, onlySamples, showFavOnly, artistSort, chainUsageFilter, imageUsageFilter, samplePack]);
    const onScrollRestore = useKeepAliveScrollRestore(scrollContainerRef, 'library', { skipRestore: selectionAnchor.hasAnchor, resetKey: resultKey, onReset: selectionAnchor.clearAnchor });
    const catalogSearchRequestRef = useRef(0);
    const catalogSentinelRef = useRef<HTMLDivElement>(null);
    const nextCatalogPageRef = useRef(0);
    const catalogPageCountRef = useRef(0);
    const catalogPageLoadingRef = useRef(false);
    const catalogLoadGenerationRef = useRef(0);
    const artistSortRef = useRef<ArtistDictionarySort>(serverArtistSort);

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
    const usageSortedArtists = useMemo(() => {
        if (gachaArtists || !localUsageBrowse || !libraryDictionary.length) return null;
        const sampledNames = onlySamples ? new Set(sampledArtists.map(entry => entry.name)) : null;
        return libraryDictionary.filter(entry => (!sampledNames || sampledNames.has(entry.name)) &&
            (!showFavOnly || favoriteKeys.has(normalizeRollArtistKey(entry.name))) &&
            matchesArtistSearch(entry, searchTerms) &&
            (!usageFiltersActive || !usageIndex || matchesArtistUsage(entry.name, usageIndex, chainUsageFilter, imageUsageFilter)))
            .slice().sort((left, right) => usageIndex
                ? compareArtistUsage(left, right, artistSort, usageIndex)
                : compareLibraryTags(left, right, 'popular'));
    }, [artistSort, libraryDictionary, onlySamples, gachaArtists, sampledArtists, searchTerms, showFavOnly, favoriteKeys, usageIndex, localUsageBrowse, usageFiltersActive, chainUsageFilter, imageUsageFilter]);
    const recentGachaIndicesRef = useRef<number[][]>([]);
    const catalogScrollTopRef = useRef(0);
    const gachaGenerationRef = useRef(0);
    const leaveGacha = useCallback((keepFocus = false) => {
        gachaGenerationRef.current++;
        if (!keepFocus) setFocusedName(null);
        setGachaArtists(null);
        setIsGachaLoading(false);
    }, []);
    // 从 Roll 详情带回画师名：沿用现有搜索，不额外维护第二套筛选状态。
    useEffect(() => {
        if (!initialSearch) return;
        setSearchTerm(initialSearch.query);
        setShowFavOnly(false);
        leaveGacha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSearch?.token]);
    useEffect(() => () => { gachaGenerationRef.current++; }, []);

    // View Settings
    const gridCols = useMasonryColumnCount(imageDisplay, undefined, scrollContainerRef);
    useEffect(() => {
        const savedPrefix = localStorage.getItem('nai_use_prefix');
        if (savedPrefix !== null) setUsePrefix(savedPrefix === 'true');
    }, []);

    const loadNextCatalogPage = useCallback(async () => {
        if (catalogPageLoadingRef.current || nextCatalogPageRef.current >= catalogPageCountRef.current) return;
        const generation = catalogLoadGenerationRef.current;
        catalogPageLoadingRef.current = true;
        setIsLoadingMoreCatalog(true);
        setLoadMoreError('');
        try {
            const result = await getArtistDictionaryPage(nextCatalogPageRef.current, artistSortRef.current);
            if (generation !== catalogLoadGenerationRef.current) return;
            setLoadedCatalogArtists(previous => [...previous, ...result.entries]);
            nextCatalogPageRef.current = result.page + 1;
            setHasMoreCatalog(nextCatalogPageRef.current < result.pageCount);
        } catch (error) {
            console.warn('Unable to load more artist tags:', error);
            if (generation === catalogLoadGenerationRef.current) setLoadMoreError(t('加载更多画师失败，请重试'));
        } finally {
            if (generation === catalogLoadGenerationRef.current) {
                catalogPageLoadingRef.current = false;
                setIsLoadingMoreCatalog(false);
            }
        }
    }, []);

    useEffect(() => {
        artistSortRef.current = serverArtistSort;
        localStorage.setItem('nai_artist_sort', artistSort);
        setSampleLimit(100);
        if (localUsageBrowse) {
            catalogLoadGenerationRef.current++;
            catalogPageLoadingRef.current = false;
            setIsCatalogLoading(false);
            setIsLoadingMoreCatalog(false);
            setHasMoreCatalog(false);
            setLoadMoreError('');
            return;
        }
        const generation = ++catalogLoadGenerationRef.current;
        catalogPageLoadingRef.current = true;
        nextCatalogPageRef.current = 0;
        catalogPageCountRef.current = 0;
        setLoadedCatalogArtists([]);
        setHasMoreCatalog(false);
        setIsCatalogLoading(true);
        setIsLoadingMoreCatalog(false);
        setCatalogError('');
        setLoadMoreError('');
        let cancelled = false;
        getArtistDictionaryPage(0, serverArtistSort)
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
                if (cancelled || generation !== catalogLoadGenerationRef.current) return;
                const message = t('画师目录不可用，请在全局设置更新 Tag 词库。');
                setCatalogError(message);
                notify(message, 'error');
            })
            .finally(() => {
                if (!cancelled && generation === catalogLoadGenerationRef.current) {
                    catalogPageLoadingRef.current = false;
                    setIsCatalogLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [artistSort, serverArtistSort, catalogRetry, localUsageBrowse]);

    useEffect(() => {
        if (localUsageBrowse) {
            catalogSearchRequestRef.current++;
            setCatalogSearchResults([]);
            setSearchError('');
            setIsCatalogLoading(false);
            return;
        }
        const terms = onlySamples || showFavOnly ? [] : searchTerms;
        const requestId = ++catalogSearchRequestRef.current;
        if (!terms.length) {
            setCatalogSearchResults([]);
            setSearchError('');
            // 清空搜索词时必须复位 loading：在途请求的 finally 会被上面递增的代际守卫拦下，不复位就永久转圈
            setIsCatalogLoading(false);
            return;
        }

        setIsCatalogLoading(true);
        setSearchError('');
        const timer = window.setTimeout(() => {
            getArtistSampleDictionary()
                .then(entries => {
                    if (requestId === catalogSearchRequestRef.current) setCatalogSearchResults([...new Map(entries.filter(entry => matchesArtistSearch(entry, terms)).map(entry => [entry.name, entry])).values()]
                        .sort((left, right) => compareLibraryTags(left, right, serverArtistSort)).slice(0, SEARCH_RESULT_LIMIT + 1));
                })
                .catch(error => {
                    if (requestId === catalogSearchRequestRef.current) {
                        setCatalogSearchResults([]);
                        setSearchError(t('搜索画师失败，请稍后重试'));
                    }
                    console.warn('Artist tag search failed:', error);
                })
                .finally(() => {
                    if (requestId === catalogSearchRequestRef.current) setIsCatalogLoading(false);
                });
        }, 180);
        return () => window.clearTimeout(timer);
    }, [artistSort, serverArtistSort, searchTerms, onlySamples, showFavOnly, searchRetry, localUsageBrowse]);

    // 词库仍按页读取，只将已缓存的图包独有名单并入当前页；不为目录浏览再请求全量词库。
    const catalogWithPackArtists = useMemo(() => [...loadedCatalogArtists, ...packOnlyArtists].sort((left, right) => compareLibraryTags(left, right, serverArtistSort)), [loadedCatalogArtists, packOnlyArtists, serverArtistSort]);
    const catalogDisplayLimit = Math.max(sampleLimit, loadedCatalogArtists.length);
    const visibleCatalogArtists = catalogWithPackArtists.slice(0, catalogDisplayLimit);
    const hasMoreUnionCatalog = hasMoreCatalog || catalogWithPackArtists.length > catalogDisplayLimit;
    const hasMoreSamples = (showFavOnly ? sampledArtists.filter(entry => favoriteKeys.has(normalizeRollArtistKey(entry.name))).length : sampledArtists.length) > sampleLimit;
    const hasMoreVisible = localUsageBrowse
        ? !hasSearch && (usageSortedArtists?.length || 0) > sampleLimit
        : onlySamples ? hasMoreSamples : !showFavOnly && hasMoreUnionCatalog;
    const loadMore = () => { if (localUsageBrowse || onlySamples) setSampleLimit(current => current + 100); else if (hasMoreCatalog) void loadNextCatalogPage(); else setSampleLimit(current => Math.max(current, loadedCatalogArtists.length) + 100); };
    useGalleryLoadMore(scrollContainerRef, catalogSentinelRef, !hasSearch && !gachaArtists && hasMoreVisible && !loadMoreError, loadMore, '800px 0px', onlySamples || localUsageBrowse ? sampleLimit : `${nextCatalogPageRef.current}:${catalogDisplayLimit}`);

    useEffect(() => {
        const sync = () => setFavorites(new Set(collectionSnapshot()
            .filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId)
            .map(item => item.sourceId!)));
        sync(); void ensureCollection().catch(() => {}); return subscribeCollection(sync);
    }, []);

    const toggleCart = (name: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (cart.find(i => i.name === name)) {
            setCart(cart.filter(i => i.name !== name));
        } else {
            setFocusedName(name);
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

    const availableArtists = useMemo(() => {
        if (gachaArtists) return gachaArtists.slice().sort((left, right) => usageIndex
            ? compareArtistUsage(left, right, artistSort, usageIndex)
            : compareLibraryTags(left, right, dictionarySort(artistSort)));
        if (usageSortedArtists) return usageSortedArtists.slice(0, hasSearch ? SEARCH_RESULT_LIMIT + 1 : sampleLimit);
        if (onlySamples) return sampledArtists
            .filter(entry => (!showFavOnly || favoriteKeys.has(normalizeRollArtistKey(entry.name))) && matchesArtistSearch(entry, searchTerms))
            .slice().sort((left, right) => compareLibraryTags(left, right, dictionarySort(artistSort)))
            .slice(0, hasSearch ? SEARCH_RESULT_LIMIT + 1 : sampleLimit);
        // 收藏筛选真实词库与已接入图包，不从旧收藏快照补造条目或受已展示分页限制。
        if (showFavOnly) return libraryDictionary.slice().sort((left, right) => compareLibraryTags(left, right, dictionarySort(artistSort)));
        return hasSearch ? [...new Map([...catalogSearchResults, ...packOnlyArtists.filter(entry => matchesArtistSearch(entry, searchTerms))].map(entry => [entry.name, entry])).values()]
            .sort((left, right) => compareLibraryTags(left, right, dictionarySort(artistSort)))
            .slice(0, SEARCH_RESULT_LIMIT + 1)
            : visibleCatalogArtists;
    }, [catalogSearchResults, gachaArtists, visibleCatalogArtists, searchTerms, hasSearch, onlySamples, sampledArtists, libraryDictionary, packOnlyArtists, artistSort, showFavOnly, favoriteKeys, sampleLimit, usageSortedArtists, usageIndex]);

    const matchedArtists = useMemo(() => availableArtists.filter(artist => {
        if (showFavOnly && !favoriteKeys.has(normalizeRollArtistKey(artist.name))) return false;
        return matchesArtistSearch(artist, searchTerms);
    }), [availableArtists, showFavOnly, favoriteKeys, searchTerms]);
    // 目录搜索与样张搜索都只取前 201 条，足以判断是否还有更多；展示上限保持 200。
    const filteredArtists = useMemo(() => hasSearch ? matchedArtists.slice(0, SEARCH_RESULT_LIMIT) : matchedArtists, [matchedArtists, hasSearch]);
    const searchTruncated = hasSearch && matchedArtists.length > filteredArtists.length;

    // 抽卡只读取本地 Tag 目录，不触发生图。

    const drawGacha = async () => {
        const pool = sampledArtists.slice().sort((left, right) => compareLibraryTags(left, right, 'popular'));
        const total = pool.length;
        if (total <= 0 || isGachaLoading) return;
        if (!gachaArtists) catalogScrollTopRef.current = scrollContainerRef.current?.scrollTop || 0;

        const generation = ++gachaGenerationRef.current;
        setFocusedName(null);
        setIsGachaLoading(true);
        setSearchTerm('');
        setShowFavOnly(false);
        setChainUsageFilter('all');
        setImageUsageFilter('all');
        localStorage.setItem('nai_artist_gacha_mode', gachaMode);
        localStorage.setItem('nai_artist_gacha_count', String(gachaCount));

        try {
            const indices = drawLibraryIndices(total, gachaCount, gachaMode, recentGachaIndicesRef.current);
            const artists = indices.map(index => pool[index]);
            if (generation !== gachaGenerationRef.current) return;
            setGachaArtists(artists);
            recentGachaIndicesRef.current = [...recentGachaIndicesRef.current, indices].slice(-5);
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: appearanceScrollBehavior() });
        } catch (error) {
            if (generation !== gachaGenerationRef.current) return;
            console.warn('Artist gacha failed:', error);
            notify('随机选择画师失败，请稍后重试', 'error');
        } finally {
            if (generation === gachaGenerationRef.current) setIsGachaLoading(false);
        }
    };

    const returnToCatalog = () => {
        setSearchTerm('');
        leaveGacha();
        requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: catalogScrollTopRef.current }));
    };

    useAgentCommand({
        name: 'get_artist_sample_status', label: '读取画师样张状态', description: '读取指定画师与样张包的生成、保存、失败或取消状态。', parameters: { type: 'object', properties: { tag: { type: 'string' }, pack: { enum: ['v45', 'v5'] } }, required: ['tag'] }, readOnly: true, scope: () => agentRootRef.current,
        execute: args => {
            const tag = String(args.tag || '').trim();
            const pack: ArtistSamplePack = args.pack === 'v5' ? 'v5' : 'v45';
            if (!tag) throw new Error('请提供画师 Tag');
            const state = getArtistSampleGeneration(tag, pack);
            return state ? {
                tag, pack, phase: state.phase, error: state.error || '', hasPreview: Boolean(state.preview),
                historyIds: state.target.historyIds,
                session: state.session ? { state: state.session.state, queued: state.session.queued, progress: state.session.progress, awaiting: state.session.awaiting || null } : null,
            } : { tag, pack, phase: 'idle' };
        },
    });
    useAgentCommand({
        name: 'generate_artist_sample', label: '生成或补充画师样张', description: '为指定画师生成样张并归档；按当前权限直接生成或等待页面费用确认。', parameters: { type: 'object', properties: { tag: { type: 'string' }, pack: { enum: ['v45', 'v5'] }, regenerate: { type: 'boolean' }, agentPermissionMode: { type: 'string' } }, required: ['tag'] }, scope: () => agentRootRef.current,
        execute: args => {
            const tag = String(args.tag || '').trim();
            const pack: ArtistSamplePack = args.pack === 'v5' ? 'v5' : 'v45';
            if (!tag) throw new Error('请提供画师 Tag');
            if (!readArtistSampleApiKey()) throw new Error('请先在全局设置中配置 NovelAI API Key');
            if (requesting.current) throw new Error('已有样张请求正在等待费用确认');
            if (artistSampleGenerationBusy(getArtistSampleGeneration(tag, pack))) throw new Error('这位画师已有样张正在生成，请等待完成');
            const template = sampleData.templates[pack];
            if (!template) {
                setSampleSettings({ tag, pack, generateAfterSave: true, regenerate: args.regenerate === true });
                return { started: false, requiresSettings: true, note: '还没有保存样张模板，已在页面打开设置。' };
            }
            validateArtistSampleTemplate(pack, template);
            const started = supplementSample(tag, pack, args.regenerate === true, { skipConfirmation: args.agentPermissionMode === 'full' });
            return { started, tag, pack, regenerate: args.regenerate === true, note: started ? '已发起样张生成；费用确认由页面处理，进度用 get_artist_sample_status 读取。' : '未能发起，请检查页面状态。' };
        },
    });

    return (
        <div ref={agentRootRef} className="workspace-canvas flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">

            {/* --- Controls Header --- */}
            <WorkspaceChrome>
<WorkspaceToolbar>
                <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div role="group" aria-label={t('画师样张模型')} className="appearance-group flex flex-none items-center rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-950">
                    <span className="hidden px-1.5 text-micro font-semibold text-gray-500 dark:text-gray-400 sm:inline">{t('样张')}</span>
                    {(['v45', 'v5'] as const).map(pack => <button type="button" key={pack} aria-pressed={samplePack === pack} onClick={() => { setCardPacks({}); if (pack === samplePack) return; setSamplePack(pack); localStorage.setItem('nai_artist_sample_pack', pack); recentGachaIndicesRef.current = []; leaveGacha(true); }} className={`appearance-group mobile-touch rounded-lg px-2 py-1.5 text-xs font-bold ${samplePack === pack ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>{pack === 'v45' ? 'V4.5' : 'V5 Full'}</button>)}
                </div>
                <div className="relative min-w-[140px] flex-1">
                    <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); leaveGacha(); }} placeholder={t("搜索画师，多个词用逗号分隔")} containerClassName="md:max-w-none!" className="pr-9" />
                    {isCatalogLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
                </div>
                <ToolbarPopover title={t("筛选画师")} count={Number(artistSort !== 'popular') + Number(showFavOnly) + Number(!onlySamples) + Number(chainUsageFilter !== 'all') + Number(imageUsageFilter !== 'all')}>
                    <div className="space-y-3">
                        <p role="status" className={`text-xs ${currentSampleError || download?.stage === 'error' || currentPackStatus?.phase === 'error' ? 'text-red-500' : 'text-gray-500'}`}>{sampleStatusText}{samplePack === 'v5' && hasLegacyV5Samples && <span className="block">{t('旧 Curated 样张已保留，不计入 Full 浏览')}</span>}</p>
                        {usageState.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('正在统计画师使用…')}</p>}
                        {usageState.status === 'error' && <p role="alert" className="flex items-center justify-between gap-2 text-xs text-red-500">{t('画师使用统计暂不可用')}<button type="button" className="shrink-0 underline" onClick={() => setUsageRetry(current => current + 1)}>{t('重试统计')}</button></p>}
                        <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={onlySamples} onChange={event => { updateOnlySamples(event.target.checked); leaveGacha(); }} />{t('只看有样张')}</label>
                        <label className="block text-sm font-semibold dark:text-white">{t("排序")}<select aria-label={t("画师排序")} value={artistSort} onChange={event => { setArtistSort(event.target.value as ArtistLibrarySort); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}>
                            <option value="popular">{hasSearch ? t("相关性优先 · 热度高") : t("热度从高到低")}</option><option value="least">{hasSearch ? t("相关性优先 · 热度低") : t("热度从低到高")}</option><option value="name-asc">{t("名称 A → Z")}</option><option value="name-desc">{t("名称 Z → A")}</option>
                            <option value="usage-chains" disabled={!statsSortReady}>{t('收录串数从高到低')}</option><option value="usage-chains-asc" disabled={!statsSortReady}>{t('收录串数从低到高')}</option><option value="usage-images" disabled={!statsSortReady}>{t('生成图片数从高到低')}</option><option value="usage-images-asc" disabled={!statsSortReady}>{t('生成图片数从低到高')}</option>
                        </select></label>
                        <label className="block text-sm font-semibold dark:text-white">{t('风格串收录')}<select aria-label={t('风格串收录')} value={chainUsageFilter} disabled={!statsSortReady} onChange={event => { setChainUsageFilter(event.target.value as ArtistUsageFilter); setSampleLimit(100); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}><option value="all">{t('全部')}</option><option value="used">{t('已收录')}</option><option value="unused">{t('未收录')}</option></select></label>
                        <label className="block text-sm font-semibold dark:text-white">{t('图片生成')}<select aria-label={t('图片生成')} value={imageUsageFilter} disabled={!statsSortReady} onChange={event => { setImageUsageFilter(event.target.value as ArtistUsageFilter); setSampleLimit(100); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}><option value="all">{t('全部')}</option><option value="used">{t('已生成')}</option><option value="unused">{t('未生成')}</option></select></label>
                        <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={showFavOnly} onChange={event => { setShowFavOnly(event.target.checked); leaveGacha(); }} />{t("只看收藏画师")}</label>
                        <button type="button" onClick={() => { setArtistSort('popular'); setChainUsageFilter('all'); setImageUsageFilter('all'); setShowFavOnly(false); updateOnlySamples(true); setSampleLimit(100); leaveGacha(); }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">{t("重置筛选")}</button>
                    </div>
                </ToolbarPopover>
                <ToolbarButton aria-label={gachaArtists ? t("再选一批") : t("随机选画师")} title={sampledArtists.length ? undefined : t('先下载样张图包或生成样张')} onClick={() => void drawGacha()} disabled={isGachaLoading || sampledArtists.length <= 0} className="mobile-touch" tone="neutral">
                        {isGachaLoading ? <LoaderCircle className="animate-spin" /> : <Dice5 />}<span className="hidden sm:inline">{gachaArtists ? t("再选一批") : t("随机选画师")}</span>
                </ToolbarButton>
                <div ref={librarySettingsRef} className="flex flex-none items-center border-l border-gray-200 pl-2 dark:border-gray-700">
                    <ToolbarPopover label={t('画师库设置')} title={t('画师库设置')} icon={<Settings2 />} className="[&_button>span]:!inline" width={320}>
                      {close => <div className="space-y-4"><div className="grid grid-cols-2 gap-3">
                            <label className="text-sm font-semibold dark:text-white">{t("随机方式")}<select value={gachaMode} onChange={event => setGachaMode(event.target.value as ArtistGachaMode)} className={TOOLBAR_FIELD_CLASS}><option value="mixed">{t("惊喜混合")}</option><option value="uniform">{t("完全随机")}</option><option value="popular">{t("热门画师")}</option></select></label>
                            <label className="text-sm font-semibold dark:text-white">{t("数量")}<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className={TOOLBAR_FIELD_CLASS}><option value={6}>{t("6 位")}</option><option value={12}>{t("12 位")}</option><option value={24}>{t("24 位")}</option></select></label>
                        </div><div className="border-t border-gray-200 pt-3 dark:border-gray-700"><p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('补图生成设置')}</p><div className="grid grid-cols-2 gap-2">{SAMPLE_PACKS.map(pack => <button key={pack} type="button" aria-label={t('{0} 补图生成设置', [pack === 'v45' ? 'V4.5' : 'V5 Full'])} onClick={() => openTemplateSettings(pack, close)} className="appearance-group mobile-touch min-h-11 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-indigo-500 dark:hover:text-indigo-300">{pack === 'v45' ? 'V4.5' : 'V5 Full'}</button>)}</div></div></div>}
                    </ToolbarPopover>
                </div>
                </div>
            </WorkspaceToolbar>
            {!isCatalogLoading && !catalogError && !searchError && !((onlySamples || showFavOnly) && currentSampleError) && ((!onlySamples && !showFavOnly && !gachaArtists) || !sampleLoading) && <ToolbarCountCaption>{hasSearch
                ? t(searchTruncated ? '已加载中匹配 {0} 位' : '匹配 {0} 位', [filteredArtists.length])
                : gachaArtists ? t('本次抽取 {0} 位', [filteredArtists.length])
                : localUsageBrowse ? usageFiltersActive || showFavOnly
                    ? t(hasMoreVisible ? '已加载中匹配 {0} 位' : '匹配 {0} 位', [filteredArtists.length])
                    : t(hasMoreVisible ? '已加载 {0} 位' : '共 {0} 位', [filteredArtists.length])
                : showFavOnly ? t(hasMoreSamples ? '已加载中匹配 {0} 位' : '匹配 {0} 位', [filteredArtists.length])
                : onlySamples ? t(hasMoreSamples ? '已加载 {0} 位' : '共 {0} 位', [filteredArtists.length])
                : hasMoreUnionCatalog ? t('已加载 {0} 位', [visibleCatalogArtists.length])
                : t('共 {0} 位', [artistCatalogCount + packOnlyArtists.length])}
            </ToolbarCountCaption>}

            {gachaArtists && (
                <GalleryActiveStateBanner
                    count={filteredArtists.length}
                    entityName={t("画师")}
                    showDrawAgain={false}
                    onDrawAgain={() => void drawGacha()}
                    onExit={returnToCatalog}
                    isLoading={isGachaLoading}
                />
            )}

            {/* --- Main Content Area --- */}
            </WorkspaceChrome>
            <div ref={scrollContainerRef} onScroll={() => { selectionAnchor.onScroll(); onScrollRestore(); }} className="workspace-canvas workspace-scroll-viewport flex-1 overflow-y-auto p-4 md:p-6 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
                {showFavOnly && !filteredArtists.length && !isCatalogLoading && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    <p>{usageFiltersActive ? t('没有匹配的画师') : t('还没有收藏画师')}</p>
                    <button type="button" className="mobile-touch mt-3 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setShowFavOnly(false)}>{t('关闭只看收藏')}</button>
                    {onlySamples && <button type="button" className="mobile-touch mt-3 ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('浏览全部画师')}</button>}
                </div>}
                {!showFavOnly && onlySamples && !filteredArtists.length && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    {usageFiltersActive ? t('没有匹配的画师') : !currentSampleError && !sampleLoading && currentPackStatus?.phase === 'ready' && isArtistSampleSourceForPack(samplePack, currentPackStatus) && (!download || ['missing', 'ready'].includes(download.stage)) ? t('没有匹配的画师样张') : sampleStatusText}
                    {currentSampleError && <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setSampleRefresh(current => current + 1)}>{t('重试')}</button>}
                    {hasSearch && <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('在全部画师中搜索')}</button>}
                    {!hasSearch && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button type="button" className="mobile-touch rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={openSampleSettings}>{t('下载样张图包')}</button>
                        <button type="button" className="mobile-touch rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('浏览全部画师')}</button>
                    </div>}
                </div>}
                {!showFavOnly && !onlySamples && !filteredArtists.length && !isCatalogLoading && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    {searchError || catalogError ? <>
                        {searchError || catalogError}
                        <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => searchError ? setSearchRetry(current => current + 1) : setCatalogRetry(current => current + 1)}>{t('重试')}</button>
                    </> : hasSearch ? <>
                        {t('没有匹配的画师')}
                        <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setSearchTerm('')}>{t('清除搜索')}</button>
                    </> : usageFiltersActive ? t('没有匹配的画师') : t('画师目录不可用，请在全局设置更新 Tag 词库。')}
                </div>}
                {imageDisplay.layout === 'masonry' ? (
                    <ShortestColumnMasonry<ArtistDictionaryEntry>
                        resetKey={resultKey}
                        stableColumns
                        items={filteredArtists}
                        columns={gridCols}
                        getItemKey={artist => artist.name}
                        estimateItemHeight={estimateArtistCardHeight}
                        renderItem={renderArtistCard}
                    />
                ) : (
                    <div
                        className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-artist-grid`}
                        style={mobileGalleryStyle(imageDisplay, gridCols)}
                    >
                        {filteredArtists.map(renderArtistCard)}
                    </div>
                )}

                {searchTruncated && <p role="status" className="py-4 text-center text-xs text-gray-400">{t('仅显示前 200 条结果，请缩小搜索范围')}</p>}

                {!hasSearch && !gachaArtists && (
                    <div ref={catalogSentinelRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-gray-400">
                        {isLoadingMoreCatalog ? (
                            <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />{t("正在加载更多画师…")}</span>
                        ) : loadMoreError ? (
                            <span role="alert" className="flex items-center gap-2">{loadMoreError}<button type="button" onClick={loadMore} className="rounded-full border border-gray-300 px-3 py-1 hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">{t('重试')}</button></span>
                        ) : hasMoreVisible ? (
                            <button type="button" onClick={loadMore} className="rounded-full border border-gray-300 px-4 py-2 hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">{t("继续向下滚动加载更多")}</button>
                        ) : (onlySamples ? sampledArtists.length : artistCatalogCount) > 0 ? (
                            <span>{t("已加载完整画师目录")}</span>
                        ) : null}
                    </div>
                )}
            </div>

            {settingsDialog}

            <TagSelectionBar count={cart.length} unit={t("位画师")} onClear={() => setCart([])} onCopy={copyCart} onImport={onNavigateToPlayground ? importCartToPlayground : undefined} onSendToRoll={onOpenRoll ? () => { const tags = cart.map(item => item.name); setCart([]); onOpenRoll(tags); } : undefined} />

        </div>
    );
};
