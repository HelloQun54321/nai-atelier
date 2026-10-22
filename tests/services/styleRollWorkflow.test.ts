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

it('新轮次只保存总人数、固定 Tag 与权重范围，不写模式且旧快照不变', () => {
  const e = rollFixture(); e.rules = { ...e.rules, minArtists: 2, maxArtists: 5 };
  e.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] };
  e.candidates = [candidateFixture('old')];
  e.rounds = [{ id: 'old-round', candidateIds: ['old'], createdAt: 1, snapshot: { rules: { ...e.rules }, mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] } }];
  const before = structuredClone(e);
  const next = beginRollRound(e, e.artists.map(artist => artist.tag), 2);
  expect(next.rules).toMatchObject({ minArtists: 5, maxArtists: 5 });
  expect(currentRollRound(next)!.snapshot).toEqual({ rules: next.rules, pinnedArtists: ['alpha', 'beta'] });
  expect(next.drawPlan).toBeUndefined();
  expect(next.rounds[0]).toEqual(before.rounds[0]); expect(e).toEqual(before);
  expect(() => validateRollExperiment(next)).not.toThrow();
});

it('样张过滤仅限制随机补位，固定的无样张 Tag 仍参与且不足总人数时拒绝', () => {
  const e = rollFixture(); e.artists = []; e.pinnedArtists = ['no-sample'];
  e.rules = { ...e.rules, minArtists: 2, maxArtists: 2 };
  const next = beginRollRound(e, ['sampled'], 6, { sampledOnly: true });
  expect(next.candidates.every(candidate => candidate.tags.map(tag => tag.tag).join(',') === 'no-sample,sampled')).toBe(true);
  expect(currentRollRound(next)!.snapshot?.sampledOnly).toBe(true);
  expect(() => beginRollRound(e, [], 1, { sampledOnly: true })).toThrow('可用画师不足');
});
