import { PromptAgentAction, PromptAgentDraft } from '../types';
import { parseErrorResponse } from './api';

export interface PromptAgentConfig {
  provider: string;
  model: string;
  imageInput: boolean;
  visionProvider: string;
  visionModel: string;
  visionAvailable: boolean;
  visionDedicated: boolean;
  visionMode: 'auto' | 'manual';
  configured: boolean;
  configuredProviders: string[];
  policyVersion: string;
  policyFingerprint: string;
  creativeMode: boolean;
  runtimeStartedAt: number;
  credentialWarning?: string;
}

export interface PromptAgentProvider {
  id: string;
  name: string;
  authType: 'api_key' | 'oauth';
  authTypes: Array<'api_key' | 'oauth'>;
  configured: boolean;
  current: boolean;
  modelCount: number;
  custom?: boolean;
  baseUrl?: string;
  api?: PromptAgentCustomApi;
}

export type PromptAgentCustomApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface PromptAgentCustomModel {
  id: string;
  name?: string;
  reasoning: boolean;
  imageInput: boolean;
  contextWindow: number;
  maxTokens: number;
  capabilityDetection?: {
    imageInput: 'metadata' | 'pi_catalog' | 'model_name' | 'unknown' | 'manual';
    reasoning: 'metadata' | 'pi_catalog' | 'model_name' | 'unknown' | 'manual';
  };
}
export interface PromptAgentCustomProvider {
  id?: string;
  name: string;
  baseUrl: string;
  api: PromptAgentCustomApi;
  apiKey?: string;
  headers?: Record<string, string>;
  configured?: boolean;
  models: PromptAgentCustomModel[];
}

export type PromptAgentAuthPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string; description?: string }> };

export interface PromptAgentLoginResult {
  complete: boolean;
  prompt?: PromptAgentAuthPrompt;
  promptIndex?: number;
  flowId?: string;
  events?: Array<{ type: string; message?: string; instructions?: string; url?: string; verificationUri?: string; userCode?: string; links?: Array<{ url: string; label?: string }> }>;
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
  /** Exact levels supported by this model according to Pi's model metadata. */
  thinkingLevels: PromptAgentThinkingLevel[];
  current?: boolean;
  currentVision?: boolean;
}

export type PromptAgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface PromptAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  thinkingLevel: PromptAgentThinkingLevel;
  creativeMode: boolean;
  visionProvider: string;
  visionModel: string;
  visionAvailable: boolean;
  visionDedicated: boolean;
  visionMode: 'auto' | 'manual';
  creativeModeLocked?: boolean;
  policyFingerprint?: string;
  messageCount?: number;
  running?: boolean;
  taskStatus?: 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';
}

export interface PromptAgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface PromptAgentVisionUsage {
  provider: string;
  model: string;
  imageCount: number;
  usage?: PromptAgentUsage;
}

export interface PromptAgentHistoryMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  model?: string;
  provider?: string;
  usage?: PromptAgentUsage;
  visionUsage?: PromptAgentVisionUsage[];
  stopReason?: string;
  timestamp?: number;
  thinking?: string;
  tools?: Array<{ id: string; name: string; args?: unknown; result?: unknown; state: 'running' | 'done' | 'error' }>;
}

export type PromptAgentEvent =
  | { type: 'response_start'; id: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'response_end'; model: string; provider: string; usage: PromptAgentUsage; stopReason: string; timestamp: number }
  | { type: 'vision_usage'; model: string; provider: string; imageCount: number; usage?: PromptAgentUsage }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result?: unknown }
  | { type: 'queue'; action: 'steer' | 'followUp'; message: string }
  | { type: 'action'; action: PromptAgentAction; draft?: PromptAgentDraft }
  | { type: 'project_changed'; resource: string }
  | { type: 'done'; draft: PromptAgentDraft; message: string; provider: string; model: string }
  | { type: 'error'; error: string };

