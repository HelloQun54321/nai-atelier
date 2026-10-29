import { compilePrompt, getGlobalPromptSectionKeys, normalizeAgentLabDraft, restoreUnchangedAgentLabFields } from './agentLabSync.mjs';
// 差异只保存提示词及其来源；恢复时按字段核对，不覆盖生成参数与后来手改。
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const characterFields = ['prompt', 'negativePrompt', 'sections', 'sectionNegatives', 'sectionMeta'];
const moduleFields = ['content', 'isActive'];
const arrays = new Set(['modules', 'characters']);
const itemKey = (item, index) => item.id ? `id:${item.id}` : `index:${index}`;
const itemIndex = (items, key) => key.startsWith('id:') ? items.findIndex(item => item.id === key.slice(3)) : Number(key.slice(6));

export function createAgentPromptChange(before, after, id = '') {
  const changes = [];
  const visit = (a, b, path, index) => {
    if (same(a, b)) return;
    if (object(a) && object(b)) {
      for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
        if (!reserved.has(key)) visit(a?.[key], b?.[key], [...path, key]);
      }
    } else changes.push({ path, ...(a !== undefined ? { before: structuredClone(a) } : {}), ...(b !== undefined ? { after: structuredClone(b) } : {}), ...(index !== undefined ? { index } : {}) });
  };
  for (const field of ['basePrompt', 'subjectPrompt', 'negativePrompt']) visit(before[field], after[field], [field]);
  for (const field of ['_promptSections', '_characterSectionsNegatives']) visit(before.params?.[field], after.params?.[field], ['params', field]);
  for (const [path, fields] of [[['modules'], moduleFields], [['params', 'characters'], characterFields]]) {
    const a = (path.length === 1 ? before.modules : before.params?.characters) || [];
    const b = (path.length === 1 ? after.modules : after.params?.characters) || [];
    const oldItems = new Map(a.map((item, index) => [itemKey(item, index), item]));
    const newItems = new Map(b.map((item, index) => [itemKey(item, index), item]));
    for (const key of new Set([...oldItems.keys(), ...newItems.keys()])) {
      const oldItem = oldItems.get(key), newItem = newItems.get(key);
      if (!oldItem || !newItem) changes.push({ path: [...path, key], ...(oldItem ? { before: structuredClone(oldItem) } : {}), ...(newItem ? { after: structuredClone(newItem) } : {}), index: itemIndex(newItem ? b : a, key) });
      else for (const field of fields) visit(oldItem[field], newItem[field], [...path, key, field]);
    }
  }
  const sectionText = draft => {
    const sections = draft.params?._promptSections || {};
    return getGlobalPromptSectionKeys(sections).map(key => sections[key]?.trim()).filter(Boolean).join(', ');
  };
  for (const change of changes) {
    const { path } = change;
    if (path[0] === 'subjectPrompt' && (sectionText(before) || sectionText(after)) && before.subjectPrompt === sectionText(before) && after.subjectPrompt === sectionText(after)) change.hidden = true;
    const character = path[1] === 'characters' ? (after.params?.characters || before.params?.characters || [])[itemIndex(after.params?.characters || before.params?.characters || [], path[2])] : null;
    if (path[1] === 'characters' || path[0] === 'modules') {
      const items = path[1] === 'characters' ? after.params?.characters || [] : after.modules || [];
      const oldItems = path[1] === 'characters' ? before.params?.characters || [] : before.modules || [];
      const key = path[path[0] === 'modules' ? 1 : 2];
      const position = itemIndex(items, key), oldPosition = itemIndex(oldItems, key);
      change.ownerIndex = (position >= 0 ? position : oldPosition) + 1;
      const name = (items[position] || oldItems[oldPosition])?.name;
      if (name) change.ownerName = name;
    }
    const key = path.at(-1);
    if (key.startsWith('directory:')) {
      const name = character?.sectionMeta?.[key]?.directoryName || after.params?._promptSections?.sectionMeta?.[key]?.directoryName || before.params?._promptSections?.sectionMeta?.[key]?.directoryName;
      if (name) change.directoryName = name;
    }
  }
  return { id, ...(after.target ? { target: { chainId: after.target.chainId, mode: after.target.mode } } : {}), status: 'pending', changes };
}

