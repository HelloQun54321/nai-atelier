import { purposeSectionKey, type PromptPurposeId } from './promptPurposes.mjs';

/** 实验室 Roll 的选材范围；版式与画风保留按需手动勾选，默认不参与常规随机。 */
export const LAB_SUBJECT_PURPOSES = ['appearance', 'clothing', 'pose', 'expression'] as const satisfies readonly PromptPurposeId[];
export const LAB_PICTURE_PURPOSES = ['interaction', 'place', 'atmosphere', 'camera', 'format'] as const satisfies readonly PromptPurposeId[];
export const LAB_STYLE_PURPOSES = ['style'] as const satisfies readonly PromptPurposeId[];

/** 互动用途需要至少两名启用角色才默认参与抽取。 */
export const INTERACTION_MIN_CHARACTERS = 2;

const INTERACTION_SECTION = purposeSectionKey('interaction');
const LOW_FREQUENCY_ROLL_SECTIONS = new Set<string>([purposeSectionKey('format'), purposeSectionKey('style')]);

/** 统计实验室当前启用角色数；无实验室参数时返回 null（不按人数门禁）。 */
export function countRollLabCharacters(params: { characters?: Array<{ enabled?: boolean }> | null } | null | undefined): number | null {
  if (!params) return null;
  return (params.characters || []).filter(character => character.enabled !== false).length;
}

/** 去掉范围前缀后的用途栏位键，与 contentRoll.rollSectionKey 对 purpose 键一致。 */
function purposeRollSectionKey(kind: string): string {
  return kind.replace(/^(global|character):(?=purpose:)/, '');
}

/**
 * 用途行默认是否参与抽取。
 * 已知人数且不足两人时，互动默认关闭，可手动勾回；版式与特效、画风配方默认不参与常规随机。
 */
export function defaultPurposeRollParticipation(kind: string, labCharacterCount: number | null): boolean {
  const key = purposeRollSectionKey(kind);
  if (LOW_FREQUENCY_ROLL_SECTIONS.has(key)) return false;
  if (key !== INTERACTION_SECTION) return true;
  return labCharacterCount === null || labCharacterCount >= INTERACTION_MIN_CHARACTERS;
}
