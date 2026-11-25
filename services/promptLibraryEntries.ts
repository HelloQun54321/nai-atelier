import { getEntryPurposes, getExplicitEntryPurposes, normalizePromptPurposeId, normalizePromptPurposeSectionKey, purposeSectionKey, isCreativeSectionKey, isPurposeSectionKey, promptPurposeLabel, type PromptPurposeId } from './promptPurposes.mjs';
import { t } from './i18n';
import type { CharacterParams, CharacterSectionContent, NAIParams, PromptChain, PromptSectionSource } from '../types';
import { rollItemKey, rollSectionKey, contentRead, contentSnapshotOf, isContentRecord, isDirectorySectionKey, KINDS, META, type RollRow } from './contentRoll';
import { createUuid } from './id';
import { collectedPromptText, prepareCollectedPrompt } from './collectedPrompt';
import type { PromptLibraryKind } from './promptAgent';
import { applyPromptText, type PromptApplyMode } from './promptApply';
import { getCustomChainTags } from './chainTags';
import { isPromptLibraryFragmentEntry, getPromptLibraryDirectoryPath, getPromptLibraryEntryDirectoryIds, resolveExplicitPurposesAfterDirectoryMove, type PromptLibraryTreeState } from './promptLibraryDirectories';
import { LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY } from './promptLibraryTree.mjs';
import { compileCharacterContent, hasCharacterSections } from './characterPrompts';
import { compilePrompt } from './promptUtils';

export type PromptFragmentKind = PromptLibraryKind | 'general';
export type PromptLibrarySection = 'items' | 'saved' | 'originals';
export const isLibraryOnlyQuery = (query: string): boolean => /^@(?=[\p{L}\p{N}])/u.test(query);
export const FRAGMENT_LABELS: Record<string, string> = {
  appearance: '外貌', wardrobe: '服饰', pose: '动作', expression: '表情', scene: '场景', camera: '镜头', general: '通用', extra: '补充',
};
/** 有目录上下文时展示真实归属；旧固定分类仅用于无目录的兼容入口。 */
export function promptLibraryEntryLabel(chain: PromptChain, directories?: PromptLibraryTreeState): string {
  if (isPromptLibraryCharacterProjection(chain)) return t('自定义角色');
  const section = librarySectionOf(chain);
  if (section !== 'items') return t(section === 'saved' ? '组合' : '原文');
  if (directories) {
    const paths = getPromptLibraryEntryDirectoryIds(chain, directories).map(id => getPromptLibraryDirectoryPath(directories, id).map(node => node.name).join(' / ')).filter(Boolean);
    return paths.join('、') || t('未归类');
  }
  return t(FRAGMENT_LABELS[fragmentKindOf(chain) || 'general']);
}

/** 角色库自定义角色在组合「角色」夹中的投影来源字段（同一实体，两边入口）。 */
export const PROMPT_LIBRARY_CHARACTER_SOURCE_KEY = '_promptLibraryCharacterSourceId';

const paramsBag = (params?: NAIParams): Record<string, unknown> => (params || {}) as unknown as Record<string, unknown>;

export const isPromptLibraryCharacterProjection = (chain: PromptChain): boolean => typeof paramsBag(chain.params)[PROMPT_LIBRARY_CHARACTER_SOURCE_KEY] === 'string';

export const promptLibraryCharacterSourceId = (chain: PromptChain): string | null => {
  const value = paramsBag(chain.params)[PROMPT_LIBRARY_CHARACTER_SOURCE_KEY];
  return typeof value === 'string' && value ? value : null;
};

const isStylePurposeKey = (key: string): boolean => isPurposeSectionKey(key) && normalizePromptPurposeId(key.slice(8)) === 'style';

const mergeDistinctParts = (parts: ReadonlyArray<string | undefined>): string => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.join(', ');
};

const directoryWritebackKind = (key: string): string => {
  if (!isDirectorySectionKey(key)) return key;
  const directoryId = key.slice('directory:'.length);
  const purpose = PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY[directoryId as keyof typeof PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY];
  if (purpose) return purposeSectionKey(normalizePromptPurposeId(purpose));
  const legacy = (Object.entries(LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS) as Array<[string, string]>).find(([, id]) => id === directoryId)?.[0];
  return legacy || key;
};

