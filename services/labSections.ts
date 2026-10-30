import { PROMPT_PURPOSES, isCustomSectionKey, isPurposeSectionKey, promptPurposeLabel, type PromptPurposeId } from './promptPurposes.mjs';
import { getGlobalPromptSectionKeys, mergePromptFields } from './promptUtils';
import type { CharacterParams, PromptSectionSource, PromptSections } from '../types';

/**
 * 分类编辑的栏位模型。
 *
 * 全局画风是一整段（basePrompt + 全局负面），不进入栏位，随机搭配也不能改它。
 * 画面与角色使用内置分区，并允许追加分区和栏位。正文仍写入既有
 * `_promptSections` / `character.sections`，按原有固定顺序并进 NovelAI 请求，
 * 因此旧稿不会因为界面分组而被换序。
 */

export const STYLE_SECTION_KEYS = ['purpose:style', 'purpose:artist', 'purpose:texture', 'purpose:effect', 'purpose:quality', 'purpose:lighting', 'purpose:color'] as const;

export const isStyleSectionKey = (key: string): boolean => (STYLE_SECTION_KEYS as readonly string[]).includes(key);

export interface LabZoneDefinition {
  id: string;
  label: string;
  defaults: readonly string[];
  optional: readonly string[];
}

export const PICTURE_ZONES: readonly LabZoneDefinition[] = [
  { id: 'subject', label: '主体', defaults: ['purpose:identity', 'purpose:appearance', 'purpose:clothing'], optional: ['purpose:creature', 'purpose:object', 'purpose:vehicle'] },
  { id: 'scene', label: '场景', defaults: ['purpose:place', 'purpose:nature'], optional: ['purpose:time', 'purpose:interaction'] },
  { id: 'frame', label: '构图与镜头', defaults: ['purpose:composition', 'purpose:camera'], optional: ['purpose:text'] },
];

export const CHARACTER_ZONE: LabZoneDefinition = {
  id: 'character',
  label: '这个角色',
  defaults: ['purpose:identity', 'purpose:appearance', 'purpose:clothing', 'purpose:pose', 'purpose:expression'],
  optional: ['purpose:creature', 'purpose:object', 'purpose:vehicle'],
};

const LEGACY_PICTURE: Record<string, { zoneId: string; label: string }> = {
  appearance: { zoneId: 'subject', label: '外貌（原有）' },
  wardrobe: { zoneId: 'subject', label: '服饰（原有）' },
  pose: { zoneId: 'subject', label: '动作（原有）' },
  scene: { zoneId: 'scene', label: '场景（原有）' },
  camera: { zoneId: 'frame', label: '镜头（原有）' },
  presentation: { zoneId: 'frame', label: '呈现形式' },
};

const LEGACY_CHARACTER: Record<string, string> = {
  appearance: '外貌（原有）',
  wardrobe: '服饰（原有）',
  pose: '动作（原有）',
  expression: '表情（原有）',
};

export interface LabLayoutZone { id: string; label: string }
export interface LabLayoutFacet { id: string; zoneId: string; label: string }
export interface LabSectionLayout {
  zones: LabLayoutZone[];
  facets: LabLayoutFacet[];
  characterFacets: LabLayoutFacet[];
  /** 大区的显示与（在 visual 时）送入顺序。缺省用内置顺序。 */
  zoneOrder?: string[];
  /** 用户添加到分页里的画面分区。空分区不占用分页，除非在这里。 */
  pinnedZones?: string[];
  /** legacy 沿用旧栏固定顺序，避免只打开分类就改写已有稿。visual 按界面顺序拼接。 */
  assembly?: 'legacy' | 'visual';
}

export interface LabFacetView {
  id: string;
  label: string;
  builtin: boolean;
  removable: boolean;
  purposeId?: PromptPurposeId;
  text: string;
  negative: string;
  sourceName?: string;
}

export interface LabZoneView {
  id: string;
  label: string;
  builtin: boolean;
  removable: boolean;
  facets: LabFacetView[];
  /** 还能加进这个分区的内置栏。 */
  available: { id: string; label: string }[];
}

