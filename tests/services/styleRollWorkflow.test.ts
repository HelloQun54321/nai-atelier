import { expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
import { rollCandidates, validateRollExperiment } from '../../services/styleRoll';
import { beginRollRound, currentRollRound } from '../../services/styleRollWorkflow';

it('提取池只限定随机补位，保留原固定项且不从全库补足', () => {
  const e = rollFixture(); e.artists = []; e.pinnedArtists = ['fixed-outside'];
  e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  e.chainArtistSource = { chainIds: ['source'], artists: [{ tag: 'only-source', count: 1 }] };
  const next = beginRollRound(e, ['whole-library'], 1);
  expect(next.candidates[0].tags.map(artist => artist.tag)).toEqual(['fixed-outside', 'only-source']);
  e.rules.maxArtists = 3;
  expect(() => beginRollRound(e, ['whole-library', 'another'], 1)).toThrow('可用画师不足');
  e.chainArtistSource = { chainIds: [], artists: [] };
  expect(() => beginRollRound(e, ['whole-library', 'another'], 1)).toThrow('可用画师不足');
});

it('提取集合可以超过单图人数上限，快照与JSON往返保留来源且不随后续选择变化', () => {
  const e = rollFixture(); e.artists = []; e.pinnedArtists = [];
  e.rules = { ...e.rules, minArtists: 1, maxArtists: 1 };
  e.chainArtistSource = { chainIds: ['source'], artists: Array.from({ length: 1100 }, (_, index) => ({ tag: `source-${index}`, count: 1 })) };
  const next = beginRollRound(e, ['not-source'], 1);
  expect(next.candidates[0].tags).toHaveLength(1);
  expect(next.rounds[0].snapshot?.chainArtistSource?.artists).toHaveLength(1100);
  const snapshot = structuredClone(next.rounds[0].snapshot);
  e.chainArtistSource.artists[0].tag = 'changed'; e.chainArtistSource.chainIds.push('second');
  expect(next.rounds[0].snapshot).toEqual(snapshot);
  expect(() => validateRollExperiment(JSON.parse(JSON.stringify(next)))).not.toThrow();
});

it('来源频次与偏好倍率相乘，偏好保底同样按来源频次抽取且单串不重复', () => {
  const e = rollFixture(); e.pinnedArtists = [];
  e.rules = { ...e.rules, minArtists: 1, maxArtists: 1 };
  e.artists = ['alpha', 'beta', 'outside'].map(tag => ({ tag, weight: 1, excluded: false, locked: false }));
  e.chainArtistSource = { chainIds: ['one', 'two'], artists: [{ tag: 'alpha', count: 2 }, { tag: 'beta', count: 1 }] };
  expect(rollCandidates(e, 1, { random: () => 0.6 })[0].tags[0].tag).toBe('alpha');
  e.rules.preferredMultiplier = 3;
  expect(rollCandidates(e, 1, { random: () => 0.6, preferredTags: ['beta'] })[0].tags[0].tag).toBe('beta');
  e.rules.preferredMinArtists = 1;
  expect(rollCandidates(e, 1, { random: () => 0.6, preferredTags: ['alpha', 'beta'] })[0].tags[0].tag).toBe('alpha');
  e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  expect(new Set(rollCandidates(e, 1, { random: () => 0.6, preferredTags: ['alpha', 'beta'] })[0].tags.map(artist => artist.tag)).size).toBe(2);
});

it('提取来源照常受样张、屏蔽和排除约束，偏好不足不借全库', () => {
  const e = rollFixture(); e.pinnedArtists = []; e.rules = { ...e.rules, minArtists: 1, maxArtists: 1 };
  e.artists = [{ tag: 'alpha', weight: 1, excluded: false, locked: false }, { tag: 'beta', weight: 1, excluded: true, locked: false }];
  e.chainArtistSource = { chainIds: ['one'], artists: [{ tag: 'alpha', count: 1 }, { tag: 'beta', count: 1 }] };
  expect(() => beginRollRound(e, ['outside'], 1, { sampledOnly: true })).toThrow('可用画师不足');
  expect(() => beginRollRound(e, ['outside'], 1, { blockedTags: ['alpha'] })).toThrow('可用画师不足');
  e.rules.preferredMinArtists = 1;
  expect(() => beginRollRound(e, ['outside'], 1, { preferredTags: ['outside', 'beta'] })).toThrow('可用偏好画师不足');
});

it('只抽收藏仍限定来源并保留来源频次，轮次快照保存开关且不改旧资料', () => {
  const e = rollFixture(); e.artists = []; e.pinnedArtists = [];
  e.rules = { ...e.rules, minArtists: 1, maxArtists: 1, preferredOnly: true, preferredMultiplier: 100, preferredMinArtists: 0 };
  e.chainArtistSource = { chainIds: ['one', 'two'], artists: [{ tag: 'alpha', count: 2 }, { tag: 'beta', count: 1 }, { tag: 'ordinary', count: 2 }] };
  const before = structuredClone(e);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.6);
  try {
    const options = { preferredTags: ['alpha', 'beta', 'outside'] };
    const next = beginRollRound(e, ['outside'], 1, options);
    expect(next.candidates[0].tags[0].tag).toBe('alpha');
    expect(currentRollRound(next)!.snapshot!.rules).toEqual(e.rules);
    expect(() => validateRollExperiment(JSON.parse(JSON.stringify(next)))).not.toThrow();
    expect(e).toEqual(before);
    e.chainArtistSource.artists[0].count = 1; e.chainArtistSource.artists[1].count = 2;
    expect(beginRollRound(e, ['outside'], 1, options).candidates[0].tags[0].tag).toBe('beta');
    expect(beginRollRound(e, ['beta'], 1, { ...options, sampledOnly: true }).candidates[0].tags[0].tag).toBe('beta');
    expect(() => beginRollRound(e, ['ordinary', 'outside'], 1, { ...options, sampledOnly: true })).toThrow('可用收藏画师不足');
    expect(() => beginRollRound(e, ['outside'], 1, { preferredTags: ['outside'] })).toThrow('可用收藏画师不足');
  } finally { random.mockRestore(); }
});

