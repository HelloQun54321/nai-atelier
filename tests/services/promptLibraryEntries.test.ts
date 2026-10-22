import { describe, expect, it } from 'vitest';
import type { NAIParams, PromptChain } from '../../types';
import { applyLibraryText, combinationPicks, createCombinationData, createFragmentData, librarySectionOf, searchLibraryEntries, workspacePicks } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { applyLibrarySelection, planLibrarySelection, type PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';

const chain = (data: Partial<PromptChain>, id = 'entry') => ({ id, name: '雨夜', ...data } as PromptChain);
const combo = chain(createCombinationData('雨夜搭配', {
  wardrobe: { kind: 'wardrobe', filled: true, text: 'white dress', negative: 'black dress' },
  scene: { kind: 'scene', filled: true, text: 'rainy night', negative: 'daylight' },
}));
const state = (): PromptLibraryWorkspaceState => ({ classified: true, base: 'artist:someone', subject: 'handwritten', negative: 'lowres', params: {
  model: 'nai-diffusion-4-5-full', seed: 123, steps: 28,
  characters: [
    { id: 'one', prompt: 'first', x: 0.2, y: 0.5 },
    { id: 'two', prompt: 'second', x: 0.8, y: 0.5, sections: { wardrobe: 'old dress' }, sectionNegatives: { wardrobe: 'old negative' } },
  ],
} as NAIParams });

describe('提示词库的对象边界与定向取用', () => {
  it('原文、通用片段、六类片段和组合分开归属，旧记录无需搬移', () => {
    expect(librarySectionOf(chain(prepareCollectedPrompt(' a\r\nb ')))).toBe('originals');
    expect(librarySectionOf(chain(createFragmentData('a prop', '', 'general')))).toBe('items');
    expect(librarySectionOf(chain(createFragmentData('a dress', '', 'wardrobe')))).toBe('items');
    expect(librarySectionOf(combo)).toBe('saved');
    expect(librarySectionOf(chain({ type: 'style', basePrompt: 'a dress' }))).toBeNull();
  });
  it('原文取用逐字保留换行和权重，不把已有原文重新拆词', () => {
    const original = '  {{snow}}\r\n1.2::hair, eyes::  ';
    expect(applyLibraryText('', original, 'append', true)).toBe(original);
    expect(applyLibraryText('original', original, 'replace', true)).toBe(original);
    expect(applyLibraryText('stay', original, 'fill-missing', true)).toBe('stay');
  });
  it('名称支持中文、@和同名记录；只检索个人提示词，不把风格串混进来', () => {
    const matches = searchLibraryEntries([combo, chain(createFragmentData('rain', '雨夜', 'scene'), 'second'), chain({ name: '雨夜', type: 'style' }, 'style')], '@雨夜');
    expect(matches.map(item => item.id).sort()).toEqual(['entry', 'second']);
  });
  it('角色二取用只改变该角色所选类别与负面，不改角色一、场景、画风和参数', () => {
    const before = state();
    const after = applyLibrarySelection(planLibrarySelection(before, combo, { mode: 'existing', id: 'two' }, 'replace', { roleId: 'two', kind: 'wardrobe' }));
    expect(after.params.characters![0]).toEqual(before.params.characters![0]);
    expect(after.params.characters![1]).toMatchObject({ id: 'two', x: 0.8, prompt: 'second', sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'black dress' } });
    expect(after.params._promptSections?.scene).toBeUndefined();
    expect(after.base).toBe(before.base); expect(after.params.seed).toBe(123);
    expect(before.params.characters![1].sections?.wardrobe).toBe('old dress');
  });
  it('完整组合保持角色与全局分开；整段模式合并显示且不藏负面', () => {
    const before = { ...state(), classified: false };
    const after = applyLibrarySelection(planLibrarySelection(before, combo, { mode: 'existing', id: 'two' }, 'append'));
    expect(after.base).toContain('rainy night'); expect(after.base).not.toContain('white dress');
    expect(after.negative).toContain('daylight');
    expect(after.params.characters![1].prompt).toContain('white dress');
    expect(after.params.characters![1].negativePrompt).toContain('black dress');
    expect(after.params.characters![1].sections).toBeUndefined();
  });
  it('已删除的目标和迟到的名称补全不会改写新输入', () => {
    expect(() => applyLibrarySelection(planLibrarySelection(state(), combo, { mode: 'existing', id: 'deleted' }, 'replace'))).toThrow('目标角色');
    expect(() => planLibrarySelection(state(), combo, { mode: 'global' }, 'append', {}, 0, { value: 'old query', start: 0, end: 9, field: {} })).toThrow('提示词已改变');
    expect(() => planLibrarySelection(state(), combo, { mode: 'global' }, 'append', {}, 0, { value: '{雨夜搭配}', start: 1, end: 5, field: {} })).toThrow('权重组外');
  });
  it('保存组合只读所选角色和已知分栏，不猜测整段正文', () => {
    const params = state().params;
    expect(workspacePicks(params, 'two').wardrobe.text).toBe('old dress');
    expect(workspacePicks(params, 'one')).toEqual({});
  });
  it('组合编辑再保存保留来源和分类负面，新建角色不改动已有角色分栏', () => {
    const original = chain(createCombinationData('白裙', { wardrobe: { kind: 'wardrobe', id: 'dress', name: '白裙片段', filled: true, text: 'white dress', negative: 'red dress', constraintNotes: '保留备注' } }));
    const picks = combinationPicks(chain(createCombinationData('副本', combinationPicks(original))));
    expect(picks.wardrobe).toMatchObject({ id: 'dress', name: '白裙片段', negative: 'red dress', constraintNotes: '保留备注' });
    const before = { ...state(), classified: false };
    const after = applyLibrarySelection(planLibrarySelection(before, combo, { mode: 'new' }, 'append'));
    expect(after.params.characters!.slice(0, 2)).toEqual(before.params.characters);
    expect(after.params.characters![2].prompt).toContain('white dress');
    expect(after.params.characters![2].negativePrompt).toContain('black dress');
  });
});
