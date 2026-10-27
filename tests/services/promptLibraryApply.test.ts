import { describe, expect, it } from 'vitest';
import type { NAIParams, PromptChain } from '../../types';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { planLibrarySelection, applyLibrarySelection, type PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import { mergePromptSections } from '../../services/labWorkspace';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import { compileCharacterContent } from '../../services/characterPrompts';

const directories = { revision: 1, nodes: [{ id: 'eyes', name: '眼睛', parentId: null, target: 'character' as const }, { id: 'light', name: '灯光', parentId: null, target: 'global' as const }] };
const state = (): PromptLibraryWorkspaceState => {
  const params = { ...LAB_DEFAULT_PARAMS, model: 'nai-diffusion-4-5-full', seed: 23, _promptSections: { extra: 'handwritten global', 'directory:light': 'old light', sectionNegatives: { 'directory:light': 'old global negative' } }, characters: [{ id: 'role', prompt: 'handwritten role', x: 0.5, y: 0.5, sections: { 'directory:eyes': 'old eyes', wardrobe: 'keep dress' }, sectionNegatives: { 'directory:eyes': 'old role negative' } }] } as NAIParams;
  return { params, base: 'artist:keep', subject: mergePromptSections(params._promptSections), negative: 'keep negative', classified: true };
};
const combination = { id: 'combo', ...createCombinationData('动态组合', {
  'directory:eyes': { kind: 'directory:eyes', directoryId: 'eyes', directoryName: '眼睛', scope: 'character', filled: true, text: 'blue eyes', negative: 'closed eyes' },
  'directory:light': { kind: 'directory:light', directoryId: 'light', directoryName: '灯光', scope: 'global', filled: true, text: 'backlight', negative: 'flat light' },
}) } as PromptChain;

describe('动态目录提示词取用', () => {
  it.each(['replace', 'append', 'fill-missing'] as const)('%s逐目录应用正负词，不修改画风、手写或生成参数', mode => {
    const before = state();
    const next = applyLibrarySelection(planLibrarySelection(before, combination, { mode: 'existing', id: 'role' }, mode));
    const eyes = next.params.characters![0].sections!['directory:eyes'];
    const light = next.params._promptSections!['directory:light'];
    expect(eyes).toBe(mode === 'replace' ? 'blue eyes' : mode === 'append' ? 'old eyes, blue eyes' : 'old eyes');
    expect(light).toBe(mode === 'replace' ? 'backlight' : mode === 'append' ? 'old light, backlight' : 'old light');
    expect(next.params.characters![0].sectionNegatives!['directory:eyes']).toBe(mode === 'replace' ? 'closed eyes' : mode === 'append' ? 'old role negative, closed eyes' : 'old role negative');
    expect(next.params._promptSections!.extra).toBe('handwritten global');
    expect(next.params.characters![0].prompt).toBe('handwritten role');
    expect(next.params.characters![0].sections!.wardrobe).toBe('keep dress');
    expect(next.params.seed).toBe(23);
    expect(next.base).toBe('artist:keep');
    expect(before.params.characters![0].sections!['directory:eyes']).toBe('old eyes');
  });
  it('当前角色取用按角色落点过滤，整段编辑仍编译目录正文和分类负面', () => {
    const before = { ...state(), classified: false };
    const next = applyLibrarySelection(planLibrarySelection(before, combination, { mode: 'existing', id: 'role' }, 'replace', { roleId: 'role' }));
    expect(next.subject).toBe(before.subject);
    const compiled = compileCharacterContent(next.params.characters![0]);
    expect(compiled.prompt).toContain('blue eyes');
    expect(compiled.prompt).toContain('handwritten role');
    expect(compiled.negativePrompt).toContain('closed eyes');
    expect(next.params.characters![0].sections).toBeUndefined();
  });
  it('单条自定义目录片段使用实时树确定来源范围，全局目标仍明确写入全局', () => {
    const entry = { id: 'fragment', type: 'preset', name: '眼睛片段', basePrompt: 'green eyes', negativePrompt: 'closed eyes', params: { _promptLibraryDirectoryIds: ['eyes'] } } as unknown as PromptChain;
    const selection = planLibrarySelection(state(), entry, { mode: 'global' }, 'replace', {}, 0, undefined, directories);
    expect(selection.plan.rows.map(row => row.kind)).toEqual(['directory:eyes']);
    const next = applyLibrarySelection(selection);
    expect(next.params._promptSections!['directory:eyes']).toBe('green eyes');
    expect(next.params.characters![0].sections!['directory:eyes']).toBe('old eyes');
  });
});
