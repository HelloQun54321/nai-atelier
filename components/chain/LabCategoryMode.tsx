import { promptPurposeLabel, type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, MapPin, MoreHorizontal, Save, UserRound } from 'lucide-react';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { PromptCopyButton } from './PresetSourceBadges';
import { CharacterPositionStage } from './CharacterPositionStage';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { SmartImage } from '../SmartImage';
import { ToolbarSearch } from '../DesignSystem';
import { useModalA11y } from '../useModalA11y';
import { compilePrompt } from '../../services/promptUtils';
import { hasCharacterSections } from '../../services/characterPrompts';
import type { CharacterParams, NAIParams, PromptChain, PromptSectionSource, PromptSections } from '../../types';
import {
  PICTURE_ZONES, addCharacterFacet, addCustomZone, addPictureFacet, customSectionId, movePictureZone, pictureExtra,
  pinPictureZone, pinnedPictureZones, readCharacterBoard, readLabSectionLayout, readPictureBoard, removeCharacterFacet,
  removeCustomZone, removePictureFacet, unpinPictureZone, writeSectionNegative, writeSectionText,
  type LabFacetView, type LabSectionLayout, type LabZoneView,
} from '../../services/labSections';
import { createUuid } from '../../services/id';

const fieldClass = 'lab-category-field w-full resize-y rounded-xl border border-gray-200/80 bg-transparent p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-[var(--nai-accent)] dark:border-white/10 dark:text-gray-100';
const insetClass = 'rounded-[var(--workspace-card-radius)] border border-[color-mix(in_srgb,var(--nai-panel-border)_35%,transparent)] bg-[color-mix(in_srgb,var(--nai-panel-solid-surface)_28%,transparent)] p-3';

const FACET_HINT: Record<string, string> = {
  'purpose:place': '写地点、室内或背景',
  'purpose:nature': '写天气、地貌或植物',
  'purpose:time': '写时段或季节',
  'purpose:interaction': '写谁和谁在做什么',
  'purpose:camera': '写景别和视角',
  'purpose:composition': '写人数和布局',
  'purpose:text': '写画面里的文字',
  'purpose:identity': '写身份或角色名',
  'purpose:appearance': '写发型、眼睛和体型',
  'purpose:clothing': '写衣服和配饰',
  'purpose:pose': '写动作和朝向',
  'purpose:expression': '写表情',
  scene: '这一栏原有的场景',
  camera: '这一栏原有的镜头',
};

const facetHint = (facet: LabFacetView) => FACET_HINT[facet.id] || '写这一栏的提示词';

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

