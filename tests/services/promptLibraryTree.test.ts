import { describe, expect, it } from 'vitest';
import {
  createDefaultPromptLibraryTree, flattenPromptLibraryDirectories, getPromptLibraryDefaultSelection,
  getPromptLibraryDirectoryLegacyKind, getPromptLibraryDirectoryPath, getPromptLibraryDirectoryPurpose, getPromptLibraryDirectoryRollKey,
  getPromptLibraryDirectoryTarget, getPromptLibraryEntryDirectoryIds, inferPurposesFromDirectoryIds,
  normalizePromptLibraryDirectorySelection, readPromptLibraryTree, remapPromptLibraryDirectoryIds,
  removePromptLibraryDirectory, selectPromptLibraryDirectoryEntries,
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
    expect(state.nodes.filter(node => node.parentId === null)).toHaveLength(3);
    expect(state.nodes.filter(node => node.parentId === null).map(node => [node.name, state.nodes.filter(child => child.parentId === node.id).map(child => child.name)])).toEqual([
      ['人物', ['外貌与设定', '服饰穿搭', '动作姿态', '表情神态', '多人互动']],
      ['画面与场景', ['场景地点', '光影与氛围', '镜头与构图']],
      ['其他与辅助', ['版式与特效', '常用负面与整段']],
    ]);
    expect(getPromptLibraryDefaultSelection(state)).toEqual([
      'person-appearance', 'person-wardrobe', 'person-pose', 'person-expression', 'person-interaction',
      'environment-scene', 'environment-atmosphere', 'composition-camera',
      'composition-format', 'auxiliary-notes',
    ]);
    expect(state.nodes.some(node => [
      'person-identity', 'subjects-objects', 'subjects-creatures', 'subjects-machines', 'environment-nature',
      'environment-time', 'environment-climate', 'composition-layout', 'composition-text', 'style',
    ].includes(node.id))).toBe(false);
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

  it('按当前末级目录选择，父子交叠只保留父目录且显式空选择不回落', () => {
    expect(getPromptLibraryDefaultSelection(tree())).toEqual(['deep', 'single']);
    expect(normalizePromptLibraryDirectorySelection(tree(), ['root', 'deep', 'root', 'missing'])).toEqual(['root']);
    expect(normalizePromptLibraryDirectorySelection(tree(), [])).toEqual([]);
    expect(normalizePromptLibraryDirectorySelection(tree(), null)).toEqual(['root', 'single']);
    expect(getPromptLibraryDirectoryPath(tree(), 'deep').map(node => node.name)).toEqual(['自定根', '自定子', '继续细分']);
    expect(flattenPromptLibraryDirectories(tree()).map(node => [node.id, node.depth])).toEqual([['root', 0], ['child', 1], ['deep', 2], ['single', 0]]);
    expect(getPromptLibraryDirectoryRollKey('deep')).toBe('directory:deep');
  });

  it('预设每个节点均可改名、删除和继续细分；默认选择随实际树变化', () => {
    const preset = createDefaultPromptLibraryTree();
    for (const node of preset.nodes) {
      const renamed = readPromptLibraryTree({ ...preset, nodes: preset.nodes.map(item => item.id === node.id ? { ...item, name: '用户自定名称' } : item) });
      expect(renamed.nodes.find(item => item.id === node.id)?.name).toBe('用户自定名称');
      expect(readPromptLibraryTree(removePromptLibraryDirectory(renamed, node.id)).nodes.some(item => item.id === node.id)).toBe(false);
      const extended = readPromptLibraryTree({ ...renamed, nodes: [...renamed.nodes,
        { id: 'custom-child', parentId: node.id, name: '继续细分' },
        { id: 'custom-deep', parentId: 'custom-child', name: '再细分' },
      ] });
      expect(getPromptLibraryDefaultSelection(extended)).toContain('custom-deep');
      expect(getPromptLibraryDefaultSelection(extended)).not.toContain(node.id);
      expect(getPromptLibraryDefaultSelection(extended)).not.toContain('custom-child');
    }
    expect(getPromptLibraryDefaultSelection({ revision: 1, nodes: [] })).toEqual([]);
    expect(getPromptLibraryDefaultSelection(removePromptLibraryDirectory(tree(), 'deep'))).toEqual(['child', 'single']);
  });

  it('旧六类只读映射稳定ID，改名不丢归属；显式空、删后孤立不恢复旧type', () => {
    const state = createDefaultPromptLibraryTree();
    const entry = { id: 'old', type: 'wardrobe', params: {} };
    const original = JSON.stringify(entry);
    state.nodes = state.nodes.map(node => ({ ...node, name: `${node.name}新名字` }));
    expect(getPromptLibraryEntryDirectoryIds(entry, state)).toEqual(['person-wardrobe']);
    expect(getPromptLibraryDirectoryLegacyKind(state, 'person-wardrobe')).toBe('wardrobe');
    expect(getPromptLibraryEntryDirectoryIds({ id: 'g', type: 'preset', params: { _collectedCategory: 'general' } }, state)).toEqual(['auxiliary-notes']);
    expect(getPromptLibraryEntryDirectoryIds({ id: 'g', type: 'preset', params: { _collectedCategory: 'general' } }, { revision: 0, nodes: [{ id: 'style', parentId: null, name: '画风配方' }] })).toEqual(['style']);
    expect(getPromptLibraryEntryDirectoryIds({ ...entry, params: { _promptLibraryDirectoryIds: [] } }, state)).toEqual([]);
    expect(getPromptLibraryEntryDirectoryIds({ ...entry, params: { _promptLibraryDirectoryIds: ['deleted'] } }, state)).toEqual([]);
    expect(getPromptLibraryEntryDirectoryIds(entry, removePromptLibraryDirectory(state, 'person-wardrobe'))).toEqual([]);
    expect(JSON.stringify(entry)).toBe(original);
  });

  it('旧目录别名迁到当前预设，并可从旧目录补用途', () => {
    const known = new Set(createDefaultPromptLibraryTree().nodes.map(node => node.id));
    expect(remapPromptLibraryDirectoryIds([
      'interaction-people', 'subjects-machines', 'environment-nature', 'environment-time',
      'composition-layout', 'composition-text', 'lighting-light', 'quality-supplement', 'person-pose', 'missing',
    ], known)).toEqual([
      'person-interaction', 'environment-scene', 'environment-atmosphere', 'composition-camera', 'composition-format', 'person-pose',
    ]);
    expect(inferPurposesFromDirectoryIds(['interaction-people', 'subjects-machines', 'environment-time', 'person-identity', 'composition-text']))
      .toEqual(['interaction', 'place', 'atmosphere', 'appearance', 'format']);
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

  it('目录节点支持可选默认用途与 none 解绑，支持子树继承、旧细项归一与删节点延续', () => {
    const customTree = readPromptLibraryTree({
      revision: 1,
      nodes: [
        { id: 'ancient', parentId: null, name: '古风', target: 'character', purpose: 'lighting' },
        { id: 'hanfu', parentId: 'ancient', name: '汉服', purpose: 'clothing' },
        { id: 'sleeve', parentId: 'hanfu', name: '广袖' },
        { id: 'misc', parentId: 'hanfu', name: '杂项备注', purpose: 'none' },
        { id: 'person-wardrobe', parentId: null, name: '自定义服饰夹' },
        { id: 'sub-wardrobe', parentId: 'person-wardrobe', name: '鞋履' },
        { id: 'person-pose', parentId: null, name: '解绑预设', purpose: 'none' },
      ],
    });
    expect(customTree.nodes.find(node => node.id === 'ancient')?.purpose).toBe('atmosphere');
    expect(getPromptLibraryDirectoryPurpose(customTree, 'sleeve')).toBe('clothing');
    expect(getPromptLibraryDirectoryPurpose(customTree, 'misc')).toBeUndefined();
    expect(getPromptLibraryDirectoryPurpose(customTree, 'sub-wardrobe')).toBe('clothing');
    expect(getPromptLibraryDirectoryPurpose(customTree, 'person-pose')).toBeUndefined();
    expect(inferPurposesFromDirectoryIds(['sleeve', 'misc', 'sub-wardrobe'], customTree)).toEqual(['clothing']);
    expect(() => readPromptLibraryTree({ revision: 0, nodes: [{ id: 'bad', parentId: null, name: '坏用途', purpose: 'unknown' }] })).toThrow('提示词目录名称或位置无效');

    const afterDelete = readPromptLibraryTree(removePromptLibraryDirectory(customTree, 'hanfu'));
    expect(afterDelete.nodes.find(node => node.id === 'sleeve')).toMatchObject({ parentId: 'ancient', purpose: 'clothing' });
    expect(afterDelete.nodes.find(node => node.id === 'misc')).toMatchObject({ parentId: 'ancient', purpose: 'none' });
  });
});
