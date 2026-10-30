import { promptPurposeLabel, type PromptPurposeId } from '../../services/promptPurposes.mjs';
import { t, useLanguage } from '../../services/i18n';
import React, { useState } from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryFieldActions, PromptLibraryRandomButton } from '../PromptLibraryAccess';
import { PromptCopyButton } from './PresetSourceBadges';
import type { CharacterParams, NAIParams, PromptSectionSource, PromptSections } from '../../types';
import {
  PICTURE_ZONES, addCharacterFacet, addCustomZone, addPictureFacet, customSectionId, movePictureZone, pictureExtra,
  pinPictureZone, pinnedPictureZones, readCharacterBoard, readLabSectionLayout, readPictureBoard, removeCharacterFacet,
  removeCustomZone, removePictureFacet, subjectFromSections, unpinPictureZone, writeSectionNegative, writeSectionText,
  type LabFacetView, type LabSectionLayout, type LabZoneView,
} from '../../services/labSections';
import { createUuid } from '../../services/id';

const fieldClass = 'w-full resize-y rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-sm font-normal leading-relaxed text-gray-900 outline-none focus:ring-1 focus:ring-[var(--nai-accent)] dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100';

export type LabCategoryTab = 'style' | 'character' | 'reference' | 'params' | 'add' | string;

export function labCategoryTabOptions(sections: PromptSections | null | undefined, layout: LabSectionLayout | null | undefined, references: boolean): [string, string][] {
  const zones = pinnedPictureZones(sections, layout);
  return [
    ['style', '全局'],
    ['character', '角色'],
    ...zones.map(zone => [zone.id, zone.label] as [string, string]),
    ...(references ? [['reference', '参考'] as [string, string]] : []),
    ['params', '参数'],
    ['add', '添加'],
  ];
}

function ZoneMenu({ label, children }: { label: string; children: React.ReactNode }) {
  useLanguage();
  return <details className="relative">
    <summary aria-label={label} className="mobile-touch flex h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-xs text-gray-500 [&::-webkit-details-marker]:hidden"><MoreHorizontal className="h-4 w-4" />{t('更多')}</summary>
    <div className="absolute right-0 z-20 mt-1 w-52 rounded-[var(--workspace-card-radius)] border border-[var(--nai-panel-border)] bg-[var(--nai-panel-solid-surface)] p-1 shadow-[var(--nai-panel-shadow)]">{children}</div>
  </details>;
}

function FacetField({ facet, disabled, tagAssist, negativeLocked, roleId, onText, onNegative, onRemove }: {
  facet: LabFacetView; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean; roleId?: string;
  onText: (value: string, source?: PromptSectionSource) => void; onNegative: (value: string) => void; onRemove?: () => void;
}) {
  useLanguage();
  const [negativeOpen, setNegativeOpen] = useState(Boolean(facet.negative.trim()));
  const purposes = facet.purposeId ? [facet.purposeId] as const : undefined;
  return <div role="group" aria-label={t(facet.label)} className="flex min-w-0 flex-col gap-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">{t(facet.label)}{facet.sourceName ? <span className="ml-1 font-normal text-gray-400">{t('来源：{0}', [facet.sourceName])}</span> : null}</span>
      <ZoneMenu label={t('{0} 的更多操作', [t(facet.label)])}>
        {purposes && <PromptLibraryRandomButton purposes={purposes} roleId={roleId} variant="menu" disabled={disabled} />}
        <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => setNegativeOpen(open => !open)}>{t(negativeOpen ? '收起内容负面' : '内容负面')}</button>
        <div className="px-1"><PromptLibraryFieldActions value={facet.text} disabled={disabled} field={{ purposeId: facet.purposeId, roleId }} onText={onText} /></div>
        {onRemove && <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={onRemove}>{t('移除栏位')}</button>}
      </ZoneMenu>
    </div>
    <TagAutocompleteTextarea aria-label={t(facet.label)} libraryField={{ purposeId: facet.purposeId, roleId }} tagAssistEnabled={tagAssist} disabled={disabled} value={facet.text} onValueChange={onText} placeholder={t(facet.label)} className={`${fieldClass} min-h-24`} />
    {negativeOpen && <TagAutocompleteTextarea aria-label={t('{0} 内容负面', [t(facet.label)])} libraryField={{ purposeId: facet.purposeId, roleId, negative: true }} tagAssistEnabled={tagAssist && !negativeLocked} disabled={disabled || negativeLocked} value={facet.negative} onValueChange={onNegative} placeholder={t('内容负面')} className={`${fieldClass} min-h-16 text-xs`} />}
  </div>;
}