const EMPTY_LAYOUT: LabSectionLayout = { zones: [], facets: [], characterFacets: [] };
const MAX_ZONES = 8;
const MAX_FACETS = 24;
const LABEL_LIMIT = 24;

const text = (value: unknown) => String(value ?? '');
const cleanLabel = (value: unknown, fallback: string) => {
  const label = text(value).trim().slice(0, LABEL_LIMIT);
  return label || fallback;
};
const isZoneId = (id: string) => PICTURE_ZONES.some(zone => zone.id === id) || /^zone:[\w-]{1,80}$/.test(id);
const purposeOf = (id: string): PromptPurposeId | undefined => {
  if (!isPurposeSectionKey(id) || isStyleSectionKey(id)) return undefined;
  const purpose = id.slice(8) as PromptPurposeId;
  return PROMPT_PURPOSES.some(item => item.id === purpose) ? purpose : undefined;
};
const facetLabel = (id: string, stored?: string) => stored?.trim() || (purposeOf(id) ? promptPurposeLabel(purposeOf(id)!) : LEGACY_PICTURE[id]?.label || LEGACY_CHARACTER[id] || id.replace(/^custom:/, ''));

const sectionText = (sections: PromptSections | null | undefined, id: string) => text((sections as Record<string, unknown> | null | undefined)?.[id]);
const sectionNegative = (sections: PromptSections | null | undefined, id: string) => text(sections?.sectionNegatives?.[id]);
const hasFacetContent = (sections: PromptSections | null | undefined, id: string) => Boolean(sectionText(sections, id).trim() || sectionNegative(sections, id).trim());

export const readLabSectionLayout = (value: unknown): LabSectionLayout => {
  const source = value && typeof value === 'object' ? value as Partial<LabSectionLayout> : {};
  const zones: LabLayoutZone[] = [];
  const seenZones = new Set<string>();
  for (const zone of Array.isArray(source.zones) ? source.zones : []) {
    const id = text(zone?.id);
    if (!/^zone:[\w-]{1,80}$/.test(id) || seenZones.has(id) || zones.length >= MAX_ZONES) continue;
    seenZones.add(id);
    zones.push({ id, label: cleanLabel(zone?.label, '自定义分区') });
  }
  const takeFacets = (input: unknown, allowPicture: boolean): LabLayoutFacet[] => {
    const facets: LabLayoutFacet[] = [];
    const seen = new Set<string>();
    for (const facet of Array.isArray(input) ? input as LabLayoutFacet[] : []) {
      const id = text(facet?.id);
      const zoneId = text(facet?.zoneId);
      const builtinZone = PICTURE_ZONES.find(zone => zone.id === zoneId);
      const customZone = zones.some(zone => zone.id === zoneId);
      const character = zoneId === CHARACTER_ZONE.id;
      const allowedId = (purposeOf(id) && (builtinZone ? [...builtinZone.defaults, ...builtinZone.optional].includes(id) : character && [...CHARACTER_ZONE.defaults, ...CHARACTER_ZONE.optional].includes(id)))
        || isCustomSectionKey(id);
      if (!allowedId || seen.has(id) || facets.length >= MAX_FACETS) continue;
      if (allowPicture ? !(builtinZone || customZone) : !character) continue;
      seen.add(id);
      facets.push({ id, zoneId: allowPicture ? zoneId : CHARACTER_ZONE.id, label: cleanLabel(facet?.label, facetLabel(id)) });
    }
    return facets;
  };
  const zoneOrder = Array.isArray(source.zoneOrder)
    ? source.zoneOrder.map(id => text(id)).filter(id => PICTURE_ZONES.some(zone => zone.id === id) || zones.some(zone => zone.id === id)).slice(0, MAX_ZONES + PICTURE_ZONES.length)
    : undefined;
  return {
    zones,
    facets: takeFacets(source.facets, true),
    characterFacets: takeFacets(source.characterFacets, false),
    ...(zoneOrder?.length ? { zoneOrder } : {}),
    ...(source.assembly === 'visual' ? { assembly: 'visual' as const } : {}),
    ...(Array.isArray(source.pinnedZones) ? { pinnedZones: source.pinnedZones.map(id => text(id)).filter(id => isZoneId(id) || zones.some(zone => zone.id === id)).slice(0, MAX_ZONES + PICTURE_ZONES.length) } : {}),
  };
};

