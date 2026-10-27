import type { PromptChain } from '../types';
import { getCustomChainTags } from './chainTags';
import { librarySectionOf } from './promptLibraryEntries';
import type { PromptLibraryCategoryTreeState } from './promptLibraryCategoryTree';
import { flattenDirectoryTree } from './directoryTree.mjs';

export interface PromptLibraryCategorySnapshot { chains: PromptChain[]; names: string[]; tree?: PromptLibraryCategoryTreeState }

/** 空分类来自目录，使用数只统计组合，不借用片段或原文的同名标签。 */
export function promptLibraryCategoryCounts(chains: PromptChain[], names: string[] = [], tree?: PromptLibraryCategoryTreeState): Array<[string, number]> {
  if (tree) {
    const ancestors = new Map(flattenDirectoryTree(tree.nodes).map(node => [node.id, node.path]));
    const members = new Map([...names, ...tree.nodes.map(node => node.id)].map(name => [name, new Set<string>()]));
    for (const chain of chains.filter(chain => librarySectionOf(chain) === 'saved')) for (const tag of getCustomChainTags(chain.tags)) for (const id of ancestors.get(tag) || [tag]) {
      if (!members.has(id)) members.set(id, new Set());
      members.get(id)!.add(chain.id);
    }
    return [...members].map(([name, ids]): [string, number] => [name, ids.size]).sort((a, b) => a[0].localeCompare(b[0]));
  }
  const counts = new Map(names.map(name => [name, 0]));
  chains.filter(chain => librarySectionOf(chain) === 'saved').forEach(chain => {
    getCustomChainTags(chain.tags).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

export const promptLibraryCategoryNames = (chains: PromptChain[], names: string[] = []): string[] => promptLibraryCategoryCounts(chains, names).map(([name]) => name);

/** 只构造标签补丁，其他标签原样保留，合并时同名去重。 */
export function promptLibraryCategoryUpdates(chains: PromptChain[], from: string, to: string): Array<{ id: string; tags: string[] }> {
  return chains.filter(chain => librarySectionOf(chain) === 'saved' && getCustomChainTags(chain.tags).includes(from))
    .map(chain => ({ id: chain.id, tags: [...new Set((chain.tags || []).map(tag => tag.trim() === from ? to : tag))] }));
}
