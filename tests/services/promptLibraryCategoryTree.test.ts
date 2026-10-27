import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { api } from '../../services/api';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { getDirectoryPath } from '../../services/directoryTree.mjs';
import { readPromptLibraryTagNames } from '../../services/promptLibraryTags';
import {
  emptyPromptLibraryCategoryTree, readPromptLibraryCategoryTree, projectPromptLibraryCategoryTree,
  renamePromptLibraryCategory, removePromptLibraryCategory, loadPromptLibraryCategoryTree, savePromptLibraryCategoryTree,
  promptLibraryCategoryLabel,
  type PromptLibraryCategoryTreeState,
} from '../../services/promptLibraryCategoryTree';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
const node = (name: string, parentId: string | null = null) => ({ id: name, name, parentId });
const tree = (): PromptLibraryCategoryTreeState => ({ revision: 4, nodes: [node('祖先'), node('旧分类', '祖先'), node('孩子', '旧分类'), node('后代', '孩子'), node('旁支', '旧分类'), node('目标')] });

it('分类路径只用于显示，未知名称或未加载树时保持原标签', () => {
  expect(promptLibraryCategoryLabel(tree(), '后代')).toBe('祖先 / 旧分类 / 孩子 / 后代');
  expect(promptLibraryCategoryLabel(tree(), '*')).toBe('*');
  expect(promptLibraryCategoryLabel(undefined, '原标签')).toBe('原标签');
});

it('旧分类与组合自定义标签只读补根，保留已有空分类和层级且不改组合归属', () => {
  const combo = { ...createCombinationData('组合', { scene: { kind: 'scene', text: 'night', filled: true } }), id: 'combo', tags: ['旧分类', '未知旧标签', '*', '__internal__', 'pixiv'] } as PromptChain;
  const fragment = { id: 'fragment', type: 'scene', tags: ['仅片段'] } as PromptChain;
  const original = { id: 'original', type: 'preset', params: { _promptLibraryOriginal: 1 }, tags: ['仅原文'] } as unknown as PromptChain;
  const stored = { revision: 2, nodes: [node('旧分类'), node('保留空分类', '旧分类')] };
  const before = structuredClone({ stored, combo });
  const projected = projectPromptLibraryCategoryTree([combo, fragment, original], ['旧分类', '旧根目录'], stored);
  expect(projected).toEqual({ revision: 2, nodes: [...stored.nodes, node('旧根目录'), node('未知旧标签'), node('*')] });
  expect({ stored, combo }).toEqual(before);
  expect(projectPromptLibraryCategoryTree([combo], [], emptyPromptLibraryCategoryTree()).nodes.map(item => item.id)).toEqual(['旧分类', '未知旧标签', '*']);
});

it('沿用标签合法名称并校验身份、全局唯一、缺父、循环和版本，允许一千层', () => {
  expect(readPromptLibraryCategoryTree({ revision: 0, nodes: [node('*'), node('路径/名称', '*')] }).nodes).toHaveLength(2);
  for (const invalid of [
    { revision: -1, nodes: [] }, { revision: 0.5, nodes: [] }, { revision: 0, nodes: [{ ...node('x'), id: 'other' }] },
    { revision: 0, nodes: [node('x'), node('x')] }, { revision: 0, nodes: [node('x', 'missing')] },
    { revision: 0, nodes: [node('x', 'y'), node('y', 'x')] }, { revision: 0, nodes: [node('x', 'x')] },
    { revision: 0, nodes: [node(' ')] }, { revision: 0, nodes: [node('__internal__')] },
  ]) expect(() => readPromptLibraryCategoryTree(invalid)).toThrow();
  const nodes = Array.from({ length: 1000 }, (_, index) => node(`层${index}`, index ? `层${index - 1}` : null));
  const deep = readPromptLibraryCategoryTree({ revision: 0, nodes });
  expect(getDirectoryPath(deep.nodes, '层999')).toHaveLength(1000);
  expect(readPromptLibraryCategoryTree({ revision: 0, nodes: [...nodes, node('更多')] }).nodes).toHaveLength(1001);
  expect(projectPromptLibraryCategoryTree([], ['新增'], deep).nodes).toHaveLength(1001);
});

