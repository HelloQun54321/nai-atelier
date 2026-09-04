// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES, AppearancePreferences } from '../services/appearancePreferences';
import { ConfirmDialogProvider } from './ConfirmDialog';
import { GlobalSettings } from './GlobalSettings';

vi.mock('../services/mobileImageCache', () => ({
  clearMobileThumbnailCache: vi.fn(),
  getMobileCacheLimitMb: () => 50,
  getMobileCacheStats: () => ({ count: 0, bytes: 0, pinnedCount: 0, pinnedBytes: 0, limitMb: 50, limitBytes: 0, pinnedLimitBytes: 0 }),
  refreshMobileCacheMetadata: async () => ({ count: 0, bytes: 0, pinnedCount: 0, pinnedBytes: 0, limitMb: 50, limitBytes: 0, pinnedLimitBytes: 0 }),
  setMobileCacheLimitMb: vi.fn(),
}));

vi.mock('./MobileUI', () => ({
  useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose,
}));

vi.mock('../services/anlasBudget', () => ({
  DEFAULT_ANLAS_BUDGET: 1666,
  getActiveKeyHash: async () => '',
  anlasBudgetService: { set: vi.fn(), resetPersonal: vi.fn() },
  useAnlasBudget: () => ({ remaining: 1666, personal: null, loading: false, refresh: vi.fn() }),
}));

vi.mock('../services/naiRuntime', () => ({
  getNaiRuntimeConfig: async () => ({ imagesPerPercent: 17.3 }),
}));

vi.mock('../services/cloudQueue', () => {
  const preferences = { enabled: false, serviceUrl: 'https://example.invalid', greeting: '', showGreeting: true };
  return {
    CLOUD_QUEUE_SERVICE_URL: preferences.serviceUrl,
    getCachedCloudQueuePreferences: () => preferences,
    getCloudQueuePreferences: async () => preferences,
    setCloudQueuePreferences: async (next: typeof preferences) => next,
  };
});

vi.mock('../services/naiKeyVault', () => ({
  naiKeyVault: {
    list: () => Promise.resolve([]),
    activate: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(() => Promise.resolve([])),
    clearActive: vi.fn(),
    rename: vi.fn(() => Promise.resolve([])),
  },
}));

const SettingsHarness = () => {
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(DEFAULT_APPEARANCE_PREFERENCES);
  return React.createElement(ConfirmDialogProvider, null,
    React.createElement(GlobalSettings, {
      open: true,
      initialSection: 'appearance',
      onClose: vi.fn(),
      notify: vi.fn(),
      isDark: false,
      themeMode: 'light',
      setThemeMode: vi.fn(),
      appearancePreferences,
      setAppearancePreferences,
      safeMode: true,
      safeModeStartup: true,
      safeModeHideTitles: false,
      setSafeModeStartup: vi.fn(),
      setSafeModeHideTitles: vi.fn(),
      toggleSafeMode: vi.fn(),
    }));
};

describe('GlobalSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('打开设置并切换实验室布局折叠块时不会因失效事件对象崩溃', async () => {
    const { container } = render(React.createElement(SettingsHarness));

    expect(await screen.findByText('实验室模块布局')).toBeTruthy();
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(4);

    fireEvent.click(details[1].querySelector('summary')!);
    await waitFor(() => expect(details[1].open).toBe(true));
    expect(screen.getByText('实验室模块布局')).toBeTruthy();
  });
});
