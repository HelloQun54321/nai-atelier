import { useSyncExternalStore } from 'react';
import { applyThemeColors, HEX_COLOR_PATTERN, normalizeThemePalettes, ThemePalettes } from './themePalette';
import { applyThemeDetails, normalizeThemeDetails, resolveThemeDetails, ThemeDetails } from './themeDetails';
import { validateAppearancePreset } from './appearancePresets';
import { applyThemeBackground, normalizeThemeBackground, normalizeWorkspaceBackgrounds, resolveWorkspaceBackground, type ThemeBackground, type WorkspaceBackgrounds } from './themeBackground';
export { APPEARANCE_FORMAT_VERSION, appearanceValues, appearanceMatchesPreset, serializeAppearancePresets, validateAppearancePreset, readAppearancePresetImport, parseAppearancePresetsFromJson } from './appearancePresets';

export type ThemeMode = 'light' | 'dark' | 'system';
export type DesignTheme = 'nai-atelier';
export type InterfaceDensity = 'comfortable' | 'standard' | 'compact';
export type CornerStyle = 'soft' | 'standard' | 'sharp';
export type SurfaceStyle = 'solid' | 'translucent';
export type MotionStyle = 'full' | 'reduced' | 'off';
export type FontScale = 'small' | 'standard' | 'large';
export type LabModuleId = 'prompt' | 'characters' | 'params' | 'negative' | 'characterReference' | 'vibe';
export type LabModuleCollapsedPreferences = Record<LabModuleId, boolean>;
export type LabPageId = 'text-to-image' | 'image-to-image' | 'inpaint' | 'outpaint';
export type LabPageModuleId = LabModuleId | 'baseImage' | 'editSettings';
export interface LabPageLayout {
  order: LabPageModuleId[];
  collapsed: Partial<Record<LabPageModuleId, boolean>>;
}
export type LabPageLayouts = Record<LabPageId, LabPageLayout>;

export interface GenerationMemoryPreferences {
  parameters: boolean;
  globalPrompt: boolean;
  negativePrompt: boolean;
  characterPrompt: boolean;
  characterNegativePrompt: boolean;
}

export const DEFAULT_GENERATION_MEMORY_PREFERENCES: GenerationMemoryPreferences = {
  parameters: true,
  globalPrompt: true,
  negativePrompt: true,
  characterPrompt: true,
  characterNegativePrompt: true,
};

export const LAB_PAGE_IDS: LabPageId[] = ['text-to-image', 'image-to-image', 'inpaint', 'outpaint'];

export const DEFAULT_LAB_MODULE_ORDER: LabModuleId[] = [
  'prompt',
  'characters',
  'params',
  'negative',
  'characterReference',
  'vibe',
];

export const DEFAULT_LAB_MODULE_COLLAPSED: LabModuleCollapsedPreferences = {
  prompt: false,
  characters: false,
  params: false,
  negative: false,
  characterReference: true,
  vibe: true,
};

const DEFAULT_LAB_EDIT_MODULE_ORDER: LabPageModuleId[] = [
  'baseImage',
  'prompt',
  'characters',
  'editSettings',
  'params',
  'characterReference',
  'vibe',
];

const DEFAULT_LAB_EDIT_MODULE_COLLAPSED: LabPageLayout['collapsed'] = {
  prompt: false,
  characters: false,
  baseImage: false,
  params: false,
  editSettings: false,
  characterReference: true,
  vibe: true,
};

export const DEFAULT_LAB_PAGE_LAYOUTS: LabPageLayouts = {
  'text-to-image': {
    order: [...DEFAULT_LAB_MODULE_ORDER],
    collapsed: { ...DEFAULT_LAB_MODULE_COLLAPSED },
  },
  'image-to-image': {
    order: [...DEFAULT_LAB_EDIT_MODULE_ORDER],
    collapsed: { ...DEFAULT_LAB_EDIT_MODULE_COLLAPSED },
  },
  inpaint: {
    order: [...DEFAULT_LAB_EDIT_MODULE_ORDER],
    collapsed: { ...DEFAULT_LAB_EDIT_MODULE_COLLAPSED },
  },
  outpaint: {
    order: [...DEFAULT_LAB_EDIT_MODULE_ORDER],
    collapsed: { ...DEFAULT_LAB_EDIT_MODULE_COLLAPSED },
  },
};

