import { compilePrompt } from '../../services/promptUtils';
import { describe, expect, it } from 'vitest';
import type { PromptAgentDraft } from '../../types';
import { normalizeAgentLabDraft, restoreUnchangedAgentLabFields } from '../../services/agentLabSync.mjs';
import { applyAgentPromptChange, createAgentPromptChange } from '../../services/agentPromptChanges.mjs';

const stored = () => ({
  target: { chainId: 'synthetic', mode: 'text-to-image', fingerprint: 'before' },
  basePrompt: '1.2::artist:test::', subjectPrompt: 'old subject', negativePrompt: 'blur',
  modules: [{ id: 'pre', name: 'pre', content: 'pre text', isActive: true, position: 'pre' }, { id: 'off', name: 'off', content: 'unused', isActive: false }],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler',
    _promptSections: { 'purpose:place': 'old subject', presentation: 'frame', sectionNegatives: { 'purpose:place': 'city', presentation: 'border' }, sectionMeta: { 'purpose:place': { source: 'library', entryId: 'source' } } },
    _characterSectionsNegatives: { 'alice::appearance': 'hat' },
    characters: [{ id: 'alice', prompt: 'standing', negativePrompt: 'coat', x: 0.5, y: 0.5, sections: { appearance: 'blue eyes', 'directory:test': '1.3::white shirt::, white shirt' }, sectionNegatives: { 'directory:test': 'jacket' }, sectionMeta: { 'directory:test': { source: 'library', entryId: 'character-source' } } }],
  },
}) as PromptAgentDraft;

describe('助手整段草稿与原存储一致性', () => {
  it('保留实际顺序、权重、旧用途与目录正文；规范化幂等且不改原件', () => {
    const original = stored(), copy = structuredClone(original), visible = normalizeAgentLabDraft(original);
    expect(visible.basePrompt).toBe(original.basePrompt);
    expect(visible.modules).toEqual(original.modules);
    expect(visible.subjectPrompt).toBe(original.subjectPrompt);
    expect(visible.negativePrompt).toBe('blur, city, border');
    expect(visible.params.characters![0]).toMatchObject({ prompt: 'blue eyes, 1.3::white shirt::, white shirt, standing', negativePrompt: 'hat, jacket, coat' });
    expect(visible.params._promptSections).toBeUndefined();
    expect(visible.params.characters![0].sections).toBeUndefined();
    expect(normalizeAgentLabDraft(visible)).toEqual(visible);
    expect(original).toEqual(copy);
    expect(restoreUnchangedAgentLabFields(original, visible)).toEqual(original);
  });

  it('只改参数不物化旧正文；只改全局负面不复活被删旧词', () => {
    const original = stored(), visible = normalizeAgentLabDraft(original);
    const changedParams = restoreUnchangedAgentLabFields(original, { ...visible, params: { ...visible.params, steps: 30 } });
    expect(changedParams).toEqual({ ...original, params: { ...original.params, steps: 30 } });
    const applied = restoreUnchangedAgentLabFields(original, { ...visible, negativePrompt: 'border' });
    expect(normalizeAgentLabDraft(applied).negativePrompt).toBe('border');
    expect(applied.basePrompt).toBe(original.basePrompt);
    expect(applied.modules).toEqual(original.modules);
    expect(compilePrompt(original, original.subjectPrompt)).toBe('1.2::artist:test::, pre text, old subject');
    expect(compilePrompt(applied, applied.subjectPrompt)).toBe(compilePrompt(original, original.subjectPrompt));
    expect(applied.params._promptSections?.sectionMeta).toEqual(original.params._promptSections?.sectionMeta);
    expect(applied.params.characters).toEqual(original.params.characters);
  });

  it('调整模块启用状态保留模块身份与未改旧分类来源', () => {
    const original = stored(), visible = normalizeAgentLabDraft(original);
    const modules = visible.modules.map(module => ({ ...module, isActive: false }));
    const applied = restoreUnchangedAgentLabFields(original, { ...visible, modules });
    expect(applied.modules).toEqual(modules);
    expect(applied.params).toEqual(original.params);
    expect(applied.basePrompt).toBe(original.basePrompt);
    expect(applied.subjectPrompt).toBe(original.subjectPrompt);
  });

  it('改角色任一整段保住另一正文且不重复旧分类，撤回重做恢复完整来源', () => {
    const original = stored(), proposed = normalizeAgentLabDraft(original);
    proposed.params.characters![0].negativePrompt = 'coat';
    const applied = restoreUnchangedAgentLabFields(original, proposed);
    expect(normalizeAgentLabDraft(applied).params.characters![0]).toMatchObject({ prompt: proposed.params.characters![0].prompt, negativePrompt: 'coat' });
    const change = createAgentPromptChange(original, applied, 'round');
    expect(applyAgentPromptChange(applied, change, 'undo')).toEqual(original);
    expect(applyAgentPromptChange(original, change, 'redo')).toEqual(applied);
    const manual = structuredClone(applied); manual.params.characters![0].prompt = 'later manual';
    expect(() => applyAgentPromptChange(manual, change, 'undo')).toThrow('未覆盖');
  });

  it('编辑全局正面仍保留原有全局负面与所有角色', () => {
    const original = stored(), proposed = normalizeAgentLabDraft(original);
    proposed.basePrompt = 'new complete prompt';
    const applied = restoreUnchangedAgentLabFields(original, proposed);
    expect(normalizeAgentLabDraft(applied).basePrompt).toBe('new complete prompt');
    expect(normalizeAgentLabDraft(applied).negativePrompt).toBe('blur, city, border');
    expect(applied.params.characters).toEqual(original.params.characters);
  });
});
