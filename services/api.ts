import { reportCloudQueueCleanupError } from './cloudQueue';

// Base API URL
const API_BASE = '/api';
export const NAI_ACCOUNTING_ERROR_EVENT = 'nai-generation-accounting-error';

const getHeaders = (extraHeaders?: Record<string, string>) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  return headers;
};

/** 网关返回的结构化业务错误：code 为错误码（如 QUEUE_CANCELLED），status 为 HTTP 状态。 */
export class ApiError extends Error {
  code?: string;
  status?: number;
  retryAfter?: number;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

/** 取消排队终态的结构化标识（见 scripts/media-gateway.mjs 的 499 + QUEUE_CANCELLED）。 */
const QUEUE_CANCELLED_CODE = 'QUEUE_CANCELLED';
const QUEUE_CANCELLED_STATUS = 499;

/** 统一解析网关错误响应：优先 JSON 的结构化 { error, message, code }，取用户可见 message；JSON 解析失败时回退截断后的响应文本。 */
export const parseErrorResponse = async (res: Response): Promise<ApiError> => {
  let message = `请求失败 (${res.status})`;
  let code: string | undefined;
  let retryAfter: number | undefined;
  const truncated = (text: string) => text.length > 500 ? `${text.slice(0, 500)}…` : text;
  try {
    const payload: unknown = await res.clone().json();
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const error = typeof record.error === 'string' ? record.error : undefined;
      const fallbackMessage = typeof record.message === 'string' ? record.message : undefined;
      if (typeof record.code === 'string' && record.code) code = record.code;
      if (typeof record.retryAfter === 'number' && Number.isFinite(record.retryAfter) && record.retryAfter > 0) retryAfter = Math.ceil(record.retryAfter);
      const candidate = error || fallbackMessage || code;
      if (candidate) message = truncated(candidate);
    }
  } catch {
    // 响应体不是 JSON（HTML/纯文本等），回退截断原文。
    try {
      message = truncated((await res.clone().text()).trim() || message);
    } catch { /* 响应体不可读时保留默认文案。 */ }
  }
  return Object.assign(new ApiError(message, res.status, code), retryAfter ? { retryAfter } : {});
};

/** 网关终态判定：结构化 code 为 QUEUE_CANCELLED 或 HTTP 499，兜底匹配旧的“已取消排队”文案。 */
export const isQueueCancelledError = (error: unknown): boolean => {
  if (error instanceof ApiError && (error.code === QUEUE_CANCELLED_CODE || error.status === QUEUE_CANCELLED_STATUS)) return true;
  return error instanceof Error && error.message.includes('已取消排队');
};

/** 401 时按结构化 code 通知全局 LAN 解锁流程。 */
const notifyLanAccessRequired = (res: Response) => {
  if (res.status !== 401 || typeof window === 'undefined') return;
  void res.clone().json().then(payload => {
    const code = (payload as Record<string, unknown> | null)?.code;
    if (code === 'LAN_ACCESS_REQUIRED') window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
  }).catch(() => { /* 非 JSON 的 401 响应体无需处理。 */ });
};

const handleResponse = async (res: Response) => {
    notifyLanAccessRequired(res);
    if (!res.ok) throw await parseErrorResponse(res);
    return res.json();
};

interface BinaryRequestOptions {
  /** 与本次生图所用 Key 对应的哈希，用于防止切 Key 后预算事件串号。 */
  budgetKeyHash?: string;
}

interface StreamRequestOptions extends BinaryRequestOptions {
  /** 调用方离开当前视图时中止流传输。 */
  signal?: AbortSignal;
}

interface BinaryResponseDetails {
  blob: Blob;
  estimatedCost?: number;
  remaining?: number;
}

export interface ParsedSseEvent {
  event: string;
  data: unknown;
}

/** 增量解析 fetch POST 返回的 SSE；兼容 CRLF、分片字段与多行 data。 */
export const createSseParser = (onEvent: (event: ParsedSseEvent) => void) => {
  let buffer = '';
  const emitFrame = (frame: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value || 'message';
      if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    const raw = data.join('\n');
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw); } catch { /* 文本事件原样交给调用方。 */ }
    onEvent({ event, data: parsed });
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
        buffer = buffer.slice(boundary + separator.length);
        emitFrame(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    finish() {
      if (buffer.trim()) emitFrame(buffer);
      buffer = '';
    },
  };
};

const emitBudgetChanged = (remaining: number, budgetKeyHash = '') => {
  if (!Number.isFinite(remaining) || remaining < 0 || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nai-anlas-budget-changed', {
    detail: { remaining, updatedAt: Date.now(), keyHash: budgetKeyHash, refreshPersonal: true },
  }));
};

const requestPersonalUsageRefresh = (budgetKeyHash = '') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nai-anlas-budget-changed', {
    detail: { keyHash: budgetKeyHash, refreshPersonal: true },
  }));
};

export const reportNaiAccountingError = (budgetKeyHash = '') => {
  requestPersonalUsageRefresh(budgetKeyHash);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NAI_ACCOUNTING_ERROR_EVENT, {
    detail: { message: '任务已完成，但本地用量记账失败；请核对官方余额与本地预算，勿重复提交' },
  }));
};

