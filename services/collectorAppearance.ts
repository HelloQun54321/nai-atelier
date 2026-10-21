import { useEffect } from 'react';
import type { AppearancePreferences } from './appearancePreferences';
import { useLanguage, type Language } from './i18n';

export const collectorIsLocal = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
export type CollectorAppearance = Pick<AppearancePreferences, 'themeMode' | 'accentColor' | 'motion' | 'palette'> & {
  isDark: boolean; language?: Language; surfaces?: AppearancePreferences['surfaces']; corners?: AppearancePreferences['corners'];
  accents?: { light?: string; dark?: string };
};

/** 外观同步位于应用根部，切页不卸载；串行合并快速调色，避免旧请求覆盖新偏好。 */
export function useCollectorAppearance(preferences: AppearancePreferences, isDark: boolean) {
  const language = useLanguage();
  const { themeMode, accentColor, motion, palette, surfaces, corners, details } = preferences;
  useEffect(() => {
    if (!collectorIsLocal(window.location.hostname)) return;
    const appearance = { themeMode, accentColor, motion, isDark, language, surfaces, corners,
      accents: { light: details?.light?.accentColor || accentColor, dark: details?.dark?.accentColor || accentColor }, ...(palette ? { palette } : {}) };
    void syncCollectorAppearance(appearance);
    const sync = () => { void syncCollectorAppearance(appearance); };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [themeMode, accentColor, motion, isDark, language, palette, surfaces, corners, details?.light?.accentColor, details?.dark?.accentColor]);
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