export const cloneDefaultLabPageLayouts = (): LabPageLayouts => Object.fromEntries(
  LAB_PAGE_IDS.map(pageId => [pageId, {
    order: [...DEFAULT_LAB_PAGE_LAYOUTS[pageId].order],
    collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS[pageId].collapsed },
  }]),
) as LabPageLayouts;

export interface AppearancePreset {
  id: string;
  name: string;
  createdAt: number;
  isBuiltin?: boolean;
  accentColor: string;
  themeMode: ThemeMode;
  density: InterfaceDensity;
  corners: CornerStyle;
  surfaces: SurfaceStyle;
  motion: MotionStyle;
  fontScale: FontScale;
  galleryFrostedCaption: boolean;
  galleryHoverFloat: boolean;
  gallerySelectionFocus: boolean;
  palette?: ThemePalettes;
  details?: ThemeDetails;
  background?: ThemeBackground;
}

export const BUILTIN_APPEARANCE_PRESET: AppearancePreset = {
  id: 'builtin-default',
  name: 'NAI Atelier 默认',
  createdAt: 0,
  isBuiltin: true,
  accentColor: '#0ea5e9',
  themeMode: 'system',
  density: 'standard',
  corners: 'standard',
  surfaces: 'solid',
  motion: 'full',
  fontScale: 'standard',
  galleryFrostedCaption: true,
  galleryHoverFloat: true,
  gallerySelectionFocus: true,
};

export interface AppearancePreferences {
  designTheme: DesignTheme;
  themeMode: ThemeMode;
  accentColor: string;
  palette?: ThemePalettes;
  details?: ThemeDetails;
  background?: ThemeBackground;
  /** 独立于预设快照的本端背景，重新应用预设不覆盖。 */
  workspaceBackgrounds?: WorkspaceBackgrounds;
  density: InterfaceDensity;
  corners: CornerStyle;
  surfaces: SurfaceStyle;
  motion: MotionStyle;
  fontScale: FontScale;
  galleryFrostedCaption: boolean;
  galleryHoverFloat: boolean;
  /** 选中作品时垂直居中并淡化其他卡片。 */
  gallerySelectionFocus: boolean;
  tagAssistEnabled: boolean;
  /** 在支持的模型上显示采样过程；这是当前设备的观看偏好，不写入风格串。 */
  generationStreamPreview: boolean;
  /** 跨重启记住各工作台的文字与参数，不属于外观预设。 */
  rememberGenerationSettings: boolean;
  /** 跨重启记忆范围，与当前会话草稿和外观预设独立。 */
  generationMemory: GenerationMemoryPreferences;
  /** 本端连续生成与排队偏好，不随 Key 且不属于外观预设。 */
  continuousGenerationEnabled: boolean;
  /** 强制清空随机种子；开启后在工坊与实验室中暂时忽略并留空随机种子（不修改预设保存的原值），关闭后恢复。 */
  forceEmptySeed: boolean;
  /** 免费步数上限开关；开启时生成步数输入锁定在官方同步的 freeMaxSteps（默认 28）内，关闭后允许探索付费步数（至多 50）。 */
  enforceFreeStepLimit: boolean;
  labModuleOrder: LabModuleId[];
  labModuleCollapsed: LabModuleCollapsedPreferences;
  /** 四种实验室模式各自独立的模块顺序与默认展开状态。 */
  labPageLayouts: LabPageLayouts;
  customPresets: AppearancePreset[];
  activePresetId?: string;
}

