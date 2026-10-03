import { afterEach, expect, it, vi } from 'vitest';
import { formatModelOptionTitle, promptAgentService } from './promptAgent';

afterEach(() => vi.unstubAllGlobals());

it('同名模型展示时标注服务来源', () => {
  const models = [
    { id: 'deepseek-v4-flash', provider: 'deepseek', providerName: 'DeepSeek' },
    { id: 'deepseek/deepseek-v4-flash', provider: 'custom-1', providerName: 'command-goat' },
  ];
  expect(formatModelOptionTitle(models[0], models)).toBe('deepseek-v4-flash (DeepSeek)');
  expect(formatModelOptionTitle(models[1], models)).toBe('deepseek-v4-flash (command-goat)');
});

it('新会话和模型切换只发送原生会话参数，不再提供预设客户端', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 's', title: '新对话' }));
  vi.stubGlobal('fetch', fetch);
  await promptAgentService.createSession({ title: '创作' });
  await promptAgentService.updateSession('s', { model: 'a', thinkingLevel: 'high' });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ title: '创作' });
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ model: 'a', thinkingLevel: 'high' });
  expect(Object.keys(promptAgentService).some(name => /Creative|Preset|Injection/.test(name))).toBe(false);
});
