import type { NAIParams, PromptChain } from '../types';
import { contentRead, contentSnapshotOf, isContentRecord, KINDS, META, type RollRow } from './contentRoll';
import { collectedPromptText, prepareCollectedPrompt } from './collectedPrompt';
import type { PromptLibraryKind } from './promptAgent';
import { applyPromptText, type PromptApplyMode } from './promptApply';

export type PromptFragmentKind = PromptLibraryKind | 'general';
export type PromptLibrarySection = 'items' | 'saved' | 'originals';
export const isLibraryOnlyQuery = (query: string): boolean => /^@(?=[\p{L}\p{N}])/u.test(query);
export const FRAGMENT_LABELS: Record<PromptFragmentKind, string> = {
  appearance: '外貌', wardrobe: '服饰', pose: '动作', expression: '表情', scene: '场景', camera: '镜头', general: '通用',
};
export const parsePromptLibraryTags = (text: string): string[] => [...new Set(text.split(/[,，\r\n]+/).map(tag => tag.trim()).filter(Boolean))];
export interface PromptLibraryField {
  kind?: PromptFragmentKind;
  roleId?: string;
  negative?: boolean;
  textOnly?: boolean;
}

export function fragmentKindOf(chain: PromptChain): PromptFragmentKind | null {
  if (KINDS.includes(chain.type)) return chain.type as PromptLibraryKind;
  const params = chain.params as unknown as Record<string, unknown> | undefined;
  return chain.type === 'preset' && params?._collectedCategory === 'general' ? 'general' : null;
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
  const role = read.roles[roleIndex];
  return Object.fromEntries(KINDS.flatMap(kind => {
    const global = read.global[kind];
    const text = META[kind].scope === 'character' ? role?.sections[kind] : global?.text;
    if (!text) return [];
    const negative = META[kind].scope === 'character' ? role?.negatives[kind] : global?.negative;
    const meta = (META[kind].scope === 'character' ? role?.meta[kind] : global?.meta) as { entryId?: string; entryName?: string; notes?: string } | undefined;
    return [[kind, { kind, filled: true, text, negative: negative?.text || '', id: meta?.entryId || '', name: meta?.entryName || chain.name,
      meta, constraintNotes: [negative?.note, meta?.notes].filter(Boolean).join('；') }]];
  }));
}

export function libraryEntryText(chain: PromptChain, field: PromptLibraryField = {}): string {
  if ((chain.params as unknown as Record<string, unknown>)?._promptLibraryPolarity === 'negative') return field.negative ? chain.basePrompt || '' : '';
  if (!isContentRecord(chain)) return field.negative ? chain.negativePrompt || '' : chain.basePrompt || '';
  const picks = combinationPicks(chain);
  return KINDS.filter(kind => field.kind ? kind === field.kind : true)
    .map(kind => field.negative ? picks[kind]?.negative : picks[kind]?.text).filter(Boolean).join(', ');
}

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
    && (librarySectionOf(chain) === 'saved' || libraryEntryText(chain, field).trim()))
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

export function workspacePicks(params: Partial<NAIParams>, roleId?: string): Record<string, RollRow> {
  const role = params.characters?.find(item => item.id === roleId);
  return Object.fromEntries(KINDS.flatMap(kind => {
    const text = META[kind].scope === 'character' && role ? role.sections?.[kind as keyof typeof role.sections]
      : (params._promptSections as Record<string, unknown> | undefined)?.[kind];
    const negative = META[kind].scope === 'character' && role ? role.sectionNegatives?.[kind as keyof typeof role.sectionNegatives]
      : params._promptSections?.sectionNegatives?.[kind];
    return typeof text === 'string' && text.trim() ? [[kind, { kind, filled: true, text, negative: String(negative || '') }]] : [];
  }));
}

export function createFragmentData(text: string, name: string, kind: PromptFragmentKind, negative = ''): Partial<PromptChain> {
  return { ...prepareCollectedPrompt(text, name, kind), negativePrompt: negative };
}
