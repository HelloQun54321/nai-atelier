/** 目录只负责整理范围；旧 type 仅在未指定目录时做只读兼容。 */
export const PROMPT_LIBRARY_DIRECTORY_IDS_KEY = '_promptLibraryDirectoryIds';
export const LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS = Object.freeze({
  appearance: 'person-appearance', wardrobe: 'person-wardrobe', pose: 'person-pose',
  expression: 'person-expression', scene: 'environment-scene', camera: 'composition-camera', general: 'quality-supplement',
});

export function createDefaultPromptLibraryTree() {
  const groups = [
    ['person', '人物', 'character', [['person-appearance', '外貌与身体'], ['person-wardrobe', '服饰与配件'], ['person-pose', '动作与姿态'], ['person-expression', '表情与情绪']]],
    ['subjects', '其他主体', 'global', [['subjects-creatures', '动物与生物'], ['subjects-objects', '物品与道具'], ['subjects-machines', '载具与机械']]],
    ['environment', '场景环境', 'global', [['environment-scene', '地点与布景'], ['environment-nature', '自然与天气'], ['environment-time', '时间与季节']]],
    ['interaction', '互动与关系', 'global', [['interaction-people', '人物互动'], ['interaction-object', '与物品及环境互动']]],
    ['composition', '构图与镜头', 'global', [['composition-camera', '视角与景别'], ['composition-layout', '构图与布局']]],
    ['lighting', '光照与色彩', 'global', [['lighting-light', '光照与阴影'], ['lighting-color', '色彩与色调']]],
    ['style', '画风与表现', 'global', [['style-medium', '媒介与技法'], ['style-expression', '线条与质感']]],
    ['quality', '质量与细节', 'global', [['quality-detail', '质量标签'], ['quality-supplement', '细节表现']]],
  ];
  return { revision: 0, nodes: groups.flatMap(([id, name, target, children]) => [
    { id, parentId: null, name, target }, ...children.map(([childId, childName]) => ({ id: childId, parentId: id, name: childName })),
  ]) };
}

export function readPromptLibraryTree(value) {
  const validId = id => typeof id === 'string' && /^[\w-]{1,120}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.nodes) || value.nodes.length > 2000) throw Error('提示词目录数据无效');
  const nodes = value.nodes.map(node => {
    if (!node || !validId(node.id) || !(node.parentId === null || validId(node.parentId))
      || typeof node.name !== 'string' || !node.name.trim() || node.name.length > 100 || /[\u0000-\u001f\u007f]/u.test(node.name)
      || (node.target !== undefined && node.target !== 'global' && node.target !== 'character')) throw Error('提示词目录名称或位置无效');
    return { id: node.id, parentId: node.parentId, name: node.name.trim(), ...(node.target ? { target: node.target } : {}) };
  });
  const parents = new Map(nodes.map(node => [node.id, node.parentId]));
  if (parents.size !== nodes.length || new Set(nodes.map(node => JSON.stringify([node.parentId, node.name.toLocaleLowerCase()]))).size !== nodes.length) throw Error('同一位置已有同名提示词目录');
  for (const node of nodes) {
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent !== null) {
      if (!parents.has(parent) || visited.has(parent)) throw Error('提示词目录层级无效');
      visited.add(parent); parent = parents.get(parent);
    }
  }
  return { revision: value.revision, nodes };
}

export function getPromptLibraryDirectoryPath(state, id) {
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const path = [];
  const seen = new Set();
  for (let node = byId.get(id); node && !seen.has(node.id); node = byId.get(node.parentId)) {
    seen.add(node.id); path.unshift(node);
  }
  return path;
}

export function flattenPromptLibraryDirectories(state) {
  const children = new Map();
  for (const node of state.nodes) children.set(node.parentId, [...(children.get(node.parentId) || []), node]);
  const stack = (children.get(null) || []).map(node => ({ ...node, depth: 0 })).reverse();
  const result = [];
  while (stack.length) {
    const node = stack.pop();
    result.push(node);
    stack.push(...(children.get(node.id) || []).map(child => ({ ...child, depth: node.depth + 1 })).reverse());
  }
  return result;
}

export const getPromptLibraryDirectoryRollKey = id => `directory:${id}`;

