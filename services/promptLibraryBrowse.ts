import { getEntryPurposes, promptPurposeLabel } from './promptPurposes.mjs';
import type { PromptChain } from '../types';
import { bilingualOf, contentRead } from './contentRoll';
import { collectedPromptText } from './collectedPrompt';
import { fragmentKindOf, librarySectionOf, type PromptFragmentKind, type PromptLibrarySection } from './promptLibraryEntries';

export type PromptBrowseScope = 'all' | PromptLibrarySection;
export interface PromptBrowseFilter {
  scope: PromptBrowseScope;
  query: string;
  kind: PromptFragmentKind | '';
  tags: string[];
  purposes?: string[];
  sort: 'updated' | 'name';
}
export interface PromptBrowseEntry {
  chain: PromptChain;
  section: PromptLibrarySection;
  kind: PromptFragmentKind | null;
  texts: string[];
  summary: string;
}
export const normalizeBrowseText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/** 只读汇总所有角色和分类，不能用第一个角色的展示摘要代替检索正文。 */
export function promptBrowseEntries(chains: PromptChain[]): PromptBrowseEntry[] {
  return chains.flatMap(chain => {
    const section = librarySectionOf(chain);
    if (!section) return [];
    const original = collectedPromptText(chain);
    const read = section === 'saved' ? contentRead((chain.params as unknown as Record<string, unknown>)?._rollContentSnapshot) : null;
    const body = [original ?? '', bilingualOf(chain), chain.basePrompt || '', chain.negativePrompt || '',
      ...(read?.roles.flatMap(role => [...Object.values(role.sections),
        ...Object.values(role.negatives).flatMap(negative => [negative.text, negative.note])]) || []),
      ...Object.values(read?.global || {}).flatMap(field => [field.text || '', field.negative?.text || '', field.negative?.note || ''])].filter(Boolean);
    const texts = [...body, ...(read?.items.flatMap(item => [item.text, item.negative, item.constraintNotes, item.directoryName, ...item.directoryPath]) || []), ...(read?.roles.map(role => role.name) || []), chain.description || '', ...(chain.tags || []), ...getEntryPurposes(chain).map(promptPurposeLabel)];
    const summary = section === 'saved' ? [...Object.values(read?.roles[0]?.sections || {}),
      ...Object.values(read?.global || {}).map(field => field.text), ...(read?.items.map(item => item.text) || [])].filter(Boolean).join(', ') : body[0];
    return [{ chain, section, kind: fragmentKindOf(chain), texts, summary: summary || chain.description || '' }];
  });
}

export function filterPromptBrowseEntries(entries: PromptBrowseEntry[], filter: PromptBrowseFilter): PromptBrowseEntry[] {
  const query = normalizeBrowseText(filter.query);
  return entries.filter(entry => (filter.scope === 'all' || entry.section === filter.scope)
    && (!filter.kind || entry.section === 'items' && entry.kind === filter.kind)
    && filter.tags.every(tag => entry.chain.tags?.includes(tag))
    && (filter.purposes || []).every(id => getEntryPurposes(entry.chain).some(value => value === id))
    && (!query || [entry.chain.name, ...entry.texts].some(text => normalizeBrowseText(text).includes(query))))
    .sort((a, b) => (query ? Number(normalizeBrowseText(b.chain.name).includes(query)) - Number(normalizeBrowseText(a.chain.name).includes(query)) : 0)
      || (filter.sort === 'name' ? a.chain.name.localeCompare(b.chain.name) : Number(b.chain.updatedAt || 0) - Number(a.chain.updatedAt || 0)));
}

/** 摘要优先展示命中的正文；名称或标签命中时仍保留可辨认的内容。 */
export function promptBrowseSummary(entry: PromptBrowseEntry, query: string): string {
  const key = normalizeBrowseText(query);
  const text = (key ? entry.texts.find(value => normalizeBrowseText(value).includes(key)) : null) || entry.summary;
  const compact = text.replace(/\s+/g, ' ').trim();
  const match = key ? compact.toLocaleLowerCase().indexOf(key) : -1;
  const start = Math.max(0, match - 45);
  return `${start ? '…' : ''}${compact.slice(start, start + 220)}${compact.length > start + 220 ? '…' : ''}`;
}
