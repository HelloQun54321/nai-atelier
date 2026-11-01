import { expect, it } from 'vitest';
import {
  buildPromptLibraryCoverPrompt, getDefaultPromptLibraryCoverTemplate, promptLibraryCoverContent,
  validatePromptLibraryCoverTemplate,
} from '../../services/promptLibraryCoverTemplate';
import { createCombinationData } from '../../services/promptLibraryEntries';
import type { PromptChain } from '../../types';

it('默认模板把 {style} 换成恰好一个 {content}', () => {
  const template = getDefaultPromptLibraryCoverTemplate();
  expect(template.prompt.split('{content}')).toHaveLength(2);
  expect(template.prompt).not.toContain('{style}');
  expect(() => validatePromptLibraryCoverTemplate(template)).not.toThrow();
});

it('片段用 basePrompt 填 {content}，条目负面不覆盖模板 UC', () => {
  const template = { ...getDefaultPromptLibraryCoverTemplate(), negativePrompt: 'template-uc', characterPrompt: '1girl' };
  const prompt = buildPromptLibraryCoverPrompt(template, 'soft light, outdoors');
  expect(prompt).toContain('soft light, outdoors');
  expect(prompt).toContain('1girl');
  expect(prompt).not.toContain('{content}');
});

it('组合把已填栏位正词拼进 {content}，空正文拒绝生成', () => {
  const combination = { id: 'combo', ...createCombinationData('夜景', {
    scene: { kind: 'scene', filled: true, text: 'night sky' },
    camera: { kind: 'camera', filled: true, text: 'from below' },
  }) } as PromptChain;
  expect(promptLibraryCoverContent(combination)).toBe('night sky, from below');
  expect(promptLibraryCoverContent({ id: 'empty', type: 'preset', basePrompt: '  ', tags: [], params: {} } as unknown as PromptChain)).toBe('');
  expect(() => buildPromptLibraryCoverPrompt(getDefaultPromptLibraryCoverTemplate(), '  ')).toThrow('还没有正文');
});

it('公共正向必须恰好一个 {content}，角色栏不能再写替换位', () => {
  const template = getDefaultPromptLibraryCoverTemplate();
  expect(() => validatePromptLibraryCoverTemplate({ ...template, prompt: 'no placeholder' })).toThrow('{content}');
  expect(() => validatePromptLibraryCoverTemplate({ ...template, prompt: '{content} and {content}' })).toThrow('{content}');
  expect(() => validatePromptLibraryCoverTemplate({ ...template, characterPrompt: '{content}' })).toThrow('角色提示词');
});