export function labCategoryTabOptions(sections: PromptSections | null | undefined, layout: LabSectionLayout | null | undefined, references: boolean): [string, string][] {
  const zones = pinnedPictureZones(sections, layout);
  return [
    ['style', '全局'],
    ['character', '角色'],
    ...zones.map(zone => [zone.id, zone.label] as [string, string]),
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
    <button ref={trigger} type="button" aria-label={label} aria-expanded={open} onClick={toggle} className="mobile-touch flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-gray-500"><MoreHorizontal className="h-4 w-4" />{t('更多')}</button>
    {open && createPortal(<div ref={menu} role="menu" style={{ position: 'fixed', top: box?.top ?? 0, left: box?.left ?? 0, maxHeight: box?.maxHeight, visibility: box ? 'visible' : 'hidden' }} className="z-[80] w-52 overflow-y-auto rounded-[var(--workspace-card-radius)] border border-[var(--nai-panel-border)] bg-[var(--nai-panel-solid-surface)] p-1 shadow-[var(--nai-panel-shadow)]" onClick={() => setOpen(false)}>{children}</div>, document.body)}
  </div>;
}

function FacetField({ facet, disabled, tagAssist, negativeLocked, roleId, focused, onFocus, onText, onNegative, onRemove }: {
  facet: LabFacetView; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean; roleId?: string; focused: boolean; onFocus: () => void;
  onText: (value: string, source?: PromptSectionSource) => void; onNegative: (value: string) => void; onRemove?: () => void;
}) {
  useLanguage();
  const slot = useRef<HTMLSpanElement>(null);
  const [negativeOpen, setNegativeOpen] = useState(Boolean(facet.negative.trim()));
  const purposes = facet.purposeId ? [facet.purposeId] as const : undefined;
  return <div role="group" aria-label={t(facet.label)} className={`lab-category-zone group/zone ${insetClass} flex min-w-0 flex-col gap-1.5`} onFocus={() => onFocus()}>
    <div className="flex min-h-8 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{t(facet.label)}{facet.sourceName ? <span className="ml-1 text-xs font-normal text-gray-500">{t('来源：{0}', [facet.sourceName])}</span> : null}</span>
      <span ref={slot} className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within/zone:opacity-100 group-hover/zone:opacity-100" />
      <button type="button" className="text-xs text-gray-400 opacity-0 group-focus-within/zone:opacity-100 group-hover/zone:opacity-100" onClick={() => setNegativeOpen(open => !open)}>{t(negativeOpen ? '收起负面' : '负面')}</button>
      {onRemove && <button type="button" className="text-xs text-gray-400 opacity-0 group-focus-within/zone:opacity-100 group-hover/zone:opacity-100" onClick={onRemove}>{t('移除')}</button>}
    </div>
    <TagAutocompleteTextarea aria-label={t(facet.label)} clearActionSlotRef={slot} libraryField={{ purposeId: facet.purposeId, roleId }} tagAssistEnabled={tagAssist} showTranslations={focused} disabled={disabled} value={facet.text} onValueChange={onText} onFocus={onFocus} placeholder={t(facetHint(facet))} className={`${fieldClass} min-h-16`} />
    {purposes && focused && <PromptLibraryRandomButton purposes={purposes} roleId={roleId} variant="menu" disabled={disabled} />}
    {negativeOpen && <TagAutocompleteTextarea aria-label={t('{0} 的负面', [t(facet.label)])} libraryField={{ purposeId: facet.purposeId, roleId, negative: true }} tagAssistEnabled={tagAssist && !negativeLocked} showTranslations={focused} disabled={disabled || negativeLocked} value={facet.negative} onValueChange={onNegative} onFocus={onFocus} placeholder={t('这一栏不想要的内容，可选')} className={`${fieldClass} min-h-14 text-xs`} />}
  </div>;
}

function ZonePane({ zone, sections, layout, disabled, tagAssist, negativeLocked, focusedId, onFocus, onSections, onLayout }: {
  zone: LabZoneView; sections?: PromptSections | null; layout?: LabSectionLayout | null; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  focusedId: string; onFocus: (id: string) => void;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void;
}) {
  useLanguage();
  const stored = readLabSectionLayout(layout);
  const purposes = zone.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id));
  const write = (id: string, value: string, source?: PromptSectionSource) => onSections(writeSectionText(sections, id, value, source));
  return <section aria-label={t(zone.label)} className="lab-module-section lab-region relative z-0 flex flex-col gap-4 p-4 md:p-5">
    <header className="relative z-30 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{t(zone.label)}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{t('只编辑这一页。随机这一页不会改画风。')}</p>
      </div>
      <RegionMenu label={t('{0} 的更多操作', [t(zone.label)])} onOpen={() => onFocus('')}>
        {purposes.length > 0 && <PromptLibraryRandomButton purposes={purposes} variant="menu" disabled={disabled} />}
        {zone.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addPictureFacet(stored, zone.id, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
        <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(movePictureZone(stored, zone.id, -1))}>{t('上移')}</button>
        <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(movePictureZone(stored, zone.id, 1))}>{t('下移')}</button>
        {zone.removable ? <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={() => { const next = removeCustomZone(stored, sections, zone.id); onLayout(next.layout); onSections(next.sections); }}>{t('移除分区')}</button>
          : <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(unpinPictureZone(stored, zone.id))}>{t('从分页拿下')}</button>}
      </RegionMenu>
    </header>
    <div className="flex flex-col gap-2">
      {zone.facets.map(facet => <FacetField key={facet.id} facet={facet} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} focused={focusedId === facet.id} onFocus={() => onFocus(facet.id)} onText={(value, source) => write(facet.id, value, source)} onNegative={value => onSections(writeSectionNegative(sections, facet.id, value))} onRemove={facet.removable ? () => { const next = removePictureFacet(stored, sections, facet.id); onLayout(next.layout); onSections(next.sections); } : undefined} />)}
    </div>
  </section>;
}

