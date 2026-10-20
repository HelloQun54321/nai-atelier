import { expect, it } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import { rollPendingCandidates, rollWorkspaceCandidates } from '../../services/styleRollWorkspace';

const fixture = () => {
  const e = rollFixture();
  e.candidates = [candidateFixture('old', 'old_artist'), { ...candidateFixture('saved', 'saved_artist'), savedChainId: 'chain' }, candidateFixture('pending'), { ...candidateFixture('trash'), archived: true }];
  e.rounds = [{ id: 'old-round', candidateIds: ['old'], createdAt: 1, closedAt: 2 }, { id: 'current', candidateIds: ['saved', 'pending'], createdAt: 3 }];
  return { e, images: new Map([['saved', rollImageFixture(e, e.candidates[1])]]) };
};
const view = { filter: 'all', roundId: '', query: '', sort: 'new' };

it('全部如实展示成图与待生成，编号、画师与轮次筛选一致，并按新旧排序', () => {
  const { e, images } = fixture();
  expect(rollWorkspaceCandidates(e, images, view).map(item => item.id)).toEqual(['pending', 'saved', 'old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, sort: 'old' }).map(item => item.id)).toEqual(['old', 'saved', 'pending']);
  expect(rollWorkspaceCandidates(e, images, { ...view, filter: 'archived' }).map(item => item.id)).toEqual(['trash']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: 'OLD artist' }).map(item => item.id)).toEqual(['old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '#2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '2' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'current', filter: 'saved' }).map(item => item.id)).toEqual(['saved']);
  expect(rollWorkspaceCandidates(e, images, { ...view, roundId: 'missing' })).toEqual([]);
});

it('补齐仅取当前未结束轮次，不混入历史缺图，关闭轮次后仍可手选生成', () => {
  const { e, images } = fixture();
  expect(rollPendingCandidates(e, images).map(item => item.id)).toEqual(['pending']);
  e.rounds[1].closedAt = 4;
  expect(rollPendingCandidates(e, images)).toEqual([]);
  expect(rollPendingCandidates(e, images, ['old']).map(item => item.id)).toEqual(['old']);
});

it('手选补图排除已出图和回收站项', () => {
  const { e, images } = fixture();
  expect(rollPendingCandidates(e, images, e.candidates.map(item => item.id)).map(item => item.id)).toEqual(['old', 'pending']);
});

it('候选搜索同时匹配画师中文名', () => {
  const { e, images } = fixture();
  const aliases = new Map([['old artist', '旧画师'], ['saved artist', '收藏画师']]);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '旧画师' }, aliases).map(item => item.id)).toEqual(['old']);
  expect(rollWorkspaceCandidates(e, images, { ...view, query: '收藏' }, aliases).map(item => item.id)).toEqual(['saved']);
});
