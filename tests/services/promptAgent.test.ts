import { afterEach, expect, it, vi } from 'vitest';
import { formatModelOptionTitle, promptAgentService } from '../../services/promptAgent';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

it.each(['请求未响应', '响应正文未读完'])('会话设置保存%s时超时退出，而不是一直占用发送状态', async phase => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const stalled = () => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    return phase === '请求未响应' ? stalled() : Promise.resolve({ ok: true, json: stalled });
  }));
  const result = promptAgentService.updateSession('s', { thinkingLevel: 'high' });
  const rejected = expect(result).rejects.toThrow('设置保存超时，请检查本地服务是否响应后重试');
  await vi.advanceTimersByTimeAsync(15_000); await rejected; expect(vi.getTimerCount()).toBe(0);
});

it('会话设置正常保存或接口报错后清理超时，保留原始错误原因', async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: 's', thinkingLevel: 'high' })).mockResolvedValueOnce(Response.json({ error: '会话正在运行' }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  expect(await promptAgentService.updateSession('s', { thinkingLevel: 'high' })).toMatchObject({ thinkingLevel: 'high' }); expect(vi.getTimerCount()).toBe(0);
  await expect(promptAgentService.updateSession('s', { model: 'other' })).rejects.toThrow('会话正在运行'); expect(vi.getTimerCount()).toBe(0);
});
