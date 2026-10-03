import { promptAgentService, type PromptAgentEvent } from './promptAgent';
import type { PromptAgentDraft } from '../types';

type RunInput = Parameters<typeof promptAgentService.run>[0];
const active = new Map<string, Promise<void>>();
const composers = new Map<string, { text: string; attachments: Array<{ data: string; mimeType: string; name: string }> }>();

/** 标签页内统一持有任务，编辑器卸载不会关闭请求；电脑服务负责跨设备恢复。 */
export const promptAgentCoordinator = {
  running: (sessionId: string) => active.has(sessionId),
  run(input: RunInput, onEvent: (event: PromptAgentEvent) => void) {
    if (active.has(input.sessionId)) return Promise.reject(new Error('这个会话已有任务在执行'));
    const task = promptAgentService.run(input, onEvent).finally(() => { active.delete(input.sessionId); });
    active.set(input.sessionId, task);
    return task;
  },
  saveComposer(sessionId: string, text: string, attachments: Array<{ data: string; mimeType: string; name: string }>) {
    if (!sessionId) return;
    composers.set(sessionId, { text, attachments: attachments.slice(0, 4) });
    // 图片只留有限的标签页内缓存；文字承担浏览器草稿职责。
    while (composers.size > 8) composers.delete(composers.keys().next().value!);
    try { sessionStorage.setItem(`nai-agent-composer-${sessionId}`, text.slice(0, 8000)); } catch { /* 浏览器禁用存储或空间不足时继续保留内存草稿。 */ }
  },
  loadComposer(sessionId: string) {
    const saved = composers.get(sessionId); if (saved) return saved;
    let text = ''; try { text = sessionStorage.getItem(`nai-agent-composer-${sessionId}`) || ''; } catch { /* 浏览器存储不可用。 */ }
    return { text, attachments: [] };
  },
};

export const agentDraftFingerprint = (value: unknown) => {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
};

export const agentDraftFields = ['basePrompt', 'subjectPrompt', 'negativePrompt', 'modules', 'params'] as const;
export const agentDraftChangedFields = (current: PromptAgentDraft, proposed: PromptAgentDraft) => agentDraftFields.filter(field => JSON.stringify(current[field]) !== JSON.stringify(proposed[field]));
export const mergeAgentDraftFields = (current: PromptAgentDraft, proposed: PromptAgentDraft, fields: ReadonlyArray<typeof agentDraftFields[number]>): PromptAgentDraft => ({ ...current, ...Object.fromEntries(fields.map(field => [field, proposed[field]])) });
