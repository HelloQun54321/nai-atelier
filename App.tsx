import { t, useLanguage } from './services/i18n';

import React, { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { useConfirmDialog } from './components/ConfirmDialog';
import { ImageActivityProvider } from './components/SmartImage';
import { db } from './services/dbService';
import { collectionRevision, collectionSnapshot, subscribeCollection } from './services/collectionFavorites';
import { NAI_ACCOUNTING_ERROR_EVENT } from './services/api';
import { useAgentCommand } from './services/agentCommands';
import { listGenerationSeriesSessions, stopGenerationSeriesSession } from './services/generationSeries';
import { cancelGenerationQueue, getGenerationQueue, setGenerationQueuePaused } from './services/generationTask';
import { useCollectorAppearance } from './services/collectorAppearance';
import { LAB_DEFAULT_PARAMS, mergePromptSections, resolvePromptSections } from './services/labWorkspace';
import { deleteLabWorkspaceSession, getLabWorkspaceSessionKey, markEditorSessionDiscarded } from './services/labWorkspace';
import type { ChainEditorSaveHandle } from './components/ChainEditor';
import {
  applyAppearancePreferences,
  AppearancePreferences,
  loadAppearancePreferences,
  saveAppearancePreferences,
  ThemeMode,
} from './services/appearancePreferences';
import { PromptChain, User, Inspiration, ChainType, NAIParams } from './types';
import { applyContentRollToParams, undoContentRollApply, type ContentRollApplyPlan, type ContentRollEntryTarget } from './services/contentRollApply';
import { contentRead, contentSnapshotOf } from './services/contentRoll';
import { prepareCollectedPrompt } from './services/collectedPrompt';
import { stableOperationId } from './services/operationId';
import { createUuid } from './services/id';
import type { HistoryBrowseQuery } from './services/historyBrowse';
import { ContentLibraryPage, type ContentLibrarySection } from './components/ContentLibraryPage';
import { PromptLibraryContext, PromptLibraryRequestEnabledContext } from './components/PromptLibraryAccess';
import { combinationPicks, createCombinationData, libraryPicksWithSources } from './services/promptLibraryEntries';

const ChainEditor = lazy(() => import('./components/ChainEditor').then(module => ({ default: module.ChainEditor })));
const ArtistLibrary = lazy(() => import('./components/ArtistLibrary').then(module => ({ default: module.ArtistLibrary })));
const InspirationGallery = lazy(() => import('./components/InspirationGallery').then(module => ({ default: module.InspirationGallery })));
const GenHistory = lazy(() => import('./components/GenHistory').then(module => ({ default: module.GenHistory })));
const CreationFootprint = lazy(() => import('./components/CreationFootprint').then(module => ({ default: module.CreationFootprint })));
const AitagGallery = lazy(() => import('./components/AitagGallery').then(module => ({ default: module.AitagGallery })));
const DanbooruGallery = lazy(() => import('./components/DanbooruGallery').then(module => ({ default: module.DanbooruGallery })));
const PixivGallery = lazy(() => import('./components/PixivGallery').then(module => ({ default: module.PixivGallery })));
const CodexGallery = lazy(() => import('./components/CodexGallery').then(module => ({ default: module.CodexGallery })));
const CharacterLibrary = lazy(() => import('./components/CharacterLibrary').then(module => ({ default: module.CharacterLibrary })));
const PromptLibraryHub = lazy(() => import('./components/PromptLibrary').then(module => ({ default: module.PromptLibraryHub })));
const ContentRollWorkspace = lazy(() => import('./components/ContentRollWorkspace').then(module => ({ default: module.ContentRollWorkspace })));
const ContentRollLibrary = lazy(() => import('./components/ContentRollLibrary').then(module => ({ default: module.ContentRollLibrary })));
const StyleRollPage = lazy(() => import('./components/StyleRollPage').then(module => ({ default: module.StyleRollPage })));

type ViewState = 'list' | 'characters' | 'content-library' | 'edit' | 'library' | 'aitag' | 'danbooru' | 'pixiv' | 'codex' | 'inspiration' | 'history' | 'footprint' | 'playground' | 'roll' | 'prompts' | 'content-roll' | 'content-roll-library';
type KeepAliveView = Exclude<ViewState, 'edit'>;

// 手机端实验室返回箭头的落点：只记录内容页，编辑器/实验室本身不作为返回落点。
const LAB_ENTRY_VIEWS: ViewState[] = ['list', 'characters', 'content-library', 'library', 'aitag', 'danbooru', 'pixiv', 'codex', 'inspiration', 'history', 'footprint', 'roll', 'prompts', 'content-roll', 'content-roll-library'];
const chainLibraryView = (type?: ChainType): ViewState => type === 'character' ? 'characters'
  : type && ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera'].includes(type) ? 'content-library' : 'list';

const CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache

const isKeepAliveView = (targetView: ViewState): targetView is KeepAliveView => targetView !== 'edit';

// 缓存的页面事件始终使用最近已提交的状态，废弃的并发渲染不会替换回调。
function useCommittedCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const committed = useRef(callback);
  useLayoutEffect(() => { committed.current = callback; });
  return React.useCallback((...args: Args) => committed.current(...args), []);
}

