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

  it('旧标签读取、Fork 和信息保存共用过滤，不改写传入的自定义资料', async () => {
    const source = makeChain({ tags: ['aitag', 'NAI', '待实测', '夜景'], previewImage: '/api/assets/cover.png' });
    apiMock.get.mockResolvedValue([source]); apiMock.post.mockResolvedValue({ id: 'new' });
    expect((await db.getAllChains())[0].tags).toEqual(['待实测', '夜景']);
    await db.createChain('副本', '', source);
    expect(apiMock.post.mock.calls[0][1].tags).toEqual(['待实测', '夜景']);
    const updates = { tags: ['NAI', 'aitag', '新分类'] };
    await db.updateChain('c1', updates);
    expect(apiMock.put).toHaveBeenLastCalledWith('/chains/c1', { tags: ['新分类'] });
    expect(updates.tags).toEqual(['NAI', 'aitag', '新分类']);
    expect(source.tags).toEqual(['aitag', 'NAI', '待实测', '夜景']);
  });

  it('创建后直接使用服务端保存的条目与封面，不重新读列表', async () => {
    const saved = makeChain({ id: 'saved', previewImage: '/api/assets/covers/saved.png', tags: ['夜景'] });
    apiMock.post.mockResolvedValue({ id: saved.id, chain: saved });
    expect(await db.createChainWithData('测试串', '', makeChain())).toEqual(saved);
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('旧 Worker 只返回 ID 时只读取这个条目；失败向调用方传递', async () => {
    const saved = makeChain({ id: 'saved' });
    apiMock.post.mockResolvedValue({ id: saved.id }); apiMock.get.mockResolvedValue(saved);
    expect(await db.createChainWithData('测试串', '', makeChain())).toEqual(saved);
    expect(apiMock.get).toHaveBeenCalledWith('/chains/saved');
    apiMock.post.mockRejectedValueOnce(new Error('模拟创建失败'));
    await expect(db.createChainWithData('测试串', '', makeChain())).rejects.toThrow('模拟创建失败');
  });
});
