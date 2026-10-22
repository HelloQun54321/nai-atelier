import { beforeEach, expect, it, vi } from 'vitest';
import { loadArtistSampleUrls } from '../../services/artistSampleUrls';

const mocks = vi.hoisted(() => ({ status: vi.fn(), catalog: vi.fn(), data: vi.fn() }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: mocks.status, getArtistSampleCatalog: mocks.catalog }));
vi.mock('../../services/artistSampleDrafts', () => ({ getArtistSampleData: mocks.data }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ packs: [{ id: 'v45', phase: 'ready' }, { id: 'v5', phase: 'ready' }] });
  mocks.catalog.mockImplementation(async pack => ({ pack, revision: pack, tags: pack === 'v45' ? ['packed_artist', 'own_artist'] : ['packed_artist', 'v5_only'] }));
  mocks.data.mockResolvedValue({ samples: [{ tag: 'own_artist', pack: 'v45', imageUrl: '/own45.png' }, { tag: 'own_artist', pack: 'v5', imageUrl: '/own5.png' }] });
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
  mocks.status.mockResolvedValue({ packs: [{ id: 'v45', phase: 'error' }, { id: 'v5', phase: 'ready' }] });
  expect([...await loadArtistSampleUrls('v45')]).toEqual([['own artist', '/own45.png']]);
  expect(mocks.catalog).not.toHaveBeenCalled();
});
