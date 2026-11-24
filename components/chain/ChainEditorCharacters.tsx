import { type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, LayoutGrid, MapPin, Plus, Save, Trash2 } from 'lucide-react';
import { CHAR_TOOL_ACTIVE, CHAR_TOOL_CHIP, CHAR_TOOL_DANGER, CHAR_TOOL_NEUTRAL, CHAR_TOOL_PRIMARY } from './characterToolChips';
import { CharacterParams, NAIParams, PromptChain } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import type { PromptTidyOptions } from '../PromptTidyActions';
import { PromptLibraryChooser, PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { PresetSection, PresetSource, PresetSourceBadges } from './PresetSourceBadges';
import { mergePromptFields } from '../../services/promptUtils';
import { ImageTaggerPanel } from '../ImageTaggerPanel';
import { compileCharacterContent, getCharacterSectionKeys, hasCharacterSections, moveCharacter } from '../../services/characterPrompts';
import { CharacterPositionStage } from './CharacterPositionStage';
import { isNaiMediumModel } from '../../services/naiModels';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { IconButton } from '../DesignSystem';

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
    sample?: PromptTidyOptions['sample'];
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
    notify,
    sample,
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
    const [saveTarget, setSaveTarget] = useState<CharacterParams | null>(null);
    const [libraryCharacterId, setLibraryCharacterId] = useState('');
    const [taggerCharacterId, setTaggerCharacterId] = useState('');
    const [characterName, setCharacterName] = useState('');
    const [editingNameId, setEditingNameId] = useState('');
    const [nameDraft, setNameDraft] = useState('');
    const [savingCharacter, setSavingCharacter] = useState(false);
    // 换模式／换串时收起取用与反推浮层，避免把旧角色的结果带回新上下文。
    useEffect(() => { setLibraryCharacterId(''); setTaggerCharacterId(''); }, [scopeKey]);
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
    const actionDialogRef = useModalA11y<HTMLDivElement>(Boolean(saveTarget));
    useEffect(() => {
        if (!saveTarget) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !savingCharacter && isTopmostModal(actionDialogRef.current)) setSaveTarget(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [saveTarget, savingCharacter]);
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
    const reorder = (index: number, direction: -1 | 1) => {
        if (!canEdit) return;
        setParams({ ...params, characters: moveCharacter(characters, index, direction) });
        markChange();
    };
    const openLibrary = (id: string) => setLibraryCharacterId(id);
    const openTagger = (id: string) => setTaggerCharacterId(id);
    const libraryIndex = characters.findIndex(item => item.id === libraryCharacterId);
    const libraryTarget = libraryIndex >= 0 ? { character: characters[libraryIndex], index: libraryIndex, compiled: compileCharacterContent(characters[libraryIndex], legacyNegatives) } : null;
    const taggerIndex = characters.findIndex(item => item.id === taggerCharacterId);
    const taggerTarget = taggerIndex >= 0 ? { character: characters[taggerIndex], index: taggerIndex } : null;
    return (<>
    <LabModuleSection
        moduleId="characters"
        label={t('角色专属提示词')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.characters)}
        className={mobileEditorTab === 'character' ? 'block' : 'hidden'}
    >
        <section className={mobileEditorTab === 'character' ? 'block' : 'hidden'}>
            {/* 模块标题已在 LabModuleSection：左构图工具、右槽位操作，同款芯片只差色相；可见文案与可访问名一致。 */}
            <div className="mb-3 flex min-w-0 flex-col gap-2">
                <PresetSourceBadges sources={characterPresetSources} />
                <div className="flex min-w-0 flex-nowrap items-center justify-between gap-1.5">
                    {characters.length > 0 ? (
                        <div role="group" aria-label={t('角色构图')} className="flex min-w-0 flex-nowrap items-center gap-1.5">
                            <button type="button" disabled={!characters.length} aria-label={t('角色定位')} aria-expanded={positionOpen} title={coordinateHint} onClick={() => setPositionOpen(!positionOpen)}
                                className={`${CHAR_TOOL_CHIP} ${positionOpen ? CHAR_TOOL_ACTIVE : CHAR_TOOL_NEUTRAL}`}>
                                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t('定位')}
                            </button>
                            <button
                                type="button"
                                disabled={!canEdit}
                                aria-label={t('自动构图')}
                                aria-pressed={params.useCoords !== true}
                                title={t('自动构图')}
                                onClick={() => {
                                    // 按下＝自动构图（useCoords 关闭）；再点改为手动定位。
                                    setParams({ ...params, useCoords: params.useCoords !== true });
                                    markPresetSectionModified('settings');
                                    markChange();
                                }}
                                className={`${CHAR_TOOL_CHIP} ${params.useCoords !== true ? CHAR_TOOL_ACTIVE : CHAR_TOOL_NEUTRAL} disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />{t('自动构图')}
                            </button>
                        </div>
                    ) : <span className="min-w-0 flex-1" />}
                    {canEdit && (
                        <div role="group" aria-label={t('角色槽位')} className="ml-auto flex shrink-0 items-center gap-1.5">
                            {characters.length > 0 && shownCharacterIndex >= 0 && (
                                <button type="button" aria-label={t('删除角色')} title={t('删除角色')} onClick={() => removeCharacter(shownCharacterIndex)}
                                    className={`${CHAR_TOOL_CHIP} ${CHAR_TOOL_DANGER}`}>
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('删除')}
                                </button>
                            )}
                            <button type="button" aria-label={t('添加角色')} title={t('添加角色')} onClick={addCharacter}
                                className={`${CHAR_TOOL_CHIP} ${CHAR_TOOL_PRIMARY}`}>
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('添加')}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {characters.length > 0 && <div role="group" aria-label={t('角色切换')} className="mb-3 flex flex-wrap items-center gap-1.5">
                {characters.map((character, index) => <button key={character.id} type="button" aria-pressed={index === shownCharacterIndex} onClick={() => setActiveCharacterId(character.id)} className={`mobile-touch inline-flex h-11 max-w-full items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition ${index === shownCharacterIndex ? CHAR_TOOL_ACTIVE : CHAR_TOOL_NEUTRAL}`}><span className="max-w-40 truncate">{characterLabel(character, index)}</span>{character.enabled === false && <span className="text-gray-400">{t('· 已停用')}</span>}</button>)}
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
                                {showCharacterReference && <IconButton label={t('从库取用')} tone="ghost" disabled={!canEdit} onClick={() => openLibrary(char.id)}><BookOpen className="h-4 w-4" aria-hidden="true" /></IconButton>}
                                {canSaveCharacter && onSaveCharacter && <IconButton label={t('保存到角色库')} tone="ghost" disabled={(!char.prompt.trim() && !hasCharacterSections(char)) || savingCharacter} onClick={() => { setCharacterName(''); setSaveTarget(char); }}><Save className="h-4 w-4" aria-hidden="true" /></IconButton>}
                                <IconButton label={t('上移角色 {0}', [idx + 1])} tone="ghost" disabled={!canEdit || idx === 0} onClick={() => reorder(idx, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></IconButton>
                                <IconButton label={t('下移角色 {0}', [idx + 1])} tone="ghost" disabled={!canEdit || idx === characters.length - 1} onClick={() => reorder(idx, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></IconButton>
                            </div>
                        </div>
                        <div className="min-w-0 space-y-2">
                                <div>
                                    <div className="mb-1 flex items-center justify-between gap-2"><label className="text-micro text-gray-500 font-bold">{t('角色提示词')}</label><span ref={positiveSlotRef} /></div>
                                    <TagAutocompleteTextarea
                                        clearActionSlotRef={positiveSlotRef}
                                        libraryField={{ roleId: char.id }}
                                        promptLibraryActions="save"
                                        promptTidy={notify ? { notify, sample } : undefined}
                                        reverseTag={{ onReverse: () => openTagger(char.id) }}
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
    {saveTarget && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !savingCharacter) setSaveTarget(null); }}>
        <div ref={actionDialogRef} role="dialog" aria-modal="true" aria-label={t("保存到角色库")} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <form onSubmit={event => void saveCharacter(event)}>
                <h2 className="text-base font-bold">{t("保存到角色库")}</h2>
                <label className="mt-4 block text-xs font-semibold text-gray-500">{t("角色名称")}<input autoFocus value={characterName} disabled={savingCharacter} onChange={event => setCharacterName(event.target.value)} placeholder={t("输入角色名称")} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={savingCharacter} onClick={() => setSaveTarget(null)} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t("取消")}</button><button type="submit" disabled={!characterName.trim() || savingCharacter} className="mobile-touch rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{savingCharacter ? t("正在保存…") : t("保存")}</button></div>
            </form>
        </div>
    </div></ImagePreviewPortal>}
    {libraryTarget && <PromptLibraryChooser value={libraryTarget.compiled.prompt} onText={text => updateCharacter(libraryTarget.index, {
        prompt: text, sections: undefined, sectionNegatives: undefined,
        sectionMeta: legacyNegatives || hasCharacterSections(libraryTarget.character) ? Object.fromEntries(getCharacterSectionKeys(libraryTarget.character).map(key => [key, { source: 'manual' }])) : libraryTarget.character.sectionMeta,
    })} field={{ roleId: libraryTarget.character.id }} whole onClose={() => setLibraryCharacterId('')}
        headerActions={<PromptLibraryRandomButton roleId={libraryTarget.character.id} purposes={SUBJECT_PURPOSES} disabled={!canEdit} fallback={canEdit && onContentRollForRole ? () => onContentRollForRole(libraryTarget.index) : undefined} />} />}
    {taggerTarget && <ImagePreviewPortal><ImageTaggerPanel contextual open hideSendToLab onClose={() => setTaggerCharacterId('')} notify={notify ?? (() => {})} actionLabel={t('追加 {count} 个 Tag 到此角色')}
        onInsert={tags => { updateCharacter(taggerTarget.index, { prompt: mergePromptFields(taggerTarget.character.prompt, tags) }); setTaggerCharacterId(''); }} /></ImagePreviewPortal>}
    </>);
};
