import type { PromptChain } from '../types';
import { api } from './api';
import { getCustomChainTags, isCustomChainTag } from './chainTags';
import { isContentRecord } from './contentRoll';
import { getDirectoryDescendantIds, getDirectoryPath, validateDirectoryTree } from './directoryTree.mjs';
import { readPromptLibraryTagNames } from './promptLibraryTags';

export interface PromptLibraryCategoryTreeNode { id: string; name: string; parentId: string | null }
export interface PromptLibraryCategoryTreeState { revision: number; nodes: PromptLibraryCategoryTreeNode[] }

export const emptyPromptLibraryCategoryTree = (): PromptLibraryCategoryTreeState => ({ revision: 0, nodes: [] });

export const promptLibraryCategoryLabel = (tree: PromptLibraryCategoryTreeState | undefined, name: string): string => tree ? getDirectoryPath(tree.nodes, name).map(node => node.name).join(' / ') || name : name;

/** 分类名沿用标签身份；只增加层级，不替换既有组合归属。 */
export function readPromptLibraryCategoryTree(value: unknown): PromptLibraryCategoryTreeState {
  const state = value as Partial<PromptLibraryCategoryTreeState> | null;
  if (!state || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || !Array.isArray(state.nodes)) throw new Error('组合分类树无效');
  const nodes = state.nodes.map(node => {
    if (!node || typeof node.name !== 'string' || node.id !== node.name || !(node.parentId === null || typeof node.parentId === 'string')) throw new Error('组合分类节点无效');
    if (!isCustomChainTag(node.name)) throw new Error('组合分类节点无效');
    const name = node.name.trim();
    const parentId = node.parentId === null ? null : node.parentId.trim();
    return { id: name, name, parentId };
  });
  validateDirectoryTree(nodes);
  return { revision: state.revision as number, nodes };
}

/** 只读补齐既有候选与组合标签；不丢弃侧存树中的空分类或旧层级。 */
export function projectPromptLibraryCategoryTree(chains: PromptChain[], names: string[], stored: PromptLibraryCategoryTreeState): PromptLibraryCategoryTreeState {
  const tree = readPromptLibraryCategoryTree(stored);
  const known = new Set(tree.nodes.map(node => node.id));
  const categories = getCustomChainTags([...names, ...chains.filter(isContentRecord).flatMap(chain => getCustomChainTags(chain.tags))]);
  const nodes = [...tree.nodes];
  for (const name of categories) if (!known.has(name)) {
    nodes.push({ id: name, name, parentId: null });
    known.add(name);
  }
  return readPromptLibraryCategoryTree({ ...tree, nodes });
}

/** 合并到后代时先提升目标，随后将原节点的直接子项挂到目标，避免成环。 */
export function renamePromptLibraryCategory(tree: PromptLibraryCategoryTreeState, from: string, to: string): PromptLibraryCategoryTreeState {
  const state = readPromptLibraryCategoryTree(tree);
  const name = state.nodes.find(node => node.id === to)?.name || readPromptLibraryTagNames([to])[0];
  const source = state.nodes.find(node => node.id === from);
  if (!source) throw new Error('组合分类不存在');
  if (from === name) return state;
  const merge = state.nodes.some(node => node.id === name);
  const liftTarget = merge && getDirectoryDescendantIds(state.nodes, from).has(name);
  return readPromptLibraryCategoryTree({ ...state, nodes: state.nodes.filter(node => !merge || node.id !== from).map(node => {
    if (liftTarget && node.id === name) return { ...node, parentId: source.parentId };
    return { ...node, ...(node.id === from ? { id: name, name } : {}), ...(node.parentId === from ? { parentId: name } : {}) };
  }) });
}

/** 删除只解除本分类，直接子项提升一级；组合标签由现有管理流程处理。 */
export function removePromptLibraryCategory(tree: PromptLibraryCategoryTreeState, id: string): PromptLibraryCategoryTreeState {
  const state = readPromptLibraryCategoryTree(tree);
  const parentId = state.nodes.find(node => node.id === id)?.parentId ?? null;
  return readPromptLibraryCategoryTree({ ...state, nodes: state.nodes.filter(node => node.id !== id).map(node => node.parentId === id ? { ...node, parentId } : node) });
}

export async function loadPromptLibraryCategoryTree(signal?: AbortSignal): Promise<PromptLibraryCategoryTreeState> {
  return readPromptLibraryCategoryTree(await api.get('/prompt-library-category-tree', { cache: 'no-store', signal }));
}

export async function savePromptLibraryCategoryTree(state: PromptLibraryCategoryTreeState): Promise<PromptLibraryCategoryTreeState> {
  return readPromptLibraryCategoryTree(await api.put('/prompt-library-category-tree', readPromptLibraryCategoryTree(state)));
}
