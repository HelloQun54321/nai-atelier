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
  'prompt',
  'baseImage',
  'params',
  'editSettings',
  'characterReference',
  'vibe',
];

const DEFAULT_LAB_EDIT_MODULE_COLLAPSED: LabPageLayout['collapsed'] = {
  prompt: false,
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
};

export interface AppearancePreferences {
  designTheme: DesignTheme;
  themeMode: ThemeMode;
  accentColor: string;
  density: InterfaceDensity;
  corners: CornerStyle;
  surfaces: SurfaceStyle;
  motion: MotionStyle;
  fontScale: FontScale;
  tagAssistEnabled: boolean;
  /** 在支持的模型上显示采样过程；这是当前设备的观看偏好，不写入风格串。 */
  generationStreamPreview: boolean;
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
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  designTheme: 'nai-atelier',
  themeMode: 'system',
  accentColor: '#0ea5e9',
  density: 'standard',
  corners: 'standard',
  surfaces: 'solid',
  motion: 'full',
  fontScale: 'standard',
  tagAssistEnabled: true,
  generationStreamPreview: false,
  forceEmptySeed: false,
  enforceFreeStepLimit: true,
  labModuleOrder: [...DEFAULT_LAB_MODULE_ORDER],
  labModuleCollapsed: { ...DEFAULT_LAB_MODULE_COLLAPSED },
  labPageLayouts: cloneDefaultLabPageLayouts(),
  customPresets: [],
  activePresetId: 'builtin-default',
};

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
  };
};

export const parseAppearancePresetsFromJson = (jsonText: string): AppearancePreset[] => {
  try {
    const parsed = JSON.parse(jsonText);
    const rawList = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).presets))
        ? (parsed as Record<string, unknown>).presets as unknown[]
        : [parsed];
    const results: AppearancePreset[] = [];
    for (const item of rawList) {
      const valid = validateAppearancePreset(item);
      if (valid && !valid.isBuiltin) {
        results.push(valid);
      }
    }
    return results;
  } catch {
    return [];
  }
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
    density: isOneOf(input.density, ['comfortable', 'standard', 'compact']) ? input.density : DEFAULT_APPEARANCE_PREFERENCES.density,
    corners: isOneOf(input.corners, ['soft', 'standard', 'sharp']) ? input.corners : DEFAULT_APPEARANCE_PREFERENCES.corners,
    surfaces: isOneOf(input.surfaces, ['solid', 'translucent']) ? input.surfaces : DEFAULT_APPEARANCE_PREFERENCES.surfaces,
    motion: isOneOf(input.motion, ['full', 'reduced', 'off']) ? input.motion : DEFAULT_APPEARANCE_PREFERENCES.motion,
    fontScale: isOneOf(input.fontScale, ['small', 'standard', 'large']) ? input.fontScale : DEFAULT_APPEARANCE_PREFERENCES.fontScale,
    tagAssistEnabled: typeof input.tagAssistEnabled === 'boolean'
      ? input.tagAssistEnabled
      : DEFAULT_APPEARANCE_PREFERENCES.tagAssistEnabled,
    generationStreamPreview: typeof input.generationStreamPreview === 'boolean'
      ? input.generationStreamPreview
      : DEFAULT_APPEARANCE_PREFERENCES.generationStreamPreview,
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
  // Safari 隐私模式/锁定模式或配额满时 setItem 会抛异常；调用点在 useLayoutEffect（渲染阶段），
  // 不兜底会击穿 React 树白屏，且每次改任意设置都会复现
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(LEGACY_THEME_KEY, normalized.themeMode);
  } catch {
    // 写入失败只影响持久化，本次会话内的偏好状态仍然有效
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
  root.style.setProperty('--nai-accent', preferences.accentColor);
  root.style.colorScheme = isDark ? 'dark' : 'light';
};
