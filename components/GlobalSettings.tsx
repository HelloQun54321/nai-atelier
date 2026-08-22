import React, { useCallback, useEffect, useState } from 'react';
import { TagDictionaryUpdater } from './TagDictionaryUpdater';
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
import { CLOUD_QUEUE_SERVICE_URL, getCachedCloudQueuePreferences, getCloudQueuePreferences, setCloudQueuePreferences } from '../services/cloudQueue';
import { naiKeyVault, NaiKeyEntry } from '../services/naiKeyVault';
import { PromptAgentSettings } from './PromptAgentSettings';
import {
  AppearancePreferences,
  CornerStyle,
  DEFAULT_APPEARANCE_PREFERENCES,
  FontScale,
  InterfaceDensity,
  MotionStyle,
  SurfaceStyle,
  ThemeMode,
} from '../services/appearancePreferences';
import { ArrowLeft, Bot, Check, ChevronRight, Database, ExternalLink, KeyRound, Monitor, Moon, Palette, RefreshCw, RotateCcw, Server, Shield, SlidersHorizontal, Smartphone, Sun, X } from 'lucide-react';

type SettingsSection = 'appearance' | 'novelai' | 'agent' | 'maintenance';
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
  { id: 'appearance', label: '界面与内容显示', description: '主题、安全模式与图片布局', icon: Palette },
  { id: 'novelai', label: 'NovelAI 与 Anlas', description: '连接、队列与本地预算', icon: KeyRound },
  { id: 'agent', label: '项目 Agent', description: '模型、权限与服务商', icon: Bot },
  { id: 'maintenance', label: '数据与维护', description: '词库、缓存、备份与服务状态', icon: Database },
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
  safeModeHideTitles: boolean;
  setSafeModeHideTitles: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSafeMode: () => void;
}

interface AppearanceOption {
  value: string;
  label: string;
  description?: string;
}

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
        className={`mobile-touch min-w-0 rounded-xl border px-2 py-2 text-center transition md:min-h-10 ${value === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600'}`}
      >
        <span className="block truncate text-xs font-bold">{option.label}</span>
        {option.description && <span className="mt-0.5 block truncate text-[10px] font-normal opacity-65">{option.description}</span>}
      </button>
    ))}
  </div>
);

