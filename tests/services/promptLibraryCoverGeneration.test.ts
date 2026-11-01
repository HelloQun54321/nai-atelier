// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { getDefaultPromptLibraryCoverTemplate } from '../../services/promptLibraryCoverTemplate';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({
  build: vi.fn(), begin: vi.fn(), apply: vi.fn(), supportsStream: true, publish: undefined as (() => void) | undefined,
}));
vi.mock('../../services/naiService', () => ({ buildGenerationJobDescriptor: mocks.build }));
vi.mock('../../services/generationSeries', () => ({
  beginGenerationSeries: mocks.begin,
  subscribeGenerationSeries: (listener: () => void) => { mocks.publish = listener; return () => {}; },
}));
vi.mock('../../services/promptLibraryCoverApi', () => ({ applyPromptLibraryCoverFromHistory: mocks.apply }));
vi.mock('../../services/naiModels', async original => ({
  ...await original<typeof import('../../services/naiModels')>(),
  getRuntimeNaiModelInfo: () => ({ supportsStreamedResponses: mocks.supportsStream }),
}));
vi.mock('../../services/naiRuntime', async original => ({
  ...await original<typeof import('../../services/naiRuntime')>(),
  getNaiRuntimeConfig: async () => undefined,
}));

const chain = {
  id: 'fragment-one', name: '柔光', type: 'preset', basePrompt: 'soft light', tags: [], params: {},
} as unknown as PromptChain;
const item = (id = 'history-one') => ({
  id, imageUrl: `/api/local-history/${id}/image`, prompt: 'soft light', negativePrompt: '',
  params: { ...getDefaultPromptLibraryCoverTemplate().params, seed: 123 }, createdAt: 100,
});
const session = (id = 'history-one') => ({
  scope: '', key: 'synthetic-key', state: 'succeeded', historyIds: [id], lastSavedItem: item(id),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.supportsStream = true;
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  mocks.build.mockImplementation(async input => ({ ...input, history: input.history }));
  mocks.begin.mockImplementation(() => ({ session: session(), settle: Promise.resolve({ success: true, outcome: 'succeeded' }) }));
  mocks.apply.mockResolvedValue('/api/assets/cover.png');
});

it('无正文时不创建描述符或费用任务', async () => {
  const service = await import('../../services/promptLibraryCoverGeneration');
  await expect(service.beginPromptLibraryCoverGeneration(
    { ...chain, basePrompt: '' }, getDefaultPromptLibraryCoverTemplate(), 'synthetic-key', 0, false,
  )).rejects.toThrow('还没有正文');
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('开单张任务并按封面 marker 写回 previewImage，不再次上传', async () => {
  const service = await import('../../services/promptLibraryCoverGeneration');
  const template = getDefaultPromptLibraryCoverTemplate();
  await service.beginPromptLibraryCoverGeneration(chain, template, 'synthetic-key', 3, true);
  const input = mocks.build.mock.calls[0][0];
  expect(input).toMatchObject({
    operation: 'text-to-image', approvedCost: 3, forceEmptySeed: false, negative: template.negativePrompt,
  });
  expect(input.prompt).toContain('soft light');
  expect(input.history.sourceChainId).toBe('prompt-library-cover:fragment-one');
  const marker = input.history.modules[0];
  expect(marker).toMatchObject({ id: 'prompt-library-cover-target:fragment-one', name: '提示词库封面', isActive: false });
  expect(JSON.parse(marker.content)).toEqual({ chainId: 'fragment-one' });
  expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ count: 1, key: 'synthetic-key', agent: false }));
  expect(mocks.apply).toHaveBeenCalledWith('fragment-one', 'history-one');
  expect(service.getPromptLibraryCoverGeneration('fragment-one')).toMatchObject({
    phase: 'saved', previewImage: '/api/assets/cover.png',
  });
});

it('再次生成只令本次描述符使用新随机 Seed，模板保持不变', async () => {
  const service = await import('../../services/promptLibraryCoverGeneration');
  const template = getDefaultPromptLibraryCoverTemplate();
  await service.beginPromptLibraryCoverGeneration(chain, template, 'synthetic-key', 0, false, true);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
    forceEmptySeed: true, params: { ...template.params, seed: 0 },
  }));
  expect(template.params.seed).toBe(0);
});

it('写封面失败可只重试 apply，不重发生成', async () => {
  const service = await import('../../services/promptLibraryCoverGeneration');
  mocks.apply.mockRejectedValueOnce(new Error('封面写入失败')).mockResolvedValueOnce('/api/assets/retry.png');
  await service.beginPromptLibraryCoverGeneration(chain, getDefaultPromptLibraryCoverTemplate(), 'synthetic-key', 0, false);
  expect(service.getPromptLibraryCoverGeneration('fragment-one')).toMatchObject({ phase: 'save_failed' });
  await service.retryPromptLibraryCoverSave('fragment-one');
  expect(mocks.begin).toHaveBeenCalledOnce();
  expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(service.getPromptLibraryCoverGeneration('fragment-one')).toMatchObject({
    phase: 'saved', previewImage: '/api/assets/retry.png',
  });
});