function StructureSummary({ base, negative, sections, layout, characters }: { base: string; negative: string; sections?: PromptSections | null; layout?: LabSectionLayout | null; characters: CharacterParams[] }) {
  useLanguage();
  const zones = pinnedPictureZones(sections, layout).filter(zone => zone.facets.some(facet => facet.text.trim()));
  const parts = [base.trim() ? t('画风') : '', characters.some(character => character.prompt?.trim() || Object.values(character.sections || {}).some(value => String(value || '').trim())) ? t('角色') : '', ...zones.map(zone => t(zone.label))].filter(Boolean);
  const preview = [base.trim(), subjectFromSections(sections, layout)].filter(Boolean).join(', ');
  if (!parts.length && !negative.trim()) return null;
  return <details className="text-xs text-gray-500">
    <summary className="cursor-pointer list-none">{t('本次结构')}{parts.length ? ` · ${parts.join(' · ')}` : ''}</summary>
    {preview && <p className="mt-1 line-clamp-3 font-mono leading-relaxed">{preview}</p>}
  </details>;
}

function ZonePane({ zone, sections, layout, disabled, tagAssist, negativeLocked, onSections, onLayout }: {
  zone: LabZoneView; sections?: PromptSections | null; layout?: LabSectionLayout | null; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void;
}) {
  useLanguage();
  const stored = readLabSectionLayout(layout);
  const purposes = zone.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id));
  const write = (id: string, value: string, source?: PromptSectionSource) => onSections(writeSectionText(sections, id, value, source));
  return <section aria-label={t(zone.label)} className="lab-module-section lab-region flex flex-col gap-3 p-4 md:p-5">
    <header className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{t(zone.label)}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{t('只编辑这一页。随机这一页不会改画风。')}</p>
      </div>
      <ZoneMenu label={t('{0} 的更多操作', [t(zone.label)])}>
        {purposes.length > 0 && <PromptLibraryRandomButton purposes={purposes} variant="menu" disabled={disabled} />}
        {zone.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addPictureFacet(stored, zone.id, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
        <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(movePictureZone(stored, zone.id, -1))}>{t('上移')}</button>
        <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(movePictureZone(stored, zone.id, 1))}>{t('下移')}</button>
        {zone.removable ? <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={() => { const next = removeCustomZone(stored, sections, zone.id); onLayout(next.layout); onSections(next.sections); }}>{t('移除分区')}</button>
          : <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(unpinPictureZone(stored, zone.id))}>{t('从分页拿下')}</button>}
      </ZoneMenu>
    </header>
    <div className="grid grid-cols-1 gap-3">
      {zone.facets.map(facet => <FacetField key={facet.id} facet={facet} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} onText={(value, source) => write(facet.id, value, source)} onNegative={value => onSections(writeSectionNegative(sections, facet.id, value))} onRemove={facet.removable ? () => { const next = removePictureFacet(stored, sections, facet.id); onLayout(next.layout); onSections(next.sections); } : undefined} />)}
    </div>
  </section>;
}

