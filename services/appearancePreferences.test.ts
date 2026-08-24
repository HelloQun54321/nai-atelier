import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAB_MODULE_COLLAPSED,
  DEFAULT_LAB_PAGE_LAYOUTS,
  normalizeAppearancePreferences,
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
      splitPromptFields: false,
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
      splitPromptFields: false,
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
      splitPromptFields: 'sometimes',
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
});