const STORAGE_KEY = 'nai_appearance_preferences';
const LEGACY_THEME_KEY = 'nai_theme';
export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  designTheme: 'nai-atelier',
  themeMode: 'system',
  accentColor: '#0ea5e9',
  density: 'standard',
  corners: 'standard',
  surfaces: 'solid',
  motion: 'full',
  fontScale: 'standard',
  galleryFrostedCaption: true,
  galleryHoverFloat: true,
  gallerySelectionFocus: true,
  tagAssistEnabled: true,
  generationStreamPreview: false,
  rememberGenerationSettings: true,
  generationMemory: { ...DEFAULT_GENERATION_MEMORY_PREFERENCES },
  continuousGenerationEnabled: true,
  forceEmptySeed: false,
  enforceFreeStepLimit: true,
  labModuleOrder: [...DEFAULT_LAB_MODULE_ORDER],
  labModuleCollapsed: { ...DEFAULT_LAB_MODULE_COLLAPSED },
  labPageLayouts: cloneDefaultLabPageLayouts(),
  customPresets: [],
  activePresetId: 'builtin-default',
};

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

const normalizeLabPageLayout = (value: unknown, defaults: LabPageLayout): LabPageLayout => {
  const input = value && typeof value === 'object' ? value as Partial<LabPageLayout> : {};
  const persistedOrder = Array.isArray(input.order)
    ? input.order.filter((item): item is LabPageModuleId => isOneOf(item, defaults.order))
    : [];
  const order = [
    ...new Set(persistedOrder),
    ...defaults.order.filter(item => !persistedOrder.includes(item)),
  ];
  // 旧编辑模式布局没有角色模块：补在提示词后，保留其他模块的自定义顺序。
  if (defaults.order.includes('characters') && !persistedOrder.includes('characters')) {
    order.splice(order.indexOf('characters'), 1);
    order.splice(order.indexOf('prompt') + 1, 0, 'characters');
  }
  const persistedCollapsed = input.collapsed && typeof input.collapsed === 'object'
    ? input.collapsed as Partial<Record<LabPageModuleId, boolean>>
    : {};
  const collapsed = Object.fromEntries(defaults.order.map(moduleId => [
    moduleId,
    typeof persistedCollapsed[moduleId] === 'boolean'
      ? persistedCollapsed[moduleId]
      : Boolean(defaults.collapsed[moduleId]),
  ])) as Partial<Record<LabPageModuleId, boolean>>;
  return { order, collapsed };
};