const copySections = (sections?: PromptSections | null): PromptSections => {
  const source = sections && typeof sections === 'object' ? sections : {};
  const next: PromptSections = {};
  for (const key of getGlobalPromptSectionKeys(source)) {
    if (typeof (source as Record<string, unknown>)[key] === 'string') (next as Record<string, string>)[key] = (source as Record<string, string>)[key];
  }
  if (source.sectionNegatives) next.sectionNegatives = { ...source.sectionNegatives };
  if (source.sectionMeta) next.sectionMeta = { ...source.sectionMeta };
  return next;
};

/** 把误放在栏位里的画风配方并回全局正文。纯函数，不改入参。 */
export const projectSectionedPrompt = (base: string, sections?: PromptSections | null): { base: string; sections: PromptSections } => {
  const next = copySections(sections);
  const style: string[] = [];
  const negatives = { ...(next.sectionNegatives || {}) };
  const meta = { ...(next.sectionMeta || {}) };
  for (const key of STYLE_SECTION_KEYS) {
    const value = text((next as Record<string, unknown>)[key]).trim();
    if (value) style.push(value);
    delete (next as Record<string, unknown>)[key];
    delete negatives[key];
    delete meta[key];
  }
  if (Object.keys(negatives).length) next.sectionNegatives = negatives; else delete next.sectionNegatives;
  if (Object.keys(meta).length) next.sectionMeta = meta; else delete next.sectionMeta;
  return { base: mergePromptFields(base, style.join(', ')), sections: next };
};

/** 画风栏的负面并回全局负面，避免和画面栏的内容负面混在一次编辑里。 */
export const projectSectionedNegative = (negative: string, sections?: PromptSections | null): { negative: string; sections: PromptSections } => {
  const next = copySections(sections);
  const negatives = { ...(next.sectionNegatives || {}) };
  const folded: string[] = [];
  for (const key of STYLE_SECTION_KEYS) {
    const value = text(negatives[key]).trim();
    if (value) folded.push(value);
    delete negatives[key];
  }
  if (Object.keys(negatives).length) next.sectionNegatives = negatives; else delete next.sectionNegatives;
  return { negative: mergePromptFields(negative, folded.join(', ')), sections: next };
};

const viewOf = (id: string, zoneId: string, sections: PromptSections | null | undefined, storedLabel: string | undefined, removable: boolean): LabFacetView => ({
  id,
  label: facetLabel(id, storedLabel),
  builtin: !isCustomSectionKey(id),
  removable,
  purposeId: purposeOf(id),
  text: sectionText(sections, id),
  negative: sectionNegative(sections, id),
  sourceName: sections?.sectionMeta?.[id]?.entryName,
});

const zoneAvailable = (zone: LabZoneDefinition, shown: Set<string>) =>
  zone.optional.filter(id => !shown.has(id)).map(id => ({ id, label: promptPurposeLabel(purposeOf(id)!) }));