/** 组合分栏写回角色库字段时的稳定落点；全局栏不写入角色本体。 */
const characterWritebackTarget = (kind: string): 'appearance' | 'wardrobe' | 'pose' | 'expression' | 'extra' | 'section' | null => {
  const key = directoryWritebackKind(normalizePromptPurposeSectionKey(rollSectionKey(kind)));
  if (key === 'extra') return 'extra';
  if (key === 'appearance' || key === purposeSectionKey('appearance')) return 'appearance';
  if (key === 'wardrobe' || key === purposeSectionKey('clothing')) return 'wardrobe';
  if (key === 'pose' || key === purposeSectionKey('pose')) return 'pose';
  if (key === 'expression' || key === purposeSectionKey('expression')) return 'expression';
  if (META[key]?.scope === 'global') return null;
  if (META[key]?.scope === 'character' || isCreativeSectionKey(key) || isDirectorySectionKey(key) || isPurposeSectionKey(key)) return 'section';
  return null;
};

const isCharacterScopedPick = (kind: string, row: RollRow): boolean => {
  if (row.scope === 'character') return true;
  if (row.scope === 'global') return false;
  return META[rollSectionKey(kind)]?.scope === 'character' || characterWritebackTarget(kind) !== null;
};

/**
 * 把组合 picks 写回自定义角色字段（同一 id，不另存副本）。
 * 封面 previewImage 由调用方原样保留；不写入组合快照，避免双事实源。
 */
export function applyCombinationPicksToCharacter(existing: PromptChain, name: string, picks: Record<string, RollRow>): Partial<PromptChain> {
  const previous = existing.params?.characters?.find(item => item.enabled !== false) || existing.params?.characters?.[0];
  const sections: CharacterSectionContent = { ...(previous?.sections || {}) };
  const sectionNegatives: NonNullable<CharacterParams['sectionNegatives']> = { ...(previous?.sectionNegatives || {}) };
  let basePrompt = String(existing.basePrompt || '');
  let negativePrompt = String(existing.negativePrompt || '');
  let extra = String(previous?.prompt || '');
  let extraNegative = String(previous?.negativePrompt || '');
  let hasAppearance = false;

  for (const [key, row] of Object.entries(picks)) {
    if (!row?.filled || !isCharacterScopedPick(key, row)) continue;
    const text = String(row.text || '').trim();
    const negative = String(row.negative || '').trim();
    if (!text && !negative) continue;
    const target = characterWritebackTarget(key);
    const sectionKey = normalizePromptPurposeSectionKey(rollSectionKey(key));
    const slotPurposeKey = target === 'appearance' ? purposeSectionKey('appearance')
      : target === 'wardrobe' ? purposeSectionKey('clothing')
        : target === 'pose' ? purposeSectionKey('pose')
          : target === 'expression' ? purposeSectionKey('expression') : '';
    if (target === 'appearance') {
      hasAppearance = true;
      if (text) { basePrompt = text; sections.appearance = text; }
      if (negative) { negativePrompt = negative; sectionNegatives.appearance = negative; }
      if (slotPurposeKey && (sectionKey.startsWith('purpose:') || Object.hasOwn(sections, slotPurposeKey))) {
        if (text) sections[slotPurposeKey as keyof CharacterSectionContent] = text;
        if (negative) sectionNegatives[slotPurposeKey as keyof CharacterSectionContent] = negative;
      }
    } else if (target === 'wardrobe' || target === 'pose' || target === 'expression') {
      if (text) sections[target] = text;
      if (negative) sectionNegatives[target] = negative;
      if (slotPurposeKey && (sectionKey.startsWith('purpose:') || Object.hasOwn(sections, slotPurposeKey))) {
        if (text) sections[slotPurposeKey as keyof CharacterSectionContent] = text;
        if (negative) sectionNegatives[slotPurposeKey as keyof CharacterSectionContent] = negative;
      }
    } else if (target === 'extra') {
      if (text) extra = text;
      if (negative) extraNegative = negative;
    } else if (target === 'section' && (text || negative)) {
      if (text) sections[sectionKey as keyof CharacterSectionContent] = text;
      if (negative) sectionNegatives[sectionKey as keyof CharacterSectionContent] = negative;
    }
  }
  if (!hasAppearance && !basePrompt.trim()) basePrompt = name.trim() || existing.name || '未命名角色';

  const role: CharacterParams = {
    id: previous?.id || createUuid(),
    name: name.trim() || existing.name || previous?.name,
    enabled: previous?.enabled !== false,
    prompt: extra,
    negativePrompt: extraNegative || undefined,
    x: previous?.x ?? 0.5,
    y: previous?.y ?? 0.5,
    sections,
    sectionNegatives,
    sectionMeta: previous?.sectionMeta,
  };
  const others = (existing.params?.characters || []).filter(item => item.id !== role.id);
  return {
    name: name.trim() || existing.name || '未命名角色',
    type: 'character',
    basePrompt,
    negativePrompt,
    previewImage: existing.previewImage,
    variableValues: { ...(existing.variableValues || {}), subject: '' },
    params: { ...existing.params, characters: [role, ...others] } as NAIParams,
  };
}

