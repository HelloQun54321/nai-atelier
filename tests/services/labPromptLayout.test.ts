import { expect, it } from 'vitest';
import { LAB_SUBJECT_PURPOSES, LAB_PICTURE_PURPOSES, LAB_STYLE_PURPOSES } from '../../services/labPromptLayout';
import { PROMPT_PURPOSE_IDS } from '../../services/promptPurposes.mjs';
it('实验室三类用途完整且互不重复，不新增呈现形式Tag', () => {
  const all = [...LAB_SUBJECT_PURPOSES, ...LAB_PICTURE_PURPOSES, ...LAB_STYLE_PURPOSES];
  expect(all).toHaveLength(22); expect(new Set(all).size).toBe(22);
  expect([...all].sort()).toEqual([...PROMPT_PURPOSE_IDS].sort());
});
