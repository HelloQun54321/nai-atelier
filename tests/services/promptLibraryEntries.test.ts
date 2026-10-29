import { describe, expect, it } from 'vitest';
import type { NAIParams, PromptChain } from '../../types';
import { applyLibraryText, combinationPicks, createCombinationData, createFragmentData, librarySectionOf, libraryEntryText, searchLibraryEntries, workspacePicks, parsePromptLibraryTags } from '../../services/promptLibraryEntries';
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
  it('组合只保存用户填写的标签，去掉空白和重复且允许不分类', () => {
    expect(parsePromptLibraryTags(' 雨夜，动作\n雨夜, , 动作\r\n个人分类 ')).toEqual(['雨夜', '动作', '个人分类']);
    expect(parsePromptLibraryTags(' ,，\n')).toEqual([]);
    const picks = { scene: { kind: 'scene', filled: true, text: 'rain' } };
    expect(createCombinationData('雨夜', picks, [' 夜景 ', '夜景']).tags).toEqual(['夜景']);
    expect(createCombinationData('雨夜', picks).tags).toEqual([]);
  });
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

it('自定义目录片段与组合保留正文、目录路径和真实存储范围', () => {
  const directories = { revision: 1, nodes: [{ id: 'custom', parentId: null, name: '道具', target: 'global' as const }] };
  const entry = chain(createFragmentData('silver sword', '剑', 'general', '', ['custom']));
  expect(librarySectionOf(entry)).toBe('items');
  expect((entry.params as unknown as Record<string, unknown>)._promptLibraryDirectoryIds).toEqual(['custom']);
  const params = { _promptSections: { 'directory:custom': 'sword', sectionNegatives: { 'directory:custom': 'axe' } }, characters: [{ id: 'one', sections: { 'directory:costume': 'cape' } }] } as unknown as NAIParams;
  const picks = workspacePicks(params, 'one', directories);
  expect(picks['global:directory:custom']).toMatchObject({ scope: 'global', directoryName: '道具', text: 'sword', negative: 'axe' });
  expect(picks['character:directory:costume']).toMatchObject({ scope: 'character', text: 'cape' });
  const saved = chain(createCombinationData('道具组合', picks));
  expect(libraryEntryText(saved)).toBe('sword, cape');
  expect(libraryEntryText(saved, { directoryId: 'custom', negative: true })).toBe('axe');
  expect(combinationPicks(saved)['global:directory:custom']).toMatchObject({ directoryId: 'custom', directoryPath: ['道具'] });
});

it('同一目录同时存于全局和所选角色时分别保存，保留两份输入', () => {
  const params = { _promptSections: { 'directory:shared': 'global sword' }, characters: [{ id: 'one', sections: { 'directory:shared': 'character sword' } }] } as unknown as NAIParams;
  const before = JSON.stringify(params);
  expect(Object.keys(workspacePicks(params, 'one'))).toEqual(['global:directory:shared', 'character:directory:shared']);
  expect(JSON.stringify(params)).toBe(before);
  expect(workspacePicks(params)['global:directory:shared'].text).toBe('global sword');
});

