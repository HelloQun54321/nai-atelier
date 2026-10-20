import { expect, it } from 'vitest';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
import { validateRollExperiment } from '../../services/styleRoll';
import { beginRollRound, currentRollRound } from '../../services/styleRollWorkflow';

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

it('新轮次保存抽取条件快照，固定画师与固定权重都能回看', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  const plan = { mode: 'pinnedArtists' as const, pinnedArtists: ['alpha', 'beta'] };
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 2, { plan });
  expect(currentRollRound(next)!.snapshot).toEqual({ rules: expect.objectContaining({ minArtists: 2, maxArtists: 2 }), mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] });
  expect(() => validateRollExperiment(next)).not.toThrow();
  const fixed = beginRollRound({ ...e, rules: { ...e.rules, minWeight: 1.2, maxWeight: 1.2 } }, e.artists.map(artist => artist.tag), 2, { plan: { mode: 'fixedWeight' } });
  expect(currentRollRound(fixed)!.snapshot).toMatchObject({ mode: 'fixedWeight', rules: { minWeight: 1.2, maxWeight: 1.2 } });
});
