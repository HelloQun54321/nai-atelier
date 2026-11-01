import type { PromptChain } from '../types';
import { combinationPicks, isPromptLibraryCharacterProjection, librarySectionOf, projectCustomCharacterAsCombination } from './promptLibraryEntries';
import { isContentRecord } from './contentRoll';
import { createDefaultRollTemplate, type RollTemplate } from './styleRoll';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from './naiRuntime';

/** 提示词库封面生成模板；与画师／Roll 模板独立存储。 */
export type PromptLibraryCoverTemplate = RollTemplate;

export const PROMPT_LIBRARY_COVER_CHANGED = 'nai-prompt-library-cover-changed';

export const broadcastPromptLibraryCoverChanged = (chainId: string, previewImage: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROMPT_LIBRARY_COVER_CHANGED, { detail: { chainId, previewImage } }));
};

/** 默认从 Roll 推荐模板派生，仅把 `{style}` 换成 `{content}`，避免空配置无法生成。 */
export const getDefaultPromptLibraryCoverTemplate = (runtime: NaiRuntimeConfig = DEFAULT_NAI_RUNTIME): PromptLibraryCoverTemplate => {
  const template = createDefaultRollTemplate(runtime);
  return { ...template, prompt: template.prompt.replace('{style}', '{content}') };
};

/** 片段用 basePrompt；组合／角色投影把已填栏位正词拼成一段。 */
export function promptLibraryCoverContent(chain: PromptChain): string {
  const source = isPromptLibraryCharacterProjection(chain) ? projectCustomCharacterAsCombination(chain)
    : isContentRecord(chain) || librarySectionOf(chain) === 'saved' ? chain : null;
  if (source) {
    return Object.values(combinationPicks(source))
      .filter(row => row?.filled && String(row.text || '').trim())
      .map(row => String(row.text).trim())
      .join(', ');
  }
  return String(chain.basePrompt || '').trim();
}

export function validatePromptLibraryCoverPlaceholders(template: PromptLibraryCoverTemplate): void {
  const prompt = template?.prompt;
  const character = template?.characterPrompt;
  if (typeof prompt !== 'string' || prompt.length > 32_000 || typeof template.negativePrompt !== 'string' || template.negativePrompt.length > 32_000 ||
    (character !== undefined && (typeof character !== 'string' || character.length > 32_000)) ||
    prompt.split('{content}').length !== 2 || prompt.split('{character}').length > 2 ||
    (typeof character === 'string' && /\{(?:content|character)\}/.test(character))) {
    throw new Error('公共提示词需要且只能包含一个 {content} 占位符，角色提示词不能包含替换位');
  }
}

export function validatePromptLibraryCoverTemplate(template: PromptLibraryCoverTemplate): void {
  validatePromptLibraryCoverPlaceholders(template);
  const params = template.params;
  if (!params || typeof params.model !== 'string' || !/^nai-diffusion-(?:4|4-5|5)-/.test(params.model) || params.model.endsWith('-inpainting') ||
    !Number.isSafeInteger(params.seed) || params.seed! < 0 || params.seed! > 4294967295 ||
    ![params.width, params.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096 && value % 64 === 0) ||
    !Number.isSafeInteger(params.steps) || params.steps < 1 || params.steps > 50 || !Number.isFinite(params.scale) || params.scale < 0 || params.scale > 10 ||
    typeof params.sampler !== 'string' || params.sampler.length > 100) throw new Error('请设置有效的文生图参数与固定 Seed');
}

/** 模板自带负面／参数；条目负面不覆盖模板 UC。 */
export function buildPromptLibraryCoverPrompt(template: PromptLibraryCoverTemplate, content: string): string {
  validatePromptLibraryCoverPlaceholders(template);
  const body = content.trim();
  if (!body) throw new Error('这条记录还没有正文，无法生成封面');
  const character = template.characterPrompt?.trim() || '';
  return template.prompt.includes('{character}')
    ? template.prompt.replace('{character}', character).replace('{content}', body)
    : template.prompt.replace('{content}', character ? `${body}, ${character}` : body);
}
