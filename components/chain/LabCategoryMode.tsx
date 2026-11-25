import { promptPurposeLabel, type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkPlus, ChevronDown, ChevronRight, Library, MoreVertical, Trash2, UserRound, UserRoundSearch, X } from 'lucide-react';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryChooser, PromptLibraryFieldActions, PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { CharacterPositionStage } from './CharacterPositionStage';
import { CharacterSlotHeader } from './CharacterSlotHeader';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { SmartImage } from '../SmartImage';
import { IconButton, InlineSpinner, PageSpinner, ToolbarSearch } from '../DesignSystem';
import { useModalA11y } from '../useModalA11y';
import { compilePrompt } from '../../services/promptUtils';
import { characterSlotFromLibraryChain } from '../../services/promptLibraryEntries';
import { hasCharacterSections, reorderCharacter } from '../../services/characterPrompts';
import { resolveManualCharacterNamePatch } from '../../services/characterAutoName';
import { useCharacterAutoRename } from './useCharacterAutoRename';
import { getRuntimeNaiModelInfo } from '../../services/naiModels';
import { useNaiRuntime } from '../../services/naiRuntime';
import type { CharacterParams, NAIParams, PromptChain, PromptSectionSource, PromptSections } from '../../types';
import {
  addCharacterFacet, addPictureFacet, pictureExtra, readCharacterBoard, readLabSectionLayout, readPictureBoard,
  removeCharacterFacet, removeCustomZone, removePictureFacet, writeSectionNegative, writeSectionText,
  type LabFacetView, type LabSectionLayout, type LabZoneView,
} from '../../services/labSections';
import { createUuid } from '../../services/id';

const fieldClass = 'lab-category-field w-full resize-y rounded-lg border border-gray-200/80 bg-transparent p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-[var(--nai-accent)] dark:border-white/10 dark:text-gray-100';
const insetClass = 'rounded-xl border border-gray-200/80 p-3 dark:border-white/10';
/** 与普通模式的实验室模块卡片同款外观，分类页不再自己拼一套。 */
const cardClass = 'lab-module-section lab-region appearance-reading-surface appearance-card appearance-group flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white/70 p-4 shadow-sm transition-all dark:border-gray-800 dark:bg-gray-900/60';

const EXTRA_FACET = { id: 'extra', label: '补充', builtin: true, removable: false } as const;
/** 互动写全局栏，挂在角色页共用，不属于单个角色槽。 */
const INTERACTION_FACET = {
  id: 'purpose:interaction',
  label: '多人互动',
  builtin: true,
  removable: false,
  purposeId: 'interaction' as PromptPurposeId,
} as const;

export type LabCategoryTab = 'style' | 'character' | 'reference' | 'params' | string;

export interface LabCategoryCharacterTools {
  chains: PromptChain[];
  chainsLoading?: boolean;
  chainsError?: string;
  onRetryChains?: () => void;
  onSaveCharacter?: (character: CharacterParams, name: string) => Promise<void>;
  notify?: (message: string, type?: 'success' | 'error') => void;
  freeformPosition?: boolean;
  params: NAIParams;
  setParams: (params: NAIParams) => void;
  onSettingsChange?: () => void;
}

/** 分类编辑的固定分页：全局、角色、场景，参考随模型能力出现。场景不靠添加，直接在角色后面。 */
export function labCategoryTabOptions(references: boolean): [string, string][] {
  return [
    ['style', '全局'],
    ['character', '角色'],
    ['scene', '场景'],
    ...(references ? [['reference', '参考'] as [string, string]] : []),
    ['params', '参数'],
  ];
}

