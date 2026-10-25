// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../services/api', () => ({ api: apiMock }));

import { db } from '../../services/dbService';

afterEach(() => vi.unstubAllGlobals());

it('组合分类目录严格回读与保存，不吞掉损坏响应或请求失败', async () => {
  apiMock.get.mockResolvedValue({ tags: [' 空分类 ', '空分类', '夜景'] });
  expect(await db.getPromptLibraryTagNames()).toEqual(['空分类', '夜景']);
  expect(apiMock.get).toHaveBeenLastCalledWith('/prompt-library-tags');
  apiMock.put.mockResolvedValue({ tags: ['夜景'] });
  expect(await db.savePromptLibraryTagNames([' 夜景 ', '夜景'])).toEqual(['夜景']);
  expect(apiMock.put).toHaveBeenLastCalledWith('/prompt-library-tags', { tags: ['夜景'] });
  for (const tags of [undefined, [9], ['__internal__'], ['AITag'], ['bad,name'], ['bad\nname']]) {
    apiMock.get.mockResolvedValue({ tags });
    await expect(db.getPromptLibraryTagNames()).rejects.toThrow('组合分类目录无效');
  }
  apiMock.put.mockResolvedValue({ tags: null });
  await expect(db.savePromptLibraryTagNames(['夜景'])).rejects.toThrow('组合分类目录无效');
  apiMock.get.mockRejectedValue(new Error('合成读取失败'));
  await expect(db.getPromptLibraryTagNames()).rejects.toThrow('合成读取失败');
  apiMock.put.mockRejectedValue(new Error('合成保存失败'));
  await expect(db.savePromptLibraryTagNames(['夜景'])).rejects.toThrow('合成保存失败');
});

it('收藏独立标签使用同一持久接口，规范化候选，不接受无效响应或吞掉保存失败', async () => {
  apiMock.get.mockResolvedValue({ tags: [' #构图 ', '构图', '光影'] });
  expect(await db.getCollectionTagNames()).toEqual(['构图', '光影']);
  expect(apiMock.get).toHaveBeenLastCalledWith('/collection-tags');
  apiMock.put.mockResolvedValue({ tags: ['构图'] });
  expect(await db.saveCollectionTagNames([' #构图 ', '构图'])).toEqual(['构图']);
  expect(apiMock.put).toHaveBeenLastCalledWith('/collection-tags', { tags: ['构图'] });
  apiMock.get.mockResolvedValue({}); await expect(db.getCollectionTagNames()).rejects.toThrow('标签目录响应无效');
  apiMock.put.mockResolvedValue({ tags: [9] }); await expect(db.saveCollectionTagNames(['夜景'])).rejects.toThrow('标签目录响应无效');
  apiMock.put.mockRejectedValue(new Error('合成保存失败')); await expect(db.saveCollectionTagNames(['夜景'])).rejects.toThrow('合成保存失败');
});

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

it('新提示词库条目不夹带默认人物词，创建回执直接返回完整数据', async () => {
  const chain = makeChain({ type: 'wardrobe' });
  apiMock.post.mockResolvedValue({ id: chain.id, chain });
  expect(await db.createChainWithData('synthetic', '', undefined, 'wardrobe')).toEqual(chain);
  expect(apiMock.post).toHaveBeenLastCalledWith('/chains', expect.objectContaining({ type: 'wardrobe', variableValues: { subject: '' } }));
});

describe('AITag 风格串保存复用详情原图', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['/api/assets/aitag-covers/123.webp', '/api/assets/aitag-covers/123.webp'],
    ['/api/assets/aitag-images/123/123_p3.webp', '/api/assets/aitag-images/123/123_p3.webp'],
    ['https://ai-img.10118899.xyz/NAI/42/123_p3.webp', '/api/media?source=https%3A%2F%2Fai-img.10118899.xyz%2FNAI%2F42%2F123_p3.webp&variant=original'],
  ])('从显示时的地址 %s 优先读浏览器缓存，提交原始字节而非再次让后端下载', async (previewImage, displayedUrl) => {
    const image = new Blob([new Uint8Array([7, 8, 9])], { type: 'image/webp' });
    const fetchImage = vi.fn(async () => ({ ok: true, blob: async () => image }));
    vi.stubGlobal('fetch', fetchImage);
    const source = makeChain({ previewImage, basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative' });
    const saved = makeChain({ ...source, id: 'saved', previewImage: '/api/assets/covers/saved.webp' });
    apiMock.post.mockResolvedValue({ id: saved.id, chain: saved });
    expect(await db.createChainWithData(source.name, '', source)).toEqual(saved);
    expect(fetchImage).toHaveBeenCalledExactlyOnceWith(displayedUrl, {
      cache: 'force-cache', credentials: 'same-origin', signal: expect.any(AbortSignal),
    });
    expect(apiMock.post).toHaveBeenCalledExactlyOnceWith('/chains', expect.objectContaining({
      previewImage: 'data:image/webp;base64,BwgJ', basePrompt: source.basePrompt, negativePrompt: source.negativePrompt, params: source.params,
    }));
    expect(source.previewImage).toBe(previewImage);
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('同类 Fork 入口等待原图就绪才创建，保留原始内容且只写一次', async () => {
    let finish!: (image: Blob) => void;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => new Promise<Blob>(resolve => { finish = resolve; }) })));
    apiMock.post.mockResolvedValue({ id: 'saved' });
    const saving = db.createChain('synthetic', '', makeChain({ previewImage: '/api/assets/aitag-covers/123.webp' }));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(apiMock.post).not.toHaveBeenCalled();
    finish(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/webp' }));
    expect(await saving).toBe('saved');
    expect(apiMock.post).toHaveBeenCalledExactlyOnceWith('/chains', expect.objectContaining({ previewImage: 'data:image/webp;base64,BwgJ' }));
  });

  it.each(['HTTP', 'HTML', 'network'])('原图读取失败 %s 时不创建空封面条目、不自动重试，错误标明阶段', async failure => {
    const fetchImage = vi.fn(async () => {
      if (failure === 'network') throw new Error('Failed to fetch');
      return { ok: failure !== 'HTTP', status: 403, blob: async () => new Blob(['not image'], { type: 'text/html' }) };
    });
    vi.stubGlobal('fetch', fetchImage);
    await expect(db.createChainWithData('synthetic', '', makeChain({ previewImage: '/api/assets/aitag-covers/123.webp' })))
      .rejects.toThrow('读取 AITag 封面失败：');
    expect(fetchImage).toHaveBeenCalledOnce(); expect(apiMock.post).not.toHaveBeenCalled();
  });

  it.each(['/api/assets/covers/existing.webp', 'https://example.com/image.webp', undefined])('其他来源 %s 保留既有保存流程', async previewImage => {
    const fetchImage = vi.fn(); vi.stubGlobal('fetch', fetchImage);
    apiMock.post.mockResolvedValue({ id: 'saved' });
    expect(await db.createChain('synthetic', '', makeChain({ previewImage }))).toBe('saved');
    expect(apiMock.post).toHaveBeenCalledWith('/chains', expect.objectContaining({ previewImage }));
    expect(fetchImage).not.toHaveBeenCalled();
  });
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
