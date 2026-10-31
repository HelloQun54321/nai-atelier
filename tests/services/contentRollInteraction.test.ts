import { expect, it } from 'vitest';
import {
  bindingTag,
  classifyInteractionMode,
  extractInteractionActionTag,
  mergeAttributionText,
  pickOrderedCharacterPair,
  planInteractionAttribution,
} from '../../services/contentRollInteraction';
import type { RollRow } from '../../services/contentRoll';
import type { NAIParams } from '../../types';

const interaction = (text: string, id = 'inter'): Record<string, RollRow> => ({
  'purpose:interaction': { kind: 'purpose:interaction', filled: true, text, id, name: '互动' } as RollRow,
});

const params = (ids: string[]): NAIParams => ({
  characters: ids.map((id, index) => ({ id, prompt: '', x: 0.5, y: 0.5, enabled: index !== 99 })),
} as NAIParams);

it('从互动正文提取动作概念，并对等／单向分类', () => {
  expect(extractInteractionActionTag('kissing, leaning forward')).toBe('kissing');
  expect(extractInteractionActionTag('holding hands, facing each other')).toBe('holding hands');
  expect(extractInteractionActionTag('eye contact, looking at each other')).toBe('eye contact');
  expect(classifyInteractionMode('holding hands')).toBe('mutual');
  expect(classifyInteractionMode('kissing, leaning forward')).toBe('directed');
  expect(bindingTag('source', 'kissing')).toBe('source#kissing');
});

it('同一 seed 稳定抽同一对角色，不足两人不成对', () => {
  expect(pickOrderedCharacterPair(['a'], 's')).toBeNull();
  const once = pickOrderedCharacterPair(['a', 'b', 'c'], 'seed-1');
  const twice = pickOrderedCharacterPair(['a', 'b', 'c'], 'seed-1');
  expect(once).toEqual(twice);
  expect(once?.[0]).not.toBe(once?.[1]);
});

it('计划归属：单向写 source／target，对等写 mutual；停用角色不参与', () => {
  const duo = params(['c1', 'c2']);
  const directed = planInteractionAttribution(interaction('kissing, intimate'), duo, 'kiss');
  expect(directed?.mode).toBe('directed');
  expect(directed?.sourceBinding.startsWith('source#')).toBe(true);
  expect(directed?.targetBinding.startsWith('target#')).toBe(true);
  expect(directed?.sourceId).not.toBe(directed?.targetId);

  const mutual = planInteractionAttribution(interaction('holding hands'), duo, 'hands');
  expect(mutual?.mode).toBe('mutual');
  expect(mutual?.sourceBinding).toBe('mutual#holding hands');
  expect(mutual?.targetBinding).toBe('mutual#holding hands');

  expect(planInteractionAttribution(interaction('kissing'), params(['only']), 'x')).toBeNull();
  expect(planInteractionAttribution(interaction('kissing'), {
    characters: [{ id: 'a', prompt: '', x: .5, y: .5 }, { id: 'b', prompt: '', x: .5, y: .5, enabled: false }],
  } as NAIParams, 'x')).toBeNull();
});

it('归属 Tag 合并去重', () => {
  expect(mergeAttributionText('', 'source#kissing')).toBe('source#kissing');
  expect(mergeAttributionText('standing', 'source#kissing')).toBe('standing, source#kissing');
  expect(mergeAttributionText('source#kissing, smile', 'source#kissing')).toBe('source#kissing, smile');
});