/** 菜单优先翻到按钮上方；上方不够且右侧有空位时改到按钮右侧。两种位置都不压住按钮下方正在编辑的栏。 */
function placeRegionMenu(anchor: DOMRect, height: number): { top: number; left: number; maxHeight: number } {
  const width = 208;
  const gap = 6;
  const margin = 8;
  const above = Math.max(0, anchor.top - margin - gap);
  const rightSpace = window.innerWidth - anchor.right - margin - gap;
  const clampLeft = (value: number) => Math.max(margin, Math.min(value, window.innerWidth - width - margin));
  const besideRight = rightSpace >= width;
  if (besideRight && above < Math.min(height, 168)) {
    const maxHeight = Math.max(112, window.innerHeight - margin * 2);
    const used = Math.min(height, maxHeight);
    return { top: Math.max(margin, Math.min(anchor.top, window.innerHeight - margin - used)), left: anchor.right + gap, maxHeight };
  }
  const maxHeight = above;
  const used = Math.min(height, maxHeight);
  return { top: anchor.top - gap - used, left: clampLeft(anchor.right - width), maxHeight };
}

function RegionMenu({ label, children, onOpen }: { label: string; children: React.ReactNode; onOpen?: () => void }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) { setBox(null); return; }
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      setBox(placeRegionMenu(anchor, menu.current?.scrollHeight || 240));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer); };
  }, [open]);
  const toggle = () => setOpen(value => {
    const next = !value;
    if (next) onOpen?.();
    return next;
  });
  return <div className="relative z-30">
    <button ref={trigger} type="button" aria-label={label} title={label} aria-expanded={open} onClick={toggle} className="mobile-touch flex h-7 w-7 items-center justify-center rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} role="menu" style={{ position: 'fixed', top: box?.top ?? 0, left: box?.left ?? 0, maxHeight: box?.maxHeight, visibility: box ? 'visible' : 'hidden' }} className="z-[80] w-52 overflow-y-auto rounded-[var(--workspace-card-radius)] border border-[var(--nai-panel-border)] bg-[var(--nai-panel-solid-surface)] p-1 shadow-[var(--nai-panel-shadow)]" onClick={() => setOpen(false)}>{children}</div>, document.body)}
  </div>;
}

