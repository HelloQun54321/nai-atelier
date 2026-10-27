import React, { useMemo } from 'react';
import type { PromptChain } from '../types';
import { t, useLanguage } from '../services/i18n';
import { getPromptLibraryDirectoryPath, getPromptLibraryEntryDirectoryIds, isPromptLibraryFragmentEntry, type PromptLibraryTreeState } from '../services/promptLibraryTree.mjs';
import { librarySectionOf } from '../services/promptLibraryEntries';
import { DirectoryTreeNavigation } from './DirectoryTreeNavigation';

export interface PromptLibraryDirectorySelection {
  directoryIds: string[];
  allDirectories: boolean;
  unclassified: boolean;
}

interface PromptLibraryDirectoryNavigationProps {
  id?: string;
  state: PromptLibraryTreeState;
  entries: PromptChain[];
  selectedIds: string[];
  allSelected: boolean;
  unclassified: boolean;
  onSelect: (selection: PromptLibraryDirectorySelection) => void;
  expanded: boolean;
  onCreate?: (parentId: string | null) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, parentId: string | null) => void;
  disabled?: boolean;
  embedded?: boolean;
}

export function PromptLibraryDirectoryNavigation({ id, state, entries, selectedIds, allSelected, unclassified, onSelect, expanded, onCreate, onRename, onDelete, onMove, disabled = false, embedded = false }: PromptLibraryDirectoryNavigationProps) {
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
    return new Map([...values].map(([key, ids]) => [key, ids.size]));
  }, [entries, state]);
  const select = (value: string) => onSelect({ directoryIds: value && value !== '*' ? [value] : [], allDirectories: value === '*', unclassified: value === '' });
  if (!expanded) return null;
  return <DirectoryTreeNavigation id={id} label={t('提示词目录导航')} title={t('提示词目录')}
    className="prompt-library-directory-navigation" nodes={state.nodes}
    selectedId={allSelected ? '*' : unclassified && !selectedIds.length ? '' : selectedIds.length === 1 && !unclassified ? selectedIds[0] : '#selected'}
    selectedIds={allSelected ? ['*'] : [...selectedIds, ...(unclassified ? [''] : [])]}
    onSelect={select} expanded={expanded} preferenceKey="nai-prompt-library-directory-branches" counts={counts}
    onCreate={onCreate} onRename={onRename} onDelete={onDelete} onMove={onMove} disabled={disabled} embedded={embedded} selectLabel={t('选择提示词目录')} />;
}