export const normalizeAppearancePreferences = (value: unknown): AppearancePreferences => {
  const input = value && typeof value === 'object' ? value as Partial<AppearancePreferences> : {};
  const workspaceBackgrounds = normalizeWorkspaceBackgrounds(input.workspaceBackgrounds);
  const legacyBackground = normalizeThemeBackground(input.background);
  const backgroundPresetId = typeof input.activePresetId === 'string' && input.activePresetId.trim() || 'builtin-default';
  if (legacyBackground && !Object.hasOwn(workspaceBackgrounds, backgroundPresetId)) workspaceBackgrounds[backgroundPresetId] = { light: legacyBackground, dark: legacyBackground };
  const persistedOrder = Array.isArray(input.labModuleOrder)
    ? input.labModuleOrder.filter((item): item is LabModuleId => isOneOf(item, DEFAULT_LAB_MODULE_ORDER))
    : [];
  const labModuleOrder = [
    ...new Set(persistedOrder),
    ...DEFAULT_LAB_MODULE_ORDER.filter(item => !persistedOrder.includes(item)),
  ];
  const persistedCollapsed = input.labModuleCollapsed && typeof input.labModuleCollapsed === 'object'
    ? input.labModuleCollapsed as Partial<LabModuleCollapsedPreferences>
    : {};
  const labModuleCollapsed = Object.fromEntries(DEFAULT_LAB_MODULE_ORDER.map(moduleId => [
    moduleId,
    typeof persistedCollapsed[moduleId] === 'boolean'
      ? persistedCollapsed[moduleId]
      : DEFAULT_LAB_MODULE_COLLAPSED[moduleId],
  ])) as LabModuleCollapsedPreferences;
  const persistedPageLayouts = input.labPageLayouts && typeof input.labPageLayouts === 'object'
    ? input.labPageLayouts as Partial<Record<LabPageId, unknown>>
    : {};
  const hasPersistedPageLayouts = Object.keys(persistedPageLayouts).length > 0;
  const labPageLayouts = Object.fromEntries(LAB_PAGE_IDS.map(pageId => [
    pageId,
    normalizeLabPageLayout(
      hasPersistedPageLayouts
        ? persistedPageLayouts[pageId]
        : pageId === 'text-to-image'
          ? { order: labModuleOrder, collapsed: labModuleCollapsed }
          : undefined,
      DEFAULT_LAB_PAGE_LAYOUTS[pageId],
    ),
  ])) as LabPageLayouts;
  return {
    designTheme: input.designTheme === 'nai-atelier' ? input.designTheme : DEFAULT_APPEARANCE_PREFERENCES.designTheme,
    themeMode: isOneOf(input.themeMode, ['light', 'dark', 'system']) ? input.themeMode : DEFAULT_APPEARANCE_PREFERENCES.themeMode,
    accentColor: typeof input.accentColor === 'string' && HEX_COLOR_PATTERN.test(input.accentColor)
      ? input.accentColor.toLowerCase()
      : DEFAULT_APPEARANCE_PREFERENCES.accentColor,
    ...(normalizeThemePalettes(input.palette) ? { palette: normalizeThemePalettes(input.palette) } : {}),
    ...(normalizeThemeDetails(input.details) ? { details: normalizeThemeDetails(input.details) } : {}),
    ...(normalizeThemeBackground(input.background) ? { background: normalizeThemeBackground(input.background) } : {}),
    ...(Object.keys(workspaceBackgrounds).length ? { workspaceBackgrounds } : {}),
    density: isOneOf(input.density, ['comfortable', 'standard', 'compact']) ? input.density : DEFAULT_APPEARANCE_PREFERENCES.density,
    corners: isOneOf(input.corners, ['soft', 'standard', 'sharp']) ? input.corners : DEFAULT_APPEARANCE_PREFERENCES.corners,
    surfaces: isOneOf(input.surfaces, ['solid', 'translucent']) ? input.surfaces : DEFAULT_APPEARANCE_PREFERENCES.surfaces,
    motion: isOneOf(input.motion, ['full', 'reduced', 'off']) ? input.motion : DEFAULT_APPEARANCE_PREFERENCES.motion,
    fontScale: isOneOf(input.fontScale, ['small', 'standard', 'large']) ? input.fontScale : DEFAULT_APPEARANCE_PREFERENCES.fontScale,
    galleryFrostedCaption: typeof input.galleryFrostedCaption === 'boolean' ? input.galleryFrostedCaption : DEFAULT_APPEARANCE_PREFERENCES.galleryFrostedCaption,
    galleryHoverFloat: typeof input.galleryHoverFloat === 'boolean' ? input.galleryHoverFloat : DEFAULT_APPEARANCE_PREFERENCES.galleryHoverFloat,
    gallerySelectionFocus: typeof input.gallerySelectionFocus === 'boolean' ? input.gallerySelectionFocus : DEFAULT_APPEARANCE_PREFERENCES.gallerySelectionFocus,
    tagAssistEnabled: typeof input.tagAssistEnabled === 'boolean'
      ? input.tagAssistEnabled
      : DEFAULT_APPEARANCE_PREFERENCES.tagAssistEnabled,
    generationStreamPreview: typeof input.generationStreamPreview === 'boolean'
      ? input.generationStreamPreview
      : DEFAULT_APPEARANCE_PREFERENCES.generationStreamPreview,
    rememberGenerationSettings: typeof input.rememberGenerationSettings === 'boolean'
      ? input.rememberGenerationSettings
      : DEFAULT_APPEARANCE_PREFERENCES.rememberGenerationSettings,
    generationMemory: Object.fromEntries(Object.entries(DEFAULT_GENERATION_MEMORY_PREFERENCES).map(([key, defaultValue]) => [
      key,
      typeof input.generationMemory?.[key as keyof GenerationMemoryPreferences] === 'boolean'
        ? input.generationMemory[key as keyof GenerationMemoryPreferences]
        : defaultValue,
    ])) as GenerationMemoryPreferences,
    continuousGenerationEnabled: typeof input.continuousGenerationEnabled === 'boolean'
      ? input.continuousGenerationEnabled
      : DEFAULT_APPEARANCE_PREFERENCES.continuousGenerationEnabled,
    forceEmptySeed: typeof input.forceEmptySeed === 'boolean'
      ? input.forceEmptySeed
      : DEFAULT_APPEARANCE_PREFERENCES.forceEmptySeed,
    enforceFreeStepLimit: typeof input.enforceFreeStepLimit === 'boolean'
      ? input.enforceFreeStepLimit
      : DEFAULT_APPEARANCE_PREFERENCES.enforceFreeStepLimit,
    labModuleOrder: labPageLayouts['text-to-image'].order as LabModuleId[],
    labModuleCollapsed: labPageLayouts['text-to-image'].collapsed as LabModuleCollapsedPreferences,
    labPageLayouts,
    customPresets: Array.isArray(input.customPresets)
      ? input.customPresets
          .map(validateAppearancePreset)
          .filter((item): item is AppearancePreset => item !== null && !item.isBuiltin)
      : [],
    activePresetId: typeof input.activePresetId === 'string' && input.activePresetId.trim()
      ? input.activePresetId.trim()
      : 'builtin-default',
  };
};

