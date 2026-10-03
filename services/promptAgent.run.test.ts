import { afterEach, expect, it, vi } from 'vitest';
import { promptAgentService, agentRuntimeWarning } from './promptAgent';
import type { PromptAgentConfig } from './promptAgent';
import type { PromptAgentDraft } from '../types';

afterEach(() => vi.unstubAllGlobals());
const input = { sessionId: 'test', message: 'hello', draft: {} as PromptAgentDraft, context: {} };
const stream = (lines: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(lines)));

it('业务回调异常正常传播', async () => {
  stream('{"type":"text_delta","delta":"a"}\n{"type":"done"}\n');
  await expect(promptAgentService.run(input, () => { throw new Error('callback failed'); })).rejects.toThrow('callback failed');
});
it('服务端错误与缺少终态都不冒充成功', async () => {
  stream('{"type":"error","error":"provider failed"}\n');
  await expect(promptAgentService.run(input, () => {})).rejects.toThrow('provider failed');
  stream('{"type":"text_delta","delta":"a"}\n');
  await expect(promptAgentService.run(input, () => {})).rejects.toThrow('连接中断');
});
it('仅跳过坏 JSON，正确分发尾部完成事件', async () => {
  stream('bad json\n{"type":"text_delta","delta":"a"}\n{"type":"done"}');
  const callback = vi.fn();
  await promptAgentService.run(input, callback);
  expect(callback.mock.calls.map(([event]) => event.type)).toEqual(['text_delta', 'done']);
});

it('本地图片携带当前 Key，外部地址不会收到凭据', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => 'synthetic-key' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }))));
  const path = '/api/prompt-agent/local-image?sessionId=s&id=' + 'a'.repeat(32);
  await promptAgentService.getLocalImage(path);
  expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-key' }, cache: 'no-store' }));
  await expect(promptAgentService.getLocalImage('https://example.com/image')).rejects.toThrow('引用无效');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('后端旧版本、未重启与已同步状态有准确提示', () => {
  const config = { backendVersion: 'synthetic-version' } as PromptAgentConfig;
  expect(agentRuntimeWarning(config, 'synthetic-version')).toBe('');
  expect(agentRuntimeWarning({ ...config, restartRequired: true }, 'synthetic-version')).toContain('重启');
  expect(agentRuntimeWarning(config, 'next-version')).toContain('未同步');
  expect(agentRuntimeWarning({} as PromptAgentConfig, 'next-version')).toContain('旧版');
});
