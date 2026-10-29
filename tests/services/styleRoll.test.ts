import { describe, expect, it } from 'vitest';
import { candidateFixture, rollFixture, seededRandom } from '../fixtures/styleRoll';
import { createDefaultRollTemplate, DEFAULT_ROLL_CHARACTER_PROMPT, DEFAULT_ROLL_NEGATIVE, DEFAULT_ROLL_PROMPT, formatRollStyle, ROLL_MAX_ARTISTS, getRollPinnedArtists, mergeRollArtists, parseRollArtists, removeRollCandidates, resolveRollArtists, rollCandidateCapacity, rollCandidates, rollCandidateToChain, rollPrompt, rollSignature, validateRollExperiment, validateRollPreset, validateRollTemplate, type RollExperiment } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';

it('推荐模板工厂沿用当前默认值且各次结果独立', () => {
  const template = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME);
  expect(template.prompt).toBe(DEFAULT_ROLL_PROMPT);
  expect(template.prompt).not.toMatch(/\b(?:1girl|solo|upper body|looking at viewer)\b/);
  expect(template.characterPrompt).toBe(DEFAULT_ROLL_CHARACTER_PROMPT);
  expect(template.negativePrompt).toBe(DEFAULT_ROLL_NEGATIVE);
  expect(template.params).toMatchObject({ width: 832, height: 1216, steps: DEFAULT_NAI_RUNTIME.freeMaxSteps, scale: 5, sampler: 'k_euler_ancestral', seed: 0, qualityToggle: false, ucPreset: 4, characters: [] });
  validateRollTemplate(template);
  const next = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME);
  expect(next.params).not.toBe(template.params);
  expect(next.params.characters).not.toBe(template.params.characters);
  expect(rollPrompt(template, [{ tag: 'alpha', weight: 1 }])).toBe('masterpiece, very aesthetic, best quality, absurdres, highres, no text, intricate details, ultra-detailed, depth of field, shiny skin, realistic skin surface, cinematic lighting, year 2025, simple background, 1.0::artist:alpha ::, 1girl, solo, upper body, looking at viewer');
});

it('推荐重分栏保留全部原词且不增加重复项，背景归公共而角色只留人物姿态', () => {
  const previous = 'masterpiece, very aesthetic, best quality, absurdres, highres, no text, {style}, 1girl, solo, upper body, looking at viewer, intricate details, ultra-detailed, depth of field, shiny skin, realistic skin surface, cinematic lighting, simple background, year 2025';
  const words = (text: string) => text.split(',').map(word => word.trim()).sort();
  expect(words(`${DEFAULT_ROLL_PROMPT}, ${DEFAULT_ROLL_CHARACTER_PROMPT}`)).toEqual(words(previous));
  expect(DEFAULT_ROLL_CHARACTER_PROMPT).toBe('1girl, solo, upper body, looking at viewer');
});

it('预设验证复用完整生成模板边界，不接受无名、旧版本或缺少style位置', () => {
  const preset = { id: 'quality-one', name: '自定义质量词', revision: 0, createdAt: 1, updatedAt: 1, template: rollFixture().template };
  expect(() => validateRollPreset(preset)).not.toThrow();
  for (const patch of [{ id: '../other' }, { name: ' ' }, { revision: -1 }, { revision: 0.5 }, { createdAt: NaN }]) expect(() => validateRollPreset({ ...preset, ...patch })).toThrow('Roll 预设资料无效');
  expect(() => validateRollPreset({ ...preset, template: { ...preset.template, prompt: 'no placeholder' } })).toThrow('公共提示词');
});

it('每条串从人数范围抽取，锁定计入总数且权重仍随机', () => {
  const e = rollFixture(); e.pinnedArtists = ['alpha', 'beta']; e.rules = { ...e.rules, minArtists: 4, maxArtists: 6 };
  const candidates = rollCandidates(e, 24, { random: seededRandom(23) });
  expect(new Set(candidates.map(candidate => candidate.tags.length))).toEqual(new Set([4, 5, 6]));
  expect(candidates.every(candidate => candidate.tags.slice(0, 2).map(tag => tag.tag).join(',') === 'alpha,beta')).toBe(true);
  expect(new Set(candidates.map(candidate => candidate.tags[0].weight)).size).toBeGreaterThan(1);
  e.rules.minArtists = 6;
  expect(rollCandidates(e, 12).every(candidate => candidate.tags.length === 6)).toBe(true);
});

