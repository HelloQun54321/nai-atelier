import type { PromptChain } from '../types';
import type { CharacterDictionaryEntry } from './tagDictionary';
import type { AgentCharacterReference } from './promptAgent';

/** 角色库里已编辑过的词库角色，用这个标记区分纯自定义角色。 */
export const CHARACTER_CATALOG_MARKER = '__character_catalog__';

export type { AgentCharacterReference } from './promptAgent';

export interface AgentCharacterMentionOption extends AgentCharacterReference {
  /** 候选里显示的第二行资料，不写进输入框。 */
  detail: string;
  /** 只有名称或角色 Tag 命中时排到词库候选之前；仅描述/提示词命中时降权。 */
  nameMatched?: boolean;
}

export interface AgentCharacterMentionQuery {
  /** @ 本身的字符位置。 */
  start: number;
  /** 查询词结束位置，也就是光标。 */
  end: number;
  query: string;
}

/** 光标前是否正处于 @ 查询中；只在行首或空白后的 @ 触发，避免邮箱等普通文本误触发。 */
export const findCharacterMention = (text: string, caret: number): AgentCharacterMentionQuery | null => {
  if (caret < 1) return null;
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(（【\[])[@＠]([^\s@＠]{0,40})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[1].length - 1, end: caret, query: match[1] };
};

const normalize = (value: string) => value.replaceAll('_', ' ').normalize('NFKC').toLowerCase().trim();

const isCatalogChain = (chain: PromptChain) => chain.tags?.includes(CHARACTER_CATALOG_MARKER) === true;

const isLiveChain = (chain: PromptChain) => chain.type === 'character' && !chain.guestHidden;

const chainTag = (chain: PromptChain) => String(chain.params?._characterCatalogTag || (!isCatalogChain(chain) ? chain.basePrompt : '') || '').trim();

const promptOf = (chain: PromptChain) => String(chain.basePrompt || '').trim();

const optionOfChain = (chain: PromptChain, source: 'custom' | 'catalog', chinese?: string, postCount?: number): AgentCharacterMentionOption => {
  const tag = chainTag(chain);
  const name = source === 'catalog' ? chinese?.trim() || chain.name : chain.name;
  return {
    id: chain.id,
    source,
    name,
    ...(tag && source === 'custom' ? { tag } : {}),
    ...(chinese?.trim() ? { chinese: chinese.trim() } : {}),
    ...(chain.description?.trim() ? { description: chain.description.trim() } : {}),
    ...(promptOf(chain) ? { prompt: promptOf(chain) } : {}),
    ...(chain.negativePrompt?.trim() ? { negativePrompt: chain.negativePrompt.trim() } : {}),
    ...(postCount ? { postCount } : {}),
    detail: chain.description?.trim() || tag,
  };
};

const scoreChainMatch = (chain: PromptChain, keyword: string) => {
  if (!keyword) return 0;
  const name = normalize(chain.name);
  if (name === keyword) return 1000;
  if (name.startsWith(keyword)) return 900;
  if (name.includes(keyword)) return 800;
  if (normalize(String(chain.basePrompt || '')).includes(keyword)) return 420;
  if (normalize(String(chain.description || '')).includes(keyword)) return 300;
  return 0;
};

/** 当前角色库里可直接引用的自定义角色（不含只读的词库条目）。 */
export const matchCustomCharacters = (chains: readonly PromptChain[], query: string, limit = 6): AgentCharacterMentionOption[] => {
  const keyword = normalize(query);
  const candidates = chains.filter(chain => isLiveChain(chain) && !isCatalogChain(chain));
  if (!keyword) return candidates.slice().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0)).slice(0, limit).map(chain => optionOfChain(chain, 'custom'));
  const scored = candidates.flatMap(chain => {
    const score = scoreChainMatch(chain, keyword);
    return score ? [{ chain, score }] : [];
  }).sort((left, right) => right.score - left.score || (right.chain.updatedAt || 0) - (left.chain.updatedAt || 0));
  return scored.slice(0, limit).map(({ chain, score }) => ({ ...optionOfChain(chain, 'custom'), nameMatched: score >= 800 }));
};

