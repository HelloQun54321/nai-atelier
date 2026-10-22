// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), getBrowseOrder: vi.fn(), getPage: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('../../services/localHistory', () => ({ localHistory: mocks }));
import { loadRollExperiments, loadRollHistory, rollCandidateImages, saveRollExperiment, saveRollBlocklist, ROLL_BLOCKLIST_CHANGED } from '../../services/styleRollApi';
beforeEach(() => vi.clearAllMocks());

it('全局屏蔽只在保存成功并校验回执后通知画师库和 Roll', async () => {
  const changed = vi.fn(); window.addEventListener(ROLL_BLOCKLIST_CHANGED, changed);
  try {
    mocks.put.mockRejectedValueOnce(new Error('合成失败'));
    await expect(saveRollBlocklist(['alpha'])).rejects.toThrow('合成失败'); expect(changed).not.toHaveBeenCalled();
    mocks.put.mockResolvedValueOnce({ tags: ['alpha'] });
    await saveRollBlocklist(['alpha']); expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0][0].detail).toEqual(['alpha']);
  } finally { window.removeEventListener(ROLL_BLOCKLIST_CHANGED, changed); }
});

it('只从匹配实验、候选、提示词和 Seed 的历史读取图片，固定首次匹配结果', () => {
  const e = rollFixture(); e.candidates = [candidateFixture('a'), candidateFixture('b')];
  const first = rollImageFixture(e, e.candidates[0]), late = { ...first, id: 'later', createdAt: 2 };
  const wrongSeed = { ...rollImageFixture(e, e.candidates[1]), params: { ...e.template.params, seed: 9 } };
  const wrongPrompt = { ...rollImageFixture(e, e.candidates[1]), prompt: 'something else' };
  expect([...rollCandidateImages(e, [late, wrongSeed, wrongPrompt, first]).values()]).toEqual([first]);
  expect(rollCandidateImages(e, [{ ...first, sourceChainId: 'other' }]).size).toBe(0);
});
it('读取全部候选历史时复用轻量索引分页，超过旧入口 200 张上限仍能完整恢复', async () => {
  const ids = Array.from({ length: 240 }, (_, index) => `image-${index}`); mocks.getBrowseOrder.mockResolvedValue({ ids });
  mocks.getPage.mockImplementation(async (page: number, size: number) => ({ items: ids.slice(page * size, (page + 1) * size).map(id => ({ id })) }));
  expect(await loadRollHistory('e')).toHaveLength(240); expect(mocks.getPage).toHaveBeenCalledTimes(3);
  expect(mocks.getBrowseOrder).toHaveBeenCalledWith({ source: 'style-roll:e', sort: 'oldest' });
});
it('坏响应不转为空实验，保存失败直接交给页面保留原状态', async () => {
  mocks.get.mockResolvedValue({ experiments: [null] }); await expect(loadRollExperiments()).rejects.toThrow();
  mocks.put.mockRejectedValue(new Error('冲突')); await expect(saveRollExperiment(rollFixture())).rejects.toThrow('冲突');
});

it('普通记录完整读取保存，风格串关联与轮次不丢失', async () => {
  const e = rollFixture(); e.candidates = [{ ...candidateFixture('a'), savedChainId: 'kept-chain' }];
  e.rounds = [{ id: 'batch', candidateIds: ['a'], createdAt: 1 }];
  mocks.get.mockResolvedValue({ experiments: [e] });
  expect(await loadRollExperiments()).toEqual([e]);
  mocks.put.mockResolvedValue({ experiment: { ...e, revision: e.revision + 1 } });
  const saved = await saveRollExperiment(e);
  expect(mocks.put).toHaveBeenCalledWith('/style-roll', e);
  expect(saved.candidates).toEqual(e.candidates); expect(saved.rounds).toEqual(e.rounds);
});
