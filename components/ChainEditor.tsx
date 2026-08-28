
import React, { useState, useEffect, useRef } from 'react';
import { GenerationMode, ImageEditMetadata, ImageEditOperation, PromptChain, PromptModule, CharacterParams, NAIParams, LocalGenItem, PromptAgentDraft, LabImageEditDraft, LabWorkspaceSession } from '../types';
import { compilePrompt, getEditableGlobalPrompt, mergePromptFields } from '../services/promptUtils';
import { generateImage, generateImageEdit, generateImageStream } from '../services/naiService';
import { InlineCloudQueueStatus, useCloudQueueStatus } from './CloudQueueStatus';
import { localHistory } from '../services/localHistory';
import { api } from '../services/api';
import { db } from '../services/dbService';
import { extractMetadata, parseNovelAIMetadata, IMPORT_SESSION_KEY, PendingImportData, extractRawMetadataFromJsonText } from '../services/metadataService';
import { ChainEditorParams } from './ChainEditorParams';
import { ChainEditorPreview } from './ChainEditorPreview';
import { ImageEditPanel, ImageEditRequest } from './ImageEditPanel';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { dataUrlToBlob } from '../services/imageEdit';
import { ImageTaggerPanel } from './ImageTaggerPanel';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { createUuid } from '../services/id';
import { VibeManager } from './VibeManager';
import { CharacterReferenceManager } from './CharacterReferenceManager';
import { appendTagsToImageEditDraft, buildImageEditMetadataPatch, buildImageEditPresetPatch, canSaveLabModeToLibrary, LabPresetImportOptions } from '../services/labModeTools';
import { normalizeVibeSelections } from '../services/vibeUtils';
import { LabPageLayouts } from '../services/appearancePreferences';
import { useNovelaiUsage } from '../services/naiUsage';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { estimateImageEditCost, estimateV45GenerationCost, applyEstimatorRuntime, formatGenerationCostLabel, formatImageEditCostLabel, hashNaiApiKey, useAnlasBudget } from '../services/anlasBudget';
import { cleanupLabWorkspaceAssets, createLabImageEditDraft, createLabWorkspaceSession, dataUrlToWorkspaceAsset, deleteLabWorkspaceAsset, getLabWorkspaceAssetId, getLabWorkspaceSessionKey, LAB_DEFAULT_PARAMS, loadLabWorkspaceSession, readLabWorkspaceAsset, saveLabWorkspaceSession, saveLabWorkspaceAsset, blobToDataUrl, scopeLabWorkspaceSessionToEntry, getLabModeLabel, normalizeParams } from '../services/labWorkspace';
import { DEFAULT_NAI_RUNTIME, getNaiRuntimeConfig, isNaiRuntimeSyncUnhealthy, describeNaiRuntimeSyncProblem, NaiRuntimeConfig } from '../services/naiRuntime';
import { splitNovelAiPrompt } from '../services/promptImport';
import { decideCurrentPreviewCover } from '../services/chainCover';
import { LabModuleSection } from './LabModuleSection';
import { FileDown } from 'lucide-react';
import { UNTESTED_CHAIN_TAG } from './DesignSystem';
import { ChainEditorHeader } from './chain/ChainEditorHeader';
import { ChainEditorPromptInputs } from './chain/ChainEditorPromptInputs';
import { ChainEditorCharacters } from './chain/ChainEditorCharacters';
import { ChainEditorPresetModal } from './chain/ChainEditorPresetModal';
import { ChainEditorForkModal } from './chain/ChainEditorForkModal';
import { PresetSection, PresetSource, PresetSourceBadge, PromptCopyButton, PromptAgentOverlayController } from './chain/PresetSourceBadges';

