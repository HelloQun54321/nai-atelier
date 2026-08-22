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
  postBinary: async (endpoint: string, data: any, headers?: Record<string, string>, options: BinaryRequestOptions = {}) => {
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
    if (remaining !== null && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nai-anlas-budget-changed', {
        detail: { remaining: Number(remaining), updatedAt: Date.now(), keyHash: options.budgetKeyHash || '', refreshPersonal: true },
      }));
    }
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
