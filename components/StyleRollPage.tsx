import { confirmationCostScope } from '../services/dailyConfirmation';
import { flushSync } from 'react-dom';
import { copyTagText } from '../services/externalImageTags';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Ban, ChevronLeft, ChevronRight, Copy, CopyPlus, Folder, Heart, Layers, Dice5, FlaskConical, ImagePlus, ListChecks, LoaderCircle, Pin, Plus, RefreshCw, RotateCcw, Save, Settings2, Trash2, X } from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../types';
import { MobileBottomSheet, MobileOverflowMenu } from './MobileUI';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { formatGenerationDuration, readGenerationDurationMs } from '../services/generationDuration';
import { createDefaultRollTemplate, DEFAULT_ROLL_RULES, formatRollStyle, getRollArtistRange, getRollPinnedArtists, removeRollCandidates, ROLL_MAX_ARTISTS, rollCandidateToChain, rollExperimentSummary, rollRoundSourceChainIds, rollSourceId, type RollChainArtistSource, type RollCandidate, type RollExperiment, type RollExperimentSummary, type RollRules } from '../services/styleRoll';
import { beginRollRound, currentRollRound } from '../services/styleRollWorkflow';
import { getRollSeries, nextRollSeriesStep, ROLL_SERIES_STOP_LABELS, rollSeriesWouldOverflow, startRollSeries, stopRollSeries, type RollSeriesStopReason } from '../services/styleRollSeries';
import { buildRollChainArtistSource } from '../services/styleRollChainArtists';
import { rollFavoriteMatches, rollPendingCandidates, rollWorkspaceCandidates } from '../services/styleRollWorkspace';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleLibrary, normalizeArtistSampleTag } from '../services/artistSamples';
import { loadArtistSampleUrls } from '../services/artistSampleUrls';
import { getSampledArtistTags } from '../services/artistSampleDrafts';
import type { ArtistDictionaryEntry } from '../services/tagDictionary';
import { loadRollBlocklist, loadRollExperiment, loadRollExperiments, loadRollHistory, ROLL_BLOCKLIST_CHANGED, rollCandidateImages, saveRollBlocklist, saveRollExperiment, deleteRollExperiment } from '../services/styleRollApi';
import { normalizeRollArtistKey } from '../services/styleRollSeed';
import { beginRollGeneration, readRollApiKey } from '../services/styleRollGeneration';
import { api, notifyLanAccessRequired, parseErrorResponse } from '../services/api';
import { parseHttpError } from '../services/httpErrors.mjs';
import { applyEstimatorRuntime, estimateV45GenerationCost, formatGenerationCostLabel, useAnlasBudget } from '../services/anlasBudget';
import { getPoolMaxOpusPercent, prepareGenerationWithPool, reportPoolKeyCooldown, useNaiKeyPool } from '../services/naiKeyPool';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { approveGenerationSeries, getGenerationSeriesSession, restoreGenerationSeriesSessions, stopGenerationSeriesSession, subscribeGenerationSeries, type GenerationSeriesSession } from '../services/generationSeries';
import { getGenerationQueue, setGenerationInterval, setGenerationQueuePaused } from '../services/generationTask';
import { DEFAULT_GENERATION_INTERVAL_JITTER_PERCENT, DEFAULT_GENERATION_INTERVAL_SECONDS, validateGenerationInterval, validateGenerationIntervalJitter } from '../worker/generationTasks.mjs';
import { localHistory } from '../services/localHistory';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { createUuid } from '../services/id';
import { useAlertDialog, useConfirmDialog } from './ConfirmDialog';
import { useNaiChannelMode } from '../services/naiChannel';
import { useAgentCommand } from '../services/agentCommands';
import { EmptyState, IconButton, PageSpinner, ToolbarButton, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { ToolbarCountBadge } from './ToolbarCountBadge';
import { SmartImage } from './SmartImage';
import { ImageLightbox } from './ImageLightbox';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageShareActions } from './ImageShareActions';
import { ImageCardActions } from './ImageCardActions';
import { PressRevealSurface } from './PressRevealSurface';
import { MobileDetailView } from './MobileUI';
import { StyleRollSetup } from './roll/StyleRollSetup';
import { normalizeArtistUsageKey } from '../services/artistParticipation';
import { StyleRollChainArtistDialog } from './roll/StyleRollChainArtistDialog';
import { StyleRollArtistDialog } from './roll/StyleRollArtistDialog';
import { StyleRollRuleFields } from './roll/StyleRollRuleFields';
import { clearArtistPreference, collectionRevision, collectionSnapshot, collectionTargetActive, ensureCollection, subscribeCollection, toggleArtistPreference } from '../services/collectionFavorites';
import { StyleRollGallery } from './roll/StyleRollGallery';
import { RollRecordNavigation } from './roll/RollRecordNavigation';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';

interface Props {
  active: boolean; chains: PromptChain[]; enforceFreeStepLimit: boolean; generationStreamPreview: boolean; selectionFocusEnabled?: boolean;
  /** 与实验室共用的全局「强制清空种子」：打开后 Roll 的生成配置也按随机种子提交。 */
  forceEmptySeed?: boolean;
  onForceEmptySeedChange?: (enabled: boolean) => void;
  continuousGenerationEnabled?: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
  onSaveChain: (chain: PromptChain) => Promise<PromptChain>;
  onOpenChain: (id: string) => void;
  onNavigateToPlayground: () => void;
  onOpenArtistLibrary?: (name?: string) => void;
  initialPinned?: { tags: string[]; token: number } | null;
}
const ROLL_FILTER_LABELS = { all: '全部', unsaved: '已出图但未保存', saved: '已保存', pending: '待生成', favorited: '已收藏' } as const;
/** 依赖已出图结果、候选会因保存或收藏离开当前结果的筛选：就绪前显示读取状态，离开时详情衔接下一项。 */
const ROLL_TRIAGE_FILTERS: readonly string[] = ['unsaved', 'favorited'];
/** 画师库带入的固定画师只消费一次；页面被保活淘汰后重建也不重复建记录。 */
const artistCountLabel = (rules: RollRules) => rules.minArtists === rules.maxArtists ? String(rules.maxArtists) : `${rules.minArtists}–${rules.maxArtists}`;
const consumedPinnedTokens = new Set<number>();
/** 一次出图的结果：连续 Roll 据此决定进入下一轮还是停下。 */
type RollGenerateOutcome = { ok: true } | { ok: false; reason: 'skipped' | 'error' | 'cancelled' | 'declined' | 'record_full' | 'opus_limit'; error?: string };

/** 候选里的画师收藏按钮：收藏的就是画师库里的同一条记录（收藏库 sourceType='artist'）。 */
const ArtistFavoriteButton: React.FC<{ tag: string; sampleUrl?: string }> = ({ tag, sampleUrl }) => {
  useLanguage();
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const sync = () => setFavorite(collectionSnapshot().some(item => item.sourceType === 'artist' && !item.archived && item.sourceId && normalizeRollArtistKey(item.sourceId) === normalizeRollArtistKey(tag)));
  useEffect(() => {
    ensureCollection().then(sync).catch(() => undefined);
    return subscribeCollection(sync);
  }, [tag]);
  return <button type="button" aria-label={t(favorite ? '取消收藏画师 {0}' : '收藏画师 {0}', [tag])} title={t(favorite ? '取消收藏画师 {0}' : '收藏画师 {0}', [tag])} aria-pressed={favorite} disabled={busy}
    onClick={async () => {
      if (busy) return;
      setBusy(true);
      // 无样张只收藏 Tag，空封面与画师库一致，不写入假图片地址。
      try { setFavorite(await toggleArtistPreference(tag, sampleUrl || '')); }
      catch { /* 收藏失败保持原状，不打断候选浏览 */ }
      finally { setBusy(false); }
    }}
    className={`mobile-touch flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-50 ${favorite ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-400' : 'text-gray-400 hover:bg-gray-100 hover:text-rose-400 dark:text-gray-500 dark:hover:bg-gray-800'}`}>
    <Heart aria-hidden="true" className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
  </button>;
};