/** 新建挂「角色」的组合时，直接落成自定义角色（出现在角色库）。 */
export function createCharacterDataFromCombinationPicks(name: string, picks: Record<string, RollRow>, tags: string[] = []): Partial<PromptChain> {
  const draft = applyCombinationPicksToCharacter({
    id: '', type: 'character', name: name.trim() || '未命名角色', basePrompt: '', tags: [], params: { characters: [] } as unknown as NAIParams,
  } as unknown as PromptChain, name, picks);
  return {
    ...draft,
    tags: parsePromptLibraryTags(tags.join(',')).filter(tag => tag !== '角色'),
  };
}

/**
 * 把自定义角色投影成组合卡片：挂到「角色」夹，与角色库同一实体（含封面）。
 * 外貌栏优先合并 basePrompt 与 subject；已有角色分栏照搬；无正文时用描述或名称兜底。
 */
export function projectCustomCharacterAsCombination(character: PromptChain, rootTag = '角色'): PromptChain {
  const picks: Record<string, RollRow> = {};
  const fallback = String(character.description || '').trim() || character.name?.trim() || '未命名角色';
  const subject = String(character.variableValues?.subject || '').trim();
  const appearance = [String(character.basePrompt || '').trim(), subject].filter(Boolean).join(', ');
  const negative = String(character.negativePrompt || '').trim();
  const role = (character.params?.characters || []).find(item => item.enabled !== false) || character.params?.characters?.[0];
  const compiledRole = role && hasCharacterSections(role) ? compileCharacterContent(role) : null;
  const mirroredAppearance = compiledRole && appearance.trim().toLocaleLowerCase() === compiledRole.prompt.trim().toLocaleLowerCase() ? '' : appearance;
  const mirroredNegative = compiledRole && negative.trim().toLocaleLowerCase() === (compiledRole.negativePrompt || '').trim().toLocaleLowerCase() ? '' : negative;
  const sectionsMap = (role?.sections || {}) as Record<string, unknown>;
  const negativesMap = (role?.sectionNegatives || {}) as Record<string, unknown>;
  const sectionMeta = (role?.sectionMeta || {}) as Record<string, { directoryName?: string; directoryPath?: string[] } | undefined>;

  const slotDefs = [
    ['appearance', ['appearance', purposeSectionKey('appearance'), 'purpose:identity']],
    ['wardrobe', ['wardrobe', purposeSectionKey('clothing')]],
    ['pose', ['pose', purposeSectionKey('pose')]],
    ['expression', ['expression', purposeSectionKey('expression')]],
  ] as const;
  const consumedSlotKeys = new Set<string>(slotDefs.flatMap(([, keys]) => [...keys]));

  for (const [kind, keys] of slotDefs) {
    const text = mergeDistinctParts(keys.map(slotKey => typeof sectionsMap[slotKey] === 'string' ? sectionsMap[slotKey] : ''));
    const sectionNegative = mergeDistinctParts(keys.map(slotKey => typeof negativesMap[slotKey] === 'string' ? negativesMap[slotKey] : ''));
    if (kind === 'appearance') {
      const mergedNegative = mergeDistinctParts([sectionNegative, mirroredNegative]);
      const body = text.trim() || mirroredAppearance || (mergedNegative ? fallback : '');
      if (!body.trim()) continue;
      picks.appearance = { kind, scope: 'character', filled: true, text: body, negative: mergedNegative };
      continue;
    }
    if (!text.trim()) continue;
    picks[kind] = { kind, scope: 'character', filled: true, text, negative: sectionNegative };
  }

  const creativeBuckets = new Map<string, { texts: string[]; negatives: string[]; directoryName?: string }>();
  for (const rawKey of new Set([...Object.keys(sectionsMap), ...Object.keys(negativesMap)])) {
    if (consumedSlotKeys.has(rawKey) || !isCreativeSectionKey(rawKey) || isStylePurposeKey(rawKey)) continue;
    const canonicalKey = isPurposeSectionKey(rawKey) ? normalizePromptPurposeSectionKey(rawKey) : rawKey;
    const bucket = creativeBuckets.get(canonicalKey) || { texts: [], negatives: [] };
    if (typeof sectionsMap[rawKey] === 'string') bucket.texts.push(sectionsMap[rawKey]);
    if (typeof negativesMap[rawKey] === 'string') bucket.negatives.push(negativesMap[rawKey]);
    if (!bucket.directoryName) {
      bucket.directoryName = sectionMeta[rawKey]?.directoryPath?.join(' / ') || sectionMeta[rawKey]?.directoryName;
    }
    creativeBuckets.set(canonicalKey, bucket);
  }
  for (const [canonicalKey, bucket] of creativeBuckets) {
    const text = mergeDistinctParts(bucket.texts);
    if (!text) continue;
    const mergedNegative = mergeDistinctParts(bucket.negatives);
    const metaName = isPurposeSectionKey(canonicalKey)
      ? t(promptPurposeLabel(canonicalKey.slice(8)))
      : (bucket.directoryName || canonicalKey.replace(/^custom:/, ''));
    picks[rollItemKey(canonicalKey, 'character')] = {
      kind: canonicalKey,
      scope: 'character',
      filled: true,
      text,
      negative: mergedNegative,
      ...(metaName ? { directoryName: metaName, directoryPath: [metaName] } : {}),
    };
  }

  if (!Object.keys(picks).length) {
    picks.appearance = { kind: 'appearance', scope: 'character', filled: true, text: mirroredAppearance || appearance || fallback, negative: mirroredNegative || negative };
  } else if (!picks.appearance && (mirroredAppearance || mirroredNegative)) {
    picks.appearance = { kind: 'appearance', scope: 'character', filled: true, text: mirroredAppearance || fallback, negative: mirroredNegative };
  }
  const extra = String(role?.prompt || '').trim();
  if (extra) picks[rollItemKey('extra', 'character')] = { kind: 'extra', scope: 'character', filled: true, text: extra, negative: String(role?.negativePrompt || ''), directoryName: '补充', directoryPath: ['补充'] };
  const data = createCombinationData(character.name || '未命名角色', picks, [rootTag]);
  return {
    ...character,
    type: 'preset',
    tags: [rootTag],
    basePrompt: mirroredAppearance || appearance || character.basePrompt,
    params: { ...data.params, [PROMPT_LIBRARY_CHARACTER_SOURCE_KEY]: character.id } as NAIParams,
  } as PromptChain;
}