const App = () => {
  const language = useLanguage();
  const confirmAction = useConfirmDialog();
  const agentViewScope = () => document.querySelector<HTMLElement>('[data-agent-view]');
  const agentApiKey = () => { try { return (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim(); } catch { return ''; } };
  useAgentCommand({
    name: 'get_generation_status', label: '读取生成队列', description: '读取当前工坊所有正在执行或等待的生成任务，含范围、状态、真实进度、已保存历史 ID 与模型；同时读取同 Key 的后端队列。不返回 Key 或任务令牌。', parameters: { type: 'object', properties: {} }, readOnly: true,
    scope: agentViewScope,
    execute: async () => {
      const sessions = listGenerationSeriesSessions().map(({ scope, session }) => ({
        scope, state: session.state, queued: session.queued, stopped: session.stopped,
        progress: session.progress, model: session.model, operation: session.operation,
        historyIds: session.historyIds, awaiting: session.awaiting || null,
        connectionError: session.connectionError || '', accountingFailed: session.accountingFailed === true,
      }));
      const key = agentApiKey();
      let queue: Record<string, unknown> | { error: string } | null = null;
      if (key) {
        try {
          const value = await getGenerationQueue(key);
          queue = {
            intervalSeconds: value.intervalSeconds, busy: value.busy, completed: value.completed, total: value.total,
            paused: value.paused, pausing: value.pausing,
            waiting: Array.isArray(value.waiting) ? value.waiting.map(item => ({ position: item.position, total: item.total, completed: item.completed })) : [],
          };
        } catch (error) { queue = { error: error instanceof Error ? error.message : '队列状态读取失败' }; }
      }
      return { sessions, queue };
    },
  });
  useAgentCommand({
    name: 'control_generation', label: '控制生成任务', description: '暂停、继续或取消当前生成队列。暂停与继续按同一 NovelAI Key 作用于整队；取消按同一 Key 停止当前与等待任务，只停止后续图片，已提交图片仍会保存。', parameters: { type: 'object', properties: { action: { enum: ['pause', 'resume', 'cancel'] }, scope: { type: 'string' } }, required: ['action'] },
    scope: agentViewScope,
    execute: async args => {
      const action = String(args.action || '');
      if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('请选择暂停、继续或取消');
      if (action === 'pause' || action === 'resume') {
        const key = agentApiKey();
        if (!key) throw new Error('请先在全局设置中配置 NovelAI API Key');
        await setGenerationQueuePaused(key, action === 'pause');
        return { action, state: action === 'pause' ? 'paused' : 'resumed', note: '暂停与继续按同一 NovelAI Key 作用于整队；当前图片会先保存。' };
      }
      const sessions = listGenerationSeriesSessions().filter(item => !args.scope || item.scope === args.scope);
      const key = agentApiKey();
      if (!key) throw new Error('请先在全局设置中配置 NovelAI API Key');
      if (sessions.length > 1 && !args.scope) throw new Error('有多个生成任务，请先读取状态并指定 scope');
      for (const item of sessions) stopGenerationSeriesSession(item.session);
      const queue = await cancelGenerationQueue(key);
      return { action, cancelled: queue.cancelled ?? 0, results: sessions.map(item => ({ scope: item.scope, state: 'cancelling' })), note: '取消按同一 NovelAI Key 停止当前与等待任务；只停止后续图片，已提交的图片仍由后台保存。' };
    },
  });
  useAgentCommand({
    name: 'open_settings', label: '打开全局设置', description: '打开全局设置窗口，可定位外观、生成、NovelAI、助手或数据维护分区。', parameters: { type: 'object', properties: { section: { enum: ['appearance', 'generation', 'novelai', 'agent', 'maintenance'] } } }, readOnly: true,
    scope: agentViewScope,
    execute: args => {
      const section = ['appearance', 'generation', 'novelai', 'agent', 'maintenance'].includes(String(args.section)) ? String(args.section) : undefined;
      window.dispatchEvent(new CustomEvent('nai-open-global-settings', { detail: section ? { section } : {} }));
      return { opened: true, section: section || 'home' };
    },
  });
  useAgentCommand({
    name: 'inspect_image_tags', label: '反推图片 Tag', description: '对项目图片或助手已登记的本机图片做本地反推，返回 Danbooru Tag、置信度与中文对照。需要电脑端反推模型已就绪。', parameters: { type: 'object', properties: { source: { enum: ['project', 'local'] }, kind: { enum: ['history', 'inspiration', 'vibe', 'reference', 'chain'] }, id: { type: 'string' }, path: { type: 'string' }, threshold: { type: 'number' }, characterThreshold: { type: 'number' }, model: { type: 'string' } }, required: ['source'] }, readOnly: true,
    scope: agentViewScope,
    execute: async args => {
      const [{ imageTaggerService }, { promptAgentService }] = await Promise.all([import('./services/imageTaggerService'), import('./services/promptAgent')]);
      let blob: Blob;
      if (args.source === 'local') {
        blob = await promptAgentService.getLocalImage(String(args.path || ''));
      } else {
        const bases: Record<string, string> = { history: 'local-history', inspiration: 'inspirations', vibe: 'vibes', reference: 'character-references', chain: 'chains' };
        const kind = String(args.kind || ''), id = String(args.id || '');
        const base = bases[kind];
        if (!base || !id) throw new Error('请提供项目图片类型和 ID');
        const itemResponse = await fetch(`/api/${base}/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!itemResponse.ok) throw new Error('读取项目图片详情失败');
        const payload = await itemResponse.json();
        const item = payload.item || payload;
        const imagePath = kind === 'chain' ? item.previewImage : item.imageUrl || item.originalImageUrl || `/api/${base}/${encodeURIComponent(id)}/image`;
        if (typeof imagePath !== 'string' || !imagePath) throw new Error('该项目资料没有可反推的图片');
        const imageResponse = await fetch(imagePath, { cache: 'no-store' });
        if (!imageResponse.ok) throw new Error('读取项目图片失败');
        blob = await imageResponse.blob();
      }
      if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error('反推只支持 PNG、JPEG 和 WebP 图片');
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      return imageTaggerService.tagFile(new File([blob], `agent-image.${extension}`, { type: blob.type }), {
        threshold: typeof args.threshold === 'number' ? args.threshold : undefined,
        characterThreshold: typeof args.characterThreshold === 'number' ? args.characterThreshold : undefined,
        model: typeof args.model === 'string' ? args.model : undefined,
      });
    },
  });
  useEffect(() => {
    // 各列表已自行恢复滚动，避免浏览器在 popstate 后再用历史旧值覆盖。
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);
  const [view, setView] = useState<ViewState>('list');
  /* 一键 Roll 填入的撤销快照（只保留最近一次；刷新即失效） */
  const [contentRollUndo, setContentRollUndo] = useState<{ params: NAIParams; subject: string; createdRoleId: string } | null>(null);
  /* 从提示词库「载入到一键 Roll」带过来的那一组（工作区挂载时消费一次） */
  const [contentRollSeed, setContentRollSeed] = useState<{ picks: Record<string, unknown>; seed: string; seeds: Record<string, string>; sourceText?: string } | null>(null);
  const [contentRollEditId, setContentRollEditId] = useState('');
  /* 存为内容的稳定操作标识 → 已创建记录 id：重复点击复用同一条，不产生重复记录 */
  const contentRollSaveIndexRef = useRef<Map<string, string>>(new Map());
  /* 一键 Roll 写入 params 的次数：让实验室按这个版本号重新同步编辑区 */
  const [contentRollRevision, setContentRollRevision] = useState(0);
  /* 实验室随机搭配的固定目标；关闭面板或从提示词库重新打开时清除。 */
  const [contentRollEntryTarget, setContentRollEntryTarget] = useState<ContentRollEntryTarget | null>(null);
  /* 提示词库资源分区与临时搭配面板独立，打开面板不切换原列表。 */
  const [contentLibrarySection, setContentLibrarySection] = useState<ContentLibrarySection>('items');
  const [libraryEntryRequest, setLibraryEntryRequest] = useState<PromptChain | null>(null);
  const [contentRollOpen, setContentRollOpen] = useState(false);
  const viewSessionRef = useRef({ view });
  if (viewSessionRef.current.view !== view) viewSessionRef.current = { view };
  useEffect(() => { window.dispatchEvent(new Event('nai-workspace-changed')); }, [view]);
  const [mountedViews, setMountedViews] = useState<KeepAliveView[]>(['list']);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);

  // Playground State
  const lastLabEntryViewRef = useRef<ViewState>('list');
  const [playgroundChain, setPlaygroundChain] = useState<PromptChain | null>(null);
  const [playgroundImportToken, setPlaygroundImportToken] = useState(0);
  const [playgroundAgentOpenToken, setPlaygroundAgentOpenToken] = useState(0);
  const [editorAgentOpenToken, setEditorAgentOpenToken] = useState(0);

  // Data Cache State
  const [inspirationsCache, setInspirationsCache] = useState<Inspiration[] | null>(null);
  const [historyEntry, setHistoryEntry] = useState<{ query: HistoryBrowseQuery; token: number } | null>(null);
  const historyEntryTokenRef = useRef(0);
  const [libraryEntry, setLibraryEntry] = useState<{ query: string; token: number } | null>(null);
  const libraryEntryTokenRef = useRef(0);
  const [rollPinnedEntry, setRollPinnedEntry] = useState<{ tags: string[]; token: number } | null>(null);
  const rollPinnedTokenRef = useRef(0);

  // Cache Timestamps
  const [lastChainFetch, setLastChainFetch] = useState(0);
  const [lastInspirationFetch, setLastInspirationFetch] = useState(0);

  // Dirty State for Navigation Guard
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const editorSaveRef = useRef<ChainEditorSaveHandle | null>(null);

  // Personal-mode owner loaded from the local service.
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // 设计主题、明暗模式和个性化覆盖统一由外观偏好管理。
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(loadAppearancePreferences);
  const themeMode = appearancePreferences.themeMode;
  const setThemeMode = (mode: ThemeMode) => setAppearancePreferences(current => ({ ...current, themeMode: mode }));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  useCollectorAppearance(appearancePreferences, isDark);
  const [safeModeStartup, setSafeModeStartup] = useState(() => localStorage.getItem('nai_safe_mode_startup') !== 'false');
  // 启动偏好唯一决定启动时的安全模式状态：开关开启则每次启动必定进入安全模式，关闭则必定关闭。
  // 会话中的手动开关只影响当前会话；nai_safe_mode 键继续作为当前状态镜像供 Agent 读取，不参与启动判定。
  const [safeMode, setSafeMode] = useState(() => localStorage.getItem('nai_safe_mode_startup') !== 'false');
  const [safeModeHideTitles, setSafeModeHideTitles] = useState(() => localStorage.getItem('nai_safe_mode_hide_titles') !== 'false');

  // Toast State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // 连续 notify 时旧计时器会把新 toast 提前清掉，先清旧再挂新
  const toastTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);
  const accountingWarningUntilRef = useRef(0);
  // useCallback 保持稳定引用：notify 被多处 effect 依赖，每次渲染新建会导致监听反复重挂。
  const notify = React.useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (type === 'success' && Date.now() < accountingWarningUntilRef.current) return;
    setToast({ message, type });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    const onAccountingError = (event: Event) => {
      accountingWarningUntilRef.current = Date.now() + 3000;
      notify((event as CustomEvent<{ message: string }>).detail.message, 'error');
    };
    window.addEventListener(NAI_ACCOUNTING_ERROR_EVENT, onAccountingError);
    return () => window.removeEventListener(NAI_ACCOUNTING_ERROR_EVENT, onAccountingError);
  }, [notify]);

  // Personal mode enters directly without a login session.
  useEffect(() => {
    db.getMe().then(user => {
      setCurrentUser(user);
      refreshData();
    }).catch(() => {
      setDbConfigError(true);
      setLoading(false);
    });
  }, []);

  // Agent 事件桥接：导航实现在下方定义，经 ref 接入以保持监听只注册一次。
  const handleNavigateRef = useRef<(view: ViewState, id?: string, options?: { externalImport?: boolean; refreshData?: boolean }) => Promise<void>>(async () => {});
  useEffect(() => {
    const applyPreferences = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (['light', 'dark', 'system'].includes(detail.themeMode)) setThemeMode(detail.themeMode);
      if (typeof detail.safeMode === 'boolean') setSafeMode(detail.safeMode);
      if (typeof detail.safeModeStartup === 'boolean') setSafeModeStartup(detail.safeModeStartup);
    };
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (['list', 'characters', 'content-library', 'prompts', 'content-roll', 'content-roll-library', 'library', 'aitag', 'danbooru', 'pixiv', 'codex', 'inspiration', 'history', 'footprint', 'playground', 'roll'].includes(detail.view)) {
        void handleNavigateRef.current(detail.view, detail.id, { externalImport: detail.externalImport === true });
      }
    };
    const navigatePage = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !['list', 'characters', 'content-library', 'prompts', 'content-roll', 'content-roll-library', 'library', 'aitag', 'danbooru', 'pixiv', 'codex', 'inspiration', 'history', 'footprint', 'playground', 'roll'].includes(detail.view)) { detail?.reject?.(new Error('页面不存在')); return; }
      void handleNavigateRef.current(detail.view).then(detail.resolve, detail.reject);
    };
    window.addEventListener('nai-agent-ui-preferences', applyPreferences);
    window.addEventListener('nai-agent-navigate', navigate);
    window.addEventListener('nai-agent-page-navigate', navigatePage);
    return () => {
      window.removeEventListener('nai-agent-ui-preferences', applyPreferences);
      window.removeEventListener('nai-agent-navigate', navigate);
      window.removeEventListener('nai-agent-page-navigate', navigatePage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refreshData 并发守卫：创建/删除/Agent 数据变更事件可能同时触发多次刷新，
  // 先完成者的 finally 会提前清掉后者的 loading，响应乱序时还会互相覆盖
  const refreshDataSeqRef = useRef(0);
  const chainCreateRevisionRef = useRef(0);
  const recentCreatedChainsRef = useRef(new Map<string, { chain: PromptChain; revision: number }>());
  const refreshData = useCommittedCallback(async (force = false) => {
    // 加载全部串，供列表过滤和角色库就地引用使用。
    if (!force && chains.length > 0 && Date.now() - lastChainFetch < CACHE_TTL) return;

    const refreshSeq = ++refreshDataSeqRef.current;
    const createRevision = chainCreateRevisionRef.current;
    setLoading(true);
    try {
      const data = await db.getAllChains();
      if (refreshSeq !== refreshDataSeqRef.current) return;
      // 查询期间新建的条目可能不在这个快照里；合并它们，既保留旧资料也不丢新工作台。
      const ids = new Set(data.map(chain => chain.id));
      const additions: PromptChain[] = [];
      for (const [id, entry] of recentCreatedChainsRef.current) {
        if (entry.revision > createRevision && !ids.has(id)) additions.push(entry.chain);
        else recentCreatedChainsRef.current.delete(id);
      }
      setChains([...additions, ...data]);
      setLastChainFetch(Date.now());
      setDbConfigError(false);
      return [...additions, ...data];
    } catch (e: any) {
      if (refreshSeq !== refreshDataSeqRef.current) return;
      if (e.message && e.message.includes('Database not configured')) {
        setDbConfigError(true);
      } else {
        console.error('加载风格串列表失败', e);
        notify('风格串列表加载失败，请稍后重试', 'error');
      }
    } finally {
      if (refreshSeq === refreshDataSeqRef.current) setLoading(false);
    }
  });

  const loadInspirations = useCommittedCallback(async (force = false) => {
    if (!force && inspirationsCache && Date.now() - lastInspirationFetch < CACHE_TTL) return;
    try {
      const data = await db.getAllInspirations(currentUser || undefined);
      setInspirationsCache(data);
      setLastInspirationFetch(Date.now());
    } catch (e) {
      console.error('加载收藏库失败', e);
      notify('收藏库加载失败，请稍后重试', 'error');
    }
  });

  useEffect(() => {
    if (!currentUser) return;
    const updateCollectionSnapshot = () => {
      setInspirationsCache(collectionSnapshot());
      setLastInspirationFetch(Date.now());
    };
    if (collectionRevision()) updateCollectionSnapshot();
    const unsubscribe = subscribeCollection(updateCollectionSnapshot);
    const refreshAgentChanges = () => {
      void refreshData(true);
      void loadInspirations(true);
    };
    window.addEventListener('nai-project-data-changed', refreshAgentChanges);
    const refreshCollection = () => { void loadInspirations(true); };
    window.addEventListener('nai-collection-changed', refreshCollection);
    return () => {
      unsubscribe();
      window.removeEventListener('nai-project-data-changed', refreshAgentChanges);
      window.removeEventListener('nai-collection-changed', refreshCollection);
    };
  }, [currentUser]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    applyAppearancePreferences(appearancePreferences, isDark);
    saveAppearancePreferences(appearancePreferences);
  }, [appearancePreferences, isDark]);

  useEffect(() => {
    const onTheme = (event: Event) => setThemeMode((event as CustomEvent<'light' | 'dark' | 'system'>).detail);
    const onSafeMode = (event: Event) => setSafeMode(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('nai-agent-theme-change', onTheme);
    window.addEventListener('nai-agent-safe-mode-change', onSafeMode);
    return () => {
      window.removeEventListener('nai-agent-theme-change', onTheme);
      window.removeEventListener('nai-agent-safe-mode-change', onSafeMode);
    };
  }, []);

  const resetSafeModeReveals = () => {
    document.querySelectorAll<HTMLElement>('[data-safe-revealed="true"]').forEach(target => {
      delete target.dataset.safeRevealed;
    });
    document.querySelectorAll<HTMLElement>('[data-safe-title-revealed="true"]').forEach(title => {
      delete title.dataset.safeTitleRevealed;
    });
    document.querySelectorAll<HTMLElement>('[data-safe-work-revealed="true"]').forEach(work => {
      delete work.dataset.safeWorkRevealed;
    });
  };

  const toggleSafeMode = () => {
    resetSafeModeReveals();
    setSafeMode(enabled => !enabled);
  };

  useEffect(() => {
    localStorage.setItem('nai_safe_mode_startup', String(safeModeStartup));
  }, [safeModeStartup]);

  useEffect(() => {
    localStorage.setItem('nai_safe_mode', String(safeMode));
    localStorage.setItem('nai_safe_mode_hide_titles', String(safeModeHideTitles));
    resetSafeModeReveals();

    if (!safeMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetSafeModeReveals();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetSafeModeReveals();
    };
    let pointerFrame: number | null = null;
    let pointerPosition = { x: 0, y: 0 };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (pointerFrame !== null) return;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = null;
        document.querySelectorAll<HTMLElement>('[data-safe-revealed="true"]').forEach(target => {
          const rect = target.getBoundingClientRect();
          const isInsideImage = pointerPosition.x >= rect.left && pointerPosition.x <= rect.right
            && pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom;
          if (!isInsideImage) {
            delete target.dataset.safeRevealed;
            const work = target.closest<HTMLElement>('[data-safe-mode-work="true"]');
            if (work) delete work.dataset.safeWorkRevealed;
          }
        });
        document.querySelectorAll<HTMLElement>('[data-safe-title-revealed="true"]').forEach(title => {
          const rect = title.getBoundingClientRect();
          const isInsideTitle = pointerPosition.x >= rect.left && pointerPosition.x <= rect.right
            && pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom;
          if (!isInsideTitle) delete title.dataset.safeTitleRevealed;
        });
      });
    };

    window.addEventListener('blur', resetSafeModeReveals);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('pointermove', handlePointerMove, true);
    return () => {
      if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame);
      window.removeEventListener('blur', resetSafeModeReveals);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('pointermove', handlePointerMove, true);
    };
  }, [safeMode, safeModeHideTitles]);

  useEffect(() => {
    if (safeMode) resetSafeModeReveals();
  }, [view, safeMode]);

  const findSafeModeTarget = (target: HTMLElement, clientX: number, clientY: number): HTMLElement | null => {
    if (target instanceof HTMLImageElement) return target;

    const canvasTarget = target.closest<HTMLElement>('[data-safe-mode-canvas="true"]');
    if (canvasTarget && !target.closest<HTMLElement>('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) {
      return canvasTarget;
    }

    // Interactive controls are a hard lookup boundary. Mobile floating actions
    // (for example Generate) can share a wrapper with a preview thumbnail; the
    // old ancestor walk treated that sibling image as the click target and the
    // safe-mode capture handler swallowed the button click before its onClick
    // could run. Images that actually belong to a button/card still work,
    // because the boundary itself is searched before traversal stops.
    const interactiveBoundary = target.closest<HTMLElement>(
      'button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
    );
    let current: HTMLElement | null = target;
    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
      const candidates = Array.from(current.querySelectorAll<HTMLImageElement>('img'))
        .filter(image => {
          const rect = image.getBoundingClientRect();
          return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        })
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.width * aRect.height - bRect.width * bRect.height;
        });
      if (candidates[0]) return candidates[0];
      if (current === interactiveBoundary) break;
    }
    return null;
  };

  const handleSafeModeClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!safeMode || !(event.target instanceof HTMLElement)) return;
    const title = safeModeHideTitles ? event.target.closest<HTMLElement>('[data-safe-mode-title="true"]') : null;
    if (title) {
      const work = title.closest<HTMLElement>('[data-safe-mode-work="true"]');
      if (title.dataset.safeTitleRevealed === 'true' || work?.dataset.safeWorkRevealed === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      resetSafeModeReveals();
      title.dataset.safeTitleRevealed = 'true';
      return;
    }
    const target = findSafeModeTarget(event.target, event.clientX, event.clientY);
    if (!target) {
      resetSafeModeReveals();
      return;
    }
    if (target.dataset.safeModeIgnore === 'true' || target.dataset.safeRevealed === 'true') return;

    event.preventDefault();
    event.stopPropagation();
    resetSafeModeReveals();
    // SmartImage 会在同一容器内渲染主图 + 渐进升级高清叠加图，CSS 对每张 img
    // 独立判断 data-safe-revealed；只标记一张会导致叠加图残留模糊，必须整组解除。
    const targets: HTMLElement[] = [target];
    if (target instanceof HTMLImageElement && target.parentElement) {
      targets.push(...Array.from(target.parentElement.querySelectorAll<HTMLImageElement>('img')));
    }
    for (const candidate of new Set(targets)) {
      if (candidate.dataset.safeModeIgnore === 'true') continue;
      candidate.dataset.safeRevealed = 'true';
    }
    const work = target.closest<HTMLElement>('[data-safe-mode-work="true"]');
    if (work) work.dataset.safeWorkRevealed = 'true';
  };

  // keep-alive 视图按最近使用保留：桌面端上限 9 = 全部可保留页面常驻，任何切页往返
  // 都不再触发整页卸载重建——配合 SmartImage 隐藏时保留图片，切回任意图库瞬时完整呈现。
  // 手机浏览器内存管理激进（iOS Safari 内存紧张时会整页刷新），维持 4；手机端另有
  // Cache API 持久图片缓存兜底，页面重建时图片仍能从本地缓存秒出。访问时提升到队尾。
  const keepAliveLimit = () => (window.matchMedia('(max-width: 767px)').matches ? 4 : 9);
  const keepViewMounted = (targetView: ViewState) => {
    if (!isKeepAliveView(targetView)) return;
    setMountedViews(prev => {
      const withoutTarget = prev.filter(v => v !== targetView);
      const next = [...withoutTarget, targetView];
      const limit = keepAliveLimit();
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
  };

  const ensurePlayground = () => {
    setPlaygroundChain(previous => previous || {
      id: 'playground',
      name: '生图实验室',
      description: '临时生图实验',
      userId: currentUser?.id || 'local-owner',
      basePrompt: '',
      negativePrompt: '',
      modules: [],
      params: {
        width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined, qualityToggle: true, ucPreset: 4, characters: []
      },
      variableValues: { subject: '' },
      type: 'style',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const handleOpenAgent = () => {
    // Agent is a tool overlay, not a destination. Opening it must never trigger
    // the editor navigation guard or discard the page underneath it.
    if (view === 'edit') {
      window.dispatchEvent(new CustomEvent('nai-open-prompt-agent', { detail: { chainId: selectedId } }));
      return;
    }
    if (playgroundChain && mountedViews.includes('playground')) {
      window.dispatchEvent(new CustomEvent('nai-open-prompt-agent', { detail: { chainId: 'playground' } }));
      return;
    }
    ensurePlayground();
    keepViewMounted('playground');
    setPlaygroundAgentOpenToken(value => value + 1);
  };

  const handleNavigate = useCommittedCallback(async (newView: ViewState, id?: string, options: { externalImport?: boolean; refreshData?: boolean } = {}) => {
    if (isEditorDirty) {
      const editor = editorSaveRef.current;
      let saved = false;
      if (!await confirmAction({
        rememberKey: 'editor.leave',
        rememberScope: { canSave: Boolean(editor?.canSave) },
        title: '有未保存的修改',
        message: editor?.canSave ? '是否保存当前修改后离开？' : '当前修改尚未保存，离开后将会丢失。',
        confirmLabel: '放弃并离开',
        cancelLabel: '继续编辑',
        tone: 'danger',
        onSave: editor?.canSave ? async () => { saved = (await editorSaveRef.current?.save()) ?? false; return saved; } : undefined,
      })) {
        return;
      }
      // User confirmed, reset dirty state
      setIsEditorDirty(false);
      // 「放弃」必须真实生效：清掉该串的实验室工作区草稿（否则重进会恢复“已放弃”的修改），
      // 并标记编辑器卸载时跳过自动补封面。
      if (!saved && view === 'edit' && selectedId) {
        deleteLabWorkspaceSession(getLabWorkspaceSessionKey(selectedId));
        markEditorSessionDiscarded(selectedId);
      }
    }

    // 旧入口统一收进「提示词库」；一键 Roll 仍需要实验室参数作为应用目标。
    setContentRollEntryTarget(null);
    setContentRollOpen(newView === 'content-roll');
    if (newView === 'content-roll') { ensurePlayground(); keepViewMounted('playground'); }
    if (newView === 'prompts' || newView === 'content-roll' || newView === 'content-roll-library') {
      if (newView !== 'content-roll') setContentLibrarySection(newView === 'prompts' ? 'items' : 'saved');
      newView = 'content-library';
    }

    // 记录进入实验室前的内容页，供手机端返回箭头使用；实验室内部切换不覆盖该记录。
    if (newView === 'playground' && LAB_ENTRY_VIEWS.includes(view)) lastLabEntryViewRef.current = view;
    setSelectedId(id);
    setView(newView);
    keepViewMounted(newView);
    if (newView === 'playground' && options.externalImport) {
      setPlaygroundImportToken(prev => prev + 1);
    }
    if (newView === 'playground') ensurePlayground();

    // Auto-load data based on view, respecting cache
    if (['list', 'characters', 'content-library', 'prompts'].includes(newView) && options.refreshData !== false) refreshData();
    if (newView === 'inspiration') loadInspirations();

  });
  handleNavigateRef.current = handleNavigate;

  // 足迹页的排行与热力图都落到同一份真实历史；打开时带上筛选并复用历史页已有查询能力。
  const openHistory = (query?: HistoryBrowseQuery) => {
    setHistoryEntry({ query: query || { sort: 'newest' }, token: ++historyEntryTokenRef.current });
    void handleNavigate('history');
  };
  const openArtistLibrary = (name?: string) => {
    setLibraryEntry({ query: name || '', token: ++libraryEntryTokenRef.current });
    void handleNavigate('library');
  };
  const openRollWithArtists = (tags: string[]) => {
    setRollPinnedEntry({ tags, token: ++rollPinnedTokenRef.current });
    void handleNavigate('roll');
  };

  const handleUpdatePlaygroundChain = async (id: string, updates: Partial<PromptChain>) => {
    setPlaygroundChain(prev => prev ? { ...prev, ...updates } : null);
  };

  // 按计划更新角色及全局分栏，保留旧正文和撤销快照。
  const handleApplyContentRoll = async (plan: ContentRollApplyPlan): Promise<boolean> => {
    /* 先确保实验室这个伪链存在，并以默认参数为基底 —— 否则「从没进过实验室」时写入的 params 会缺模型/尺寸等字段 */
    ensurePlayground();
    const params = playgroundChain?.params || LAB_DEFAULT_PARAMS;
    const subject = playgroundChain?.variableValues?.subject ?? mergePromptSections(params._promptSections);
    const writesGlobal = Object.keys(plan.globalSections).length > 0;
    const base = writesGlobal ? { ...params, _promptSections: resolvePromptSections(params._promptSections, subject) } : params;
    const result = applyContentRollToParams(base, plan, createUuid);
    setContentRollUndo({ params, subject, createdRoleId: result.createdRoleId });
    /* 分区与「主体正文」必须一起提交：resolvePromptSections 要求两者一致，否则场景/镜头会被判为不匹配而回落到补充栏 */
    const merged = mergePromptSections(result.params._promptSections);
    /* 主体正文在 chain.variableValues.subject 上（分区在 params 上），两者必须一起提交 */
    await handleUpdatePlaygroundChain('playground', {
      params: result.params,
      variableValues: { ...(playgroundChain?.variableValues || {}), subject: writesGlobal ? merged : subject },
    });
    setContentRollRevision(value => value + 1);
    return true;
  };
  /* 存为 Roll 内容：字段白名单在 contentSnapshotOf 里，这里只负责落库（type='preset'） */
  const handleSaveContentRoll = async (name: string, picks: Record<string, unknown>, seed: string, seeds: Record<string, string>, copy = false) => {
    const snapshot = contentSnapshotOf({ picks: libraryPicksWithSources(picks as Parameters<typeof libraryPicksWithSources>[0]), seed, seeds, checks: {}, locked: {} } as never, new Date().toISOString());
    if (!snapshot) throw new Error(t('这一组没有可保存的六类内容'));
    if (contentRollEditId && !copy) {
      const existing = chains.find(item => item.id === contentRollEditId);
      if (!existing) throw new Error(t('原组合已不存在，请另存为新组合'));
      await handleUpdateChain(existing.id, { name, params: { ...existing.params, _rollContentSnapshot: snapshot } as NAIParams });
      return existing.id;
    }
    /* 稳定操作标识：重复点击 / 网络重试复用同一条记录，不产生重复 */
    const operationId = stableOperationId('content-roll', { name, seed, picks });
    const existingId = contentRollSaveIndexRef.current.get(operationId);
    if (existingId) {
      await handleUpdateChain(existingId, { name, params: { _rollContentSnapshot: snapshot } as unknown as NAIParams });
      return existingId;
    }
    const created = await createLibraryChain(name, t('一键 Roll 存下的六类内容组合'), 'preset', {
      params: { _rollContentSnapshot: snapshot } as unknown as NAIParams,
    });
    contentRollSaveIndexRef.current.set(operationId, created);
    return created;
  };
  /**
   * 一键 Roll 的内容写进风格串：新建一条，或写进已有串的对应分栏。
   * 写完清掉目标串的编辑器草稿——否则旧草稿会在自动保存时把这些分栏覆盖回「补充」。
   */
  const handleWriteContentRollToChain = async (payload: {
    name: string;
    chain: PromptChain | null;
    params: NAIParams;
    variableValues: Record<string, string>;
  }) => {
    if (payload.chain) {
      await handleUpdateChain(payload.chain.id, { params: payload.params, variableValues: payload.variableValues });
      deleteLabWorkspaceSession(getLabWorkspaceSessionKey(payload.chain.id));
      notify(t('已写入风格串「{0}」，打开该串即可看到分栏', [payload.chain.name]));
      return payload.chain.id;
    }
    const created = await createLibraryChain(payload.name, t('来自一键 Roll 内容'), 'style', {
      params: payload.params,
      variableValues: payload.variableValues,
    });
    notify(t('已新建风格串「{0}」', [payload.name]));
    return created;
  };
  /**
   * 从提示词库载入一组：用**白名单读取**还原（分类负面、约束备注、来源快照都恢复），
   * 而不是只取第一角色的 sections —— 那样会把负面与约束丢掉。
   */
  const handleLoadContentRoll = (chain: PromptChain, selectedRole?: number) => {
    setContentRollEditId(chain.id || '');
    if (!chain.id) { setContentRollSeed({ picks: {}, seed: chain.name || t('新组合'), seeds: {}, sourceText: chain.basePrompt }); void handleNavigate('content-roll'); return; }
    const read = contentRead((chain.params as { _rollContentSnapshot?: unknown } | undefined)?._rollContentSnapshot);
    if (!read.ok) {
      notify(t('这条记录不能按纯内容载入'), 'error');
      return;
    }
    if (read.roles.length > 1 && selectedRole === undefined) { notify(t('请先选择组合中的角色'), 'error'); return; }
    if (read.roles.length > 1) setContentRollEditId('');
    const picks = combinationPicks(chain, selectedRole || 0);
    setContentRollSeed({ picks, seed: chain.name, seeds: {} });
    void handleNavigate('content-roll');
  };

  /* 实验室入口固定落点，面板内只选择参与分类。 */
  const handleContentRollForRole = (index: number) => {
    const character = (playgroundChain?.params?.characters || [])[index];
    if (!character) return;
    setContentRollEntryTarget({ mode: 'existing', id: String(character.id) });
    setContentRollOpen(true);
    keepViewMounted('content-library');
    setView('content-library');
  };
  const handleContentRollForGlobal = () => {
    setContentRollEntryTarget({ mode: 'global' });
    setContentRollOpen(true);
    keepViewMounted('content-library');
    setView('content-library');
  };

  const handleUndoContentRoll = async (): Promise<boolean> => {
    if (!contentRollUndo) return false;
    const restored = undoContentRollApply(playgroundChain?.params, contentRollUndo.params, contentRollUndo.createdRoleId);
    /* 正文与分区必须一起回滚：resolvePromptSections 要求两者一致，否则场景/镜头会被判为不匹配而回落。
       注意：应用前的正文可能是**空串**，也要照样写回 —— 用真值判断会漏掉这种情况，留下新正文。 */
    const restoredSubject = contentRollUndo.subject;
    setContentRollUndo(null);
    await handleUpdatePlaygroundChain('playground', {
      params: restored,
      variableValues: { ...(playgroundChain?.variableValues || {}), subject: restoredSubject },
    });
    setContentRollRevision(value => value + 1);
    return true;
  };

  const handleCreateChain = async (name: string, desc: string, type: ChainType) => {
    setLoading(true);
    try {
      const newId = await db.createChain(name, desc, undefined, type);
      await refreshData(true);
      handleNavigate('edit', newId);
    } catch (e) {
      console.error('创建风格串失败', e);
      notify('创建失败，请稍后重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  const createLibraryChain = async (name: string, description: string, type: ChainType, data?: Partial<PromptChain>) => {
    const saved = await db.createChainWithData(name, description, data, type);
    recentCreatedChainsRef.current.set(saved.id, { chain: saved, revision: ++chainCreateRevisionRef.current });
    setChains(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    setLastChainFetch(0);
    return saved.id;
  };

  const handleForkChain = async (chain: PromptChain, targetType?: ChainType) => {
    const finalType = targetType || chain.type;
    const name = chain.name + (chain.id === 'playground' ? '' : ' (Fork)');
    try {
      await db.createChain(name, chain.description, chain, finalType); // Persist type on fork
      notify(finalType === 'character' ? '已保存到角色库' : '已保存到风格串');
      await refreshData(true);
      // Return to appropriate list based on type
      const targetView = finalType === 'character' ? 'characters' : 'list';
      setView(targetView);
      keepViewMounted(targetView);
    } catch (e) {
      console.error('Fork 风格串失败', e);
      throw e;
    }
  };

  const handleSaveCharacterToLibrary = async (chain: PromptChain) => {
    const saved = await db.createChainWithData(chain.name, chain.description, chain, 'character');
    recentCreatedChainsRef.current.set(saved.id, { chain: saved, revision: ++chainCreateRevisionRef.current });
    setChains(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    setLastChainFetch(0);
    await refreshData(true);
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
    try {
      await db.updateChain(id, updates);
      await refreshData(true);
    } catch (e) {
      console.error('保存风格串失败', e);
      throw e;
    }
  };

  const handleCreateChainFromAitag = async (chain: PromptChain) => {
    const entrySession = viewSessionRef.current;
    const saved = await db.createChainWithData(chain.name, chain.description, chain, 'style');
    recentCreatedChainsRef.current.set(saved.id, { chain: saved, revision: ++chainCreateRevisionRef.current });
    setChains(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    setLastChainFetch(0);
    // 保存期间主动离开来源页时保留用户的位置；当前页保存则等待实际导航完成。
    if (viewSessionRef.current === entrySession) {
      await handleNavigateRef.current('edit', saved.id);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await db.deleteChain(id);
      await refreshData(true);
    } catch (e) {
      console.error('删除风格串失败', e);
      throw e;
    } finally {
      // Stay on current list view
      setLoading(false);
    }
  };

  const handleBulkDelete = async (ids: string[], onProgress: (completed: number) => void) => {
    let errorCount = 0;
    for (const [index, id] of ids.entries()) {
      try { await db.deleteChain(id); } catch { errorCount++; }
      onProgress(index + 1);
    }
    // 删除回执丢失或图片清理失败时，条目可能已删除；只按实际回读保留选择。
    const snapshot = await refreshData(true);
    if (!snapshot) throw new Error(t('删除已提交，但列表刷新失败，请刷新后核对结果'));
    const existing = new Set(snapshot.map(chain => chain.id));
    return { remainingIds: ids.filter(id => existing.has(id)), errorCount };
  };

  const getSelectedChain = () => chains.find(c => c.id === selectedId);
  const handleReturnFromEditor = () => {
    const selectedChain = getSelectedChain();
    // 传 id 作为 returnTargetId：
    // 1. 确保列表渲染批次（visibleCount）包含该卡片及之前的所有卡片，保证容器拥有足够的高度恢复原滚动位置；
    // 2. useKeepAliveScrollRestore 精确恢复离开前的像素级滚动位置；
    // 3. 若目标卡片仍在视口内则不强制居中，若因排序变动离开视口则由 useRestoreListAnchor 兜底滚回可见范围。
    void handleNavigate(chainLibraryView(selectedChain?.type), selectedChain?.id || selectedId, { refreshData: false });
  };

  const renderViewContent = (targetView: ViewState) => {
    if (!currentUser) return null;
    switch (targetView) {
      case 'list':
        return <ChainList
          chains={chains}
          type="style"
          onCreate={handleCreateChain}
          onSelect={(id) => handleNavigate('edit', id)}
          onDelete={handleDelete}
          onBulkDelete={handleBulkDelete}
          onUpdateChain={handleUpdateChain}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onRefresh={() => refreshData(true)}
          onReloadTags={async () => {
            if (!await refreshData(true)) throw new Error(t('风格串列表加载失败，请稍后重试'));
          }}
          isLoading={loading}
          notify={notify}
          isGuest={false}
          returnTargetId={view === 'list' ? selectedId : undefined}
        />;
      case 'content-library':
        return <ContentLibraryPage
          section={contentLibrarySection}
          onSectionChange={setContentLibrarySection}
          active={view === 'content-library'}
          onCapture={async (text, name, category) => {
            const data = prepareCollectedPrompt(text, name, category);
            await createLibraryChain(data.name, '', data.type, data);
            notify(t(category ? '已保存片段' : '已保存原文'));
          }}
          rollOpen={contentRollOpen}
          rollTitle={contentRollEntryTarget ? '随机搭配' : undefined}
          onRollOpenChange={open => {
            if (open) setContentRollEditId('');
            setContentRollEntryTarget(null);
            if (open) { ensurePlayground(); keepViewMounted('playground'); }
            setContentRollOpen(open);
          }}
          items={toolbarSlot => <PromptLibraryHub chains={chains} onCreate={createLibraryChain} onUpdateChain={handleUpdateChain}
            onDelete={handleDelete} notify={notify} embedded toolbarSlot={toolbarSlot} />}
          roll={toolbarSlot => <ContentRollWorkspace active={view === 'content-library' && contentRollOpen} chains={chains} notify={notify} toolbarSlot={toolbarSlot}
            editing={!!contentRollEditId}
            playgroundParams={playgroundChain?.params || null}
            playgroundRoles={(playgroundChain?.params?.characters || []).map((item, index) => ({ id: String(item.id), enabled: item.enabled !== false, label: t('角色 {0}', [String(index + 1)]) })).filter(item => item.enabled)}
            canUndo={!!contentRollUndo}
            onApplyRoll={handleApplyContentRoll}
            onUseCombination={contentRollEntryTarget ? undefined : picks => { const entry = { id: 'current-combination', ...createCombinationData(t('当前组合'), picks) } as PromptChain; void handleNavigate('playground').then(() => setLibraryEntryRequest(entry)); }}
            onUndoApply={handleUndoContentRoll}
            entryTarget={contentRollEntryTarget}
            onSaveRoll={handleSaveContentRoll}
            onWriteRollToChain={handleWriteContentRollToChain}
            seedRecord={contentRollSeed}
            onSeedConsumed={() => setContentRollSeed(null)}
            embedded />}
          saved={toolbarSlot => <ContentRollLibrary active={contentLibrarySection === 'saved'} chains={chains} notify={notify} toolbarSlot={toolbarSlot}
            onLoad={handleLoadContentRoll}
            onRename={async (chain, name) => { await handleUpdateChain(chain.id, { name }); }}
            onDelete={async chain => { await handleDelete(chain.id); }}
            onSetCover={async (chain, url) => { await handleUpdateChain(chain.id, { previewImage: url }); }}
            embedded />}
          originals={toolbarSlot => <ContentRollLibrary section="originals" active={contentLibrarySection === 'originals'} chains={chains} notify={notify} toolbarSlot={toolbarSlot}
            onLoad={handleLoadContentRoll}
            onRename={async (chain, name) => { await handleUpdateChain(chain.id, { name }); }}
            onDelete={async chain => { await handleDelete(chain.id); }}
            onSetCover={async (chain, url) => { await handleUpdateChain(chain.id, { previewImage: url }); }} embedded />}
        />;
      case 'characters':
        return <CharacterLibrary
          chains={chains}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          onCreate={handleCreateChain}
          onSelect={(id) => handleNavigate('edit', id)}
          onDelete={handleDelete}
          onUpdateChain={handleUpdateChain}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          notify={notify}
          returnTargetId={view === 'characters' ? selectedId : undefined}
        />;
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor
          key={editChain.id}
          chain={editChain}
          allChains={chains}
          onUpdateChain={handleUpdateChain}
          onFork={handleForkChain}
          onCreateCharacter={handleSaveCharacterToLibrary}
          setIsDirty={setIsEditorDirty}
          saveRef={editorSaveRef}
          notify={notify}
          agentOpenToken={editorAgentOpenToken}
          tagAssistEnabled={appearancePreferences.tagAssistEnabled}
          promptClassificationEnabled={appearancePreferences.promptClassificationEnabled}
          onPromptClassificationEnabledChange={enabled => setAppearancePreferences(current => ({ ...current, promptClassificationEnabled: enabled }))}
          autoClassifyMetadata={appearancePreferences.autoClassifyMetadata}
          onTagAssistEnabledChange={enabled => setAppearancePreferences(current => ({ ...current, tagAssistEnabled: enabled }))}
          generationStreamPreview={appearancePreferences.generationStreamPreview}
          rememberGenerationSettings={appearancePreferences.rememberGenerationSettings}
          generationMemory={appearancePreferences.generationMemory}
          forceEmptySeed={appearancePreferences.forceEmptySeed}
          onForceEmptySeedChange={enabled => setAppearancePreferences(current => ({ ...current, forceEmptySeed: enabled }))}
          enforceFreeStepLimit={appearancePreferences.enforceFreeStepLimit}
          continuousGenerationEnabled={appearancePreferences.continuousGenerationEnabled}
          labPageLayouts={appearancePreferences.labPageLayouts}
          safeMode={safeMode}
          onBack={handleReturnFromEditor}
        />;
      case 'library':
        return <ArtistLibrary
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onOpenRoll={openRollWithArtists}
          initialSearch={libraryEntry}
        />;
      case 'aitag':
        return <AitagGallery
          active={view === 'aitag'}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onCreateArtistChain={handleCreateChainFromAitag}
          onRefreshInspiration={() => loadInspirations(true)}
          chains={chains}
        />;
      case 'danbooru':
        return <DanbooruGallery
          active={view === 'danbooru'}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onRefreshInspiration={() => loadInspirations(true)}
        />;
      case 'pixiv':
        return <PixivGallery
          active={view === 'pixiv'}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onRefreshInspiration={() => loadInspirations(true)}
        />;
      case 'codex':
        return <CodexGallery active={view === 'codex'} selectionFocusEnabled={appearancePreferences.gallerySelectionFocus} currentUser={currentUser} notify={notify} onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })} onCreateArtistChain={handleCreateChainFromAitag} />;
      case 'inspiration':
        return <InspirationGallery
          currentUser={currentUser}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          inspirationsData={inspirationsCache}
          onRefresh={() => loadInspirations(true)}
          onImportRefresh={async () => {
            const items = await db.getAllInspirations(currentUser);
            setInspirationsCache(items); setLastInspirationFetch(Date.now());
          }}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          chains={chains}
          onCreateArtistChain={handleCreateChainFromAitag}
          onSetChainCover={async (chainId, imageUrl) => {
            await db.updateChain(chainId, { previewImage: imageUrl });
            await refreshData(true);
          }}
        />;
      case 'footprint':
        return <CreationFootprint
          active={view === 'footprint'}
          chains={chains}
          onOpenHistory={openHistory}
          onOpenCollection={() => void handleNavigate('inspiration')}
          onOpenLab={() => void handleNavigate('playground')}
          onOpenRoll={() => void handleNavigate('roll')}
        />;
      case 'history':
        return <GenHistory currentUser={currentUser} chains={chains} notify={notify} initialQuery={historyEntry} onOpenFootprint={() => void handleNavigate('footprint')} onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })} onRefreshInspiration={() => loadInspirations(true)} />;
      case 'roll':
        return <StyleRollPage active={view === 'roll'} chains={chains} notify={notify}
          continuousGenerationEnabled={appearancePreferences.continuousGenerationEnabled}
          selectionFocusEnabled={appearancePreferences.gallerySelectionFocus}
          enforceFreeStepLimit={appearancePreferences.enforceFreeStepLimit}
          generationStreamPreview={appearancePreferences.generationStreamPreview}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onOpenArtistLibrary={openArtistLibrary}
          initialPinned={rollPinnedEntry}
          onOpenChain={id => { void handleNavigate('edit', id); }}
          onSaveChain={async chain => {
            const saved = await db.createChainWithData(chain.name, chain.description, chain, 'style');
            recentCreatedChainsRef.current.set(saved.id, { chain: saved, revision: ++chainCreateRevisionRef.current });
            setChains(current => [saved, ...current.filter(item => item.id !== saved.id)]);
            setLastChainFetch(0);
            return saved;
          }} />;
      case 'playground':
        if (!playgroundChain) return <div>Loading...</div>;
        return <PromptLibraryRequestEnabledContext.Provider value={view === 'playground'}><ChainEditor
          chain={playgroundChain}
          allChains={chains}
          onUpdateChain={handleUpdatePlaygroundChain}
          onFork={handleForkChain}
          onCreateCharacter={handleSaveCharacterToLibrary}
          setIsDirty={() => { }}
          notify={notify}
          externalImportToken={playgroundImportToken}
          sectionsRevision={contentRollRevision}
          onContentRollForRole={handleContentRollForRole}
          onContentRollForGlobal={handleContentRollForGlobal}
          agentOpenToken={playgroundAgentOpenToken}
          tagAssistEnabled={appearancePreferences.tagAssistEnabled}
          promptClassificationEnabled={appearancePreferences.promptClassificationEnabled}
          onPromptClassificationEnabledChange={enabled => setAppearancePreferences(current => ({ ...current, promptClassificationEnabled: enabled }))}
          autoClassifyMetadata={appearancePreferences.autoClassifyMetadata}
          onTagAssistEnabledChange={enabled => setAppearancePreferences(current => ({ ...current, tagAssistEnabled: enabled }))}
          generationStreamPreview={appearancePreferences.generationStreamPreview}
          rememberGenerationSettings={appearancePreferences.rememberGenerationSettings}
          generationMemory={appearancePreferences.generationMemory}
          forceEmptySeed={appearancePreferences.forceEmptySeed}
          onForceEmptySeedChange={enabled => setAppearancePreferences(current => ({ ...current, forceEmptySeed: enabled }))}
          enforceFreeStepLimit={appearancePreferences.enforceFreeStepLimit}
          continuousGenerationEnabled={appearancePreferences.continuousGenerationEnabled}
          labPageLayouts={appearancePreferences.labPageLayouts}
          safeMode={safeMode}
          onBack={() => handleNavigate(lastLabEntryViewRef.current)}
        /></PromptLibraryRequestEnabledContext.Provider>;
      default:
        return <div>Unknown View</div>;
    }
  };

  // 页面元素只随实际资料、外观和激活状态更新，实验室输入及 toast 不重建其他保活页。
  const cachedViews = useMemo(() => Object.fromEntries(
    (['list', 'characters', 'library', 'aitag', 'danbooru', 'pixiv', 'codex', 'inspiration', 'footprint', 'history', 'roll'] as const)
      .map(target => [target, renderViewContent(target)]),
  ), [view, chains, currentUser, loading, selectedId, appearancePreferences, inspirationsCache, historyEntry, libraryEntry, rollPinnedEntry, language]);
  const playgroundContent = useMemo(() => renderViewContent('playground'), [
    view, playgroundChain, chains, currentUser, playgroundImportToken, contentRollRevision, playgroundAgentOpenToken,
    appearancePreferences, safeMode, language,
  ]);
  const contentLibraryContent = useMemo(() => renderViewContent('content-library'), [
    view, chains, currentUser, contentLibrarySection, contentRollOpen, contentRollEntryTarget, contentRollEditId,
    playgroundChain, contentRollUndo, contentRollSeed, language,
  ]);
  const saveLibraryEntry = useCommittedCallback(async (data: Partial<PromptChain>) => {
    if (data.id) { await handleUpdateChain(data.id, data); return; }
    const id = await createLibraryChain(data.name || '', data.description || '', data.type || 'preset', data);
    if (!id) throw new Error(t('保存失败，请稍后重试'));
    notify(t('已存入提示词库'));
  });
  const useLibraryEntry = useCommittedCallback((entry: PromptChain) => { void handleNavigate('playground').then(() => setLibraryEntryRequest(entry)); });
  const clearLibraryRequest = React.useCallback(() => setLibraryEntryRequest(null), []);
  const promptLibrary = useMemo(() => ({ chains, requestedEntry: libraryEntryRequest, clearRequest: clearLibraryRequest,
    save: saveLibraryEntry, useEntry: useLibraryEntry,
  }), [chains, libraryEntryRequest, clearLibraryRequest, saveLibraryEntry, useLibraryEntry]);

  if (!currentUser && !dbConfigError) {
    return <div className="workspace-canvas min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-500">{t("正在启动本地应用…")}</div>;
  }

  // --- Database Setup Guide ---
  if (dbConfigError) {
    return (
      <div className="workspace-canvas min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans dark:text-white">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">{t("本地服务未连接")}</h2>
          <p>{t("请启动本地服务")}</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded">{t("刷新")}</button>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  const renderContent = () => {
    const viewsToRender = isKeepAliveView(view) && !mountedViews.includes(view)
      ? [...mountedViews, view]
      : mountedViews;

    return (
      <>
        <div className={view === 'edit' ? 'hidden' : 'flex flex-1 min-h-0 flex-col overflow-hidden'}>
          {viewsToRender.map(mountedView => (
            <div
              key={mountedView}
              className={view === mountedView ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'}
            >
              <ImageActivityProvider active={view === mountedView}>
                {mountedView === 'playground' ? playgroundContent : mountedView === 'content-library' ? contentLibraryContent : cachedViews[mountedView]}
              </ImageActivityProvider>
            </div>
          ))}
        </div>
        {view === 'edit' && renderViewContent('edit')}
      </>
    );
  };

  const getActiveView = (): ViewState => {
    if (view === 'edit') {
      return chainLibraryView(getSelectedChain()?.type);
    }
    return view;
  };

  return (
    <div
      data-agent-view={view}
      className={`agent-stage flex flex-col h-screen ${safeMode ? 'safe-mode' : ''} ${safeMode && safeModeHideTitles ? 'safe-mode-hide-titles' : ''}`}
      onClickCapture={handleSafeModeClickCapture}
    >
      <PromptLibraryContext.Provider value={promptLibrary}>
      <Layout
        onNavigate={handleNavigate}
        currentView={view}
        activeView={getActiveView()}
        isDark={isDark}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        appearancePreferences={appearancePreferences}
        setAppearancePreferences={setAppearancePreferences}
        safeMode={safeMode}
        safeModeStartup={safeModeStartup}
        safeModeHideTitles={safeModeHideTitles}
        setSafeModeStartup={setSafeModeStartup}
        setSafeModeHideTitles={setSafeModeHideTitles}
        toggleSafeMode={toggleSafeMode}
        toast={toast}
        hideNav={view === 'edit' || view === 'playground'}
        notify={notify}
        onOpenAgent={handleOpenAgent}
      >
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">{t("正在加载工作区…")}</div>}>
          {renderContent()}
        </Suspense>
      </Layout>
      </PromptLibraryContext.Provider>
    </div>
  );
};

export default App;