export const readPictureBoard = (sections?: PromptSections | null, layout?: LabSectionLayout | null): LabZoneView[] => {
  const stored = layout || EMPTY_LAYOUT;
  const zones: LabZoneView[] = PICTURE_ZONES.map(zone => ({ id: zone.id, label: zone.label, builtin: true, removable: false, facets: [], available: [] }));
  for (const zone of stored.zones) zones.push({ id: zone.id, label: zone.label, builtin: false, removable: true, facets: [], available: [] });
  const library: LabFacetView[] = [];
  const shown = new Set<string>();
  const place = (id: string, zoneId: string, removable: boolean, storedLabel?: string) => {
    if (shown.has(id) || isStyleSectionKey(id)) return;
    const zone = zones.find(item => item.id === zoneId);
    if (!zone) return;
    shown.add(id);
    zone.facets.push(viewOf(id, zoneId, sections, storedLabel, removable));
  };
  for (const zone of PICTURE_ZONES) for (const id of zone.defaults) place(id, zone.id, false);
  for (const facet of stored.facets) place(facet.id, facet.zoneId, true, facet.label);
  for (const [id, meta] of Object.entries(LEGACY_PICTURE)) if (hasFacetContent(sections, id)) place(id, meta.zoneId, false, meta.label);
  for (const key of getGlobalPromptSectionKeys(sections)) {
    if (!hasFacetContent(sections, key) || shown.has(key) || key === 'extra' || isStyleSectionKey(key)) continue;
    if (key.startsWith('directory:') || isCustomSectionKey(key)) {
      if (key.startsWith('directory:')) library.push(viewOf(key, 'library', sections, sections?.sectionMeta?.[key]?.directoryPath?.join(' / ') || sections?.sectionMeta?.[key]?.directoryName, false));
      else {
        const facet = stored.facets.find(item => item.id === key);
        place(key, facet?.zoneId || zones[zones.length - 1]?.id || 'scene', true, facet?.label);
      }
    }
  }
  for (const zone of zones) {
    const definition = PICTURE_ZONES.find(item => item.id === zone.id);
    zone.available = definition ? zoneAvailable(definition, shown) : [];
  }
  if (library.length) zones.push({ id: 'library', label: '从资料带入', builtin: true, removable: false, facets: library, available: [] });
  const order = stored.zoneOrder;
  const visible = zones.filter(zone => zone.facets.length || zone.removable);
  if (!order?.length) return visible;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...visible].sort((a, b) => (rank.get(a.id) ?? 1000) - (rank.get(b.id) ?? 1000));
};

export const readCharacterBoard = (character: CharacterParams, layout?: LabSectionLayout | null): LabZoneView => {
  const stored = layout || EMPTY_LAYOUT;
  const shown = new Set<string>();
  const facets: LabFacetView[] = [];
  const asSections = { ...(character.sections || {}), sectionNegatives: character.sectionNegatives, sectionMeta: character.sectionMeta } as PromptSections;
  const add = (id: string, removable: boolean, storedLabel?: string) => {
    if (shown.has(id) || isStyleSectionKey(id)) return;
    shown.add(id);
    facets.push(viewOf(id, CHARACTER_ZONE.id, asSections, storedLabel, removable));
  };
  for (const id of CHARACTER_ZONE.defaults) add(id, false);
  for (const facet of stored.characterFacets) add(facet.id, true, facet.label);
  for (const [id, label] of Object.entries(LEGACY_CHARACTER)) {
    const sections = character.sections as Record<string, string> | undefined;
    if (text(sections?.[id]).trim() || text((character.sectionNegatives as Record<string, string> | undefined)?.[id]).trim()) add(id, false, label);
  }
  return {
    id: CHARACTER_ZONE.id,
    label: CHARACTER_ZONE.label,
    builtin: true,
    removable: false,
    facets,
    available: zoneAvailable(CHARACTER_ZONE, shown),
  };
};

export const pictureExtra = (sections?: PromptSections | null) => sectionText(sections, 'extra');

const withoutMeta = (sections: PromptSections, id: string, value: string, source?: PromptSectionSource): PromptSections => {
  const next = copySections(sections);
  (next as Record<string, string>)[id] = value;
  const meta = { ...(next.sectionMeta || {}) };
  if (value.trim()) meta[id] = source || { ...meta[id], source: meta[id]?.source || 'manual' };
  else delete meta[id];
  if (Object.keys(meta).length) next.sectionMeta = meta; else delete next.sectionMeta;
  if (!value.trim()) {
    const negatives = { ...(next.sectionNegatives || {}) };
    delete negatives[id];
    if (Object.keys(negatives).length) next.sectionNegatives = negatives; else delete next.sectionNegatives;
  }
  return next;
};

export const writeSectionText = (sections: PromptSections | null | undefined, id: string, value: string, source?: PromptSectionSource): PromptSections =>
  withoutMeta(copySections(sections), id, value, source);

