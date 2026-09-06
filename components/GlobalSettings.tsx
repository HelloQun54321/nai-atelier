import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useModalA11y } from './useModalA11y';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';
import { DataBackupManager } from './DataBackupManager';
import { DesktopLauncherManager } from './DesktopLauncherManager';
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
import { DesktopImageColumns, getMobileImageDisplayPreferences, MobileImageColumns, MobileImageLayout, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { anlasBudgetService, DEFAULT_ANLAS_BUDGET, getActiveKeyHash, useAnlasBudget } from '../services/anlasBudget';
import { getNaiRuntimeConfig } from '../services/naiRuntime';
import { isNovelaiSubscriptionActive, isActiveOpusSubscription, useNovelaiUsage } from '../services/naiUsage';
import { getCachedCloudQueuePreferences, getCloudQueuePreferences, setCloudQueuePreferences } from '../services/cloudQueue';
import { naiKeyVault, NaiKeyEntry } from '../services/naiKeyVault';
import { PromptAgentSettings } from './PromptAgentSettings';
import {
  AppearancePreferences,
  AppearancePreset,
  BUILTIN_APPEARANCE_PRESET,
  CornerStyle,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAB_PAGE_LAYOUTS,
  cloneDefaultLabPageLayouts,
  FontScale,
  InterfaceDensity,
  LAB_PAGE_IDS,
  LabPageId,
  LabPageLayout,
  LabPageModuleId,
  MotionStyle,
  parseAppearancePresetsFromJson,
  SurfaceStyle,
  ThemeMode,
  validateAppearancePreset,
} from '../services/appearancePreferences';
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronRight, Database, Edit2, ExternalLink, FileDown, FileUp, FolderInput, FolderOutput, GripVertical, KeyRound, Lock, Monitor, Moon, Palette, Plus, RefreshCw, RotateCcw, Server, Shield, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, X } from 'lucide-react';

type SettingsSection = 'appearance' | 'generation' | 'novelai' | 'agent' | 'maintenance';
type SettingsPage = 'home' | SettingsSection;

interface LocalMaintenanceStatus {
  gatewayReady: boolean;
  workerReady: boolean;
  thumbnailCache: {
    count: number;
    bytes: number;
    pinnedCount: number;
    pinnedBytes: number;
    limitBytes: number;
    pinnedLimitBytes: number;
  };
}

const settingsSections: Array<{ id: SettingsSection; label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'appearance', label: '外观与画廊', description: '主题预设、防社死遮罩与画廊布局', icon: Palette },
  { id: 'generation', label: '生图偏好与实验室', description: '生成体验、计费保护与模块布局', icon: Sparkles },
  { id: 'novelai', label: 'NovelAI 与 Anlas', description: '连接、队列与本地预算', icon: KeyRound },
  { id: 'agent', label: '项目 Agent', description: '模型、权限与服务商', icon: Bot },
  { id: 'maintenance', label: '数据与维护', description: '备份、局域网访问、缓存与服务状态', icon: Database },
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
  description?: string;
}

const LAB_MODULE_META: Record<LabPageModuleId, { label: string; description: string }> = {
  prompt: { label: '全局提示词', description: '整张图片共用的画风、环境与主体描述' },
  characters: { label: '角色专属提示词', description: '角色描述、专属负面与构图坐标' },
  params: { label: '参数设置', description: '模型、尺寸、采样器、步数和 CFG' },
  negative: { label: '全局负面提示词', description: '整张图片共用的负面约束' },
  characterReference: { label: '角色参考', description: '角色参考图与相关参数' },
  vibe: { label: 'Vibe Transfer', description: 'Vibe 图像编码与复用' },
  baseImage: { label: '底图', description: '导入、替换与尺寸规范化' },
  editSettings: { label: '编辑参数', description: 'Strength、Noise、蒙版工具与画布扩展' },
};

const LAB_PAGE_META: Record<LabPageId, { label: string; description: string }> = {
  'text-to-image': { label: '文生图', description: '风格、角色、提示词和生成参数' },
  'image-to-image': { label: '图生图', description: '底图、提示词、参数与可用辅助模块' },
  inpaint: { label: '局部重绘', description: '底图、蒙版、Focused Inpainting 与参数' },
  outpaint: { label: '扩图', description: '底图、画布扩展、蒙版与生成参数' },
};

const AppearanceOptionGroup: React.FC<{
  value: string;
  options: AppearanceOption[];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`mobile-touch min-w-0 rounded-xl border px-2 py-2 text-center transition md:min-h-10 ${value === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600'}`}
      >
        <span className="block truncate text-xs font-bold">{option.label}</span>
        {option.description && <span className="mt-0.5 block truncate text-micro font-normal opacity-65">{option.description}</span>}
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

const readApiKey = () => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';

