import { PromptAgentAction, PromptAgentDraft } from '../types';

export interface PromptAgentConfig {
  provider: string;
  model: string;
  configuredProviders: string[];
  providers: Array<{ id: string; label: string }>;
}

export interface PromptAgentModel {
  id: string;
  name: string;
  reasoning: boolean;
  imageInput: boolean;
}

export type PromptAgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string; isError: boolean }
  | { type: 'action'; action: PromptAgentAction }
  | { type: 'done'; draft: PromptAgentDraft; message: string; provider: string; model: string }
  | { type: 'error'; error: string };

const readError = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.error || `请求失败 (${response.status})`);
};

export const promptAgentService = {
  getConfig: async (): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/config', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  saveConfig: async (input: { provider: string; model: string; apiKey?: string; clearApiKey?: boolean }): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  getModels: async (provider: string): Promise<PromptAgentModel[]> => {
    const response = await fetch(`/api/prompt-agent/models?provider=${encodeURIComponent(provider)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  resetSession: async (sessionId: string) => {
    const response = await fetch('/api/prompt-agent/session/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    if (!response.ok) return readError(response);
  },
  getSession: async (sessionId: string): Promise<Array<{ id: string; role: 'user' | 'agent'; text: string }>> => {
    const response = await fetch(`/api/prompt-agent/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  run: async (
    input: { sessionId: string; message: string; draft: PromptAgentDraft; context: { presets: unknown[]; vibes: unknown[] } },
    onEvent: (event: PromptAgentEvent) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetch('/api/prompt-agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
    if (!response.ok) return readError(response);
    if (!response.body) throw new Error('浏览器不支持 Agent 流式响应');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      if (done) break;
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer));
  },
};