export const writeSectionNegative = (sections: PromptSections | null | undefined, id: string, value: string): PromptSections => {
  const next = copySections(sections);
  const negatives = { ...(next.sectionNegatives || {}) };
  if (value.trim()) negatives[id] = value; else delete negatives[id];
  if (Object.keys(negatives).length) next.sectionNegatives = negatives; else delete next.sectionNegatives;
  return next;
};

export const addPictureFacet = (layout: LabSectionLayout | null | undefined, zoneId: string, id: string, label?: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  if (!isZoneId(zoneId) || current.facets.some(facet => facet.id === id)) return current;
  return readLabSectionLayout({ ...current, facets: [...current.facets, { id, zoneId, label: label || facetLabel(id) }] });
};

export const addCharacterFacet = (layout: LabSectionLayout | null | undefined, id: string, label?: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  if (current.characterFacets.some(facet => facet.id === id)) return current;
  return readLabSectionLayout({ ...current, characterFacets: [...current.characterFacets, { id, zoneId: CHARACTER_ZONE.id, label: label || facetLabel(id) }] });
};

export const addCustomZone = (layout: LabSectionLayout | null | undefined, label: string, facetId: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  const id = `zone:${facetId.replace(/^custom:/, '')}`;
  return readLabSectionLayout({
    ...current,
    zones: [...current.zones, { id, label: cleanLabel(label, '自定义分区') }],
    facets: [...current.facets, { id: facetId, zoneId: id, label: '补充栏' }],
  });
};

const appendExtra = (sections: PromptSections, value: string) => writeSectionText(sections, 'extra', mergePromptFields(pictureExtra(sections), value));

/** 移除自定义栏时把已写内容收进补充，不直接丢掉。 */
export const removePictureFacet = (layout: LabSectionLayout | null | undefined, sections: PromptSections | null | undefined, id: string): { layout: LabSectionLayout; sections: PromptSections } => {
  const current = readLabSectionLayout(layout);
  const nextSections = appendExtra(copySections(sections), sectionText(sections, id));
  delete (nextSections as Record<string, unknown>)[id];
  return {
    layout: readLabSectionLayout({ ...current, facets: current.facets.filter(facet => facet.id !== id) }),
    sections: writeSectionNegative(nextSections, id, ''),
  };
};

export const removeCustomZone = (layout: LabSectionLayout | null | undefined, sections: PromptSections | null | undefined, zoneId: string): { layout: LabSectionLayout; sections: PromptSections } => {
  const current = readLabSectionLayout(layout);
  let next = copySections(sections);
  for (const facet of current.facets.filter(item => item.zoneId === zoneId)) {
    next = appendExtra(next, sectionText(next, facet.id));
    delete (next as Record<string, unknown>)[facet.id];
    next = writeSectionNegative(next, facet.id, '');
  }
  return {
    layout: readLabSectionLayout({ ...current, zones: current.zones.filter(zone => zone.id !== zoneId), facets: current.facets.filter(facet => facet.zoneId !== zoneId) }),
    sections: next,
  };
};

export const removeCharacterFacet = (layout: LabSectionLayout | null | undefined, character: CharacterParams, id: string): { layout: LabSectionLayout; character: CharacterParams } => {
  const current = readLabSectionLayout(layout);
  const sections = { ...(character.sections || {}) };
  const prompt = mergePromptFields(character.prompt, text(sections[id as keyof typeof sections]));
  delete sections[id as keyof typeof sections];
  const negatives = { ...(character.sectionNegatives || {}) } as Record<string, string>;
  delete negatives[id];
  return {
    layout: readLabSectionLayout({ ...current, characterFacets: current.characterFacets.filter(facet => facet.id !== id) }),
    character: { ...character, prompt, sections, sectionNegatives: negatives },
  };
};

