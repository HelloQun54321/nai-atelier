import { useEffect } from 'react';
import type { AppearancePreferences } from './appearancePreferences';
import { useLanguage, type Language } from './i18n';
import { resolveThemeDetails } from './themeDetails';
import { resolveWorkspaceBackground, type ThemeBackground } from './themeBackground';
import { resolveThemePalette } from './themePalette';

export const collectorIsLocal = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
export type CollectorAppearance = Pick<AppearancePreferences, 'themeMode' | 'accentColor' | 'motion' | 'palette'> & {
  isDark: boolean; language?: Language; surfaces?: AppearancePreferences['surfaces']; corners?: AppearancePreferences['corners'];
  backgrounds?: Partial<Record<'light' | 'dark', ThemeBackground | null>>;
  accents?: { light?: string; dark?: string };
  materials?: Record<'light' | 'dark', { kind: 'glass' | 'frosted'; opacity: number; highlight: number; borderOpacity: number; controlRadius: number; panelRadius?: number; blur: number; saturation: number; refraction: number; controlShadow: number }>;
};

/** 外观同步位于应用根部，切页不卸载；串行合并快速调色，避免旧请求覆盖新偏好。 */
export function useCollectorAppearance(preferences: AppearancePreferences, isDark: boolean) {
  const language = useLanguage();
  const { themeMode, accentColor, motion, palette, surfaces, corners, details, activePresetId, workspaceBackgrounds, background } = preferences;
  useEffect(() => {
    if (!collectorIsLocal(window.location.hostname)) return;
    const backgrounds = Object.fromEntries((['light', 'dark'] as const).map(mode => [mode, resolveWorkspaceBackground(workspaceBackgrounds, activePresetId || 'builtin-default', mode, background) ?? null]));
    const appearance = { themeMode, accentColor, motion, isDark, language, surfaces, corners,
      ...(Object.values(backgrounds).some(Boolean) ? { backgrounds } : {}),
      accents: { light: details?.light?.accentColor || accentColor, dark: details?.dark?.accentColor || accentColor }, ...(palette || surfaces === 'translucent' ? { palette: { light: resolveThemePalette(palette, false), dark: resolveThemePalette(palette, true) } } : {}),
      ...(surfaces === 'translucent' || details ? { materials: Object.fromEntries(([false, true] as const).map(dark => {
        const value = resolveThemeDetails(details, dark);
        return [dark ? 'dark' : 'light', {
          kind: value?.material ?? 'frosted', opacity: value?.globalOpacity ?? value?.sidebarOpacity ?? value?.opacity ?? .85,
          highlight: value?.highlight ?? .3, borderOpacity: value?.borderOpacity ?? .26,
          controlShadow: value?.controlShadow ?? .25,
          controlRadius: value?.controlRadius ?? (corners === 'soft' ? 14.4 : corners === 'sharp' ? 5.6 : 12), panelRadius: value?.panelRadius ?? 24,
          blur: value?.blur ?? 22, saturation: value?.saturation ?? 130, refraction: value?.material === 'glass' ? value.refraction ?? 0 : 0,
        }];
      })) as CollectorAppearance['materials'] } : {}) };
    void syncCollectorAppearance(appearance);
    const sync = () => { void syncCollectorAppearance(appearance); };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [themeMode, accentColor, motion, isDark, language, palette, surfaces, corners, details, activePresetId, workspaceBackgrounds, background]);
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
