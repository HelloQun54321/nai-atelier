import { PromptAgentAction, PromptAgentDraft } from '../types';

export interface PromptAgentConfig {
  provider: string;
  model: string;
  imageInput: boolean;
  configured: boolean;
  configuredProviders: string[];
}

export interface PromptAgentProvider {
  id: string;
  name: string;
  authType: 'api_key';
  configured: boolean;
  current: boolean;
  modelCount: number;
}

export type PromptAgentAuthPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string; description?: string }> };

export interface PromptAgentLoginResult {
  complete: boolean;
  prompt?: PromptAgentAuthPrompt;
  promptIndex?: number;
  events?: Array<{ type: string; message?: string; links?: Array<{ url: string; label?: string }> }>;
}

export interface PromptAgentModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  imageInput: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null;
  current?: boolean;
}

export type PromptAgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string; isError: boolean }
  | { type: 'action'; action: PromptAgentAction }
  | { type: 'project_changed'; resource: string }
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
  getProviders: async (): Promise<PromptAgentProvider[]> => {
    const response = await fetch('/api/prompt-agent/providers', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  login: async (provider: string, answers: string[]): Promise<PromptAgentLoginResult> => {
    const response = await fetch('/api/prompt-agent/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, answers }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  logout: async (provider: string): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  getAvailableModels: async (): Promise<PromptAgentModel[]> => {
    const response = await fetch('/api/prompt-agent/available-models', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  selectModel: async (provider: string, model: string): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }) });
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
  executeProjectAction: async (action: { action: string; resourceId?: string; payload?: Record<string, unknown> }) => {
    const response = await fetch('/api/prompt-agent/project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
    if (!response.ok) return readError(response) as never;
    return response.json() as Promise<{ ok: boolean; action: string; resourceId?: string }>;
  },
  getSession: async (sessionId: string): Promise<Array<{ id: string; role: 'user' | 'agent'; text: string }>> => {
    const response = await fetch(`/api/prompt-agent/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  run: async (
    input: { sessionId: string; message: string; draft: PromptAgentDraft; context: { presets: unknown[]; vibes: unknown[]; clientSettings?: Record<string, unknown> } },
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
