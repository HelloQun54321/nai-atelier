import { expect, it } from 'vitest';
import { applyRollSelection, type PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import { compileCharacterContent } from '../../services/characterPrompts';
import type { RollPicks } from '../../services/contentRoll';
import type { NAIParams } from '../../types';
const state = (): PromptLibraryWorkspaceState => ({ base: 'artist:keep', subject: 'global handwritten', negative: 'global negative', classified: false, params: {
  model: 'nai-diffusion-4-5-full', seed: 123, characters: [
    { id: 'one', prompt: 'white dress, handwritten', negativePrompt: 'role negative', x: 0.3, y: 0.6 },
    { id: 'two', prompt: 'other role', negativePrompt: 'other negative', x: 0.7, y: 0.6 },
  ],
} as NAIParams });
const picks = (text: string, negative = ''): RollPicks => ({ 'purpose:clothing': { kind: 'purpose:clothing', scope: 'character', filled: true, text, negative } });
const target = { mode: 'existing' as const, id: 'one' };
it('Roll连续填入只替换自身用途，保留同词手写、风格、未参与用途和其他角色', () => {
  const before = state();
  const first = applyRollSelection(before, { ...picks('white dress', 'coat'), 'purpose:pose': { kind: 'purpose:pose', scope: 'character', filled: true, text: 'sitting' } }, target);
  expect(first.state.params.characters![0].prompt).toBe('white dress, handwritten, white dress, sitting');
  const second = applyRollSelection(first.state, picks('{black coat}', 'dress'), target, first.receipt);
  expect(second.state.params.characters![0].prompt).toBe('white dress, handwritten, {black coat}, sitting');
  expect(second.state.params.characters![0].negativePrompt).toBe('role negative, dress');
  expect(second.state.params.characters![1]).toEqual(before.params.characters![1]);
  expect(second.state.base).toBe(before.base); expect(second.state.subject).toBe(before.subject);
  expect(second.state.params.seed).toBe(123); expect(second.conflicts).toEqual([]);
  expect(before.params.characters![0].prompt).toBe('white dress, handwritten');
});
it('手改正向只跳过该字段，负面仍可重抽；手选追加也受同样保护', () => {
  const first = applyRollSelection(state(), picks('dress', 'coat'), target);
  const edited = { ...first.state, params: { ...first.state.params, characters: first.state.params.characters!.map(role => role.id === 'one' ? { ...role, prompt: role.prompt + ', manual addition' } : role) } };
  const next = applyRollSelection(edited, picks('new dress', 'new negative'), target, first.receipt);
  expect(next.conflicts).toEqual(['character:one:positive']);
  expect(next.state.params.characters![0].prompt).toBe(edited.params.characters![0].prompt);
  expect(next.state.params.characters![0].negativePrompt).toBe('role negative, new negative');
  expect(next.receipt.fields['character:one:positive']).toEqual(first.receipt.fields['character:one:positive']);
});
it('全局和角色身份独立、正负独立；切目标不会替换另一角色Roll', () => {
  const first = applyRollSelection(state(), { ...picks('dress'), 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'garden', negative: 'indoor' } }, target);
  const edited = { ...first.state, negative: first.state.negative + ', manual global negative' };
  const next = applyRollSelection(edited, { ...picks('coat'), 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'street', negative: 'outdoor' } }, { mode: 'existing', id: 'two' }, first.receipt);
  expect(next.state.base).toBe('artist:keep, global handwritten, street');
  expect(next.state.negative).toBe(edited.negative); expect(next.conflicts).toEqual(['global:negative']);
  expect(next.state.params.characters![0].prompt).toBe(first.state.params.characters![0].prompt);
  expect(next.state.params.characters![1].prompt).toBe('other role, coat');
});
it('未填行不动旧Roll，已填空行可清除该用途；negative-only保留正向正文', () => {
  const first = applyRollSelection(state(), picks('dress', 'coat'), target);
  const empty = applyRollSelection(first.state, { 'purpose:clothing': { kind: 'purpose:clothing', filled: false, text: '' } }, target, first.receipt);
  expect(empty.state.params.characters).toEqual(first.state.params.characters);
  const negativeOnly = applyRollSelection(first.state, picks('', 'negative only'), target, first.receipt);
  expect(negativeOnly.state.params.characters![0].prompt).toBe('white dress, handwritten');
  expect(negativeOnly.state.params.characters![0].negativePrompt).toBe('role negative, negative only');
  const cleared = applyRollSelection(negativeOnly.state, picks(''), target, negativeOnly.receipt);
  expect(cleared.state.params.characters![0].negativePrompt).toBe('role negative');
});
it('首次旧sections合并到整段，重抽不重复合并旧正负且保留参数', () => {
  const before = state(); before.classified = true;
  before.params._promptSections = { presentation: '{two panels}', sectionNegatives: { presentation: 'single panel' } }; before.subject = '{two panels}';
  before.params.characters![0] = { ...before.params.characters![0], sections: { 'purpose:pose': 'standing' }, sectionNegatives: { 'purpose:pose': 'lying' } };
  const first = applyRollSelection(before, { ...picks('dress'), 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'garden' } }, target);
  expect(first.state.base).toBe('artist:keep, {two panels}, garden');
  expect(first.state.negative).toBe('global negative, single panel');
  expect(first.state.params._promptSections).toBeUndefined();
  expect(first.state.params.characters![0].prompt).toContain('standing');
  expect(first.state.params.characters![0].negativePrompt).toContain('lying');
  expect(first.state.params.characters![0].sections).toBeUndefined();
  const next = applyRollSelection(first.state, picks('coat'), target, first.receipt);
  expect(next.conflicts).toEqual([]);
  expect(next.state.params.characters![0].prompt?.match(/standing/g)).toHaveLength(1);
  expect(next.state.base).toBe(first.state.base); expect(next.state.classified).toBe(false);
});
it('目标删除拒绝填入，预览回执与输入都不被改写', () => {
  const before = state(); const original = JSON.stringify(before);
  expect(() => applyRollSelection(before, picks('dress'), { mode: 'existing', id: 'deleted' })).toThrow('目标角色已不存在');
  expect(JSON.stringify(before)).toBe(original);
  const first = applyRollSelection(before, picks('dress'), target); const receipt = JSON.stringify(first.receipt);
  applyRollSelection(first.state, picks('coat'), target, first.receipt);
  expect(JSON.stringify(first.receipt)).toBe(receipt);
});

