import { LAB_SUBJECT_PURPOSES } from '../../services/labPromptLayout';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, ChevronDown, ChevronRight, Trash2, UserRoundSearch } from 'lucide-react';
import { CharacterParams, NAIParams, PromptChain } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import type { PromptTidyOptions } from '../PromptTidyActions';
import { PromptLibraryChooser, PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { PresetSection, PresetSource, PresetSourceBadges } from './PresetSourceBadges';
import { mergePromptFields } from '../../services/promptUtils';
import { ImageTaggerPanel } from '../ImageTaggerPanel';
import { compileCharacterContent, getCharacterSectionKeys, hasCharacterSections, reorderCharacter } from '../../services/characterPrompts';
import { CharacterPositionStage } from './CharacterPositionStage';
import { CharacterSlotHeader } from './CharacterSlotHeader';
import { getRuntimeNaiModelInfo, isNaiMediumModel } from '../../services/naiModels';
import { useNaiRuntime } from '../../services/naiRuntime';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { IconButton } from '../DesignSystem';

export interface ChainEditorCharactersProps {
    params: NAIParams;
    setParams: (params: NAIParams) => void;
    characters: CharacterParams[];
    canEdit: boolean;
    tagAssistEnabled: boolean;
    characterPresetSources: Record<string, PresetSource>;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    addCharacter: () => void;
    /** 就地发起「随机搭配」 */
    onContentRollForRole?: (index: number) => void;
    updateCharacter: (idx: number, updates: Partial<CharacterParams>, useCoords?: boolean) => void;
    removeCharacter: (idx: number) => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'reference' | 'params';
    coordinateHint?: string;
    scopeKey?: string;
    freeformPosition?: boolean;
    positionImage?: string | null;
    positionSize?: { width: number; height: number };
    allChains?: PromptChain[];
    chainsLoading?: boolean;
    chainsError?: string;
    onRetryChains?: () => void;
    showCharacterReference?: boolean;
    canSaveCharacter?: boolean;
    onSaveCharacter?: (character: CharacterParams, name: string) => Promise<void>;
    onCopyPrompt?: (value: string, label: string) => void;
    notify?: (message: string, type?: 'success' | 'error') => void;
    sample?: PromptTidyOptions['sample'];
    /** 在独立角色分页下省略外层「角色专属提示词 · 收起」折叠壳。 */
    bare?: boolean;
}

export const ChainEditorCharacters: React.FC<ChainEditorCharactersProps> = ({
    params,
    setParams,
    characters,
    canEdit,
    tagAssistEnabled,
    onContentRollForRole,
    characterPresetSources,
    markPresetSectionModified,
    markChange,
    addCharacter,
    updateCharacter,
    removeCharacter,
    activeLabLayout,
    mobileEditorTab,
    coordinateHint,
    scopeKey = '',
    freeformPosition = false,
    positionImage,
    positionSize,
    showCharacterReference = false,
    canSaveCharacter = false,
    onSaveCharacter,
    onCopyPrompt,
    notify,
    bare = false,
}) => {
  useLanguage();
    const runtime = useNaiRuntime();
    const maxCharacters = getRuntimeNaiModelInfo(params.model, runtime).maxCharacters;
    const legacyNegatives = (params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives;
    const actionSlots = useRef(new Map<string, React.RefObject<HTMLSpanElement | null>>());
    const actionSlot = (key: string) => {
        if (!actionSlots.current.has(key)) actionSlots.current.set(key, React.createRef<HTMLSpanElement>());
        return actionSlots.current.get(key)!;
    };
    const [positionOpen, setPositionOpen] = useState(false);
    const [activeCharacterId, setActiveCharacterId] = useState('');
    const [openNegativeIds, setOpenNegativeIds] = useState<Record<string, boolean>>({});
    const [saveTarget, setSaveTarget] = useState<CharacterParams | null>(null);
    const [libraryCharacterId, setLibraryCharacterId] = useState('');
    const [taggerCharacterId, setTaggerCharacterId] = useState('');
    const [characterName, setCharacterName] = useState('');
    const [editingNameId, setEditingNameId] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    const [savingCharacter, setSavingCharacter] = useState(false);
    // 换模式／换串时收起取用与反推浮层，避免把旧角色的结果带回新上下文。
    useEffect(() => { setLibraryCharacterId(''); setTaggerCharacterId(''); }, [scopeKey]);
    // 与分类编辑一致：页头网格切换，一次只编辑当前角色；空选／删后落到仍存在的槽，避免排序后漂到别的角色。
    const resolvedCharacterId = characters.some(item => item.id === activeCharacterId) ? activeCharacterId : characters[0]?.id || '';
    const shownCharacterIndex = characters.length ? Math.max(0, characters.findIndex(item => item.id === resolvedCharacterId)) : -1;
    const characterLabel = (item: CharacterParams, index: number) => item.name || t('角色 {0}', [index + 1]);
    const characterCount = useRef(characters.length);
    useEffect(() => {
        if (characters.length > characterCount.current) setActiveCharacterId(characters[characters.length - 1].id);
        else if (characters.length && !characters.some(item => item.id === activeCharacterId)) setActiveCharacterId(characters[0].id);
        characterCount.current = characters.length;
    }, [characters, activeCharacterId]);
    const actionDialogRef = useModalA11y<HTMLDivElement>(Boolean(saveTarget));
    useEffect(() => {
        if (!saveTarget) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !savingCharacter && isTopmostModal(actionDialogRef.current)) setSaveTarget(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [saveTarget, savingCharacter, actionDialogRef]);
    const saveCharacter = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!saveTarget || !onSaveCharacter || !characterName.trim() || savingCharacter) return;
        setSavingCharacter(true);
        try {
            await onSaveCharacter(saveTarget, characterName.trim());
            setSaveTarget(null);
            setCharacterName('');
        } catch (error) {
            notify?.(error instanceof Error ? error.message : '保存角色失败', 'error');
        } finally {
            setSavingCharacter(false);
        }
    };
    const negativeLocked = isNaiMediumModel(params.model);
    const handleReorder = (fromIndex: number, toIndex: number) => {
        if (!canEdit) return;
        const next = reorderCharacter(characters, fromIndex, toIndex);
        if (next === characters) return;
        setParams({ ...params, characters: next });
        markChange();
    };
    const copyText = (value: string, label: string) => {
        if (onCopyPrompt) { onCopyPrompt(value, label); return; }
        void navigator.clipboard?.writeText(value);
        notify?.(`${label}已复制`, 'success');
    };
    const openLibrary = (id: string) => setLibraryCharacterId(id);
    const openTagger = (id: string) => setTaggerCharacterId(id);
    const libraryIndex = characters.findIndex(item => item.id === libraryCharacterId);
    const libraryTarget = libraryIndex >= 0 ? { character: characters[libraryIndex], index: libraryIndex, compiled: compileCharacterContent(characters[libraryIndex], legacyNegatives) } : null;
    const taggerIndex = characters.findIndex(item => item.id === taggerCharacterId);
    const taggerTarget = taggerIndex >= 0 ? { character: characters[taggerIndex], index: taggerIndex } : null;

    const innerContent = (
        <section className={mobileEditorTab === 'character' ? 'block' : 'hidden'}>
            <PresetSourceBadges sources={characterPresetSources} />
            <CharacterSlotHeader
                characters={characters}
                activeCharacterId={resolvedCharacterId}
                onSelectCharacter={setActiveCharacterId}
                canEdit={canEdit}
                useCoords={params.useCoords === true}
                onUseCoordsChange={useCoords => {
                    setParams({ ...params, useCoords });
                    markPresetSectionModified('settings');
                    markChange();
                }}
                positionOpen={positionOpen}
                onTogglePosition={() => setPositionOpen(open => !open)}
                coordinateHint={coordinateHint}
                onAddCharacter={addCharacter}
                maxCharacters={maxCharacters}
                onReorderCharacters={handleReorder}
            />

            {positionOpen && <CharacterPositionStage key={scopeKey} characters={characters} freeform={freeformPosition}
                width={positionSize?.width || params.width} height={positionSize?.height || params.height} image={positionImage}
                canEdit={canEdit} useCoords={params.useCoords === true} onPosition={(index, position) => {
                    // 同一次更新写入手动开关与位置，避免两个草稿更新互相覆盖。
                    updateCharacter(index, position, true);
                    markPresetSectionModified('settings');
                }} />}
            <div className="min-w-0">
                {(characters || []).length === 0 && (
                    <div className="py-6 text-center text-xs text-gray-400">{t('暂无角色，点击上方添加')}</div>
                )}
                {(characters || []).map((char, idx) => {
                    if (idx !== shownCharacterIndex) return null;
                    const positiveSlotRef = actionSlot(`${scopeKey}:${char.id}:positive`);
                    const negativeSlotRef = actionSlot(`${scopeKey}:${char.id}:negative`);
                    const compiled = compileCharacterContent(char, legacyNegatives);
                    const hasNegativeContent = Boolean(compiled.negativePrompt?.trim());
                    const negativeOpen = openNegativeIds[char.id] ?? hasNegativeContent;
                    const enabled = char.enabled !== false;
                    const labelText = characterLabel(char, idx);

                    const negativeField = (
                        <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
                            <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
                                <button
                                    type="button"
                                    aria-expanded={negativeOpen}
                                    onClick={() => setOpenNegativeIds(prev => ({ ...prev, [char.id]: !negativeOpen }))}
                                    className="mobile-touch -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-micro font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                                >
                                    {negativeOpen
                                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                        : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                                    <span>{t('角色负面提示词（选填）')}</span>
                                </button>
                                {negativeOpen && <span ref={negativeSlotRef} />}
                            </div>
                            {negativeOpen && (
                                <TagAutocompleteTextarea
                                    aria-label={t('角色负面提示词')}
                                    clearActionSlotRef={negativeSlotRef}
                                    libraryField={{ roleId: char.id, negative: true }}
                                    promptLibraryActions={false}
                                    onCopy={val => copyText(val, `${labelText}负面提示词`)}
                                    copyTitle={t('复制角色负面提示词')}
                                    tagAssistEnabled={tagAssistEnabled && !negativeLocked}
                                    disabled={!canEdit || negativeLocked}
                                    value={compiled.negativePrompt || ''}
                                    onValueChange={(nextValue) => {
                                        setOpenNegativeIds(prev => prev[char.id] === undefined ? { ...prev, [char.id]: true } : prev);
                                        updateCharacter(idx, {
                                            prompt: compiled.prompt, negativePrompt: nextValue,
                                            sections: undefined, sectionNegatives: undefined, sectionMeta: legacyNegatives || hasCharacterSections(char) ? Object.fromEntries(getCharacterSectionKeys(char).map(key => [key, { source: 'manual' }])) : char.sectionMeta,
                                        });
                                    }}
                                    className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-14 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                                    placeholder=""
                                />
                            )}
                        </div>
                    );

                    return (
                        <div key={`${scopeKey}:${char.id}`} className="lab-character relative min-w-0">
                            <div className="character-card-header mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={enabled}
                                        aria-label={t('启用角色 {0}', [idx + 1])}
                                        title={enabled ? t('点击停用此角色') : t('点击启用此角色')}
                                        disabled={!canEdit}
                                        onClick={() => updateCharacter(idx, { enabled: !enabled })}
                                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d8bf2] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? 'bg-[#0d8bf2]' : 'bg-gray-300 dark:bg-gray-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                                    </button>
                                    {editingNameId === char.id
                                        ? <input autoFocus aria-label={t('角色名称')} value={nameDraft} onChange={event => setNameDraft(event.target.value)} onBlur={() => { updateCharacter(idx, { name: nameDraft.trim() || undefined }); setEditingNameId(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); updateCharacter(idx, { name: nameDraft.trim() || undefined }); setEditingNameId(''); } else if (event.key === 'Escape') setEditingNameId(''); }} className="h-6 w-28 rounded border border-gray-300 bg-white px-1.5 text-xs dark:border-gray-600 dark:bg-gray-800" />
                                        : <button type="button" disabled={!canEdit} title={t('修改角色名称')} onClick={() => { setEditingNameId(char.id); setNameDraft(char.name || ''); }} className={`min-w-0 max-w-44 truncate rounded px-1 py-0.5 text-left font-semibold hover:bg-gray-100 disabled:opacity-100 dark:hover:bg-gray-800 ${enabled ? '' : 'text-gray-400 line-through dark:text-gray-500'}`}>{labelText}</button>}
                                    {!enabled && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-micro font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">{t('已停用')}</span>}
                                </div>
                                <div className="character-tools ml-auto flex shrink-0 items-center gap-1">
                                    {showCharacterReference && (
                                        <IconButton label={t('从角色库取用')} title={t('从角色库取用')} tone="ghost" disabled={!canEdit} onClick={() => openLibrary(char.id)}>
                                            <UserRoundSearch className="h-4 w-4" aria-hidden="true" />
                                        </IconButton>
                                    )}
                                    {canSaveCharacter && onSaveCharacter && (
                                        <IconButton label={t('收录到角色库')} title={t('收录到角色库')} tone="ghost" disabled={(!char.prompt.trim() && !hasCharacterSections(char)) || savingCharacter} onClick={() => { setCharacterName(''); setSaveTarget(char); }}>
                                            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
                                        </IconButton>
                                    )}
                                    {canEdit && (
                                        <>
                                            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />
                                            <IconButton
                                                label={t('删除角色')}
                                                title={t('删除当前角色')}
                                                tone="ghost"
                                                onClick={() => removeCharacter(idx)}
                                                className="hover:bg-red-50! hover:text-red-600! dark:hover:bg-red-950/40! dark:hover:text-red-400!"
                                            >
                                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                            </IconButton>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="min-w-0 space-y-2.5">
                                <div>
                                    <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
                                        <label className="text-micro text-gray-500 font-bold">{t('角色提示词')}</label>
                                        <span ref={positiveSlotRef} />
                                    </div>
                                    <TagAutocompleteTextarea
                                        aria-label={t('角色提示词')}
                                        clearActionSlotRef={positiveSlotRef}
                                        libraryField={{ roleId: char.id }}
                                        promptLibraryActions={false}
                                        reverseTag={{ onReverse: () => openTagger(char.id) }}
                                        onCopy={val => copyText(val, `${labelText}提示词`)}
                                        copyTitle={t('复制角色提示词')}
                                        tagAssistEnabled={tagAssistEnabled}
                                        disabled={!canEdit}
                                        value={compiled.prompt}
                                        onValueChange={(nextValue) => updateCharacter(idx, {
                                            prompt: nextValue, negativePrompt: compiled.negativePrompt,
                                            sections: undefined, sectionNegatives: undefined, sectionMeta: legacyNegatives || hasCharacterSections(char) ? Object.fromEntries(getCharacterSectionKeys(char).map(key => [key, { source: 'manual' }])) : char.sectionMeta,
                                        })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-20 focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder=""
                                    />
                                </div>
                                {negativeField}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );

    return (<>
    {bare ? (
        <div
            data-lab-module="characters"
            className={`lab-module-section appearance-reading-surface appearance-card appearance-group min-w-0 rounded-xl border border-gray-200 bg-white/70 p-4 shadow-sm transition-all dark:border-gray-800 dark:bg-gray-900/60 ${mobileEditorTab === 'character' ? 'block' : 'hidden'}`}
        >
            {innerContent}
        </div>
    ) : (
        <LabModuleSection
            moduleId="characters"
            label={t('角色专属提示词')}
            defaultCollapsed={Boolean(activeLabLayout.collapsed.characters)}
            className={mobileEditorTab === 'character' ? 'block' : 'hidden'}
        >
            {innerContent}
        </LabModuleSection>
    )}
    {saveTarget && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !savingCharacter) setSaveTarget(null); }}>
        <div ref={actionDialogRef} role="dialog" aria-modal="true" aria-label={t("收录到角色库")} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <form onSubmit={event => void saveCharacter(event)}>
                <h2 className="text-base font-bold">{t("收录到角色库")}</h2>
                <label className="mt-4 block text-xs font-semibold text-gray-500">{t("角色名称")}<input autoFocus value={characterName} disabled={savingCharacter} onChange={event => setCharacterName(event.target.value)} placeholder={t("输入角色名称")} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={savingCharacter} onClick={() => setSaveTarget(null)} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t("取消")}</button><button type="submit" disabled={!characterName.trim() || savingCharacter} className="mobile-touch rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{savingCharacter ? t("正在保存…") : t("保存")}</button></div>
            </form>
        </div>
    </div></ImagePreviewPortal>}
    {libraryTarget && <PromptLibraryChooser value={libraryTarget.compiled.prompt} onText={text => updateCharacter(libraryTarget.index, {
        prompt: text, sections: undefined, sectionNegatives: undefined,
        sectionMeta: legacyNegatives || hasCharacterSections(libraryTarget.character) ? Object.fromEntries(getCharacterSectionKeys(libraryTarget.character).map(key => [key, { source: 'manual' }])) : libraryTarget.character.sectionMeta,
    })} field={{ roleId: libraryTarget.character.id, lockedSection: 'saved', targetScope: 'character' }} whole onClose={() => setLibraryCharacterId('')}
        headerActions={<PromptLibraryRandomButton roleId={libraryTarget.character.id} purposes={LAB_SUBJECT_PURPOSES} disabled={!canEdit} fallback={canEdit && onContentRollForRole ? () => onContentRollForRole(libraryTarget.index) : undefined} />} />}
    {taggerTarget && <ImagePreviewPortal><ImageTaggerPanel contextual open hideSendToLab onClose={() => setTaggerCharacterId('')} notify={notify ?? (() => {})} actionLabel={t('追加 {count} 个 Tag 到此角色')}
        onInsert={tags => { updateCharacter(taggerTarget.index, { prompt: mergePromptFields(taggerTarget.character.prompt, tags) }); setTaggerCharacterId(''); }} /></ImagePreviewPortal>}
    </>);
};
