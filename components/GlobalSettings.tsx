import React, { useEffect, useState } from 'react';
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
import { getMobileImageDisplayPreferences, MobileImageColumns, MobileImageLayout, setMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { anlasBudgetService, DEFAULT_ANLAS_BUDGET, useAnlasBudget } from '../services/anlasBudget';
import { CLOUD_QUEUE_SERVICE_URL, getCachedCloudQueuePreferences, getCloudQueuePreferences, setCloudQueuePreferences } from '../services/cloudQueue';
import { PromptAgentSettings } from './PromptAgentSettings';
import { Bot, BookOpen, ChevronDown, Coins, Info, KeyRound, Palette, Shield, Smartphone, X } from 'lucide-react';

type SettingsSection = 'appearance' | 'novelai' | 'agent' | 'anlas' | 'tags' | 'cache' | 'about';

const settingsSections: Array<{ id: SettingsSection; label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'appearance', label: '外观与隐私', description: '主题、安全模式与图片布局', icon: Palette },
  { id: 'novelai', label: 'NovelAI', description: '连接密钥与多人队列', icon: KeyRound },
  { id: 'agent', label: '项目 Agent', description: '模型、权限与服务商', icon: Bot },
  { id: 'anlas', label: 'Anlas 点数', description: '本地预算与扣费记录', icon: Coins },
  { id: 'tags', label: 'Tag 词库', description: '词库来源与更新', icon: BookOpen },
  { id: 'cache', label: '手机缓存', description: '小图缓存容量', icon: Smartphone },
  { id: 'about', label: '关于', description: '版本与项目信息', icon: Info },
];

interface GlobalSettingsProps {
  open: boolean;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  isDark: boolean;
  themeMode: 'light' | 'dark' | 'system';
  setThemeMode: (mode: 'light' | 'dark' | 'system') => void;
  safeMode: boolean;
  toggleSafeMode: () => void;
  onOpenAgent: () => void;
}

