// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { promptAgentCoordinator, agentDraftFingerprint } from './promptAgentCoordinator';
import { promptAgentService } from './promptAgent';
import type { PromptAgentDraft } from '../types';

it('统一任务持有，重复运行拒绝，结束归还任务', async () => {
  let release!: () => void;
  const mock = vi.spyOn(promptAgentService, 'run').mockImplementation(() => new Promise<undefined>(resolve => { release = () => resolve(undefined); }));
  const input = { sessionId: 's', message: 'test', draft: {} as PromptAgentDraft, context: {} };
  const task = promptAgentCoordinator.run(input, () => {});
  expect(promptAgentCoordinator.running('s')).toBe(true);
  await expect(promptAgentCoordinator.run(input, () => {})).rejects.toThrow('已有任务');
  release(); await task;
  expect(promptAgentCoordinator.running('s')).toBe(false);
  mock.mockRestore();
});
it('页面 RPC 由任务持有层执行，消息重复不重复操作，不依赖面板回调', async () => {
  document.body.innerHTML = '<main data-agent-view="history"><h1>最新作品</h1></main>';
  let release!: () => void;
  const callback = vi.fn();
  const control = vi.spyOn(promptAgentService, 'control').mockImplementation(async () => { release(); });
  const run = vi.spyOn(promptAgentService, 'run').mockImplementation(async (_input, onEvent) => {
    await new Promise<void>(resolve => {
      release = resolve;
      onEvent({ type: 'ui_request', requestId: 'request-page', operation: { action: 'read' } });
      onEvent({ type: 'ui_request', requestId: 'request-page', operation: { action: 'read' } });
    });
  });
  try {
    await promptAgentCoordinator.run({ sessionId: 'page-session', message: '在哪里', draft: {} as PromptAgentDraft, context: {} }, callback);
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledWith('page-session', 'ui_result', '', expect.objectContaining({ result: expect.objectContaining({ title: '生成历史' }) }));
    expect(callback).not.toHaveBeenCalled();
  } finally { run.mockRestore(); control.mockRestore(); document.body.innerHTML = ''; }
});
it('输入与图片按会话隔离，文字可以跨组件恢复', () => {
  promptAgentCoordinator.saveComposer('a', 'draft a', [{ data: 'image', mimeType: 'image/png', name: 'a.png' }]);
  promptAgentCoordinator.saveComposer('b', 'draft b', []);
  expect(promptAgentCoordinator.loadComposer('a').text).toBe('draft a');
  expect(promptAgentCoordinator.loadComposer('b').attachments).toEqual([]);
  expect(agentDraftFingerprint({ prompt: 'a' })).not.toBe(agentDraftFingerprint({ prompt: 'b' }));
});
it('浏览器禁用草稿存储仍能继续输入，不抛异常阻断界面', () => {
  const mock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
  expect(() => promptAgentCoordinator.saveComposer('quota', 'pending text', [])).not.toThrow();
  expect(promptAgentCoordinator.loadComposer('quota').text).toBe('pending text');
  mock.mockRestore();
});
