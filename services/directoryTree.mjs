/** 仅校验树关系，名称、ID 和节点数量的业务限制由调用方负责。 */
export function validateDirectoryTree(nodes) {
  if (!Array.isArray(nodes)) throw new Error('目录树无效');
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error('目录 ID 重复');
    byId.set(node.id, node);
  }
  const children = new Map();
  const pending = [];
  for (const node of nodes) {
    if (node.parentId == null) { pending.push(node.id); continue; }
    if (node.parentId === node.id) throw new Error('目录不能作为自己的上级');
    if (!byId.has(node.parentId)) throw new Error('上级目录不存在');
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  let visited = 0;
  for (let index = 0; index < pending.length; index++) {
    visited++;
    for (const id of children.get(pending[index]) || []) pending.push(id);
  }
  if (visited !== nodes.length) throw new Error('目录不能循环嵌套');
}

export function flattenDirectoryTree(nodes) {
  validateDirectoryTree(nodes);
  const children = new Map();
  for (const node of nodes) {
    const parent = node.parentId ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const stack = (children.get(null) || []).map(node => ({ node, depth: 0, path: [] })).reverse();
  const result = [];
  while (stack.length) {
    const { node, depth, path } = stack.pop();
    const names = [...path, node.name];
    result.push({ ...node, depth, path: names });
    const descendants = children.get(node.id) || [];
    for (let index = descendants.length - 1; index >= 0; index--) stack.push({ node: descendants[index], depth: depth + 1, path: names });
  }
  return result;
}

export function getDirectoryPath(nodes, id) {
  validateDirectoryTree(nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result = [];
  for (let node = byId.get(id); node; node = byId.get(node.parentId)) result.push(node);
  return result.reverse();
}

export function getDirectoryDescendantIds(nodes, id) {
  validateDirectoryTree(nodes);
  const children = new Map();
  for (const node of nodes) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  const result = new Set();
  const pending = nodes.some(node => node.id === id) ? [id] : [];
  while (pending.length) {
    const current = pending.pop();
    result.add(current);
    for (const child of children.get(current) || []) pending.push(child);
  }
  return result;
}
