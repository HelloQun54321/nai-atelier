// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';
const mocks = vi.hoisted(() => ({ build: vi.fn(), begin: vi.fn() }));
vi.mock('../../services/naiService', () => ({ buildGenerationJobDescriptor: mocks.build }));
vi.mock('../../services/generationSeries', () => ({ beginGenerationSeries: mocks.begin }));
import { beginRollGeneration } from '../../services/styleRollGeneration';
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('nai_api_key', 'synthetic-key'); mocks.build.mockImplementation(async input => ({ history: input.history, randomSeed: input.forceEmptySeed })); });

it('只向现有后台任务提交一张，保留固定 Seed、成本授权和可恢复候选来源', async () => {
  const e = rollFixture(), candidate = candidateFixture('c'); await beginRollGeneration(e, candidate, 'synthetic-key', 3, true);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ operation: 'text-to-image', forceEmptySeed: false, params: expect.objectContaining({ seed: 0 }), approvedCost: 3 }));
  expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ scope: 'style-roll:synthetic-experiment', count: 1, agent: false, descriptor: expect.objectContaining({ history: expect.objectContaining({ sourceChainId: 'style-roll:synthetic-experiment', modules: [expect.objectContaining({ id: 'style-roll:c', isActive: false })] }) }) }));
});
it('准备期间切 Key 不将旧配置或旧授权投递到新 Key', async () => {
  mocks.build.mockImplementation(async () => { sessionStorage.setItem('nai_api_key', 'different-key'); return {}; });
  await expect(beginRollGeneration(rollFixture(), candidateFixture('c'), 'synthetic-key', 0, false)).rejects.toThrow('Key 已变化');
  expect(mocks.begin).not.toHaveBeenCalled();
});
it('一轮多配方一次提交，各张保留自己的画师、历史来源和公共固定Seed', async () => {
  const e = rollFixture(), first = candidateFixture('a', 'alpha'), second = candidateFixture('b', 'beta');
  await beginRollGeneration(e, [first, second], 'synthetic-key', 4, false);
  expect(mocks.build).toHaveBeenNthCalledWith(2, expect.objectContaining({ prompt: expect.stringContaining('artist:beta'), params: expect.objectContaining({ seed: 0 }) }));
  expect(mocks.begin).toHaveBeenCalledOnce(); expect(mocks.begin.mock.calls[0][0]).toEqual(expect.objectContaining({ count: 2, descriptor: expect.objectContaining({ sequence: [expect.objectContaining({ history: expect.objectContaining({ modules: [expect.objectContaining({ id: 'style-roll:a' })] }) }), expect.objectContaining({ history: expect.objectContaining({ modules: [expect.objectContaining({ id: 'style-roll:b' })] }) })] }) }));
});

it('强制置空种子时按随机 Seed 提交，不改写模板与记录', async () => {
  const e = rollFixture(), candidate = candidateFixture('c');
  await beginRollGeneration(e, candidate, 'synthetic-key', 3, false, undefined, true);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ forceEmptySeed: true, params: expect.objectContaining({ seed: 0 }) }));
  expect(e.template.params.seed).toBe(0);
});