const notifyQueueCleanupFailed = (res: Response, headers?: Record<string, string>) => {
  if (res.headers.get('x-nai-queue-cleanup-failed') === '1') {
    reportCloudQueueCleanupError(res.headers.get('x-nai-queue-task-id') || '', (headers?.Authorization || '').replace(/^Bearer /, ''));
  }
};

export const api = {
  get: async (endpoint: string, options: { cache?: RequestCache; signal?: AbortSignal } = {}) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: getHeaders(),
        cache: options.cache || 'default',
        signal: options.signal,
    });
    return handleResponse(res);
  },

  post: async (endpoint: string, data: any) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  postForm: async (endpoint: string, data: FormData) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      body: data,
    });
    return handleResponse(res);
  },

  put: async (endpoint: string, data: any) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  delete: async (endpoint: string, data?: any) => {
    const options: RequestInit = {
      method: 'DELETE',
      headers: getHeaders(),
    };
    if (data) options.body = JSON.stringify(data);
    
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    return handleResponse(res);
  },
  
  // Binary response for images
  postBinaryDetailed: async (endpoint: string, data: any, headers?: Record<string, string>, options: BinaryRequestOptions = {}): Promise<BinaryResponseDetails> => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(headers),
      body: JSON.stringify(data),
    });
    notifyLanAccessRequired(res);
    notifyQueueCleanupFailed(res, headers);
    if (!res.ok) throw await parseErrorResponse(res);
    if (res.headers.get('x-nai-anlas-accounting-failed') === '1') reportNaiAccountingError(options.budgetKeyHash);
    const remaining = res.headers.get('x-nai-anlas-remaining');
    if (remaining !== null) emitBudgetChanged(Number(remaining), options.budgetKeyHash);
    const spent = res.headers.get('x-nai-anlas-estimated-spent') ?? res.headers.get('x-nai-anlas-spent');
    const parsedCost = spent === null || spent.trim() === '' ? NaN : Number(spent);
    return { blob: await res.blob(), estimatedCost: Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : undefined, remaining: remaining === null ? undefined : Number(remaining) };
  },

  postBinary: async (endpoint: string, data: any, headers?: Record<string, string>, options: BinaryRequestOptions = {}) => {
    return (await api.postBinaryDetailed(endpoint, data, headers, options)).blob;
  },

  postSse: async (
    endpoint: string,
    data: unknown,
    headers: Record<string, string>,
    onEvent: (event: ParsedSseEvent) => void,
    options: StreamRequestOptions = {},
  ): Promise<{ estimatedCost?: number }> => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders({ Accept: 'text/event-stream', ...headers }),
      body: JSON.stringify(data),
      signal: options.signal,
    });
    notifyLanAccessRequired(res);
    notifyQueueCleanupFailed(res, headers);
    if (!res.ok) throw await parseErrorResponse(res);
    if (!res.body) throw new Error('流式生成没有返回响应体');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // SSE 中 nai_usage 事件（final 图片之后到达）携带网关结算的真实 estimatedSpent，
    // 累积随 postSse 返回，供流式生成本地历史写入真实估算成本。
    let estimatedCost: number | undefined;
    const parser = createSseParser(event => {
      if (event.event === 'nai_usage' && event.data && typeof event.data === 'object') {
        const usageData = event.data as { remaining?: unknown; estimatedSpent?: unknown };
        const remaining = typeof usageData.remaining === 'number' ? usageData.remaining : NaN;
        if (Number.isFinite(remaining) && remaining >= 0) emitBudgetChanged(remaining, options.budgetKeyHash);
        else requestPersonalUsageRefresh(options.budgetKeyHash);
        const spent = typeof usageData.estimatedSpent === 'number' ? usageData.estimatedSpent : NaN;
        if (Number.isFinite(spent) && spent >= 0) estimatedCost = spent;
      }
      if (event.event === 'nai_usage_error') {
        reportNaiAccountingError(options.budgetKeyHash);
      }
      if (event.event === 'nai_queue_cleanup_error') {
        reportCloudQueueCleanupError(res.headers.get('x-nai-queue-task-id') || '', (headers.Authorization || '').replace(/^Bearer /, ''));
      }
      onEvent(event);
    });
    try {
      while (true) {
        const { done, value } = await reader.read();
        parser.push(decoder.decode(value, { stream: !done }));
        if (done) break;
      }
      parser.finish();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return { ...(estimatedCost !== undefined ? { estimatedCost } : {}) };
  },

  getBlob: async (endpoint: string) => {
    const res = await fetch(`${API_BASE}${endpoint}`, { headers: getHeaders() });
    notifyLanAccessRequired(res);
    if (!res.ok) throw await parseErrorResponse(res);
    return res.blob();
  },

  // NEW: Upload File (Multipart)
  uploadFile: async (file: File, folder: string = 'misc') => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);

      const res = await fetch(`${API_BASE}/upload`, {
          method: 'POST',
          body: formData, // Browser sets Content-Type: multipart/form-data with boundary
      });
      return handleResponse(res);
  }
};