/** AI 搭配与随机搭配共用当前末级目录，不依赖预设名称或固定层数。 */
export function getPromptLibraryDefaultSelection(state) {
  const parents = new Set(state.nodes.map(node => node.parentId));
  return state.nodes.filter(node => !parents.has(node.id)).map(node => node.id);
}

export function getPromptLibraryDescendantIds(state, id) {
  return state.nodes.filter(node => getPromptLibraryDirectoryPath(state, node.id).some(parent => parent.id === id)).map(node => node.id);
}

/** null 表示全部；显式空数组表示不选；父节点涵盖子树，避免重复抽取。 */
export function normalizePromptLibraryDirectorySelection(state, ids) {
  const selected = new Set(ids === null ? state.nodes.filter(node => node.parentId === null).map(node => node.id) : ids);
  return state.nodes.filter(node => selected.has(node.id) && !getPromptLibraryDirectoryPath(state, node.id).slice(0, -1).some(parent => selected.has(parent.id))).map(node => node.id);
}

export function getPromptLibraryDirectoryTarget(state, id) {
  return getPromptLibraryDirectoryPath(state, id).reverse().find(node => node.target)?.target || 'global';
}

export function getPromptLibraryDirectoryLegacyKind(state, id) {
  const legacyIds = Object.entries(LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS);
  for (const node of getPromptLibraryDirectoryPath(state, id).reverse()) {
    const kind = legacyIds.find(([, directoryId]) => directoryId === node.id)?.[0];
    if (kind) return kind;
  }
  return undefined;
}

function entryParams(entry) {
  if (typeof entry.params === 'string') {
    try { return JSON.parse(entry.params) || {}; } catch { return {}; }
  }
  return entry.params && typeof entry.params === 'object' ? entry.params : {};
}

export function isPromptLibraryFragmentEntry(entry) {
  const params = entryParams(entry);
  if (params._rollContentSnapshot || params._promptLibraryOriginal) return false;
  if (Object.hasOwn(params, PROMPT_LIBRARY_DIRECTORY_IDS_KEY)) return true;
  return Object.hasOwn(LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS, entry.type) && entry.type !== 'general'
    || entry.type === 'preset' && params._collectedCategory === 'general';
}

export function getPromptLibraryEntryDirectoryIds(entry, state) {
  const params = entryParams(entry);
  const known = new Set(state.nodes.map(node => node.id));
  if (Object.hasOwn(params, PROMPT_LIBRARY_DIRECTORY_IDS_KEY)) {
    const ids = params[PROMPT_LIBRARY_DIRECTORY_IDS_KEY];
    return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && known.has(id)))] : [];
  }
  if (!isPromptLibraryFragmentEntry(entry)) return [];
  const id = LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[entry.type === 'preset' ? 'general' : entry.type];
  return id && known.has(id) ? [id] : [];
}

export function selectPromptLibraryDirectoryEntries(entries, state, ids = null) {
  const selected = new Set(normalizePromptLibraryDirectorySelection(state, ids).flatMap(id => getPromptLibraryDescendantIds(state, id)));
  const seen = new Set();
  return entries.filter(entry => {
    if (!isPromptLibraryFragmentEntry(entry) || seen.has(entry.id) || !getPromptLibraryEntryDirectoryIds(entry, state).some(id => selected.has(id))) return false;
    seen.add(entry.id); return true;
  });
}

/** 只删所选目录，子目录提升一级；条目、原文及历史快照保持原件。 */
export function removePromptLibraryDirectory(state, id) {
  const parentId = state.nodes.find(node => node.id === id)?.parentId ?? null;
  const names = new Set(state.nodes.filter(node => node.id !== id && node.parentId === parentId).map(node => node.name.toLocaleLowerCase()));
  return { ...state, nodes: state.nodes.filter(node => node.id !== id).map(node => {
    if (node.parentId !== id) return node;
    let name = node.name;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      const ending = ` (${suffix++})`;
      name = node.name.slice(0, 100 - ending.length) + ending;
    }
    names.add(name.toLocaleLowerCase());
    return { ...node, parentId, name, target: getPromptLibraryDirectoryTarget(state, node.id) };
  }) };
}
