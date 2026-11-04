import type { CharacterParams, NAIParams, PromptChain } from '../types';
import { compileCharacterContent, getActiveCharacters } from './characterPrompts';
import { getChainPromptTokenWeight, parseChainPromptTokens } from './chainSimilarity';
import { compilePrompt } from './promptUtils';
import { normalizeRollArtistKey } from './styleRollSeed';

export const normalizeArtistUsageKey = (name: string) => normalizeRollArtistKey(name.normalize('NFKC').replace(/\\([()])/g, '$1'));

const artistName = (key: string, knownArtists?: ReadonlySet<string>) => {
  const explicit = /^artists?\s*:/i.test(key);
  const name = normalizeArtistUsageKey(key.replace(/^(?:artists?\s*:\s*|by[\s:]+|@)/i, ''));
  return name && !/[:,，\r\n|<>\[\]{}]/.test(name) && (explicit || knownArtists?.has(name)) ? name : null;
};

/** 统计写入正向的参与 Tag；权重不分摊，重复出现只记一次。 */
export function extractArtistParticipation(text: string, knownArtists?: ReadonlySet<string>): string[] {
  return [...new Set(parseChainPromptTokens(text).flatMap(token => {
    const name = artistName(token.key, knownArtists);
    return name ? [name] : [];
  }))];
}

/**
 * 实际参与生成的画师：全局与各段角色栏独立解析，未闭合的数值范围不跨段延续；
 * 负权重画师是被压低的，不算参与。
 */
export function extractPromptArtistTags(texts: readonly string[], knownArtists?: ReadonlySet<string>): string[] {
  const artists = new Set<string>();
  // 全局与各角色独立解析，未闭合的数值范围不能跨角色延续。
  for (const text of texts) {
    for (const token of parseChainPromptTokens(text.normalize('NFKC').replace(/\\([()])/g, '$1'))) {
      // 比较器对括号／by 等写法保守标记“不确定”；这里只读取词法已经确定的倍率符号。
      const weight = getChainPromptTokenWeight({ ...token, uncertainWeight: false });
      if (weight !== null && weight <= 0) continue;
      for (const artist of extractArtistParticipation(token.text, knownArtists)) artists.add(artist);
    }
  }
  return [...artists];
}

const parsed = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const activeCharacters = (value: unknown) => getActiveCharacters(Array.isArray(value) ? value : []);

const characterTexts = (params: Partial<NAIParams>) => activeCharacters(params.characters)
  .map(character => compileCharacterContent(character).prompt);

export function extractChainArtistParticipation(chain: PromptChain, knownArtists?: ReadonlySet<string>): string[] {
  return extractPromptArtistTags([
    compilePrompt(chain, chain.variableValues?.subject || ''), ...characterTexts(chain.params || {}),
  ], knownArtists);
}

export interface ArtistParticipationHistory {
  prompt?: string | null;
  base_prompt?: string | null;
  subject_prompt?: string | null;
  params?: unknown;
  characters?: unknown;
}

/** 历史使用当时保存的实际内容，不再从当前风格串反推。 */
export function extractHistoryParticipation(row: ArtistParticipationHistory, knownArtists?: ReadonlySet<string>) {
  const params = parsed<Partial<NAIParams>>(row.params, {}) || {};
  const characters = activeCharacters(parsed<CharacterParams[]>(row.characters, params.characters || []));
  const roles = characters.map(character => compileCharacterContent(character).prompt);
  const global = row.prompt?.trim() || [row.base_prompt, row.subject_prompt].filter(Boolean).join(', ');
  const tokens = parseChainPromptTokens(global);
  const tags = [...new Set(tokens.map(token => token.key).filter(key => key && key.length <= 80 && !artistName(key, knownArtists)))];
  const names = [...new Set(roles.map(prompt => prompt.replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean))];
  return {
    // 全局与角色栏分别解析：全局未闭合的权重或 `artists:` 分组不能把角色栏的描述当成画师名。
    artists: extractPromptArtistTags([global, ...roles], knownArtists),
    tags,
    characters: names.map(name => ({ id: name, name })),
  };
}
