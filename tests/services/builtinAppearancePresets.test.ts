import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_APPEARANCE_PRESETS, CUPERTINO_LIQUID_GLASS_PRESET, DEFAULT_ACTIVE_APPEARANCE_PRESET } from '../../services/builtinAppearancePresets';
import { appearanceMatchesPreset, appearanceValues, BUILTIN_APPEARANCE_PRESET, DEFAULT_APPEARANCE_PREFERENCES, normalizeAppearancePreferences, readAppearancePresetImport, serializeAppearancePresets } from '../../services/appearancePreferences';

describe('内置外观主题', () => {
  it('全新工坊默认 NAI Atelier 默认白天透光，Cupertino 液态玻璃仍保留且与公开原件一致', () => {
    expect(BUILTIN_APPEARANCE_PRESETS[0]).toBe(BUILTIN_APPEARANCE_PRESET);
    expect(BUILTIN_APPEARANCE_PRESETS[1]).toBe(CUPERTINO_LIQUID_GLASS_PRESET);
    expect(BUILTIN_APPEARANCE_PRESETS.map(preset => preset.id)).toEqual(['builtin-default', 'builtin-cupertino-liquid-glass']);
    expect(DEFAULT_ACTIVE_APPEARANCE_PRESET).toBe(BUILTIN_APPEARANCE_PRESET);
    expect(DEFAULT_ACTIVE_APPEARANCE_PRESET).toMatchObject({
      isBuiltin: true,
      createdAt: 0,
      accentColor: '#0d8bf2',
      themeMode: 'light',
      density: 'standard',
      corners: 'standard',
      surfaces: 'translucent',
      motion: 'full',
      fontScale: 'standard',
      gallerySelectionFocus: true,
      galleryFrostedCaption: true,
      galleryHoverFloat: true,
      galleryPointerTilt: false,
    });
    expect(DEFAULT_APPEARANCE_PREFERENCES.activePresetId).toBe('builtin-default');
    expect(DEFAULT_APPEARANCE_PREFERENCES.themeMode).toBe('light');
    expect(DEFAULT_APPEARANCE_PREFERENCES.surfaces).toBe('translucent');
    expect(appearanceMatchesPreset(DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_ACTIVE_APPEARANCE_PRESET)).toBe(true);
    const exported = readAppearancePresetImport(readFileSync('public/themes/cupertino-liquid-glass.json', 'utf8'))[0];
    expect(appearanceValues(CUPERTINO_LIQUID_GLASS_PRESET)).toEqual(appearanceValues(exported));
    expect(CUPERTINO_LIQUID_GLASS_PRESET).toMatchObject({ isBuiltin: true, createdAt: 0, themeMode: 'dark', galleryFrostedCaption: true, galleryHoverFloat: true, galleryPointerTilt: false, gallerySelectionFocus: true, details: { material: 'glass', light: { accentColor: '#007aff' }, dark: { accentColor: '#0a84ff' } } });
    expect(normalizeAppearancePreferences({ ...appearanceValues(CUPERTINO_LIQUID_GLASS_PRESET), activePresetId: CUPERTINO_LIQUID_GLASS_PRESET.id }).activePresetId).toBe(CUPERTINO_LIQUID_GLASS_PRESET.id);
  });

  it('每个内置主题导出后都能作为普通副本导入，不携带锁定身份', () => {
    for (const preset of BUILTIN_APPEARANCE_PRESETS) {
      const [imported] = readAppearancePresetImport(serializeAppearancePresets([preset]));
      expect(imported.isBuiltin).toBeUndefined();
      expect(appearanceValues(imported)).toEqual(appearanceValues(preset));
    }
  });
});
