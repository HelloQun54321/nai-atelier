// Base API URL
const API_BASE = '/api';

const getHeaders = (extraHeaders?: Record<string, string>) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  return headers;
};

// Handle response globally
const handleResponse = async (res: Response) => {
    if (res.status === 401) {
        const cloned = res.clone();
        const payload = await cloned.json().catch(() => null);
        if (payload?.code === 'LAN_ACCESS_REQUIRED' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
        }
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};

interface BinaryRequestOptions {
  /** 与本次生图所用 Key 对应的哈希，用于防止切 Key 后预算事件串号。 */
  budgetKeyHash?: string;
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
  if (!Number.isFinite(remaining) || typeof window === 'undefined') return;
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

export const api = {
  get: async (endpoint: string, options: { cache?: RequestCache } = {}) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: getHeaders(),
        cache: options.cache || 'default',
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
    if (res.status === 401) {
      const payload = await res.clone().json().catch(() => null);
      if (payload?.code === 'LAN_ACCESS_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
      }
    }
    if (!res.ok) throw new Error(await res.text());
    const remaining = res.headers.get('x-nai-anlas-remaining');
    if (remaining !== null) emitBudgetChanged(Number(remaining), options.budgetKeyHash);
    const spent = res.headers.get('x-nai-anlas-estimated-spent') ?? res.headers.get('x-nai-anlas-spent');
    const parsedCost = spent === null ? NaN : Number(spent);
    return { blob: await res.blob(), estimatedCost: Number.isFinite(parsedCost) ? parsedCost : undefined, remaining: remaining === null ? undefined : Number(remaining) };
  },

  postBinary: async (endpoint: string, data: any, headers?: Record<string, string>, options: BinaryRequestOptions = {}) => {
    return (await api.postBinaryDetailed(endpoint, data, headers, options)).blob;
  },

  postSse: async (
    endpoint: string,
    data: unknown,
    headers: Record<string, string>,
    onEvent: (event: ParsedSseEvent) => void,
    options: BinaryRequestOptions = {},
  ) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders({ Accept: 'text/event-stream', ...headers }),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      const payload = await res.clone().json().catch(() => null);
      if (payload?.code === 'LAN_ACCESS_REQUIRED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
      }
    }
    if (!res.ok) throw new Error(await res.text());
    if (!res.body) throw new Error('流式生成没有返回响应体');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser(event => {
      if (event.event === 'nai_usage' && event.data && typeof event.data === 'object') {
        const remaining = Number((event.data as { remaining?: unknown }).remaining);
        if (Number.isFinite(remaining)) emitBudgetChanged(remaining, options.budgetKeyHash);
        else requestPersonalUsageRefresh(options.budgetKeyHash);
      }
      if (event.event === 'nai_usage_error') {
        requestPersonalUsageRefresh(options.budgetKeyHash);
      }
      onEvent(event);
    });
    while (true) {
      const { done, value } = await reader.read();
      parser.push(decoder.decode(value, { stream: !done }));
      if (done) break;
    }
    parser.finish();
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
