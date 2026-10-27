import { describe, expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { filterPromptBrowseEntries, promptBrowseEntries, promptBrowseSummary, type PromptBrowseFilter } from '../../services/promptLibraryBrowse';

const chain = (id: string, data: Partial<PromptChain>) => ({ id, name: id, updatedAt: 1, ...data } as PromptChain);
const defaults: PromptBrowseFilter = { scope: 'all', query: '', kind: '', tags: [], sort: 'updated' };
const fragment = chain('fragment', { ...createFragmentData('white dress', '礼服', 'wardrobe', 'black dress'), tags: ['夜晚', '正式'] });
const original = chain('original', { ...prepareCollectedPrompt('a moonlit garden', '花园'), tags: ['夜晚'], updatedAt: 3 });
const combo = chain('combo', createCombinationData('组合', { scene: { kind: 'scene', filled: true, text: 'night garden', negative: 'daylight' } }));

describe('统一提示词库检索', () => {
  it('全部汇总三种资产，排除风格串，关键词切范围不变且所有标签取交集', () => {
    const entries = promptBrowseEntries([fragment, original, combo, chain('style', { type: 'style', basePrompt: 'white dress' })]);
    expect(entries).toHaveLength(3);
    expect(filterPromptBrowseEntries(entries, { ...defaults, tags: ['夜晚', '正式'] }).map(row => row.chain.id)).toEqual(['fragment']);
    expect(filterPromptBrowseEntries(entries, { ...defaults, query: 'garden' }).map(row => row.chain.id)).toEqual(['original', 'combo']);
    expect(filterPromptBrowseEntries(entries, { ...defaults, scope: 'saved', query: 'garden' }).map(row => row.chain.id)).toEqual(['combo']);
    expect(filterPromptBrowseEntries(entries, { ...defaults, kind: 'wardrobe' }).map(row => row.chain.id)).toEqual(['fragment']);
  });
  it('检索负面和已有双语，名称命中在正文命中之前', () => {
    const bilingual = chain('bilingual', { ...createFragmentData('rain', 'daylight', 'scene'), params: { _wardrobe: { bilingual: 'rain（雨）' } } as unknown as PromptChain['params'] });
    const entries = promptBrowseEntries([fragment, combo, bilingual]);
    expect(filterPromptBrowseEntries(entries, { ...defaults, query: 'BLACK DRESS' })[0].chain.id).toBe('fragment');
    expect(filterPromptBrowseEntries(entries, { ...defaults, query: '雨' })[0].chain.id).toBe('bilingual');
    expect(filterPromptBrowseEntries(entries, { ...defaults, query: 'daylight' }).map(row => row.chain.id)).toEqual(['bilingual', 'combo']);
  });
  it('旧多人组合包含后续角色的正负词，摘要定位命中处且保留原件', () => {
    const snapshot = (combo.params as unknown as Record<string, unknown>)?._rollContentSnapshot as { roles: unknown[] };
    const multi = chain('multi', { ...combo, params: { ...combo.params, _rollContentSnapshot: { ...snapshot, roles: [
      { key: 'one', name: 'one', provided: { wardrobe: true }, sections: { wardrobe: 'first dress' } },
      { key: 'two', name: 'two', provided: { wardrobe: true }, sections: { wardrobe: 'second coat' }, negatives: { wardrobe: { text: 'forbidden coat' } } },
    ] } } as unknown as PromptChain['params'] });
    const before = JSON.stringify(multi);
    const rows = filterPromptBrowseEntries(promptBrowseEntries([multi]), { ...defaults, query: 'forbidden' });
    expect(rows).toHaveLength(1);
    expect(promptBrowseSummary(rows[0], 'forbidden')).toContain('forbidden coat');
    expect(JSON.stringify(multi)).toBe(before);
  });
  it('组合摘要展示首角色与全局真实正文，角色名称仅作为可搜索信息', () => {
    const entry = chain('content', createCombinationData('搭配', {
      wardrobe: { kind: 'wardrobe', filled: true, text: 'white dress' },
      scene: { kind: 'scene', filled: true, text: 'rainy garden' },
    }));
    const rows = promptBrowseEntries([entry]);
    expect(promptBrowseSummary(rows[0], '')).toBe('white dress, rainy garden');
    expect(filterPromptBrowseEntries(rows, { ...defaults, query: '角色 1' })).toHaveLength(1);
    expect(rows[0].summary).not.toContain('角色 1');
  });
});

it('动态目录组合正文与目录名参与检索，摘要保留真实内容', () => {
  const entry = chain('dynamic', createCombinationData('自定义组合', { 'directory:prop': { kind: 'directory:prop', directoryId: 'prop', directoryName: '道具', directoryPath: ['人物', '道具'], scope: 'character', text: 'silver sword', negative: 'axe', filled: true } }));
  const rows = promptBrowseEntries([entry]);
  expect(filterPromptBrowseEntries(rows, { ...defaults, query: '道具' })).toHaveLength(1);
  expect(filterPromptBrowseEntries(rows, { ...defaults, query: 'axe' })).toHaveLength(1);
  expect(rows[0].summary).toBe('silver sword');
});
