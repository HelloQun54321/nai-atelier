import { beforeEach, expect, it, vi } from 'vitest';
import { loadArtistSampleUrls } from '../../services/artistSampleUrls';

it.each([undefined, 'nai-diffusion-5-curated'])('旧V5来源model=%s不能冒充Full目录，正确Full元数据才能取图', async model => {
  mocks.data.mockResolvedValue({ samples: [] });
  mocks.status.mockResolvedValue({ packs: [{ id: 'v5', phase: 'ready', model }] });
  expect((await loadArtistSampleUrls('v5')).size).toBe(0);
  mocks.status.mockResolvedValue({ packs: [{ id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] });
  mocks.catalog.mockResolvedValue({ pack: 'v5', revision: 'revision', tags: ['sample'], model });
  expect((await loadArtistSampleUrls('v5')).size).toBe(0);
  mocks.catalog.mockResolvedValue({ pack: 'v5', revision: 'revision', tags: ['sample'], model: 'nai-diffusion-5-full' });
  expect((await loadArtistSampleUrls('v5')).get('sample')).toContain('pack=v5');
});

it('删除元数据读取失败时明确拒绝，不能按空删除记录返回原图包', async () => {
  mocks.data.mockRejectedValue(new Error('private metadata unavailable'));
  await expect(loadArtistSampleUrls('v45')).rejects.toThrow('private metadata unavailable');
  expect(mocks.catalog).not.toHaveBeenCalled();
});

it('旧缓存自建样张被删除标记过滤，图包首图删除改用下张，全删后不回退复活', async () => {
  mocks.data.mockResolvedValue({ templates: {}, samples: [{ id: 'old', tag: 'own_artist', pack: 'v45', imageUrl: '/old.png' }], removedSamples: [
    { source: 'own', pack: 'v45', tag: 'own_artist', id: 'old' },
    { source: 'pack', pack: 'v45', revision: 'v45', tag: 'own_artist', index: 0, imageCount: 1 },
    { source: 'pack', pack: 'v45', revision: 'v45', tag: 'packed_artist', index: 0, imageCount: 2 },
  ] });
  const urls = await loadArtistSampleUrls('v45');
  expect(urls.has('own artist')).toBe(false);
  expect(urls.get('packed artist')).toContain('index=1');
});

const mocks = vi.hoisted(() => ({ status: vi.fn(), catalog: vi.fn(), data: vi.fn() }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog }));
vi.mock('../../services/artistSampleDrafts', () => ({ getArtistSampleData: mocks.data }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ packs: [{ id: 'v45', phase: 'ready' }, { id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] });
  mocks.catalog.mockImplementation(async pack => ({ pack, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: pack, tags: pack === 'v45' ? ['packed_artist', 'own_artist'] : ['packed_artist', 'v5_only'] }));
  mocks.data.mockResolvedValue({ samples: [{ tag: 'own_artist', pack: 'v45', imageUrl: '/own45.png', params: { model: 'nai-diffusion-4-5-full' } }, { tag: 'own_artist', pack: 'v5', imageUrl: '/own5.png', params: { model: 'nai-diffusion-5-full' } }] });
});

it('V5Full预览隐藏旧Curated自建样张而保留FullMedium，旧对象原样保留', async () => {
  const samples = [
    { tag: 'old', pack: 'v5', imageUrl: '/curated.png', params: { model: 'nai-diffusion-5-curated' } },
    { tag: 'medium', pack: 'v5', imageUrl: '/medium.png', params: { model: 'nai-diffusion-5-full-medium' } },
  ];
  const original = structuredClone(samples); mocks.data.mockResolvedValue({ samples });
  const urls = await loadArtistSampleUrls('v5');
  expect(urls.has('old')).toBe(false); expect(urls.get('medium')).toBe('/medium.png'); expect(samples).toEqual(original);
});

it.each(['v45', 'v5'] as const)('指定 %s 时自建与图包均取对应版本，不借用另一版', async pack => {
  const urls = await loadArtistSampleUrls(pack);
  expect(urls.get('own artist')).toBe(pack === 'v45' ? '/own45.png' : '/own5.png');
  expect(urls.get('packed artist')).toContain(`pack=${pack}`);
  expect(urls.has('v5 only')).toBe(pack === 'v5');
  expect(mocks.catalog).toHaveBeenCalledExactlyOnceWith(pack);
});

it('未指定版本仍保留原有自动样张回退，Roll 详情缩略图不丢失', async () => {
  const urls = await loadArtistSampleUrls();
  expect(urls.get('own artist')).toBe('/own5.png'); expect(urls.get('packed artist')).toContain('pack=v45');
  expect(urls.get('v5 only')).toContain('pack=v5');
});

it('目标包未就绪时只保留该版自建样张，不读取失效图包', async () => {
  mocks.status.mockResolvedValue({ packs: [{ id: 'v45', phase: 'error' }, { id: 'v5', phase: 'ready', model: 'nai-diffusion-5-full' }] });
  expect([...await loadArtistSampleUrls('v45')]).toEqual([['own artist', '/own45.png']]);
  expect(mocks.catalog).not.toHaveBeenCalled();
});
