import { expect, it } from 'vitest';
import { getAgentContextUsage } from './agentContextUsage';
import type { PromptAgentModel, PromptAgentUsage } from './promptAgent';

const model = { id: 'test', provider: 'first', contextWindow: 10000 } as PromptAgentModel;
const usage = { input: 1000, cacheRead: 2000, cacheWrite: 500, output: 500, reasoning: 300, totalTokens: 4000 } as PromptAgentUsage;
const message = { role: 'agent', model: 'test', provider: 'first', usage };
it('使用最近一次完整用量而非历史累计，同名跨服务与当前模型隔离', () => {
  expect(getAgentContextUsage([{ ...message, usage: { ...usage, totalTokens: 9000 } }, message, { ...message, provider: 'second', usage: { ...usage, totalTokens: 1 } }], model)).toEqual({ used: 4000, limit: 10000 });
  expect(getAgentContextUsage([message], { ...model, provider: 'third' })).toBeUndefined();
});
it('缺失总量时包括缓存和输出，不重复计入推理 Token', () => {
  expect(getAgentContextUsage([{ ...message, usage: { ...usage, totalTokens: undefined } as unknown as PromptAgentUsage }], model)).toEqual({ used: 4000, limit: 10000 });
});
it('未知用量和无效窗口不伪装为零，实际零用量保留', () => {
  expect(getAgentContextUsage([], model)).toBeUndefined();
  expect(getAgentContextUsage([message], { ...model, contextWindow: 0 })).toBeUndefined();
  expect(getAgentContextUsage([{ ...message, usage: { ...usage, totalTokens: NaN, input: NaN } }], model)).toBeUndefined();
  expect(getAgentContextUsage([{ ...message, usage: { ...usage, totalTokens: 0 } }], model)).toEqual({ used: 0, limit: 10000 });
});
