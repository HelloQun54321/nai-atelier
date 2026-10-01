import { UNTESTED_CHAIN_TAG } from './chainStatus';

// 历史导入自动附加的来源、图片类型与临时收集状态；不再作为资产分类传播。
const AUTOMATIC_TAG_NAMES = new Set([
  'aitag', 'nai', 'novelai', 'sd', 'sdxl', 'stable diffusion', 'midjourney',
  'pixiv', 'danbooru', '生成历史', '手动上传', '本地导入', '批量导入', '收集中',
]);

/** 读取旧资料与写入共用规则；保留用户分类和仍有用途的内部状态，不批量改写旧库。 */
export const normalizeChainTags = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim()).filter(tag => tag && !AUTOMATIC_TAG_NAMES.has(tag.toLowerCase())))]
  : [];

export const isCustomChainTag = (tag: string): boolean => {
  const name = tag.trim();
  return Boolean(name) && name !== UNTESTED_CHAIN_TAG && !(name.startsWith('__') && name.endsWith('__'))
    && !AUTOMATIC_TAG_NAMES.has(name.toLowerCase());
};

export const getCustomChainTags = (value: unknown): string[] => normalizeChainTags(value).filter(isCustomChainTag);

/** 信息编辑只管理用户标签，待实测／角色目录标记沿用原状态。 */
export const replaceCustomChainTags = (original: unknown, custom: unknown): string[] => [
  ...normalizeChainTags(original).filter(tag => !isCustomChainTag(tag)),
  ...getCustomChainTags(custom),
];
