import type { CharacterReferenceSelection } from '../types';

/**
 * 与官方 Precise Reference 的 Description 下拉保持一致（None / Character / Style /
 * Costume / Character & Style / Delta）；None 对应清空，界面不提供。
 * label 是词典键，界面统一用 t() 取值。
 */
export const CHARACTER_REFERENCE_TYPES: Array<{ value: CharacterReferenceSelection['type']; label: string; hint: string }> = [
  { value: 'character', label: '角色', hint: '保留人物身份与外观' },
  { value: 'style', label: '画风', hint: '参考图像的风格表现' },
  { value: 'costume', label: '服装', hint: '服装与配饰' },
  { value: 'character_style', label: '角色与画风', hint: '同时参考人物和风格' },
  { value: 'delta', label: '变化', hint: '变化量' },
];

/** 未知或旧值按官方默认的「角色与画风」显示，与新建参考的默认类型一致。 */
export const characterReferenceTypeLabel = (type: string) =>
  CHARACTER_REFERENCE_TYPES.find(item => item.value === type)?.label ?? '角色与画风';
