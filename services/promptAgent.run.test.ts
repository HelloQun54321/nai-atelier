import { afterEach, expect, it, vi } from 'vitest';
import { promptAgentService } from './promptAgent';
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