it('1001个以上旧分类与合法分隔符标签完整投影，不受独立names名单限制且原tags逐项不变', () => {
  const tags = [...Array.from({ length: 1001 }, (_, index) => `旧标签${index}`), '旧,逗号', '旧，中文逗号', '旧\n换行', '旧\r换行', '很长'.repeat(120)];
  const combo = { ...createCombinationData('旧组合', { scene: { kind: 'scene', text: 'night', filled: true } }), id: 'legacy', tags } as PromptChain;
  const before = structuredClone(combo);
  const projected = projectPromptLibraryCategoryTree([combo], ['空分类'], emptyPromptLibraryCategoryTree());
  expect(projected.nodes.map(item => item.id)).toEqual(['空分类', ...tags]);
  expect(projectPromptLibraryCategoryTree([], tags, emptyPromptLibraryCategoryTree()).nodes.map(item => item.id)).toEqual(tags);
  expect(readPromptLibraryCategoryTree(projected)).toEqual(projected);
  expect(combo).toEqual(before);
  const moved = readPromptLibraryCategoryTree({ ...projected, nodes: projected.nodes.map(item => item.id === '旧\n换行' ? { ...item, parentId: '旧,逗号' } : item) });
  expect(promptLibraryCategoryLabel(moved, '旧\n换行')).toBe('旧,逗号 / 旧\n换行');
  expect(renamePromptLibraryCategory(moved, '旧,逗号', '新分类').nodes.find(item => item.id === '旧\n换行')?.parentId).toBe('新分类');
  expect(removePromptLibraryCategory(moved, '旧,逗号').nodes.find(item => item.id === '旧\n换行')?.parentId).toBeNull();
  expect(renamePromptLibraryCategory(moved, '空分类', '旧,逗号').nodes.some(item => item.id === '空分类')).toBe(false);
  expect(() => renamePromptLibraryCategory(moved, '空分类', '新,分类')).toThrow();
  expect(() => readPromptLibraryTagNames(tags)).toThrow();
  expect(() => readPromptLibraryTagNames(['非法,新名单'])).toThrow();
});

it('改名同步节点身份和直接孩子父名，保持其他节点和输入不变', () => {
  const original = tree(), before = structuredClone(original);
  const renamed = renamePromptLibraryCategory(original, '旧分类', '新分类');
  expect(renamed.nodes.find(item => item.id === '新分类')).toEqual(node('新分类', '祖先'));
  expect(getDirectoryPath(renamed.nodes, '后代').map(item => item.id)).toEqual(['祖先', '新分类', '孩子', '后代']);
  expect(renamed.nodes.find(item => item.id === '旁支')?.parentId).toBe('新分类');
  expect(renamed.revision).toBe(original.revision);
  expect(original).toEqual(before);
  expect(renamePromptLibraryCategory(original, '旧分类', '旧分类')).toEqual(original);
  expect(() => renamePromptLibraryCategory(original, 'missing', '新')).toThrow('不存在');
});

it('合并到其他分类或祖先时孩子挂目标，合并到自身后代先安全提升目标避免成环', () => {
  for (const target of ['目标', '祖先', '后代', '孩子']) {
    const merged = renamePromptLibraryCategory(tree(), '旧分类', target);
    expect(merged.nodes.some(item => item.id === '旧分类')).toBe(false);
    expect(merged.nodes.find(item => item.id === '旁支')?.parentId).toBe(target);
    expect(readPromptLibraryCategoryTree(merged)).toEqual(merged);
  }
  const descendant = renamePromptLibraryCategory(tree(), '旧分类', '后代');
  expect(getDirectoryPath(descendant.nodes, '孩子').map(item => item.id)).toEqual(['祖先', '后代', '孩子']);
  const immediate = renamePromptLibraryCategory(tree(), '旧分类', '孩子');
  expect(getDirectoryPath(immediate.nodes, '后代').map(item => item.id)).toEqual(['祖先', '孩子', '后代']);
});

it('删除只移除本节点并提升直接子节点，保留更深层次与其他节点', () => {
  const removed = removePromptLibraryCategory(tree(), '旧分类');
  expect(removed.nodes.find(item => item.id === '孩子')?.parentId).toBe('祖先');
  expect(removed.nodes.find(item => item.id === '旁支')?.parentId).toBe('祖先');
  expect(getDirectoryPath(removed.nodes, '后代').map(item => item.id)).toEqual(['祖先', '孩子', '后代']);
  expect(removePromptLibraryCategory({ revision: 0, nodes: [node('根'), node('子', '根')] }, '根').nodes).toEqual([node('子')]);
  expect(removePromptLibraryCategory(tree(), 'missing')).toEqual(tree());
});

it('API读取不缓存，保存使用验证后完整树和服务端版本，失败不冒充空树', async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValueOnce(tree()).mockResolvedValueOnce({ revision: 0 });
  expect(await loadPromptLibraryCategoryTree(signal)).toEqual(tree());
  expect(api.get).toHaveBeenCalledWith('/prompt-library-category-tree', { cache: 'no-store', signal });
  await expect(loadPromptLibraryCategoryTree()).rejects.toThrow();
  vi.mocked(api.put).mockResolvedValueOnce({ ...tree(), revision: 5 });
  expect((await savePromptLibraryCategoryTree(tree())).revision).toBe(5);
  expect(api.put).toHaveBeenCalledWith('/prompt-library-category-tree', tree());
  const conflict = Object.assign(new Error('其他窗口已更新'), { status: 409 });
  vi.mocked(api.put).mockRejectedValueOnce(conflict);
  await expect(savePromptLibraryCategoryTree(tree())).rejects.toBe(conflict);
  await expect(savePromptLibraryCategoryTree({ revision: -1, nodes: [] })).rejects.toThrow();
  expect(api.put).toHaveBeenCalledTimes(2);
});