it('偏好保底计入已锁定偏好，屏蔽和排除后不足会停止', () => {
  const e = rollFixture(); e.pinnedArtists = ['alpha']; e.rules = { ...e.rules, minArtists: 3, maxArtists: 5, preferredMinArtists: 2 };
  const preferredTags = ['alpha', 'beta'];
  const candidates = rollCandidates(e, 12, { preferredTags, random: seededRandom(7) });
  expect(candidates.every(candidate => preferredTags.every(tag => candidate.tags.some(item => item.tag === tag)))).toBe(true);
  expect(() => rollCandidates(e, 1, { preferredTags, blockedTags: ['beta'] })).toThrow('可用偏好画师不足');
  e.artists[1].excluded = true;
  expect(() => rollCandidates(e, 1, { preferredTags })).toThrow('可用偏好画师不足');
  e.pinnedArtists = ['gamma', 'delta', 'eta', 'theta', 'zeta'];
  e.artists[1].excluded = false;
  expect(() => rollCandidates(e, 1, { preferredTags })).toThrow('固定画师与偏好保底超出人数上限');
});

it('倍率由用户设置并增加偏好抽中率，不改变提示词权重或重复抽同一 Tag', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 1, maxArtists: 1 };
  const sample = (multiplier: number) => {
    const random = seededRandom(42); e.rules.preferredMultiplier = multiplier;
    return Array.from({ length: 1000 }, () => rollCandidates(e, 1, { random, preferredTags: ['alpha'] })[0]).filter(candidate => candidate.tags[0].tag === 'alpha').length;
  };
  expect(sample(1)).toBeLessThan(180); expect(sample(10)).toBeGreaterThan(500);
  e.rules = { ...e.rules, minArtists: 5, maxArtists: 5, minWeight: 1.2, maxWeight: 1.2 };
  const candidates = rollCandidates(e, 12, { preferredTags: ['alpha', 'beta'], random: seededRandom(9) });
  expect(candidates.every(candidate => new Set(candidate.tags.map(tag => tag.tag)).size === 5 && candidate.tags.every(tag => tag.weight === 1.2))).toBe(true);
});

it('保存边界校验偏好设置，旧记录缺省为不加权且不保底', () => {
  const e = rollFixture(); expect(() => validateRollExperiment(e)).not.toThrow();
  for (const preferredMultiplier of [0, -1, Infinity, NaN]) expect(() => validateRollExperiment({ ...e, rules: { ...e.rules, preferredMultiplier } })).toThrow('偏好');
  for (const preferredMinArtists of [-1, 1.5, 5]) expect(() => validateRollExperiment({ ...e, rules: { ...e.rules, preferredMinArtists } })).toThrow('偏好');
});

it.each([0, 0.999999])('只抽收藏在随机极值%s仍不混普通，已收藏固定计入且倍率保底保持原值', random => {
  const e = rollFixture(); e.pinnedArtists = ['alpha'];
  e.rules = { ...e.rules, minArtists: 3, maxArtists: 3, preferredOnly: true, preferredMultiplier: 100, preferredMinArtists: 1 };
  const before = structuredClone(e);
  const [candidate] = rollCandidates(e, 1, { preferredTags: ['alpha', 'beta', 'gamma'], random: () => random });
  expect(candidate.tags.map(tag => tag.tag).sort()).toEqual(['alpha', 'beta', 'gamma']);
  expect(new Set(candidate.tags.map(tag => tag.tag)).size).toBe(3);
  expect(e).toEqual(before);
});

it('只抽收藏拒绝未收藏固定及不足最大人数，不补普通或降低本串人数', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 1, maxArtists: 3, preferredOnly: true };
  const before = structuredClone(e);
  expect(() => rollCandidates(e, 1, { preferredTags: [], random: () => 0 })).toThrow('可用收藏画师不足');
  expect(() => rollCandidates(e, 1, { preferredTags: ['alpha', 'beta'], random: () => 0 })).toThrow('可用收藏画师不足');
  e.pinnedArtists = ['theta'];
  expect(() => rollCandidates(e, 1, { preferredTags: ['alpha', 'beta', 'gamma'] })).toThrow('固定画师未收藏：theta');
  expect(e.candidates).toEqual(before.candidates); expect(e.rounds).toEqual(before.rounds);
  expect(e.pinnedArtists).toEqual(['theta']);
});

