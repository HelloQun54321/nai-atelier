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

interface SettingsHarnessProps {
  initialSection?: 'home' | 'appearance' | 'generation' | 'novelai' | 'agent' | 'maintenance';
}

const SettingsHarness: React.FC<SettingsHarnessProps> = ({ initialSection = 'appearance' }) => {
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(DEFAULT_APPEARANCE_PREFERENCES);
  return React.createElement(ConfirmDialogProvider, null,
    React.createElement(GlobalSettings, {
      open: true,
      initialSection,
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
    vi.stubGlobal('__APP_VERSION__', '1.0.0');
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

  it('打开设置并切换实验室布局折叠块时不会因失效事件对象崩溃，且默认全部收起', async () => {
    const { container } = render(React.createElement(SettingsHarness, { initialSection: 'generation' }));

    expect(await screen.findByText('实验室模块布局')).toBeTruthy();
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(4);

    // 验证文生图与其他三项一致，默认均处于收起状态
    details.forEach(d => expect(d.open).toBe(false));

    fireEvent.click(details[0].querySelector('summary')!);
    await waitFor(() => expect(details[0].open).toBe(true));
    expect(screen.getByText('实验室模块布局')).toBeTruthy();
  });

  it('支持 5 分类独立导航且各区专属内容正常展示与切换', async () => {
    render(React.createElement(SettingsHarness));

    // 验证侧边栏包含 5 大分类导航
    expect(screen.getByRole('button', { name: /外观与画廊/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /生图偏好与实验室/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /NovelAI 与 Anlas/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /项目 Agent/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /数据与维护/ })).toBeTruthy();

    // 初始外观区包含明暗模式、安全模式（防社死）与图片列表布局
    expect(screen.getByText('明暗模式')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^安全模式/ })).toBeTruthy();
    expect(screen.getByText('启动时自动开启安全模式')).toBeTruthy();
    expect(screen.getByText('图片列表布局')).toBeTruthy();

    // 切换至「生图偏好与实验室」
    fireEvent.click(screen.getByRole('button', { name: /生图偏好与实验室/ }));
    expect(await screen.findByText('生成过程预览')).toBeTruthy();
    expect(screen.getByText('强制清空随机种子（始终随机）')).toBeTruthy();
    expect(screen.getByText('生成步数锁定在免费额度内')).toBeTruthy();
    expect(screen.getByText('实验室模块布局')).toBeTruthy();

    // 切换至「数据与维护」
    fireEvent.click(screen.getByRole('button', { name: /数据与维护/ }));
    expect(await screen.findByText('重要数据备份')).toBeTruthy();
    expect(screen.getByText('局域网访问密码')).toBeTruthy();
  });

  it('选中的主题卡片强调色与色标会随着外观偏好的强调色改变而同步联动', async () => {
    const { container } = render(React.createElement(SettingsHarness));

    const activeCard = container.querySelector('.atelier-theme-card');
    expect(activeCard).toBeTruthy();

    // 初始状态下卡片底部色标为 #0ea5e9
    expect(activeCard?.textContent).toContain('#0ea5e9');

    // 点击第二个强调色（靛蓝 #6366f1）
    const indigoButton = screen.getByRole('button', { name: '强调色：靛蓝' });
    fireEvent.click(indigoButton);

    // 选中卡片的微缩骨架高亮条与卡片底部的十六进制色标应同步变为 #6366f1
    await waitFor(() => {
      expect(activeCard?.textContent).toContain('#6366f1');
    });

    const previewAccentBar = activeCard?.querySelector('.atelier-theme-preview span[style*="background-color"]');
    expect(previewAccentBar).toBeTruthy();
    expect(previewAccentBar?.getAttribute('style')).toContain('rgb(99, 102, 241)');
  });

  it('明暗模式和外观选项被选中时具有 dark:text-indigo-300 保证暗色高对比度', async () => {
    render(React.createElement(SettingsHarness));

    // 默认 standard 选项（界面密度、圆角语言、字号）均被选中且具有 dark:text-indigo-300
    const standardButtons = screen.getAllByRole('button', { name: '标准' });
    expect(standardButtons.length).toBeGreaterThan(0);
    standardButtons.forEach(btn => {
      expect(btn.className).toContain('dark:text-indigo-300');
    });

    // SettingsHarness 中当前 themeMode 为 'light'，因此「浅色」是选中的
    const lightModeBtn = screen.getByRole('button', { name: /浅色/ });
    expect(lightModeBtn.className).toContain('dark:text-indigo-300');
  });

  it('切换图片列表布局时正确切换选中态并更新本地偏好', async () => {
    render(React.createElement(SettingsHarness));

    const portraitBtn = screen.getByRole('button', { name: '竖向卡片' });
    const squareBtn = screen.getByRole('button', { name: '方形' });
    const masonryBtn = screen.getByRole('button', { name: '瀑布流' });

    // 点击「竖向卡片」
    fireEvent.click(portraitBtn);
    expect(portraitBtn.className).toContain('border-indigo-500');

    // 点击「方形」
    fireEvent.click(squareBtn);
    expect(squareBtn.className).toContain('border-indigo-500');

    // 点击「瀑布流」
    fireEvent.click(masonryBtn);
    expect(masonryBtn.className).toContain('border-indigo-500');
  });

  it('个性化强调色按钮具有 mobile-size-locked 防止移动端被拉伸为椭圆/蛋形', async () => {
    render(React.createElement(SettingsHarness));

    const indigoBtn = screen.getByRole('button', { name: '强调色：靛蓝' });
    expect(indigoBtn.className).toContain('mobile-size-locked');
    expect(indigoBtn.className).toContain('rounded-full');
  });

  it('在移动视图下实验室模块布局显示已锁定且操作按钮处于禁用状态', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('1023px') || query.includes('767px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    render(React.createElement(SettingsHarness, { initialSection: 'generation' }));

    expect(await screen.findByText('移动端已锁定')).toBeTruthy();
    expect(screen.getByText(/移动端已采用三段式标签流/)).toBeTruthy();
    const resetBtn = screen.getByRole('button', { name: /全部推荐/ }) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
  });
});

