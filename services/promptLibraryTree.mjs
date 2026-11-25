import { PROMPT_PURPOSE_IDS, normalizePromptPurposeId } from './promptPurposes.mjs';

/** 目录只负责整理范围；旧 type 仅在未指定目录时做只读兼容。 */
export const PROMPT_LIBRARY_DIRECTORY_IDS_KEY = '_promptLibraryDirectoryIds';
export const LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS = Object.freeze({
  appearance: 'person-appearance', wardrobe: 'person-wardrobe', pose: 'person-pose',
  expression: 'person-expression', scene: 'environment-scene', camera: 'composition-camera', general: 'auxiliary-notes',
});

/** 旧预设目录 ID → 当前预设；迁移条目归属时使用，不改正文。 */
export const PROMPT_LIBRARY_DIRECTORY_ID_ALIASES = Object.freeze({
  'person-identity': 'person-appearance',
  'subjects-creatures': 'environment-scene',
  'subjects-objects': 'environment-scene',
  'subjects-machines': 'environment-scene',
  'environment-nature': 'environment-atmosphere',
  'environment-time': 'environment-atmosphere',
  'environment-climate': 'environment-atmosphere',
  interaction: 'person-interaction',
  'interaction-people': 'person-interaction',
  'interaction-object': 'person-pose',
  'composition-layout': 'composition-camera',
  'composition-text': 'composition-format',
  lighting: 'environment-atmosphere',
  'lighting-light': 'environment-atmosphere',
  'lighting-color': 'environment-atmosphere',
  'style-medium': 'style',
  'style-expression': 'style',
  quality: 'style',
  'quality-detail': 'style',
  'quality-supplement': 'style',
});

/** 预设目录及旧预设目录的默认用途；仅作继承兜底，'auxiliary-notes' 保持纯文件夹。 */
export const PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY = Object.freeze({
  'person-identity': 'appearance',
  'person-appearance': 'appearance',
  'person-wardrobe': 'clothing',
  'person-pose': 'pose',
  'person-expression': 'expression',
  'person-interaction': 'interaction',
  'subjects-creatures': 'place',
  'subjects-objects': 'place',
  'subjects-machines': 'place',
  'environment-scene': 'place',
  'environment-atmosphere': 'atmosphere',
  'environment-nature': 'atmosphere',
  'environment-time': 'atmosphere',
  'environment-climate': 'atmosphere',
  interaction: 'interaction',
  'interaction-people': 'interaction',
  'interaction-object': 'pose',
  'composition-camera': 'camera',
  'composition-layout': 'camera',
  'composition-format': 'format',
  'composition-text': 'format',
  lighting: 'atmosphere',
  'lighting-light': 'atmosphere',
  'lighting-color': 'atmosphere',
  style: 'style',
  'style-medium': 'style',
  'style-expression': 'style',
  quality: 'style',
  'quality-detail': 'style',
  'quality-supplement': 'style',
});

export function remapPromptLibraryDirectoryIds(ids, knownIds) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => (known.has(id) ? id : PROMPT_LIBRARY_DIRECTORY_ID_ALIASES[id] || id))
    .filter(id => typeof id === 'string' && known.has(id)))];
}

export function getPromptLibraryDirectoryPurpose(state, id) {
  const path = getPromptLibraryDirectoryPath(state, id);
  for (const node of path.reverse()) {
    if (node.purpose === 'none') return undefined;
    if (node.purpose) return normalizePromptPurposeId(node.purpose);
    const preset = PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY[node.id];
    if (preset) return normalizePromptPurposeId(preset);
  }
  return undefined;
}

export function inferPurposesFromDirectoryIds(ids, state) {
  const purposes = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const rawPurpose = state ? getPromptLibraryDirectoryPurpose(state, id) : PROMPT_LIBRARY_PURPOSE_FROM_DIRECTORY[id];
    const purpose = rawPurpose ? normalizePromptPurposeId(rawPurpose) : undefined;
    if (purpose && !purposes.includes(purpose)) purposes.push(purpose);
  }
  return purposes;
}

export function createDefaultPromptLibraryTree() {
  // 3 大组 10 子夹：人物 5 项、画面与场景 3 项、其他与辅助 2 项；不单设画风根与风格串库重复。
  const groups = [
    ['person', '人物', 'character', [
      ['person-appearance', '外貌与设定'],
      ['person-wardrobe', '服饰穿搭'],
      ['person-pose', '动作姿态'],
      ['person-expression', '表情神态'],
      ['person-interaction', '多人互动'],
    ]],
    ['scene', '画面与场景', 'global', [
      ['environment-scene', '场景地点'],
      ['environment-atmosphere', '光影与氛围'],
      ['composition-camera', '镜头与构图'],
    ]],
    ['auxiliary', '其他与辅助', 'global', [
      ['composition-format', '版式与特效'],
      ['auxiliary-notes', '常用负面与整段'],
    ]],
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
    let purpose;
    if (node.purpose !== undefined) {
      if (node.purpose === 'none') purpose = 'none';
      else {
        const normalizedPurpose = typeof node.purpose === 'string' ? normalizePromptPurposeId(node.purpose) : '';
        if (!PROMPT_PURPOSE_IDS.includes(normalizedPurpose)) throw Error('提示词目录名称或位置无效');
        purpose = normalizedPurpose;
      }
    }
    return { id: node.id, parentId: node.parentId, name: node.name.trim(), ...(node.target ? { target: node.target } : {}), ...(purpose ? { purpose } : {}) };
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
  const legacyType = entry.type === 'preset' ? 'general' : entry.type;
  const id = LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS[legacyType];
  if (id && known.has(id)) return [id];
  if (legacyType === 'general' && known.has('style')) return ['style'];
  return [];
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
    const inheritedPurpose = node.purpose !== undefined ? node.purpose : getPromptLibraryDirectoryPurpose(state, node.id);
    return { ...node, parentId, name, target: getPromptLibraryDirectoryTarget(state, node.id), ...(inheritedPurpose ? { purpose: inheritedPurpose } : {}) };
  }) };
}
