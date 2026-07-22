export const CLOUD_QUEUE_SERVICE_URL = 'https://st-chatu-novelai-queue.hf.space';

export interface CloudQueuePreferences {
  enabled: boolean;
  greeting: string;
  showGreeting: boolean;
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

const defaults: CloudQueuePreferences = { enabled: false, greeting: '正在生成中～', showGreeting: true };
let cachedPreferences: CloudQueuePreferences = defaults;
let currentQueueStatus: CloudQueueStatus | null = null;
const statusListeners = new Set<() => void>();

export const getCachedCloudQueuePreferences = (): CloudQueuePreferences => cachedPreferences;

export const getCloudQueuePreferences = async (): Promise<CloudQueuePreferences> => {
  const response = await fetch(`/api/generation-queue/preferences?_t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await response.text());
  cachedPreferences = await response.json();
  return cachedPreferences;
};

export const setCloudQueuePreferences = async (preferences: CloudQueuePreferences) => {
  const response = await fetch('/api/generation-queue/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error(await response.text());
  cachedPreferences = await response.json();
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-preferences-changed', { detail: cachedPreferences }));
  return cachedPreferences;
};

export const emitCloudQueueStatus = (status: CloudQueueStatus | null) => {
  currentQueueStatus = status;
  statusListeners.forEach(listener => listener());
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-status', { detail: status }));
};

export const getCurrentCloudQueueStatus = () => currentQueueStatus;

export const subscribeCloudQueueStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};

export const cancelCloudQueueTask = async (taskId: string) => {
  const response = await fetch('/api/generation-queue/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  if (!response.ok) throw new Error(await response.text());
};

export const watchCloudQueueTask = async (taskId: string, isFinished: () => boolean) => {
  while (!isFinished()) {
    try {
      const response = await fetch(`/api/generation-queue/status?taskId=${encodeURIComponent(taskId)}&_t=${Date.now()}`, { cache: 'no-store' });
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
