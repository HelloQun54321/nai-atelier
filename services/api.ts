// Base API URL
const API_BASE = '/api';
const NAI_API_URL = 'https://image.novelai.net/ai/generate-image';

// 本地模式下 /generate 端点需绕过 Worker 代理直接调用 NAI API
// 原因：Wrangler pages dev 本地开发时 Worker 代理会产生报错
// 生产环境部署时仍通过 Worker 代理，保持安全层（日志、速率限制等）
// 注意：仅 postBinary 方法需要绕过，因为其他 POST 方法调用本地 Worker API（数据库操作）
//      不涉及外部 NAI API 调用
const LOCAL_BYPASS_ENDPOINTS = ['/generate'];

// 私有 IP 地址检测（覆盖 RFC 1918 定义的所有私有地址段 + IPv6 loopback）
const PRIVATE_IP_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/,           // 127.0.0.0/8 (IPv4 loopback)
  /^10\.\d+\.\d+\.\d+$/,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,           // 192.168.0.0/16
  /^0\.0\.0\.0$/,                   // 0.0.0.0
];

const isLocalMode = () => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '::1' || PRIVATE_IP_PATTERNS.some(p => p.test(hostname));
};

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
        // Optional: Trigger global logout or redirect logic if needed
        // For now, let component handle the error message
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};

export const api = {
  get: async (endpoint: string) => {
    // Add timestamp to prevent caching
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${API_BASE}${endpoint}${separator}_t=${Date.now()}`;
    
    const res = await fetch(url, { 
        headers: getHeaders() 
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
  postBinary: async (endpoint: string, data: any, headers?: Record<string, string>) => {
    let url = `${API_BASE}${endpoint}`;
    
    if (LOCAL_BYPASS_ENDPOINTS.includes(endpoint) && isLocalMode()) {
      url = NAI_API_URL;
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(headers),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
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