export const StyleRollPage: React.FC<Props> = ({ active, chains, enforceFreeStepLimit, generationStreamPreview, forceEmptySeed = false, onForceEmptySeedChange, selectionFocusEnabled = true, continuousGenerationEnabled = true, notify, onSaveChain, onOpenChain, onNavigateToPlayground, onOpenArtistLibrary, initialPinned }) => {
  useLanguage();
  const confirm = useConfirmDialog();
  const alertDialog = useAlertDialog();
  const perUseNaiChannel = useNaiChannelMode() === 'per-use';
  const runtime = useNaiRuntime(); applyEstimatorRuntime(runtime);
  const subscription = useNovelaiUsage(), budget = useAnlasBudget();
  // 列表只保存摘要；当前记录完整加载后放进 experiment，避免每次进页面搬运全部候选与轮次。
  const [experiments, setExperiments] = useState<RollExperimentSummary[]>([]), [experimentId, setExperimentId] = useState('');
  const [experiment, setExperiment] = useState<RollExperiment | undefined>(), [detailId, setDetailId] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setErrorState] = useState('');
  // 生成失败不占用顶部横幅：Roll 常驻小框承担出图过程、结果与失败回执。
  const [generationError, setGenerationError] = useState<{ experimentId: string; message: string; tone: 'error' | 'warning' } | null>(null);
  const setError = useCallback((message: string, source: 'request' | 'generation' = 'request') => {
    // 带换行的消息是「汇总 + 逐条失败详情」，不再按单条 HTTP 错误解析。
    const text = message ? (message.includes('\n') ? message : parseHttpError(message).message) : '';
    if (source === 'generation') setGenerationError(text ? { experimentId, message: text, tone: 'error' } : null);
    else setErrorState(text);
  }, [experimentId]);
  // 请求错误不再顶成一条横幅：交给一次性弹窗，关掉即结束。
  useEffect(() => {
    if (!error) return;
    setErrorState('');
    alertDialog(error);
  }, [error, alertDialog]);
  const [library, setLibrary] = useState<string[]>([]), [libraryLoading, setLibraryLoading] = useState(true), [libraryError, setLibraryError] = useState('');
  const [libraryEntries, setLibraryEntries] = useState<ArtistDictionaryEntry[]>([]);
  const [sampleUrls, setSampleUrls] = useState<Map<string, string>>(new Map());
  const [history, setHistory] = useState<LocalGenItem[]>([]), [historyLoading, setHistoryLoading] = useState(false);
  const [historyReadyId, setHistoryReadyId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState('all'), [count, setCount] = useState(6);
  const [roundRules, setRoundRules] = useState<RollRules>({ ...DEFAULT_ROLL_RULES });
  const [artistDialogOpen, setArtistDialogOpen] = useState(false);
  const [chainTarget, setChainTarget] = useState<string | null>(null);
  const knownArtists = useMemo(() => new Set(libraryEntries.map(artist => normalizeArtistUsageKey(artist.name))), [libraryEntries]);
  useEffect(() => { setChainTarget(null); }, [active, experimentId]);
  const [artistOverrides, setArtistOverrides] = useState<RollExperiment['artists']>([]);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('new'), [roundId, setRoundId] = useState('');
  const [selecting, setSelecting] = useState(false), [selectedIds, setSelectedIds] = useState(new Set<string>());
  // 画风记录：桌面用可折叠左栏（与其他资料页同构），手机用底部面板承载同一份列表。
  const [recordsExpanded, setRecordsExpanded] = useState(() => { try { return localStorage.getItem('nai-roll-records-expanded') === 'true'; } catch { return false; } });
  const [mobileRecordMenuOpen, setMobileRecordMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleRecords = () => setRecordsExpanded(current => {
    const next = !current;
    try { localStorage.setItem('nai-roll-records-expanded', String(next)); } catch { /* 本端偏好不可写时仍可展开。 */ }
    return next;
  });
  const currentRecordName = experiment?.name || experiments.find(item => item.id === experimentId)?.name || '';
  const [savingProgress, setSavingProgress] = useState<{ completed: number; total: number } | null>(null);
  const [saveFailures, setSaveFailures] = useState<{ experimentId: string; ids: string[]; unprocessed: number; needsReload: boolean; messages: string[] } | null>(null);
  const [setup, setSetup] = useState<RollExperiment | null>(null), [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
  useEffect(() => { if (setup) setChainTarget(null); }, [setup]);
  const [session, setSession] = useState<GenerationSeriesSession | null>(null), [preparing, setPreparing] = useState(false);
  // 生成间隔与随机浮动画按 Key 保存，和实验室生成条共用同一份队列偏好。
  const [queueInterval, setQueueInterval] = useState<{ seconds: number; jitterPercent: number } | null>(null);
  const [intervalPending, setIntervalPending] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(DEFAULT_GENERATION_INTERVAL_SECONDS.toFixed(1));
  const [pinnedArtists, setPinnedArtists] = useState<string[]>([]);
  const [chainArtistSource, setChainArtistSource] = useState<RollChainArtistSource | undefined>();
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [sampledOnly, setSampledOnly] = useState(false);
  const [sampledTags, setSampledTags] = useState<Set<string> | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const busyRef = useRef(false), generatingRef = useRef(false), selectedExperimentRef = useRef(experimentId), historySequence = useRef(0);
  const loadingRef = useRef(true), loadSequence = useRef(0), detailSequence = useRef(0);
  const librarySequence = useRef(0);
  const savedChains = useRef(new Map<string, PromptChain>()), mounted = useRef(true);
  const savedCovers = useRef(new Map<string, string>());
  const saveView = JSON.stringify([active, experimentId, filter, roundId, query, sort, selecting]);
  const saveViewRef = useRef(saveView); saveViewRef.current = saveView;
  const sampleLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectionAnchor = useGallerySelectionAnchor(scrollRef, scrollRef, selectedId || null, active, selectionFocusEnabled);
  const rememberScroll = useKeepAliveScrollRestore(scrollRef, `roll:${experimentId}:${filter}`, {
    skipRestore: selectionAnchor.hasAnchor,
    resetKey: `${filter}|${query}|${sort}|${roundId}`,
    onReset: selectionAnchor.clearAnchor,
  });
  selectedExperimentRef.current = experimentId;
  const excludedArtistTags = useMemo(() => artistOverrides.filter(artist => artist.excluded).map(artist => artist.tag), [artistOverrides]);
  const effectiveLibrary = useMemo(() => {
    const source = chainArtistSource?.artists.map(artist => artist.tag) ?? library;
    const keyOf = chainArtistSource ? normalizeArtistUsageKey : normalizeArtistSampleTag;
    const available = chainArtistSource && sampledTags ? new Set([...sampledTags].map(keyOf)) : sampledTags;
    return available ? source.filter(tag => available.has(keyOf(tag))) : source;
  }, [chainArtistSource, library, sampledTags]);
  const chineseNames = useMemo(() => new Map(libraryEntries.map(entry => [normalizeArtistSampleTag(entry.name), entry.chinese || ''])), [libraryEntries]);
  const roundNumbers = useMemo(() => {
    const map = new Map<string, number>();
    experiment?.rounds.forEach((item, index) => item.candidateIds.forEach(id => map.set(id, index + 1)));
    return map;
  }, [experiment]);
  const selected = experiment?.candidates.find(item => item.id === selectedId);
  const images = useMemo(() => experiment ? rollCandidateImages(experiment, history) : new Map<string, LocalGenItem>(), [experiment, history]);
  // 与卡片爱心共用收藏库判定，收藏或取消后筛选与多选即时跟随。
  const collectionVersion = useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);
  const [collectionSettled, setCollectionSettled] = useState(false);
  const [collectionFailed, setCollectionFailed] = useState(false);
  const loadFavorites = useCallback(async () => {
    setCollectionSettled(false); setCollectionFailed(false);
    try { await ensureCollection(); if (mounted.current) setCollectionSettled(true); }
    catch { if (mounted.current) setCollectionFailed(true); }
  }, []);
  useEffect(() => { if (active) void loadFavorites(); }, [active, loadFavorites]);
  const favoriteIds = useMemo(() => new Set([...images].filter(([, item]) => collectionTargetActive({ imageUrl: item.imageUrl, sourceType: 'history', sourceId: item.id })).map(([id]) => id)), [images, collectionVersion]);
  const round = experiment && currentRollRound(experiment);
  // 本批排序：未出图卡片在自己的按钮/状态里标出「本批第 n/总数 张」。
  const roundPositions = useMemo(() => {
    const map = new Map<string, { index: number; total: number }>();
    if (!round) return map;
    round.candidateIds.forEach((id, index) => map.set(id, { index: index + 1, total: round.candidateIds.length }));
    return map;
  }, [round]);
  const selectedImage = selected && images.get(selected.id);
  const historyReady = Boolean(experiment && historyReadyId === experiment.id);
  const filterReady = filter === 'favorited' ? historyReady && collectionSettled : filter === 'pending' || filter === 'unsaved' ? historyReady : true;
  const cost = experiment ? estimateV45GenerationCost(experiment.template.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true) : 0;
  const costLabel = !subscription.info ? t(subscription.loading ? '费用确认中…' : '费用未知') : t(formatGenerationCostLabel(cost, experiment?.template.params.model));
  const visible = useMemo(() => experiment ? rollWorkspaceCandidates(experiment, images, { filter, roundId, query, sort }, chineseNames, favoriteIds) : [], [experiment, images, filter, roundId, query, sort, chineseNames, favoriteIds]);
  const chosen = visible.filter(candidate => selectedIds.has(candidate.id));
  const visibleFavorited = historyReady && collectionSettled ? visible.filter(candidate => rollFavoriteMatches(candidate, images, favoriteIds, true)) : [];
  const visibleUnfavorited = historyReady && collectionSettled ? visible.filter(candidate => rollFavoriteMatches(candidate, images, favoriteIds, false)) : [];
  useEffect(() => { if (!busy) setSelectedIds(current => { const next = new Set([...current].filter(id => visible.some(candidate => candidate.id === id))); return next.size === current.size ? current : next; }); }, [visible, busy]);
  const previousVisible = useRef<string[]>([]);
  useEffect(() => {
    if (selectedId && !visible.some(candidate => candidate.id === selectedId)) {
      const previous = previousVisible.current, index = previous.indexOf(selectedId), available = new Set(visible.map(candidate => candidate.id));
      setSelectedId(ROLL_TRIAGE_FILTERS.includes(filter) && index >= 0 ? [...previous.slice(index + 1), ...previous.slice(0, index).reverse()].find(id => available.has(id)) || '' : '');
      selectionAnchor.clearAnchor();
    }
    previousVisible.current = visible.map(candidate => candidate.id);
  }, [visible, selectedId, filter]);
  useEffect(() => { setSaveFailures(null); setSavingProgress(null); }, [active, experimentId]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const changed = () => setIsMobile(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current; loadingRef.current = true;
    setLoading(true); setError('');
    try { const values = await loadRollExperiments(); if (!mounted.current || sequence !== loadSequence.current) return; setExperiments(values); setDetailId(''); setExperimentId(current => values.some(value => value.id === current && !value.archived) ? current : values.find(value => !value.archived)?.id || ''); }
    catch (cause) { if (mounted.current && sequence === loadSequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === loadSequence.current) { loadingRef.current = false; setLoading(false); } }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // 摘要选中后再读完整记录：列表不再搬运模板、候选与轮次，切记录只有这一条请求。
  useEffect(() => {
    if (!active) return;
    if (!experimentId) { setExperiment(undefined); setDetailId(''); setDetailLoading(false); return; }
    if (detailId === experimentId) return;
    const sequence = ++detailSequence.current;
    let stale = false;
    setDetailLoading(true); setExperiment(undefined);
    void loadRollExperiment(experimentId)
      .then(full => { if (!stale && mounted.current && sequence === detailSequence.current) { setExperiment(full); setDetailId(full.id); } })
      .catch(cause => { if (!stale && mounted.current && sequence === detailSequence.current) setError((cause as Error).message); })
      .finally(() => { if (!stale && mounted.current && sequence === detailSequence.current) setDetailLoading(false); });
    return () => { stale = true; };
  }, [active, experimentId, detailId, setError]);
  const reloadLibrary = useCallback(async () => {
    const sequence = ++librarySequence.current;
    setLibraryLoading(true); setLibraryError('');
    try {
      const artists = await getArtistSampleLibrary();
      if (!artists.length) throw new Error('画师词库为空，请在画师库中检查词库资源');
      if (mounted.current && sequence === librarySequence.current) { setLibrary(artists.map(artist => artist.name)); setLibraryEntries(artists); }
    }
    catch (cause) { if (mounted.current && sequence === librarySequence.current) setLibraryError((cause as Error).message); }
    finally { if (mounted.current && sequence === librarySequence.current) setLibraryLoading(false); }
  }, []);
  useEffect(() => { if (active) void reloadLibrary(); }, [active, reloadLibrary]);
  // 词库读取失败不再顶成一条常驻提示：弹一次窗，附带就地重新加载。
  const promptedLibraryError = useRef('');
  useEffect(() => {
    if (!libraryError || promptedLibraryError.current === libraryError) return;
    promptedLibraryError.current = libraryError;
    alertDialog(t(libraryError), { title: t('画师词库不可用'), action: { label: t('重新加载'), onClick: () => void reloadLibrary() } });
  }, [libraryError, alertDialog, reloadLibrary]);
  const refreshHistory = useCallback(async (id: string) => {
    const sequence = ++historySequence.current;
    if (!id) { setHistory([]); return; }
    setHistoryLoading(true); setHistoryReadyId('');
    try { const values = await loadRollHistory(id); if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) { setHistory(values); setHistoryReadyId(id); } }
    catch (cause) { if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === historySequence.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => { setHistory([]); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setRoundId(''); setQuery(''); setFilter('all'); }, [experimentId]);
  useEffect(() => { setRoundRules(experiment ? { ...experiment.rules, ...getRollArtistRange(experiment) } : { ...DEFAULT_ROLL_RULES }); }, [experimentId, experiment?.rules]);
  useEffect(() => { setArtistOverrides(experiment?.artists ?? []); }, [experimentId, experiment?.artists]);
  useEffect(() => { setPinnedArtists(experiment ? getRollPinnedArtists(experiment) : []); }, [experimentId, experiment?.pinnedArtists, experiment?.drawPlan, experiment?.artists]);
  useEffect(() => { setChainArtistSource(experiment?.chainArtistSource); }, [experimentId, experiment?.chainArtistSource]);
  useEffect(() => { setSampledOnly(experiment?.sampledOnly ?? false); }, [experimentId, experiment?.sampledOnly]);
  const [sampleRetry, setSampleRetry] = useState(0);
  useEffect(() => { const changed = () => { sampleLoaded.current = false; setSampledTags(null); setSampleRetry(value => value + 1); if (active) void reloadLibrary(); }; window.addEventListener(ARTIST_SAMPLES_CHANGED, changed); return () => window.removeEventListener(ARTIST_SAMPLES_CHANGED, changed); }, [active, reloadLibrary]);
  useEffect(() => { let current = true; if (active) void getSampledArtistTags().then(tags => { if (current) setSampledTags(tags); }).catch(() => { if (current) setSampledTags(new Set()); }); return () => { current = false; }; }, [active, sampleRetry]);
  useEffect(() => {
    let stale = false;
    const changed = (event: Event) => {
      stale = true;
      const tags = (event as CustomEvent<string[]>).detail, keys = new Set(tags.map(normalizeRollArtistKey));
      setBlocklist(tags); setPinnedArtists(current => current.filter(tag => !keys.has(normalizeRollArtistKey(tag))));
    };
    window.addEventListener(ROLL_BLOCKLIST_CHANGED, changed);
    if (active) void loadRollBlocklist().then(tags => { if (!stale) setBlocklist(tags); }).catch(() => {});
    return () => { stale = true; window.removeEventListener(ROLL_BLOCKLIST_CHANGED, changed); };
  }, [active]);
  useEffect(() => { if (active && experimentId) void refreshHistory(experimentId); }, [active, experimentId, refreshHistory]);
  useEffect(() => localHistory.subscribe(() => { if (selectedExperimentRef.current) void refreshHistory(selectedExperimentRef.current); }), [refreshHistory]);
  useEffect(() => {
    const update = () => {
      const found = experiments.map(item => getGenerationSeriesSession(rollSourceId(item.id))).find(Boolean);
      setSession(found ? { ...found } : null);
    };
    update(); return subscribeGenerationSeries(update);
  }, [experiments]);
  // 重新打开页面先接回可恢复会话：任务还在就恢复小框，服务已重启则留下中断记录。
  useEffect(() => { if (active) void restoreGenerationSeriesSessions(); }, [active]);

  const store = async (next: RollExperiment, options: { updateDetail?: boolean } = {}) => {
    const saved = await saveRollExperiment({ ...next, rules: { ...next.rules, ...getRollArtistRange(next) }, drawPlan: undefined, pinnedArtists: getRollPinnedArtists(next) });
    if (mounted.current) {
      if (options.updateDetail !== false) { setExperiment(saved); setDetailId(saved.id); setDetailLoading(false); }
      setExperiments(current => [rollExperimentSummary(saved), ...current.filter(item => item.id !== saved.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    }
    return saved;
  };
  // 生成失败回执同时落在候选卡占位区（就地重试）和一次性弹窗（不再占用顶部横幅）。
  const reportGeneration = useCallback((message: string, tone: 'error' | 'warning' = 'error') => {
    if (!mounted.current) return;
    const text = t(parseHttpError(message).message);
    setGenerationError({ experimentId: selectedExperimentRef.current, message: text, tone });
    // 连续 Roll 失败即停并汇总提示一次，不在无人值守时逐轮叠弹窗。
    if (!getRollSeries().running) alertDialog(text);
  }, [alertDialog]);
  const perform = async (action: () => Promise<void>, source: 'request' | 'generation' = 'request') => {
    if (busyRef.current || loadingRef.current) return;
    busyRef.current = true; setBusy(true);
    if (source === 'generation') setGenerationError(null); else setErrorState('');
    try { await action(); }
    catch (cause) {
      if (!mounted.current) return;
      // 一律用弹窗报错；生成过程失败同时落在候选卡占位区，方便就地重试。
      // 请求类错误交给 error 状态的 effect 弹窗，这里不重复弹。
      if (source === 'generation') reportGeneration((cause as Error).message);
      else setError((cause as Error).message);
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const updateBlocklist = async (tags: string[]) => { setBlocklist(await saveRollBlocklist(tags)); };
  const openFromSettings = (close: () => void, open: () => void) => {
    // 手机先退出设置的历史层，再打开画师／配置窗口，避免返回事件连带关闭新弹窗。
    const returned = window.history.state?.__naiMobileLayer?.startsWith('sheet-')
      ? new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true })) : null;
    flushSync(close);
    if (returned) void returned.then(() => { if (mounted.current) open(); }); else open();
  };
  const readPreferredTags = async () => {
    if (!roundRules.preferredOnly && (roundRules.preferredMultiplier ?? 1) === 1 && !roundRules.preferredMinArtists) return [];
    await ensureCollection();
    return collectionSnapshot().filter(item => item.sourceType === 'artist' && !item.archived && item.sourceId).map(item => item.sourceId!);
  };
  const makeExperiment = () => {
    const now = Date.now();
    const template = createDefaultRollTemplate(runtime);
    const next: RollExperiment = {
      version: 1, id: createUuid(), name: t('画风记录 {0}', [experiments.length + 1]), revision: 0, createdAt: now, updatedAt: now,
      artists: structuredClone(artistOverrides), rules: roundRules, sampledOnly, chainArtistSource,
      template,
      candidates: [], rounds: [], pinnedArtists: [...pinnedArtists],
    };
    return next;
  };
  // 详情首次打开时读取画师样张；没有样张时保持文字标签，不阻塞候选浏览。
  useEffect(() => {
    if (!active || !selectedId || sampleLoaded.current) return;
    let current = true;
    void loadArtistSampleUrls().then(urls => {
      if (current && mounted.current) { sampleLoaded.current = true; setSampleUrls(urls); }
    }).catch(() => {});
    return () => { current = false; };
  }, [active, selectedId, sampleRetry]);
  // 画师库「在 Roll 中固定」：新建记录并预置固定画师，不覆盖当前记录。
  useEffect(() => {
    if (!initialPinned || consumedPinnedTokens.has(initialPinned.token)) return;
    consumedPinnedTokens.add(initialPinned.token);
    void (async () => {
      try {
        const draft = makeExperiment();
        const tags = initialPinned.tags.slice(0, ROLL_MAX_ARTISTS);
        draft.name = t('固定画师组 {0} 位', [tags.length]);
        draft.pinnedArtists = tags;
        const size = Math.min(ROLL_MAX_ARTISTS, Math.max(1, tags.length));
        draft.rules = { ...draft.rules, minArtists: size, maxArtists: size, preferredMinArtists: 0 };
        const saved = await store(draft);
        selectedExperimentRef.current = saved.id;
        setExperimentId(saved.id); setPinnedArtists(tags);
        setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId('');
        notify(t('已新建画风记录并固定 {0} 位画师', [tags.length]), 'success');
      } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPinned?.token]);
  const generate = async (candidates: RollCandidate[] = selected ? [selected] : [], target = experiment, options: { skipConfirmation?: boolean } = {}): Promise<RollGenerateOutcome> => {
    if (!target || target.archived || !candidates.length || candidates.some(candidate => candidate.archived || images.has(candidate.id)) || loadingRef.current || generatingRef.current || session || (target.id === experiment?.id && (historyLoading || !historyReady))) return { ok: false, reason: 'skipped' };
    if (!continuousGenerationEnabled && candidates.length > 1) { const message = t('连续生成已关闭，请开启后生成本轮'); reportGeneration(message); return { ok: false, reason: 'error', error: message }; }
    generatingRef.current = true; setPreparing(true); setGenerationError(null);
    const reportError = (message: string, tone: 'error' | 'warning' = 'error') => {
      const text = t(parseHttpError(message).message);
      if (!mounted.current) return text;
      if (selectedExperimentRef.current === target.id) setGenerationError({ experimentId: target.id, message: text, tone });
      else notify(t('画风记录 {0}：{1}', [target.name, text]), 'error');
      // 出图回执里的错误与警告同样用一次弹窗说清楚，候选卡占位区仍保留就地重试；连续 Roll 停下后统一提示一次。
      if (!getRollSeries().running) alertDialog(text);
      return text;
    };
    try {
      let key = readRollApiKey();
      let activeSub = subscription.info;
      const poolCheck = await prepareGenerationWithPool({
        model: target.template.params.model,
        estimatedCostWithOpus: estimateV45GenerationCost(target.template.params, true, false),
        minPercent: getRollSeries().running ? getRollSeries().stopAtPercent : 0,
      });
      if (poolCheck.pooled) {
        if (!poolCheck.ok) {
          const text = reportError(poolCheck.message);
          return { ok: false, reason: poolCheck.code === 'pool_exhausted' && getRollSeries().running ? 'opus_limit' : 'error', error: text };
        }
        key = poolCheck.key;
        activeSub = poolCheck.info;
      } else {
        void subscription.refreshIfStale();
      }
      if (!key) { const message = t('请先在“全局设置”中配置 NovelAI API Key'); reportGeneration(message); return { ok: false, reason: 'error', error: message }; }
      const eachCost = perUseNaiChannel && !poolCheck.pooled ? 0 : estimateV45GenerationCost(target.template.params, isActiveOpusSubscription(activeSub), activeSub?.usage?.isNegative ?? true), totalCost = eachCost * candidates.length;
      if (totalCost > 0 && !options.skipConfirmation && !await confirm({ rememberKey: 'roll.generate', rememberScope: confirmationCostScope(key, eachCost, candidates.length, budget.remaining, target.template.params.model), title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片',
        message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [candidates.length, totalCost, budget.remaining]),
        confirmLabel: t('消耗 {0} 点并生成', [totalCost]), ...(totalCost > budget.remaining ? { tone: 'danger' as const } : {}) })) return { ok: false, reason: 'declined' };
      const started = await beginRollGeneration(target, candidates.length === 1 ? candidates[0] : candidates, key, eachCost, generationStreamPreview && getRuntimeNaiModelInfo(target.template.params.model, runtime).supportsStreamedResponses, currentRollRound(target)?.id, forceEmptySeed);
      const receipt = await started.settle;
      if (!receipt.success && receipt.outcome !== 'cancelled' && /429|502|503|限流|并发|超时/.test(String(receipt.error || ''))) {
        reportPoolKeyCooldown(key);
      }
      const warnings: string[] = [];
      if (started.session.accountingFailed) warnings.push(t('图片已保存，但本地记账异常，请核对额度后再继续') + (started.session.accountingError ? `：${started.session.accountingError}` : ''));
      if (started.session.cleanupError) warnings.push(t('后台任务清理异常：{0}', [started.session.cleanupError]));
      let outcome: RollGenerateOutcome = { ok: true };
      // 记账或清理异常也要停下连续 Roll：已出的图保住，但不能在额度不明时继续消耗。
      if (warnings.length) outcome = { ok: false, reason: 'error', error: reportError(warnings.join('；'), 'warning') };
      else if (receipt.outcome === 'cancelled') outcome = { ok: false, reason: 'cancelled' };
      else if (!receipt.success) outcome = { ok: false, reason: receipt.code === 'pool_exhausted' && getRollSeries().running ? 'opus_limit' : 'error', error: reportError(receipt.error || t('生成失败')) };
      if (mounted.current && selectedExperimentRef.current === target.id) {
        const saved = started.session.lastSavedItem;
        if (saved) setHistory(current => [...current.filter(item => item.id !== saved.id), saved]);
        await refreshHistory(target.id);
      }
      return outcome;
    } catch (cause) { return { ok: false, reason: 'error', error: reportError((cause as Error).message) }; }
    finally { generatingRef.current = false; if (mounted.current) setPreparing(false); }
  };
  const approve = () => void perform(async () => {
    if (!session?.awaiting) return;
    const current = getGenerationSeriesSession(session.scope); if (!current?.awaiting) return;
    const nextCost = current.awaiting.cost;
    const remaining = current.awaiting.requestedCount - current.awaiting.completedCount;
    if (!await confirm({ rememberKey: 'roll.cost-increase', rememberScope: confirmationCostScope(current.key, nextCost, remaining, budget.remaining), title: '后台任务费用已变化', message: t('本轮剩余 {0} 张，当前每张预计 {1} Anlas，共 {2} Anlas。本地剩余预算：{3}。', [remaining, nextCost, nextCost * remaining, budget.remaining]), confirmLabel: t('消耗 {0} 点并生成', [nextCost * remaining]), tone: 'danger' })) { stopGenerationSeriesSession(current); return; }
    if (readRollApiKey() !== current.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await approveGenerationSeries(current, nextCost);
  }, 'generation');
  /** 抽取一轮候选并保存记录；手动 Roll、助手单轮与连续 Roll 共用同一份校验与落库。 */
  const createRound = async (requested: number, useSamples: boolean) => {
    if (chainArtistSource === undefined && (libraryLoading || libraryError || !library.length)) throw new Error(libraryError || '画师词库尚未就绪，请重新加载');
    if (useSamples && sampledTags === null) throw new Error('正在读取画师样张，请稍候');
    if (useSamples && !effectiveLibrary.length && pinnedArtists.length < roundRules.maxArtists) throw new Error('没有可用的有样张画师，请先在画师库下载图包或生成样张');
    let source = experiment || makeExperiment();
    if (round && !round.closedAt) source = { ...source, rounds: source.rounds.map(item => item.id === round.id ? { ...item, closedAt: Date.now() } : item) };
    source = { ...source, artists: artistOverrides, drawPlan: undefined, pinnedArtists, chainArtistSource, rules: roundRules, sampledOnly: useSamples };
    const next = beginRollRound(source, useSamples ? effectiveLibrary : library, requested, { blockedTags: blocklist, sampledOnly: useSamples, preferredTags: await readPreferredTags() });
    const saved = await store(next), created = currentRollRound(saved)!;
    selectedExperimentRef.current = saved.id; setExperimentId(saved.id); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId('');
    return { saved, created, candidates: saved.candidates.filter(candidate => created.candidateIds.includes(candidate.id)) };
  };
  const runRound = () => void perform(async () => {
    if (session || generatingRef.current) return;
    if (experiment && (!historyReady || historyLoading)) throw new Error('历史暂不可用，请重新加载后再生成。');
    if (!continuousGenerationEnabled && count > 1) throw new Error('连续生成已关闭，请开启后生成本轮');
    const { saved, candidates } = await createRound(count, sampledOnly);
    void generate(candidates, saved);
  }, 'generation');
  /**
   * 连续 Roll 的一轮：抽取并等本批出图结束，把结果交回循环判断。
   * 尚未抽取时遇到忙碌只等待；一旦落了候选，生成未能发起也按失败停下，避免无人值守时攒下空轮。
   */
  const runSeriesRound = async (): Promise<RollGenerateOutcome> => {
    if (busyRef.current || loadingRef.current || generatingRef.current || session || !experiment || !historyReady || historyLoading) return { ok: false, reason: 'skipped' };
    if (!continuousGenerationEnabled) return { ok: false, reason: 'error', error: t('连续生成已关闭，无法连续 Roll') };
    if (rollSeriesWouldOverflow(experiment, count)) return { ok: false, reason: 'record_full' };
    busyRef.current = true; setBusy(true);
    let created: Awaited<ReturnType<typeof createRound>>;
    try { created = await createRound(count, sampledOnly); }
    catch (cause) { return { ok: false, reason: 'error', error: t(parseHttpError((cause as Error).message).message) }; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    const outcome = await generate(created.candidates, created.saved, { skipConfirmation: getRollSeries().skipConfirmation });
    return !outcome.ok && outcome.reason === 'skipped' ? { ok: false, reason: 'error', error: t('本轮候选已抽取，但生成未能发起') } : outcome;
  };
  const runSeriesRoundRef = useRef(runSeriesRound);
  runSeriesRoundRef.current = runSeriesRound;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const keyPool = useNaiKeyPool();
  // Opus 百分比与官方点数与侧栏同源；池模式下取全池可用最高百分比，任一未知都不当作已达标。
  const poolMaxOpus = keyPool.config.enabled ? getPoolMaxOpusPercent() : null;
  const seriesOpusPercent = poolMaxOpus !== null
    ? poolMaxOpus
    : (subscription.info?.usage && Number.isFinite(Number(subscription.info.usage.percent)) ? Number(subscription.info.usage.percent) : null);
  const seriesAccountPoints = (() => {
    const balance = subscription.info?.trainingStepsLeft;
    return balance && Number.isFinite(balance.fixedTrainingStepsLeft) && Number.isFinite(balance.purchasedTrainingSteps)
      ? balance.fixedTrainingStepsLeft + balance.purchasedTrainingSteps : null;
  })();
  const seriesSignals = { busy: Boolean(session || preparing || busy || loading || detailLoading || historyLoading || !historyReady), experimentId, opusPercent: seriesOpusPercent, points: seriesAccountPoints };
  const seriesSignalRef = useRef(seriesSignals);
  seriesSignalRef.current = seriesSignals;
  // 连续 Roll：页面打开期间逐轮推进，不占助手回复轮次；每轮等本批结束再进入下一轮，任何失败都停下并提示一次。
  useEffect(() => {
    const finish = (reason: RollSeriesStopReason, error = '') => {
      if (!stopRollSeries(reason, error) || !mounted.current) return;
      const label = t(ROLL_SERIES_STOP_LABELS[reason]);
      const ended = ['max_rounds', 'opus_limit', 'points_limit'].includes(reason);
      notifyRef.current(t('连续 Roll 已停止：{0}', [error ? `${label}（${error}）` : label]), ended ? 'success' : 'error');
    };
    const timer = window.setInterval(() => {
      const series = getRollSeries(), step = nextRollSeriesStep(series, seriesSignalRef.current);
      if (step.action === 'stop') { finish(step.reason); return; }
      if (step.action !== 'run') return;
      const runId = series.runId;
      series.inFlight = true; series.lastRoundAt = Date.now();
      void runSeriesRoundRef.current()
        .then(outcome => {
          if (!series.running || series.runId !== runId) return;
          if (outcome.ok) { series.rounds += 1; series.lastProgressAt = Date.now(); }
          else if (outcome.reason !== 'skipped') finish(outcome.reason, outcome.error);
        })
        .catch(cause => { if (series.runId === runId) finish('error', (cause as Error).message); })
        .finally(() => { if (series.runId === runId) series.inFlight = false; });
    }, 2000);
    // 循环属于这个页面：页面卸载或关闭即停，并留下原因；刷新后不续跑。
    const closed = () => { stopRollSeries('page_closed'); };
    window.addEventListener('pagehide', closed);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', closed); closed(); };
  }, []);
  const generatePending = (ids?: string[]) => void perform(async () => {
    if (!experiment || !historyReady || historyLoading || session || generatingRef.current) return;
    let source = experiment;
    const pending = rollPendingCandidates(experiment, images, ids).slice(0, continuousGenerationEnabled ? 24 : 1);
    if (!pending.length) return;
    if (ids || !round || round.closedAt) source = await store({ ...experiment, rounds: [...experiment.rounds.map(item => item.id === round?.id && !item.closedAt ? { ...item, closedAt: Date.now() } : item), { id: createUuid(), candidateIds: pending.map(candidate => candidate.id), createdAt: Date.now() }] });
    setSelectedId(''); setSelecting(false); setSelectedIds(new Set()); setRoundId(''); setFilter('all'); void generate(pending, source);
  }, 'generation');
  const resume = () => void perform(async () => {
    if (!session || session.state !== 'paused') return;
    if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await setGenerationQueuePaused(session.key, false);
  }, 'generation');
  const pause = () => void perform(async () => {
    if (!session) return;
    if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await setGenerationQueuePaused(session.key, true);
  }, 'generation');
  const cancelSession = () => { if (!session) return; const current = getGenerationSeriesSession(session.scope); if (current) stopGenerationSeriesSession(current); };
  const intervalSeconds = queueInterval?.seconds ?? DEFAULT_GENERATION_INTERVAL_SECONDS;
  const intervalJitter = queueInterval?.jitterPercent ?? DEFAULT_GENERATION_INTERVAL_JITTER_PERCENT;
  // 打开「本轮设置」时读当前 Key 的队列偏好；读取失败保留默认值，不阻塞本轮设置。
  const loadQueueInterval = useCallback(async () => {
    const key = readRollApiKey();
    if (!key) { if (mounted.current) setQueueInterval(null); return; }
    try {
      const next = await getGenerationQueue(key);
      if (!mounted.current) return;
      const seconds = typeof next.intervalSeconds === 'number' ? next.intervalSeconds : DEFAULT_GENERATION_INTERVAL_SECONDS;
      const jitterPercent = typeof next.intervalJitterPercent === 'number' ? next.intervalJitterPercent : DEFAULT_GENERATION_INTERVAL_JITTER_PERCENT;
      setQueueInterval({ seconds, jitterPercent });
      setIntervalDraft(seconds.toFixed(1));
    } catch { /* 保留上次已知值；生成仍按后端现有偏好执行。 */ }
  }, []);
  const changeInterval = async (seconds: number, jitterPercent?: number) => {
    const key = readRollApiKey();
    if (!key || intervalPending) { if (!key) notify(t('请先在“全局设置”中配置 NovelAI API Key'), 'error'); return; }
    setIntervalPending(true);
    try {
      const next = await setGenerationInterval(key, seconds, jitterPercent);
      if (!mounted.current) return;
      const nextSeconds = typeof next.intervalSeconds === 'number' ? next.intervalSeconds : seconds;
      const nextJitter = typeof next.intervalJitterPercent === 'number' ? next.intervalJitterPercent : (jitterPercent ?? intervalJitter);
      setQueueInterval({ seconds: nextSeconds, jitterPercent: nextJitter });
      setIntervalDraft(nextSeconds.toFixed(1));
    } catch (cause) { if (mounted.current) notify((cause as Error).message, 'error'); }
    finally { if (mounted.current) setIntervalPending(false); }
  };
  const commitInterval = () => {
    const text = intervalDraft.trim();
    if (!text) { setIntervalDraft(intervalSeconds.toFixed(1)); return; }
    try {
      const next = validateGenerationInterval(Number(text));
      setIntervalDraft(next.toFixed(1));
      if (next !== intervalSeconds) void changeInterval(next);
    } catch { setIntervalDraft(intervalSeconds.toFixed(1)); }
  };
  const persistCandidate = async (target: RollExperiment, id: string) => {
    const candidate = target.candidates.find(item => item.id === id); if (!candidate) return target;
    const image = images.get(id);
    let saved = savedChains.current.get(`${target.id}:${id}`) || chains.find(chain => chain.id === candidate.savedChainId);
    if (!saved) {
      const chain = rollCandidateToChain(target, candidate);
      if (image) {
        const coverKey = JSON.stringify([target.id, id, image.id, image.imageUrl]);
        let cover = savedCovers.current.get(coverKey);
        if (!cover) {
          const response = await fetch(image.imageUrl); notifyLanAccessRequired(response);
          if (!response.ok) throw await parseErrorResponse(response);
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) throw new Error('当前预览内容不是有效图片');
          cover = (await api.uploadFile(new File([blob], 'roll-cover.png', { type: blob.type }), 'covers')).url;
          if (typeof cover !== 'string' || !cover.trim()) throw new Error(t('上传失败'));
          savedCovers.current.set(coverKey, cover);
        }
        chain.previewImage = cover;
        chain.basePrompt = image.prompt; chain.negativePrompt = image.negativePrompt ?? ''; chain.params = structuredClone(image.params);
      }
      saved = await onSaveChain(chain); savedChains.current.set(`${target.id}:${id}`, saved);
    }
    return store({ ...target, candidates: target.candidates.map(item => item.id === id ? { ...item, savedChainId: saved!.id } : item) });
  };
  const saveCandidate = (id = selectedId) => void perform(async () => {
    if (!experiment) return;
    if (!images.has(id)) throw new Error(t('生成图片后再保存为风格串'));
    await persistCandidate(experiment, id);
    notify('已保存到风格串');
  });
  // 弹窗里保存的「重试」动作要用最新一次渲染的 saveChosen，避免拿着旧记录状态重试。
  const saveChosenRef = useRef<(retry?: boolean) => void>(() => {});
  const saveChosen = (retry = false) => void perform(async () => {
    if (!experiment || !historyReady) return;
    const ordered = retry && saveFailures?.experimentId === experiment.id ? saveFailures.ids.flatMap(id => experiment.candidates.find(candidate => candidate.id === id) ?? []) : chosen;
    const items = ordered.filter(candidate => images.has(candidate.id) && !candidate.archived && !candidate.savedChainId);
    const context = saveView;
    const currentView = () => mounted.current && saveViewRef.current === context;
    const currentRecord = () => mounted.current && selectedExperimentRef.current === experiment.id;
    let next = experiment;
    if (retry && saveFailures?.needsReload) {
      try {
        const refreshed = await loadRollExperiment(experiment.id);
        if (refreshed.archived) throw new Error(t('画风记录暂不可用'));
        next = refreshed;
        if (mounted.current) { setExperiment(refreshed); setDetailId(refreshed.id); setExperiments(current => [rollExperimentSummary(refreshed), ...current.filter(record => record.id !== refreshed.id)]); }
      } catch { if (currentRecord()) setError(t('暂时无法确认保存结果，已暂停后续项目')); return; }
    }
    const failed: string[] = [], unprocessed: string[] = [], messages: string[] = [];
    let needsReload = false;
    let successful = 0;
    setSaveFailures(null);
    if (currentView()) setSelectedIds(new Set(items.map(candidate => candidate.id)));
    setSavingProgress({ completed: 0, total: items.length });
    try {
      for (const [index, candidate] of items.entries()) {
        const latest = next.candidates.find(item => item.id === candidate.id);
        if (!latest || latest.archived) continue;
        let saved = Boolean(latest.savedChainId);
        try { if (!saved) next = await persistCandidate(next, candidate.id); saved = true; }
        catch (cause) {
          const message = parseHttpError((cause as Error).message).message;
          if (savedChains.current.has(`${next.id}:${candidate.id}`)) {
            // 关联失败后先核对服务端修订，再处理下一项，不能拿旧版本覆盖其他已保存关联。
            try {
              const refreshed = await loadRollExperiment(next.id);
              if (refreshed.archived) throw new Error(t('画风记录暂不可用'));
              next = refreshed;
              if (mounted.current) { setExperiment(refreshed); setDetailId(refreshed.id); setExperiments(current => [rollExperimentSummary(refreshed), ...current.filter(record => record.id !== refreshed.id)]); }
              saved = Boolean(refreshed.candidates.find(item => item.id === candidate.id)?.savedChainId);
            } catch {
              failed.push(candidate.id); unprocessed.push(...items.slice(index + 1).map(item => item.id));
              needsReload = true;
              messages.push(`#${experiment.candidates.indexOf(candidate) + 1}：${message}`, t('暂时无法确认保存结果，已暂停后续项目'));
              break;
            }
          }
          if (!saved) { failed.push(candidate.id); messages.push(`#${experiment.candidates.indexOf(candidate) + 1}：${message}`); }
        }
        if (saved) successful++;
        if (currentView()) setSavingProgress({ completed: index + 1, total: items.length });
      }
      if (currentRecord()) {
        const remainingIds = [...failed, ...unprocessed];
        if (currentView()) setSelectedIds(new Set(remainingIds));
        setSaveFailures(remainingIds.length ? { experimentId: experiment.id, ids: remainingIds, unprocessed: unprocessed.length, needsReload, messages } : null);
        if (remainingIds.length) alertDialog([t('已保存 {0} 个候选，{1} 个失败，{2} 个未处理', [successful, failed.length, unprocessed.length]), ...messages].join('\n'), {
          title: t('保存未完成'),
          action: { label: t(unprocessed.length ? '重试待保存项' : '重试失败项'), onClick: () => saveChosenRef.current(true) },
        });
        else notify(t('已保存 {0} 个候选', [successful]), 'success');
      }
    } finally { if (mounted.current) setSavingProgress(null); }
  });
  saveChosenRef.current = saveChosen;
  /** 丢弃就是彻底删除：没有回收站，也没有还原，所以每次都要二次确认。 */
  const deleteCandidates = (ids: string[]) => void perform(async () => {
    if (!experiment) return;
    const targets = experiment.candidates.filter(candidate => ids.includes(candidate.id));
    if (!targets.length) return;
    const label = targets.length === 1 ? `候选 ${experiment.candidates.indexOf(targets[0]) + 1}` : `${targets.length} 个候选`;
    if (!await confirm({ title: '删除候选', message: t('将永久删除 {0}；已生成的历史图片与已保存的风格串仍保留，删除后不能还原。', [label]), confirmLabel: t('删除'), tone: 'danger' })) return;
    const next = removeRollCandidates(experiment, targets.map(candidate => candidate.id));
    await store(next);
    if (roundId && !next.rounds.some(round => round.id === roundId)) setRoundId('');
    setSelectedIds(new Set()); setSelectedId('');
    notify(t('已删除 {0}', [label]), 'success');
  });
  // 归档候选只来自更早的丢弃方式；现在「丢弃」就是直接删除，容量立即回到记录上，不再有可永久清理的归档项。
  // 记录删除与候选一致：二次确认后彻底移除，不保留回收站；历史原图与已保存的风格串独立保存。
  const deleteRecord = (id: string) => void perform(async () => {
    if (getGenerationSeriesSession(rollSourceId(id)) || generatingRef.current) return;
    const summary = experiments.find(item => item.id === id);
    if (!summary) return;
    if (!await confirm({ title: '删除记录', message: t('将永久删除画风记录「{0}」，其中的 {1} 轮与 {2} 个候选配方一并移除；已生成的历史图片与已保存的风格串保留，删除后不能还原。', [summary.name, summary.rounds, summary.candidates]), confirmLabel: t('删除记录'), tone: 'danger' })) return;
    await deleteRollExperiment(id, summary.revision);
    if (!mounted.current) return;
    setExperiments(current => current.filter(item => item.id !== id));
    if (id === experimentId) setExperimentId(experiments.find(item => item.id !== id && !item.archived)?.id || '');
    notify(t('已删除画风记录「{0}」', [summary.name]), 'success');
  });
  /** 旧版本把删除做成回收站；这里只提供一次性清理出口，清完就没有这个状态了。 */
  const purgeArchived = () => void perform(async () => {
    const targets = experiments.filter(item => item.archived);
    if (!targets.length) return;
    if (!await confirm({ title: '清理旧记录', message: t('将永久删除 {0} 条在旧版回收站里标记删除的记录，不能还原。', [targets.length]), confirmLabel: t('清理'), tone: 'danger' })) return;
    const failed: string[] = [];
    for (const item of targets) { try { await deleteRollExperiment(item.id, item.revision); } catch { failed.push(item.name); } }
    await reload();
    notify(failed.length ? t('已清理 {0} 条，{1} 条失败：{2}', [targets.length - failed.length, failed.length, failed.join('、')]) : t('已清理 {0} 条旧记录', [targets.length]), failed.length ? 'error' : 'success');
  });
  /** 记录导航里的重命名：当前记录直接用内存副本，其他记录先按 ID 补读完整内容再保存。 */
  const renameRecord = (id: string, name: string) => void perform(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = experiment?.id === id ? experiment : await loadRollExperiment(id);
    if (target.name === trimmed) return;
    await store({ ...target, name: trimmed });
  });
  const sendToLab = () => {
    if (!experiment || !selected) return;
    const chain = rollCandidateToChain(experiment, selected);
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true, replace: true,
      prompt: selectedImage?.prompt ?? chain.basePrompt, negativePrompt: selectedImage?.negativePrompt ?? chain.negativePrompt,
      params: selectedImage?.params ?? chain.params, importSettings: true, importSeed: true, importModel: true }));
    onNavigateToPlayground();
  };
  const createPinnedRecord = (candidate: RollCandidate) => void perform(async () => {
    if (!experiment) return;
    const draft = makeExperiment();
    draft.template = structuredClone(experiment.template);
    const pinned = candidate.tags.map(tag => tag.tag);
    draft.name = t('固定画师组 {0} 位', [pinned.length]);
    draft.pinnedArtists = pinned;
    draft.rules = { ...draft.rules, minArtists: pinned.length, maxArtists: pinned.length, preferredMinArtists: 0 };
    const saved = await store(draft);
    selectedExperimentRef.current = saved.id;
    setExperimentId(saved.id);
    setPinnedArtists(pinned);
    setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId('');
    notify(t('已新建记录，之后每轮只随机权重'), 'success');
  });
  const [detailBlockBusy, setDetailBlockBusy] = useState<string | null>(null);
  const pinnedArtistKeys = useMemo(() => new Set(pinnedArtists.map(normalizeRollArtistKey)), [pinnedArtists]);
  const blockedArtistKeys = useMemo(() => new Set([...blocklist, ...excludedArtistTags].map(normalizeRollArtistKey)), [blocklist, excludedArtistTags]);
  const toggleDetailPin = (tag: string) => {
    const key = normalizeRollArtistKey(tag);
    if (pinnedArtistKeys.has(key)) {
      setPinnedArtists(current => current.filter(value => normalizeRollArtistKey(value) !== key));
      notify(t('已取消固定画师：{0}', [tag]), 'success');
      return;
    }
    if (blockedArtistKeys.has(key)) {
      notify(t('画师已被屏蔽或排除：{0}', [tag]), 'error');
      return;
    }
    if (pinnedArtists.length >= roundRules.maxArtists) {
      notify(t('最多可添加 {0} 位画师', [roundRules.maxArtists]), 'error');
      return;
    }
    setPinnedArtists(current => [...current, tag]);
    notify(t('已固定画师：{0}（下一轮生效）', [tag]), 'success');
  };
  const toggleDetailBlock = async (tag: string) => {
    if (detailBlockBusy) return;
    const key = normalizeRollArtistKey(tag);
    const activeBlock = blockedArtistKeys.has(key);
    setDetailBlockBusy(key);
    try {
      await updateBlocklist(activeBlock ? blocklist.filter(value => normalizeRollArtistKey(value) !== key) : [...blocklist, tag]);
      if (activeBlock) {
        setArtistOverrides(current => current.map(artist => normalizeRollArtistKey(artist.tag) === key ? { ...artist, excluded: false } : artist));
        notify(t('已取消屏蔽画师：{0}', [tag]), 'success');
      } else {
        setPinnedArtists(current => current.filter(value => normalizeRollArtistKey(value) !== key));
        await clearArtistPreference(tag).catch(() => {});
        notify(t('已屏蔽画师：{0}（下一轮不再抽取）', [tag]), 'success');
      }
    } catch (cause) {
      notify((cause as Error).message, 'error');
    } finally {
      if (mounted.current) setDetailBlockBusy(null);
    }
  };
  const selectedSavedChain = selected?.savedChainId && chains.some(chain => chain.id === selected.savedChainId);
  const selectedRoundNo = selected ? roundNumbers.get(selected.id) : undefined;
  const selectedParams = selectedImage?.params ?? experiment?.template.params;
  const selectedModelLabel = selectedParams?.model ? getRuntimeNaiModelInfo(selectedParams.model, runtime).label : '';
  const detailIndex = visible.findIndex(candidate => candidate.id === selectedId);
  /** 详情页的主动作收进标题栏，统一用透明底线条图标；已保存的条目用品牌色前景区分。 */
  const detailActions = selected ? <>
    <IconButton label={t(selectedSavedChain ? '打开风格串' : selectedImage ? '存为风格串' : '生成后可保存')} tone="ghost" className={selectedSavedChain ? '!text-indigo-600 dark:!text-indigo-400' : '!text-emerald-600 dark:!text-emerald-400'} disabled={busy || loading || (!selectedImage && !selectedSavedChain)} onClick={selectedSavedChain ? () => onOpenChain(selected.savedChainId!) : selectedImage ? () => saveCandidate() : undefined}><Save /></IconButton>
    <IconButton label={t('复制画风')} tone="ghost" onClick={() => void copyTagText(formatRollStyle(selected.tags))
      .then(() => notify(t('已复制提示词'), 'success'))
      .catch(() => notify(t('复制失败，请检查浏览器剪贴板权限'), 'error'))}><Copy /></IconButton>
    <IconButton label={t('送往实验室')} tone="ghost" disabled={busy} onClick={() => { try { sendToLab(); } catch (cause) { setError((cause as Error).message); } }}><FlaskConical /></IconButton>
    <IconButton label={t('新建记录 · 固定这些画师')} tone="ghost" disabled={busy || loading || selected.archived} onClick={() => createPinnedRecord(selected)}><CopyPlus /></IconButton>
  </> : null;
  const detail = experiment && selected ? <div className="space-y-4 p-4">
    {selectedImage ? <PressRevealSurface touchActions="bar" className="appearance-group group relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950" data-safe-mode-work="true">
      <button className="block w-full" type="button" aria-label={t('放大图片')} onClick={() => setLightbox(selectedImage)}><SmartImage src={selectedImage.imageUrl} alt={t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])} eager className="h-auto w-full object-contain" containerClassName="w-full" /></button>
      {formatGenerationDuration(readGenerationDurationMs(selectedImage)) && <div data-image-preview-footer className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2.5 py-0.5 text-xs tabular-nums text-white">{formatGenerationDuration(readGenerationDurationMs(selectedImage))}</div>}
      {detailIndex > 0 && <button type="button" data-image-preview-navigation aria-label={t('上一张')} title={t('上一张')} onClick={() => setSelectedId(visible[detailIndex - 1].id)} className="nai-float-btn hover-reveal-lg mobile-size-locked absolute left-3 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"><ChevronLeft className="h-7 w-7" /></button>}
      {detailIndex >= 0 && detailIndex < visible.length - 1 && <button type="button" data-image-preview-navigation aria-label={t('下一张')} title={t('下一张')} onClick={() => setSelectedId(visible[detailIndex + 1].id)} className="nai-float-btn hover-reveal-lg mobile-size-locked absolute right-3 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"><ChevronRight className="h-7 w-7" /></button>}
      <ImageCardActions><ImageShareActions imageUrl={selectedImage.imageUrl} filename={`roll-${selectedImage.id}.png`} generationData={selectedImage} favorite={{ imageUrl: selectedImage.imageUrl, sourceType: 'history', sourceId: selectedImage.id }} notify={notify} variant="card" /></ImageCardActions>
    </PressRevealSurface> : <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-700"><ImagePlus className="h-8 w-8" /></div>}
    <div aria-label={t('候选生成信息')} className="flex flex-wrap items-center gap-1.5 text-micro tabular-nums text-gray-500 dark:text-gray-400">
      {selectedRoundNo ? <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">R{selectedRoundNo}</span> : null}
      {selectedModelLabel && <span className="rounded-md bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">{selectedModelLabel}</span>}
      {selectedParams?.width && selectedParams?.height && <span className="rounded-md bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{selectedParams.width}×{selectedParams.height}</span>}
      {selectedImage?.params.seed !== undefined && selectedImage.params.seed !== null && <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono dark:bg-gray-800">Seed {selectedImage.params.seed}</span>}
      {selectedSavedChain && <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{t('已保存')}</span>}
    </div>
    <div className="appearance-group rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 space-y-2.5 dark:border-gray-800/80 dark:bg-gray-900/40 shadow-inner">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
        <span>{t('画师与权重')}</span>
        <span className="font-mono text-xs">{selected.tags.length} {t('位画师')}</span>
      </div>
      <div className="space-y-2.5">{selected.tags.map(entry => {
        const sampleUrl = sampleUrls.get(normalizeArtistSampleTag(entry.tag));
        const chinese = chineseNames.get(normalizeArtistSampleTag(entry.tag));
        const artistKey = normalizeRollArtistKey(entry.tag);
        const isPinned = pinnedArtistKeys.has(artistKey);
        const isBlocked = blockedArtistKeys.has(artistKey);
        return <div key={entry.tag} className="flex min-w-0 items-center gap-2.5 text-sm">
          <button type="button" disabled={!onOpenArtistLibrary} onClick={() => onOpenArtistLibrary?.(entry.tag)} title={onOpenArtistLibrary ? t('在画师库查看 {0}', [entry.tag]) : undefined} className="shrink-0 disabled:cursor-default">
            {sampleUrl ? <SmartImage src={sampleUrl} alt="" thumbnailVariant="thumb-160" containerClassName="relative h-11 w-11 overflow-hidden rounded-xl" className="h-full w-full object-cover" previewTransform={sampleUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v2' : undefined} /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-200 text-sm font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-200">{entry.tag.slice(0, 1)}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <button type="button" disabled={!onOpenArtistLibrary} onClick={() => onOpenArtistLibrary?.(entry.tag)} title={onOpenArtistLibrary ? t('在画师库查看 {0}', [entry.tag]) : entry.tag} className={`min-w-0 truncate text-left text-xs font-medium disabled:cursor-default ${isBlocked ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>{entry.tag}</button>
              <div className="flex flex-none items-center gap-1.5"><span className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><span className="block h-full rounded-full bg-[var(--nai-accent)]" style={{ width: `${Math.min(100, Math.max(5, (entry.weight / 3) * 100))}%` }} /></span><span className="w-6 text-right font-mono text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-300">{entry.weight.toFixed(1)}</span></div>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
              <span className="min-w-0 truncate text-micro text-gray-400" title={chinese || undefined}>{chinese || ''}</span>
              <div className="flex flex-none items-center gap-0.5">
                <ArtistFavoriteButton tag={entry.tag} sampleUrl={sampleUrl} />
                <button type="button" aria-label={t(isPinned ? '取消固定画师 {0}' : '固定画师 {0}', [entry.tag])} title={t(isPinned ? '取消固定（下一轮不锁定）' : '固定到下一轮')} aria-pressed={isPinned} disabled={busy || isBlocked} onClick={() => toggleDetailPin(entry.tag)} className={`mobile-touch flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${isPinned ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-gray-400 hover:bg-gray-100 hover:text-indigo-500 dark:text-gray-500 dark:hover:bg-gray-800'}`}><Pin aria-hidden="true" className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} /></button>
                <button type="button" aria-label={t(isBlocked ? '取消屏蔽画师 {0}' : '屏蔽画师 {0}', [entry.tag])} title={t(isBlocked ? '取消屏蔽画师' : '屏蔽画师（下一轮不再抽取）')} aria-pressed={isBlocked} disabled={busy || detailBlockBusy !== null} onClick={() => void toggleDetailBlock(entry.tag)} className={`mobile-touch flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${isBlocked ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400' : 'text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:text-gray-500 dark:hover:bg-gray-800'}`}><Ban aria-hidden="true" className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        </div>;
      })}</div>
    </div>
    {!selectedImage && <ToolbarButton data-agent-action="business" tone="primary" className="!h-11 w-full" disabled={busy || loading || preparing || Boolean(session) || historyLoading || !historyReady || selected.archived} onClick={() => void generate()}>{preparing ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}{t('生成图片')} · {costLabel}</ToolbarButton>}
    {!historyLoading && !historyReady && <p className="text-xs text-amber-600 dark:text-amber-400">{t('历史暂不可用，请重新加载后再生成。')}</p>}
  </div> : null;

  useAgentCommand({
    name: 'get_roll_state', label: '读取 Roll 串状态', description: '读取当前 Roll 串记录、当前轮、候选出图与保存状态、生成会话。', parameters: { type: 'object', properties: {} }, readOnly: true, scope: () => rootRef.current,
    execute: () => ({
      experiment: experiment ? { id: experiment.id, name: experiment.name, archived: experiment.archived === true, rounds: experiment.rounds.length } : null,
      round: round ? { id: round.id, candidateIds: round.candidateIds, closedAt: round.closedAt || null } : null,
      candidates: experiment ? experiment.candidates.map(candidate => ({
        id: candidate.id, tags: candidate.tags, archived: candidate.archived === true,
        savedChainId: candidate.savedChainId || '', hasImage: images.has(candidate.id), favorite: collectionSettled ? favoriteIds.has(candidate.id) : null,
      })) : [],
      session: session ? { scope: session.scope, state: session.state, queued: session.queued, progress: session.progress, awaiting: session.awaiting || null } : null,
      library: { count: library.length, loading: libraryLoading, error: libraryError, sampledOnly, effectiveCount: effectiveLibrary.length, sampledReady: sampledTags !== null },
      count, rules: roundRules, pinnedArtists, chainArtistSource,
      series: (() => { const series = getRollSeries(); return { running: series.running, experimentId: series.experimentId, rounds: series.rounds, maxRounds: series.maxRounds, stopAtPercent: series.stopAtPercent, stopAtPoints: series.stopAtPoints, stopReason: series.stopReason, stopLabel: series.stopReason ? ROLL_SERIES_STOP_LABELS[series.stopReason] : '', lastError: series.lastError, roundInFlight: series.inFlight, opusPercent: seriesOpusPercent, points: seriesAccountPoints }; })(),
    }),
  });
  useAgentCommand({
    name: 'run_roll_round', label: '发起 Roll 一轮', description: '按当前规则抽取候选并保存；generate 为真时按权限直接生成或等待页面费用确认。', parameters: { type: 'object', properties: { count: { type: 'number' }, generate: { type: 'boolean' }, sampledOnly: { type: 'boolean' } } }, scope: () => rootRef.current,
    execute: async args => {
      if (session || generatingRef.current) throw new Error('已有图片正在生成，请先等待或取消');
      if (getRollSeries().running) throw new Error('连续 Roll 正在进行，请先停止');
      if (args.generate !== false && !readRollApiKey()) throw new Error('请先在全局设置中配置 NovelAI API Key');
      if (args.generate !== false && experiment && (!historyReady || historyLoading)) throw new Error('历史暂不可用，请重新加载后再生成');
      const requested = Math.max(1, Math.min(24, Math.floor(Number(args.count) || count)));
      if (!continuousGenerationEnabled && requested > 1) throw new Error('连续生成已关闭，本次只能生成 1 张');
      const useSamples = typeof args.sampledOnly === 'boolean' ? args.sampledOnly : sampledOnly;
      const { saved, created, candidates } = await createRound(requested, useSamples);
      if (args.generate !== false) void generate(candidates, saved, { skipConfirmation: args.agentPermissionMode === 'full' });
      return { experimentId: saved.id, roundId: created.id, candidateIds: created.candidateIds, generationStarted: args.generate !== false, note: args.generate !== false ? '已发起生成；费用确认由页面处理，进度用 get_generation_status 读取。' : '候选已抽取并保存，尚未消耗 Anlas。' };
    },
  });
  useAgentCommand({
    name: 'run_roll_series', label: '连续 Roll 串', description: '让当前 Roll 记录连续 Roll：每轮抽取并生成，等本批结束后进入下一轮，直到 Opus 额度降到 stopAtPercent（默认 5）、点数降到 stopAtPoints（默认 0）或达到 maxRounds。任何一轮失败、取消、未确认费用、记录容量将满、切换记录或页面关闭都会立即停止且不重试；循环只在 Roll 页面打开期间运行，刷新后不续跑。调用立即返回；用 get_roll_state 的 series 读取进度与 stopReason，传 stop 立即停止。', parameters: { type: 'object', properties: { maxRounds: { type: 'number' }, stopAtPercent: { type: 'number' }, stopAtPoints: { type: 'number' }, count: { type: 'number' }, stop: { type: 'boolean' } } }, scope: () => rootRef.current,
    execute: args => {
      if (args.stop === true) {
        stopRollSeries('user_stop');
        const series = getRollSeries();
        return { running: series.running, rounds: series.rounds, stopReason: series.stopReason };
      }
      if (!experiment) throw new Error('先选择要连续 Roll 的画风记录');
      if (getRollSeries().running) throw new Error('连续 Roll 已在进行，请先停止');
      if (session || generatingRef.current) throw new Error('已有图片正在生成，请先等待或取消');
      if (!continuousGenerationEnabled) throw new Error('连续生成已关闭，无法连续 Roll');
      if (!readRollApiKey()) throw new Error('请先在全局设置中配置 NovelAI API Key');
      const requested = Number(args.count);
      const roundSize = Number.isFinite(requested) ? Math.max(1, Math.min(24, Math.floor(requested))) : count;
      if (rollSeriesWouldOverflow(experiment, roundSize)) throw new Error(ROLL_SERIES_STOP_LABELS.record_full);
      if (roundSize !== count) setCount(roundSize);
      const series = startRollSeries({
        experimentId: experiment.id,
        maxRounds: Math.max(1, Math.min(5000, Math.floor(Number(args.maxRounds) || 500))),
        stopAtPercent: Math.max(0, Math.min(100, Number.isFinite(Number(args.stopAtPercent)) ? Number(args.stopAtPercent) : 5)),
        stopAtPoints: Math.max(0, Math.floor(Number(args.stopAtPoints) || 0)),
        // 完全访问沿用已授权的费用；标准权限每轮仍走页面费用确认，未确认即停。
        skipConfirmation: args.agentPermissionMode === 'full',
      });
      return { running: true, experimentId: experiment.id, maxRounds: series.maxRounds, stopAtPercent: series.stopAtPercent, stopAtPoints: series.stopAtPoints, opusPercent: seriesOpusPercent, points: seriesAccountPoints, note: '已在 Roll 页面启动连续 Roll，每轮结束自动进入下一轮；任何失败都会停止，请用 get_roll_state 核对 stopReason。' };
    },
  });
  useAgentCommand({
    name: 'generate_roll_pending', label: '补齐 Roll 候选', description: '为当前轮未出图的候选发起生成，最多 24 张。', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } }, scope: () => rootRef.current,
    execute: async args => {
      if (!experiment || !historyReady || historyLoading || session || generatingRef.current) throw new Error('当前不能发起生成，请先读取状态');
      const ids = Array.isArray(args.ids) ? args.ids.map(value => String(value)).slice(0, 24) : undefined;
      const pending = rollPendingCandidates(experiment, images, ids).slice(0, 24);
      if (!continuousGenerationEnabled && pending.length > 1) throw new Error('连续生成已关闭，本次只能生成 1 张');
      if (!pending.length) return { generationStarted: false, ids: [], note: '没有待生成候选。' };
      let source = experiment;
      if (ids || !round || round.closedAt) source = await store({ ...experiment, rounds: [...experiment.rounds.map(item => item.id === round?.id && !item.closedAt ? { ...item, closedAt: Date.now() } : item), { id: createUuid(), candidateIds: pending.map(candidate => candidate.id), createdAt: Date.now() }] });
      setSelectedId(''); setSelecting(false); setSelectedIds(new Set()); setRoundId(''); setFilter('all');
      void generate(pending, source, { skipConfirmation: args.agentPermissionMode === 'full' });
      return { experimentId: source.id, ids: pending.map(candidate => candidate.id), generationStarted: true };
    },
  });
  useAgentCommand({
    name: 'save_roll_candidate', label: '保存 Roll 候选为风格串', description: '把已出图的候选保存为风格串；candidateIds 省略时保存当前选中候选，单次最多 8 个。', parameters: { type: 'object', properties: { candidateIds: { type: 'array', items: { type: 'string' } } } }, scope: () => rootRef.current,
    execute: async args => {
      if (!experiment) throw new Error('当前没有 Roll 串记录');
      if (busyRef.current || loadingRef.current) throw new Error(t('正在保存，请稍候'));
      const ids = Array.isArray(args.candidateIds) && args.candidateIds.length ? args.candidateIds.map(value => String(value)).slice(0, 8) : selectedId ? [selectedId] : [];
      if (!ids.length) throw new Error('请选择要保存的候选');
      busyRef.current = true; setBusy(true);
      try {
      let current = experiment; const saved = [];
      for (const id of ids) {
        if (!images.has(id)) throw new Error(`候选 ${id} 还没有生成图片，无法保存`);
        current = await persistCandidate(current, id);
        saved.push({ candidateId: id, chainId: current.candidates.find(candidate => candidate.id === id)?.savedChainId || '' });
      }
      return { saved };
      } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    },
  });
  const roundPending = experiment ? rollPendingCandidates(experiment, images) : [];
  // 流式预览跟随本轮第一张还没出图的候选；保存后自然移到下一张。
  const previewCandidateId = round && !round.closedAt ? round.candidateIds.find(id => !images.has(id)) : undefined;
  // 没有进行中的轮次时，错误与生成按钮仍要落在某张待生成候选上；都没有则退回计数行提示。
  const nextPendingId = previewCandidateId ?? experiment?.candidates.find(candidate => !candidate.archived && !images.has(candidate.id))?.id;
  const livePreview = (generationStreamPreview || session?.state === 'saving') && experiment && session && session.scope === rollSourceId(experiment.id) && session.preview?.image && previewCandidateId
    ? { id: previewCandidateId, image: session.preview.image }
    : null;
  const scopedRound = experiment?.rounds.find(item => item.id === roundId);
  const generatingCandidateId = preparing || (session && ['preparing', 'generating', 'saving'].includes(session.state)) ? previewCandidateId : undefined;
  const selectedPending = experiment ? rollPendingCandidates(experiment, images, chosen.map(candidate => candidate.id)) : [];
  const saveable = chosen.filter(candidate => images.has(candidate.id) && !candidate.archived && !candidate.savedChainId);
  const working = Boolean(session || preparing), frozen = busy || loading || detailLoading;
  const canStart = !frozen && !working && (chainArtistSource !== undefined || (!libraryLoading && !libraryError && library.length > 0)) && (!experiment || historyReady) && (!sampledOnly || (sampledTags !== null && (effectiveLibrary.length > 0 || pinnedArtists.length >= roundRules.maxArtists)));
  const roundConditionLabel = (item: RollExperiment['rounds'][number]) => {
    const snapshot = item.snapshot;
    if (!snapshot) return '';
    return `${t('{0} 位画师', [artistCountLabel(snapshot.rules)])} · ${t('固定 {0} 位', [snapshot.pinnedArtists?.length ?? 0])}${snapshot.rules.preferredOnly ? ` · ${t('只抽取收藏画师')}` : ''} · ${snapshot.rules.minWeight.toFixed(1)}～${snapshot.rules.maxWeight.toFixed(1)} · ${t('{0} 张', [item.candidateIds.length])}`;
  };
  return <div ref={rootRef} className="workspace-canvas flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100" data-roll-page="true">
    <WorkspaceChrome>
<WorkspaceToolbar>
      {selecting ? <>
        <div role="group" aria-label={t('候选批量操作')} className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap">
          <b aria-live="polite" className="shrink-0 text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-300" title={savingProgress ? t('正在保存 {0}/{1}', [savingProgress.completed, savingProgress.total]) : t('已选 {0} 个候选', [chosen.length])}>{savingProgress ? <><span className="md:hidden">{savingProgress.completed}/{savingProgress.total}</span><span className="hidden md:inline">{t('正在保存 {0}/{1}', [savingProgress.completed, savingProgress.total])}</span></> : <><span className="md:hidden">{chosen.length}</span><span className="hidden md:inline">{t('已选 {0} 个候选', [chosen.length])}</span></>}</b>
          <ToolbarButton aria-label={t('全选筛选结果')} title={t('全选筛选结果')} disabled={frozen} onClick={() => setSelectedIds(new Set(visible.map(candidate => candidate.id)))} className="!px-2.5 max-md:hidden">{t('全选筛选结果')}</ToolbarButton>
          <ToolbarButton aria-label={t('反选筛选结果')} title={t('反选筛选结果')} disabled={frozen} onClick={() => setSelectedIds(new Set(visible.filter(candidate => !selectedIds.has(candidate.id)).map(candidate => candidate.id)))} className="!px-2.5 max-md:hidden">{t('反选筛选结果')}</ToolbarButton>
          <ToolbarButton aria-label={t('选择已收藏图片')} title={t('选择已收藏图片')} disabled={frozen || !visibleFavorited.length} onClick={() => setSelectedIds(new Set(visibleFavorited.map(candidate => candidate.id)))} className="!px-2.5 max-md:hidden">{t('选择已收藏图片')}</ToolbarButton>
          <ToolbarButton aria-label={t('选择未收藏图片')} title={t('选择未收藏图片')} disabled={frozen || !visibleUnfavorited.length} onClick={() => setSelectedIds(new Set(visibleUnfavorited.map(candidate => candidate.id)))} className="!px-2.5 max-md:hidden">{t('选择未收藏图片')}</ToolbarButton>
          <ToolbarButton aria-label={t('清空选择')} title={t('清空选择')} disabled={frozen || !chosen.length} onClick={() => setSelectedIds(new Set())} className="!px-2.5 max-md:hidden">{t('清空选择')}</ToolbarButton>
          <ToolbarButton tone="primary" aria-label={t('保存所选')} title={t('保存所选')} disabled={frozen || !historyReady || !saveable.length} onClick={() => saveChosen()} className="!px-2.5"><Save /><span className="toolbar-responsive-label hidden md:inline">{t('保存所选')}</span></ToolbarButton>
          {!!selectedPending.length && <ToolbarButton data-agent-action="business" aria-label={`${t('生成所选')} · ${Math.min(selectedPending.length, continuousGenerationEnabled ? 24 : 1)}`} title={!continuousGenerationEnabled && selectedPending.length > 1 ? t('连续生成已关闭，本次只生成 1 张，剩余 {0} 张', [selectedPending.length]) : t('生成所选')} disabled={frozen || working || !historyReady} onClick={() => generatePending(selectedPending.map(candidate => candidate.id))} className="!px-2.5"><ImagePlus /><span className="toolbar-responsive-label hidden md:inline">{t('生成所选')} · {Math.min(selectedPending.length, continuousGenerationEnabled ? 24 : 1)}</span><span className="toolbar-responsive-compact md:hidden tabular-nums">{Math.min(selectedPending.length, continuousGenerationEnabled ? 24 : 1)}</span></ToolbarButton>}
          <ToolbarButton tone="danger" aria-label={t('删除所选')} title={t('删除所选')} disabled={frozen || !chosen.length} onClick={() => deleteCandidates(chosen.map(candidate => candidate.id))} className="ml-auto !px-2.5"><Trash2 /><span className="toolbar-responsive-label hidden md:inline">{t('删除所选')}</span></ToolbarButton>
        </div>
        <MobileOverflowMenu className="md:hidden" items={[
          { label: '全选筛选结果', disabled: frozen, onClick: () => setSelectedIds(new Set(visible.map(candidate => candidate.id))) },
          { label: '反选筛选结果', disabled: frozen, onClick: () => setSelectedIds(new Set(visible.filter(candidate => !selectedIds.has(candidate.id)).map(candidate => candidate.id))) },
          { label: '选择已收藏图片', disabled: frozen || !visibleFavorited.length, onClick: () => setSelectedIds(new Set(visibleFavorited.map(candidate => candidate.id))) },
          { label: '选择未收藏图片', disabled: frozen || !visibleUnfavorited.length, onClick: () => setSelectedIds(new Set(visibleUnfavorited.map(candidate => candidate.id))) },
          { label: '清空选择', disabled: frozen || !chosen.length, onClick: () => setSelectedIds(new Set()) },
        ]} />
        <ToolbarButton aria-label={t('退出多选')} title={t('退出多选')} disabled={frozen} onClick={() => { setSelecting(false); setSelectedIds(new Set()); }} className="!px-2.5"><X /><span className="toolbar-responsive-label hidden md:inline">{t('退出多选')}</span></ToolbarButton>
      </> : <>
        {/* 左侧：画风记录入口，与其他列表页的文件夹按钮等高同款；桌面开合左栏，手机打开底部面板。 */}
        {isMobile
          ? <ToolbarButton className="mobile-touch !px-2.5" aria-label={t('切换画风记录')} title={[t('切换画风记录'), currentRecordName || t('新画风记录')].join(' · ')} aria-haspopup="dialog" aria-expanded={mobileRecordMenuOpen} active={mobileRecordMenuOpen} disabled={frozen || preparing} onClick={() => setMobileRecordMenuOpen(true)}>
            <Folder className="h-4 w-4" />
          </ToolbarButton>
          : <ToolbarButton active={recordsExpanded} className="!min-w-0 !max-w-36 !justify-start !px-3 sm:!max-w-48 lg:!max-w-64" aria-label={t('切换画风记录')} title={[t('切换画风记录'), currentRecordName || t('新画风记录')].join(' · ')} aria-expanded={recordsExpanded} disabled={frozen || preparing} onClick={toggleRecords}>
            <Folder className="h-4 w-4" /><span className="min-w-0 truncate">{currentRecordName || t('新画风记录')}</span>
          </ToolbarButton>}
        <ToolbarPopover title={t('筛选与排序')} label={t('筛选')} count={Number(filter !== 'all') + Number(Boolean(roundId)) + Number(sort !== 'new')} disabled={!experiment}>
          {close => <div className="space-y-4">
            <div role="group" aria-label={t('候选筛选')} className="grid grid-cols-2 gap-2">
              {(['all', 'unsaved', 'saved', 'pending', 'favorited'] as const).map(value => <ToolbarButton key={value} className={value === 'all' ? 'col-span-2' : undefined} aria-label={t(ROLL_FILTER_LABELS[value])} active={filter === value} onClick={() => { setFilter(value); setSelectedId(''); selectionAnchor.clearAnchor(); close(); }}>{t(ROLL_FILTER_LABELS[value])}<span className="ml-auto text-xs opacity-60">{value === 'favorited' && (!collectionSettled || !historyReady) ? '—' : experiment ? rollWorkspaceCandidates(experiment, images, { filter: value, roundId, query: '', sort }, undefined, favoriteIds).length : 0}</span></ToolbarButton>)}
            </div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('查看轮次')}<select aria-label={t('查看轮次')} value={roundId} onChange={event => { setRoundId(event.target.value); setSelectedId(''); }} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部轮次')}</option>{[...(experiment?.rounds || [])].reverse().map(item => <option key={item.id} value={item.id}>{`${t('第 {0} 轮', [(experiment?.rounds.indexOf(item) ?? 0) + 1])}${roundConditionLabel(item) ? ` · ${roundConditionLabel(item)}` : ` · ${item.candidateIds.length}`}`}</option>)}</select></label>
            {scopedRound?.snapshot && <ToolbarButton className="w-full" onClick={() => {
              const snapshot = scopedRound.snapshot!;
              setRoundRules({ ...snapshot.rules, maxArtists: Math.max(snapshot.rules.maxArtists, snapshot.pinnedArtists?.length ?? 0) });
              setPinnedArtists(snapshot.pinnedArtists ?? []);
              // 旧快照内联了当时的画师清单；新快照只存来源串 ID（或指向记录级集合），按现有风格串重新提取。
              const sourceChainIds = rollRoundSourceChainIds(snapshot, experiment?.sourceChainSets);
              if (snapshot.chainArtistSource) setChainArtistSource(snapshot.chainArtistSource);
              else if (sourceChainIds) {
                if (!sourceChainIds.length) setChainArtistSource({ chainIds: [], artists: [] });
                else {
                  const restored = buildRollChainArtistSource(chains.filter(chain => sourceChainIds.includes(chain.id)), knownArtists);
                  setChainArtistSource(restored.artists.length ? restored : undefined);
                  if (!restored.artists.length) notify(t('这轮使用的来源风格串已删除'), 'error');
                }
              } else setChainArtistSource(undefined);
              setSampledOnly(Boolean(snapshot.sampledOnly));
              close();
            }}><RotateCcw />{t('沿用这轮条件')}</ToolbarButton>}
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('排序')}<select aria-label={t('候选排序')} value={sort} onChange={event => setSort(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="new">{t('最新生成')}</option><option value="old">{t('最早优先')}</option></select></label>
            <div className="border-t border-gray-200 pt-2.5 dark:border-gray-800">
              <button type="button" className="mobile-touch rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50" onClick={() => { setFilter('all'); setRoundId(''); setSort('new'); setQuery(''); close(); }}>{t('重置筛选')}</button>
            </div>
          </div>}
        </ToolbarPopover>

        {/* 中间：以搜索框为界，左侧浏览筛选、右侧管理与执行操作。 */}
        <ToolbarSearch value={query} trailing={experiment && <ToolbarCountBadge inline total={round && roundPending.length > 0 ? round.candidateIds.length : visible.length} loaded={round && roundPending.length > 0 ? round.candidateIds.filter(id => images.has(id)).length : undefined} />} onChange={event => { setQuery(event.target.value); setSelectedId(''); selectionAnchor.clearAnchor(); }} aria-label={t('搜索画师、中文名或编号')} placeholder={t('搜索画师、中文名或编号')} containerClassName="min-w-0 flex-1 !max-w-none md:!max-w-none" disabled={!experiment} />

        {/* 右侧集群：多选、主 CTA、设置与更多。 */}
        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">

          <ToolbarButton className="max-md:hidden" aria-label={t('批量选择候选')} title={t('多选')} disabled={frozen || !experiment || !visible.length} onClick={() => { setSelectedId(''); setSelecting(true); setSelectedIds(new Set()); }}><ListChecks /><span className="toolbar-responsive-label hidden xl:inline">{t('多选')}</span></ToolbarButton>
          {!working && roundPending.length > 0 && <ToolbarButton className="max-md:hidden" aria-label={t('补齐剩余 {0} 张', [continuousGenerationEnabled ? Math.min(24, roundPending.length) : 1])} title={t('本轮还有 {0} 张没出，点击后确认费用', [roundPending.length])} data-agent-action="business" disabled={frozen || !historyReady} onClick={() => generatePending()}><ImagePlus /><span className="toolbar-responsive-label hidden xl:inline">{t(continuousGenerationEnabled ? '补齐剩余 {0} 张' : '生成本轮 1 张', [continuousGenerationEnabled ? Math.min(24, roundPending.length) : 1])}</span><span className="toolbar-responsive-compact xl:hidden tabular-nums">{continuousGenerationEnabled ? Math.min(24, roundPending.length) : 1}</span></ToolbarButton>}
          <ToolbarButton aria-label={t(experiment ? '再 Roll 一轮' : '开始 Roll')} title={t('本轮将生成 {0} 张，点击后确认费用', [count])} data-agent-action="business" tone="primary" disabled={!canStart} className="mobile-touch !px-2.5 font-bold shadow-sm transition-transform active:scale-95 md:!px-3" onClick={() => runRound()}><Dice5 className="h-4 w-4" /><span className="toolbar-responsive-label hidden md:inline">{t(experiment ? '再 Roll 一轮' : '开始 Roll')}</span></ToolbarButton>
          <div className="flex flex-none items-center max-md:hidden">
          <ToolbarPopover label={t('设置')} title={t('设置')} icon={<Settings2 />} iconOnly iconTone="ghost" disabled={frozen || working} width={360} open={settingsOpen} onOpenChange={open => { setSettingsOpen(open); if (open) void loadQueueInterval(); }}>
            {close => {
              const preferredMultiplier = roundRules.preferredMultiplier ?? 1;
              const preferredSliderMax = Math.max(100, Number.isFinite(preferredMultiplier) ? preferredMultiplier : 100);
              return <div className="max-h-[75dvh] space-y-4 overflow-y-auto pr-0.5">
              <section className="space-y-3">
                <p className="text-micro font-bold text-gray-500 dark:text-gray-400">{t('本轮')}</p>
                <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>{t('本轮张数')}</span><input type="number" aria-label={t('本轮生成张数')} className={`${TOOLBAR_FIELD_CLASS} !mt-0 text-center tabular-nums`} min={1} max={24} value={count} onChange={event => setCount(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} /></label>
              {continuousGenerationEnabled && <>
                <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300" title={t('每张图片保存后等待；0 秒不额外等待')}>
                  <span>{t('生成间隔')}</span>
                  <span className="relative flex min-w-0 items-center">
                    <input type="number" aria-label={t('生成间隔')} min={0} max={3600} step={0.1} inputMode="decimal" value={intervalDraft} disabled={intervalPending}
                      onChange={event => setIntervalDraft(event.target.value)} onBlur={commitInterval}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                      className={`${TOOLBAR_FIELD_CLASS} !mt-0 min-w-0 flex-1 pr-7 text-center tabular-nums`} />
                    <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-xs font-normal text-gray-400">{t('秒')}</span>
                  </span>
                </label>
                <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <span>{t('随机浮动')}</span>
                  <select aria-label={t('间隔随机浮动幅度')} value={intervalJitter} disabled={intervalPending}
                    onChange={event => { const next = validateGenerationIntervalJitter(Number(event.target.value)); if (next !== intervalJitter) void changeInterval(intervalSeconds, next); }}
                    className={`${TOOLBAR_FIELD_CLASS} !mt-0`}>
                    <option value={0}>{t('关闭（固定间隔）')}</option>
                    {[10, 20, 30, 50].map(percent => <option key={percent} value={percent}>{t('±{0}%', [percent])}</option>)}
                  </select>
                </label>
              </>}
              </section>
              <section className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800">
                <p className="text-micro font-bold text-gray-500 dark:text-gray-400">{t('记录设置')}</p>
                <StyleRollRuleFields rules={roundRules} onChange={setRoundRules} disabled={frozen} />
                <div className="space-y-2.5 border-t border-gray-200/80 pt-2.5 dark:border-gray-800/80">
                  <label className="mobile-touch flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-600" disabled={frozen} checked={roundRules.preferredOnly ?? false} onChange={event => setRoundRules({ ...roundRules, preferredOnly: event.target.checked })} />
                    <span>{t('只抽取收藏画师')}</span>
                  </label>
                  <fieldset disabled={frozen || (roundRules.preferredOnly ?? false)} className={`min-w-0 space-y-2.5 ${roundRules.preferredOnly ? 'opacity-50' : ''}`}>
                    <div>
                      <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        <span>{t('偏好抽中倍率')}</span>
                        <span className="relative flex min-w-0 items-center">
                          <input aria-label={t('偏好抽中倍率')} className={`${TOOLBAR_FIELD_CLASS} !mt-0 min-w-0 flex-1 pr-6 text-center tabular-nums`} type="number" min={1} step={0.1} value={preferredMultiplier} onChange={event => setRoundRules({ ...roundRules, preferredMultiplier: Number(event.target.value) })} />
                          <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-xs font-normal text-gray-400">×</span>
                        </span>
                      </label>
                      <input type="range" aria-label={t('偏好抽中倍率滑条')} min={1} max={preferredSliderMax} step={0.1} value={preferredMultiplier} onChange={event => setRoundRules({ ...roundRules, preferredMultiplier: Number(event.target.value) })} className="mobile-touch mt-1 block w-full accent-[var(--nai-accent)]" />
                    </div>
                    <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300">
                      <span>{t('每串偏好保底人数')}</span>
                      <span className="relative flex min-w-0 items-center">
                        <input aria-label={t('每串偏好保底人数')} className={`${TOOLBAR_FIELD_CLASS} !mt-0 min-w-0 flex-1 pr-7 text-center tabular-nums`} type="number" min={0} max={roundRules.maxArtists} step={1} value={roundRules.preferredMinArtists ?? 0} onChange={event => setRoundRules({ ...roundRules, preferredMinArtists: Number(event.target.value) })} />
                        <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-xs font-normal text-gray-400">{t('人')}</span>
                      </span>
                    </label>
                  </fieldset>
                  <label className="mobile-touch flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-600" disabled={frozen} checked={sampledOnly} onChange={event => setSampledOnly(event.target.checked)} />
                    <span>{t('只从有样张的画师中抽取')}</span>
                  </label>
                </div>
                <div className="space-y-1 border-t border-gray-200/80 pt-2.5 dark:border-gray-800/80">
                <ToolbarButton className="w-full !justify-between !px-2" onClick={() => openFromSettings(close, () => setChainTarget(experimentId))}><span className="flex items-center gap-2"><Layers />{t('从风格串提取')}</span><span className="ml-auto text-xs font-normal text-gray-500">{chainArtistSource ? t('已选 {0} 串', [chainArtistSource.chainIds.length]) : t('画师库')}</span><ChevronRight /></ToolbarButton>
                <ToolbarButton className="w-full !justify-between !px-2" onClick={() => openFromSettings(close, () => setArtistDialogOpen(true))}><span className="flex items-center gap-2"><Settings2 />{t('管理画师与偏好')}</span><span className="ml-auto text-xs font-normal text-gray-500">{t('固定 {0} 位', [pinnedArtists.length])}</span><ChevronRight /></ToolbarButton>
                <ToolbarButton className="w-full !justify-between !px-2" onClick={() => openFromSettings(close, () => setSetup({ ...(experiment || makeExperiment()), drawPlan: undefined, artists: artistOverrides, pinnedArtists, chainArtistSource, rules: roundRules, sampledOnly }))}><span className="flex items-center gap-2"><Settings2 />{t('提示词与生成设置')}</span><ChevronRight /></ToolbarButton>
                </div>
              </section>
            </div>;
            }}
          </ToolbarPopover>
          </div>
          {/* 手机顶栏只留画风记录、搜索、筛选、Roll 与更多；设置、多选与提取收进「更多」。 */}
          <MobileOverflowMenu className="md:hidden" items={[
            { label: '设置', icon: <Settings2 />, disabled: frozen || working, onClick: () => { setSettingsOpen(true); void loadQueueInterval(); } },
            ...(roundPending.length > 0 ? [{ label: t('补齐剩余 {0} 张', [continuousGenerationEnabled ? Math.min(24, roundPending.length) : 1]), icon: <ImagePlus />, disabled: frozen || working || !historyReady, onClick: () => generatePending() }] : []),
            { label: '批量选择候选', icon: <ListChecks />, disabled: frozen || !experiment || !visible.length, onClick: () => { setSelectedId(''); setSelecting(true); setSelectedIds(new Set()); } },
            { label: chainArtistSource ? `已选 ${chainArtistSource.chainIds.length} 串` : '从风格串提取', icon: <Layers />, disabled: frozen || working || libraryLoading, onClick: () => setChainTarget(experimentId) },
          ]} />
        </div>
      </>}
    </WorkspaceToolbar>
    </WorkspaceChrome>
    <div className="flex min-h-0 min-w-0 flex-1">
      {!isMobile && recordsExpanded && <RollRecordNavigation records={experiments} selectedId={experimentId} busy={frozen || preparing} loading={loading}
        className="workspace-fixed-pane workspace-category-navigation appearance-panel hidden min-h-0 w-52 flex-none flex-col overflow-hidden border-r border-gray-200 p-3 dark:border-gray-800 md:flex"
        onSelect={id => setExperimentId(id)} onCreate={() => setSetup(makeExperiment())}
        onReload={() => { void reload(); void reloadLibrary(); if (experimentId) void refreshHistory(experimentId); }}
        onRename={(id, name) => renameRecord(id, name)} onDelete={deleteRecord} onPurgeArchived={purgeArchived} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    {(loading || detailLoading) && !experiment ? <PageSpinner className="workspace-scroll-viewport overflow-y-auto" /> : !experiment ? <EmptyState className="workspace-scroll-viewport flex-1 overflow-y-auto p-6" icon={<Dice5 className="h-8 w-8" />} title={t('Roll 出你的画风')} hint={libraryLoading ? t('正在读取画师词库…') : libraryError || t('从画师库抽取组合，一键出图，只保存喜欢的候选。')} action={<div className="flex flex-wrap items-center justify-center gap-2"><ToolbarButton tone="primary" disabled={!canStart} onClick={() => runRound()}><Dice5 />{t('开始第一轮')}</ToolbarButton></div>} />
      : <div className="relative flex min-h-0 flex-1">
        {ROLL_TRIAGE_FILTERS.includes(filter) && !filterReady ? (filter === 'favorited' && collectionFailed ? <div role="alert" className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-gray-500"><span>{t('收藏状态读取失败')}</span><ToolbarButton onClick={() => void loadFavorites()}>{t('重新加载')}</ToolbarButton></div> : historyReady || historyLoading ? <PageSpinner /> : <div role="status" className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">{t('历史暂不可用')}</div>) : <StyleRollGallery experiment={experiment} candidates={visible} images={images} favoriteIds={favoriteIds} preview={livePreview} roundNumbers={roundNumbers} positions={roundPositions} generationState={{ generatingId: generatingCandidateId, nextId: nextPendingId, running: working, paused: session?.state === 'paused', awaiting: Boolean(session?.awaiting), saving: session?.state === 'saving', error: generationError && generationError.experimentId === experiment.id ? generationError : null }} onGenerate={id => { const candidate = experiment.candidates.find(item => item.id === id); if (candidate) void generate([candidate], experiment); }} onPause={pause} onResume={resume} onCancel={cancelSession} onApprove={approve} historyReady={historyReady} historyLoading={historyLoading} selectedId={selectedId} selectionFocusEnabled={selectionFocusEnabled} selecting={selecting} selectedIds={selectedIds} onSelect={setSelectedId} onToggle={id => setSelectedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} onSave={id => saveCandidate(id)} onArchive={id => deleteCandidates([id])} busy={frozen} emptyState={(() => {
          const hasAnyCandidates = experiment.candidates.some(candidate => !candidate.archived);
          if (!hasAnyCandidates) return { title: t('还没有 Roll 候选'), hint: t('调整上方设置后点击开始，即可批量随机探索画风组合。'), actionLabel: t('开始第一轮'), actionPrimary: true, actionDisabled: !canStart, onAction: () => runRound() };
          const hasActiveFilter = filter !== 'all' || Boolean(roundId) || Boolean(query.trim()) || sort !== 'new';
          return { title: t('暂无匹配候选'), hint: hasActiveFilter ? t('当前筛选或搜索条件下没有命中候选。') : undefined, actionLabel: hasActiveFilter ? t('重置筛选') : undefined, onAction: hasActiveFilter ? () => { setFilter('all'); setRoundId(''); setSort('new'); setQuery(''); } : undefined };
        })()} scrollRef={scrollRef} onScroll={() => { selectionAnchor.onScroll(); rememberScroll(); }} notify={notify} />}
        {!isMobile && selected && <aside className="workspace-fixed-pane appearance-surface flex w-84 max-w-[40%] flex-none flex-col border-l border-gray-200/80 bg-white/95 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/95 xl:w-92 shadow-sm"><div className="appearance-surface flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800"><strong className="appearance-surface text-sm">{t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])}</strong><div className="flex items-center gap-1">{detailActions}<IconButton label="关闭候选详情" onClick={() => setSelectedId('')}><X /></IconButton></div></div><div className="appearance-surface min-h-0 flex-1 overflow-y-auto">{detail}</div></aside>}
      </div>}
      </div>
    </div>
    {isMobile && <ImagePreviewPortal><MobileBottomSheet open={mobileRecordMenuOpen} title={t('画风记录')} onClose={() => setMobileRecordMenuOpen(false)}>
      <RollRecordNavigation records={experiments} selectedId={experimentId} mobile busy={frozen || preparing} loading={loading} className="flex min-h-0 flex-col"
        onSelect={id => { setExperimentId(id); setMobileRecordMenuOpen(false); }}
        onCreate={() => openFromSettings(() => setMobileRecordMenuOpen(false), () => setSetup(makeExperiment()))}
        onReload={() => { void reload(); void reloadLibrary(); if (experimentId) void refreshHistory(experimentId); }}
        onRename={(id, name) => renameRecord(id, name)} onDelete={deleteRecord} onPurgeArchived={purgeArchived} />
    </MobileBottomSheet></ImagePreviewPortal>}
    {experiment && isMobile && <ImagePreviewPortal><MobileDetailView open={Boolean(selected) && !setup} title={t('候选 {0}', [experiment.candidates.findIndex(candidate => candidate.id === selectedId) + 1])} onClose={() => setSelectedId('')} actions={detailActions}>{detail}</MobileDetailView></ImagePreviewPortal>}
    {active && chainTarget !== null && chainTarget === experimentId && !setup && <StyleRollChainArtistDialog knownArtists={knownArtists} source={chainArtistSource} blocked={[...blocklist, ...excludedArtistTags]} onConfirm={source => { if (active && !frozen && !working && chainTarget === experimentId) setChainArtistSource(source); }} onClose={() => setChainTarget(null)} />}
    {setup && <StyleRollSetup key={setup.id} initial={setup} initialSection={setup.candidates.length > 0 ? 'template' : 'pool'} libraryCount={library.length} libraryLoading={libraryLoading} libraryError={libraryError} blockedTags={blocklist} library={libraryEntries} onBlockedChange={updateBlocklist} enforceFreeStepLimit={enforceFreeStepLimit} forceEmptySeed={forceEmptySeed} onForceEmptySeedChange={onForceEmptySeedChange} onClose={() => setSetup(null)} onSave={async value => { await store(value); if (!experiments.some(item => item.id === value.id)) setExperimentId(value.id); }} />}
    {artistDialogOpen && <StyleRollArtistDialog enforceFreeStepLimit={enforceFreeStepLimit} library={libraryEntries} loading={libraryLoading} libraryError={libraryError} pinned={pinnedArtists} onPinnedChange={setPinnedArtists} blocked={blocklist} onBlockedChange={updateBlocklist} excluded={excludedArtistTags} onExcludedChange={tags => setArtistOverrides(current => current.map(artist => ({ ...artist, excluded: tags.includes(artist.tag) })))} sampledOnly={sampledOnly} onSampledOnlyChange={setSampledOnly} rules={roundRules} onRulesChange={setRoundRules} onClose={() => setArtistDialogOpen(false)} />}
    {lightbox && <ImageLightbox src={lightbox.imageUrl} generationData={lightbox} favorite={{ imageUrl: lightbox.imageUrl, sourceType: 'history', sourceId: lightbox.id }} notify={notify} onClose={() => setLightbox(null)}>
      {formatGenerationDuration(readGenerationDurationMs(lightbox)) && <div data-image-preview-footer className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs tabular-nums text-white">{new Date(lightbox.createdAt).toLocaleString(getLanguage())} · {formatGenerationDuration(readGenerationDurationMs(lightbox))}</div>}
    </ImageLightbox>}
  </div>;
};
