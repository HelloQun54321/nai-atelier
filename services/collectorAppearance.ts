import { useEffect } from 'react';
import type { AppearancePreferences } from './appearancePreferences';

export const collectorIsLocal = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
export type CollectorAppearance = Pick<AppearancePreferences, 'themeMode' | 'accentColor' | 'motion'> & { isDark: boolean };

/** 外观同步位于应用根部，切页不卸载；串行合并快速调色，避免旧请求覆盖新偏好。 */
export function useCollectorAppearance(preferences: AppearancePreferences, isDark: boolean) {
  const { themeMode, accentColor, motion } = preferences;
  useEffect(() => {
    if (!collectorIsLocal(window.location.hostname)) return;
    const appearance = { themeMode, accentColor, motion, isDark };
    void syncCollectorAppearance(appearance);
    const sync = () => { void syncCollectorAppearance(appearance); };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [themeMode, accentColor, motion, isDark]);
}

let pending: CollectorAppearance | null = null;
let sending: Promise<void> | null = null;
export function syncCollectorAppearance(appearance: CollectorAppearance): Promise<void> {
  pending = appearance;
  if (sending) return sending;
  sending = (async () => {
    while (pending) {
      const next = pending; pending = null;
      try {
        await fetch('/api/style-collector/appearance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nai-Local-Control': 'true' }, body: JSON.stringify(next) });
      } catch { /* 服务断开不影响网页外观，下一次外观变化或回到页面时重新同步。 */ }
    }
  })().finally(() => { sending = null; if (pending) return syncCollectorAppearance(pending); });
  return sending;
}
