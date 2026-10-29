import React, { useMemo } from 'react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { getPromptLibraryDirectoryPath, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { librarySectionOf } from '../services/promptLibraryEntries';
import { DIRECTORY_FAVORITES_ID, DirectoryTreeNavigation } from './DirectoryTreeNavigation';

export interface PromptLibraryDirectorySelection {
  directoryIds: string[];
  allDirectories: boolean;
  unclassified: boolean;
  favorites?: boolean;
}

interface PromptLibraryDirectoryNavigationProps {
  id?: string;
  state: PromptLibraryTreeState;
  entries: PromptChain[];
  selectedIds: string[];
  allSelected: boolean;
  unclassified: boolean;
  favorites?: boolean;
  favoriteIds?: ReadonlySet<string>;
  onSelect: (selection: PromptLibraryDirectorySelection) => void;
  expanded: boolean;
  onCreate?: (parentId: string | null) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, parentId: string | null) => void;
  disabled?: boolean;
  embedded?: boolean;
  countsPending?: boolean;
}

export function PromptLibraryDirectoryNavigation({ id, state, entries, selectedIds, allSelected, unclassified, favorites = false, favoriteIds, onSelect, expanded, onCreate, onRename, onDelete, onMove, disabled = false, embedded = false, countsPending = false }: PromptLibraryDirectoryNavigationProps) {
  useLanguage();
  const counts = useMemo(() => {
    const values = new Map<string, Set<string>>([['*', new Set()], ['', new Set()], ...state.nodes.map(node => [node.id, new Set<string>()] as [string, Set<string>])]);
    for (const entry of entries) {
      if (!librarySectionOf(entry)) continue;
      values.get('*')!.add(entry.id);
      if (!isPromptLibraryFragmentEntry(entry)) continue;
      const directoryIds = getPromptLibraryEntryDirectoryIds(entry, state);
      if (!directoryIds.length) values.get('')!.add(entry.id);
      for (const directoryId of directoryIds) for (const node of getPromptLibraryDirectoryPath(state, directoryId)) values.get(node.id)?.add(entry.id);
    }
    const counts = new Map<string, number | string>([...values].map(([key, ids]) => [key, countsPending && !ids.size ? '—' : ids.size]));
    counts.set(DIRECTORY_FAVORITES_ID, favoriteIds ? new Set(entries.filter(entry => librarySectionOf(entry) && favoriteIds.has(entry.id)).map(entry => entry.id)).size : '?');
    if (countsPending && (counts.get(DIRECTORY_FAVORITES_ID) === 0 || counts.get(DIRECTORY_FAVORITES_ID) === '?')) counts.set(DIRECTORY_FAVORITES_ID, '—');
    return counts;
  }, [entries, state, favoriteIds, countsPending]);
  const select = (value: string) => onSelect({ directoryIds: value && value !== '*' && value !== DIRECTORY_FAVORITES_ID ? [value] : [], allDirectories: value === '*', unclassified: value === '', ...(value === DIRECTORY_FAVORITES_ID ? { favorites: true } : {}) });
  if (!expanded) return null;
  return <DirectoryTreeNavigation id={id} label={t('提示词目录导航')} title={t('提示词目录')}
    className="prompt-library-directory-navigation" nodes={state.nodes}
    selectedId={favorites ? DIRECTORY_FAVORITES_ID : allSelected ? '*' : unclassified && !selectedIds.length ? '' : selectedIds.length === 1 && !unclassified ? selectedIds[0] : '#selected'}
    selectedIds={favorites ? [DIRECTORY_FAVORITES_ID] : allSelected ? ['*'] : [...selectedIds, ...(unclassified ? [''] : [])]}
    virtualNodes={[{ id: DIRECTORY_FAVORITES_ID, name: t('收藏') }]}
    onSelect={select} expanded={expanded} preferenceKey="nai-prompt-library-directory-branches" counts={counts}
    onCreate={onCreate} onRename={onRename} onDelete={onDelete} onMove={onMove} disabled={disabled} embedded={embedded} selectLabel={t('选择提示词目录')} />;
}
