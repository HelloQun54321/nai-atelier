import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get: mocks.get } }));
import { getUsageAssets } from '../../services/usageStats';

beforeEach(() => vi.clearAllMocks());

it('资产统计读取轻量摘要并传递取消信号，不缓存旧数据', async () => {
  const signal = new AbortController().signal;
  const payload = { roll: [], vibes: [{ createdAt: 1, encodings: [] }], vibeGroups: [] };
  mocks.get.mockResolvedValue(payload);
  expect(await getUsageAssets(signal)).toEqual(payload);
  expect(mocks.get).toHaveBeenCalledWith('/local-usage/assets', { cache: 'no-store', signal });
});

it('分组失败保留未知状态，整个请求失败交由页面反馈', async () => {
  mocks.get.mockResolvedValue({ vibes: [], vibeGroups: null });
  expect(await getUsageAssets()).toEqual({ roll: undefined, vibes: [], vibeGroups: undefined });
  mocks.get.mockRejectedValue(new Error('合成错误'));
  await expect(getUsageAssets()).rejects.toThrow('合成错误');
});
