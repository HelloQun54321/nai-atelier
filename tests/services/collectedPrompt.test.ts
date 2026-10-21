import { expect, it } from 'vitest';
import { collectedPromptText, MAX_COLLECTED_PROMPT_LENGTH, prepareCollectedPrompt } from '../../services/collectedPrompt';
import { isContentRecord } from '../../services/contentRoll';

it('只整理名称，原文含空格、CRLF、权重和多角色标记仍逐字保留，不冒充分栏快照', () => {
  const text = '  {{snow}}, 1.2::hair::\r\ncharacter: [smile]  ';
  const data = prepareCollectedPrompt(text);
  expect(data.basePrompt).toBe(text); expect(data.name).toBe('{{snow}}, 1.2::hair::');
  expect(collectedPromptText({ ...data, type: 'preset' })).toBe(text);
  expect(collectedPromptText({ ...data, type: 'style' })).toBeNull();
  expect(isContentRecord(data)).toBe(false);
  expect(prepareCollectedPrompt(text, ' 雪天 ').name).toBe('雪天');
});

it('指定分类时直接落入六类条目库，保留原文与分类标记，未知分类拒绝', () => {
  const text = '  {{snow}}\r\n[smile]  ';
  const data = prepareCollectedPrompt(text, '雪天', 'appearance');
  expect(data.type).toBe('appearance');
  expect(data.name).toBe('雪天');
  expect(data.basePrompt).toBe(text);
  expect((data.params as unknown as Record<string, unknown>)._collectedPrompt).toBe(1);
  expect((data.params as unknown as Record<string, unknown>)._collectedCategory).toBe('appearance');
  expect(isContentRecord(data)).toBe(false);
  expect(collectedPromptText({ ...data, type: 'appearance' })).toBeNull();
  for (const category of ['style', 'preset', 'nope']) expect(() => prepareCollectedPrompt(text, '', category)).toThrow('分类无效');
});

it('拒绝非文本、全空白和超长原文，不截断保存', () => {
  for (const text of [null, {}, '', ' \r\n\t']) expect(() => prepareCollectedPrompt(text)).toThrow('请先粘贴提示词');
  expect(() => prepareCollectedPrompt('a'.repeat(MAX_COLLECTED_PROMPT_LENGTH + 1))).toThrow('提示词过长');
  expect(prepareCollectedPrompt('a'.repeat(MAX_COLLECTED_PROMPT_LENGTH)).basePrompt.length).toBe(MAX_COLLECTED_PROMPT_LENGTH);
});
