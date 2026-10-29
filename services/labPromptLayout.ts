import type { PromptPurposeId } from './promptPurposes.mjs';

/** 实验室 Roll 的选材范围；画风用途保留在完整配方中。 */
export const LAB_SUBJECT_PURPOSES = ['identity', 'appearance', 'clothing', 'pose', 'expression', 'creature', 'object', 'vehicle'] as const satisfies readonly PromptPurposeId[];
export const LAB_PICTURE_PURPOSES = ['interaction', 'place', 'nature', 'time', 'composition', 'camera', 'text'] as const satisfies readonly PromptPurposeId[];
export const LAB_STYLE_PURPOSES = ['artist', 'style', 'texture', 'effect', 'quality', 'lighting', 'color'] as const satisfies readonly PromptPurposeId[];
