import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAB_MODULE_COLLAPSED,
  DEFAULT_LAB_PAGE_LAYOUTS,
  normalizeAppearancePreferences,
  parseAppearancePresetsFromJson,
  validateAppearancePreset,
} from './appearancePreferences';

describe('appearance preferences', () => {
  it('accepts a complete supported theme customization', () => {
    const normalized = normalizeAppearancePreferences({
      designTheme: 'nai-atelier',
      themeMode: 'dark',
      accentColor: '#0EA5E9',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'large',
      tagAssistEnabled: false,
      generationStreamPreview: true,
      labModuleOrder: ['params', 'prompt', 'negative', 'vibe', 'characters', 'characterReference'],
      labModuleCollapsed: {
        prompt: true,
        characters: false,
        params: true,
        negative: false,
        characterReference: false,
        vibe: true,
      },
    });
    expect(normalized).toEqual({
      designTheme: 'nai-atelier',
      themeMode: 'dark',
      accentColor: '#0ea5e9',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'large',
      tagAssistEnabled: false,
      generationStreamPreview: true,
      labModuleOrder: ['params', 'prompt', 'negative', 'vibe', 'characters', 'characterReference'],
      labModuleCollapsed: {
        prompt: true,
        characters: false,
        params: true,
        negative: false,
        characterReference: false,
        vibe: true,
      },
      labPageLayouts: {
        ...DEFAULT_LAB_PAGE_LAYOUTS,
        'text-to-image': {
          order: ['params', 'prompt', 'negative', 'vibe', 'characters', 'characterReference'],
          collapsed: {
            prompt: true,
            characters: false,
            params: true,
            negative: false,
            characterReference: false,
            vibe: true,
          },
        },
      },
      customPresets: [],
      activePresetId: 'builtin-default',
    });
  });

  it('falls back safely when persisted values are malformed', () => {
    expect(normalizeAppearancePreferences({
      designTheme: 'unknown',
      themeMode: 'sepia',
      accentColor: 'red',
      density: 3,
      corners: null,
      surfaces: 'glassier',
      motion: 'fast',
      fontScale: 'huge',
      tagAssistEnabled: 'sometimes',
      generationStreamPreview: 'sometimes',
      labModuleOrder: 'anything',
      labModuleCollapsed: null,
    })).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('repairs duplicated, unknown and incomplete laboratory module preferences', () => {
    const normalized = normalizeAppearancePreferences({
      labModuleOrder: ['vibe', 'unknown', 'prompt', 'vibe'],
      labModuleCollapsed: { vibe: false, prompt: 'yes' },
    });

    expect(normalized.labModuleOrder).toEqual([
      'vibe',
      'prompt',
      'characters',
      'params',
      'negative',
      'characterReference',
    ]);
    expect(normalized.labModuleCollapsed).toEqual({
      ...DEFAULT_LAB_MODULE_COLLAPSED,
      vibe: false,
    });
  });

  it('keeps legacy text layout and creates independent edit layouts', () => {
    const normalized = normalizeAppearancePreferences({
      labModuleOrder: ['negative', 'prompt'],
      labModuleCollapsed: { negative: true },
    });

    expect(normalized.labPageLayouts['text-to-image'].order).toEqual([
      'negative',
      'prompt',
      'characters',
      'params',
      'characterReference',
      'vibe',
    ]);
    expect(normalized.labPageLayouts['text-to-image'].collapsed.negative).toBe(true);
    expect(normalized.labPageLayouts['image-to-image']).toEqual(DEFAULT_LAB_PAGE_LAYOUTS['image-to-image']);
    expect(normalized.labPageLayouts.inpaint).not.toBe(normalized.labPageLayouts.outpaint);
  });

  it('repairs each persisted laboratory page independently', () => {
    const normalized = normalizeAppearancePreferences({
      labPageLayouts: {
        inpaint: {
          order: ['editSettings', 'prompt', 'unknown', 'prompt'],
          collapsed: { editSettings: true },
        },
      },
    });

    expect(normalized.labPageLayouts.inpaint.order).toEqual([
      'editSettings',
      'prompt',
      'baseImage',
      'params',
      'characterReference',
      'vibe',
    ]);
    expect(normalized.labPageLayouts.inpaint.collapsed.editSettings).toBe(true);
    expect(normalized.labPageLayouts.outpaint.order).toEqual(DEFAULT_LAB_PAGE_LAYOUTS.outpaint.order);
  });

  it('validates and normalizes appearance presets', () => {
    expect(validateAppearancePreset(null)).toBeNull();
    expect(validateAppearancePreset({})).toBeNull();
    expect(validateAppearancePreset({ name: '   ' })).toBeNull();

    const valid = validateAppearancePreset({
      name: '深夜极客',
      accentColor: '#14B8A6',
      themeMode: 'dark',
      density: 'compact',
      corners: 'sharp',
      surfaces: 'translucent',
      motion: 'reduced',
      fontScale: 'small',
    });
    expect(valid).not.toBeNull();
    expect(valid?.name).toBe('深夜极客');
    expect(valid?.accentColor).toBe('#14b8a6');
    expect(valid?.density).toBe('compact');
    expect(valid?.corners).toBe('sharp');
    expect(valid?.surfaces).toBe('translucent');
  });

  it('parses appearance presets from various JSON formats safely', () => {
    expect(parseAppearancePresetsFromJson('invalid json')).toEqual([]);

    const singleJson = JSON.stringify({
      name: '单项预设',
      accentColor: '#8b5cf6',
      themeMode: 'light',
    });
    const parsedSingle = parseAppearancePresetsFromJson(singleJson);
    expect(parsedSingle).toHaveLength(1);
    expect(parsedSingle[0].name).toBe('单项预设');
    expect(parsedSingle[0].accentColor).toBe('#8b5cf6');

    const arrayJson = JSON.stringify([
      { name: '预设 1', accentColor: '#0ea5e9' },
      { name: '预设 2', accentColor: '#e11d48' },
      { invalid: true },
    ]);
    const parsedArray = parseAppearancePresetsFromJson(arrayJson);
    expect(parsedArray).toHaveLength(2);
    expect(parsedArray[0].name).toBe('预设 1');
    expect(parsedArray[1].name).toBe('预设 2');

    const wrappedJson = JSON.stringify({
      presets: [
        { name: '包装预设', accentColor: '#d97706' },
      ],
    });
    const parsedWrapped = parseAppearancePresetsFromJson(wrappedJson);
    expect(parsedWrapped).toHaveLength(1);
    expect(parsedWrapped[0].name).toBe('包装预设');
  });

  it('preserves custom presets and active preset id in preferences', () => {
    const normalized = normalizeAppearancePreferences({
      customPresets: [
        { id: 'custom-1', name: '我的预设', accentColor: '#0ea5e9', createdAt: 1000 },
      ],
      activePresetId: 'custom-1',
    });
    expect(normalized.customPresets).toHaveLength(1);
    expect(normalized.customPresets[0].id).toBe('custom-1');
    expect(normalized.customPresets[0].name).toBe('我的预设');
    expect(normalized.activePresetId).toBe('custom-1');
  });
});
