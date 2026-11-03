// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({ library: vi.fn(), urls: vi.fn(), add: vi.fn() }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleLibrary: mocks.library }));
vi.mock('../../services/artistSampleUrls', () => ({ loadArtistSampleUrls: mocks.urls }));
vi.mock('../../services/collectionFavorites', () => ({ addArtistPreferences: mocks.add }));

const chainOf = (basePrompt: string): PromptChain => ({
  id: 'synthetic-style', userId: 'synthetic-user', type: 'style', name: '合成风格串',
  description: '', tags: [], createdAt: 1, updatedAt: 1, basePrompt, negativePrompt: 'artist:negative_only', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' },
});

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.library.mockResolvedValue([{ name: 'Known_Artist' }, { name: 'second artist' }]);
  mocks.urls.mockResolvedValue(new Map([['known artist', '/api/assets/known.png']]));
  mocks.add.mockImplementation(async (tags: string[]) => ({ tags, added: tags, existing: [], failed: [] }));
});

it('Roll 候选直接使用自带画师名单，不读取画师目录', async () => {
  const { extractArtistTags } = await import('../../services/artistFavoriteExtraction');
  expect(await extractArtistTags({ kind: 'tags', tags: ['alpha', 'beta'] })).toEqual(['alpha', 'beta']);
  expect(mocks.library).not.toHaveBeenCalled();
});

it('成图正向与角色栏识别已知裸名并换回画师库原名，样张封面按同一画师查找', async () => {
  const { favoriteArtistsFrom } = await import('../../services/artistFavoriteExtraction');
  await favoriteArtistsFrom({ kind: 'prompt', prompt: 'known artist, artist:explicit_one, plain words', params: { characters: [{ id: 'role', prompt: 'second_artist, smile', x: 0.5, y: 0.5 }] } });
  expect(mocks.add).toHaveBeenCalledOnce();
  const [tags, loadCovers] = mocks.add.mock.calls[0];
  expect(tags).toEqual(['Known_Artist', 'explicit one', 'second artist']);
  const coverOf = await loadCovers();
  expect(coverOf('Known_Artist')).toBe('/api/assets/known.png');
  expect(coverOf('explicit one')).toBeUndefined();
});

it('风格串按编译后的正向与启用模块识别，负面提示词里的画师不计入', async () => {
  const { extractArtistTags } = await import('../../services/artistFavoriteExtraction');
  const chain = chainOf('artist:base, Known_Artist');
  chain.modules = [{ id: 'on', name: '启用', content: 'artist:module', isActive: true }];
  expect(await extractArtistTags({ kind: 'chain', chain })).toEqual(['base', 'Known_Artist', 'module']);
});

it('认不出画师时不写收藏，也不读取样张', async () => {
  const { favoriteArtistsFrom } = await import('../../services/artistFavoriteExtraction');
  expect(await favoriteArtistsFrom({ kind: 'prompt', prompt: 'solo, smile' })).toEqual({ tags: [], added: [], existing: [], failed: [] });
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.urls).not.toHaveBeenCalled();
});

it('画师目录读取失败时只认显式写法并在下次点按重试，成功后复用，图包变化再重读', async () => {
  const { extractArtistTags } = await import('../../services/artistFavoriteExtraction');
  const { ARTIST_SAMPLES_CHANGED } = await import('../../services/artistSamples');
  const source = { kind: 'prompt' as const, prompt: 'known artist, artist:explicit' };
  mocks.library.mockRejectedValueOnce(new Error('词库未下载'));
  expect(await extractArtistTags(source)).toEqual(['explicit']);
  expect(await extractArtistTags(source)).toEqual(['Known_Artist', 'explicit']);
  await extractArtistTags(source);
  expect(mocks.library).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event(ARTIST_SAMPLES_CHANGED));
  await extractArtistTags(source);
  expect(mocks.library).toHaveBeenCalledTimes(3);
});
