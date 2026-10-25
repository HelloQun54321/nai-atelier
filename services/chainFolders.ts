/** 风格串的目录与归属独立保存，不改写配方、标签或原图。 */
export interface ChainFolder { id: string; name: string; parentId: string | null }
export interface ChainFolderState { revision: number; folders: ChainFolder[]; assignments: Record<string, string> }
export const emptyChainFolders = (): ChainFolderState => ({ revision: 0, folders: [], assignments: {} });

export function readChainFolders(value: unknown): ChainFolderState {
  const state = value as ChainFolderState;
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,120}$/.test(id);
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.folders)
    || state.folders.length > 500 || !state.assignments || typeof state.assignments !== 'object' || Array.isArray(state.assignments)) throw Error('文件夹数据无效');
  const folders = state.folders.map(folder => {
    if (!folder || !validId(folder.id) || typeof folder.name !== 'string' || !folder.name.trim() || folder.name.length > 60
      || !(folder.parentId === null || validId(folder.parentId))) throw Error('文件夹名称或位置无效');
    return { id: folder.id, name: folder.name.trim(), parentId: folder.parentId };
  });
  const ids = new Set(folders.map(folder => folder.id));
  const names = new Set(folders.map(folder => JSON.stringify([folder.parentId, folder.name.toLowerCase()])));
  if (ids.size !== folders.length || names.size !== folders.length) throw Error('同一位置已有同名文件夹');
  const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent !== null) {
      if (!ids.has(parent) || visited.has(parent)) throw Error('文件夹层级无效');
      visited.add(parent); parent = parents.get(parent)!;
    }
  }
  const entries = Object.entries(state.assignments);
  if (entries.length > 100000 || entries.some(([id, folder]) => !validId(id) || !ids.has(folder))) throw Error('风格串归属无效');
  return { revision: state.revision, folders, assignments: Object.fromEntries(entries) };
}

export function folderTree(folders: ChainFolder[], parentId: string | null = null, depth = 0): Array<ChainFolder & { depth: number }> {
  return folders.filter(folder => folder.parentId === parentId).flatMap(folder => [
    { ...folder, depth }, ...folderTree(folders, folder.id, depth + 1),
  ]);
}

export function folderContains(folders: ChainFolder[], ancestor: string, folderId: string | undefined): boolean {
  const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
  let cursor = folderId;
  while (cursor) { if (cursor === ancestor) return true; cursor = parents.get(cursor) || undefined; }
  return false;
}

export function removeChainFolder(state: ChainFolderState, id: string): ChainFolderState {
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
    assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, folder]) => folder !== id)),
  };
}