interface ChainEditorProps {
    chain: PromptChain;
    allChains: PromptChain[]; // Need access to other chains for importing
    onUpdateChain: (id: string, updates: Partial<PromptChain>) => Promise<void> | void;
    onFork: (chain: PromptChain, targetType?: 'style' | 'character') => Promise<void> | void;
    setIsDirty: (isDirty: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
    externalImportToken?: number;
    agentOpenToken?: number;
    tagAssistEnabled: boolean;
    onTagAssistEnabledChange: (enabled: boolean) => void;
    generationStreamPreview: boolean;
    forceEmptySeed?: boolean;
    labPageLayouts: LabPageLayouts;
    safeMode: boolean;
    onBack: () => void | Promise<void>;
}

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, allChains, onUpdateChain, onFork, setIsDirty, notify, externalImportToken, agentOpenToken, tagAssistEnabled, onTagAssistEnabledChange, generationStreamPreview, forceEmptySeed = false, labPageLayouts, safeMode, onBack }) => {
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const queueStatus = useCloudQueueStatus();
    const confirmAction = useConfirmDialog();
    const isOwner = true;
    const isGuest = false;
    const canEdit = true;

    // Distinguish Editor Mode
    const isCharacterMode = chain.type === 'character';

    // --- Chain Info State ---
    const [chainName, setChainName] = useState(chain.name);
    const [chainDesc, setChainDesc] = useState(chain.description);
    const [chainTags, setChainTags] = useState<string[]>(chain.tags || []);
    const [isEditingInfo, setIsEditingInfo] = useState(false);

    // --- Prompt State ---
    const [basePrompt, setBasePrompt] = useState(chain.basePrompt || '');
    const [negativePrompt, setNegativePrompt] = useState(chain.negativePrompt || '');
    const [modules, setModules] = useState<PromptModule[]>(chain.modules || []);
    // Default Seed to undefined (random), UC Preset to 4 (None)
    const [params, setParams] = useState<NAIParams>(() => normalizeParams(chain.params));
    // Opus 限额透支后，受限额模型（V5）的小图不再免费，费用估算需同步。
    const { info: novelaiSubscription, usage: novelaiUsage, refreshIfStale: refreshUsageIfStale } = useNovelaiUsage();
    // 本地 Anlas 预算（账号整体，手动校准）：用尽后扣费生成需要红色警告。
    const anlasBudget = useAnlasBudget();
    const opusUsageExhausted = novelaiUsage?.isNegative === true;
    // 成本估算常量（免费门槛、公式系数、受限模型清单）由网关自动同步。
    const [naiRuntimeConfig, setNaiRuntimeConfig] = useState<NaiRuntimeConfig | null>(null);
    const [, setRuntimeAppliedAt] = useState(0);
    useEffect(() => {
        let active = true;
        void getNaiRuntimeConfig().then(config => {
            if (!active) return;
            applyEstimatorRuntime(config);
            setNaiRuntimeConfig(config);
            setRuntimeAppliedAt(Date.now());
        });
        return () => { active = false; };
    }, []);
    // 同步失效时“免费/扣费”判断可能基于过期规则，生成前必须向用户示警。
    const runtimeSyncUnhealthy = isNaiRuntimeSyncUnhealthy(naiRuntimeConfig);
    const runtimeSyncWarning = naiRuntimeConfig
        ? `${describeNaiRuntimeSyncProblem(naiRuntimeConfig)}，费用估算与免费档判断可能过期，继续生成可能意外消耗共享 Anlas`
        : '';
    const activeModelInfo = getRuntimeNaiModelInfo(params.model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME);
    const estimatedAnlasCost = estimateV45GenerationCost(params, true, opusUsageExhausted);
    const generationCostLabel = formatGenerationCostLabel(estimatedAnlasCost, params.model);

    /**
     * 拼车共享账号：其他成员随时可能把 Opus 限额耗尽或透支。受限额模型
     * 生成前强制刷新真实额度，确保费用确认弹窗按服务端最新状态计费。
     */
    const usageForCostEstimate = async (model?: string): Promise<boolean> => {
        if (!getRuntimeNaiModelInfo(model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).opusUsageLimit) return opusUsageExhausted;
        const fresh = await refreshUsageIfStale();
        return fresh?.usage?.isNegative === true;
    };

    // --- New: Subject/Variable Prompt State ---
    const [subjectPrompt, setSubjectPrompt] = useState('');

    const [hasChanges, setHasChanges] = useState(false);
    const [lightboxImg, setLightboxImg] = useState<string | null>(null);

    // --- Import Preset Modal State ---
    // New state for import modal search and tags
    const [importModalSearch, setImportModalSearch] = useState('');
    const [importModalSelectedTags, setImportModalSelectedTags] = useState<Set<string>>(new Set());
    const [showImportPreset, setShowImportPreset] = useState(false);
    const [quickImportMode, setQuickImportMode] = useState(true); // 快速导入模式：默认开启，跳过模块选择
    // Detailed Import Config State
    const [importCandidate, setImportCandidate] = useState<PromptChain | null>(null);
    const [importOptions, setImportOptions] = useState<LabPresetImportOptions>({
        importBasePrompt: true,  // Renamed from importPrompt
        importSubject: true,     // New: Subject Prompt
        importNegative: true,    // Negative Prompt
        importModules: true,     // Modules array
        appendModules: false,    // New: Append Modules
        importCharacters: true,  // Characters params
        appendCharacters: false, // Append Characters (if false, replace)
        importSettings: true,    // Resolution, Steps, Scale, Sampler...
        importSeed: true,        // Seed
    });
    const [selectedImportModuleIds, setSelectedImportModuleIds] = useState<Set<string>>(new Set());
    // New: Tab state for import modal
    const [importTab, setImportTab] = useState<'style' | 'character'>('style');

    // --- Favorites (for preset sort), re-read when opening modal ---
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = localStorage.getItem('nai_chain_favs');
            if (saved) setFavorites(new Set(JSON.parse(saved) as string[]));
        } catch { /* ignore */ }
        // Default tab: if I am Character, I likely want to import Artist (style). If I am Artist (style), I likely want Character.
        setImportTab(chain.type === 'character' ? 'style' : 'character');
    }, [showImportPreset, chain.type]);

    // Sync dirty state with parent.
    useEffect(() => {
        setIsDirty(hasChanges);
    }, [hasChanges, setIsDirty]);

    // --- Testing State ---
    const [activeModules, setActiveModules] = useState<Record<string, boolean>>({});
    const [finalPrompt, setFinalPrompt] = useState('');
    const globalPrompt = getEditableGlobalPrompt(basePrompt, subjectPrompt);

    // --- Generation State ---
    const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState<{ step: number; total: number } | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [previewHistory, setPreviewHistory] = useState<LocalGenItem[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewMode, setPreviewMode] = useState<'history' | 'cover' | 'result' | 'unsaved'>('cover');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const generationInFlightRef = useRef(false);
    const [imageEditBaseImage, setImageEditBaseImage] = useState<string | null>(null);
    const [imageEditPreviewImage, setImageEditPreviewImage] = useState<string | null>(null);
    const workspaceKey = getLabWorkspaceSessionKey(chain.id);
    const workspaceFallback = createLabWorkspaceSession(chain.basePrompt || '', String(chain.variableValues?.subject || ''), chain.negativePrompt || '', normalizeParams(chain.params), Object.fromEntries((chain.modules || []).map(module => [module.id, module.isActive])));
    const [workspaceSession, setWorkspaceSession] = useState<LabWorkspaceSession>(() => scopeLabWorkspaceSessionToEntry(chain.id, loadLabWorkspaceSession(workspaceKey, workspaceFallback)));
    const [imageEditMaskData, setImageEditMaskData] = useState<string | undefined>();
  const imageEditGenerateFnRef = useRef<(() => void) | null>(null);
  const [imageEditGenerateBar, setImageEditGenerateBar] = useState<{ costLabel: string; canGenerate: boolean } | null>(null);
  const handleImageEditGenerateBarChange = React.useCallback((bar: { generate: () => void; costLabel: string; canGenerate: boolean }) => {
    imageEditGenerateFnRef.current = bar.generate;
    setImageEditGenerateBar(previous => previous && previous.costLabel === bar.costLabel && previous.canGenerate === bar.canGenerate ? previous : { costLabel: bar.costLabel, canGenerate: bar.canGenerate });
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
    const [taggerOpen, setTaggerOpen] = useState(false);
    const [mobileEditorTab, setMobileEditorTab] = useState<'global' | 'character' | 'params'>('global');
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<PromptAgentDraft | null>(null);
    const editorRevisionRef = useRef(0);
    const agentRunRevisionRef = useRef(0);

    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) return;
        const updateKeyboardState = () => {
            const active = document.activeElement;
            const editingPrompt = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
            setKeyboardOpen(editingPrompt && window.innerHeight - viewport.height > 120);
        };
        updateKeyboardState();
        viewport.addEventListener('resize', updateKeyboardState);
        window.addEventListener('focusin', updateKeyboardState);
        window.addEventListener('focusout', updateKeyboardState);
        return () => {
            viewport.removeEventListener('resize', updateKeyboardState);
            window.removeEventListener('focusin', updateKeyboardState);
            window.removeEventListener('focusout', updateKeyboardState);
        };
    }, []);

    // --- Initialization ---

    // --- Initialization ---
    const prevChainIdRef = useRef<string | null>(null);
    const [presetSources, setPresetSources] = useState<Partial<Record<PresetSection, PresetSource>>>({});
    const [modulePresetSources, setModulePresetSources] = useState<Record<string, PresetSource>>({});
    const [characterPresetSources, setCharacterPresetSources] = useState<Record<string, PresetSource>>({});

    const markPresetSectionModified = (section: PresetSection) => {
        setPresetSources(previous => previous[section]
            ? { ...previous, [section]: { ...previous[section]!, modified: true } }
            : previous);
    };
    const markModuleSourceModified = (id: string) => {
        setModulePresetSources(previous => previous[id]
            ? { ...previous, [id]: { ...previous[id], modified: true } }
            : previous);
    };
    const markCharacterSourceModified = (id: string) => {
        setCharacterPresetSources(previous => previous[id]
            ? { ...previous, [id]: { ...previous[id], modified: true } }
            : previous);
    };
    const clearPresetSources = () => {
        setPresetSources({});
        setModulePresetSources({});
        setCharacterPresetSources({});
    };

    const sourceChainId = chain.id === 'playground' ? 'playground' : chain.id;
    const activeGenerationMode = chain.id === 'playground' ? workspaceSession.activeMode : 'text-to-image';
    const canSaveActiveModeToLibrary = canSaveLabModeToLibrary(activeGenerationMode);
    const activeEditOperation = activeGenerationMode === 'text-to-image' ? null : activeGenerationMode;
    const activeEditDraft = activeEditOperation ? workspaceSession.edits[activeEditOperation] : null;
    const activeLabLayout = labPageLayouts[activeGenerationMode];
    const latestTextToImageItem = previewHistory.find(item => !item.edit);
    const selectedPreviewItem = previewMode === 'history' ? previewHistory[previewIndex] || null : null;
    const displayedPreviewImage = selectedPreviewItem?.imageUrl || generatedImage;
    const imageEditPreviewHistoryIndex = imageEditPreviewImage ? previewHistory.findIndex(item => item.imageUrl === imageEditPreviewImage) : -1;
    const imageEditPreviewItem = imageEditPreviewHistoryIndex >= 0 ? previewHistory[imageEditPreviewHistoryIndex] : null;
    const imageEditPreviewHistoryLabel = imageEditPreviewHistoryIndex >= 0 ? `${imageEditPreviewHistoryIndex + 1} / ${previewHistory.length}` : undefined;
    const currentPreviewCover = decideCurrentPreviewCover(displayedPreviewImage, chain.previewImage);
    const hasPendingPreviewCover = chain.type === 'style' && currentPreviewCover.needsUpload;
    const canSaveCurrentChain = hasChanges || hasPendingPreviewCover;
    const lightboxItem = lightboxImg ? previewHistory.find(item => item.imageUrl === lightboxImg) || null : null;
    const currentPreviewPosition = selectedPreviewItem
        ? `${previewIndex + 1} / ${previewHistory.length}`
        : previewMode === 'result'
            ? '刚刚生成 · 正在保存历史'
        : previewMode === 'unsaved'
            ? '刚刚生成 · 历史保存失败'
        : previewHistory.length > 0
            ? `封面 · 历史 ${previewHistory.length} 张`
            : '当前封面';

    const reloadPreviewHistory = async (targetSourceChainId = sourceChainId) => {
        const history = await localHistory.getBySourceChain(targetSourceChainId);
        setPreviewHistory(history);
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
        setPreviewIndex(nextIndex);
        setPreviewMode('history');
        setGeneratedImage(nextImage);
        if (activeEditOperation) setImageEditPreviewImage(nextImage);
        if (lightboxImg) {
            setLightboxImg(nextImage);
        }
    };

    const showPreviousHistory = () => showHistoryAt(previewIndex - 1);
    const showNextHistory = () => showHistoryAt(previewIndex + 1);

    const handleRemoveCurrentHistory = async (targetItem = selectedPreviewItem) => {
        if (!targetItem) return;

        try {
            await localHistory.unlinkFromSourceChain(targetItem.id);

            const removedIndex = previewHistory.findIndex(item => item.id === targetItem.id);
            const nextHistory = previewHistory.filter(item => item.id !== targetItem.id);
            setPreviewHistory(nextHistory);

            if (nextHistory.length === 0) {
                setPreviewIndex(0);
                setPreviewMode('cover');
                setGeneratedImage(null);
                if (activeEditOperation) setImageEditPreviewImage(imageEditBaseImage);
                if (lightboxImg) setLightboxImg(null);
            } else {
                const nextIndex = Math.min(Math.max(0, removedIndex), nextHistory.length - 1);
                const nextImage = nextHistory[nextIndex].imageUrl;
                setPreviewIndex(nextIndex);
                setPreviewMode('history');
                setGeneratedImage(nextImage);
                if (activeEditOperation) setImageEditPreviewImage(nextImage);
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
            if (activeEditOperation) setImageEditPreviewImage(imageEditBaseImage);
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
        clearPresetSources();

        const storedWorkspace = scopeLabWorkspaceSessionToEntry(chain.id, loadLabWorkspaceSession(workspaceKey, workspaceFallback));
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
        setChainName(chain.name);
        setChainDesc(chain.description);
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
        setHasChanges(false);

        void reloadPreviewHistory(sourceChainId);

        const initialEditOperation = storedWorkspace.activeMode === 'text-to-image' ? null : storedWorkspace.activeMode;
        if (initialEditOperation) void resolveEditBaseImage(storedWorkspace.edits[initialEditOperation]);
        else {
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
            setImageEditMaskData(undefined);
        }

    }, [chain.id, chain.basePrompt, chain.negativePrompt, chain.modules, chain.params, chain.name, chain.description, chain.variableValues]);
    // Dependency note: we still list props to satisfy linter, but the guard 'if (prevChainId === chain.id) return' blocks re-execution.

    // --- sessionStorage 侦听：接收来自历史/灵感页面的一键导入数据 ---
    useEffect(() => {
        const raw = sessionStorage.getItem(IMPORT_SESSION_KEY);
        if (!raw) return;

        try {
            const data = JSON.parse(raw) as PendingImportData;
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
            setApiKey(nextValue);
        };
        window.addEventListener('nai-api-key-changed', syncApiKey);
        window.addEventListener('storage', syncApiKey);
        return () => {
            window.removeEventListener('nai-api-key-changed', syncApiKey);
            window.removeEventListener('storage', syncApiKey);
        };
    }, []);

    useEffect(() => {
        if (!lightboxImg || previewHistory.length <= 1) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                showPreviousHistory();
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                showNextHistory();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxImg, previewHistory, previewIndex]);


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
            return;
        }
        setImageEditBaseLoading(true);
        try {
            const blob = await readLabWorkspaceAsset(draft.baseImageRef);
            if (resolveRevision !== editBaseResolveRevisionRef.current) return;
            const restoredBaseImage = blob ? await blobToDataUrl(blob) : null;
            setImageEditBaseImage(restoredBaseImage);
            setImageEditPreviewImage(restoredBaseImage);
            if (draft.maskRef) {
                const maskBlob = await readLabWorkspaceAsset(draft.maskRef);
                if (resolveRevision !== editBaseResolveRevisionRef.current) return;
                setImageEditMaskData(maskBlob ? await blobToDataUrl(maskBlob) : undefined);
            } else setImageEditMaskData(undefined);
        } finally {
            if (resolveRevision === editBaseResolveRevisionRef.current) setImageEditBaseLoading(false);
        }
    };

    /** 仅重置单个编辑模式的持久化底图/蒙版资产与草稿；不触碰文生图与其他编辑模式。 */
    const resetEditOperation = async (operation: ImageEditOperation) => {
        const baseAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'base');
        const maskAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'mask');
        const previousDraft = workspaceSession.edits[operation];
        const currentEditDraft = activeEditOperation === operation && activeEditDraft ? activeEditDraft : previousDraft;
        const defaultDraft = createLabImageEditDraft(operation, '', '', LAB_DEFAULT_PARAMS);
        await Promise.all([
            deleteLabWorkspaceAsset(baseAssetId),
            deleteLabWorkspaceAsset(previousDraft.maskRef !== maskAssetId ? maskAssetId : undefined),
            deleteLabWorkspaceAsset(currentEditDraft.maskRef !== maskAssetId ? currentEditDraft.maskRef : undefined),
        ]).catch(error => console.warn('重置编辑模式资产失败:', error));
        updateWorkspace(previous => ({ ...previous, edits: { ...previous.edits, [operation]: defaultDraft } }));
    };

    const createEditDraftFromSource = async (operation: ImageEditOperation, sourceImage: string | undefined, source: 'generated' | 'history' | 'upload', parentHistoryId?: string, sourcePrompt = finalPrompt, sourceNegativePrompt = negativePrompt, sourceParams = params, editMetadata?: ImageEditMetadata, reuseEditMask = false) => {
        const draft = createLabImageEditDraft(operation, sourcePrompt, sourceNegativePrompt, sourceParams, {
            baseImageSource: source,
            parentHistoryId,
            promptSource: source === 'history' ? 'history' : 'current',
            strength: editMetadata?.strength ?? (operation === 'image-to-image' ? 0.7 : 1),
            noise: editMetadata?.noise ?? 0,
            focused: operation === 'inpaint' && Boolean(editMetadata?.focused),
            minimumContextArea: editMetadata?.minimumContextArea ?? editMetadata?.contextArea ?? 64,
            expansion: editMetadata?.canvasExpansion || { top: 0, right: 0, bottom: 0, left: 0 },
            focusedRect: editMetadata?.focusedArea,
        });
        let restoredMask: string | undefined;
        const baseAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'base');
        if (sourceImage) {
            draft.baseImageRef = await dataUrlToWorkspaceAsset(sourceImage, baseAssetId);
            setImageEditBaseImage(sourceImage);
            setImageEditPreviewImage(sourceImage);
        } else {
            await deleteLabWorkspaceAsset(baseAssetId);
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
        }
        const maskAssetId = getLabWorkspaceAssetId(workspaceKey, operation, 'mask');
        await deleteLabWorkspaceAsset(maskAssetId);
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
        if (activeEditOperation) await flushMaskSave(activeEditOperation).catch(error => console.warn('切换编辑模式前保存蒙版失败:', error));
        if (mode === 'text-to-image') {
            updateWorkspace(previous => ({ ...previous, activeMode: mode }));
            setImageEditBaseImage(null);
            setImageEditPreviewImage(null);
            setImageEditMaskData(undefined);
            return;
        }
        const existing = workspaceSession.edits[mode];
        if (existing.baseImageRef || existing.prompt || existing.parentHistoryId) {
            updateWorkspace(previous => ({ ...previous, activeMode: mode }));
            await resolveEditBaseImage(existing);
            return;
        }
        const sourceItem = selectedPreviewItem;
        const sourceImage = displayedPreviewImage || chain.previewImage;
        await createEditDraftFromSource(mode, sourceImage, sourceItem ? 'history' : 'generated', sourceItem?.id, sourceItem?.prompt || finalPrompt, sourceItem?.negativePrompt || negativePrompt, sourceItem?.params || params);
    };

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    // Helper to mark changes only if owner
    const markChange = () => {
        editorRevisionRef.current += 1;
        if (isOwner) setHasChanges(true);
    };

    // --- Handlers: Prompt Editing ---
    const handleModuleChange = (index: number, key: keyof PromptModule, value: any) => {
        if (!canEdit) return;
        const newModules = [...modules];
        newModules[index] = { ...newModules[index], [key]: value };
        setModules(newModules);
        markModuleSourceModified(newModules[index].id);
        markChange();
    };

    const addModule = () => {
        if (!canEdit) return;
        const newModule: PromptModule = {
            id: createUuid(),
            name: '新模块',
            content: '',
            isActive: true,
            position: 'post'
        };
        setModules([...modules, newModule]);
        setActiveModules(prev => ({ ...prev, [newModule.id]: true }));
        markChange();
    };

    const removeModule = (index: number) => {
        if (!canEdit) return;
        const newModules = [...modules];
        const removedId = newModules[index]?.id;
        newModules.splice(index, 1);
        setModules(newModules);
        if (removedId) setModulePresetSources(previous => {
            const next = { ...previous };
            delete next[removedId];
            return next;
        });
        markChange();
    };

    // --- Character Handlers ---
    const addCharacter = () => {
        if (!canEdit) return;
        if ((params.characters || []).length >= activeModelInfo.maxCharacters) {
            notify(`${activeModelInfo.label} 最多支持 ${activeModelInfo.maxCharacters} 个角色提示词`, 'error');
            return;
        }
        const newChar: CharacterParams = { id: createUuid(), prompt: '', x: 0.5, y: 0.5 };
        setParams({ ...params, characters: [...(params.characters || []), newChar] });
        markChange();
    };

    const updateCharacter = (idx: number, updates: Partial<CharacterParams>) => {
        if (!canEdit || !params.characters) return;
        const newChars = [...params.characters];
        newChars[idx] = { ...newChars[idx], ...updates };
        setParams({ ...params, characters: newChars });
        markCharacterSourceModified(newChars[idx].id);
        markChange();
    };

    const removeCharacter = (idx: number) => {
        if (!canEdit || !params.characters) return;
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

    // --- Smart Import Logic ---
    const getDefaultImportOptions = (c: PromptChain) => {
        // Determine type-based defaults
        const isTargetChar = c.type === 'character';
        const hasModules = c.modules && c.modules.length > 0;

        // Default options based on target type
        return {
            importBasePrompt: !isTargetChar,     // Artist: Checked, Char: Unchecked (per Rule 6 & 5)
            importSubject: isTargetChar,         // Char: Checked, Artist: Unchecked (per Rule 5 & 6)
            importNegative: !isTargetChar,       // Artist: Checked, Char: Unchecked
            importModules: hasModules,           // Both: Checked only if modules exist
            appendModules: false,                // Both: Unchecked
            importCharacters: isTargetChar,      // Char: Checked, Artist: Unchecked
            appendCharacters: false,
            importSettings: !isTargetChar,       // Artist: Checked, Char: Unchecked
            importSeed: false,                   // Both: Unchecked
        };
    };

    const initiateImport = (c: PromptChain) => {
        // 快速导入模式：直接使用默认设置导入，不弹出详细配置
        if (quickImportMode) {
            const defaultOptions = getDefaultImportOptions(c);
            executeImport(c, defaultOptions, new Set((c.modules || []).map(m => m.id)));
            return;
        }

        // 详细模式：弹出配置窗口
        setImportCandidate(c);
        setImportOptions(getDefaultImportOptions(c));
        // Select all modules by default
        setSelectedImportModuleIds(new Set((c.modules || []).map(m => m.id)));
    };

    // 执行导入的核心逻辑（提取为独立函数）
    const executeImport = (
        target: PromptChain,
        options: LabPresetImportOptions,
        moduleIds: Set<string>
    ) => {
        if (!canEdit) return;
        if (activeEditOperation && activeEditDraft) {
            updateEditDraft(activeEditOperation, buildImageEditPresetPatch(activeEditDraft, target, options, moduleIds, createUuid));
            notify(`已将 "${target.name}" 导入当前${activeEditOperation === 'image-to-image' ? '图生图' : activeEditOperation === 'inpaint' ? '局部重绘' : '扩图'}配置`);
            setImportCandidate(null);
            setShowImportPreset(false);
            return;
        }
        const source: PresetSource = { name: target.name, modified: false };

        // 1. Prompt (Base + Subject)
        if (options.importBasePrompt) {
            setBasePrompt(target.basePrompt || '');
            setPresetSources(previous => ({ ...previous, base: source }));
        }
        if (options.importSubject) {
            const targetSubject = target.variableValues?.['subject'] || '';
            setSubjectPrompt(targetSubject);
            setPresetSources(previous => ({ ...previous, subject: source }));
        }

        // 2. Negative
        if (options.importNegative) {
            setNegativePrompt(target.negativePrompt || '');
            setPresetSources(previous => ({ ...previous, negative: source }));
        }

        // 3. Modules
        if (options.importModules && target.modules && target.modules.length > 0) {
            const modulesToImport = target.modules.filter(m => moduleIds.has(m.id));
            const newModules = modulesToImport.map(m => ({ ...m, id: createUuid() }));

            if (options.appendModules) {
                setModules(prev => [...prev, ...newModules]); // Append
                setModulePresetSources(previous => ({
                    ...previous,
                    ...Object.fromEntries(newModules.map(module => [module.id, source]))
                }));
            } else {
                setModules(newModules); // Replace
                setModulePresetSources(Object.fromEntries(newModules.map(module => [module.id, source])));
            }

            // Update active state
            setActiveModules(prev => {
                const next = options.appendModules ? { ...prev } : {};
                newModules.forEach(m => next[m.id] = m.isActive);
                return next;
            });
        }

        // 4. Characters
        if (options.importCharacters && target.params?.characters) {
            const newChars = target.params.characters.map(c => ({
                ...c,
                id: createUuid() // Regen IDs
            }));

            if (options.appendCharacters) {
                setParams(prev => ({ ...prev, characters: [...(prev.characters || []), ...newChars] }));
                setCharacterPresetSources(previous => ({
                    ...previous,
                    ...Object.fromEntries(newChars.map(character => [character.id, source]))
                }));
            } else {
                setParams(prev => ({ ...prev, characters: newChars }));
                setCharacterPresetSources(Object.fromEntries(newChars.map(character => [character.id, source])));
            }
        }

        // 5. Settings
        if (options.importSettings) {
            setParams(prev => ({
                ...prev,
                steps: target.params?.steps ?? prev.steps,
                scale: target.params?.scale ?? prev.scale,
                sampler: target.params?.sampler ?? prev.sampler,
                width: target.params?.width ?? prev.width,
                height: target.params?.height ?? prev.height,
                qualityToggle: target.params?.qualityToggle ?? prev.qualityToggle,
                ucPreset: target.params?.ucPreset ?? prev.ucPreset,
                cfgRescale: target.params?.cfgRescale ?? prev.cfgRescale,
                variety: target.params?.variety ?? prev.variety,
                useCoords: target.params?.useCoords ?? prev.useCoords
            }));
            setPresetSources(previous => ({ ...previous, settings: source }));
        }

        // 6. Seed
        if (options.importSeed && target.params?.seed !== undefined) {
            setParams(prev => ({ ...prev, seed: target.params.seed }));
            setPresetSources(previous => ({ ...previous, settings: source }));
        }

        notify(`已从 "${target.name}" 导入配置`);
        markChange();
        setImportCandidate(null);
        setShowImportPreset(false);
    };

    const confirmImport = () => {
        if (!importCandidate || !canEdit) return;
        executeImport(importCandidate, importOptions, selectedImportModuleIds);
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
                void db.logClientEvent({
                    category: 'client',
                    action: 'metadata_import',
                    resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                    resourceId: chain.id,
                    message: `从${sourceLabel}导入元数据到${modeLabel}`,
                    metadata: {
                        source: sourceLabel,
                        splitMode: 'edit-full',
                        generationMode: activeEditOperation,
                        chainName,
                        promptLength: parsed.prompt.length,
                        negativeLength: parsed.negativePrompt.length,
                        model: parsed.params.model,
                        width: parsed.params.width,
                        height: parsed.params.height,
                        seed: parsed.params.seed ?? 'random',
                    },
                }).catch(console.error);
                return;
            }
            setBasePrompt(parsed.prompt);
            setSubjectPrompt('');
            setNegativePrompt(parsed.negativePrompt);
            setParams(parsed.params);
            clearPresetSources();
            markChange();
            notify('已将完整提示词导入全局提示词，并恢复角色与生成参数。');
            void db.logClientEvent({
                category: 'client',
                action: 'metadata_import',
                resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                resourceId: chain.id,
                message: `从${sourceLabel}导入元数据`,
                metadata: {
                    source: sourceLabel,
                    splitMode: 'global',
                    chainName,
                    promptLength: parsed.prompt.length,
                    negativeLength: parsed.negativePrompt.length,
                    model: parsed.params.model,
                    width: parsed.params.width,
                    height: parsed.params.height,
                    seed: parsed.params.seed ?? 'random',
                },
            }).catch(console.error);
        } catch (e: any) {
            notify('解析失败: ' + e.message, 'error');
            void db.logClientEvent({
                category: 'client',
                action: 'metadata_import',
                status: 'error',
                resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                resourceId: chain.id,
                message: `从${sourceLabel}导入元数据失败`,
                metadata: { source: sourceLabel, error: e.message },
            }).catch(console.error);
        }
    };

    const importMetadataFile = async (file: File) => {
        if (!canEdit) return;

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
        if (!canEdit || !hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        importDragDepthRef.current += 1;
        setIsImportDragActive(true);
    };

    const handleImportDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!canEdit || !hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setIsImportDragActive(true);
    };

    const handleImportDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!canEdit || !hasImageImportPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
        if (importDragDepthRef.current === 0) {
            setIsImportDragActive(false);
        }
    };

    const handleImportDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        if (!canEdit || !hasImageImportPayload(e.dataTransfer)) return;
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
    const applyImportData = (data: PendingImportData) => {
        if (data.mode === 'image-edit' && data.baseImageUrl) {
            const operation = data.imageEditOperation || 'image-to-image';
            void createEditDraftFromSource(
                operation,
                data.baseImageUrl,
                data.parentHistoryId ? 'history' : 'upload',
                data.parentHistoryId,
                data.prompt || finalPrompt,
                data.negativePrompt || negativePrompt,
                data.params || params,
                data.editMetadata,
                data.reuseEditMask === true,
            );
            notify('已载入底图，正在打开对应图片编辑模式。');
            return;
        }
        if (data.mode === 'append-prompt') {
            setBasePrompt(current => mergePromptFields(current, data.prompt));
            setSubjectPrompt('');
            markChange();
            notify('已把灵感 Prompt 追加到全局提示词。');
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


    const prepareCurrentPreviewCover = async (forceUpload = false): Promise<{ previewImage?: string; changed: boolean }> => {
        const decision = decideCurrentPreviewCover(displayedPreviewImage, chain.previewImage, forceUpload);
        if (!decision.source || !decision.needsUpload) {
            return { previewImage: decision.source || undefined, changed: false };
        }

        const response = await fetch(decision.source);
        if (!response.ok) throw new Error(`读取当前预览图片失败（${response.status}）`);
        const blob = await response.blob();
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
        void autoSaveCoverOnExitRef.current();
    }, []);




    const handleSaveAll = async () => {
        if (!isOwner || isUploading) return;
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
            setIsEditingInfo(false);
            notify(`${isCharacterMode ? '角色串' : '风格串'}已保存${cover.changed ? '，当前图片已设为封面' : ''}`);
        } catch (error: any) {
            notify(`保存失败：${error?.message || '未知错误'}`, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleFork = () => {
        setShowForkModal(true);
    };

    const handleReset = async () => {
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
            setGeneratedImage(null);
            setPreviewMode('cover');
            notify(`${modeLabel}已重置`);
            return;
        }

        if (!await confirmAction({
            title: '重置文生图？',
            message: '将恢复文生图的提示词、模块与参数为默认值。此操作无法撤销。',
            confirmLabel: '确认重置',
            tone: 'danger',
        })) return;

        setBasePrompt('');
        setNegativePrompt('');
        setSubjectPrompt('');
        setModules([]);
        setActiveModules({});
        setParams({ ...LAB_DEFAULT_PARAMS });
        clearPresetSources();
        setGeneratedImage(null);
        setPreviewMode('cover');
        notify('文生图已重置');
    };

    const confirmFork = async (targetType: 'style' | 'character') => {
        if (isUploading) return;
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
                description: chainDesc,
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

    const toggleModuleActive = (id: string) => {
        markModuleSourceModified(id);
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
            setChainTags(updatedTags);
            void onUpdateChain(chain.id, { tags: updatedTags });
        }
    };

    const handleGenerateDraft = async (override?: PromptAgentDraft) => {
        if (!apiKey) {
            const message = '请先在“全局设置”中配置 NovelAI API Key';
            setErrorMsg(message);
            notify(message, 'error');
            return false;
        }
        if (generationInFlightRef.current) return false;
        generationInFlightRef.current = true;
        const generationPrompt = override ? compilePrompt({ basePrompt: override.basePrompt, modules: override.modules }, override.subjectPrompt) : finalPrompt;
        const generationNegativePrompt = override?.negativePrompt ?? negativePrompt;
        const generationParams = override?.params ?? params;
        const previousGeneratedImage = generatedImage;
        const previousPreviewMode = previewMode;
        let streamedPreviewShown = false;
        setIsGenerating(true);
        setGenerationProgress(null);
        setErrorMsg(null);
        try {
            const activeParams: NAIParams = {
                ...generationParams,
                ...(forceEmptySeed ? { seed: undefined } : {}),
                vibes: generationParams.vibes ? {
                    ...generationParams.vibes,
                    slots: normalizeVibeSelections(generationParams.vibes.slots, generationParams.vibes.normalizeStrengths),
                } : undefined,
            };
            const streamSupported = getRuntimeNaiModelInfo(activeParams.model, naiRuntimeConfig || DEFAULT_NAI_RUNTIME).supportsStreamedResponses;
            let result;
            if (generationStreamPreview && streamSupported) {
                try {
                    result = await generateImageStream(apiKey, generationPrompt, generationNegativePrompt, activeParams, preview => {
                        streamedPreviewShown = true;
                        setGeneratedImage(preview.image);
                        setPreviewMode('result');
                        setGenerationProgress(preview.step ? { step: preview.step, total: activeParams.steps } : null);
                    }, streamSupported);
                } catch (streamError) {
                    // 只有 final 尚未到达时 generateImageStream 才会抛错，因此这里回退不会重复生成。
                    console.warn('生成过程预览不可用，已回退普通生成：', streamError);
                    setGenerationProgress(null);
                    result = await generateImage(apiKey, generationPrompt, generationNegativePrompt, activeParams);
                }
            } else {
                result = await generateImage(apiKey, generationPrompt, generationNegativePrompt, activeParams);
            }

            // Show the completed image before uploading its several-megabyte
            // base64 payload to local history. Keeping previewMode='history'
            // here made the previous history item mask the new result until
            // that upload finished, which was especially visible on phones.
            setGeneratedImage(result.image);
            setPreviewMode('result');
            if (window.matchMedia('(max-width: 767px)').matches) setLightboxImg(result.image);

            // Leave the current task so React can commit and the browser can
            // paint the result before JSON serialization/history persistence.
            await new Promise<void>(resolve => window.setTimeout(resolve, 0));

            // Use actual seed returned from generation
            const finalParams = { ...activeParams, seed: result.seed };
            // Agent generation can use a draft that has not been applied to
            // the editor.  Persist that exact draft so re-importing history
            // reconstructs the image that was actually generated.
            const generatedStructure = override ?? {
                basePrompt,
                subjectPrompt,
                negativePrompt,
                modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })),
                params: activeParams,
            };
            try {
                const historyItem = await localHistory.add(result.blob, generationPrompt, finalParams, generationNegativePrompt, {
                sourceChainId,
                sourceChainName: chainName,
                sourceChainType: chain.id === 'playground' ? 'playground' : chain.type,
                basePrompt: generatedStructure.basePrompt,
                subjectPrompt: generatedStructure.subjectPrompt,
                modules: generatedStructure.modules,
            });
                setPreviewHistory(prev => [historyItem, ...prev.filter(item => item.id !== historyItem.id)]);
                setPreviewIndex(0);
                setPreviewMode('history');
                setGeneratedImage(historyItem.imageUrl);
                setLightboxImg(current => current === result.image ? historyItem.imageUrl : current);
                checkAndRemoveUntestedTag();
            } catch (historyError: any) {
                // Generation has already succeeded. Keep the in-memory image
                // visible and report only the persistence failure.
                setPreviewMode('unsaved');
                notify(`图片已生成，但保存到本地历史失败：${historyError?.message || '未知错误'}`, 'error');
                void db.logClientEvent({
                    category: 'generation',
                    action: 'save_generation_history',
                    status: 'error',
                    resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                    resourceId: chain.id,
                    message: '图片生成成功，但本地历史保存失败',
                    metadata: { error: historyError?.message || String(historyError) },
                }).catch(console.error);
            }
            void db.logClientEvent({
                category: 'generation',
                action: 'generate_image',
                resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                resourceId: chain.id,
                message: chain.id === 'playground' ? '实验室生图成功' : `从串生图成功：${chainName}`,
                metadata: {
                    chainName,
                    width: activeParams.width,
                    height: activeParams.height,
                    steps: activeParams.steps,
                    scale: activeParams.scale,
                    sampler: activeParams.sampler,
                    requestedSeed: activeParams.seed ?? 'random',
                    seed: result.seed,
                    promptLength: generationPrompt.length,
                    negativeLength: generationNegativePrompt.length,
                    characters: activeParams.characters?.length || 0,
                },
            }).catch(console.error);
            return true;
        } catch (e: any) {
            if (streamedPreviewShown) {
                setGeneratedImage(previousGeneratedImage);
                setPreviewMode(previousPreviewMode);
            }
            setErrorMsg(e.message);
            notify(e.message, 'error');
            void db.logClientEvent({
                category: 'generation',
                action: 'generate_image',
                status: 'error',
                resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                resourceId: chain.id,
                message: chain.id === 'playground' ? '实验室生图失败' : `从串生图失败：${chainName}`,
                metadata: {
                    chainName,
                    error: e.message,
                    width: generationParams.width,
                    height: generationParams.height,
                    steps: generationParams.steps,
                    scale: generationParams.scale,
                    sampler: generationParams.sampler,
                    seed: generationParams.seed ?? 'random',
                    promptLength: generationPrompt.length,
                    negativeLength: generationNegativePrompt.length,
                },
            }).catch(console.error);
            return false;
        } finally {
            setGenerationProgress(null);
            setIsGenerating(false);
            generationInFlightRef.current = false;
        }
    };
    const handleGenerate = async () => {
        const cost = estimateV45GenerationCost(params, true, await usageForCostEstimate(params.model));
        // 同步失效时按“免费”估算原本会静默直发，这里必须先警示确认。
        if (runtimeSyncUnhealthy && cost === 0) {
            if (!await confirmAction({
                title: '常量同步异常',
                message: `${runtimeSyncWarning}。\n\n仍要按当前估算（${generationCostLabel}）继续生成吗？`,
                confirmLabel: '仍要生成',
                tone: 'danger',
            })) return false;
            return handleGenerateDraft();
        }
        // 本地 Anlas 预算已用尽但仍需扣费：红色警告，由用户确认后才继续。
        if (cost > 0 && anlasBudget.remaining <= 0) {
            if (!await confirmAction({
                title: 'Anlas 预算已用尽',
                message: `本地预算已扣到 0，本次生成仍需消耗 ${cost} Anlas（共享账号额度），继续将透支你手动设定的预算线。\n\n若预算数字过期，可先到全局设置校准。`,
                confirmLabel: `仍要消耗 ${cost} 点生成`,
                tone: 'danger',
            })) return false;
            return handleGenerateDraft();
        }
        if (cost > 0 && !await confirmAction({
            title: '确认生成图片',
            message: `当前参数预计消耗 ${cost} Anlas${params.characterReferences?.enabled && params.characterReferences.slots.length ? `\n其中角色参考：${params.characterReferences.slots.length} × 5 = ${params.characterReferences.slots.length * 5} Anlas` : ''}${cost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖本次消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}。`,
            confirmLabel: `消耗 ${cost} 点并生成`,
        })) return false;
        return handleGenerateDraft();
    };

    const imageEditCostLabel = (operation: ImageEditOperation, focused: boolean, context?: { width: number; height: number; focusedRect?: { x: number; y: number; width: number; height: number } | null; minimumContextArea?: number }) => {
        const focusedReady = operation === 'inpaint' && focused && Boolean(context?.focusedRect && context.focusedRect.width >= 2 && context.focusedRect.height >= 2);
        const cost = estimateImageEditCost(activeEditDraft?.params || params, operation, activeEditDraft?.strength || (operation === 'image-to-image' ? 0.7 : 1), focusedReady, novelaiSubscription?.tier, opusUsageExhausted, context);
        return formatImageEditCostLabel(cost, operation, focusedReady, novelaiSubscription?.tier);
    };

    const handleImageEditGenerate = async (request: ImageEditRequest) => {
        if (!apiKey) {
            const message = '请先在“全局设置”中配置 NovelAI API Key';
            setErrorMsg(message);
            notify(message, 'error');
            return;
        }
        const editParamsSource = activeEditDraft?.params || params;
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
            return;
        }
        const editCost = estimateImageEditCost(editParamsSource, request.operation, request.strength, Boolean(request.focused), novelaiSubscription?.tier, opusUsageExhausted, {
            width: sourceWidth,
            height: sourceHeight,
            focusedRect: request.focusedRect,
            minimumContextArea: request.minimumContextArea,
        });
        if (editCost > 0 && anlasBudget.remaining <= 0) {
            if (!await confirmAction({ title: 'Anlas 预算已用尽', message: `本次图片编辑预计消耗 ${editCost} Anlas，继续将透支本地预算线。`, confirmLabel: `仍要消耗 ${editCost} 点`, tone: 'danger' })) return;
        } else if (editCost > 0 && !await confirmAction({ title: '确认图片编辑', message: `本次${request.operation === 'image-to-image' ? '图生图' : request.operation === 'inpaint' ? '局部重绘' : '扩图'}本地结算估算消耗 ${editCost} Anlas；生成成功后会刷新当前 Key 的账号额度。`, confirmLabel: `消耗 ${editCost} 点并生成` })) return;

        await flushMaskSave(request.operation).catch(error => console.warn('生成前保存编辑蒙版失败:', error));
        setIsGenerating(true);
        setErrorMsg(null);
        try {
            const editParams: NAIParams = {
                ...editParamsSource,
                width: sourceWidth,
                height: sourceHeight,
                seed: forceEmptySeed ? undefined : editParamsSource.seed,
                characters: [],
                useCoords: false,
            };
            const result = await generateImageEdit(apiKey, request.prompt, request.negativePrompt, editParams, request);
            setGeneratedImage(result.image);
            setPreviewMode('result');
            const keyHash = await hashNaiApiKey(apiKey);
            const editMask = request.mask ? await dataUrlToBlob(request.mask) : undefined;
            const edit: ImageEditMetadata = {
                operation: request.operation,
                parentHistoryId: request.parentHistoryId,
                baseImageSource: request.baseImageSource || (request.parentHistoryId ? 'history' : 'generated'),
                strength: request.strength,
                noise: request.noise,
                focused: request.focused,
                minimumContextArea: request.minimumContextArea,
                focusedArea: request.focusedRect,
                contextArea: request.minimumContextArea,
                canvasExpansion: request.expansion,
                requestWidth: result.requestWidth,
                requestHeight: result.requestHeight,
                fullSizeMask: Boolean(result.focusedGeometry?.fullSizeMask || (request.mask && !request.focused)),
                maskAvailable: Boolean(editMask),
                estimatedCost: result.estimatedCost ?? editCost,
                settlementStatus: 'estimated',
                keyHash,
                promptSource: request.promptSource,
            };
            const historyItem = await localHistory.add(result.blob, request.prompt, { ...editParams, seed: result.seed }, request.negativePrompt, {
                sourceChainId,
                sourceChainName: chainName,
                sourceChainType: chain.id === 'playground' ? 'playground' : chain.type,
                basePrompt,
                subjectPrompt,
                modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })),
                edit,
                editMask,
            });
            setPreviewHistory(previous => [historyItem, ...previous.filter(item => item.id !== historyItem.id)]);
            setPreviewIndex(0);
            setPreviewMode('history');
            setGeneratedImage(historyItem.imageUrl);
            setImageEditPreviewImage(historyItem.imageUrl);
            checkAndRemoveUntestedTag();
            notify('图片编辑完成，结果已保存为新的历史图片', 'success');
        } catch (editError) {
            const message = editError instanceof Error ? editError.message : '图片编辑失败';
            setErrorMsg(message);
            notify(message, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const currentAgentDraft = (): PromptAgentDraft => ({
        basePrompt,
        subjectPrompt,
        negativePrompt,
        modules: modules.map(module => ({ ...module, isActive: activeModules[module.id] ?? module.isActive })),
        params,
    });

    const applyAgentDraft = (draft: PromptAgentDraft) => {
        setBasePrompt(draft.basePrompt);
        setSubjectPrompt(draft.subjectPrompt);
        setNegativePrompt(draft.negativePrompt);
        setModules(draft.modules);
        setActiveModules(Object.fromEntries(draft.modules.map(module => [module.id, module.isActive])));
        setParams(draft.params);
        setHasChanges(true);
    };

    const requestAgentGeneration = async (draft: PromptAgentDraft, reason?: string): Promise<boolean> => {
        const cost = estimateV45GenerationCost(draft.params, true, await usageForCostEstimate(draft.params.model));
        const draftGenerationCostLabel = formatGenerationCostLabel(cost, draft.params.model);
        if (runtimeSyncUnhealthy && cost === 0) {
            if (!await confirmAction({
                title: '常量同步异常',
                message: `${reason ? `${reason}\n\n` : ''}${runtimeSyncWarning}。\n\n仍要按当前估算（${draftGenerationCostLabel}）继续生成吗？`,
                confirmLabel: '仍要生成',
                tone: 'danger',
            })) return false;
            return handleGenerateDraft(draft);
        }
        // 预算已用尽仍需扣费：红色警告（Agent 路径同样拦截）。
        if (cost > 0 && anlasBudget.remaining <= 0) {
            if (!await confirmAction({
                title: 'Anlas 预算已用尽',
                message: `${reason ? `${reason}\n\n` : ''}本地预算已扣到 0，本次生成仍需消耗 ${cost} Anlas（共享账号额度），继续将透支你手动设定的预算线。`,
                confirmLabel: `仍要消耗 ${cost} 点生成`,
                tone: 'danger',
            })) return false;
            return handleGenerateDraft(draft);
        }
        if (cost > 0 && !await confirmAction({
            title: 'Agent 已准备好生图',
            message: `${reason ? `${reason}\n\n` : ''}预计本次消耗 ${cost} Anlas。确认后才会提交给 NovelAI。${cost > anlasBudget.remaining ? `\n\n⚠ 剩余预算 ${anlasBudget.remaining} 点不足以覆盖本次消耗。` : ''}${runtimeSyncUnhealthy ? `\n\n⚠ ${runtimeSyncWarning}` : ''}`,
            confirmLabel: `消耗 ${cost} 点并生成`,
        })) return false;
        return handleGenerateDraft(draft);
    };

    const handleSavePreview = async () => {
        if (!generatedImage || !isOwner || chain.id === 'playground') return;
        if (await confirmAction({
            title: '将当前图片设为封面并保存？',
            message: '当前生成图片将成为该串的新封面，并自动保存当前所有提示词与参数改动；原有上传封面将被替换。',
            confirmLabel: '更换封面并保存',
            tone: 'danger',
        })) {
            setIsUploading(true);
            try {
                const res = await fetch(generatedImage);
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
                setIsEditingInfo(false);
                notify(`${isCharacterMode ? '角色串' : '风格串'}已保存，封面已更新`);
                void db.logClientEvent({
                    category: 'chain',
                    action: 'chain_cover_update',
                    resourceType: chain.type === 'character' ? 'character_chain' : 'style_chain',
                    resourceId: chain.id,
                    message: `用当前生成图更新封面并保存：${chainName}`,
                    metadata: { chainName, coverUrl: uploadRes.url, fileSize: uploadRes.size },
                }).catch(console.error);
            } catch (e: unknown) {
                const errMessage = e instanceof Error ? e.message : String(e);
                notify('设置封面失败: ' + errMessage, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!isOwner) return;
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
                setIsEditingInfo(false);
                notify(`${isCharacterMode ? '角色串' : '风格串'}已保存，封面已更新`);
                void db.logClientEvent({
                    category: 'chain',
                    action: 'chain_cover_upload',
                    resourceType: chain.type === 'character' ? 'character_chain' : 'style_chain',
                    resourceId: chain.id,
                    message: `上传新封面并保存：${chainName}`,
                    metadata: { chainName, fileName: file.name, fileSize: file.size, coverUrl: res.url },
                }).catch(console.error);
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

    return (
        <div
            className="chain-editor-workspace flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors relative"
            onDragEnter={handleImportDragEnter}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            onDrop={handleImportDrop}
        >
            {canEdit && isImportDragActive && (
                <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-indigo-950/55 backdrop-blur-sm">
                    <div className="mx-4 max-w-sm rounded-lg border-2 border-dashed border-white/80 bg-white/95 px-6 py-5 text-center shadow-2xl dark:bg-gray-900/95 dark:border-indigo-300">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                            <FileDown className="h-6 w-6" />
                        </div>
                        <div className="text-base font-bold text-gray-900 dark:text-white">松手导入配置</div>
                        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">支持 PNG 图片元数据或 JSON 元数据，并覆盖当前 Prompt 与生成参数</div>
                    </div>
                </div>
            )}
            {/* Top Bar */}
            <ChainEditorHeader
                chainId={chain.id}
                chainName={chainName}
                chainDesc={chainDesc}
                chainTags={chainTags}
                setChainName={setChainName}
                setChainDesc={setChainDesc}
                setChainTags={setChainTags}
                isCharacterMode={isCharacterMode}
                isOwner={isOwner}
                isGuest={isGuest}
                canEdit={canEdit}
                isEditingInfo={isEditingInfo}
                setIsEditingInfo={setIsEditingInfo}
                canSaveActiveModeToLibrary={canSaveActiveModeToLibrary}
                canSaveCurrentChain={canSaveCurrentChain}
                isUploading={isUploading}
                hasChanges={hasChanges}
                hasPendingPreviewCover={hasPendingPreviewCover}
                tagAssistEnabled={tagAssistEnabled}
                onTagAssistEnabledChange={onTagAssistEnabledChange}
                activeGenerationMode={activeGenerationMode}
                selectGenerationMode={selectGenerationMode}
                onBack={onBack}
                markChange={markChange}
                handleReset={handleReset}
                handleFork={handleFork}
                handleSaveAll={handleSaveAll}
                handleImportImage={handleImportImage}
                setShowImportPreset={setShowImportPreset}
                setTaggerOpen={setTaggerOpen}
                notify={notify}
            />

            <PromptAgentOverlayController
                chainId={chain.id}
                openToken={agentOpenToken}
                draft={currentAgentDraft()}
                apiKey={apiKey}
                onRunStart={snapshot => { agentRunRevisionRef.current = editorRevisionRef.current; setAgentUndoSnapshot(snapshot); }}
                onFinalDraft={draft => {
                    if (editorRevisionRef.current !== agentRunRevisionRef.current) {
                        notify('检测到 Agent 运行期间实验室已有变化，已保留当前内容，未覆盖你的修改。');
                        return;
                    }
                    applyAgentDraft(draft);
                }}
                onRequestGeneration={(draft, reason) => requestAgentGeneration(draft, reason)}
                canUndo={Boolean(agentUndoSnapshot)}
                onUndo={() => { if (agentUndoSnapshot) { applyAgentDraft(agentUndoSnapshot); setAgentUndoSnapshot(null); notify('已撤销本次 Agent 修改'); } }}
                tagAssistEnabled={tagAssistEnabled}
            />
            <ImageTaggerPanel
                open={taggerOpen}
                onClose={() => setTaggerOpen(false)}
                notify={notify}
                onInsert={(tags) => {
                    if (activeEditOperation && activeEditDraft) {
                        updateEditDraft(activeEditOperation, appendTagsToImageEditDraft(activeEditDraft, tags));
                    } else {
                        setBasePrompt(current => mergePromptFields(current, tags));
                        setSubjectPrompt('');
                        markPresetSectionModified('base');
                        markChange();
                    }
                    notify(`已追加 ${tags.split(',').length} 个识别 Tag`);
                }}
            />
            {activeGenerationMode === 'text-to-image' ? <>
            <nav className="grid h-10 grid-cols-3 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:hidden">
                {([['global', '全局'], ['character', '角色'], ['params', '参数']] as const).map(([value, label]) => <button key={value} onClick={() => setMobileEditorTab(value)} className={`relative min-w-0 text-sm font-bold ${mobileEditorTab === value ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>{label}{mobileEditorTab === value && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-indigo-500" />}</button>)}
            </nav>

            {/* Editor Content */}
            <div className="chain-editor-body flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-white dark:bg-gray-900">
                {/* Left Panel - Editor */}
                <div className="chain-editor-main flex w-full lg:w-1/2 min-h-full flex-col border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 lg:overflow-y-auto bg-white dark:bg-gray-900 relative order-2 lg:order-1 lg:flex-1 shrink-0">
                    <div className="flex w-full max-w-3xl flex-col gap-6 p-4 pb-24 md:p-6 md:pb-24 mx-auto">
                        <ChainEditorPromptInputs
                            prompt={basePrompt}
                            setPrompt={setBasePrompt}
                            presetSources={presetSources}
                            tagAssistEnabled={tagAssistEnabled}
                            canEdit={canEdit}
                            copyPromptToClipboard={copyPromptToClipboard}
                            markPresetSectionModified={markPresetSectionModified}
                            markChange={markChange}
                            activeLabLayout={activeLabLayout}
                            mobileEditorTab={mobileEditorTab}
                        />


                        {/* Character Management (New V4.5) */}
                        <ChainEditorCharacters
                            params={params}
                            setParams={setParams}
                            characters={params.characters || []}
                            canEdit={canEdit}
                            tagAssistEnabled={tagAssistEnabled}
                            characterPresetSources={characterPresetSources}
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
                            label="角色参考"
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
                            label="全局负面提示词"
                            order={activeLabLayout.order.indexOf('negative')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.negative)}
                            className={mobileEditorTab === 'global' ? 'block' : 'hidden lg:block'}
                        >
                        <section>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <PresetSourceBadge source={presetSources.negative} />
                                </div>
                                <PromptCopyButton onClick={() => copyPromptToClipboard(negativePrompt, '全局负面提示词')} title="复制全局负面提示词" />
                            </div>
                            <TagAutocompleteTextarea
                                tagAssistEnabled={tagAssistEnabled}
                                disabled={!canEdit}
                                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm font-normal leading-relaxed min-h-[80px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-indigo-500/50'}`}
                                value={negativePrompt}
                                onValueChange={(nextValue) => { setNegativePrompt(nextValue); markPresetSectionModified('negative'); markChange() }}
                            />
                        </section>
                        </LabModuleSection>

                        {/* Params Component */}
                        <LabModuleSection
                            moduleId="params"
                            label="参数设置"
                            order={activeLabLayout.order.indexOf('params')}
                            defaultCollapsed={Boolean(activeLabLayout.collapsed.params)}
                            className={mobileEditorTab === 'params' ? 'block' : 'hidden lg:block'}
                        >
                        <ChainEditorParams
                            params={params}
                            setParams={(nextParams) => { setParams(nextParams); markPresetSectionModified('settings'); }}
                            canEdit={canEdit}
                            markChange={markChange}
                            presetSource={presetSources.settings}
                            forceEmptySeed={forceEmptySeed}
                        />
                        </LabModuleSection>
                    </div>

                </div>

                {/* Right Panel - Preview (Testing) - Extracted Component */}
                <div className="chain-editor-preview-wrapper hidden min-h-0 flex-1 lg:contents">
                <ChainEditorPreview
                    isGenerating={isGenerating}
                    handleGenerate={handleGenerate}
                    errorMsg={errorMsg}
                    generatedImage={displayedPreviewImage}
                    previewImage={chain.previewImage}
                    setLightboxImg={setLightboxImg}
                    isOwner={isOwner}
                    isUploading={isUploading}
                    handleSavePreview={handleSavePreview}
                    handleUploadCover={handleUploadCover}
                    getDownloadFilename={getDownloadFilename}
                    hideCoverActions={chain.id === 'playground'}
                    canNavigateHistory={previewHistory.length > 1}
                    historyLabel={displayedPreviewImage ? currentPreviewPosition : undefined}
                    onPreviousHistory={showPreviousHistory}
                    onNextHistory={showNextHistory}
                    canManageHistoryGroup={Boolean(selectedPreviewItem)}
                    onRemoveCurrentHistory={handleRemoveCurrentHistory}
                    onClearHistoryGroup={handleClearHistoryGroup}
                    generationCostLabel={generationCostLabel}
                    transparentPreview={activeModelInfo.supportsTransparentBackground && params.transparent === true}
                    generationProgress={generationProgress}
                />
                </div>
            </div>

            </> : activeEditOperation && activeEditDraft ? <ImageEditPanel
                baseImage={imageEditBaseImage}
                previewImage={imageEditPreviewImage}
                operation={activeEditOperation}
                draft={activeEditDraft}
                layout={activeLabLayout}
                maskData={imageEditMaskData}
                generationCostLabel={imageEditCostLabel}
                isGenerating={isGenerating}
                safeMode={safeMode}
                tagAssistEnabled={tagAssistEnabled}
                forceEmptySeed={forceEmptySeed}
                latestTextToImageItem={latestTextToImageItem}
                onOpenLightbox={image => {
                    const historyIndex = image ? previewHistory.findIndex(item => item.imageUrl === image) : -1;
                    if (historyIndex >= 0) {
                        setPreviewIndex(historyIndex);
                        setPreviewMode('history');
                    }
                    setLightboxImg(image);
                }}
                getDownloadFilename={getDownloadFilename}
                canNavigateHistory={previewHistory.length > 1}
                historyLabel={imageEditPreviewHistoryLabel}
                onPreviousHistory={() => showHistoryAt((imageEditPreviewHistoryIndex >= 0 ? imageEditPreviewHistoryIndex : previewIndex) - 1)}
                onNextHistory={() => showHistoryAt((imageEditPreviewHistoryIndex >= 0 ? imageEditPreviewHistoryIndex : previewIndex) + 1)}
                canManageHistoryGroup={Boolean(imageEditPreviewItem)}
                onRemoveCurrentHistory={() => { void handleRemoveCurrentHistory(imageEditPreviewItem); }}
                onClearHistoryGroup={handleClearHistoryGroup}
                apiKey={apiKey}
                notify={notify}
                onPromptChange={value => updateEditDraft(activeEditOperation, { prompt: value, promptSource: 'custom' })}
                onNegativePromptChange={value => updateEditDraft(activeEditOperation, { negativePrompt: value })}
                onPromptSource={source => {
                    const sourceItem = selectedPreviewItem || (activeEditDraft.parentHistoryId ? previewHistory.find(item => item.id === activeEditDraft.parentHistoryId) : null);
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
                onBaseImageChange={(dataUrl, source, parentHistoryId) => {
                    void (async () => {
                        cancelPendingMaskSave();
                        const ref = await dataUrlToWorkspaceAsset(dataUrl, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'base'));
                        await deleteLabWorkspaceAsset(getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'mask'));
                        updateEditDraft(activeEditOperation, { baseImageRef: ref, baseImageSource: source, parentHistoryId: source === 'upload' ? undefined : parentHistoryId, maskRef: undefined, maskData: undefined, focusedRect: undefined });
                        setImageEditBaseImage(dataUrl);
                        setImageEditPreviewImage(dataUrl);
                        setImageEditMaskData(undefined);
                        if (parentHistoryId) {
                            const selectedIndex = previewHistory.findIndex(item => item.id === parentHistoryId);
                            if (selectedIndex >= 0) {
                                setPreviewIndex(selectedIndex);
                                setPreviewMode('history');
                            }
                        }
                    })();
                }}
                onCanvasChange={(imageData, maskData) => {
                    void (async () => {
                        cancelPendingMaskSave();
                        const [baseRef, maskRef] = await Promise.all([
                            dataUrlToWorkspaceAsset(imageData, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'base')),
                            dataUrlToWorkspaceAsset(maskData, getLabWorkspaceAssetId(workspaceKey, activeEditOperation, 'mask')),
                        ]);
                        updateEditDraft(activeEditOperation, { baseImageRef: baseRef, maskRef });
                        setImageEditBaseImage(imageData);
                        setImageEditPreviewImage(imageData);
                        setImageEditMaskData(maskData);
                    })();
                }}
                onGenerate={handleImageEditGenerate}
                onGenerateBarChange={handleImageEditGenerateBarChange}
            /> : null}

            {!lightboxImg && !showImportPreset && !importCandidate && <div className={`${keyboardOpen ? 'hidden' : 'flex'} fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[900] items-center gap-2 lg:hidden`}>
                {errorMsg && <div role="alert" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 left-4 z-[900] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600 shadow-lg dark:border-red-900/60 dark:bg-red-950/80 dark:text-red-300">{errorMsg}</div>}
                {(displayedPreviewImage || chain.previewImage) && <button type="button" onClick={() => setLightboxImg(displayedPreviewImage || chain.previewImage || null)} className="mobile-touch flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-gray-900 shadow-xl dark:border-gray-800" aria-label="查看最近生成结果"><SmartImage src={displayedPreviewImage || chain.previewImage || ''} alt="最近生成结果" /></button>}
                {queueStatus
                    ? <InlineCloudQueueStatus compact className="min-w-64 max-w-[calc(100vw-5rem)]" />
                    : <button onClick={activeEditOperation ? () => imageEditGenerateFnRef.current?.() : handleGenerate} disabled={isGenerating || imageEditBaseLoading || Boolean(activeEditOperation && !imageEditGenerateBar?.canGenerate)} className={`generation-action-button mobile-touch rounded-full px-6 text-sm font-bold text-white shadow-xl disabled:opacity-60 ${isGenerating ? 'generation-action-button--loading' : ''}`}><span>{isGenerating ? generationProgress ? `生成中 ${generationProgress.step}/${generationProgress.total}` : '生成中…' : activeEditOperation && !imageEditGenerateBar?.canGenerate ? '请先选择底图' : `生成 · ${activeEditOperation ? imageEditGenerateBar?.costLabel ?? '' : generationCostLabel}`}</span></button>}
            </div>}

            {/* Lightbox Modal */}
            {lightboxImg && (
                <div className="fixed inset-0 z-[1500] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
                    {previewHistory.length > 1 && (
                        <button
                            className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 md:h-14 md:w-14 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                showPreviousHistory();
                            }}
                            title="上一张"
                            aria-label="上一张历史图"
                        >
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}
                    <OriginalImage src={lightboxImg} data-safe-mode-ignore="true" className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={e => e.stopPropagation()} />
                    {previewHistory.length > 1 && (
                        <button
                            className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 h-12 w-12 md:h-14 md:w-14 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                showNextHistory();
                            }}
                            title="下一张"
                            aria-label="下一张历史图"
                        >
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    )}
                    {lightboxItem && (
                        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs text-white pointer-events-none">
                            {previewIndex + 1} / {previewHistory.length} · {new Date(lightboxItem.createdAt).toLocaleString('zh-CN')}
                        </div>
                    )}
                    <button className="absolute top-4 right-4 text-white hover:text-gray-300" onClick={() => setLightboxImg(null)} aria-label="关闭大图">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}

            <ChainEditorPresetModal
                showImportPreset={showImportPreset}
                importCandidate={importCandidate}
                setImportCandidate={setImportCandidate}
                quickImportMode={quickImportMode}
                setQuickImportMode={setQuickImportMode}
                importTab={importTab}
                setImportTab={setImportTab}
                setShowImportPreset={setShowImportPreset}
                allChains={allChains}
                importModalSearch={importModalSearch}
                setImportModalSearch={setImportModalSearch}
                importModalSelectedTags={importModalSelectedTags}
                setImportModalSelectedTags={setImportModalSelectedTags}
                favorites={favorites}
                initiateImport={initiateImport}
                importOptions={importOptions}
                setImportOptions={setImportOptions}
                selectedImportModuleIds={selectedImportModuleIds}
                setSelectedImportModuleIds={setSelectedImportModuleIds}
                confirmImport={confirmImport}
            />

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
