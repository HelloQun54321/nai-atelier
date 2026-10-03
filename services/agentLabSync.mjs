// 页面已提交的改动按字段合并到工作草稿，保留业务工具尚未应用的其他改动。
const fields = new Set(['basePrompt', 'subjectPrompt', 'negativePrompt', 'modules', 'params', 'editContext']);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const diffAgentClientDraft = (before, after) => {
  const changes = [];
  const visit = (a, b, path) => {
    if (same(a, b)) return;
    if (object(a) && object(b) && path.length < 8) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!reserved.has(key)) visit(a[key], b[key], [...path, key]);
    } else changes.push({ path, before: a, after: b });
  };
  for (const field of fields) visit(before?.[field], after?.[field], [field]);
  return changes;
};
export const applyAgentClientChanges = (draft, changes) => {
  if (!Array.isArray(changes) || changes.length > 300 || JSON.stringify(changes).length > 500_000) throw new Error('页面草稿改动过大，请使用对应业务工具');
  const conflicts = [];
  // 先完整校验，拒绝时不留下部分写入。
  for (const change of changes) if (!Array.isArray(change.path) || !fields.has(change.path[0]) || change.path.length > 8 || change.path.some(key => typeof key !== 'string' || reserved.has(key))) throw new Error('无效的页面草稿字段');
  for (const { path, before, after } of changes) {
    let parent = draft;
    for (const key of path.slice(0, -1)) {
      if (!object(parent[key])) { if (parent[key] !== undefined) { parent = null; break; } parent[key] = {}; }
      parent = parent[key];
    }
    const key = path.at(-1);
    if (!parent) { conflicts.push(path.join('.')); continue; }
    if (!same(parent[key], before) && !same(parent[key], after)) conflicts.push(path.join('.'));
    // 页面已经提交的选择优先于尚未应用的工作草稿；同级其他字段保持原样。
    if (after === undefined) delete parent[key]; else parent[key] = structuredClone(after);
  }
  return conflicts;
};
