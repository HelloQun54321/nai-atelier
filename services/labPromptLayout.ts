import type { PromptPurposeId } from './promptPurposes.mjs';

/** 实验室 Roll 的选材范围；画风配方保留在完整配方中，不参与随机。 */
export const LAB_SUBJECT_PURPOSES = ['identity', 'appearance', 'clothing', 'pose', 'expression', 'creature', 'object', 'vehicle'] as const satisfies readonly PromptPurposeId[];
export const LAB_PICTURE_PURPOSES = ['interaction', 'place', 'nature', 'time', 'composition', 'camera', 'text'] as const satisfies readonly PromptPurposeId[];
export const LAB_STYLE_PURPOSES = ['style'] as const satisfies readonly PromptPurposeId[];
