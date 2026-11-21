import { t, useLanguage, getLanguage, setLanguage, LANGUAGES, type Language } from '../services/i18n';
import { BUILTIN_APPEARANCE_PRESETS, DEFAULT_ACTIVE_APPEARANCE_PRESET } from '../services/builtinAppearancePresets';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';
import { ImageTaggerModelManager } from './ImageTaggerModelManager';
import { TaggerRemoteAccessSettings } from './TaggerRemoteAccessSettings';
import { setCleanSharedImages, useCleanSharedImages, setSharedImageCustomText, useSharedImageCustomText, setSharedImageCleanContent, useSharedImageCleanContent, setImageDownloadFormat, useImageDownloadFormat } from '../services/imageSharing';
import { copyTagText } from '../services/externalImageTags';
import { InlineSpinner } from './DesignSystem';
import { DataBackupManager } from './DataBackupManager';
import { StorageLocationManager } from './StorageLocationManager';
import { ArtistSampleManager } from './ArtistSampleManager';
import { beginExportTarget } from '../services/exportLocation';
import { DesktopLauncherManager } from './DesktopLauncherManager';
import { AndroidStorageManager } from './AndroidStorageManager';
import { isAndroidApp } from '../services/platform';
import { AppUpdateManager } from './AppUpdateManager';
import { ProjectNotice } from './ProjectNotice';
import { SillyTavernBridgeExport } from './SillyTavernBridgeExport';
import {
  clearMobileThumbnailCache,
  getMobileCacheLimitMb,
  getMobileCacheStats,
  refreshMobileCacheMetadata,
  setMobileCacheLimitMb,
} from '../services/mobileImageCache';
import { useMobileHistoryLayer } from './MobileUI';
import { useConfirmDialog } from './ConfirmDialog';
import { clearImageDisplayPageOverride, DesktopImageColumns, getImageDisplayPageOverride, getMobileImageDisplayPreferences, IMAGE_DISPLAY_PAGES, ImageDisplayPage, MobileImageColumns, MobileImageLayout, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { anlasBudgetService, DEFAULT_ANLAS_BUDGET, getActiveKeyHash, useAnlasBudget } from '../services/anlasBudget';
import { getNaiRuntimeConfig } from '../services/naiRuntime';
import { isNovelaiSubscriptionActive, isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { AnlasBalanceBar } from './AnlasBalanceBar';
import { useNaiChannelMode } from '../services/naiChannel';
import { OpusUsageBar } from './OpusUsageBar';
import { getCachedCloudQueuePreferences, getCloudQueuePreferences, setCloudQueuePreferences } from '../services/cloudQueue';
import { naiKeyVault, NaiKeyEntry } from '../services/naiKeyVault';
import { useNaiKeyPool } from '../services/naiKeyPool';
import { readActiveNaiKey } from '../services/naiKeyStorage';
import { PromptAgentSettings } from './PromptAgentSettings';
import { getCloudQueueGenerationUrl } from '../worker/cloudQueueTarget.mjs';
import {
  AppearancePreferences,
  AppearancePreset,
  BUILTIN_APPEARANCE_PRESET,
  CornerStyle,
  FontScale,
  InterfaceDensity,
  MotionStyle,
  appearanceMatchesPreset,
  appearanceValues,
  readAppearancePresetImport,
  serializeAppearancePresets,
  saveAppearancePreferences,
  SurfaceStyle,
  ThemeMode,
} from '../services/appearancePreferences';
import { AppearancePaletteEditor } from './AppearancePaletteEditor';
import { AppearanceBackgroundEditor } from './AppearanceBackgroundEditor';
import { AppearancePresetPreview } from './AppearancePresetPreview';
import { AppearanceDetailEditor } from './AppearanceDetailEditor';
import { normalizeThemeDetails, resolveThemeDetails } from '../services/themeDetails';
import { resolveWorkspaceBackground, type BackgroundMode } from '../services/themeBackground';
import { sharedAppearancePresets } from '../services/sharedAppearancePresets';
import { useSharedAppearancePresets } from './useSharedAppearancePresets';
import { FLOATING_CONTROL_MAX, FLOATING_CONTROL_MIN, useFloatingControlSize } from '../services/floatingControls';
import { ArrowLeft, Boxes, Bot, Check, ChevronRight, Copy, Database, Eye, EyeOff, FolderInput, FolderOutput, Globe, HardDrive, Info, KeyRound, LayoutGrid, Link2, Lock, Monitor, Moon, Palette, Pencil, Plus, RotateCcw, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, Users, X } from 'lucide-react';
import {
  SETTINGS_BTN_DANGER,
  SETTINGS_BTN_ICON,
  SETTINGS_BTN_ICON_DANGER,
  SETTINGS_BTN_INLINE,
  SETTINGS_BTN_NEUTRAL,
  SETTINGS_BTN_PRIMARY,
  SETTINGS_DIVIDE_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_SEGMENT_CLASS,
  SETTINGS_SEGMENT_OFF,
  SETTINGS_SEGMENT_ON,
  SETTINGS_SUBPANEL_CLASS,
  SettingsCard,
  SettingsSelect,
  SettingsSwitch,
  SettingsSwitchRow,
} from './SettingsUI';

export type SettingsSection =
  | 'appearance'
  | 'generation'
  | 'privacy'
  | 'novelai'
  | 'agent'
  | 'resources'
  | 'connections'
  | 'storage'
  | 'about';
export type SettingsPage = 'home' | SettingsSection | 'maintenance';

interface LocalMaintenanceStatus {
  lanUrls?: string[];
}

interface SettingsSectionMeta {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desktopOnly?: boolean;
}

interface SettingsNavGroup {
  id: string;
  label: string;
  items: SettingsSectionMeta[];
}

const settingsNavGroups: SettingsNavGroup[] = [
  {
    id: 'workspace',
    label: '界面与创作',
    items: [
      { id: 'appearance', label: '外观与显示', icon: Palette },
      { id: 'generation', label: '生图与实验室', icon: Sparkles },
      { id: 'privacy', label: '隐私与分享', icon: ShieldCheck },
    ],
  },
  {
    id: 'integrations',
    label: '接口与扩展',
    items: [
      { id: 'novelai', label: '生图密钥与额度', icon: KeyRound },
      { id: 'agent', label: '创作助手', icon: Bot },
      { id: 'resources', label: '本地资源与模型', icon: Boxes },
      { id: 'connections', label: '同步与网络访问', icon: Link2, desktopOnly: true },
    ],
  },
  {
    id: 'system',
    label: '数据与关于',
    items: [
      { id: 'storage', label: '存储与备份', icon: HardDrive },
      { id: 'about', label: '关于与系统', icon: Info },
    ],
  },
];

const normalizeSettingsSection = (section: SettingsPage, mobile: boolean, android: boolean): 'home' | SettingsSection => {
  if (section === 'home') return mobile ? 'home' : 'appearance';
  if (section === 'maintenance') return 'storage';
  if (android && section === 'connections') return 'storage';
  return section;
};

interface GlobalSettingsProps {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsPage;
  notify: (message: string, type?: 'success' | 'error') => void;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  appearancePreferences: AppearancePreferences;
  setAppearancePreferences: React.Dispatch<React.SetStateAction<AppearancePreferences>>;
  safeMode: boolean;
  safeModeStartup: boolean;
  safeModeHideTitles: boolean;
  setSafeModeStartup: React.Dispatch<React.SetStateAction<boolean>>;
  setSafeModeHideTitles: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSafeMode: () => void;
}

interface AppearanceOption {
  value: string;
  label: string;
}

const AppearanceOptionGroup: React.FC<{
  value: string;
  options: AppearanceOption[];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="appearance-segmented grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(option => (
      <button
        key={option.value}
        type="button" data-appearance="control" data-tone="neutral"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={`${SETTINGS_SEGMENT_CLASS} ${value === option.value ? SETTINGS_SEGMENT_ON : SETTINGS_SEGMENT_OFF}`}
      >
        <span className="truncate">{t(option.label)}</span>
      </button>
    ))}
  </div>
);

const ACCENT_PRESETS = [
  { color: '#0ea5e9', label: '晴空' },
  { color: '#6366f1', label: '靛蓝' },
  { color: '#8b5cf6', label: '紫罗兰' },
  { color: '#14b8a6', label: '青绿' },
  { color: '#e11d48', label: '绯红' },
  { color: '#d97706', label: '琥珀' },
] as const;

const readApiKey = readActiveNaiKey;