it('只抽收藏继续排除屏蔽与旧排除项，不足整轮停止，已收藏固定沿用原范围例外', () => {
  const e = rollFixture(); e.artists = [{ tag: 'beta', excluded: true, locked: false, weight: 1 }];
  e.pinnedArtists = []; e.rules = { ...e.rules, minArtists: 2, maxArtists: 2, preferredOnly: true };
  const before = structuredClone(e);
  expect(() => beginRollRound(e, ['alpha', 'beta', 'gamma', 'ordinary'], 1, { preferredTags: ['alpha', 'beta', 'gamma'], blockedTags: ['gamma'] })).toThrow('可用收藏画师不足');
  expect(e).toEqual(before);
  e.pinnedArtists = ['fixed-outside'];
  const next = beginRollRound(e, ['alpha'], 1, { sampledOnly: true, preferredTags: ['alpha', 'fixed-outside'] });
  expect(next.candidates[0].tags.map(tag => tag.tag)).toEqual(['fixed-outside', 'alpha']);
  expect(next.rules.preferredOnly).toBe(true);
  expect(() => beginRollRound(e, ['alpha'], 1, { preferredTags: ['alpha'] })).toThrow('固定画师未收藏：fixed-outside');
});

it('来源计数与快照在保存边界校验，旧无来源记录继续合法', () => {
  const e = rollFixture();
  expect(() => validateRollExperiment(e)).not.toThrow();
  for (const count of [0, -1, 0.5, 2]) {
    expect(() => validateRollExperiment({ ...e, chainArtistSource: { chainIds: ['source'], artists: [{ tag: 'alpha', count }] } })).toThrow('风格串画师抽取来源无效');
  }
  expect(() => validateRollExperiment({ ...e, chainArtistSource: null })).toThrow('风格串画师抽取来源无效');
  expect(() => validateRollExperiment({ ...e, chainArtistSource: { chainIds: ['source', 'source'], artists: [] } })).toThrow('风格串画师抽取来源无效');
  expect(() => validateRollExperiment({ ...e, chainArtistSource: { chainIds: ['source'], artists: [{ tag: 'Ａlpha_Name(style)', count: 1 }, { tag: 'alpha name (style)', count: 1 }] } })).toThrow('风格串画师抽取来源无效');
  const valid = beginRollRound({ ...e, chainArtistSource: { chainIds: ['source'], artists: [{ tag: 'alpha', count: 1 }] }, pinnedArtists: [], rules: { ...e.rules, minArtists: 1, maxArtists: 1 } }, ['alpha'], 1);
  valid.rounds[0].snapshot!.chainArtistSource!.artists[0].count = 0;
  expect(() => validateRollExperiment(valid)).toThrow('风格串画师抽取来源无效');
});

it('提取模式用统一画师身份匹配旧覆盖、固定、样张、屏蔽和偏好，不重复抽别名', () => {
  const e = rollFixture(); e.pinnedArtists = []; e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  e.chainArtistSource = { chainIds: ['source'], artists: [{ tag: 'alpha (style)', count: 1 }, { tag: 'beta name', count: 1 }] };
  e.artists = [{ tag: 'alpha(style)', weight: 1, excluded: false, locked: false }];
  const next = beginRollRound(e, ['alpha(style)', 'ＢＥＴＡ＿ＮＡＭＥ'], 1, { sampledOnly: true });
  expect(next.candidates[0].tags.map(artist => artist.tag).sort()).toEqual(['alpha (style)', 'beta name']);
  expect(() => beginRollRound(e, [], 1, { blockedTags: ['alpha(style)'] })).toThrow('可用画师不足');
  e.artists[0].excluded = true;
  expect(() => beginRollRound(e, [], 1)).toThrow('可用画师不足');
  e.artists = []; e.pinnedArtists = ['Ａlpha(style)']; e.rules.preferredMinArtists = 1;
  expect(beginRollRound(e, [], 1, { preferredTags: ['alpha (style)'] }).candidates[0].tags.map(artist => artist.tag))
    .toEqual(['Ａlpha(style)', 'beta name']);
});

