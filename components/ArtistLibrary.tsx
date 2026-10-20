import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { collectionSnapshot, subscribeCollection } from '../services/collectionFavorites';
import { t, useLanguage, getLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';
import { useImageRatios } from './useImageRatios';
import { appearanceScrollBehavior } from '../services/appearancePreferences';

import React, { useContext, useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { compareLibraryTags } from '../services/tagLibrary';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { TagSelectionBar } from './TagSelectionBar';
import { ArtistDictionaryEntry, ArtistDictionarySort, getArtistDictionaryPage, searchArtistDictionary } from '../services/tagDictionary';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { Check, Dice5, Heart, LoaderCircle, Settings2 } from 'lucide-react';
import { ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ArtistSampleSettingsDialog } from './ArtistSampleSettingsDialog';
import { ArtistSampleCover } from './ArtistSampleCover';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleCatalog, getArtistSampleDictionary, getArtistSampleStatus, matchArtistSampleTags, normalizeArtistSampleTag, type ArtistOwnSample, type ArtistSampleCatalog, type ArtistSamplePack, type ArtistSampleStatus, type ArtistSampleTemplate } from '../services/artistSamples';
import { getArtistSampleData } from '../services/artistSampleDrafts';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';
import { ImageActivityContext } from './SmartImage';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGalleryLoadMore } from './useGalleryLoadMore';

