import type { PromptChain } from '../types';

/** 风格串里实际保存的参考配置；与生成发送和 ParamsViewer 使用同一判定口径。 */
export interface ChainReferenceSummary {
  vibes: number;
  characterReferences: number;
}

export const chainReferenceSummary = (chain: Pick<PromptChain, 'params'> | null | undefined): ChainReferenceSummary => {
  const vibes = chain?.params?.vibes;
  const references = chain?.params?.characterReferences;
  return {
    vibes: vibes?.enabled && Array.isArray(vibes.slots) ? vibes.slots.length : 0,
    characterReferences: references?.enabled && Array.isArray(references.slots) ? references.slots.length : 0,
  };
};
