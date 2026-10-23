import { expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { artistUsageCount, compareArtistUsage, getArtistUsage, isArtistUsageSort, matchesArtistUsage, type ArtistUsageIndex } from '../../services/artistUsage';

vi.mock('../../services/api', () => ({ api: { get: vi.fn() } }));

it('读取已完成索引并用画师 Tag 归一化建立查表', async () => {
  vi.mocked(api.get).mockResolvedValue({ complete: true, indexed: 12, total: 12, artists: [
    { name: 'Artist_Name', chains: 3, images: 7, lastAt: 100 },
  ] });
  const controller = new AbortController();
  const result = await getArtistUsage(controller.signal);
  expect(api.get).toHaveBeenCalledWith('/artist-usage', { cache: 'no-store', signal: controller.signal });
  expect(result).toEqual({ byTag: new Map([['artist name', { chains: 3, images: 7, lastAt: 100 }]]), indexed: 12, total: 12 });
});

it('拒绝未完成或重复归一化 Tag 的索引，避免把未知计成零', async () => {
  vi.mocked(api.get).mockResolvedValue({ complete: false, indexed: 1, total: 2, artists: [] });
  await expect(getArtistUsage()).rejects.toThrow('画师使用统计数据无效');
  vi.mocked(api.get).mockResolvedValue({ complete: true, indexed: 2, total: 2, artists: [
    { name: 'artist_name', chains: 1, images: 1, lastAt: 1 },
    { name: 'Artist Name', chains: 2, images: 2, lastAt: 2 },
  ] });
  await expect(getArtistUsage()).rejects.toThrow('画师使用统计数据无效');
});

const usage: ArtistUsageIndex = { byTag: new Map([
  ['artist alpha', { chains: 2, images: 7, lastAt: 1 }],
  ['beta', { chains: 5, images: 0, lastAt: 1 }],
]), indexed: 7, total: 7 };
const artists = [
  { name: 'Artist_Alpha', chinese: '', postCount: 20 },
  { name: 'beta', chinese: '', postCount: 10 },
  { name: 'gamma', chinese: '', postCount: 30 },
  { name: 'delta', chinese: '', postCount: 40 },
];

it.each([
  ['usage-chains', ['beta', 'Artist_Alpha', 'delta', 'gamma']],
  ['usage-chains-asc', ['delta', 'gamma', 'Artist_Alpha', 'beta']],
  ['usage-images', ['Artist_Alpha', 'delta', 'gamma', 'beta']],
  ['usage-images-asc', ['delta', 'gamma', 'beta', 'Artist_Alpha']],
  ['name-asc', ['Artist_Alpha', 'beta', 'delta', 'gamma']],
] as const)('两处列表共用 %s，零值按热度再名称稳定排序', (sort, expected) => {
  expect([...artists].sort((left, right) => compareArtistUsage(left, right, sort, usage)).map(artist => artist.name)).toEqual(expected);
  expect(artists.map(artist => artist.name)).toEqual(['Artist_Alpha', 'beta', 'gamma', 'delta']);
});

it('收录与生成筛选取交集，已完成统计中未出现的 Tag 才视为零', () => {
  const filtered = (chains: 'all' | 'used' | 'unused', images: 'all' | 'used' | 'unused') => artists.filter(artist => matchesArtistUsage(artist.name, usage, chains, images)).map(artist => artist.name);
  expect(filtered('used', 'unused')).toEqual(['beta']);
  expect(filtered('used', 'used')).toEqual(['Artist_Alpha']);
  expect(filtered('unused', 'unused')).toEqual(['gamma', 'delta']);
  expect(filtered('all', 'used')).toEqual(['Artist_Alpha']);
  expect(filtered('all', 'all')).toHaveLength(4);
  expect(artistUsageCount('ARTIST ALPHA', usage, 'chains')).toBe(2);
  expect(isArtistUsageSort('usage-chains-asc')).toBe(true);
  expect(isArtistUsageSort('usage-images-asc')).toBe(true);
  expect(isArtistUsageSort('usage-images-invalid')).toBe(false);
  expect(isArtistUsageSort('popular')).toBe(false);
});
