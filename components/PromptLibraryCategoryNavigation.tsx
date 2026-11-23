import React, { useMemo } from 'react';
import type { PromptChain } from '../types';
import { getCustomChainTags } from '../services/chainTags';
import { promptLibraryCategoryCounts } from '../services/promptLibraryCategories';
import { emptyPromptLibraryCategoryTree, listPromptLibraryCustomCharacters, projectPromptLibraryCategoryTree, type PromptLibraryCategoryTreeState } from '../services/promptLibraryCategoryTree';
import { t, useLanguage } from '../services/i18n';
import { DirectoryTreeNavigation } from './DirectoryTreeNavigation';

export interface PromptLibraryCategorySelection { category: string | null; unclassified: boolean }
const encode = (id: string) => 'category:' + id;

export function PromptLibraryCategoryNavigation({ id, chains, customCharacters: suppliedCharacters, names, tree: storedTree, selected, unclassified, expanded, onSelect, onRequestClose, disabled, countsPending = false }: {
  id: string; chains: PromptChain[]; customCharacters?: Array<{ id: string; name: string }>; names: string[]; tree?: PromptLibraryCategoryTreeState; selected: string | null; unclassified: boolean; expanded: boolean;
  countsPending?: boolean;
  onSelect: (selection: PromptLibraryCategorySelection) => void;
  onRequestClose?: () => void;
  disabled?: boolean;
}) {
  useLanguage();
  const entries = useMemo(() => [...new Map(chains.map(chain => [chain.id, chain])).values()], [chains]);
  const characters = useMemo(() => suppliedCharacters ?? listPromptLibraryCustomCharacters(chains), [suppliedCharacters, chains]);
  const tree = useMemo(
    () => projectPromptLibraryCategoryTree(entries, getCustomChainTags([...names, ...(selected ? [selected] : [])]), storedTree || emptyPromptLibraryCategoryTree(), characters),
    [entries, names, selected, storedTree, characters],
  );
  const nodes = useMemo(() => tree.nodes.map(node => ({ ...node, id: encode(node.id), parentId: node.parentId === null ? null : encode(node.parentId) })), [tree]);
  const counts = useMemo(() => {
    const values = new Map<string, number | string>(promptLibraryCategoryCounts(entries, names, tree).map(([name, count]) => [encode(name), count] as const));
    if (countsPending) for (const [key, count] of values) if (count === 0) values.set(key, '—');
    return values;
  }, [tree, entries, names, countsPending]);
  const folderIds = useMemo(() => new Set(tree.nodes.map(node => node.id)), [tree]);
  const uncategorized = useMemo(() => entries.filter(chain => !getCustomChainTags(chain.tags).some(tag => folderIds.has(tag))).length, [entries, folderIds]);
  return <DirectoryTreeNavigation id={id} label={t('组合分类导航')} title={t('组合分类')} selectLabel={t('选择组合分类')} nodes={nodes}
    selectedId={selected !== null ? encode(selected) : unclassified ? '' : '*'} onSelect={value => onSelect({ category: value.startsWith('category:') ? value.slice('category:'.length) : null, unclassified: value === '' })}
    expanded={expanded} disabled={disabled} onRequestClose={onRequestClose} preferenceKey="nai-prompt-library-combination-category-branches" counts={counts} totalCount={countsPending && !entries.length ? '—' : entries.length} unclassifiedCount={countsPending && !uncategorized ? '—' : uncategorized}
    nodeProps={value => value.startsWith('category:') ? { 'aria-label': t('分类「{0}」', [value.slice('category:'.length)]) } : {}} />;
}