export function validateAgentPromptChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 1000 || JSON.stringify(changes).length > 500_000) throw new Error('提示词差异过大');
  for (const { path, index } of changes) {
    if (!Array.isArray(path) || !path.length || path.length > 9 || path.some(key => typeof key !== 'string' || reserved.has(key))) throw new Error('无效的提示词差异');
    const global = ['basePrompt', 'subjectPrompt', 'negativePrompt'].includes(path[0]) && path.length === 1;
    const section = path[0] === 'params' && ['_promptSections', '_characterSectionsNegatives'].includes(path[1]) && path.length >= 2;
    const offset = path[0] === 'modules' ? 1 : path[0] === 'params' && path[1] === 'characters' ? 2 : 0;
    const item = offset && /^(id:.+|index:\d+)$/.test(path[offset] || '') && (path.length === offset + 1 || (offset === 1 ? moduleFields : characterFields).includes(path[offset + 1]));
    if (!global && !section && !item || index !== undefined && (!Number.isInteger(index) || index < 0)) throw new Error('无效的提示词差异');
  }
}

const read = (draft, path) => {
  let value = draft;
  for (const key of path) value = Array.isArray(value) ? value[itemIndex(value, key)] : value?.[key];
  return value;
};
const write = (draft, { path, index }, value) => {
  let parent = draft;
  for (const key of path.slice(0, -1)) {
    if (Array.isArray(parent)) parent = parent[itemIndex(parent, key)];
    else { parent[key] ??= arrays.has(key) ? [] : {}; parent = parent[key]; }
    if (!parent) throw new Error('提示词内容已变化，请先核对当前内容');
  }
  const key = path.at(-1);
  if (Array.isArray(parent)) {
    const position = itemIndex(parent, key);
    if (value === undefined) { if (position >= 0) parent.splice(position, 1); }
    else if (position < 0 || position >= parent.length) parent.splice(Math.min(index ?? parent.length, parent.length), 0, structuredClone(value));
    else parent[position] = structuredClone(value);
  } else if (value === undefined) delete parent[key];
  else parent[key] = structuredClone(value);
};

export function applyAgentPromptChange(current, change, direction) {
  if (!current.target || !change.target || current.target.chainId !== change.target.chainId || current.target.mode !== change.target.mode) throw new Error('请回到本次修改的作品与模式');
  const changes = direction === 'apply' ? change.changes : change.appliedChanges || change.changes;
  validateAgentPromptChanges(changes);
  const from = direction === 'undo' ? 'after' : 'before', to = direction === 'undo' ? 'before' : 'after';
  if (changes.some(item => !same(read(current, item.path), item[from]))) throw new Error('相关提示词已被修改，未覆盖当前内容');
  const result = structuredClone(current);
  // 数组删除先从末尾开始；新增按原位置恢复，角色重排仍按 ID 找到原对象。
  for (const item of [...changes].sort((a, b) => a[to] === undefined && b[to] === undefined ? (b.index ?? 0) - (a.index ?? 0) : (a.index ?? 0) - (b.index ?? 0))) write(result, item, item[to]);
  return result;
}

const versionCharacterFields = ['id', 'name', 'enabled', ...characterFields];
const versionModuleFields = ['id', 'name', 'content', 'isActive', 'position', 'group'];
const versionParamFields = ['_promptSections', '_characterSectionsNegatives', '_styleBundleSources'];
const selectFields = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, structuredClone(value[key])]));
const assertVersionValue = value => {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 500_000) throw new Error('提示词版本过大或无效');
  const visit = (item, depth = 0) => {
    if (depth > 20) throw new Error('提示词版本嵌套过深');
    if (item && typeof item === 'object') for (const key of Object.keys(item)) {
      if (reserved.has(key)) throw new Error('无效的提示词版本字段');
      visit(item[key], depth + 1);
    }
  };
  visit(value);
};

