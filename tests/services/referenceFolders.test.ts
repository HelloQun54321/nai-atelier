import { describe, expect, it } from 'vitest';
import {
  emptyReferenceFolders, getReferenceFolderIds, readReferenceFolders, referenceFolderTree,
  removeReferenceFolder, updateReferenceFolderMemberships,
} from '../../services/referenceFolders';

const state = () => ({
  revision: 3,
  folders: [
    { id: 'role', name: '角色', parentId: null },
    { id: 'focal', name: '芙宁娜', parentId: 'role' },
    { id: 'style', name: '画风', parentId: null },
  ],
  assignments: { 'ref-1': ['focal', 'style'], 'ref-2': 'role' } as Record<string, string[] | string>,
});

describe('参考目录数据', () => {
  it('旧单归属按多归属读取，重复归属去重且不写回其它字段', () => {
    const parsed = readReferenceFolders(state());
    expect(parsed.assignments).toEqual({ 'ref-1': ['focal', 'style'], 'ref-2': ['role'] });
    expect(parsed.revision).toBe(3);
    expect(parsed.folders).toHaveLength(3);
  });

  it('拒绝循环层级、同名同级、未知归属与超量数据', () => {
    expect(() => readReferenceFolders({ revision: 0, folders: [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }], assignments: {} })).toThrow('目录层级无效');
    expect(() => readReferenceFolders({ revision: 0, folders: [{ id: 'a', name: 'A', parentId: null }, { id: 'b', name: 'a', parentId: null }], assignments: {} })).toThrow('同一位置已有同名目录');
    expect(() => readReferenceFolders({ revision: 0, folders: [], assignments: { ref: ['missing'] } })).toThrow('参考归属无效');
    expect(() => readReferenceFolders({ revision: -1, folders: [], assignments: {} })).toThrow('目录数据无效');
    expect(() => readReferenceFolders(null)).toThrow('目录数据无效');
  });

  it('多层目录按深度摊平，父目录能找到全部后代', () => {
    const { folders } = readReferenceFolders(state());
    expect(referenceFolderTree(folders).map(node => [node.id, node.depth])).toEqual([['role', 0], ['focal', 1], ['style', 0]]);
    expect(referenceFolderTree(folders, 'role')).toEqual([expect.objectContaining({ id: 'focal', depth: 0 })]);
  });

  it('整理归属只改动选中项，其余参考保持原样', () => {
    const start = readReferenceFolders(state());
    const next = updateReferenceFolderMemberships(start, ['ref-2'], { style: true, role: false });
    expect(next.assignments).toEqual({ 'ref-1': ['focal', 'style'], 'ref-2': ['style'] });
    expect(getReferenceFolderIds(start, 'ref-1')).toEqual(['focal', 'style']);
  });

  it('删除目录把子目录上移并保留参考，只移除该目录归属', () => {
    const start = readReferenceFolders(state());
    const next = removeReferenceFolder(start, 'role');
    expect(next.folders.map(folder => [folder.id, folder.parentId])).toEqual([['focal', null], ['style', null]]);
    expect(next.assignments).toEqual({ 'ref-1': ['focal', 'style'] });
  });

  it('空资料库是稳定初始值', () => {
    expect(emptyReferenceFolders()).toEqual({ revision: 0, folders: [], assignments: {} });
  });
});
