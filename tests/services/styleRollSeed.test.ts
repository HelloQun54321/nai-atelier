import { describe, expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { hasLockedPinnedArtists, countRollChainArtists, replacePinnedArtistOverrides, rollSeedFromChain, unlockPinnedArtists } from '../../services/styleRollSeed';
import { parseRollArtists } from '../../services/styleRoll';

const chain = (overrides: Partial<PromptChain> = {}): PromptChain => ({
  id: 'chain-1', userId: 'u', type: 'style', name: '合成画风', description: '', tags: [], modules: [],
  createdAt: 1, updatedAt: 1,
  basePrompt: 'masterpiece, 1.2::artist:alpha ::, 1girl, artist:beta, solo',
  negativePrompt: 'lowres, bad hands',
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42, qualityToggle: false, ucPreset: 4,
    characters: [{ id: 'r', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }] },
  variableValues: { subject: '' },
  ...overrides,
});

describe('从风格串创建 Roll 起点', () => {
  it('保留提示词、负面、参数、角色与固定 Seed，画师改为固定组并保留原权重', () => {
    const seed = rollSeedFromChain(chain());
    expect(seed.template.prompt).toBe('masterpiece, {style}, 1girl, solo');
    expect(seed.template.negativePrompt).toBe('lowres, bad hands');
    expect(seed.template.params.seed).toBe(42);
    expect(seed.template.params.characters).toEqual([{ id: 'r', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }]);
    expect(seed.template.params.characters).not.toBe(chain().params.characters);
    expect(seed.artists).toHaveLength(2);
    expect(seed.artists[0]).toMatchObject({ tag: 'alpha', weight: 1.2, locked: true });
    expect(seed.rules).toMatchObject({ minArtists: 2, maxArtists: 2 });
    expect(seed.drawPlan).toEqual({ mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] });
  });

  it('清理旧串里的分组括号和残留冒号，异常 Tag 不拖垮整条串', () => {
    const source = chain({ basePrompt: '{{[[artist:ask_(askzy])}}}}, ::artist:hero neisan, 1.25::gogalking ::, artist:bad:tag' });
    const known = new Set(['ask (askzy)', 'hero neisan', 'gogalking']);
    const seed = rollSeedFromChain(source, 0, known);
    expect(seed.artists.map(artist => artist.tag)).toEqual(['ask_(askzy)', 'hero neisan', 'gogalking']);
    expect(seed.skippedArtists).toBe(1);
  });
  it('artist: 前缀大小写不敏感，Artist: 与 ARTIST: 同样可识别', () => {
    const source = chain({ basePrompt: 'Artist:alpha, 1.2::ARTIST:beta ::, 1girl' });
    const seed = rollSeedFromChain(source);
    expect(seed.artists.map(artist => artist.tag)).toEqual(['alpha', 'beta']);
    expect(seed.artists[1].weight).toBe(1.2);
  });

  it('支持 Artists: 复数前缀和多位画师权重', () => {
    const source = chain({ basePrompt: '1.7::Artists:ushikani kassen::, 0.8::Artists:ame_(uten_cancel)::, 0.6::Artists:zhili_xingzou ::, year 2026, best quality' });
    const seed = rollSeedFromChain(source);
    expect(seed.artists.map(artist => artist.tag)).toEqual(['ushikani kassen', 'ame_(uten_cancel)', 'zhili_xingzou']);
    expect(seed.artists.map(artist => artist.weight)).toEqual([1.7, 0.8, 0.6]);
    expect(seed.template.prompt).toBe('{style}, year 2026, best quality');
  });

  it('括号前没有空格的裸画师名也能匹配词库', () => {
    const source = chain({ basePrompt: 'dino(dinoartforame), 1girl' });
    const known = new Set(['dino (dinoartforame)']);
    expect(countRollChainArtists(source, known)).toBe(1);
    expect(rollSeedFromChain(source, 0, known).artists[0].tag).toBe('dino(dinoartforame)');
  });

  it('支持 @handle 与 by 画师署名', () => {
    const source = chain({ basePrompt: '@orange_maru, by MeioN:0.9, 1girl' });
    const known = new Set(['orange maru', 'meion']);
    const seed = rollSeedFromChain(source, 0, known);
    expect(seed.artists.map(artist => artist.tag)).toEqual(['orange_maru', 'MeioN']);
    expect(seed.artists.map(artist => artist.weight)).toEqual([1, 0.9]);
    expect(seed.template.prompt).toBe('{style}, 1girl');
  });

  it('没有固定 Seed 时使用回退值，随机 Seed 不进入 Roll', () => {
    const source = chain();
    source.params.seed = -1;
    expect(rollSeedFromChain(source, 7).template.params.seed).toBe(7);
  });

  it('超出 32 位的旧 Seed 取低 32 位，避免整条串无法使用', () => {
    const source = chain();
    source.params.seed = 6386002392;
    expect(rollSeedFromChain(source).template.params.seed).toBe(6386002392 % 4294967296);
  });

  it('通过词库识别没有 artist: 前缀的裸画师 Tag，并归一化权重', () => {
    const source = chain({ basePrompt: 'masterpiece, 3.8::alpha_artist ::, 1girl, 1.36::beta_artist ::, solo' });
    const known = new Set(['alpha artist', 'beta artist']);
    expect(countRollChainArtists(source, known)).toBe(2);
    const seed = rollSeedFromChain(source, 0, known);
    expect(seed.artists).toEqual([
      expect.objectContaining({ tag: 'alpha_artist', weight: 3, locked: true }),
      expect.objectContaining({ tag: 'beta_artist', weight: 1.4, locked: true }),
    ]);
    expect(seed.normalizedWeights).toBe(true);
    expect(seed.template.prompt).toBe('masterpiece, {style}, 1girl, solo');
  });

  it('旧风格串没有记录模型时使用默认文生图模型，其余参数保持', () => {
    const source = chain();
    delete (source.params as { model?: string }).model;
    const seed = rollSeedFromChain(source);
    expect(seed.template.params.model).toBe('nai-diffusion-4-5-full');
    expect(seed.template.params.width).toBe(832);
    expect(seed.template.params.characters).toEqual(source.params.characters);
  });

  it('没有 artist Tag、超过 64 位或使用编辑模型时明确拒绝', () => {
    expect(() => rollSeedFromChain(chain({ basePrompt: '1girl, solo' }))).toThrow('没有可识别的画师 Tag');
    const many = Array.from({ length: 65 }, (_, index) => `artist:artist_${index}`).join(', ');
    expect(() => rollSeedFromChain(chain({ basePrompt: many }))).toThrow('最多 64 位画师');
    const editing = chain();
    editing.params.model = 'nai-diffusion-4-5-full-inpainting';
    expect(() => rollSeedFromChain(editing)).toThrow('不是文生图模型');
  });

  it('允许导入超过旧上限但不超过 64 位的画师组', () => {
    const many = Array.from({ length: 40 }, (_, index) => `artist:artist_${index}`).join(', ');
    expect(rollSeedFromChain(chain({ basePrompt: many }), 0).artists).toHaveLength(40);
  });

  it('替换画师继承被替换位置的权重与锁定状态，移除旧覆盖项', () => {
    const overrides = parseRollArtists('1.2::alpha ::, 0.8::beta ::, 1.5::gamma ::').map(artist => ({ ...artist, locked: true }));
    const next = replacePinnedArtistOverrides(overrides, ['alpha', 'beta', 'gamma'], ['alpha', 'delta', 'gamma']);
    expect(next.map(artist => artist.tag).sort()).toEqual(['alpha', 'delta', 'gamma']);
    expect(next.find(artist => artist.tag === 'delta')).toMatchObject({ weight: 0.8, locked: true, excluded: false });
    expect(next.find(artist => artist.tag === 'beta')).toBeUndefined();
    expect(hasLockedPinnedArtists(next, ['alpha', 'delta', 'gamma'])).toBe(true);
    const unlocked = unlockPinnedArtists(next, ['alpha', 'delta', 'gamma']);
    expect(unlocked.every(artist => !artist.locked)).toBe(true);
    expect(hasLockedPinnedArtists(unlocked, ['alpha', 'delta', 'gamma'])).toBe(false);
  });
});