const LEGACY_CHARACTER_SLOT_MAP: Record<string, string> = {
  appearance: purposeSectionKey('appearance'),
  wardrobe: purposeSectionKey('clothing'),
  pose: purposeSectionKey('pose'),
  expression: purposeSectionKey('expression'),
};

/** 从自定义角色还原实验室分栏槽位；仅存纯文本的角色原样落回补充栏，不硬拆。 */
export function characterSlotFromLibraryChain(item: PromptChain): Pick<CharacterParams, 'name' | 'prompt' | 'negativePrompt' | 'sections' | 'sectionNegatives' | 'sectionMeta'> {
  const sourceRole = (item.params?.characters || []).find(role => role.enabled !== false) || item.params?.characters?.[0];
  if (!sourceRole || !hasCharacterSections(sourceRole)) {
    return {
      name: item.name,
      prompt: compilePrompt(item, item.variableValues?.subject || ''),
      negativePrompt: item.negativePrompt || '',
      sections: undefined,
      sectionNegatives: undefined,
      sectionMeta: undefined,
    };
  }
  const sections: Record<string, string> = {};
  const sectionNegatives: Record<string, string> = {};
  const sectionMeta: Record<string, PromptSectionSource> = {};
  const normalizeSlotKey = (rawKey: string) => LEGACY_CHARACTER_SLOT_MAP[rawKey]
    || (isPurposeSectionKey(rawKey) ? normalizePromptPurposeSectionKey(rawKey) : rawKey);
  const rawSections = (sourceRole.sections || {}) as Record<string, unknown>;
  const rawNegatives = (sourceRole.sectionNegatives || {}) as Record<string, unknown>;
  const rawMeta = (sourceRole.sectionMeta || {}) as Record<string, PromptSectionSource | undefined>;
  for (const rawKey of new Set([...Object.keys(rawSections), ...Object.keys(rawNegatives)])) {
    const slotKey = normalizeSlotKey(rawKey);
    if (isStylePurposeKey(slotKey)) continue;
    const text = typeof rawSections[rawKey] === 'string' ? String(rawSections[rawKey]).trim() : '';
    const negative = typeof rawNegatives[rawKey] === 'string' ? String(rawNegatives[rawKey]).trim() : '';
    if (text) sections[slotKey] = mergeDistinctParts([sections[slotKey], text]);
    if (negative) sectionNegatives[slotKey] = mergeDistinctParts([sectionNegatives[slotKey], negative]);
    const meta = rawMeta[rawKey];
    if ((text || negative) && meta && !sectionMeta[slotKey]) sectionMeta[slotKey] = meta;
  }
  const compiled = compileCharacterContent(sourceRole);
  const fallbackAppearance = mergeDistinctParts([String(item.basePrompt || ''), String(item.variableValues?.subject || '')]);
  if (!sections[purposeSectionKey('appearance')] && fallbackAppearance
    && fallbackAppearance.toLocaleLowerCase() !== compiled.prompt.trim().toLocaleLowerCase()) {
    sections[purposeSectionKey('appearance')] = fallbackAppearance;
  }
  return {
    name: item.name,
    prompt: sourceRole.prompt || '',
    negativePrompt: sourceRole.negativePrompt || '',
    sections: Object.keys(sections).length ? (sections as CharacterSectionContent) : undefined,
    sectionNegatives: Object.keys(sectionNegatives).length ? (sectionNegatives as CharacterSectionContent) : undefined,
    sectionMeta: Object.keys(sectionMeta).length ? (sectionMeta as CharacterParams['sectionMeta']) : undefined,
  };
}