import { artistSampleGenerationBusy, artistSampleGenerationRevision, beginArtistSampleGeneration, getArtistSampleGeneration, getGeneratedArtistSamples, readArtistSampleApiKey, retryArtistSampleSave, subscribeArtistSampleGeneration } from '../services/artistSampleGeneration';
import { applyEstimatorRuntime, estimateV45GenerationCost, useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { useConfirmDialog } from './ConfirmDialog';
import { confirmationCostScope } from '../services/dailyConfirmation';
import { approveGenerationSeries, stopGenerationSeriesSession } from '../services/generationSeries';
import { setGenerationQueuePaused } from '../services/generationTask';

interface CartItem {
    name: string;
}

interface ArtistLibraryProps {
    selectionFocusEnabled?: boolean;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
    onOpenRoll?: (tags: string[]) => void;
    /** 从 Roll 详情跳转时带入画师名，复用现有搜索。 */
    initialSearch?: { query: string; token: number } | null;
}

type ArtistGachaMode = 'mixed' | 'uniform' | 'popular';
type SampleSettingsTarget = { tag?: string; pack: ArtistSamplePack; generateAfterSave: false } | { tag: string; pack: ArtistSamplePack; generateAfterSave: true; regenerate?: boolean };
const SAMPLE_PACKS = ['v45', 'v5'] as const;
const SEARCH_RESULT_LIMIT = 200;
const ONLY_SAMPLES_KEY = 'nai_artist_only_samples';
const readOnlySamples = () => localStorage.getItem(ONLY_SAMPLES_KEY) !== 'false';
/** 画师名与词库 Tag 使用下划线，输入框里常出现空格；搜索统一按空格形式比较。 */
const normalizeArtistSearch = (value: string) => {
    const lower = value.toLowerCase();
    if (!lower.includes('_') && !lower.includes('  ')) return lower.trim();
    return lower.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
};

export const ArtistLibrary: React.FC<ArtistLibraryProps> = ({ notify, onNavigateToPlayground, onOpenRoll, initialSearch, selectionFocusEnabled = true }) => {
  useLanguage();
    const confirm = useConfirmDialog();
    const budget = useAnlasBudget(), subscription = useNovelaiUsage();
    const runtime = useNaiRuntime(); applyEstimatorRuntime(runtime);
    useSyncExternalStore(subscribeArtistSampleGeneration, artistSampleGenerationRevision);
    const requesting = useRef(false);
    const [requestingTarget, setRequestingTarget] = useState('');
    const [samplePack, setSamplePack] = useState<ArtistSamplePack>(() => localStorage.getItem('nai_artist_sample_pack') === 'v5' ? 'v5' : 'v45');
    const [cardPacks, setCardPacks] = useState<Partial<Record<string, ArtistSamplePack>>>({});
    const [sampleSettings, setSampleSettings] = useState<SampleSettingsTarget | null>(null);
    const [onlySamples, setOnlySamples] = useState(readOnlySamples);
    const updateOnlySamples = (value: boolean) => { setOnlySamples(value); try { localStorage.setItem(ONLY_SAMPLES_KEY, String(value)); } catch { /* 存储不可用时仍保留本次选择。 */ } };
    const [sampleStatus, setSampleStatus] = useState<ArtistSampleStatus | null>(null);
    const [sampleCatalogs, setSampleCatalogs] = useState<Partial<Record<ArtistSamplePack, ArtistSampleCatalog>>>({});
    const [catalogErrors, setCatalogErrors] = useState<Partial<Record<ArtistSamplePack, string>>>({});
    const [sampleData, setSampleData] = useState<{ templates: Partial<Record<ArtistSamplePack, ArtistSampleTemplate>>; samples: ArtistOwnSample[] }>({ templates: {}, samples: [] });
    const [sampleDictionary, setSampleDictionary] = useState<ArtistDictionaryEntry[]>([]);
    const [sampleLoading, setSampleLoading] = useState(true);
    const [sampleError, setSampleError] = useState('');
    const [sampleRefresh, setSampleRefresh] = useState(0);
    const [sampleLimit, setSampleLimit] = useState(100);
    const getSampleStatusText = (pack: ArtistSamplePack) => {
      const currentPackStatus = sampleStatus?.packs.find(item => item.id === pack);
      const download = currentPackStatus?.download;
      const downloadPercent = download && download.totalBytes > 0 ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100)) : 0;
      return sampleError || catalogErrors[pack] || (sampleLoading && (!currentPackStatus || (currentPackStatus.phase === 'ready' && !sampleCatalogs[pack])) ? t('正在读取样张…')
        : download?.stage === 'downloading' ? t('图包下载中：{0}%', [downloadPercent])
        : download?.stage === 'verifying' ? t('正在校验图包…')
        : download?.stage === 'paused' ? t('图包下载已暂停：{0}%', [downloadPercent])
        : download?.stage === 'error' ? `${t('图包下载失败')}${download.error ? `：${download.error}` : ''}`
        : currentPackStatus?.phase === 'indexing' ? t('样张索引中：{0}%', [Math.round(currentPackStatus.progress)])
        : currentPackStatus?.phase === 'error' ? currentPackStatus.error || t('样张索引异常')
        : currentPackStatus?.phase === 'ready' ? t('已读取 {0} 个样张 Tag', [currentPackStatus.count])
        : t('该模型尚未配置样张图包'));
    };
    const currentPackStatus = sampleStatus?.packs.find(pack => pack.id === samplePack);
    const download = currentPackStatus?.download;
    const sampleStatusText = getSampleStatusText(samplePack);
    const currentSampleError = sampleError || catalogErrors[samplePack];
    const generatedSamples = getGeneratedArtistSamples();
    const samplesByPack = useMemo(() => {
        const forPack = (pack: ArtistSamplePack) => {
            const own = [...new Map([...sampleData.samples, ...generatedSamples].filter(sample => sample.pack === pack).map(sample => [sample.id, sample])).values()].sort((left, right) => right.createdAt - left.createdAt);
            const packed = matchArtistSampleTags(sampleDictionary, sampleCatalogs[pack]?.tags || []);
            const ownArtists = matchArtistSampleTags(sampleDictionary, own.map(sample => sample.tag));
            return { own, packed, ownArtists, packedNames: new Set(packed.map(entry => entry.name)), ownNames: new Set(ownArtists.map(entry => entry.name)) };
        };
        return { v45: forPack('v45'), v5: forPack('v5') };
    }, [sampleData.samples, sampleDictionary, sampleCatalogs, generatedSamples]);
    const sampledArtists = useMemo(() => [...new Map([...samplesByPack[samplePack].packed, ...samplesByPack[samplePack].ownArtists].map(entry => [entry.name, entry])).values()], [samplesByPack, samplePack]);
    const imageDisplay = useMobileImageDisplayPreferences('artists');
    // 瀑布流（masonry 布局时）：封面按真实宽高比完整显示，最短列分配互相补齐。
    const [artistRatios, updateImageRatio] = useImageRatios();
    const frostedCaption = useGalleryFrostedCaption();
    const estimateArtistCardHeight = React.useCallback((artist: (typeof filteredArtists)[number], columnWidth: number) => {
      const ratio = artistRatios[`${cardPacks[artist.name] || samplePack}:${artist.name}`] || 2 / 3;
      const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
      return imageHeight + (frostedCaption ? 2 : 78);
    }, [artistRatios, frostedCaption, cardPacks, samplePack]);
    const renderArtistCard = (artist: (typeof filteredArtists)[number]) => {
                            const isSelected = !!cart.find(c => c.name === artist.name);
                            const effectivePack = cardPacks[artist.name] || samplePack;
                            const samples = samplesByPack[effectivePack];
                            const artistOwnSamples = samples.ownNames.has(artist.name) ? samples.own.filter(sample => normalizeArtistSampleTag(sample.tag) === normalizeArtistSampleTag(artist.name)) : [];
                            const ratioKey = `${effectivePack}:${artist.name}`;
                            const generation = getArtistSampleGeneration(artist.name, effectivePack);
                            const busy = artistSampleGenerationBusy(generation) || requestingTarget === ratioKey;

                            return (
                                <PressRevealSurface
                                    key={artist.name}
                                    data-gallery-work-id={artist.name}
                                    data-safe-mode-work="true"
                                    role="button"
                                    data-agent-action="select"
                                    aria-label={t("选择画师：{0}", [artist.name])}
                                    aria-pressed={isSelected}
                                    tabIndex={0}
                                    className={`mobile-gallery-item gallery-image-card gallery-card-visual group relative flex-col bg-white dark:bg-gray-800 rounded-lg overflow-hidden border transition-[filter,box-shadow,border-color] duration-150 cursor-pointer ${selectionFocusEnabled && cart.length > 0 && !isSelected ? 'brightness-[.7]' : ''} ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}
                                    onClick={() => toggleCart(artist.name)}
                                    onKeyDown={event => {
                                        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                                        event.preventDefault(); toggleCart(artist.name);
                                    }}
                                >
                                    <div className="mobile-gallery-frame md:aspect-[2/3] relative overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': artistRatios[ratioKey] ? `${Math.round(artistRatios[ratioKey] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                                        <ArtistSampleCover
                                            generation={generation}
                                            pending={busy}
                                            tag={artist.name}
                                            pack={effectivePack}
                                            onPackChange={pack => setCardPacks(previous => ({ ...previous, [artist.name]: pack }))}
                                            revision={sampleCatalogs[effectivePack]?.revision || ''}
                                            hasPackSample={samples.packedNames.has(artist.name)}
                                            sampleStatusText={onlySamples && !sampleCatalogs[effectivePack] ? getSampleStatusText(effectivePack) : undefined}
                                            ownSamples={artistOwnSamples}
                                            alt={artist.chinese || artist.name}
                                            onSupplement={() => supplementSample(artist.name, effectivePack)}
                                            onGenerate={() => supplementSample(artist.name, effectivePack, true)}
                                            imageClassName={imageDisplay.layout === 'masonry' ? 'h-full w-full object-contain' : undefined}
                                            notify={notify}
                                            onImageLoad={(width, height) => updateImageRatio(ratioKey, width, height)}
                                        />
                                        {isSelected && (
                                            <div className="absolute inset-0 border-4 border-indigo-500/80 pointer-events-none" />
                                        )}
                                    </div>
                                    <div className="gallery-card-caption p-2 md:p-3 bg-white dark:bg-gray-800 text-center border-t border-gray-100 dark:border-gray-700">
                                        <div data-safe-mode-title="true" title={artist.name} className={`text-xs md:text-sm font-bold truncate ${isSelected ? 'text-indigo-600' : 'text-gray-700 dark:text-gray-300'}`}>{isSelected && <Check aria-hidden="true" className="mr-1 inline h-3 w-3" strokeWidth={4} />}{favorites.has(artist.name) && <Heart aria-label={t('已收藏画师')} className="mr-1 inline h-3 w-3 fill-current text-rose-500" />}{artist.name}</div>
                                        {artist.chinese && <div data-safe-mode-title="true" className="mt-0.5 truncate text-micro text-gray-400" title={artist.chinese}>{artist.chinese}</div>}
                                        {typeof artist.postCount === 'number' && <div className="gallery-card-meta mt-0.5 text-micro font-mono text-gray-500" title={t("Danbooru 关联作品数")}>{t("作品 {0}", [artist.postCount.toLocaleString(getLanguage())])}</div>}
                                    </div>
                                    {(busy || generation?.error || generation?.phase === 'save_failed') && <div data-card-action="true" className="flex flex-wrap items-center justify-center gap-1 border-t border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                                        {busy && <span role="status" className="flex min-w-0 items-center gap-1"><LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />{t(generation?.session?.connectionError || (generation?.session?.awaiting ? '等待费用确认' : generation?.session?.state === 'paused' ? '任务已暂停' : generation?.phase === 'saving' ? '正在保存样张…' : '正在生成样张…'))}</span>}
                                        {generation?.error && <span role="alert" className="max-h-16 w-full overflow-y-auto break-words text-center text-red-600 dark:text-red-300">{t(generation.error)}</span>}
                                        {generation?.phase === 'save_failed' && <button type="button" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => void retryArtistSampleSave(artist.name, effectivePack)}>{t('重试保存样张')}</button>}
                                        {!busy && !artistOwnSamples.length && generation?.phase === 'failed' && generation.preview && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => supplementSample(artist.name, effectivePack)}>{t('补充样张')}</button>}
                                        {generation?.session?.awaiting && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => void manageGeneration(artist.name, effectivePack, 'approve')}>{t('确认费用')}</button>}
                                        {generation?.session?.state === 'paused' && <button type="button" data-agent-action="business" className="mobile-touch min-h-11 px-2 underline" onClick={() => void manageGeneration(artist.name, effectivePack, 'resume')}>{t('继续')}</button>}
                                        {generation?.session && <button type="button" className="mobile-touch min-h-11 px-2 underline" disabled={generation.session.stopped} onClick={() => stopGenerationSeriesSession(generation.session!)}>{t(generation.session.stopped ? '取消中…' : '取消')}</button>}
                                    </div>}
                                </PressRevealSurface>
                            )
    };

    const [searchTerm, setSearchTerm] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [focusedName, setFocusedName] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [showFavOnly, setShowFavOnly] = useState(false);
    const [usePrefix, setUsePrefix] = useState(true);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const active = useContext(ImageActivityContext);
    const activeRef = useRef(active); activeRef.current = active;
    useEffect(() => { activeRef.current = active; return () => { activeRef.current = false; }; }, [active]);
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
            setSampleStatus(status); setSampleData(data); setSampleDictionary(dictionary);
            // 当前包尚未配置、也没有任何自建样张时先展示完整目录；下载／索引进行中仍保留样张视图和真实进度。
            if (localStorage.getItem(ONLY_SAMPLES_KEY) === null && data.samples.length === 0 && status.packs.every(pack => pack.phase === 'unconfigured' && (!pack.download || pack.download.stage === 'missing'))) setOnlySamples(false);
            // 新状态确认失效时立即清掉旧目录；两包独立就绪，不让另一包失败阻塞当前卡片。
            setSampleCatalogs(previous => Object.fromEntries(Object.entries(previous).filter(([id, catalog]) => status.packs.some(pack => pack.id === id && pack.phase === 'ready' && pack.revision === catalog.revision))));
            await Promise.all(SAMPLE_PACKS.map(async pack => {
                if (status.packs.find(item => item.id === pack)?.phase !== 'ready') return;
                try {
                    const catalog = await getArtistSampleCatalog(pack);
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
    const generateSample = async (tag: string, pack: ArtistSamplePack, template: ArtistSampleTemplate, regenerate = false) => {
        if (requesting.current || artistSampleGenerationBusy(getArtistSampleGeneration(tag, pack))) return;
        const key = readArtistSampleApiKey();
        if (!key) { notify(t('请先在“全局设置”中配置 NovelAI API Key'), 'error'); return; }
        requesting.current = true; setRequestingTarget(pack + ':' + tag);
        const snapshot = structuredClone(template);
        try {
            void subscription.refreshIfStale();
            const cost = estimateV45GenerationCost(snapshot.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true);
            if (cost > 0 && !await confirm({ rememberKey: 'artist-sample.generate', rememberScope: confirmationCostScope(key, cost, 1, budget.remaining, snapshot.params.model), title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片', message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [1, cost, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [cost]), ...(cost > budget.remaining ? { tone: 'danger' as const } : {}) })) return;
            if (!activeRef.current) return;
            if (readArtistSampleApiKey() !== key) throw new Error('NovelAI Key 已变化，请重新发起生成');
            // 任务在服务中观察完成，页面卸载不会丢失入库核对；这里只放开确认互斥。
            void beginArtistSampleGeneration(tag, pack, snapshot, key, cost, true, regenerate, () => activeRef.current).catch(error => notify((error as Error).message, 'error'));
        } catch (error) { notify((error as Error).message, 'error'); }
        finally { requesting.current = false; setRequestingTarget(''); }
    };
    const supplementSample = (tag: string, pack: ArtistSamplePack, regenerate = false) => {
        const template = sampleData.templates[pack];
        if (!template) { setSampleSettings({ tag, pack, generateAfterSave: true, regenerate }); return; }
        void generateSample(tag, pack, template, regenerate);
    };
    const manageGeneration = async (tag: string, pack: ArtistSamplePack, action: 'approve' | 'resume') => {
        const session = getArtistSampleGeneration(tag, pack)?.session;
        if (!session || !activeRef.current) return;
        try {
            if (readArtistSampleApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
            if (action === 'resume') { await setGenerationQueuePaused(session.key, false); return; }
            const cost = session.awaiting?.cost;
            if (cost === undefined) return;
            if (!await confirm({ rememberKey: 'artist-sample.cost-increase', rememberScope: confirmationCostScope(session.key, cost, 1, budget.remaining), title: '后台任务费用已变化', message: t('本轮剩余 {0} 张，当前每张预计 {1} Anlas，共 {2} Anlas。本地剩余预算：{3}。', [1, cost, cost, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [cost]), tone: 'danger' })) { stopGenerationSeriesSession(session); return; }
            if (readArtistSampleApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
            if (!activeRef.current) return;
            await approveGenerationSeries(session, cost);
        } catch (error) { notify((error as Error).message, 'error'); }
    };
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
    const [artistSort, setArtistSort] = useState<ArtistDictionarySort>(() => {
        const saved = localStorage.getItem('nai_artist_sort');
        return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' ? saved : 'popular';
    });
    const resultKey = JSON.stringify([searchTerm, onlySamples, showFavOnly, artistSort, samplePack]);
    const onScrollRestore = useKeepAliveScrollRestore(scrollContainerRef, 'library', { skipRestore: selectionAnchor.hasAnchor, resetKey: resultKey, onReset: selectionAnchor.clearAnchor });
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
        setCatalogError('');
        setLoadMoreError('');
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
    }, [artistSort, catalogRetry]);

    useEffect(() => {
        const query = onlySamples || showFavOnly ? '' : searchTerm.trim();
        const requestId = ++catalogSearchRequestRef.current;
        if (!query) {
            setCatalogSearchResults([]);
            setSearchError('');
            // 清空搜索词时必须复位 loading：在途请求的 finally 会被上面递增的代际守卫拦下，不复位就永久转圈
            setIsCatalogLoading(false);
            return;
        }

        setIsCatalogLoading(true);
        setSearchError('');
        const timer = window.setTimeout(() => {
            searchArtistDictionary(query, SEARCH_RESULT_LIMIT + 1, artistSort)
                .then(results => {
                    if (requestId === catalogSearchRequestRef.current) setCatalogSearchResults(results);
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
    }, [artistSort, searchTerm, onlySamples, showFavOnly, searchRetry]);

    const hasMoreSamples = (showFavOnly ? sampledArtists.filter(entry => favorites.has(entry.name)).length : sampledArtists.length) > sampleLimit;
    const hasMoreVisible = onlySamples ? hasMoreSamples : !showFavOnly && hasMoreCatalog;
    const loadMore = () => { if (onlySamples) setSampleLimit(current => current + 100); else void loadNextCatalogPage(); };
    useGalleryLoadMore(scrollContainerRef, catalogSentinelRef, !searchTerm.trim() && !gachaArtists && hasMoreVisible && !loadMoreError, loadMore, '800px 0px');

    useEffect(() => {
        const sync = () => setFavorites(new Set(collectionSnapshot()
            .filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId)
            .map(item => item.sourceId!)));
        sync(); return subscribeCollection(sync);
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
        const query = normalizeArtistSearch(searchTerm);
        if (onlySamples) return (gachaArtists || sampledArtists)
            .filter(entry => (!showFavOnly || favorites.has(entry.name)) && (!query || normalizeArtistSearch(entry.name).includes(query) || normalizeArtistSearch(entry.chinese || '').includes(query)))
            .slice().sort((left, right) => compareLibraryTags(left, right, artistSort))
            .slice(0, gachaArtists ? gachaArtists.length : searchTerm.trim() ? SEARCH_RESULT_LIMIT + 1 : sampleLimit);
        // 收藏只筛选真实词库，全目录已读取，不从旧收藏快照补造条目或受已展示分页限制。
        if (showFavOnly) return sampleDictionary.slice().sort((left, right) => compareLibraryTags(left, right, artistSort));
        return searchTerm.trim() ? catalogSearchResults : (gachaArtists || loadedCatalogArtists);
    }, [catalogSearchResults, gachaArtists, loadedCatalogArtists, searchTerm, onlySamples, sampledArtists, sampleDictionary, artistSort, showFavOnly, favorites, sampleLimit]);

    const matchedArtists = useMemo(() => availableArtists.filter(artist => {
        if (showFavOnly && !favorites.has(artist.name)) return false;
        const query = normalizeArtistSearch(searchTerm);
        return !query || normalizeArtistSearch(artist.name).includes(query) || normalizeArtistSearch(artist.chinese || '').includes(query);
    }), [availableArtists, showFavOnly, favorites, searchTerm]);
    // 目录搜索与样张搜索都只取前 201 条，足以判断是否还有更多；展示上限保持 200。
    const filteredArtists = useMemo(() => searchTerm.trim() ? matchedArtists.slice(0, SEARCH_RESULT_LIMIT) : matchedArtists, [matchedArtists, searchTerm]);
    const searchTruncated = searchTerm.trim() !== '' && matchedArtists.length > filteredArtists.length;

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
        const pool = sampledArtists.slice().sort((left, right) => compareLibraryTags(left, right, 'popular'));
        const total = pool.length;
        if (total <= 0 || isGachaLoading) return;
        if (!gachaArtists) catalogScrollTopRef.current = scrollContainerRef.current?.scrollTop || 0;

        const generation = ++gachaGenerationRef.current;
        setFocusedName(null);
        setIsGachaLoading(true);
        setSearchTerm('');
        setShowFavOnly(false);
        localStorage.setItem('nai_artist_gacha_mode', gachaMode);
        localStorage.setItem('nai_artist_gacha_count', String(gachaCount));

        try {
            const recentIndices = new Set(recentGachaIndicesRef.current.flat());
            const selectedIndices = new Set<number>();
            const targetCount = Math.min(gachaCount, total);
            let attempts = 0;
            while (selectedIndices.size < targetCount && attempts < 10_000) {
                attempts += 1;
                const index = drawGachaIndex(gachaMode, total);
                if (!recentIndices.has(index)) selectedIndices.add(index);
            }
            for (let index = 0; selectedIndices.size < targetCount && index < total; index++) {
                selectedIndices.add(index);
            }

            const indices = [...selectedIndices];
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

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">

            {/* --- Controls Header --- */}
            <WorkspaceToolbar>
                <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div role="group" aria-label={t('画师样张模型')} className="flex flex-none items-center rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-950">
                    <span className="hidden px-1.5 text-micro font-semibold text-gray-500 dark:text-gray-400 sm:inline">{t('样张')}</span>
                    {(['v45', 'v5'] as const).map(pack => <button type="button" key={pack} aria-pressed={samplePack === pack} onClick={() => { setCardPacks({}); if (pack === samplePack) return; setSamplePack(pack); localStorage.setItem('nai_artist_sample_pack', pack); recentGachaIndicesRef.current = []; leaveGacha(true); }} className={`mobile-touch rounded-lg px-2 py-1.5 text-xs font-bold ${samplePack === pack ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>{pack === 'v45' ? 'V4.5' : 'V5'}</button>)}
                </div>
                <div className="relative min-w-[140px] flex-1">
                    <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); leaveGacha(); }} placeholder={t("搜索画师名称或 Tag")} containerClassName="md:max-w-none!" className="pr-9" />
                    {isCatalogLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
                </div>
                <ToolbarPopover title={t("筛选画师")} count={Number(artistSort !== 'popular') + Number(showFavOnly) + Number(!onlySamples)}>
                    <div className="space-y-3">
                        <p role="status" className={`text-xs ${currentSampleError || download?.stage === 'error' || currentPackStatus?.phase === 'error' ? 'text-red-500' : 'text-gray-500'}`}>{sampleStatusText}</p>
                        <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={onlySamples} onChange={event => { updateOnlySamples(event.target.checked); leaveGacha(); }} />{t('只看有样张')}</label>
                        <label className="block text-sm font-semibold dark:text-white">{t("排序")}<select aria-label={t("画师排序")} value={artistSort} onChange={event => { setArtistSort(event.target.value as ArtistDictionarySort); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}>
                            <option value="popular">{searchTerm.trim() ? t("相关性优先 · 热度高") : t("热度从高到低")}</option><option value="least">{searchTerm.trim() ? t("相关性优先 · 热度低") : t("热度从低到高")}</option><option value="name-asc">{t("名称 A → Z")}</option><option value="name-desc">{t("名称 Z → A")}</option>
                        </select></label>
                        <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={showFavOnly} onChange={event => { setShowFavOnly(event.target.checked); leaveGacha(); }} />{t("只看收藏画师")}</label>
                        <button type="button" onClick={() => { setArtistSort('popular'); setShowFavOnly(false); updateOnlySamples(true); leaveGacha(); }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">{t("重置筛选")}</button>
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
                        </div><div className="border-t border-gray-200 pt-3 dark:border-gray-700"><p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('补图生成设置')}</p><div className="grid grid-cols-2 gap-2">{SAMPLE_PACKS.map(pack => <button key={pack} type="button" aria-label={t('{0} 补图生成设置', [pack === 'v45' ? 'V4.5' : 'V5'])} onClick={() => openTemplateSettings(pack, close)} className="mobile-touch min-h-11 rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-indigo-500 dark:hover:text-indigo-300">{pack === 'v45' ? 'V4.5' : 'V5'}</button>)}</div></div></div>}
                    </ToolbarPopover>
                </div>
                </div>
            </WorkspaceToolbar>

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
            <div ref={scrollContainerRef} onScroll={() => { selectionAnchor.onScroll(); onScrollRestore(); }} className="flex-1 overflow-y-auto p-4 md:p-6 pb-40 bg-gray-50 dark:bg-gray-900 scroll-smooth relative">
                {showFavOnly && !filteredArtists.length && !isCatalogLoading && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    <p>{t('还没有收藏画师')}</p>
                    <p className="mt-1 text-xs">{t('收藏画师样张后，这里会按画师汇总。')}</p>
                    <button type="button" className="mobile-touch mt-3 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setShowFavOnly(false)}>{t('关闭只看收藏')}</button>
                    {onlySamples && <button type="button" className="mobile-touch mt-3 ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('浏览全部画师')}</button>}
                </div>}
                {!showFavOnly && onlySamples && !filteredArtists.length && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    {!currentSampleError && !sampleLoading && currentPackStatus?.phase === 'ready' && (!download || ['missing', 'ready'].includes(download.stage)) ? t('没有匹配的画师样张') : sampleStatusText}
                    {currentSampleError && <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setSampleRefresh(current => current + 1)}>{t('重试')}</button>}
                    {searchTerm.trim() && <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('在全部画师中搜索')}</button>}
                    {!searchTerm.trim() && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button type="button" className="mobile-touch rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={openSampleSettings}>{t('下载样张图包')}</button>
                        <button type="button" className="mobile-touch rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => updateOnlySamples(false)}>{t('浏览全部画师')}</button>
                    </div>}
                </div>}
                {!showFavOnly && !onlySamples && !filteredArtists.length && !isCatalogLoading && <div role="status" className="py-12 text-center text-sm text-gray-400">
                    {searchError || catalogError ? <>
                        {searchError || catalogError}
                        <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => searchError ? setSearchRetry(current => current + 1) : setCatalogRetry(current => current + 1)}>{t('重试')}</button>
                    </> : searchTerm.trim() ? <>
                        {t('没有匹配的画师')}
                        <button type="button" className="mobile-touch ml-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" onClick={() => setSearchTerm('')}>{t('清除搜索')}</button>
                    </> : t('画师目录不可用，请在全局设置更新 Tag 词库。')}
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

                {!searchTerm.trim() && !gachaArtists && (
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

            {sampleSettings && <ArtistSampleSettingsDialog key={sampleSettings.pack + ':' + sampleSettings.tag} {...sampleSettings} onClose={() => setSampleSettings(null)} onSaved={template => {
                setSampleData(current => ({ ...current, templates: { ...current.templates, [sampleSettings.pack]: template } }));
                const target = sampleSettings;
                flushSync(() => setSampleSettings(null));
                if (target.generateAfterSave) void generateSample(target.tag, target.pack, template, target.regenerate);
            }} />}

            <TagSelectionBar count={cart.length} unit={t("位画师")} onClear={() => setCart([])} onCopy={copyCart} onImport={onNavigateToPlayground ? importCartToPlayground : undefined} onSendToRoll={onOpenRoll ? () => { const tags = cart.map(item => item.name); setCart([]); onOpenRoll(tags); } : undefined} />

        </div>
    );
};
