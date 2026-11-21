import type { PromptChain } from '../types';

export const OWN_CHAIN_PARTITION = 'own';
export const LEGACY_BUNDLE_PARTITION = 'legacy-imports';
export const CHAIN_PARTITION_STORAGE_KEY = 'nai_style_partition';
const validBundle = (value: unknown): value is { id: string; name: string } => {
  const item = value as { id?: unknown; name?: unknown } | null;
  return Boolean(item && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && typeof item.name === 'string' && item.name.trim());
};
export const hasLegacyChainPartition = (chains: PromptChain[]) => chains.some(chain =>
  /^naia-[a-f0-9]{64}$/.test(chain.id) || chain.params?._chainPartition?.id === LEGACY_BUNDLE_PARTITION);

/** 分区是本机收录归属，不随配方分享，也不进入生成参数。 */
export function getChainPartition(chain: PromptChain): string {
  const selected = chain.params?._chainPartition;
  if (selected && (selected.id === OWN_CHAIN_PARTITION || selected.id === LEGACY_BUNDLE_PARTITION || validBundle(selected))) return selected.id;
  const imported = chain.params?._styleBundleImport;
  if (validBundle(imported)) return imported.id;
  // 旧分享包导入器的专属操作 ID 可确定来源，但旧格式没有保存原文件名。
  return /^naia-[a-f0-9]{64}$/.test(chain.id) ? LEGACY_BUNDLE_PARTITION : OWN_CHAIN_PARTITION;
}

export function getBundlePartitions(chains: PromptChain[]): Array<{ id: string; name: string }> {
  const partitions = new Map<string, string>();
  // 原始包信息继续登记，兼容已有归属调整而不丢失包入口。
  for (const chain of chains) {
    const imported = chain.params?._styleBundleImport;
    if (validBundle(imported) && !partitions.has(imported.id)) partitions.set(imported.id, imported.name);
  }
  for (const chain of chains) {
    const selected = chain.params?._chainPartition;
    if (validBundle(selected) && !partitions.has(selected.id)) partitions.set(selected.id, selected.name);
  }
  // 同名不同包保持独立；后缀只用于显示，不改名或合并配方。
  const names = new Map<string, number>();
  const reserved = new Set(partitions.values());
  return [...partitions].sort(([a], [b]) => a.localeCompare(b)).map(([id, name]) => {
    let number = (names.get(name) || 0) + 1;
    while (number > 1 && reserved.has(`${name} (${number})`)) number++;
    names.set(name, number);
    return { id, name: number > 1 ? `${name} (${number})` : name };
  });
}