const readApiKey = () => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, notify, isDark, themeMode, setThemeMode, safeMode, toggleSafeMode, onOpenAgent }) => {
  const confirmAction = useConfirmDialog();
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => localStorage.getItem('nai_api_key') !== null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [cloudQueue, setCloudQueue] = useState(getCachedCloudQueuePreferences);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [imageDisplay, setImageDisplay] = useState(getMobileImageDisplayPreferences);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [mobileSection, setMobileSection] = useState<SettingsSection>('appearance');
  const anlasBudget = useAnlasBudget();
  const [anlasInput, setAnlasInput] = useState(String(DEFAULT_ANLAS_BUDGET));
  const requestClose = useMobileHistoryLayer(open, onClose, 'settings');

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    setApiKey(readApiKey());
    setRememberApiKey(localStorage.getItem('nai_api_key') !== null);
    void getCloudQueuePreferences().then(setCloudQueue).catch(() => notify('读取公共队列设置失败', 'error'));
  }, [open]);

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

  const updateCloudQueue = (patch: Partial<typeof cloudQueue>) => {
    const next = { ...cloudQueue, ...patch };
    setCloudQueue(next);
    void setCloudQueuePreferences(next).then(setCloudQueue).catch(() => notify('保存公共队列设置失败', 'error'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-0 md:p-4" onMouseDown={requestClose}>
      <div className="flex h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:h-[82vh] md:max-h-[860px] md:max-w-6xl md:rounded-2xl md:border" onMouseDown={event => event.stopPropagation()}>
        <div className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-gray-200 px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 md:min-h-0 md:px-5 md:py-4 md:pt-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">全局设置</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">连接信息和本地数据维护</p>
          </div>
          <button type="button" onClick={requestClose} className="mobile-touch flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="关闭全局设置">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-64 flex-none border-r border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40 md:flex md:flex-col md:gap-1">
            {settingsSections.map(item => {
              const SectionIcon = item.icon;
              const active = mobileSection === item.id;
              return <button key={item.id} type="button" onClick={() => setMobileSection(item.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-indigo-300 dark:ring-gray-700' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800/60'}`}>
                <SectionIcon className="h-4.5 w-4.5 flex-none" />
                <span className="min-w-0"><b className="block text-sm">{item.label}</b><span className="block truncate text-[10px] font-normal text-gray-400">{item.description}</span></span>
              </button>;
            })}
          </nav>
        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'appearance' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('appearance')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div><h3 className="font-semibold text-gray-900 dark:text-white">外观与隐私</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">主题与图片安全显示状态：{safeMode ? '安全模式已开启' : isDark ? '深色' : '浅色'}</p></div>
              <ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'appearance' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'appearance' && <div className="mt-3 space-y-3">
              <div><div className="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">主题</div><div className="grid grid-cols-3 gap-2">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setThemeMode(value)} className={`mobile-touch rounded-xl border px-2 text-xs font-bold ${themeMode === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{label}</button>)}</div></div>
              <button type="button" onClick={toggleSafeMode} aria-pressed={safeMode} className={`mobile-touch flex w-full items-center justify-between rounded-xl px-3 text-sm font-bold ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span className="flex items-center gap-2"><Shield className="h-4 w-4" />安全模式</span><span>{safeMode ? '已开启' : '已关闭'}</span></button>
              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">手机图片列表</div>
                <div className="grid grid-cols-3 gap-2">
                  {([['masonry', '瀑布流'], ['portrait', '竖向卡片'], ['square', '方形']] as const).map(([layout, label]) => <button key={layout} type="button" onClick={() => { const next = { ...imageDisplay, layout: layout as MobileImageLayout }; setImageDisplay(next); setMobileImageDisplayPreferences(next); }} className={`mobile-touch rounded-xl border px-2 text-xs font-bold ${imageDisplay.layout === layout ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{label}</button>)}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {([['auto', '自动'], [1, '1 张'], [2, '2 张'], [3, '3 张']] as const).map(([columns, label]) => <button key={columns} type="button" onClick={() => { const next = { ...imageDisplay, columns: columns as MobileImageColumns }; setImageDisplay(next); setMobileImageDisplayPreferences(next); }} className={`mobile-touch rounded-xl border px-1 text-xs font-bold ${imageDisplay.columns === columns ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{label}</button>)}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">只影响手机图片列表；详情、下载和导入始终使用完整原图。</p>
              </div>
            </div>}
          </section>
          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'novelai' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('novelai')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">NovelAI 连接</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">生图实验室和画师预览生成共用同一个 API Key。</p>
              </div><ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'novelai' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'novelai' && <div className="mt-3">
            <div className="flex gap-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={event => updateApiKey(event.target.value.trim())}
                placeholder="输入 NovelAI API Key"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                aria-label="NovelAI API Key"
              />
              <button type="button" onClick={() => setShowApiKey(value => !value)} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={rememberApiKey} onChange={event => updateRememberApiKey(event.target.checked)} className="rounded border-gray-300 text-indigo-600" />
              在本机记住 API Key
            </label>
            <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">不勾选时仅保留到当前浏览器会话结束；浏览器前端无法对密钥提供真正的加密保护。</p>
            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span><b className="block text-sm text-gray-800 dark:text-gray-100">多人拼车公共队列</b><span className="mt-0.5 block text-[11px] leading-5 text-gray-500 dark:text-gray-400">兼容 st-chatu8；相同 NovelAI Key 的接入者依次生图。</span></span>
                <input type="checkbox" checked={cloudQueue.enabled} onChange={event => updateCloudQueue({ enabled: event.target.checked })} className="h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600" />
              </label>
              {cloudQueue.enabled && <div className="mt-3 space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
                <div><label className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">排队个性语（最多15字）</label><input value={cloudQueue.greeting} maxLength={15} onChange={event => setCloudQueue(value => ({ ...value, greeting: event.target.value.slice(0, 15) }))} onBlur={() => updateCloudQueue({ greeting: cloudQueue.greeting })} className="mobile-touch w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900" /></div>
                <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-gray-700 dark:text-gray-200"><span>显示当前使用者的个性语</span><input type="checkbox" checked={cloudQueue.showGreeting} onChange={event => updateCloudQueue({ showGreeting: event.target.checked })} className="h-5 w-5 rounded border-gray-300 text-indigo-600" /></label>
                <div className="break-all text-[10px] leading-4 text-gray-400">公共服务：{CLOUD_QUEUE_SERVICE_URL}</div>
                <p className="text-[11px] leading-5 text-amber-600 dark:text-amber-400">仅发送 Key 的 SHA-256 指纹、任务标识和个性语；Prompt、图片、原始 Key 不会发送给队列服务。队列不可用时本次生成会停止，不会静默绕过。</p>
              </div>}
            </div></div>}
          </section>

          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'agent' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('agent')} className="flex min-h-11 w-full items-center justify-between gap-4 text-left">
              <div><h3 className="font-semibold text-gray-900 dark:text-white">项目 Agent</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">让 DeepSeek、Gemini 或 Grok 查看历史图片、操作实验室并管理项目资料。</p></div>
              <ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'agent' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'agent' && <div className="mt-3 space-y-4">
              <button type="button" onClick={() => { onClose(); onOpenAgent(); }} className="mobile-touch flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500">
                <Bot className="h-5 w-5" />
                打开项目 Agent
              </button>
              <PromptAgentSettings notify={notify} />
            </div>}
          </section>

          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'anlas' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('anlas')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div><h3 className="font-semibold text-gray-900 dark:text-white">Anlas 点数预算</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">当前剩余 <b className="text-indigo-600 dark:text-indigo-300">{anlasBudget.remaining}</b> 点，电脑与手机共用。</p></div>
              <ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'anlas' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'anlas' && <div className="mt-3">
              <div className="flex gap-2">
                <input type="number" min="0" step="1" value={anlasInput} onChange={event => setAnlasInput(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-lg font-black tabular-nums outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900" aria-label="可支配 Anlas 点数" />
                <button type="button" onClick={async () => { const next = await anlasBudgetService.set(Number(anlasInput)); setAnlasInput(String(next.remaining)); notify('Anlas 预算已更新'); }} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white">保存</button>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 text-gray-500 dark:text-gray-400"><p>这是本地预算，不是 NovelAI 官网实时余额。默认按 Opus 每月 10000 点由 6 人均分后取整为 1666；生图和永久 Vibe 成功后按官方规则扣减，失败、导入或重复编码不扣。</p><button type="button" onClick={async () => { const next = await anlasBudgetService.set(DEFAULT_ANLAS_BUDGET); setAnlasInput(String(next.remaining)); }} className="flex-shrink-0 font-bold text-indigo-600 dark:text-indigo-300">恢复 1666</button></div>
            </div>}
          </section>

          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'tags' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('tags')} className="flex min-h-11 w-full items-center justify-between gap-4 text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Tag 补全词库</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">查看版本、数量并检查中英 Tag 数据更新。</p>
              </div><ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'tags' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'tags' && <div className="mt-3 flex justify-start"><TagDictionaryUpdater notify={notify} /></div>}
          </section>

          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'cache' ? '' : 'md:hidden'}`}>
            <button type="button" onClick={() => isMobile && setMobileSection('cache')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">手机图片缓存</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">仅保存列表小图，原图和历史数据仍只保存在电脑。缓存被清除后可以重新生成。</p>
              </div><ChevronDown className={`h-4 w-4 flex-none transition md:hidden ${mobileSection === 'cache' ? 'rotate-180' : ''}`} />
            </button>
            {mobileSection === 'cache' && <div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[0, 25, 50, 100].map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMobileCacheLimitMb(value);
                    setMobileCacheStats(getMobileCacheStats());
                  }}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${getMobileCacheLimitMb() === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                >
                  {value === 0 ? '关闭' : `${value} MB`}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 text-xs dark:bg-gray-800/70">
              <span className="text-gray-500 dark:text-gray-400">已缓存 {mobileCacheStats.count} 张 · {(mobileCacheStats.bytes / 1024 / 1024).toFixed(1)} MB / {mobileCacheStats.limitMb} MB</span>
              <button
                type="button"
                onClick={async () => {
                  if (!await confirmAction({ title: '清空手机小图缓存？', message: '只会清除可重新生成的缩略图，不会影响原图、历史或任何本地数据。', confirmLabel: '清空缓存', tone: 'danger' })) return;
                  await clearMobileThumbnailCache();
                  setMobileCacheStats(getMobileCacheStats());
                  notify('手机小图缓存已清空');
                }}
                className="flex-shrink-0 font-medium text-red-500 hover:text-red-600"
              >
                清空缓存
              </button>
            </div>
            </div>}
          </section>

          <section className={`rounded-xl border border-gray-200 p-4 dark:border-gray-700 ${mobileSection === 'about' ? '' : 'md:hidden'}`}>
            <div className="flex items-center justify-between gap-4">
              <div><h3 className="font-semibold text-gray-900 dark:text-white">关于</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">NaiPromptManager 个人维护版本</p></div>
              <span className="rounded-lg bg-gray-100 px-3 py-1.5 font-mono text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">v0.5.0</span>
            </div>
          </section>
        </div>
        </div>
      </div>
    </div>
  );
};