it('只抽收藏忽略保留的旧保底，降低人数仍可抽且关闭后恢复原保底校验', () => {
  const e = rollFixture();
  e.rules = { ...e.rules, minArtists: 2, maxArtists: 2, preferredOnly: true, preferredMinArtists: 4, preferredMultiplier: 100 };
  expect(() => validateRollExperiment(e)).not.toThrow();
  expect(rollCandidates(e, 1, { preferredTags: ['alpha', 'beta'] })[0].tags.map(tag => tag.tag).sort()).toEqual(['alpha', 'beta']);
  expect(e.rules).toMatchObject({ preferredMinArtists: 4, preferredMultiplier: 100 });
  e.rules.preferredOnly = false;
  expect(() => validateRollExperiment(e)).toThrow('偏好抽中倍率和保底人数');
  expect(() => rollCandidates(e, 1, { preferredTags: ['alpha', 'beta'] })).toThrow('偏好抽中倍率和保底人数');
  e.rules.preferredOnly = true;
  for (const preferredMinArtists of [-1, 1.5, ROLL_MAX_ARTISTS + 1]) expect(() => validateRollExperiment({ ...e, rules: { ...e.rules, preferredMinArtists } })).toThrow('偏好抽中倍率和保底人数');
});

it('只抽收藏缺省或关闭保持原加权抽取，保存与旧轮次快照校验布尔类型', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 1, maxArtists: 1, preferredMultiplier: 100 };
  const draw = () => rollCandidates(e, 1, { preferredTags: ['alpha'], random: () => 0.999999 })[0].tags[0].tag;
  expect(draw()).toBe('theta');
  e.rules.preferredOnly = true; expect(draw()).toBe('alpha');
  e.rules.preferredOnly = false; expect(draw()).toBe('theta');
  expect(() => validateRollExperiment(e)).not.toThrow();
  for (const preferredOnly of ['true', 1, null]) expect(() => validateRollExperiment({ ...e, rules: { ...e.rules, preferredOnly: preferredOnly as unknown as boolean } })).toThrow('只抽取收藏画师设置无效');
  const candidate = candidateFixture('old');
  const old: RollExperiment = { ...e, candidates: [candidate], rounds: [{ id: 'old-round', createdAt: 1, candidateIds: [candidate.id], snapshot: { rules: { ...e.rules, preferredOnly: undefined }, pinnedArtists: [] } }] };
  expect(() => validateRollExperiment(old)).not.toThrow();
  old.rounds[0].snapshot!.rules.preferredOnly = 'true' as unknown as boolean;
  expect(() => validateRollExperiment(old)).toThrow('只抽取收藏画师设置无效');
});