const ACCENT_PRESETS = [
  { color: '#6366f1', label: '靛蓝' },
  { color: '#8b5cf6', label: '紫罗兰' },
  { color: '#0ea5e9', label: '晴空' },
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

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, initialSection = 'home', notify, isDark, themeMode, setThemeMode, appearancePreferences, setAppearancePreferences, safeMode, safeModeHideTitles, setSafeModeHideTitles, toggleSafeMode }) => {
  const confirmAction = useConfirmDialog();
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => localStorage.getItem('nai_api_key') !== null);
  const [cloudQueue, setCloudQueue] = useState(getCachedCloudQueuePreferences);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [imageDisplay, setImageDisplay] = useState(getMobileImageDisplayPreferences);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [activeSection, setActiveSection] = useState<SettingsPage>('home');
  const anlasBudget = useAnlasBudget();
  // 个人 Opus 免费图折算百分比用的换算系数（网关自动同步，17.3 张 ≈ 1%）。
  const [naiRuntimeCoefficient, setNaiRuntimeCoefficient] = useState(17.3);
  const [anlasInput, setAnlasInput] = useState(String(DEFAULT_ANLAS_BUDGET));
  const [maintenanceStatus, setMaintenanceStatus] = useState<LocalMaintenanceStatus | null>(null);
  const [maintenanceStatusError, setMaintenanceStatusError] = useState('');
  const [maintenanceStatusLoading, setMaintenanceStatusLoading] = useState(false);
  const requestClose = useMobileHistoryLayer(open, onClose, 'settings');

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection === 'home' ? (isMobile ? 'home' : 'appearance') : initialSection);
    setApiKey(readApiKey());
    setRememberApiKey(localStorage.getItem('nai_api_key') !== null);
    void getNaiRuntimeConfig().then(config => setNaiRuntimeCoefficient(config.imagesPerPercent || 17.3));
    void getCloudQueuePreferences().then(setCloudQueue).catch(() => notify('读取公共队列设置失败', 'error'));
  }, [open, initialSection, isMobile]);

  useEffect(() => { setAnlasInput(String(anlasBudget.remaining)); }, [anlasBudget.remaining]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
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
    setKeyVault(naiKeyVault.list());
  }, [open]);

  const refreshVault = () => setKeyVault(naiKeyVault.list());

  const activateKeyEntry = (entry: NaiKeyEntry) => {
    if (entry.key === readApiKey()) return;
    naiKeyVault.activate(entry, rememberApiKey);
    setApiKey(entry.key);
    notify(`已切换到「${entry.name}」`, 'success');
  };

  const addKeyEntry = () => {
    const entry = naiKeyVault.add(newKeyName, newKeyValue);
    if (!entry) {
      notify('密钥为空，或与已有条目重复', 'error');
      return;
    }
    setNewKeyName('');
    setNewKeyValue('');
    refreshVault();
    notify(`已添加「${entry.name}」`, 'success');
  };

  const removeKeyEntry = async (entry: NaiKeyEntry) => {
    const active = entry.key === readApiKey();
    if (!await confirmAction({
      title: `删除密钥「${entry.name}」？`,
      message: `仅从本机保管箱移除 ${maskNaiKeyForDisplay(entry.key)}${active ? '（当前正在使用，删除后需要重新选择密钥）' : ''}，不影响 NovelAI 账号本身。`,
      confirmLabel: '删除',
      tone: 'danger',
    })) return;
    naiKeyVault.remove(entry.id);
    if (active) {
      naiKeyVault.clearActive();
      setApiKey('');
    }
    refreshVault();
    notify('密钥已删除');
  };

  const commitRename = (entry: NaiKeyEntry) => {
    if (!renameValue.trim()) {
      setRenamingKeyId('');
      return;
    }
    setKeyVault(naiKeyVault.rename(entry.id, renameValue));
    setRenamingKeyId('');
    notify('备注已更新');
  };

  const updateCloudQueue = (patch: Partial<typeof cloudQueue>) => {
    const next = { ...cloudQueue, ...patch };
    setCloudQueue(next);
    void setCloudQueuePreferences(next).then(setCloudQueue).catch(() => {
      setCloudQueue(getCachedCloudQueuePreferences());
      notify('保存公共队列设置失败', 'error');
    });
  };

  const updateCloudQueueServiceUrl = (value: string) => {
    const serviceUrl = value.trim();
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

  const resetThemeCustomization = () => {
    setAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      themeMode,
    });
  };

  if (!open) return null;

  const activeSectionMeta = activeSection === 'home' ? null : settingsSections.find(section => section.id === activeSection);

  return (
    <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-0 md:p-4" onMouseDown={requestClose}>
      <div className="settings-dialog ui-modal-enter flex h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:h-[82vh] md:max-h-[860px] md:max-w-6xl md:rounded-2xl md:border" onMouseDown={event => event.stopPropagation()}>
        <div className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-gray-200 px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 md:min-h-0 md:px-5 md:py-4 md:pt-4">
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
                <span className="min-w-0"><b className="block text-sm">{item.label}</b><span className="block truncate text-[10px] font-normal text-gray-400">{item.description}</span></span>
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
                <div className="mb-2 flex items-end justify-between gap-3"><div><div className="text-xs font-bold text-gray-700 dark:text-gray-200">设计主题</div><p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">主题决定整套界面的设计语言；明暗模式独立配合。</p></div><span className="flex-none text-[10px] font-medium text-gray-400">1 个可用主题</span></div>
                <button type="button" aria-pressed="true" className="atelier-theme-card group relative w-full overflow-hidden rounded-2xl border border-indigo-400/70 bg-gray-50 p-3 text-left ring-2 ring-indigo-500/10 dark:bg-gray-950">
                  <span className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white"><Check className="h-3 w-3" /></span>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="atelier-theme-preview grid h-20 w-28 flex-none grid-cols-[1.8rem_1fr] overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-900" aria-hidden="true"><span className="border-r border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-950"><span className="mt-1 block h-1 w-3 rounded-full bg-indigo-400" /><span className="mt-2 block h-1 w-4 rounded-full bg-gray-300 dark:bg-gray-600" /><span className="mt-1 block h-1 w-4 rounded-full bg-gray-400 dark:bg-gray-700" /></span><span className="p-1.5"><span className="block h-2 w-8 rounded bg-indigo-500/70" /><span className="mt-1.5 block h-5 rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" /><span className="mt-1.5 grid grid-cols-2 gap-1"><span className="h-7 rounded bg-gray-200 dark:bg-gray-800" /><span className="h-7 rounded bg-gray-200 dark:bg-gray-800" /></span></span></span>
                    <span className="min-w-0"><b className="block text-sm text-gray-900 dark:text-white">NAI Atelier</b><span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">安静的创作工作台、克制分层与作品优先的现代工坊语言。</span><span className="mt-1 block text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">当前：{isDark ? '黑夜版本' : '白天版本'}</span></span>
                  </span>
                </button>
              </div>

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-200">明暗模式</div>
                <div className="grid grid-cols-3 gap-2">
                  {([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '白天', icon: Sun }, { value: 'dark', label: '黑夜', icon: Moon }] as const).map(option => { const ModeIcon = option.icon; return <button key={option.value} type="button" onClick={() => setThemeMode(option.value)} className={`mobile-touch flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition md:h-10 ${themeMode === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}><ModeIcon className="h-3.5 w-3.5 flex-none" /><span className="truncate">{option.label}</span></button>; })}
                </div>
              </div>

              <div className="appearance-control-panel rounded-2xl border border-gray-200 bg-gray-50/65 p-3 dark:border-gray-700 dark:bg-gray-950/35">
                <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-indigo-500" /><div><h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">个性化</h4><p className="text-[10px] text-gray-500 dark:text-gray-400">修改只覆盖当前主题的默认值。</p></div></div>

                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">强调色</span><span className="font-mono text-[10px] uppercase text-gray-400">{appearancePreferences.accentColor}</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map(preset => <button key={preset.color} type="button" onClick={() => updateAppearance({ accentColor: preset.color })} aria-label={`强调色：${preset.label}`} title={preset.label} className={`relative h-8 w-8 rounded-full border-2 transition hover:scale-105 ${appearancePreferences.accentColor === preset.color ? 'border-gray-900 ring-2 ring-gray-900/15 dark:border-white dark:ring-white/20' : 'border-white shadow-sm dark:border-gray-700'}`} style={{ backgroundColor: preset.color }}>{appearancePreferences.accentColor === preset.color && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />}</button>)}
                    <label className="relative flex h-8 min-w-24 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-white px-2 text-[10px] font-bold text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"><Palette className="h-3.5 w-3.5" />自定义<input type="color" value={appearancePreferences.accentColor} onChange={event => updateAppearance({ accentColor: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="自定义强调色" /></label>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><div className="mb-2 text-[11px] font-bold text-gray-600 dark:text-gray-300">界面密度</div><AppearanceOptionGroup value={appearancePreferences.density} onChange={value => updateAppearance({ density: value as InterfaceDensity })} options={[{ value: 'comfortable', label: '舒展' }, { value: 'standard', label: '标准' }, { value: 'compact', label: '紧凑' }]} /></div>
                  <div><div className="mb-2 text-[11px] font-bold text-gray-600 dark:text-gray-300">圆角语言</div><AppearanceOptionGroup value={appearancePreferences.corners} onChange={value => updateAppearance({ corners: value as CornerStyle })} options={[{ value: 'soft', label: '柔和' }, { value: 'standard', label: '标准' }, { value: 'sharp', label: '锐利' }]} /></div>
                  <div><div className="mb-2 text-[11px] font-bold text-gray-600 dark:text-gray-300">表面材质</div><AppearanceOptionGroup value={appearancePreferences.surfaces} onChange={value => updateAppearance({ surfaces: value as SurfaceStyle })} options={[{ value: 'solid', label: '实色', description: '主题默认' }, { value: 'translucent', label: '透光', description: '轻微模糊' }]} /></div>
                  <div><div className="mb-2 text-[11px] font-bold text-gray-600 dark:text-gray-300">字号</div><AppearanceOptionGroup value={appearancePreferences.fontScale} onChange={value => updateAppearance({ fontScale: value as FontScale })} options={[{ value: 'small', label: '偏小' }, { value: 'standard', label: '标准' }, { value: 'large', label: '偏大' }]} /></div>
                  <div className="lg:col-span-2"><div className="mb-2 text-[11px] font-bold text-gray-600 dark:text-gray-300">动效</div><AppearanceOptionGroup value={appearancePreferences.motion} onChange={value => updateAppearance({ motion: value as MotionStyle })} options={[{ value: 'full', label: '完整' }, { value: 'reduced', label: '减少' }, { value: 'off', label: '关闭' }]} /></div>
                </div>

                <button type="button" onClick={resetThemeCustomization} className="mobile-touch mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"><RotateCcw className="h-3.5 w-3.5" />恢复 NAI Atelier 默认外观</button>
              </div>
              <button type="button" onClick={toggleSafeMode} aria-pressed={safeMode} className={`mobile-touch md:h-10 flex w-full items-center justify-between rounded-xl px-3 text-sm font-bold ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span className="flex items-center gap-2"><Shield className="h-4 w-4" />安全模式</span><span>{safeMode ? '已开启' : '已关闭'}</span></button>
              <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">开启后遮挡全站图片；点击图片可临时显示，离开后自动重新遮挡。</p>
              <button type="button" onClick={() => setSafeModeHideTitles(enabled => !enabled)} aria-pressed={safeModeHideTitles} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700">
                <span className="min-w-0"><b className="block text-xs text-gray-800 dark:text-gray-100">同时隐藏作品名称</b><span className="mt-0.5 block text-[10px] leading-4 text-gray-500 dark:text-gray-400">开启后可单独点击名称显示；点击图片会连同对应名称一起显示。</span></span>
                <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeModeHideTitles ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeModeHideTitles ? 'translate-x-5' : 'translate-x-0'}`} /></span>
              </button>
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">图片列表布局</div>
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
                <p className="mt-4 text-[11px] leading-5 text-gray-500 dark:text-gray-400">布局在所有图片列表全局生效（手机与桌面）；移动端列数仅作用于手机（自动 = 手机 2 列/横屏 3 列）。桌面端：滑块 0 = 自适应（按屏幕宽度 4-6 列），1-5 = 固定列数；角色与画师库可用工具栏滑块单独调整并记住。详情、下载和导入始终使用完整原图。</p>
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
                return (
                  <div key={entry.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${active ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-950/30' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'}`}>
                    {renamingKeyId === entry.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={event => setRenameValue(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') commitRename(entry);
                          if (event.key === 'Escape') setRenamingKeyId('');
                        }}
                        onBlur={() => commitRename(entry)}
                        maxLength={30}
                        className="min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm outline-none dark:border-indigo-500/50 dark:bg-gray-900"
                        aria-label="密钥备注名"
                      />
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-gray-800 dark:text-gray-100" title={entry.name}>{entry.name}</span>
                          {active && <span className="flex-none rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">当前</span>}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{maskNaiKeyForDisplay(entry.key)}</p>
                      </div>
                    )}
                    <div className="flex flex-none items-center gap-1">
                      <button type="button" onClick={() => { setRenamingKeyId(entry.id); setRenameValue(entry.name); }} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700" title="修改备注名">备注</button>
                      {renamingKeyId !== entry.id && !active && <button type="button" onClick={() => activateKeyEntry(entry)} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-500">使用</button>}
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
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                aria-label="密钥备注名"
              />
              <div className="flex gap-2">
                <input
                  type={showNewKeyValue ? 'text' : 'password'}
                  value={newKeyValue}
                  onChange={event => setNewKeyValue(event.target.value.trim())}
                  placeholder="NovelAI API Key（pst-…）"
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  aria-label="NovelAI API Key"
                />
                <button type="button" onClick={() => setShowNewKeyValue(value => !value)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                  {showNewKeyValue ? '隐藏' : '显示'}
                </button>
                <button type="button" onClick={addKeyEntry} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500">添加</button>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={rememberApiKey} onChange={event => updateRememberApiKey(event.target.checked)} className="rounded border-gray-300 text-indigo-600" />
              在本机记住当前使用的 API Key
            </label>
            <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">保管箱与备注保存在本机浏览器；不勾选时当前密钥仅保留到浏览器会话结束。浏览器前端无法对密钥提供真正的加密保护。</p>
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span><b className="block text-sm text-gray-800 dark:text-gray-100">多人拼车公共队列</b><span className="mt-0.5 block text-[11px] leading-5 text-gray-500 dark:text-gray-400">兼容 st-chatu8；相同 NovelAI Key 的接入者依次生图。</span></span>
                <input type="checkbox" checked={cloudQueue.enabled} onChange={event => updateCloudQueue({ enabled: event.target.checked })} className="h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600" />
              </label>
              <div className="mt-3 space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
                <div><label className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">公共队列服务地址</label><input type="url" value={cloudQueue.serviceUrl} onChange={event => setCloudQueue(value => ({ ...value, serviceUrl: event.target.value }))} onBlur={event => updateCloudQueueServiceUrl(event.target.value)} placeholder={CLOUD_QUEUE_SERVICE_URL} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" /><p className="mt-1 text-[10px] leading-4 text-gray-400">默认使用当前 st-chatu8 兼容服务；如使用自建兼容服务，可在这里替换地址。</p></div>
                {cloudQueue.enabled && <>
                  <div><label className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">排队个性语（最多15字）</label><input value={cloudQueue.greeting} maxLength={15} onChange={event => setCloudQueue(value => ({ ...value, greeting: event.target.value.slice(0, 15) }))} onBlur={() => updateCloudQueue({ greeting: cloudQueue.greeting })} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" /></div>
                  <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-gray-700 dark:text-gray-200"><span>显示当前使用者的个性语</span><input type="checkbox" checked={cloudQueue.showGreeting} onChange={event => updateCloudQueue({ showGreeting: event.target.checked })} className="h-5 w-5 rounded border-gray-300 text-indigo-600" /></label>
                </>}
                <p className="text-[11px] leading-5 text-amber-600 dark:text-amber-400">仅发送 Key 的 SHA-256 指纹、任务标识和个性语；Prompt、图片、原始 Key 不会发送给队列服务。队列不可用时本次生成会停止，不会静默绕过。</p>
              </div>
            </div>
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div><h4 className="font-semibold text-gray-900 dark:text-white">Anlas 点数预算</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">当前剩余 <b className="text-indigo-600 dark:text-indigo-300">{anlasBudget.remaining}</b> 点，电脑与手机共用。</p></div>
              <div className="mt-3 flex gap-2">
                <input type="number" min="0" step="1" value={anlasInput} onChange={event => setAnlasInput(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-lg font-black tabular-nums outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" aria-label="可支配 Anlas 点数" />
                <button type="button" onClick={async () => { const next = await anlasBudgetService.set(Number(anlasInput)); setAnlasInput(String(next.remaining)); notify('Anlas 预算已更新'); }} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white">保存</button>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 text-gray-500 dark:text-gray-400"><p>这是本地预算（账号整体，手动校准），不是 NovelAI 官网实时余额——官方没有提供余额接口。默认按 Opus 每月 10000 点由 6 人均分后取整为 1666；生图和永久 Vibe 成功后按官方规则扣减，失败、导入或重复编码不扣。</p><button type="button" onClick={async () => { const next = await anlasBudgetService.set(DEFAULT_ANLAS_BUDGET); setAnlasInput(String(next.remaining)); }} className="flex-shrink-0 font-bold text-indigo-600 dark:text-indigo-300">恢复 1666</button></div>
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
                    }} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">重置</button>
                  )}
                </div>
                {anlasBudget.personal ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">个人已花 Anlas</div>
                      <div className="mt-0.5 text-lg font-black tabular-nums text-indigo-600 dark:text-indigo-300">{anlasBudget.personal.anlasSpent}</div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">个人 Opus 免费图</div>
                      <div className="mt-0.5 text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-300">{anlasBudget.personal.opusImages} 张</div>
                      <div className="text-[10px] text-gray-400">≈ {(anlasBudget.personal.opusImages / naiRuntimeCoefficient).toFixed(2)}% 额度</div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">尚未配置 NovelAI 密钥，或本机还没有该账号的使用记录。统计只记本机行为，按密钥分账号累计。</p>
                )}
              </div>
            </div></div>}
          </section>

          <section id={`settings-agent`} className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'agent' ? 'hidden' : ''}`}>
            {activeSection === 'agent' && <PromptAgentSettings notify={notify} />}
          </section>

          <section id="settings-maintenance" className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${activeSection !== 'maintenance' ? 'hidden' : ''}`}>
            {activeSection === 'maintenance' && <div className="space-y-5">
              <div className="rounded-xl bg-gray-50/80 p-4 dark:bg-gray-800/50"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h4 className="font-semibold text-gray-900 dark:text-white">Tag 补全词库</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">查看版本、数量并检查中英 Tag 数据更新。</p></div><div className="flex flex-none sm:justify-end"><TagDictionaryUpdater notify={notify} /></div></div></div>

              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">手机图片缓存</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">仅保存列表小图；清除后可重新生成，不会影响原图、历史或电脑数据。</p></div><Smartphone className="h-4 w-4 flex-none text-indigo-500" /></div><div className="mt-3 grid grid-cols-4 gap-2">{[0, 25, 50, 100].map(value => <button key={value} type="button" onClick={() => { setMobileCacheLimitMb(value); setMobileCacheStats(getMobileCacheStats()); }} className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${getMobileCacheLimitMb() === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{value === 0 ? '关闭' : `${value} MB`}</button>)}</div><div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-800/70"><span className="text-gray-500 dark:text-gray-400">已缓存 {mobileCacheStats.count} 张 · {(mobileCacheStats.bytes / 1024 / 1024).toFixed(1)} MB / {mobileCacheStats.limitMb} MB</span><button type="button" onClick={async () => { if (!await confirmAction({ title: '清空手机小图缓存？', message: '只会清除可重新生成的缩略图，不会影响原图、历史或任何本地数据。', confirmLabel: '清空缓存', tone: 'danger' })) return; await clearMobileThumbnailCache(); setMobileCacheStats(getMobileCacheStats()); notify('手机小图缓存已清空'); }} className="flex-shrink-0 font-medium text-red-500 hover:text-red-600">清空缓存</button></div></div>

              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">电脑缩略图缓存</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">位于 <code>local-cache/thumbnails</code>，仅保存可重建的小图；普通缓存自动控制在 1 GB 内，固定封面另有 256 MB 上限。</p></div><Database className="h-4 w-4 flex-none text-indigo-500" /></div><div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">{maintenanceStatus ? <>已缓存 {maintenanceStatus.thumbnailCache.count} 张 · {(maintenanceStatus.thumbnailCache.bytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.limitBytes / 1024 / 1024).toFixed(0)} MB<br />固定封面 {maintenanceStatus.thumbnailCache.pinnedCount} 张 · {(maintenanceStatus.thumbnailCache.pinnedBytes / 1024 / 1024).toFixed(1)} MB / {(maintenanceStatus.thumbnailCache.pinnedLimitBytes / 1024 / 1024).toFixed(0)} MB</> : '等待读取本地缓存状态…'}</div></div>

              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-gray-900 dark:text-white">本地服务状态</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">状态来自当前运行的媒体网关与核心页面服务；手机访问时也会经过同一套验证。</p></div><button type="button" onClick={() => void refreshMaintenanceStatus()} disabled={maintenanceStatusLoading} className="mobile-touch flex flex-none items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" title="刷新本地服务状态"><RefreshCw className={`h-3.5 w-3.5 ${maintenanceStatusLoading ? 'animate-spin' : ''}`} />刷新</button></div>{maintenanceStatusError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">{maintenanceStatusError}</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.gatewayReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>媒体网关：{maintenanceStatus?.gatewayReady ? '可用' : '正在检查'}</div><div className={`rounded-lg px-3 py-2.5 text-xs ${maintenanceStatus?.workerReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : maintenanceStatus ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-800/70 dark:text-gray-400'}`}>核心页面服务：{maintenanceStatus?.workerReady ? '可用' : maintenanceStatus ? '未就绪' : '正在检查'}</div></div>}</div>

              <div className="border-b border-gray-200 pb-5 dark:border-gray-700"><h4 className="font-semibold text-gray-900 dark:text-white">重要数据备份</h4><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">请完整复制 <code>local-data</code>：其中包含数据库、R2 原图、历史、局域网认证和 Agent 的加密凭据。<code>local-cache</code>、手机小图缓存和 GitHub 仓库都不能代替这份备份。</p></div>

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
