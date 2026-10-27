import type { InspirationBoard } from '../types';
import { validateDirectoryTree } from './directoryTree.mjs';

export interface CollectionBoardTree { revision: number; parents: Record<string, string | null> }

export const collectionBoardTreeKey = (userId: string) => `collection_board_tree_v1:${userId}`;

/** 缺记录的旧收藏夹按根目录投影；损坏的已存父图必须明确报错。 */
export function readCollectionBoardTree(raw: string | null, boards: InspirationBoard[]): CollectionBoardTree {
  const tree: CollectionBoardTree = raw === null ? { revision: 0, parents: {} } : JSON.parse(raw);
  if (!tree || !Number.isSafeInteger(tree.revision) || tree.revision < 0 || !tree.parents || typeof tree.parents !== 'object' || Array.isArray(tree.parents)) throw Error('收藏夹目录数据无效');
  const ids = new Set(boards.map(board => board.id));
  if (Object.entries(tree.parents).some(([id, parent]) => !ids.has(id) || !(parent === null || typeof parent === 'string' && ids.has(parent)))) throw Error('收藏夹目录归属无效');
  validateDirectoryTree(projectCollectionBoardTree(boards, tree));
  return tree;
}

export const projectCollectionBoardTree = (boards: InspirationBoard[], tree: CollectionBoardTree): InspirationBoard[] =>
  boards.map(board => ({ ...board, parentId: Object.hasOwn(tree.parents, board.id) ? tree.parents[board.id] : null }));

/** 删除只提升直接子目录，保留其 ID、颜色、排序及作品关系。 */
export function removeCollectionBoardTreeNode(tree: CollectionBoardTree, id: string): CollectionBoardTree {
  const parent = Object.hasOwn(tree.parents, id) ? tree.parents[id] : null;
  return { revision: tree.revision + 1, parents: Object.fromEntries(Object.entries(tree.parents)
    .filter(([node]) => node !== id).map(([node, value]) => [node, value === id ? parent : value])) };
}
