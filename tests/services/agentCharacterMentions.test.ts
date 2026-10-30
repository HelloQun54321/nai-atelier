import { describe, expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { findCharacterMention, matchCatalogCharacters, matchCustomCharacters, matchLooseCatalogEntries, mergeCharacterMentionOptions, toAgentCharacterReference, CHARACTER_CATALOG_MARKER } from '../../services/agentCharacterMentions';

const chain = (overrides: Partial<PromptChain> & { id: string; name: string }): PromptChain => ({
  userId: '',
  type: 'character',
  description: '',
  tags: [],
  basePrompt: '',
  negativePrompt: '',
  modules: [],
  params: {} as PromptChain['params'],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const furina = chain({ id: 'custom-furina', name: '芙宁娜', basePrompt: 'furina (genshin impact), blue eyes', negativePrompt: 'bad hands', description: '水神', updatedAt: 20 });
const hutao = chain({ id: 'catalog-hutao', name: '胡桃', basePrompt: 'hu tao (genshin impact), brown hair', tags: [CHARACTER_CATALOG_MARKER], params: { _characterCatalogTag: 'hu tao' } as PromptChain['params'], updatedAt: 10 });
const raiden = chain({ id: 'custom-raiden', name: '雷电将军', basePrompt: 'raiden shogun', updatedAt: 30 });

describe('findCharacterMention', () => {
  it('只在行首或空白后的 @ 触发，并给出替换区间', () => {
    expect(findCharacterMention('请用 @芙', 5)).toEqual({ start: 3, end: 5, query: '芙' });
    expect(findCharacterMention('@胡桃', 3)).toEqual({ start: 0, end: 3, query: '胡桃' });
    expect(findCharacterMention('（@芙', 3)).toEqual({ start: 1, end: 3, query: '芙' });
    expect(findCharacterMention('邮件 a@b.com', 9)).toBeNull();
    expect(findCharacterMention('普通文本', 4)).toBeNull();
    expect(findCharacterMention('请用 @芙宁娜 画', 8)).toBeNull();
    expect(findCharacterMention('请用 @', 4)).toMatchObject({ start: 3, query: '' });
  });
});

describe('角色库候选', () => {
  it('自定义角色按名称、角色 Tag 和描述匹配，词库记录不重复出现在自定义目录', () => {
    expect(matchCustomCharacters([furina, hutao, raiden], '芙').map(item => item.name)).toEqual(['芙宁娜']);
    expect(matchCustomCharacters([furina, hutao, raiden], 'genshin').map(item => item.name)).toEqual(['芙宁娜']);
    expect(matchCustomCharacters([furina, hutao, raiden], '胡桃')).toEqual([]);
    expect(matchCustomCharacters([furina, hutao, raiden], '').map(item => item.name)).toEqual(['雷电将军', '芙宁娜']);
    expect(matchCustomCharacters([furina], '芙')[0]).toMatchObject({ source: 'custom', tag: 'furina (genshin impact), blue eyes', prompt: 'furina (genshin impact), blue eyes', negativePrompt: 'bad hands' });
  });

  it('名称命中排在仅提示词命中的自定义角色之前', () => {
    const blue = chain({ id: 'custom-blue', name: 'Blue', basePrompt: 'blue archive girl' });
    const result = matchCustomCharacters([furina, blue], 'blue');
    expect(result.map(item => [item.name, item.nameMatched])).toEqual([['Blue', true], ['芙宁娜', false]]);
  });

  it('英文去掉空白后比对词库角色，中文仍走词库索引', () => {
    const entries = [{ name: 'hu tao', chinese: '胡桃', postCount: 500 }, { name: 'furina (genshin impact)', chinese: '芙宁娜', postCount: 400 }];
    expect(matchLooseCatalogEntries(entries, 'hutao').map(entry => entry.name)).toEqual(['hu tao']);
    expect(matchLooseCatalogEntries(entries, 'huta').map(entry => entry.name)).toEqual(['hu tao']);
    expect(matchLooseCatalogEntries(entries, 'genshin impact').map(entry => entry.name)).toEqual(['furina (genshin impact)']);
    expect(matchLooseCatalogEntries(entries, '胡桃')).toEqual([]);
    expect(matchLooseCatalogEntries(entries, '  ')).toEqual([]);
  });

  it('词库角色优先取已有个人配方，没有配方时只带名称与中文名', () => {
    const [withRecipe] = matchCatalogCharacters([hutao], [{ name: 'hu tao', chinese: '胡桃', postCount: 123 }], 4);
    expect(withRecipe).toMatchObject({ source: 'catalog', name: '胡桃', tag: 'hu tao', prompt: 'hu tao (genshin impact), brown hair' });
    const [bare] = matchCatalogCharacters([], [{ name: 'hu tao', chinese: '胡桃', postCount: 123 }], 4);
    expect(bare).toMatchObject({ source: 'catalog', name: '胡桃', tag: 'hu tao', postCount: 123 });
    expect(bare.prompt).toBeUndefined();
  });

  it('合并时自定义角色优先并按标签去重，引用对象不带内部显示字段', () => {
    const custom = matchCustomCharacters([furina], '芙');
    const catalog = matchCatalogCharacters([], [{ name: 'furina', chinese: '芙宁娜', postCount: 9 }], 4);
    const merged = mergeCharacterMentionOptions(custom, catalog, 8);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('custom');
    const reference = toAgentCharacterReference(merged[0]);
    expect(reference).not.toHaveProperty('detail');
    expect(reference).toMatchObject({ source: 'custom', name: '芙宁娜', prompt: 'furina (genshin impact), blue eyes' });
  });

  it('只有提示词命中的自定义角色排在词库候选之后', () => {
    const promptMatch = matchCustomCharacters([furina], 'blue')[0];
    const catalog = matchCatalogCharacters([], [{ name: 'hu tao', chinese: '胡桃', postCount: 9 }], 4);
    const merged = mergeCharacterMentionOptions([promptMatch], catalog, 8);
    expect(merged.map(item => item.source)).toEqual(['catalog', 'custom']);
    expect(toAgentCharacterReference(merged[1])).not.toHaveProperty('nameMatched');
  });
});