export const parsePromptLibraryTags = (text: string): string[] => [...new Set(text.split(/[,，\r\n]+/).map(tag => tag.trim()).filter(Boolean))];
export interface PromptLibraryField {
  kind?: PromptFragmentKind;
  directoryId?: string; purposeId?: PromptPurposeId;
  roleId?: string;
  lockedSection?: 'items' | 'saved';
  targetScope?: 'global' | 'character';
  negative?: boolean;
  textOnly?: boolean;
}

export function fragmentKindOf(chain: PromptChain): PromptFragmentKind | null {
  if (KINDS.includes(chain.type)) return chain.type as PromptLibraryKind;
  const params = chain.params as unknown as Record<string, unknown> | undefined;
  return chain.type === 'preset' && (params?._collectedCategory === 'general' || isPromptLibraryFragmentEntry(chain)) ? 'general' : null;
}

export function librarySectionOf(chain: PromptChain): PromptLibrarySection | null {
  if (isContentRecord(chain)) return 'saved';
  if (fragmentKindOf(chain)) return 'items';
  return collectedPromptText(chain) !== null ? 'originals' : null;
}

/** 只读已有快照；旧多人组合必须明确选取，不能静默取第一个角色。 */
export function combinationPicks(chain: PromptChain, roleIndex = 0): Record<string, RollRow> {
  const read = contentRead((chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot);
  if (!read.ok) return {};
  // 旧版画风细项（purpose:artist 等）归并到画风配方分栏；同一 scope 内按原顺序拼接正负，
  // 不同 scope 的同用途仍保持独立身份。
  const mergedItems = new Map<string, { item: (typeof read.items)[number]; text: string; negative: string; notes: string }>();
  for (const item of read.items) {
    const unitId = String(normalizePromptPurposeSectionKey(item.unitId));
    const itemId = item.itemId ? rollItemKey(normalizePromptPurposeSectionKey(rollSectionKey(item.itemId)), item.scope) : undefined;
    const key = `${unitId}|${item.scope}|${itemId || ''}`;
    const previous = mergedItems.get(key);
    if (!previous) { mergedItems.set(key, { item: { ...item, unitId, ...(itemId ? { itemId } : {}) }, text: item.text, negative: item.negative, notes: item.constraintNotes }); continue; }
    previous.text = [previous.text, item.text].filter(Boolean).join(', ');
    previous.negative = [previous.negative, item.negative].filter(Boolean).join(', ');
    previous.notes = [previous.notes, item.constraintNotes].filter(Boolean).join('；');
  }
  const items = [...mergedItems.values()];
  const itemCounts = new Map<string, number>();
  for (const { item } of items) itemCounts.set(item.unitId, (itemCounts.get(item.unitId) || 0) + 1);
  const directoryPicks: Record<string, RollRow> = Object.fromEntries(items.map(({ item, text, negative, notes }) => [item.itemId || ((itemCounts.get(item.unitId) || 0) > 1 ? rollItemKey(item.unitId, item.scope) : item.unitId), {
    kind: item.unitId, directoryId: item.directoryId, directoryName: item.directoryName, directoryPath: item.directoryPath,
    scope: item.scope, filled: true, text, negative, constraintNotes: notes,
    id: String(item.meta?.entryId || ''), name: String(item.meta?.entryName || item.directoryName || chain.name), meta: item.meta,
  }]));
  const role = read.roles[roleIndex];
  return { ...Object.fromEntries([...KINDS, 'presentation'].flatMap(kind => {
    const global = read.global[kind];
    const text = META[kind].scope === 'character' ? role?.sections[kind] : global?.text;
    if (!text) return [];
    const negative = META[kind].scope === 'character' ? role?.negatives[kind] : global?.negative;
    const meta = (META[kind].scope === 'character' ? role?.meta[kind] : global?.meta) as { entryId?: string; entryName?: string; notes?: string } | undefined;
    return [[kind, { kind, filled: true, text, negative: negative?.text || '', id: meta?.entryId || '', name: meta?.entryName || chain.name,
      meta, constraintNotes: [negative?.note, meta?.notes].filter(Boolean).join('；') }]];
  })), ...directoryPicks };
}

export function libraryEntryText(chain: PromptChain, field: PromptLibraryField = {}, directories?: PromptLibraryTreeState): string {
  const purposes = field.purposeId && !isContentRecord(chain) ? getEntryPurposes(chain, directories) : [];
  if (field.purposeId && !isContentRecord(chain) && (purposes.length !== 1 || !purposes.includes(normalizePromptPurposeId(field.purposeId)))) return '';
  if ((chain.params as unknown as Record<string, unknown>)?._promptLibraryPolarity === 'negative') return field.negative ? chain.basePrompt || '' : '';
  if (!isContentRecord(chain)) return field.negative ? chain.negativePrompt || '' : chain.basePrompt || '';
  const picks = combinationPicks(chain);
  return Object.entries(picks).filter(([kind, row]) => field.purposeId ? normalizePromptPurposeSectionKey(rollSectionKey(kind)) === purposeSectionKey(field.purposeId) : field.directoryId ? row.directoryId === field.directoryId : field.kind ? kind === field.kind : true)
    .map(([, row]) => field.negative ? row.negative : row.text).filter(Boolean).join(', ');
}

/**
 * 负面栏位的兼容回退：条目没有负面内容时允许以正文作为负面取用，
 * 界面须原位注明该行为；libraryEntryText 的纯语义保持不变。
 * 组合的负面来自快照分栏，不把组合摘要当负面，因此排除。
 */
export function libraryNegativeFallbackText(chain: PromptChain, field: PromptLibraryField = {}, directories?: PromptLibraryTreeState): string {
  if (!field.negative || isContentRecord(chain)) return '';
  if (libraryEntryText(chain, field, directories).trim()) return '';
  return (chain.basePrompt || '').trim();
}

/** 取用与候选展示使用：优先负面内容，必要时回退正文。 */
export const libraryFieldText = (chain: PromptChain, field: PromptLibraryField = {}, directories?: PromptLibraryTreeState): string =>
  libraryEntryText(chain, field, directories) || libraryNegativeFallbackText(chain, field, directories);

/** 原文追加保持空白、换行及权重；片段沿用已有的加权组去重规则。 */
export function applyLibraryText(current: string, incoming: string, mode: PromptApplyMode, original = false): string {
  if (mode === 'fill-missing' && current.trim()) return current;
  if (mode === 'replace' || !current.trim()) return incoming;
  if (!incoming.trim()) return current;
  return original ? current + (/[,，\n]\s*$/.test(current) ? '' : ', ') + incoming : applyPromptText(current, incoming, mode);
}

export function searchLibraryEntries(chains: PromptChain[], query: string, field: PromptLibraryField = {}): PromptChain[] {
  const normalize = (value: string) => value.trim().replace(/^@/, '').replace(/[_\s]+/g, ' ').toLocaleLowerCase();
  const key = normalize(query);
  if (!key) return [];
  return chains.filter(chain => librarySectionOf(chain) && normalize(chain.name).includes(key)
    && (librarySectionOf(chain) === 'saved' || libraryEntryText(chain, field).trim() || libraryNegativeFallbackText(chain, field)))
    .sort((a, b) => Number(normalize(b.name) === key) - Number(normalize(a.name) === key)
      || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 6);
}

export function libraryPicksWithSources(picks: Record<string, RollRow>): Record<string, RollRow> {
  return Object.fromEntries(Object.entries(picks).map(([kind, row]) => [kind, { ...row,
    meta: row.meta || (row.id && !row.id.startsWith('manual-') ? { source: 'library', entryId: row.id, entryName: row.name, entryType: kind, entryBasePrompt: row.text } : undefined),
  }]));
}

export function createCombinationData(name: string, picks: Record<string, RollRow>, tags: string[] = []): Partial<PromptChain> {
  const snapshot = contentSnapshotOf({ picks: libraryPicksWithSources(picks) }, new Date().toISOString());
  if (!snapshot) throw new Error('组合还没有内容');
  return { name: name.trim() || '新组合', type: 'preset', tags: parsePromptLibraryTags(tags.join(',')), params: { _rollContentSnapshot: snapshot } as unknown as NAIParams };
}

export function workspacePicks(params: Partial<NAIParams>, roleId?: string, directories?: PromptLibraryTreeState): Record<string, RollRow> {
  const role = params.characters?.find(item => item.id === roleId);
  const picks: Record<string, RollRow> = Object.fromEntries(KINDS.flatMap(kind => {
    const text = META[kind].scope === 'character' && role ? role.sections?.[kind as keyof typeof role.sections]
      : (params._promptSections as Record<string, unknown> | undefined)?.[kind];
    const negative = META[kind].scope === 'character' && role ? role.sectionNegatives?.[kind as keyof typeof role.sectionNegatives]
      : params._promptSections?.sectionNegatives?.[kind];
    return typeof text === 'string' && text.trim() ? [[kind, { kind, filled: true, text, negative: String(negative || '') }]] : [];
  }));
  for (const [scope, sections, negatives] of [
    ['global', params._promptSections, params._promptSections?.sectionNegatives],
    ['character', role?.sections, role?.sectionNegatives],
  ] as const) for (const [kind, text] of Object.entries(sections || {})) {
    if (!isCreativeSectionKey(kind) || typeof text !== 'string' || !text.trim()) continue;
    // 旧工作草稿里的画风细项归并到同一分栏，避免出现多个「画风配方」。
    const normalizedKind = String(normalizePromptPurposeSectionKey(kind));
    const directoryId = isDirectorySectionKey(normalizedKind) ? normalizedKind.slice('directory:'.length) : '';
    const sectionMeta = ((scope === 'character' ? role?.sectionMeta : params._promptSections?.sectionMeta) as Record<string, { directoryName?: string; directoryPath?: string[] } | undefined> | undefined)?.[kind];
    const path = isPurposeSectionKey(normalizedKind)
      ? [promptPurposeLabel(normalizedKind.slice(8))]
      : isDirectorySectionKey(normalizedKind)
        ? (directories ? getPromptLibraryDirectoryPath(directories, directoryId).map(node => node.name) : [])
        : (sectionMeta?.directoryPath?.length ? sectionMeta.directoryPath : [sectionMeta?.directoryName || normalizedKind.replace(/^custom:/, '')]);
    const key = rollItemKey(normalizedKind, scope);
    const previous = picks[key];
    picks[key] = { kind: normalizedKind, directoryId, directoryName: path.at(-1) || directoryId || normalizedKind.replace(/^custom:/, ''), directoryPath: path,
      scope,
      filled: true,
      text: [previous?.text, text].filter(Boolean).join(', '),
      negative: [previous?.negative, String((negatives as Record<string, unknown> | undefined)?.[kind] || '')].filter(Boolean).join(', ') };
  }
  const presentation = params._promptSections?.presentation;
  if (presentation?.trim()) picks.presentation = { kind: 'presentation', scope: 'global', filled: true, text: presentation, negative: params._promptSections?.sectionNegatives?.presentation || '', meta: params._promptSections?.sectionMeta?.presentation };
  const globalExtra = params._promptSections?.extra;
  if (typeof globalExtra === 'string' && globalExtra.trim()) {
    picks[rollItemKey('extra', 'global')] = {
      kind: 'extra', scope: 'global', filled: true, text: globalExtra,
      negative: params._promptSections?.sectionNegatives?.extra || '',
      directoryName: '补充', directoryPath: ['补充'],
    };
  }
  if (role) {
    const characterExtra = String(role.prompt || '').trim();
    if (characterExtra) {
      picks[rollItemKey('extra', 'character')] = {
        kind: 'extra', scope: 'character', filled: true, text: characterExtra,
        negative: String(role.negativePrompt || ''),
        directoryName: '补充', directoryPath: ['补充'],
      };
    }
  }
  return picks;
}

export function createFragmentData(text: string, name: string, kind: PromptFragmentKind, negative = '', directoryIds?: string[]): Partial<PromptChain> {
  const data = prepareCollectedPrompt(text, name, kind);
  return { ...data, negativePrompt: negative, ...(directoryIds ? { params: { ...data.params, _promptLibraryDirectoryIds: directoryIds } as NAIParams } : {}) };
}

export interface PromptCardBadge {
  key: string;
  label: string;
  kind: 'folder' | 'purpose' | 'tag' | 'character' | 'negative';
}

/** 供卡片一键复制使用的真实文本：组合拼接各分栏正词，片段／原文返回正文。 */
export function getPromptEntryCopyText(chain: PromptChain): string {
  if (isContentRecord(chain)) return libraryEntryText(chain).trim();
  return (collectedPromptText(chain) || chain.basePrompt || '').trim();
}

/**
 * 卡片底部徽标：人类视角只展示负面标记与真实所在文件夹胶囊，
 * 机器使用的固定用途已由目录绑定，不再平铺在浏览卡片上造成双套分类重名。
 */
export function getPromptCardBadges(
  chain: PromptChain,
  directories?: PromptLibraryTreeState,
  categoryLabel?: (tag: string) => string,
): PromptCardBadge[] {
  if (isPromptLibraryCharacterProjection(chain)) {
    return [{ key: 'char', label: t('自定义角色'), kind: 'character' }];
  }
  if (librarySectionOf(chain) === 'saved') {
    return getCustomChainTags(chain.tags)
      .slice(0, 3)
      .map(tag => ({ key: `tag:${tag}`, label: categoryLabel ? categoryLabel(tag) : tag, kind: 'tag' }));
  }
  const badges: PromptCardBadge[] = [];
  const seenLabels = new Set<string>();
  const params = paramsBag(chain.params);
  if (params._promptLibraryPolarity === 'negative') {
    const negLabel = t('负面');
    badges.push({ key: 'negative', label: negLabel, kind: 'negative' });
    seenLabels.add(negLabel.toLocaleLowerCase());
  }
  if (directories) {
    for (const id of getPromptLibraryEntryDirectoryIds(chain, directories)) {
      const folderName = getPromptLibraryDirectoryPath(directories, id).at(-1)?.name;
      if (!folderName) continue;
      const normalized = folderName.toLocaleLowerCase();
      if (seenLabels.has(normalized)) continue;
      seenLabels.add(normalized);
      badges.push({ key: `dir:${id}`, label: folderName, kind: 'folder' });
    }
  }
  return badges.slice(0, 3);
}

/** 拖拽归类或批量改目录时构造更新载荷，让未单独覆写的条目继续实时继承新目录用途。 */
export function buildDirectoryMoveUpdates(
  chain: PromptChain,
  nextDirectoryIds: string[],
  directories: PromptLibraryTreeState,
): Partial<PromptChain> {
  const params = { ...(chain.params || {}) } as Record<string, unknown>;
  const previousDirectoryIds = getPromptLibraryEntryDirectoryIds(chain, directories);
  const nextPurposes = resolveExplicitPurposesAfterDirectoryMove(previousDirectoryIds, getExplicitEntryPurposes(chain), directories);
  const nextParams: Record<string, unknown> = {
    ...params,
    _promptLibraryDirectoryIds: [...new Set(nextDirectoryIds)],
    _promptLibraryPurposes: nextPurposes,
  };
  if (params._promptLibraryPolarity !== 'negative' && nextDirectoryIds.length > 0 && params._collectedPrompt === 1 && params._collectedCategory !== 'general') {
    nextParams._collectedCategory = 'general';
  }
  if (params._promptLibraryOriginal && params._promptLibraryPolarity !== 'negative' && nextDirectoryIds.length > 0) {
    delete nextParams._promptLibraryOriginal;
    nextParams._collectedCategory = 'general';
  }
  return { params: nextParams as unknown as NAIParams };
}
