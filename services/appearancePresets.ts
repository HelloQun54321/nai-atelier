import type { AppearancePreset, AppearancePreferences } from './appearancePreferences';
import { HEX_COLOR_PATTERN, normalizeThemePalettes, THEME_PALETTE_KEYS } from './themePalette';
import { normalizeThemeDetails, ThemeDetails } from './themeDetails';
import { normalizeThemeBackground } from './themeBackground';

export const APPEARANCE_FORMAT_VERSION = 3;

const APPEARANCE_KEYS = ['accentColor', 'themeMode', 'density', 'corners', 'surfaces', 'motion', 'fontScale', 'galleryFrostedCaption', 'galleryHoverFloat', 'galleryPointerTilt', 'gallerySelectionFocus', 'palette', 'details', 'background'] as const;
export const appearanceValues = (value: AppearancePreset | AppearancePreferences): Pick<AppearancePreset, typeof APPEARANCE_KEYS[number]> => ({
  ...Object.fromEntries(APPEARANCE_KEYS.map(key => [key, value[key]])),
  palette: normalizeThemePalettes(value.palette),
  details: normalizeThemeDetails(value.details),
  background: normalizeThemeBackground(value.background),
}) as Pick<AppearancePreset, typeof APPEARANCE_KEYS[number]>;
export const appearanceMatchesPreset = (preferences: AppearancePreferences, preset: AppearancePreset): boolean =>
  JSON.stringify(appearanceValues(preferences)) === JSON.stringify(appearanceValues(preset));

export const serializeAppearancePresets = (presets: AppearancePreset[]): string => JSON.stringify({
  version: APPEARANCE_FORMAT_VERSION,
  presets: presets.map(preset => ({ id: preset.id, name: preset.name, createdAt: preset.createdAt, ...appearanceValues(preset) })),
}, null, 2);

export const validateAppearancePreset = (input: unknown): AppearancePreset | null => {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Partial<AppearancePreset>;
  if (typeof obj.name !== 'string' || !obj.name.trim()) return null;

  const id = typeof obj.id === 'string' && obj.id.trim()
    ? obj.id.trim()
    : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const name = obj.name.trim().slice(0, 30);
  const createdAt = typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now();
  const isBuiltin = obj.isBuiltin === true;
  const accentColor = typeof obj.accentColor === 'string' && HEX_COLOR_PATTERN.test(obj.accentColor) ? obj.accentColor.toLowerCase() : '#0ea5e9';
  const themeMode = isOneOf(obj.themeMode, ['light', 'dark', 'system']) ? obj.themeMode : 'system';
  const density = isOneOf(obj.density, ['comfortable', 'standard', 'compact']) ? obj.density : 'standard';
  const corners = isOneOf(obj.corners, ['soft', 'standard', 'sharp']) ? obj.corners : 'standard';
  const surfaces = isOneOf(obj.surfaces, ['solid', 'translucent']) ? obj.surfaces : 'solid';
  const motion = isOneOf(obj.motion, ['full', 'reduced', 'off']) ? obj.motion : 'full';
  const fontScale = isOneOf(obj.fontScale, ['small', 'standard', 'large']) ? obj.fontScale : 'standard';

  return {
    id,
    name,
    createdAt,
    ...(isBuiltin ? { isBuiltin: true } : {}),
    accentColor,
    themeMode,
    density,
    corners,
    surfaces,
    motion,
    fontScale,
    galleryFrostedCaption: typeof obj.galleryFrostedCaption === 'boolean' ? obj.galleryFrostedCaption : true,
    galleryHoverFloat: typeof obj.galleryHoverFloat === 'boolean' ? obj.galleryHoverFloat : true,
    // 与偏好归一化同一互斥规则：悬停浮动开着时倾斜一律关掉，避免按钮跟着晃动点不准。
    galleryPointerTilt: (typeof obj.galleryHoverFloat === 'boolean' ? obj.galleryHoverFloat : true) ? false
      : typeof obj.galleryPointerTilt === 'boolean' ? obj.galleryPointerTilt : false,
    gallerySelectionFocus: typeof obj.gallerySelectionFocus === 'boolean' ? obj.gallerySelectionFocus : true,
    ...(normalizeThemePalettes(obj.palette) ? { palette: normalizeThemePalettes(obj.palette) } : {}),
    ...(normalizeThemeDetails(obj.details) ? { details: normalizeThemeDetails(obj.details) } : {}),
    ...(normalizeThemeBackground(obj.background) ? { background: normalizeThemeBackground(obj.background) } : {}),
  };
};

