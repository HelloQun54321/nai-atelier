// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES, AppearancePreferences, appearanceValues, BUILTIN_APPEARANCE_PRESET, readAppearancePresetImport } from '../../services/appearancePreferences';
import { downloadFile } from '../../services/fileDownload';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { GlobalSettings } from '../../components/GlobalSettings';
import { readAgentPage } from '../../services/agentWorkspace';
import { getCleanSharedImages, getSharedImageCustomText, getSharedImageCleanContent, IMAGE_SHARING_STORAGE_KEY, IMAGE_SHARING_TEXT_STORAGE_KEY, IMAGE_SHARING_CONTENT_STORAGE_KEY } from '../../services/imageSharing';
import { readActiveNaiKey, REMEMBER_NAI_KEY_STORAGE_KEY, setActiveNaiKey } from '../../services/naiKeyStorage';
import { naiKeyVault } from '../../services/naiKeyVault';
import { getImageDisplayPageOverride, getMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
const themeFixture = vi.hoisted(() => ({ presets: null as import('../../services/appearancePreferences').AppearancePreset[] | null, fail: false }));
vi.mock('../../services/sharedAppearancePresets', () => ({ sharedAppearancePresets: {
  load: vi.fn(async (legacy: import('../../services/appearancePreferences').AppearancePreset[]) => {
    if (themeFixture.fail) throw Error('offline');
    themeFixture.presets ??= [...legacy];
    return [...themeFixture.presets];
  }),
  add: vi.fn(async (items: import('../../services/appearancePreferences').AppearancePreset[]) => {
    if (themeFixture.fail) throw Error('offline');
    themeFixture.presets = [...(themeFixture.presets || []), ...items]; return [...themeFixture.presets];
  }),
  update: vi.fn(async (item: import('../../services/appearancePreferences').AppearancePreset) => {
    if (themeFixture.fail) throw Error('offline');
    themeFixture.presets = themeFixture.presets!.map(p => p.id === item.id ? item : p); return [...themeFixture.presets];
  }),
  rename: vi.fn(async (id: string, name: string) => {
    themeFixture.presets = themeFixture.presets!.map(p => p.id === id ? { ...p, name } : p); return [...themeFixture.presets];
  }),
  remove: vi.fn(async (id: string) => {
    themeFixture.presets = themeFixture.presets!.filter(p => p.id !== id); return [...themeFixture.presets];
  }),
} }));
const subscriptionFixture = vi.hoisted(() => ({ entries: [] as import('../../services/naiKeyVault').NaiKeyEntry[], expired: false, balance: undefined as { fixedTrainingStepsLeft: number; purchasedTrainingSteps: number } | undefined, usage: undefined as import('../../services/naiUsage').NovelaiUsageState | undefined, refresh: vi.fn(async () => null) }));
vi.mock('../../services/fileDownload', () => ({ downloadFile: vi.fn(async () => ({ saved: true, cancelled: false, browserDownload: true })) }));
vi.mock('../../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiUsage')>(),
  useNovelaiUsage: () => ({ info: subscriptionFixture.expired || subscriptionFixture.balance || subscriptionFixture.usage ? { active: !subscriptionFixture.expired, tier: 3, trainingStepsLeft: subscriptionFixture.balance } : null, usage: subscriptionFixture.usage, loading: false, error: null, fetchedAt: 0, refresh: subscriptionFixture.refresh }),
}));

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
    list: () => Promise.resolve(subscriptionFixture.entries.length ? subscriptionFixture.entries : subscriptionFixture.expired ? [{ id: 'expired', name: '测试过期订阅', key: 'pst-settings-expired', createdAt: 0 }] : []),
    activate: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(() => Promise.resolve([])),
    clearActive: vi.fn(),
    rename: vi.fn(() => Promise.resolve([])),
  },
}));