function CharacterLibraryDialog({ action, chains, chainsLoading, chainsError, onRetryChains, onSaveCharacter, onClose, onApply }: {
  action: { kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number };
  chains: PromptChain[]; chainsLoading?: boolean; chainsError?: string; onRetryChains?: () => void;
  onSaveCharacter?: (character: CharacterParams, name: string) => Promise<void>;
  onClose: () => void;
  onApply: (index: number, character: Pick<CharacterParams, 'prompt' | 'negativePrompt'>) => void;
}) {
  useLanguage();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useModalA11y<HTMLDivElement>(true);
  const characters = chains.filter(item => item.type === 'character');
  const needle = query.trim().toLocaleLowerCase();
  const shown = characters.filter(item => !needle || [item.name, item.description, item.basePrompt, item.negativePrompt, ...(item.tags || [])].join(' ').toLocaleLowerCase().includes(needle));
  return <ImagePreviewPortal><div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(action.kind === 'save' ? '保存到角色库' : '选择角色库角色')} className="appearance-panel ui-modal-enter max-h-[min(80dvh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
      {action.kind === 'save' ? <form onSubmit={event => { event.preventDefault(); if (!onSaveCharacter || !name.trim() || saving) return; setSaving(true); void onSaveCharacter(action.character, name.trim()).then(onClose).finally(() => setSaving(false)); }}>
        <h2 className="text-base font-bold">{t('保存到角色库')}</h2>
        <label className="mt-4 block text-xs font-semibold text-gray-500">{t('角色名称')}<input autoFocus value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder={t('输入角色名称')} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="mobile-touch rounded-xl px-4 text-sm text-gray-500">{t('取消')}</button><button type="submit" disabled={!name.trim() || saving} className="mobile-touch rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-40">{saving ? t('正在保存…') : t('保存')}</button></div>
      </form> : <>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold">{t('选择角色库角色')}</h2><button type="button" onClick={onClose} className="mobile-touch rounded px-2 py-1 text-gray-500">{t('关闭')}</button></div>
        <ToolbarSearch autoFocus aria-label={t('搜索角色库角色')} placeholder={t('搜索角色名称、标签或提示词')} value={query} onChange={event => setQuery(event.target.value)} containerClassName="mb-3 md:max-w-none!" />
        <div className="space-y-2">{shown.map(item => <button key={item.id} type="button" onClick={() => { onApply(action.index, { prompt: compilePrompt(item, item.variableValues?.subject || ''), negativePrompt: item.negativePrompt || '' }); onClose(); }} className="mobile-touch flex w-full items-center gap-3 rounded-xl border border-gray-200 p-2 text-left hover:border-indigo-400 dark:border-gray-700 dark:hover:border-indigo-500">
          {item.previewImage ? <SmartImage src={item.previewImage} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" /> : <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800"><UserRound className="h-5 w-5" /></span>}
          <span className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="block truncate text-xs text-gray-500">{compilePrompt(item, item.variableValues?.subject || '')}</span></span>
        </button>)}</div>
        {chainsLoading && <p role="status" className="py-4 text-center text-sm text-gray-500">{t('加载中…')}</p>}
        {!chainsLoading && chainsError && <div role="alert" className="flex items-center justify-center gap-3 py-4 text-sm text-red-600">{t(chainsError)}{onRetryChains && <button type="button" onClick={onRetryChains} className="mobile-touch rounded border border-current px-3 py-1">{t('重试')}</button>}</div>}
        {!chainsLoading && !chainsError && characters.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t('角色库中暂无自定义角色')}</p>}
        {!chainsLoading && !chainsError && characters.length > 0 && shown.length === 0 && <p className="py-10 text-center text-sm text-gray-500">{t('没有匹配的角色')}</p>}
      </>}
    </div>
  </div></ImagePreviewPortal>;
}

