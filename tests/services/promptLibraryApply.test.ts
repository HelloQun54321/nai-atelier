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
  it('片段按固定用途写入指定全局目标，目录不改变其语义', () => {
    const entry = { id: 'fragment', type: 'preset', name: '眼睛片段', basePrompt: 'green eyes', negativePrompt: 'closed eyes', params: { _promptLibraryDirectoryIds: ['eyes'], _promptLibraryPurposes: ['appearance'] } } as unknown as PromptChain;
    const selection = planLibrarySelection(state(), entry, { mode: 'global' }, 'replace', {}, 0, undefined, directories);
    expect(selection.plan.rows.map(row => row.kind)).toEqual(['purpose:appearance']);
    const next = applyLibrarySelection(selection);
    expect(next.params._promptSections!['purpose:appearance']).toBe('green eyes');
    expect(next.params.characters![0].sections!['directory:eyes']).toBe('old eyes');
  });
});

it('用途小区从组合只取当前用途，并按入口角色重新确定落点', () => {
  const before = state();
  const entry = { id: 'grouped', ...createCombinationData('跨目标组合', {
    'purpose:clothing': { kind: 'purpose:clothing', scope: 'global', filled: true, text: 'white dress', negative: 'coat' },
    'purpose:lighting': { kind: 'purpose:lighting', scope: 'global', filled: true, text: 'backlight' },
  }) } as PromptChain;
  const next = applyLibrarySelection(planLibrarySelection(before, entry, { mode: 'existing', id: 'role' }, 'replace', { roleId: 'role', purposeId: 'clothing' }));
  expect(next.params.characters![0].sections?.['purpose:clothing']).toBe('white dress');
  expect(next.params.characters![0].sectionNegatives?.['purpose:clothing']).toBe('coat');
  expect(next.params.characters![0].sections?.['purpose:lighting']).toBeUndefined();
  expect(next.params._promptSections).toEqual(before.params._promptSections);
  expect(next.params.characters![0].prompt).toBe(before.params.characters![0].prompt);
});
