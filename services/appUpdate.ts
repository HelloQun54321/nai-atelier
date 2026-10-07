export interface AppUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'installing' | 'error';
  currentVersion: string;
  version: string;
  progress: number;
  allowPrerelease: boolean;
  message: string;
  releaseNotes: string;
}

export interface DesktopUpdateBridge {
  status: () => Promise<AppUpdateState>;
  check: () => Promise<AppUpdateState>;
  download: () => Promise<AppUpdateState>;
  install: () => Promise<AppUpdateState>;
  channel: (value: boolean) => Promise<AppUpdateState>;
  releases: () => Promise<AppUpdateState>;
  onStatus: (callback: (state: AppUpdateState) => void) => () => void;
}

declare global { interface Window { atelierUpdate?: DesktopUpdateBridge } }

export const desktopUpdateBridge = () => window.atelierUpdate;

const UPDATE_DRAFTS_KEY = 'nai-update-lab-drafts';
const LAB_DRAFT_PREFIX = 'nai-lab-workspace-v1:';
/** 重启更新临时保留实验室草稿，不复制 sessionStorage 中的 Key 或授权状态。 */
export function preserveUpdateDrafts() {
  const entries: Record<string, string> = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(LAB_DRAFT_PREFIX)) entries[key] = sessionStorage.getItem(key) || '';
  }
  localStorage.setItem(UPDATE_DRAFTS_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
}

export const clearUpdateDrafts = () => localStorage.removeItem(UPDATE_DRAFTS_KEY);

export function restoreUpdateDrafts() {
  try {
    const saved = JSON.parse(localStorage.getItem(UPDATE_DRAFTS_KEY) || 'null');
    if (!saved || typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > 24 * 60 * 60 * 1000 || !saved.entries || typeof saved.entries !== 'object') return;
    for (const [key, value] of Object.entries(saved.entries)) {
      if (key.startsWith(LAB_DRAFT_PREFIX) && typeof value === 'string' && !sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
    }
    clearUpdateDrafts();
  } catch { /* 浏览器存储不可用时保留现有会话，不覆盖当前草稿。 */ }
}