/** 仅存创作正文及来源，角色坐标、生成参数与图片仍由当前工作区持有。 */
export function pickPromptVersionContent(input) {
  if (!object(input)) throw new Error('提示词版本无效');
  const modules = input.modules ?? [], characters = input.params?.characters ?? [];
  if (!Array.isArray(modules) || !Array.isArray(characters) || [...modules, ...characters].some(item => !object(item))) throw new Error('提示词版本的模块或角色无效');
  const content = {
    basePrompt: input.basePrompt ?? '',
    subjectPrompt: input.subjectPrompt ?? input.variableValues?.subject ?? '',
    negativePrompt: input.negativePrompt ?? '',
    modules: modules.map(item => selectFields(item, versionModuleFields)),
    params: { ...selectFields(input.params, versionParamFields), characters: characters.map(item => selectFields(item, versionCharacterFields)) },
    ...(input.variableValues !== undefined ? { variableValues: structuredClone(input.variableValues) } : {}),
  };
  if (['basePrompt', 'subjectPrompt', 'negativePrompt'].some(key => typeof content[key] !== 'string')) throw new Error('提示词版本正文无效');
  assertVersionValue(content);
  return content;
}

const sortVersionKeys = value => Array.isArray(value) ? value.map(sortVersionKeys) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortVersionKeys(value[key])])) : value;

/** raw旧分栏与模型整段稿按同一可见内容核对；数组顺序仍属于版本事实。 */
export function canonicalPromptVersionContent(input) {
  return sortVersionKeys(pickPromptVersionContent(normalizeAgentLabDraft(pickPromptVersionContent(input))));
}

/** 恢复前核对完整提示词投影，任何手改冲突都只报告、不覆盖。 */
export function restorePromptVersion(current, snapshot, expected) {
  const before = pickPromptVersionContent(current), desired = pickPromptVersionContent(snapshot), baseline = pickPromptVersionContent(expected);
  if (same(sortVersionKeys(before), sortVersionKeys(desired))) return { ok: true, draft: structuredClone(current) };
  const conflicts = [];
  const inspect = (a, b, path) => {
    if (same(a, b)) return;
    if (object(a) && object(b)) for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) inspect(a[key], b[key], [...path, key]);
    else conflicts.push(path.join('.'));
  };
  inspect(canonicalPromptVersionContent(before), canonicalPromptVersionContent(baseline), []);
  if (conflicts.length) return { ok: false, conflicts };
  const draft = structuredClone(current);
  draft.basePrompt = desired.basePrompt; draft.negativePrompt = desired.negativePrompt;
  if ('subjectPrompt' in current || !('variableValues' in current)) draft.subjectPrompt = desired.subjectPrompt;
  if ('variableValues' in current || 'variableValues' in desired) draft.variableValues = { ...(desired.variableValues || {}), subject: desired.subjectPrompt };
  draft.modules = desired.modules.map((module, index) => {
    const previous = current.modules?.find((item, offset) => itemKey(item, offset) === itemKey(module, index));
    return { ...selectFields(previous, Object.keys(previous || {}).filter(key => !versionModuleFields.includes(key))), ...module };
  });
  draft.params = { ...(draft.params || {}) };
  for (const key of versionParamFields) {
    if (desired.params[key] === undefined) delete draft.params[key]; else draft.params[key] = structuredClone(desired.params[key]);
  }
  draft.params.characters = desired.params.characters.map((character, index) => {
    const previous = current.params?.characters?.find((item, offset) => itemKey(item, offset) === itemKey(character, index));
    return { ...(previous ? selectFields(previous, Object.keys(previous).filter(key => !versionCharacterFields.includes(key))) : { x: 0.5, y: 0.5 }), ...character };
  });
  return { ok: true, draft };
}

