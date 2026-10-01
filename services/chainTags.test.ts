import { describe, expect, it } from 'vitest';
import { getCustomChainTags, isCustomChainTag, normalizeChainTags, replaceCustomChainTags } from './chainTags';

describe('风格串自定义分类与内部状态隔离', () => {
  it('移除历史自动来源／类型，保留真正分类，规范化后不再重新传播', () => {
    const input = [' aitag ', 'NAI', 'NovelAI', 'SDXL', 'Pixiv', 'Danbooru', '生成历史', '手动上传', '收集中', ' 星空 ', '星空', 'NAI风格', 'aitag收藏', null, 3];
    const result = normalizeChainTags(input);
    expect(result).toEqual(['星空', 'NAI风格', 'aitag收藏']);
    expect(normalizeChainTags(result)).toEqual(result);
    expect(input).toContain('NAI');
  });
  it('待实测和目录标记保留于存储，只提供自定义分类给编辑与筛选', () => {
    const input = ['NAI', '待实测', '__character_catalog__', '我的分类'];
    expect(normalizeChainTags(input)).toEqual(['待实测', '__character_catalog__', '我的分类']);
    expect(getCustomChainTags(input)).toEqual(['我的分类']);
    expect(replaceCustomChainTags(input, ['新分类', '新分类', 'aitag', '待实测'])).toEqual(['待实测', '__character_catalog__', '新分类']);
    expect(replaceCustomChainTags(input, [])).toEqual(['待实测', '__character_catalog__']);
  });
  it('缺失或损坏字段为空，限制精确名称而不按子串误删用户分类', () => {
    for (const value of [null, undefined, {}, 'NAI']) expect(getCustomChainTags(value)).toEqual([]);
    expect(isCustomChainTag('nai')).toBe(false);
    expect(isCustomChainTag('待实测')).toBe(false);
    expect(isCustomChainTag('星空')).toBe(true);
    expect(isCustomChainTag('Pixiv灵感')).toBe(true);
  });
});
