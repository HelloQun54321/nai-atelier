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
let clearStatusTimer: number | null = null;
const statusListeners = new Set<() => void>();

const normalizePreferences = (value: Partial<CloudQueuePreferences> | null | undefined): CloudQueuePreferences => ({
  enabled: value?.enabled === true,
  greeting: String(value?.greeting || defaults.greeting).trim().slice(0, 15),
  showGreeting: value?.showGreeting !== false,
  serviceUrl: String(value?.serviceUrl || defaults.serviceUrl).trim() || defaults.serviceUrl,
});

const getActiveApiKey = () => (sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '').trim();
const getActiveKeyHeaders = (): Record<string, string> => {
  const apiKey = getActiveApiKey();
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

export const emitCloudQueueStatus = (status: CloudQueueStatus | null) => {
  if (status && clearStatusTimer !== null) {
    window.clearTimeout(clearStatusTimer);
    clearStatusTimer = null;
  }
  currentQueueStatus = status;
  statusListeners.forEach(listener => listener());
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-status', { detail: status }));
};

export const scheduleCloudQueueStatusClear = (taskId: string, delay: number) => {
  if (clearStatusTimer !== null) window.clearTimeout(clearStatusTimer);
  clearStatusTimer = window.setTimeout(() => {
    clearStatusTimer = null;
    if (currentQueueStatus?.taskId === taskId) emitCloudQueueStatus(null);
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

export const watchCloudQueueTask = async (taskId: string, isFinished: () => boolean) => {
  while (!isFinished()) {
    try {
      const response = await fetch(`/api/generation-queue/status?taskId=${encodeURIComponent(taskId)}&_t=${Date.now()}`, { cache: 'no-store', headers: getActiveKeyHeaders() });
      if (response.ok) {
        const status = await response.json() as CloudQueueStatus;
        emitCloudQueueStatus(status);
        if (['completed', 'cancelled', 'error'].includes(status.phase)) return;
      }
    } catch {
      // The generation request carries the authoritative error; status polling is best effort.
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
};
