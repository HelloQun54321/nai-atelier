import { type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, MapPin, MoreHorizontal, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { CharacterParams, NAIParams, PromptChain } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { PresetSection, PresetSource, PresetSourceBadges } from './PresetSourceBadges';
import { compilePrompt, mergePromptFields } from '../../services/promptUtils';
import { CharacterTaggerReference } from './CharacterTaggerReference';
import { compileCharacterContent, getCharacterSectionKeys, hasCharacterSections, moveCharacter } from '../../services/characterPrompts';
import { CharacterPositionStage } from './CharacterPositionStage';
import { isNaiMediumModel } from '../../services/naiModels';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { SmartImage } from '../SmartImage';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from '../ToolbarPopover';
import { InlineSpinner, PageSpinner, ToolbarSearch } from '../DesignSystem';

const SUBJECT_PURPOSES: readonly PromptPurposeId[] = ['identity', 'appearance', 'clothing', 'pose', 'expression', 'creature', 'object', 'vehicle'];

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
    notify?: (message: string, type?: 'success' | 'error') => void;
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
    allChains = [],
    chainsLoading = false,
    chainsError,
    onRetryChains,
    showCharacterReference = false,
    canSaveCharacter = false,
    onSaveCharacter,
    notify,
}) => {
  useLanguage();
    const legacyNegatives = (params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives;
    const actionSlots = useRef(new Map<string, React.RefObject<HTMLSpanElement | null>>());
    const actionSlot = (key: string) => {
        if (!actionSlots.current.has(key)) actionSlots.current.set(key, React.createRef<HTMLSpanElement>());
        return actionSlots.current.get(key)!;
    };
    const [positionOpen, setPositionOpen] = useState(false);
    const [activeCharacterId, setActiveCharacterId] = useState('');
    const [activeAction, setActiveAction] = useState<{ kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number } | null>(null);
    const [characterName, setCharacterName] = useState('');
    const [editingNameId, setEditingNameId] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    const [referenceQuery, setReferenceQuery] = useState('');
    const [savingCharacter, setSavingCharacter] = useState(false);
    // 与分类编辑一致：页头横排切换，一次只编辑当前角色；空选／删后落到仍存在的槽，避免排序后漂到别的角色。
    const resolvedCharacterId = characters.some(item => item.id === activeCharacterId) ? activeCharacterId : characters[0]?.id || '';
    const shownCharacterIndex = characters.length ? Math.max(0, characters.findIndex(item => item.id === resolvedCharacterId)) : -1;
    const characterLabel = (item: CharacterParams, index: number) => item.name || t('角色 {0}', [index + 1]);
    const characterCount = useRef(characters.length);
    useEffect(() => {
        if (characters.length > characterCount.current) setActiveCharacterId(characters[characters.length - 1].id);
        else if (characters.length && !characters.some(item => item.id === activeCharacterId)) setActiveCharacterId(characters[0].id);
        characterCount.current = characters.length;
    }, [characters, activeCharacterId]);
    const actionDialogRef = useModalA11y<HTMLDivElement>(Boolean(activeAction));
    useEffect(() => {
        if (!activeAction) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !savingCharacter && isTopmostModal(actionDialogRef.current)) setActiveAction(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeAction, savingCharacter]);
    const saveCharacter = async (event: React.FormEvent) => {
        event.preventDefault();
        if (activeAction?.kind !== 'save' || !onSaveCharacter || !characterName.trim() || savingCharacter) return;
        setSavingCharacter(true);
        try {
            await onSaveCharacter(activeAction.character, characterName.trim());
            setActiveAction(null);
            setCharacterName('');
        } catch (error) {
            notify?.(error instanceof Error ? error.message : '保存角色失败', 'error');
        } finally {
            setSavingCharacter(false);
        }
    };
    const negativeLocked = isNaiMediumModel(params.model);
    const reorder = (index: number, direction: -1 | 1) => {
        if (!canEdit) return;
        setParams({ ...params, characters: moveCharacter(characters, index, direction) });
        markChange();
    };
    const openReference = (index: number) => {
        setReferenceQuery('');
        setActiveAction({ kind: 'reference', index });
    };
    const characterChains = allChains.filter(item => item.type === 'character');
    const normalizedReferenceQuery = referenceQuery.trim().toLocaleLowerCase();
    const filteredCharacterChains = characterChains.filter(item => {
        if (!normalizedReferenceQuery) return true;
        const positivePrompt = compilePrompt(item, item.variableValues?.subject || '');
        const storedCharacterPrompts = (item.params?.characters || []).flatMap(character => [character.prompt, character.negativePrompt || '']);
        return [item.name, item.description, ...(item.tags || []), positivePrompt, item.negativePrompt || '', ...storedCharacterPrompts]
            .some(value => value.toLocaleLowerCase().includes(normalizedReferenceQuery));
    });
    return (<>
    <LabModuleSection
        moduleId="characters"
        label={t('角色专属提示词')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.characters)}
        className={mobileEditorTab === 'character' ? 'block' : 'hidden'}
    >
        <section className={mobileEditorTab === 'character' ? 'block' : 'hidden'}>
            {/* 模块标题已在 LabModuleSection：定位／自动构图在左；删除当前与添加成对在右。 */}
            <div className="mb-3 flex min-w-0 flex-col gap-2">
                <PresetSourceBadges sources={characterPresetSources} />
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    {characters.length > 0 ? (
                        <div role="group" aria-label={t('角色构图')} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <button type="button" disabled={!characters.length} aria-expanded={positionOpen} title={coordinateHint} onClick={() => setPositionOpen(!positionOpen)}
                                className={`mobile-touch inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition ${positionOpen ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : 'hover:bg-black/[0.04] hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'}`}>
                                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t('角色定位')}
                            </button>
                            <label className="mobile-touch inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-black/[0.04] hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
                                <input
                                    type="checkbox"
                                    disabled={!canEdit}
                                    checked={params.useCoords !== true}
                                    onChange={(e) => {
                                        setParams({ ...params, useCoords: !e.target.checked });
                                        markPresetSectionModified('settings');
                                        markChange();
                                    }}
                                    className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-0"
                                />
                                <span className="font-medium">{t('自动构图')}</span>
                            </label>
                        </div>
                    ) : <span className="min-w-0 flex-1" />}
                    {canEdit && (
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                            {characters.length > 0 && shownCharacterIndex >= 0 && (
                                <button type="button" onClick={() => removeCharacter(shownCharacterIndex)}
                                    className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50/80 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50">
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('删除角色')}
                                </button>
                            )}
                            <button type="button" onClick={addCharacter}
                                className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50">
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('添加角色')}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {characters.length > 0 && <div role="group" aria-label={t('角色切换')} className="mb-3 flex flex-wrap items-center gap-1.5">
                {characters.map((character, index) => <button key={character.id} type="button" aria-pressed={index === shownCharacterIndex} onClick={() => setActiveCharacterId(character.id)} className={`appearance-group mobile-touch flex max-w-full items-center gap-1 rounded border px-2 py-1 text-xs ${index === shownCharacterIndex ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}><span className="max-w-40 truncate">{characterLabel(character, index)}</span>{character.enabled === false && <span className="text-gray-400">{t('· 已停用')}</span>}</button>)}
            </div>}

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
                    const taggerSlotRef = actionSlot(`${scopeKey}:${char.id}:tagger`);
                    const randomSlotRef = actionSlot(`${scopeKey}:${char.id}:random`);
                    const compiled = compileCharacterContent(char, legacyNegatives);
                    const negativeField = <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
                        <div className="mb-1 flex items-center justify-between gap-2"><label className="text-micro text-gray-500 font-bold">{t('角色负面提示词')}</label><span ref={negativeSlotRef} /></div>
                        <TagAutocompleteTextarea
                            clearActionSlotRef={negativeSlotRef}
                            libraryField={{ roleId: char.id, negative: true }}
                            tagAssistEnabled={tagAssistEnabled && !negativeLocked}
                            disabled={!canEdit || negativeLocked}
                            value={compiled.negativePrompt || ''}
                            onValueChange={(nextValue) => updateCharacter(idx, {
                                prompt: compiled.prompt, negativePrompt: nextValue,
                                sections: undefined, sectionNegatives: undefined, sectionMeta: legacyNegatives || hasCharacterSections(char) ? Object.fromEntries(getCharacterSectionKeys(char).map(key => [key, { source: 'manual' }])) : char.sectionMeta,
                            })}
                            className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-10 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                            placeholder={t('选填')}
                        />
                    </div>;
                    return (
                    <div key={`${scopeKey}:${char.id}`} className="lab-character relative min-w-0">
                        <div className="character-card-header mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                <input type="checkbox" aria-label={t('启用角色 {0}', [idx + 1])} checked={char.enabled !== false} disabled={!canEdit}
                                    onChange={event => updateCharacter(idx, { enabled: event.target.checked })} className="h-3.5 w-3.5 rounded" />
                                {editingNameId === char.id
                                    ? <input autoFocus aria-label={t('角色名称')} value={nameDraft} onChange={event => setNameDraft(event.target.value)} onBlur={() => { updateCharacter(idx, { name: nameDraft.trim() || undefined }); setEditingNameId(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); updateCharacter(idx, { name: nameDraft.trim() || undefined }); setEditingNameId(''); } else if (event.key === 'Escape') setEditingNameId(''); }} className="h-6 w-28 rounded border border-gray-300 bg-white px-1.5 text-xs dark:border-gray-600 dark:bg-gray-800" />
                                    : <button type="button" disabled={!canEdit} title={t('修改角色名称')} onClick={() => { setEditingNameId(char.id); setNameDraft(char.name || ''); }} className="min-w-0 max-w-40 truncate rounded px-1 py-0.5 text-left hover:bg-gray-100 disabled:opacity-100 dark:hover:bg-gray-800">{characterLabel(char, idx)}</button>}
                                {char.enabled === false && <span className="text-gray-400">{t("· 已停用")}</span>}
                            </div>
                            <div className="character-tools ml-auto flex flex-wrap items-center justify-end gap-1">
                                <span ref={taggerSlotRef} className="sr-only" />
                                <span ref={randomSlotRef} className="hidden" aria-hidden="true">
                                    <PromptLibraryRandomButton roleId={char.id} purposes={SUBJECT_PURPOSES} variant="icon" disabled={!canEdit} fallback={canEdit && onContentRollForRole ? () => onContentRollForRole(idx) : undefined} />
                                </span>
                                <ToolbarPopover label={t('角色 {0} 的更多操作', [idx + 1])} title={t('更多')} icon={<MoreHorizontal />} iconOnly width={240} compact>
                                    {close => <>
                                        {showCharacterReference && <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { close(); openReference(idx); }}><UserRound />{t('从角色库引用')}</button>}
                                        <button type="button" className={TOOLBAR_MENU_CLASS} disabled={!canEdit} onClick={() => { close(); taggerSlotRef.current?.querySelector('button')?.click(); }}><ClipboardPaste />{t('粘贴反推')}</button>
                                        {canSaveCharacter && onSaveCharacter && <button type="button" className={`${TOOLBAR_MENU_CLASS} disabled:opacity-40`} disabled={(!char.prompt.trim() && !hasCharacterSections(char)) || savingCharacter} onClick={() => { close(); setCharacterName(''); setActiveAction({ kind: 'save', character: char }); }}><Save />{t('保存到角色库')}</button>}
                                        <button type="button" aria-label={t('上移角色 {0}', [idx + 1])} className={`${TOOLBAR_MENU_CLASS} disabled:opacity-40`} disabled={!canEdit || idx === 0} onClick={() => { close(); reorder(idx, -1); }}><ArrowUp />{t('上移')}</button>
                                        <button type="button" aria-label={t('下移角色 {0}', [idx + 1])} className={`${TOOLBAR_MENU_CLASS} disabled:opacity-40`} disabled={!canEdit || idx === characters.length - 1} onClick={() => { close(); reorder(idx, 1); }}><ArrowDown />{t('下移')}</button>
                                    </>}
                                </ToolbarPopover>
                            </div>
                        </div>
                        <CharacterTaggerReference buttonSlotRef={taggerSlotRef} canEdit={canEdit} onAppend={tags => updateCharacter(idx, { prompt: mergePromptFields(char.prompt, tags) })} />
                        <div className="min-w-0 space-y-2">
                                <div>
                                    <div className="mb-1 flex items-center justify-between gap-2"><label className="text-micro text-gray-500 font-bold">{t('角色提示词')}</label><span ref={positiveSlotRef} /></div>
                                    <TagAutocompleteTextarea
                                        clearActionSlotRef={positiveSlotRef}
                                        libraryField={{ roleId: char.id }}
                                        tagAssistEnabled={tagAssistEnabled}
                                        disabled={!canEdit}
                                        value={compiled.prompt}
                                        onValueChange={(nextValue) => updateCharacter(idx, {
                                            prompt: nextValue, negativePrompt: compiled.negativePrompt,
                                            sections: undefined, sectionNegatives: undefined, sectionMeta: legacyNegatives || hasCharacterSections(char) ? Object.fromEntries(getCharacterSectionKeys(char).map(key => [key, { source: 'manual' }])) : char.sectionMeta,
                                        })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder={t('角色提示词')}
                                    />
                                </div>
                                {negativeField}
                        </div>
                    </div>
                    );
                })}
            </div>
        </section>
    </LabModuleSection>
    {activeAction && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !savingCharacter) setActiveAction(null); }}>
        <div ref={actionDialogRef} role="dialog" aria-modal="true" aria-label={t(activeAction.kind === 'save' ? "保存到角色库" : "从角色库引用")} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            {activeAction.kind === 'save' ? <form onSubmit={event => void saveCharacter(event)}>
                <h2 className="text-base font-bold">{t("保存到角色库")}</h2>
                <label className="mt-4 block text-xs font-semibold text-gray-500">{t("角色名称")}<input autoFocus value={characterName} disabled={savingCharacter} onChange={event => setCharacterName(event.target.value)} placeholder={t("输入角色名称")} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={savingCharacter} onClick={() => setActiveAction(null)} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t("取消")}</button><button type="submit" disabled={!characterName.trim() || savingCharacter} className="mobile-touch rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{savingCharacter ? t("正在保存…") : t("保存")}</button></div>
            </form> : <>
                <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-base font-bold">{t("从角色库引用")}</h2>
                    <button type="button" onClick={() => setActiveAction(null)} className="mobile-touch rounded px-2 py-1 text-gray-500">{t("关闭")}</button>
                </div>
                {activeAction.index >= 0 && (
                    <div className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                        <p className="mb-2 text-xs text-gray-500">{t('随机搭配是引用的一种模式，按用途抽片段写入当前角色')}</p>
                        <button type="button" disabled={!canEdit} className="mobile-touch inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200"
                            onClick={() => {
                                const index = activeAction.index;
                                const slot = actionSlot(`${scopeKey}:${characters[index]?.id}:random`);
                                slot.current?.querySelector('button')?.click();
                                setActiveAction(null);
                            }}>{t('随机搭配')}</button>
                    </div>
                )}
                <p className="mb-2 text-xs font-semibold text-gray-500">{t('点选已有角色')}</p>
                <ToolbarSearch autoFocus aria-label={t('搜索角色库角色')} placeholder={t('搜索角色名称、标签或提示词')} value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} containerClassName="mb-3 md:max-w-none!" />
                <div className="space-y-2">{filteredCharacterChains.map(item => <button key={item.id} type="button" onClick={() => {
                    if (activeAction.kind === 'reference') updateCharacter(activeAction.index, { name: item.name, prompt: compilePrompt(item, item.variableValues?.subject || ''), negativePrompt: item.negativePrompt || '', sections: undefined, sectionNegatives: undefined, sectionMeta: undefined });
                    setActiveAction(null);
                }} className="mobile-touch flex w-full items-center gap-3 rounded-xl border border-gray-200 p-2 text-left hover:border-indigo-400 dark:border-gray-700 dark:hover:border-indigo-500">
                    {item.previewImage ? <SmartImage src={item.previewImage} alt="" containerClassName="relative h-12 w-12 flex-none overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800" className="h-full w-full object-cover" /> : <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><UserRound className="h-5 w-5" /></span>}
                    <span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="block truncate text-xs text-gray-500">{compilePrompt(item, item.variableValues?.subject || '')}</span></span>
                </button>)}</div>
                {chainsLoading && (characterChains.length ? <InlineSpinner className="w-full py-4" /> : <PageSpinner fill={false} className="py-8" />)}
                {!chainsLoading && chainsError && <div role="alert" className="flex items-center justify-center gap-3 py-4 text-sm text-red-600 dark:text-red-400">{t(chainsError)}{onRetryChains && <button type="button" onClick={onRetryChains} className="mobile-touch rounded border border-current px-3 py-1">{t("重试")}</button>}</div>}
                {!chainsLoading && !chainsError && characterChains.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t("角色库中暂无自定义角色")}</p>}
                {!chainsLoading && !chainsError && characterChains.length > 0 && filteredCharacterChains.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t("没有匹配的角色")}</p>}
            </>}
        </div>
    </div></ImagePreviewPortal>}
    </>);
};
