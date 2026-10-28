import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCollectionSourceImage: vi.fn(),
  getCoverSet: vi.fn(),
  getMobileOriginalUrl: vi.fn((url: string) => `mobile:${url}`),
}));

vi.mock('../../services/collectionFavorites', () => ({ getCollectionSourceImage: mocks.getCollectionSourceImage }));
vi.mock('../../services/danbooruService', () => ({ danbooruService: { getCoverSet: mocks.getCoverSet } }));
vi.mock('../../services/mobileImageCache', () => ({ getMobileOriginalUrl: mocks.getMobileOriginalUrl }));

import { buildCharacterVariantIndex, characterVariantFavoriteTarget, groupCharacterVariantKeys, resolveCharacterVariantMembershipKeys } from '../../services/characterVariants';
import type { CollectionImage } from '../../services/collectionFavorites';
import type { CharacterDictionaryEntry } from '../../services/tagDictionary';

const entry = (name: string): CharacterDictionaryEntry => ({ name, chinese: '', postCount: 1 });
const base = 'ulrich von hutten (azur lane)';
const variants = ['ulrich von hutten (mayhem maid) (azur lane)', 'ulrich_von_hutten (ignition matrician) (azur lane)', 'ulrich von hutten (what comes after the bell) (azur lane)', 'ulrich von hutten (liebestrank) (azur lane)'];
const catalogKey = (tag: string) => `catalog:${tag}`;
const variantIndex = () => buildCharacterVariantIndex([base, ...variants].map(entry));
const image = (sourceId: string, imageUrl = `https://${sourceId}.png`): CollectionImage => ({ sourceId, sourceType: 'character', imageUrl, title: sourceId });

