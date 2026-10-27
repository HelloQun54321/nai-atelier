import { splitPromptSegments } from './promptSegments.mjs';
import { flattenPromptLibraryDirectories, getPromptLibraryDirectoryPath, getPromptLibraryDirectoryRollKey, getPromptLibraryDirectoryTarget, readPromptLibraryTree } from './promptLibraryTree.mjs';

const GLOBAL_KEYS = ['style', 'appearance', 'wardrobe', 'pose', 'scene', 'camera', 'extra'];
const CHARACTER_KEYS = ['appearance', 'wardrobe', 'pose', 'expression', 'extra'];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

/** 输入只含待分类的正向原文，已有分类的文档由调用者省略。 */
export function preparePromptClassification(input) {
  if (!input || !Array.isArray(input.documents) || input.documents.length > 65) fail('分类文本无效');
  let directories;
  try { directories = input.directories === undefined ? undefined : readPromptLibraryTree(input.directories); }
  catch (cause) { fail(cause.message); }
  const directoryCategories = directories && flattenPromptLibraryDirectories(directories).map(node => ({
    key: getPromptLibraryDirectoryRollKey(node.id), directoryId: node.id, directoryName: node.name,
    directoryPath: getPromptLibraryDirectoryPath(directories, node.id).map(parent => parent.name),
    scope: getPromptLibraryDirectoryTarget(directories, node.id),
  }));
  const ids = new Set();
  let length = 0;
  return input.documents.map(item => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !['global', 'character'].includes(item.kind) || typeof item.prompt !== 'string') fail('分类文本无效');
    ids.add(item.id); length += item.prompt.length;
    if (length > 100_000) fail('待分类的提示词过长');
    const available = directoryCategories?.filter(category => item.kind === 'global' || category.scope === 'character');
    return { id: item.id, kind: item.kind, chunks: splitPromptSegments(item.prompt),
      categories: available ? [...(item.kind === 'global' ? ['style'] : []), ...available.map(category => category.key), 'extra']
        : item.kind === 'global' ? GLOBAL_KEYS : CHARACTER_KEYS,
      ...(available ? { directoryCategories: available } : {}),
    };
  }).filter(item => item.chunks.length);
}

/** 模型只返回分类名称；原文由程序重组，不能增删词或拆坏加权组。 */
export function parsePromptClassification(raw, documents) {
  let result;
  try { result = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Object.assign(new Error('助手未返回有效的分类结果'), { status: 502 }); }
  if (!Array.isArray(result) || result.length !== documents.length) throw Object.assign(new Error('助手返回的分类结果不完整'), { status: 502 });
  return documents.map(document => {
    const matches = result.filter(item => item?.id === document.id);
    const categories = matches[0]?.categories;
    if (matches.length !== 1 || !Array.isArray(categories) || categories.length !== document.chunks.length || categories.some(key => !document.categories.includes(key))) {
      throw Object.assign(new Error('助手返回的分类结果不完整'), { status: 502 });
    }
    const sections = {};
    for (const key of document.categories) sections[key] = document.chunks.filter((_, index) => categories[index] === key).join(', ');
    const sectionMeta = document.directoryCategories && Object.fromEntries(document.directoryCategories
      .filter(category => sections[category.key])
      .map(({ key, directoryId, directoryName, directoryPath }) => [key, { source: 'ai', directoryId, directoryName, directoryPath }]));
    return { id: document.id, kind: document.kind, sections, ...(sectionMeta ? { sectionMeta } : {}) };
  });
}