describe('Roll 串画师与规则', () => {
  it('完整词库不受手填1000项限制，覆盖项按名称去重且锁定／排除优先', () => {
    const names = Array.from({ length: 1205 }, (_, index) => `catalog_${index}`);
    const overrides = [{ tag: 'CATALOG 0', weight: 2, locked: true, excluded: false }, { tag: 'catalog_1', weight: 1, locked: false, excluded: true }];
    const artists = resolveRollArtists([...names, 'CATALOG 2', 'invalid,tag'], overrides);
    expect(artists).toHaveLength(1205); expect(artists[0]).toEqual(overrides[0]); expect(artists[1]).toEqual(overrides[1]); expect(artists[2].tag).toBe('catalog_2');
    const e = rollFixture(); e.artists = artists;
    const candidate = rollCandidates(e, 1, { random: () => 0.999999 })[0];
    expect(candidate.tags[0]).toEqual({ tag: 'CATALOG 0', weight: 1.4 }); expect(candidate.tags.some(tag => tag.tag === 'catalog_1204')).toBe(true);
    expect(candidate.tags.some(tag => tag.tag === 'catalog_1')).toBe(false); expect(overrides).toHaveLength(2);
  });
  it('支持裸 Tag、artist 前缀和数值权重，归一化去重但保留第一份名字', () => {
    expect(parseRollArtists('artist:alpha_name, 1.2::artist:beta ::\nALPHA NAME')).toEqual([
      { tag: 'alpha_name', weight: 1, locked: false, excluded: false }, { tag: 'beta', weight: 1.2, locked: false, excluded: false },
    ]);
    expect(mergeRollArtists([{ ...parseRollArtists('alpha')[0], locked: true }], parseRollArtists('ALPHA, beta'))).toHaveLength(2);
  });
  it.each(['-1::artist:alpha ::', '0::alpha::', '1.23::alpha::', '{artist:alpha}', '3.1::alpha::'])('拒绝无效权重与嵌套语法 %s', input => expect(() => parseRollArtists(input)).toThrow());
  it('固定 Seed 0 有效；不接受随机 Seed、重复占位或编辑模型', () => {
    const e = rollFixture(); expect(() => validateRollTemplate(e.template)).not.toThrow();
    for (const seed of [undefined, -1, NaN, 4294967296]) expect(() => validateRollTemplate({ ...e.template, params: { ...e.template.params, seed } })).toThrow();
    expect(() => validateRollTemplate({ ...e.template, prompt: '{style}, {style}' })).toThrow();
    expect(() => validateRollTemplate({ ...e.template, params: { ...e.template.params, model: 'nai-diffusion-4-5-full-inpainting' } })).toThrow();
  });
  it('空池草稿可保存，真正 Roll 才要求足够画师', () => {
    const e = rollFixture(); e.artists = []; expect(() => validateRollExperiment(e)).not.toThrow();
    expect(() => rollCandidates(e, 1)).toThrow('可用画师不足');
    e.artists = parseRollArtists('alpha, beta, gamma').map(artist => ({ ...artist, locked: true }));
    e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
    expect(() => rollCandidates(e, 1)).toThrow('固定画师数量');
  });
  it('候选只保存画师与权重，不再接受来源、方法或代数字段', () => {
    const e = rollFixture(); e.candidates = [candidateFixture('a')];
    expect(() => validateRollExperiment(e)).not.toThrow();
    expect(() => validateRollExperiment({ ...e, candidates: [{ ...candidateFixture('a'), tags: [] }] })).toThrow('候选串资料无效');
    expect(() => validateRollExperiment({ ...e, candidates: [{ ...candidateFixture('a'), tags: [{ tag: 'a', weight: 1 }, { tag: 'A', weight: 1 }] }] })).toThrow('候选串资料无效');
  });
  it('旧记录字段不再兼容：带来源、方法或代数的候选直接判为无效', () => {
    const e = rollFixture();
    const legacy = { ...e, candidates: [{ id: 'old', genes: [{ tag: 'alpha', weight: 1.2 }], parents: ['x'], method: 'mutate', generation: 2, createdAt: 1, archived: false }] };
    expect(() => validateRollExperiment(legacy)).toThrow('候选串资料无效');
  });
});

describe('Roll 抽取', () => {
  it('自定义范围包含上下界，范围相等时使用固定权重', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minWeight: 1.8, maxWeight: 2.2 };
    expect(rollCandidates(e, 1, { random: () => 0 })[0].tags.every(tag => tag.weight === 1.8)).toBe(true);
    expect(rollCandidates(e, 1, { random: () => 0.999999 })[0].tags.every(tag => tag.weight === 2.2)).toBe(true);
    e.rules.minWeight = e.rules.maxWeight = 0.1;
    expect(rollCandidates(e, 1)[0].tags.every(tag => tag.weight === 0.1)).toBe(true);
  });
  it('每轮都是纯随机组合，不受已保存候选影响', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minArtists: 4, maxArtists: 4 };
    e.candidates = [{ ...candidateFixture('saved'), savedChainId: 'chain', tags: ['alpha', 'beta', 'gamma', 'delta'].map(tag => ({ tag, weight: 1 })) }];
    const result = rollCandidates(e, 8, { random: seededRandom() });
    expect(result).toHaveLength(8);
    expect(result.every(candidate => !('parents' in candidate) && !('method' in candidate))).toBe(true);
    expect(new Set(result.map(candidate => rollSignature(candidate.tags))).size).toBe(8);
  });
  it('批次去重、固定 Tag 随机权重、排除生效，并满足总人数和权重边界', () => {
    const e = rollFixture(); e.artists[0] = { ...e.artists[0], locked: true, weight: 2 }; e.artists[1].excluded = true;
    const random = seededRandom(); e.candidates = rollCandidates(e, 24, { random });
    e.candidates.push(...rollCandidates(e, 24, { random }));
    expect(new Set(e.candidates.map(candidate => rollSignature(candidate.tags))).size).toBe(48);
    for (const candidate of e.candidates) {
      expect(candidate.tags).toHaveLength(4);
      expect(candidate.tags[0].tag).toBe('alpha'); expect(candidate.tags.some(tag => tag.tag === 'beta')).toBe(false);
      for (const tag of candidate.tags) { expect(tag.weight).toBeGreaterThanOrEqual(0.7); expect(tag.weight).toBeLessThanOrEqual(1.4); }
    }
    expect(() => validateRollExperiment(e)).not.toThrow();
  });
  it('可行组合不足时有界返回部分结果，完全重复时明确失败', () => {
    const e = rollFixture(); e.artists = parseRollArtists('alpha'); e.rules = { minArtists: 1, maxArtists: 1, minWeight: 1, maxWeight: 1 };
    e.candidates = rollCandidates(e, 24); expect(e.candidates).toHaveLength(1);
    expect(() => rollCandidates(e, 1)).toThrow('没有新的组合');
  });
});