export function LabCategoryMode({ tab, adding, base, negative, sections, layout, characters, disabled, tagAssist, negativeLocked, onCancelAdd, onBase, onNegative, onSections, onLayout, onCopy, onAddCharacter, onUpdateCharacter, onRemoveCharacter }: {
  tab: string; adding: boolean; base: string; negative: string; sections?: PromptSections | null; layout?: LabSectionLayout | null;
  characters: CharacterParams[]; disabled?: boolean; tagAssist: boolean; negativeLocked: boolean;
  onCancelAdd: () => void; onBase: (value: string) => void; onNegative: (value: string) => void;
  onSections: (sections: PromptSections) => void; onLayout: (layout: LabSectionLayout) => void; onCopy: (value: string, label: string) => void;
  onAddCharacter: () => void; onUpdateCharacter: (index: number, updates: Partial<CharacterParams>) => void; onRemoveCharacter: (index: number) => void;
}) {
  useLanguage();
  const stored = readLabSectionLayout(layout);
  const zones = pinnedPictureZones(sections, stored);
  const zone = zones.find(item => item.id === tab) || readPictureBoard(sections, stored).find(item => item.id === tab);
  const [name, setName] = useState('');
  const available = PICTURE_ZONES.filter(item => !zones.some(zone => zone.id === item.id));
  const addBuiltin = (id: string) => { onLayout(pinPictureZone(stored, id)); onCancelAdd(); };
  const addNamed = () => {
    const id = customSectionId(createUuid());
    const next = addCustomZone(stored, name, id);
    const zoneId = next.zones.at(-1)?.id;
    onLayout(zoneId ? pinPictureZone(next, zoneId) : next);
    setName('');
    onCancelAdd();
  };
  return <div className="flex flex-col gap-4">
    <StructureSummary base={base} negative={negative} sections={sections} layout={stored} characters={characters} />
    {adding && <form className="lab-module-section flex flex-col gap-2 p-4" onSubmit={event => { event.preventDefault(); if (name.trim()) addNamed(); }}>
      <p className="text-xs font-semibold text-gray-500">{t('添加分页')}</p>
      <div className="flex flex-wrap gap-2">{available.map(item => <button key={item.id} type="button" className="mobile-touch h-9 rounded-[var(--workspace-control-radius)] border border-[var(--nai-panel-border)] px-3 text-xs" onClick={() => addBuiltin(item.id)}>{t(item.label)}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t('分区名称')} value={name} onChange={event => setName(event.target.value)} placeholder={t('自定义分页')} className="h-10 min-w-36 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700" />
        <button type="submit" className="mobile-touch h-10 rounded-[var(--workspace-control-radius)] bg-[var(--nai-accent)] px-3 text-xs font-semibold text-[var(--nai-on-accent)]">{t('添加')}</button>
        <button type="button" className="mobile-touch h-10 px-2 text-xs text-gray-500" onClick={onCancelAdd}>{t('取消')}</button>
      </div>
    </form>}
    {tab === 'style' && <article className="lab-module-section lab-region flex flex-col gap-3 p-4 md:p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t('画风')}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('整段使用，随机搭配不会改这里。')}</p>
        </div>
        <PromptCopyButton onClick={() => onCopy(base, '画风')} title={t('复制画风')} />
      </header>
      <TagAutocompleteTextarea aria-label={t('画风')} tagAssistEnabled={tagAssist} disabled={disabled} value={base} onValueChange={onBase} placeholder={t('画师、媒介、光影与画风，整段填写')} className={`${fieldClass} min-h-32`} />
      <div className={negativeLocked ? 'nai-model-locked' : undefined}>
        <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-semibold text-gray-500">{t('画风负面')}</span><PromptCopyButton onClick={() => onCopy(negative, '画风负面')} title={t('复制画风负面')} /></div>
        <TagAutocompleteTextarea aria-label={t('画风负面')} libraryField={{ negative: true }} tagAssistEnabled={tagAssist && !negativeLocked} disabled={disabled || negativeLocked} value={negative} onValueChange={onNegative} placeholder={t('整段负面')} className={`${fieldClass} min-h-20`} />
      </div>
    </article>}
    {tab === 'character' && <section aria-label={t('角色')} className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t('角色')}</h2><button type="button" className="mobile-touch text-xs font-semibold text-[var(--nai-accent)]" onClick={onAddCharacter}>{t('+ 添加角色')}</button></div>
      {characters.length === 0 && <p className="text-xs text-gray-500">{t('还没有角色。场景和构图在各自的分页里。')}</p>}
      {characters.map((character, index) => {
        const board = readCharacterBoard(character, stored);
        return <article key={character.id} className="lab-module-section lab-region flex flex-col gap-3 p-4">
          <header className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" aria-label={t('启用角色 {0}', [index + 1])} checked={character.enabled !== false} onChange={event => onUpdateCharacter(index, { enabled: event.target.checked })} />{t('角色 {0}', [index + 1])}</label>
            <ZoneMenu label={t('角色 {0} 的更多操作', [index + 1])}>
              <PromptLibraryRandomButton roleId={character.id} purposes={board.facets.map(facet => facet.purposeId).filter((id): id is PromptPurposeId => Boolean(id))} variant="menu" disabled={disabled} />
              {board.available.map(item => <button key={item.id} type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs" onClick={() => onLayout(addCharacterFacet(stored, item.id, promptPurposeLabel(item.id as PromptPurposeId)))}>{t('添加{0}', [t(item.label)])}</button>)}
              <button type="button" className="mobile-touch flex h-9 w-full items-center rounded-lg px-2 text-left text-xs text-red-600" onClick={() => onRemoveCharacter(index)}>{t('移除角色')}</button>
            </ZoneMenu>
          </header>
          {board.facets.map(facet => <FacetField key={facet.id} facet={{ ...facet, text: String(character.sections?.[facet.id as keyof typeof character.sections] || ''), negative: (character.sectionNegatives as Record<string, string> | undefined)?.[facet.id] || '' }} roleId={character.id} tagAssist={tagAssist} negativeLocked={negativeLocked} disabled={disabled}
            onText={value => onUpdateCharacter(index, { sections: { ...character.sections, [facet.id]: value } })}
            onNegative={value => onUpdateCharacter(index, { sectionNegatives: { ...character.sectionNegatives, [facet.id]: value } })}
            onRemove={facet.removable ? () => { const next = removeCharacterFacet(stored, character, facet.id); onLayout(next.layout); onUpdateCharacter(index, next.character); } : undefined} />)}
          <label className="text-xs font-semibold text-gray-500">{t('补充')}<TagAutocompleteTextarea aria-label={t('角色 {0} 补充', [index + 1])} libraryField={{ roleId: character.id }} tagAssistEnabled={tagAssist} disabled={disabled} value={character.prompt || ''} onValueChange={value => onUpdateCharacter(index, { prompt: value })} className={`${fieldClass} mt-1 min-h-16`} /></label>
          <label className={`text-xs font-semibold text-gray-500 ${negativeLocked ? 'nai-model-locked' : ''}`}>{t('角色负面')}<TagAutocompleteTextarea aria-label={t('角色 {0} 负面', [index + 1])} libraryField={{ roleId: character.id, negative: true }} tagAssistEnabled={tagAssist && !negativeLocked} disabled={disabled || negativeLocked} value={character.negativePrompt || ''} onValueChange={value => onUpdateCharacter(index, { negativePrompt: value })} className={`${fieldClass} mt-1 min-h-16`} /></label>
        </article>;
      })}
    </section>}
    {zone && tab !== 'style' && tab !== 'character' && tab !== 'reference' && tab !== 'params' && tab !== 'add' && <ZonePane zone={zone} sections={sections} layout={stored} disabled={disabled} tagAssist={tagAssist} negativeLocked={negativeLocked} onSections={onSections} onLayout={onLayout} />}
    {pictureExtra(sections).trim() && tab !== 'style' && tab !== 'reference' && tab !== 'params' && tab !== 'add' && <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-gray-500">{t('补充')}</span>
      <TagAutocompleteTextarea aria-label={t('补充')} tagAssistEnabled={tagAssist} disabled={disabled} value={pictureExtra(sections)} onValueChange={value => onSections(writeSectionText(sections, 'extra', value))} placeholder={t('还没归进分页的画面内容')} className={`${fieldClass} min-h-16`} />
    </div>}
  </div>;
}
