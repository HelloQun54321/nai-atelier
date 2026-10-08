export const CLOUD_QUEUE_SERVICE_URL = '';

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
  cleanupError?: string;
  cancelable?: boolean;
  proxy?: boolean;
}

const defaults: CloudQueuePreferences = { enabled: false, greeting: '正在生成中～', showGreeting: true, serviceUrl: '' };
let cachedPreferences: CloudQueuePreferences = defaults;
let cachedPreferencesKey = '';
let currentQueueStatus: CloudQueueStatus | null = null;
let currentQueueStatusKey = '';
let clearStatusTimer: number | null = null;
const statusListeners = new Set<() => void>();

export const isCloudQueueTaskActive = (status: CloudQueueStatus | null) => Boolean(
  status && !['completed', 'cancelled', 'error'].includes(status.phase),
);

const normalizePreferences = (value: Partial<CloudQueuePreferences> | null | undefined): CloudQueuePreferences => {
  const serviceUrl = String(value?.serviceUrl || '').trim();
  return {
    enabled: value?.enabled === true && Boolean(serviceUrl),
    greeting: String(value?.greeting || defaults.greeting).trim().slice(0, 15),
    showGreeting: value?.showGreeting !== false,
    serviceUrl,
  };
};

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
  // 同一 Key 已开始新任务时，旧生成请求的收尾不能覆盖新任务。
  if (status && currentQueueStatus && status.taskId !== currentQueueStatus.taskId && !isCloudQueueTaskActive(status)) return;
  if (clearStatusTimer !== null) {
    window.clearTimeout(clearStatusTimer);
    clearStatusTimer = null;
  }
  // 生成结果与清理警告独立；前端补写终态时不能覆盖同一任务的释放失败反馈。
  currentQueueStatus = status && currentQueueStatus?.taskId === status.taskId && currentQueueStatusKey === normalizedSourceApiKey
    ? { ...status, proxy: status.proxy ?? currentQueueStatus.proxy, cleanupError: status.cleanupError || currentQueueStatus.cleanupError }
    : status;
  currentQueueStatusKey = status ? normalizedSourceApiKey : '';
  statusListeners.forEach(listener => listener());
  window.dispatchEvent(new CustomEvent('nai-cloud-queue-status', { detail: currentQueueStatus }));
  // 终态自行收尾，轮询与生成请求走同一规则；正常完成仅短暂保留内部任务标识。
  if (currentQueueStatus && !isCloudQueueTaskActive(currentQueueStatus)) {
    scheduleCloudQueueStatusClear(currentQueueStatus.taskId, currentQueueStatus.phase === 'error' || currentQueueStatus.cleanupError ? 8000 : 1500, normalizedSourceApiKey);
  }
};

export const reportCloudQueueCleanupError = (taskId: string, sourceApiKey: string) => {
  if (currentQueueStatus?.taskId !== taskId || currentQueueStatusKey !== normalizeApiKey(sourceApiKey)) return;
  emitCloudQueueStatus({ ...currentQueueStatus, cleanupError: '公共队列退出或释放失败，请检查队列状态' }, sourceApiKey);
};

export const scheduleCloudQueueStatusClear = (taskId: string, delay: number, sourceApiKey = getActiveApiKey()) => {
  const normalizedSourceApiKey = normalizeApiKey(sourceApiKey);
  if (currentQueueStatus?.taskId !== taskId || currentQueueStatusKey !== normalizedSourceApiKey) return;
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
  const canUpdate = () => !isFinished() && getActiveApiKey() === normalizedSourceApiKey
    && currentQueueStatus?.taskId === taskId && currentQueueStatusKey === normalizedSourceApiKey
    && isCloudQueueTaskActive(currentQueueStatus);
  while (canUpdate()) {
    try {
      const response = await fetch(`/api/generation-queue/status?taskId=${encodeURIComponent(taskId)}&_t=${Date.now()}`, { cache: 'no-store', headers: getActiveKeyHeaders(normalizedSourceApiKey) });
      if (response.ok) {
        const status = await response.json() as CloudQueueStatus;
        // 请求结束、切 Key 或新任务开始后，迟到的轮询不得恢复旧提示或取消收尾计时。
        if (!canUpdate() || status.taskId !== taskId) return;
        // 网关已完成不代表浏览器已收完图片；以生成请求结束为准，保留接收期间的清理警告。
        if (status.phase === 'completed') return;
        emitCloudQueueStatus(status, normalizedSourceApiKey);
        if (['completed', 'cancelled', 'error'].includes(status.phase)) return;
      }
    } catch {
      // 生成请求负责报告最终错误，状态轮询仅作辅助。
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