function FacetField({ facet, disabled, tagAssist, negativeLocked, roleId, focused, onFocus, onText, onNegative, onCopy, onRemove }: {
  facet: LabFacetView; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean; roleId?: string; focused: boolean; onFocus: () => void;
  onText: (value: string, source?: PromptSectionSource) => void; onNegative: (value: string) => void; onCopy: (value: string, label: string) => void; onRemove?: () => void;
}) {
  useLanguage();
  const slot = useRef<HTMLSpanElement>(null);
  const negativeSlot = useRef<HTMLSpanElement>(null);
  const [negativeOpen, setNegativeOpen] = useState(Boolean(facet.negative.trim()));
  const purposes = facet.purposeId ? [facet.purposeId] as const : undefined;
  const libraryField = { purposeId: facet.purposeId, roleId, lockedSection: 'items' as const };
  return <div role="group" aria-label={t(facet.label)} className={`lab-category-zone group/zone ${insetClass} flex min-w-0 flex-col gap-1.5`} onFocus={() => onFocus()}>
    <div className="flex min-h-7 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{t(facet.label)}{facet.sourceName ? <span className="ml-1 text-xs font-normal text-gray-500">{t('来源：{0}', [facet.sourceName])}</span> : null}</span>
      <div className="flex shrink-0 items-center gap-1 text-gray-400">
        <PromptLibraryFieldActions value={facet.text} onText={value => onText(value)} field={libraryField} disabled={disabled} />
        <span ref={slot} className="flex items-center gap-1" />
        {onRemove && (
          <button
            type="button"
            aria-label={t('移除{0}', [t(facet.label)])}
            title={t('移除{0}', [t(facet.label)])}
            className="mobile-touch flex h-7 w-7 items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            onClick={onRemove}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
    <TagAutocompleteTextarea
      aria-label={t(facet.label)}
      clearActionSlotRef={slot}
      promptLibraryActions={false}
      libraryField={libraryField}
      onCopy={value => onCopy(value, t(facet.label))}
      copyTitle={t('复制{0}', [t(facet.label)])}
      tagAssistEnabled={tagAssist}
      disabled={disabled}
      value={facet.text}
      onValueChange={onText}
      onFocus={onFocus}
      placeholder=""
      className={`${fieldClass} min-h-16`}
    />
    {purposes && focused && <PromptLibraryRandomButton purposes={purposes} roleId={roleId} variant="menu" disabled={disabled} />}
    <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={negativeOpen}
          onClick={() => setNegativeOpen(open => !open)}
          className="mobile-touch -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-micro font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          {negativeOpen
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>{t('负面（选填）')}</span>
        </button>
        {negativeOpen && <span ref={negativeSlot} />}
      </div>
      {negativeOpen && (
        <TagAutocompleteTextarea
          aria-label={t('{0} 的负面', [t(facet.label)])}
          clearActionSlotRef={negativeSlot}
          promptLibraryActions={false}
          onCopy={value => onCopy(value, `${t(facet.label)} · ${t('负面')}`)}
          copyTitle={t('复制{0}负面', [t(facet.label)])}
          libraryField={{ ...libraryField, negative: true }}
          tagAssistEnabled={tagAssist && !negativeLocked}
          disabled={disabled || negativeLocked}
          value={facet.negative}
          onValueChange={onNegative}
          onFocus={onFocus}
          placeholder=""
          className={`${fieldClass} mt-1 min-h-14 text-xs`}
        />
      )}
    </div>
  </div>;
}

function ZonePane({ zone, sections, layout, disabled, tagAssist, negativeLocked, focusedId, onFocus, onSections, onLayout, onCopy, trailing }: {
  zone: LabZoneView; sections?: PromptSections | null; layout?: LabSectionLayout | null; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  focusedId: string; onFocus: (id: string) => void;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void; onCopy: (value: string, label: string) => void;
  trailing?: React.ReactNode;
}) {
  useLanguage();
  const [comboOpen, setComboOpen] = useState(false);
  const stored = readLabSectionLayout(layout);
  const purposes = zone.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id));
  const write = (id: string, value: string, source?: PromptSectionSource) => onSections(writeSectionText(sections, id, value, source));
  return <section aria-label={t(zone.label)} className={`${cardClass} relative z-0 gap-4`}>
    <header className="relative z-30 flex items-center justify-between gap-3">
      <h2 className="min-w-0 truncate text-xs font-bold text-gray-700 dark:text-gray-300">{t(zone.label)}</h2>
      <div className="flex shrink-0 items-center gap-1">
        {zone.id === 'scene' && (
          <IconButton label={t('用组合填充场景')} title={t('用组合填充场景')} tone="ghost" disabled={disabled} onClick={() => setComboOpen(true)}>
            <Library className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
        <RegionMenu label={t('{0} 的更多操作', [t(zone.label)])} onOpen={() => onFocus('')}>
          {purposes.length > 0 && <PromptLibraryRandomButton purposes={purposes} variant="menu" disabled={disabled} />}
          {zone.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addPictureFacet(stored, zone.id, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
          {zone.removable && <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={() => { const next = removeCustomZone(stored, sections, zone.id); onLayout(next.layout); onSections(next.sections); }}>{t('移除分区')}</button>}
        </RegionMenu>
      </div>
    </header>
    {comboOpen && <PromptLibraryChooser value="" onText={() => {}} field={{ lockedSection: 'saved', targetScope: 'global' }} onClose={() => setComboOpen(false)} />}
    <div className="flex flex-col gap-2">
      {zone.facets.map(facet => <FacetField key={facet.id} facet={facet} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} focused={focusedId === facet.id} onFocus={() => onFocus(facet.id)} onText={(value, source) => write(facet.id, value, source)} onNegative={value => onSections(writeSectionNegative(sections, facet.id, value))} onCopy={onCopy} onRemove={facet.removable ? () => { const next = removePictureFacet(stored, sections, facet.id); onLayout(next.layout); onSections(next.sections); } : undefined} />)}
      {trailing}
    </div>
  </section>;
}

function CharacterLibraryDialog({ action, chains, chainsLoading, chainsError, onRetryChains, onSaveCharacter, onClose, onApply, onRandom, randomDisabled }: {
  action: { kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number };
  chains: PromptChain[]; chainsLoading?: boolean; chainsError?: string; onRetryChains?: () => void;
  onSaveCharacter?: (character: CharacterParams, name: string) => Promise<void>;
  onClose: () => void;
  onApply: (index: number, character: Pick<CharacterParams, 'prompt' | 'negativePrompt' | 'name' | 'sections' | 'sectionNegatives' | 'sectionMeta'>) => void;
  onRandom?: () => void;
  randomDisabled?: boolean;
}) {
  useLanguage();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useModalA11y<HTMLDivElement>(true);
  const characters = chains.filter(item => item.type === 'character');
  const needle = query.trim().toLocaleLowerCase();
  const shown = characters.filter(item => !needle || [item.name, item.description, item.basePrompt, item.negativePrompt, ...(item.tags || [])].join(' ').toLocaleLowerCase().includes(needle));
  const showRandom = action.kind === 'reference' && action.index >= 0 && Boolean(onRandom);
  return <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(action.kind === 'save' ? '收录到角色库' : '从角色库取用')} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
      {action.kind === 'save' ? <form onSubmit={event => { event.preventDefault(); if (!onSaveCharacter || !name.trim() || saving) return; setSaving(true); void onSaveCharacter(action.character, name.trim()).then(onClose).finally(() => setSaving(false)); }}>
        <h2 className="text-base font-bold">{t('收录到角色库')}</h2>
        <label className="mt-4 block text-xs font-semibold text-gray-500">{t('角色名称')}<input autoFocus value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder={t('输入角色名称')} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t('取消')}</button><button type="submit" disabled={!name.trim() || saving} className="mobile-touch rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{saving ? t('正在保存…') : t('保存')}</button></div>
      </form> : <>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold">{t('从角色库取用')}</h2><button type="button" onClick={onClose} className="mobile-touch rounded px-2 py-1 text-gray-500">{t('关闭')}</button></div>
        {showRandom && <div className="mb-3">
          <button type="button" disabled={randomDisabled} className="mobile-touch inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200" onClick={() => { onRandom?.(); onClose(); }}>{t('随机搭配')}</button>
        </div>}
        <p className="mb-2 text-xs font-semibold text-gray-500">{t('点选已有角色')}</p>
        <ToolbarSearch autoFocus aria-label={t('搜索角色库角色')} placeholder={t('搜索角色名称、标签或提示词')} value={query} onChange={event => setQuery(event.target.value)} containerClassName="mb-3 md:max-w-none!" />
        <div className="space-y-2">{shown.map(item => <button key={item.id} type="button" onClick={() => { onApply(action.index, characterSlotFromLibraryChain(item)); onClose(); }} className="mobile-touch flex w-full items-center gap-3 rounded-xl border border-gray-200 p-2 text-left hover:border-indigo-400 dark:border-gray-700 dark:hover:border-indigo-500">
          {item.previewImage ? <SmartImage src={item.previewImage} alt="" containerClassName="relative h-12 w-12 flex-none overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800" className="h-full w-full object-cover" /> : <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><UserRound className="h-5 w-5" /></span>}
          <span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="block truncate text-xs text-gray-500">{compilePrompt(item, item.variableValues?.subject || '')}</span></span>
        </button>)}</div>
        {chainsLoading && (characters.length ? <InlineSpinner className="w-full py-4" /> : <PageSpinner fill={false} className="py-8" />)}
        {!chainsLoading && chainsError && <div role="alert" className="flex items-center justify-center gap-3 py-4 text-sm text-red-600">{t(chainsError)}{onRetryChains && <button type="button" onClick={onRetryChains} className="mobile-touch rounded border border-current px-3 py-1">{t('重试')}</button>}</div>}
        {!chainsLoading && !chainsError && characters.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t('角色库中暂无自定义角色')}</p>}
        {!chainsLoading && !chainsError && characters.length > 0 && shown.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t('没有匹配的角色')}</p>}
      </>}
    </div>
  </div></ImagePreviewPortal>;
}