export const readAppearancePresetImport = (jsonText: string): AppearancePreset[] => {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); }
  catch { throw new Error('主题文件不是有效的 JSON'); }
  const container = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  if (container && 'version' in container && (typeof container.version !== 'number' || ![1, 2, APPEARANCE_FORMAT_VERSION].includes(container.version))) throw new Error('不支持的主题文件版本，请更新应用');
  if (container && 'presets' in container && !Array.isArray(container.presets)) throw new Error('主题文件的 presets 必须是数组');
  if (container && 'presets' in container && Object.keys(container).some(key => !['version', 'presets', 'exportedAt'].includes(key))) throw new Error('主题包含不支持的字段，请对照主题制作说明');
  const rawList = Array.isArray(parsed)
    ? parsed
    : (container && Array.isArray(container.presets))
      ? container.presets
      : [parsed];
  const results: AppearancePreset[] = [];
  for (const item of rawList) {
    const valid = validateAppearancePreset(item);
    if (!valid) throw new Error('主题名称缺失或主题数据无效');
    const record = item as Record<string, unknown>;
    const allowed = ['id', 'name', 'createdAt', 'isBuiltin', ...APPEARANCE_KEYS];
    if (Object.keys(record).some(key => !allowed.includes(key))) throw new Error('主题包含不支持的字段，请对照主题制作说明');
    for (const key of APPEARANCE_KEYS) {
      if (key === 'palette' || key === 'details' || key === 'background' || !(key in record)) continue;
      const value = record[key];
      if (key === 'accentColor' ? typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value) : value !== valid[key]) throw new Error('主题选项无效，请对照主题制作说明');
    }
    if ('background' in record && !normalizeThemeBackground(record.background)) throw new Error('主题背景无效，请使用支持的本地图片和显示参数');
    if ('palette' in record) {
      const palette = record.palette;
      if (!palette || typeof palette !== 'object' || Array.isArray(palette) || Object.keys(palette).some(mode => !['light', 'dark'].includes(mode))) throw new Error('主题配色只支持 light 和 dark');
      for (const colors of Object.values(palette)) {
        if (!colors || typeof colors !== 'object' || Array.isArray(colors) || Object.entries(colors).some(([key, color]) => !THEME_PALETTE_KEYS.includes(key as typeof THEME_PALETTE_KEYS[number]) || typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color))) throw new Error('主题配色必须使用已支持的字段和六位十六进制颜色');
      }
    }
    if ('details' in record) {
      const details = record.details;
      const normalized = normalizeThemeDetails(details);
      if (!details || typeof details !== 'object' || Array.isArray(details) || Object.entries(details).some(([key, value]) => {
        if (key === 'light' || key === 'dark') {
          const variant = normalized?.[key];
          return !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([field, entry]) => !variant || variant[field as keyof typeof variant] !== entry);
        }
        return !normalized || normalized[key as keyof ThemeDetails] !== value;
      })) throw new Error('主题选项无效，请对照主题制作说明');
    }
    const custom = { ...valid };
    delete custom.isBuiltin;
    results.push(custom);
  }
  if (!results.length) throw new Error('主题文件中没有可导入的主题');
  return results;
};

export const parseAppearancePresetsFromJson = (jsonText: string): AppearancePreset[] => {
  try {
    return readAppearancePresetImport(jsonText);
  } catch {
    return [];
  }
};

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

