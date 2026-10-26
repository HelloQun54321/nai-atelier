import { PromptAgentAction, PromptAgentDraft } from '../types';
import { parseErrorResponse } from './api';
import { isAgentImagePath } from './agentMedia';
import { agentConnectionEndpoint } from './agentConnection.mjs';
import { getAgentPageClientId, type AgentPageOperation } from './agentWorkspace';
import { stableOperationId } from './operationId';


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
  creativeDirect?: boolean;
  creativeDirectRules?: string;
  creativeDirectRulesDefault?: string;
  creativeDirectRulesCustom?: boolean;
  deepseekSearch?: boolean;
  searchEnabled?: boolean;
  searchApiBaseUrl?: string;
  searchApiKeyConfigured?: boolean;
  searchApiKeyCustom?: boolean;
  runtimeStartedAt: number;
  backendVersion?: string;
  sourceVersion?: string;
  restartRequired?: boolean;
  permissionMode?: AgentPermissionMode;
  credentialWarning?: string;
}

export const agentRuntimeWarning = (config: PromptAgentConfig, frontendVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''): string => {
  if (!config.backendVersion) return '电脑上仍运行旧版助手服务。再次打开启动器会复用旧进程；请关闭原服务窗口，再启动工坊。';
  if (config.restartRequired || config.sourceVersion && config.backendVersion !== config.sourceVersion) return `助手服务 ${config.backendVersion} 尚未加载最新代码。请关闭原服务窗口，再启动工坊；只刷新页面不会更新后端。`;
  if (frontendVersion && config.backendVersion !== frontendVersion) return `当前界面 ${frontendVersion} 与助手服务 ${config.backendVersion} 未同步，请刷新页面以加载最新界面。`;
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
  | { type: 'done'; draft: PromptAgentDraft; message: string; provider: string; model: string; status?: string; error?: string; errorDetail?: string; stopReason?: string; draftChanged?: boolean }
  | { type: 'error'; error: string; errorDetail?: string }));

