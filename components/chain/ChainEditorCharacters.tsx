import { PromptClearButton } from './PresetSourceBadges';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, MapPin, Save, Trash2, UserRound } from 'lucide-react';
import { CharacterParams, NAIParams, PromptChain } from '../../types';
import { LabPageLayout } from '../../services/appearancePreferences';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PresetSection, PresetSource, PresetSourceBadges } from './PresetSourceBadges';
import { compilePrompt, mergePromptFields } from '../../services/promptUtils';
import { CharacterTaggerReference } from './CharacterTaggerReference';
import { moveCharacter, normalizeCharacterCoordinate } from '../../services/characterPrompts';
import { CharacterPositionStage } from './CharacterPositionStage';
import { isNaiMediumModel } from '../../services/naiModels';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y, isTopmostModal } from '../useModalA11y';
import { SmartImage } from '../SmartImage';

const CoordinateInput: React.FC<{ value: number; freeform: boolean; disabled: boolean; label: string; onCommit: (value: number) => void }> = ({ value, freeform, disabled, label, onCommit }) => {
  useLanguage();
    const coordinate = normalizeCharacterCoordinate(value, freeform);
    const [draft, setDraft] = useState(String(coordinate));
    useEffect(() => setDraft(String(coordinate)), [coordinate]);
    return <input type="number" step={freeform ? '0.01' : '0.2'} min={freeform ? '0' : '0.1'} max={freeform ? '1' : '0.9'}
        aria-label={t(label)} disabled={disabled} value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
            if (disabled) { setDraft(String(coordinate)); return; }
            const next = normalizeCharacterCoordinate(draft.trim() ? Number(draft) : NaN, freeform);
            setDraft(String(next)); onCommit(next);
        }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
        className="w-full rounded border bg-gray-50 p-1 text-xs disabled:opacity-40 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />;
};

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
    updateCharacter: (idx: number, updates: Partial<CharacterParams>, useCoords?: boolean) => void;
    removeCharacter: (idx: number) => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
    coordinateHint?: string;
    scopeKey?: string;
    freeformPosition?: boolean;
    positionImage?: string | null;
    positionSize?: { width: number; height: number };
    allChains?: PromptChain[];
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
    showCharacterReference = false,
    canSaveCharacter = false,
    onSaveCharacter,
    notify,
}) => {
  useLanguage();
    const [positionOpen, setPositionOpen] = useState(false);
    const [activeAction, setActiveAction] = useState<{ kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number } | null>(null);
    const [characterName, setCharacterName] = useState('');
    const [savingCharacter, setSavingCharacter] = useState(false);
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
    return (<>
    <LabModuleSection
        moduleId="characters"
        label={t("角色专属提示词")}
        order={activeLabLayout.order.indexOf('characters')}
        defaultCollapsed={Boolean(activeLabLayout.collapsed.characters)}
        className={mobileEditorTab === 'character' ? 'block' : 'hidden lg:block'}
    >
        <section className={mobileEditorTab === 'character' ? 'block' : 'hidden lg:block'}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <PresetSourceBadges sources={characterPresetSources} />
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <button type="button" disabled={!characters.length} aria-expanded={positionOpen} title={coordinateHint} onClick={() => setPositionOpen(!positionOpen)}
                        className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                        <MapPin className="h-3.5 w-3.5" />{t("角色定位")}</button>
                    <label className="flex items-center gap-1.5 cursor-pointer bg-white dark:bg-gray-700 px-2 py-1 rounded shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 border border-transparent dark:border-gray-600">
                        <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={params.useCoords !== true}
                            onChange={(e) => {
                                setParams({ ...params, useCoords: !e.target.checked });
                                markPresetSectionModified('settings');
                                markChange();
                            }}
                            className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-0"
                        />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{t("AI 自动构图")}</span>
                    </label>

                    {canEdit && (
                        <button onClick={addCharacter} className="text-xs flex items-center bg-white dark:bg-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-200">
                            {t("+ 添加角色")}</button>
                    )}
                </div>
            </div>


            {positionOpen && <CharacterPositionStage key={scopeKey} characters={characters} freeform={freeformPosition}
                width={positionSize?.width || params.width} height={positionSize?.height || params.height} image={positionImage}
                canEdit={canEdit} useCoords={params.useCoords === true} onPosition={(index, position) => {
                    // 同一次更新写入手动开关与位置，避免两个草稿更新互相覆盖。
                    updateCharacter(index, position, true);
                    markPresetSectionModified('settings');
                }} />}
            <div className="space-y-3">
                {(characters || []).length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-2">{t("暂无角色，点击上方添加")}</div>
                )}
                {(characters || []).map((char, idx) => (
                    <div key={`${scopeKey}:${char.id}`} className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700 shadow-sm relative">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                <input type="checkbox" aria-label={t("启用角色 {0}", [idx + 1])} checked={char.enabled !== false} disabled={!canEdit}
                                    onChange={event => updateCharacter(idx, { enabled: event.target.checked })} className="h-3.5 w-3.5 rounded" />
                                {t("角色 ")}{idx + 1}{char.enabled === false && <span className="text-gray-400">{t("· 已停用")}</span>}
                            </label>
                            <div className="flex items-center gap-1">
                                {canSaveCharacter && onSaveCharacter && <button type="button" aria-label={t("保存到角色库")} title={t("保存到角色库")} disabled={!char.prompt.trim() || savingCharacter} onClick={() => { setCharacterName(''); setActiveAction({ kind: 'save', character: char }); }} className="mobile-touch rounded p-1 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-25 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"><Save className="h-4 w-4" /></button>}
                                {showCharacterReference && <button type="button" aria-label={t("从角色库引用")} title={t("从角色库引用")} onClick={() => setActiveAction({ kind: 'reference', index: idx })} className="mobile-touch rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300"><UserRound className="h-4 w-4" /></button>}
                                <button type="button" title={t("上移")} aria-label={t("上移角色 {0}", [idx + 1])} disabled={!canEdit || idx === 0} onClick={() => reorder(idx, -1)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-700 dark:hover:text-gray-200"><ArrowUp className="h-4 w-4" /></button>
                                <button type="button" title={t("下移")} aria-label={t("下移角色 {0}", [idx + 1])} disabled={!canEdit || idx === characters.length - 1} onClick={() => reorder(idx, 1)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-700 dark:hover:text-gray-200"><ArrowDown className="h-4 w-4" /></button>
                                <button type="button" title={t("移除角色提示词")} aria-label={t("移除角色提示词")} disabled={!canEdit} onClick={() => removeCharacter(idx)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-25 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-3 items-start sm:flex-nowrap">
                            <div className="min-w-0 flex-1 space-y-2">
                                <div>
                                    <div className="mb-1 flex items-center justify-between gap-1"><label className="text-micro font-bold text-gray-500">{t('角色提示词')}</label><PromptClearButton title={t('清空角色 {0} 提示词', [idx+1])} disabled={!canEdit || !char.prompt.trim()} onClick={() => updateCharacter(idx,{prompt:''})} /></div>
                                    <TagAutocompleteTextarea
                                        tagAssistEnabled={tagAssistEnabled}
                                        disabled={!canEdit}
                                        value={char.prompt}
                                        onValueChange={(nextValue) => updateCharacter(idx, { prompt: nextValue })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-16 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder={t("角色提示词")}
                                    />
                                </div>
                                <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
                                    <div className="mb-1 flex items-center justify-between gap-1"><label className="text-micro font-bold text-gray-500">{t('角色负面提示词')}</label><PromptClearButton title={t('清空角色 {0} 负面提示词', [idx+1])} disabled={!canEdit || negativeLocked || !char.negativePrompt?.trim()} onClick={() => updateCharacter(idx,{negativePrompt:''})} /></div>
                                    <TagAutocompleteTextarea
                                        tagAssistEnabled={tagAssistEnabled && !negativeLocked}
                                        disabled={!canEdit || negativeLocked}
                                        value={char.negativePrompt || ''}
                                        onValueChange={(nextValue) => updateCharacter(idx, { negativePrompt: nextValue })}
                                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 h-10 resize-none focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-400"
                                        placeholder={t("选填")}
                                    />
                                </div>
                            </div>
                            <div className="order-3 grid w-full grid-cols-2 items-start gap-3 sm:order-none sm:flex sm:w-28 sm:shrink-0 sm:flex-col">
                              <div className="w-full space-y-2">
                                <div>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">{t("水平位置 (X)")}</label>
                                    <CoordinateInput label={t("角色 {0} 水平位置", [idx + 1])} value={char.x} freeform={freeformPosition}
                                        disabled={!canEdit || params.useCoords !== true || char.enabled === false} onCommit={x => updateCharacter(idx, { x })} />
                                </div>
                                <div>
                                    <label className="text-micro text-gray-500 font-bold mb-1 block">{t("垂直位置 (Y)")}</label>
                                    <CoordinateInput label={t("角色 {0} 垂直位置", [idx + 1])} value={char.y} freeform={freeformPosition}
                                        disabled={!canEdit || params.useCoords !== true || char.enabled === false} onCommit={y => updateCharacter(idx, { y })} />
                                </div>
                              </div>
                              <CharacterTaggerReference canEdit={canEdit} onAppend={tags => updateCharacter(idx, { prompt: mergePromptFields(char.prompt, tags) })} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    </LabModuleSection>
    {activeAction && <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !savingCharacter) setActiveAction(null); }}>
        <div ref={actionDialogRef} role="dialog" aria-modal="true" aria-label={t(activeAction.kind === 'save' ? "保存到角色库" : "选择角色库角色")} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            {activeAction.kind === 'save' ? <form onSubmit={event => void saveCharacter(event)}>
                <h2 className="text-base font-bold">{t("保存到角色库")}</h2>
                <label className="mt-4 block text-xs font-semibold text-gray-500">{t("角色名称")}<input autoFocus value={characterName} disabled={savingCharacter} onChange={event => setCharacterName(event.target.value)} placeholder={t("输入角色名称")} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={savingCharacter} onClick={() => setActiveAction(null)} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t("取消")}</button><button type="submit" disabled={!characterName.trim() || savingCharacter} className="mobile-touch rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-40">{savingCharacter ? t("正在保存…") : t("保存")}</button></div>
            </form> : <>
                <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold">{t("选择角色库角色")}</h2><button type="button" onClick={() => setActiveAction(null)} className="mobile-touch rounded px-2 py-1 text-gray-500">{t("关闭")}</button></div>
                <div className="space-y-2">{allChains.filter(item => item.type === 'character').map(item => <button key={item.id} type="button" onClick={() => {
                    if (activeAction.kind === 'reference') updateCharacter(activeAction.index, { prompt: compilePrompt(item, item.variableValues?.subject || ''), negativePrompt: item.negativePrompt || '' });
                    setActiveAction(null);
                }} className="mobile-touch flex w-full items-center gap-3 rounded-xl border border-gray-200 p-2 text-left hover:border-indigo-400 dark:border-gray-700 dark:hover:border-indigo-500">
                    {item.previewImage ? <SmartImage src={item.previewImage} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" /> : <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><UserRound className="h-5 w-5" /></span>}
                    <span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="block truncate text-xs text-gray-500">{compilePrompt(item, item.variableValues?.subject || '')}</span></span>
                </button>)}</div>
                {allChains.every(item => item.type !== 'character') && <p className="py-10 text-center text-sm text-gray-500">{t("角色库中暂无自定义角色")}</p>}
            </>}
        </div>
    </div></ImagePreviewPortal>}
    </>);
};