export function LabCategoryMode({ tab, adding, base, negative, sections, layout, characters, disabled, tagAssist, negativeLocked, onCancelAdd, onBase, onNegative, onSections, onLayout, onCopy, onAddCharacter, onUpdateCharacter, onRemoveCharacter, characterTools }: {
  tab: string; adding: boolean; base: string; negative: string; sections?: PromptSections | null; layout?: LabSectionLayout | null;
  characters: CharacterParams[]; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  onCancelAdd: () => void; onBase: (value: string) => void; onNegative: (value: string) => void;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void; onCopy: (value: string, label: string) => void;
  onAddCharacter: () => void; onUpdateCharacter: (index: number, updates: Partial<CharacterParams>) => void; onRemoveCharacter: (index: number) => void;
  characterTools?: LabCategoryCharacterTools;
}) {
  useLanguage();
  const formId = useId();
  const stored = readLabSectionLayout(layout);
  const zones = pinnedPictureZones(sections, stored);
  const zone = zones.find(item => item.id === tab) || readPictureBoard(sections, stored).find(item => item.id === tab);
  const [name, setName] = useState('');
  const [focusedId, setFocusedId] = useState('');
  const [styleFocus, setStyleFocus] = useState<'positive' | 'negative' | ''>('');
  const [positionOpen, setPositionOpen] = useState(false);
  const [libraryAction, setLibraryAction] = useState<{ kind: 'save'; character: CharacterParams } | { kind: 'reference'; index: number } | null>(null);
  const available = PICTURE_ZONES.filter(item => !zones.some(current => current.id === item.id));
  const addBuiltin = (id: string) => { onLayout(pinPictureZone(stored, id)); onCancelAdd(); };
  const addNamed = () => {
    const id = customSectionId(createUuid());
    const next = addCustomZone(stored, name, id);
    const zoneId = next.zones.at(-1)?.id;
    onLayout(zoneId ? pinPictureZone(next, zoneId) : next);
    setName('');
    onCancelAdd();
  };
  const openReference = (index: number) => setLibraryAction({ kind: 'reference', index });
  return <div className="lab-category-mode flex flex-col gap-4 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0">
    {adding && <form id={formId} className="lab-module-section lab-region flex flex-col gap-3 p-4" onSubmit={event => { event.preventDefault(); if (name.trim()) addNamed(); }}>
      <h2 className="text-sm font-semibold">{t('添加分页')}</h2>
      <div className="flex flex-wrap gap-2">{available.map(item => <button key={item.id} type="button" className="mobile-touch h-9 rounded-[var(--workspace-control-radius)] border border-[var(--nai-panel-border)] px-3 text-xs" onClick={() => addBuiltin(item.id)}>{t(item.label)}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t('分区名称')} value={name} onChange={event => setName(event.target.value)} placeholder={t('自定义分页，例如夜景')} className="h-10 min-w-36 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700" />
        <button type="submit" className="mobile-touch h-10 rounded-[var(--workspace-control-radius)] bg-[var(--nai-accent)] px-3 text-xs font-semibold text-[var(--nai-on-accent)]">{t('添加')}</button>
        <button type="button" className="mobile-touch h-10 px-2 text-xs text-gray-500" onClick={onCancelAdd}>{t('取消')}</button>
      </div>
    </form>}
    {tab === 'style' && <article className="lab-module-section lab-region flex flex-col gap-3 p-4 md:p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t('画风')}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('整段使用，随机搭配不会改这里。')}</p>
        </div>
        <PromptCopyButton onClick={() => onCopy(base, '画风')} title={t('复制画风')} />
      </header>
      <TagAutocompleteTextarea aria-label={t('画风')} tagAssistEnabled={tagAssist} showTranslations={styleFocus === 'positive'} disabled={disabled} value={base} onValueChange={onBase} onFocus={() => setStyleFocus('positive')} placeholder={t('画师、媒介、光影，整段填写')} className={`${fieldClass} min-h-32`} />
      <div className={negativeLocked ? 'nai-model-locked' : undefined}>
        <div className="mb-1.5 flex items-center justify-between"><span className="text-xs text-gray-500">{t('画风负面（可选）')}</span><PromptCopyButton onClick={() => onCopy(negative, '画风负面')} title={t('复制画风负面')} /></div>
        <TagAutocompleteTextarea aria-label={t('画风负面（可选）')} libraryField={{ negative: true }} tagAssistEnabled={tagAssist && !negativeLocked} showTranslations={styleFocus === 'negative'} disabled={disabled || negativeLocked} value={negative} onValueChange={onNegative} onFocus={() => setStyleFocus('negative')} placeholder={t('不想要的画风，可以留空')} className={`${fieldClass} min-h-20`} />
      </div>
    </article>}
    {tab === 'character' && <section aria-label={t('角色')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('角色')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {characterTools && <button type="button" disabled={!characters.length} aria-expanded={positionOpen} onClick={() => setPositionOpen(open => !open)} className="appearance-group mobile-touch flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"><MapPin className="h-3.5 w-3.5" />{t('角色定位')}</button>}
          {characterTools && <button type="button" className="mobile-touch flex h-9 items-center gap-1 rounded-[var(--workspace-control-radius)] border border-[var(--nai-panel-border)] px-3 text-xs font-semibold" onClick={() => openReference(-1)}><UserRound className="h-3.5 w-3.5" />{t('从角色库引用')}</button>}
          <button type="button" className="mobile-touch h-9 rounded-[var(--workspace-control-radius)] bg-[var(--nai-accent)] px-3 text-xs font-semibold text-[var(--nai-on-accent)]" onClick={onAddCharacter}>{t('添加角色')}</button>
        </div>
      </div>
      {characterTools && positionOpen && <CharacterPositionStage characters={characters} freeform={Boolean(characterTools.freeformPosition)} width={characterTools.params.width} height={characterTools.params.height} canEdit={!disabled} useCoords={characterTools.params.useCoords === true} onPosition={(index, position) => { characterTools.setParams({ ...characterTools.params, useCoords: true, characters: (characterTools.params.characters || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...position } : item) }); characterTools.onSettingsChange?.(); }} />}
      {characters.length === 0 && <article className="lab-module-section lab-region flex flex-col items-start gap-3 p-5">
        <h3 className="text-sm font-semibold">{t('还没有角色')}</h3>
        <p className="text-xs text-gray-500">{t('外貌、服饰和动作写在角色页。场景和构图用各自的分页。')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="mobile-touch h-10 rounded-[var(--workspace-control-radius)] bg-[var(--nai-accent)] px-4 text-sm font-semibold text-[var(--nai-on-accent)]" onClick={onAddCharacter}>{t('添加角色')}</button>
          {characterTools && <button type="button" className="mobile-touch flex h-10 items-center gap-1 rounded-[var(--workspace-control-radius)] border border-[var(--nai-panel-border)] px-4 text-sm font-semibold" onClick={() => openReference(-1)}><UserRound className="h-4 w-4" />{t('从角色库引用')}</button>}
        </div>
      </article>}
      {characters.map((character, index) => {
        const board = readCharacterBoard(character, stored);
        return <article key={character.id} className="lab-module-section lab-region flex flex-col gap-3 p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" aria-label={t('启用角色 {0}', [index + 1])} checked={character.enabled !== false} onChange={event => onUpdateCharacter(index, { enabled: event.target.checked })} />{t('角色 {0}', [index + 1])}</label>
            <div className="flex flex-wrap items-center gap-1">
              {characterTools?.onSaveCharacter && <button type="button" aria-label={t('保存到角色库')} title={t('保存到角色库')} disabled={!character.prompt.trim() && !hasCharacterSections(character)} onClick={() => setLibraryAction({ kind: 'save', character })} className="mobile-touch inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-25 dark:hover:bg-emerald-950/30"><Save className="h-4 w-4" />{t('保存到角色库')}</button>}
              <RegionMenu label={t('角色 {0} 的更多操作', [index + 1])} onOpen={() => setFocusedId('')}>
                {characterTools && <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => openReference(index)}>{t('从角色库引用')}</button>}
                <PromptLibraryRandomButton roleId={character.id} purposes={board.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id))} variant="menu" disabled={disabled} />
                {board.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addCharacterFacet(stored, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
                <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={() => onRemoveCharacter(index)}>{t('移除角色')}</button>
              </RegionMenu>
            </div>
          </header>
          <div className="flex flex-col gap-2">
            {board.facets.map(facet => <FacetField key={facet.id} facet={{ ...facet, text: String(character.sections?.[facet.id as keyof typeof character.sections] || ''), negative: (character.sectionNegatives as Record<string, string> | undefined)?.[facet.id] || '' }} roleId={character.id} tagAssist={tagAssist} negativeLocked={negativeLocked} disabled={disabled} focused={focusedId === `${character.id}:${facet.id}`} onFocus={() => setFocusedId(`${character.id}:${facet.id}`)}
              onText={value => onUpdateCharacter(index, { sections: { ...character.sections, [facet.id]: value } })}
              onNegative={value => onUpdateCharacter(index, { sectionNegatives: { ...character.sectionNegatives, [facet.id]: value } })}
              onRemove={facet.removable ? () => { const next = removeCharacterFacet(stored, character, facet.id); onLayout(next.layout); onUpdateCharacter(index, next.character); } : undefined} />)}
          </div>
          <div className={insetClass}>
            <span className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100">{t('补充')}</span>
            <TagAutocompleteTextarea aria-label={t('角色 {0} 补充', [index + 1])} libraryField={{ roleId: character.id }} tagAssistEnabled={tagAssist} showTranslations={focusedId === `${character.id}:extra`} disabled={disabled} value={character.prompt || ''} onValueChange={value => onUpdateCharacter(index, { prompt: value })} onFocus={() => setFocusedId(`${character.id}:extra`)} placeholder={t('还没归进上面各栏的角色内容')} className={`${fieldClass} min-h-16`} />
          </div>
        </article>;
      })}
      {libraryAction && characterTools && <CharacterLibraryDialog action={libraryAction} chains={characterTools.chains} chainsLoading={characterTools.chainsLoading} chainsError={characterTools.chainsError} onRetryChains={characterTools.onRetryChains} onSaveCharacter={characterTools.onSaveCharacter} onClose={() => setLibraryAction(null)} onApply={(index, next) => {
        if (index < 0) characterTools.setParams({ ...characterTools.params, characters: [...(characterTools.params.characters || []), { id: createUuid(), prompt: next.prompt, negativePrompt: next.negativePrompt, x: 0.5, y: 0.5 }] });
        else onUpdateCharacter(index, { ...next, sections: undefined, sectionNegatives: undefined, sectionMeta: undefined });
      }} />}
    </section>}
    {zone && tab !== 'style' && tab !== 'character' && tab !== 'reference' && tab !== 'params' && <ZonePane zone={zone} sections={sections} layout={stored} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} focusedId={focusedId} onFocus={setFocusedId} onSections={onSections} onLayout={onLayout} />}
    {pictureExtra(sections).trim() && tab !== 'style' && tab !== 'reference' && tab !== 'params' && tab !== 'character' && <div className={insetClass}>
      <span className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100">{t('补充')}</span>
      <TagAutocompleteTextarea aria-label={t('补充')} tagAssistEnabled={tagAssist} showTranslations={focusedId === 'extra'} disabled={disabled} value={pictureExtra(sections)} onValueChange={value => onSections(writeSectionText(sections, 'extra', value))} onFocus={() => setFocusedId('extra')} placeholder={t('还没归进分页的画面内容')} className={`${fieldClass} min-h-16`} />
    </div>}
  </div>;
}