export interface PromptAgentTask {
  status?: string;
  runId?: string;
  cursor?: number;
  reset?: boolean;
  error?: string;
  errorDetail?: string;
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


/* ---------- 提示词库（人物形象 / 服饰 / 姿势 / 场景） ---------- */
export type PromptLibraryKind = 'appearance' | 'wardrobe' | 'pose' | 'expression' | 'scene' | 'camera';

/** 一次生成产出的单条方案。 */
export interface PromptLibraryItem {
  name: string;
  prompt: string;
  bilingual: string;
  tags: string[];
  note?: string;
  filtered?: string[];
  filteredWarning?: boolean;
}

export interface PromptLibraryResult {
  items: PromptLibraryItem[];
  provider: string;
  model: string;
  count: number;
  kind: PromptLibraryKind;
  filteredCount?: number;
}

/** AI 生成搭配：一段话一次生成六类库，每条带自己的领域 kind。 */
export interface PromptLibraryBundleItem {
  kind: PromptLibraryKind;
  label: string;
  name: string;
  prompt: string;
  bilingual: string;
  negativePrompt: string;
  tags: string[];
  note: string;
}

export interface PromptLibraryBundleResult {
  items: PromptLibraryBundleItem[];
  /** 本次没能生成出来的库（模型输出缺失或校验未通过），可重试。 */
  missing: string[];
  provider: string;
  model: string;
  count: number;
  filteredCount?: number;
}

export interface PromptLibraryBundleInput {
  brief: string;
  hint?: string;
  detail?: 'strict' | 'moderate' | 'detailed';
  keepEmpty?: boolean;
  singleColor?: boolean;
  dryRun?: boolean;
}

/** 库生成时置顶追加的两段自定义提示词。 */
export interface PromptLibraryPrompts {
  spec: string;
  extra: string;
}

/** 提示词／图片提取：一条候选即一个未来要落库的库条目（同类内容已按原顺序合并）。 */
export interface PromptExtractionCandidate {
  kind: PromptLibraryKind;
  /** 中文名称含义，用户可在审阅时改写。 */
  name: string;
  /** 实际保存进库的英文提示词。 */
  prompt: string;
  /** 被翻译的中文原文（仅文字模式的中文片段出现）。 */
  original?: string;
  /** 中文片段还没拿到可用英文译法：界面默认不勾选，补上英文后才能入库。 */
  needsTranslation?: boolean;
  /** 源文本的权重／括号结构没能可靠套回译文：界面默认不勾选并提示人工处理。 */
  needsReview?: boolean;
  /** 需要人工处理的具体原因（结构问题说明）。 */
  reviewNote?: string;
}

/** 图片元数据里的一个角色分栏：正向内容单独成组，不与其他角色混合。 */
export interface PromptExtractionCharacter {
  label: string;
  prompt: string;
  /** 该角色的负面提示词：只用于如实展示，不进入正向候选。 */
  negative?: string;
}

/** 无法归类的残留内容：只在「未归类」区域展示，不入库，也不静默丢弃。 */
export interface PromptExtractionUnclassified {
  name: string;
  prompt: string;
  original?: string;
}

export interface PromptExtractionResult {
  mode: 'text' | 'vision';
  provider: string;
  model: string;
  items: PromptExtractionCandidate[];
  unclassified: PromptExtractionUnclassified | null;
  /** 从原文剥离的负面提示词与生成参数，只用于如实展示。 */
  excluded?: { negative: string; parameters: string };
  /** 看图提取时被模型返回、但内容为空的条目数量。 */
  ignored?: number;
}

export interface PromptExtractionInput {
  mode: 'text' | 'vision';
  text?: string;
  /** 图片元数据里的角色分栏正向提示词：带上它才能保留角色归属。 */
  characters?: PromptExtractionCharacter[];
  images?: Array<{ data: string; mimeType: string }>;
}

export const PROMPT_LIBRARY_KIND_LABELS: Record<PromptLibraryKind, string> = {
  appearance: '外貌',
  wardrobe: '服饰',
  pose: '动作',
  expression: '表情',
  scene: '场景',
  camera: '镜头',
};

export const promptAgentService = {
  classifyPrompts: async (documents: Array<{ id: string; kind: 'global' | 'character'; prompt: string }>) => {
    const response = await fetch('/api/prompt-agent/classify-prompts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents }),
    });
    if (!response.ok) return readError(response) as never;
    return response.json() as Promise<{ items: Array<{ id: string; kind: 'global' | 'character'; sections: Record<string, string> }> }>;
  },
  /**
   * 提示词／图片 → 六类库候选（忠实提取，不是六库生成）。
   *
   * 文字模式：英文 Tag 由模型判断类别、程序按原片段重组；中文片段翻译及自然语言拆分
   * 依赖模型理解，结果交用户审阅。图片模式由当前助手模型推断，不冒充原始提示词。
   * 每次都由用户主动点击触发；客户端不自动重发，避免重复消耗模型调用。
   */
  extractCandidates: async (input: PromptExtractionInput, signal?: AbortSignal): Promise<PromptExtractionResult> => {
    // 图片的 base64 体积很大，operationId 只按结构派生，避免对整段图片数据做哈希。
    const operationId = stableOperationId('extract-candidates', {
      mode: input.mode,
      text: input.text ?? '',
      characters: (input.characters ?? []).map(entry => `${entry.label}:${entry.prompt.length}`),
      images: (input.images ?? []).map(image => ({ mimeType: image.mimeType, length: image.data.length })),
    });
    const response = await fetch('/api/prompt-agent/extract-candidates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, operationId }), signal,
    });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  setCreativeDirect: async (enabled: boolean): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/creative-direct', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  setCreativeDirectRules: async (rules: string): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/creative-direct-rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json();
  },
  setSearchApi: async ({ enabled, baseUrl, apiKey }: { enabled: boolean; baseUrl?: string; apiKey?: string }): Promise<PromptAgentConfig> => {
    const response = await fetch('/api/prompt-agent/search-api', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, baseUrl, apiKey }) });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json();
  },
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
  /* ---------- 提示词库：与创作助手共用模型，做一次性非流式补全 ---------- */
  /**
   * 提示词库生成。
   *
   * 请求体带 `operationId`，但**不在客户端自动重发**：服务端目前没有按该 id 去重/查询的入口，
   * 连接中断时「结果未知」，自动重发等于可能重复消耗模型调用。等网关侧提供幂等查询后再打开重试。
   */
  generateLibraryPrompt: async (input: {
    kind: PromptLibraryKind;
    brief: string;
    count?: number;
    [facet: string]: unknown;
  }): Promise<PromptLibraryResult> => {
    const operationId = stableOperationId('library-generate', input);
    const response = await fetch('/api/prompt-agent/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, operationId }),
    });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  /**
   * AI 生成搭配：一段话一次生成人物形象 / 服饰 / 姿势 / 表情状态 / 场景 / 镜头六类提示词。
   *
   * 与 generateLibraryPrompt 同一套路：带 operationId 仅用于追踪，客户端不自动重发，
   * 避免连接中断后重复消耗模型调用。用户主动触发，使用当前助手模型，不消耗生图额度。
   */
  generateLibraryBundle: async (input: PromptLibraryBundleInput): Promise<PromptLibraryBundleResult> => {
    const operationId = stableOperationId('library-bundle', input);
    const response = await fetch('/api/prompt-agent/library-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, operationId }),
    });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  getLibraryPrompts: async (): Promise<PromptLibraryPrompts> => {
    const response = await fetch('/api/prompt-agent/library-prompts', { cache: 'no-store' });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  saveLibraryPrompts: async (input: { spec?: string; extra?: string }): Promise<PromptLibraryPrompts> => {
    const response = await fetch('/api/prompt-agent/library-prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: input.spec ?? '', extra: input.extra ?? '' }),
    });
    if (!response.ok) return readError(response) as never;
    return response.json();
  },
  previewLibrarySystemPrompt: async (input: {
    kind: PromptLibraryKind;
    spec: string;
    extra: string;
  }): Promise<{ kind: PromptLibraryKind; length: number; systemPrompt: string }> => {
    const response = await fetch('/api/prompt-agent/library-prompts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
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
    if (!response.body) throw new Error('浏览器不支持助手流式响应');
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
      if (event.type === 'error') throw new Error(event.error || '助手执行失败');
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
    if (!terminal) throw new Error('助手连接中断，尚未收到完成回执；可重新打开对话查看任务状态');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
};
