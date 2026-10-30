import { expect, it } from 'vitest';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES, getEntryPurposes, getPromptPurposeCandidateStatus, normalizePromptPurposeSectionKey, promptPurposeLabel, readPromptPurposes, selectPurposeEntries, isCreativeSectionKey, isPurposeSectionKey } from '../../services/promptPurposes.mjs';
import { draw } from '../../services/contentRollDraw';
import { contentRead, contentSnapshotOf } from '../../services/contentRoll';
import { planContentRollApply, applyContentRollToParams } from '../../services/contentRollApply';
import { compileCharacterContent } from '../../services/characterPrompts';
import { mergePromptSections, LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import { libraryEntryText } from '../../services/promptLibraryEntries';
import { buildExtractedChainPayload } from '../../services/extractedPromptEntry';
import { normalizeExtractDraft, createEmptyExtractDraft } from '../../services/promptExtractDraft';
import type { PromptChain } from '../../types';

const entry = (id: string, purposes?: string[]) => ({ id, type: 'preset', name: id, basePrompt: '{{white dress}}', negativePrompt: 'hat', params: { _promptLibraryDirectoryIds: ['anything'], ...(purposes ? { _promptLibraryPurposes: purposes } : {}) } }) as unknown as PromptChain;

it('单用途候选状态区分真实排除原因，纯池与状态一致且不改正文或标注', () => {
  const entries = [
    entry('pure', ['clothing']), entry('unmarked'), entry('mixed', ['clothing', 'expression']),
    { ...entry('negative', ['clothing']), params: { ...entry('negative', ['clothing']).params, _promptLibraryPolarity: 'negative' } },
    { ...entry('empty', ['clothing']), basePrompt: ' \n ' },
    { ...entry('original', ['clothing']), params: { _collectedPrompt: 1, _promptLibraryPurposes: ['clothing'] } },
    entry('other', ['pose']),
  ] as PromptChain[];
  const before = JSON.stringify(entries);
  expect(entries.map(item => getPromptPurposeCandidateStatus(item, 'clothing').reason)).toEqual([
    'eligible', 'unmarked', 'mixed', 'negative_only', 'empty_prompt', 'non_fragment', 'purpose_mismatch',
  ]);
  expect(selectPurposeEntries(entries, 'clothing', true).map(item => item.id)).toEqual(['pure']);
  expect(selectPurposeEntries(entries, 'clothing').map(item => item.id)).toEqual(['pure', 'mixed', 'negative', 'empty', 'original']);
  expect(getPromptPurposeCandidateStatus(entries[6]).eligible).toBe(true);
  expect(getPromptPurposeCandidateStatus({ ...entries[0], params: JSON.stringify(entries[0].params) }).reason).toBe('eligible');
  expect(getPromptPurposeCandidateStatus(null).reason).toBe('non_fragment');
  // 单一标注可抽并不等于程序核验了语义纯度，不能擅自拆掉正文里的其他内容。
  expect(getPromptPurposeCandidateStatus({ ...entries[0], basePrompt: 'dress, smiling' }).eligible).toBe(true);
  expect(JSON.stringify(entries)).toBe(before);
});

it('16 个稳定用途拒绝自定义值，不从目录、旧类型和自由标签猜用途', () => {
  expect(new Set(PROMPT_PURPOSES.map(item => item.id)).size).toBe(16);
  expect(readPromptPurposes(['pose', 'clothing', 'pose'])).toEqual(['clothing', 'pose']);
  // 旧版画风细项只读归并到画风配方，不批量改写用户资料。
  expect(readPromptPurposes(['artist', 'lighting', 'style', 'texture'])).toEqual(['style']);
  expect(promptPurposeLabel('lighting')).toBe('画风配方');
  expect(isPurposeSectionKey('purpose:artist')).toBe(true);
  expect(normalizePromptPurposeSectionKey('purpose:artist')).toBe('purpose:style');
  for (const invalid of [null, 'clothing', ['衣服'], ['other'], ['clothing', 'custom']]) expect(() => readPromptPurposes(invalid)).toThrow('用途 Tag 无效');
  expect(getEntryPurposes({ ...entry('old'), type: 'wardrobe', tags: ['clothing'] } as PromptChain)).toEqual([]);
  expect(isCreativeSectionKey('purpose:custom')).toBe(false);
  const entries = [entry('pure', ['clothing']), entry('mixed', ['clothing', 'pose']), entry('old')];
  const negative = { ...entry('negative', ['clothing']), params: { ...entry('negative', ['clothing']).params, _promptLibraryPolarity: 'negative' as const } };
  const original = { ...entry('original', ['clothing']), params: { _collectedPrompt: 1, _promptLibraryPurposes: ['clothing'] } } as unknown as PromptChain;
  expect(selectPurposeEntries([negative, original], 'clothing', true)).toEqual([]);
  expect(selectPurposeEntries(entries, 'clothing', true).map(item => item.id)).toEqual(['pure']);
  expect(selectPurposeEntries(entries, 'clothing').map(item => item.id)).toEqual(['pure', 'mixed']);
  expect(libraryEntryText(entries[1], { purposeId: 'clothing' })).toBe('');
  expect(libraryEntryText(entries[1])).toBe('{{white dress}}');
});

it('Roll、快照及角色/全局写入使用稳定用途键，空目录不影响选材', () => {
  const unit = { id: 'purpose:clothing', purposeId: 'clothing' as const, directoryId: '', name: '服饰与配件', path: ['服饰与配件'], scope: 'character' as const };
  const result = draw({ chains: [entry('pure', ['clothing']), entry('mixed', ['clothing', 'pose'])], units: [unit], directories: { revision: 9, nodes: [] }, seed: 'fixed' });
  expect(result.picks[unit.id].id).toBe('pure');
  const read = contentRead(contentSnapshotOf(result, 'synthetic'));
  expect(read.items[0]).toMatchObject({ unitId: 'purpose:clothing', text: '{{white dress}}', negative: 'hat' });
  const params = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'role', prompt: 'solo', x: 0.5, y: 0.5 }] };
  const role = applyContentRollToParams(params, planContentRollApply(result.picks, params, { mode: 'existing', id: 'role' }), () => 'new').params;
  expect(compileCharacterContent(role.characters![0])).toMatchObject({ prompt: '{{white dress}}, solo', negativePrompt: 'hat' });
  const global = applyContentRollToParams(params, planContentRollApply(result.picks, params, { mode: 'global' }), () => 'new').params;
  expect(mergePromptSections(global._promptSections)).toBe('{{white dress}}');
  expect(global.characters![0].prompt).toBe('solo');
});

