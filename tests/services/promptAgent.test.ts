import { afterEach, expect, it, vi } from 'vitest';
import { formatModelOptionTitle, isAgentTaskRunning, promptAgentService } from '../../services/promptAgent';
import * as i18n from '../../services/i18n';
import type { PromptAgentDraft } from '../../types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('会话版本保存与完成只传提示词原稿及目标，不把图片Vibe和生成参数放入版本载荷', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'v', versionId: 'v', fingerprint: 'hash' })); vi.stubGlobal('fetch', fetch);
  const draft = { basePrompt: 'raw style', subjectPrompt: 'raw subject', negativePrompt: 'raw negative', modules: [], params: { width: 832, seed: 10, reference_image_multiple: ['private image bytes'], _promptSections: { scene: 'raw scene' } }, target: { chainId: 'target', mode: 'text-to-image', fingerprint: 'page' }, editContext: { baseImageAvailable: true } } as unknown as PromptAgentDraft;
  await promptAgentService.savePromptVersion('chat/one', { draft, afterDraft: draft, source: 'page', reason: 'before_apply' });
  await promptAgentService.finishPromptVersion('chat/one', 'v', draft);
  await promptAgentService.updateSession('chat/one', { promptChange: { id: 'change', status: 'applied', beforeVersionId: 'v', rawAfter: draft, selectedAfter: draft } });
  const bodies = fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string));
  expect(fetch.mock.calls[0][0]).toBe('/api/prompt-agent/sessions/chat%2Fone/prompt-versions');
  expect(fetch.mock.calls[1][0]).toBe('/api/prompt-agent/sessions/chat%2Fone/prompt-versions/v');
  for (const payload of [bodies[0].draft, bodies[0].afterDraft, bodies[1].afterDraft, bodies[2].promptChange.rawAfter, bodies[2].promptChange.selectedAfter]) {
    expect(payload).toMatchObject({ basePrompt: 'raw style', subjectPrompt: 'raw subject', params: { _promptSections: { scene: 'raw scene' } }, target: draft.target });
    expect(payload.editContext).toBeUndefined(); expect(payload.params.width).toBeUndefined(); expect(payload.params.reference_image_multiple).toBeUndefined();
  }
});

it('问答等待仍属运行态，回答使用独立控制动作且不伪造批准', async () => {
  expect(isAgentTaskRunning('waiting_user_input')).toBe(true);
  expect(isAgentTaskRunning('aborted')).toBe(false);
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
  const answer = { runId: 'run', requestId: 'question', answers: [{ questionId: 'style', customText: '自己的选择' }] };
  await promptAgentService.control('session', 'answer', undefined, answer);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ sessionId: 'session', action: 'answer', ...answer });
});

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
  expect(Object.keys(promptAgentService).filter(name => /Creative|Preset|Injection/.test(name)))
    .toEqual(['setCreativeDirect', 'setCreativeDirectRules']);
});

it('压缩上下文使用同一会话HTTP接口，编码会话ID且原样交付结果', async () => {
  const result = { compacted: true, context: { beforeTokens: 30000, afterTokens: 6000, retainedMessages: 8, contextWindow: 64000 } };
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(result)); vi.stubGlobal('fetch', fetch);
  vi.spyOn(i18n, 'getLanguage').mockReturnValue('ja');
  expect(await promptAgentService.compactSession('conversation/中文')).toEqual(result);
  expect(fetch).toHaveBeenCalledWith('/api/prompt-agent/sessions/conversation%2F%E4%B8%AD%E6%96%87/compact', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ language: 'ja' });
});

it('压缩接口失败保留后端原因，不把失败返回当成成功', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '会话正在运行，暂不能压缩' }, { status: 409 })));
  await expect(promptAgentService.compactSession('s')).rejects.toThrow('会话正在运行，暂不能压缩');
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
