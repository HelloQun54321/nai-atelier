import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_APPEARANCE_PRESETS, CUPERTINO_LIQUID_GLASS_PRESET, DEFAULT_ACTIVE_APPEARANCE_PRESET } from '../../services/builtinAppearancePresets';
import { appearanceMatchesPreset, appearanceValues, BUILTIN_APPEARANCE_PRESET, DEFAULT_APPEARANCE_PREFERENCES, normalizeAppearancePreferences, readAppearancePresetImport, serializeAppearancePresets } from '../../services/appearancePreferences';

describe('内置外观主题', () => {
  it('全新工坊默认液态玻璃深色，苹果参数直接来自公开原件且三项效果开启', () => {
    expect(BUILTIN_APPEARANCE_PRESETS[0]).toBe(CUPERTINO_LIQUID_GLASS_PRESET);
    expect(BUILTIN_APPEARANCE_PRESETS[1]).toBe(BUILTIN_APPEARANCE_PRESET);
    expect(BUILTIN_APPEARANCE_PRESETS.map(preset => preset.id)).toEqual(['builtin-cupertino-liquid-glass', 'builtin-default']);
    const glass = DEFAULT_ACTIVE_APPEARANCE_PRESET;
    const exported = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'))[0];
    expect(appearanceValues(glass)).toEqual(appearanceValues(exported));
    expect(glass).toMatchObject({ isBuiltin: true, createdAt: 0, themeMode: 'dark', galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true, details: { material: 'glass', light: { accentColor: '#007aff' }, dark: { accentColor: '#0a84ff' } } });
    expect(DEFAULT_APPEARANCE_PREFERENCES.activePresetId).toBe('builtin-cupertino-liquid-glass');
    expect(DEFAULT_APPEARANCE_PREFERENCES.themeMode).toBe('dark');
    expect(appearanceMatchesPreset(DEFAULT_APPEARANCE_PREFERENCES, glass)).toBe(true);
    expect(normalizeAppearancePreferences({ ...appearanceValues(glass), activePresetId: glass.id }).activePresetId).toBe(glass.id);
  });

  it('每个内置主题导出后都能作为普通副本导入，不携带锁定身份', () => {
    for (const preset of BUILTIN_APPEARANCE_PRESETS) {
      const [imported] = readAppearancePresetImport(serializeAppearancePresets([preset]));
      expect(imported.isBuiltin).toBeUndefined();
      expect(appearanceValues(imported)).toEqual(appearanceValues(preset));
    }
  });
});