describe('统一随机抽取', () => {
  it('部分固定计入总人数，补齐其余 Tag，全部权重每条重新抽取', () => {
    const e = rollFixture(); e.pinnedArtists = ['alpha', 'beta'];
    e.rules = { ...e.rules, minArtists: 5, maxArtists: 5 };
    e.artists[0].weight = 3; e.artists[0].locked = true;
    const result = rollCandidates(e, 24, { random: seededRandom() });
    expect(result).toHaveLength(24);
    for (const candidate of result) {
      expect(candidate.tags).toHaveLength(5);
      expect(candidate.tags.slice(0, 2).map(item => item.tag)).toEqual(['alpha', 'beta']);
      expect(new Set(candidate.tags.map(item => item.tag)).size).toBe(5);
      expect(candidate.tags.every(item => item.weight >= 0.7 && item.weight <= 1.4)).toBe(true);
    }
    expect(new Set(result.map(candidate => candidate.tags[0].weight)).size).toBeGreaterThan(1);
    expect(new Set(result.map(candidate => candidate.tags.slice(2).map(item => item.tag).join(','))).size).toBeGreaterThan(1);
  });
  it('固定全部画师仍随机每位的权重，无需额外解除权重锁', () => {
    const e = rollFixture(); e.pinnedArtists = ['alpha', 'beta']; e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
    const result = rollCandidates(e, 12, { random: seededRandom() });
    expect(result).toHaveLength(12);
    expect(result.every(candidate => candidate.tags.map(tag => tag.tag).join(',') === 'alpha,beta')).toBe(true);
    expect(new Set(result.map(candidate => rollSignature(candidate.tags))).size).toBe(12);
  });
  it('上下限相等即统一权重，对固定 Tag 同样生效', () => {
    const e = rollFixture(); e.pinnedArtists = ['alpha']; e.rules = { ...e.rules, minWeight: 1.1, maxWeight: 1.1 };
    expect(rollCandidates(e, 4).every(candidate => candidate.tags.every(tag => tag.weight === 1.1))).toBe(true);
  });
  it('固定项不能超过总人数、重复或绕过屏蔽及排除', () => {
    const e = rollFixture(); e.pinnedArtists = ['alpha'];
    expect(() => rollCandidates(e, 1, { blockedTags: ['alpha'] })).toThrow('固定画师不可用');
    e.artists[0].excluded = true;
    expect(() => rollCandidates(e, 1)).toThrow('固定画师不可用');
    e.pinnedArtists = ['beta', 'BETA'];
    expect(() => validateRollExperiment(e)).toThrow('不重复');
    e.pinnedArtists = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    expect(() => rollCandidates(e, 1)).toThrow('不能超过每串总人数');
  });
  it('候选池不足时不偷偷减少总人数，手动固定项可来自词库之外', () => {
    const e = rollFixture(); e.pinnedArtists = ['manual'];
    expect(rollCandidates(e, 1)[0].tags[0].tag).toBe('manual');
    const blocked = e.artists.slice(1).map(artist => artist.tag);
    expect(() => rollCandidates(e, 1, { blockedTags: blocked })).toThrow('可用画师不足');
  });
  it('旧固定模式与单项锁定只保留 Tag，显式空列表可解除全部旧锁定', () => {
    const e = rollFixture(); e.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['beta'] };
    e.artists[0].locked = true; e.artists[0].weight = 3;
    expect(() => validateRollExperiment(e)).not.toThrow();
    expect(getRollPinnedArtists(e)).toEqual(['beta', 'alpha']);
    const result = rollCandidates(e, 1, { random: () => 0 });
    expect(result[0].tags.slice(0, 2)).toEqual([{ tag: 'beta', weight: 0.7 }, { tag: 'alpha', weight: 0.7 }]);
    e.pinnedArtists = []; expect(getRollPinnedArtists(e)).toEqual([]);
  });
});

