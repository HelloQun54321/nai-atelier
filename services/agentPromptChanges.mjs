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
    if (object(a) || object(b)) {
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
    return [...['appearance', 'wardrobe', 'pose', 'scene', 'camera', 'extra'], ...Object.keys(sections).filter(key => /^(directory|purpose):/.test(key))].map(key => sections[key]?.trim()).filter(Boolean).join(', ');
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
    const section = path[0] === 'params' && ['_promptSections', '_characterSectionsNegatives'].includes(path[1]) && path.length > 2;
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
