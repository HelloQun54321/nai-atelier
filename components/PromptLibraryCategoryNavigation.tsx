import React, { useMemo } from 'react';
import type { PromptChain } from '../types';
import { getCustomChainTags } from '../services/chainTags';
import { promptLibraryCategoryCounts } from '../services/promptLibraryCategories';
import { emptyPromptLibraryCategoryTree, projectPromptLibraryCategoryTree, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { t, useLanguage } from '../services/i18n';
import { DIRECTORY_FAVORITES_ID, DirectoryTreeNavigation } from './DirectoryTreeNavigation';

export interface PromptLibraryCategorySelection { category: string | null; unclassified: boolean; favorites?: boolean }
const encode = (id: string) => 'category:' + id;

export function PromptLibraryCategoryNavigation({ id, chains, names, tree: storedTree, selected, unclassified, favorites = false, favoriteIds, expanded, onSelect, onMove, onCreate, onRename, onDelete, disabled }: {
  id: string; chains: PromptChain[]; names: string[]; tree?: PromptLibraryCategoryTreeState; selected: string | null; unclassified: boolean; expanded: boolean;
  favorites?: boolean; favoriteIds?: ReadonlySet<string>;
  onSelect: (selection: PromptLibraryCategorySelection) => void;
  onMove?: (id: string, parentId: string | null) => void; disabled?: boolean;
  onCreate?: (parentId: string | null) => void; onRename?: (id: string) => void; onDelete?: (id: string) => void;
}) {
  useLanguage();
  const entries = useMemo(() => [...new Map(chains.map(chain => [chain.id, chain])).values()], [chains]);
  const tree = useMemo(() => projectPromptLibraryCategoryTree(entries, getCustomChainTags([...names, ...(selected ? [selected] : [])]), storedTree || emptyPromptLibraryCategoryTree()), [entries, names, selected, storedTree]);
  const nodes = useMemo(() => tree.nodes.map(node => ({ ...node, id: encode(node.id), parentId: node.parentId === null ? null : encode(node.parentId) })), [tree]);
  const counts = useMemo(() => new Map<string, number | string>([...promptLibraryCategoryCounts(entries, names, tree).map(([name, count]) => [encode(name), count] as const), [DIRECTORY_FAVORITES_ID, favoriteIds ? entries.filter(entry => favoriteIds.has(entry.id)).length : '?']]), [tree, entries, names, favoriteIds]);
  const uncategorized = useMemo(() => entries.filter(chain => !getCustomChainTags(chain.tags).length).length, [entries]);
  return <DirectoryTreeNavigation id={id} label={t('组合分类导航')} title={t('组合分类')} selectLabel={t('选择组合分类')} nodes={nodes}
    selectedId={favorites ? DIRECTORY_FAVORITES_ID : selected !== null ? encode(selected) : unclassified ? '' : '*'} onSelect={value => onSelect({ category: value.startsWith('category:') ? value.slice('category:'.length) : null, unclassified: value === '', ...(value === DIRECTORY_FAVORITES_ID ? { favorites: true } : {}) })}
    virtualNodes={[{ id: DIRECTORY_FAVORITES_ID, name: t('收藏') }]}
    expanded={expanded} disabled={disabled} onMove={onMove ? (value, parent) => onMove(value.slice('category:'.length), parent === null ? null : parent.slice('category:'.length)) : undefined} preferenceKey="nai-prompt-library-combination-category-branches" counts={counts} totalCount={entries.length} unclassifiedCount={uncategorized}
    onRename={onRename ? value => onRename(value.slice('category:'.length)) : undefined} onDelete={onDelete ? value => onDelete(value.slice('category:'.length)) : undefined} onCreate={onCreate ? value => onCreate(value === null ? null : value.slice('category:'.length)) : undefined} nodeProps={value => value.startsWith('category:') ? { 'aria-label': t('分类「{0}」', [value.slice('category:'.length)]) } : {}} />;
}
