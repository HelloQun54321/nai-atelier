export type ThemeMode = 'light' | 'dark' | 'system';
export type DesignTheme = 'nai-atelier';
export type InterfaceDensity = 'comfortable' | 'standard' | 'compact';
export type CornerStyle = 'soft' | 'standard' | 'sharp';
export type SurfaceStyle = 'solid' | 'translucent';
export type MotionStyle = 'full' | 'reduced' | 'off';
export type FontScale = 'small' | 'standard' | 'large';

export interface AppearancePreferences {
  designTheme: DesignTheme;
  themeMode: ThemeMode;
  accentColor: string;
  density: InterfaceDensity;
  corners: CornerStyle;
  surfaces: SurfaceStyle;
  motion: MotionStyle;
  fontScale: FontScale;
}

const STORAGE_KEY = 'nai_appearance_preferences';
const LEGACY_THEME_KEY = 'nai_theme';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  designTheme: 'nai-atelier',
  themeMode: 'system',
  accentColor: '#6366f1',
  density: 'standard',
  corners: 'standard',
  surfaces: 'solid',
  motion: 'full',
  fontScale: 'standard',
};

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

export const normalizeAppearancePreferences = (value: unknown): AppearancePreferences => {
  const input = value && typeof value === 'object' ? value as Partial<AppearancePreferences> : {};
  return {
    designTheme: input.designTheme === 'nai-atelier' ? input.designTheme : DEFAULT_APPEARANCE_PREFERENCES.designTheme,
    themeMode: isOneOf(input.themeMode, ['light', 'dark', 'system']) ? input.themeMode : DEFAULT_APPEARANCE_PREFERENCES.themeMode,
    accentColor: typeof input.accentColor === 'string' && HEX_COLOR_PATTERN.test(input.accentColor)
      ? input.accentColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.accentColor,
    density: isOneOf(input.density, ['comfortable', 'standard', 'compact']) ? input.density : DEFAULT_APPEARANCE_PREFERENCES.density,
    corners: isOneOf(input.corners, ['soft', 'standard', 'sharp']) ? input.corners : DEFAULT_APPEARANCE_PREFERENCES.corners,
    surfaces: isOneOf(input.surfaces, ['solid', 'translucent']) ? input.surfaces : DEFAULT_APPEARANCE_PREFERENCES.surfaces,
    motion: isOneOf(input.motion, ['full', 'reduced', 'off']) ? input.motion : DEFAULT_APPEARANCE_PREFERENCES.motion,
    fontScale: isOneOf(input.fontScale, ['small', 'standard', 'large']) ? input.fontScale : DEFAULT_APPEARANCE_PREFERENCES.fontScale,
  };
};

export const loadAppearancePreferences = (): AppearancePreferences => {
  let stored: unknown = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    // 损坏的本地偏好直接回退，不影响应用启动。
  }
  const preferences = normalizeAppearancePreferences(stored);
  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
  if (!localStorage.getItem(STORAGE_KEY) && isOneOf(legacyTheme, ['light', 'dark', 'system'])) {
    preferences.themeMode = legacyTheme;
  }
  return preferences;
};

export const saveAppearancePreferences = (preferences: AppearancePreferences) => {
  const normalized = normalizeAppearancePreferences(preferences);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  localStorage.setItem(LEGACY_THEME_KEY, normalized.themeMode);
};

export const applyAppearancePreferences = (preferences: AppearancePreferences, isDark: boolean) => {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.dataset.designTheme = preferences.designTheme;
  root.dataset.density = preferences.density;
  root.dataset.corners = preferences.corners;
  root.dataset.surfaces = preferences.surfaces;
  root.dataset.motion = preferences.motion;
  root.dataset.fontScale = preferences.fontScale;
  root.style.setProperty('--nai-accent', preferences.accentColor);
  root.style.colorScheme = isDark ? 'dark' : 'light';
};