const readError = async (response: Response) => {
  throw await parseErrorResponse(response);
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
  getCustomProviders: async (): Promise<PromptAgentCustomProvider[]> => {
    const response = await fetch('/api/prompt-agent/custom-providers', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  saveCustomProvider: async (input: PromptAgentCustomProvider) => {
    const response = await fetch('/api/prompt-agent/custom-providers', { method: input.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  testCustomProvider: async (input: PromptAgentCustomProvider): Promise<{ ok: boolean; message: string }> => {
    const response = await fetch('/api/prompt-agent/custom-providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  fetchCustomProviderModels: async (input: PromptAgentCustomProvider): Promise<{ ok: boolean; models: PromptAgentCustomModel[] }> => {
    const response = await fetch('/api/prompt-agent/custom-providers/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  deleteCustomProvider: async (id: string): Promise<PromptAgentConfig> => {
    const response = await fetch(`/api/prompt-agent/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  login: async (provider: string, answers: string[], authType?: 'api_key' | 'oauth', flowId?: string): Promise<PromptAgentLoginResult> => {
    const response = await fetch('/api/prompt-agent/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, answers, authType, flowId }) });
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
  selectVisionModel: async (provider: string, model: string): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/vision-selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  selectVisionAuto: async (): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/vision-selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto' }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  listSessions: async (): Promise<PromptAgentSession[]> => {
    const response = await fetch('/api/prompt-agent/sessions', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  createSession: async (input: { title?: string; creativeMode?: boolean } = {}): Promise<PromptAgentSession> => {
    const response = await fetch('/api/prompt-agent/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  updateSession: async (sessionId: string, patch: Partial<Pick<PromptAgentSession, 'title' | 'provider' | 'model' | 'thinkingLevel' | 'creativeMode'>>): Promise<PromptAgentSession> => {
    const response = await fetch(`/api/prompt-agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  deleteSession: async (sessionId: string) => {
    const response = await fetch(`/api/prompt-agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (!response.ok) return readError(response);
  },
  control: async (sessionId: string, action: 'steer' | 'followUp' | 'abort' | 'clear' | 'confirm' | 'finalize', message?: string, payload?: Record<string, unknown>) => {
    const response = await fetch('/api/prompt-agent/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, action, message, ...(payload || {}) }) });
    if (!response.ok) return readError(response);
  },
  resetSession: async (sessionId: string) => {
    const response = await fetch('/api/prompt-agent/session/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    if (!response.ok) return readError(response);
  },
  reviseMessage: async (sessionId: string, messageId: string, content: string): Promise<PromptAgentHistoryMessage[]> => {
    const response = await fetch('/api/prompt-agent/session/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, messageId, content }) });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  executeProjectAction: async (action: { action: string; resourceId?: string; payload?: Record<string, unknown>; sessionId?: string; confirmationRequestId?: string }) => {
    const response = await fetch('/api/prompt-agent/project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
    if (!response.ok) return readError(response) as never;
    return response.json() as Promise<{ ok: boolean; action: string; resourceId?: string }>;
  },
  getSession: async (sessionId: string): Promise<PromptAgentHistoryMessage[]> => {
    const response = await fetch(`/api/prompt-agent/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  getTask: async (sessionId: string): Promise<{ status?: string; events?: PromptAgentEvent[] }> => {
    const response = await fetch(`/api/prompt-agent/task?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  getAuditLog: async (sessionId: string): Promise<Record<string, unknown>> => {
    const response = await fetch(`/api/prompt-agent/log?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  run: async (
    input: { sessionId: string; message: string; mode?: 'prompt' | 'retry'; images?: Array<{ data: string; mimeType: string }>; draft: PromptAgentDraft; context: { clientSettings?: Record<string, unknown> }; apiKey?: string },
    onEvent: (event: PromptAgentEvent) => void,
    signal?: AbortSignal,
  ) => {
    const { apiKey, ...payload } = input;
    const response = await fetch('/api/prompt-agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(payload),
      signal,
    });
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
      for (const line of lines) {
        if (!line.trim()) continue;
        // 逐行容错：单行坏 JSON 只跳过该行，不能因此中断整个 Agent 会话。
        try {
          onEvent(JSON.parse(line));
        } catch {
          console.warn('[promptAgent] 跳过无法解析的事件行', line.slice(0, 200));
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer));
      } catch {
        console.warn('[promptAgent] 跳过无法解析的尾部事件行', buffer.slice(0, 200));
      }
    }
  },
};
