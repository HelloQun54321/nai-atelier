import { getDirectoryDescendantIds, validateDirectoryTree } from './directoryTree.mjs';

/** 用户分组只记录目录身份，不改写 Tag、偏好、配方或图片。 */
export type CatalogGroupKind = 'artist' | 'character';
export interface CatalogGroup { id: string; name: string; parentId?: string | null }
export interface CatalogGroupState { revision: number; groups: CatalogGroup[]; memberships: Record<string, string[]> }
export const emptyCatalogGroups = (): CatalogGroupState => ({ revision: 0, groups: [], memberships: {} });
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,120}$/.test(id) && !reserved.has(id);
const validKey = (key: string) => key.length <= 512 && /^(artist|catalog|custom):[^\u0000-\u001f\u007f]+$/u.test(key) && Boolean(key.slice(key.indexOf(':') + 1).trim());

export function readCatalogGroups(value: unknown): CatalogGroupState {
  const state = value as CatalogGroupState;
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.groups) || state.groups.length > 500
    || !state.memberships || typeof state.memberships !== 'object' || Array.isArray(state.memberships)) throw Error('分组数据无效');
  const groups = state.groups.map(group => {
    if (!group || !validId(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 60
      || !(group.parentId == null || validId(group.parentId))) throw Error('分组名称无效');
    return { id: group.id, name: group.name.trim(), ...(group.parentId === undefined ? {} : { parentId: group.parentId }) };
  });
  const ids = new Set(groups.map(group => group.id));
  if (ids.size !== groups.length || new Set(groups.map(group => JSON.stringify([group.parentId ?? null, group.name.toLowerCase()]))).size !== groups.length) throw Error('已有同名分组');
  validateDirectoryTree(groups);
  const entries = Object.entries(state.memberships);
  if (entries.length > 100000 || entries.some(([key, memberships]) => !validKey(key) || !Array.isArray(memberships) || memberships.length > groups.length
    || memberships.some(id => typeof id !== 'string' || !ids.has(id)) || new Set(memberships).size !== memberships.length)) throw Error('分组归属无效');
  return { revision: state.revision, groups, memberships: Object.fromEntries(entries.map(([key, memberships]) => [key, [...memberships]])) };
}

export function matchesCatalogGroup(state: CatalogGroupState, active: string, key: string): boolean {
  const memberships = state.memberships[key] || [];
  if (active === '*') return true;
  if (active === '') return memberships.length === 0;
  const descendants = getDirectoryDescendantIds(state.groups, active);
  return memberships.some(id => descendants.has(id));
}

export function updateCatalogGroupMemberships(state: CatalogGroupState, keys: readonly string[], changes: Record<string, boolean>): CatalogGroupState {
  const checked = readCatalogGroups(state);
  const ids = new Set(checked.groups.map(group => group.id));
  const touched = Object.entries(changes);
  if (touched.some(([id, selected]) => !ids.has(id) || typeof selected !== 'boolean')) throw Error('分组归属无效');
  for (const key of new Set(keys)) {
    if (!validKey(key)) throw Error('分组归属无效');
    const memberships = new Set(checked.memberships[key] || []);
    for (const [id, selected] of touched) { if (selected) memberships.add(id); else memberships.delete(id); }
    if (memberships.size) checked.memberships[key] = [...memberships]; else delete checked.memberships[key];
  }
  return checked;
}

export function removeCatalogGroup(state: CatalogGroupState, id: string): CatalogGroupState {
  const checked = readCatalogGroups(state);
  const parentId = checked.groups.find(group => group.id === id)?.parentId ?? null;
  const names = new Set(checked.groups.filter(group => group.id !== id && (group.parentId ?? null) === parentId).map(group => group.name.toLowerCase()));
  return { ...checked, groups: checked.groups.filter(group => group.id !== id).map(group => {
    if (group.parentId !== id) return group;
    let name = group.name, suffix = 2;
    while (names.has(name.toLowerCase())) { const ending = ` (${suffix++})`; name = group.name.slice(0, 60 - ending.length) + ending; }
    names.add(name.toLowerCase());
    return { ...group, name, parentId };
  }), memberships: Object.fromEntries(Object.entries(checked.memberships)
    .map(([key, memberships]) => [key, memberships.filter(group => group !== id)] as const).filter(([, memberships]) => memberships.length > 0)) };
}