export const loadAppearancePreferences = (): AppearancePreferences => {
  let stored: unknown = {};
  let hasStoredPreferences = false;
  let legacyTheme: string | null = null;
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    hasStoredPreferences = Boolean(serialized);
    legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    stored = JSON.parse(serialized || '{}');
  } catch {
    // 损坏或禁止读取的本地存储直接回退，初始化在错误边界挂载前也不能阻断启动。
  }
  const preferences = normalizeAppearancePreferences(stored);
  if (!hasStoredPreferences && isOneOf(legacyTheme, ['light', 'dark', 'system'])) {
    preferences.themeMode = legacyTheme;
  }
  return preferences;
};

export const saveAppearancePreferences = (preferences: AppearancePreferences) => {
  const normalized = normalizeAppearancePreferences(preferences);
  // Safari 隐私模式/锁定模式或配额满时 setItem 会抛异常；调用点在 useLayoutEffect（渲染阶段），
  // 不兜底会击穿 React 树白屏，且每次改任意设置都会复现
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(LEGACY_THEME_KEY, normalized.themeMode);
    return true;
  } catch {
    // 写入失败只影响持久化，本次会话内的偏好状态仍然有效
    return false;
  }
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
  const captionChanged = root.dataset.galleryFrostedCaption !== String(preferences.galleryFrostedCaption);
  root.dataset.galleryFrostedCaption = String(preferences.galleryFrostedCaption);
  root.dataset.galleryHoverFloat = String(preferences.galleryHoverFloat);
  if (captionChanged) window.dispatchEvent(new Event('nai-gallery-caption-change'));
  const accent = resolveThemeDetails(preferences.details, isDark)?.accentColor || preferences.accentColor;
  root.style.setProperty('--nai-accent', accent);
  applyThemeColors(root, preferences.palette, isDark, preferences.surfaces === 'translucent', accent);
  applyThemeDetails(root, preferences.details, preferences);
  applyThemeBackground(root, resolveWorkspaceBackground(preferences.workspaceBackgrounds, preferences.activePresetId || 'builtin-default', isDark ? 'dark' : 'light', preferences.background));
  root.style.colorScheme = isDark ? 'dark' : 'light';
};

// 信息栏高度影响瀑布流分列；切换外观时同步更新各图库的高度估算。
const subscribeGalleryCaption = (listener: () => void) => {
  window.addEventListener('nai-gallery-caption-change', listener);
  return () => window.removeEventListener('nai-gallery-caption-change', listener);
};
export const useGalleryFrostedCaption = () => useSyncExternalStore(
  subscribeGalleryCaption,
  () => document.documentElement.dataset.galleryFrostedCaption !== 'false',
);

/** App 挂载前和系统明暗变化时恢复外观，访问门禁与错误页也使用同一套偏好。 */
export const restoreAppearancePreferences = () => {
  const preferences = loadAppearancePreferences();
  const isDark = preferences.themeMode === 'dark'
    || (preferences.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyAppearancePreferences(preferences, isDark);
};

/** JS 发起的滚动不会被 CSS 动画时长约束，显式遵循项目与系统的减少动画设置。 */
export const appearanceScrollBehavior = (): ScrollBehavior => document.documentElement.dataset.motion === 'full'
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