it.each([false, true])('源模式合并合法旧双别名时排除优先，与排列无关：反转=%s', reverse => {
  const e = rollFixture(); e.pinnedArtists = []; e.rules = { ...e.rules, minArtists: 1, maxArtists: 1 };
  e.artists = [
    { tag: 'Ａlpha', weight: 1, excluded: true, locked: false },
    { tag: 'alpha', weight: 2, excluded: false, locked: false },
  ];
  if (reverse) e.artists.reverse();
  e.chainArtistSource = { chainIds: ['source'], artists: [{ tag: 'alpha', count: 1 }, { tag: 'beta', count: 1 }] };
  expect(() => validateRollExperiment(e)).not.toThrow();
  expect(beginRollRound(e, ['alpha', 'beta'], 1).candidates[0].tags[0].tag).toBe('beta');
  e.chainArtistSource.artists = [{ tag: 'alpha', count: 1 }];
  expect(() => beginRollRound(e, ['alpha', 'beta'], 1)).toThrow('可用画师不足');
  e.pinnedArtists = ['alpha'];
  expect(() => beginRollRound(e, ['alpha', 'beta'], 1)).toThrow('固定画师不可用');
});

it('新一轮自动从完整目录建普通批次，存档只保留覆盖项', () => {
  const e = rollFixture(); e.artists = [];
  const next = beginRollRound(e, ['alpha', 'beta', 'gamma', 'delta', 'eta'], 4);
  expect(next.artists).toEqual([]); expect(next.candidates).toHaveLength(4);
  expect(currentRollRound(next)).toMatchObject({ candidateIds: next.candidates.map(candidate => candidate.id) });
  expect(() => validateRollExperiment(next)).not.toThrow();
  expect(e.candidates).toEqual([]); expect(e.rounds).toEqual([]);
});

it('未结束的普通批次也可再Roll，不改写已有候选和轮次', () => {
  const e = beginRollRound(rollFixture(), ['alpha', 'beta', 'gamma', 'delta', 'eta'], 4), before = structuredClone(e);
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 4);
  expect(next.candidates.slice(0, e.candidates.length)).toEqual(before.candidates);
  expect(next.rounds.slice(0, e.rounds.length)).toEqual(before.rounds);
  expect(next.rounds).toHaveLength(2); expect(currentRollRound(next)!.candidateIds).toHaveLength(4);
  expect(() => validateRollExperiment(next)).not.toThrow(); expect(e).toEqual(before);
});

it('无效轮次引用或缺失轮次列表不会被默认为合法记录', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('a')];
  e.rounds = [{ id: 'batch', candidateIds: ['missing'], createdAt: 1 }];
  expect(() => validateRollExperiment(e)).toThrow('画风轮次资料无效');
  expect(() => validateRollExperiment({ ...e, rounds: undefined })).toThrow('画风轮次资料无效');
});

it('新轮次只保存总人数、固定 Tag 与权重范围，不写模式且旧快照不变', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 2, maxArtists: 5 };
  e.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] };
  e.candidates = [candidateFixture('old')];
  e.rounds = [{ id: 'old-round', candidateIds: ['old'], createdAt: 1, snapshot: { rules: { ...e.rules }, mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] } }];
  const before = structuredClone(e);
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 2);
  expect(next.rules).toMatchObject({ minArtists: 2, maxArtists: 5 });
  expect(currentRollRound(next)!.snapshot).toEqual({ rules: next.rules, pinnedArtists: ['alpha', 'beta'] });
  expect(next.drawPlan).toBeUndefined();
  expect(next.rounds[0]).toEqual(before.rounds[0]); expect(e).toEqual(before);
  expect(() => validateRollExperiment(next)).not.toThrow();
});

it('样张过滤不会被历史覆盖项绕过，偏好不足时不创建候选', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 1, maxArtists: 1, preferredMinArtists: 1, preferredMultiplier: 3 };
  expect(() => beginRollRound(e, ['alpha'], 1, { sampledOnly: true, preferredTags: ['beta'] })).toThrow('可用偏好画师不足');
  const next = beginRollRound(e, ['alpha'], 1, { sampledOnly: true, preferredTags: ['alpha'] });
  expect(next.candidates[0].tags[0].tag).toBe('alpha');
  expect(next.rounds[0].snapshot?.rules).toMatchObject({ preferredMinArtists: 1, preferredMultiplier: 3 });
});

it('样张过滤仅限制随机补位，固定的无样张 Tag 仍参与且不足总人数时拒绝', () => {
  const e = rollFixture(); e.artists = []; e.pinnedArtists = ['no-sample'];
  e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  const next = beginRollRound(e, ['sampled'], 6, { sampledOnly: true });
  expect(next.candidates.every(candidate => candidate.tags.map(tag => tag.tag).join(',') === 'no-sample,sampled')).toBe(true);
  expect(currentRollRound(next)!.snapshot?.sampledOnly).toBe(true);
  expect(() => beginRollRound(e, [], 1, { sampledOnly: true })).toThrow('可用画师不足');
});
