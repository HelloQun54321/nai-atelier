export const CLOUD_QUEUE_SERVICE_URL = 'https://st-chatu-novelai-queue.hf.space';

export interface CloudQueuePreferences {
  enabled: boolean;
  greeting: string;
  showGreeting: boolean;
  serviceUrl: string;
}

export interface CloudQueueStatus {
  taskId: string;
  phase: 'preparing' | 'joining' | 'waiting' | 'ready' | 'generating' | 'completed' | 'cancelled' | 'error';
  position?: number | null;
  queueSize?: number | null;
  greeting?: string | null;
  error?: string;
  cancelable?: boolean;
}

const defaults: CloudQueuePreferences = { enabled: false, greeting: '正在生成中～', showGreeting: true, serviceUrl: CLOUD_QUEUE_SERVICE_URL };
let cachedPreferences: CloudQueuePreferences = defaults;
let cachedPreferencesKey = '';
let currentQueueStatus: CloudQueueStatus | null = null;
let currentQueueStatusKey = '';
let clearStatusTimer: number | null = null;
const statusListeners = new Set<() => void>();

const normalizePreferences = (value: Partial<CloudQueuePreferences> | null | undefined): CloudQueuePreferences => ({
  enabled: value?.enabled === true,
  greeting: String(value?.greeting || defaults.greeting).trim().slice(0, 15),
  showGreeting: value?.showGreeting !== false,
  serviceUrl: String(value?.serviceUrl || defaults.serviceUrl).trim() || defaults.serviceUrl,
});

const normalizeApiKey = (apiKey: string) => apiKey.trim();
const getActiveApiKey = () => normalizeApiKey(sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
const getActiveKeyHeaders = (apiKey = getActiveApiKey()): Record<string, string> => {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
};

export const getCachedCloudQueuePreferences = (): CloudQueuePreferences => ({
  ...(cachedPreferencesKey === getActiveApiKey() ? cachedPreferences : defaults),
});

export const getCloudQueuePreferences = async (): Promise<CloudQueuePreferences> => {
  const requestedApiKey = getActiveApiKey();
  const response = await fetch(`/api/generation-queue/preferences?_t=${Date.now()}`, { cache: 'no-store', headers: getActiveKeyHeaders() });
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    if (response.status === 401 && payload?.code === 'LAN_ACCESS_REQUIRED') {
      window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
    }
    throw new Error(payload?.error || await response.text());
  }
  const next = normalizePreferences(await response.json());
  if (getActiveApiKey() !== requestedApiKey) return getCachedCloudQueuePreferences();
  cachedPreferences = next;
  cachedPreferencesKey = requestedApiKey;
  return cachedPreferences;
};

export const setCloudQueuePreferences = async (preferences: CloudQueuePreferences) => {
  const requestedApiKey = getActiveApiKey();
  const response = await fetch('/api/generation-queue/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...getActiveKeyHeaders() }, body: JSON.stringify(preferences),
  });
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    if (response.status === 401 && payload?.code === 'LAN_ACCESS_REQUIRED') {
      window.dispatchEvent(new CustomEvent('nai-lan-access-required'));
    }
    throw new Error(payload?.error || await response.text());
  }
  const next = normalizePreferences(await response.json());
  if (getActiveApiKey() !== requestedApiKey) return getCachedCloudQueuePreferences();
  cachedPreferences = next;
  cachedPreferencesKey = requestedApiKey;
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-preferences-changed', { detail: cachedPreferences }));
  return cachedPreferences;
};

export const emitCloudQueueStatus = (status: CloudQueueStatus | null, sourceApiKey = getActiveApiKey()) => {
  const normalizedSourceApiKey = normalizeApiKey(sourceApiKey);
  // 旧 Key 的请求结束时不得把终态重新显示到新 Key 的界面。
  if (status && normalizedSourceApiKey !== getActiveApiKey()) return;
  if (status && clearStatusTimer !== null) {
    window.clearTimeout(clearStatusTimer);
    clearStatusTimer = null;
  }
  currentQueueStatus = status;
  currentQueueStatusKey = status ? normalizedSourceApiKey : '';
  statusListeners.forEach(listener => listener());
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-status', { detail: status }));
};

export const scheduleCloudQueueStatusClear = (taskId: string, delay: number, sourceApiKey = getActiveApiKey()) => {
  const normalizedSourceApiKey = normalizeApiKey(sourceApiKey);
  if (clearStatusTimer !== null) window.clearTimeout(clearStatusTimer);
  clearStatusTimer = window.setTimeout(() => {
    clearStatusTimer = null;
    if (currentQueueStatus?.taskId === taskId && currentQueueStatusKey === normalizedSourceApiKey) emitCloudQueueStatus(null);
  }, delay);
};

export const getCurrentCloudQueueStatus = () => currentQueueStatus;

export const subscribeCloudQueueStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};

export const cancelCloudQueueTask = async (taskId: string) => {
  const response = await fetch('/api/generation-queue/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getActiveKeyHeaders() },
    body: JSON.stringify({ taskId }),
  });
  if (!response.ok) throw new Error(await response.text());
};

export const watchCloudQueueTask = async (taskId: string, isFinished: () => boolean, sourceApiKey = getActiveApiKey()) => {
  const normalizedSourceApiKey = normalizeApiKey(sourceApiKey);
  while (!isFinished() && getActiveApiKey() === normalizedSourceApiKey) {
    try {
      const response = await fetch(`/api/generation-queue/status?taskId=${encodeURIComponent(taskId)}&_t=${Date.now()}`, { cache: 'no-store', headers: getActiveKeyHeaders(normalizedSourceApiKey) });
      if (response.ok) {
        const status = await response.json() as CloudQueueStatus;
        emitCloudQueueStatus(status, normalizedSourceApiKey);
        if (['completed', 'cancelled', 'error'].includes(status.phase)) return;
      }
    } catch {
      // The generation request carries the authoritative error; status polling is best effort.
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
};

// 切换账号后，旧账号的排队提示立即失效；旧请求稍后返回时也会被 emitCloudQueueStatus 拦截。
if (typeof window !== 'undefined') {
  window.addEventListener('nai-api-key-changed', () => {
    if (currentQueueStatus) emitCloudQueueStatus(null);
  });
}
