import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
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
    })).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });
});
