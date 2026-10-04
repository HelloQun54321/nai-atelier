import { PromptAgentAction, PromptAgentDraft } from '../types';
import { parseErrorResponse } from './api';
import { isAgentImagePath } from './agentMedia';
import { agentConnectionEndpoint } from './agentConnection.mjs';
import { getAgentPageClientId, type AgentPageOperation } from './agentWorkspace';


const agentAuthHeaders = (): Record<string, string> => {
  const key = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '' : '';
  return key ? { Authorization: 'Bearer ' + key } : {};
};

export type AgentPermissionMode = 'read_only' | 'standard' | 'full';

export interface PromptAgentConfig {
  provider: string;
  model: string;
  imageInput: boolean;
  configured: boolean;
  configuredProviders: string[];
  policyVersion: string;
  policyFingerprint: string;
  runtimeStartedAt: number;
  backendVersion?: string;
  sourceVersion?: string;
  restartRequired?: boolean;
  permissionMode?: AgentPermissionMode;
  credentialWarning?: string;
}

export const agentRuntimeWarning = (config: PromptAgentConfig, frontendVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''): string => {
  if (!config.backendVersion) return '电脑上仍运行旧版 Agent 服务。再次打开启动器会复用旧进程；请关闭原服务窗口，再启动工坊。';
  if (config.restartRequired || config.sourceVersion && config.backendVersion !== config.sourceVersion) return `Agent 服务 ${config.backendVersion} 尚未加载最新代码。请关闭原服务窗口，再启动工坊；只刷新页面不会更新后端。`;
  if (frontendVersion && config.backendVersion !== frontendVersion) return `当前界面 ${frontendVersion} 与 Agent 服务 ${config.backendVersion} 未同步，请刷新页面以加载最新界面。`;
  return '';
};

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
export const previewPromptAgentEndpoint = (baseUrl: string, api: PromptAgentCustomApi): string => {
  try { return agentConnectionEndpoint(baseUrl, api); }
  catch { return ''; }
};
export interface PromptAgentCustomModel {
  id: string;
  name?: string;
  reasoning: boolean;
  imageInput: boolean;
  tools?: boolean;
  contextWindow: number;
  maxTokens: number;
  contextWindowSource?: PromptAgentThinkingSource;
  maxTokensSource?: PromptAgentThinkingSource;
  thinkingLevels?: PromptAgentThinkingLevel[];
  thinkingLevelMap?: Partial<Record<PromptAgentThinkingLevel, string | null>>;
  thinkingLevelsSource?: PromptAgentThinkingSource;
  thinkingMode?: 'adaptive' | 'budget';
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null;
  capabilityDetection?: {
    imageInput: 'metadata' | 'pi_catalog' | 'official_docs' | 'model_name' | 'unknown' | 'manual';
    reasoning: 'metadata' | 'pi_catalog' | 'official_docs' | 'model_name' | 'unknown' | 'manual';
    tools?: 'metadata' | 'pi_catalog' | 'official_docs' | 'unknown' | 'manual';
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
  select?: boolean;
  testModel?: string;
  testImage?: boolean;
}

export interface PromptAgentProbeResult {
  ok: boolean;
  message: string;
  model?: string;
  elapsedMs?: number;
  checks?: Record<string, string>;
  usage?: PromptAgentUsage[];
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
  tools?: boolean;
  capabilityDetection?: PromptAgentCustomModel['capabilityDetection'];
  contextWindow: number;
  maxTokens: number;
  /** 仅兼容旧配置，新接口不再提供价格。 */
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null;
  /** 接口声明、目录或人工设置的档位；兼容默认须单独标明。 */
  thinkingLevels: PromptAgentThinkingLevel[];
  thinkingLevelsSource?: PromptAgentThinkingSource;
  current?: boolean;
}

export type PromptAgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PromptAgentThinkingSource = 'metadata' | 'pi_catalog' | 'official_docs' | 'manual' | 'fallback';

/** 获取列表刷新已添加模型的能力，人工纠正优先，也不自动加入其他模型。 */
export const mergePromptAgentModelCapabilities = (current: PromptAgentCustomModel, discovered: PromptAgentCustomModel): PromptAgentCustomModel => ({
  ...current,
  ...(current.contextWindowSource === 'manual' || discovered.contextWindowSource === 'fallback' ? {} : { contextWindow: discovered.contextWindow, contextWindowSource: discovered.contextWindowSource }),
  ...(current.maxTokensSource === 'manual' || discovered.maxTokensSource === 'fallback' ? {} : { maxTokens: discovered.maxTokens, maxTokensSource: discovered.maxTokensSource }),
  ...(current.capabilityDetection?.tools === 'manual' || discovered.capabilityDetection?.tools === 'unknown' ? {} : { tools: discovered.tools }),
  ...(current.capabilityDetection?.imageInput === 'manual' || discovered.capabilityDetection?.imageInput === 'unknown' ? {} : { imageInput: discovered.imageInput }),
  ...(current.capabilityDetection?.reasoning === 'manual' || discovered.capabilityDetection?.reasoning === 'unknown' ? {} : { reasoning: discovered.reasoning }),
  capabilityDetection: {
    imageInput: current.capabilityDetection?.imageInput === 'manual' ? 'manual' : discovered.capabilityDetection?.imageInput || 'unknown',
    reasoning: current.capabilityDetection?.reasoning === 'manual' ? 'manual' : discovered.capabilityDetection?.reasoning || 'unknown',
    tools: current.capabilityDetection?.tools === 'manual' ? 'manual' : discovered.capabilityDetection?.tools || 'unknown',
  },
  ...(current.thinkingLevelsSource !== 'manual' && discovered.thinkingLevels?.length ? { thinkingLevels: discovered.thinkingLevels, thinkingLevelMap: discovered.thinkingLevelMap, thinkingLevelsSource: discovered.thinkingLevelsSource, thinkingMode: discovered.thinkingMode ?? current.thinkingMode } : {}),
});

export interface PromptAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  thinkingLevel: PromptAgentThinkingLevel;
  imageInput: boolean;
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
  /** 仅兼容旧记录；新事件及持久化记录只保留 Token 数。 */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
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
  tools?: Array<{ id: string; name: string; args?: unknown; result?: unknown; state: 'running' | 'done' | 'error' | 'interrupted' }>;
}

