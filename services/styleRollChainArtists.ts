import type { NAIParams, PromptChain } from '../types';
import { extractPromptArtistTags } from './artistParticipation';
import { compileCharacterContent, getActiveCharacters } from './characterPrompts';
import { compilePrompt } from './promptUtils';
import type { RollChainArtistSource } from './styleRoll';

/** 只取实际正向中的画师名字；knownArtists 由调用方用 normalizeArtistUsageKey 一次规范化，不继承原权重或其它生成配置。 */
export function extractRollChainArtistTags(chain: PromptChain, knownArtists: ReadonlySet<string>): string[] {
  return extractPromptArtistTags([
    compilePrompt(chain, chain.variableValues?.subject || ''),
    ...getActiveCharacters(chain.params?.characters).map(character => compileCharacterContent(character).prompt),
  ], knownArtists);
}

/** 成图记录保存的是当时的完整全局正向与角色栏，直接按同一规则读取。 */
export function extractGenerationArtistTags(data: { prompt?: string; params?: Partial<NAIParams> }, knownArtists: ReadonlySet<string>): string[] {
  return extractPromptArtistTags([
    data.prompt || '',
    ...getActiveCharacters(data.params?.characters).map(character => compileCharacterContent(character).prompt),
  ], knownArtists);
}

/** 每条所选风格串只贡献一次同名画师，重复选择同一条也不增加概率。 */
export function buildRollChainArtistSource(
  chains: readonly PromptChain[],
  knownArtists: ReadonlySet<string>,
  readTags: (chain: PromptChain) => readonly string[] = chain => extractRollChainArtistTags(chain, knownArtists),
): RollChainArtistSource {
  const chainIds = new Set<string>(), counts = new Map<string, number>();
  for (const chain of chains) {
    if (chainIds.has(chain.id)) continue;
    chainIds.add(chain.id);
    for (const tag of new Set(readTags(chain))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return { chainIds: [...chainIds], artists: [...counts].map(([tag, count]) => ({ tag, count })) };
}
