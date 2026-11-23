/**
 * 前端构建更新后的旧分包失效自动恢复：
 * 浏览器标签页长时间打开期间若 dist/assets 重新打包，懒加载切页会请求已移除的旧哈希分包，
 * 触发 `Failed to fetch dynamically imported module` 或 `vite:preloadError`。
 * 这里在带冷却防死循环的前提下静默刷新一次，并记住用户正要进入的目标视图。
 */

const RELOAD_AT_KEY = 'nai_chunk_reload_at';
const PENDING_VIEW_KEY = 'nai_chunk_reload_view';
export const CHUNK_RELOAD_COOLDOWN_MS = 15_000;
const PENDING_VIEW_TTL_MS = 30_000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
  /Unable to preload CSS/i,
];

let activeNavigableView = '';

export const isDynamicImportError = (error: unknown): boolean => {
  if (!error) return false;
  const text = typeof error === 'string'
    ? error
    : error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message?: unknown }).message)
        : '';
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some(pattern => pattern.test(text));
};

/** 仅记录在内存中；只有真正触发旧分包自动刷新时才写入 sessionStorage，不影响普通手动刷新。 */
export const setActiveViewForChunkRecovery = (view: string) => {
  activeNavigableView = view;
};

/** 一次性消费自动刷新前记住的目标视图；超时或无记录返回 null。 */
export const consumePendingChunkReloadView = (now = Date.now()): string | null => {
  try {
    const raw = sessionStorage.getItem(PENDING_VIEW_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_VIEW_KEY);
    const parsed = JSON.parse(raw) as { view?: unknown; savedAt?: unknown };
    if (typeof parsed?.view !== 'string' || !parsed.view) return null;
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > PENDING_VIEW_TTL_MS) return null;
    return parsed.view;
  } catch {
    return null;
  }
};

/**
 * 若确认是旧分包加载失败且不在冷却期内，记住当前目标视图并触发单次刷新。
 * 返回 true 表示已接管并触发刷新，调用方可避免弹出崩溃页。
 */
export const recoverFromDynamicImportError = (
  error: unknown,
  reload: () => void = () => window.location.reload(),
  now = Date.now(),
): boolean => {
  if (!isDynamicImportError(error)) return false;
  try {
    const lastAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) || '0');
    if (Number.isFinite(lastAt) && lastAt > 0 && now - lastAt < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(RELOAD_AT_KEY, String(now));
    if (activeNavigableView) {
      sessionStorage.setItem(PENDING_VIEW_KEY, JSON.stringify({ view: activeNavigableView, savedAt: now }));
    }
  } catch {
    // 隐私模式等无法写 sessionStorage 时不做自动刷新，避免无法记录冷却而陷入死循环。
    return false;
  }
  reload();
  return true;
};

/** 监听 Vite 官方 preloadError，在进入 React ErrorBoundary 之前静默恢复旧分包。 */
export const installVitePreloadErrorRecovery = (
  reload: () => void = () => window.location.reload(),
): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const onPreloadError = (event: Event) => {
    const payload = (event as CustomEvent).detail ?? (event as Event & { payload?: unknown }).payload ?? new Error('Failed to fetch dynamically imported module');
    if (recoverFromDynamicImportError(payload, reload)) {
      event.preventDefault();
    }
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
};
