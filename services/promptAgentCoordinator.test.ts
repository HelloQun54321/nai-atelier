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
it('输入与图片按会话隔离，文字可以跨组件恢复', () => {
  promptAgentCoordinator.saveComposer('a', 'draft a', [{ data: 'image', mimeType: 'image/png', name: 'a.png' }]);
  promptAgentCoordinator.saveComposer('b', 'draft b', []);
  expect(promptAgentCoordinator.loadComposer('a').text).toBe('draft a');
  expect(promptAgentCoordinator.loadComposer('b').attachments).toEqual([]);
  expect(agentDraftFingerprint({ prompt: 'a' })).not.toBe(agentDraftFingerprint({ prompt: 'b' }));
});