beforeEach(() => {
  mocks.getCollectionSourceImage.mockReset();
  mocks.getCoverSet.mockReset();
  mocks.getMobileOriginalUrl.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('buildCharacterVariantIndex', () => {
  it('只把同基础名、同作品且基础 Tag 存在的四个变体归为一组', () => {
    const names = ['ulrich von hutten (azur lane)', ...variants];
    const index = buildCharacterVariantIndex(names.map(entry));
    expect(index.get('ulrich von hutten (liebestrank) (azur lane)')?.map(item => item.name)).toEqual(names);
  });

  it('不跨作品合并，也不猜测缺失基础 Tag、cosplay、meme 或复杂括号关系', () => {
    const names = [
      'ulrich von hutten (azur lane)', variants[0], 'ulrich von hutten (mayhem maid) (another series)',
      'ulrich von hutten (azur lane) (mayhem maid)', 'ulrich von hutten (cosplay) (azur lane)',
      'ulrich von hutten (meme) (azur lane)', 'ulrich von hutten (summer (alt)) (azur lane)',
    ];
    const index = buildCharacterVariantIndex(names.map(entry));
    expect(index.has('ulrich von hutten (mayhem maid) (another series)')).toBe(false);
    expect(index.has('ulrich von hutten (azur lane) (mayhem maid)')).toBe(false);
    expect(index.has('ulrich von hutten (cosplay) (azur lane)')).toBe(false);
    expect(index.has('ulrich von hutten (meme) (azur lane)')).toBe(false);
    expect(index.has('ulrich von hutten (summer (alt)) (azur lane)')).toBe(false);
  });
});

describe('characterVariantFavoriteTarget', () => {
  const group = variants.map((tag, index) => ({ tag, title: `胡滕变体 ${index + 1}`, prompt: `prompt ${index + 1}` }));

  it('仅大小写／下划线归一化用于定位，返回的成员 sourceId 保留原始 Tag', async () => {
    const target = characterVariantFavoriteTarget(image('ulrich_von_hutten_(liebestrank)_(azur_lane)'), group);
    expect(target.groupSourceIds).toEqual(group.map(item => item.tag));
    expect(target.sourceId).toBe('ulrich_von_hutten_(liebestrank)_(azur_lane)');
    mocks.getCoverSet.mockResolvedValue({ representative: { id: 9, sampleUrl: 'cover.png' }, candidates: [] });
    const result = await target.getGroup!();
    expect(result.map(item => item.sourceId)).toEqual(group.map(item => item.tag));
  });

  it('复用当前用户已收藏的成员，其他变体取代表封面且每个成员独立保留提示词', async () => {
    const saved = { ...image(group[0].tag, 'saved.png'), prompt: 'saved prompt' };
    mocks.getCollectionSourceImage.mockImplementation((type: string, tag: string) => type === 'character' && tag === group[0].tag ? saved : undefined);
    mocks.getCoverSet.mockResolvedValue({ representative: { id: 22, sampleUrl: 'representative.png' }, candidates: [{ id: 33, sampleUrl: 'other.png' }] });
    const result = await characterVariantFavoriteTarget(image('clicked'), group).getGroup!();
    expect(result[0]).toBe(saved);
    expect(mocks.getCoverSet).toHaveBeenCalledTimes(3);
    expect(result.slice(1).map(item => item.imageId)).toEqual(['22', '22', '22']);
    expect(result.slice(1).map(item => item.sourceId)).toEqual(group.slice(1).map(item => item.tag));
    expect(result.slice(1).map(item => item.prompt)).toEqual(['prompt 2', 'prompt 3', 'prompt 4']);
  });

  it('当前点击图优先，fixedSrc 直接使用，缺失封面时抛错', async () => {
    const groupWithFixed = group.map((item, index) => ({ ...item, ...(index === 1 ? { fixedSrc: 'fixed.png' } : {}) }));
    mocks.getCoverSet.mockResolvedValue({ representative: { id: 1, sampleUrl: 'cover.png' }, candidates: [] });
    const clicked = image(group[0].tag, 'clicked.png');
    const result = await characterVariantFavoriteTarget(clicked, groupWithFixed).getGroup!();
    expect(result[0]).toBe(clicked);
    expect(result[1].imageUrl).toBe('mobile:fixed.png');
    expect(mocks.getCoverSet).toHaveBeenCalledTimes(2);
    mocks.getCoverSet.mockResolvedValue({ representative: undefined, candidates: [] });
    await expect(characterVariantFavoriteTarget(image('other'), group.slice(0, 2)).getGroup!()).rejects.toThrow('代表封面');
  });

  it('不为单成员组构造收藏分组', () => {
    const current = image('only');
    expect(characterVariantFavoriteTarget(current, [group[0]])).toBe(current);
  });
});

describe('groupCharacterVariantKeys', () => {
  it('按首次出现位置只输出一次家族，并以范围内基础角色为代表', () => {
    const keys = [catalogKey(variants[2]), 'custom:one', catalogKey(base), catalogKey(variants[0]), catalogKey(variants[1]), catalogKey(variants[3])];
    expect(groupCharacterVariantKeys(keys, variantIndex())).toEqual([
      { id: catalogKey(base), representativeKey: catalogKey(base), memberKeys: [catalogKey(base), catalogKey(variants[2]), catalogKey(variants[0]), catalogKey(variants[1]), catalogKey(variants[3])] },
      { id: 'custom:one', representativeKey: 'custom:one', memberKeys: ['custom:one'] },
    ]);
  });

  it('基础角色不在范围时以排序首个成员代表，家族 id 仍使用原版 Tag', () => {
    const keys = [catalogKey(variants[3]), catalogKey(variants[1])];
    expect(groupCharacterVariantKeys(keys, variantIndex())).toEqual([
      { id: catalogKey(base), representativeKey: catalogKey(variants[3]), memberKeys: [catalogKey(variants[3]), catalogKey(variants[1])] },
    ]);
  });

  it('显式范围可补入尚未加载的同族成员，成员顺序沿用范围且代表排首位', () => {
    const keys = [catalogKey(variants[2])];
    const eligible = new Set([catalogKey(variants[1]), catalogKey(variants[2]), catalogKey(base), catalogKey(variants[0]), catalogKey(variants[3])]);
    expect(groupCharacterVariantKeys(keys, variantIndex(), eligible)).toEqual([
      { id: catalogKey(base), representativeKey: catalogKey(base), memberKeys: [catalogKey(base), catalogKey(variants[1]), catalogKey(variants[2]), catalogKey(variants[0]), catalogKey(variants[3])] },
    ]);
  });

  it('custom 同名身份与未知 Tag 保持独立，重复 key 只输出一次', () => {
    const keys = ['custom:first', 'custom:second', 'custom:first', catalogKey('unindexed character')];
    expect(groupCharacterVariantKeys(keys, variantIndex())).toEqual([
      { id: 'custom:first', representativeKey: 'custom:first', memberKeys: ['custom:first'] },
      { id: 'custom:second', representativeKey: 'custom:second', memberKeys: ['custom:second'] },
      { id: catalogKey('unindexed character'), representativeKey: catalogKey('unindexed character'), memberKeys: [catalogKey('unindexed character')] },
    ]);
  });

  it('忽略不在显式范围内的 seed，并按首个符合范围的身份定位家族', () => {
    const keys = [catalogKey(variants[0]), 'custom:between', catalogKey(variants[1])];
    const eligible = new Set(['custom:between', catalogKey(variants[1])]);
    expect(groupCharacterVariantKeys(keys, variantIndex(), eligible)).toEqual([
      { id: 'custom:between', representativeKey: 'custom:between', memberKeys: ['custom:between'] },
      { id: catalogKey(base), representativeKey: catalogKey(variants[1]), memberKeys: [catalogKey(variants[1])] },
    ]);
  });

  it('旧来源 Tag 的大小写和下划线不匹配词库原文时仍按原 key 独立回显', () => {
    const legacyKey = 'catalog:ULRICH_VON_HUTTEN_(MAYHEM_MAID)_(AZUR_LANE)';
    expect(groupCharacterVariantKeys([legacyKey], variantIndex(), new Set([legacyKey]))).toEqual([
      { id: legacyKey, representativeKey: legacyKey, memberKeys: [legacyKey] },
    ]);
  });
});

describe('resolveCharacterVariantMembershipKeys', () => {
  it('从任一目录角色补齐原版和全量变体，不把自定义同名身份混入词库家族', () => {
    const custom = 'custom:character-chain';
    const result = resolveCharacterVariantMembershipKeys([catalogKey(variants[2]), custom], variantIndex());
    expect(result).toEqual(expect.arrayContaining([catalogKey(base), ...variants.map(catalogKey), custom]));
    expect(result).toHaveLength(6);
  });

  it('保留无家族的原 key 并按 Set 语义去重', () => {
    const keys = ['custom:one', catalogKey('unknown character'), 'custom:one'];
    expect(resolveCharacterVariantMembershipKeys(keys, variantIndex())).toEqual(['custom:one', catalogKey('unknown character')]);
  });

  it('旧下划线和大小写 alias 保留原身份，同时补齐 canonical 家族且不重复', () => {
    const alias = 'catalog:ULRICH_VON_HUTTEN_(MAYHEM_MAID)_(AZUR_LANE)';
    const result = resolveCharacterVariantMembershipKeys([alias, catalogKey(base), alias], variantIndex());
    expect(result[0]).toBe(alias);
    expect(result).toEqual(expect.arrayContaining([alias, catalogKey(base), ...variants.map(catalogKey)]));
    expect(result).toHaveLength(6);
  });
});
