import type { PromptChain } from '../types';
import { extractArtistParticipation } from './artistParticipation';
import { getChainPromptTokenWeight, parseChainPromptTokens } from './chainSimilarity';
import { compileCharacterContent, getActiveCharacters } from './characterPrompts';
import { compilePrompt } from './promptUtils';

/** 只取实际正向中的画师名字；knownArtists 由调用方用 normalizeArtistUsageKey 一次规范化，不继承原权重或其它生成配置。 */
export function extractRollChainArtistTags(chain: PromptChain, knownArtists: ReadonlySet<string>): string[] {
  const texts = [
    compilePrompt(chain, chain.variableValues?.subject || ''),
    ...getActiveCharacters(chain.params?.characters).map(character => compileCharacterContent(character).prompt),
  ];
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