it('提取审阅和本地草稿保留混合用途，落库不改正文', () => {
  const candidate = { id: 1, entryId: 'synthetic', kind: 'preset' as const, name: '组合片段', prompt: '1.3::dress, smiling::', original: '', directoryIds: [], purposes: ['clothing', 'expression'] as const, picked: true, needsTranslation: false, needsReview: false, reviewNote: '' };
  const restored = normalizeExtractDraft({ ...createEmptyExtractDraft(), candidates: [candidate] })!.candidates[0];
  expect(restored.purposes).toEqual(candidate.purposes);
  const payload = buildExtractedChainPayload(restored);
  expect(payload.data.params?._promptLibraryPurposes).toEqual(candidate.purposes);
  expect(payload.data.basePrompt).toBe(candidate.prompt);
});

it('五个大区完整覆盖 16 个用途且没有重复，分组不是可保存的用途', () => {
  expect(PROMPT_PURPOSE_GROUPS.map(group => group.label)).toEqual(['主体与外观', '动作与关系', '场景与环境', '镜头、构图与文字', '画风与成像']);
  const ids = PROMPT_PURPOSE_GROUPS.flatMap(group => group.purposes);
  expect(ids).toHaveLength(16);
  expect([...ids].sort()).toEqual(PROMPT_PURPOSES.map(item => item.id).sort());
  expect(() => readPromptPurposes(['subject'])).toThrow('用途 Tag 无效');
});