export const renameLayoutItem = (layout: LabSectionLayout | null | undefined, kind: 'zone' | 'facet' | 'character', id: string, label: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  if (kind === 'zone') return { ...current, zones: current.zones.map(zone => zone.id === id ? { ...zone, label: cleanLabel(label, zone.label) } : zone) };
  const key = kind === 'character' ? 'characterFacets' : 'facets';
  return { ...current, [key]: current[key].map(facet => facet.id === id ? { ...facet, label: cleanLabel(label, facet.label) } : facet) };
};

export const sectionPurposeId = purposeOf;
export const customSectionId = (uuid: string) => `custom:${uuid.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80)}`;

export const characterSectionRecord = (character: CharacterParams): PromptSections => (character.sections || {}) as PromptSections;

const legacySubject = (sections?: PromptSections | null) =>
  getGlobalPromptSectionKeys(sections).filter(key => !isStyleSectionKey(key)).map(key => sectionText(sections, key).trim()).filter(Boolean).join(', ');

/** 按界面上的分区顺序拼接画面正文。空栏跳过，画风栏不参与。 */
export const assembleVisualSubject = (sections?: PromptSections | null, layout?: LabSectionLayout | null): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  const push = (id: string) => {
    if (seen.has(id) || isStyleSectionKey(id)) return;
    seen.add(id);
    const value = sectionText(sections, id).trim();
    if (value) parts.push(value);
  };
  for (const zone of readPictureBoard(sections, layout)) for (const facet of zone.facets) push(facet.id);
  push('extra');
  for (const key of getGlobalPromptSectionKeys(sections)) push(key);
  return parts.join(', ');
};

export const subjectFromSections = (sections?: PromptSections | null, layout?: LabSectionLayout | null): string =>
  readLabSectionLayout(layout).assembly === 'visual' ? assembleVisualSubject(sections, layout) : legacySubject(sections);

/** 分类模式的分页：只列出用户添加的分区，以及已经写了内容的分区。 */
export const pinnedPictureZones = (sections?: PromptSections | null, layout?: LabSectionLayout | null): LabZoneView[] => {
  const stored = readLabSectionLayout(layout);
  const pinned = new Set(stored.pinnedZones || []);
  return readPictureBoard(sections, stored).filter(zone => pinned.has(zone.id) || zone.facets.some(facet => facet.text.trim() || facet.negative.trim()));
};

export const pinPictureZone = (layout: LabSectionLayout | null | undefined, zoneId: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  if ((current.pinnedZones || []).includes(zoneId)) return current;
  return readLabSectionLayout({ ...current, pinnedZones: [...(current.pinnedZones || []), zoneId] });
};

export const unpinPictureZone = (layout: LabSectionLayout | null | undefined, zoneId: string): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  return readLabSectionLayout({ ...current, pinnedZones: (current.pinnedZones || []).filter(id => id !== zoneId) });
};

export const movePictureZone = (layout: LabSectionLayout | null | undefined, zoneId: string, direction: -1 | 1): LabSectionLayout => {
  const current = readLabSectionLayout(layout);
  const ids = current.zoneOrder?.length
    ? [...current.zoneOrder]
    : [...PICTURE_ZONES.map(zone => zone.id), ...current.zones.map(zone => zone.id)];
  if (!ids.includes(zoneId)) ids.push(zoneId);
  const index = ids.indexOf(zoneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return current;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return { ...current, zoneOrder: ids, assembly: 'visual' };
};

/**
 * 打开分类编辑。不拆已经写在全局里的画风；已有分栏能对上就沿用，对不上的整段画面放进补充。
 */
export const enterSectionedPrompt = (base: string, subject: string, negative: string, sections?: PromptSections | null): { base: string; subject: string; negative: string; sections: PromptSections } => {
  const projected = projectSectionedPrompt(base, sections);
  const folded = projectSectionedNegative(negative, projected.sections);
  let next = folded.sections;
  const merged = legacySubject(next);
  const pending = subject.trim();
  if (!merged && pending) next = writeSectionText(next, 'extra', pending);
  else if (merged && pending && merged !== pending && !merged.includes(pending)) next = writeSectionText(next, 'extra', mergePromptFields(pictureExtra(next), pending));
  return { base: projected.base, negative: folded.negative, sections: next, subject: legacySubject(next) };
};
