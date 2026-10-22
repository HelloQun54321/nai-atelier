import { describe, expect, it } from 'vitest';
import { applyPromptClassification, getClassificationDocuments } from '../../services/promptClassificationDraft';
import { getEditableGlobalNegative } from '../../services/promptUtils';
import { compileCharacterContent } from '../../services/characterPrompts';
import type { PromptAgentDraft } from '../../types';

const draft: PromptAgentDraft = { basePrompt: 'artist:test, red dress', subjectPrompt: '', negativePrompt: 'lowres', modules: [], params: {
  model: 'synthetic', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42,
  characters: [{ id: 'role', prompt: 'blue hair, smile, 1girl', negativePrompt: 'closed eyes', enabled: false, x: 0.2, y: 0.8 }],
} };

describe('导入提示词分类', () => {
  it('只发送未分类的正词，不发送负面、参数或图片；已有分类直接恢复', () => {
    expect(getClassificationDocuments(draft)).toEqual([{ id: 'global', kind: 'global', prompt: draft.basePrompt }, { id: 'role', kind: 'character', prompt: draft.params.characters![0].prompt }]);
    expect(getClassificationDocuments({ ...draft, params: { ...draft.params, _promptSections: { wardrobe: 'red dress' }, characters: [{ ...draft.params.characters![0], sections: { appearance: 'blue hair' } }] } })).toEqual([]);
  });
  it('分类只改变正词归属，保留角色、坐标、启用状态、负面与全部参数', () => {
    const result = applyPromptClassification(draft, [{ id: 'global', kind: 'global', sections: { style: 'artist:test', wardrobe: 'red dress' } }, { id: 'role', kind: 'character', sections: { appearance: 'blue hair', expression: 'smile', extra: '1girl' } }]);
    expect(result.basePrompt).toBe('artist:test'); expect(result.subjectPrompt).toBe('red dress');
    expect(result.params).toEqual({ ...draft.params, _promptSections: { wardrobe: 'red dress' }, characters: [{ ...draft.params.characters![0], prompt: '1girl', sections: { appearance: 'blue hair', expression: 'smile' }, sectionMeta: { appearance: { source: 'ai' }, expression: { source: 'ai' } } }] });
    expect(result.negativePrompt).toBe('lowres'); expect(draft.basePrompt).toBe('artist:test, red dress');
  });
  it('整段模式包含生效的分类负面，空栏负面不复活', () => {
    expect(getEditableGlobalNegative('lowres', { scene: 'forest', camera: '', sectionNegatives: { scene: 'city', camera: 'wide shot' } })).toBe('lowres, city');
  });
  it('AI 分类后的角色进入真实请求时仍保留重复词，不带出旧分类负面', () => {
    const result = applyPromptClassification(draft, [{ id: 'role', kind: 'character', sections: { appearance: 'blue hair, blue hair', extra: 'smile' } }]);
    expect(compileCharacterContent(result.params.characters![0], { 'role::appearance': 'old negative' })).toMatchObject({ prompt: 'blue hair, blue hair, smile', negativePrompt: 'closed eyes' });
  });
});