const maskNaiKeyForDisplay = (key: string) => {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed ? '****' : '';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, initialSection = 'home', notify, isDark, themeMode, setThemeMode, appearancePreferences, setAppearancePreferences, safeMode, safeModeStartup, safeModeHideTitles, setSafeModeStartup, setSafeModeHideTitles, toggleSafeMode }) => {
  const confirmAction = useConfirmDialog();
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => localStorage.getItem('nai_api_key') !== null);
  const [cloudQueue, setCloudQueue] = useState(getCachedCloudQueuePreferences);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [imageDisplay, setImageDisplay] = useState(getMobileImageDisplayPreferences);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [isLabMobile, setIsLabMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const [activeSection, setActiveSection] = useState<SettingsPage>('home');
  const [draggingLabModule, setDraggingLabModule] = useState<{ pageId: LabPageId; moduleId: LabPageModuleId } | null>(null);
  const [expandedLabPages, setExpandedLabPages] = useState<Record<LabPageId, boolean>>(() => Object.fromEntries(LAB_PAGE_IDS.map(pageId => [pageId, false])) as Record<LabPageId, boolean>);
  const anlasBudget = useAnlasBudget();
  // 当前使用密钥的订阅健康状态：每分钟轮询 + 切 Key 自动刷新，零额外探测请求。
  // 保管箱据此只对「当前使用」的 key 标失效，非当前 key 不做探测。
  const { info: currentSubscription, error: subscriptionError, loading: subscriptionLoading, refresh: refreshSubscription } = useNovelaiUsage();
  // 个人 Opus 免费图折算百分比用的换算系数（网关自动同步，17.3 张 ≈ 1%）。
  const [naiRuntimeCoefficient, setNaiRuntimeCoefficient] = useState(17.3);
  const [anlasInput, setAnlasInput] = useState(String(DEFAULT_ANLAS_BUDGET));
  const [maintenanceStatus, setMaintenanceStatus] = useState<LocalMaintenanceStatus | null>(null);
  const [maintenanceStatusError, setMaintenanceStatusError] = useState('');
  const [maintenanceStatusLoading, setMaintenanceStatusLoading] = useState(false);
  const [lanPin, setLanPin] = useState('');
  const [lanPinSaving, setLanPinSaving] = useState(false);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const importFileRef = React.useRef<HTMLInputElement | null>(null);
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
    const labQuery = window.matchMedia('(max-width: 1023px)');
    const updateLab = () => setIsLabMobile(labQuery.matches);
    labQuery.addEventListener('change', updateLab);
    return () => {
      query.removeEventListener('change', update);
      labQuery.removeEventListener('change', updateLab);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection === 'home' ? (isMobile ? 'home' : 'appearance') : initialSection);
    setApiKey(readApiKey());
    setRememberApiKey(localStorage.getItem('nai_api_key') !== null);
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
      if (event.key === 'Escape' && !closingRef.current) {
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
    setMaintenanceStatusLoading(true);
    setMaintenanceStatusError('');
    try {
      const response = await fetch('/api/local-maintenance/status', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as LocalMaintenanceStatus & { error?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.error || '无法读取本地服务状态');
      setMaintenanceStatus(payload);
    } catch (error) {
      setMaintenanceStatusError(error instanceof Error ? error.message : '无法读取本地服务状态');
    } finally {
      setMaintenanceStatusLoading(false);
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
    if (!open || activeSection !== 'maintenance') return;
    void refreshMaintenanceStatus();
  }, [open, activeSection, refreshMaintenanceStatus]);

  const broadcastApiKey = (value: string) => {
    window.dispatchEvent(new CustomEvent<string>('nai-api-key-changed', { detail: value }));
  };

  const updateApiKey = (value: string) => {
    setApiKey(value);
    if (value) sessionStorage.setItem('nai_api_key', value);
    else sessionStorage.removeItem('nai_api_key');
    if (rememberApiKey && value) localStorage.setItem('nai_api_key', value);
    else localStorage.removeItem('nai_api_key');
    broadcastApiKey(value);
  };

  const updateRememberApiKey = (remember: boolean) => {
    setRememberApiKey(remember);
    if (remember && apiKey) localStorage.setItem('nai_api_key', apiKey);
    else localStorage.removeItem('nai_api_key');
  };

  // ---- 多密钥保管箱 ----
  const [keyVault, setKeyVault] = useState<NaiKeyEntry[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [renamingKeyId, setRenamingKeyId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [showNewKeyValue, setShowNewKeyValue] = useState(false);

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
    notify(`已切换到「${entry.name}」`, 'success');
  };

  const addKeyEntry = async () => {
    const result = await naiKeyVault.add(newKeyName, newKeyValue);
    if (result.status === 'empty') {
      notify('密钥不能为空', 'error');
      return;
    }
    if (result.status === 'invalid') {
      notify('这不像 NovelAI 密钥：官方密钥以 pst- 开头。请检查是否粘贴了其他服务的密钥（浏览器可能自动填入了别处的密码）。', 'error');
      return;
    }
    if (result.status === 'duplicate') {
      notify('这把密钥已经在保管箱里了', 'error');
      return;
    }
    setNewKeyName('');
    setNewKeyValue('');
    await refreshVault();
    notify(`已添加「${result.entry.name}」`, 'success');
  };

  const removeKeyEntry = async (entry: NaiKeyEntry) => {
    const active = entry.key === readApiKey();
    if (!await confirmAction({
      title: `删除密钥「${entry.name}」？`,
      message: `仅从本机保管箱移除 ${maskNaiKeyForDisplay(entry.key)}${active ? '（当前正在使用，删除后需要重新选择密钥）' : ''}，不影响 NovelAI 账号本身。`,
      confirmLabel: '删除',
      tone: 'danger',
    })) return;
    await naiKeyVault.remove(entry.id);
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
    setAppearancePreferences(current => ({ ...current, ...patch }));
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

  const moveLabModule = (pageId: LabPageId, moduleId: LabPageModuleId, offset: -1 | 1) => {
    const layout = getLabPageLayout(pageId);
    const currentIndex = layout.order.indexOf(moduleId);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= layout.order.length) return;
    const next = [...layout.order];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    updateLabPageLayout(pageId, current => ({ ...current, order: next }));
  };

  const dropLabModule = (pageId: LabPageId, targetId: LabPageModuleId) => {
    if (!draggingLabModule || draggingLabModule.pageId !== pageId || draggingLabModule.moduleId === targetId) {
      setDraggingLabModule(null);
      return;
    }
    const layout = getLabPageLayout(pageId);
    const next = layout.order.filter(moduleId => moduleId !== draggingLabModule.moduleId);
    const targetIndex = layout.order.indexOf(targetId);
    next.splice(targetIndex, 0, draggingLabModule.moduleId);
    updateLabPageLayout(pageId, current => ({ ...current, order: next }));
    setDraggingLabModule(null);
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
    order: [...DEFAULT_LAB_PAGE_LAYOUTS[pageId].order],
    collapsed: { ...DEFAULT_LAB_PAGE_LAYOUTS[pageId].collapsed },
  }));

  const resetAllLabPageLayouts = () => updateAppearance({ labPageLayouts: cloneDefaultLabPageLayouts() });

  const resetThemeCustomization = () => {
    setAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      themeMode,
      tagAssistEnabled: appearancePreferences.tagAssistEnabled,
      labModuleOrder: appearancePreferences.labModuleOrder,
      labModuleCollapsed: appearancePreferences.labModuleCollapsed,
      labPageLayouts: appearancePreferences.labPageLayouts,
    });
  };

  const customPresets = appearancePreferences.customPresets || [];
  const allPresets: AppearancePreset[] = [BUILTIN_APPEARANCE_PRESET, ...customPresets];
  const activePresetId = appearancePreferences.activePresetId || 'builtin-default';

  const downloadJson = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const applyPreset = (preset: AppearancePreset) => {
    updateAppearance({
      accentColor: preset.accentColor,
      themeMode: preset.themeMode,
      density: preset.density,
      corners: preset.corners,
      surfaces: preset.surfaces,
      motion: preset.motion,
      fontScale: preset.fontScale,
      activePresetId: preset.id,
    });
    if (preset.themeMode !== themeMode) {
      setThemeMode(preset.themeMode);
    }
    notify?.('已应用外观预设「' + preset.name + '」', 'success');
  };

  const handleSaveCurrentPreset = () => {
    const trimmed = newPresetName.trim();
    const finalName = trimmed || `自定义外观 ${customPresets.length + 1}`;
    const newPreset: AppearancePreset = {
      id: `preset-${Date.now()}`,
      name: finalName,
      createdAt: Date.now(),
      accentColor: appearancePreferences.accentColor,
      themeMode,
      density: appearancePreferences.density,
      corners: appearancePreferences.corners,
      surfaces: appearancePreferences.surfaces,
      motion: appearancePreferences.motion,
      fontScale: appearancePreferences.fontScale,
    };
    updateAppearance({
      customPresets: [...customPresets, newPreset],
      activePresetId: newPreset.id,
    });
    setIsCreatingPreset(false);
    setNewPresetName('');
    notify?.('已保存新外观预设「' + newPreset.name + '」', 'success');
  };

  const handleDeletePreset = async (preset: AppearancePreset) => {
    if (preset.isBuiltin) return;
    const confirmed = await confirmAction({
      title: '删除外观预设',
      message: `确定要删除外观预设「${preset.name}」吗？此操作无法撤销。`,
      confirmLabel: '删除预设',
      tone: 'danger',
    });
    if (confirmed) {
      const nextPresets = customPresets.filter(p => p.id !== preset.id);
      updateAppearance({
        customPresets: nextPresets,
        ...(activePresetId === preset.id ? { activePresetId: 'builtin-default' } : {}),
      });
      notify?.('已删除外观预设「' + preset.name + '」', 'success');
    }
  };

  const handleRenamePreset = (presetId: string) => {
    const trimmed = editingPresetName.trim();
    if (!trimmed) {
      setEditingPresetId(null);
      return;
    }
    const nextPresets = customPresets.map(p => p.id === presetId ? { ...p, name: trimmed.slice(0, 30) } : p);
    updateAppearance({ customPresets: nextPresets });
    setEditingPresetId(null);
    notify?.('已重命名为「' + trimmed + '」', 'success');
  };

  const handleExportSinglePreset = (preset: AppearancePreset) => {
    const filename = `nai-preset-${preset.name.toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fa5]/gi, '_')}.json`;
    downloadJson(filename, [preset]);
    notify?.('已导出预设「' + preset.name + '」', 'success');
  };

  const handleExportAllPresets = () => {
    if (customPresets.length === 0) {
      notify?.('暂无自定义预设可导出');
      return;
    }
    downloadJson(`nai-appearance-presets-${new Date().toISOString().slice(0, 10)}.json`, {
      version: 1,
      exportedAt: Date.now(),
      presets: customPresets,
    });
    notify?.(`已导出 ${customPresets.length} 个自定义预设`, 'success');
  };

  const handleImportPresets = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      const parsed = parseAppearancePresetsFromJson(text);
      if (parsed.length === 0) {
        notify?.('导入失败：未找到有效的外观预设数据', 'error');
        return;
      }
      const existingNames = new Set(customPresets.map(p => p.name));
      const nextPresets = [...customPresets];
      let added = 0;
      for (const item of parsed) {
        let name = item.name;
        if (existingNames.has(name)) {
          name = `${name} (导入)`;
        }
        existingNames.add(name);
        nextPresets.push({
          ...item,
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          createdAt: Date.now(),
        });
        added++;
      }
      updateAppearance({ customPresets: nextPresets });
      notify?.(`成功导入 ${added} 个外观预设`, 'success');
      if (importFileRef.current) importFileRef.current.value = '';
    };
    reader.onerror = () => {
      notify?.('读取文件失败', 'error');
    };
    reader.readAsText(file);
  };

  if (!open) return null;

  const activeSectionMeta = activeSection === 'home' ? null : settingsSections.find(section => section.id === activeSection);

  return (
    <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-0 md:p-4" onMouseDown={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="全局设置"
        className="settings-dialog ui-modal-enter flex h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:h-[82vh] md:max-h-[860px] md:max-w-6xl md:rounded-2xl md:border"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="workspace-command-bar flex items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {activeSectionMeta && <button type="button" onClick={() => setActiveSection('home')} className="mobile-touch flex flex-none items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300 md:hidden" aria-label="返回设置分类" title="返回设置分类"><ArrowLeft className="h-[18px] w-[18px]" /></button>}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-gray-900 dark:text-white">{activeSectionMeta?.label || '全局设置'}</h2>
              <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{activeSectionMeta?.description || '连接信息和本地数据维护'}</p>
            </div>
          </div>
          <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="关闭全局设置">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="settings-navigation hidden w-64 flex-none border-r border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40 md:flex md:flex-col md:gap-1">
            {settingsSections.map(item => {
              const SectionIcon = item.icon;
              const active = activeSection === item.id;
              return <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-indigo-300 dark:ring-gray-700' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800/60'}`}>
                <SectionIcon className="h-4.5 w-4.5 flex-none" />
                <span className="min-w-0"><b className="block text-sm">{item.label}</b><span className="block truncate text-micro font-normal text-gray-400">{item.description}</span></span>
              </button>;
            })}
          </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          {activeSection === 'home' && <section className="mx-auto max-w-3xl md:hidden">
            <div className="mb-5"><h3 className="text-base font-bold text-gray-900 dark:text-white">选择设置分类</h3><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">每个分类在独立页面中打开，修改会按原有方式即时保存。</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {settingsSections.map(item => {
                const SectionIcon = item.icon;
                return <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className="flex min-h-24 items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><SectionIcon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><b className="block text-sm text-gray-900 dark:text-white">{item.label}</b><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{item.description}</span></span>
                  <ChevronRight className="h-4 w-4 flex-none text-gray-400" />
                </button>;
              })}
            </div>
          </section>}
          <div className={activeSection === 'home' ? 'hidden' : 'space-y-3'}>
          <section id={`settings-appearance`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'appearance' ? 'hidden' : ''}`}>
            {activeSection === 'appearance' && <div className="space-y-3">
              <div>
                <div className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">明暗模式</div>
                <div className="grid grid-cols-3 gap-2">
                  {([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as const).map(option => { const ModeIcon = option.icon; return <button key={option.value} type="button" onClick={() => setThemeMode(option.value)} className={`mobile-touch flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition md:h-10 ${themeMode === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}><ModeIcon className="h-3.5 w-3.5 flex-none" /><span className="truncate">{option.label}</span></button>; })}
                </div>
              </div>

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <button type="button" onClick={toggleSafeMode} aria-pressed={safeMode} className={`mobile-touch md:h-10 flex w-full items-center justify-between rounded-xl px-3 text-sm font-bold ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span className="flex items-center gap-2"><Shield className="h-4 w-4" />安全模式（防社死）</span><span>{safeMode ? '已开启' : '已关闭'}</span></button>
                <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">开启后遮挡全站图片；点击图片可临时显示，离开后自动重新遮挡。</p>
                <button type="button" onClick={() => setSafeModeHideTitles(enabled => !enabled)} aria-pressed={safeModeHideTitles} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700">
                  <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">同时隐藏作品名称</b><span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">开启后可单独点击名称显示；点击图片会连同对应名称一起显示。</span></span>
                  <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeModeHideTitles ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeModeHideTitles ? 'translate-x-5' : 'translate-x-0'}`} /></span>
                </button>
                <button type="button" onClick={() => setSafeModeStartup(enabled => !enabled)} aria-pressed={safeModeStartup} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700">
                  <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">启动时自动开启安全模式</b><span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">每次重新打开项目时默认开启；关闭后启动时保持关闭，当前会话仍可手动切换。</span></span>
                  <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeModeStartup ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeModeStartup ? 'translate-x-5' : 'translate-x-0'}`} /></span>
                </button>
              </div>

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">图片列表布局</div>
                <div className="grid grid-cols-3 gap-2">
                  {([['masonry', '瀑布流'], ['portrait', '竖向卡片'], ['square', '方形']] as const).map(([layout, label]) => <button key={layout} type="button" onClick={() => { const next = { ...imageDisplay, layout: layout as MobileImageLayout }; setImageDisplay(next); setMobileImageDisplayPreferences(next); }} className={`mobile-touch md:h-10 rounded-xl border px-2 text-xs font-bold ${imageDisplay.layout === layout ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{label}</button>)}
                </div>
                <div className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">移动端列数</span>
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.columns === 'auto' ? '自适应' : `${imageDisplay.columns} 列`}</span>
                  </div>
                  <input type="range" min={0} max={3} step={1} value={imageDisplay.columns === 'auto' ? 0 : imageDisplay.columns} onChange={event => { const value = Number(event.target.value); const next = { ...imageDisplay, columns: (value === 0 ? 'auto' : value) as MobileImageColumns }; setImageDisplay(next); setMobileImageDisplayPreferences(next); }} className="mt-2 block w-full accent-indigo-500" aria-label="移动端列数" />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">桌面端列数</span>
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{imageDisplay.desktopColumns === 'auto' ? '自适应' : `${imageDisplay.desktopColumns} 列`}</span>
                  </div>
                  <input type="range" min={0} max={5} step={1} value={imageDisplay.desktopColumns === 'auto' ? 0 : imageDisplay.desktopColumns} onChange={event => { const value = Number(event.target.value); const next = { ...imageDisplay, desktopColumns: (value === 0 ? 'auto' : value) as DesktopImageColumns }; setImageDisplay(next); setMobileImageDisplayPreferences(next); }} className="mt-2 block w-full accent-indigo-500" aria-label="桌面端列数" />
                </div>
                </div>
                <p className="mt-3 text-meta leading-5 text-gray-500 dark:text-gray-400">支持按屏幕宽度自适应或固定每行图片列数。原图、详情与下载始终使用原始画质。</p>
              </div>

              {/* 设计主题与预设管理 */}
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <input
                  type="file"
                  ref={importFileRef}
                  accept=".json,application/json"
                  onChange={handleImportPresets}
                  className="hidden"
                />
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-200">设计主题</div>
                      <span className="flex-none text-micro font-medium text-gray-400">{allPresets.length} 个可用主题</span>
                    </div>
                    <p className="mt-0.5 text-meta text-gray-500 dark:text-gray-400">选择预设主题或保存你调配的专属风格；明暗模式独立配合。</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                      title="从 JSON 文件导入主题预设"
                    >
                      <FolderInput className="h-3 w-3" />导入
                    </button>
                    {customPresets.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportAllPresets}
                        className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-meta font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                        title="导出全部自定义主题为 JSON 文件"
                      >
                        <FolderOutput className="h-3 w-3" />导出全部
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCreatingPreset(true)}
                      className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-meta font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      <Plus className="h-3 w-3" />另存当前主题
                    </button>
                  </div>
                </div>

                {isCreatingPreset && (
                  <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                    <div className="text-meta font-bold text-indigo-900 dark:text-indigo-200 mb-1.5">
                      保存当前外观配置为新主题
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newPresetName}
                        onChange={e => setNewPresetName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveCurrentPreset();
                          if (e.key === 'Escape') setIsCreatingPreset(false);
                        }}
                        placeholder={`例如：晴空午夜、舒适大字（默认：自定义主题 ${customPresets.length + 1}）`}
                        maxLength={30}
                        autoFocus
                        className="h-8 flex-1 rounded-lg border border-indigo-300 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-indigo-700 dark:bg-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={handleSaveCurrentPreset}
                        className="h-8 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-500"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingPreset(false);
                          setNewPresetName('');
                        }}
                        className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                <div className={`grid gap-3 ${allPresets.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                  {allPresets.map(preset => {
                    const isSelected = activePresetId === preset.id;
                    const isEditing = editingPresetId === preset.id;
                    const presetAccent = isSelected ? (appearancePreferences.accentColor || '#0ea5e9') : (preset.accentColor || '#0ea5e9');
                    return (
                      <div
                        key={preset.id}
                        onClick={() => !isEditing && applyPreset(preset)}
                        className={`atelier-theme-card group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-3 text-left transition cursor-pointer ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-500/15 dark:border-indigo-500/80 dark:bg-indigo-950/20'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-gray-700'
                        }`}
                      >
                        {isSelected && !isEditing && (
                          <span className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}

                        <div className="flex min-w-0 items-center gap-3">
                          {/* 微缩界面骨架 */}
                          <div
                            className="atelier-theme-preview grid h-20 w-28 flex-none grid-cols-[1.8rem_1fr] overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-900"
                            aria-hidden="true"
                          >
                            <div className="border-r border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-950">
                              <span className="mt-1 block h-1 w-3 rounded-full" style={{ backgroundColor: presetAccent }} />
                              <span className="mt-2 block h-1 w-4 rounded-full bg-gray-300 dark:bg-gray-600" />
                              <span className="mt-1 block h-1 w-4 rounded-full bg-gray-400 dark:bg-gray-700" />
                            </div>
                            <div className="p-1.5">
                              <span className="block h-2 w-8 rounded opacity-85" style={{ backgroundColor: presetAccent }} />
                              <span className="mt-1.5 block h-5 rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
                              <span className="mt-1.5 grid grid-cols-2 gap-1">
                                <span className="h-7 rounded bg-gray-200 dark:bg-gray-800" />
                                <span className="h-7 rounded bg-gray-200 dark:bg-gray-800" />
                              </span>
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
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
                                  className="rounded bg-indigo-600 px-2 py-1 text-micro font-bold text-white hover:bg-indigo-500"
                                >
                                  确定
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPresetId(null)}
                                  className="rounded px-1.5 py-1 text-micro font-bold text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <b className="truncate text-sm text-gray-900 dark:text-white">{preset.name}</b>
                                  {preset.isBuiltin && (
                                    <span className="flex items-center gap-0.5 rounded bg-gray-100 px-1 py-0.2 text-mini font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400" title="出厂默认主题（锁定保护不可删除）">
                                      <Lock className="h-2.5 w-2.5" />默认锁定
                                    </span>
                                  )}
                                </div>
                                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                                  {preset.isBuiltin ? '默认出厂外观配置（石墨炭黑 / 晴空蓝）。' : `${preset.themeMode === 'dark' ? '深色' : preset.themeMode === 'light' ? '浅色' : '跟随系统'} · ${preset.density === 'compact' ? '紧凑' : preset.density === 'comfortable' ? '舒展' : '标准'}密度 · ${preset.corners === 'sharp' ? '锐利' : preset.corners === 'soft' ? '柔和' : '标准'}圆角`}
                                </span>
                                <span className="mt-1 block text-micro font-semibold text-indigo-600 dark:text-indigo-300">
                                  {isSelected ? `当前使用（${isDark ? '深色版本' : '浅色版本'}）` : `强调色：${presetAccent}`}
                                </span>
                              </>
                            )}
                          </div>
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
                              aria-label={`导出「${preset.name}」`}
                              title="导出此主题为 JSON 文件"
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
                                  aria-label={`重命名「${preset.name}」`}
                                  title="重命名"
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePreset(preset)}
                                  aria-label={`删除「${preset.name}」`}
                                  title="删除"
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
                <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-indigo-500" /><div><h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">个性化</h4><p className="text-micro text-gray-500 dark:text-gray-400">微调当前主题的样式细节。</p></div></div>

                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="text-meta font-bold text-gray-600 dark:text-gray-300">强调色</span><span className="font-mono text-micro uppercase text-gray-400">{appearancePreferences.accentColor}</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map(preset => <button key={preset.color} type="button" onClick={() => updateAppearance({ accentColor: preset.color })} aria-label={`强调色：${preset.label}`} title={preset.label} className={`mobile-size-locked relative h-8 w-8 rounded-full border-2 transition hover:scale-105 ${appearancePreferences.accentColor === preset.color ? 'border-gray-900 ring-2 ring-gray-900/15 dark:border-white dark:ring-white/20' : 'border-white shadow-sm dark:border-gray-700'}`} style={{ backgroundColor: preset.color }}>{appearancePreferences.accentColor === preset.color && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />}</button>)}
                    <label className="relative flex h-8 min-w-24 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-white px-2 text-micro font-bold text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"><Palette className="h-3.5 w-3.5" />自定义<input type="color" value={appearancePreferences.accentColor} onChange={event => updateAppearance({ accentColor: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="自定义强调色" /></label>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">界面密度</div><AppearanceOptionGroup value={appearancePreferences.density} onChange={value => updateAppearance({ density: value as InterfaceDensity })} options={[{ value: 'comfortable', label: '舒展' }, { value: 'standard', label: '标准' }, { value: 'compact', label: '紧凑' }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">圆角语言</div><AppearanceOptionGroup value={appearancePreferences.corners} onChange={value => updateAppearance({ corners: value as CornerStyle })} options={[{ value: 'soft', label: '柔和' }, { value: 'standard', label: '标准' }, { value: 'sharp', label: '锐利' }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">表面材质</div><AppearanceOptionGroup value={appearancePreferences.surfaces} onChange={value => updateAppearance({ surfaces: value as SurfaceStyle })} options={[{ value: 'solid', label: '实色', description: '主题默认' }, { value: 'translucent', label: '透光', description: '轻微模糊' }]} /></div>
                  <div><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">字号</div><AppearanceOptionGroup value={appearancePreferences.fontScale} onChange={value => updateAppearance({ fontScale: value as FontScale })} options={[{ value: 'small', label: '偏小' }, { value: 'standard', label: '标准' }, { value: 'large', label: '偏大' }]} /></div>
                  <div className="lg:col-span-2"><div className="mb-2 text-meta font-bold text-gray-600 dark:text-gray-300">动效</div><AppearanceOptionGroup value={appearancePreferences.motion} onChange={value => updateAppearance({ motion: value as MotionStyle })} options={[{ value: 'full', label: '完整' }, { value: 'reduced', label: '减少' }, { value: 'off', label: '关闭' }]} /></div>
                </div>

                <button type="button" onClick={resetThemeCustomization} className="mobile-touch mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"><RotateCcw className="h-3.5 w-3.5" />恢复 NAI Atelier 默认外观</button>
              </div>
            </div>}
          </section>
          <section id={`settings-generation`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'generation' ? 'hidden' : ''}`}>
            {activeSection === 'generation' && <div className="space-y-3">
              <button type="button" onClick={() => updateAppearance({ generationStreamPreview: !appearancePreferences.generationStreamPreview })} aria-pressed={appearancePreferences.generationStreamPreview} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">生成过程预览</b><span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">生图过程中逐步显示采样画面。</span></span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.generationStreamPreview ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.generationStreamPreview ? 'translate-x-5' : 'translate-x-0'}`} /></span>
              </button>

              <button type="button" onClick={() => updateAppearance({ forceEmptySeed: !appearancePreferences.forceEmptySeed })} aria-pressed={appearancePreferences.forceEmptySeed} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0">
                  <b className="block text-xs text-gray-800 dark:text-gray-100">强制清空随机种子（始终随机）</b>
                  <span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">
                    开启后，风格串与实验室的随机种子输入框将暂时置空并使用全随机种子生图，不会修改预设原本保存的数值；关闭后立即恢复。
                  </span>
                </span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.forceEmptySeed ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.forceEmptySeed ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>

              <button type="button" onClick={() => updateAppearance({ enforceFreeStepLimit: !appearancePreferences.enforceFreeStepLimit })} aria-pressed={appearancePreferences.enforceFreeStepLimit} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700">
                <span className="min-w-0">
                  <b className="block text-xs text-gray-800 dark:text-gray-100">生成步数锁定在免费额度内</b>
                  <span className="mt-0.5 block text-micro leading-4 text-gray-500 dark:text-gray-400">
                    开启时，风格串与实验室的生成步数上限锁定在官方免费门槛（当前 28 步）内，避免无意跨入 Anlas 计费；关闭后可手动输入更高步数（至多 50），费用估算会按实际步数计费。
                  </span>
                </span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${appearancePreferences.enforceFreeStepLimit ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${appearancePreferences.enforceFreeStepLimit ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>

              <div className={`rounded-2xl border transition-all ${isLabMobile ? 'border-gray-200 bg-gray-100/70 p-3 dark:border-gray-800 dark:bg-gray-900/40' : 'border-gray-200 bg-gray-50/65 p-3 dark:border-gray-700 dark:bg-gray-950/35'}`}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">实验室模块布局</h4>
                      {isLabMobile && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                          <Lock className="h-3 w-3" />移动端已锁定
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-micro leading-4 text-gray-500 dark:text-gray-400">
                      {isLabMobile ? '移动端已采用三段式标签流，模块排版已锁定；如需自定义双栏布局请在电脑端操作。' : '自定义文生图、图生图、局部重绘与扩图的模块顺序与展开状态。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isLabMobile}
                    onClick={resetAllLabPageLayouts}
                    className="mobile-touch flex flex-none items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-micro font-bold text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-600"
                  >
                    <RotateCcw className="h-3 w-3" />全部推荐
                  </button>
                </div>
                {isLabMobile && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-micro font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    <Smartphone className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>当前设备处于移动视图，实验室各模式已固定为「角色/画布/全局/参数」三段式流，不可在此更改顺序。</span>
                  </div>
                )}
                <div className={`space-y-2 ${isLabMobile ? 'pointer-events-none select-none opacity-50' : ''}`}>
                  {LAB_PAGE_IDS.map(pageId => {
                    const pageMeta = LAB_PAGE_META[pageId];
                    const layout = getLabPageLayout(pageId);
                    const defaultLayout = DEFAULT_LAB_PAGE_LAYOUTS[pageId];
                    const isCustom = JSON.stringify(layout) !== JSON.stringify(defaultLayout);
                    return <details key={pageId} open={expandedLabPages[pageId]} onToggle={event => {
                      // React 的 currentTarget 只在事件回调执行期间有效；状态更新器可能延迟执行。
                      const expanded = event.currentTarget.open;
                      setExpandedLabPages(current => current[pageId] === expanded ? current : { ...current, [pageId]: expanded });
                    }} className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0"><span className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-200"><span>{pageMeta.label}</span>{isCustom && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-mini font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">已自定义</span>}</span><span className="mt-0.5 block truncate text-micro text-gray-400">{pageMeta.description} · {layout.order.length} 个模块</span></span>
                        <ChevronRight className="h-4 w-4 flex-none text-gray-400 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="border-t border-gray-100 p-2.5 dark:border-gray-800">
                        <div className="mb-2 flex items-center justify-between gap-2"><span className="text-micro text-gray-400">支持拖动排序，也可用箭头微调</span><button type="button" onClick={() => resetLabPageLayout(pageId)} className="mobile-touch flex items-center gap-1 rounded-lg px-2 py-1 text-micro font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"><RotateCcw className="h-3 w-3" />推荐顺序</button></div>
                        <div className="space-y-2">
                          {layout.order.map((moduleId, index) => {
                            const meta = LAB_MODULE_META[moduleId];
                            const collapsed = Boolean(layout.collapsed[moduleId]);
                            const dragging = draggingLabModule?.pageId === pageId && draggingLabModule.moduleId === moduleId;
                            return <div
                              key={moduleId}
                              draggable
                              onDragStart={event => {
                                setDraggingLabModule({ pageId, moduleId });
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', moduleId);
                              }}
                              onDragEnd={() => setDraggingLabModule(null)}
                              onDragOver={event => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                              }}
                              onDrop={event => {
                                event.preventDefault();
                                dropLabModule(pageId, moduleId);
                              }}
                              className={`flex items-center gap-2 rounded-xl border bg-gray-50/60 p-2 transition dark:bg-gray-800/50 ${dragging ? 'border-indigo-400 opacity-55 dark:border-indigo-500' : 'border-gray-200 dark:border-gray-700'}`}
                            >
                              <GripVertical className="h-4 w-4 flex-none cursor-grab text-gray-300 active:cursor-grabbing dark:text-gray-600" aria-hidden="true" />
                              <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-gray-700 dark:text-gray-200">{index + 1}. {meta.label}</div><div className="truncate text-micro text-gray-400" title={meta.description}>{meta.description}</div></div>
                              <div className="flex flex-none items-center gap-1"><button type="button" onClick={() => moveLabModule(pageId, moduleId, -1)} disabled={index === 0} aria-label={`上移${meta.label}`} title="上移" className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-25 dark:hover:bg-gray-800 dark:hover:text-indigo-300"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => moveLabModule(pageId, moduleId, 1)} disabled={index === layout.order.length - 1} aria-label={`下移${meta.label}`} title="下移" className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-25 dark:hover:bg-gray-800 dark:hover:text-indigo-300"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => toggleLabModuleCollapsed(pageId, moduleId)} aria-pressed={collapsed} className={`ml-1 rounded-full border px-2 py-1 text-micro font-bold transition ${collapsed ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>{collapsed ? '默认收起' : '默认展开'}</button></div>
                            </div>;
                          })}
                        </div>
                      </div>
                    </details>;
                  })}
                </div>
              </div>
            </div>}
          </section>
          <section id={`settings-novelai`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'novelai' ? 'hidden' : ''}`}>
            {activeSection === 'novelai' && <div>
            {/* 密钥保管箱：多把密钥 + 命名备注，点击使用即切换 */}
            <div className="space-y-2">
              {keyVault.length === 0 && (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">还没有保存的密钥，在下方添加第一把。</p>
              )}
              {keyVault.map(entry => {
                const active = entry.key === apiKey;
                // 只对「当前使用」的 key 显示订阅健康（复用轮询结果，不额外探测）；
                // 加载中/请求失败时不妄断失效，避免误标。
                const activeKeySubscription = active
                  ? { info: currentSubscription, error: subscriptionError, loading: subscriptionLoading, refresh: refreshSubscription }
                  : null;
                const keyInvalid = Boolean(activeKeySubscription)
                  && !activeKeySubscription!.loading
                  && !activeKeySubscription!.error
                  && isNovelaiSubscriptionActive(activeKeySubscription!.info) === false;
                const keyNonOpus = Boolean(activeKeySubscription)
                  && !activeKeySubscription!.loading
                  && !activeKeySubscription!.error
                  && isNovelaiSubscriptionActive(activeKeySubscription!.info) === true
                  && !isActiveOpusSubscription(activeKeySubscription!.info);
                return (
                  <div key={entry.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${active ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-950/30' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'}`}>
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
                        aria-label="密钥备注名"
                      />
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-gray-800 dark:text-gray-100" title={entry.name}>{entry.name}</span>
                          {!entry.key.startsWith('pst-') && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title="NovelAI 官方密钥以 pst- 开头，这可能是误存的其他服务密钥（例如被浏览器自动填入）">格式可疑</span>}
                          {keyInvalid && <span className="flex-none rounded-full bg-red-100 px-1.5 py-0.5 text-micro font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300" title="NovelAI 返回该密钥订阅已失效；生成请求会被拒绝，请切换其他密钥">已失效</span>}
                          {keyNonOpus && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title="当前订阅不是 Opus 档，无免费生成额度，按 Anlas 扣费生成">非 Opus</span>}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-meta text-gray-500 dark:text-gray-400">{maskNaiKeyForDisplay(entry.key)}</p>
                      </div>
                    )}
                    <div className="flex flex-none items-center gap-1">
                      <button type="button" onClick={() => { setRenamingKeyId(entry.id); setRenameValue(entry.name); }} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700" title="修改备注名">备注</button>
                      {renamingKeyId !== entry.id && <button type="button" disabled={active} aria-pressed={active} onClick={() => activateKeyEntry(entry)} className={`rounded-lg px-2.5 py-1 text-xs font-bold text-white ${active ? 'cursor-default bg-indigo-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>{active ? '使用中' : '使用'}</button>}
                      {renamingKeyId !== entry.id && <button type="button" onClick={() => void removeKeyEntry(entry)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="删除">删除</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-xs font-bold text-gray-500 dark:text-gray-400">添加密钥</div>
              <input
                value={newKeyName}
                onChange={event => setNewKeyName(event.target.value)}
                maxLength={30}
                placeholder="备注名（例如：车队 A / 备用号）"
                autoComplete="off"
                name="nai-vault-key-label"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                aria-label="密钥备注名"
              />
              <div className="flex gap-2">
                <input
                  type={showNewKeyValue ? 'text' : 'password'}
                  value={newKeyValue}
                  onChange={event => setNewKeyValue(event.target.value.trim())}
                  placeholder="NovelAI API Key（pst-…）"
                  autoComplete="new-password"
                  name="nai-vault-key-secret"
                  readOnly={false}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  aria-label="NovelAI API Key"
                />
                <button type="button" onClick={() => setShowNewKeyValue(value => !value)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                  {showNewKeyValue ? '隐藏' : '显示'}
                </button>
                <button type="button" onClick={() => void addKeyEntry()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500">添加</button>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={rememberApiKey} onChange={event => updateRememberApiKey(event.target.checked)} className="rounded border-gray-300 text-indigo-600" />
              在本机记住当前使用的 API Key
            </label>
            <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">保管箱与备注由本地服务保存在 local-data 数据目录；「当前使用的密钥」按上方开关保留在本机浏览器。密钥以明文存储于本机，局域网访问受访问密码保护。</p>
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span><b className="block text-sm text-gray-800 dark:text-gray-100">多人拼车公共队列</b><span className="mt-0.5 block text-meta leading-5 text-gray-500 dark:text-gray-400">兼容 st-chatu8；设置按当前 NovelAI Key 独立保存，切换 Key 后不会串用；相同 Key 的接入者依次生图。</span></span>
                <input type="checkbox" checked={cloudQueue.enabled} onChange={event => updateCloudQueue({ enabled: event.target.checked })} className="h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600" />
              </label>
              <div className="mt-3 space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
                <div><label className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">公共队列服务地址</label><input type="url" value={cloudQueue.serviceUrl} onChange={event => { const serviceUrl = event.currentTarget.value; setCloudQueue(value => ({ ...value, serviceUrl })); }} onBlur={event => updateCloudQueueServiceUrl(event.currentTarget.value)} placeholder="例如 https://your-queue.example.com 或自建服务地址" className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" /><p className="mt-1 text-micro leading-4 text-gray-400">填写你或车队部署的 st-chatu8 兼容排队服务地址；留空时不启用排队。</p></div>
                {cloudQueue.enabled && <>
                  <div><label className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">排队个性语（最多15字）</label><input value={cloudQueue.greeting} maxLength={15} onChange={event => { const greeting = event.currentTarget.value.slice(0, 15); setCloudQueue(value => ({ ...value, greeting })); }} onBlur={() => updateCloudQueue({ greeting: cloudQueue.greeting })} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" /></div>
                  <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-gray-700 dark:text-gray-200"><span>显示当前使用者的个性语</span><input type="checkbox" checked={cloudQueue.showGreeting} onChange={event => updateCloudQueue({ showGreeting: event.target.checked })} className="h-5 w-5 rounded border-gray-300 text-indigo-600" /></label>
                </>}
                <p className="text-meta leading-5 text-amber-600 dark:text-amber-400">仅用于排队协调，不会上传密钥明文、提示词或图片数据。</p>
              </div>
            </div>
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div><h4 className="font-semibold text-gray-900 dark:text-white">Anlas 点数预算</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">当前密钥剩余 <b className="text-indigo-600 dark:text-indigo-300">{anlasBudget.remaining}</b> 点，电脑与手机共用。</p></div>
              <div className="mt-3 flex gap-2">
                <input type="number" min="0" step="1" value={anlasInput} onChange={event => setAnlasInput(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-lg font-black tabular-nums outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" aria-label="可支配 Anlas 点数" />
                <button type="button" onClick={async () => { const next = await anlasBudgetService.set(Number(anlasInput)); setAnlasInput(String(next.remaining)); notify('Anlas 预算已更新'); }} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white">保存</button>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-meta leading-5 text-gray-500 dark:text-gray-400"><p>本地预算仅用于超额预警与消耗追踪（每把密钥独立记录，电脑与手机共用）。生图与 Vibe 编码成功后自动扣减，不影响云端账户。</p><button type="button" onClick={async () => { const next = await anlasBudgetService.set(DEFAULT_ANLAS_BUDGET); setAnlasInput(String(next.remaining)); }} className="flex-shrink-0 font-bold text-indigo-600 dark:text-indigo-300">恢复 1666</button></div>
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">个人使用统计（当前密钥）</span>
                  {anlasBudget.personal && (anlasBudget.personal.anlasSpent > 0 || anlasBudget.personal.opusImages > 0) && (
                    <button type="button" onClick={async () => {
                      if (!await confirmAction({ title: '重置个人使用统计？', message: '把当前密钥的个人 Anlas 花费与 Opus 免费图计数清零，不影响本地预算。', confirmLabel: '重置', tone: 'danger' })) return;
                      try {
                        const keyHash = await getActiveKeyHash();
                        if (!keyHash) return;
                        await anlasBudgetService.resetPersonal(keyHash);
                        await anlasBudget.refresh();
                        notify('个人统计已重置');
                      } catch {
                        notify('重置失败', 'error');
                      }
                    }} className="text-meta font-bold text-indigo-600 dark:text-indigo-300">重置</button>
                  )}
                </div>
                {(() => {
                  const personal = anlasBudget.personal || (apiKey ? { anlasSpent: 0, opusImages: 0 } : null);
                  if (!personal) {
                    return <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">尚未配置 NovelAI 密钥。统计只记本机行为，按密钥分账号累计。</p>;
                  }
                  const hasRecords = anlasBudget.personal != null;
                  return (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
                          <div className="text-meta text-gray-500 dark:text-gray-400">个人已花 Anlas</div>
                          <div className="mt-0.5 text-lg font-black tabular-nums text-indigo-600 dark:text-indigo-300">{personal.anlasSpent}</div>
                        </div>
                        <div className="rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
                          <div className="text-meta text-gray-500 dark:text-gray-400">个人 Opus 免费图</div>
                          <div className="mt-0.5 text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-300">{personal.opusImages} 张</div>
                          <div className="text-micro text-gray-400">≈ {(personal.opusImages / naiRuntimeCoefficient).toFixed(2)}% 额度</div>
                        </div>
                      </div>
                      {!hasRecords && (
                        <p className="mt-2 text-meta leading-5 text-gray-500 dark:text-gray-400">本机在该账号尚未产生计费记录。统计口径：扣费生成（大图/多步/角色参考/Vibe 编码等）计入个人 Anlas，受限模型的免费档生成计入 Opus 额度；标准免费小图不计入。</p>
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

          <section id="settings-maintenance" className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'maintenance' ? 'hidden' : ''}`}>
            {activeSection === 'maintenance' && <div className="space-y-5">
              {/* 本地数据备份与还原 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <DataBackupManager notify={notify} />
              </div>

              {/* Windows 桌面启动器 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <DesktopLauncherManager notify={notify} />
              </div>

              {/* SillyTavern 互通扩展 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <SillyTavernBridgeExport notify={notify} />
              </div>

              {/* 局域网访问密码 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">局域网访问密码</h4>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">手机通过局域网访问时使用的四位数字密码；电脑与手机均可修改，保存后立即生效，无需重启。</p>
                  </div>
                  <Lock className="h-4 w-4 flex-none text-indigo-500" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    maxLength={4}
                    value={lanPin}
                    onChange={event => setLanPin(event.currentTarget.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="新的 4 位数字密码"
                    className="mobile-touch w-40 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => void saveLanPin()}
                    disabled={lanPinSaving || lanPin.length !== 4}
                    className="mobile-touch flex-none rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >{lanPinSaving ? '保存中…' : '更新密码'}</button>
                </div>
              </div>

              {/* 手机图片缓存 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">手机图片缓存</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">仅保存列表缩略图；清除后可重新生成，不会影响原图、历史或电脑数据。</p></div><Smartphone className="h-4 w-4 flex-none text-indigo-500" /></div><div className="mt-3 grid grid-cols-4 gap-2">{[0, 25, 50, 100].map(value => <button key={value} type="button" onClick={() => { setMobileCacheLimitMb(value); setMobileCacheStats(getMobileCacheStats()); }} className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${getMobileCacheLimitMb() === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{value === 0 ? '关闭' : `${value} MB`}</button>)}</div><div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-800/70"><span className="text-gray-500 dark:text-gray-400">已缓存 {mobileCacheStats.count} 张 · {(mobileCacheStats.bytes / 1024 / 1024).toFixed(1)} MB / {mobileCacheStats.limitMb} MB</span><button type="button" onClick={async () => { if (!await confirmAction({ title: '清空手机小图缓存？', message: '只会清除可重新生成的缩略图，不会影响原图、历史或任何本地数据。', confirmLabel: '清空缓存', tone: 'danger' })) return; await clearMobileThumbnailCache(); setMobileCacheStats(getMobileCacheStats()); notify('手机小图缓存已清空'); }} className="flex-shrink-0 font-medium text-red-500 hover:text-red-600">清空缓存</button></div></div>

              {/* 电脑缩略图缓存 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">电脑缩略图缓存</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">本地小图缓存已建立自动空间管理；清除后可重新生成，不影响原图。</p></div><Database className="h-4 w-4 flex-none text-indigo-500" /></div><div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">{maintenanceStatus ? <>已缓存 {maintenanceStatus.thumbnailCache.count} 张 · {(maintenanceStatus.thumbnailCache.bytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.limitBytes / 1024 / 1024).toFixed(0)} MB<br />固定封面 {maintenanceStatus.thumbnailCache.pinnedCount} 张 · {(maintenanceStatus.thumbnailCache.pinnedBytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.pinnedLimitBytes / 1024 / 1024).toFixed(0)} MB</> : '等待读取本地缓存状态…'}</div></div>

              {/* Tag 补全词库 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h4 className="font-semibold text-gray-900 dark:text-white">Tag 补全词库</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">词库由用户按需下载（源自 ffdkj 开源项目），支持查看版本、数量并检查中英 Tag 数据更新。</p></div><div className="flex flex-none sm:justify-end"><TagDictionaryUpdater notify={notify} /></div></div></div>

              {/* 本地服务状态 */}
              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">本地服务状态</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">状态来自当前运行的媒体网关与核心页面服务；手机访问时也会经过同一套验证。</p></div><button type="button" onClick={() => void refreshMaintenanceStatus()} disabled={maintenanceStatusLoading} className="mobile-touch flex flex-none items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" title="刷新本地服务状态"><RefreshCw className={`h-3.5 w-3.5 ${maintenanceStatusLoading ? 'animate-spin' : ''}`} />刷新</button></div>{maintenanceStatusError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">{maintenanceStatusError}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.gatewayReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>媒体网关：{maintenanceStatus?.gatewayReady ? '可用' : '正在检查'}</div><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.workerReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : maintenanceStatus ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>核心页面服务：{maintenanceStatus?.workerReady ? '可用' : maintenanceStatus ? '未就绪' : '正在检查'}</div></div>}</div>

              {/* 关于 NAI Atelier */}
              <div className="flex items-center justify-between gap-4"><div><h4 className="font-semibold text-gray-900 dark:text-white">关于 NAI Atelier</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">个人维护版本 · v{__APP_VERSION__}</p></div><a href="https://github.com/HelloQun54321/nai-atelier" target="_blank" rel="noreferrer" className="mobile-touch flex flex-none items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"><ExternalLink className="h-3.5 w-3.5" />打开 GitHub</a></div>
            </div>}
          </section>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
