import { expect, it } from 'vitest';
import { projectCollectionBoardTree, readCollectionBoardTree, removeCollectionBoardTreeNode } from '../../services/collectionBoardTree';
import type { InspirationBoard } from '../../types';

it('父图不限定目录深度，允许同名，旧根目录只投影且不改输入', () => {
  const boards: InspirationBoard[] = Array.from({ length: 1200 }, (_, index) => ({ id: `folder-${index}`, name: '同名', userId: 'owner', color: '#ec4899', sortOrder: index, createdAt: 1, updatedAt: 1 }));
  expect(projectCollectionBoardTree(boards, readCollectionBoardTree(null, boards)).every(board => board.parentId === null)).toBe(true);
  const raw = JSON.stringify({ revision: 3, parents: Object.fromEntries(boards.map((board, index) => [board.id, index ? boards[index - 1].id : null])) });
  const tree = readCollectionBoardTree(raw, boards);
  expect(projectCollectionBoardTree(boards, tree).at(-1)?.parentId).toBe('folder-1198');
  const removed = removeCollectionBoardTreeNode(tree, 'folder-600');
  expect(removed.parents['folder-601']).toBe('folder-599');
  expect(removed.parents['folder-602']).toBe('folder-601');
  expect(removed.parents).not.toHaveProperty('folder-600');
  expect(tree.parents['folder-601']).toBe('folder-600');
  expect(boards[0]).not.toHaveProperty('parentId');
});
