import { expect, it } from 'vitest';
import {
  LAB_SUBJECT_PURPOSES, LAB_PICTURE_PURPOSES, LAB_STYLE_PURPOSES,
  countRollLabCharacters, defaultPurposeRollParticipation,
} from '../../services/labPromptLayout';
import { PROMPT_PURPOSE_IDS, purposeSectionKey } from '../../services/promptPurposes.mjs';
it('实验室三类用途完整且互不重复，不新增呈现形式Tag', () => {
  const all = [...LAB_SUBJECT_PURPOSES, ...LAB_PICTURE_PURPOSES, ...LAB_STYLE_PURPOSES];
  expect(all).toHaveLength(16); expect(new Set(all).size).toBe(16);
  expect([...all].sort()).toEqual([...PROMPT_PURPOSE_IDS].sort());
});

it('实验室启用角色数：无参数不门禁，停用角色不计入，可到模型上限', () => {
  expect(countRollLabCharacters(null)).toBeNull();
  expect(countRollLabCharacters(undefined)).toBeNull();
  expect(countRollLabCharacters({})).toBe(0);
  expect(countRollLabCharacters({ characters: [{}, { enabled: true }, { enabled: false }] })).toBe(2);
  expect(countRollLabCharacters({ characters: Array.from({ length: 10 }, () => ({})) })).toBe(10);
});

it('互动默认参与：未知人数或≥2 人开启，不足两人关闭；其他用途不受影响', () => {
  const interaction = purposeSectionKey('interaction');
  expect(defaultPurposeRollParticipation(interaction, null)).toBe(true);
  expect(defaultPurposeRollParticipation(interaction, 0)).toBe(false);
  expect(defaultPurposeRollParticipation(interaction, 1)).toBe(false);
  expect(defaultPurposeRollParticipation(interaction, 2)).toBe(true);
  expect(defaultPurposeRollParticipation(interaction, 6)).toBe(true);
  expect(defaultPurposeRollParticipation(`character:${interaction}`, 1)).toBe(false);
  expect(defaultPurposeRollParticipation(purposeSectionKey('pose'), 1)).toBe(true);
  expect(defaultPurposeRollParticipation(purposeSectionKey('place'), 0)).toBe(true);
});
