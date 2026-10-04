// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES, AppearancePreferences } from '../../services/appearancePreferences';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { GlobalSettings } from '../../components/GlobalSettings';
import { readAgentPage } from '../../services/agentWorkspace';
import { getCleanSharedImages, IMAGE_SHARING_STORAGE_KEY } from '../../services/imageSharing';
import { readActiveNaiKey, REMEMBER_NAI_KEY_STORAGE_KEY, setActiveNaiKey } from '../../services/naiKeyStorage';
const lowMode = vi.hoisted(() => ({ enabled: false, save: vi.fn() }));
const subscriptionFixture = vi.hoisted(() => ({ expired: false, balance: undefined as { fixedTrainingStepsLeft: number; purchasedTrainingSteps: number } | undefined, usage: undefined as import('../../services/naiUsage').NovelaiUsageState | undefined, refresh: vi.fn(async () => null) }));
vi.mock('../../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiUsage')>(),
  useNovelaiUsage: () => ({ info: subscriptionFixture.expired || subscriptionFixture.balance || subscriptionFixture.usage ? { active: !subscriptionFixture.expired, tier: 3, trainingStepsLeft: subscriptionFixture.balance } : null, usage: subscriptionFixture.usage, loading: false, error: null, fetchedAt: 0, refresh: subscriptionFixture.refresh }),
}));
vi.mock('../../services/lowConsumption', () => ({ useLowConsumption: () => ({ enabled: lowMode.enabled }), setLowConsumption: lowMode.save }));

vi.mock('../../services/mobileImageCache', () => ({
  clearMobileThumbnailCache: vi.fn(),
  getMobileCacheLimitMb: () => 50,
  getMobileCacheStats: () => ({ count: 0, bytes: 0, pinnedCount: 0, pinnedBytes: 0, limitMb: 50, limitBytes: 0, pinnedLimitBytes: 0 }),
  refreshMobileCacheMetadata: async () => ({ count: 0, bytes: 0, pinnedCount: 0, pinnedBytes: 0, limitMb: 50, limitBytes: 0, pinnedLimitBytes: 0 }),
  setMobileCacheLimitMb: vi.fn(),
}));

vi.mock('../../components/MobileUI', () => ({
  useMobileHistoryLayer: (_open: boolean, onClose: () => void) => onClose,
}));

vi.mock('../../services/anlasBudget', () => ({
  DEFAULT_ANLAS_BUDGET: 1666,
  getActiveKeyHash: async () => '',
  anlasBudgetService: { set: vi.fn(), resetPersonal: vi.fn() },
  useAnlasBudget: () => ({ remaining: 1666, personal: null, loading: false, refresh: vi.fn() }),
}));

vi.mock('../../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/naiRuntime')>();
  const runtime = { ...actual.DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } };
  return { ...actual, getNaiRuntimeConfig: async () => runtime, useNaiRuntime: () => runtime };
});

vi.mock('../../services/cloudQueue', () => {
  const preferences = { enabled: false, serviceUrl: 'https://example.invalid', greeting: '', showGreeting: true };
  return {
    CLOUD_QUEUE_SERVICE_URL: preferences.serviceUrl,
    getCachedCloudQueuePreferences: () => preferences,
    getCloudQueuePreferences: async () => preferences,
    setCloudQueuePreferences: async (next: typeof preferences) => next,
  };
});

vi.mock('../../services/naiKeyVault', () => ({
  naiKeyVault: {
    list: () => Promise.resolve(subscriptionFixture.expired ? [{ id: 'expired', name: '测试过期订阅', key: 'pst-settings-expired', createdAt: 0 }] : []),
    activate: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(() => Promise.resolve([])),
    clearActive: vi.fn(),
    rename: vi.fn(() => Promise.resolve([])),
  },
}));