const scopedCombination = () => {
  const params = { _promptSections: { 'purpose:clothing': 'global cape', sectionNegatives: { 'purpose:clothing': 'global negative' } }, characters: [
    { id: 'one', prompt: 'keep one', sections: { 'purpose:clothing': 'one dress' } },
    { id: 'two', prompt: 'keep two', sections: { 'purpose:clothing': 'two dress' }, sectionNegatives: { 'purpose:clothing': 'two negative' } },
  ] } as unknown as NAIParams;
  return chain(createCombinationData('同用途两个落点', workspacePicks(params, 'two')));
};
it('同用途两落点组合以独立身份保存读回，正文负面与canonical用途完整保留', () => {
  const saved = scopedCombination();
  const snapshot = (saved.params as any)._rollContentSnapshot;
  expect(snapshot.version).toBe(2);
  expect(snapshot.items.map((item: any) => [item.itemId, item.unitId, item.scope, item.text, item.negative])).toEqual([
    ['global:purpose:clothing', 'purpose:clothing', 'global', 'global cape', 'global negative'],
    ['character:purpose:clothing', 'purpose:clothing', 'character', 'two dress', 'two negative'],
  ]);
  const picks = combinationPicks(saved);
  expect(Object.keys(picks)).toEqual(['global:purpose:clothing', 'character:purpose:clothing']);
  expect(Object.values(picks).map(row => row.kind)).toEqual(['purpose:clothing', 'purpose:clothing']);
  expect(libraryEntryText(saved, { purposeId: 'clothing' })).toBe('global cape, two dress');
  expect(libraryEntryText(saved, { purposeId: 'clothing', negative: true })).toBe('global negative, two negative');
  expect(combinationPicks(chain(createCombinationData('再次保存', picks)))).toEqual(picks);
});
it.each(['replace', 'append', 'fill-missing'] as const)('整组合%s按分项scope写回全局与指定角色，不互相覆盖', mode => {
  const before = state();
  const after = applyLibrarySelection(planLibrarySelection(before, scopedCombination(), { mode: 'existing', id: 'two' }, mode));
  expect((after.params._promptSections as any)['purpose:clothing']).toBe('global cape');
  expect((after.params._promptSections?.sectionNegatives as any)['purpose:clothing']).toBe('global negative');
  expect((after.params.characters![1].sections as any)['purpose:clothing']).toBe('two dress');
  expect((after.params.characters![1].sectionNegatives as any)['purpose:clothing']).toBe('two negative');
  expect(after.params.characters![0]).toEqual(before.params.characters![0]);
  expect(after.params.seed).toBe(123);
});
it('明确全局或角色用途入口合入两份同用途正文和负面，不静默覆盖', () => {
  const saved = scopedCombination();
  const global = applyLibrarySelection(planLibrarySelection(state(), saved, { mode: 'global' }, 'replace'));
  expect((global.params._promptSections as any)['purpose:clothing']).toBe('global cape, two dress');
  expect((global.params._promptSections?.sectionNegatives as any)['purpose:clothing']).toBe('global negative, two negative');
  const role = applyLibrarySelection(planLibrarySelection(state(), saved, { mode: 'existing', id: 'two' }, 'replace', { purposeId: 'clothing', roleId: 'two' }));
  expect((role.params.characters![1].sections as any)['purpose:clothing']).toBe('global cape, two dress');
  expect((role.params.characters![1].sectionNegatives as any)['purpose:clothing']).toBe('global negative, two negative');
});
it('旧v2同用途不同scope未含itemId仍独立读回；旧多人组合依roleIndex选择', () => {
  const saved = scopedCombination();
  const snapshot = (saved.params as any)._rollContentSnapshot;
  snapshot.items.forEach((item: any) => delete item.itemId);
  expect(Object.keys(combinationPicks(saved))).toEqual(['global:purpose:clothing', 'character:purpose:clothing']);
  const legacy = chain({ params: { _rollContentSnapshot: { format: 'nai-roll-content', version: 1, roles: [
    { key: 'one', provided: { wardrobe: true }, sections: { wardrobe: 'first dress' } },
    { key: 'two', provided: { wardrobe: true }, sections: { wardrobe: 'second dress' } },
  ], global: {} } } as any });
  expect(combinationPicks(legacy, 1).wardrobe.text).toBe('second dress');
});

it('仅填空白按目标落点独立处理，不因另一落点已填而丢掉待填项目', () => {
  const before = state();
  before.params._promptSections = { 'purpose:clothing': 'keep global' } as any;
  before.subject = 'keep global';
  const selection = planLibrarySelection(before, scopedCombination(), { mode: 'existing', id: 'two' }, 'fill-missing');
  expect(selection.plan.written).toContain('character:purpose:clothing');
  const after = applyLibrarySelection(selection);
  expect((after.params._promptSections as any)['purpose:clothing']).toBe('keep global');
  expect((after.params.characters![1].sections as any)['purpose:clothing']).toBe('two dress');
});
it('压到单目标时按原顺序保留权重组与重复原词，不擅自拆删', () => {
  const picks = {
    'global:purpose:clothing': { kind: 'purpose:clothing', scope: 'global' as const, filled: true, text: '{red, cape}, red', negative: '[blue, coat]' },
    'character:purpose:clothing': { kind: 'purpose:clothing', scope: 'character' as const, filled: true, text: 'red, 1.2::dress::', negative: 'blue, coat' },
  };
  const saved = chain(createCombinationData('weighted', picks));
  const after = applyLibrarySelection(planLibrarySelection(state(), saved, { mode: 'global' }, 'replace'));
  expect((after.params._promptSections as any)['purpose:clothing']).toBe('{red, cape}, red, red, 1.2::dress::');
  expect((after.params._promptSections?.sectionNegatives as any)['purpose:clothing']).toBe('[blue, coat], blue, coat');
});