/** 核验声明修改在模型视图中的实际子集，再保留整段应用伴随的旧分栏清理。 */
export function createAppliedAgentPromptChange(declared, rawBefore, rawAfter, selectedAfter = rawAfter) {
  validateAgentPromptChanges(declared.changes);
  if (declared.target && [rawBefore, rawAfter].some(draft => draft.target?.chainId !== declared.target.chainId || draft.target?.mode !== declared.target.mode)) throw new Error('实际提示词修改不属于本次作品与模式');
  const before = pickPromptVersionContent(rawBefore), after = pickPromptVersionContent(rawAfter);
  const visibleBefore = normalizeAgentLabDraft(before), visibleAfter = normalizeAgentLabDraft(pickPromptVersionContent(selectedAfter));
  const visibleChanges = createAgentPromptChange(visibleBefore, visibleAfter).changes;
  const declaredValue = change => change.after === undefined ? undefined
    : change.path[0] === 'params' && change.path[1] === 'characters' && change.path.length === 3 ? selectFields(change.after, versionCharacterFields)
      : change.path[0] === 'modules' && change.path.length === 2 ? selectFields(change.after, versionModuleFields) : change.after;
  if (visibleChanges.some(item => !declared.changes.some(original => same(original.path, item.path) && same(declaredValue(original), item.after)))) throw new Error('实际提示词修改超出本次声明范围');
  const permitted = restoreUnchangedAgentLabFields(before, visibleAfter);
  if (declared.target?.mode && declared.target.mode !== 'text-to-image') {
    permitted.basePrompt = compilePrompt(permitted, permitted.subjectPrompt);
    permitted.subjectPrompt = ''; permitted.modules = [];
  }
  if (!same(pickPromptVersionContent(permitted), after)) throw new Error('实际提示词来源或分栏与本次修改不匹配');
  const changeDraft = (raw, projected) => ({ ...projected, target: raw.target, params: { ...projected.params,
    characters: (projected.params.characters || []).map((character, index) => ({ ...character, ...selectFields(raw.params?.characters?.[index], ['x', 'y']) })),
  } });
  const applied = createAgentPromptChange(changeDraft(rawBefore, before), changeDraft(rawAfter, after), declared.id);
  return { ...declared, status: 'applied', appliedChanges: applied.changes };
}

// 英文按词、其他文字按字符匹配，保留权重、重复词和换行；共同部分只在展示时折叠。
export function diffPromptText(before, after) {
  if (before === after) return [{ kind: 'equal', text: before }];
  const tokens = text => text.match(/[A-Za-z_]+|\d+|[^A-Za-z_\d]/gu) || [];
  const parts = [];
  const push = (kind, text) => { if (!text) return; if (parts.at(-1)?.kind === kind) parts.at(-1).text += text; else parts.push({ kind, text }); };
  // Hirschberg 只保留 LCS 当前行，长文本也继续匹配共同内容，不退化成整段替换。
  const lengths = (a, b) => {
    const row = new Uint32Array(b.length + 1);
    for (const token of a) {
      let diagonal = 0;
      for (let j = 0; j < b.length; j++) {
        const previous = row[j + 1];
        row[j + 1] = token === b[j] ? diagonal + 1 : Math.max(row[j], previous);
        diagonal = previous;
      }
    }
    return row;
  };
  const splitAt = (a, b, middle) => {
    const front = lengths(a.slice(0, middle), b), back = lengths(a.slice(middle).reverse(), [...b].reverse());
    let split = 0, best = -1;
    for (let j = 0; j <= b.length; j++) {
      const score = front[j] + back[b.length - j];
      if (score > best) { best = score; split = j; }
    }
    return split;
  };
  const visit = (a, b) => {
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    push('equal', a.slice(0, start).join(''));
    const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end);
    if (!left.length) push('insert', right.join(''));
    else if (!right.length) push('delete', left.join(''));
    else if (left.length === 1) {
      const position = right.indexOf(left[0]);
      if (position < 0) { push('delete', left[0]); push('insert', right.join('')); }
      else { push('insert', right.slice(0, position).join('')); push('equal', left[0]); push('insert', right.slice(position + 1).join('')); }
    } else {
      const middle = Math.floor(left.length / 2), split = splitAt(left, right, middle);
      visit(left.slice(0, middle), right.slice(0, split));
      visit(left.slice(middle), right.slice(split));
    }
    push('equal', end ? a.slice(-end).join('') : '');
  };
  visit(tokens(before), tokens(after));
  return parts;
}
