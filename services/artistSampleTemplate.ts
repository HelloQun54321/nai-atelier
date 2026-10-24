import type { ArtistSampleTemplate } from './artistSamples';
import type { RollTemplate } from './styleRoll';

/** 只转换当前草稿的替换位，旧存储与周围原词、权重保持原样。 */
export function normalizeArtistSampleTemplate(template: ArtistSampleTemplate): RollTemplate {
  return { ...structuredClone(template), prompt: template.prompt.replace(/artists?\s*:\s*\{artist\}|\{artist\}/gi, '{style}') };
}

/** 新模板沿用 Roll 的角色插入位置；旧模板保留直接替换 Tag 的生成语义。 */
export function buildArtistSamplePrompt(template: ArtistSampleTemplate, tag: string): string {
  if (template.prompt.includes('{style}')) {
    const style = `artist:${tag}`, character = template.characterPrompt?.trim() || '';
    // 单画师无需数字权重，避免 :: 重置占位符外层的原始权重作用域。
    return template.prompt.includes('{character}')
      ? template.prompt.replace('{character}', character).replace('{style}', style)
      : template.prompt.replace('{style}', character ? `${style}, ${character}` : style);
  }
  const prompt = template.prompt.replaceAll('{artist}', tag), character = template.characterPrompt?.trim() || '';
  return prompt.includes('{character}') ? prompt.replace('{character}', character) : character ? `${prompt}, ${character}` : prompt;
}

export function validateArtistSamplePlaceholders(template: ArtistSampleTemplate): void {
  const prompt = template?.prompt, character = template?.characterPrompt;
  if (typeof prompt !== 'string' || prompt.length > 32_000 || typeof template.negativePrompt !== 'string' || template.negativePrompt.length > 32_000 ||
    (character !== undefined && (typeof character !== 'string' || character.length > 32_000)) ||
    (prompt.split('{style}').length - 1) + (prompt.split('{artist}').length - 1) !== 1 || prompt.split('{character}').length > 2 ||
    (typeof character === 'string' && /\{(?:style|artist|character)\}/.test(character))) {
    throw new Error('公共提示词需要且只能包含一个 {style} 占位符，角色提示词不能包含替换位');
  }
}
