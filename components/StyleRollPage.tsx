import { confirmationCostScope } from '../services/dailyConfirmation';
import { flushSync } from 'react-dom';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Layers, Dice5, FlaskConical, ImagePlus, ListChecks, LoaderCircle, MoreHorizontal, Pause, Plus, RefreshCw, RotateCcw, Save, Settings2, Trash2, X } from 'lucide-react';
import type { LocalGenItem, PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { createDefaultRollTemplate, DEFAULT_ROLL_RULES, formatRollStyle, getRollArtistRange, getRollPinnedArtists, removeRollCandidates, ROLL_MAX_ARTISTS, rollCandidateCapacity, rollCandidateToChain, rollSourceId, type RollChainArtistSource, type RollCandidate, type RollRules, type RollExperiment } from '../services/styleRoll';
import { beginRollRound, currentRollRound } from '../services/styleRollWorkflow';
import { rollFavoriteMatches, rollPendingCandidates, rollWorkspaceCandidates } from '../services/styleRollWorkspace';
import { ARTIST_SAMPLES_CHANGED, getArtistSampleLibrary, normalizeArtistSampleTag } from '../services/artistSamples';
import { loadArtistSampleUrls } from '../services/artistSampleUrls';
import { getSampledArtistTags } from '../services/artistSampleDrafts';
import type { ArtistDictionaryEntry } from '../services/tagDictionary';
import { loadRollBlocklist, loadRollExperiments, loadRollHistory, ROLL_BLOCKLIST_CHANGED, rollCandidateImages, saveRollBlocklist, saveRollExperiment } from '../services/styleRollApi';
import { normalizeRollArtistKey } from '../services/styleRollSeed';
import { beginRollGeneration, readRollApiKey } from '../services/styleRollGeneration';
import { api, notifyLanAccessRequired, parseErrorResponse } from '../services/api';
import { parseHttpError } from '../services/httpErrors.mjs';
import { applyEstimatorRuntime, estimateV45GenerationCost, formatGenerationCostLabel, useAnlasBudget } from '../services/anlasBudget';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { useNaiRuntime } from '../services/naiRuntime';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { approveGenerationSeries, getGenerationSeriesSession, stopGenerationSeriesSession, subscribeGenerationSeries, type GenerationSeriesSession } from '../services/generationSeries';
import { setGenerationQueuePaused } from '../services/generationTask';
import { localHistory } from '../services/localHistory';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import { createUuid } from '../services/id';
import { useConfirmDialog } from './ConfirmDialog';
import { useAgentCommand } from '../services/agentCommands';
import { EmptyState, IconButton, PageSpinner, ToolbarButton, ToolbarSearch, ToolbarSelect, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { ToolbarCountCaption } from './ToolbarCountCaption';
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
import { collectionRevision, collectionSnapshot, collectionTargetActive, ensureCollection, subscribeCollection } from '../services/collectionFavorites';
import { StyleRollGallery } from './roll/StyleRollGallery';
import { rollChipColor } from './roll/rollPalette';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';

interface Props {
  active: boolean; chains: PromptChain[]; enforceFreeStepLimit: boolean; generationStreamPreview: boolean; selectionFocusEnabled?: boolean;
  continuousGenerationEnabled?: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
  onSaveChain: (chain: PromptChain) => Promise<PromptChain>;
  onOpenChain: (id: string) => void;
  onNavigateToPlayground: () => void;
  onOpenArtistLibrary?: (name?: string) => void;
  initialPinned?: { tags: string[]; token: number } | null;
}
const ROLL_FILTER_LABELS = { all: '全部', unsaved: '已出图但未保存', saved: '已保存', pending: '待生成', favorited: '已收藏', unfavorited: '未收藏', archived: '回收站' } as const;
/** 依赖已出图结果、候选会因保存或收藏离开当前结果的筛选：就绪前显示读取状态，离开时详情衔接下一项。 */
const ROLL_TRIAGE_FILTERS: readonly string[] = ['unsaved', 'favorited', 'unfavorited'];
/** 画师库带入的固定画师只消费一次；页面被保活淘汰后重建也不重复建记录。 */
const artistCountLabel = (rules: RollRules) => rules.minArtists === rules.maxArtists ? String(rules.maxArtists) : `${rules.minArtists}–${rules.maxArtists}`;
const consumedPinnedTokens = new Set<number>();

export const StyleRollPage: React.FC<Props> = ({ active, chains, enforceFreeStepLimit, generationStreamPreview, selectionFocusEnabled = true, continuousGenerationEnabled = true, notify, onSaveChain, onOpenChain, onNavigateToPlayground, onOpenArtistLibrary, initialPinned }) => {
  useLanguage();
  const confirm = useConfirmDialog();
  const runtime = useNaiRuntime(); applyEstimatorRuntime(runtime);
  const subscription = useNovelaiUsage(), budget = useAnlasBudget();
  const [experiments, setExperiments] = useState<RollExperiment[]>([]), [experimentId, setExperimentId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setErrorState] = useState('');
  const [errorSource, setErrorSource] = useState<'request' | 'generation'>('request');
  const setError = useCallback((message: string, source: 'request' | 'generation' = 'request') => { setErrorState(message ? parseHttpError(message).message : ''); setErrorSource(source); }, []);
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
  const [savingProgress, setSavingProgress] = useState<{ completed: number; total: number } | null>(null);
  const [saveFailures, setSaveFailures] = useState<{ experimentId: string; ids: string[]; unprocessed: number; needsReload: boolean; messages: string[] } | null>(null);
  const [recordName, setRecordName] = useState('');
  const [setup, setSetup] = useState<RollExperiment | null>(null), [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
  useEffect(() => { if (setup) setChainTarget(null); }, [setup]);
  const [session, setSession] = useState<GenerationSeriesSession | null>(null), [preparing, setPreparing] = useState(false);
  const [pinnedArtists, setPinnedArtists] = useState<string[]>([]);
  const [chainArtistSource, setChainArtistSource] = useState<RollChainArtistSource | undefined>();
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [sampledOnly, setSampledOnly] = useState(false);
  const [sampledTags, setSampledTags] = useState<Set<string> | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const busyRef = useRef(false), generatingRef = useRef(false), selectedExperimentRef = useRef(experimentId), historySequence = useRef(0);
  const loadingRef = useRef(true), loadSequence = useRef(0);
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
  const experiment = experiments.find(item => item.id === experimentId && !item.archived);
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
  const remaining = experiment ? rollCandidateCapacity(experiment) : 240;
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
  const selectedImage = selected && images.get(selected.id);
  const historyReady = Boolean(experiment && historyReadyId === experiment.id);
  const filterReady = filter === 'favorited' || filter === 'unfavorited' ? historyReady && collectionSettled : filter === 'pending' || filter === 'unsaved' ? historyReady : true;
  const cost = experiment ? estimateV45GenerationCost(experiment.template.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true) : 0;
  const costLabel = !subscription.info ? t(subscription.loading ? '费用确认中…' : '费用未知') : t(formatGenerationCostLabel(cost, experiment?.template.params.model));
  const roundCostLabel = !subscription.info ? t(subscription.loading ? '费用确认中…' : '费用未知') : experiment ? formatGenerationCostLabel(cost * Math.max(1, count), experiment.template.params.model) : '';
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
    try { const values = await loadRollExperiments(); if (!mounted.current || sequence !== loadSequence.current) return; setExperiments(values); setExperimentId(current => values.some(value => value.id === current && !value.archived) ? current : values.find(value => !value.archived)?.id || ''); }
    catch (cause) { if (mounted.current && sequence === loadSequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === loadSequence.current) { loadingRef.current = false; setLoading(false); } }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
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
  const refreshHistory = useCallback(async (id: string) => {
    const sequence = ++historySequence.current;
    if (!id) { setHistory([]); return; }
    setHistoryLoading(true); setHistoryReadyId('');
    try { const values = await loadRollHistory(id); if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) { setHistory(values); setHistoryReadyId(id); } }
    catch (cause) { if (mounted.current && selectedExperimentRef.current === id && sequence === historySequence.current) setError((cause as Error).message); }
    finally { if (mounted.current && sequence === historySequence.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => { setHistory([]); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setRoundId(''); setQuery(''); setFilter('all'); }, [experimentId]);
  useEffect(() => { setRecordName(experiment?.name || ''); }, [experiment?.id, experiment?.name]);
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

  const store = async (next: RollExperiment) => {
    const saved = await saveRollExperiment({ ...next, rules: { ...next.rules, ...getRollArtistRange(next) }, drawPlan: undefined, pinnedArtists: getRollPinnedArtists(next) });
    if (mounted.current) setExperiments(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    return saved;
  };
  const perform = async (action: () => Promise<void>) => {
    if (busyRef.current || loadingRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
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
    if ((roundRules.preferredMultiplier ?? 1) === 1 && !roundRules.preferredMinArtists) return [];
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
  const generate = async (candidates: RollCandidate[] = selected ? [selected] : [], target = experiment, options: { skipConfirmation?: boolean } = {}) => {
    if (!target || target.archived || !candidates.length || candidates.some(candidate => candidate.archived || images.has(candidate.id)) || loadingRef.current || generatingRef.current || session || (target.id === experiment?.id && (historyLoading || !historyReady))) return;
    if (!continuousGenerationEnabled && candidates.length > 1) { setError(t('连续生成已关闭，请开启后生成本轮')); return; }
    const key = readRollApiKey();
    if (!key) { setError(t('请先在“全局设置”中配置 NovelAI API Key')); return; }
    generatingRef.current = true; setPreparing(true); setError('');
    const reportError = (message: string) => {
      if (!mounted.current) return;
      if (selectedExperimentRef.current === target.id) setError(message, 'generation');
      else notify(t('画风记录 {0}：{1}', [target.name, t(parseHttpError(message).message)]), 'error');
    };
    try {
      void subscription.refreshIfStale();
      const eachCost = estimateV45GenerationCost(target.template.params, isActiveOpusSubscription(subscription.info), subscription.info?.usage?.isNegative ?? true), totalCost = eachCost * candidates.length;
      if (totalCost > 0 && !options.skipConfirmation && !await confirm({ rememberKey: 'roll.generate', rememberScope: confirmationCostScope(key, eachCost, candidates.length, budget.remaining, target.template.params.model), title: budget.remaining <= 0 ? 'Anlas 预算已用尽' : '确认生成图片',
        message: t('本轮生成 {0} 张，预计共消耗 {1} Anlas。本地剩余预算：{2}。', [candidates.length, totalCost, budget.remaining]),
        confirmLabel: t('消耗 {0} 点并生成', [totalCost]), ...(totalCost > budget.remaining ? { tone: 'danger' as const } : {}) })) return;
      const started = await beginRollGeneration(target, candidates.length === 1 ? candidates[0] : candidates, key, eachCost, generationStreamPreview && getRuntimeNaiModelInfo(target.template.params.model, runtime).supportsStreamedResponses);      const receipt = await started.settle;
      if (mounted.current) {
        const warnings: string[] = [];
        if (started.session.accountingFailed) warnings.push(t('图片已保存，但本地记账异常，请核对额度后再继续') + (started.session.accountingError ? `：${started.session.accountingError}` : ''));
        if (started.session.cleanupError) warnings.push(t('后台任务清理异常：{0}', [started.session.cleanupError]));
        if (warnings.length) reportError(warnings.join('；'));
        else if (!receipt.success && receipt.outcome !== 'cancelled') reportError(receipt.error || t('生成失败'));
        if (selectedExperimentRef.current === target.id) {
          const saved = started.session.lastSavedItem;
          if (saved) setHistory(current => [...current.filter(item => item.id !== saved.id), saved]);
          await refreshHistory(target.id);
        }
      }
    } catch (cause) { reportError((cause as Error).message); }
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
  });
  const runRound = () => void perform(async () => {
    if (session || generatingRef.current) return;
    if (experiment && (!historyReady || historyLoading)) throw new Error('历史暂不可用，请重新加载后再生成。');
    if (!continuousGenerationEnabled && count > 1) throw new Error('连续生成已关闭，请开启后生成本轮');
    if (chainArtistSource === undefined && (libraryLoading || libraryError || !library.length)) throw new Error(libraryError || '画师词库尚未就绪，请重新加载');
    if (sampledOnly && sampledTags === null) throw new Error('正在读取画师样张，请稍候');
    if (sampledOnly && !effectiveLibrary.length && pinnedArtists.length < roundRules.maxArtists) throw new Error('没有可用的有样张画师，请先在画师库下载图包或生成样张');
    let source = experiment || makeExperiment();
    if (round && !round.closedAt) source = { ...source, rounds: source.rounds.map(item => item.id === round.id ? { ...item, closedAt: Date.now() } : item) };
    source = { ...source, artists: artistOverrides, drawPlan: undefined, pinnedArtists, chainArtistSource, rules: roundRules, sampledOnly };
    const next = beginRollRound(source, sampledOnly ? effectiveLibrary : library, count, { blockedTags: blocklist, sampledOnly, preferredTags: await readPreferredTags() });
    const saved = await store(next), created = currentRollRound(saved)!;
    selectedExperimentRef.current = saved.id; setExperimentId(saved.id); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId('');
    void generate(saved.candidates.filter(candidate => created.candidateIds.includes(candidate.id)), saved);
  });
  const generatePending = (ids?: string[]) => void perform(async () => {
    if (!experiment || !historyReady || historyLoading || session || generatingRef.current) return;
    let source = experiment;
    const pending = rollPendingCandidates(experiment, images, ids).slice(0, continuousGenerationEnabled ? 24 : 1);
    if (!pending.length) return;
    if (ids || !round || round.closedAt) source = await store({ ...experiment, rounds: [...experiment.rounds.map(item => item.id === round?.id && !item.closedAt ? { ...item, closedAt: Date.now() } : item), { id: createUuid(), candidateIds: pending.map(candidate => candidate.id), createdAt: Date.now() }] });
    setSelectedId(''); setSelecting(false); setSelectedIds(new Set()); setRoundId(''); setFilter('all'); void generate(pending, source);
  });
  const resume = () => void perform(async () => {
    if (!session || session.state !== 'paused') return;
    if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成');
    await setGenerationQueuePaused(session.key, false);
  });
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
        const records = await loadRollExperiments(), refreshed = records.find(record => record.id === experiment.id && !record.archived);
        if (!refreshed) throw new Error(t('画风记录暂不可用'));
        next = refreshed;
        if (mounted.current) setExperiments(current => [refreshed, ...current.filter(record => record.id !== refreshed.id)]);
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
              const records = await loadRollExperiments(), refreshed = records.find(record => record.id === next.id && !record.archived);
              if (!refreshed) throw new Error(t('画风记录暂不可用'));
              next = refreshed;
              if (mounted.current) setExperiments(current => [refreshed, ...current.filter(record => record.id !== refreshed.id)]);
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
        if (remainingIds.length) setError(t('已保存 {0} 个候选，{1} 个失败，{2} 个未处理', [successful, failed.length, unprocessed.length]));
        else notify(t('已保存 {0} 个候选', [successful]), 'success');
      }
    } finally { if (mounted.current) setSavingProgress(null); }
  });
  const archiveCandidates = (ids: string[], archived: boolean) => void perform(async () => {
    if (!experiment) return;
    await store({ ...experiment, candidates: experiment.candidates.map(candidate => ids.includes(candidate.id) ? { ...candidate, archived } : candidate) });
    setSelectedIds(new Set()); setSelectedId('');
  });
  const purgeCandidates = (ids: string[]) => void perform(async () => {
    if (!experiment) return;
    const archivedIds = experiment.candidates.filter(candidate => ids.includes(candidate.id) && candidate.archived).map(candidate => candidate.id);
    if (!archivedIds.length) return;
    if (!await confirm({ title: '永久清理候选', message: t('将永久删除 {0} 个已归档候选；它们生成的历史图片与已保存风格串仍保留。', [archivedIds.length]), confirmLabel: t('永久清理'), tone: 'danger' })) return;
    const next = removeRollCandidates(experiment, archivedIds);
    await store(next);
    if (roundId && !next.rounds.some(round => round.id === roundId)) setRoundId('');
    setSelectedIds(new Set()); setSelectedId('');
    notify(t('已永久清理 {0} 个候选', [archivedIds.length]), 'success');
  });
  const archiveRecord = (record: RollExperiment, archived: boolean) => void perform(async () => {
    if (getGenerationSeriesSession(rollSourceId(record.id)) || generatingRef.current) return;
    await store({ ...record, archived });
    if (archived && record.id === experimentId) setExperimentId(experiments.find(item => item.id !== record.id && !item.archived)?.id || '');
    if (!archived) setExperimentId(record.id);
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
  const selectedSavedChain = selected?.savedChainId && chains.some(chain => chain.id === selected.savedChainId);
  const detailIndex = visible.findIndex(candidate => candidate.id === selectedId);
  const detail = experiment && selected ? <div className="space-y-4 p-4">
    <div className="flex items-center justify-between gap-2">
      <IconButton label="上一张" disabled={detailIndex <= 0} onClick={() => setSelectedId(visible[detailIndex - 1].id)}><ChevronLeft /></IconButton>
      <span className="text-xs tabular-nums text-gray-500">{detailIndex + 1} / {visible.length}</span>
      <IconButton label="下一张" disabled={detailIndex < 0 || detailIndex >= visible.length - 1} onClick={() => setSelectedId(visible[detailIndex + 1].id)}><ChevronRight /></IconButton>
    </div>
    {selectedImage ? <PressRevealSurface className="appearance-group group relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950" data-safe-mode-work="true">
      <button className="block w-full" type="button" aria-label={t('放大图片')} onClick={() => setLightbox(selectedImage)}><SmartImage src={selectedImage.imageUrl} alt={t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])} eager className="max-h-[45vh] w-full object-contain" containerClassName="w-full" /></button>
      <ImageCardActions><ImageShareActions imageUrl={selectedImage.imageUrl} filename={`roll-${selectedImage.id}.png`} generationData={selectedImage} favorite={{ imageUrl: selectedImage.imageUrl, sourceType: 'history', sourceId: selectedImage.id }} notify={notify} variant="card" /></ImageCardActions>
    </PressRevealSurface> : <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-700"><ImagePlus className="h-8 w-8" /></div>}
    <div className="appearance-group rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 space-y-2.5 dark:border-gray-800/80 dark:bg-gray-900/40 shadow-inner">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
        <span>{t('画师与权重')}</span>
        <span className="font-mono text-xs">{selected.tags.length} {t('位画师')}</span>
      </div>
      <div className="space-y-2">{selected.tags.map((entry, index) => {
        const chipColor = rollChipColor(index);
        const sampleUrl = sampleUrls.get(normalizeArtistSampleTag(entry.tag));
        const chinese = chineseNames.get(normalizeArtistSampleTag(entry.tag));
        return <div key={entry.tag} className="flex min-w-0 items-center gap-2 text-sm">
          <button type="button" disabled={!onOpenArtistLibrary} onClick={() => onOpenArtistLibrary?.(entry.tag)} title={onOpenArtistLibrary ? t('在画师库查看 {0}', [entry.tag]) : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
            {sampleUrl ? <SmartImage src={sampleUrl} alt="" thumbnailVariant="thumb-160" containerClassName="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg" className="h-full w-full object-cover" previewTransform={sampleUrl.startsWith('/api/artist-samples/image?') ? 'artist-sample-padding-v2' : undefined} /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-micro font-bold text-white" style={{ backgroundColor: chipColor }}>{entry.tag.slice(0, 1)}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-200" title={entry.tag}>{entry.tag}</span>
              {chinese && <span className="block truncate text-micro text-gray-400" title={chinese}>{chinese}</span>}
            </span>
          </button>
          <div className="flex flex-none items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(5, (entry.weight / 3) * 100))}%`, backgroundColor: chipColor }} /></span><span className="w-7 text-right font-mono text-xs font-semibold text-gray-600 dark:text-gray-300">{entry.weight.toFixed(1)}</span></div>
        </div>;
      })}</div>
    </div>
    {!selectedImage && <ToolbarButton data-agent-action="business" tone="primary" className="!h-11 w-full" disabled={busy || loading || preparing || Boolean(session) || historyLoading || !historyReady || selected.archived} onClick={() => void generate()}>{preparing ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}{t('生成图片')} · {costLabel}</ToolbarButton>}
    {!historyLoading && !historyReady && <p className="text-xs text-amber-600 dark:text-amber-400">{t('历史暂不可用，请重新加载后再生成。')}</p>}
    <div className="grid grid-cols-2 gap-2">
      <ToolbarButton disabled={busy || loading || (!selectedImage && !selectedSavedChain)} tone="primary" className="!h-10 rounded-xl font-bold shadow-sm" onClick={selectedSavedChain ? () => onOpenChain(selected.savedChainId!) : selectedImage ? () => saveCandidate() : undefined}><Save />{t(selectedSavedChain ? '打开风格串' : selectedImage ? '存为风格串' : '生成后可保存')}</ToolbarButton>
      <ToolbarButton disabled={busy} className="!h-10 rounded-xl border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 font-bold shadow-sm" onClick={() => { try { sendToLab(); } catch (cause) { setError((cause as Error).message); } }}><FlaskConical />{t('送往实验室')}</ToolbarButton>
    </div>
    <details className="appearance-group rounded-xl border border-gray-100 bg-gray-50/50 p-3 transition-all dark:border-gray-800/80 dark:bg-gray-900/40">
      <summary className="mobile-touch cursor-pointer text-xs font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400">{t('更多操作')}</summary>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <ToolbarButton disabled={busy || loading} onClick={() => void perform(async () => { if (!navigator.clipboard?.writeText) throw new Error('当前环境无法直接复制，请从完整提示词中手动复制'); await navigator.clipboard.writeText(formatRollStyle(selected.tags)); notify('已复制提示词'); })}><Copy />{t('复制画风')}</ToolbarButton>
        <ToolbarButton disabled={busy || loading} onClick={() => archiveCandidates([selected.id], !selected.archived)}>{selected.archived ? <RotateCcw /> : <Trash2 />}{t(selected.archived ? '恢复候选' : '丢弃')}</ToolbarButton>
        <ToolbarButton className={selected.archived ? 'col-span-1' : 'col-span-2'} disabled={busy || loading || selected.archived} onClick={() => createPinnedRecord(selected)}><Dice5 />{t('新建记录 · 固定这些画师')}</ToolbarButton>
        {selected.archived && <ToolbarButton tone="danger" disabled={busy || loading} onClick={() => purgeCandidates([selected.id])}><Trash2 />{t('永久清理')}</ToolbarButton>}
      </div>
    </details>
    <details className="appearance-group rounded-2xl border border-gray-100 bg-gray-50/50 p-3 transition-all dark:border-gray-800/80 dark:bg-gray-900/40 text-xs text-gray-500">
      <summary className="mobile-touch cursor-pointer font-semibold text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400">{t('完整提示词')}</summary>
      <p className="appearance-group mt-2 break-words rounded-xl bg-white p-2.5 font-mono leading-relaxed text-gray-700 shadow-inner dark:bg-gray-950 dark:text-gray-300">{rollCandidateToChain(experiment, selected).basePrompt}</p>
    </details>
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
    }),
  });
  useAgentCommand({
    name: 'run_roll_round', label: '发起 Roll 一轮', description: '按当前规则抽取候选并保存；generate 为真时按权限直接生成或等待页面费用确认。', parameters: { type: 'object', properties: { count: { type: 'number' }, generate: { type: 'boolean' }, sampledOnly: { type: 'boolean' }, agentPermissionMode: { type: 'string' } } }, scope: () => rootRef.current,
    execute: async args => {
      if (session || generatingRef.current) throw new Error('已有图片正在生成，请先等待或取消');
      if (args.generate !== false && !readRollApiKey()) throw new Error('请先在全局设置中配置 NovelAI API Key');
      if (args.generate !== false && experiment && (!historyReady || historyLoading)) throw new Error('历史暂不可用，请重新加载后再生成');
      const requested = Math.max(1, Math.min(24, Math.floor(Number(args.count) || count)));
      if (!continuousGenerationEnabled && requested > 1) throw new Error('连续生成已关闭，本次只能生成 1 张');
      if (chainArtistSource === undefined && (libraryLoading || libraryError || !library.length)) throw new Error(libraryError || '画师词库尚未就绪，请重新加载');
      const useSamples = typeof args.sampledOnly === 'boolean' ? args.sampledOnly : sampledOnly;
      if (useSamples && sampledTags === null) throw new Error('正在读取画师样张，请稍候');
      if (useSamples && !effectiveLibrary.length && pinnedArtists.length < roundRules.maxArtists) throw new Error('没有可用的有样张画师');
      let source = experiment || makeExperiment();
      if (round && !round.closedAt) source = { ...source, rounds: source.rounds.map(item => item.id === round.id ? { ...item, closedAt: Date.now() } : item) };
      source = { ...source, artists: artistOverrides, drawPlan: undefined, pinnedArtists, chainArtistSource, rules: roundRules, sampledOnly: useSamples };
      const next = beginRollRound(source, useSamples ? effectiveLibrary : library, requested, { blockedTags: blocklist, sampledOnly: useSamples, preferredTags: await readPreferredTags() });
      const saved = await store(next), created = currentRollRound(saved)!;
      selectedExperimentRef.current = saved.id; setExperimentId(saved.id); setSelectedId(''); setSelectedIds(new Set()); setSelecting(false); setFilter('all'); setQuery(''); setRoundId('');
      const candidates = saved.candidates.filter(candidate => created.candidateIds.includes(candidate.id));
      if (args.generate !== false) void generate(candidates, saved, { skipConfirmation: args.agentPermissionMode === 'full' });
      return { experimentId: saved.id, roundId: created.id, candidateIds: created.candidateIds, generationStarted: args.generate !== false, note: args.generate !== false ? '已发起生成；费用确认由页面处理，进度用 get_generation_status 读取。' : '候选已抽取并保存，尚未消耗 Anlas。' };
    },
  });
  useAgentCommand({
    name: 'generate_roll_pending', label: '补齐 Roll 候选', description: '为当前轮未出图的候选发起生成，最多 24 张。', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, agentPermissionMode: { type: 'string' } } }, scope: () => rootRef.current,
    execute: async args => {
      if (!experiment || !historyReady || historyLoading || session || generatingRef.current) throw new Error('当前不能发起生成，请先读取状态');
      const ids = Array.isArray(args.ids) ? args.ids.map(value => String(value)).slice(0, 24) : undefined;
      const pending = rollPendingCandidates(experiment, images, ids).slice(0, continuousGenerationEnabled ? 24 : 1);
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
  const livePreview = (generationStreamPreview || session?.state === 'saving') && experiment && session && session.scope === rollSourceId(experiment.id) && session.preview?.image && previewCandidateId
    ? { id: previewCandidateId, image: session.preview.image }
    : null;
  const scopedRound = experiment?.rounds.find(item => item.id === roundId);
  const generatingCandidateId = preparing || (session && ['preparing', 'generating', 'saving'].includes(session.state)) ? previewCandidateId : undefined;
  const selectedPending = experiment ? rollPendingCandidates(experiment, images, chosen.map(candidate => candidate.id)) : [];
  const saveable = chosen.filter(candidate => images.has(candidate.id) && !candidate.archived && !candidate.savedChainId);
  const working = Boolean(session || preparing), frozen = busy || loading;
  const canStart = !frozen && !working && remaining > 0 && (chainArtistSource !== undefined || (!libraryLoading && !libraryError && library.length > 0)) && (!experiment || historyReady) && (!sampledOnly || (sampledTags !== null && (effectiveLibrary.length > 0 || pinnedArtists.length >= roundRules.maxArtists)));
  const roundConditionLabel = (item: RollExperiment['rounds'][number]) => {
    const snapshot = item.snapshot;
    if (!snapshot) return '';
    return `${t('{0} 位画师', [artistCountLabel(snapshot.rules)])} · ${t('固定 {0} 位', [snapshot.pinnedArtists?.length ?? 0])} · ${snapshot.rules.minWeight.toFixed(1)}～${snapshot.rules.maxWeight.toFixed(1)} · ${t('{0} 张', [item.candidateIds.length])}`;
  };
  return <div ref={rootRef} className="workspace-canvas flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100" data-roll-page="true">
    <WorkspaceChrome>
<WorkspaceToolbar>
      {selecting ? <>
        <div role="group" aria-label={t('候选批量操作')} className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
          <b aria-live="polite" className="shrink-0 text-xs text-gray-600 dark:text-gray-300">{savingProgress ? t('正在保存 {0}/{1}', [savingProgress.completed, savingProgress.total]) : t('已选 {0} 个候选', [chosen.length])}</b>
          {filter !== 'archived' && <ToolbarButton tone="primary" disabled={frozen || !historyReady || !saveable.length} onClick={() => saveChosen()}><Save />{t('保存所选')}</ToolbarButton>}
          {!!selectedPending.length && <ToolbarButton data-agent-action="business" disabled={frozen || working || !historyReady} onClick={() => generatePending(selectedPending.map(candidate => candidate.id))} title={!continuousGenerationEnabled && selectedPending.length > 1 ? t('连续生成已关闭，本次只生成 1 张，剩余 {0} 张', [selectedPending.length]) : undefined}><ImagePlus />{t('生成所选')} · {Math.min(selectedPending.length, continuousGenerationEnabled ? 24 : 1)}</ToolbarButton>}
          <ToolbarButton tone={filter === 'archived' ? 'neutral' : 'danger'} disabled={frozen || !chosen.length} onClick={() => archiveCandidates(chosen.map(candidate => candidate.id), filter !== 'archived')}>{filter === 'archived' ? <RotateCcw /> : <Trash2 />}{t(filter === 'archived' ? '恢复所选' : '丢弃所选')}</ToolbarButton>
          {filter === 'archived' && <ToolbarButton tone="danger" disabled={frozen || !chosen.length} onClick={() => purgeCandidates(chosen.map(candidate => candidate.id))}><Trash2 />{t('永久清理所选')}</ToolbarButton>}
          <ToolbarButton disabled={frozen} onClick={() => setSelectedIds(new Set(visible.map(candidate => candidate.id)))}>{t('全选筛选结果')}</ToolbarButton>
          <ToolbarButton disabled={frozen} onClick={() => setSelectedIds(new Set(visible.filter(candidate => !selectedIds.has(candidate.id)).map(candidate => candidate.id)))}>{t('反选筛选结果')}</ToolbarButton>
          <ToolbarButton disabled={frozen || !visibleFavorited.length} onClick={() => setSelectedIds(new Set(visibleFavorited.map(candidate => candidate.id)))}>{t('选择已收藏图片')}</ToolbarButton>
          <ToolbarButton disabled={frozen || !visibleUnfavorited.length} onClick={() => setSelectedIds(new Set(visibleUnfavorited.map(candidate => candidate.id)))}>{t('选择未收藏图片')}</ToolbarButton>
          <ToolbarButton disabled={frozen || !chosen.length} onClick={() => setSelectedIds(new Set())}>{t('清空选择')}</ToolbarButton>
        </div>
        <ToolbarButton aria-label={t('退出多选')} disabled={frozen} onClick={() => { setSelecting(false); setSelectedIds(new Set()); }}><X /><span className="hidden sm:inline">{t('退出多选')}</span></ToolbarButton>
      </> : <div data-roll-toolbar-scroll="true" className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        {/* 左侧：画风记录选择与管理（胶囊卡片，归正核心上下文） */}
        <div className="appearance-group flex shrink-0 items-center gap-1 rounded-xl border border-gray-200/80 bg-gray-100/60 p-0.5 dark:border-gray-800 dark:bg-gray-800/40">
          <span className="hidden pl-2 text-micro font-semibold text-gray-500 dark:text-gray-400 lg:inline">{t('画风记录')}</span>
          <ToolbarSelect label={t('切换画风记录')} containerClassName="max-w-32 sm:max-w-48 lg:max-w-72 min-w-0" className="!h-8 !border-transparent !bg-transparent !pl-2 !text-sm font-semibold" value={experimentId} disabled={frozen || preparing} onChange={event => setExperimentId(event.target.value)}>
            {!experiment && <option value="">{t('新画风记录')}</option>}{experiments.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </ToolbarSelect>
          <ToolbarPopover title={t('画风记录管理')} label={t('管理记录')} icon={<MoreHorizontal className="h-4 w-4" />} iconOnly disabled={frozen || working || selecting} width={320} className="[&_button]:!h-7 [&_button]:!w-7">
            {close => <div className="space-y-3">
              {experiment && <div className="appearance-group rounded-xl bg-gray-50 px-2.5 py-2 text-xs text-gray-500 dark:bg-gray-800/60">{t('{0} 轮 · {1} 张已出图 · {2} 个已存风格串', [experiment.rounds.length, images.size, experiment.candidates.filter(candidate => candidate.savedChainId).length])}</div>}
              {experiment && <form onSubmit={event => { event.preventDefault(); if (!recordName.trim() || recordName.trim() === experiment.name) return; void perform(async () => { await store({ ...experiment, name: recordName.trim() }); close(); }); }}>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('记录名称')}<input aria-label={t('记录名称')} value={recordName} maxLength={120} onChange={event => setRecordName(event.target.value)} className={TOOLBAR_FIELD_CLASS} /></label>
                <ToolbarButton type="submit" className="mt-2 w-full" disabled={!recordName.trim() || recordName.trim() === experiment.name}>{t('重命名')}</ToolbarButton>
              </form>}
              <div className="space-y-1">
                <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => openFromSettings(close, () => setSetup(makeExperiment()))}><Plus />{t('新建记录')}</button>
                <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { void reload(); void reloadLibrary(); if (experimentId) void refreshHistory(experimentId); close(); }}><RefreshCw />{t('重新加载画风记录')}</button>
                {experiment && <button type="button" className={`${TOOLBAR_MENU_CLASS} !text-red-500`} onClick={() => { archiveRecord(experiment, true); close(); }}><Trash2 />{t('将记录移入回收站')}</button>}
              </div>
              {experiments.some(item => item.archived) && <div className="space-y-1 border-t border-gray-200 pt-3 dark:border-gray-800"><p className="mb-2 text-xs text-gray-400">{t('记录回收站')}</p>{experiments.filter(item => item.archived).map(item => <div key={item.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{item.name}</span><button type="button" className="mobile-touch shrink-0 px-2 text-xs text-indigo-500" aria-label={t('恢复记录：{0}', [item.name])} onClick={() => { archiveRecord(item, false); close(); }}>{t('恢复')}</button></div>)}</div>}
            </div>}
          </ToolbarPopover>
        </div>

        {/* 中间：自适应搜索框铺满可用宽度 */}
        <ToolbarSearch value={query} onChange={event => { setQuery(event.target.value); setSelectedId(''); selectionAnchor.clearAnchor(); }} aria-label={t('搜索画师、中文名或编号')} placeholder={t('搜索画师、中文名或编号')} containerClassName="flex-1 !max-w-none md:!max-w-none min-w-[140px] mx-1 md:mx-2" disabled={!experiment} />

        {/* 右侧集群：紧密贴紧屏幕最右端，彻底消除右侧空白 */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
          {/* 筛选与排序 */}
          <ToolbarPopover title={t('筛选与排序')} label={t('筛选')} count={Number(filter !== 'all') + Number(Boolean(roundId)) + Number(sort !== 'new')} disabled={!experiment}>
            {close => <div className="space-y-4">
              <div role="group" aria-label={t('候选筛选')} className="grid grid-cols-2 gap-2">
                {(['all', 'unsaved', 'saved', 'pending', 'favorited', 'unfavorited', 'archived'] as const).map(value => <ToolbarButton key={value} aria-label={t(ROLL_FILTER_LABELS[value])} active={filter === value} onClick={() => { setFilter(value); setSelectedId(''); selectionAnchor.clearAnchor(); close(); }}>{t(ROLL_FILTER_LABELS[value])}<span className="ml-auto text-xs opacity-60">{(value === 'favorited' || value === 'unfavorited') && (!collectionSettled || !historyReady) ? '—' : experiment ? rollWorkspaceCandidates(experiment, images, { filter: value, roundId, query: '', sort }, undefined, favoriteIds).length : 0}</span></ToolbarButton>)}
              </div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('查看轮次')}<select aria-label={t('查看轮次')} value={roundId} onChange={event => { setRoundId(event.target.value); setSelectedId(''); }} className={TOOLBAR_FIELD_CLASS}><option value="">{t('全部轮次')}</option>{[...(experiment?.rounds || [])].reverse().map(item => <option key={item.id} value={item.id}>{`${t('第 {0} 轮', [(experiment?.rounds.indexOf(item) ?? 0) + 1])}${roundConditionLabel(item) ? ` · ${roundConditionLabel(item)}` : ` · ${item.candidateIds.length}`}`}</option>)}</select></label>
              {scopedRound?.snapshot && <ToolbarButton className="w-full" onClick={() => { const snapshot = scopedRound.snapshot!; setRoundRules({ ...snapshot.rules, maxArtists: Math.max(snapshot.rules.maxArtists, snapshot.pinnedArtists?.length ?? 0) }); setPinnedArtists(snapshot.pinnedArtists ?? []); setChainArtistSource(snapshot.chainArtistSource); setSampledOnly(Boolean(snapshot.sampledOnly)); close(); }}><RotateCcw />{t('沿用这轮条件')}</ToolbarButton>}
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('排序')}<select aria-label={t('候选排序')} value={sort} onChange={event => setSort(event.target.value)} className={TOOLBAR_FIELD_CLASS}><option value="new">{t('最新生成')}</option><option value="old">{t('最早优先')}</option></select></label>
              <button type="button" className="mobile-touch text-xs font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { setFilter('all'); setRoundId(''); setSort('new'); setQuery(''); close(); }}>{t('重置筛选')}</button>
            </div>}
          </ToolbarPopover>

          {/* 批量多选 */}
          <ToolbarButton aria-label={t('批量选择候选')} title={t('多选')} disabled={frozen || !experiment} onClick={() => { setSelectedId(''); setSelecting(true); setSelectedIds(new Set()); }}><ListChecks /><span className="hidden xl:inline">{t('多选')}</span></ToolbarButton>
        </div>
      </div>}

      {/* 主 CTA 固定在滚动区外，窄屏也始终可见；摘要只表达本轮，不另加轮次栏。 */}
      {!selecting && <div className="ml-1 flex shrink-0 items-center gap-2">
        <ToolbarButton aria-label={t('从风格串提取')} title={chainArtistSource ? t('已选 {0} 串 · {1} 位画师', [chainArtistSource.chainIds.length, chainArtistSource.artists.length]) : t('从风格串提取')} disabled={frozen || working || libraryLoading} className="!px-2" onClick={() => setChainTarget(experimentId)}><Layers /><span className="flex min-w-0 max-w-[9rem] flex-col items-start sm:max-w-[12rem]"><span className="text-xs leading-4"><span className="sm:hidden">{t('提取画师')}</span><span className="hidden sm:inline">{t('从风格串提取')}</span></span><span className="max-w-full truncate text-micro font-normal leading-3 tabular-nums opacity-70">{chainArtistSource ? t('已选 {0} 串 · {1} 位画师', [chainArtistSource.chainIds.length, chainArtistSource.artists.length]) : t('画师库')}</span></span></ToolbarButton>
        <div className="hidden flex-col items-end leading-tight text-micro text-gray-500 xl:flex">
          <span className="font-semibold text-gray-600 dark:text-gray-300">{t('{0} 张 · {1} 位', [count, artistCountLabel(roundRules)])}</span>
          {experiment && <span className="text-gray-400">{roundCostLabel}</span>}
        </div>
        <div className="flex shrink-0 items-center">
          <ToolbarButton aria-label={t(experiment ? '再 Roll 一轮' : '开始 Roll')} title={remaining <= 0 ? t('本记录候选已满，请在回收站永久清理') : undefined} data-agent-action="business" tone="primary" disabled={!canStart} className="!rounded-r-none !border-r-0 font-bold shadow-sm transition-transform active:scale-95" onClick={() => runRound()}><Dice5 className="h-4 w-4" /><span className="sm:hidden">Roll</span><span className="hidden sm:inline">{t(experiment ? '再 Roll 一轮' : '开始 Roll')}</span></ToolbarButton>
          <ToolbarPopover label={t('本轮设置')} title={t('本轮设置')} icon={<ChevronDown />} disabled={frozen || working} width={360} className="[&_button[aria-haspopup]]:rounded-l-none">
            {close => <div className="space-y-3">
              <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>{t('本轮张数')}</span><input type="number" aria-label={t('本轮生成张数')} className={`${TOOLBAR_FIELD_CLASS} text-center tabular-nums`} min={1} max={24} value={count} onChange={event => setCount(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} /></label>
              <div className="border-t border-gray-200 pt-3 dark:border-gray-800"><StyleRollRuleFields rules={roundRules} onChange={setRoundRules} disabled={frozen} /></div>
              <div className="space-y-1 border-t border-gray-200 pt-2 dark:border-gray-800">
                <ToolbarButton className="w-full !justify-between !px-2" onClick={() => openFromSettings(close, () => setArtistDialogOpen(true))}><span className="flex items-center gap-2"><Settings2 />{t('管理画师与偏好')}</span><span className="ml-auto text-xs font-normal text-gray-500">{t('固定 {0} 位', [pinnedArtists.length])}</span><ChevronRight /></ToolbarButton>
                <ToolbarButton className="w-full !justify-between !px-2" onClick={() => openFromSettings(close, () => setSetup({ ...(experiment || makeExperiment()), drawPlan: undefined, artists: artistOverrides, pinnedArtists, chainArtistSource, rules: roundRules, sampledOnly }))}><span className="flex items-center gap-2"><Settings2 />{t('提示词与生成设置')}</span><ChevronRight /></ToolbarButton>
              </div>
              <div className={`flex items-center justify-between gap-2 text-micro ${remaining <= 0 ? 'text-red-600 dark:text-red-300' : remaining < count ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400'}`}>
                <span>{t('本记录还可 Roll {0} 个候选', [remaining])}</span>
                {remaining < count && <span className="font-semibold">{remaining <= 0 ? t('候选已满') : t('超出剩余容量')}</span>}
              </div>
            </div>}
          </ToolbarPopover>
        </div>
      </div>}
    </WorkspaceToolbar>
    {experiment && filterReady && <ToolbarCountCaption>{filter !== 'all' || roundId || query.trim()
      ? t('匹配 {0} 个候选', [visible.length])
      : t('共 {0} 个候选', [visible.length])}</ToolbarCountCaption>}
    {error && <div role="alert" className="flex flex-none items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><div className="min-w-0 flex-1 break-words"><span>{t(error)}</span>{saveFailures?.experimentId === experimentId && saveFailures.messages.length > 0 && <details open><summary>{t('失败详情')}</summary><ul className="max-h-32 overflow-y-auto">{saveFailures.messages.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}</div>{errorSource !== 'generation' && <button type="button" className="mobile-touch shrink-0 px-2 underline" onClick={() => { void reload(); if (experimentId) void refreshHistory(experimentId); }}>{t('重新加载')}</button>}<IconButton label="关闭错误提示" className="!h-8 !w-8 !border-transparent !bg-transparent !text-current" onClick={() => setError('')}><X /></IconButton></div>}
    {saveFailures?.experimentId === experimentId && saveFailures.ids.length > 0 && <div className="flex flex-none justify-end px-4 py-2"><ToolbarButton disabled={busy || !historyReady} onClick={() => saveChosen(true)}>{t(saveFailures.unprocessed ? '重试待保存项' : '重试失败项')}</ToolbarButton></div>}
    {libraryError && <div role="alert" className="flex flex-none items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><span className="flex-1">{t(libraryError)}</span>{onOpenArtistLibrary && <button type="button" className="mobile-touch px-2 underline" onClick={() => onOpenArtistLibrary()}>{t('打开画师库')}</button>}<button type="button" className="mobile-touch px-2 underline" onClick={() => void reloadLibrary()}>{t('重新加载')}</button></div>}
    {working && <div role="status" className="flex flex-none flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-600 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300"><LoaderCircle className="h-4 w-4 animate-spin" /><span className="min-w-0 flex-1">{t(session?.connectionError || (session?.awaiting ? '等待费用确认' : session?.state === 'paused' ? '任务已暂停' : session?.state === 'saving' ? '正在保存…' : '正在逐张出图…'))}{session ? ` ${session.progress.current}/${session.progress.total}` : ''}</span>{session?.awaiting && <ToolbarButton data-agent-action="business" disabled={busy} onClick={approve}>{t('确认费用')}</ToolbarButton>}{session?.state === 'paused' ? <ToolbarButton data-agent-action="business" disabled={busy} onClick={resume}>{t('继续')}</ToolbarButton> : session && continuousGenerationEnabled && <ToolbarButton disabled={busy} onClick={() => void perform(async () => { if (readRollApiKey() !== session.key) throw new Error('NovelAI Key 已变化，请重新发起生成'); await setGenerationQueuePaused(session.key, true); })}><Pause />{t('暂停')}</ToolbarButton>}{session && <button type="button" disabled={session.stopped} className="mobile-touch px-2 underline" onClick={() => { const current = getGenerationSeriesSession(session.scope); if (current) stopGenerationSeriesSession(current); }}>{t(session.stopped ? '取消中…' : '取消')}</button>}</div>}
    {!working && historyReady && experiment && roundPending.length > 0 && <div className="flex flex-none items-center gap-2 border-b border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 md:px-5"><span className="min-w-0 flex-1">{t('本轮已出图 {0}/{1}', [round!.candidateIds.filter(id => images.has(id)).length, round!.candidateIds.length])}{!continuousGenerationEnabled && roundPending.length > 1 ? ` · ${t('连续生成已关闭，本次生成 1 张')}` : ''}</span><ToolbarButton data-agent-action="business" disabled={frozen || !historyReady} onClick={() => generatePending()}><ImagePlus />{t(continuousGenerationEnabled ? '补齐剩余 {0} 张' : '生成本轮 1 张', [continuousGenerationEnabled ? Math.min(24, roundPending.length) : 1])}</ToolbarButton></div>}
    </WorkspaceChrome>
    {loading && !experiment ? <PageSpinner className="workspace-scroll-viewport flex-1 overflow-y-auto" /> : !experiment ? <EmptyState className="workspace-scroll-viewport flex-1 overflow-y-auto p-6" icon={<Dice5 className="h-8 w-8" />} title={t('Roll 出你的画风')} hint={libraryLoading ? t('正在读取画师词库…') : libraryError || t('从画师库抽取组合，一键出图，只保存喜欢的候选。')} action={<div className="flex flex-wrap items-center justify-center gap-2"><ToolbarButton tone="primary" disabled={!canStart} onClick={() => runRound()}><Dice5 />{t('开始第一轮')}</ToolbarButton></div>} />
      : <div className="relative flex min-h-0 flex-1">
        {ROLL_TRIAGE_FILTERS.includes(filter) && !filterReady ? <div role="status" className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">{(filter === 'favorited' || filter === 'unfavorited') && collectionFailed ? <div role="alert" className="flex items-center gap-2"><span>{t('收藏状态读取失败')}</span><ToolbarButton onClick={() => void loadFavorites()}>{t('重新加载')}</ToolbarButton></div> : t(historyReady || historyLoading ? '加载中…' : '历史暂不可用')}</div> : <StyleRollGallery experiment={experiment} candidates={visible} images={images} favoriteIds={favoriteIds} preview={livePreview} roundNumbers={roundNumbers} generatingId={generatingCandidateId} historyReady={historyReady} historyLoading={historyLoading} selectedId={selectedId} selectionFocusEnabled={selectionFocusEnabled} selecting={selecting} selectedIds={selectedIds} onSelect={setSelectedId} onToggle={id => setSelectedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} onSave={id => saveCandidate(id)} onArchive={id => archiveCandidates([id], !experiment.candidates.find(candidate => candidate.id === id)!.archived)} busy={frozen} scrollRef={scrollRef} onScroll={() => { selectionAnchor.onScroll(); rememberScroll(); }} notify={notify} />}
        {!isMobile && selected && <aside className="workspace-fixed-pane appearance-surface flex w-84 max-w-[40%] flex-none flex-col border-l border-gray-200/80 bg-white/95 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/95 xl:w-92 shadow-sm"><div className="appearance-surface flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800"><strong className="appearance-surface text-sm">{t('候选 {0}', [experiment.candidates.indexOf(selected) + 1])}</strong><IconButton label="关闭候选详情" onClick={() => setSelectedId('')}><X /></IconButton></div><div className="appearance-surface min-h-0 flex-1 overflow-y-auto">{detail}</div></aside>}
      </div>}
    {experiment && isMobile && <ImagePreviewPortal><MobileDetailView open={Boolean(selected) && !setup} title={t('候选 {0}', [experiment.candidates.findIndex(candidate => candidate.id === selectedId) + 1])} onClose={() => setSelectedId('')}>{detail}</MobileDetailView></ImagePreviewPortal>}
    {active && chainTarget !== null && chainTarget === experimentId && !setup && <StyleRollChainArtistDialog knownArtists={knownArtists} source={chainArtistSource} blocked={[...blocklist, ...excludedArtistTags]} onConfirm={source => { if (active && !frozen && !working && chainTarget === experimentId) setChainArtistSource(source); }} onClose={() => setChainTarget(null)} />}
    {setup && <StyleRollSetup key={setup.id} initial={setup} libraryCount={library.length} libraryLoading={libraryLoading} libraryError={libraryError} blockedTags={blocklist} library={libraryEntries} onBlockedChange={updateBlocklist} enforceFreeStepLimit={enforceFreeStepLimit} onClose={() => setSetup(null)} onSave={async value => { await store(value); if (!experiments.some(item => item.id === value.id)) setExperimentId(value.id); }} />}
    {artistDialogOpen && <StyleRollArtistDialog enforceFreeStepLimit={enforceFreeStepLimit} library={libraryEntries} loading={libraryLoading} libraryError={libraryError} pinned={pinnedArtists} onPinnedChange={setPinnedArtists} blocked={blocklist} onBlockedChange={updateBlocklist} excluded={excludedArtistTags} onExcludedChange={tags => setArtistOverrides(current => current.map(artist => ({ ...artist, excluded: tags.includes(artist.tag) })))} sampledOnly={sampledOnly} onSampledOnlyChange={setSampledOnly} rules={roundRules} onRulesChange={setRoundRules} onClose={() => setArtistDialogOpen(false)} />}
    {lightbox && <ImageLightbox src={lightbox.imageUrl} generationData={lightbox} favorite={{ imageUrl: lightbox.imageUrl, sourceType: 'history', sourceId: lightbox.id }} notify={notify} onClose={() => setLightbox(null)} />}
  </div>;
};
