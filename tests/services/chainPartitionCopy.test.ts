import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { copyChainsToPartition } from '../../services/chainPartitionCopy';
vi.mock('../../services/api', () => ({ api: { post: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
it('复制接口发送原 ID、目标和稳定操作 ID，回执要求独立新 ID', async () => {
  vi.mocked(api.post).mockResolvedValue({ sourceIds: ['a', 'b'], copiedIds: ['copy-a', 'copy-b'], partitionId: 'own' });
  await copyChainsToPartition(['a', 'b', 'a'], 'own', 'copy-operation-1');
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/chains/copy-partition', { ids: ['a', 'b'], target: 'own', operation: 'copy-operation-1' });
  for (const result of [{ sourceIds: ['a'], copiedIds: ['copy-a'], partitionId: 'own' }, { sourceIds: ['a', 'b'], copiedIds: ['copy-a', 'copy-b'], partitionId: 'other' }, { sourceIds: ['a', 'b'], copiedIds: ['a', 'b'], partitionId: 'own' }, { sourceIds: ['a', 'b'], copiedIds: ['copy-a', 'copy-a'], partitionId: 'own' }]) {
    vi.mocked(api.post).mockResolvedValue(result);
    await expect(copyChainsToPartition(['a', 'b'], 'own', 'copy-operation-1')).rejects.toThrow('回执无效');
  }
});
