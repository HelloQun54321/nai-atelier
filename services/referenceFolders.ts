import { flattenDirectoryTree, getDirectoryDescendantIds, getDirectoryPath, validateDirectoryTree } from './directoryTree.mjs';

/**
 * 参考资料库（精准参考／氛围参考）的目录与归属，与风格串共用同一套
 * `directoryTree` 规则：多层、同一资源可归属多个目录。目录数据独立保存，
 * 不改写参考资产本身，也不参与删除时的创作引用检查。
 */
export const REFERENCE_FOLDER_KINDS = ['character-reference', 'vibe'] as const;
export type ReferenceFolderKind = typeof REFERENCE_FOLDER_KINDS[number];

export interface ReferenceFolder { id: string; name: string; parentId: string | null }
export interface ReferenceFolderState { revision: number; folders: ReferenceFolder[]; assignments: Record<string, string[]> }

export const emptyReferenceFolders = (): ReferenceFolderState => ({ revision: 0, folders: [], assignments: {} });

const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,120}$/.test(id);

export function readReferenceFolders(value: unknown): ReferenceFolderState {
  const state = value as ReferenceFolderState;
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.folders)
    || state.folders.length > 500 || !state.assignments || typeof state.assignments !== 'object' || Array.isArray(state.assignments)) throw Error('目录数据无效');
  const folders = state.folders.map(folder => {
    if (!folder || !validId(folder.id) || typeof folder.name !== 'string' || !folder.name.trim() || folder.name.length > 60
      || !(folder.parentId === null || validId(folder.parentId))) throw Error('目录名称或位置无效');
    return { id: folder.id, name: folder.name.trim(), parentId: folder.parentId };
  });
  const ids = new Set(folders.map(folder => folder.id));
  const names = new Set(folders.map(folder => JSON.stringify([folder.parentId, folder.name.toLowerCase()])));
  if (ids.size !== folders.length || names.size !== folders.length) throw Error('同一位置已有同名目录');
  try { validateDirectoryTree(folders); }
  catch { throw Error('目录层级无效'); }
  const entries = Object.entries(state.assignments).map(([id, value]) => [id, typeof value === 'string' ? [value] : value] as const);
  if (entries.length > 100000 || entries.some(([id, folders]) => !validId(id) || !Array.isArray(folders)
    || folders.length > 500 || folders.some(folder => typeof folder !== 'string' || !ids.has(folder)))) throw Error('参考归属无效');
  return { revision: state.revision, folders, assignments: Object.fromEntries(entries.filter(([, folders]) => folders.length).map(([id, folders]) => [id, [...new Set(folders)]])) };
}

export const getReferenceFolderIds = (state: ReferenceFolderState, assetId: string): string[] => state.assignments[assetId] || [];

export function updateReferenceFolderMemberships(state: ReferenceFolderState, assetIds: string[], changes: Record<string, boolean>): ReferenceFolderState {
  const assignments = { ...state.assignments };
  for (const id of assetIds) {
    const folders = new Set(getReferenceFolderIds(state, id));
    for (const [folder, selected] of Object.entries(changes)) { if (selected) folders.add(folder); else folders.delete(folder); }
    if (folders.size) assignments[id] = [...folders]; else delete assignments[id];
  }
  return { ...state, assignments };
}

export function referenceFolderTree(folders: ReferenceFolder[], parentId: string | null = null, depth = 0): Array<ReferenceFolder & { depth: number }> {
  const tree = flattenDirectoryTree(folders);
  if (parentId === null) return tree.map(folder => ({ ...folder, depth: folder.depth + depth }));
  const parent = tree.find(folder => folder.id === parentId);
  if (!parent) return [];
  const descendants = getDirectoryDescendantIds(folders, parentId);
  return tree.filter(folder => folder.id !== parentId && descendants.has(folder.id)).map(folder => ({ ...folder, depth: folder.depth - parent.depth - 1 + depth }));
}

export const referenceFolderContains = (folders: ReferenceFolder[], ancestor: string, folderId: string | undefined) =>
  Boolean(folderId && getDirectoryPath(folders, folderId).some(folder => folder.id === ancestor));

export function removeReferenceFolder(state: ReferenceFolderState, id: string): ReferenceFolderState {
  const parent = state.folders.find(folder => folder.id === id)?.parentId || null;
  const names = new Set(state.folders.filter(folder => folder.id !== id && folder.parentId === parent).map(folder => folder.name.toLowerCase()));
  return { ...state,
    folders: state.folders.filter(folder => folder.id !== id).map(folder => {
      if (folder.parentId !== id) return folder;
      let name = folder.name;
      let suffix = 2;
      while (names.has(name.toLowerCase())) { const ending = ` (${suffix++})`; name = folder.name.slice(0, 60 - ending.length) + ending; }
      names.add(name.toLowerCase());
      return { ...folder, name, parentId: parent };
    }),
    assignments: Object.fromEntries(Object.entries(state.assignments).map(([asset, folders]) => [asset, folders.filter(folder => folder !== id)] as const).filter(([, folders]) => folders.length)),
  };
}