describe('风格串保存', () => {
  it('角色提示词跟随画师串，并支持模板内 {character} 占位', () => {
    const e = rollFixture(); e.candidates = [candidateFixture('a')];
    const style = formatRollStyle(e.candidates[0].tags);
    expect(rollPrompt({ ...e.template, characterPrompt: 'miku, twintails' }, e.candidates[0].tags)).toBe(`${style}, miku, twintails, synthetic subject`);
    expect(rollPrompt({ ...e.template, prompt: '{style}, {character}, landscape', characterPrompt: 'miku' }, e.candidates[0].tags)).toBe(`${style}, miku, landscape`);
    expect(rollPrompt({ ...e.template, characterPrompt: '  ' }, e.candidates[0].tags)).toBe(`${style}, synthetic subject`);
    expect(() => validateRollTemplate({ ...e.template, prompt: '{style} {character} {character}' })).toThrow();
  });
  it('风格串保存保留完整配置和真实 Seed，独立深拷贝角色参数', () => {
    const e = rollFixture(); e.template.params.characters = [{ id: 'role', prompt: 'subject', negativePrompt: 'negative role', x: 0.5, y: 0.5 }];
    e.candidates = [candidateFixture('alpha')]; const saved = rollCandidateToChain(e, e.candidates[0], '/api/assets/synthetic.png');
    expect(saved.basePrompt).toBe(`${formatRollStyle(e.candidates[0].tags)}, synthetic subject`); expect(saved.params.seed).toBe(0);
    expect(saved.params.characters).toEqual(e.template.params.characters); expect(saved.params.characters).not.toBe(e.template.params.characters);
    expect(saved.modules).toEqual([]); expect(saved.variableValues).toEqual({ subject: '' }); expect(saved.tags).toEqual([]);
  });
  it('保存名带候序号与主权重画师，便于在风格串列表辨认', () => {
    const e = rollFixture();
    e.candidates = [{ id: 'mixed', tags: [{ tag: 'alpha', weight: 1.2 }, { tag: 'beta', weight: 2 }, { tag: 'gamma', weight: 0.8 }], createdAt: 1, archived: false }];
    expect(rollCandidateToChain(e, e.candidates[0]).name).toBe('合成实验 · 1 · beta / alpha');
  });
});

describe('候选容量与永久清理', () => {
  const candidate = (id: string, archived = false) => ({ ...candidateFixture(id), archived });
  it('容量按全部候选计算，已归档项仍占位', () => {
    const e = rollFixture();
    e.candidates = Array.from({ length: 238 }, (_, index) => candidate(`c${index}`));
    expect(rollCandidateCapacity(e)).toBe(2);
    expect(() => rollCandidates(e, 3)).toThrow('还可 Roll 2 串');
  });
  it('永久清理只接受已归档候选，并同步移除轮次引用、删除空轮', () => {
    const e = rollFixture();
    e.candidates = [candidate('keep'), candidate('drop', true)];
    e.rounds = [{ id: 'r1', candidateIds: ['drop'], createdAt: 1 }, { id: 'r2', candidateIds: ['keep', 'drop'], createdAt: 2 }];
    const next = removeRollCandidates(e, ['drop']);
    expect(next.candidates.map(item => item.id)).toEqual(['keep']);
    expect(next.rounds.map(round => round.id)).toEqual(['r2']);
    expect(next.rounds[0].candidateIds).toEqual(['keep']);
    expect(() => validateRollExperiment(next)).not.toThrow();
    expect(() => removeRollCandidates(e, ['keep'])).toThrow('只能永久清理已归档的候选');
    expect(removeRollCandidates(e, [])).toBe(e);
  });
});
