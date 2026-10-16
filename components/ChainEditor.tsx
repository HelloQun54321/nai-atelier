import { t, useLanguage, getLanguage } from '../services/i18n';
import { ImageLightbox } from './ImageLightbox';
import { agentDraftFingerprint } from '../services/promptAgentCoordinator';
import { promptAgentService } from '../services/promptAgent';
import { agentOperationError, agentGenerationFailure, normalizeAgentGenerationResult, validateGenerationCount, validateGenerationPlacement } from '../services/agentOperation.mjs';
import { approveGenerationSeries, beginGenerationSeries, getGenerationSeriesSession, getQueuedGenerationSeries, stopGenerationSeriesSession, subscribeGenerationSeries, type GenerationSeriesSession } from '../services/generationSeries';
import { cancelGenerationJob, type GenerationJobDescriptor, type GenerationJobState } from '../services/generationJob';
import { getGenerationQueue, setGenerationQueuePaused, setGenerationInterval, type GenerationPlacement, type GenerationQueueSnapshot } from '../services/generationTask';
import { GenerationCountControl } from './GenerationCountControl';
import { AgentDraftReview } from './AgentDraftReview';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GenerationMode, ImageEditMetadata, ImageEditOperation, PromptChain, PromptModule, CharacterParams, NAIParams, LocalGenItem, PromptAgentDraft, PromptAgentGenerationResult, LabImageEditDraft, LabWorkspaceSession } from '../types';
import { compilePrompt } from '../services/promptUtils';
import { buildGenerationJobDescriptor } from '../services/naiService';
import { localHistory } from '../services/localHistory';
import { api } from '../services/api';
import { extractMetadata, parseNovelAIMetadata, IMPORT_SESSION_KEY, PendingImportData, PromptFragmentImport, BaseImageImport, extractRawMetadataFromJsonText } from '../services/metadataService';
import { ChainEditorParams } from './ChainEditorParams';
import { ChainEditorPreview } from './ChainEditorPreview';
import { ImagePreviewActions } from './ImagePreviewActions';
import { MobileGenerationResources } from './MobileGenerationResources';
import { ImageEditPanel, ImageEditRequest } from './ImageEditPanel';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { dataUrlToBlob } from '../services/imageEdit';
import { useConfirmDialog } from './ConfirmDialog';
import { SmartImage } from './SmartImage';
import { createUuid } from '../services/id';
import { VibeManager } from './VibeManager';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { buildImageEditMetadataPatch, buildPromptFragmentPatch, canSaveLabModeToLibrary } from '../services/labModeTools';
import { normalizeVibeSelections } from '../services/vibeUtils';
import { LabPageLayouts } from '../services/appearancePreferences';
import { isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { applyNaiModelSettings, getRuntimeNaiModelInfo, isNaiMediumModel } from '../services/naiModels';
import { estimateImageEditCost, estimateV45GenerationCost, applyEstimatorRuntime, formatGenerationCostLabel, useAnlasBudget } from '../services/anlasBudget';
import { cleanupLabWorkspaceAssets, consumeEditorSessionDiscarded, createLabImageEditDraft, createLabWorkspaceSession, dataUrlToWorkspaceAsset, deleteLabWorkspaceAsset, getLabWorkspaceAssetId, getLabWorkspaceSessionKey, LAB_DEFAULT_PARAMS, openLabWorkspaceSession, readLabWorkspaceAsset, saveLabWorkspaceSession, saveLabWorkspaceAsset, blobToDataUrl, getLabModeLabel, normalizeParams } from '../services/labWorkspace';
import { DEFAULT_NAI_RUNTIME, useNaiRuntime, isNaiRuntimeSyncUnhealthy, describeNaiRuntimeSyncProblem } from '../services/naiRuntime';
import { splitNovelAiPrompt } from '../services/promptImport';
import { decideCurrentPreviewCover } from '../services/chainCover';
import { LabModuleSection } from './LabModuleSection';
import { FileDown } from 'lucide-react';
import { parsePromptTags, resolvePromptTranslations, translateMissingPromptTags } from '../services/tagTranslations';
import { UNTESTED_CHAIN_TAG } from './DesignSystem';
import { ChainEditorHeader } from './chain/ChainEditorHeader';
import { ChainEditorPromptInputs } from './chain/ChainEditorPromptInputs';
import { ChainEditorCharacters } from './chain/ChainEditorCharacters';
import { ChainEditorForkModal } from './chain/ChainEditorForkModal';
import { PresetSection, PresetSource, PresetSourceBadge, PromptCopyButton, PromptClearButton, PromptAgentOverlayController } from './chain/PresetSourceBadges';

export interface ChainEditorSaveHandle {
    canSave: boolean;
    save: () => Promise<boolean>;
}

interface ChainEditorProps {
    chain: PromptChain;
    allChains: PromptChain[]; // 角色卡就地引用角色库。
    onUpdateChain: (id: string, updates: Partial<PromptChain>) => Promise<void> | void;
    onFork: (chain: PromptChain, targetType?: 'style' | 'character') => Promise<void> | void;
    onCreateCharacter?: (chain: PromptChain) => Promise<void>;
    setIsDirty: (isDirty: boolean) => void;
    saveRef?: React.Ref<ChainEditorSaveHandle>;
    notify: (msg: string, type?: 'success' | 'error') => void;
    externalImportToken?: number;
    agentOpenToken?: number;
    tagAssistEnabled: boolean;
    onTagAssistEnabledChange: (enabled: boolean) => void;
    generationStreamPreview: boolean;
    forceEmptySeed?: boolean;
    onForceEmptySeedChange?: (enabled: boolean) => void;
    enforceFreeStepLimit?: boolean;
    continuousGenerationEnabled?: boolean;
    labPageLayouts: LabPageLayouts;
    safeMode: boolean;
    onBack: () => void | Promise<void>;
}

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, allChains, onUpdateChain, onFork, onCreateCharacter, setIsDirty, saveRef, notify, externalImportToken, agentOpenToken, tagAssistEnabled, onTagAssistEnabledChange, generationStreamPreview, forceEmptySeed = false, onForceEmptySeedChange, enforceFreeStepLimit = true, continuousGenerationEnabled = true, labPageLayouts, safeMode, onBack }) => {
  useLanguage();
    const [keyboardOffset, setKeyboardOffset] = useState(0);
    const confirmAction = useConfirmDialog();

    // Distinguish Editor Mode
    const isCharacterMode = chain.type === 'character';

    // 信息由卡片编辑；工作台使用最新资料，不能在保存草稿时回写旧名称。
    const chainName = chain.name;
    const chainDesc = chain.description;
    const [chainTags, setChainTags] = useState<string[]>(chain.tags || []);
    useEffect(() => { setChainTags(chain.tags || []); }, [chain.id, chain.tags]);

    // --- Prompt State ---
    const [basePrompt, setBasePrompt] = useState(chain.basePrompt || '');
    const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt || '');
    const [modules, setModules] = useState<PromptModule[]>(chain.modules || []);
    // Default Seed to undefined (random), UC Preset to 4 (None)
    const [params, setParams] = useState<NAIParams>(() => normalizeParams(chain.params));
    // Opus 限额透支后，受限额模型（V5）的小图不再免费，费用估算需同步。
    const novelaiStatus = useNovelaiUsage();
    const { info: novelaiSubscription, usage: novelaiUsage, loading: novelaiSubscriptionLoading, refreshIfStale: refreshUsageIfStale } = novelaiStatus;
    // 本地 Anlas 预算（账号整体，手动校准）：用尽后扣费生成需要红色警告。
    const anlasBudget = useAnlasBudget();
    const opusUsageExhausted = novelaiUsage?.isNegative === true;
    // Opus 免费档资格来自「活跃 Opus 订阅」：订阅过期或非 Opus 时没有免费额度，
    // 费用必须按付费档算，避免显示“免费/消耗额度”却实际扣点数。
    const opusSubscriptionActive = isActiveOpusSubscription(novelaiSubscription);
    // 成本估算常量（免费门槛、公式系数、受限模型清单）由网关自动同步。
    const naiRuntimeConfig = useNaiRuntime();
    applyEstimatorRuntime(naiRuntimeConfig);
    // 同步失效保留状态提示，普通生成不额外弹确认或等待同步。
    const runtimeSyncUnhealthy = isNaiRuntimeSyncUnhealthy(naiRuntimeConfig);
    const runtimeSyncWarning = naiRuntimeConfig
        ? `${describeNaiRuntimeSyncProblem(naiRuntimeConfig)}，费用估算与免费档判断可能过期，继续生成可能意外消耗共享 Anlas`
        : '';
    const activeModelInfo = getRuntimeNaiModelInfo(params.model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME);
    const [generationCount, setGenerationCount] = useState(1);
    const effectiveGenerationCount = continuousGenerationEnabled ? generationCount : 1;
    const continuousGenerationEnabledRef = useRef(continuousGenerationEnabled);
    continuousGenerationEnabledRef.current = continuousGenerationEnabled;
    useEffect(() => { if (!continuousGenerationEnabled) setGenerationCount(1); }, [continuousGenerationEnabled]);
    const estimatedAnlasCost = estimateV45GenerationCost(params, opusSubscriptionActive, opusUsageExhausted);
    const costStatusLabel = !novelaiSubscription ? novelaiSubscriptionLoading ? '费用确认中…' : '费用未知' : undefined;
    const generationCostLabel = costStatusLabel || formatGenerationCostLabel(estimatedAnlasCost * effectiveGenerationCount, params.model);

    // --- New: Subject/Variable Prompt State ---
    const [subjectPrompt, setSubjectPrompt] = useState('');

    const [hasChanges, setHasChanges] = useState(false);
    const [lightboxImg, setLightboxImg] = useState<string | null>(null);

    // Sync dirty state with parent.
    useEffect(() => {
        setIsDirty(hasChanges);
    }, [hasChanges, setIsDirty]);

    // --- Testing State ---
    const [activeModules, setActiveModules] = useState<Record<string, boolean>>({});
    const [finalPrompt, setFinalPrompt] = useState('');

    // --- Generation State ---
    const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
    const [isImageGenerating, setIsGenerating] = useState(false);

    const [generationSeries, setGenerationSeries] = useState(() => getGenerationSeriesSession(chain.id)?.progress || null);
    const [queuedGenerations, setQueuedGenerations] = useState(() => getQueuedGenerationSeries(chain.id));
    const generationSeriesRef = useRef(getGenerationSeriesSession(chain.id));
    // 后台任务的观察态：过程预览、成图、费用确认都来自后端状态，不靠本页逐张回调。
    const lastSeriesStreamImageRef = useRef<string | undefined>(undefined);
    const awaitingApprovalRef = useRef('');
    const connectionNoticeRef = useRef('');
    const activeEditOperationRef = useRef<ImageEditOperation | null>(null);
    const promptJobApprovalRef = useRef<(session: GenerationSeriesSession, awaiting: { cost: number; completedCount: number; requestedCount: number }) => Promise<void>>(async () => {});
    const isGenerating = isImageGenerating || Boolean(generationSeries && generationSeries.current < generationSeries.total);
    const latestGenerationStateRef = useRef({ apiKey, subscription: novelaiStatus, isGenerating });
    latestGenerationStateRef.current = { apiKey, subscription: novelaiStatus, isGenerating };
    const [queueState, setQueueState] = useState<GenerationQueueSnapshot | null>(null);
    const [pausePending, setPausePending] = useState(false);
    const [intervalPending, setIntervalPending] = useState(false);
    const intervalRevisionRef = useRef(0);
    useEffect(() => {
      setQueueState(null);
      setPausePending(false);
      setIntervalPending(false);
      intervalRevisionRef.current++;
      if (!apiKey) return;
      let cancelled = false, reading = false, lastRead = -Infinity, busy = false;
      const refresh = async (force = false) => {
        if (reading || document.hidden || (!force && Date.now() - lastRead < (busy || latestGenerationStateRef.current.isGenerating ? 1000 : 5000))) return;
        reading = true; lastRead = Date.now();
        const revision = intervalRevisionRef.current;
        try { const status = await getGenerationQueue(apiKey); if (!cancelled && revision === intervalRevisionRef.current && Number.isSafeInteger(status.total) && typeof status.paused === 'boolean') { busy = status.total > status.completed; setQueueState(status); } }
        catch { /* 保留最后已知进度，接口异常由提交与暂停操作明确提示。 */ }
        finally { reading = false; }
      };
      const onVisible = () => { if (!document.hidden) void refresh(true); };
      void refresh(true); const timer = setInterval(() => { void refresh(); }, 1000);
      document.addEventListener('visibilitychange', onVisible);
      return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, [apiKey]);
    const toggleQueuePause = async () => {
      if (pausePending) return;
      setPausePending(true);
      try {
        const state = queueState || await getGenerationQueue(apiKey);
        if (typeof state.paused !== 'boolean') throw new Error('后端尚未支持暂停队列，请重启工坊后再试');
        const next = await setGenerationQueuePaused(apiKey, !state.paused);
        if (latestGenerationStateRef.current.apiKey === apiKey) setQueueState(next);
      } catch (error) { if (latestGenerationStateRef.current.apiKey === apiKey) notify((error as Error).message, 'error'); }
      finally { if (latestGenerationStateRef.current.apiKey === apiKey) setPausePending(false); }
    };
    const changeGenerationInterval = async (seconds: number) => {
      if (intervalPending || !apiKey) return;
      const revision = ++intervalRevisionRef.current;
      setIntervalPending(true);
      try {
        const next = await setGenerationInterval(apiKey, seconds);
        if (latestGenerationStateRef.current.apiKey === apiKey && revision === intervalRevisionRef.current) setQueueState(next);
      } catch (error) { if (latestGenerationStateRef.current.apiKey === apiKey) notify((error as Error).message, 'error'); }
      finally { if (latestGenerationStateRef.current.apiKey === apiKey && revision === intervalRevisionRef.current) { intervalRevisionRef.current++; setIntervalPending(false); } }
    };
    const externalGenerationBusy = Boolean(queueState && queueState.total > queueState.completed) && !isGenerating;
    const generationUnavailableLabel = externalGenerationBusy ? t("此 Key 正在生成") : undefined;
    const stopGenerationSeries = React.useCallback(() => {
        if (!generationSeriesRef.current) return;
        stopGenerationSeriesSession(generationSeriesRef.current);
    }, []);
    const [isSwitchingMode, setIsSwitchingMode] = useState(false);
    const modeTransitionRef = useRef(false);
    const [generationProgress, setGenerationProgress] = useState<{ step: number; total: number } | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [previewHistory, setPreviewHistory] = useState<LocalGenItem[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewMode, setPreviewMode] = useState<'history' | 'cover' | 'result' | 'unsaved'>('cover');
    const previewHistoryLoadRevisionRef = useRef(0);
    const previewSelectionRevisionRef = useRef(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const generationInFlightRef = useRef(false);
    // 生成是长任务：用户在生成途中离开编辑页（edit 视图不常驻）后，异步回调只能写持久层，
    // 不得再触碰本组件状态。
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    // 最近一次生成结果的内存 blob：卸载时 blob: 预览可能已被 revoke，自动补封面用它兜底。
    const lastGeneratedBlobRef = useRef<Blob | null>(null);
    const [imageEditBaseImage, setImageEditBaseImage] = useState<string | null>(null);
    const [imageEditBaseVersion, setImageEditBaseVersion] = useState(0);
    const [imageEditPreviewImage, setImageEditPreviewImage] = useState<string | null>(null);
    const lastSeriesPreviewRef = useRef<string | undefined>(undefined);
    const workspaceKey = getLabWorkspaceSessionKey(chain.id);
    const workspaceFallback = createLabWorkspaceSession(chain.basePrompt || '', String(chain.variableValues?.subject || ''), chain.negativePrompt || '', normalizeParams(chain.params), Object.fromEntries((chain.modules || []).map(module => [module.id, module.isActive])));
    // 首次进入编辑模式也带上完整风格模块；之后各模式沿用自己的独立草稿。
    for (const draft of Object.values(workspaceFallback.edits)) {
        draft.prompt = compilePrompt(chain, String(chain.variableValues?.subject || ''));
    }
    const [workspaceSession, setWorkspaceSession] = useState<LabWorkspaceSession>(() => openLabWorkspaceSession(workspaceKey, workspaceFallback));
    const [imageEditMaskData, setImageEditMaskData] = useState<string | undefined>();
  const imageEditGenerateFnRef = useRef<(() => void) | null>(null);
  const imageEditQueueFnRef = useRef<((placement: GenerationPlacement) => void) | null>(null);
  const [imageEditGenerateBar, setImageEditGenerateBar] = useState<{ costLabel: string; canGenerate: boolean; canQueue: boolean; unavailableLabel?: string } | null>(null);
  const handleImageEditGenerateBarChange = React.useCallback((bar: { generate: () => void; queue: (placement: GenerationPlacement) => void; costLabel: string; canGenerate: boolean; canQueue: boolean; unavailableLabel?: string }) => {
    imageEditGenerateFnRef.current = bar.generate;
    imageEditQueueFnRef.current = bar.queue;
    setImageEditGenerateBar(previous => previous && previous.costLabel === bar.costLabel && previous.canGenerate === bar.canGenerate && previous.canQueue === bar.canQueue && previous.unavailableLabel === bar.unavailableLabel ? previous : { costLabel: bar.costLabel, canGenerate: bar.canGenerate, canQueue: bar.canQueue, unavailableLabel: bar.unavailableLabel });
  }, []);
    const [imageEditBaseLoading, setImageEditBaseLoading] = useState(false);
    const maskSaveRevisionRef = useRef(0);
    const maskSaveTimerRef = useRef<number | null>(null);
    const pendingMaskSaveRef = useRef<{ operation: ImageEditOperation; data: string; revision: number } | null>(null);
    const editBaseResolveRevisionRef = useRef(0);
    const workspaceInitializedKeyRef = useRef(workspaceKey);

    useEffect(() => () => {
        if (generatedImage?.startsWith('blob:')) URL.revokeObjectURL(generatedImage);
    }, [generatedImage]);
    const importInputRef = useRef<HTMLInputElement>(null);
    const importDragDepthRef = useRef(0);
    const [showForkModal, setShowForkModal] = useState(false);
    const [isImportDragActive, setIsImportDragActive] = useState(false);
    const [translationPending, setTranslationPending] = useState(false);
    const [mobileEditorTab, setMobileEditorTab] = useState<'global' | 'character' | 'params'>('global');
    const [agentProposal, setAgentProposal] = useState<PromptAgentDraft | null>(null);
    const agentTargetRef = useRef<PromptAgentDraft['target']>(undefined);
    const agentEditGenerateRef = useRef<((draft: PromptAgentDraft, onApproved?: () => Promise<void>, count?: number, placement?: GenerationPlacement) => Promise<PromptAgentGenerationResult | boolean>) | null>(null);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<PromptAgentDraft | null>(null);
    const editorRevisionRef = useRef(0);
    const agentRunRevisionRef = useRef(0);

    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) return;
        const updateKeyboardOffset = () => {
            const active = document.activeElement;
            const editingPrompt = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
            // 软键盘弹起时 visualViewport 会被压缩（高度小于布局视口），
            // 底部悬浮胶囊据此上移避让，而不是直接隐藏（隐藏后键盘收起时状态残留不可点）。
            const lift = window.innerHeight - viewport.height;
            if (editingPrompt && lift > 120) {
                setKeyboardOffset(lift);
            } else if (lift <= 120) {
                setKeyboardOffset(0);
            }
        };
        updateKeyboardOffset();
        viewport.addEventListener('resize', updateKeyboardOffset);
        window.addEventListener('focusin', updateKeyboardOffset);
        window.addEventListener('focusout', updateKeyboardOffset);
        return () => {
            viewport.removeEventListener('resize', updateKeyboardOffset);
            window.removeEventListener('focusin', updateKeyboardOffset);
            window.removeEventListener('focusout', updateKeyboardOffset);
        };
    }, []);

    // --- Initialization ---

    // --- Initialization ---
    const prevChainIdRef = useRef<string | null>(null);
    const [presetSources, setPresetSources] = useState<Partial<Record<PresetSection, PresetSource>>>({});
    const [characterPresetSources, setCharacterPresetSources] = useState<Record<string, PresetSource>>({});

    const markPresetSectionModified = (section: PresetSection) => {
        setPresetSources(previous => previous[section]
            ? { ...previous, [section]: { ...previous[section]!, modified: true } }
            : previous);
    };
    const markCharacterSourceModified = (id: string) => {
        setCharacterPresetSources(previous => previous[id]
            ? { ...previous, [id]: { ...previous[id], modified: true } }
            : previous);
    };
    const clearPresetSources = () => {
        setPresetSources({});
        setCharacterPresetSources({});
    };

    const sourceChainId = chain.id === 'playground' ? 'playground' : chain.id;
    const activeGenerationMode = workspaceSession.activeMode;
    const canSaveActiveModeToLibrary = canSaveLabModeToLibrary(activeGenerationMode);
    const activeEditOperation = activeGenerationMode === 'text-to-image' ? null : activeGenerationMode;
    activeEditOperationRef.current = activeEditOperation;
    const generationSession = getGenerationSeriesSession(chain.id);
    const generationState: GenerationJobState = generationSession?.key === apiKey ? generationSession.state : isImageGenerating ? 'preparing' : 'waiting';
    const generationCountControl = { continuousGenerationEnabled, count: effectiveGenerationCount, onCountChange: setGenerationCount, series: generationSeries, onStop: stopGenerationSeries, queueState, onTogglePause: () => { void toggleQueuePause(); }, pausePending,
        generationState,
        intervalSeconds: queueState?.intervalSeconds, onIntervalChange: (seconds: number) => { void changeGenerationInterval(seconds); }, intervalPending: intervalPending || !apiKey,
        onQueue: continuousGenerationEnabled ? (placement: GenerationPlacement) => { void (activeEditOperation ? imageEditQueueFnRef.current?.(placement) : handleGenerate(placement)); } : undefined,
        queued: queueState ? queueState.waiting.map(task => ({ id: task.token, progress: { current: task.completed, total: task.total, position: task.position, stopping: false }, onCancel: () => { const local = queuedGenerations.find(session => session.token === task.token); if (local) stopGenerationSeriesSession(local); else void cancelGenerationJob(apiKey, task.token).catch(error => notify(error.message, 'error')); } })) : queuedGenerations.map(session => ({ id: session.token, progress: session.progress, onCancel: () => stopGenerationSeriesSession(session) })),
        queueDisabled: !apiKey || imageEditBaseLoading || Boolean(activeEditOperation && !imageEditGenerateBar?.canQueue) };
    const activeEditDraft = activeEditOperation ? workspaceSession.edits[activeEditOperation] : null;
    const activeLabLayout = labPageLayouts[activeGenerationMode];
    const latestTextToImageItem = previewHistory.find(item => !item.edit);
    const selectedPreviewItem = previewMode === 'history' ? previewHistory.find(item => item.imageUrl === generatedImage) || null : null;
    const selectedPreviewIndex = selectedPreviewItem ? previewHistory.indexOf(selectedPreviewItem) : previewIndex;
    const displayedPreviewImage = selectedPreviewItem?.imageUrl || generatedImage;
    const displayedPreviewItem = previewHistory.find(item => item.imageUrl === displayedPreviewImage);
    // 移动端浮动圆圈：编辑模式显示最近一次编辑结果（底图已移入左侧「底图与导入」），文生图沿用最近生成结果
    const mobileFloatingPreviewImage = activeEditOperation
        ? imageEditPreviewImage
        : (displayedPreviewImage || chain.previewImage);
    const imageEditPreviewHistoryIndex = imageEditPreviewImage ? previewHistory.findIndex(item => item.imageUrl === imageEditPreviewImage) : -1;
    const imageEditPreviewItem = imageEditPreviewHistoryIndex >= 0 ? previewHistory[imageEditPreviewHistoryIndex] : null;
    const imageEditPreviewHistoryLabel = imageEditPreviewHistoryIndex >= 0 ? `${imageEditPreviewHistoryIndex + 1} / ${previewHistory.length}` : undefined;
    const currentPreviewCover = decideCurrentPreviewCover(displayedPreviewImage, chain.previewImage);
    const hasPendingPreviewCover = chain.type === 'style' && currentPreviewCover.needsUpload;
    const canSaveCurrentChain = hasChanges || hasPendingPreviewCover;
    const lightboxItem = lightboxImg ? previewHistory.find(item => item.imageUrl === lightboxImg) || null : null;
    const currentPreviewPosition = selectedPreviewItem
        ? `${selectedPreviewIndex + 1} / ${previewHistory.length}`
        : previewMode === 'result'
            ? '刚刚生成 · 正在保存历史'
        : previewMode === 'unsaved'
            ? '刚刚生成 · 历史保存失败'
        : previewHistory.length > 0
            ? `封面 · 历史 ${previewHistory.length} 张`
            : '当前封面';

    const reloadPreviewHistory = async (targetSourceChainId = sourceChainId) => {
        const loadRevision = ++previewHistoryLoadRevisionRef.current;
        const selectionRevision = previewSelectionRevisionRef.current;
        const history = await localHistory.getBySourceChain(targetSourceChainId);
        if (!mountedRef.current || loadRevision !== previewHistoryLoadRevisionRef.current) return;
        // 历史请求可能晚于本次生成完成；合并新结果，不能把预览拉回请求时的旧图。
        setPreviewHistory(previous => [...new Map([...history, ...previous].map(item => [item.id, item])).values()]
            .sort((a, b) => b.createdAt - a.createdAt));
        if (getGenerationSeriesSession(chain.id)?.lastSavedItem || targetSourceChainId === 'playground' || selectionRevision !== previewSelectionRevisionRef.current) return;
        setPreviewIndex(0);
        if (history.length > 0) {
            setPreviewMode('history');
            setGeneratedImage(history[0].imageUrl);
        } else {
            setPreviewMode('cover');
            setGeneratedImage(null);
        }
    };

    const showHistoryAt = (index: number) => {
        if (previewHistory.length === 0) return;
        const nextIndex = (index + previewHistory.length) % previewHistory.length;
        const nextImage = previewHistory[nextIndex].imageUrl;
        if (activeEditOperation) {
            setImageEditPreviewImage(nextImage);
        } else {
            previewSelectionRevisionRef.current += 1;
            setPreviewIndex(nextIndex);
            setPreviewMode('history');
            setGeneratedImage(nextImage);
        }
        if (lightboxImg) {
            setLightboxImg(nextImage);
        }
    };

    const activePreviewIndex = activeEditOperation && imageEditPreviewHistoryIndex >= 0 ? imageEditPreviewHistoryIndex : selectedPreviewIndex;
    const showPreviousHistory = () => showHistoryAt(activePreviewIndex - 1);
    const showNextHistory = () => showHistoryAt(activePreviewIndex + 1);

    const handleRemoveCurrentHistory = async (targetItem = selectedPreviewItem) => {
        if (!targetItem) return;

        try {
            await localHistory.unlinkFromSourceChain(targetItem.id);

            const removedIndex = previewHistory.findIndex(item => item.id === targetItem.id);
            const nextHistory = previewHistory.filter(item => item.id !== targetItem.id);
            setPreviewHistory(nextHistory);

            if (activeEditOperation) {
                const nextImage = nextHistory[Math.min(Math.max(0, removedIndex), nextHistory.length - 1)]?.imageUrl || null;
                setImageEditPreviewImage(nextImage);
                if (lightboxImg) setLightboxImg(nextImage);
            } else if (nextHistory.length === 0) {
                setPreviewIndex(0);
                setPreviewMode('cover');
                setGeneratedImage(null);
                if (lightboxImg) setLightboxImg(null);
            } else {
                const nextIndex = Math.min(Math.max(0, removedIndex), nextHistory.length - 1);
                const nextImage = nextHistory[nextIndex].imageUrl;
                setPreviewIndex(nextIndex);
                setPreviewMode('history');
                setGeneratedImage(nextImage);
                if (lightboxImg) setLightboxImg(nextImage);
            }

            notify('已从当前风格串历史组移除，历史页仍会保留。', 'success');
        } catch (error) {
            console.error('移除历史组图片失败:', error);
            notify('移除失败，请稍后重试。', 'error');
        }
    };

    const handleClearHistoryGroup = async () => {
        if (previewHistory.length === 0) return;
        if (!await confirmAction({
            title: '清除当前风格串的历史组？',
            message: `将从当前风格串移除 ${previewHistory.length} 张图片，但不会删除本地历史中的原图。`,
            confirmLabel: '确认清除',
            tone: 'danger',
        })) return;

        try {
            const count = await localHistory.unlinkAllFromSourceChain(sourceChainId);
            setPreviewHistory([]);
            setPreviewIndex(0);
            setPreviewMode('cover');
            setGeneratedImage(null);
            setImageEditPreviewImage(null);
            setLightboxImg(null);
            notify(`已清除 ${count} 张图片的当前风格串归属，历史页仍会保留。`, 'success');
        } catch (error) {
            console.error('清除历史组失败:', error);
            notify('清除失败，请稍后重试。', 'error');
        }
    };

    useEffect(() => {
        // Only reset state if Chain ID changes.
        // This prevents resetting unsaved work when only metadata (like cover image) updates.
        if (prevChainIdRef.current === chain.id) return;

        prevChainIdRef.current = chain.id;
        previewHistoryLoadRevisionRef.current += 1;
        previewSelectionRevisionRef.current += 1;
        setPreviewHistory([]);
        setPreviewIndex(0);
        setPreviewMode('cover');
        setGeneratedImage(null);
        clearPresetSources();

        const storedWorkspace = openLabWorkspaceSession(workspaceKey, workspaceFallback);
        workspaceInitializedKeyRef.current = workspaceKey;
        workspaceSyncBlockedRef.current = true;
        setWorkspaceSession(storedWorkspace);
        setBasePrompt(storedWorkspace.textToImage.basePrompt);
        setNegativePrompt(storedWorkspace.textToImage.negativePrompt);
        setModules((chain.modules || []).map(m => ({
            ...m,
            position: m.position || 'post'
        })));
        setParams(normalizeParams({
            seed: undefined,
            qualityToggle: true, ucPreset: 4, characters: [],
            useCoords: chain.params?.useCoords ?? false,
            variety: chain.params?.variety ?? false,
            cfgRescale: chain.params?.cfgRescale ?? 0,
            ...storedWorkspace.textToImage.params
        }));
        setChainTags(chain.tags || []);

        // Default subject to empty, not '1girl'
        const savedVars = chain.variableValues || {};
        setSubjectPrompt(storedWorkspace.textToImage.subjectPrompt || savedVars['subject'] || '');

        const initialModules: Record<string, boolean> = { ...storedWorkspace.textToImage.activeModules };
        if (chain.modules) {
            chain.modules.forEach(m => {
                if (initialModules[m.id] === undefined) initialModules[m.id] = m.isActive;
            });
        }
        setActiveModules(initialModules);
        // 恢复的工作区草稿若与已落库内容不一致，必须如实标记为未保存：
        // 否则界面显示「已保存」而数据库是旧值，后续保存会把中断前的草稿静默写回。
        const persistedParams = normalizeParams({
            seed: undefined,
            qualityToggle: true, ucPreset: 4, characters: [],
            useCoords: chain.params?.useCoords ?? false,
            variety: chain.params?.variety ?? false,
            cfgRescale: chain.params?.cfgRescale ?? 0,
            ...(chain.params || {})
        });
        const restoredParams = normalizeParams({
            seed: undefined,
            qualityToggle: true, ucPreset: 4, characters: [],
            useCoords: chain.params?.useCoords ?? false,
            variety: chain.params?.variety ?? false,
            cfgRescale: chain.params?.cfgRescale ?? 0,
            ...storedWorkspace.textToImage.params
        });
        const moduleStateDiffers = (chain.modules || []).some(m => (initialModules[m.id] ?? m.isActive) !== m.isActive);
        const restoredDiffers =
            (storedWorkspace.textToImage.basePrompt || '') !== (chain.basePrompt || '') ||
            (storedWorkspace.textToImage.negativePrompt || '') !== (chain.negativePrompt || '') ||
            (storedWorkspace.textToImage.subjectPrompt || '') !== String(chain.variableValues?.subject || '') ||
            JSON.stringify(restoredParams) !== JSON.stringify(persistedParams) ||
            moduleStateDiffers;
        setHasChanges(restoredDiffers);
        if (restoredDiffers && chain.id !== 'playground') {
            notify('已恢复上次未保存的修改，保存后才会写回风格串');
        }

        void reloadPreviewHistory(sourceChainId);
    }, [chain.id, chain.basePrompt, chain.negativePrompt, chain.modules, chain.params, chain.name, chain.description, chain.variableValues]);
    // Dependency note: we still list props to satisfy linter, but the guard 'if (prevChainId === chain.id) return' blocks re-execution.

    // --- sessionStorage 侦听：接收来自历史/灵感页面的一键导入数据 ---
    useEffect(() => {
        const raw = sessionStorage.getItem(IMPORT_SESSION_KEY);
        if (!raw) return;

        try {
            const data = JSON.parse(raw) as PendingImportData | PromptFragmentImport | BaseImageImport;
            // 清除标志位，防止重复消费
            sessionStorage.removeItem(IMPORT_SESSION_KEY);
            // 应用数据到当前编辑器
            applyImportData(data);
        } catch (e) {
            console.error('解析 pending import 数据失败', e);
            sessionStorage.removeItem(IMPORT_SESSION_KEY);
        }
    }, [chain.id, externalImportToken]); // Also consume when a kept-alive playground receives a fresh external import.

    useEffect(() => {
        const syncApiKey = (event: Event) => {
            const nextValue = event instanceof CustomEvent
                ? String(event.detail || '')
                : (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
            if (generationSeriesRef.current && nextValue !== generationSeriesRef.current.key) {
                stopGenerationSeriesSession(generationSeriesRef.current);
            }
            setApiKey(nextValue);
        };
        window.addEventListener('nai-api-key-changed', syncApiKey);
        window.addEventListener('storage', syncApiKey);
        return () => {
            window.removeEventListener('nai-api-key-changed', syncApiKey);
            window.removeEventListener('storage', syncApiKey);
        };
    }, []);

    // 大图灯箱键盘可达性：Esc 关闭（不受历史张数限制）、打开会话时焦点移入关闭按钮、
    // 会话结束（关闭）后把焦点归还给触发元素。左右方向键仅在多张历史时切换。
    // 用 latest-ref 调用最新 handler；effect 仅依赖 lightboxImg，避免历史切换重注册时误抢焦点。
    const lightboxCloseBtnRef = useRef<HTMLButtonElement | null>(null);
    const lightboxOpenerRef = useRef<HTMLElement | null>(null);
    const lightboxSessionOpenRef = useRef(false);
    const lightboxHistoryCountRef = useRef(previewHistory.length);
    lightboxHistoryCountRef.current = previewHistory.length;
    const lightboxNavRef = useRef({ showPreviousHistory, showNextHistory });
    lightboxNavRef.current = { showPreviousHistory, showNextHistory };
    const closeLightboxRef = useRef(() => setLightboxImg(null));
    closeLightboxRef.current = () => setLightboxImg(null);

    useEffect(() => {
        if (!lightboxImg) {
            // 灯箱会话结束：把焦点还给打开它的元素（仍挂载在文档中才聚焦）
            lightboxSessionOpenRef.current = false;
            const opener = lightboxOpenerRef.current;
            lightboxOpenerRef.current = null;
            if (opener && opener.isConnected && opener !== document.body) {
                opener.focus({ preventScroll: true });
            }
            return;
        }
        const freshOpen = !lightboxSessionOpenRef.current;
        lightboxSessionOpenRef.current = true;
        if (freshOpen) {
            // 仅首次打开记录触发元素：按钮/缩略图点开时焦点就在其上；程序自动弹出（如生成完成）则不强求归还
            const active = document.activeElement;
            if (active instanceof HTMLElement && active !== document.body) {
                lightboxOpenerRef.current = active;
            }
            // 焦点移入弹层内关闭按钮，让键盘/读屏用户进入弹层上下文
            lightboxCloseBtnRef.current?.focus({ preventScroll: true });
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('[role="alertdialog"]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeLightboxRef.current();
                return;
            }
            if (lightboxHistoryCountRef.current <= 1) return;
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                lightboxNavRef.current.showPreviousHistory();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                lightboxNavRef.current.showNextHistory();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxImg]);

    // --- Logic: Compilation ---
    useEffect(() => {
        const tempChain = {
            basePrompt,
            modules: (modules || []).map(m => ({
                ...m,
                isActive: activeModules[m.id] ?? true
            }))
        } as any;

        const compiled = compilePrompt(tempChain, subjectPrompt);
        setFinalPrompt(compiled);
    }, [basePrompt, modules, activeModules, subjectPrompt]);

    useEffect(() => {
        if (workspaceInitializedKeyRef.current !== workspaceKey) return;
        saveLabWorkspaceSession(workspaceKey, workspaceSession);
    }, [workspaceKey, workspaceSession]);

    useEffect(() => {
        const references = Object.values(workspaceSession.edits).flatMap(edit => [edit.baseImageRef, edit.maskRef].filter((value): value is string => Boolean(value)));
        void cleanupLabWorkspaceAssets(references).catch(error => console.warn('清理编辑资产失败:', error));
        // 仅在进入一个工作区时扫描一次，避免每次笔画都触发全库清理。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceKey]);

    useEffect(() => () => {
        const pending = pendingMaskSaveRef.current;
        if (pending) void flushMaskSave(pending.operation, false).catch(error => console.warn('离开实验室前保存编辑蒙版失败:', error));
        if (maskSaveTimerRef.current !== null) window.clearTimeout(maskSaveTimerRef.current);
    // 当前 cleanup 只需要捕获离开前的工作区与待写入资产。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceKey]);

    const workspaceSyncBlockedRef = useRef(false);

    useEffect(() => {
        if (prevChainIdRef.current !== chain.id) return;
        if (workspaceSyncBlockedRef.current) {
            workspaceSyncBlockedRef.current = false;
            return;
        }
        setWorkspaceSession(previous => {
            const nextTextToImage = { basePrompt, subjectPrompt, negativePrompt, params: { ...params }, activeModules: { ...activeModules } };
            if (JSON.stringify(previous.textToImage) === JSON.stringify(nextTextToImage)) return previous;
            return { ...previous, textToImage: nextTextToImage, updatedAt: Date.now() };
        });
    }, [basePrompt, subjectPrompt, negativePrompt, params, activeModules, chain.id]);

    const updateWorkspace = (updater: (previous: LabWorkspaceSession) => LabWorkspaceSession) => {
        setWorkspaceSession(previous => ({ ...updater(previous), updatedAt: Date.now() }));
    };

    const flushMaskSave = async (operation?: ImageEditOperation, updateSession = true) => {
        const pending = pendingMaskSaveRef.current;
        if (!pending || (operation && pending.operation !== operation)) return;
        pendingMaskSaveRef.current = null;
        if (maskSaveTimerRef.current !== null) {
            window.clearTimeout(maskSaveTimerRef.current);
            maskSaveTimerRef.current = null;
        }
        const maskRef = await saveLabWorkspaceAsset(await dataUrlToBlob(pending.data), getLabWorkspaceAssetId(workspaceKey, pending.operation, 'mask'));
        if (updateSession && pending.revision === maskSaveRevisionRef.current) {
            updateWorkspace(previous => ({
                ...previous,
                edits: { ...previous.edits, [pending.operation]: { ...previous.edits[pending.operation], maskRef } },
            }));
        }
    };

    const cancelPendingMaskSave = () => {
        pendingMaskSaveRef.current = null;
        if (maskSaveTimerRef.current !== null) {
            window.clearTimeout(maskSaveTimerRef.current);
            maskSaveTimerRef.current = null;
        }
    };

    const updateEditDraft = (operation: ImageEditOperation, patch: Partial<LabImageEditDraft> & { maskData?: string }) => {
        const { maskData, ...draftPatch } = patch;
        const hasMaskPatch = Object.prototype.hasOwnProperty.call(patch, 'maskData');
        updateWorkspace(previous => ({
            ...previous,
            edits: { ...previous.edits, [operation]: { ...previous.edits[operation], ...draftPatch, ...(hasMaskPatch && maskData === undefined ? { maskRef: undefined } : {}) } },
        }));
        const maskAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'mask');
        if (hasMaskPatch && maskData !== undefined) {
            setImageEditMaskData(maskData);
            const saveRevision = (maskSaveRevisionRef.current += 1);
            pendingMaskSaveRef.current = { operation, data: maskData, revision: saveRevision };
            if (maskSaveTimerRef.current !== null) window.clearTimeout(maskSaveTimerRef.current);
            maskSaveTimerRef.current = window.setTimeout(() => {
                void flushMaskSave(operation).catch(error => console.warn('保存编辑蒙版失败:', error));
            }, 140);
        } else if (hasMaskPatch) {
            maskSaveRevisionRef.current += 1;
            cancelPendingMaskSave();
            setImageEditMaskData(undefined);
            void deleteLabWorkspaceAsset(maskAssetId).catch(error => console.warn('删除编辑蒙版失败:', error));
        }
    };

    const resolveEditBaseImage = async (draft: LabImageEditDraft | null) => {
        const resolveRevision = editBaseResolveRevisionRef.current + 1;
        editBaseResolveRevisionRef.current = resolveRevision;
        if (!draft?.baseImageRef) {
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
            setImageEditMaskData(undefined);
            setImageEditBaseLoading(false);
            return;
        }
        setImageEditBaseLoading(true);
        try {
            const blob = await readLabWorkspaceAsset(draft.baseImageRef);
            if (resolveRevision !== editBaseResolveRevisionRef.current) return;
            const restoredBaseImage = blob ? await blobToDataUrl(blob) : null;
            if (resolveRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;
            setImageEditBaseImage(restoredBaseImage);
            // 复开自由实验室时旧图片引用已隔离，同次打开内切换模式仍恢复各自新结果。
            let restoredResult: string | null = null;
            if (draft.resultImageRef) {
                const resultBlob = await readLabWorkspaceAsset(draft.resultImageRef);
                if (resolveRevision !== editBaseResolveRevisionRef.current) return;
                restoredResult = resultBlob ? await blobToDataUrl(resultBlob) : null;
                if (resolveRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;
            }
            // 底图在左侧「底图与导入」展示；右侧只显示结果，无结果时为 null（空态引导左侧）
            const pendingResult = getGenerationSeriesSession(chain.id)?.lastSavedItem;
            setImageEditPreviewImage(pendingResult?.edit && pendingResult.edit.operation === activeEditOperation ? pendingResult.imageUrl : restoredResult);
            if (draft.maskRef) {
                const maskBlob = await readLabWorkspaceAsset(draft.maskRef);
                if (resolveRevision !== editBaseResolveRevisionRef.current) return;
                const maskData = maskBlob ? await blobToDataUrl(maskBlob) : undefined;
                if (resolveRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;
                setImageEditMaskData(maskData);
            } else setImageEditMaskData(undefined);
        } finally {
            if (resolveRevision === editBaseResolveRevisionRef.current && mountedRef.current) setImageEditBaseLoading(false);
        }
    };

    useEffect(() => {
        // 入口和切模式共用恢复流程，保留各自草稿与资产。
        const draft = activeEditOperation ? workspaceSession.edits[activeEditOperation] : null;
        void resolveEditBaseImage(draft).catch(error => notify(error instanceof Error ? error.message : '恢复编辑底图失败', 'error'));
        setShowForkModal(false);
        return () => { editBaseResolveRevisionRef.current += 1; };
        // 只在进入模式时恢复；当前模式上传／画布变更已有各自的即时更新。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceKey, activeEditOperation]);

    useEffect(() => {
        lastSeriesPreviewRef.current = undefined;
        lastSeriesStreamImageRef.current = undefined;
        awaitingApprovalRef.current = '';
        connectionNoticeRef.current = '';
        const sync = () => {
            const session = getGenerationSeriesSession(chain.id);
            generationSeriesRef.current = session;
            setGenerationSeries(session?.progress || null);
            setQueuedGenerations(getQueuedGenerationSeries(chain.id));
            if (!session) {
                setGenerationProgress(null);
                lastSeriesStreamImageRef.current = undefined;
                return;
            }
            // 后台任务的过程预览独立于成图：最终图到达后再由 lastSavedItem 接管。
            const preview = session.preview;
            const hasUnsavedPreview = session.state === 'failed' && Boolean(preview?.image);
            const keepPreview = hasUnsavedPreview || (session.state === 'generating' && Boolean(preview?.image));
            if (preview?.image && (preview.image !== lastSeriesStreamImageRef.current || hasUnsavedPreview)) {
                lastSeriesStreamImageRef.current = preview.image;
                // 保存失败的终态会带完整未保存成图：先展示，再按失败态标注为未保存。
                const previewState = session.state === 'failed' ? 'unsaved' as const : 'result' as const;
                if (activeEditOperationRef.current) {
                    if (chain.id !== 'playground') { setGeneratedImage(preview.image); setPreviewMode(previewState); }
                    setImageEditPreviewImage(preview.image);
                } else {
                    setGeneratedImage(preview.image);
                    setPreviewMode(previewState);
                }
            }
            setGenerationProgress(preview?.step ? { step: preview.step, total: session.steps } : null);
            if (session.connectionError && session.connectionError !== connectionNoticeRef.current) {
                connectionNoticeRef.current = session.connectionError;
                notify(session.connectionError, 'error');
            } else if (!session.connectionError) connectionNoticeRef.current = '';
            const awaiting = session.awaiting;
            if (awaiting) {
                const revision = `${session.token}:${awaiting.cost}:${awaiting.completedCount}`;
                if (awaitingApprovalRef.current !== revision) {
                    awaitingApprovalRef.current = revision;
                    void promptJobApprovalRef.current(session, awaiting);
                }
            }
            const item = session.lastSavedItem;
            if (!item || lastSeriesPreviewRef.current === item.id) return;
            lastSeriesPreviewRef.current = item.id;
            previewSelectionRevisionRef.current += 1;
            setPreviewHistory(previous => [item, ...previous.filter(saved => saved.id !== item.id)]);
            if (item.edit && !keepPreview) setImageEditPreviewImage(item.imageUrl);
            if (!keepPreview && (!item.edit || chain.id !== 'playground')) {
                setGeneratedImage(item.imageUrl);
                setPreviewIndex(0);
                setPreviewMode('history');
                if (session.count === 1 && !item.edit && window.matchMedia('(max-width: 1023px)').matches) setLightboxImg(item.imageUrl);
            }
            if (!keepPreview) setGenerationProgress(null);
            // 历史变更与额度刷新广播由后台任务监督器统一发出，本页不再重复 add。
            checkAndRemoveUntestedTag();
        };
        sync();
        return subscribeGenerationSeries(sync);
    }, [chain.id]);

    /** 仅重置单个编辑模式的持久化底图/蒙版资产与草稿；不触碰文生图与其他编辑模式。 */
    const resetEditOperation = async (operation: ImageEditOperation) => {
        const baseAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'base');
        const maskAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'mask');
        const previousDraft = workspaceSession.edits[operation];
        const currentEditDraft = activeEditOperation === operation && activeEditDraft ? activeEditDraft : previousDraft;
        const defaultDraft = chain.id === 'playground'
            ? createLabImageEditDraft(operation, '', '', LAB_DEFAULT_PARAMS)
            : createLabImageEditDraft(operation, finalPrompt, negativePrompt, params);
        await Promise.all([
            deleteLabWorkspaceAsset(baseAssetId),
            deleteLabWorkspaceAsset(previousDraft.maskRef !== maskAssetId ? maskAssetId : undefined),
            deleteLabWorkspaceAsset(currentEditDraft.maskRef !== maskAssetId ? currentEditDraft.maskRef : undefined),
            deleteLabWorkspaceAsset(currentEditDraft.resultImageRef),
        ]).catch(error => console.warn('重置编辑模式资产失败:', error));
        updateWorkspace(previous => ({ ...previous, edits: { ...previous.edits, [operation]: defaultDraft } }));
    };

    const createEditDraftFromSource = async (operation: ImageEditOperation, sourceImage: string | undefined, source: 'generated' | 'history' | 'upload' | 'inspiration', parentHistoryId?: string, sourcePrompt = finalPrompt, sourceNegativePrompt = negativePrompt, sourceParams = params, editMetadata?: ImageEditMetadata, reuseEditMask = false) => {
        const draft = createLabImageEditDraft(operation, sourcePrompt, sourceNegativePrompt, sourceParams, {
            baseImageSource: source,
            parentHistoryId,
            promptSource: (source === 'history' || source === 'inspiration') ? 'history' : 'current',
            strength: editMetadata?.strength ?? (operation === 'image-to-image' ? 0.7 : 1),
            noise: editMetadata?.noise ?? 0,
            focused: operation === 'inpaint' && (editMetadata?.focused ?? true),
            minimumContextArea: editMetadata?.minimumContextArea ?? editMetadata?.contextArea ?? 64,
            // 载入的生成结果已经是完整图片，上一轮扩展量不能再套在新底图上。
            expansion: { top: 0, right: 0, bottom: 0, left: 0 },
            outpaintRatioId: operation === 'outpaint' ? 'custom' : undefined,
            focusedRect: editMetadata?.focusedArea,
        });
        let restoredMask: string | undefined;
        const baseAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'base');
        if (sourceImage) {
            draft.baseImageRef = await dataUrlToWorkspaceAsset(sourceImage, baseAssetId);
            setImageEditBaseImage(sourceImage);
            setImageEditPreviewImage(null);
        } else {
            await deleteLabWorkspaceAsset(baseAssetId);
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
        }
        const maskAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'mask');
        await deleteLabWorkspaceAsset(maskAssetId);
        // 重建草稿会丢弃旧结果引用；同步删除旧结果资产避免泄漏
        const previousDraftForResult = workspaceSession.edits[operation];
        if (previousDraftForResult?.resultImageRef) {
            await deleteLabWorkspaceAsset(previousDraftForResult.resultImageRef).catch(error => console.warn('删除编辑结果资产失败:', error));
        }
        if (reuseEditMask && parentHistoryId) {
            const maskBlob = await localHistory.getEditMask(parentHistoryId);
            if (maskBlob) {
                draft.maskRef = await saveLabWorkspaceAsset(maskBlob, maskAssetId);
                restoredMask = await blobToDataUrl(maskBlob);
            }
        }
        updateWorkspace(previous => ({ ...previous, activeMode: operation, edits: { ...previous.edits, [operation]: draft } }));
        setImageEditMaskData(restoredMask);
    };

    const selectGenerationMode = async (mode: GenerationMode) => {
        // 生成进行中不允许切换模式：视觉层（模式导航禁用）+ 逻辑层（此处拦截）双保险
        if (isGenerating || modeTransitionRef.current || mode === activeGenerationMode) return;
        modeTransitionRef.current = true;
        setIsSwitchingMode(true);
        try {
            if (activeEditOperation) await flushMaskSave(activeEditOperation).catch(error => console.warn('切换编辑模式前保存蒙版失败:', error));
            // 切模式前先清空蒙版态：否则 Panel 会以「新 operation + 上一模式的 maskData」渲染，
            // loadBaseImage 的默认恢复参数把旧模式蒙版画进新模式画布并随请求发出。
            setImageEditMaskData(undefined);
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
            if (mode === 'text-to-image') {
                editBaseResolveRevisionRef.current += 1;
                setImageEditBaseLoading(false);
                updateWorkspace(previous => ({ ...previous, activeMode: mode }));
                setImageEditBaseImage(null);
                setImageEditPreviewImage(null);
                setImageEditMaskData(undefined);
                return;
            }
            const existing = workspaceSession.edits[mode];
            // 图生图即使主动清空提示词，也继续使用独立草稿；选底图由左侧入口完成。
            if (mode === 'image-to-image' || existing.baseImageRef || existing.prompt || existing.parentHistoryId) {
                updateWorkspace(previous => ({ ...previous, activeMode: mode }));
                return;
            }
            const sourceItem = selectedPreviewItem;
            const sourceImage = displayedPreviewImage || chain.previewImage;
            await createEditDraftFromSource(mode, sourceImage, sourceItem ? 'history' : 'generated', sourceItem?.id, sourceItem?.prompt ?? finalPrompt, sourceItem?.negativePrompt ?? negativePrompt, sourceItem?.params || params);
        } catch (error) {
            notify(error instanceof Error ? error.message : '切换生成模式失败', 'error');
        } finally {
            modeTransitionRef.current = false;
            if (mountedRef.current) setIsSwitchingMode(false);
        }
    };

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    // 编辑操作共用脏状态。
    const markChange = () => {
        editorRevisionRef.current += 1;
        setHasChanges(true);
    };

    // --- Character Handlers ---
    const addCharacter = () => {
        if ((params.characters || []).length >= activeModelInfo.maxCharacters) {
            notify(`${activeModelInfo.label} 最多支持 ${activeModelInfo.maxCharacters} 个角色提示词`, 'error');
            return;
        }
        const newChar: CharacterParams = { id: createUuid(), prompt: '', x: 0.5, y: 0.5 };
        setParams({ ...params, characters: [...(params.characters || []), newChar] });
        markChange();
    };

    const updateCharacter = (idx: number, updates: Partial<CharacterParams>, useCoords?: boolean) => {
        if (!params.characters?.[idx]) return;
        const newChars = [...params.characters];
        newChars[idx] = { ...newChars[idx], ...updates };
        setParams({ ...params, characters: newChars, ...(useCoords !== undefined ? { useCoords } : {}) });
        markCharacterSourceModified(newChars[idx].id);
        markChange();
    };

    const removeCharacter = (idx: number) => {
        if (!params.characters) return;
        const newChars = [...params.characters];
        const removedId = newChars[idx]?.id;
        newChars.splice(idx, 1);
        setParams({ ...params, characters: newChars });
        if (removedId) setCharacterPresetSources(previous => {
            const next = { ...previous };
            delete next[removedId];
            return next;
        });
        markChange();
    };

    // --- Import Logic ---
    const isJsonMetadataFile = (file: File) => {
        return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
    };

    const isPngMetadataFile = (file: File) => {
        return file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    };

    const normalizeMetadataFile = (file: File) => {
        if (file.name.toLowerCase().endsWith('.png')) {
            return new File([file], file.name, { type: 'image/png' });
        }
        if (file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
            return new File([file], file.name, { type: 'application/json' });
        }
        return file;
    };

    const extractRawMetadataFromJson = async (file: File) => {
        return extractRawMetadataFromJsonText(await file.text());
    };

    const applyRawMetadata = async (rawMeta: string, sourceLabel: string) => {
        if (!rawMeta) {
            notify(`无法读取${sourceLabel}元数据`, 'error');
            return;
        }

        try {
            const parsed = parseNovelAIMetadata(rawMeta, activeEditDraft?.params || params, naiRuntimeConfig?.metadataModelMappings);
            if (activeEditOperation && activeEditDraft) {
                updateEditDraft(activeEditOperation, buildImageEditMetadataPatch(parsed.prompt, parsed.negativePrompt, parsed.params));
                const modeLabel = activeEditOperation === 'image-to-image' ? '图生图' : activeEditOperation === 'inpaint' ? '局部重绘' : '扩图';
                notify(`已将完整提示词、角色与生成参数导入当前${modeLabel}页面。`);
                return;
            }
            setBasePrompt(parsed.prompt);
            setSubjectPrompt('');
            setNegativePrompt(parsed.negativePrompt);
            setParams(parsed.params);
            clearPresetSources();
            markChange();
            notify('已将完整提示词导入全局提示词，并恢复角色与生成参数。');
        } catch (e: any) {
            notify('解析失败: ' + e.message, 'error');
        }
    };

    const importMetadataFile = async (file: File) => {

        const normalizedFile = normalizeMetadataFile(file);
        if (isJsonMetadataFile(normalizedFile)) {
            try {
                const rawMeta = await extractRawMetadataFromJson(normalizedFile);
                await applyRawMetadata(rawMeta, 'JSON');
            } catch (e: any) {
                notify('读取 JSON 失败: ' + e.message, 'error');
            }
            return;
        }

        if (!isPngMetadataFile(normalizedFile)) {
            notify('目前只支持导入 PNG 图片或 JSON 元数据文件', 'error');
            return;
        }

        const rawMeta = await extractMetadata(normalizedFile);
        await applyRawMetadata(rawMeta || '', '图片');
    };

    const handleImportImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await importMetadataFile(file);
        if (importInputRef.current) importInputRef.current.value = '';
    };

    const hasImageImportPayload = (dataTransfer: DataTransfer) => {
        const types = Array.from(dataTransfer.types || []);
        return types.includes('Files') || types.includes('text/uri-list');
    };

    const getDroppedImageFile = (dataTransfer: DataTransfer) => {
        const files = Array.from(dataTransfer.files || []);
        return files.find(file => file.type.startsWith('image/') || isPngMetadataFile(file) || isJsonMetadataFile(file)) || null;
    };

    const getDroppedImageUrl = (dataTransfer: DataTransfer) => {
        const uriList = dataTransfer.getData('text/uri-list');
        const uri = uriList
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#'));

        return uri || '';
    };

    const importImageMetadataUrl = async (url: string) => {
        if (!url) return;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const fileName = url.split('/').pop()?.split('?')[0] || 'dropped-image.png';
            await importMetadataFile(new File([blob], fileName, { type: blob.type || 'image/png' }));
        } catch {
            notify('无法读取拖入图片。请改为拖入本地 PNG 文件，或使用“导入图片配置”按钮。', 'error');
        }
    };

    const resetImportDragState = () => {
        importDragDepthRef.current = 0;
        setIsImportDragActive(false);
    };

    const handleImportDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        if (!hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        importDragDepthRef.current += 1;
        setIsImportDragActive(true);
    };

    const handleImportDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setIsImportDragActive(true);
    };

    const handleImportDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
        if (importDragDepthRef.current === 0) {
            setIsImportDragActive(false);
        }
    };

    const handleImportDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        if (!hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();

        const file = getDroppedImageFile(e.dataTransfer);
        const imageUrl = file ? '' : getDroppedImageUrl(e.dataTransfer);
        resetImportDragState();

        if (file) {
            await importMetadataFile(file);
            return;
        }

        if (imageUrl) {
            await importImageMetadataUrl(imageUrl);
            return;
        }

        notify('未找到可导入的图片文件', 'error');
    };

    /**
     * 从外部投递的数据（历史/灵感页面的一键导入）中加载参数
     * 由 useEffect 在检测到 sessionStorage 中的 nai_pending_import 时调用
     */
    const applyImportData = (data: PendingImportData | PromptFragmentImport | BaseImageImport) => {
        if (data.mode === 'base-image') {
            void createEditDraftFromSource(data.imageEditOperation, data.baseImageUrl, 'upload', undefined,
                activeEditDraft?.prompt ?? finalPrompt, activeEditDraft?.negativePrompt ?? negativePrompt,
                activeEditDraft?.params ?? params).catch(error => notify(error instanceof Error ? error.message : '底图读取失败', 'error'));
            return;
        }
        if (data.targetMode === 'text-to-image') {
            updateWorkspace(previous => ({ ...previous, activeMode: 'text-to-image' }));
        }
        if (data.mode === 'prompt-fragments' || data.mode === 'append-prompt') {
            const fragment: PromptFragmentImport = data.mode === 'prompt-fragments' ? data : { mode: 'prompt-fragments', prompt: data.prompt };
            if (data.targetMode !== 'text-to-image' && activeEditOperation && activeEditDraft) {
                const patch = buildPromptFragmentPatch(activeEditDraft, fragment);
                updateEditDraft(activeEditOperation, { ...patch, promptSource: 'custom' });
            } else {
                const textDraft = workspaceSession.textToImage;
                const patch = buildPromptFragmentPatch(data.targetMode === 'text-to-image'
                    ? { prompt: textDraft.basePrompt, negativePrompt: textDraft.negativePrompt, params: textDraft.params }
                    : { prompt: basePrompt, negativePrompt, params }, fragment);
                if (patch.prompt !== undefined) setBasePrompt(patch.prompt);
                if (patch.negativePrompt !== undefined) setNegativePrompt(patch.negativePrompt);
                if (patch.params) setParams(patch.params);
                if (fragment.fullMetadata) {
                    setSubjectPrompt(''); setModules([]);
                    setActiveModules(Object.fromEntries([...Object.keys(activeModules), ...modules.map(module => module.id)].map(id => [id, false])));
                }
            }
            if (fragment.fullMetadata) clearPresetSources();
            markChange();
            notify('已取用所选内容到当前模式');
            return;
        }
        if (data.mode === 'image-edit' && data.baseImageUrl) {
            const operation = data.imageEditOperation || 'image-to-image';
            const source = data.sourceInspirationId ? 'inspiration' : (data.parentHistoryId ? 'history' : 'upload');
            void createEditDraftFromSource(
                operation,
                data.baseImageUrl,
                source,
                data.parentHistoryId,
                data.prompt ?? finalPrompt,
                data.negativePrompt ?? negativePrompt,
                data.params ?? params,
                data.editMetadata,
                data.reuseEditMask === true,
            );
            notify('已载入底图，正在打开对应图片编辑模式。');
            return;
        }
        if (data.mode === 'prompt-only') {
            setBasePrompt(data.prompt || '');
            setSubjectPrompt('');
            markChange();
            notify('已使用灵感的正面 Prompt。');
            return;
        }
        if (data.mode === 'negative-only') {
            setNegativePrompt(data.negativePrompt || '');
            markChange();
            notify('已使用灵感的负面 Prompt。');
            return;
        }
        if (data.mode === 'params-only') {
            setParams(data.params);
            markChange();
            notify('已使用灵感的生成参数。');
            return;
        }
        const hasPromptStructure = typeof data.basePrompt === 'string' || typeof data.subjectPrompt === 'string' || Array.isArray(data.modules);
        if (hasPromptStructure) {
            const importedModules = (data.modules || []).map(module => ({ ...module, position: module.position || 'post' }));
            setBasePrompt(data.basePrompt || '');
            setSubjectPrompt(data.subjectPrompt || '');
            setModules(importedModules);
            setActiveModules(Object.fromEntries(importedModules.map(module => [module.id, module.isActive])));
        } else {
            setBasePrompt(data.prompt || '');
            setSubjectPrompt('');
        }
        setNegativePrompt(data.negativePrompt);
        setParams(data.params);
        clearPresetSources();
        markChange();
        const charCount = data.params?.characters?.length || 0;
        if (charCount > 0) {
            notify(`已导入 ${charCount} 个多角色槽位与生成参数。`);
        } else {
            notify(hasPromptStructure ? '已按原结构恢复提示词与生成参数。' : '已恢复全局提示词与生成参数。');
        }
    };

    const prepareCurrentPreviewCover = async (forceUpload = false, sourceImage = displayedPreviewImage): Promise<{ previewImage?: string; changed: boolean }> => {
        const decision = decideCurrentPreviewCover(sourceImage, chain.previewImage, forceUpload);
        if (!decision.source || !decision.needsUpload) {
            return { previewImage: decision.source || undefined, changed: false };
        }

        // blob: 预览在卸载 cleanup 中可能已被 revoke；优先使用生成时保留的内存 blob。
        const coverSource = decision.source;
        const retainedBlob = coverSource.startsWith('blob:') ? lastGeneratedBlobRef.current : null;
        const blob = retainedBlob ?? await (async () => {
            const response = await fetch(coverSource);
            if (!response.ok) throw new Error(`读取当前预览图片失败（${response.status}）`);
            return response.blob();
        })();
        if (!blob.type.startsWith('image/')) throw new Error('当前预览内容不是有效图片');
        const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
        const file = new File([blob], `chain-cover.${extension}`, { type: blob.type });
        const upload = await api.uploadFile(file, 'covers');
        return { previewImage: upload.url, changed: true };
    };

    /** 离开编辑页前，若风格串尚未设置封面且当前有可见图片，自动将该图设为封面。
     *  已有封面或非风格串时不改动；失败静默，不阻塞返回。
     *  已通过保存设过封面（coverAutoSaveTriggeredRef）时不重复上传。 */
    const coverAutoSaveTriggeredRef = useRef(false);
    const autoSaveCoverOnExit = async () => {
        if (coverAutoSaveTriggeredRef.current) return;
        // 实验室（playground）是临时试验田，不是真正的风格串：它永远没有持久封面。
        // 缺了这条豁免，实验室实例被 keep-alive 淘汰卸载时会把生成的图"自动设为封面"
        // 并弹提示，而用户此刻早已在其他页面。
        if (chain.id === 'playground') return;
        if (chain.type !== 'style' || chain.previewImage) return;
        if (!displayedPreviewImage || isUploading) return;
        try {
            const cover = await prepareCurrentPreviewCover();
            if (cover.changed && cover.previewImage) {
                await onUpdateChain(chain.id, { previewImage: cover.previewImage });
                notify('已自动将当前图片设为封面');
            }
            coverAutoSaveTriggeredRef.current = true;
        } catch (error) {
            console.warn('离开时自动保存封面失败:', error);
        }
    };

    /** 组件卸载（离开编辑页：左箭头返回、侧边栏切页、点风格串图标等任意路径）时触发自动补封面。 */
    const autoSaveCoverOnExitRef = useRef(autoSaveCoverOnExit);
    autoSaveCoverOnExitRef.current = autoSaveCoverOnExit;
    useEffect(() => () => {
        // 用户在导航守卫里明确选择了「放弃并离开」：跳过自动补封面等所有卸载副作用。
        if (consumeEditorSessionDiscarded(chain.id)) return;
        void autoSaveCoverOnExitRef.current();
    }, []);

    const handleSaveAll = async () => {
        if (isUploading || !canSaveActiveModeToLibrary || chain.id === 'playground') return false;
        setIsUploading(true);
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        const varValues = { 'subject': subjectPrompt };
        try {
            const cover = chain.type === 'style'
                ? await prepareCurrentPreviewCover()
                : { previewImage: chain.previewImage, changed: false };
            await onUpdateChain(chain.id, {
                name: chainName,
                description: chainDesc,
                tags: chainTags,
                basePrompt,
                negativePrompt,
                modules: updatedModules,
                params,
                variableValues: varValues,
                ...(cover.changed ? { previewImage: cover.previewImage } : {}),
            });
            if (cover.changed) {
                setPreviewMode('cover');
                setGeneratedImage(null);
                coverAutoSaveTriggeredRef.current = true;
            }
            setHasChanges(false);
            notify(`${isCharacterMode ? '自定义角色' : '风格串'}已保存${cover.changed ? '，当前图片已设为封面' : ''}`);
            return true;
        } catch (error: any) {
            notify(`保存失败：${error?.message || '未知错误'}`, 'error');
            return false;
        } finally {
            setIsUploading(false);
        }
    };

    React.useImperativeHandle(saveRef, () => ({
        canSave: !isUploading && canSaveActiveModeToLibrary && chain.id !== 'playground',
        save: handleSaveAll,
    }));

    const handleFork = () => {
        if (!canSaveActiveModeToLibrary || isUploading) return;
        if (chain.id === 'playground') { void confirmFork('style'); return; }
        setShowForkModal(true);
    };

    const handleReset = async () => {
        if (isGenerating || modeTransitionRef.current) return;
        if (activeEditOperation) {
            const modeLabel = getLabModeLabel(activeEditOperation);
            if (!await confirmAction({
                title: `重置${modeLabel}？`,
                message: `将清空${modeLabel}的底图、蒙版与提示词。此操作无法撤销。`,
                confirmLabel: '确认重置',
                tone: 'danger',
            })) return;

            await flushMaskSave(activeEditOperation, false).catch(error => console.warn('重置编辑模式前保存蒙版失败:', error));
            cancelPendingMaskSave();
            editBaseResolveRevisionRef.current += 1;
            await resetEditOperation(activeEditOperation);
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
            setImageEditMaskData(undefined);
            if (chain.id !== 'playground') {
                setGeneratedImage(null);
                setPreviewMode('cover');
            }
            notify(`${modeLabel}已重置`);
            return;
        }

        if (!await confirmAction({
            title: '重置文生图？',
            message: chain.id === 'playground'
                ? '将恢复文生图的提示词、模块与参数为默认值。此操作无法撤销。'
                : `将放弃当前修改，恢复「${chain.name}」已保存的内容。其他模式的草稿保留。`,
            confirmLabel: '确认重置',
            tone: 'danger',
        })) return;

        const resetToSaved = chain.id !== 'playground';
        const restored = resetToSaved ? workspaceFallback.textToImage : createLabWorkspaceSession('', '', '', LAB_DEFAULT_PARAMS, {}).textToImage;
        editorRevisionRef.current += 1;
        setBasePrompt(restored.basePrompt);
        setNegativePrompt(restored.negativePrompt);
        setSubjectPrompt(restored.subjectPrompt);
        setModules(resetToSaved ? (chain.modules || []).map(module => ({ ...module, position: module.position || 'post' })) : []);
        setActiveModules(restored.activeModules);
        setParams(restored.params);
        if (resetToSaved) {
            setChainTags(chain.tags || []);
            setHasChanges(false);
        }
        clearPresetSources();
        setGeneratedImage(null);
        setPreviewMode('cover');
        notify(resetToSaved ? '已恢复保存的内容' : '文生图已重置');
    };

    const confirmFork = async (targetType: 'style' | 'character') => {
        if (isUploading || !canSaveActiveModeToLibrary) return;
        setIsUploading(true);
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        try {
            const cover = targetType === 'style'
                ? await prepareCurrentPreviewCover(true)
                : { previewImage: chain.previewImage, changed: false };
            await onFork({
                ...chain,
                name: chainName,
                description: chain.id === 'playground' ? '' : chainDesc,
                tags: chainTags,
                basePrompt,
                negativePrompt,
                modules: updatedModules,
                params,
                variableValues: { 'subject': subjectPrompt },
                previewImage: cover.previewImage,
            }, targetType);
            setShowForkModal(false);
        } catch (error: any) {
            notify(`保存失败：${error?.message || '未知错误'}`, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const saveCharacterToLibrary = async (character: CharacterParams, name: string) => {
        if (!onCreateCharacter || isUploading) throw new Error('当前无法保存角色');
        setIsUploading(true);
        try {
            const roleParams = activeEditOperation && activeEditDraft ? activeEditDraft.params : params;
            const coverSource = activeEditOperation ? imageEditPreviewImage : displayedPreviewImage;
            const cover = await prepareCurrentPreviewCover(true, coverSource);
            await onCreateCharacter({
                ...chain,
                type: 'character',
                name,
                description: '',
                tags: [],
                basePrompt: character.prompt,
                negativePrompt: character.negativePrompt || '',
                modules: [],
                params: { ...roleParams, characters: [], vibes: undefined, characterReferences: undefined },
                variableValues: { subject: '' },
                previewImage: cover.previewImage,
            });
            notify('角色已保存到角色库');
        } finally {
            setIsUploading(false);
        }
    };

    const toggleModuleActive = (id: string) => {
        setActiveModules(prev => {
            const newState = { ...prev, [id]: !prev[id] };

            // Group Logic: If activating, deactivate others in same group
            if (newState[id]) {
                const targetMod = modules.find(m => m.id === id);
                if (targetMod && targetMod.group) {
                    modules.forEach(m => {
                        if (m.id !== id && m.group === targetMod.group && prev[m.id]) {
                            newState[m.id] = false;
                        }
                    });
                }
            }

            markChange();
            return newState;
        });
    };

    const checkAndRemoveUntestedTag = () => {
        if (chain.id && chain.id !== 'playground' && chainTags.includes(UNTESTED_CHAIN_TAG)) {
            const updatedTags = chainTags.filter(t => t !== UNTESTED_CHAIN_TAG);
            if (mountedRef.current) setChainTags(updatedTags);
            void onUpdateChain(chain.id, { tags: updatedTags });
        }
    };

    /** 费用上涨后由用户补充授权；没有确认就不恢复后端任务。 */
    const promptJobApproval = async (session: GenerationSeriesSession, awaiting: { cost: number; completedCount: number; requestedCount: number }) => {
        const remaining = Math.max(0, awaiting.requestedCount - awaiting.completedCount);
        const approved = await confirmAction({
            title: '后台任务费用已变化',
            message: `当前每张预计 ${awaiting.cost} Anlas，剩余 ${remaining} 张预计 ${awaiting.cost * remaining} Anlas。确认后继续生成；取消将停止后续请求，已经提交的图片仍会保存。`,
            confirmLabel: `消耗约 ${awaiting.cost * remaining} 点并继续`,
            tone: 'danger',
        });
        if (!approved) { stopGenerationSeriesSession(session); return; }
        try { await approveGenerationSeries(session, awaiting.cost); }
        catch (error) {
            // 授权未生效时允许再次提示，不能替用户自动确认。
            awaitingApprovalRef.current = '';
            if (mountedRef.current) notify((error as Error).message, 'error');
        }
    };
    promptJobApprovalRef.current = promptJobApproval;

    const assertGenerationPreference = (count: number, placement?: GenerationPlacement) => {
        if (!continuousGenerationEnabledRef.current && (count > 1 || placement)) {
            throw agentOperationError('连续生成与排队已关闭，请在设置中开启后再请求多张或排队', 'continuous_generation_disabled');
        }
    };

    /** 提交一次有限后台任务：POST 一次后只观察后端状态与结果，本页不再逐张请求或落库。 */
    const runBackgroundJob = async (descriptor: GenerationJobDescriptor, count: number,
        options?: { agent?: boolean; autoApproveCost?: boolean; onApproved?: () => Promise<void>; placement?: GenerationPlacement; onCompleted?: (item: LocalGenItem) => void | Promise<void> }): Promise<PromptAgentGenerationResult> => {
        // 描述符构建与批准回调都是异步的：提交前必须确认 Key 仍是本轮开始时的 Key，不能把旧任务投给新 Key。
        const assertSubmitKey = () => {
            const storedKey = sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';
            if (latestGenerationStateRef.current.apiKey !== apiKey || storedKey !== apiKey) throw agentOperationError('NovelAI Key 已变化，已取消本次生成', 'key_changed');
        };
        try {
            validateGenerationCount(count);
            validateGenerationPlacement(options?.placement);
            assertGenerationPreference(count, options?.placement);
            if (!apiKey) throw agentOperationError('请先在“全局设置”中配置 NovelAI API Key', 'missing_key');
            if (!options?.placement && (generationSeriesRef.current || isGenerating)) throw agentOperationError('已有图片正在生成，请等待完成', 'generation_busy');
            assertSubmitKey();
            await options?.onApproved?.();
            assertSubmitKey();
            // 确认或准备期间关闭偏好后，不再投递尚未提交的多张/排队任务。
            assertGenerationPreference(count, options?.placement);
            const { session, settle } = beginGenerationSeries({ scope: chain.id, key: apiKey, count, agent: Boolean(options?.agent), placement: options?.placement, descriptor: { ...descriptor, ...(options?.autoApproveCost ? { autoApproveCost: true } : {}) } });
            if (!options?.placement) generationSeriesRef.current = session;
            const result = await settle;
            const completed = result.completedCount ?? 0;
            if (session.lastSavedItem) await options?.onCompleted?.(session.lastSavedItem);
            if (!mountedRef.current) return result;
            if (result.success) notify(`已生成并保存 ${completed} 张图片`, 'success');
            else if (result.outcome === 'cancelled') notify(`已取消后续生成，已保存 ${completed} 张图片`, 'success');
            else notify(`${result.error}（已保存 ${completed}/${count} 张）`, 'error');
            if (session.accountingFailed) notify('图片已保存，但本地记账异常，请核对额度后再继续', 'error');
            else if (session.cleanupError) notify(`后台任务清理异常：${session.cleanupError}`, 'error');
            return result;
        } catch (error) {
            const result = { ...agentGenerationFailure(error), requestedCount: count, completedCount: 0, historyIds: [] as string[] };
            if (mountedRef.current && result.outcome !== 'cancelled') notify(result.error || '连续生成失败', 'error');
            return result;
        }
    };

    /** 文生图：一次构建固定配置，随机种子交由后端每张重新抽取。 */
    const startTextToImageJob = async (draft: { basePrompt: string; subjectPrompt: string; negativePrompt: string; modules: PromptModule[]; params: NAIParams }, stream: boolean, approvedCost: number): Promise<GenerationJobDescriptor> => {
        const activeParams: NAIParams = {
            ...applyNaiModelSettings(draft.params, naiRuntimeConfig || DEFAULT_NAI_RUNTIME),
            ...(forceEmptySeed ? { seed: undefined } : {}),
            vibes: draft.params.vibes ? {
                ...draft.params.vibes,
                slots: normalizeVibeSelections(draft.params.vibes.slots, draft.params.vibes.normalizeStrengths),
            } : undefined,
        };
        return buildGenerationJobDescriptor({
            operation: 'text-to-image',
            prompt: compilePrompt({ basePrompt: draft.basePrompt, modules: draft.modules }, draft.subjectPrompt),
            negative: isNaiMediumModel(activeParams.model) ? '' : draft.negativePrompt,
            params: activeParams, stream, forceEmptySeed, approvedCost,
            history: {
                basePrompt: draft.basePrompt, subjectPrompt: draft.subjectPrompt, modules: draft.modules,
                sourceChainId, sourceChainName: chainName, sourceChainType: chain.id === 'playground' ? 'playground' : chain.type,
            },
        });
    };

    const submitTextToImageJob = async (draft: { basePrompt: string; subjectPrompt: string; negativePrompt: string; modules: PromptModule[]; params: NAIParams }, count: number, approvedCost: number,
        options?: { agent?: boolean; autoApproveCost?: boolean; onApproved?: () => Promise<void>; placement?: GenerationPlacement }): Promise<PromptAgentGenerationResult> => {
        generationInFlightRef.current = true;
        try {
            const streamSupported = getRuntimeNaiModelInfo(applyNaiModelSettings(draft.params, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).supportsStreamedResponses;
            const descriptor = await startTextToImageJob(draft, generationStreamPreview && streamSupported, approvedCost);
            return await runBackgroundJob(descriptor, count, options);
        } finally {
            generationInFlightRef.current = false;
        }
    };

    const handleGenerate = async (placement?: GenerationPlacement) => {
        if (placement && !continuousGenerationEnabledRef.current) {
            notify('连续生成与排队已关闭，请在设置中开启后再请求多张或排队', 'error');
            return false;
        }
        if (!placement && (generationSeriesRef.current || generationInFlightRef.current || isGenerating || externalGenerationBusy || queueState?.paused)) return false;
        if (!apiKey) {
            const message = '请先在“全局设置”中配置 NovelAI API Key';
            setErrorMsg(message);
            notify(message, 'error');
            return false;
        }
        const draft = structuredClone({ basePrompt, subjectPrompt, negativePrompt,
            modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })), params });
        const count = validateGenerationCount(effectiveGenerationCount);
        const freshSubscription = novelaiSubscription;
        void refreshUsageIfStale();
        const cost = estimateV45GenerationCost(draft.params, isActiveOpusSubscription(freshSubscription), freshSubscription?.usage?.isNegative ?? true);
        const totalCost = cost * count;
        if (count > 1 || placement) {
            if (!await confirmAction({
                title: placement ? placement === 'next' ? '排到下一位' : '加入生成队列' : '确认连续生成',
                message: `使用本轮固定的提示词与参数，逐张生成并保存 ${count} 张图片。${cost > 0 ? `\n每张预计 ${cost} Anlas，整轮预计 ${totalCost} Anlas。` : '\n当前参数预计使用免费额度；如果转为付费，将停止后续生成。'}\n停止只取消后续请求，正在生成的图片仍会接收并保存。${totalCost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖整轮消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}`,
                confirmLabel: cost > 0 ? `消耗约 ${totalCost} 点，生成 ${count} 张` : `生成 ${count} 张`,
                ...(totalCost > anlasBudget.remaining || runtimeSyncUnhealthy ? { tone: 'danger' as const } : {}),
            })) return false;
        } else if (cost > 0 && anlasBudget.remaining <= 0) {
            // 本地 Anlas 预算已用尽但仍需扣费：红色警告，由用户确认后才继续。
            if (!await confirmAction({
                title: 'Anlas 预算已用尽',
                message: `本地预算已扣到 0，本次生成仍需消耗 ${cost} Anlas（共享账号额度），继续将透支你手动设定的预算线。\n\n若预算数字过期，可先到全局设置校准。`,
                confirmLabel: `仍要消耗 ${cost} 点生成`,
                tone: 'danger',
            })) return false;
        } else if (cost > 0 && !await confirmAction({
            title: '确认生成图片',
            message: `当前参数预计消耗 ${cost} Anlas${params.characterReferences?.enabled && params.characterReferences.slots.length ? `\n其中角色参考：${params.characterReferences.slots.length} × ${(naiRuntimeConfig || DEFAULT_NAI_RUNTIME).billing.characterReferenceCost} = ${params.characterReferences.slots.length * (naiRuntimeConfig || DEFAULT_NAI_RUNTIME).billing.characterReferenceCost} Anlas` : ''}${cost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖本次消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}。`,
            confirmLabel: `消耗 ${cost} 点并生成`,
        })) return false;
        try {
            return (await submitTextToImageJob(draft, count, cost, { placement })).success;
        } catch (error) {
            const message = error instanceof Error ? error.message : '图片生成失败';
            if (mountedRef.current) { setErrorMsg(message); notify(message, 'error'); }
            return false;
        }
    };

    const imageEditCostLabel = (operation: ImageEditOperation, focused: boolean, context?: { width: number; height: number; focusedRect?: { x: number; y: number; width: number; height: number } | null; minimumContextArea?: number }) => {
        const focusedReady = operation === 'inpaint' && focused && Boolean(context?.focusedRect && context.focusedRect.width >= 2 && context.focusedRect.height >= 2);
        if (operation === 'inpaint' && focused && !focusedReady) return '';
        if (costStatusLabel) return costStatusLabel;
        // strength=0 是合法值（完全保留原图、几乎不重绘）；不能用 || 回退到默认 0.7
        const editStrength = activeEditDraft?.strength !== undefined ? activeEditDraft.strength : (operation === 'image-to-image' ? 0.7 : 1);
        const costParams = activeEditDraft?.params || params;
        const cost = estimateImageEditCost(costParams, operation, editStrength, focusedReady, opusSubscriptionActive ? novelaiSubscription?.tier : 0, opusUsageExhausted, context);
        return formatGenerationCostLabel(cost * effectiveGenerationCount, costParams.model);
    };

    const handleImageEditGenerate = async (request: ImageEditRequest, options?: { params?: NAIParams; onApproved?: () => Promise<void>; agent?: boolean; count?: number; placement?: GenerationPlacement }): Promise<PromptAgentGenerationResult> => {
        const count = validateGenerationCount(options?.agent ? options.count : effectiveGenerationCount);
        // 未提交的任务同样回完整回执：请求数与已保存数为 0，历史 ID 为空。
        const stop = (message: string, code: string, outcome: 'blocked' | 'failed' | 'cancelled' = 'blocked'): PromptAgentGenerationResult => {
            if (options?.agent) throw agentOperationError(message, code, outcome);
            return { ...agentGenerationFailure(agentOperationError(message, code, outcome)), requestedCount: count, completedCount: 0, historyIds: [] };
        };
        if (!continuousGenerationEnabledRef.current && (count > 1 || options?.placement)) {
            return stop('连续生成与排队已关闭，请在设置中开启后再请求多张或排队', 'continuous_generation_disabled');
        }
        if (!apiKey) {
            const message = '请先在“全局设置”中配置 NovelAI API Key';
            setErrorMsg(message);
            notify(message, 'error');
            return stop(message, 'missing_key');
        }
        if (!options?.placement && (generationSeriesRef.current || generationInFlightRef.current || isGenerating)) return stop('此 Key 正在生成，请等待当前任务完成', 'generation_busy');
        const permissionMode = options?.agent ? (await promptAgentService.getConfig()).permissionMode : undefined;
        if (permissionMode === 'read_only') return stop('当前为只读权限，不能生成图片', 'agent_read_only');
        const fullAccess = permissionMode === 'full';
        const editParamsSource = options?.params || request.params || activeEditDraft?.params || params;
        const freshSubscription = latestGenerationStateRef.current.subscription.info;
        void refreshUsageIfStale();
        let sourceWidth = request.canvasWidth;
        let sourceHeight = request.canvasHeight;
        try {
            const bitmap = await createImageBitmap(await dataUrlToBlob(request.image));
            sourceWidth = bitmap.width;
            sourceHeight = bitmap.height;
            bitmap.close();
        } catch {
            const message = '无法读取图片编辑底图尺寸';
            setErrorMsg(message);
            notify(message, 'error');
            return stop(message, 'invalid_base_image');
        }
        const editCost = estimateImageEditCost(editParamsSource, request.operation, request.strength, Boolean(request.focused), isActiveOpusSubscription(freshSubscription) ? freshSubscription!.tier : 0, freshSubscription?.usage?.isNegative ?? true, {
            width: sourceWidth,
            height: sourceHeight,
            focusedRect: request.focusedRect,
            minimumContextArea: request.minimumContextArea,
        });
        const syncWarning = runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : '';
        const totalCost = editCost * count;
        // 标准权限只确认一次，完全访问沿用授权；提交后由后端费用状态机继续裁决。
        if (!fullAccess && (count > 1 || options?.placement)) {
            if (!await confirmAction({
                title: options?.placement ? options.placement === 'next' ? '排到下一位' : '加入生成队列' : '确认连续生成',
                message: `使用本轮固定的提示词、参数与底图，逐张生成并保存 ${count} 张图片。${editCost > 0 ? `\n每张预计 ${editCost} Anlas，整轮预计 ${totalCost} Anlas。` : '\n当前参数预计使用免费额度；如果转为付费，将停止后续生成。'}\n停止只取消后续请求，正在生成的图片仍会接收并保存。${totalCost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖整轮消耗。` : ''}${syncWarning}`,
                confirmLabel: editCost > 0 ? `消耗约 ${totalCost} 点，生成 ${count} 张` : `生成 ${count} 张`,
                ...(totalCost > anlasBudget.remaining || runtimeSyncUnhealthy ? { tone: 'danger' as const } : {}),
            })) return stop('用户取消了生图请求', 'user_cancelled', 'cancelled');
        } else if (!fullAccess && editCost > 0 && anlasBudget.remaining <= 0) {
            if (!await confirmAction({ title: 'Anlas 预算已用尽', message: `本次图片编辑预计消耗 ${editCost} Anlas，继续将透支本地预算线。${syncWarning}`, confirmLabel: `仍要消耗 ${editCost} 点`, tone: 'danger' })) return stop('用户取消了生图请求', 'user_cancelled', 'cancelled');
        } else if (!fullAccess && (editCost > 0 || options?.agent) && !await confirmAction({ title: '确认图片编辑', message: `本次${request.operation === 'image-to-image' ? '图生图' : request.operation === 'inpaint' ? '局部重绘' : '扩图'}本地结算估算消耗 ${editCost} Anlas；生成成功后会刷新当前 Key 的账号额度。${editCost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖本次消耗。` : ''}${syncWarning}`, confirmLabel: editCost > 0 ? `消耗 ${editCost} 点并生成` : '仍要生成', ...(runtimeSyncUnhealthy ? { tone: 'danger' as const } : {}) })) return stop('用户取消了生图请求', 'user_cancelled', 'cancelled');
        await flushMaskSave(request.operation).catch(error => console.warn('生成前保存编辑蒙版失败:', error));
        generationInFlightRef.current = true;
        if (mountedRef.current) {
            setIsGenerating(true);
            setErrorMsg(null);
        }
        try {
            const editParams: NAIParams = {
                ...editParamsSource,
                width: sourceWidth,
                height: sourceHeight,
                seed: forceEmptySeed ? undefined : editParamsSource.seed,
            };
            const streamSupported = getRuntimeNaiModelInfo(applyNaiModelSettings(editParams, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).supportsStreamedResponses;
            // 只提交一次：回贴原料与整图历史参数都在这里固定，随机种子由后端每张抽取。
            const job = await buildGenerationJobDescriptor({
                operation: request.operation, prompt: request.prompt, negative: request.negativePrompt, params: editParams,
                stream: generationStreamPreview && streamSupported, forceEmptySeed, apiKey, estimatedCost: editCost, approvedCost: editCost,
                history: {
                    basePrompt, subjectPrompt,
                    modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })),
                    sourceChainId, sourceChainName: chainName, sourceChainType: chain.id === 'playground' ? 'playground' : chain.type,
                    edit: {
                        operation: request.operation,
                        parentHistoryId: request.parentHistoryId,
                        baseImageSource: request.baseImageSource || (request.parentHistoryId ? 'history' : 'generated'),
                        strength: request.strength, noise: request.noise, focused: request.focused,
                        minimumContextArea: request.minimumContextArea, focusedArea: request.focusedRect,
                        contextArea: request.minimumContextArea, canvasExpansion: request.expansion, promptSource: request.promptSource,
                    },
                },
                edit: {
                    image: request.image, mask: request.mask, strength: request.strength, noise: request.noise,
                    focused: request.focused, focusedRect: request.focusedRect,
                    minimumContextArea: request.minimumContextArea, expansion: request.expansion,
                },
            });
            const result = await runBackgroundJob(job, count, {
                agent: options?.agent, autoApproveCost: fullAccess, placement: options?.placement, onApproved: options?.onApproved,
                onCompleted: persistEditResultAsset,
            });
            if (result.success && !options?.agent) notify('图片编辑完成，结果已保存为新的历史图片', 'success');
            return result;
        } catch (editError) {
            const message = editError instanceof Error ? editError.message : '图片编辑失败';
            if (mountedRef.current) { setErrorMsg(message); notify(message, 'error'); }
            const failure = agentGenerationFailure(editError);
            return stop(message, failure.code || 'generation_failed', failure.outcome === 'cancelled' ? 'cancelled' : failure.outcome === 'blocked' ? 'blocked' : 'failed');
        } finally {
            generationInFlightRef.current = false;
            if (mountedRef.current) setIsGenerating(false);
        }
    };

    /** 后台任务保存编辑结果后，把它作为当前模式的结果资产留出预览入口。 */
    const persistEditResultAsset = async (item: LocalGenItem) => {
        const operation = item.edit?.operation;
        if (!operation) return;
        try {
            const response = await fetch(item.imageUrl);
            if (!response.ok) throw new Error(`读取图片编辑结果失败（${response.status}）`);
            const blob = await response.blob();
            lastGeneratedBlobRef.current = blob;
            const resultRef = await saveLabWorkspaceAsset(blob, getLabWorkspaceAssetId(workspaceKey, operation, 'result'));
            updateWorkspace(previous => ({
                ...previous,
                edits: { ...previous.edits, [operation]: { ...previous.edits[operation], resultImageRef: resultRef } },
            }));
        } catch (error) {
            console.warn('保存图片编辑结果资产失败:', error);
        }
    };

    const agentCanvasFingerprint = useMemo(() => agentDraftFingerprint({ base: imageEditBaseImage, mask: imageEditMaskData, draft: activeEditDraft && { ...activeEditDraft, params: undefined, prompt: undefined, negativePrompt: undefined } }), [imageEditBaseImage, imageEditMaskData, activeEditDraft]);
    const currentAgentDraft = (): PromptAgentDraft => {
        const content: PromptAgentDraft = activeEditDraft ? { editContext: { baseImageAvailable: Boolean(imageEditBaseImage), maskAvailable: Boolean(imageEditMaskData), strength: activeEditDraft.strength, noise: activeEditDraft.noise, focused: activeEditDraft.focused }, basePrompt: activeEditDraft.prompt, subjectPrompt: '', negativePrompt: activeEditDraft.negativePrompt, modules: [], params: activeEditDraft.params } : { basePrompt, subjectPrompt, negativePrompt, modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })), params };
        return { ...content, target: { chainId: chain.id, name: chain.name, mode: activeGenerationMode, fingerprint: agentDraftFingerprint({ content, canvas: activeEditDraft ? agentCanvasFingerprint : null }) } };
    };
    agentTargetRef.current = currentAgentDraft().target;
    const applyAgentDraft = (draft: PromptAgentDraft) => {
        if (draft.target?.mode && draft.target.mode !== 'text-to-image') {
            updateEditDraft(draft.target.mode, { prompt: [draft.basePrompt, draft.subjectPrompt, ...draft.modules.filter(module => module.isActive).map(module => module.content)].filter(Boolean).join(', '), negativePrompt: draft.negativePrompt, params: draft.params, promptSource: 'custom' });
            return;
        }
        setBasePrompt(draft.basePrompt);
        setSubjectPrompt(draft.subjectPrompt);
        setNegativePrompt(draft.negativePrompt);
        setModules(draft.modules);
        setActiveModules(Object.fromEntries(draft.modules.map(module => [module.id, module.isActive])));
        setParams(draft.params);
        setHasChanges(true);
    };

    const requestAgentGeneration = async (draft: PromptAgentDraft, reason?: string, onApproved?: () => Promise<void>, count = 1, placement?: GenerationPlacement): Promise<PromptAgentGenerationResult> => {
        // 未提交的任务也回完整回执：请求数与已保存数为 0，历史 ID 为空。
        if (!placement && (generationSeriesRef.current || generationInFlightRef.current || isGenerating)) return { ...agentGenerationFailure(agentOperationError('已有图片正在生成，请等待完成', 'generation_busy')), requestedCount: count, completedCount: 0, historyIds: [] };
        const execute = async (): Promise<PromptAgentGenerationResult> => {
            validateGenerationCount(count);
            validateGenerationPlacement(placement);
            assertGenerationPreference(count, placement);
            const target = agentTargetRef.current;
            if (draft.target && (draft.target.chainId !== target?.chainId || draft.target.mode !== target?.mode || draft.target.fingerprint !== target?.fingerprint)) throw agentOperationError('创作目标已变化，请先读取当前状态，再重新请求生成', 'target_changed');
            const approve = async () => {
                const current = agentTargetRef.current;
                if (draft.target && (draft.target.chainId !== current?.chainId || draft.target.mode !== current?.mode || draft.target.fingerprint !== current?.fingerprint)) throw agentOperationError('确认期间创作目标已变化，请重新提出请求', 'target_changed');
                await onApproved?.();
            };
            if (activeGenerationMode !== 'text-to-image') {
                if (!agentEditGenerateRef.current) throw agentOperationError('编辑画布尚未准备好', 'canvas_not_ready');
                const agentResult = await agentEditGenerateRef.current(draft, approve, count, placement);
                if (typeof agentResult !== 'boolean') return agentResult;
                return agentResult
                    ? normalizeAgentGenerationResult({ success: true, historySaved: true, outcome: 'succeeded' })
                    : agentGenerationFailure(agentOperationError('图片编辑未返回生成回执', 'generation_failed', 'failed'));
            }
            const freshSubscription = novelaiSubscription;
            void refreshUsageIfStale();
            const cost = estimateV45GenerationCost(draft.params, isActiveOpusSubscription(freshSubscription), freshSubscription?.usage?.isNegative ?? true);
            const totalCost = cost * count;
            const permissionMode = (await promptAgentService.getConfig()).permissionMode;
            if (permissionMode === 'read_only') throw agentOperationError('当前为只读权限，不能生成图片', 'agent_read_only');
            const fullAccess = permissionMode === 'full';
            // 完全访问已授权生图费用，其他权限仍逐轮确认。
            if (!fullAccess && cost > 0 && anlasBudget.remaining <= 0) {
                if (!await confirmAction({
                    title: 'Anlas 预算已用尽',
                    message: `${reason ? `${reason}\n\n` : ''}本地预算已扣到 0，本次生成仍需消耗 ${cost} Anlas（共享账号额度），继续将透支你手动设定的预算线。`,
                    confirmLabel: `仍要消耗 ${cost} 点生成`,
                    tone: 'danger',
                })) throw agentOperationError('用户取消了生图请求', 'user_cancelled', 'cancelled');
            } else if (!fullAccess && (count > 1 || placement)) {
                if (!await confirmAction({
                    title: placement ? placement === 'next' ? '排到下一位' : '加入生成队列' : '确认连续生成',
                    message: `${reason ? `${reason}\n\n` : ''}使用本轮固定的提示词与参数，逐张生成并保存 ${count} 张图片。${cost > 0 ? `\n每张预计 ${cost} Anlas，整轮预计 ${totalCost} Anlas。` : '\n当前参数预计使用免费额度；如果转为付费，将停止后续生成。'}\n停止只取消后续请求，正在生成的图片仍会接收并保存。${totalCost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖整轮消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}`,
                    confirmLabel: cost > 0 ? `消耗约 ${totalCost} 点，生成 ${count} 张` : `生成 ${count} 张`,
                    ...(totalCost > anlasBudget.remaining || runtimeSyncUnhealthy ? { tone: 'danger' as const } : {}),
                })) throw agentOperationError('用户取消了生图请求', 'user_cancelled', 'cancelled');
            } else if (!fullAccess && !await confirmAction({
                title: '助手已准备好生图',
                message: `${reason ? `${reason}\n\n` : ''}预计本次${formatGenerationCostLabel(cost, draft.params.model)}。确认后才会提交给 NovelAI。${cost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖本次消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}`,
                confirmLabel: cost > 0 ? `消耗 ${cost} 点并生成` : '确认生成一张',
            })) throw agentOperationError('用户取消了生图请求', 'user_cancelled', 'cancelled');
            return await submitTextToImageJob(structuredClone(draft), count, cost, { agent: true, autoApproveCost: fullAccess, placement, onApproved: approve });
        };
        try {
            return await execute();
        } catch (error) {
            return { ...agentGenerationFailure(error), requestedCount: count, completedCount: 0, historyIds: [] };
        }
    };

    const handleSavePreview = async () => {
        const coverImage = displayedPreviewImage;
        if (!coverImage || chain.id === 'playground') return;
        if (await confirmAction({
            title: '将当前图片设为封面并保存？',
            message: '替换原封面，并保存当前提示词与参数。',
            confirmLabel: '更换封面并保存',
            tone: 'danger',
        })) {
            setIsUploading(true);
            try {
                const res = await fetch(coverImage);
                const blob = await res.blob();
                const file = new File([blob], getDownloadFilename(), { type: 'image/png' });
                const uploadRes = await api.uploadFile(file, 'covers');
                const updatedModules = modules.map(m => ({
                    ...m,
                    isActive: activeModules[m.id] ?? true
                }));
                await onUpdateChain(chain.id, {
                    name: chainName,
                    description: chainDesc,
                    tags: chainTags,
                    basePrompt,
                    negativePrompt,
                    modules: updatedModules,
                    params,
                    variableValues: { 'subject': subjectPrompt },
                    previewImage: uploadRes.url,
                });
                setHasChanges(false);
                notify(`${isCharacterMode ? '自定义角色' : '风格串'}已保存，封面已更新`);
            } catch (e: unknown) {
                const errMessage = e instanceof Error ? e.message : String(e);
                notify('设置封面失败: ' + errMessage, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (await confirmAction({
            title: '上传更换封面并保存？',
            message: `将使用“${file.name}”作为新封面，并自动保存当前所有提示词与参数改动；原有上传封面文件将被替换。`,
            confirmLabel: '上传并保存',
            tone: 'danger',
        })) {
            setIsUploading(true);
            try {
                const res = await api.uploadFile(file, 'covers');
                const updatedModules = modules.map(m => ({
                    ...m,
                    isActive: activeModules[m.id] ?? true
                }));
                await onUpdateChain(chain.id, {
                    name: chainName,
                    description: chainDesc,
                    tags: chainTags,
                    basePrompt,
                    negativePrompt,
                    modules: updatedModules,
                    params,
                    variableValues: { 'subject': subjectPrompt },
                    previewImage: res.url,
                });
                setHasChanges(false);
                notify(`${isCharacterMode ? '自定义角色' : '风格串'}已保存，封面已更新`);
            } catch (err: unknown) {
                const errMessage = err instanceof Error ? err.message : String(err);
                notify('上传失败: ' + errMessage, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const copyPromptToClipboard = (value: string, label: string) => {
        navigator.clipboard.writeText(value);
        notify(`${label}已复制`);
    };

    const translateAllMissingPromptTags = async () => {
        if (translationPending) return;
        const characterPrompts = (activeEditDraft?.params || params).characters || [];
        const promptValues = activeEditDraft
            ? [activeEditDraft.prompt, activeEditDraft.negativePrompt, ...characterPrompts.flatMap(character => [character.prompt, character.negativePrompt || ''])]
            : [basePrompt, negativePrompt, ...characterPrompts.flatMap(character => [character.prompt, character.negativePrompt || ''])];
        const tokens = promptValues.flatMap(value => parsePromptTags(value || ''));
        if (!tokens.length) { notify(t("当前提示词没有未翻译 Tag")); return; }

        setTranslationPending(true);
        try {
            const resolved = await resolvePromptTranslations(tokens);
            const missingTags = [...new Set(resolved.filter(item => item.source === 'missing').map(item => item.lookupTag))];
            if (!missingTags.length) { notify(t("当前提示词没有未翻译 Tag")); return; }
            await translateMissingPromptTags(missingTags);
            notify(t("提示词 Tag 翻译完成"), 'success');
        } catch (error) {
            notify(error instanceof Error ? error.message : t("提示词 Tag 翻译失败"), 'error');
        } finally {
            setTranslationPending(false);
        }
    };

    return (
        <div
            className="chain-editor-workspace flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors relative"
            onDragEnter={handleImportDragEnter}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            onDrop={handleImportDrop}
        >
            {isImportDragActive && (
                <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-indigo-950/55 backdrop-blur-sm">
                    <div className="mx-4 max-w-sm rounded-lg border-2 border-dashed border-white/80 bg-white/95 px-6 py-5 text-center shadow-2xl dark:bg-gray-900/95 dark:border-indigo-300">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                            <FileDown className="h-6 w-6" />
                        </div>
                        <div className="text-base font-bold text-gray-900 dark:text-white">{t("松手导入配置")}</div>
                        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("PNG / JSON · 替换提示词与参数")}</div>
                    </div>
                </div>
            )}
            {/* Top Bar */}
            <ChainEditorHeader
                chainId={chain.id}
                isCharacterMode={isCharacterMode}
                isOwner={true}
                isGuest={false}
                canEdit={true}
                canSaveActiveModeToLibrary={canSaveActiveModeToLibrary}
                canSaveCurrentChain={canSaveCurrentChain}
                isUploading={isUploading}
                hasChanges={hasChanges}
                hasPendingPreviewCover={hasPendingPreviewCover}
                tagAssistEnabled={tagAssistEnabled}
                onTagAssistEnabledChange={onTagAssistEnabledChange}
                activeGenerationMode={activeGenerationMode}
                selectGenerationMode={selectGenerationMode}
                isGenerating={isGenerating || isSwitchingMode}
                onBack={onBack}
                handleReset={handleReset}
                handleFork={handleFork}
                handleSaveAll={handleSaveAll}
                handleImportImage={handleImportImage}
                onTranslateMissingPrompts={() => { void translateAllMissingPromptTags(); }}
                translationPending={translationPending}
                notify={notify}
            />

            <PromptAgentOverlayController
                chainId={chain.id}
                openToken={agentOpenToken}
                draft={currentAgentDraft()}
                apiKey={apiKey}
                onRunStart={snapshot => { agentRunRevisionRef.current = editorRevisionRef.current; setAgentUndoSnapshot(snapshot); }}
                onFinalDraft={(draft, reviewOnly) => {
                    if (reviewOnly) { setAgentProposal(draft); return; }
                    if (draft.target && (draft.target.chainId !== chain.id || draft.target.mode !== activeGenerationMode)) { notify('草稿属于其他作品或模式，请回到原目标后恢复', 'error'); return; }
                    if (draft.target ? draft.target.fingerprint !== currentAgentDraft().target?.fingerprint : editorRevisionRef.current !== agentRunRevisionRef.current) { setAgentProposal(draft); return; }
                    setAgentUndoSnapshot(currentAgentDraft()); applyAgentDraft(draft);
                }}
                onRequestGeneration={requestAgentGeneration}
                onGenerationInterrupted={() => {
                    if (generationSeriesRef.current?.agent) stopGenerationSeries();
                    for (const session of getQueuedGenerationSeries(chain.id)) if (session.agent) stopGenerationSeriesSession(session);
                }}
                canUndo={Boolean(agentUndoSnapshot)}
                onUndo={() => { if (agentUndoSnapshot) { applyAgentDraft(agentUndoSnapshot); setAgentUndoSnapshot(null); notify('已撤销本次助手修改'); } }}
                tagAssistEnabled={tagAssistEnabled}
                splitPromptFields={false}
            />
            {agentProposal && <AgentDraftReview current={currentAgentDraft()} proposed={agentProposal} onClose={() => setAgentProposal(null)} onApply={draft => { setAgentUndoSnapshot(currentAgentDraft()); applyAgentDraft(draft); setAgentProposal(null); }}/>}
            {activeGenerationMode === 'text-to-image' ? <>
            <nav className="grid h-10 grid-cols-3 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:hidden">
                {([['global', '全局'], ['character', '角色'], ['params', '参数']] as const).map(([value, label]) => <button key={value} onClick={() => setMobileEditorTab(value)} className={`relative min-w-0 text-sm font-bold ${mobileEditorTab === value ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>{t(label)}{mobileEditorTab === value && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-indigo-500" />}</button>)}
            </nav>

            {/* Editor Content */}
            <div className="chain-editor-body flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-white dark:bg-gray-900">
                {/* Left Panel - Editor */}
                <div className="chain-editor-main flex w-full lg:w-1/2 min-h-full flex-col border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 lg:overflow-y-auto bg-white dark:bg-gray-900 relative order-2 lg:order-1 lg:flex-1 shrink-0">
                    <div className="flex w-full max-w-3xl flex-col gap-6 p-4 pb-36 md:p-6 md:pb-24 mx-auto">
                        <ChainEditorPromptInputs
                            prompt={basePrompt}
                            setPrompt={setBasePrompt}
                            sections={params._promptSections || null}
                            setSections={(nextSections) => setParams(previous => ({ ...previous, _promptSections: nextSections }))}
                            supplementPrompt={subjectPrompt}
                            setSupplementPrompt={setSubjectPrompt}
                            presetSources={presetSources}
                            tagAssistEnabled={tagAssistEnabled}
                            canEdit={true}
                            copyPromptToClipboard={copyPromptToClipboard}
                            markPresetSectionModified={markPresetSectionModified}
                            markChange={markChange}
                            activeLabLayout={activeLabLayout}
                            mobileEditorTab={mobileEditorTab}
                        />

                        {/* Character Management (New V4.5) */}
                        <ChainEditorCharacters
                            scopeKey={`${chain.id}:text-to-image`}
                            params={params}
                            setParams={setParams}
                            characters={params.characters || []}
                            freeformPosition={activeModelInfo.freeformCharacterPosition}
                            canEdit={true}
                            tagAssistEnabled={tagAssistEnabled}
                            characterPresetSources={characterPresetSources}
                            allChains={allChains}
                            showCharacterReference
                            canSaveCharacter
                            onSaveCharacter={saveCharacterToLibrary}
                            notify={notify}
                            markPresetSectionModified={markPresetSectionModified}
                            markChange={markChange}
                            addCharacter={addCharacter}
                            updateCharacter={updateCharacter}
                            removeCharacter={removeCharacter}
                            activeLabLayout={activeLabLayout}
                            mobileEditorTab={mobileEditorTab}
                        />

                        {activeModelInfo.supportsCharacterReferences && <LabModuleSection
                            moduleId="characterReference"
                            label={t("角色参考")}
                            order={activeLabLayout.order.indexOf('characterReference')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.characterReference)}
                            className={mobileEditorTab === 'character' ? 'block' : 'hidden lg:block'}
                        >
                            <CharacterReferenceManager
                                params={params}
                                setParams={setParams}
                                markChange={markChange}
                                notify={notify}
                            />
                        </LabModuleSection>}

                        {activeModelInfo.supportsVibes && <LabModuleSection
                            moduleId="vibe"
                            label="Vibe Transfer"
                            order={activeLabLayout.order.indexOf('vibe')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.vibe)}
                            className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
                        >
                            <VibeManager
                                params={params}
                                setParams={setParams}
                                markChange={markChange}
                                apiKey={apiKey}
                                notify={notify}
                            />
                        </LabModuleSection>}

                        {/* Negative Prompt */}
                        <LabModuleSection
                            moduleId="negative"
                            label={t("全局负面提示词")}
                            order={activeLabLayout.order.indexOf('negative')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.negative)}
                            className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
                        >
                        <section className={isNaiMediumModel(params.model) ? 'nai-model-locked' : undefined} title={isNaiMediumModel(params.model) ? t('Medium 不支持负面提示词') : undefined}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <PresetSourceBadge source={presetSources.negative} />
                                </div>
                                <div className="flex items-center gap-1"><PromptCopyButton onClick={() => copyPromptToClipboard(negativePrompt, '全局负面提示词')} title={t("复制全局负面提示词")} /><PromptClearButton title={t('清空全局负面提示词')} disabled={isNaiMediumModel(params.model) || !negativePrompt.trim()} onClick={() => {setNegativePrompt(''); markPresetSectionModified('negative'); markChange();}} /></div>
                            </div>
                            <TagAutocompleteTextarea
                                tagAssistEnabled={tagAssistEnabled && !isNaiMediumModel(params.model)}
                                disabled={isNaiMediumModel(params.model)}
                                className="w-full border rounded-lg p-3 outline-none font-mono text-sm font-normal leading-relaxed min-h-[80px] bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-indigo-500/50"
                                value={negativePrompt}
                                onValueChange={(nextValue) => { setNegativePrompt(nextValue); markPresetSectionModified('negative'); markChange() }}
                            />
                        </section>
                        </LabModuleSection>

                        {/* Params Component */}
                        <LabModuleSection
                            moduleId="params"
                            label={t("参数设置")}
                            order={activeLabLayout.order.indexOf('params')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.params)}
                            className={mobileEditorTab === 'params' ? 'block' : 'hidden lg:block'}
                        >
                        <ChainEditorParams
                            params={params}
                            prompt={finalPrompt}
                            setParams={(nextParams) => { setParams(nextParams); markPresetSectionModified('settings'); }}
                            canEdit={true}
                            markChange={markChange}
                            presetSource={presetSources.settings}
                            forceEmptySeed={forceEmptySeed}
                            onForceEmptySeedChange={onForceEmptySeedChange}
                            enforceFreeStepLimit={enforceFreeStepLimit}
                        />
                        </LabModuleSection>
                    </div>

                </div>

                {/* Right Panel - Preview (Testing) - Extracted Component */}
                <div className="chain-editor-preview-wrapper hidden min-h-0 flex-1 lg:contents">
                <ChainEditorPreview
                    favorite={displayedPreviewItem ? { imageUrl: displayedPreviewItem.imageUrl, sourceType: 'history', sourceId: displayedPreviewItem.id } : { imageUrl: chain.previewImage || '', title: chain.name, sourceType: chain.type === 'character' ? 'character' : 'chain', sourceId: chain.id, prompt: chain.basePrompt, negativePrompt: chain.negativePrompt, params: chain.params }}
                    generationData={displayedPreviewItem ? { prompt: displayedPreviewItem.prompt, negativePrompt: displayedPreviewItem.negativePrompt, params: displayedPreviewItem.params } : undefined}
                    isGenerating={isGenerating}
                    generationDisabled={externalGenerationBusy}
                    unavailableLabel={generationUnavailableLabel}
                    handleGenerate={() => { void handleGenerate(); }}
                    errorMsg={errorMsg}
                    generatedImage={displayedPreviewImage}
                    previewImage={chain.previewImage}
                    setLightboxImg={setLightboxImg}
                    isOwner={true}
                    isUploading={isUploading}
                    handleSavePreview={handleSavePreview}
                    handleUploadCover={handleUploadCover}
                    getDownloadFilename={getDownloadFilename}
                    hideCoverActions={chain.id === 'playground'}
                    canNavigateHistory={previewHistory.length > 1 && (chain.id !== 'playground' || Boolean(displayedPreviewImage))}
                    historyLabel={displayedPreviewImage ? currentPreviewPosition : undefined}
                    onPreviousHistory={showPreviousHistory}
                    onNextHistory={showNextHistory}
                    canManageHistoryGroup={Boolean(selectedPreviewItem)}
                    onRemoveCurrentHistory={handleRemoveCurrentHistory}
                    onClearHistoryGroup={handleClearHistoryGroup}
                    generationCostLabel={generationCostLabel}
                    transparentPreview={activeModelInfo.supportsTransparentBackground && params.transparent === true}
                    generationProgress={generationProgress}
                    generationCountControl={generationCountControl}
                    notify={notify}
                />
                </div>
            </div>

            </> : activeEditOperation && activeEditDraft ? <ImageEditPanel
                favorite={imageEditPreviewItem ? { imageUrl: imageEditPreviewItem.imageUrl, sourceType: 'history', sourceId: imageEditPreviewItem.id } : undefined}
                key={chain.id}
                generationData={imageEditPreviewItem ? { prompt: imageEditPreviewItem.prompt, negativePrompt: imageEditPreviewItem.negativePrompt, params: imageEditPreviewItem.params } : undefined}
                baseImage={imageEditBaseImage}
                baseImageVersion={imageEditBaseVersion}
                isBaseImageLoading={imageEditBaseLoading}
                previewImage={imageEditPreviewImage}
                operation={activeEditOperation}
                draft={activeEditDraft}
                layout={activeLabLayout}
                maskData={imageEditMaskData}
                generationUnavailableLabel={generationUnavailableLabel}
                generationCostLabel={imageEditCostLabel}
                isGenerating={isGenerating}
                generationProgress={generationProgress}
                safeMode={safeMode}
                tagAssistEnabled={tagAssistEnabled}
                forceEmptySeed={forceEmptySeed}
                onForceEmptySeedChange={onForceEmptySeedChange}
                enforceFreeStepLimit={enforceFreeStepLimit}
                latestTextToImageItem={latestTextToImageItem}
                onOpenLightbox={image => {
                    setLightboxImg(image);
                }}
                getDownloadFilename={getDownloadFilename}
                canNavigateHistory={previewHistory.length > 1 && (chain.id !== 'playground' || Boolean(imageEditPreviewImage))}
                historyLabel={imageEditPreviewHistoryLabel}
                onPreviousHistory={() => showHistoryAt((imageEditPreviewHistoryIndex >= 0 ? imageEditPreviewHistoryIndex : previewIndex) - 1)}
                onNextHistory={() => showHistoryAt((imageEditPreviewHistoryIndex >= 0 ? imageEditPreviewHistoryIndex : previewIndex) + 1)}
                canManageHistoryGroup={Boolean(imageEditPreviewItem)}
                onRemoveCurrentHistory={() => { void handleRemoveCurrentHistory(imageEditPreviewItem); }}
                onClearHistoryGroup={handleClearHistoryGroup}
                apiKey={apiKey}
                allChains={allChains}
                showCharacterReference
                canSaveCharacter
                onSaveCharacter={saveCharacterToLibrary}
                notify={notify}
                onPromptChange={value => updateEditDraft(activeEditOperation, { prompt: value, promptSource: 'custom' })}
                onNegativePromptChange={value => updateEditDraft(activeEditOperation, { negativePrompt: value })}
                onPromptSource={source => {
                    // 「底图原 Prompt」必须绑定实际底图的 parentHistoryId，而不是当前浏览的历史项；
                    // 用户翻过历史后二者不同，误读会取到另一张图的 Prompt。
                    const sourceItem = activeEditDraft.parentHistoryId
                        ? previewHistory.find(item => item.id === activeEditDraft.parentHistoryId) || null
                        : null;
                    const value = source === 'style-only'
                        ? compilePrompt({ basePrompt, modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })) }, '')
                        : source === 'history'
                            ? sourceItem?.prompt || activeEditDraft.prompt
                            : source === 'custom'
                                ? ''
                                : finalPrompt;
                    updateEditDraft(activeEditOperation, { prompt: value, promptSource: source });
                }}
                onDraftChange={patch => updateEditDraft(activeEditOperation, patch)}
                onAgentGenerateReady={generate => { agentEditGenerateRef.current = generate; }}
                onBaseImageChange={async (dataUrl, source, parentHistoryId, meta) => {
                    cancelPendingMaskSave();
                    const changeRevision = ++editBaseResolveRevisionRef.current;
                    const ref = await dataUrlToWorkspaceAsset(dataUrl, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'base'));
                    if (changeRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;
                    await deleteLabWorkspaceAsset(getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'mask'));
                    if (changeRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;

                    // 图生图选底图只更新图片工作区，完整配置通过「导入图片或 JSON 配置」主动导入。
                    // 不回写捕获的旧提示词，避免异步保存期间覆盖后来编辑的内容。
                    const inheritedConfig: Partial<LabImageEditDraft> = {};
                    if (activeEditOperation !== 'image-to-image') {
                        if (meta) {
                            if (meta.prompt !== undefined) {
                                inheritedConfig.prompt = meta.prompt;
                                inheritedConfig.promptSource = (source === 'history' || source === 'inspiration') ? 'history' : 'current';
                            }
                            if (meta.negativePrompt !== undefined) inheritedConfig.negativePrompt = meta.negativePrompt;
                            if (meta.params) inheritedConfig.params = { ...activeEditDraft.params, ...meta.params };
                        } else if (source === 'generated' && latestTextToImageItem) {
                            inheritedConfig.prompt = latestTextToImageItem.prompt ?? finalPrompt ?? activeEditDraft.prompt;
                            inheritedConfig.negativePrompt = latestTextToImageItem.negativePrompt ?? activeEditDraft.negativePrompt;
                            if (latestTextToImageItem.params) inheritedConfig.params = { ...activeEditDraft.params, ...latestTextToImageItem.params };
                            inheritedConfig.promptSource = 'current';
                        }
                    }

                    const previousResultRef = activeEditDraft.resultImageRef;
                    updateEditDraft(activeEditOperation, {
                        baseImageRef: ref,
                        baseImageSource: source,
                        parentHistoryId: (source === 'upload' || source === 'inspiration' || source === 'clipboard') ? undefined : parentHistoryId,
                        maskRef: undefined,
                        maskData: undefined,
                        expansion: { top: 0, right: 0, bottom: 0, left: 0 },
                        appliedExpansion: undefined,
                        outpaintRatioId: '16:9',
                        focusedRect: undefined,
                        resultImageRef: undefined,
                        ...inheritedConfig,
                    });
                    // 换底图作废旧结果资产
                    if (previousResultRef) {
                        void deleteLabWorkspaceAsset(previousResultRef).catch(error => console.warn('删除编辑结果资产失败:', error));
                    }
                    setImageEditBaseImage(dataUrl);
                    setImageEditBaseVersion(previous => previous + 1);
                    // 换底图后右侧等待新结果；底图在左侧展示
                    setImageEditPreviewImage(null);
                    setImageEditMaskData(undefined);
                    setImageEditBaseLoading(false);
                    if (parentHistoryId && source === 'history') {
                        const selectedIndex = previewHistory.findIndex(item => item.id === parentHistoryId);
                        if (selectedIndex >= 0) {
                            setPreviewIndex(selectedIndex);
                            setPreviewMode('history');
                        }
                    }
                }}
                onCanvasChange={async (imageData, maskData) => {
                    cancelPendingMaskSave();
                    const changeRevision = editBaseResolveRevisionRef.current;
                    const [baseRef, maskRef] = await Promise.all([
                        dataUrlToWorkspaceAsset(imageData, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'base')),
                        maskData ? dataUrlToWorkspaceAsset(maskData, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'mask')) : Promise.resolve(undefined),
                    ]);
                    if (changeRevision !== editBaseResolveRevisionRef.current || !mountedRef.current) return;
                    // 画布扩展/规范化改变画布尺寸：旧结果不再有效，作废
                    const previousResultRef = activeEditDraft.resultImageRef;
                    updateEditDraft(activeEditOperation, { baseImageRef: baseRef, maskRef, resultImageRef: undefined });
                    if (previousResultRef) {
                        void deleteLabWorkspaceAsset(previousResultRef).catch(error => console.warn('删除编辑结果资产失败:', error));
                    }
                    setImageEditBaseImage(imageData);
                    setImageEditPreviewImage(null);
                    setImageEditMaskData(maskData);
                }}
                onGenerate={handleImageEditGenerate}
                generationCountControl={generationCountControl}
                onGenerateBarChange={handleImageEditGenerateBarChange}
            /> : null}

            {!lightboxImg && <>
            <div className="mobile-generation-actions flex fixed right-4 z-[900] flex-col items-end gap-2 lg:hidden" style={keyboardOffset > 0 ? { bottom: `calc(${keyboardOffset}px + var(--mobile-generation-bottom))` } : undefined}>
                {errorMsg && <div role="alert" className="max-h-[30dvh] w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600 shadow-lg dark:border-red-900/60 dark:bg-red-950/80 dark:text-red-300">{errorMsg}</div>}
                <div className="flex max-w-[calc(100vw-2rem)] items-center gap-2">
                    {mobileFloatingPreviewImage && <button type="button" onClick={() => setLightboxImg(mobileFloatingPreviewImage)} className="mobile-touch flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-gray-900 shadow-xl dark:border-gray-800" aria-label={t("查看当前预览图")}><SmartImage src={mobileFloatingPreviewImage || ''} alt={t("当前预览图")} /></button>}
                    <div className="flex min-w-0 items-stretch justify-end gap-2">
                        <GenerationCountControl {...generationCountControl}
                            generationProgress={generationProgress}
                            onGenerate={activeEditOperation ? () => imageEditGenerateFnRef.current?.() : () => { void handleGenerate(); }}
                            busy={isGenerating || externalGenerationBusy}
                            costLabel={activeEditOperation ? imageEditGenerateBar?.costLabel : generationCostLabel}
                            unavailableLabel={activeEditOperation && imageEditBaseLoading ? t("读取图片中…") : activeEditOperation ? imageEditGenerateBar?.unavailableLabel : generationUnavailableLabel}
                            disabled={isGenerating || externalGenerationBusy || imageEditBaseLoading || Boolean(activeEditOperation && !imageEditGenerateBar?.canGenerate)} />
                    </div>
                </div>
            </div>
            <MobileGenerationResources apiKey={apiKey} budget={anlasBudget} subscription={novelaiStatus} runtime={naiRuntimeConfig} keyboardOffset={keyboardOffset} />
            </>}

            {/* Lightbox Modal */}
            {lightboxImg && (
                <ImageLightbox src={lightboxImg} customActions onClose={() => setLightboxImg(null)} onSwipe={delta => delta < 0 ? showPreviousHistory() : showNextHistory()}>
                    <ImagePreviewActions
                        imageUrl={lightboxImg}
                        favorite={lightboxItem ? { imageUrl: lightboxItem.imageUrl, sourceType: 'history', sourceId: lightboxItem.id } : { imageUrl: lightboxImg, sourceType: chain.type === 'character' ? 'character' : 'chain', sourceId: chain.id, title: chain.name, prompt: chain.basePrompt, negativePrompt: chain.negativePrompt, params: chain.params }}
                        generationData={lightboxItem ? { prompt: lightboxItem.prompt, negativePrompt: lightboxItem.negativePrompt, params: lightboxItem.params } : undefined}
                        filename={getDownloadFilename()}
                        notify={notify}
                        canManageHistoryGroup={Boolean(lightboxItem)}
                        onRemoveCurrentHistory={() => { void handleRemoveCurrentHistory(lightboxItem); }}
                        onClearHistoryGroup={handleClearHistoryGroup}
                        onSetCover={!activeEditOperation && chain.id !== 'playground' && lightboxImg === displayedPreviewImage ? handleSavePreview : undefined}
                        onUploadCover={!activeEditOperation && chain.id !== 'playground' ? handleUploadCover : undefined}
                        isUploading={isUploading}
                        onBack={() => setLightboxImg(null)}
                        backButtonRef={lightboxCloseBtnRef}
                    />
                    {previewHistory.length > 1 && (
                        <button data-card-action="true"
                            className="hover-reveal-touch absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 md:h-14 md:w-14 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                showPreviousHistory();
                            }}
                            title={t("上一张")}
                            aria-label={t("上一张历史图")}
                        >
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}
                    {previewHistory.length > 1 && (
                        <button data-card-action="true"
                            className="hover-reveal-touch absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 md:h-14 md:w-14 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                showNextHistory();
                            }}
                            title={t("下一张")}
                            aria-label={t("下一张历史图")}
                        >
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    )}
                    {lightboxItem && (
                        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs text-white pointer-events-none">
                            {previewHistory.indexOf(lightboxItem) + 1} / {previewHistory.length} · {new Date(lightboxItem.createdAt).toLocaleString(getLanguage())}
                        </div>
                    )}

                </ImageLightbox>
            )}

            <ChainEditorForkModal
                showForkModal={showForkModal}
                setShowForkModal={setShowForkModal}
                confirmFork={confirmFork}
                isUploading={isUploading}
                currentPreviewCover={currentPreviewCover}
            />

        </div>
    );
};
