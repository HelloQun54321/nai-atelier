import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api', () => ({ api: apiMock }));

import { db } from './dbService';

const makeChain = (overrides: Partial<PromptChain> = {}): PromptChain => ({
  id: 'c1',
  name: '测试串',
  description: '',
  userId: 'local-owner',
  basePrompt: '',
  negativePrompt: '',
  modules: [],
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 4, characters: [] },
  variableValues: { subject: '' },
  type: 'style',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('dbService 会话级 blob: 封面防护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('读取链列表时将 blob: 封面视为无封面', async () => {
    apiMock.get.mockResolvedValue([
      makeChain({ id: 'bad', previewImage: 'blob:http://localhost/dead-beef' }),
      makeChain({ id: 'good', previewImage: '/api/assets/covers/a.png' }),
    ]);
    const chains = await db.getAllChains();
    expect(chains.find(c => c.id === 'bad')?.previewImage).toBeUndefined();
    expect(chains.find(c => c.id === 'good')?.previewImage).toBe('/api/assets/covers/a.png');
  });

  it('更新链时丢弃 blob: 封面，避免把会话级 URL 写入数据库', async () => {
    apiMock.put.mockResolvedValue(undefined);
    await db.updateChain('c1', { previewImage: 'blob:http://localhost/dead-beef', name: '新名字' });
    expect(apiMock.put).toHaveBeenCalledWith('/chains/c1', { name: '新名字' });
  });

  it('更新链时保留正常的资产封面地址', async () => {
    apiMock.put.mockResolvedValue(undefined);
    await db.updateChain('c1', { previewImage: '/api/assets/covers/a.png' });
    expect(apiMock.put).toHaveBeenCalledWith('/chains/c1', { previewImage: '/api/assets/covers/a.png' });
  });

  it('Fork 复制时不携带源链的 blob: 封面', async () => {
    apiMock.post.mockResolvedValue({ id: 'new-id' });
    const source = makeChain({ previewImage: 'blob:http://localhost/dead-beef' });
    await db.createChain('副本', '', source, 'style');
    const payload = apiMock.post.mock.calls[0][1];
    expect(payload.previewImage).toBeUndefined();
  });
});
