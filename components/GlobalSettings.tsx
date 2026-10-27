import { t, useLanguage, getLanguage, setLanguage, LANGUAGES, type Language } from '../services/i18n';
import { BUILTIN_APPEARANCE_PRESETS } from '../services/builtinAppearancePresets';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';
import { ImageTaggerModelManager } from './ImageTaggerModelManager';
import { setCleanSharedImages, useCleanSharedImages, setSharedImageCustomText, useSharedImageCustomText, setSharedImageCleanContent, useSharedImageCleanContent } from '../services/imageSharing';
import { copyTagText } from '../services/externalImageTags';
import { DataBackupManager } from './DataBackupManager';
import { StorageLocationManager } from './StorageLocationManager';
import { ArtistSampleManager } from './ArtistSampleManager';
import { beginExportTarget } from '../services/exportLocation';
import { DesktopLauncherManager } from './DesktopLauncherManager';
import { AndroidStorageManager } from './AndroidStorageManager';
import { isAndroidApp } from '../services/platform';
import { AppUpdateManager } from './AppUpdateManager';
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
import { OpusUsageBar } from './OpusUsageBar';
import { getCachedCloudQueuePreferences, getCloudQueuePreferences, setCloudQueuePreferences } from '../services/cloudQueue';
import { naiKeyVault, NaiKeyEntry } from '../services/naiKeyVault';
import { readActiveNaiKey, getRememberNaiKey, setRememberNaiKey, NAI_KEY_REMEMBER_CHANGED } from '../services/naiKeyStorage';
import { PromptAgentSettings } from './PromptAgentSettings';
import { getCloudQueueGenerationUrl } from '../worker/cloudQueueTarget.mjs';
import {
  AppearancePreferences,
  AppearancePreset,
  BUILTIN_APPEARANCE_PRESET,
  CornerStyle,
  DEFAULT_LAB_PAGE_LAYOUTS,
  cloneDefaultLabPageLayouts,
  FontScale,
  InterfaceDensity,
  LAB_PAGE_IDS,
  LabPageId,
  LabPageLayout,
  LabPageModuleId,
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
import { ArrowLeft, Bot, Check, ChevronRight, Copy, Database, Edit2, ExternalLink, Eye, EyeOff, FileDown, FileUp, FolderInput, FolderOutput, KeyRound, Lock, Monitor, Moon, Palette, Plus, RotateCcw, Server, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, X } from 'lucide-react';

type SettingsSection = 'appearance' | 'generation' | 'novelai' | 'agent' | 'privacy' | 'maintenance';
type SettingsPage = 'home' | SettingsSection;

interface LocalMaintenanceStatus {
  gatewayReady: boolean;
  workerReady: boolean;
  lanUrls?: string[];
  thumbnailCache: {
    count: number;
    bytes: number;
    pinnedCount: number;
    pinnedBytes: number;
    limitBytes: number;
    pinnedLimitBytes: number;
  };
}

const settingsSections: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'appearance', label: '外观与画廊', icon: Palette },
  { id: 'generation', label: '生图偏好与实验室', icon: Sparkles },
  { id: 'novelai', label: 'NovelAI 与 Anlas', icon: KeyRound },
  { id: 'agent', label: '创作助手', icon: Bot },
  { id: 'privacy', label: '隐私与分享', icon: ShieldCheck },
  { id: 'maintenance', label: '数据与维护', icon: Database },
];

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

const LAB_MODULE_META: Record<LabPageModuleId, { label: string }> = {
  prompt: { label: '全局正面提示词' },
  characters: { label: '角色专属提示词' },
  params: { label: '参数设置' },
  negative: { label: '全局负面提示词' },
  characterReference: { label: '精准参考' },
  vibe: { label: 'Vibe Transfer' },
  baseImage: { label: '底图' },
  editSettings: { label: '编辑参数' },
};

const LAB_PAGE_META: Record<LabPageId, { label: string }> = {
  'text-to-image': { label: '文生图' },
  'image-to-image': { label: '图生图' },
  inpaint: { label: '局部重绘' },
  outpaint: { label: '扩图' },
};

