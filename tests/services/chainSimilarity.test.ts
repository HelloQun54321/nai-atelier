import { describe, expect, it } from 'vitest';
import type { PromptChain } from '../../types';
import { compareChainStyles, describeChainStyle, findSimilarChains, getChainComparisonDetails, getChainGroupSimilarity, getChainPromptTokenWeight, parseChainPromptTokens } from '../../services/chainSimilarity';

const chain = (id: string, basePrompt: string, overrides: Partial<PromptChain> = {}): PromptChain => ({
  id, name: id, userId: 'synthetic', type: 'style', description: '', tags: [], basePrompt,
  negativePrompt: '', modules: [], params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' },
  createdAt: 1, updatedAt: 1, ...overrides,
});
const artists = new Set(['alpha artist', 'beta artist']);
const scan = (chains: PromptChain[], knownArtists = artists) => findSimilarChains(chains, knownArtists, new AbortController().signal);
const profile = (prompt: string) => describeChainStyle(chain(prompt, prompt), artists);

describe('本地风格串相似识别', () => {
  it('跨人物／场景、主体与生效模块召回同画风，排除角色库和停用模块且不改原串', async () => {
    const input = [
      chain('a', '1.2::artist:alpha_artist::, watercolor, 1girl, red dress, forest'),
      chain('b', '1boy, suit, city', { variableValues: { subject: 'watercolor' }, modules: [
        { id: 'on', name: '', content: '1.2::ALPHA_ARTIST::', isActive: true, position: 'pre' },
        { id: 'off', name: '', content: 'artist:other', isActive: false },
      ] }),
      chain('role', 'artist:alpha_artist', { type: 'character' }),
      chain('different', 'artist:other, watercolor, 1girl, red dress, forest'),
    ];
    const original = structuredClone(input), result = await scan(input);
    expect(result.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['a', 'b']]);
    expect(result.total).toBe(3); expect(result.matched).toBe(2);
    expect(result.groups[0].members[1].other.join(', ')).toBe('1boy, suit, city');
    expect(input).toEqual(original);
  });

  it('保留有符号小数、嵌套权重、混合组及重复词，权重变化明确列为变体', () => {
    const left = profile('-1.25::{artist:alpha_artist, 1girl}::, {{artist:beta_artist}}, artist:beta_artist');
    const right = profile('-1.20::{artist:alpha_artist, 1boy}::, {artist:beta_artist}, artist:beta_artist');
    expect(left.features.map(feature => JSON.parse(feature.weight))).toEqual([['-1.25::', '{'], ['{', '{'], []]);
    expect(left.other).toEqual(['-1.25::{1girl}::']);
    const comparison = compareChainStyles(left, right);
    expect(comparison.sameStyle).toBe(false); expect(comparison.sharedArtists).toBe(1);
    expect(comparison.common).toEqual(['artist:beta_artist']);
    expect(comparison.leftOnly).toEqual(['-1.25::{artist:alpha_artist}::', '{{artist:beta_artist}}']);
    expect(comparison.rightOnly).toEqual(['-1.20::{artist:alpha_artist}::', '{artist:beta_artist}']);
    expect(compareChainStyles(profile('artist:alpha_artist, artist:alpha_artist'), profile('artist:alpha_artist')).leftOnly).toEqual(['artist:alpha_artist']);
  });

  it('只统一名称写法与无关顺序，识别裸画师、by 与 @，不吞掉括号内名字', () => {
    const left = profile('artist:alpha_artist, artist:beta_artist');
    const right = profile('@beta_artist, by ALPHA_ARTIST');
    expect(compareChainStyles(left, right).sameStyle).toBe(true);
    expect(profile('by alpha_artist:0.9').features[0].weight).toBe('["0.9::"]');
    expect(describeChainStyle(chain('x', 'dino(dinoartforame)'), new Set(['dino (dinoartforame)'])).features[0].key).toBe('artist:dino (dinoartforame)');
  });

  it('拆开换行、结构标记、管线与紧邻权重组，不把后续画风词吞进画师名', () => {
    const input = chain('a', 'alpha_artist\n<style>\nflat color\n</style>0.5::artist:beta_artist::0.8::artist:alpha_artist::\r\nartist:beta_artist | no lineart');
    const original = structuredClone(input), parsed = describeChainStyle(input, artists);
    expect(parsed.features.map(feature => [feature.key, JSON.parse(feature.weight)])).toEqual([
      ['artist:alpha artist', []], ['style:flat color', []], ['artist:beta artist', ['0.5::']],
      ['artist:alpha artist', ['0.8::']], ['artist:beta artist', []], ['style:no lineart', []],
    ]);
    expect(parsed.other).toEqual([]); expect(input).toEqual(original);
  });

  it('规范画师前缀内括号和特殊权重，保留画师消歧括号与真实权重路径', () => {
    const parsed = profile('{2::(artist:alpha_artist)::, artist:{beta_artist}, (artist:alpha_artist:0.9), @beta_artist:-.5');
    expect(parsed.features.map(feature => [feature.key, JSON.parse(feature.weight)])).toEqual([
      ['artist:alpha artist', ['{', '2::']], ['artist:beta artist', ['{']],
      ['artist:alpha artist', ['0.9::']], ['artist:beta artist', ['-0.5::']],
    ]);
    expect(parsed.features[3].raw).toBe('@beta_artist:-.5');
    expect(profile('artist:unknown (sample)').features[0].key).toBe('artist:unknown (sample)');
    expect(compareChainStyles(profile('2::(artist:alpha_artist)::'), profile('2::artist:alpha_artist::'))).toMatchObject({ sameStyle: false, uncertainWeights: true });
  });

  it('独立 :: 是合法重置，数值权重无需尾部闭合且不改原文', () => {
    const input = chain('reset', 'artist:beta_artist, ::artist:alpha_artist::, 0.5::artist:unfinished');
    const original = structuredClone(input), parsed = describeChainStyle(input, artists);
    expect(parsed.uncertainWeights).toBe(false);
    expect(parsed.features.map(feature => JSON.parse(feature.weight))).toEqual([[], [], ['0.5::']]);
    expect([...parsed.keys]).toEqual(['artist:beta artist', 'artist:alpha artist', 'artist:unfinished']);
    expect(compareChainStyles(parsed, parsed)).toMatchObject({ sameStyle: true, uncertainWeights: false });
    expect(profile('::artist:alpha_artist::').reliable).toBe(true);
    expect(input).toEqual(original);
  });

  it('括号由 :: 合法重置，未知正文仍保留且不修写原串', () => {
    const input = chain('a', '3::{{{unknown subject}}::\n2::artist:alpha_artist, artist:beta_artist::');
    const original = structuredClone(input), parsed = describeChainStyle(input, artists);
    expect(parsed.features.map(feature => [feature.key, JSON.parse(feature.weight)])).toEqual([
      ['artist:alpha artist', ['2::']], ['artist:beta artist', ['2::']],
    ]);
    expect(parsed.other).toEqual(['3::{{{unknown subject}}}::']); expect(input).toEqual(original);
  });

  it('官方 :: 重置与括号逐符号倍率不会漏掉画师，紧邻组分别识别', () => {
    const reset = profile('{{artist:alpha_artist::, artist:beta_artist');
    const balanced = profile('{{artist:alpha_artist}}, artist:beta_artist');
    expect(reset.features.map(feature => [feature.key, feature.weight])).toEqual(balanced.features.map(feature => [feature.key, feature.weight]));
    expect(profile('1.2::artist:alpha_artist').features[0].weight).toBe('["1.2::"]');
    expect(profile('1.2::artist:alpha_artist').signature).toBe(profile('1.2::artist:alpha_artist::').signature);
    expect(profile('{artist:alpha_artist}{artist:beta_artist}').features.map(feature => feature.weight)).toEqual(['["{"]', '["{"]']);
    expect(profile(']artist:alpha_artist[, artist:beta_artist').features.map(feature => feature.weight)).toEqual(['["]"]', '[]']);
    expect(profile('artist:alpha_artist, }artist:beta_artist').features[1].weight).toBe('["}"]');
    expect(profile('unknown (unfinished, artist:beta_artist').features[0].key).toBe('artist:beta artist');
  });

  it('共用正词分词保留重复次数、原始数值写法和未包权重的词项', () => {
    const tokens = parseChainPromptTokens('-1.20::{artist:alpha_artist, 1girl}::, 1girl, year 2024');
    expect(tokens.map(token => [token.text, token.raw, token.weight])).toEqual([
      ['artist:alpha_artist', '-1.20::{artist:alpha_artist}::', '["-1.2::","{"]'],
      ['1girl', '-1.20::{1girl}::', '["-1.2::","{"]'],
      ['1girl', '1girl', '[]'], ['year 2024', 'year 2024', '[]'],
    ]);
    expect(parseChainPromptTokens('@alpha_artist:-.5')[0]).toMatchObject({ text: '@alpha_artist', raw: '@alpha_artist:-.5', uncertainWeight: true });
    expect(getChainPromptTokenWeight(parseChainPromptTokens('@alpha_artist:-.5')[0])).toBeNull();
    expect(getChainPromptTokenWeight(parseChainPromptTokens('{{artist:a}}')[0])).toBe(1.1025);
    expect(profile(`${'9'.repeat(400)}::artist:alpha_artist`).reliable).toBe(false);
    expect(profile(`${'9'.repeat(400)}::artist:alpha_artist`).uncertainWeights).toBe(true);
  });

  it('官方流派参与召回，年份和复杂度参与最终差异但不独立召回', async () => {
    const result = await scan([
      chain('a', 'ukiyo-e, art nouveau, year 2024, high complexity'),
      chain('b', 'art nouveau, ukiyo-e, year 1990, low complexity'),
      chain('generic-a', 'year 2024, high complexity, masterpiece'),
      chain('generic-b', 'year 2024, high complexity, best quality'),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.insufficient.map(item => item.chain.id)).toEqual(['generic-a', 'generic-b']);
    expect(compareChainStyles(profile('ukiyo-e, art nouveau, year 2024, high complexity'), profile('art nouveau, ukiyo-e, year 1990, low complexity')).leftOnly).toEqual(['year 2024', 'high complexity']);
    expect(profile('artist:alpha_artist, year future').other).toContain('year future');
  });

  it('明确的线条、上色和具名画风参与差异，不再标为画风一致', () => {
    const base = profile('artist:alpha_artist, cel shading');
    const variant = profile('artist:alpha_artist, cel shading, 2::no lineart::, anime coloring, sample series (style), sample studio(style)');
    const comparison = compareChainStyles(base, variant);
    expect(comparison.sameStyle).toBe(false);
    expect(comparison.rightOnly).toEqual(['2::no lineart::', 'anime coloring', 'sample series (style)', 'sample studio(style)']);
    expect(variant.other).toEqual([]);
  });

  it('无画师串不靠通用词或负权重排除词匹配，具体画风集合需高度一致', async () => {
    const result = await scan([
      chain('generic-a', 'anime, -2::realistic, 3d, cgi::'), chain('generic-b', 'anime, -3::realistic, 3d, cgi::'),
      chain('negative-a', '-2::artist:alpha_artist::, watercolor'), chain('negative-b', '-2::artist:alpha_artist::, watercolor'),
      chain('specific-a', 'watercolor, thin lines, cel shading'), chain('specific-b', 'watercolor, thin lines, cel shading, no lineart'),
      chain('specific-c', 'watercolor, thin lines, cel shading, sample studio (style)'),
    ]);
    expect(result.groups).toEqual([]); expect(result.insufficient).toHaveLength(4);
    const identical = await scan([chain('a', 'watercolor, thin lines, anime'), chain('b', 'watercolor, thin lines, digital art')]);
    expect(identical.groups).toEqual([]);
    expect(compareChainStyles(profile('watercolor, thin lines, anime'), profile('watercolor, thin lines, digital art')).sameStyle).toBe(false);
  });

  it('通用质量词、相同人物或单个媒介词不构成判重依据，未知词保留', async () => {
    const result = await scan([
      chain('a', 'masterpiece, best quality, 1girl, unknown style, simple background'),
      chain('b', 'masterpiece, best quality, 1girl, unknown style, simple background'),
      chain('c', 'watercolor, 1girl'),
    ]);
    expect(result.groups).toEqual([]); expect(result.insufficient).toHaveLength(3);
    expect(result.insufficient[0].other).toContain('unknown style');
    expect(result.insufficient[0].other).toContain('simple background');
  });

  it('无画师的串可按多个媒介／渲染词比较，不与有不同画师的串混组', async () => {
    const result = await scan([
      chain('a', 'watercolor, thin lines, 1girl'), chain('b', 'thin_lines, watercolor, city'),
      chain('c', 'artist:other, watercolor, thin lines'),
    ]);
    expect(result.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['a', 'b']]);
  });

  it('同画师的主次互换不再仅凭词名集合归组，轻微调权仍保留', async () => {
    const result = await scan([
      chain('base', '2::artist:a::, 0.5::artist:b::'),
      chain('swapped', '0.5::artist:a::, 2::artist:b::'),
      chain('near', '1.9::artist:a::, 0.55::artist:b::'),
    ]);
    expect(result.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['base', 'near']]);
    expect(compareChainStyles(describeChainStyle(result.groups[0].members[0].chain, artists), describeChainStyle(result.groups[0].members[1].chain, artists)).sameStyle).toBe(false);
  });

  it('花方括号和明确的等效数字按有效权重比较，展示保留原写法', async () => {
    const pairs = [['{{artist:a}}', '1.1025::artist:a::'], ['[artist:a]', `${1 / 1.05}::artist:a::`],
      ['artist:a', '1.00::artist:a::'], [']artist:a[', '1.05::artist:a::']];
    for (const [leftText, rightText] of pairs) {
      const left = profile(leftText), right = profile(rightText);
      expect(left.features[0].raw).not.toBe(right.features[0].raw);
      expect(compareChainStyles(left, right)).toMatchObject({ sameStyle: true, leftOnly: [], rightOnly: [] });
      expect((await scan([chain('left', leftText), chain('right', rightText)])).matched).toBe(2);
    }
  });

  it('官方前端数值起始覆盖当前倍率，后续括号仍逐符号生效', () => {
    const before = profile('{2::artist:a::'), after = profile('2::{artist:a}::');
    expect(before.features[0].effectiveWeight).toBe(2);
    expect(after.features[0].effectiveWeight).toBe(2.1);
    expect(before.features[0]).toMatchObject({ weight: '["{","2::"]', raw: '{2::artist:a::}' });
    expect(after.features[0]).toMatchObject({ weight: '["2::","{"]', raw: '2::{artist:a}::' });
    expect(compareChainStyles(before, profile('2::artist:a::')).sameStyle).toBe(true);
    expect(compareChainStyles(after, profile('2.1::artist:a::')).sameStyle).toBe(true);
    expect(profile('2::artist:a,3::artist:b::').features.map(feature => feature.effectiveWeight)).toEqual([2, 3]);
    expect(before.prompt).toBe('{2::artist:a::');
    expect(after.prompt).toBe('2::{artist:a}::');
  });

  it('负权重方向和强排除参与评分，不与正词抵消', async () => {
    const result = await scan([
      chain('base', 'artist:a'),
      chain('excluded', 'artist:a, -10::artist:b::'),
      chain('positive', 'artist:a, 10::artist:b::'),
    ]);
    expect(result.groups).toEqual([]);
    const negativeNear = await scan([chain('a', 'artist:a, -2::artist:b::'), chain('b', 'artist:a, -2.1::artist:b::')]);
    expect(negativeNear.matched).toBe(2);
  });

  it('具体画风负责召回时，负向画师差异仍参与最终全特征评分', async () => {
    const result = await scan([
      chain('a', 'watercolor, sketch, -10::artist:a::'),
      chain('b', 'watercolor, sketch, -10::artist:b::'),
      chain('near', 'watercolor, sketch, -10.1::artist:a::'),
    ]);
    expect(result.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['a', 'near']]);
    expect([...result.groups[0].members[0].keys]).toEqual(['style:watercolor', 'style:sketch']);
  });

  it('重复画师按出现项配对，既不去重也不当作线性总权重', async () => {
    const result = await scan([
      chain('once', 'artist:a'), chain('twice', 'artist:a, artist:a'), chain('double', '2::artist:a::'),
    ]);
    expect(result.groups).toEqual([]);
    const same = await scan([chain('a', 'artist:a, 0.5::artist:a::'), chain('b', '0.5::artist:a::, artist:a')]);
    expect(same.matched).toBe(2);
    expect(compareChainStyles(same.groups[0].members[0], same.groups[0].members[1]).sameStyle).toBe(true);
  });

  it('整体倍增仍有差异，同模型候选按实际权重接近程度排序', async () => {
    const doubled = await scan([chain('a', 'artist:a, 0.5::artist:b::'), chain('b', '2::artist:a::, artist:b')]);
    expect(doubled.groups).toEqual([]);
    const sorted = await scan([chain('base', 'artist:a'), chain('far', '1.3::artist:a::'), chain('near', '1.05::artist:a::')]);
    expect(sorted.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['base', 'near', 'far']]);
    const sameNamesRatio = await scan([chain('base', 'artist:a, artist:b, artist:c, 0.1::artist:d::'),
      chain('far', '1.1::artist:a, artist:b, artist:c::'), chain('near', 'artist:a, artist:b, artist:c')]);
    expect(sameNamesRatio.groups[0].members.map(item => item.chain.id)).toEqual(['base', 'near', 'far']);
  });

  it('无画师配方要求画风权重也达到九成，质量和人物不冲淡差异', async () => {
    const specific = await scan([
      chain('a', 'watercolor, thin lines'), chain('b', '1.05::watercolor::, thin lines'),
      chain('c', '2::watercolor::, thin lines'),
    ]);
    expect(specific.groups.map(group => group.members.map(item => item.chain.id))).toEqual([['a', 'b']]);
    const generic = 'masterpiece, best quality, 1girl';
    const reversed = await scan([
      chain('a', `artist:a, 2::watercolor::, 0.5::thin lines::, ${generic}`),
      chain('b', `artist:a, 0.5::watercolor::, 2::thin lines::, ${generic}`),
    ]);
    expect(reversed.groups).toEqual([]);
    expect((await scan([chain('a', `2::artist:a::, 0.5::artist:b::, ${generic}`),
      chain('b', `0.5::artist:a::, 2::artist:b::, ${generic}`)])).groups).toEqual([]);
  });

  it('不确定的导入权重不能冒充确定倍率进入加权归组', async () => {
    const result = await scan([chain('a', '(artist:a:0.9)'), chain('b', '0.9::artist:a::')]);
    expect(result.groups).toEqual([]);
    expect(result.insufficient.map(item => item.chain.id)).toEqual(['a']);
    expect(profile('(artist:a:0.9)').features[0]).toMatchObject({ effectiveWeight: null, raw: '(artist:a:0.9)' });
  });

  it('少量新增画风不一票否决相同画师配方，强反向画风仍有实质影响', async () => {
    const artists = ['a', 'b', 'c', 'd', 'e'].map(name => `artist:${name}`).join(', ');
    expect((await scan([chain('a', artists), chain('b', `${artists}, watercolor`)])).matched).toBe(2);
    expect((await scan([chain('a', 'artist:a'), chain('b', 'artist:a, -10::watercolor::')])).groups).toEqual([]);
    const generic = 'anime, digital art, illustration, realistic, 3d';
    expect((await scan([chain('a', `2::artist:a::, 0.5::artist:b::, ${generic}`),
      chain('b', `0.5::artist:a::, 2::artist:b::, ${generic}`)])).groups).toEqual([]);
  });

  it('A≈B、B≈C 时可展示重叠候选，但 A 与 C 不被连锁塞进同组', async () => {
    const prompts = ['artist:a, artist:b, artist:c', 'artist:a, artist:b, artist:c, artist:d', 'artist:a, artist:b, artist:d'];
    const result = await scan(prompts.map((prompt, index) => chain(String(index), prompt)));
    const groups = result.groups.map(group => group.members.map(item => item.chain.id));
    expect(groups).toEqual([['0', '1'], ['1', '2']]);
    expect(result.matched).toBe(3);
    expect(groups.every(group => !(group.includes('0') && group.includes('2')))).toBe(true);
  });

  it('模型优先不会吞掉已经在其他组出现的桥接相似对', async () => {
    const sets = [['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['a', 'b', 'd'], ['a', 'b', 'd', 'e']];
    const input = sets.map((names, index) => chain(String(index), names.map(name => `artist:${name}`).join(', '), {
      params: { ...chain('', '').params, model: index < 2 ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full' },
    }));
    const result = await scan(input);
    const groups = result.groups.map(group => group.members.map(item => Number(item.chain.id)));
    for (let left = 0; left < sets.length; left++) for (let right = left + 1; right < sets.length; right++) {
      const common = sets[left].filter(artist => sets[right].includes(artist)).length;
      const similar = common / new Set([...sets[left], ...sets[right]]).size >= 0.75;
      expect(groups.some(group => group.includes(left) && group.includes(right))).toBe(similar);
    }
    expect(result.matched).toBe(4);
  });

  it('组相似度取所有两两评分最低值，删除后的子组复用同一评分', async () => {
    const result = await scan([chain('a', 'artist:a'), chain('b', '1.1::artist:a::'), chain('c', '1.2::artist:a::')]);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.similarity).toBeCloseTo(1 / 1.2, 12);
    const average = (1 / 1.1 + 1 / 1.2 + 1.1 / 1.2) / 3;
    expect(group.similarity).toBeLessThan(average);
    expect(getChainGroupSimilarity(group.members)).toBe(group.similarity);
    expect(getChainGroupSimilarity(group.members.filter(member => member.chain.id !== 'c'))).toBeCloseTo(1 / 1.1, 12);
    expect(getChainGroupSimilarity([])).toBe(0);
    expect(getChainGroupSimilarity(group.members.slice(0, 1))).toBe(0);
  });

  it('按未四舍五入的组相似度降序，同分保留原组顺序，等效权重为百分之百', async () => {
    const pairs = [
      ['low', 'a', '1.10009'], ['high', 'b', '1.10001'],
      ['tie-first', 'c', '1.2'], ['tie-second', 'd', '1.2'],
    ];
    const input = pairs.flatMap(([id, artist, weight]) => [chain(id, `artist:${artist}`), chain(`${id}-pair`, `${weight}::artist:${artist}::`)]);
    input.push(chain('equal', '{artist:e}'), chain('equal-pair', '1.05::artist:e::'));
    const result = await scan(input);
    expect(result.groups.map(group => group.members[0].chain.id)).toEqual(['equal', 'high', 'low', 'tie-first', 'tie-second']);
    expect(result.groups[0].similarity).toBe(1);
    expect(result.groups[1].similarity).toBeGreaterThan(result.groups[2].similarity);
    expect((result.groups[1].similarity * 100).toFixed(1)).toBe((result.groups[2].similarity * 100).toFixed(1));
    expect(result.groups[3].similarity).toBe(result.groups[4].similarity);
  });

  it('千条同画师只生成一组，分组阶段也能取消', async () => {
    const input = Array.from({ length: 1000 }, (_, index) => chain(String(index), `${1 + index / 10000}::artist:alpha_artist::`));
    const result = await scan(input);
    expect(result.groups).toHaveLength(1); expect(result.groups[0].members).toHaveLength(1000);
    const controller = new AbortController();
    await expect(findSimilarChains(input, artists, controller.signal, stage => {
      if (stage === 'group') setTimeout(() => controller.abort(), 0);
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('优先同模型，同时显露模型／负面／分类负面／角色／参考／参数差异', async () => {
    const left = chain('a', 'artist:alpha_artist');
    const right = chain('b', 'artist:alpha_artist', { negativePrompt: 'bad hands', params: {
      ...left.params, model: 'nai-diffusion-5-full', seed: 7,
      _promptSections: { scene: 'forest', sectionNegatives: { scene: 'street' } },
      characters: [{ id: 'synthetic', prompt: '1boy', x: 0.3, y: 0.4 }],
      vibes: { enabled: true, normalizeStrengths: false, slots: [] },
      characterReferences: { enabled: true, slots: [] },
    } });
    const third = chain('c', 'artist:alpha_artist');
    const result = await scan([left, right, third]);
    expect(result.groups[0].members.map(item => item.chain.id)).toEqual(['a', 'c', 'b']);
    const comparison = compareChainStyles(result.groups[0].members[0], result.groups[0].members[2]);
    expect(comparison.sameModel).toBe(false);
    expect(comparison.differences.map(row => row.label)).toEqual(['负面提示词', '角色配置', 'Vibe', '角色／风格参考', '生成参数']);
    expect(comparison.differences[0].right).toBe('bad hands, street');
    expect(comparison.differences[1].right).not.toContain('synthetic');
    expect(comparison.differences[4].right).toContain('"seed": 7');
    const details = getChainComparisonDetails(right);
    expect(details.map(row => row.label)).toEqual(comparison.differences.map(row => row.label));
    expect(details.map(row => row.value)).toEqual(comparison.differences.map(row => row.right));
    const reordered = chain('reordered', 'artist:alpha_artist', { params: Object.fromEntries(Object.entries(left.params).reverse()) as PromptChain['params'] });
    expect(compareChainStyles(describeChainStyle(left, artists), describeChainStyle(reordered, artists)).differences).toEqual([]);
  });

  it('旧串缺类型仍参与，缺模型不冒充当前默认模型，词库缺失仍识别显式画师', async () => {
    const a = chain('a', 'artist:alpha_artist'); delete (a as Partial<PromptChain>).type; delete a.params.model;
    const result = await scan([a, chain('b', 'artist:alpha_artist'), chain('c', 'alpha_artist')], new Set());
    expect(result.groups[0].members).toHaveLength(2); expect(result.insufficient).toHaveLength(1);
    expect(compareChainStyles(result.groups[0].members[0], result.groups[0].members[1]).modelKnown).toBe(false);
  });

  it('扫描覆盖首屏之外，进度分阶段推进，关闭可中止', async () => {
    const input = Array.from({ length: 85 }, (_, index) => chain(String(index), index < 83 ? `artist:unique_${index}` : 'artist:shared'));
    const stages: string[] = [], controller = new AbortController();
    const result = await findSimilarChains(input, artists, controller.signal, stage => stages.push(stage));
    expect(result.groups[0].members.map(item => item.chain.id)).toEqual(['83', '84']);
    expect(new Set(stages)).toEqual(new Set(['extract', 'group']));
    const pending = findSimilarChains(input, artists, controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