export interface AgentPageRequest { requestId: string; operation: AgentPageOperation; clientId?: string; expiresAt?: number; claimId?: string }
export type PromptAgentEvent = ({ runId?: string; seq?: number } & (
  | ({ type: 'ui_request' } & AgentPageRequest)
  | { type: 'ui_cancel'; requestId: string; clientId?: string }
  | { type: 'response_start'; id: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'response_end'; model: string; provider: string; usage: PromptAgentUsage; stopReason: string; timestamp: number }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result?: unknown }
  | { type: 'action'; action: PromptAgentAction; draft?: PromptAgentDraft }
  | { type: 'project_changed'; resource: string }
  | { type: 'done'; draft: PromptAgentDraft; message: string; provider: string; model: string; status?: string; error?: string; stopReason?: string; draftChanged?: boolean }
  | { type: 'error'; error: string }));

export interface PromptAgentTask {
  status?: string;
  runId?: string;
  cursor?: number;
  reset?: boolean;
  error?: string;
  stopReason?: string;
  target?: PromptAgentDraft['target'];
  finalDraft?: PromptAgentDraft | null;
  events?: PromptAgentEvent[];
  pending?: Array<{ requestId: string; approved: boolean; expiresAt: number; operation: { action: string; resourceId: string; payload: Record<string, unknown> } }>;
  pendingUI?: AgentPageRequest[];
  clientDraft?: PromptAgentDraft;
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

export const formatModelOptionTitle = (
  model: { id: string; provider: string; providerName?: string },
  allModels: Array<{ id: string; provider: string; providerName?: string }> = [],
): string => {
  const base = displayModelName(model.id);
  const duplicate = allModels.some(other => other !== model
    && other.provider !== model.provider
    && displayModelName(other.id).toLowerCase() === base.toLowerCase());
  return duplicate ? `${base} (${model.providerName || model.provider})` : base;
};

export const promptAgentService = {
  setPermissionMode: async (mode: AgentPermissionMode): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/permissions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json();
  },
  getLocalImage: async (path: string, signal?: AbortSignal): Promise<Blob> => {
    if (!path.startsWith('/api/prompt-agent/local-image?') || !isAgentImagePath(path)) throw new Error('本地图片引用无效');
    const response = await fetch(path, { headers: agentAuthHeaders(), cache: 'no-store', signal });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.blob();
  },
  getLocalFile: async (path: string, signal?: AbortSignal): Promise<Blob> => {
    if (!/^\/api\/prompt-agent\/local-(?:image|file)\?sessionId=[^&]+&id=[a-f0-9]{32}$/.test(path)) throw new Error('本地文件引用无效');
    const response = await fetch(path, { headers: agentAuthHeaders(), cache: 'no-store', signal });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.blob();
  },
  uploadExport: async (sessionId: string, name: string, blob: Blob, signal?: AbortSignal): Promise<{ exportId: string; name: string; bytes: number }> => {
    const response = await fetch('/api/prompt-agent/export', { method: 'POST', signal, headers: { ...agentAuthHeaders(), 'Content-Type': blob.type || 'application/octet-stream', 'X-Agent-Session': encodeURIComponent(sessionId), 'X-Agent-Filename': encodeURIComponent(name) }, body: blob });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json();
  },
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
  testCustomProvider: async (input: PromptAgentCustomProvider): Promise<PromptAgentProbeResult> => {
    const response = await fetch('/api/prompt-agent/custom-providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  fetchCustomProviderModels: async (input: PromptAgentCustomProvider): Promise<{ ok: boolean; models: PromptAgentCustomModel[]; baseUrl?: string }> => {
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
  listSessions: async (): Promise<PromptAgentSession[]> => {
    const response = await fetch('/api/prompt-agent/sessions', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  createSession: async (input: { title?: string } = {}): Promise<PromptAgentSession> => {
    const response = await fetch('/api/prompt-agent/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  updateSession: async (sessionId: string, patch: Partial<Pick<PromptAgentSession, 'title' | 'provider' | 'model' | 'thinkingLevel'>>): Promise<PromptAgentSession> => {
    // 本地设置也可能遇到后台暂停，不能让发送与模型入口永久停留在保存状态。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/prompt-agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), signal: controller.signal });
      if (!response.ok) return await readError(response) as never;
      return await response.json();
    } catch (reason) {
      if (controller.signal.aborted) throw new Error('设置保存超时，请检查本地服务是否响应后重试');
      throw reason;
    } finally { clearTimeout(timer); }
  },
  deleteSession: async (sessionId: string) => {
    const response = await fetch(`/api/prompt-agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (!response.ok) return readError(response);
  },
  control: async (sessionId: string, action: 'abort' | 'confirm' | 'finalize' | 'ui_result', message?: string, payload?: Record<string, unknown>) => {
    const response = await fetch('/api/prompt-agent/control', { method: 'POST', headers: { 'Content-Type': 'application/json', ...agentAuthHeaders() }, body: JSON.stringify({ sessionId, action, message, ...(payload || {}) }) });
    if (!response.ok) return readError(response);
  },
  pageControl: async (sessionId: string, action: 'ui_claim' | 'ui_context' | 'ui_result', payload: Record<string, unknown>): Promise<{ ok?: boolean; execute?: boolean; claimId?: string }> => {
    const response = await fetch('/api/prompt-agent/control', { method: 'POST', headers: { 'Content-Type': 'application/json', ...agentAuthHeaders() }, body: JSON.stringify({ sessionId, action, ...payload }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
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
    const response = await fetch('/api/prompt-agent/project-action', { method: 'POST', headers: { 'Content-Type': 'application/json', ...agentAuthHeaders() }, body: JSON.stringify(action) });
    if (!response.ok) return readError(response) as never;
    return response.json() as Promise<{ ok: boolean; action: string; resourceId?: string }>;
  },
  getSession: async (sessionId: string): Promise<PromptAgentHistoryMessage[]> => {
    const response = await fetch(`/api/prompt-agent/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return (await response.json()).items || [];
  },
  getTask: async (sessionId: string, after = 0, runId = ''): Promise<PromptAgentTask> => {
    const response = await fetch(`/api/prompt-agent/task?sessionId=${encodeURIComponent(sessionId)}&after=${after}&runId=${encodeURIComponent(runId)}&clientId=${encodeURIComponent(getAgentPageClientId())}`, { cache: 'no-store' });
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
    let terminal = false;
    const dispatch = (line: string) => {
      if (!line.trim()) return;
      let event: PromptAgentEvent;
      try { event = JSON.parse(line); }
      catch { console.warn('[promptAgent] 跳过无法解析的事件行'); return; }
      onEvent(event);
      if (event.type === 'error') throw new Error(event.error || 'Agent 执行失败');
      if (event.type === 'done') terminal = true;
    };
    try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        dispatch(line);
      }
      if (done) break;
    }
    dispatch(buffer);
    if (!terminal) throw new Error('Agent 连接中断，尚未收到完成回执；可重新打开对话查看任务状态');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
};