const AppearanceOptionGroup: React.FC<{
  value: string;
  options: AppearanceOption[];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="appearance-segmented grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(option => (
      <button
        key={option.value}
        type="button" data-appearance="control"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={`mobile-touch min-w-0 rounded-xl border px-2 py-2 text-center transition md:min-h-10 ${value === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600'}`}
      >
        <span className="block truncate text-xs font-bold">{t(option.label)}</span>
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
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => getRememberNaiKey());
  const [cloudQueue, setCloudQueue] = useState(getCachedCloudQueuePreferences);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [imageDisplayScope, setImageDisplayScope] = useState<'global' | ImageDisplayPage>('global');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(isDark ? 'dark' : 'light');
  const [imageDisplay, setImageDisplay] = useState(getMobileImageDisplayPreferences);
  const [imageDisplayFollowsGlobal, setImageDisplayFollowsGlobal] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [activeSection, setActiveSection] = useState<SettingsPage>('home');
  // 四个实验室页面分组默认展开，便于一次看到全部模块的展开／收起状态。
  const [expandedLabPages, setExpandedLabPages] = useState<Record<LabPageId, boolean>>(() => Object.fromEntries(LAB_PAGE_IDS.map(pageId => [pageId, true])) as Record<LabPageId, boolean>);
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
  // P2-2：Esc 与浏览器手势返回共用 requestClose。移动端关闭走 history.back()（异步），
  // 在 popstate 触发组件卸载前的窗口内再按 Esc 会二次 history.back() 越过标记直接退出页面；
  // 用 closingRef 挡住“关闭动作已在途”的重复触发，重新打开时复位。
  const closingRef = useRef(false);
  useEffect(() => { if (open) closingRef.current = false; }, [open]);
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还），ref 挂在内容容器上。
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const requestClose = useMobileHistoryLayer(open, onClose, 'settings');

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
    setActiveSection(initialSection === 'home' ? (isMobile ? 'home' : 'appearance') : initialSection);
    setApiKey(readApiKey());
    setRememberApiKey(getRememberNaiKey());
    // 每次重新打开设置都回到「脱敏 + 密码框」的默认态，明文回显不跨会话。
    setRevealedKeyId('');
    setShowNewKeyValue(false);
    void getNaiRuntimeConfig().then(config => setNaiRuntimeCoefficient(config.imagesPerPercent || 17.3));
    void getCloudQueuePreferences().then(setCloudQueue).catch(() => notify('读取公共队列设置失败', 'error'));
  }, [open, initialSection, isMobile]);

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
        closingRef.current = true;
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setMobileCacheStats(getMobileCacheStats());
    void refreshMobileCacheMetadata().then(setMobileCacheStats);
    window.addEventListener('nai-mobile-cache-changed', refresh);
    return () => window.removeEventListener('nai-mobile-cache-changed', refresh);
  }, [open]);

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
    if (!open || activeSection !== 'maintenance' || isAndroidApp()) return;
    void refreshMaintenanceStatus();
  }, [open, activeSection, refreshMaintenanceStatus]);

  const updateRememberApiKey = (remember: boolean) => {
    setRememberNaiKey(remember);
    setRememberApiKey(remember);
  };

  useEffect(() => {
    const syncKey = () => { setApiKey(readApiKey()); setRememberApiKey(getRememberNaiKey()); };
    window.addEventListener('nai-api-key-changed', syncKey);
    window.addEventListener(NAI_KEY_REMEMBER_CHANGED, syncKey);
    window.addEventListener('storage', syncKey);
    return () => {
      window.removeEventListener('nai-api-key-changed', syncKey);
      window.removeEventListener(NAI_KEY_REMEMBER_CHANGED, syncKey);
      window.removeEventListener('storage', syncKey);
    };
  }, []);

  // ---- 多密钥保管箱 ----
  const [keyVault, setKeyVault] = useState<NaiKeyEntry[]>([]);
  const activeGateway = keyVault.find(entry => entry.key === apiKey)?.gatewayUrl;
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyGateway, setNewKeyGateway] = useState(false);
  const [newKeyGatewayUrl, setNewKeyGatewayUrl] = useState('');
  const [renamingKeyId, setRenamingKeyId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [showNewKeyValue, setShowNewKeyValue] = useState(false);
  // 明文回显只作用于「当前点开的那一条」，同屏最多一把；不写入任何存储，
  // 关闭设置或切换密钥即复位，避免明文长期停在屏幕上（局域网访问场景同理）。
  const [revealedKeyId, setRevealedKeyId] = useState('');

  useEffect(() => {
    if (!open) return;
    // 保管箱已迁入 local-data（Worker 保管），list 为异步；打开设置时拉取一次。
    let active = true;
    void naiKeyVault.list().then(entries => { if (active) setKeyVault(entries); });
    return () => { active = false; };
  }, [open]);

  const refreshVault = async () => setKeyVault(await naiKeyVault.list());

  const activateKeyEntry = (entry: NaiKeyEntry) => {
    if (entry.key === readApiKey()) return;
    naiKeyVault.activate(entry, rememberApiKey);
    setApiKey(entry.key);
    // 切走后不再保留上一条的明文回显。
    setRevealedKeyId('');
    notify(`已切换到「${entry.name}」`, 'success');
  };

  const addKeyEntry = async () => {
    if (newKeyGateway && !newKeyGatewayUrl.trim()) { notify('请填写生图网关地址。', 'error'); return; }
    const result = newKeyGateway
      ? await naiKeyVault.add(newKeyName, newKeyValue, newKeyGatewayUrl)
      : await naiKeyVault.add(newKeyName, newKeyValue);
    if (result.status === 'empty') {
      notify('密钥不能为空', 'error');
      return;
    }
    if (result.status === 'invalid') {
      notify(newKeyGateway ? '成员 Key 包含无效字符，请检查粘贴内容。' : 'NovelAI Key 应以 pst- 开头，请检查粘贴内容。', 'error');
      return;
    }
    if (result.status === 'invalid-gateway') {
      notify('生图网关地址须为完整 HTTP(S) 地址，不能包含凭据、查询参数或片段。', 'error');
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
    naiKeyVault.activate(result.entry, rememberApiKey);
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
    setAppearancePreferences(current => {
      if ((!patch.corners && !patch.accentColor) || 'details' in patch || !current.details) return { ...current, ...patch };
      const details = { ...current.details };
      if (patch.corners) { delete details.controlRadius; delete details.panelRadius; delete details.cardRadius; }
      for (const mode of ['light', 'dark'] as const) {
        const variant = { ...details[mode] };
        if (patch.corners) { delete variant.controlRadius; delete variant.panelRadius; delete variant.cardRadius; }
        if (patch.accentColor) delete variant.accentColor;
        details[mode] = variant;
      }
      return { ...current, ...patch, details: normalizeThemeDetails(details) };
    });
  };

  const getLabPageLayout = (pageId: LabPageId): LabPageLayout => appearancePreferences.labPageLayouts[pageId] || DEFAULT_LAB_PAGE_LAYOUTS[pageId];

  const updateLabPageLayout = (pageId: LabPageId, update: (layout: LabPageLayout) => LabPageLayout) => {
    updateAppearance({
      labPageLayouts: {
        ...appearancePreferences.labPageLayouts,
        [pageId]: update(getLabPageLayout(pageId)),
      },
    });
  };

  const toggleLabModuleCollapsed = (pageId: LabPageId, moduleId: LabPageModuleId) => {
    updateLabPageLayout(pageId, current => ({
      ...current,
      collapsed: {
        ...current.collapsed,
        [moduleId]: !current.collapsed[moduleId],
      },
    }));
  };

  const resetLabPageLayout = (pageId: LabPageId) => updateLabPageLayout(pageId, () => ({
    collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS[pageId].collapsed },
  }));

  const resetAllLabPageLayouts = () => updateAppearance({ labPageLayouts: cloneDefaultLabPageLayouts() });

  const resetThemeCustomization = () => {
    applyPreset(BUILTIN_APPEARANCE_PRESET);
  };

  const customPresets = appearancePreferences.customPresets || [];
  const allPresets: AppearancePreset[] = [...BUILTIN_APPEARANCE_PRESETS, ...customPresets];
  const activePresetId = appearancePreferences.activePresetId || 'builtin-default';
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
      if (!await themeLibrary.change(() => sharedAppearancePresets.remove(preset.id), current => current.activePresetId === preset.id ? { ...appearanceValues(BUILTIN_APPEARANCE_PRESET), activePresetId: 'builtin-default' } : {})) return;
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

  const activeSectionMeta = activeSection === 'home' ? null : settingsSections.find(section => section.id === activeSection);
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
            {activeSectionMeta && <button type="button" onClick={() => setActiveSection('home')} className="mobile-touch flex flex-none items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300 md:hidden" aria-label={t("返回设置分类")} title={t("返回设置分类")}><ArrowLeft className="h-[18px] w-[18px]" /></button>}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-gray-900 dark:text-white">{t(activeSectionMeta?.label) || t("全局设置")}</h2>

            </div>
          </div>
          <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label={t("关闭全局设置")}>
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="settings-navigation hidden w-64 flex-none border-r border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40 md:flex md:flex-col md:gap-1">
            {settingsSections.map(item => {
              const SectionIcon = item.icon;
              const active = activeSection === item.id;
              return <button key={item.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => setActiveSection(item.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'appearance-group bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-indigo-300 dark:ring-gray-700' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800/60'}`}>
                <SectionIcon className="h-4.5 w-4.5 flex-none" />
                <span className="min-w-0"><b className="block text-sm">{t(item.label)}</b></span>
              </button>;
            })}
          </nav>
        <div className="settings-content min-w-0 flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          {activeSection === 'home' && <section className="mx-auto max-w-3xl md:hidden">
            <div className="mb-5"><h3 className="text-base font-bold text-gray-900 dark:text-white">{t("选择设置分类")}</h3></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {settingsSections.map(item => {
                const SectionIcon = item.icon;
                return <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className="appearance-group flex min-h-24 items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><SectionIcon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><b className="block text-sm text-gray-900 dark:text-white">{t(item.label)}</b></span>
                  <ChevronRight className="h-4 w-4 flex-none text-gray-400" />
                </button>;
              })}
            </div>
          </section>}
          <div className={activeSection === 'home' ? 'hidden' : 'space-y-3'}>
          <section id={`settings-appearance`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'appearance' ? 'hidden' : ''}`}>
            {activeSection === 'appearance' && <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-bold text-gray-700 dark:text-gray-200" htmlFor="interface-language">{t("语言")}</label>
                <select id="interface-language" value={getLanguage()} onChange={event => setLanguage(event.target.value as Language)} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900">
                  {LANGUAGES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">{t("明暗模式")}</div>
                <div className="appearance-segmented grid grid-cols-3 gap-2">
                  {([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as const).map(option => { const ModeIcon = option.icon; return <button key={option.value} type="button" data-appearance="control" aria-pressed={themeMode === option.value} onClick={() => setThemeMode(option.value)} className={`mobile-touch flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition md:h-10 ${themeMode === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}><ModeIcon className="h-3.5 w-3.5 flex-none" /><span className="truncate">{t(option.label)}</span></button>; })}
                </div>
              </div>

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div id="image-display-heading" className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">{t("图片列表布局")}</div>
                <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <label htmlFor="image-display-scope" className="text-xs font-bold text-gray-700 dark:text-gray-200">{t("设置范围")}</label>
                  <select id="image-display-scope" value={imageDisplayScope} onChange={event => changeImageDisplayScope(event.target.value as 'global' | ImageDisplayPage)} className="min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    <option value="global">{t("全局默认")}</option>
                    {IMAGE_DISPLAY_PAGES.map(page => <option key={page.id} value={page.id}>{t(page.label)}</option>)}
                  </select>
                </div>
                {imageDisplayScope !== 'global' && <button type="button" role="switch" aria-checked={imageDisplayFollowsGlobal} aria-label={t("跟随全局")} onClick={toggleImageDisplayInheritance} className="appearance-group mb-3 flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                  <span><span className="block font-semibold text-gray-700 dark:text-gray-200">{t("跟随全局")}</span>{imageDisplayFollowsGlobal && <span className="mt-0.5 block text-gray-500 dark:text-gray-400">{t("当前值继承自全局设置；关闭后可单独调整此页面")}</span>}</span>
                  <span aria-hidden="true" className={`relative h-5 w-9 flex-none rounded-full transition ${imageDisplayFollowsGlobal ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${imageDisplayFollowsGlobal ? 'left-[18px]' : 'left-0.5'}`} /></span>
                </button>}
                <fieldset aria-labelledby="image-display-heading" disabled={imageDisplayScope !== 'global' && imageDisplayFollowsGlobal} className="min-w-0 disabled:opacity-60">
                  <div className="appearance-segmented grid grid-cols-3 gap-2">
                    {([['masonry', '瀑布流'], ['portrait', '竖向卡片'], ['square', '方形']] as const).map(([layout, label]) => <button key={layout} type="button" data-appearance="control" aria-pressed={imageDisplay.layout === layout} onClick={() => updateImageDisplay({ ...imageDisplay, layout: layout as MobileImageLayout })} className={`mobile-touch md:h-10 rounded-xl border px-2 text-xs font-bold disabled:cursor-not-allowed ${imageDisplay.layout === layout ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{t(label)}</button>)}
                  </div>
                  <div className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{t("移动端列数")}</span>
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.columns === 'auto' ? t("自适应") : t("{0} 列", [imageDisplay.columns])}</span>
                      </div>
                      <input type="range" min={0} max={3} step={1} value={imageDisplay.columns === 'auto' ? 0 : imageDisplay.columns} onChange={event => { const value = Number(event.target.value); updateImageDisplay({ ...imageDisplay, columns: (value === 0 ? 'auto' : value) as MobileImageColumns }); }} className="mt-2 block w-full accent-indigo-500" aria-label={t("移动端列数")} />
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{t("桌面端列数")}</span>
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.desktopColumns === 'auto' ? t("自适应") : t("{0} 列", [imageDisplay.desktopColumns])}</span>
                      </div>
                      <input type="range" min={0} max={7} step={1} value={imageDisplay.desktopColumns === 'auto' ? 0 : imageDisplay.desktopColumns} onChange={event => { const value = Number(event.target.value); updateImageDisplay({ ...imageDisplay, desktopColumns: (value === 0 ? 'auto' : value) as DesktopImageColumns }); }} className="mt-2 block w-full accent-indigo-500" aria-label={t("桌面端列数")} />
                    </div>
                  </div>
                </fieldset>
              </div>

              {/* 设计主题与预设管理 */}
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !themeLibraryBusy) importPresetFile(file); }}>
                <input
                  type="file"
                  ref={importFileRef} aria-label={t("导入外观预设 JSON")}
                  accept=".json,application/json"
                  onChange={event => { const file = event.target.files?.[0]; if (file) importPresetFile(file); }}
                  className="hidden"
                />
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{t("设计主题")}</div>
                      <span className="flex-none text-micro font-medium text-gray-400">{t("{0} 个可用主题", [allPresets.length])}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      disabled={themeLibraryBusy}
                      className="appearance-group mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                      title={t("从 JSON 文件导入主题预设")}
                    >
                      <FolderInput className="h-3 w-3" />{t("导入")}</button>
                    {customPresets.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportAllPresets}
                        className="appearance-group mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                        title={t("导出全部自定义主题为 JSON 文件")}
                      >
                        <FolderOutput className="h-3 w-3" />{t("导出全部")}</button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCreatingPreset(true)}
                      className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-meta font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      <Plus className="h-3 w-3" />{t("另存当前主题")}</button>
                  </div>
                </div>

                {!themeLibrary.ready && !themeLibrary.error && <p role="status" className="mb-2 text-meta text-gray-500 dark:text-gray-400">{t('正在同步工坊主题库…')}</p>}
                {themeLibrary.error && <div role="alert" className="mb-2 flex items-center gap-2 text-meta text-red-600 dark:text-red-300"><span>{t('主题库同步失败，修改尚未保存，请重试')}</span><button type="button" onClick={() => themeLibrary.refresh()} className="mobile-touch rounded px-2 underline">{t('重试')}</button></div>}
                {appearanceModified && <div className="mb-3 flex flex-wrap items-center gap-2 text-meta">
                  <span role="status" className="text-amber-700 dark:text-amber-300">{t('当前外观已修改')}</span>
                  {activePreset && !activePreset.isBuiltin && <button type="button" disabled={themeLibraryBusy} onClick={() => themeLibrary.change(() => sharedAppearancePresets.update({ ...activePreset, ...appearanceValues(appearancePreferences) }))} className="mobile-touch rounded-lg px-2 py-1 font-bold text-indigo-600 dark:text-indigo-300">{t('保存修改')}</button>}
                  <button type="button" onClick={() => handleExportSinglePreset({ id: 'current-appearance', name: t('当前外观'), createdAt: Date.now(), ...appearanceValues(appearancePreferences) })} className="mobile-touch rounded-lg px-2 py-1 font-bold text-indigo-600 dark:text-indigo-300">{t('导出当前外观')}</button>
                </div>}
                {isCreatingPreset && (
                  <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                    <div className="text-meta font-bold text-indigo-900 dark:text-indigo-200 mb-1.5">
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
                        className="h-8 flex-1 rounded-lg border border-indigo-300 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-indigo-700 dark:bg-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={handleSaveCurrentPreset}
                        disabled={themeLibraryBusy}
                        className="h-8 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-500"
                      >
                        {t("保存")}</button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingPreset(false);
                          setNewPresetName('');
                        }}
                        className="appearance-group h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {t("取消")}</button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
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
                        className={`atelier-theme-card group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-3 text-left transition cursor-pointer ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/15 dark:border-indigo-500/80 dark:bg-indigo-950/20'
                            : 'appearance-group border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-gray-700'
                        }`}
                      >
                        {isSelected && !isEditing && (
                          <span className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}

                        <div className="flex min-w-0 flex-col gap-3">
                          <div className="min-w-0 w-full flex-1 pr-7">
                            {isEditing ? (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
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
                                  className="h-7 w-full rounded border border-indigo-400 bg-white px-2 text-xs font-bold text-gray-900 outline-none dark:border-indigo-600 dark:bg-gray-950 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRenamePreset(preset.id)}
                                  disabled={themeLibraryBusy}
                                  className="rounded bg-indigo-600 px-2 py-1 text-micro font-bold text-white hover:bg-indigo-500"
                                >
                                  {t("确定")}</button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPresetId(null)}
                                  className="rounded px-1.5 py-1 text-micro font-bold text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  {t("取消")}</button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <b className="truncate text-sm text-gray-900 dark:text-white">{preset.isBuiltin ? t(preset.name) : preset.name}</b>
                                  {preset.isBuiltin && (
                                    <span className="flex items-center gap-0.5 rounded bg-gray-100 px-1 py-0.2 text-mini font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400" title={t("内置主题（锁定保护不可删除）")}>
                                      <Lock className="h-2.5 w-2.5" />{t("内置锁定")}</span>
                                  )}
                                </div>
                                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                                  {preset.id === BUILTIN_APPEARANCE_PRESET.id ? t("默认出厂外观配置（石墨炭黑 / 晴空蓝）。") : t("{0} · {1}密度 · {2}圆角", [preset.themeMode === 'dark' ? t('深色') : preset.themeMode === 'light' ? t('浅色') : t('跟随系统'), preset.density === 'compact' ? t('紧凑') : preset.density === 'comfortable' ? t('舒展') : t('标准'), preset.corners === 'sharp' ? t('锐利') : preset.corners === 'soft' ? t('柔和') : t('标准')])}
                                </span>
                                <span className="mt-1 block text-micro font-semibold text-indigo-600 dark:text-indigo-300">
                                  {isSelected ? t("当前使用（{0}）", [isDark ? t('深色版本') : t('浅色版本')]) : t("强调色：{0}", [presetAccent])}
                                </span>
                              </>
                            )}
                          </div>
                          <AppearancePresetPreview preset={preset} isDark={isDark} backgrounds={appearancePreferences.workspaceBackgrounds} />
                        </div>

                        {/* 卡片底部操作栏 */}
                        <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-800/80" onClick={e => e.stopPropagation()}>
                          <span className="text-micro font-medium text-gray-400 flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: presetAccent }} />
                            <span className="font-mono">{presetAccent}</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleExportSinglePreset(preset)}
                              aria-label={t("导出「{0}」", [preset.name])}
                              title={t("导出此主题为 JSON 文件")}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
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
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePreset(preset)}
                                  disabled={themeLibraryBusy}
                                  aria-label={t("删除「{0}」", [preset.name])}
                                  title={t("删除")}
                                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
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

              <div className="appearance-control-panel rounded-2xl border border-gray-200 bg-gray-50/65 p-3 dark:border-gray-700 dark:bg-gray-950/35">
                <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-indigo-500" /><div><h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">{t("个性化")}</h4></div></div>

                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="text-meta font-bold text-gray-600 dark:text-gray-300">{t("强调色")}</span><span className="font-mono text-micro uppercase text-gray-400">{effectiveAccent}</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map(preset => <button key={preset.color} type="button" onClick={() => updateAppearance({ accentColor: preset.color })} aria-label={t("强调色：{0}", [t(preset.label)])} title={t(preset.label)} className={`mobile-size-locked relative h-8 w-8 rounded-full border-2 transition hover:scale-105 ${effectiveAccent === preset.color ? 'border-gray-900 ring-2 ring-gray-900/15 dark:border-white dark:ring-white/20' : 'border-white shadow-sm dark:border-gray-700'}`} style={{ backgroundColor: preset.color }}>{effectiveAccent === preset.color && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />}</button>)}
                    <label className="appearance-group relative flex h-8 min-w-24 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-white px-2 text-micro font-bold text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"><Palette className="h-3.5 w-3.5" />{t("自定义")}<input type="color" value={effectiveAccent} onChange={event => updateAppearance({ accentColor: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={t("自定义强调色")} /></label>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{t("界面密度")}</div><AppearanceOptionGroup value={appearancePreferences.density} onChange={value => updateAppearance({ density: value as InterfaceDensity })} options={[{ value: 'comfortable', label: t("舒展") }, { value: 'standard', label: t("标准") }, { value: 'compact', label: t("紧凑") }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{t("圆角语言")}</div><AppearanceOptionGroup value={appearancePreferences.corners} onChange={value => updateAppearance({ corners: value as CornerStyle })} options={[{ value: 'soft', label: t("柔和") }, { value: 'standard', label: t("标准") }, { value: 'sharp', label: t("锐利") }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{t("表面材质")}</div><AppearanceOptionGroup value={appearancePreferences.surfaces} onChange={value => updateAppearance({ surfaces: value as SurfaceStyle })} options={[{ value: 'solid', label: t("实色") }, { value: 'translucent', label: t("透光") }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{t("字号")}</div><AppearanceOptionGroup value={appearancePreferences.fontScale} onChange={value => updateAppearance({ fontScale: value as FontScale })} options={[{ value: 'small', label: t("偏小") }, { value: 'standard', label: t("标准") }, { value: 'large', label: t("偏大") }]} /></div>
                  <div className="lg:col-span-2">
                    <div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">{t("动效")}</div>
                    <AppearanceOptionGroup value={appearancePreferences.motion} onChange={value => updateAppearance({ motion: value as MotionStyle })} options={[{ value: 'full', label: t("完整") }, { value: 'reduced', label: t("减少") }, { value: 'off', label: t("关闭动效") }]} />
                    <button type="button" role="switch" aria-checked={appearancePreferences.gallerySelectionFocus} aria-label={t("选中作品聚焦模式")} onClick={() => updateAppearance({ gallerySelectionFocus: !appearancePreferences.gallerySelectionFocus })} className="appearance-group mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                      <span><span className="block text-sm font-bold">{t("选中作品聚焦模式")}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t("选中作品时淡化其他作品并垂直居中；居中滚动遵循上方动效设置。")}</span></span>
                      <span aria-hidden="true" className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.gallerySelectionFocus ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.gallerySelectionFocus ? 'translate-x-5' : 'translate-x-0'}`} /></span>
                    </button>
                  </div>
                  {([
                    ['galleryFrostedCaption', '全图磨砂卡片', '图片铺满卡片，名称叠在底部渐变磨砂上；关闭后恢复图下信息栏。'],
                    ['galleryHoverFloat', '卡片悬停浮动', '鼠标经过时轻轻抬起并放大图片；遵循减少或关闭动效设置。'],
                  ] as const).map(([key, label, description]) => <button key={key} type="button" role="switch" aria-checked={appearancePreferences[key]} aria-label={t(label)} onClick={() => updateAppearance({ [key]: !appearancePreferences[key] })} className="appearance-group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                    <span><span className="block text-sm font-bold">{t(label)}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t(description)}</span></span>
                    <span aria-hidden="true" className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences[key] ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences[key] ? 'translate-x-5' : 'translate-x-0'}`} /></span>
                  </button>)}
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
                <button type="button" onClick={resetThemeCustomization} className="appearance-group mobile-touch mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"><RotateCcw className="h-3.5 w-3.5" />{t("恢复 NAI Atelier 默认外观")}</button>
              </div>
            </div>}
          </section>
          <section id={`settings-generation`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'generation' ? 'hidden' : ''}`}>
            {activeSection === 'generation' && <div className="space-y-3">
              <div className="appearance-group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <button type="button" role="switch" aria-checked={appearancePreferences.promptClassificationEnabled} aria-label={t("提示词分类编辑")} onClick={() => updateAppearance({ promptClassificationEnabled: !appearancePreferences.promptClassificationEnabled })} className="mobile-touch flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
                  <b className="text-xs">{t("提示词分类编辑")}</b>
                  <span aria-hidden="true" className={`relative h-6 w-11 flex-none rounded-full ${appearancePreferences.promptClassificationEnabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${appearancePreferences.promptClassificationEnabled ? 'translate-x-5' : ''}`} /></span>
                </button>
                {appearancePreferences.promptClassificationEnabled && <div className="border-t border-gray-100 px-3 py-3 dark:border-gray-800">
                  <label className="mobile-touch flex cursor-pointer items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={appearancePreferences.autoClassifyMetadata} onChange={event => updateAppearance({ autoClassifyMetadata: event.currentTarget.checked })} className="h-4 w-4 rounded accent-indigo-600" />
                    {t("导入后自动分类")}
                  </label>
                  <p className="mt-1 text-micro leading-4 text-gray-500 dark:text-gray-400">{t("导入元数据后，使用当前助手模型自动整理提示词。仅发送提示词文本，可能产生模型调用费用。")}</p>
                </div>}
              </div>
              <div className="appearance-group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <button type="button" role="switch" aria-checked={appearancePreferences.rememberGenerationSettings} aria-label={t("记住上次生图设置")} onClick={() => updateAppearance({ rememberGenerationSettings: !appearancePreferences.rememberGenerationSettings })} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:text-indigo-700 dark:hover:text-indigo-300">
                  <span className="min-w-0">
                    <b className="block text-xs text-gray-800 dark:text-gray-100">{t("记住上次生图设置")}</b>
                  </span>
                  <span aria-hidden="true" className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.rememberGenerationSettings ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.rememberGenerationSettings ? 'translate-x-5' : 'translate-x-0'}`} /></span>
                </button>
                {appearancePreferences.rememberGenerationSettings && <div className="border-t border-gray-100 px-3 py-3 dark:border-gray-800">
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
                  <p className="mt-2 text-micro leading-4 text-gray-500 dark:text-gray-400">{t("重启后仅恢复勾选的内容。不影响当前输入或已保存的预设。")}</p>
                </div>}
              </div>
              <button type="button" onClick={() => updateAppearance({ generationStreamPreview: !appearancePreferences.generationStreamPreview })} aria-pressed={appearancePreferences.generationStreamPreview} className="appearance-group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">{t("生成过程预览")}</b></span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.generationStreamPreview ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.generationStreamPreview ? 'translate-x-5' : 'translate-x-0'}`} /></span>
              </button>
              <button type="button" onClick={() => updateAppearance({ continuousGenerationEnabled: !appearancePreferences.continuousGenerationEnabled })} aria-pressed={appearancePreferences.continuousGenerationEnabled} className="appearance-group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0">
                  <b className="block text-xs text-gray-800 dark:text-gray-100">{t("连续生成与排队")}</b>
                  <span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">
                    {t("关闭后，每次仅生成一张，不允许追加或插队。")}</span>
                </span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.continuousGenerationEnabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.continuousGenerationEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>

              <button type="button" onClick={() => updateAppearance({ forceEmptySeed: !appearancePreferences.forceEmptySeed })} aria-pressed={appearancePreferences.forceEmptySeed} className="appearance-group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0">
                  <b className="block text-xs text-gray-800 dark:text-gray-100">{t("强制清空种子（始终随机）")}</b>
                  <span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">
                    {t("不改写预设种子；关闭后恢复。")}</span>
                </span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.forceEmptySeed ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.forceEmptySeed ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>

              <button type="button" onClick={() => updateAppearance({ enforceFreeStepLimit: !appearancePreferences.enforceFreeStepLimit })} aria-pressed={appearancePreferences.enforceFreeStepLimit} className="appearance-group flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0">
                  <b className="block text-xs text-gray-800 dark:text-gray-100">{t("生成步数锁定在免费额度内")}</b>
                  <span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">
                    {t("关闭后，超出免费步数将消耗 Anlas。")}</span>
                </span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.enforceFreeStepLimit ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.enforceFreeStepLimit ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>

              <div className="appearance-group rounded-2xl border border-gray-200 bg-gray-50/65 p-3 dark:border-gray-700 dark:bg-gray-950/35">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">{t("实验室模块默认展开")}</h4>
                  <button
                    type="button"
                    onClick={resetAllLabPageLayouts}
                    className="appearance-group mobile-touch flex flex-none items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-micro font-bold text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-600"
                  >
                    <RotateCcw className="h-3 w-3" />{t("全部默认")}</button>
                </div>

                <div className="space-y-2">
                  {LAB_PAGE_IDS.map(pageId => {
                    const pageMeta = LAB_PAGE_META[pageId];
                    const layout = getLabPageLayout(pageId);
                    const defaultLayout = DEFAULT_LAB_PAGE_LAYOUTS[pageId];
                    const modules = Object.keys(defaultLayout.collapsed) as LabPageModuleId[];
                    const isCustom = modules.some(moduleId => Boolean(layout.collapsed[moduleId]) !== Boolean(defaultLayout.collapsed[moduleId]));
                    return <details key={pageId} open={expandedLabPages[pageId]} onToggle={event => {
                      // React 的 currentTarget 只在事件回调执行期间有效；状态更新器可能延迟执行。
                      const expanded = event.currentTarget.open;
                      setExpandedLabPages(current => current[pageId] === expanded ? current : { ...current, [pageId]: expanded });
                    }} className="appearance-group group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0"><span className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-200"><span>{t(pageMeta.label)}</span>{isCustom && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-mini font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">{t("已自定义")}</span>}</span><span className="mt-0.5 block truncate text-micro text-gray-400">{t("{0} 个模块", [modules.length])}</span></span>
                        <ChevronRight className="h-4 w-4 flex-none text-gray-400 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="border-t border-gray-100 p-2.5 dark:border-gray-800">
                        <div className="mb-2 flex justify-end"><button type="button" onClick={() => resetLabPageLayout(pageId)} aria-label={`${t(pageMeta.label)} · ${t("恢复默认")}`} className="mobile-touch flex items-center gap-1 rounded-lg px-2 py-1 text-micro font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"><RotateCcw className="h-3 w-3" />{t("恢复默认")}</button></div>
                        <div className="space-y-2">
                          {modules.map(moduleId => {
                            const meta = LAB_MODULE_META[moduleId];
                            const collapsed = Boolean(layout.collapsed[moduleId]);
                            return <div
                              key={moduleId}
                              className="appearance-group flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-700 dark:bg-gray-800/50"
                            >
                              <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-gray-700 dark:text-gray-200">{t(meta.label)}</div></div>
                              <div className="flex flex-none items-center gap-1"><button type="button" onClick={() => toggleLabModuleCollapsed(pageId, moduleId)} aria-label={`${t(pageMeta.label)} · ${t(meta.label)} · ${collapsed ? t("默认收起") : t("默认展开")}`} aria-pressed={collapsed} className={`mobile-touch rounded-full border px-2 py-1 text-micro font-bold transition ${collapsed ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'appearance-group border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>{collapsed ? t("默认收起") : t("默认展开")}</button></div>
                            </div>;
                          })}
                        </div>
                      </div>
                    </details>;
                  })}
                </div>
              </div>
              <div className="border-t border-gray-200 pt-4 dark:border-gray-700"><ImageTaggerModelManager notify={notify} /></div>
            </div>}
          </section>
          <section id={`settings-novelai`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'novelai' ? 'hidden' : ''}`}>
            {activeSection === 'novelai' && <div>
            {/* 密钥保管箱：多把密钥 + 命名备注，点击使用即切换 */}
            <div data-agent-private="true" className="space-y-2">
              {keyVault.length === 0 && (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">{t("还没有保存的密钥，在下方添加第一把。")}</p>
              )}
              {keyVault.map(entry => {
                const active = entry.key === apiKey;
                const revealed = entry.id === revealedKeyId;
                // 只对「当前使用」的 key 显示订阅健康（复用轮询结果，不额外探测）；
                // 加载中/请求失败时不妄断订阅过期，避免误标。
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
                  <div key={entry.id} data-active={active} className={`appearance-group flex items-center gap-2 rounded-xl border px-3 py-2 ${active ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-950/30' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'}`}>
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
                        className="min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm outline-none dark:border-indigo-500/50 dark:bg-gray-900"
                        aria-label={t("密钥备注名")}
                      />
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-gray-800 dark:text-gray-100" title={entry.name}>{entry.name}</span>
                          {entry.gatewayUrl && <span className="flex-none rounded-full bg-indigo-100 px-1.5 py-0.5 text-micro font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" title={entry.gatewayUrl}>{t("网关")}</span>}
                          {!entry.gatewayUrl && !entry.key.startsWith('pst-') && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t("NovelAI Key 应以 pst- 开头")}>{t("格式可疑")}</span>}
                          {keyExpired && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t(entry.gatewayUrl ? '成员分配额度与实际扣费以网关为准；点击刷新' : "免费权益已过期；Paid Anlas 可付费生成。")}>{t(entry.gatewayUrl ? '网关权益不可用' : "订阅过期")}</span>}
                          {keyNonOpus && !entry.gatewayUrl && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={t("当前订阅不是 Opus 档，无免费生成额度，按 Anlas 扣费生成")}>{t("非 Opus")}</span>}
                        </div>
                        <p className={revealed ? 'mt-0.5 select-all break-all font-mono text-meta text-gray-700 dark:text-gray-200' : 'mt-0.5 truncate font-mono text-meta text-gray-500 dark:text-gray-400'}>{revealed ? entry.key : maskNaiKeyForDisplay(entry.key)}</p>
                      </div>
                    )}
                    <div className="flex flex-none flex-wrap items-center justify-end gap-1">
                      {renamingKeyId !== entry.id && <button type="button" aria-pressed={revealed} onClick={() => setRevealedKeyId(revealed ? '' : entry.id)} aria-label={revealed ? t("隐藏完整 Key") : t("显示完整 Key")} title={revealed ? t("隐藏完整 Key") : t("显示完整 Key")} className="mobile-touch rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">{revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>}
                      {renamingKeyId !== entry.id && <button type="button" onClick={() => void copyTagText(entry.key).then(() => notify(`已复制「${entry.name}」的完整 Key`), () => notify('复制失败，请点「显示」后手动选择复制', 'error'))} aria-label={t("复制完整 Key")} title={t("复制完整 Key")} className="mobile-touch rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"><Copy className="h-3.5 w-3.5" /></button>}
                      <button type="button" onClick={() => { setRenamingKeyId(entry.id); setRenameValue(entry.name); }} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700" title={t("修改备注名")}>{t("备注")}</button>
                      {renamingKeyId !== entry.id && <button type="button" disabled={active} aria-pressed={active} onClick={() => activateKeyEntry(entry)} className={`rounded-lg px-2.5 py-1 text-xs font-bold text-white ${active ? 'cursor-default bg-indigo-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>{active ? t("使用中") : t("使用")}</button>}
                      {renamingKeyId !== entry.id && <button type="button" onClick={() => void removeKeyEntry(entry)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title={t("删除")}>{t("删除")}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div data-agent-private="true" className="mt-3 space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{t("添加密钥")}</span>
                <select aria-label={t("密钥接入方式")} value={newKeyGateway ? 'gateway' : 'official'} onChange={event => setNewKeyGateway(event.target.value === 'gateway')} className="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                  <option value="official">{t("NovelAI 官方")}</option><option value="gateway">{t("生图网关")}</option>
                </select>
              </div>
              {newKeyGateway && <>
                <input type="url" aria-label={t("生图网关地址")} value={newKeyGatewayUrl} onChange={event => setNewKeyGatewayUrl(event.target.value)} placeholder="https://gateway.example/v1" autoComplete="off" className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
                <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">{t("网关接收成员 Key、提示词及本次参考图；余额与扣费以网关为准，生图不提供实时预览。")}</p>
              </>}
              <input
                value={newKeyName}
                onChange={event => setNewKeyName(event.target.value)}
                maxLength={30}
                placeholder={t("备注名（例如：车队 A / 备用号）")}
                autoComplete="off"
                name="nai-vault-key-label"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                aria-label={t("密钥备注名")}
              />
              <div className="flex gap-2">
                <input
                  type={showNewKeyValue ? 'text' : 'password'}
                  value={newKeyValue}
                  onChange={event => setNewKeyValue(event.target.value.trim())}
                  placeholder={newKeyGateway ? t("成员 API Key") : 'NovelAI API Key（pst-…）'}
                  autoComplete="new-password"
                  name="nai-vault-key-secret"
                  readOnly={false}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  aria-label={newKeyGateway ? t('成员 API Key') : 'NovelAI API Key'}
                />
                <button type="button" onClick={() => setShowNewKeyValue(value => !value)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                  {showNewKeyValue ? t("隐藏") : t("显示")}
                </button>
                <button type="button" onClick={() => void addKeyEntry()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500">{t("添加")}</button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5">
                <label className="flex min-w-0 cursor-pointer items-center gap-2 text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={rememberApiKey} title={t("关闭后仅当前标签页使用")} onChange={event => updateRememberApiKey(event.target.checked)} className="shrink-0 rounded border-gray-300 text-indigo-600" />
                  <span>{t("在本机记住当前使用的 API Key")}</span>
                </label>
                <p className="text-amber-600 dark:text-amber-400">{t("保存后列表只显示脱敏格式 pst-…XXXX，可点条目旁的「显示」或「复制」取回完整 Key。")}{t("Key 明文保存在本机，局域网访问需密码。")}</p>
              </div>
            </div>
            {!activeGateway && <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="mobile-touch flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={cloudQueue.enabled} onChange={event => updateCloudQueue({ enabled: event.target.checked })} className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600" />
                  <b className="text-sm text-gray-800 dark:text-gray-100">{t("多人拼车公共队列")}</b>
                </label>
                <span className="text-xs leading-5 text-gray-500 dark:text-gray-400">{getCloudQueueGenerationUrl(cloudQueue.serviceUrl) ? t("按 Key 保存，由中转服务排队。") : t("按 Key 保存，同 Key 依次生图。")}</span>
                <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">{getCloudQueueGenerationUrl(cloudQueue.serviceUrl) ? t("启用中转会发送 Key、提示词及本次参考图；停止等待不保证服务端取消。") : t("不上传 Key、提示词或图片。")}</p>
              </div>
              <div className="appearance-group mt-2 flex flex-wrap gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
                <label className="min-w-0 flex-[3_1_20rem]">
                  <span className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">{t("公共队列服务地址")}</span>
                  <input type="url" value={cloudQueue.serviceUrl} onChange={event => { const serviceUrl = event.currentTarget.value; setCloudQueue(value => ({ ...value, serviceUrl })); }} onBlur={event => updateCloudQueueServiceUrl(event.currentTarget.value)} placeholder={t("排队服务或完整的 /ai/generate-image 地址")} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" />
                </label>
                {cloudQueue.enabled && !getCloudQueueGenerationUrl(cloudQueue.serviceUrl) && <div className="min-w-0 flex-[2_1_16rem]">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <label htmlFor="settings-cloud-queue-greeting" className="text-xs font-bold text-gray-500 dark:text-gray-400">{t("排队个性语（最多15字）")}</label>
                    <label className="mobile-touch flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title={t("显示当前使用者的个性语")}><input type="checkbox" aria-label={t("显示当前使用者的个性语")} checked={cloudQueue.showGreeting} onChange={event => updateCloudQueue({ showGreeting: event.target.checked })} className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600" /><span>{t("显示个性语")}</span></label>
                  </div>
                  <input id="settings-cloud-queue-greeting" value={cloudQueue.greeting} maxLength={15} onChange={event => { const greeting = event.currentTarget.value.slice(0, 15); setCloudQueue(value => ({ ...value, greeting })); }} onBlur={() => updateCloudQueue({ greeting: cloudQueue.greeting })} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" />
                </div>}
              </div>
            </div>}
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <h4 className="font-semibold text-gray-900 dark:text-white">{t("Anlas 点数预算")}</h4>
              <div className="mt-3 space-y-3">
                <AnlasBalanceBar variant="details" budget={anlasBudget} subscription={novelaiSubscription} />
                <OpusUsageBar collapsed={false} showDetails />
              </div>
              <div className="mt-3 flex gap-2">
                <input type="number" min="0" step="1" value={anlasInput} onChange={event => setAnlasInput(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-lg font-black tabular-nums outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" aria-label={t("可支配 Anlas 点数")} />
                <button type="button" onClick={async () => { const next = await anlasBudgetService.set(Number(anlasInput)); setAnlasInput(String(next.remaining)); notify('Anlas 预算已更新'); }} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white">{t("保存")}</button>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-meta leading-5 text-gray-500 dark:text-gray-400"><button type="button" onClick={async () => { const next = await anlasBudgetService.set(DEFAULT_ANLAS_BUDGET); setAnlasInput(String(next.remaining)); }} className="flex-shrink-0 font-bold text-indigo-600 dark:text-indigo-300">{t("恢复 1666")}</button></div>
              <div className="appearance-group mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400" title={t("仅统计本机操作，按 Key 累计")}>{t("个人使用统计（当前密钥）")}</span>
                  {anlasBudget.personal && (anlasBudget.personal.anlasSpent > 0 || anlasBudget.personal.opusImages > 0) && (
                    <button type="button" onClick={async () => {
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
                    }} className="text-meta font-bold text-indigo-600 dark:text-indigo-300">{t("重置")}</button>
                  )}
                </div>
                {(() => {
                  const personal = anlasBudget.personal || (apiKey ? { anlasSpent: 0, opusImages: 0 } : null);
                  if (!personal) {
                    return <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">{t("尚未配置 Key")}</p>;
                  }
                  const hasRecords = anlasBudget.personal != null;
                  return (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div className="appearance-group rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
                          <div className="text-meta text-gray-500 dark:text-gray-400">{t("个人估算消耗 Anlas")}</div>
                          <div className="mt-0.5 text-lg font-black tabular-nums text-indigo-600 dark:text-indigo-300">{personal.anlasSpent}</div>
                        </div>
                        <div className="appearance-group rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
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
              </div>
            </div></div>}
          </section>

          <section id={`settings-agent`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'agent' ? 'hidden' : ''}`}>
            {activeSection === 'agent' && <PromptAgentSettings notify={notify} />}
          </section>

          <section id="settings-privacy" className={`${activeSection !== 'privacy' ? 'hidden' : 'space-y-4'}`}>
            {activeSection === 'privacy' && <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <h3 className="mb-4 text-base font-bold text-gray-900 dark:text-white">{t("安全模式")}</h3>
              <button type="button" onClick={toggleSafeMode} aria-pressed={safeMode} className={`mobile-touch md:h-10 flex w-full items-center justify-between rounded-xl px-3 text-sm font-bold ${safeMode ? 'bg-emerald-700 text-white' : 'appearance-group bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span className="flex items-center gap-2"><Shield className="h-4 w-4" />{t("安全模式（防社死）")}</span><span>{safeMode ? t("已开启") : t("已关闭")}</span></button>
              <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">{t("点击图片临时显示")}</p>
              <button type="button" onClick={() => setSafeModeHideTitles(enabled => !enabled)} aria-pressed={safeModeHideTitles} className="appearance-group mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700">
                <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">{t("同时隐藏作品名称")}</b><span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">{t("点击名称临时显示")}</span></span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeModeHideTitles ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeModeHideTitles ? 'translate-x-5' : 'translate-x-0'}`} /></span>
              </button>
              <button type="button" onClick={() => setSafeModeStartup(enabled => !enabled)} aria-pressed={safeModeStartup} className="appearance-group mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700">
                <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">{t("启动时自动开启安全模式")}</b></span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeModeStartup ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeModeStartup ? 'translate-x-5' : 'translate-x-0'}`} /></span>
              </button>
            </div>}
            {activeSection === 'privacy' && <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <h3 className="mb-4 text-base font-bold text-gray-900 dark:text-white">{t("图片元数据清洗")}</h3>
              <label className="appearance-group flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                <span className="min-w-0"><b className="block text-sm text-gray-900 dark:text-white">{t("分享图片时移除生成信息")}</b><span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{t("复制／下载时移除生成信息；原图与历史保留。")}</span></span>
                <input type="checkbox" aria-label={t("分享图片时移除生成信息")} checked={cleanSharedImages} onChange={event => {
                  try { setCleanSharedImages(event.target.checked); }
                  catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                }} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" />
              </label>
              <label className="mt-3 block text-sm font-medium text-gray-800 dark:text-gray-100">
                {t("清洗内容")}
                <select aria-label={t("清洗内容")} value={sharedImageCleanContent} disabled={!cleanSharedImages} onChange={event => {
                  try { setSharedImageCleanContent(event.target.value as 'all' | 'prompts'); }
                  catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                }} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                  <option value="all">{t("全部生成信息")}</option>
                  <option value="prompts">{t("仅提示词")}</option>
                </select>
                <span className="mt-1 block text-xs leading-5 font-normal text-gray-500 dark:text-gray-400">{t("仅提示词会保留生成参数。")}</span>
              </label>
              <label className="mt-3 block text-sm font-medium text-gray-800 dark:text-gray-100">
                {t("自定义文本")}
                <input type="text" aria-label={t("自定义文本")} placeholder={t("留空时只清洗")} value={sharedImageCustomText} disabled={!cleanSharedImages} onChange={event => {
                  try { setSharedImageCustomText(event.target.value); }
                  catch { notify('设置保存失败，请检查浏览器存储权限', 'error'); }
                }} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                <span className="mt-1 block text-xs leading-5 font-normal text-gray-500 dark:text-gray-400">{t("清洗后写入自定义文本，原图与历史保留。")}</span>
              </label>
            </div>}
          </section>

          <section id="settings-maintenance" className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'maintenance' ? 'hidden' : ''}`}>
            {activeSection === 'maintenance' && (isAndroidApp() ? <AndroidStorageManager notify={notify} /> : <div className="space-y-5">
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><StorageLocationManager notify={notify} /></div>
              <ArtistSampleManager />
              {/* 本地数据备份与还原 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <DataBackupManager notify={notify} />
              </div>

              {/* Windows 桌面启动器 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <DesktopLauncherManager notify={notify} />
              </div>

              {/* 智慧姬同步 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <SillyTavernBridgeExport notify={notify} />
              </div>

              {/* 局域网访问 */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-5 dark:border-gray-700">
                <div className="min-w-0 flex-1 basis-64">
                  <h4 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><Lock className="h-4 w-4 flex-none text-indigo-500" />{t("局域网访问")}</h4>
                  {maintenanceStatus?.lanUrls ? maintenanceStatus.lanUrls.length > 0 ? maintenanceStatus.lanUrls.map(url => (
                    <div key={url} className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex-none">{t("手机访问")}</span>
                      <span className="min-w-0 break-all font-mono select-all">{url}</span>
                      <button type="button" onClick={() => void copyTagText(url).then(() => notify('手机访问地址已复制'), () => notify('复制失败，请手动选择地址复制', 'error'))} aria-label={t("复制手机访问地址 {0}", [url])} title={t("复制手机访问地址")} className="mobile-touch flex flex-none items-center justify-center rounded-lg px-2 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300"><Copy className="h-3.5 w-3.5" /></button>
                    </div>
                  )) : <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("未检测到可用的局域网地址。")}</p> : <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{maintenanceStatusError ? t("手机访问地址读取失败") : maintenanceStatus ? t("重启工坊后显示手机访问地址") : t("正在读取手机访问地址…")}</p>}
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-none">
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
                    className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:w-40 sm:flex-none"
                  />
                  <button
                    type="button"
                    onClick={() => void saveLanPin()}
                    disabled={lanPinSaving || lanPin.length !== 4}
                    className="mobile-touch flex-none rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >{lanPinSaving ? t("保存中…") : t("更新密码")}</button>
                </div>
              </div>

              {/* 手机图片缓存 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">{t("手机图片缓存")}</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("仅缩略图，不影响原图。")}</p></div><Smartphone className="h-4 w-4 flex-none text-indigo-500" /></div><div className="mt-3 grid grid-cols-4 gap-2">{[0, 25, 50, 100].map(value => <button key={value} type="button" onClick={() => { setMobileCacheLimitMb(value); setMobileCacheStats(getMobileCacheStats()); }} className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${getMobileCacheLimitMb() === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{value === 0 ? t("关闭") : `${value} MB`}</button>)}</div><div className="appearance-group mt-3 flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-800/70"><span className="text-gray-500 dark:text-gray-400">{t("已缓存 {0} 张 · {1} MB / {2} MB", [mobileCacheStats.count, (mobileCacheStats.bytes / 1024 / 1024).toFixed(1), mobileCacheStats.limitMb])}</span><button type="button" onClick={async () => { if (!await confirmAction({ rememberKey: 'thumbnail-cache.clear', title: '清空手机小图缓存？', message: '只会清除可重新生成的缩略图，不会影响原图、历史或任何本地数据。', confirmLabel: '清空缓存', tone: 'danger' })) return; await clearMobileThumbnailCache(); setMobileCacheStats(getMobileCacheStats()); notify('手机小图缓存已清空'); }} className="flex-shrink-0 font-medium text-red-500 hover:text-red-600">{t("清空缓存")}</button></div></div>

              {/* 电脑缩略图缓存 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">{t("电脑缩略图缓存")}</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("自动管理缩略图，不影响原图。")}</p></div><Database className="h-4 w-4 flex-none text-indigo-500" /></div><div className="appearance-group mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">{maintenanceStatus ? <>{t("已缓存 ")}{maintenanceStatus.thumbnailCache.count} {t(" 张 · ")}{(maintenanceStatus.thumbnailCache.bytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.limitBytes / 1024 / 1024).toFixed(0)} MB<br />{t("固定封面 ")}{maintenanceStatus.thumbnailCache.pinnedCount} {t(" 张 · ")}{(maintenanceStatus.thumbnailCache.pinnedBytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.pinnedLimitBytes / 1024 / 1024).toFixed(0)} MB</> : t("等待读取本地缓存状态…")}</div></div>

              {/* Tag 补全词库 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><TagDictionaryUpdater notify={notify} /></div>

              {/* 本地服务状态 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">{t("本地服务状态")}</h4></div></div>{maintenanceStatusError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">{maintenanceStatusError}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.gatewayReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'appearance-group bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>{t("媒体网关：{0}", [maintenanceStatus?.gatewayReady ? t("可用") : t("正在检查")])}</div><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.workerReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : maintenanceStatus ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'appearance-group bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>{t("核心页面服务：{0}", [maintenanceStatus?.workerReady ? t("可用") : maintenanceStatus ? t("未就绪") : t("正在检查")])}</div></div>}</div>

              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><AppUpdateManager /></div>
              {/* 关于 NAI Atelier */}
              <div className="flex items-center justify-between gap-4"><div><h4 className="font-semibold text-gray-900 dark:text-white">{t("关于 NAI Atelier")}</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("个人维护版本 · v{0}", [__APP_VERSION__])}</p></div><a href="https://github.com/HelloQun54321/nai-atelier" target="_blank" rel="noreferrer" className="mobile-touch flex flex-none items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-500"><ExternalLink className="h-3.5 w-3.5" />{t("打开 GitHub")}</a></div>
            </div>)}
          </section>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
