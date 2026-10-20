import { describe, expect, it } from 'vitest';
import { candidateFixture, rollFixture, seededRandom } from '../fixtures/styleRoll';
import { formatRollStyle, mergeRollArtists, parseRollArtists, removeRollCandidates, resolveRollArtists, rollCandidateCapacity, rollCandidates, rollCandidateToChain, rollPrompt, rollSignature, validateRollExperiment, validateRollRules, validateRollTemplate } from '../../services/styleRoll';

describe('Roll 串画师与规则', () => {
  it('完整词库不受手填1000项限制，覆盖项按名称去重且锁定／排除优先', () => {
    const names = Array.from({ length: 1205 }, (_, index) => `catalog_${index}`);
    const overrides = [{ tag: 'CATALOG 0', weight: 2, locked: true, excluded: false }, { tag: 'catalog_1', weight: 1, locked: false, excluded: true }];
    const artists = resolveRollArtists([...names, 'CATALOG 2', 'invalid,tag'], overrides);
    expect(artists).toHaveLength(1205); expect(artists[0]).toEqual(overrides[0]); expect(artists[1]).toEqual(overrides[1]); expect(artists[2].tag).toBe('catalog_2');
    const e = rollFixture(); e.artists = artists;
    const candidate = rollCandidates(e, 1, { random: () => 0.999999 })[0];
    expect(candidate.tags[0]).toEqual({ tag: 'CATALOG 0', weight: 2 }); expect(candidate.tags.some(tag => tag.tag === 'catalog_1204')).toBe(true);
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
    expect(() => validateRollRules(e.artists, { ...e.rules, minArtists: 1, maxArtists: 2 })).toThrow('锁定画师');
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
  it('批次去重、锁定原权重、排除生效，并满足全部数量和权重边界', () => {
    const e = rollFixture(); e.artists[0] = { ...e.artists[0], locked: true, weight: 2 }; e.artists[1].excluded = true;
    const random = seededRandom(); e.candidates = rollCandidates(e, 24, { random });
    e.candidates.push(...rollCandidates(e, 24, { random }));
    expect(new Set(e.candidates.map(candidate => rollSignature(candidate.tags))).size).toBe(48);
    for (const candidate of e.candidates) {
      expect(candidate.tags.length).toBeGreaterThanOrEqual(3); expect(candidate.tags.length).toBeLessThanOrEqual(6);
      expect(candidate.tags[0]).toEqual({ tag: 'alpha', weight: 2 }); expect(candidate.tags.some(tag => tag.tag === 'beta')).toBe(false);
      for (const tag of candidate.tags.slice(1)) { expect(tag.weight).toBeGreaterThanOrEqual(0.7); expect(tag.weight).toBeLessThanOrEqual(1.4); }
    }
    expect(() => validateRollExperiment(e)).not.toThrow();
  });
  it('可行组合不足时有界返回部分结果，完全重复时明确失败', () => {
    const e = rollFixture(); e.artists = parseRollArtists('alpha'); e.rules = { minArtists: 1, maxArtists: 1, minWeight: 1, maxWeight: 1 };
    e.candidates = rollCandidates(e, 24); expect(e.candidates).toHaveLength(1);
    expect(() => rollCandidates(e, 1)).toThrow('没有新的组合');
  });
});

describe('抽取方式', () => {
  it('固定权重时每个画师都用同一权重', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minWeight: 1.1, maxWeight: 1.1 };
    const result = rollCandidates(e, 4, { plan: { mode: 'fixedWeight' } });
    expect(result).toHaveLength(4);
    expect(result.every(candidate => candidate.tags.every(tag => tag.weight === 1.1))).toBe(true);
    expect(() => validateRollExperiment({ ...e, drawPlan: { mode: 'fixedWeight' } })).not.toThrow();
  });
  it('固定画师时集合不变，只随机权重', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
    const plan = { mode: 'pinnedArtists' as const, pinnedArtists: ['alpha', 'beta'] };
    const result = rollCandidates(e, 4, { plan, random: seededRandom() });
    expect(result).toHaveLength(4);
    for (const candidate of result) expect(candidate.tags.map(tag => tag.tag).sort()).toEqual(['alpha', 'beta']);
    expect(new Set(result.map(candidate => JSON.stringify(candidate.tags))).size).toBe(4);
  });
  it('固定画师必须包含锁定画师，且不能是被排除或屏蔽的画师', () => {
    const e = rollFixture(); e.artists[0].locked = true;
    expect(() => rollCandidates(e, 1, { plan: { mode: 'pinnedArtists', pinnedArtists: ['beta'] } })).toThrow('需要包含已锁定的画师');
    expect(() => rollCandidates(e, 1, { plan: { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'missing'] } })).toThrow('固定画师不可用');
    expect(() => rollCandidates(e, 1, { plan: { mode: 'pinnedArtists', pinnedArtists: ['alpha'] }, blockedTags: ['alpha'] })).toThrow('固定画师不可用');
  });
  it('全局屏蔽从随机池移除画师，屏蔽后不足最少人数时明确失败', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minArtists: 1, maxArtists: 8, minWeight: 1, maxWeight: 1 };
    const blocked = e.artists.slice(1).map(artist => artist.tag);
    expect(rollCandidates(e, 1, { blockedTags: blocked })[0].tags.map(tag => tag.tag)).toEqual(['alpha']);
    e.rules = { ...e.rules, minArtists: 3 };
    expect(() => rollCandidates(e, 1, { blockedTags: blocked })).toThrow('可用画师不足');
  });
  it('固定权重要求最低与最高权重相同，固定画师要求 1～64 个不重复 Tag', () => {
    const e = rollFixture();
    expect(() => rollCandidates(e, 1, { plan: { mode: 'fixedWeight' } })).toThrow('固定权重需要最低与最高权重相同');
    expect(() => rollCandidates(e, 1, { plan: { mode: 'pinnedArtists', pinnedArtists: [] } })).toThrow('固定画师需要 1～64 个不重复的画师 Tag');
    expect(() => rollCandidates(e, 1, { plan: { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'alpha'] } })).toThrow('固定画师需要 1～64 个不重复的画师 Tag');
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