const maskNaiKeyForDisplay = (key: string) => {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed ? '****' : '';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, initialSection = 'home', notify, isDark, themeMode, setThemeMode, appearancePreferences, setAppearancePreferences, safeMode, safeModeStartup, safeModeHideTitles, setSafeModeStartup, setSafeModeHideTitles, toggleSafeMode }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const cleanSharedImages = useCleanSharedImages();
  const sharedImageCustomText = useSharedImageCustomText();
  const sharedImageCleanContent = useSharedImageCleanContent();
  const imageDownloadFormat = useImageDownloadFormat();
  const [apiKey, setApiKey] = useState(readApiKey);
  const [cloudQueue, setCloudQueue] = useState(getCachedCloudQueuePreferences);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [imageDisplayScope, setImageDisplayScope] = useState<'global' | ImageDisplayPage>('global');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(isDark ? 'dark' : 'light');
  const [imageDisplay, setImageDisplay] = useState(getMobileImageDisplayPreferences);
  const [floatingControlSize, setFloatingControlSize] = useFloatingControlSize();
  const [imageDisplayFollowsGlobal, setImageDisplayFollowsGlobal] = useState(true);
  const android = isAndroidApp();
  const visibleNavGroups = settingsNavGroups
    .map(group => ({ ...group, items: group.items.filter(item => !android || !item.desktopOnly) }))
    .filter(group => group.items.length > 0);
  const visibleSections = visibleNavGroups.flatMap(group => group.items);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [activeSection, setActiveSection] = useState<'home' | SettingsSection>('home');
  const changeImageDisplayScope = (scope: 'global' | ImageDisplayPage) => {
    setImageDisplayScope(scope);
    if (scope === 'global') {
      setImageDisplay(getMobileImageDisplayPreferences());
      setImageDisplayFollowsGlobal(true);
    } else {
      setImageDisplay(getMobileImageDisplayPreferences(scope));
      setImageDisplayFollowsGlobal(getImageDisplayPageOverride(scope) === null);
    }
  };
  const updateImageDisplay = (next: ReturnType<typeof getMobileImageDisplayPreferences>) => {
    setImageDisplay(next);
    if (imageDisplayScope === 'global') setMobileImageDisplayPreferences(next);
    else if (!imageDisplayFollowsGlobal) setMobileImageDisplayPreferences(next, imageDisplayScope);
  };
  const toggleImageDisplayInheritance = () => {
    if (imageDisplayScope === 'global') return;
    if (imageDisplayFollowsGlobal) {
      setMobileImageDisplayPreferences(imageDisplay, imageDisplayScope);
      setImageDisplayFollowsGlobal(false);
    } else {
      clearImageDisplayPageOverride(imageDisplayScope);
      setImageDisplay(getMobileImageDisplayPreferences(imageDisplayScope));
      setImageDisplayFollowsGlobal(true);
    }
  };
  const anlasBudget = useAnlasBudget();
  // 当前使用密钥的订阅健康状态：每分钟轮询 + 切 Key 自动刷新，零额外探测请求。
  // 保管箱据此只对「当前使用」的 key 标失效，非当前 key 不做探测。
  const novelaiSubscription = useNovelaiUsage();
  const { info: currentSubscription, error: subscriptionError, loading: subscriptionLoading, refresh: refreshSubscription } = novelaiSubscription;
  // 个人 Opus 免费图折算百分比用的换算系数（网关自动同步，17.3 张 ≈ 1%）。
  const [naiRuntimeCoefficient, setNaiRuntimeCoefficient] = useState(17.3);
  const [anlasInput, setAnlasInput] = useState(String(DEFAULT_ANLAS_BUDGET));
  const [maintenanceStatus, setMaintenanceStatus] = useState<LocalMaintenanceStatus | null>(null);
  const [maintenanceStatusError, setMaintenanceStatusError] = useState('');
  const [lanPin, setLanPin] = useState('');
  const [lanPinSaving, setLanPinSaving] = useState(false);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const importFileRef = React.useRef<HTMLInputElement | null>(null);
  const themeLibrary = useSharedAppearancePresets(open, appearancePreferences, setAppearancePreferences);
  const themeLibraryBusy = !themeLibrary.ready || themeLibrary.busy;
  // 返回与关闭共用在途保护，防止 popstate 完成前重复 history.back()。
  // 手机子页单独入栈；明确关闭整窗时按子页、分类依次清理。
  const closingRef = useRef(false);
  const closeWholeSettingsRef = useRef(false);
  useEffect(() => { if (open) { closingRef.current = false; closeWholeSettingsRef.current = false; } }, [open]);
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还），ref 挂在内容容器上。
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const requestSettingsClose = useMobileHistoryLayer(open, onClose, 'settings');
  const requestSectionBack = useMobileHistoryLayer(open && isMobile && activeSection !== 'home', () => {
    setActiveSection('home');
    if (closeWholeSettingsRef.current) {
      closeWholeSettingsRef.current = false;
      requestSettingsClose();
    } else {
      closingRef.current = false;
    }
  }, 'settings-section');
  const requestBack = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (isMobile && activeSection !== 'home') requestSectionBack();
    else requestSettingsClose();
  }, [isMobile, activeSection, requestSectionBack, requestSettingsClose]);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (isMobile && activeSection !== 'home') {
      closeWholeSettingsRef.current = true;
      requestSectionBack();
    } else requestSettingsClose();
  }, [isMobile, activeSection, requestSectionBack, requestSettingsClose]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // 仅打开时读取初始状态，旋转或入口参数变化不重置当前设置会话。
    setActiveSection(normalizeSettingsSection(initialSection, isMobile, android));
    setApiKey(readApiKey());
    // 每次重新打开设置都回到「脱敏 + 密码框」的默认态，明文回显不跨会话。
    setRevealedKeyId('');
    setShowNewKeyValue(false);
    void getNaiRuntimeConfig().then(config => setNaiRuntimeCoefficient(config.imagesPerPercent || 17.3));
    void getCloudQueuePreferences().then(setCloudQueue).catch(() => notify('读取公共队列设置失败', 'error'));
  }, [open]);

  // 切换分类后自动回到顶部，避免保留上一个长分类的滚动位置。
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [activeSection]);

  useEffect(() => {
    if (!open) return;
    const refreshQueueForKey = () => {
      setCloudQueue(getCachedCloudQueuePreferences());
      void getCloudQueuePreferences().then(setCloudQueue).catch(() => notify('读取当前密钥的公共队列设置失败', 'error'));
    };
    window.addEventListener('nai-api-key-changed', refreshQueueForKey);
    return () => window.removeEventListener('nai-api-key-changed', refreshQueueForKey);
  }, [open, notify]);

  useEffect(() => { setAnlasInput(String(anlasBudget.remaining)); }, [anlasBudget.remaining]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current) && !closingRef.current) {
        event.preventDefault(); event.stopPropagation();
        requestBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, requestBack]);

  useEffect(() => {
    if (!open || !isMobile || android) return;
    const refresh = () => setMobileCacheStats(getMobileCacheStats());
    void refreshMobileCacheMetadata().then(setMobileCacheStats);
    window.addEventListener('nai-mobile-cache-changed', refresh);
    return () => window.removeEventListener('nai-mobile-cache-changed', refresh);
  }, [open, isMobile, android]);

  const refreshMaintenanceStatus = useCallback(async () => {
    setMaintenanceStatusError('');
    try {
      const response = await fetch('/api/local-maintenance/status', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as LocalMaintenanceStatus & { error?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.error || '无法读取本地服务状态');
      setMaintenanceStatus(payload);
    } catch (error) {
      setMaintenanceStatusError(error instanceof Error ? error.message : '无法读取本地服务状态');
    }
  }, []);
  const saveLanPin = async () => {
    if (lanPinSaving) return;
    if (!/^\d{4}$/.test(lanPin)) {
      notify('新密码必须是 4 位数字', 'error');
      return;
    }
    setLanPinSaving(true);
    try {
      const response = await fetch('/api/lan/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: lanPin }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || '修改失败');
      setLanPin('');
      notify('局域网访问密码已更新，立即生效', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '修改失败', 'error');
    } finally {
      setLanPinSaving(false);
    }
  };

  useEffect(() => {
    if (!open || activeSection !== 'connections' || android) return;
    void refreshMaintenanceStatus();
  }, [open, activeSection, android, refreshMaintenanceStatus]);

  useEffect(() => {
    const syncKey = () => { setApiKey(readApiKey()); };
    window.addEventListener('nai-api-key-changed', syncKey);
    window.addEventListener('storage', syncKey);
    return () => {
      window.removeEventListener('nai-api-key-changed', syncKey);
      window.removeEventListener('storage', syncKey);
    };
  }, []);

  const naiChannelMode = useNaiChannelMode();
  // ---- 多密钥保管箱 ----
  const [keyVault, setKeyVault] = useState<NaiKeyEntry[]>([]);
  const [keyVaultLoaded, setKeyVaultLoaded] = useState(false);
  const [keyVaultLoading, setKeyVaultLoading] = useState(false);
  const [keyVaultLoadError, setKeyVaultLoadError] = useState('');
  const keyVaultLoadedRef = useRef(false);
  const keyPool = useNaiKeyPool({ loadRemote: open && activeSection === 'novelai' && keyVaultLoaded });
  const activeGateway = keyVault.find(entry => entry.key === apiKey)?.gatewayUrl;
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyMode, setNewKeyMode] = useState<'official' | 'gateway' | 'per-use'>('official');
  const [newKeyGatewayUrl, setNewKeyGatewayUrl] = useState('');
  const [renamingKeyId, setRenamingKeyId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [showNewKeyValue, setShowNewKeyValue] = useState(false);
  // 明文回显只作用于「当前点开的那一条」，同屏最多一把；不写入任何存储，
  // 关闭设置或切换密钥即复位，避免明文长期停在屏幕上（局域网访问场景同理）。
  const [revealedKeyId, setRevealedKeyId] = useState('');

  const refreshVault = async (isCurrent: () => boolean = () => true) => {
    const hasSnapshot = keyVaultLoadedRef.current;
    if (!hasSnapshot) { setKeyVaultLoading(true); setKeyVaultLoadError(''); }
    try {
      const entries = await naiKeyVault.list();
      if (!isCurrent()) return;
      setKeyVault(entries);
      keyVaultLoadedRef.current = true;
      setKeyVaultLoaded(true);
      setKeyVaultLoadError('');
    } catch (error) {
      if (!isCurrent()) return;
      if (!hasSnapshot) setKeyVaultLoadError('读取失败，请重试');
      throw error;
    } finally {
      if (isCurrent() && !hasSnapshot) setKeyVaultLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // 保管箱已迁入 local-data（Worker 保管），list 为异步；打开设置时拉取一次。
    let active = true;
    void refreshVault(() => active).catch(() => {});
    return () => { active = false; };
    // 每次打开只读取一次，避免状态更新反复触发读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activateKeyEntry = (entry: NaiKeyEntry) => {
    if (entry.key === readApiKey()) return;
    const disablePool = keyPool.config.enabled && !keyPool.config.memberIds.includes(entry.id);
    if (disablePool) void keyPool.setEnabled(false);
    naiKeyVault.activate(entry, true);
    setApiKey(entry.key);
    // 切走后不再保留上一条的明文回显。
    setRevealedKeyId('');
    notify(disablePool ? `已切换到「${entry.name}」（已关闭 Key 池）` : `已切换到「${entry.name}」`, 'success');
  };

  const addKeyEntry = async () => {
    if (newKeyMode !== 'official' && !newKeyGatewayUrl.trim()) {
      notify(newKeyMode === 'per-use' ? '请填写按次渠道的生成地址。' : '请填写生图网关地址。', 'error');
      return;
    }
    const result = await naiKeyVault.add(
      newKeyName,
      newKeyValue,
      newKeyMode === 'official' ? '' : newKeyGatewayUrl,
      newKeyMode === 'per-use' ? 'per-use' : ''
    );
    if (result.status === 'empty') {
      notify('密钥不能为空', 'error');
      return;
    }
    if (result.status === 'missing-gateway') {
      notify('按次渠道需要填写生成地址。', 'error');
      return;
    }
    if (result.status === 'invalid') {
      notify(newKeyMode === 'official' ? 'NovelAI Key 应以 pst- 开头，请检查粘贴内容。' : 'Key 包含无效字符，请检查粘贴内容。', 'error');
      return;
    }
    if (result.status === 'invalid-gateway') {
      notify('生成地址须为完整 HTTP(S) 地址，不能包含凭据、查询参数或片段。', 'error');
      return;
    }
    if (result.status === 'duplicate') {
      notify('这把密钥已经在保管箱里了', 'error');
      return;
    }
    setNewKeyName('');
    setNewKeyValue('');
    setNewKeyGatewayUrl('');
    setShowNewKeyValue(false);
    await refreshVault();
    // 添加即启用：旧实现只入箱不激活，用户看到「输入框清空 + 列表只剩掩码」后
    // 会以为没保存成功，其他页面仍提示「请先配置 NovelAI API Key」。
    naiKeyVault.activate(result.entry, true);
    setApiKey(result.entry.key);
    notify(`已添加「${result.entry.name}」并切换使用`, 'success');
  };

  const removeKeyEntry = async (entry: NaiKeyEntry) => {
    const active = entry.key === readApiKey();
    if (!await confirmAction({
      rememberKey: 'key-vault.delete', rememberScope: active,
      title: `删除密钥「${entry.name}」？`,
      message: `仅从本机保管箱移除 ${maskNaiKeyForDisplay(entry.key)}${active ? '（当前正在使用，删除后需要重新选择密钥）' : ''}，不影响 NovelAI 账号本身。`,
      confirmLabel: '删除',
      tone: 'danger',
    })) return;
    await naiKeyVault.remove(entry.id);
    if (entry.id === revealedKeyId) setRevealedKeyId('');
    if (active) {
      naiKeyVault.clearActive();
      setApiKey('');
    }
    await refreshVault();
    notify('密钥已删除');
  };

  const commitRename = async (entry: NaiKeyEntry) => {
    if (!renameValue.trim()) {
      setRenamingKeyId('');
      return;
    }
    setKeyVault(await naiKeyVault.rename(entry.id, renameValue));
    setRenamingKeyId('');
    notify('备注已更新');
  };

  const updateCloudQueue = (patch: Partial<typeof cloudQueue>) => {
    const next = { ...cloudQueue, ...patch };
    if (patch.enabled && !next.serviceUrl?.trim()) {
      notify('请先填写公共队列服务地址', 'error');
      return;
    }
    setCloudQueue(next);
    void setCloudQueuePreferences(next).then(setCloudQueue).catch(() => {
      setCloudQueue(getCachedCloudQueuePreferences());
      notify('保存公共队列设置失败', 'error');
    });
  };

  const updateCloudQueueServiceUrl = (value: string) => {
    const serviceUrl = value.trim();
    if (!serviceUrl) {
      updateCloudQueue({ serviceUrl: '', enabled: false });
      return;
    }
    try {
      const url = new URL(serviceUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname) throw new Error();
      updateCloudQueue({ serviceUrl: url.href.replace(/\/+$/, '') });
    } catch {
      notify('公共队列服务地址无效，请填写完整的 HTTP(S) 地址', 'error');
      setCloudQueue(getCachedCloudQueuePreferences());
    }
  };

  const updateAppearance = (patch: Partial<AppearancePreferences>) => {
    const next: Partial<AppearancePreferences> = patch.galleryHoverFloat === true
      ? { ...patch, galleryPointerTilt: false }
      : patch;
    setAppearancePreferences(current => {
      if ((!next.corners && !next.accentColor) || 'details' in next || !current.details) return { ...current, ...next };
      const details = { ...current.details };
      if (next.corners) { delete details.controlRadius; delete details.panelRadius; delete details.cardRadius; }
      for (const mode of ['light', 'dark'] as const) {
        const variant = { ...details[mode] };
        if (next.corners) { delete variant.controlRadius; delete variant.panelRadius; delete variant.cardRadius; }
        if (next.accentColor) delete variant.accentColor;
        details[mode] = variant;
      }
      return { ...current, ...next, details: normalizeThemeDetails(details) };
    });
  };

  const resetThemeCustomization = () => {
    applyPreset(DEFAULT_ACTIVE_APPEARANCE_PRESET);
  };

  const customPresets = appearancePreferences.customPresets || [];
  const allPresets: AppearancePreset[] = [...BUILTIN_APPEARANCE_PRESETS, ...customPresets];
  const activePresetId = appearancePreferences.activePresetId || DEFAULT_ACTIVE_APPEARANCE_PRESET.id;
  const activePreset = allPresets.find(preset => preset.id === activePresetId);
  const appearanceModified = !activePreset || !appearanceMatchesPreset(appearancePreferences, activePreset);

  const downloadJson = async (filename: string, presets: AppearancePreset[]) => {
    const target = beginExportTarget();
    const blob = new Blob([serializeAppearancePresets(presets)], { type: 'application/json' });
    const { downloadFile } = await import('../services/fileDownload');
    return downloadFile(blob, filename, target);
  };

  const applyPreset = (preset: AppearancePreset) => {
    updateAppearance({
      ...appearanceValues(preset),
      activePresetId: preset.id,
    });
    if (preset.themeMode !== themeMode) {
      setThemeMode(preset.themeMode);
    }
    notify?.('已应用外观预设「' + preset.name + '」', 'success');
  };

  const handleSaveCurrentPreset = async () => {
    const trimmed = newPresetName.trim();
    const finalName = trimmed || `自定义外观 ${customPresets.length + 1}`;
    const newPreset: AppearancePreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: finalName,
      createdAt: Date.now(),
      ...appearanceValues(appearancePreferences),
    };
    if (!await themeLibrary.change(() => sharedAppearancePresets.add([newPreset]), current => current.activePresetId === appearancePreferences.activePresetId && appearanceMatchesPreset(current, newPreset) ? { activePresetId: newPreset.id } : {})) return;
    setIsCreatingPreset(false);
    setNewPresetName('');
    notify?.('已保存新外观预设「' + newPreset.name + '」', 'success');
  };

  const handleDeletePreset = async (preset: AppearancePreset) => {
    if (preset.isBuiltin) return;
    const confirmed = await confirmAction({
      rememberKey: 'appearance-preset.delete',
      title: '删除外观预设',
      message: t('确定要从工坊主题库删除「{0}」吗？所有浏览器都将移除此主题。', [preset.name]),
      confirmLabel: '删除预设',
      tone: 'danger',
    });
    if (confirmed) {
      if (!await themeLibrary.change(() => sharedAppearancePresets.remove(preset.id), current => current.activePresetId === preset.id ? { ...appearanceValues(DEFAULT_ACTIVE_APPEARANCE_PRESET), activePresetId: DEFAULT_ACTIVE_APPEARANCE_PRESET.id } : {})) return;
      notify?.('已删除外观预设「' + preset.name + '」', 'success');
    }
  };

  const handleRenamePreset = async (presetId: string) => {
    const trimmed = editingPresetName.trim();
    if (!trimmed) {
      setEditingPresetId(null);
      return;
    }
    if (!await themeLibrary.change(() => sharedAppearancePresets.rename(presetId, trimmed.slice(0, 30)))) return;
    setEditingPresetId(null);
    notify?.('已重命名为「' + trimmed + '」', 'success');
  };

  const handleExportSinglePreset = async (preset: AppearancePreset) => {
    const filename = `nai-preset-${preset.name.toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fa5]/gi, '_')}.json`;
    try { const receipt = await downloadJson(filename, [preset]); notify?.(receipt.browserDownload ? '已交给浏览器下载' : '已导出预设「' + preset.name + '」', 'success'); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; notify?.(error instanceof Error ? error.message : '预设导出失败', 'error'); }
  };

  const handleExportAllPresets = async () => {
    if (customPresets.length === 0) {
      notify?.('暂无自定义预设可导出');
      return;
    }
    try { const receipt = await downloadJson(`nai-appearance-presets-${new Date().toISOString().slice(0, 10)}.json`, customPresets);
    notify?.(receipt.browserDownload ? '已交给浏览器下载' : `已导出 ${customPresets.length} 个自定义预设`, 'success'); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; notify?.(error instanceof Error ? error.message : '预设导出失败', 'error'); }
  };

  const importPresetFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = String(e.target?.result || '');
      try {
        const parsed = readAppearancePresetImport(text);
        const names = new Set(allPresets.map(preset => preset.isBuiltin ? t(preset.name) : preset.name));
        const imported = parsed.map(item => {
          let name = item.name;
          let suffix = 1;
          while (names.has(name)) name = `${item.name.slice(0, 22)} (${suffix++})`;
          names.add(name);
          return { ...item, id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, createdAt: Date.now() };
        });
        if (!await themeLibrary.change(() => sharedAppearancePresets.add(imported))) return;
        notify?.(t('成功导入 {0} 个外观预设', [parsed.length]), 'success');
      } catch (error) {
        notify?.(t(error instanceof Error ? error.message : '预设导入失败'), 'error');
      } finally {
        if (importFileRef.current) importFileRef.current.value = '';
      }
    };
    reader.onerror = () => {
      notify?.('读取文件失败', 'error');
      if (importFileRef.current) importFileRef.current.value = '';
    };
    reader.readAsText(file);
  };

  if (!open) return null;

  const activeSectionMeta = activeSection === 'home' ? null : visibleSections.find(section => section.id === activeSection) || null;
  const effectiveAccent = resolveThemeDetails(appearancePreferences.details, isDark)?.accentColor || appearancePreferences.accentColor;

  return (
    <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-0 md:p-4" onMouseDown={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("全局设置")}
        data-agent-page-title={t(activeSectionMeta?.label) || t("全局设置")}
        className="settings-dialog ui-modal-enter operation-dialog flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="workspace-command-bar flex items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {activeSectionMeta && <button type="button" onClick={requestBack} data-appearance="control" data-tone="neutral" className="mobile-touch flex flex-none items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300 md:hidden" aria-label={t("返回设置分类")} title={t("返回设置分类")}><ArrowLeft className="h-[18px] w-[18px]" /></button>}
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-xs font-semibold text-gray-400 dark:text-gray-500 md:inline">{t("全局设置")}</span>
              {activeSectionMeta && <ChevronRight className="hidden h-3.5 w-3.5 flex-none text-gray-400 md:inline" aria-hidden="true" />}
              <h2 className="truncate text-base font-bold text-gray-900 dark:text-white md:text-lg">{t(activeSectionMeta?.label) || t("全局设置")}</h2>
            </div>
          </div>
          <button data-agent-action="browse" type="button" onClick={requestClose} data-appearance="control" data-tone="neutral" className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label={t("关闭全局设置")}>
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav aria-label={t("设置分类")} className="settings-navigation hidden w-60 flex-none border-r border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40 md:flex md:flex-col md:gap-2.5">
            {visibleNavGroups.map(group => (
              <div key={group.id} className="space-y-0.5">
                <div className="px-3 pb-0.5 text-micro font-semibold text-gray-400 dark:text-gray-500">{t(group.label)}</div>
                {group.items.map(item => {
                  const SectionIcon = item.icon;
                  const active = activeSection === item.id;
                  return <button key={item.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => setActiveSection(item.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${active ? 'appearance-group bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-indigo-300 dark:ring-gray-700' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800/60'}`}>
                    <SectionIcon className="h-4 w-4 flex-none" />
                    <span className="min-w-0 truncate"><b className="block truncate text-sm">{t(item.label)}</b></span>
                  </button>;
                })}
              </div>
            ))}
          </nav>
        <div ref={contentScrollRef} className="settings-content min-w-0 flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-5">
          {activeSection === 'home' && <section className="mx-auto max-w-3xl space-y-5 md:hidden">
            <div><h3 className="text-base font-bold text-gray-900 dark:text-white">{t("选择设置分类")}</h3></div>
            {visibleNavGroups.map(group => (
              <div key={group.id} className="space-y-2">
                <div className="px-1 text-xs font-semibold text-gray-400 dark:text-gray-500">{t(group.label)}</div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {group.items.map(item => {
                    const SectionIcon = item.icon;
                    return <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className="appearance-group flex min-h-20 items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-3.5 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><SectionIcon className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 flex-1"><b className="block truncate text-sm text-gray-900 dark:text-white">{t(item.label)}</b></span>
                      <ChevronRight className="h-4 w-4 flex-none text-gray-400" />
                    </button>;
                  })}
                </div>
              </div>
            ))}
          </section>}
          <div className={activeSection === 'home' ? 'hidden' : 'mx-auto max-w-4xl space-y-4'}>
          <section id="settings-appearance" className={`settings-section-pane ${activeSection !== 'appearance' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'appearance' && <>
              <SettingsCard title={t("语言与明暗")} icon={<Globe />} bodyClassName="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300" htmlFor="interface-language">{t("语言")}</label>
                  <SettingsSelect id="interface-language" value={getLanguage()} onChange={event => setLanguage(event.target.value as Language)} containerClassName="w-full">
                    {LANGUAGES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}
                  </SettingsSelect>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("明暗模式")}</div>
                  <div className="appearance-segmented grid grid-cols-3 gap-2">
                    {([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as const).map(option => { const ModeIcon = option.icon; return <button key={option.value} type="button" data-appearance="control" data-tone="neutral" aria-pressed={themeMode === option.value} onClick={() => setThemeMode(option.value)} className={`${SETTINGS_SEGMENT_CLASS} ${themeMode === option.value ? SETTINGS_SEGMENT_ON : SETTINGS_SEGMENT_OFF}`}><ModeIcon className="h-3.5 w-3.5 flex-none" /><span className="truncate">{t(option.label)}</span></button>; })}
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard title={t("图片列表布局")} titleId="image-display-heading" icon={<LayoutGrid />} bodyClassName="space-y-3">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <label htmlFor="image-display-scope" className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("设置范围")}</label>
                  <SettingsSelect id="image-display-scope" value={imageDisplayScope} onChange={event => changeImageDisplayScope(event.target.value as 'global' | ImageDisplayPage)} containerClassName="w-full">
                    <option value="global">{t("全局默认")}</option>
                    {IMAGE_DISPLAY_PAGES.map(page => <option key={page.id} value={page.id}>{t(page.label)}</option>)}
                  </SettingsSelect>
                </div>
                {imageDisplayScope !== 'global' && <SettingsSwitchRow
                  checked={imageDisplayFollowsGlobal}
                  onChange={toggleImageDisplayInheritance}
                  label="跟随全局"
                  description={imageDisplayFollowsGlobal ? "当前值继承自全局设置；关闭后可单独调整此页面" : undefined}
                  bordered
                />}
                <fieldset aria-labelledby="image-display-heading" disabled={imageDisplayScope !== 'global' && imageDisplayFollowsGlobal} className="min-w-0 disabled:opacity-60">
                  <div className="appearance-segmented grid grid-cols-3 gap-2">
                    {([['masonry', '瀑布流'], ['portrait', '竖向卡片'], ['square', '方形']] as const).map(([layout, label]) => <button key={layout} type="button" data-appearance="control" data-tone="neutral" aria-pressed={imageDisplay.layout === layout} onClick={() => updateImageDisplay({ ...imageDisplay, layout: layout as MobileImageLayout })} className={`${SETTINGS_SEGMENT_CLASS} disabled:cursor-not-allowed ${imageDisplay.layout === layout ? SETTINGS_SEGMENT_ON : SETTINGS_SEGMENT_OFF}`}>{t(label)}</button>)}
                  </div>
                  <div className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t("移动端列数")}</span>
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.columns === 'auto' ? t("自适应") : t("{0} 列", [imageDisplay.columns])}</span>
                      </div>
                      <input type="range" min={0} max={3} step={1} value={imageDisplay.columns === 'auto' ? 0 : imageDisplay.columns} onChange={event => { const value = Number(event.target.value); updateImageDisplay({ ...imageDisplay, columns: (value === 0 ? 'auto' : value) as MobileImageColumns }); }} className="mt-2 block w-full accent-indigo-500" aria-label={t("移动端列数")} />
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t("桌面端列数")}</span>
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.desktopColumns === 'auto' ? t("自适应") : t("{0} 列", [imageDisplay.desktopColumns])}</span>
                      </div>
                      <input type="range" min={0} max={7} step={1} value={imageDisplay.desktopColumns === 'auto' ? 0 : imageDisplay.desktopColumns} onChange={event => { const value = Number(event.target.value); updateImageDisplay({ ...imageDisplay, desktopColumns: (value === 0 ? 'auto' : value) as DesktopImageColumns }); }} className="mt-2 block w-full accent-indigo-500" aria-label={t("桌面端列数")} />
                    </div>
                    <div className="md:col-span-2">
                      <div className="flex items-end justify-between gap-3 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t("悬浮按钮大小")}</span>
                          <p className="mt-0.5 text-micro text-gray-400">{t("图片上的收藏、下载、保存、删除与左右切换共用这一个尺寸")}</p>
                        </div>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-gray-600 dark:text-gray-300">{floatingControlSize} px</span>
                      </div>
                      <input type="range" min={FLOATING_CONTROL_MIN} max={FLOATING_CONTROL_MAX} step={2} value={floatingControlSize} onChange={event => setFloatingControlSize(Number(event.target.value))} className="mt-2 block w-full accent-indigo-500" aria-label={t("悬浮按钮大小")} />
                    </div>
                  </div>
                </fieldset>
              </SettingsCard>

              {/* 设计主题与预设管理 */}
              <SettingsCard
                title={t("设计主题")}
                icon={<Palette />}
                badge={<span className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">{t("{0} 个可用主题", [allPresets.length])}</span>}
                action={
                  <>
                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      disabled={themeLibraryBusy}
                      data-appearance="control" data-tone="neutral"
                      className={SETTINGS_BTN_NEUTRAL}
                      title={t("从 JSON 文件导入主题预设")}
                    >
                      <FolderInput className="h-3.5 w-3.5" />{t("导入")}</button>
                    {customPresets.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportAllPresets}
                        data-appearance="control" data-tone="neutral"
                        className={SETTINGS_BTN_NEUTRAL}
                        title={t("导出全部自定义主题为 JSON 文件")}
                      >
                        <FolderOutput className="h-3.5 w-3.5" />{t("导出全部")}</button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCreatingPreset(true)}
                      data-appearance="control" data-tone="primary"
                      className={SETTINGS_BTN_PRIMARY}
                    >
                      <Plus className="h-3.5 w-3.5" />{t("另存当前主题")}</button>
                  </>
                }
              >
                <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !themeLibraryBusy) importPresetFile(file); }}>
                  <input
                    type="file"
                    ref={importFileRef} aria-label={t("导入外观预设 JSON")}
                    accept=".json,application/json"
                    onChange={event => { const file = event.target.files?.[0]; if (file) importPresetFile(file); }}
                    className="hidden"
                  />

                  {!themeLibrary.ready && !themeLibrary.error && <p role="status" className="mb-2 text-meta text-gray-500 dark:text-gray-400">{t('正在同步工坊主题库…')}</p>}
                  {themeLibrary.error && <div role="alert" className="mb-2 flex items-center gap-2 text-meta text-red-600 dark:text-red-300"><span>{t('主题库同步失败，修改尚未保存，请重试')}</span><button type="button" data-appearance="control" data-tone="neutral" onClick={() => themeLibrary.refresh()} className={SETTINGS_BTN_INLINE}>{t('重试')}</button></div>}
                  {appearanceModified && <div className="mb-3 flex flex-wrap items-center gap-2 text-meta">
                    <span role="status" className="text-amber-600 dark:text-amber-400">{t('当前外观已修改')}</span>
                    {activePreset && !activePreset.isBuiltin && <button type="button" disabled={themeLibraryBusy} data-appearance="control" data-tone="neutral" onClick={() => themeLibrary.change(() => sharedAppearancePresets.update({ ...activePreset, ...appearanceValues(appearancePreferences) }))} className={SETTINGS_BTN_INLINE}>{t('保存修改')}</button>}
                    <button type="button" data-appearance="control" data-tone="neutral" onClick={() => handleExportSinglePreset({ id: 'current-appearance', name: t('当前外观'), createdAt: Date.now(), ...appearanceValues(appearancePreferences) })} className={SETTINGS_BTN_INLINE}>{t('导出当前外观')}</button>
                  </div>}
                  {isCreatingPreset && (
                    <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                      <div className="mb-1.5 text-meta font-semibold text-indigo-900 dark:text-indigo-200">
                        {t("保存当前外观配置为新主题")}</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newPresetName}
                          onChange={e => setNewPresetName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveCurrentPreset();
                            if (e.key === 'Escape') setIsCreatingPreset(false);
                          }}
                          placeholder={t("例如：晴空午夜、舒适大字（默认：自定义主题 {0}）", [customPresets.length + 1])}
                          maxLength={30}
                          autoFocus
                          className={`${SETTINGS_INPUT_CLASS} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={handleSaveCurrentPreset}
                          disabled={themeLibraryBusy}
                          data-appearance="control" data-tone="primary"
                          className={SETTINGS_BTN_PRIMARY}
                        >
                          {t("保存")}</button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingPreset(false);
                            setNewPresetName('');
                          }}
                          data-appearance="control" data-tone="neutral"
                          className={SETTINGS_BTN_NEUTRAL}
                        >
                          {t("取消")}</button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {allPresets.map(preset => {
                      const isSelected = activePresetId === preset.id && !appearanceModified;
                      const isEditing = editingPresetId === preset.id;
                      const presetAccent = resolveThemeDetails(preset.details, preset.themeMode === 'system' ? isDark : preset.themeMode === 'dark')?.accentColor || preset.accentColor;
                      return (
                        <div
                          key={preset.id}
                          role="button" aria-label={t("应用外观预设：{0}", [preset.isBuiltin ? t(preset.name) : preset.name])} aria-pressed={isSelected} tabIndex={0}
                          onClick={() => !isEditing && applyPreset(preset)}
                          onKeyDown={event => { if (event.target === event.currentTarget && !isEditing && ['Enter', ' '].includes(event.key)) { event.preventDefault(); applyPreset(preset); } }}
                          className={`atelier-theme-card group relative flex flex-col justify-between overflow-hidden rounded-xl border p-3 text-left transition cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/15 dark:border-indigo-500/80 dark:bg-indigo-950/20'
                              : 'appearance-group border-gray-200/90 bg-white/80 hover:border-gray-300 hover:bg-gray-50/50 dark:border-gray-700/80 dark:bg-gray-900/50 dark:hover:border-gray-600'
                          }`}
                        >
                          {isSelected && !isEditing && (
                            <span className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          )}

                          <div className="flex min-w-0 flex-col gap-2.5">
                            <div className="min-w-0 w-full flex-1 pr-7">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={editingPresetName}
                                    onChange={e => setEditingPresetName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleRenamePreset(preset.id);
                                      if (e.key === 'Escape') setEditingPresetId(null);
                                    }}
                                    maxLength={30}
                                    autoFocus
                                    className={`${SETTINGS_INPUT_CLASS} h-8 flex-1 font-bold`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRenamePreset(preset.id)}
                                    disabled={themeLibraryBusy}
                                    data-appearance="control" data-tone="primary"
                                    className={`${SETTINGS_BTN_PRIMARY} h-8 px-2.5`}
                                  >
                                    {t("确定")}</button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingPresetId(null)}
                                    data-appearance="control" data-tone="neutral"
                                    className={`${SETTINGS_BTN_NEUTRAL} h-8 px-2.5`}
                                  >
                                    {t("取消")}</button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <b className="truncate text-sm text-gray-900 dark:text-white">{preset.isBuiltin ? t(preset.name) : preset.name}</b>
                                    {preset.isBuiltin && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-mini font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400" title={t("内置主题（锁定保护不可删除）")}>
                                        <Lock className="h-2.5 w-2.5" />{t("内置锁定")}</span>
                                    )}
                                    <span className="text-micro font-semibold text-indigo-600 dark:text-indigo-300">
                                      {isSelected ? t("当前使用（{0}）", [isDark ? t('深色版本') : t('浅色版本')]) : t("强调色：{0}", [presetAccent])}
                                    </span>
                                  </div>
                                  <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                                    {preset.id === DEFAULT_ACTIVE_APPEARANCE_PRESET.id ? t("当前出厂默认：液态玻璃深色。")
                                      : preset.id === BUILTIN_APPEARANCE_PRESET.id ? t("经典实色外观（石墨炭黑 / 晴空蓝）。")
                                      : t("{0} · {1}密度 · {2}圆角", [preset.themeMode === 'dark' ? t('深色') : preset.themeMode === 'light' ? t('浅色') : t('跟随系统'), preset.density === 'compact' ? t('紧凑') : preset.density === 'comfortable' ? t('舒展') : t('标准'), preset.corners === 'sharp' ? t('锐利') : preset.corners === 'soft' ? t('柔和') : t('标准')])}
                                  </span>
                                </>
                              )}
                            </div>
                            <AppearancePresetPreview preset={preset} isDark={isDark} backgrounds={appearancePreferences.workspaceBackgrounds} />
                          </div>

                          {/* 卡片底部操作栏 */}
                          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-800/80" onClick={e => e.stopPropagation()}>
                            <span className="flex items-center gap-1.5 text-micro font-medium text-gray-400">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: presetAccent }} />
                              <span className="font-mono">{presetAccent}</span>
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleExportSinglePreset(preset)}
                                aria-label={t("导出「{0}」", [preset.name])}
                                title={t("导出此主题为 JSON 文件")}
                                data-appearance="control" data-tone="neutral" className={SETTINGS_BTN_ICON}
                              >
                                <FolderOutput className="h-3.5 w-3.5" />
                              </button>
                              {!preset.isBuiltin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingPresetId(preset.id);
                                      setEditingPresetName(preset.name);
                                    }}
                                    disabled={themeLibraryBusy}
                                    aria-label={t("重命名「{0}」", [preset.name])}
                                    title={t("重命名")}
                                    data-appearance="control" data-tone="neutral" className={SETTINGS_BTN_ICON}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePreset(preset)}
                                    disabled={themeLibraryBusy}
                                    aria-label={t("删除「{0}」", [preset.name])}
                                    title={t("删除")}
                                    data-appearance="control" data-tone="danger" className={SETTINGS_BTN_ICON_DANGER}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard title={t("个性化")} icon={<SlidersHorizontal />} className="appearance-control-panel">
                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("强调色")}</span><span className="font-mono text-micro uppercase text-gray-400">{effectiveAccent}</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map(preset => (
                      <button key={preset.color} type="button" onClick={() => updateAppearance({ accentColor: preset.color })} aria-label={t("强调色：{0}", [t(preset.label)])} title={t(preset.label)} className="relative flex h-11 w-11 flex-none items-center justify-center rounded-full md:h-8 md:w-8">
                        <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition hover:scale-105 ${effectiveAccent === preset.color ? 'border-gray-900 ring-2 ring-gray-900/15 dark:border-white dark:ring-white/20' : 'border-white shadow-sm dark:border-gray-700'}`} style={{ backgroundColor: preset.color }}>
                          {effectiveAccent === preset.color && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                        </span>
                      </button>
                    ))}
                    <label className="appearance-group relative flex h-8 min-w-24 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-white px-2 text-micro font-bold text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"><Palette className="h-3.5 w-3.5" />{t("自定义")}<input type="color" value={effectiveAccent} onChange={event => updateAppearance({ accentColor: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={t("自定义强调色")} /></label>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("界面密度")}</div><AppearanceOptionGroup value={appearancePreferences.density} onChange={value => updateAppearance({ density: value as InterfaceDensity })} options={[{ value: 'comfortable', label: t("舒展") }, { value: 'standard', label: t("标准") }, { value: 'compact', label: t("紧凑") }]} /></div>
                  <div><div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("圆角语言")}</div><AppearanceOptionGroup value={appearancePreferences.corners} onChange={value => updateAppearance({ corners: value as CornerStyle })} options={[{ value: 'soft', label: t("柔和") }, { value: 'standard', label: t("标准") }, { value: 'sharp', label: t("锐利") }]} /></div>
                  <div><div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("表面材质")}</div><AppearanceOptionGroup value={appearancePreferences.surfaces} onChange={value => updateAppearance({ surfaces: value as SurfaceStyle })} options={[{ value: 'solid', label: t("实色") }, { value: 'translucent', label: t("透光") }]} /></div>
                  <div><div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("字号")}</div><AppearanceOptionGroup value={appearancePreferences.fontScale} onChange={value => updateAppearance({ fontScale: value as FontScale })} options={[{ value: 'small', label: t("偏小") }, { value: 'standard', label: t("标准") }, { value: 'large', label: t("偏大") }]} /></div>
                  <div className="lg:col-span-2">
                    <div className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("动效")}</div>
                    <AppearanceOptionGroup value={appearancePreferences.motion} onChange={value => updateAppearance({ motion: value as MotionStyle })} options={[{ value: 'full', label: t("完整") }, { value: 'reduced', label: t("减少") }, { value: 'off', label: t("关闭动效") }]} />
                  </div>
                </div>

                <div className={`mt-4 border-t border-gray-200/70 pt-2 dark:border-gray-700/70 ${SETTINGS_DIVIDE_CLASS}`}>
                  <SettingsSwitchRow
                    checked={appearancePreferences.gallerySelectionFocus}
                    onChange={next => updateAppearance({ gallerySelectionFocus: next })}
                    label="选中作品聚焦模式"
                    description="选中作品时淡化其他作品并垂直居中；居中滚动遵循上方动效设置。"
                  />
                  <SettingsSwitchRow
                    checked={appearancePreferences.galleryFrostedCaption}
                    onChange={next => updateAppearance({ galleryFrostedCaption: next })}
                    label="全图磨砂卡片"
                    description="图片铺满卡片，名称叠在底部渐变磨砂上；关闭后恢复图下信息栏。"
                  />
                  <SettingsSwitchRow
                    checked={appearancePreferences.galleryHoverFloat}
                    onChange={next => updateAppearance({ galleryHoverFloat: next })}
                    label="卡片悬停浮动"
                    description="鼠标经过时轻轻抬起并放大图片。"
                  />
                </div>

                <AppearanceBackgroundEditor key={activePresetId} mode={backgroundMode} onModeChange={setBackgroundMode}
                  background={resolveWorkspaceBackground(appearancePreferences.workspaceBackgrounds, activePresetId, backgroundMode, appearancePreferences.background)}
                  onReset={Object.hasOwn(appearancePreferences.workspaceBackgrounds?.[activePresetId] || {}, backgroundMode) ? () => {
                    const variants = { ...appearancePreferences.workspaceBackgrounds?.[activePresetId] }; delete variants[backgroundMode];
                    updateAppearance({ workspaceBackgrounds: { ...appearancePreferences.workspaceBackgrounds, [activePresetId]: variants } });
                  } : undefined} onChange={background => {
                  const workspaceBackgrounds = { ...appearancePreferences.workspaceBackgrounds, [activePresetId]: { ...appearancePreferences.workspaceBackgrounds?.[activePresetId], [backgroundMode]: background || null } };
                  if (!saveAppearancePreferences({ ...appearancePreferences, workspaceBackgrounds })) return false;
                  updateAppearance({ workspaceBackgrounds }); return true;
                }} />
                <AppearancePaletteEditor palette={appearancePreferences.palette} onChange={palette => updateAppearance({ palette })} />
                <AppearanceDetailEditor details={appearancePreferences.details} onChange={details => updateAppearance({ details, ...(details?.material && details.material !== appearancePreferences.details?.material ? { surfaces: 'translucent' } : {}) })} />
                <button type="button" onClick={resetThemeCustomization} data-appearance="control" data-tone="neutral" className={`${SETTINGS_BTN_NEUTRAL} mt-4 w-full`}><RotateCcw className="h-3.5 w-3.5" />{t("恢复出厂默认外观")}</button>
              </SettingsCard>
            </>}
          </section>
          <section id="settings-generation" className={`settings-section-pane ${activeSection !== 'generation' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'generation' && <>
              <SettingsCard>
                <SettingsSwitchRow
                  checked={appearancePreferences.rememberGenerationSettings}
                  onChange={next => updateAppearance({ rememberGenerationSettings: next })}
                  label="记住上次生图设置"
                  description="只作用于实验室；从风格串等入口打开时只保留本次页面会话的草稿，不跨重启恢复。"
                />
                {appearancePreferences.rememberGenerationSettings && <div className="mt-2 border-t border-gray-100 pt-3 dark:border-gray-800/80">
                  <div className="flex flex-wrap gap-2 text-xs text-gray-700 dark:text-gray-300">
                  {([
                    ['parameters', '参数设置'],
                    ['globalPrompt', '全局正向提示词'],
                    ['negativePrompt', '全局负面提示词'],
                    ['characterPrompt', '角色正向提示词'],
                    ['characterNegativePrompt', '角色负面提示词'],
                  ] as const).map(([field, label]) => <label key={field} className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 transition-colors ${appearancePreferences.generationMemory[field] ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : 'appearance-group border-gray-200 bg-gray-50/70 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:border-gray-600'}`}>
                    <input type="checkbox" checked={appearancePreferences.generationMemory[field]} onChange={event => updateAppearance({ generationMemory: { ...appearancePreferences.generationMemory, [field]: event.currentTarget.checked } })} className="h-3.5 w-3.5 flex-none rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800" />
                    <span className="whitespace-nowrap">{t(label)}</span>
                  </label>)}
                  </div>
                  <p className="mt-2 text-micro leading-4 text-gray-500 dark:text-gray-400">{t("重启后仅恢复实验室勾选的内容；风格串等编辑页不跨重启恢复。不影响当前输入或已保存的预设。")}</p>
                </div>}
              </SettingsCard>

              <SettingsCard title={t("生成行为")} icon={<Sparkles />} bodyClassName={SETTINGS_DIVIDE_CLASS}>
                <SettingsSwitchRow checked={appearancePreferences.generationStreamPreview} onChange={next => updateAppearance({ generationStreamPreview: next })} label="生成过程预览" />
                <SettingsSwitchRow checked={appearancePreferences.enforceFreeStepLimit} onChange={next => updateAppearance({ enforceFreeStepLimit: next })} label="生成步数锁定在免费额度内" description="关闭后，超出免费步数将消耗 Anlas。" />
                <SettingsSwitchRow
                  checked={appearancePreferences.promptInputAutoHeight && appearancePreferences.promptTranslationAutoHeight}
                  onChange={next => updateAppearance({ promptInputAutoHeight: next, promptTranslationAutoHeight: next })}
                  label="提示词框高度跟随内容"
                  description="原文框与翻译区按内容自动增高，过长时内部滚动；关闭后使用固定高度。"
                />
              </SettingsCard>
            </>}
          </section>

          <section id="settings-novelai" className={`settings-section-pane ${activeSection !== 'novelai' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'novelai' && <>
            {/* 密钥保管箱：多把密钥 + 命名备注，点击使用即切换 */}
            <SettingsCard title={t("密钥保管箱")} icon={<KeyRound />} data-agent-private="true" bodyClassName="space-y-3">
              <div className="space-y-2">
                {!keyVaultLoaded && keyVaultLoading && <p role="status" className="sr-only">{t('正在读取配置…')}</p>}
                {!keyVaultLoaded && keyVaultLoadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  <span>{t(keyVaultLoadError)}</span>
                  <button type="button" data-appearance="control" data-tone="neutral" onClick={() => { void refreshVault().catch(() => {}); }} className={`${SETTINGS_BTN_INLINE} shrink-0`}>{t('重试')}</button>
                </div>}
                {keyVaultLoaded && keyVault.length === 0 && (
                  <p className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">{t("还没有保存的密钥，在下方添加第一把。")}</p>
                )}
                {(() => {
                  const eligiblePoolKeys = keyVault.filter(entry => entry.billingMode !== 'per-use');
                  const showPoolControls = keyVaultLoaded && (eligiblePoolKeys.length >= 2 || keyPool.config.enabled || keyPool.config.memberIds.length > 0);
                  if (!showPoolControls) return null;
                  return (
                    <div className={SETTINGS_SUBPANEL_CLASS}>
                      <SettingsSwitchRow
                        checked={keyPool.config.enabled}
                        onChange={enabled => {
                          const memberIds = enabled && keyPool.config.memberIds.length === 0
                            ? eligiblePoolKeys.map(item => item.id)
                            : keyPool.config.memberIds;
                          void keyPool.setConfig({ enabled, memberIds }).then(saved => {
                            notify(saved.enabled ? t('已开启 Key 池自动轮询（共 {0} 把密钥）', [saved.memberIds.length]) : t('已关闭 Key 池自动轮询'), 'success');
                          });
                        }}
                        label="Key 池自动轮询"
                        description="按满圈率优先自动选用池内 Opus 额度最充足的密钥；全池耗尽或需付费时直接停止提示。"
                        className="!py-1"
                      />
                      {keyPool.config.enabled && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/80 pt-2 text-micro text-gray-500 dark:border-gray-700 dark:text-gray-400">
                          <span>{t('已入池 {0} 把密钥 · 满圈率优先（按次渠道不参与）', [keyPool.members.length])}</span>
                          <button type="button" data-appearance="control" data-tone="neutral" onClick={() => void keyPool.refresh()} className={SETTINGS_BTN_INLINE}>{t('刷新池额度')}</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {(() => {
                  const poolIndexById = new Map<string, number>();
                  let nextPoolIndex = 1;
                  keyVault.forEach(item => {
                    if (item.billingMode !== 'per-use' && keyPool.config.memberIds.includes(item.id)) {
                      poolIndexById.set(item.id, nextPoolIndex++);
                    }
                  });
                  return keyVault.map(entry => {
                  const active = entry.key === apiKey;
                  const revealed = entry.id === revealedKeyId;
                  const eligibleForPool = entry.billingMode !== 'per-use';
                  const inPool = keyPool.config.memberIds.includes(entry.id);
                  const poolIndex = poolIndexById.get(entry.id) || 0;
                  const showPoolButton = eligibleForPool && (keyVault.filter(item => item.billingMode !== 'per-use').length >= 2 || inPool);
                  const poolStatus = keyPool.config.enabled && inPool ? keyPool.members.find(item => item.entry.id === entry.id) : null;
                  const activeKeySubscription = active
                    ? { info: currentSubscription, error: subscriptionError, loading: subscriptionLoading, refresh: refreshSubscription }
                    : null;
                  const keyExpired = Boolean(activeKeySubscription)
                    && !activeKeySubscription!.loading
                    && !activeKeySubscription!.error
                    && activeKeySubscription!.info?.active === false;
                  const keyNonOpus = Boolean(activeKeySubscription)
                    && !activeKeySubscription!.loading
                    && !activeKeySubscription!.error
                    && isNovelaiSubscriptionActive(activeKeySubscription!.info) === true
                    && !isActiveOpusSubscription(activeKeySubscription!.info);
                  return (
                    <div key={entry.id} data-active={active} className={`appearance-group flex items-center gap-2 rounded-xl border px-3 py-2.5 ${active ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-950/30' : 'border-gray-200/80 bg-gray-50/70 dark:border-gray-700/70 dark:bg-gray-800/50'}`}>
                      {renamingKeyId === entry.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={event => setRenameValue(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') void commitRename(entry);
                            if (event.key === 'Escape') setRenamingKeyId('');
                          }}
                          onBlur={() => void commitRename(entry)}
                          maxLength={30}
                          className={`${SETTINGS_INPUT_CLASS} flex-1`}
                          aria-label={t("密钥备注名")}
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {poolIndex > 0 && (
                              <span className="flex-none rounded-full bg-emerald-100 px-1.5 py-0.5 text-micro font-bold tabular-nums text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" title={t('Key 池序号 #{0}', [poolIndex])}>
                                #{poolIndex}
                              </span>
                            )}
                            <span className="truncate text-sm font-bold text-gray-800 dark:text-gray-100" title={entry.name}>{entry.name}</span>
                            {entry.billingMode === 'per-use'
                              ? <span className="flex-none rounded-full bg-emerald-100 px-1.5 py-0.5 text-micro font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" title={entry.gatewayUrl}>{t("按次")}</span>
                              : entry.gatewayUrl && <span className="flex-none rounded-full bg-indigo-100 px-1.5 py-0.5 text-micro font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" title={entry.gatewayUrl}>{t("网关")}</span>}
                            {poolStatus && (
                              <span className={`flex-none rounded-full px-1.5 py-0.5 text-micro font-bold tabular-nums ${poolStatus.error ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : poolStatus.availableForOpus ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : poolStatus.loading ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300' : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'}`}>
                                {poolStatus.loading && !poolStatus.info ? t('同步中') : poolStatus.error && !poolStatus.info ? t('同步失败') : poolStatus.remainingPercent !== null ? `${entry.gatewayUrl ? poolStatus.remainingPercent.toFixed(1) : poolStatus.remainingPercent}%` : t('不可用')}
                              </span>
                            )}
                            {!entry.gatewayUrl && !entry.key.startsWith('pst-') && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t("NovelAI Key 应以 pst- 开头")}>{t("格式可疑")}</span>}
                            {keyExpired && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t(entry.gatewayUrl ? '成员分配额度与实际扣费以网关为准；点击刷新' : "免费权益已过期；Paid Anlas 可付费生成。")}>{t(entry.gatewayUrl ? '网关权益不可用' : "订阅过期")}</span>}
                            {keyNonOpus && !entry.gatewayUrl && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t("当前订阅不是 Opus 档，无免费生成额度，按 Anlas 扣费生成")}>{t("非 Opus")}</span>}
                          </div>
                          <p className={revealed ? 'mt-0.5 select-all break-all font-mono text-meta text-gray-700 dark:text-gray-200' : 'mt-0.5 truncate font-mono text-meta text-gray-500 dark:text-gray-400'}>{revealed ? entry.key : maskNaiKeyForDisplay(entry.key)}</p>
                        </div>
                      )}
                      <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                        {renamingKeyId !== entry.id && showPoolButton && (
                          <button
                            type="button"
                            aria-pressed={inPool}
                            aria-label={t(inPool ? '移出 Key 池：{0}' : '加入 Key 池：{0}', [entry.name])}
                            data-appearance="control"
                            data-tone={inPool ? 'primary' : 'neutral'}
                            onClick={() => void keyPool.toggleMember(entry.id)}
                            className={`mobile-touch inline-flex h-9 items-center rounded-xl border px-2.5 text-xs font-semibold transition ${inPool ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'}`}
                          >
                            {inPool ? t('已入池') : t('入池')}
                          </button>
                        )}
                        {renamingKeyId !== entry.id && <button type="button" aria-pressed={revealed} data-appearance="control" data-control-kind="icon" data-tone="neutral" onClick={() => setRevealedKeyId(revealed ? '' : entry.id)} aria-label={revealed ? t("隐藏完整 Key") : t("显示完整 Key")} title={revealed ? t("隐藏完整 Key") : t("显示完整 Key")} className={SETTINGS_BTN_ICON}>{revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>}
                        {renamingKeyId !== entry.id && <button type="button" data-appearance="control" data-control-kind="icon" data-tone="neutral" onClick={() => void copyTagText(entry.key).then(() => notify(`已复制「${entry.name}」的完整 Key`), () => notify('复制失败，请点眼睛图标后手动选择复制', 'error'))} aria-label={t("复制完整 Key")} title={t("复制完整 Key")} className={SETTINGS_BTN_ICON}><Copy className="h-3.5 w-3.5" /></button>}
                        <button type="button" data-appearance="control" data-control-kind="icon" data-tone="neutral" onClick={() => { setRenamingKeyId(entry.id); setRenameValue(entry.name); }} aria-label={t("修改备注名")} className={SETTINGS_BTN_ICON} title={t("修改备注名")}><Pencil className="h-3.5 w-3.5" /></button>
                        {renamingKeyId !== entry.id && <button type="button" disabled={active} aria-pressed={active} data-appearance={active ? undefined : 'control'} data-tone={active ? undefined : 'primary'} onClick={() => activateKeyEntry(entry)} className={`${SETTINGS_BTN_PRIMARY} min-w-[3.75rem] ${active ? 'cursor-default opacity-80' : ''}`}>{active ? t("使用中") : t("使用")}</button>}
                        {renamingKeyId !== entry.id && <button type="button" data-appearance="control" data-control-kind="icon" data-tone="danger" onClick={() => void removeKeyEntry(entry)} aria-label={t("删除")} className={SETTINGS_BTN_ICON_DANGER} title={t("删除")}><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                  );
                });
                })()}
              </div>

              <div className={`${SETTINGS_SUBPANEL_CLASS} space-y-2.5`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{t("添加密钥")}</span>
                  <SettingsSelect aria-label={t("密钥接入方式")} value={newKeyMode} onChange={event => setNewKeyMode(event.target.value as 'official' | 'gateway' | 'per-use')} containerClassName="w-40">
                    <option value="official">{t("NovelAI 官方")}</option><option value="gateway">{t("生图网关")}</option><option value="per-use">{t("按次渠道")}</option>
                  </SettingsSelect>
                </div>
                {newKeyMode !== 'official' && <>
                  <input type="url" aria-label={newKeyMode === 'per-use' ? t("按次渠道地址") : t("生图网关地址")} value={newKeyGatewayUrl} onChange={event => setNewKeyGatewayUrl(event.target.value)} placeholder={newKeyMode === 'per-use' ? 'https://example.com/ai/generate-image' : 'https://gateway.example/v1'} autoComplete="off" className={SETTINGS_INPUT_CLASS} />
                  <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">{newKeyMode === 'per-use'
                    ? t("按次渠道按调用次数自行计费，工坊不查询点数与额度，也不显示费用估算；生成照常发往该地址。")
                    : t("网关接收成员 Key、提示词及本次参考图；余额与扣费以网关为准，生图不提供实时预览。")}</p>
                </>}
                <input
                  value={newKeyName}
                  onChange={event => setNewKeyName(event.target.value)}
                  maxLength={30}
                  placeholder={t("备注名（例如：车队 A / 备用号）")}
                  autoComplete="off"
                  name="nai-vault-key-label"
                  className={SETTINGS_INPUT_CLASS}
                  aria-label={t("密钥备注名")}
                />
                <div className="flex items-center gap-2">
                  <input
                    type={showNewKeyValue ? 'text' : 'password'}
                    value={newKeyValue}
                    onChange={event => setNewKeyValue(event.target.value.trim())}
                    placeholder={newKeyMode !== 'official' ? t("渠道 API Key") : 'NovelAI API Key（pst-…）'}
                    autoComplete="new-password"
                    name="nai-vault-key-secret"
                    readOnly={false}
                    className={`${SETTINGS_INPUT_CLASS} flex-1 font-mono`}
                    aria-label={newKeyMode !== 'official' ? t('渠道 API Key') : 'NovelAI API Key'}
                  />
                  <button type="button" data-appearance="control" data-control-kind="icon" data-tone="neutral" onClick={() => setShowNewKeyValue(value => !value)} aria-label={showNewKeyValue ? t("隐藏密钥明文") : t("显示密钥明文")} title={showNewKeyValue ? t("隐藏密钥明文") : t("显示密钥明文")} className={SETTINGS_BTN_ICON}>
                    {showNewKeyValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" data-appearance="control" data-tone="primary" onClick={() => void addKeyEntry()} className={SETTINGS_BTN_PRIMARY}>{t("添加")}</button>
                </div>
                <p className="pt-0.5 text-meta leading-5 text-amber-600 dark:text-amber-400">{t("保存后列表只显示脱敏格式 pst-…XXXX，可点条目旁的眼睛或复制图标取回完整 Key。")}{t("Key 明文保存在本机，局域网访问需密码。")}</p>
              </div>
            </SettingsCard>

            {!activeGateway && (
              <SettingsCard
                title={t("多人拼车公共队列")}
                icon={<Users />}
                description={
                  <div className="space-y-0.5">
                    <p>{getCloudQueueGenerationUrl(cloudQueue.serviceUrl) ? t("按 Key 保存，由中转服务排队。") : t("按 Key 保存，同 Key 依次生图。")}</p>
                    <p className="text-amber-600 dark:text-amber-400">{getCloudQueueGenerationUrl(cloudQueue.serviceUrl) ? t("启用中转会发送 Key、提示词及本次参考图；停止等待不保证服务端取消。") : t("不上传 Key、提示词或图片。")}</p>
                  </div>
                }
                action={
                  <SettingsSwitch
                    label={t("多人拼车公共队列")}
                    checked={cloudQueue.enabled}
                    onChange={enabled => updateCloudQueue({ enabled })}
                  />
                }
              >
                <div className={`${SETTINGS_SUBPANEL_CLASS} flex flex-wrap gap-3`}>
                  <label className="min-w-0 flex-[3_1_20rem]">
                    <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("公共队列服务地址")}</span>
                    <input type="url" value={cloudQueue.serviceUrl} onChange={event => { const serviceUrl = event.currentTarget.value; setCloudQueue(value => ({ ...value, serviceUrl })); }} onBlur={event => updateCloudQueueServiceUrl(event.currentTarget.value)} placeholder={t("排队服务或完整的 /ai/generate-image 地址")} className={SETTINGS_INPUT_CLASS} />
                  </label>
                  {cloudQueue.enabled && !getCloudQueueGenerationUrl(cloudQueue.serviceUrl) && <div className="min-w-0 flex-[2_1_16rem]">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <label htmlFor="settings-cloud-queue-greeting" className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("排队个性语（最多15字）")}</label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title={t("显示当前使用者的个性语")}><input type="checkbox" aria-label={t("显示当前使用者的个性语")} checked={cloudQueue.showGreeting} onChange={event => updateCloudQueue({ showGreeting: event.target.checked })} className="h-4 w-4 shrink-0 rounded border-gray-300 accent-indigo-600" /><span>{t("显示个性语")}</span></label>
                    </div>
                    <input id="settings-cloud-queue-greeting" value={cloudQueue.greeting} maxLength={15} onChange={event => { const greeting = event.currentTarget.value.slice(0, 15); setCloudQueue(value => ({ ...value, greeting })); }} onBlur={() => updateCloudQueue({ greeting: cloudQueue.greeting })} className={SETTINGS_INPUT_CLASS} />
                  </div>}
                </div>
              </SettingsCard>
            )}

            {naiChannelMode === 'per-use' && (
              <SettingsCard title={t("Anlas 点数预算")} headingLevel={4} icon={<Sparkles />}>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{t("当前为按次渠道：工坊不查询点数与额度，也不估算费用；费用按该渠道自己的规则计算。")}</p>
              </SettingsCard>
            )}

            <div className={naiChannelMode === 'per-use' ? 'hidden' : 'space-y-4'}>
              <SettingsCard title={t("Anlas 点数预算")} headingLevel={4} icon={<Sparkles />} bodyClassName="space-y-3">
                <AnlasBalanceBar variant="details" budget={anlasBudget} subscription={novelaiSubscription} />
                <OpusUsageBar collapsed={false} showDetails />
                {novelaiSubscription.info?.source === 'gateway' && novelaiSubscription.info?.gatewayManagedWallet === true ? (
                  <p className="text-meta leading-5 text-gray-500 dark:text-gray-400">{t("当前成员网关已独立分配并管理你的可用点数，无需手动设置本地 1666 预算。")}</p>
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor="settings-anlas-budget-input" className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("可支配 Anlas 点数")}</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input id="settings-anlas-budget-input" type="number" min="0" step="1" value={anlasInput} onChange={event => setAnlasInput(event.target.value)} className={`${SETTINGS_INPUT_CLASS} min-w-32 flex-1 text-sm font-bold tabular-nums`} aria-label={t("可支配 Anlas 点数")} />
                      <button type="button" data-appearance="control" data-tone="primary" onClick={async () => { const next = await anlasBudgetService.set(Number(anlasInput)); setAnlasInput(String(next.remaining)); notify('Anlas 预算已更新'); }} className={SETTINGS_BTN_PRIMARY}>{t("保存")}</button>
                      <button type="button" data-appearance="control" data-tone="neutral" onClick={async () => { const next = await anlasBudgetService.set(DEFAULT_ANLAS_BUDGET); setAnlasInput(String(next.remaining)); }} className={SETTINGS_BTN_NEUTRAL}>{t("恢复 1666")}</button>
                    </div>
                  </div>
                )}
              </SettingsCard>

              <SettingsCard
                title={t("个人使用统计（当前密钥）")}
                headingLevel={4}
                icon={<Database />}
                description={t("仅统计本机操作，按 Key 累计")}
                action={
                  anlasBudget.personal && (anlasBudget.personal.anlasSpent > 0 || anlasBudget.personal.opusImages > 0) ? (
                    <button type="button" data-appearance="control" data-tone="danger" onClick={async () => {
                      if (!await confirmAction({ rememberKey: 'usage.reset', rememberScope: apiKey, title: '重置个人使用统计？', message: '清零当前 Key 的 Anlas／Opus 统计，本地预算保留。', confirmLabel: '重置', tone: 'danger' })) return;
                      try {
                        const keyHash = await getActiveKeyHash();
                        if (!keyHash) return;
                        await anlasBudgetService.resetPersonal(keyHash);
                        await anlasBudget.refresh();
                        notify('个人统计已重置');
                      } catch {
                        notify('重置失败', 'error');
                      }
                    }} className={SETTINGS_BTN_DANGER}>{t("重置")}</button>
                  ) : undefined
                }
              >
                {(() => {
                  const personal = anlasBudget.personal || (apiKey ? { anlasSpent: 0, opusImages: 0 } : null);
                  if (!personal) {
                    return <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{t("尚未配置 Key")}</p>;
                  }
                  const hasRecords = anlasBudget.personal != null;
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className={SETTINGS_SUBPANEL_CLASS}>
                          <div className="text-meta text-gray-500 dark:text-gray-400">{t("个人估算消耗 Anlas")}</div>
                          <div className="mt-0.5 text-lg font-black tabular-nums text-indigo-600 dark:text-indigo-300">{personal.anlasSpent}</div>
                        </div>
                        <div className={SETTINGS_SUBPANEL_CLASS}>
                          <div className="text-meta text-gray-500 dark:text-gray-400" title={t("受限模型的免费生成；不含不限额免费图")}>{t("个人 Opus 免费图")}</div>
                          <div className="mt-0.5 text-lg font-black tabular-nums text-emerald-700 dark:text-emerald-300">{t("{0} 张", [personal.opusImages])}</div>
                          <div className="text-micro text-gray-400">{t("≈ {0}% 额度", [(personal.opusImages / naiRuntimeCoefficient).toFixed(2)])}</div>
                        </div>
                      </div>
                      {!hasRecords && (
                        <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">{t("暂无本机使用记录")}</p>
                      )}
                    </>
                  );
                })()}
              </SettingsCard>
            </div>
            </>}
          </section>

          <section id="settings-agent" className={`settings-section-pane ${activeSection !== 'agent' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'agent' && <PromptAgentSettings notify={notify} />}
          </section>

          <section id="settings-privacy" className={`settings-section-pane ${activeSection !== 'privacy' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'privacy' && <>
              <SettingsCard title={t("安全模式")} icon={<ShieldCheck />} bodyClassName={SETTINGS_DIVIDE_CLASS}>
                {isMobile && (
                  <SettingsSwitchRow
                    checked={safeMode}
                    onChange={() => toggleSafeMode()}
                    label="安全模式（防社死）"
                    description="点击图片临时显示"
                    icon={<Shield />}
                  />
                )}
                <SettingsSwitchRow
                  checked={safeModeHideTitles}
                  onChange={next => setSafeModeHideTitles(next)}
                  label="同时隐藏作品名称"
                  description="点击名称临时显示"
                />
                <SettingsSwitchRow
                  checked={safeModeStartup}
                  onChange={next => setSafeModeStartup(next)}
                  label="启动时自动开启安全模式"
                />
              </SettingsCard>

              <SettingsCard title={t("图片元数据清洗")} icon={<EyeOff />} bodyClassName="space-y-3">
                <SettingsSwitchRow
                  checked={cleanSharedImages}
                  onChange={next => {
                    try { setCleanSharedImages(next); }
                    catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                  }}
                  label="分享图片时移除生成信息"
                  description="复制／下载时移除生成信息；原图与历史保留。"
                />
                <div className={`${SETTINGS_SUBPANEL_CLASS} space-y-3`}>
                  <div className="block">
                    <label htmlFor="settings-clean-content" className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("清洗内容")}</label>
                    <SettingsSelect
                      id="settings-clean-content"
                      aria-label={t("清洗内容")}
                      value={sharedImageCleanContent}
                      disabled={!cleanSharedImages}
                      onChange={event => {
                        try { setSharedImageCleanContent(event.target.value as 'all' | 'prompts'); }
                        catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                      }}
                      containerClassName="w-full"
                    >
                      <option value="all">{t("全部生成信息")}</option>
                      <option value="prompts">{t("仅提示词")}</option>
                    </SettingsSelect>
                    <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{t("仅提示词会保留生成参数。")}</span>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("自定义文本")}</span>
                    <input type="text" aria-label={t("自定义文本")} placeholder={t("留空时只清洗")} value={sharedImageCustomText} disabled={!cleanSharedImages} onChange={event => {
                      try { setSharedImageCustomText(event.target.value); }
                      catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                    }} className={SETTINGS_INPUT_CLASS} />
                    <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{t("清洗后写入自定义文本，原图与历史保留。")}</span>
                  </label>
                </div>
                <div className="border-t border-gray-100 pt-1 dark:border-gray-800/80">
                  <SettingsSwitchRow
                    checked={imageDownloadFormat === 'json'}
                    onChange={next => {
                      try { setImageDownloadFormat(next ? 'json' : 'png'); }
                      catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                    }}
                    label="图片悬浮按钮下载生成信息（JSON）"
                    description="开启后，图上的下载按钮导出 prompt、负面提示词与生成参数；图片没有生成信息时仍下载原图。"
                  />
                </div>
              </SettingsCard>
            </>}
          </section>

          <section id="settings-resources" className={`settings-section-pane ${activeSection !== 'resources' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'resources' && <>
              <SettingsCard><TagDictionaryUpdater notify={notify} /></SettingsCard>
              <SettingsCard><ImageTaggerModelManager notify={notify} /></SettingsCard>
              {!android && <SettingsCard><ArtistSampleManager /></SettingsCard>}
            </>}
          </section>

          <section id="settings-connections" className={`settings-section-pane ${activeSection !== 'connections' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'connections' && !android && <>
              <SettingsCard title={t("酒馆同步")} icon={<Link2 />}>
                <SillyTavernBridgeExport notify={notify} />
              </SettingsCard>

              <SettingsCard
                title={t("局域网访问")}
                headingLevel={4}
                icon={<Lock />}
                description={
                  maintenanceStatus?.lanUrls ? (
                    maintenanceStatus.lanUrls.length > 0 ? (
                      <div className="space-y-1">
                        {maintenanceStatus.lanUrls.map(url => (
                          <div key={url} className="flex items-center gap-1.5">
                            <span className="flex-none">{t("手机访问")}</span>
                            <span className="min-w-0 break-all font-mono select-all text-gray-700 dark:text-gray-200">{url}</span>
                            <button type="button" onClick={() => void copyTagText(url).then(() => notify('手机访问地址已复制'), () => notify('复制失败，请手动选择地址复制', 'error'))} aria-label={t("复制手机访问地址 {0}", [url])} title={t("复制手机访问地址")} className="mobile-touch flex flex-none items-center justify-center rounded-lg px-1.5 py-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300"><Copy className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    ) : t("未检测到可用的局域网地址。")
                  ) : (maintenanceStatusError || maintenanceStatus ? (maintenanceStatusError ? t("手机访问地址读取失败") : t("重启工坊后显示手机访问地址")) : <InlineSpinner label={t("正在读取手机访问地址…")} className="text-xs" />)
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    maxLength={4}
                    value={lanPin}
                    onChange={event => setLanPin(event.currentTarget.value.replace(/\D/g, '').slice(0, 4))}
                    aria-label={t("新局域网访问密码")}
                    placeholder={t("新的 4 位数字密码")}
                    title={t("四位数字，保存后立即生效")}
                    className={`${SETTINGS_INPUT_CLASS} min-w-0 flex-1 sm:max-w-52`}
                  />
                  <button
                    type="button"
                    onClick={() => void saveLanPin()}
                    disabled={lanPinSaving || lanPin.length !== 4}
                    data-appearance="control" data-tone="primary"
                    className={SETTINGS_BTN_PRIMARY}
                  >{lanPinSaving ? t("保存中…") : t("更新密码")}</button>
                </div>
              </SettingsCard>

              <SettingsCard><TaggerRemoteAccessSettings /></SettingsCard>
            </>}
          </section>

          <section id="settings-storage" className={`settings-section-pane ${activeSection !== 'storage' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'storage' && (android ? <AndroidStorageManager notify={notify} /> : <>
              <SettingsCard><StorageLocationManager notify={notify} /></SettingsCard>
              <SettingsCard><DataBackupManager notify={notify} /></SettingsCard>
              {isMobile && (
                <SettingsCard title={t("手机图片缓存")} headingLevel={4} icon={<Smartphone />} description={t("仅缩略图，不影响原图。")} bodyClassName="space-y-2.5">
                  <div className="appearance-segmented grid grid-cols-4 gap-2">
                    {[0, 25, 50, 100].map(value => <button key={value} type="button" data-appearance="control" data-tone="neutral" aria-pressed={getMobileCacheLimitMb() === value} onClick={() => { setMobileCacheLimitMb(value); setMobileCacheStats(getMobileCacheStats()); }} className={`${SETTINGS_SEGMENT_CLASS} ${getMobileCacheLimitMb() === value ? SETTINGS_SEGMENT_ON : SETTINGS_SEGMENT_OFF}`}>{value === 0 ? t("关闭") : `${value} MB`}</button>)}
                  </div>
                  <div className={`${SETTINGS_SUBPANEL_CLASS} flex items-center justify-between gap-3 py-2 text-xs`}>
                    <span className="text-gray-500 dark:text-gray-400">{t("已缓存 {0} 张 · {1} MB / {2} MB", [mobileCacheStats.count, (mobileCacheStats.bytes / 1024 / 1024).toFixed(1), mobileCacheStats.limitMb])}</span>
                    <button type="button" onClick={async () => { if (!await confirmAction({ rememberKey: 'thumbnail-cache.clear', title: '清空手机小图缓存？', message: '只会清除可重新生成的缩略图，不会影响原图、历史或任何本地数据。', confirmLabel: '清空缓存', tone: 'danger' })) return; await clearMobileThumbnailCache(); setMobileCacheStats(getMobileCacheStats()); notify('手机小图缓存已清空'); }} data-appearance="control" data-tone="danger" className={SETTINGS_BTN_DANGER}>{t("清空缓存")}</button>
                  </div>
                </SettingsCard>
              )}
            </>)}
          </section>

          <section id="settings-about" className={`settings-section-pane ${activeSection !== 'about' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'about' && <>
              <SettingsCard><AppUpdateManager /></SettingsCard>
              {!android && <SettingsCard><DesktopLauncherManager notify={notify} /></SettingsCard>}
              <SettingsCard><ProjectNotice notify={notify} /></SettingsCard>
            </>}
          </section>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
