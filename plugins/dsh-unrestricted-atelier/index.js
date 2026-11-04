import { EXECUTION_MODE_BLOCK, APPEARANCE_TAG_BLOCK } from './rules.js';

export const name = 'dsh-unrestricted-atelier';
export const inject = ['atelier'];
export function apply(ctx) {
  ctx.atelier.registerPromptBlock({ id: 'local_execution', title: '本地执行规则', text: EXECUTION_MODE_BLOCK });
  ctx.atelier.registerPromptBlock({ id: 'appearance_tags', title: '非性化外观标签', text: APPEARANCE_TAG_BLOCK });
}
