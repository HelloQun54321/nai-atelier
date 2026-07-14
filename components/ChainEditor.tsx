
import React, { useState, useEffect, useRef } from 'react';
import { PromptChain, PromptModule, CharacterParams, NAIParams, LocalGenItem } from '../types';
import { compilePrompt } from '../services/promptUtils';
import { generateImage } from '../services/naiService';
import { localHistory } from '../services/localHistory';
import { api } from '../services/api';
import { db } from '../services/dbService';
import { extractMetadata, parseNovelAIMetadata, IMPORT_SESSION_KEY } from '../services/metadataService';
import { ChainEditorParams } from './ChainEditorParams';
import { ChainEditorPreview } from './ChainEditorPreview';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';

interface ChainEditorProps {
    chain: PromptChain;
    allChains: PromptChain[]; // Need access to other chains for importing
    onUpdateChain: (id: string, updates: Partial<PromptChain>) => void;
    onBack: () => void;
    onFork: (chain: PromptChain, targetType?: 'style' | 'character') => void;
    setIsDirty: (isDirty: boolean) => void;
    notify: (msg: string, type?: 'success' | 'error') => void;
    externalImportToken?: number;
}

export const ChainEditor: React.FC<ChainEditorProps> = ({ chain, allChains, onUpdateChain, onBack, onFork, setIsDirty, notify, externalImportToken }) => {
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
    const [params, setParams] = useState(chain.params || { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined, qualityToggle: true, ucPreset: 4 });

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
    const [importOptions, setImportOptions] = useState({
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

    // --- Generation State ---
    const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [previewHistory, setPreviewHistory] = useState<LocalGenItem[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewMode, setPreviewMode] = useState<'history' | 'cover'>('cover');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const importDragDepthRef = useRef(0);
    const [showForkModal, setShowForkModal] = useState(false);
    const [isImportDragActive, setIsImportDragActive] = useState(false);
    const [showJsonPasteModal, setShowJsonPasteModal] = useState(false);
    const [jsonPasteText, setJsonPasteText] = useState('');

    // --- Initialization ---

    // --- Initialization ---
    const prevChainIdRef = useRef<string | null>(null);
    const [loadedPreset, setLoadedPreset] = useState<string | null>(null);

    const sourceChainId = chain.id === 'playground' ? 'playground' : chain.id;
    const selectedPreviewItem = previewMode === 'history' ? previewHistory[previewIndex] || null : null;
    const displayedPreviewImage = selectedPreviewItem?.imageUrl || generatedImage;
    const lightboxItem = lightboxImg ? previewHistory.find(item => item.imageUrl === lightboxImg) || null : null;
    const currentPreviewPosition = selectedPreviewItem
        ? `${previewIndex + 1} / ${previewHistory.length}`
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
        if (lightboxImg) {
            setLightboxImg(nextImage);
        }
    };

    const showPreviousHistory = () => showHistoryAt(previewIndex - 1);
    const showNextHistory = () => showHistoryAt(previewIndex + 1);

    const handleRemoveCurrentHistory = async () => {
        if (!selectedPreviewItem) return;

        try {
            await localHistory.unlinkFromSourceChain(selectedPreviewItem.id);

            const nextHistory = previewHistory.filter(item => item.id !== selectedPreviewItem.id);
            setPreviewHistory(nextHistory);

            if (nextHistory.length === 0) {
                setPreviewIndex(0);
                setPreviewMode('cover');
                setGeneratedImage(null);
                if (lightboxImg) setLightboxImg(null);
            } else {
                const nextIndex = Math.min(previewIndex, nextHistory.length - 1);
                const nextImage = nextHistory[nextIndex].imageUrl;
                setPreviewIndex(nextIndex);
                setPreviewMode('history');
                setGeneratedImage(nextImage);
                if (lightboxImg) setLightboxImg(nextImage);
            }

            notify('已从当前画师串历史组移除，历史页仍会保留。', 'success');
        } catch (error) {
            console.error('移除历史组图片失败:', error);
            notify('移除失败，请稍后重试。', 'error');
        }
    };

    const handleClearHistoryGroup = async () => {
        if (previewHistory.length === 0) return;
        if (!confirm(`确定清除当前画师串历史组里的 ${previewHistory.length} 张图片吗？\n\n这些图片不会从本地历史中删除，历史页仍然可以看到。`)) return;

        try {
            const count = await localHistory.unlinkAllFromSourceChain(sourceChainId);
            setPreviewHistory([]);
            setPreviewIndex(0);
            setPreviewMode('cover');
            setGeneratedImage(null);
            setLightboxImg(null);
            notify(`已清除 ${count} 张图片的当前画师串归属，历史页仍会保留。`, 'success');
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
        setLoadedPreset(null); // Reset loaded preset on chain switch

        setBasePrompt(chain.basePrompt || '');
        setNegativePrompt(chain.negativePrompt || '');
        setModules((chain.modules || []).map(m => ({
            ...m,
            position: m.position || 'post'
        })));
        setParams({
            width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined,
            qualityToggle: true, ucPreset: 4, characters: [],
            useCoords: chain.params?.useCoords ?? false,
            variety: chain.params?.variety ?? false,
            cfgRescale: chain.params?.cfgRescale ?? 0,
            ...chain.params
        });
        setChainName(chain.name);
        setChainDesc(chain.description);
        setChainTags(chain.tags || []);

        // Default subject to empty, not '1girl'
        const savedVars = chain.variableValues || {};
        setSubjectPrompt(savedVars['subject'] || '');

        const initialModules: Record<string, boolean> = {};
        if (chain.modules) {
            chain.modules.forEach(m => {
                initialModules[m.id] = m.isActive;
            });
        }
        setActiveModules(initialModules);
        setHasChanges(false);

        void reloadPreviewHistory(sourceChainId);

    }, [chain.id, chain.basePrompt, chain.negativePrompt, chain.modules, chain.params, chain.name, chain.description, chain.variableValues]);
    // Dependency note: we still list props to satisfy linter, but the guard 'if (prevChainId === chain.id) return' blocks re-execution.

    // --- sessionStorage 侦听：接收来自历史/灵感页面的一键导入数据 ---
    useEffect(() => {
        const raw = sessionStorage.getItem(IMPORT_SESSION_KEY);
        if (!raw) return;

        try {
            const data = JSON.parse(raw) as { prompt: string; negativePrompt: string; params: NAIParams };
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

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    // Helper to mark changes only if owner
    const markChange = () => {
        if (isOwner) setHasChanges(true);
    };

    // --- Handlers: Prompt Editing ---
    const handleModuleChange = (index: number, key: keyof PromptModule, value: any) => {
        if (!canEdit) return;
        const newModules = [...modules];
        newModules[index] = { ...newModules[index], [key]: value };
        setModules(newModules);
        markChange();
    };

    const addModule = () => {
        if (!canEdit) return;
        const newModule: PromptModule = {
            id: crypto.randomUUID(),
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
        newModules.splice(index, 1);
        setModules(newModules);
        markChange();
    };

    // --- Character Handlers ---
    const addCharacter = () => {
        if (!canEdit) return;
        const newChar: CharacterParams = { id: crypto.randomUUID(), prompt: '', x: 0.5, y: 0.5 };
        setParams({ ...params, characters: [...(params.characters || []), newChar] });
        markChange();
    };

    const updateCharacter = (idx: number, updates: Partial<CharacterParams>) => {
        if (!canEdit || !params.characters) return;
        const newChars = [...params.characters];
        newChars[idx] = { ...newChars[idx], ...updates };
        setParams({ ...params, characters: newChars });
        markChange();
    };

    const removeCharacter = (idx: number) => {
        if (!canEdit || !params.characters) return;
        const newChars = [...params.characters];
        newChars.splice(idx, 1);
        setParams({ ...params, characters: newChars });
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
        options: typeof importOptions,
        moduleIds: Set<string>
    ) => {
        if (!canEdit) return;

        // 1. Prompt (Base + Subject)
        if (options.importBasePrompt) {
            setBasePrompt(target.basePrompt || '');
        }
        if (options.importSubject) {
            const targetSubject = target.variableValues?.['subject'] || '';
            setSubjectPrompt(targetSubject);
        }

        // 2. Negative
        if (options.importNegative) {
            setNegativePrompt(target.negativePrompt || '');
        }

        // 3. Modules
        if (options.importModules && target.modules && target.modules.length > 0) {
            const modulesToImport = target.modules.filter(m => moduleIds.has(m.id));
            const newModules = modulesToImport.map(m => ({ ...m, id: crypto.randomUUID() }));

            if (options.appendModules) {
                setModules(prev => [...prev, ...newModules]); // Append
            } else {
                setModules(newModules); // Replace
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
                id: crypto.randomUUID() // Regen IDs
            }));

            if (options.appendCharacters) {
                setParams(prev => ({ ...prev, characters: [...(prev.characters || []), ...newChars] }));
            } else {
                setParams(prev => ({ ...prev, characters: newChars }));
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
        }

        // 6. Seed
        if (options.importSeed && target.params?.seed !== undefined) {
            setParams(prev => ({ ...prev, seed: target.params.seed }));
        }

        notify(`已从 "${target.name}" 导入配置`);
        markChange();
        setLoadedPreset(target.name);
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

    const extractRawMetadataFromJsonText = (jsonText: string) => {
        try {
            const json = JSON.parse(jsonText);
            const comment = json.Comment ?? json.comment;

            if (comment && typeof comment === 'object') {
                return JSON.stringify(comment);
            }

            if (typeof comment === 'string' && comment.trim()) {
                return comment;
            }

            if (json.prompt || json.steps || json.v4_prompt || json.uc) {
                return JSON.stringify(json);
            }

            if (typeof json.Description === 'string' && json.Description.trim()) {
                return json.Description;
            }
        } catch {
            // If the file is a plain metadata string saved as .json, try parsing it directly below.
        }

        return jsonText;
    };

    const extractRawMetadataFromJson = async (file: File) => {
        return extractRawMetadataFromJsonText(await file.text());
    };

    const applyRawMetadata = (rawMeta: string, sourceLabel: string) => {
        if (!rawMeta) {
            notify(`无法读取${sourceLabel}元数据`, 'error');
            return;
        }

        if (!confirm(`是否用该${sourceLabel}的参数覆盖当前 Base Prompt、Negative Prompt 和参数设置？\n(Subject 和 模块不会被修改)`)) return;

        try {
            // 调用公共解析服务
            const parsed = parseNovelAIMetadata(rawMeta, params);
            setBasePrompt(parsed.prompt);
            setNegativePrompt(parsed.negativePrompt);
            setParams(parsed.params);
            markChange();
            notify('参数已导入。Quality/UC/Variety 设置已根据 Prompt 内容自动匹配。');
            void db.logClientEvent({
                category: 'client',
                action: 'metadata_import',
                resourceType: chain.id === 'playground' ? 'playground' : 'chain',
                resourceId: chain.id,
                message: `从${sourceLabel}导入元数据`,
                metadata: {
                    source: sourceLabel,
                    chainName,
                    promptLength: parsed.prompt.length,
                    negativeLength: parsed.negativePrompt.length,
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
                applyRawMetadata(rawMeta, 'JSON');
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
        applyRawMetadata(rawMeta || '', '图片');
    };

    const handleImportImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await importMetadataFile(file);
        if (importInputRef.current) importInputRef.current.value = '';
    };

    const handlePasteJsonImport = () => {
        const text = jsonPasteText.trim();
        if (!text) {
            notify('请先粘贴 JSON 元数据', 'error');
            return;
        }

        const rawMeta = extractRawMetadataFromJsonText(text);
        applyRawMetadata(rawMeta, 'JSON');
        setShowJsonPasteModal(false);
        setJsonPasteText('');
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
    const applyImportData = (data: { prompt: string; negativePrompt: string; params: NAIParams }) => {
        setBasePrompt(data.prompt);
        setNegativePrompt(data.negativePrompt);
        setParams(data.params);
        markChange();
        notify('已从外部图片导入完整配置。');
    };


    const handleSaveAll = () => {
        if (!isOwner) return;
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        const varValues = { 'subject': subjectPrompt };
        onUpdateChain(chain.id, {
            name: chainName,
            description: chainDesc,
            tags: chainTags,
            basePrompt,
            negativePrompt,
            modules: updatedModules,
            params,
            variableValues: varValues
        });
        setHasChanges(false);
        setIsEditingInfo(false);
        notify(`${isCharacterMode ? '角色' : '画师'}串已保存`);
    };

    const handleFork = () => {
        setShowForkModal(true);
    };

    const handleReset = () => {
        if (!confirm('确定要重置实验室吗？所有当前输入都将丢失。')) return;
        setChainName('生图实验室');
        setChainDesc('临时生图实验，点击 Fork 可保存到库');
        setBasePrompt('');
        setNegativePrompt(''); // keep empty for playground
        // Reset params to defaults
        setParams({
            width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined, qualityToggle: true, ucPreset: 4, characters: []
        });
        setSubjectPrompt('');
        setModules([]);
        setActiveModules({});
        setGeneratedImage(null);
        notify('实验室已重置');
        void db.logClientEvent({
            category: 'client',
            action: 'playground_reset',
            resourceType: 'playground',
            resourceId: chain.id,
            message: chain.id === 'playground' ? '重置生图实验室' : `重置编辑器：${chainName}`,
        }).catch(console.error);
    };

    const confirmFork = (targetType: 'style' | 'character') => {
        const updatedModules = modules.map(m => ({
            ...m,
            isActive: activeModules[m.id] ?? true
        }));
        onFork({
            ...chain,
            tags: chainTags,
            basePrompt,
            negativePrompt,
            modules: updatedModules,
            params,
            variableValues: { 'subject': subjectPrompt }
        }, targetType);
        setShowForkModal(false);
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

    const handleGenerate = async () => {
        if (!apiKey) {
            setErrorMsg('请在左侧“全局设置”中配置 NovelAI API Key');
            return;
        }
        setIsGenerating(true);
        setErrorMsg(null);
        try {
            const activeParams = { ...params };
            const result = await generateImage(apiKey, finalPrompt, negativePrompt, activeParams);
            setGeneratedImage(result.image);
            // Use actual seed returned from generation
            const finalParams = { ...activeParams, seed: result.seed };
            const historyItem = await localHistory.add(result.image, finalPrompt, finalParams, negativePrompt, {
                sourceChainId,
                sourceChainName: chainName,
                sourceChainType: chain.id === 'playground' ? 'playground' : chain.type,
            });
            setPreviewHistory(prev => [historyItem, ...prev.filter(item => item.id !== historyItem.id)]);
            setPreviewIndex(0);
            setPreviewMode('history');
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
                    promptLength: finalPrompt.length,
                    negativeLength: negativePrompt.length,
                    characters: activeParams.characters?.length || 0,
                },
            }).catch(console.error);
        } catch (e: any) {
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
                    width: params.width,
                    height: params.height,
                    steps: params.steps,
                    scale: params.scale,
                    sampler: params.sampler,
                    seed: params.seed ?? 'random',
                    promptLength: finalPrompt.length,
                    negativeLength: negativePrompt.length,
                },
            }).catch(console.error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSavePreview = async () => {
        if (!generatedImage || !isOwner || chain.id === 'playground') return;
        if (confirm('将当前生成的图片设为该串的封面图？\n\n警告：此操作将永久删除旧的封面图（如果是上传的图片）。')) {
            setIsUploading(true);
            try {
                const res = await fetch(generatedImage);
                const blob = await res.blob();
                const file = new File([blob], getDownloadFilename(), { type: 'image/png' });
                const uploadRes = await api.uploadFile(file, 'covers');
                await onUpdateChain(chain.id, { previewImage: uploadRes.url });
                notify('封面已更新 (刷新列表查看效果)');
                void db.logClientEvent({
                    category: 'chain',
                    action: 'chain_cover_update',
                    resourceType: chain.type === 'character' ? 'character_chain' : 'style_chain',
                    resourceId: chain.id,
                    message: `用当前生成图更新封面：${chainName}`,
                    metadata: { chainName, coverUrl: uploadRes.url, fileSize: uploadRes.size },
                }).catch(console.error);
            } catch (e: any) {
                notify('设置封面失败: ' + e.message, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!isOwner) return;
        const file = e.target.files?.[0];
        if (!file) return;
        if (confirm('您确定要上传新封面吗？\n\n警告：此操作将永久删除旧的封面图文件。')) {
            setIsUploading(true);
            try {
                const res = await api.uploadFile(file, 'covers');
                await onUpdateChain(chain.id, { previewImage: res.url });
                notify('封面已更新');
                void db.logClientEvent({
                    category: 'chain',
                    action: 'chain_cover_upload',
                    resourceType: chain.type === 'character' ? 'character_chain' : 'style_chain',
                    resourceId: chain.id,
                    message: `上传新封面：${chainName}`,
                    metadata: { chainName, fileName: file.name, fileSize: file.size, coverUrl: res.url },
                }).catch(console.error);
            } catch (err: any) {
                notify('上传失败: ' + err.message, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const copyPromptToClipboard = (isNegative: boolean) => {
        if (isNegative) {
            navigator.clipboard.writeText(negativePrompt);
            notify('负面提示词已复制');
        } else {
            navigator.clipboard.writeText(finalPrompt);
            notify('完整正面提示词已复制');
        }
    };

    return (
        <div
            className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 transition-colors relative"
            onDragEnter={handleImportDragEnter}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            onDrop={handleImportDrop}
        >
            {canEdit && isImportDragActive && (
                <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-indigo-950/55 backdrop-blur-sm">
                    <div className="mx-4 max-w-sm rounded-lg border-2 border-dashed border-white/80 bg-white/95 px-6 py-5 text-center shadow-2xl dark:bg-gray-900/95 dark:border-indigo-300">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                        </div>
                        <div className="text-base font-bold text-gray-900 dark:text-white">松手导入配置</div>
                        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">支持 PNG 图片元数据或 JSON 元数据，并覆盖当前 Prompt 与生成参数</div>
                    </div>
                </div>
            )}
            {/* Top Bar */}
            <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-3 flex items-center justify-between gap-2 md:gap-4 overflow-x-hidden">
                <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
                    <button onClick={onBack} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors flex-shrink-0">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7m-7 7h18" /></svg>
                    </button>

                    {isEditingInfo && isOwner ? (
                        <div className="flex flex-col md:flex-row gap-2 flex-1 w-full max-w-2xl min-w-0">
                            <input type="text" value={chainName} onChange={e => { setChainName(e.target.value); markChange() }} className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-900 dark:text-white text-sm focus:border-indigo-500 outline-none font-bold min-w-0" placeholder="名称" />
                            <div className="flex gap-2">
                                <input type="text" value={chainDesc} onChange={e => { setChainDesc(e.target.value); markChange() }} className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-700 dark:text-gray-300 text-sm focus:border-indigo-500 outline-none min-w-0" placeholder="描述" />
                                <button
                                    onClick={() => setIsEditingInfo(false)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-medium flex-shrink-0 whitespace-nowrap"
                                >
                                    确定
                                </button>
                            </div>
                            {/* Tags Input */}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {chainTags.map((tag, idx) => (
                                <span key={idx} className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 flex items-center gap-1">
                                  {tag}
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setChainTags(chainTags.filter((_, i) => i !== idx));
                                        markChange();
                                      }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </span>
                              ))}
                              {canEdit && (
                                <input
                                  type="text"
                                  placeholder="添加标签..."
                                  className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                      const newTag = e.currentTarget.value.trim();
                                      if (!chainTags.includes(newTag)) {
                                        setChainTags([...chainTags, newTag]);
                                        markChange();
                                      }
                                      e.currentTarget.value = '';
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value.trim()) {
                                      const newTag = e.target.value.trim();
                                      if (!chainTags.includes(newTag)) {
                                        setChainTags([...chainTags, newTag]);
                                        markChange();
                                      }
                                      e.target.value = '';
                                    }
                                  }}
                                />
                              )}
                            </div>

                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group cursor-pointer min-w-0 flex-1" onClick={() => isOwner && setIsEditingInfo(true)}>
                            <div className="flex flex-col md:flex-row md:items-baseline gap-0.5 md:gap-2 overflow-hidden min-w-0">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border flex-shrink-0 ${isCharacterMode ? 'bg-pink-100 text-pink-700 border-pink-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                    {isCharacterMode ? '角色串' : '画师串'}
                                </span>
                                <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white truncate min-w-0">{chainName}</h1>
                                <span className="text-xs text-gray-500 dark:text-gray-500 truncate block max-w-full md:max-w-xs min-w-0">{chainDesc}</span>
                            </div>
                            {isOwner && <svg className="w-4 h-4 text-gray-400 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 md:gap-4 flex-shrink-0 ml-auto">
                    {/* Fork / Save to Library Button */}
                    {((!isOwner && !isGuest) || chain.id === 'playground') && (
                        <button
                            onClick={handleFork}
                            className="px-2 md:px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium shadow-lg shadow-green-500/20 flex items-center"
                        >
                            <svg className="w-4 h-4 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                            <span className="hidden md:inline">{chain.id === 'playground' ? '保存到库' : 'Fork'}</span>
                        </button>
                    )}

                    {/* Destructive or secondary actions stay in the overflow menu. */}
                    {chain.id === 'playground' && (
                        <details className="relative">
                            <summary className="flex h-8 w-9 cursor-pointer list-none items-center justify-center rounded text-xl text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" aria-label="更多操作" title="更多操作">⋯</summary>
                            <div className="absolute right-0 top-10 z-50 w-40 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                                <button
                                    type="button"
                                    onClick={event => {
                                        event.currentTarget.closest('details')?.removeAttribute('open');
                                        handleReset();
                                    }}
                                    className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                >
                                    重置实验室
                                </button>
                            </div>
                        </details>
                    )}
                </div>
            </header>

            {/* Editor Content */}
            <div className={`flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden ${isOwner ? 'pb-20 lg:pb-0' : ''}`}>
                {/* Left Panel - Editor */}
                <div className="w-full lg:w-1/2 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 lg:overflow-y-auto bg-white dark:bg-gray-900 relative order-2 lg:order-1 lg:flex-1 shrink-0">
                    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto w-full pb-32 md:pb-24">
                        {!isOwner && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded mb-4 text-sm text-yellow-700 dark:text-yellow-400">
                                {isGuest
                                    ? '您正在以游客身份浏览。您可以自由修改 Prompt 进行测试，但无法保存更改。'
                                    : '您正在查看他人的串，无法直接修改。您可以调整参数进行测试，或点击右上角“Fork”保存到您的列表。'
                                }
                            </div>
                        )}

                        {/* Base Prompt */}
                        <section>
                            <div className="flex justify-between items-end mb-2">
                                <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">
                                    基础画风（画师串）
                                </label>

                                {/* Import & Load Preset Buttons */}
                                <div className="flex items-center gap-2">
                                    {loadedPreset && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50 flex items-center gap-1 font-mono">
                                            <span className="opacity-50">PRESET:</span> {loadedPreset}
                                        </span>
                                    )}

                                    {canEdit && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowImportPreset(true)}
                                                className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                                引用预设
                                            </button>

                                            <input
                                                type="file"
                                                ref={importInputRef}
                                                className="hidden"
                                                accept="image/png,application/json,.json"
                                                onChange={handleImportImage}
                                            />
                                            <button
                                                onClick={() => importInputRef.current?.click()}
                                                className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                                导入图片/JSON配置
                                            </button>
                                            <button
                                                onClick={() => setShowJsonPasteModal(true)}
                                                className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex items-center gap-1"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V6a2 2 0 012-2h5l5 5v9a2 2 0 01-2 2z" /></svg>
                                                粘贴JSON
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <TagAutocompleteTextarea
                                disabled={!canEdit}
                                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[100px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:ring-1 focus:ring-indigo-500'}`}
                                value={basePrompt}
                                placeholder="画风标签，如 masterpiece、best quality、画师tag等，英文逗号分隔"
                                onValueChange={(nextValue) => { setBasePrompt(nextValue); markChange() }}
                            />
                        </section>

                        {/* Modules */}
                        <section>
                            <div className="flex justify-between items-center mb-3">
                                <label className="block text-sm font-semibold text-indigo-500 dark:text-indigo-400">
                                    2. 模块
                                </label>
                                {canEdit && (
                                    <button onClick={addModule} className="text-xs flex items-center bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700">
                                        添加
                                    </button>
                                )}
                            </div>
                            <div className="space-y-3">
                                {(modules || []).map((mod, idx) => (
                                    <div key={mod.id} className={`bg-gray-50 dark:bg-gray-800/40 border rounded-lg p-3 ${activeModules[mod.id] !== false ? 'border-gray-300 dark:border-gray-700' : 'border-gray-200 dark:border-gray-800 opacity-60'}`}>
                                        <div className="flex flex-wrap gap-2 mb-2 items-center">
                                            <input type="checkbox" checked={activeModules[mod.id] !== false} onChange={() => toggleModuleActive(mod.id)} className="rounded bg-gray-100 dark:bg-gray-900 text-indigo-600 focus:ring-0 flex-shrink-0" />
                                            <input
                                                type="text"
                                                disabled={!canEdit}
                                                className="bg-transparent border-b border-transparent focus:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-medium text-sm outline-none px-1 flex-1 min-w-[120px]"
                                                value={mod.name}
                                                onChange={(e) => handleModuleChange(idx, 'name', e.target.value)}
                                            />
                                            {/* Mobile optimized: Group Input and Position Toggles together on right */}
                                            <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                                                <input
                                                    type="text"
                                                    placeholder="分组"
                                                    disabled={!canEdit}
                                                    className="bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-indigo-500 text-gray-500 dark:text-gray-400 text-xs outline-none px-1 w-12 text-center"
                                                    value={mod.group || ''}
                                                    onChange={(e) => handleModuleChange(idx, 'group', e.target.value)}
                                                    title="分组 (Group)"
                                                />
                                                <div className="flex bg-gray-200 dark:bg-gray-700 rounded p-0.5">
                                                    <button
                                                        onClick={() => handleModuleChange(idx, 'position', 'pre')}
                                                        disabled={!canEdit}
                                                        className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mod.position === 'pre' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                                    >
                                                        前
                                                    </button>
                                                    <button
                                                        onClick={() => handleModuleChange(idx, 'position', 'post')}
                                                        disabled={!canEdit}
                                                        className={`px-2 py-0.5 text-[10px] rounded transition-colors ${(mod.position === 'post' || !mod.position) ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-300 font-bold' : 'text-gray-500'}`}
                                                    >
                                                        后
                                                    </button>
                                                </div>
                                                {canEdit && (
                                                    <button onClick={() => removeModule(idx)} className="text-gray-400 hover:text-red-500 ml-1">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <TagAutocompleteTextarea
                                            disabled={!canEdit}
                                            className={`w-full rounded p-2 outline-none font-mono text-xs h-16 resize-none ${!canEdit ? 'bg-transparent text-gray-500' : 'bg-white dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700/30 text-gray-800 dark:text-gray-300 focus:ring-1 focus:ring-indigo-500/50'}`}
                                            value={mod.content}
                                            onValueChange={(nextValue) => handleModuleChange(idx, 'content', nextValue)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Character Management (New V4.5) */}
                        <section className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-100 dark:border-indigo-800/50">
                            <div className="flex justify-between items-center mb-3">
                                <label className="block text-sm font-semibold text-indigo-600 dark:text-indigo-300">3. 多角色管理</label>
                                <div className="flex gap-2 items-center">
                                    {/* AI Choice Toggle */}
                                    <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-700 px-2 py-1 rounded shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 border border-transparent dark:border-gray-600">
                                        <input
                                            type="checkbox"
                                            disabled={!canEdit}
                                            checked={!(params.useCoords ?? true)}
                                            onChange={(e) => {
                                                setParams({ ...params, useCoords: !e.target.checked });
                                                markChange();
                                            }}
                                            className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-0"
                                        />
                                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">AI 自动构图</span>
                                    </label>

                                    {canEdit && (
                                        <button onClick={addCharacter} className="text-xs flex items-center bg-white dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-200">
                                            + 添加角色
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {(params.characters || []).length === 0 && (
                                    <div className="text-xs text-gray-400 text-center py-2">暂无角色定义，提示词将作为整体处理。</div>
                                )}
                                {(params.characters || []).map((char, idx) => (
                                    <div key={char.id} className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700 shadow-sm relative">
                                        <div className="flex gap-3 items-start">
                                            <div className="flex-1 space-y-2">
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">人物描述</label>
                                                    <TagAutocompleteTextarea
                                                        disabled={!canEdit}
                                                        value={char.prompt}
                                                        onValueChange={(nextValue) => updateCharacter(idx, { prompt: nextValue })}
                                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                                        placeholder="人物描述"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">专属负面</label>
                                                    <TagAutocompleteTextarea
                                                        disabled={!canEdit}
                                                        value={char.negativePrompt || ''}
                                                        onValueChange={(nextValue) => updateCharacter(idx, { negativePrompt: nextValue })}
                                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-10 resize-none focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                                                        placeholder="选填"
                                                    />
                                                </div>
                                            </div>
                                            <div className="w-24 flex flex-col gap-2">
                                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center X</label>
                                                    <input
                                                        type="number" step="0.1" min="0" max="1"
                                                        disabled={!canEdit}
                                                        value={char.x}
                                                        onChange={(e) => updateCharacter(idx, { x: parseFloat(e.target.value) })}
                                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                    />
                                                </div>
                                                <div className={!(params.useCoords ?? true) ? "opacity-40 pointer-events-none grayscale" : ""}>
                                                    <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Center Y</label>
                                                    <input
                                                        type="number" step="0.1" min="0" max="1"
                                                        disabled={!canEdit}
                                                        value={char.y}
                                                        onChange={(e) => updateCharacter(idx, { y: parseFloat(e.target.value) })}
                                                        className="w-full text-xs p-1 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                            {canEdit && (
                                                <button onClick={() => removeCharacter(idx)} className="text-gray-400 hover:text-red-500 mt-6">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Negative Prompt */}
                        <section className="mb-8">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <label className="block text-sm font-semibold text-red-500 dark:text-red-400">全局负面提示词</label>
                                <button type="button" onClick={() => copyPromptToClipboard(true)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30" title="复制负面提示词">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                    复制
                                </button>
                            </div>
                            <TagAutocompleteTextarea
                                disabled={!canEdit}
                                className={`w-full border rounded-lg p-3 outline-none font-mono text-sm leading-relaxed min-h-[80px] ${!canEdit ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-red-900 dark:text-red-100/80 focus:ring-1 focus:ring-red-500/50'}`}
                                value={negativePrompt}
                                onValueChange={(nextValue) => { setNegativePrompt(nextValue); markChange() }}
                            />
                        </section>

                        {/* Params Component */}
                        <ChainEditorParams
                            params={params}
                            setParams={setParams}
                            canEdit={canEdit}
                            markChange={markChange}
                        />
                    </div>

                    {/* Save Footer: fixed on mobile so always visible, sticky in left panel on lg */}
                    {isOwner && chain.id !== 'playground' && !lightboxImg && (
                        <div className="fixed bottom-0 left-0 right-0 lg:sticky lg:left-auto lg:right-auto lg:bottom-0 z-[999] w-full p-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex justify-between items-center shadow-lg transition-transform duration-300">
                            <div className="text-xs text-gray-500 ml-2">
                                {hasChanges ? <span className="text-yellow-600 dark:text-yellow-500 font-medium">⚠️ 未保存</span> : <span className="text-green-600 dark:text-green-500">✅ 已保存</span>}
                            </div>
                            <div className="flex items-center gap-2 md:gap-3">
                                <button
                                    onClick={handleSaveAll}
                                    disabled={!hasChanges}
                                    className={`px-6 py-1.5 rounded-md font-bold text-sm shadow-md transition-all transform active:scale-95 ${hasChanges
                                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 text-white shadow-indigo-500/30'
                                        : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                                        }`}
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel - Preview (Testing) - Extracted Component */}
                <ChainEditorPreview
                    subjectPrompt={subjectPrompt}
                    setSubjectPrompt={(s) => { setSubjectPrompt(s); markChange(); }}
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
                    onCopyFinalPrompt={() => copyPromptToClipboard(false)}
                />
            </div>

            {/* Lightbox Modal */}
            {lightboxImg && (
                <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
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
                    <img src={lightboxImg} className="max-w-full max-h-full object-contain rounded shadow-2xl" onClick={e => e.stopPropagation()} />
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
                    <button className="absolute top-4 right-4 text-white hover:text-gray-300" onClick={() => setLightboxImg(null)}>
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}

            {/* Paste JSON Metadata Modal */}
            {showJsonPasteModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-3xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white">粘贴 JSON 元数据</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">支持完整导出的 JSON，或仅包含 prompt / steps / v4_prompt 的 Comment 内容。</p>
                            </div>
                            <button
                                onClick={() => setShowJsonPasteModal(false)}
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                aria-label="关闭"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-4 flex-1 min-h-0">
                            <textarea
                                value={jsonPasteText}
                                onChange={(e) => setJsonPasteText(e.target.value)}
                                placeholder='粘贴 JSON，例如 {"Comment":{"prompt":"...","steps":28,"width":832,"height":1216}}'
                                className="w-full h-[45vh] min-h-[260px] resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-3 font-mono text-xs leading-relaxed text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
                                autoFocus
                            />
                        </div>
                        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-end gap-2">
                            <button
                                onClick={() => {
                                    setShowJsonPasteModal(false);
                                    setJsonPasteText('');
                                }}
                                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handlePasteJsonImport}
                                disabled={!jsonPasteText.trim()}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded shadow-lg shadow-indigo-500/20 transition-all"
                            >
                                导入 JSON 配置
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Import Preset List Modal */}
            {showImportPreset && !importCandidate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-4xl md:max-w-5xl lg:max-w-6xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center flex-shrink-0 gap-4 flex-wrap">
                            <h3 className="font-bold dark:text-white flex-shrink-0">引用预设</h3>

                            {/* 快速导入开关 */}
                            <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0 group">
                                <span className="text-xs text-gray-500 dark:text-gray-400">快速导入</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={quickImportMode}
                                    onClick={() => setQuickImportMode(!quickImportMode)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQuickImportMode(!quickImportMode); } }}
                                    className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${quickImportMode ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                >
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${quickImportMode ? 'left-5' : 'left-0.5'}`}></div>
                                </button>
                                <span className="relative">
                                    <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                        开启后点击预设直接导入，关闭则显示详细选项
                                    </span>
                                </span>
                            </label>

                            <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg flex-1 max-w-xs">
                                <button
                                    onClick={() => setImportTab('style')}
                                    className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'style' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                                >
                                    画师/风格串
                                </button>
                                <button
                                    onClick={() => setImportTab('character')}
                                    className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${importTab === 'character' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500'}`}
                                >
                                    Character (角色)
                                </button>
                            </div>

                            <button onClick={() => setShowImportPreset(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 min-h-0">
                            {/* Extract all unique tags from the filtered list for this modal */}
                            {(() => {
                              const filteredForTags = allChains.filter(c => (importTab === 'character' ? c.type === 'character' : (c.type === 'style' || !c.type)));
                              const allModalTags = Array.from(
                                new Set(
                                  filteredForTags.flatMap(chain => chain.tags || [])
                                )
                              ).sort();

                              // Filter the list based on search and tags
                              const filteredChains = filteredForTags
                                .filter(c =>
                                  (c.name.toLowerCase().includes(importModalSearch.toLowerCase()) ||
                                   c.description.toLowerCase().includes(importModalSearch.toLowerCase()))
                                )
                                .filter(c => {
                                  if (importModalSelectedTags.size === 0) return true;
                                  const chainTagSet = new Set(c.tags || []);
                                  return Array.from(importModalSelectedTags).every(tag => chainTagSet.has(tag));
                                })
                                .sort((a, b) => {
                                  const aFav = favorites.has(a.id); const bFav = favorites.has(b.id);
                                  if (aFav && !bFav) return -1; if (!aFav && bFav) return 1; return 0;
                                });

                              return (
                                <>
                                  {/* Search Input for Modal */}
                                  <div className="flex gap-2 w-full mb-4">
                                    <input
                                      type="text"
                                      placeholder="搜索预设..."
                                      className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                      value={importModalSearch}
                                      onChange={(e) => setImportModalSearch(e.target.value)}
                                    />
                                  </div>
                                  {/* Tag Filter Bar for Modal */}
                                  {allModalTags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 p-2 bg-gray-100 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 mb-4 max-h-20 overflow-y-auto">
                                      {allModalTags.map(tag => (
                                        <button
                                          key={tag}
                                          type="button"
                                          onClick={() => {
                                            const newSelected = new Set(importModalSelectedTags);
                                            if (newSelected.has(tag)) {
                                              newSelected.delete(tag);
                                            } else {
                                              newSelected.add(tag);
                                            }
                                            setImportModalSelectedTags(newSelected);
                                          }}
                                          className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                            importModalSelectedTags.has(tag)
                                              ? 'bg-indigo-600 text-white'
                                              : 'bg-white dark:bg-gray-600 text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-500'
                                          }`}
                                        >
                                          {tag}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {filteredChains.map(c => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => initiateImport(c)}
                                        className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-white dark:bg-gray-800/80 overflow-hidden text-left transition-colors"
                                      >
                                        <div className="aspect-square w-full bg-black/5 dark:bg-black/20 flex-shrink-0 relative">
                                          {c.previewImage ? (
                                            <img src={c.previewImage} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                          ) : (
                                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">无图</div>
                                          )}
                                          {favorites.has(c.id) && (
                                            <span className="absolute top-1 right-1 text-amber-500 text-lg drop-shadow-md" title="已收藏">★</span>
                                          )}
                                        </div>
                                        <div className="p-2 flex-1 min-h-0 flex flex-col">
                                          <div className="font-semibold text-sm dark:text-gray-200 truncate">{c.name}</div>
                                          <div className="text-xs text-gray-500 truncate mt-0.5 flex-1">{c.description || '无描述'}</div>
                                          <span className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">选择</span>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                  {filteredChains.length === 0 && (
                                    <div className="text-center text-gray-400 py-12 text-sm">暂无匹配的预设</div>
                                  )}
                                </>
                              );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Import Detail/Confirm Modal */}
            {importCandidate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-xl">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate" title={importCandidate.name}>
                                导入: {importCandidate.name}
                            </h3>
                        </div>
                        <div className="p-5 space-y-3">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importBasePrompt} onChange={e => setImportOptions({ ...importOptions, importBasePrompt: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">基础画风</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSubject} onChange={e => setImportOptions({ ...importOptions, importSubject: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">主体提示词</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importNegative} onChange={e => setImportOptions({ ...importOptions, importNegative: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">负面提示词</span>
                            </label>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importModules} onChange={e => setImportOptions({ ...importOptions, importModules: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">增强模块</span>
                                </label>
                                {importOptions.importModules && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendModules} onChange={e => setImportOptions({ ...importOptions, appendModules: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                    </label>
                                )}
                                {importOptions.importModules && importCandidate.modules && importCandidate.modules.length > 0 && (
                                    <div className="ml-8 mt-2 border border-gray-200 dark:border-gray-700 rounded p-2 max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-900 custom-scrollbar">
                                        {importCandidate.modules.map(m => (
                                            <label key={m.id} className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 p-1 rounded cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedImportModuleIds.has(m.id)}
                                                    onChange={e => {
                                                        const next = new Set(selectedImportModuleIds);
                                                        if (e.target.checked) next.add(m.id);
                                                        else next.delete(m.id);
                                                        setSelectedImportModuleIds(next);
                                                    }}
                                                    className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-0 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                                />
                                                <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1" title={m.content}>{m.name || '未命名模块'}</span>
                                                {m.group && <span className="text-[9px] bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-gray-500 uppercase">{m.group}</span>}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={importOptions.importCharacters} onChange={e => setImportOptions({ ...importOptions, importCharacters: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                    <span className="text-sm font-medium dark:text-gray-200">多角色管理</span>
                                </label>
                                {importOptions.importCharacters && (
                                    <label className="flex items-center gap-3 cursor-pointer select-none pl-8">
                                        <input type="checkbox" checked={importOptions.appendCharacters} onChange={e => setImportOptions({ ...importOptions, appendCharacters: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">追加</span>
                                    </label>
                                )}
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSettings} onChange={e => setImportOptions({ ...importOptions, importSettings: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">生成参数</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={importOptions.importSeed} onChange={e => setImportOptions({ ...importOptions, importSeed: e.target.checked })} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
                                <span className="text-sm font-medium dark:text-gray-200">种子</span>
                            </label>
                        </div>
                        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                            <button onClick={() => setImportCandidate(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">取消</button>
                            <button onClick={confirmImport} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded shadow-lg shadow-indigo-500/20 transition-all">导入</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Fork Type Selection Modal */}
            {showForkModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">选择保存类型</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => confirmFork('style')}
                                className="flex flex-col items-center justify-center p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors gap-2"
                            >
                                <span className="text-2xl">🎨</span>
                                <span className="font-bold text-blue-700 dark:text-blue-300">画师/风格串</span>
                            </button>
                            <button
                                onClick={() => confirmFork('character')}
                                className="flex flex-col items-center justify-center p-4 rounded-lg bg-pink-50 dark:bg-pink-900/20 border-2 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/40 transition-colors gap-2"
                            >
                                <span className="text-2xl">👤</span>
                                <span className="font-bold text-pink-700 dark:text-pink-300">角色串</span>
                            </button>
                        </div>
                        <button
                            onClick={() => setShowForkModal(false)}
                            className="mt-6 w-full py-2 text-gray-500 hover:text-gray-800 dark:hover:text-white text-sm font-medium"
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
