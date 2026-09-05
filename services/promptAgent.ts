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
  /** 可读来源名（如 command-goat / bukun / deepseek），供列表展示；provider 仍为内部 id。 */
  providerName?: string;
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
  /** Name of the bound preset (破限提示词预设) that was active when the session was created. */
  presetName?: string;
  /** Revision hash of the bound preset at session creation time. */
  presetRevisionHash?: string;
  /** Policy fingerprint of the session-bound preset (effective when bound). */
  effectivePolicyFingerprint?: string;
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

// ── 破限提示词与预设实验室（9 槽注入契约）────────────────────────────
// 9 个注入目标（target）固定、顺序稳定、跨组件一致，无旧键别名：
//   system_head / system_middle / system_tail —— 系统提示词三段（无 role）
//   context_head      —— 上下文头部帧（role: user|assistant，成对整体维护）
//   context_depth     —— 上下文窗口深度（严格数值 depth）
//   user_preamble     —— 用户消息前导帧
//   user_suffix       —— 用户消息尾部拦截元素
//   conversation_tail —— 会话尾部拦截（role 固定 user）
//   assistant_prefill —— assistant 预填（role 固定 assistant）
// 预设正文统一为 slots: PromptAgentInjectionItem[]。

export type PromptAgentLabTarget =
  | 'system_head'
  | 'system_middle'
  | 'system_tail'
  | 'context_head'
  | 'context_depth'
  | 'user_preamble'
  | 'user_suffix'
  | 'conversation_tail'
  | 'assistant_prefill';

/** 注入项基底：id / name / target / enabled / content；槽位专用字段见下。 */
export interface PromptAgentInjectionItem {
  id: string;
  name: string;
  target: PromptAgentLabTarget;
  enabled: boolean;
  content: string;
  /** context_head：user | assistant（同一对话帧成对出现，整体增删）；conversation_tail 固定 'user'；assistant_prefill 固定 'assistant'；系统/用户槽位无 role。 */
  role?: 'user' | 'assistant';
  /** context_depth：上下文窗口深度（严格数值）。 */
  depth?: number;
  /** context_head 成对分组键：同一对 user+assistant 共享同一 pairId，增删整体进行；无 pairId 时按相邻反 role 回退配对。 */
  pairId?: string;
}

export interface PromptAgentCreativePreset {
  id: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
  slots: PromptAgentInjectionItem[];
}

export interface PromptAgentCreativePresetState {
  items: PromptAgentCreativePreset[];
  activeCreativePresetId?: string;
  warnings?: string[];
}

/** 预设修订快照：一次保存记录一份完整 slots 版本。 */
export interface PromptAgentCreativePresetRevision {
  presetId: string;
  presetName: string;
  revisionHash: string;
  version: number;
  createdAt: number;
  slots: PromptAgentInjectionItem[];
}

export interface PromptAgentCreativePresetDetail extends PromptAgentCreativePreset {
  revisions: PromptAgentCreativePresetRevision[];
}

export type PromptAgentMessageContentPart = { type: string; text?: string; [key: string]: unknown };

/** 规范化上下文估算（Inspector）输出：完整规范化数据，而非仅数字。 */
export interface PromptAgentCreativeInspectResult {
  ok: boolean;
  message?: string;
  /** 拼装完成的完整系统提示词（9 槽注入后）。 */
  systemPrompt?: string;
  /** 规范化后的标准消息序列（role/content，含注入的 head/tail/prefill 帧）。 */
  canonicalMessages?: Array<{ role: 'user' | 'assistant'; content: string | PromptAgentMessageContentPart[]; injected?: boolean }>;
  /** 来源片段：每个注入项/历史段在拼装中的归属，便于溯源。 */
  sourceSegments?: Array<{
    label: string;
    target?: PromptAgentLabTarget;
    presetId?: string;
    presetName?: string;
    characterCount: number;
  }>;
  /** 令牌估算（服务端粒度）。 */
  tokenEstimate?: {
    policyTokens: number;
    draftTokens: number;
    historyTokens: number;
    presetTokens: number;
    totalTokens: number;
    contextWindow: number;
    contextDepth: number;
    projectedBuffer: number;
  };
  warnings?: string[];
  /** 本次估算输入/输出相关哈希（policy 指纹、拼装哈希等）。 */
  hashes?: {
    policyFingerprint?: string;
    presetRevisionHash?: string;
    systemPromptHash?: string;
  };
  /** 服务端上下文预算明细。 */
  budget?: {
    contextWindow: number;
    outputReserve: number;
    protocolReserve: number;
    conversationTokenBudget: number;
    storedConversation: Array<{ role: 'user' | 'assistant'; content: string | PromptAgentMessageContentPart[]; injected?: boolean }>;
  };
}

export interface PromptAgentImportResult {
  ok: boolean;
  imported: number;
  skipped: string[];
  activeCreativePresetId?: string;
}

const readError = async (response: Response) => {
  throw await parseErrorResponse(response);
};

/** 显示用模型名：剥掉 id 里的「厂商/」前缀（如 deepseek/deepseek-v4-flash → deepseek-v4-flash）。
 *  仅用于界面展示；请求与选择仍用完整 model.id（中转站要求完整 id）。 */
export const displayModelName = (modelId: string | undefined | null): string => {
  if (!modelId) return '';
  const slash = modelId.indexOf('/');
  return slash > 0 && slash < modelId.length - 1 ? modelId.slice(slash + 1) : modelId;
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

  // ── 破限提示词与预设实验室（9 槽注入契约）────────────────────────
  getCreativePresets: async (): Promise<PromptAgentCreativePresetState> => {
    const response = await fetch('/api/prompt-agent/creative-presets', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  createCreativePreset: async (input: { name: string; description?: string; forkFromId?: string; slots?: PromptAgentInjectionItem[] }): Promise<PromptAgentCreativePreset> => {
    const response = await fetch('/api/prompt-agent/creative-presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  updateCreativePreset: async (presetId: string, patch: { name?: string; slots?: PromptAgentInjectionItem[]; description?: string }): Promise<PromptAgentCreativePreset> => {
    const response = await fetch(`/api/prompt-agent/creative-presets/${encodeURIComponent(presetId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  deleteCreativePreset: async (presetId: string): Promise<{ ok: boolean }> => {
    const response = await fetch(`/api/prompt-agent/creative-presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  setActiveCreativePreset: async (presetId: string | null): Promise<PromptAgentCreativePresetState> => {
    const response = await fetch('/api/prompt-agent/creative-presets/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: presetId }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  getCreativePresetDetail: async (presetId: string): Promise<PromptAgentCreativePresetDetail> => {
    const response = await fetch(`/api/prompt-agent/creative-presets/${encodeURIComponent(presetId)}?detail=1`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  importCreativePresets: async (input: { schema: string; version: number; presets: PromptAgentCreativePreset[] }): Promise<PromptAgentImportResult> => {
    const response = await fetch('/api/prompt-agent/creative-presets/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  exportCreativePresets: async (presetIds: string[] = []): Promise<{ schema: string; version: number; exportedAt: number; presets: PromptAgentCreativePreset[] }> => {
    const query = presetIds.length ? `?${presetIds.map(id => `ids=${encodeURIComponent(id)}`).join('&')}` : '';
    const response = await fetch(`/api/prompt-agent/creative-presets/export${query}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  inspectCreativeContext: async (input: { sessionId?: string; draft: PromptAgentDraft; message?: string; clientSettings?: Record<string, unknown>; presetId?: string }): Promise<PromptAgentCreativeInspectResult> => {
    const response = await fetch('/api/prompt-agent/creative-presets/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
};
