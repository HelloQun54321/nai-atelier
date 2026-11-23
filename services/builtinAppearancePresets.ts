import cupertinoJson from '../public/themes/cupertino-liquid-glass.json?raw';
import { BUILTIN_APPEARANCE_PRESET, type AppearancePreset } from './appearancePreferences';
import { readAppearancePresetImport } from './appearancePresets';

/** 第二套内置主题：液态玻璃；与公开 JSON 共用原件。 */
export const CUPERTINO_LIQUID_GLASS_PRESET: AppearancePreset = {
  ...readAppearancePresetImport(cupertinoJson)[0],
  id: 'builtin-cupertino-liquid-glass',
  createdAt: 0,
  isBuiltin: true,
};

/** 新安装与「恢复出厂默认」使用的内置主题（NAI Atelier 默认·白天透光）。 */
export const DEFAULT_ACTIVE_APPEARANCE_PRESET = BUILTIN_APPEARANCE_PRESET;

// 出厂默认排在首位，液态玻璃仍可选用。
export const BUILTIN_APPEARANCE_PRESETS: AppearancePreset[] = [
  BUILTIN_APPEARANCE_PRESET,
  CUPERTINO_LIQUID_GLASS_PRESET,
];
