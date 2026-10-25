import { isCustomChainTag } from './chainTags';

/** 组合分类目录与条目自定义标签同名，非法内容不能静默清空已有目录。 */
export function readPromptLibraryTagNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some(tag => typeof tag !== 'string'
    || tag.length > 200 || /[,，\r\n]/.test(tag) || !isCustomChainTag(tag))) throw new Error('组合分类目录无效');
  return [...new Set(value.map(tag => tag.trim()))];
}