export function LabCategoryMode({ tab, base, negative, sections, layout, characters, disabled, tagAssist, negativeLocked, onBase, onNegative, onSections, onLayout, onCopy, onAddCharacter, onUpdateCharacter, onRemoveCharacter, characterTools }: {
  tab: string; base: string; negative: string; sections?: PromptSections | null; layout?: LabSectionLayout | null;
  characters: CharacterParams[]; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  onBase: (value: string) => void; onNegative: (value: string) => void;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void; onCopy: (value: string, label: string) => void;
  onAddCharacter: () => void; onUpdateCharacter: (index: number, updates: Partial<CharacterParams>) => void; onRemoveCharacter: (index: number) => void;
  characterTools?: LabCategoryCharacterTools;
}) {
  useLanguage();
  const runtime = useNaiRuntime();
  const maxCharacters = characterTools ? getRuntimeNaiModelInfo(characterTools.params.model, runtime).maxCharacters : undefined;
  const stored = readLabSectionLayout(layout);
  const board = readPictureBoard(sections, stored);
  const zone = board.find(item => item.id === 'scene');
  /** 场景是固定页；主体、构图与镜头不再单独成页，写了内容的历史栏在场景页下方继续可编辑。 */
  const extras = board.filter(item => item.id !== 'scene' && (item.facets.some(facet => facet.text.trim() || facet.negative.trim()) || item.removable));
  const [focusedId, setFocusedId] = useState('');
  const [positionOpen, setPositionOpen] = useState(false);
  const [activeCharacterId, setActiveCharacterId] = useState('');
  const [editingNameId, setEditingNameId] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [libraryAction, setLibraryAction] = useState<{ kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number } | null>(null);
  const [comboRoleId, setComboRoleId] = useState('');
  const [styleNegativeOpen, setStyleNegativeOpen] = useState(() => Boolean(negative.trim()));
  const interactionHasContent = Boolean(String(sections?.['purpose:interaction'] || '').trim() || sections?.sectionNegatives?.['purpose:interaction']?.trim());
  const [interactionOpen, setInteractionOpen] = useState(interactionHasContent);
  const styleSlotRef = useRef<HTMLSpanElement>(null);
  const styleNegativeSlotRef = useRef<HTMLSpanElement>(null);
  const openReference = (index: number) => setLibraryAction({ kind: 'reference', index });
  /** 角色一次只显示一个，卡片上方用网格切换；空选／删掉后回到仍存在的槽。 */
  const resolvedCharacterId = characters.some(item => item.id === activeCharacterId) ? activeCharacterId : characters[0]?.id || '';
  const shownCharacterIndex = characters.length ? Math.max(0, characters.findIndex(item => item.id === resolvedCharacterId)) : -1;
  const characterLabel = (item: CharacterParams, index: number) => item.name || t('角色 {0}', [index + 1]);
  const commitName = (index: number) => {
    const target = characters[index];
    if (target) onUpdateCharacter(index, resolveManualCharacterNamePatch(characters, target.id, nameDraft));
    setEditingNameId('');
  };
  useCharacterAutoRename({
    characters,
    canEdit: !disabled,
    onRename: (index, patch) => onUpdateCharacter(index, patch),
  });
  const characterCount = useRef(characters.length);
  useEffect(() => {
    if (characters.length > characterCount.current) setActiveCharacterId(characters[characters.length - 1].id);
    else if (characters.length && !characters.some(item => item.id === activeCharacterId)) setActiveCharacterId(characters[0].id);
    characterCount.current = characters.length;
  }, [characters, activeCharacterId]);

  // 「参考」「参数」两页由下面的独立模块渲染，这里没有内容。
  if (tab === 'reference' || tab === 'params') return null;

  return <div className="lab-category-mode flex flex-col gap-4 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0">
    {tab === 'style' && <article className={cardClass}>
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('画风')}</h2>
        <span ref={styleSlotRef} className="flex items-center gap-1" />
      </header>
      <TagAutocompleteTextarea
        aria-label={t('画风')}
        clearActionSlotRef={styleSlotRef}
        libraryField={{ purposeId: 'style', lockedSection: 'items' }}
        promptTidy={characterTools?.notify ? { notify: characterTools.notify, hideProofread: true } : undefined}
        onCopy={val => onCopy(val, '画风')}
        copyTitle={t('复制画风')}
        tagAssistEnabled={tagAssist}
        disabled={disabled}
        value={base}
        onValueChange={onBase}
        placeholder=""
        className={`${fieldClass} min-h-32`}
      />
      <div className={negativeLocked ? 'nai-model-locked' : undefined} title={negativeLocked ? t('Medium 不支持负面提示词') : undefined}>
        <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={styleNegativeOpen}
            onClick={() => setStyleNegativeOpen(open => !open)}
            className="mobile-touch -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {styleNegativeOpen
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span>{t('画风负面（选填）')}</span>
          </button>
          {styleNegativeOpen && <span ref={styleNegativeSlotRef} />}
        </div>
        {styleNegativeOpen && (
          <TagAutocompleteTextarea
            aria-label={t('画风负面（可选）')}
            clearActionSlotRef={styleNegativeSlotRef}
            libraryField={{ purposeId: 'style', negative: true, lockedSection: 'items' }}
            onCopy={val => onCopy(val, '画风负面')}
            copyTitle={t('复制画风负面')}
            tagAssistEnabled={tagAssist && !negativeLocked}
            disabled={disabled || negativeLocked}
            value={negative}
            onValueChange={onNegative}
            placeholder=""
            className={`${fieldClass} min-h-20`}
          />
        )}
      </div>
    </article>}

    {tab === 'character' && <section aria-label={t('角色')} className="flex flex-col gap-3">
      <div className={cardClass}>
        <CharacterSlotHeader
          characters={characters}
          activeCharacterId={resolvedCharacterId}
          onSelectCharacter={setActiveCharacterId}
          canEdit={!disabled}
          showPositionControls={Boolean(characterTools)}
          useCoords={characterTools?.params.useCoords === true}
          onUseCoordsChange={useCoords => {
            if (!characterTools) return;
            characterTools.setParams({ ...characterTools.params, useCoords });
            characterTools.onSettingsChange?.();
          }}
          positionOpen={positionOpen}
          onTogglePosition={() => setPositionOpen(open => !open)}
          onAddCharacter={onAddCharacter}
          maxCharacters={maxCharacters}
          onReorderCharacters={characterTools ? (fromIndex, toIndex) => {
            const next = reorderCharacter(characters, fromIndex, toIndex);
            if (next === characters) return;
            characterTools.setParams({ ...characterTools.params, characters: next });
            characterTools.onSettingsChange?.();
          } : undefined}
          emptyExtraAction={characterTools ? (
            <button
              type="button"
              onClick={() => openReference(-1)}
              className="mobile-touch inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <UserRoundSearch className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('从角色库取用')}</span>
            </button>
          ) : undefined}
        />

        {characterTools && positionOpen && <CharacterPositionStage characters={characters} freeform={Boolean(characterTools.freeformPosition)} width={characterTools.params.width} height={characterTools.params.height} canEdit={!disabled} useCoords={characterTools.params.useCoords === true} onPosition={(index, position) => { characterTools.setParams({ ...characterTools.params, useCoords: true, characters: (characterTools.params.characters || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...position } : item) }); characterTools.onSettingsChange?.(); }} />}

        {characters.length === 0 && <div className="py-4 text-center text-xs text-gray-400">{t('暂无角色，点击上方添加')}</div>}

        {characters.map((character, index) => {
          if (index !== shownCharacterIndex) return null;
          const roleBoard = readCharacterBoard(character, stored);
          const randomPurposes = roleBoard.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id));
          const enabled = character.enabled !== false;
          const labelText = characterLabel(character, index);

          return <div key={character.id} className="min-w-0">
            <header className="character-card-header mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={t('启用角色 {0}', [index + 1])}
                  title={enabled ? t('点击停用此角色') : t('点击启用此角色')}
                  disabled={disabled}
                  onClick={() => onUpdateCharacter(index, { enabled: !enabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d8bf2] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? 'bg-[#0d8bf2]' : 'bg-gray-300 dark:bg-gray-700'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                </button>
                {editingNameId === character.id
                  ? <input autoFocus aria-label={t('角色名称')} value={nameDraft} onChange={event => setNameDraft(event.target.value)} onBlur={() => commitName(index)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitName(index); } else if (event.key === 'Escape') setEditingNameId(''); }} className="h-6 w-32 rounded border border-gray-300 bg-white px-1.5 text-xs font-normal dark:border-gray-600 dark:bg-gray-800" />
                  : <button type="button" disabled={disabled} title={t('修改角色名称')} onClick={() => { setEditingNameId(character.id); setNameDraft(character.name || ''); }} className={`min-w-0 max-w-48 truncate rounded px-1 py-0.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${enabled ? '' : 'text-gray-400 line-through dark:text-gray-500'}`}>{labelText}</button>}
                {!enabled && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-micro font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">{t('已停用')}</span>}
              </div>
              <div className="character-tools ml-auto flex shrink-0 items-center gap-1">
                {characterTools && (
                  <IconButton label={t('从角色库取用')} title={t('从角色库取用')} tone="ghost" disabled={disabled} onClick={() => openReference(index)}>
                    <UserRoundSearch className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                )}
                <IconButton label={t('用组合填充角色')} title={t('用组合填充此角色')} tone="ghost" disabled={disabled} onClick={() => setComboRoleId(character.id)}>
                  <Library className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <span data-character-random={character.id} className="inline-flex">
                  <PromptLibraryRandomButton roleId={character.id} purposes={randomPurposes} variant="icon" disabled={disabled} />
                </span>
                {characterTools?.onSaveCharacter && (
                  <IconButton label={t('收录到角色库')} title={t('收录到角色库')} tone="ghost" disabled={!character.prompt.trim() && !hasCharacterSections(character)} onClick={() => setLibraryAction({ kind: 'save', character })}>
                    <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                )}
                {roleBoard.available.length > 0 && (
                  <RegionMenu label={t('角色 {0} 的更多操作', [index + 1])} onOpen={() => setFocusedId('')}>
                    {roleBoard.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addCharacterFacet(stored, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
                  </RegionMenu>
                )}
                {!disabled && (
                  <>
                    <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />
                    <IconButton
                      label={t('删除角色')}
                      title={t('删除当前角色')}
                      tone="ghost"
                      onClick={() => onRemoveCharacter(index)}
                      className="hover:bg-red-50! hover:text-red-600! dark:hover:bg-red-950/40! dark:hover:text-red-400!"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  </>
                )}
              </div>
            </header>
            <div className="flex flex-col gap-2">
              {roleBoard.facets.map(facet => <FacetField key={facet.id} facet={{ ...facet, text: String(character.sections?.[facet.id as keyof typeof character.sections] || ''), negative: (character.sectionNegatives as Record<string, string> | undefined)?.[facet.id] || '' }} roleId={character.id} tagAssist={tagAssist} negativeLocked={negativeLocked} disabled={disabled} focused={focusedId === `${character.id}:${facet.id}`} onFocus={() => setFocusedId(`${character.id}:${facet.id}`)}
                onText={value => onUpdateCharacter(index, { sections: { ...character.sections, [facet.id]: value } })}
                onNegative={value => onUpdateCharacter(index, { sectionNegatives: { ...character.sectionNegatives, [facet.id]: value } })}
                onCopy={onCopy}
                onRemove={facet.removable ? () => { const next = removeCharacterFacet(stored, character, facet.id); onLayout(next.layout); onUpdateCharacter(index, next.character); } : undefined} />)}
              <FacetField facet={{ ...EXTRA_FACET, text: character.prompt || '', negative: character.negativePrompt || '' }} roleId={character.id} tagAssist={tagAssist} negativeLocked={negativeLocked} disabled={disabled} focused={focusedId === `${character.id}:extra`} onFocus={() => setFocusedId(`${character.id}:extra`)}
                onText={value => onUpdateCharacter(index, { prompt: value })}
                onNegative={value => onUpdateCharacter(index, { negativePrompt: value })}
                onCopy={onCopy} />
            </div>
          </div>;
        })}
      </div>

      {/* 多人互动共用栏：左对齐同位折叠 */}
      <article className={cardClass}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={interactionOpen}
            onClick={() => setInteractionOpen(open => !open)}
            className="mobile-touch -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {interactionOpen
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span>{t('多人互动（选填）')}</span>
          </button>
        </div>
        {interactionOpen && (
          <FacetField
            facet={{ ...INTERACTION_FACET, text: String(sections?.['purpose:interaction'] || ''), negative: sections?.sectionNegatives?.['purpose:interaction'] || '' }}
            tagAssist={tagAssist}
            negativeLocked={negativeLocked}
            disabled={disabled}
            focused={focusedId === 'purpose:interaction'}
            onFocus={() => setFocusedId('purpose:interaction')}
            onText={(value, source) => onSections(writeSectionText(sections, 'purpose:interaction', value, source))}
            onNegative={value => onSections(writeSectionNegative(sections, 'purpose:interaction', value))}
            onCopy={onCopy}
          />
        )}
      </article>

      {libraryAction && characterTools && <CharacterLibraryDialog action={libraryAction} chains={characterTools.chains} chainsLoading={characterTools.chainsLoading} chainsError={characterTools.chainsError} onRetryChains={characterTools.onRetryChains} onSaveCharacter={characterTools.onSaveCharacter} onClose={() => setLibraryAction(null)} onRandom={libraryAction.kind === 'reference' && libraryAction.index >= 0 ? () => {
        document.querySelector(`[data-character-random="${characters[libraryAction.index]?.id}"] button`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } : undefined} randomDisabled={disabled} onApply={(index, next) => {
        if (index < 0) {
          const id = createUuid();
          characterTools.setParams({ ...characterTools.params, characters: [...(characterTools.params.characters || []), { id, ...next, x: 0.5, y: 0.5 }] });
          setActiveCharacterId(id);
        } else onUpdateCharacter(index, next);
      }} />}
      {comboRoleId && <PromptLibraryChooser value="" onText={() => {}} field={{ roleId: comboRoleId, lockedSection: 'saved', targetScope: 'character' }} onClose={() => setComboRoleId('')} />}
    </section>}

    {!['style', 'character', 'reference', 'params'].includes(tab) && zone && <ZonePane zone={zone} sections={sections} layout={stored} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} focusedId={focusedId} onFocus={setFocusedId} onSections={onSections} onLayout={onLayout} onCopy={onCopy} trailing={
      <FacetField facet={{ ...EXTRA_FACET, text: pictureExtra(sections), negative: sections?.sectionNegatives?.extra || '' }} tagAssist={tagAssist} negativeLocked={negativeLocked} disabled={disabled} focused={focusedId === 'extra'} onFocus={() => setFocusedId('extra')}
        onText={value => onSections(writeSectionText(sections, 'extra', value))}
        onNegative={value => onSections(writeSectionNegative(sections, 'extra', value))}
        onCopy={onCopy} />
    } />}
    {!['style', 'character', 'reference', 'params'].includes(tab) && extras.map(item => <ZonePane key={item.id} zone={item} sections={sections} layout={stored} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} focusedId={focusedId} onFocus={setFocusedId} onSections={onSections} onLayout={onLayout} onCopy={onCopy} />)}
  </div>;
}
