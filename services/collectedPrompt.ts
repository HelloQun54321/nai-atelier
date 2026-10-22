import type { ChainType, PromptChain } from '../types';

export const MAX_COLLECTED_PROMPT_LENGTH = 65536;

/** 「原文收录」可选的六类条目库；空串表示保持组合库的原文记录。 */
export const COLLECTED_PROMPT_CATEGORIES = [
  { kind: 'appearance', label: '外貌' },
  { kind: 'wardrobe', label: '服饰' },
  { kind: 'pose', label: '动作' },
  { kind: 'expression', label: '表情' },
  { kind: 'scene', label: '场景' },
  { kind: 'camera', label: '镜头' },
  { kind: 'general', label: '通用' },
] as const;

export type CollectedPromptCategory = typeof COLLECTED_PROMPT_CATEGORIES[number]['kind'];
const CATEGORY_KINDS = COLLECTED_PROMPT_CATEGORIES.map(item => item.kind) as CollectedPromptCategory[];

/** 原文单独标记，不能冒充六类已分栏快照；名称整理不影响正文。 */
export function prepareCollectedPrompt(text: unknown, name: unknown = '', category: unknown = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先粘贴提示词');
  if (text.length > MAX_COLLECTED_PROMPT_LENGTH) throw new Error('提示词过长，请分段收录');
  const kind = typeof category === 'string' ? category : '';
  if (kind && !CATEGORY_KINDS.includes(kind as CollectedPromptCategory)) throw new Error('分类无效');
  return {
    type: (kind && kind !== 'general' ? kind : 'preset') as ChainType,
    name: (typeof name === 'string' ? name.trim() : '').slice(0, 200) || text.trim().split(/[\r\n]/)[0].slice(0, 64),
    basePrompt: text,
    params: { _collectedPrompt: 1, ...(kind ? { _collectedCategory: kind } : {}) } as unknown as PromptChain['params'],
  };
}

export function collectedPromptText(chain: Pick<PromptChain, 'type' | 'params' | 'basePrompt'>): string | null {
  const params = chain.params as unknown as Record<string, unknown> | undefined;
  return chain.type === 'preset' && params?._collectedPrompt === 1 && params?._collectedCategory !== 'general' && typeof chain.basePrompt === 'string' ? chain.basePrompt : null;
}