interface SettingsHarnessProps {
  initialSection?: 'home' | 'appearance' | 'generation' | 'novelai' | 'agent' | 'privacy' | 'maintenance';
  initialAppearancePreferences?: Partial<AppearancePreferences>;
  onAppearancePreferencesChange?: (preferences: AppearancePreferences) => void;
  notify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const SettingsHarness: React.FC<SettingsHarnessProps> = ({ initialSection = 'appearance', initialAppearancePreferences, onAppearancePreferencesChange, notify = vi.fn() }) => {
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(() => ({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    ...initialAppearancePreferences,
  }));
  React.useEffect(() => onAppearancePreferencesChange?.(appearancePreferences), [appearancePreferences, onAppearancePreferencesChange]);
  return React.createElement(ConfirmDialogProvider, null,
    React.createElement(GlobalSettings, {
      open: true,
      initialSection,
      onClose: vi.fn(),
      notify,
      isDark: false,
      themeMode: appearancePreferences.themeMode,
      setThemeMode: themeMode => setAppearancePreferences(current => ({ ...current, themeMode })),
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

const waitThemeLibrary = () => waitFor(() => expect((screen.getByRole('button', { name: '导入' }) as HTMLButtonElement).disabled).toBe(false));

describe('GlobalSettings', () => {
  it('无自定义主题且共享库离线时仍可选用内置苹果主题，锁定原件并保留生图偏好', async () => {
    themeFixture.fail = true;
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { initialAppearancePreferences: { gallerySelectionFocus: false, galleryFrostedCaption: false, galleryHoverFloat: false, forceEmptySeed: true, continuousGenerationEnabled: false }, onAppearancePreferencesChange: changed }));
    const glass = screen.getByRole('button', { name: '应用外观预设：Cupertino Liquid Glass' });
    expect(glass.textContent).toContain('内置锁定');
    expect(glass.textContent).not.toContain('石墨炭黑');
    expect(screen.queryByRole('button', { name: '删除「Cupertino Liquid Glass」' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重命名「Cupertino Liquid Glass」' })).toBeNull();
    fireEvent.click(glass);
    expect(changed.mock.lastCall?.[0]).toMatchObject({ activePresetId: 'builtin-cupertino-liquid-glass', gallerySelectionFocus: true, galleryFrostedCaption: true, galleryHoverFloat: true, forceEmptySeed: true, continuousGenerationEnabled: false, details: { material: 'glass' } });
    expect(glass.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '强调色：紫罗兰' }));
    expect(screen.getByText('当前外观已修改')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
    expect(screen.getByRole('button', { name: '另存当前主题' })).toBeTruthy();
    await screen.findByRole('alert');
  });

  it('明暗背景独立于主题原件，重新应用和往返切换预设仍然保留', async () => {
    const background = { image: 'data:image/png;base64,AAAA', fit: 'cover' as const, opacity: 1, tileSize: 128 };
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    themeFixture.presets = [{ ...BUILTIN_APPEARANCE_PRESET, id: 'with-background', isBuiltin: false, name: '带背景', background }];
    render(React.createElement(SettingsHarness, { onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：带背景' }));
    fireEvent.click(screen.getByText('工作区背景'));
    fireEvent.change(screen.getByLabelText('背景显示方式'), { target: { value: 'tile' } });
    expect(changed.mock.lastCall?.[0].workspaceBackgrounds?.['with-background'].light).toEqual({ ...background, fit: 'tile' });
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '深色背景' }));
    fireEvent.change(screen.getByLabelText('背景显示强度'), { target: { value: '40' } });
    expect(changed.mock.lastCall?.[0].workspaceBackgrounds?.['with-background'].dark).toEqual({ ...background, opacity: .4 });
    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：带背景' }));
    expect(changed.mock.lastCall?.[0].workspaceBackgrounds?.['with-background'].light?.fit).toBe('tile');
    fireEvent.click(screen.getByRole('button', { name: '恢复 NAI Atelier 默认外观' }));
    expect(changed.mock.lastCall?.[0].background).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：带背景' }));
    expect(changed.mock.lastCall?.[0].workspaceBackgrounds?.['with-background'].dark?.opacity).toBe(.4);
    expect(themeFixture.presets?.[0].background?.fit).toBe('cover');
  });
  it('另一浏览器读取工坊主题库，返回页面同步列表但保留本机当前外观', async () => {
    const preset = { ...BUILTIN_APPEARANCE_PRESET, id: 'shared', name: '共享主题', isBuiltin: false, accentColor: '#123456' };
    themeFixture.presets = [preset];
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { initialAppearancePreferences: { themeMode: 'light', accentColor: '#abcdef' }, onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    expect(screen.getByRole('button', { name: '应用外观预设：共享主题' })).toBeTruthy();
    expect(changed.mock.lastCall?.[0]).toMatchObject({ themeMode: 'light', accentColor: '#abcdef', activePresetId: 'builtin-default' });
    themeFixture.presets = [{ ...preset, name: '另一浏览器改名' }];
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('button', { name: '应用外观预设：另一浏览器改名' });
    expect(changed.mock.lastCall?.[0].accentColor).toBe('#abcdef');
  });
  it('后端保存失败保留草稿与主题列表，不宣称成功，恢复连接后可重试', async () => {
    const notify = vi.fn();
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { notify, onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByRole('button', { name: '另存当前主题' }));
    const name = screen.getByPlaceholderText(/例如：晴空午夜/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: '保留草稿' } });
    themeFixture.fail = true;
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('主题库同步失败，修改尚未保存，请重试');
    expect(name.value).toBe('保留草稿');
    expect(changed.mock.lastCall?.[0].customPresets).toHaveLength(0);
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('已保存'), 'success');
    themeFixture.fail = false;
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('button', { name: '应用外观预设：保留草稿' });
  });
  it('图库效果独立切换，外观预设保存并恢复选中聚焦模式', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { onAppearancePreferencesChange: changed }));
    const caption = await screen.findByRole('switch', { name: '全图磨砂卡片' });
    const hover = screen.getByRole('switch', { name: '卡片悬停浮动' });
    const focus = screen.getByRole('switch', { name: '选中作品聚焦模式' });
    expect(caption.getAttribute('aria-checked')).toBe('true');
    expect(hover.getAttribute('aria-checked')).toBe('true');
    expect(focus.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(caption);
    expect(changed.mock.lastCall?.[0]).toMatchObject({ galleryFrostedCaption: false, galleryHoverFloat: true });
    fireEvent.click(hover);
    fireEvent.click(focus);
    fireEvent.click(screen.getByRole('button', { name: '另存当前主题' }));
    fireEvent.change(screen.getByPlaceholderText(/例如：晴空午夜/), { target: { value: '安静卡片' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(changed.mock.lastCall?.[0].customPresets.at(-1)).toMatchObject({ galleryFrostedCaption: false, galleryHoverFloat: false, gallerySelectionFocus: false }));
    fireEvent.click(caption);
    fireEvent.click(hover);
    fireEvent.click(focus);
    expect(changed.mock.lastCall?.[0]).toMatchObject({ galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true });
    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：安静卡片' }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ galleryFrostedCaption: false, galleryHoverFloat: false, gallerySelectionFocus: false });
    fireEvent.click(screen.getByRole('button', { name: '恢复 NAI Atelier 默认外观' }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ galleryFrostedCaption: true, galleryHoverFloat: true, gallerySelectionFocus: true });
  });
  it('连续生成开关默认开启，点击后即时关闭', async () => {
    const onAppearancePreferencesChange = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, {
      initialSection: 'generation',
      onAppearancePreferencesChange,
    }));
    const toggle = await screen.findByRole('button', { name: /连续生成与排队/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(onAppearancePreferencesChange.mock.lastCall?.[0].continuousGenerationEnabled).toBe(false));
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('记住上次生图设置默认开启；可独立选择记忆内容，关闭主开关后保留选择', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { onAppearancePreferencesChange: changed }));
    expect(screen.queryByRole('switch', { name: '记住上次生图设置' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生图偏好与实验室/ }));
    const toggle = await screen.findByRole('switch', { name: '记住上次生图设置' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const fields = ['参数设置', '全局正向提示词', '全局负面提示词', '角色正向提示词', '角色负面提示词'];
    for (const field of fields) expect((screen.getByRole('checkbox', { name: field }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('重启后仅恢复勾选的内容。不影响当前输入或已保存的预设。')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: '全局正向提示词' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '全局负面提示词' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '角色正向提示词' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '角色负面提示词' }));
    expect(changed.mock.lastCall?.[0].generationMemory).toEqual({ parameters: true, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false });
    fireEvent.click(screen.getByRole('checkbox', { name: '参数设置' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '角色负面提示词' }));
    expect(changed.mock.lastCall?.[0].generationMemory).toEqual({ parameters: false, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: true });

    fireEvent.click(toggle);
    await waitFor(() => expect(changed.mock.lastCall?.[0].rememberGenerationSettings).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    for (const field of fields) expect(screen.queryByRole('checkbox', { name: field })).toBeNull();
    expect(changed.mock.lastCall?.[0].generationMemory).toEqual({ parameters: false, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: true });
    fireEvent.click(toggle);
    for (const field of fields) expect((await screen.findByRole('checkbox', { name: field }) as HTMLInputElement).checked).toBe(field === '角色负面提示词');
  });

  it('应用外观预设和恢复默认外观不会重置连续生成偏好', async () => {
    const onAppearancePreferencesChange = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, {
      initialAppearancePreferences: { continuousGenerationEnabled: false, rememberGenerationSettings: false, generationMemory: { parameters: false, globalPrompt: true, negativePrompt: false, characterPrompt: true, characterNegativePrompt: false } },
      onAppearancePreferencesChange,
    }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByRole('button', { name: '另存当前主题' }));
    fireEvent.change(screen.getByPlaceholderText(/例如：晴空午夜/), { target: { value: '生图偏好不变' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(
      onAppearancePreferencesChange.mock.lastCall?.[0].customPresets.some(preset => preset.name === '生图偏好不变'),
    ).toBe(true));
    const savedPreset = onAppearancePreferencesChange.mock.lastCall?.[0].customPresets.find(preset => preset.name === '生图偏好不变');
    expect(savedPreset).not.toHaveProperty('continuousGenerationEnabled');
    expect(savedPreset).not.toHaveProperty('rememberGenerationSettings');
    expect(savedPreset).not.toHaveProperty('generationMemory');
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].continuousGenerationEnabled).toBe(false);
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].rememberGenerationSettings).toBe(false);
    const expectedGenerationMemory = { parameters: false, globalPrompt: true, negativePrompt: false, characterPrompt: true, characterNegativePrompt: false };
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].generationMemory).toEqual(expectedGenerationMemory);

    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：生图偏好不变' }));
    await waitFor(() => expect(onAppearancePreferencesChange.mock.lastCall?.[0].continuousGenerationEnabled).toBe(false));
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].rememberGenerationSettings).toBe(false);
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].generationMemory).toEqual(expectedGenerationMemory);
    fireEvent.click(screen.getByRole('button', { name: '恢复 NAI Atelier 默认外观' }));
    await waitFor(() => expect(onAppearancePreferencesChange.mock.lastCall?.[0].continuousGenerationEnabled).toBe(false));
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].rememberGenerationSettings).toBe(false);
    expect(onAppearancePreferencesChange.mock.lastCall?.[0].generationMemory).toEqual(expectedGenerationMemory);
  });
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
    themeFixture.presets = null; themeFixture.fail = false;
    vi.mocked(downloadFile).mockClear();
    subscriptionFixture.entries = [];
    vi.mocked(naiKeyVault.add).mockReset();
    vi.mocked(naiKeyVault.activate).mockReset();
    subscriptionFixture.expired = false;
    subscriptionFixture.balance = undefined;
    subscriptionFixture.usage = undefined;
    subscriptionFixture.refresh.mockClear();

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

  it('成员 Key 必须填写网关后添加；切回官方添加不携带网关地址', async () => {
    vi.mocked(naiKeyVault.add).mockResolvedValue({ status: 'added', entry: { id: 'added', name: '合成', key: 'STA1N-test', createdAt: 0 } });
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    fireEvent.change(await screen.findByLabelText('密钥接入方式'), { target: { value: 'gateway' } });
    fireEvent.change(screen.getByLabelText('成员 API Key'), { target: { value: 'STA1N-test' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(naiKeyVault.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('生图网关地址'), { target: { value: 'https://gateway.example/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(naiKeyVault.add).toHaveBeenCalledWith('', 'STA1N-test', 'https://gateway.example/v1'));
    await waitFor(() => expect((screen.getByLabelText('成员 API Key') as HTMLInputElement).value).toBe(''));
    fireEvent.change(screen.getByLabelText('密钥接入方式'), { target: { value: 'official' } });
    expect(screen.queryByLabelText('生图网关地址')).toBeNull();
    fireEvent.change(screen.getByLabelText('NovelAI API Key'), { target: { value: 'pst-official' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(naiKeyVault.add).toHaveBeenLastCalledWith('', 'pst-official'));
  });

  it('添加密钥后自动设为当前使用，避免“填了却没生效”', async () => {
    const entry = { id: 'auto', name: '新号', key: 'pst-auto-activate', createdAt: 0 };
    vi.mocked(naiKeyVault.add).mockResolvedValue({ status: 'added', entry });
    subscriptionFixture.entries = [entry];
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    fireEvent.change(await screen.findByLabelText('NovelAI API Key'), { target: { value: 'pst-auto-activate' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(naiKeyVault.activate).toHaveBeenCalledWith(entry, true));
    // 新 Key 立即成为当前使用项，不再需要额外点一次「使用」。
    expect(await screen.findByRole('button', { name: '使用中' })).toBeTruthy();
  });

  it('保管箱默认只显示脱敏 Key，可临时显示明文并复制，且同屏最多一把', async () => {
    const key = 'pst-view-1234';
    const otherKey = 'pst-backup-5678';
    sessionStorage.setItem('nai_api_key', key);
    subscriptionFixture.entries = [
      { id: 'view', name: '查看用', key, createdAt: 0 },
      { id: 'other', name: '备用', key: otherKey, createdAt: 0 },
    ];
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));

    expect(await screen.findByText('pst-vi…1234')).toBeTruthy();
    expect(screen.getByText('pst-ba…5678')).toBeTruthy();
    expect(screen.queryByText(key)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '显示完整 Key' })[0]);
    expect(screen.getByText(key)).toBeTruthy();
    // 点开一条不会连带显示其它条目。
    expect(screen.getByText('pst-ba…5678')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '隐藏完整 Key' }));
    expect(screen.queryByText(key)).toBeNull();

    // 复制走剪贴板，不需要先显示明文。
    fireEvent.click(screen.getAllByRole('button', { name: '复制完整 Key' })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(key));
    expect(screen.queryByText(key)).toBeNull();
  });

  it('当前成员 Key 显示网关来源并隐藏另一个公共队列地址', async () => {
    const key = 'STA1N-settings-gateway';
    sessionStorage.setItem('nai_api_key', key);
    subscriptionFixture.entries = [{ id: 'member', name: '合成车队', key, gatewayUrl: 'https://gateway.example', createdAt: 0 }];
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    expect(await screen.findByText('合成车队')).toBeTruthy();
    expect(screen.getByText('网关').title).toBe('https://gateway.example');
    expect(screen.queryByText('公共队列服务地址')).toBeNull();
    expect(screen.queryByText('格式可疑')).toBeNull();
  });
  it('成员接入五语标签与发送范围提示匹配控件，切换语言保留地址草稿', async () => {
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    fireEvent.change(await screen.findByLabelText('密钥接入方式'), { target: { value: 'gateway' } });
    const address = screen.getByLabelText('生图网关地址') as HTMLInputElement;
    fireEvent.change(address, { target: { value: 'https://gateway.example/v1' } });
    for (const language of LANGUAGES) {
      act(() => setLanguage(language.code));
      expect(screen.getByLabelText(t('生图网关地址'))).toBe(address);
      expect(address.value).toBe('https://gateway.example/v1');
      expect(screen.getByLabelText(t('成员 API Key'))).toBeTruthy();
      expect(screen.getByText(t('网关接收成员 Key、提示词及本次参考图；余额与扣费以网关为准，生图不提供实时预览。'))).toBeTruthy();
    }
  });

  afterEach(() => {
    cleanup();
    setLanguage('zh-CN');
    vi.unstubAllGlobals();
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
  it('真实设置选择五种语言，保存选择并保留未完成的自定义主题名称', () => {
    render(React.createElement(SettingsHarness));
    fireEvent.click(screen.getByRole('button', { name: '另存当前主题' }));
    const draft = screen.getByPlaceholderText(/例如：晴空午夜/) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: '取消, 我的主题' } });
    const select = screen.getByLabelText('语言') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.text)).toEqual(LANGUAGES.map(item => item.name));
    for (const item of LANGUAGES) {
      fireEvent.change(select, { target: { value: item.code } });
      expect(document.documentElement.lang).toBe(item.code);
      expect(localStorage.getItem('nai_language')).toBe(item.code);
      expect(screen.getByLabelText(t('语言'))).toBe(select);
      expect(draft.value).toBe('取消, 我的主题');
      expect(screen.getByRole('button', { name: t('另存当前主题') })).toBeTruthy();
    }
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
    expect(screen.getByText('复制／下载时移除生成信息；原图与历史保留。')).toBeTruthy();
  });
  it('安全模式与图片元数据清洗分属独立板块，自定义文本可保存并在关闭时保留', async () => {
    const view = render(React.createElement(SettingsHarness, { initialSection: 'privacy' }));
    const safeHeading = screen.getByRole('heading', { level: 3, name: '安全模式' });
    const cleanHeading = screen.getByRole('heading', { level: 3, name: '图片元数据清洗' });
    expect(safeHeading.parentElement).not.toBe(cleanHeading.parentElement);
    expect(screen.queryByRole('heading', { level: 3, name: '隐私与分享' })).toBeNull();

    const cleanToggle = await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement;
    const cleanContent = screen.getByRole('combobox', { name: '清洗内容' }) as HTMLSelectElement;
    const customText = screen.getByRole('textbox', { name: '自定义文本' }) as HTMLInputElement;
    const safeToggle = screen.getByRole('button', { name: /^安全模式/ });
    expect(cleanToggle.checked).toBe(false);
    expect(cleanContent.value).toBe('all');
    expect(getSharedImageCleanContent()).toBe('all');
    expect(cleanContent.disabled).toBe(true);
    expect(customText.value).toBe('');
    expect(customText.disabled).toBe(true);
    fireEvent.click(safeToggle);
    expect(cleanToggle.checked).toBe(false);
    fireEvent.click(cleanToggle);
    expect(safeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(cleanToggle.checked).toBe(true);
    expect(cleanContent.disabled).toBe(false);
    expect(customText.disabled).toBe(false);
    fireEvent.change(cleanContent, { target: { value: 'prompts' } });
    expect(getSharedImageCleanContent()).toBe('prompts');
    expect(localStorage.getItem(IMAGE_SHARING_CONTENT_STORAGE_KEY)).toBe('prompts');
    fireEvent.change(customText, { target: { value: '中文自定义文本 🌸' } });
    expect(getSharedImageCustomText()).toBe('中文自定义文本 🌸');
    expect(localStorage.getItem(IMAGE_SHARING_TEXT_STORAGE_KEY)).toBe('中文自定义文本 🌸');

    view.unmount();
    render(React.createElement(SettingsHarness, { initialSection: 'privacy' }));
    const reopenedToggle = await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement;
    const reopenedCleanContent = screen.getByRole('combobox', { name: '清洗内容' }) as HTMLSelectElement;
    const reopenedText = screen.getByRole('textbox', { name: '自定义文本' }) as HTMLInputElement;
    expect(reopenedToggle.checked).toBe(true);
    expect(reopenedCleanContent.value).toBe('prompts');
    expect(reopenedText.value).toBe('中文自定义文本 🌸');
    fireEvent.click(reopenedToggle);
    expect(reopenedCleanContent.disabled).toBe(true);
    expect(reopenedCleanContent.value).toBe('prompts');
    expect(reopenedText.disabled).toBe(true);
    expect(reopenedText.value).toBe('中文自定义文本 🌸');
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

  it('NovelAI 设置不再展示低消耗开关', async () => {
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    await screen.findByText('Anlas 点数预算');
    expect(screen.queryByRole('checkbox', { name: '低消耗模式' })).toBeNull();
  });

  it.each(['https://nai.ry.mk/ai/generate-image', 'https://relay.example/prefix/ai/generate-image/'])('通用中转 %s 明确传输内容，话语设置仅在 st-chatu 协议生效', async serviceUrl => {
    render(React.createElement(SettingsHarness, { initialSection: 'novelai' }));
    const address = await screen.findByRole('textbox', { name: '公共队列服务地址' });
    const enabled = screen.getByRole('checkbox', { name: '多人拼车公共队列' });
    fireEvent.click(enabled);
    await screen.findByRole('checkbox', { name: '显示当前使用者的个性语' });
    fireEvent.change(address, { target: { value: serviceUrl } });
    fireEvent.blur(address);
    await screen.findByText('按 Key 保存，由中转服务排队。');
    expect(screen.getByText(/启用中转会发送 Key、提示词及本次参考图/)).toBeTruthy();
    expect(screen.queryByText('不上传 Key、提示词或图片。')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '显示当前使用者的个性语' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '排队个性语（最多15字）' })).toBeNull();
    fireEvent.change(address, { target: { value: 'https://st-chatu-novelai-queue.hf.space/' } });
    fireEvent.blur(address);
    expect(await screen.findByRole('checkbox', { name: '显示当前使用者的个性语' })).toBeTruthy();
    expect(screen.getByText('不上传 Key、提示词或图片。')).toBeTruthy();
  });

  it('打开设置并切换实验室布局折叠块时不会因失效事件对象崩溃，且默认全部收起', async () => {
    const { container } = render(React.createElement(SettingsHarness, { initialSection: 'generation' }));

    expect(await screen.findByText('实验室模块布局')).toBeTruthy();
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(4);
    expect(screen.getByText('生成步数锁定在免费额度内')).toBeTruthy();
    expect(screen.getAllByText(/^\d+\. 角色参考$/).length).toBeGreaterThan(0);

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
    expect(screen.getByRole('button', { name: /创作助手/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /隐私与分享/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /数据与维护/ })).toBeTruthy();

    // 外观区保留明暗模式与图片列表布局，防窥设置归入隐私分类。
    expect(screen.getByText('明暗模式')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^安全模式/ })).toBeNull();
    expect(screen.queryByText('启动时自动开启安全模式')).toBeNull();
    expect(screen.getByText('图片列表布局')).toBeTruthy();

    // 切换至「生图偏好与实验室」
    fireEvent.click(screen.getByRole('button', { name: /生图偏好与实验室/ }));
    expect(await screen.findByText('生成过程预览')).toBeTruthy();
    expect(screen.getByText('强制清空随机种子（始终随机）')).toBeTruthy();
    expect(screen.getByText('生成步数锁定在免费额度内')).toBeTruthy();
    expect(screen.getByText('实验室模块布局')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /隐私与分享/ }));
    expect(await screen.findByRole('button', { name: /^安全模式/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /同时隐藏作品名称/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '启动时自动开启安全模式' })).toBeTruthy();
    expect((await screen.findByRole('checkbox', { name: '分享图片时移除生成信息' }) as HTMLInputElement).checked).toBe(false);

    // 切换至「数据与维护」
    fireEvent.click(screen.getByRole('button', { name: /数据与维护/ }));
    expect(await screen.findByText('重要数据备份')).toBeTruthy();
    expect(screen.getByText('局域网访问')).toBeTruthy();
  });

  it('当前外观修改不会改写已保存卡片，明确标记修改并提供当前外观导出', async () => {
    const { container } = render(React.createElement(SettingsHarness));

    const activeCard = container.querySelector('.atelier-theme-card');
    expect(activeCard).toBeTruthy();
    expect(activeCard?.parentElement?.classList.contains('grid-cols-1')).toBe(true);
    expect(activeCard?.parentElement?.classList.contains('sm:grid-cols-2')).toBe(false);

    // 初始状态下卡片底部色标为 #0ea5e9
    expect(activeCard?.textContent).toContain('#0ea5e9');

    // 点击第二个强调色（靛蓝 #6366f1）
    const indigoButton = screen.getByRole('button', { name: '强调色：靛蓝' });
    fireEvent.click(indigoButton);

    expect(await screen.findByText('当前外观已修改')).toBeTruthy();
    expect(activeCard?.getAttribute('aria-pressed')).toBe('false');
    expect(activeCard?.textContent).toContain('#0ea5e9');
    expect(activeCard?.textContent).not.toContain('#6366f1');

    const previewAccentBar = activeCard?.querySelector('.atelier-theme-preview [data-preview-part="action"]');
    expect(previewAccentBar).toBeTruthy();
    expect(previewAccentBar?.getAttribute('style')).toContain('rgb(11, 135, 191)');
    fireEvent.click(screen.getByRole('button', { name: '导出当前外观' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const reader = new FileReader();
    const json = await new Promise<string>(resolve => { reader.onload = () => resolve(String(reader.result)); reader.readAsText(vi.mocked(downloadFile).mock.calls[0][0] as Blob); });
    expect(readAppearancePresetImport(json)[0].accentColor).toBe('#6366f1');
  });

  it('基础强调色和圆角能接回明暗覆盖，保留其他高级材质', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    render(React.createElement(SettingsHarness, { initialAppearancePreferences: { details: { controlRadius: 8, dark: { accentColor: '#0a84ff', controlRadius: 6, blur: 28 }, light: { accentColor: '#007aff', panelRadius: 14 } } }, onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByRole('button', { name: '强调色：紫罗兰' }));
    expect(changed.mock.lastCall?.[0].accentColor).toBe('#8b5cf6');
    expect(changed.mock.lastCall?.[0].details?.dark?.accentColor).toBeUndefined();
    expect(changed.mock.lastCall?.[0].details?.light?.accentColor).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '锐利' }));
    expect(changed.mock.lastCall?.[0].details).toEqual({ dark: { blur: 28 } });
  });

  it('配色可以编辑并覆盖保存，恢复默认保留所有主题、生图偏好和布局', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    const preset = { ...BUILTIN_APPEARANCE_PRESET, id: 'paper', name: '纸张', isBuiltin: false };
    render(React.createElement(SettingsHarness, { initialAppearancePreferences: { customPresets: [preset], activePresetId: preset.id, generationStreamPreview: true, forceEmptySeed: true, enforceFreeStepLimit: false, tagAssistEnabled: false, continuousGenerationEnabled: false }, onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByText('自定义明暗配色'));
    fireEvent.change(screen.getByLabelText('浅色配色 · 背景'), { target: { value: '#fff4dd' } });
    expect(changed.mock.lastCall?.[0].palette).toEqual({ light: { canvas: '#fff4dd' } });
    expect(screen.getByRole('button', { name: '应用外观预设：纸张' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(changed.mock.lastCall?.[0].customPresets[0].palette).toEqual({ light: { canvas: '#fff4dd' } }));
    expect(screen.queryByText('当前外观已修改')).toBeNull();
    const layouts = changed.mock.lastCall?.[0].labPageLayouts;
    fireEvent.click(screen.getByRole('button', { name: '恢复 NAI Atelier 默认外观' }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ generationStreamPreview: true, forceEmptySeed: true, enforceFreeStepLimit: false, tagAssistEnabled: false, continuousGenerationEnabled: false, activePresetId: 'builtin-default', labPageLayouts: layouts });
    expect(changed.mock.lastCall?.[0].palette).toBeUndefined();
    expect(changed.mock.lastCall?.[0].customPresets[0].palette).toEqual({ light: { canvas: '#fff4dd' } });
  });

  it('删除当前主题真正恢复默认外观，其余主题保留', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    const preset = { ...BUILTIN_APPEARANCE_PRESET, id: 'paper', name: '纸张', isBuiltin: false, themeMode: 'dark' as const, accentColor: '#14b8a6', palette: { dark: { canvas: '#211c19' } } };
    render(React.createElement(SettingsHarness, { initialAppearancePreferences: { ...appearanceValues(preset), activePresetId: preset.id, customPresets: [preset, { ...preset, id: 'other', name: '保留主题' }] }, onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    fireEvent.click(screen.getByRole('button', { name: '删除「纸张」' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除预设' }));
    await waitFor(() => expect(changed.mock.lastCall?.[0].activePresetId).toBe('builtin-default'));
    expect(appearanceValues(changed.mock.lastCall![0])).toEqual(appearanceValues(BUILTIN_APPEARANCE_PRESET));
    expect(changed.mock.lastCall?.[0].customPresets.map(item => item.name)).toEqual(['保留主题']);
    expect(screen.getByRole('button', { name: '应用外观预设：NAI Atelier 默认' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('高级控件可逐字输入并保存分享，实色偏好不被其他参数改动重新开启，基础圆角可接回', async () => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    const view = render(React.createElement(SettingsHarness, { onAppearancePreferencesChange: changed }));
    await waitThemeLibrary();
    expect(view.container.querySelectorAll('.atelier-theme-card')).toHaveLength(2);
    fireEvent.click(screen.getByText('控件、排版与玻璃细节'));
    const height = screen.getByRole('spinbutton', { name: '控件高度' }) as HTMLInputElement;
    fireEvent.change(height, { target: { value: '3' } });
    expect(height.value).toBe('3');
    expect(changed.mock.lastCall?.[0].details).toBeUndefined();
    fireEvent.change(height, { target: { value: '36' } });
    expect(changed.mock.lastCall?.[0].details?.controlHeight).toBe(36);
    const font = screen.getByLabelText('界面字体') as HTMLInputElement;
    fireEvent.change(font, { target: { value: 'system-ui' } });
    fireEvent.change(font, { target: { value: 'system-ui, ' } });
    expect(font.value).toBe('system-ui, ');
    fireEvent.change(font, { target: { value: 'system-ui, sans-serif' } });
    expect(changed.mock.lastCall?.[0].details?.fontFamily).toBe('system-ui, sans-serif');
    fireEvent.change(screen.getByLabelText('材质效果'), { target: { value: 'glass' } });
    expect(changed.mock.lastCall?.[0].surfaces).toBe('translucent');
    fireEvent.click(screen.getByRole('button', { name: '实色' }));
    fireEvent.change(height, { target: { value: '38' } });
    expect(changed.mock.lastCall?.[0].surfaces).toBe('solid');
    fireEvent.change(screen.getByRole('spinbutton', { name: '控件圆角' }), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: '另存当前主题' }));
    fireEvent.change(screen.getByPlaceholderText(/例如：晴空午夜/), { target: { value: '能力回归' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(changed.mock.lastCall?.[0].customPresets[0]?.details).toMatchObject({ controlHeight: 38, controlRadius: 999, material: 'glass' }));
    fireEvent.click(screen.getByRole('button', { name: '锐利' }));
    expect(changed.mock.lastCall?.[0].details?.controlRadius).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '应用外观预设：能力回归' }));
    expect(changed.mock.lastCall?.[0].details?.controlRadius).toBe(999);
    fireEvent.click(screen.getByRole('button', { name: '恢复 NAI Atelier 默认外观' }));
    expect(changed.mock.lastCall?.[0].details).toBeUndefined();
    expect(changed.mock.lastCall?.[0].customPresets).toHaveLength(1);
  });

  it.each(['NAI Atelier 默认', 'Cupertino Liquid Glass'])('内置主题 %s 可以导出再导入为普通主题，重名连续导入保持名称唯一，错误文件可重选', async name => {
    const changed = vi.fn<(preferences: AppearancePreferences) => void>();
    const notify = vi.fn();
    render(React.createElement(SettingsHarness, { onAppearancePreferencesChange: changed, notify }));
    fireEvent.click(screen.getByRole('button', { name: `导出「${name}」` }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const reader = new FileReader();
    const json = await new Promise<string>(resolve => { reader.onload = () => resolve(String(reader.result)); reader.readAsText(vi.mocked(downloadFile).mock.calls[0][0] as Blob); });
    expect(JSON.parse(json).version).toBe(3);
    expect(readAppearancePresetImport(json)[0].isBuiltin).toBeUndefined();
    const input = screen.getByLabelText('导入外观预设 JSON');
    fireEvent.change(input, { target: { files: [new File(['{"version":999}'], 'future.json')] } });
    await waitFor(() => expect(notify).toHaveBeenCalledWith('不支持的主题文件版本，请更新应用', 'error'));
    expect(changed.mock.lastCall?.[0].customPresets).toHaveLength(0);
    for (const count of [1, 2]) {
      fireEvent.change(input, { target: { files: [new File([json], 'default.json')] } });
      await waitFor(() => expect(changed.mock.lastCall?.[0].customPresets).toHaveLength(count));
    }
    const presets = changed.mock.lastCall![0].customPresets;
    expect(new Set(presets.map(item => item.name)).size).toBe(2);
    expect(presets.every(item => item.name !== name)).toBe(true);
    expect(new Set(presets.map(item => item.id)).size).toBe(2);
    expect(presets.every(item => !item.isBuiltin)).toBe(true);
    fireEvent.drop(input.parentElement!, { dataTransfer: { files: [new File([json], 'dropped.json')] } });
    await waitFor(() => expect(changed.mock.lastCall?.[0].customPresets).toHaveLength(3));
  });

  it('明暗模式和外观选项被选中时具有 dark:text-indigo-300 保证暗色高对比度', async () => {
    render(React.createElement(SettingsHarness));

    // 默认 standard 选项（界面密度、圆角语言、字号）均被选中且具有 dark:text-indigo-300
    const standardButtons = screen.getAllByRole('button', { name: '标准' });
    expect(standardButtons.length).toBeGreaterThan(0);
    standardButtons.forEach(btn => {
      expect(btn.className).toContain('dark:text-indigo-300');
    });

    const systemModeBtn = screen.getByRole('button', { name: '跟随系统' });
    expect(systemModeBtn.className).toContain('dark:text-indigo-300');
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

  it('全局和页面独立设置均可选择桌面7列', async () => {
    render(React.createElement(SettingsHarness));
    const desktopColumns = await screen.findByRole('slider', { name: '桌面端列数' }) as HTMLInputElement;
    expect(desktopColumns.max).toBe('7');
    fireEvent.change(desktopColumns, { target: { value: '7' } });
    expect(getMobileImageDisplayPreferences().desktopColumns).toBe(7);

    const scope = screen.getByRole('combobox', { name: '设置范围' }) as HTMLSelectElement;
    fireEvent.change(scope, { target: { value: 'artists' } });
    fireEvent.click(screen.getByRole('switch', { name: '跟随全局' }));
    fireEvent.change(screen.getByRole('slider', { name: '桌面端列数' }), { target: { value: '7' } });
    expect(getImageDisplayPageOverride('artists')?.desktopColumns).toBe(7);
    expect(getMobileImageDisplayPreferences('artists').columns).toBe(2);
  });

  it('页面排列默认继承全局，取消继承后独立保存并可恢复继承', async () => {
    render(React.createElement(SettingsHarness));
    const scope = await screen.findByRole('combobox', { name: '设置范围' }) as HTMLSelectElement;
    fireEvent.click(screen.getByRole('button', { name: '方形' }));
    expect(getMobileImageDisplayPreferences().layout).toBe('square');

    fireEvent.change(scope, { target: { value: 'artists' } });
    const follow = screen.getByRole('switch', { name: '跟随全局' });
    expect(follow.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: '方形' }).matches(':disabled')).toBe(true);
    expect(screen.getByText('当前值继承自全局设置；关闭后可单独调整此页面')).toBeTruthy();
    expect(getMobileImageDisplayPreferences('artists').layout).toBe('square');

    fireEvent.click(follow);
    expect(getImageDisplayPageOverride('artists')).toEqual(getMobileImageDisplayPreferences());
    fireEvent.click(screen.getByRole('button', { name: '竖向卡片' }));
    expect(getMobileImageDisplayPreferences('artists').layout).toBe('portrait');
    expect(getMobileImageDisplayPreferences().layout).toBe('square');

    fireEvent.change(scope, { target: { value: 'global' } });
    fireEvent.click(screen.getByRole('button', { name: '瀑布流' }));
    fireEvent.change(scope, { target: { value: 'artists' } });
    expect((screen.getByRole('switch', { name: '跟随全局' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('switch', { name: '跟随全局' }));
    expect(getImageDisplayPageOverride('artists')).toBeNull();
    expect(getMobileImageDisplayPreferences('artists').layout).toBe('masonry');
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