/** 英文输入去掉空格后再比对，支持 hutao → hu tao、genshinimpact 这类无空格写法。 */
const squash = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '');

export const matchLooseCatalogEntries = (entries: readonly CharacterDictionaryEntry[], rawQuery: string, limit = 6): CharacterDictionaryEntry[] => {
  const query = squash(rawQuery);
  if (!query || !/^[a-z0-9]+$/i.test(query)) return [];
  const scored = entries.flatMap(entry => {
    const name = squash(entry.name);
    const chinese = squash(entry.chinese);
    const score = name === query ? 1000 : name.startsWith(query) ? 900 : name.includes(query) ? 800 : chinese.includes(query) ? 700 : 0;
    return score ? [{ entry, score }] : [];
  }).sort((left, right) => right.score - left.score || (right.entry.postCount || 0) - (left.entry.postCount || 0) || left.entry.name.localeCompare(right.entry.name));
  return scored.slice(0, limit).map(item => item.entry);
};

/** 词库角色候选；已有个人配方的词库角色优先取个人正文，避免引用到空壳条目。 */
export const matchCatalogCharacters = (chains: readonly PromptChain[], entries: readonly CharacterDictionaryEntry[], limit = 6): AgentCharacterMentionOption[] => {
  const catalogChains = chains.filter(chain => isLiveChain(chain) && isCatalogChain(chain));
  const byTag = new Map<string, PromptChain>();
  for (const chain of catalogChains) {
    const tag = normalize(chainTag(chain));
    if (tag && !byTag.has(tag)) byTag.set(tag, chain);
  }
  return entries.slice(0, limit).map(entry => {
    const tag = normalize(entry.name);
    const chain = byTag.get(tag);
    if (chain) return { ...optionOfChain(chain, 'catalog', entry.chinese, entry.postCount), tag: entry.name, name: entry.chinese?.trim() || entry.name };
    return { source: 'catalog' as const, name: entry.chinese?.trim() || entry.name, tag: entry.name, ...(entry.chinese?.trim() ? { chinese: entry.chinese.trim() } : {}), ...(entry.postCount ? { postCount: entry.postCount } : {}), detail: entry.chinese?.trim() && entry.chinese.trim() !== entry.name ? entry.name : '' };
  });
};

/** 合并两类候选：名称命中的自定义角色在前，词库按名称去重，仅提示词命中的自定义角色降到最后。 */
export const mergeCharacterMentionOptions = (custom: readonly AgentCharacterMentionOption[], catalog: readonly AgentCharacterMentionOption[], limit = 8): AgentCharacterMentionOption[] => {
  const seen = new Set<string>();
  const merged: AgentCharacterMentionOption[] = [];
  const nameMatchedCustom = custom.filter(item => item.nameMatched !== false);
  const otherCustom = custom.filter(item => item.nameMatched === false).slice(0, 2);
  for (const option of [...nameMatchedCustom, ...catalog, ...otherCustom]) {
    const key = normalize(option.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(option);
    if (merged.length >= limit) break;
  }
  return merged;
};

/** 只保留状态所需字段，避免把整个角色链送进请求。 */
export const toAgentCharacterReference = (option: AgentCharacterMentionOption): AgentCharacterReference => ({
  ...(option.id ? { id: option.id } : {}),
  source: option.source,
  name: option.name,
  ...(option.tag ? { tag: option.tag } : {}),
  ...(option.chinese ? { chinese: option.chinese } : {}),
  ...(option.description ? { description: option.description } : {}),
  ...(option.prompt ? { prompt: option.prompt } : {}),
  ...(option.negativePrompt ? { negativePrompt: option.negativePrompt } : {}),
  ...(option.postCount ? { postCount: option.postCount } : {}),
});
