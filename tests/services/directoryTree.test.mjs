import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenDirectoryTree, getDirectoryDescendantIds, getDirectoryPath, validateDirectoryTree } from '../../services/directoryTree.mjs';

test('目录树按原兄弟顺序平铺，完整路径与后代包含自身且不改输入', () => {
  const nodes = [{ id: 'child', parentId: 'root', name: '子项', color: 'red' }, { id: 'root', name: '根' }, { id: 'other', parentId: null, name: '另一根' }, { id: 'leaf', parentId: 'child', name: '末层' }];
  const before = structuredClone(nodes);
  assert.deepEqual(flattenDirectoryTree(nodes).map(node => [node.id, node.depth, node.path]), [['root', 0, ['根']], ['child', 1, ['根', '子项']], ['leaf', 2, ['根', '子项', '末层']], ['other', 0, ['另一根']]]);
  assert.equal(flattenDirectoryTree(nodes)[1].color, 'red');
  assert.deepEqual(getDirectoryPath(nodes, 'leaf').map(node => node.id), ['root', 'child', 'leaf']);
  assert.deepEqual(getDirectoryDescendantIds(nodes, 'root'), new Set(['root', 'child', 'leaf']));
  assert.deepEqual(nodes, before);
});

test('空树和不存在目录返回空结果', () => {
  validateDirectoryTree([]);
  assert.deepEqual(flattenDirectoryTree([]), []);
  assert.deepEqual(getDirectoryPath([], 'missing'), []);
  assert.deepEqual(getDirectoryDescendantIds([], 'missing'), new Set());
});

test('关系校验拒绝重复ID、缺父、自父及多节点环，名称限制留给业务', () => {
  assert.throws(() => validateDirectoryTree([{ id: 'a', name: '' }, { id: 'a', name: '' }]), /重复/);
  assert.throws(() => validateDirectoryTree([{ id: 'a', parentId: 'missing', name: '' }]), /不存在/);
  assert.throws(() => validateDirectoryTree([{ id: 'a', parentId: 'a', name: '' }]), /自己/);
  const cycle = [{ id: 'a', parentId: 'b', name: '' }, { id: 'b', parentId: 'a', name: '' }];
  for (const operation of [validateDirectoryTree, flattenDirectoryTree, nodes => getDirectoryPath(nodes, 'a'), nodes => getDirectoryDescendantIds(nodes, 'a')]) assert.throws(() => operation(cycle), /循环/);
  validateDirectoryTree([{ id: 'unrestricted business ID', name: '' }]);
});

test('超过一千层的目录使用迭代算法，不截断深度或路径', () => {
  const nodes = Array.from({ length: 1205 }, (_, index) => ({ id: `n${index}`, name: `${index}`, parentId: index ? `n${index - 1}` : null }));
  validateDirectoryTree(nodes);
  const flat = flattenDirectoryTree(nodes);
  assert.equal(flat.length, nodes.length);
  assert.equal(flat.at(-1).depth, 1204);
  assert.equal(flat.at(-1).path.length, 1205);
  assert.equal(getDirectoryPath(nodes, 'n1204').length, 1205);
  assert.equal(getDirectoryDescendantIds(nodes, 'n0').size, 1205);
});