it('兼容新角色目标：同一回执重抽复用稳定槽位，不重复创建角色', () => {
  const before = state();
  const first = applyRollSelection(before, picks('dress'), { mode: 'new' });
  expect(first.state.params.characters).toHaveLength(3);
  const next = applyRollSelection(first.state, picks('coat'), { mode: 'new' }, first.receipt);
  expect(next.state.params.characters).toHaveLength(3);
  expect(next.state.params.characters![2].id).toBe(first.state.params.characters![2].id);
  expect(next.state.params.characters![2].prompt).toBe('coat');
});

it('明确空subject不会复活失配的过时全局sections', () => {
  const before = state(); before.subject = '';
  before.params._promptSections = { scene: 'obsolete scene', presentation: 'obsolete presentation' };
  const next = applyRollSelection(before, { 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'new scene' } }, { mode: 'global' });
  expect(next.state.base).toBe('artist:keep, new scene');
  expect(JSON.stringify(next.state)).not.toContain('obsolete');
  expect(next.receipt.fields['global:positive'].before).toBe('artist:keep');
});
it('角色旧负面只合并一次，清sections后重抽与再次编译不会重新注入legacy', () => {
  const before = state();
  before.params.characters![0] = { ...before.params.characters![0], sections: { wardrobe: 'legacy dress' } };
  const legacy = { 'one::wardrobe': 'legacy forbidden', 'two::wardrobe': 'other forbidden' };
  (before.params as NAIParams & { _characterSectionsNegatives: Record<string, string> })._characterSectionsNegatives = legacy;
  const first = applyRollSelection(before, picks('new coat', 'new negative'), target);
  expect(first.state.params.characters![0].negativePrompt?.match(/legacy forbidden/g)).toHaveLength(1);
  const next = applyRollSelection(first.state, picks('another coat', 'another negative'), target, first.receipt);
  const role = next.state.params.characters![0];
  expect(role.sections).toBeUndefined(); expect(role.sectionNegatives).toBeUndefined();
  expect(compileCharacterContent(role, legacy).negativePrompt?.match(/legacy forbidden/g)).toHaveLength(1);
  expect(compileCharacterContent({ ...role, negativePrompt: 'user cleared legacy' }, legacy).negativePrompt).toBe('user cleared legacy');
  expect(next.state.params.characters![1]).toEqual(before.params.characters![1]);
  expect((next.state.params as NAIParams & { _characterSectionsNegatives: Record<string, string> })._characterSectionsNegatives).toEqual(legacy);
});
