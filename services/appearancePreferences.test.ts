import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAB_MODULE_COLLAPSED,
  normalizeAppearancePreferences,
} from './appearancePreferences';

describe('appearance preferences', () => {
  it('accepts a complete supported theme customization', () => {
    expect(normalizeAppearancePreferences({
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
      labModuleOrder: ['params', 'prompt', 'negative', 'vibe', 'characters', 'characterReference'],
      labModuleCollapsed: {
        prompt: true,
        characters: false,
        params: true,
        negative: false,
        characterReference: false,
        vibe: true,
      },
    })).toEqual({
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
});
