import { api } from './api';

export async function copyChainsToPartition(ids: string[], target: string, operation: string): Promise<void> {
  const unique = [...new Set(ids)];
  const result = await api.post('/chains/copy-partition', { ids: unique, target, operation });
  if (result?.partitionId !== target || !Array.isArray(result.sourceIds) || result.sourceIds.length !== unique.length || new Set(result.sourceIds).size !== unique.length || unique.some(id => !result.sourceIds.includes(id)) || !Array.isArray(result.copiedIds) || result.copiedIds.length !== unique.length || new Set(result.copiedIds).size !== unique.length || result.copiedIds.some((id: unknown) => typeof id !== 'string' || !id || unique.includes(id))) throw new Error('复制回执无效，请刷新列表核对');
}
