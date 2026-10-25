import type { PromptChain } from '../types';
import { getCustomChainTags } from './chainTags';
import { librarySectionOf } from './promptLibraryEntries';

export interface PromptLibraryCategorySnapshot { chains: PromptChain[]; names: string[] }

/** 空分类来自目录，使用数只统计组合，不借用片段或原文的同名标签。 */
export function promptLibraryCategoryCounts(chains: PromptChain[], names: string[] = []): Array<[string, number]> {
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