interface SettingsHarnessProps {
  initialSection?: 'home' | 'appearance' | 'generation' | 'novelai' | 'agent' | 'privacy' | 'maintenance';
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
  it('设置首页省去分类说明，仍可进入分类并保留隐私后果', async () => {
    const { container } = render(React.createElement(SettingsHarness, { initialSection: 'home' }));
    expect(container.textContent).not.toMatch(/独立页面中打开|主题预设、防社死|连接信息和本地数据维护/);
    const entries = screen.getAllByRole('button', { name: '隐私与分享' });
    fireEvent.click(entries.at(-1)!);
    const toggle = await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement;
    expect(screen.getByText('复制／下载时移除生成信息；原图与历史保留。')).toBeTruthy();
    fireEvent.click(toggle);
    expect(getCleanSharedImages()).toBe(true);
  });

  beforeEach(() => {
    subscriptionFixture.expired = false;
    subscriptionFixture.balance = undefined;
    subscriptionFixture.usage = undefined;
    subscriptionFixture.refresh.mockClear();
    lowMode.enabled = false;
    lowMode.save.mockReset().mockImplementation(async (enabled: boolean) => { lowMode.enabled = enabled; return { enabled }; });
    sessionStorage.clear(); localStorage.clear();
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
  it('Key 默认记住，取消后重开仍为关闭，重新开启保存当前 Key', async () => {
    const view = render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const toggle = screen.getByRole('checkbox', { name: '在本机记住当前使用的 API Key' }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(localStorage.getItem(REMEMBER_NAI_KEY_STORAGE_KEY)).toBe('false');
    view.unmount();
    setActiveNaiKey('mock-settings-key');
    expect(localStorage.getItem('nai_api_key')).toBeNull();
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const reopened = screen.getByRole('checkbox', { name: '在本机记住当前使用的 API Key' }) as HTMLInputElement;
    expect(reopened.checked).toBe(false);
    fireEvent.click(reopened);
    expect(localStorage.getItem('nai_api_key')).toBe('mock-settings-key');
    expect(readActiveNaiKey()).toBe('mock-settings-key');
  });
  it.each([false, true])('隐私开关默认关闭，保存并重开后保持，手机视图=%s', async mobile => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: mobile && (query.includes('1023px') || query.includes('767px')),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const view = render(React.createElement(SettingsHarness, { initialSection: 'privacy' }));
    const toggle = await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(getCleanSharedImages()).toBe(true);
    expect(localStorage.getItem(IMAGE_SHARING_STORAGE_KEY)).toBe('true');
    view.unmount();
    render(React.createElement(SettingsHarness, { initialSection: 'privacy' }));
    expect((await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/原图与历史保留/)).toBeTruthy();
  });
  it('当前 Key 订阅过期时显示琥珀色订阅状态，提示 Paid Anlas，不误标为密钥失效', async () => {
    subscriptionFixture.expired = true;
    sessionStorage.setItem('nai_api_key', 'pst-settings-expired');
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const badge = await screen.findByText('订阅过期');
    expect(badge.className).toContain('text-amber-700');
    expect(badge.title).toContain('Paid Anlas');
    expect(screen.queryByText('已失效')).toBeNull();
    expect(screen.queryByText('非 Opus')).toBeNull();
  });
  it.each([false, true])('账户设置完整展示真实 Opus 百分比与换算张数，点按刷新，手机视图=%s', async mobile => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    subscriptionFixture.usage = { percent: 196, isNegative: false, timeUntilNextPercent: 0 };
    sessionStorage.setItem('nai_api_key', 'settings-opus-fixture');
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const quota = await screen.findByRole('status', { name: /Opus 生成限额 196%/ });
    expect(screen.getByText('≈3391 张')).toBeTruthy();
    expect(screen.getByText('V5 等受限模型共用额度')).toBeTruthy();
    const columns = screen.getByText('剩余额度').parentElement?.parentElement;
    expect(columns?.className).toContain('grid-cols-2');
    expect(screen.getByText('≈3391 张').parentElement?.parentElement).toBe(columns);
    fireEvent.click(quota);
    expect(subscriptionFixture.refresh).toHaveBeenCalledTimes(1);
  });
  it('设置页共用个人预算／官方总余额显示，可点按刷新且不改写预算输入', async () => {
    subscriptionFixture.balance = { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 200 };
    sessionStorage.setItem('nai_api_key', 'settings-balance-test-key');
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const balanceRow = await screen.findByRole('button', { name: /个人剩余预算 1,666 点.*账号剩余点数 300 点/ });
    expect(balanceRow.title).toContain('订阅赠送：100 点；Paid Anlas：200 点');
    expect(screen.getByText('本地预算 ≠ 官方余额')).toBeTruthy();
    fireEvent.click(balanceRow);
    expect(subscriptionFixture.refresh).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('spinbutton', { name: '可支配 Anlas 点数' }) as HTMLInputElement).value).toBe('1666');
  });
  it('低消耗开关按当前 Key 保存，保留零 Anlas 与 Opus 后果', async () => {
    sessionStorage.setItem('nai_api_key', 'settings-test-key');
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const toggle = await screen.findByRole('checkbox', { name: '低消耗模式' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(lowMode.save).toHaveBeenCalledWith(true, 'settings-test-key'));
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText('仅零 Anlas 文生图／Focused 重绘；V5 仍消耗 Opus。')).toBeTruthy();
    expect(screen.queryByText(/低消耗可用 1500 点/)).toBeNull();
  });
  it('尚未配置 Key 时开关禁用', async () => {
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    expect((await screen.findByRole('checkbox', { name: '低消耗模式' }) as HTMLInputElement).disabled).toBe(true);
    expect(lowMode.save).not.toHaveBeenCalled();
  });
  it('低消耗设置只展示两模式布局，隐藏角色参考和解除步数限制，关闭恢复全部控件', async () => {
    lowMode.enabled = true;
    const { container, rerender } = render(React.createElement(SettingsHarness, { initialSection: 'generation' }));
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(screen.queryByText('生成步数锁定在免费额度内')).toBeNull();
    expect(screen.queryByText(/^\d+\. 角色参考$/)).toBeNull();
    expect(screen.queryByText('图生图')).toBeNull();
    expect(screen.queryByText('扩图')).toBeNull();
    lowMode.enabled = false;
    rerender(React.createElement(SettingsHarness, { initialSection: 'generation' }));
    expect(container.querySelectorAll('details')).toHaveLength(4);
    expect(screen.getByText('生成步数锁定在免费额度内')).toBeTruthy();
    expect(screen.getAllByText(/^\d+\. 角色参考$/).length).toBeGreaterThan(0);
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

  it('支持 6 分类独立导航且各区专属内容正常展示与切换', async () => {
    render(React.createElement(SettingsHarness));

    // 验证侧边栏包含全部分类导航
    expect(screen.getByRole('button', { name: /外观与画廊/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /生图偏好与实验室/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /NovelAI 与 Anlas/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /项目 Agent/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /隐私与分享/ })).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: /隐私与分享/ }));
    expect((await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement).checked).toBe(false);

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

    expect(await screen.findByText('手机端固定')).toBeTruthy();
    expect(screen.queryByText(/三段式标签流|当前设备处于移动视图/)).toBeNull();
    const resetBtn = screen.getByRole('button', { name: /全部推荐/ }) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
  });
it('Agent 能看到普通外观设置和关闭入口，NovelAI 密钥区域仍不可读取', async () => {
  render(React.createElement(SettingsHarness, { initialSection: 'appearance' }));
  const page = readAgentPage({ query: '关闭' }); expect(page.controls.some(item => item.actions.includes('click'))).toBe(true);
  expect(readAgentPage().text).toContain('外观');
  cleanup(); subscriptionFixture.expired = true;
  render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
  await screen.findByText('测试过期订阅');
  expect(JSON.stringify(readAgentPage())).not.toMatch(/pst-settings-expired|测试过期订阅/);
});

});
