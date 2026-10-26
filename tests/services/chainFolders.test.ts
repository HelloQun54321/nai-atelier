import { describe, expect, it } from 'vitest';
import { emptyChainFolders, folderContains, folderTree, getChainFolderIds, readChainFolders, removeChainFolder, updateChainFolderMemberships } from '../../services/chainFolders';

const state = () => ({ revision: 3, folders: [
  { id: 'root', name: '画风实验', parentId: null }, { id: 'child', name: '平涂', parentId: 'root' },
], assignments: { a: ['root'], b: ['child'] } });
describe('风格串目录规则', () => {
  it('旧单归属只在读取时规范化，重复归属去重，空归属视为未整理', () => {
    const original = { ...state(), assignments: { a: 'root', b: ['root', 'child', 'root'], c: [] } };
    expect(readChainFolders(original).assignments).toEqual({ a: ['root'], b: ['root', 'child'] });
    expect(original.assignments.a).toBe('root');
  });
  it('仅增删触及的文件夹，保留不同条目的其他归属，不生成配方副本', () => {
    const original = state();
    const added = updateChainFolderMemberships(original, ['a', 'b'], { root: true });
    expect(added.assignments).toEqual({ a: ['root'], b: ['child', 'root'] });
    const removed = updateChainFolderMemberships(added, ['a', 'b'], { root: false });
    expect(removed.assignments).toEqual({ b: ['child'] });
    expect(getChainFolderIds(removed, 'a')).toEqual([]);
    expect(original.assignments).toEqual({ a: ['root'], b: ['child'] });
  });
  it('删除目录保留同一条风格串的其他归属', () => {
    expect(removeChainFolder({ ...state(), assignments: { a: ['root', 'child'] } }, 'root').assignments).toEqual({ a: ['child'] });
  });
  it('旧配方不迁移；父目录包含子目录，树保持层级', () => {
    expect(emptyChainFolders()).toEqual({ revision: 0, folders: [], assignments: {} });
    expect(folderContains(state().folders, 'root', 'child')).toBe(true);
    expect(folderContains(state().folders, 'child', 'root')).toBe(false);
    expect(folderTree(state().folders).map(folder => [folder.id, folder.depth])).toEqual([['root', 0], ['child', 1]]);
  });
  it('删除目录只清除直接归属并提升子目录，不删除其他归属', () => {
    const original = state();
    const next = removeChainFolder(original, 'root');
    expect(next.folders).toEqual([{ id: 'child', name: '平涂', parentId: null }]);
    expect(next.assignments).toEqual({ b: ['child'] });
    expect(original.assignments.a).toEqual(['root']);
    expect(readChainFolders(next)).toEqual(next);
  });
  it('拒绝循环、悬空父目录与同级重名，但允许不同目录同名', () => {
    expect(() => readChainFolders({ ...state(), folders: [{ id: 'root', name: '循环', parentId: 'root' }] })).toThrow();
    expect(() => readChainFolders({ ...state(), folders: [{ id: 'root', name: '悬空', parentId: 'missing' }] })).toThrow();
    expect(() => readChainFolders({ ...state(), folders: [...state().folders, { id: 'dup', name: '画风实验', parentId: null }] })).toThrow('同名');
    expect(readChainFolders({ ...state(), folders: [...state().folders, { id: 'other', name: '平涂', parentId: null }] }).folders).toHaveLength(3);
  });
  it('提升子目录遇到同级重名时加编号，保留目录 ID 与内容归属', () => {
    const next = removeChainFolder({ ...state(), folders: [...state().folders, { id: 'existing', name: '平涂', parentId: null }] }, 'root');
    expect(next.folders.find(folder => folder.id === 'child')?.name).toBe('平涂 (2)');
    expect(next.assignments.b).toEqual(['child']);
    expect(readChainFolders(next)).toEqual(next);
  });
  it.each([null, { ...state(), revision: -1 }, { ...state(), assignments: { a: 'missing' } }, { ...state(), assignments: { a: ['root', 'missing'] } }, { ...state(), assignments: { a: null } }, { ...state(), assignments: { a: 1 } }, { ...state(), folders: [{ id: 'root', name: ' ', parentId: null }] }])('非法资料整份拒绝 %j', value => {
    expect(() => readChainFolders(value)).toThrow();
  });
});
