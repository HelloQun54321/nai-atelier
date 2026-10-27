import { describe, expect, it } from 'vitest';
import {
  createDefaultPromptLibraryTree, flattenPromptLibraryDirectories, getPromptLibraryDefaultSelection,
  getPromptLibraryDirectoryLegacyKind, getPromptLibraryDirectoryPath, getPromptLibraryDirectoryRollKey,
  getPromptLibraryDirectoryTarget, getPromptLibraryEntryDirectoryIds, normalizePromptLibraryDirectorySelection,
  readPromptLibraryTree, removePromptLibraryDirectory, selectPromptLibraryDirectoryEntries,
  type PromptLibraryTreeState,
} from '../../services/promptLibraryTree.mjs';

const tree = (): PromptLibraryTreeState => ({ revision: 0, nodes: [
  { id: 'root', parentId: null, name: '自定根', target: 'character' },
  { id: 'child', parentId: 'root', name: '自定子' },
  { id: 'deep', parentId: 'child', name: '继续细分' },
  { id: 'single', parentId: null, name: '独立目录' },
] });

describe('用户完整掌控的提示词目录树', () => {
  it('预设只是两层起点，每次创建独立对象；空树照常保留', () => {
    const state = readPromptLibraryTree(createDefaultPromptLibraryTree());
    expect(state.nodes.filter(node => node.parentId === null)).toHaveLength(8);
    expect(Math.max(...flattenPromptLibraryDirectories(state).map(node => node.depth))).toBe(1);
    state.nodes[0].name = '已更名';
    expect(createDefaultPromptLibraryTree().nodes[0].name).not.toBe('已更名');
    expect(readPromptLibraryTree({ revision: 3, nodes: [] })).toEqual({ revision: 3, nodes: [] });
  });

  it('允许任意深度、整棵改名；同层重名、孤儿、循环和非法输入拒绝保存', () => {
    expect(readPromptLibraryTree(tree())).toEqual(tree());
    for (const nodes of [
      [...tree().nodes, { id: 'repeat', parentId: null, name: '独立目录' }],
      [...tree().nodes, { id: 'orphan', parentId: 'missing', name: '孤儿' }],
      [{ id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }],
      [{ id: 'a', parentId: null, name: 'A', target: 'unknown' }],
      [{ id: '__proto__', parentId: null, name: 'A' }],
    ]) expect(() => readPromptLibraryTree({ revision: 0, nodes })).toThrow();
    expect(() => readPromptLibraryTree({ revision: -1, nodes: [] })).toThrow();
  });

  it('按当前树选择二级与独立根，父子交叠只保留父目录且显式空选择不回落', () => {
    expect(getPromptLibraryDefaultSelection(tree())).toEqual(['child', 'single']);
    expect(normalizePromptLibraryDirectorySelection(tree(), ['root', 'deep', 'root', 'missing'])).toEqual(['root']);
    expect(normalizePromptLibraryDirectorySelection(tree(), [])).toEqual([]);
    expect(normalizePromptLibraryDirectorySelection(tree(), null)).toEqual(['root', 'single']);
    expect(getPromptLibraryDirectoryPath(tree(), 'deep').map(node => node.name)).toEqual(['自定根', '自定子', '继续细分']);
    expect(flattenPromptLibraryDirectories(tree()).map(node => [node.id, node.depth])).toEqual([['root', 0], ['child', 1], ['deep', 2], ['single', 0]]);
    expect(getPromptLibraryDirectoryRollKey('deep')).toBe('directory:deep');
  });

  it('旧六类只读映射稳定ID，改名不丢归属；显式空、删后孤立不恢复旧type', () => {
    const state = createDefaultPromptLibraryTree();
    const entry = { id: 'old', type: 'wardrobe', params: {} };
    const original = JSON.stringify(entry);
    state.nodes = state.nodes.map(node => ({ ...node, name: `${node.name}新名字` }));
    expect(getPromptLibraryEntryDirectoryIds(entry, state)).toEqual(['person-wardrobe']);
    expect(getPromptLibraryDirectoryLegacyKind(state, 'person-wardrobe')).toBe('wardrobe');
    expect(getPromptLibraryEntryDirectoryIds({ ...entry, params: { _promptLibraryDirectoryIds: [] } }, state)).toEqual([]);
    expect(getPromptLibraryEntryDirectoryIds({ ...entry, params: { _promptLibraryDirectoryIds: ['deleted'] } }, state)).toEqual([]);
    expect(getPromptLibraryEntryDirectoryIds(entry, removePromptLibraryDirectory(state, 'person-wardrobe'))).toEqual([]);
    expect(JSON.stringify(entry)).toBe(original);
  });

  it('候选按实际子树去重，支持数据库字符串params，不混入原文、风格或组合', () => {
    const entries = [
      { id: 'piece', type: 'preset', params: { _promptLibraryDirectoryIds: ['deep', 'single'] } },
      { id: 'piece', type: 'preset', params: { _promptLibraryDirectoryIds: ['child'] } },
      { id: 'json', type: 'preset', params: JSON.stringify({ _promptLibraryDirectoryIds: ['child'] }) },
      { id: 'unfiled', type: 'preset', params: { _promptLibraryDirectoryIds: [] } },
      { id: 'style', type: 'style', params: {} },
      { id: 'original', type: 'preset', params: { _collectedPrompt: 1 } },
      { id: 'combo', type: 'preset', params: { _rollContentSnapshot: {}, _promptLibraryDirectoryIds: ['child'] } },
    ];
    expect(selectPromptLibraryDirectoryEntries(entries, tree(), ['root', 'deep']).map(entry => entry.id)).toEqual(['piece', 'json']);
    expect(selectPromptLibraryDirectoryEntries(entries, tree(), []).map(entry => entry.id)).toEqual([]);
    expect(selectPromptLibraryDirectoryEntries(entries, tree(), ['single']).map(entry => entry.id)).toEqual(['piece']);
  });

  it('删除仅选中节点，孩子提升并保留用途，重名自动避让，不改原state', () => {
    const state = tree();
    state.nodes.push({ id: 'other', parentId: null, name: '自定子' });
    const removed = readPromptLibraryTree(removePromptLibraryDirectory(state, 'root'));
    expect(removed.nodes.find(node => node.id === 'child')).toMatchObject({ parentId: null, name: '自定子 (2)', target: 'character' });
    expect(getPromptLibraryDirectoryTarget(removed, 'deep')).toBe('character');
    expect(removed.nodes.find(node => node.id === 'deep')?.parentId).toBe('child');
    expect(state.nodes.find(node => node.id === 'child')?.parentId).toBe('root');
    expect(getPromptLibraryDirectoryTarget(tree(), 'deep')).toBe('character');
  });
});
