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

interface GlobalSettingsProps {
  open: boolean;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  isDark: boolean;
  themeMode: 'light' | 'dark' | 'system';
  setThemeMode: (mode: 'light' | 'dark' | 'system') => void;
  safeMode: boolean;
  toggleSafeMode: () => void;
}

const readApiKey = () => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ open, onClose, notify, isDark, themeMode, setThemeMode, safeMode, toggleSafeMode }) => {
  const confirmAction = useConfirmDialog();
  const [apiKey, setApiKey] = useState(readApiKey);
  const [rememberApiKey, setRememberApiKey] = useState(() => localStorage.getItem('nai_api_key') !== null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [mobileCacheStats, setMobileCacheStats] = useState(getMobileCacheStats);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [mobileSection, setMobileSection] = useState<'appearance' | 'novelai' | 'tags' | 'cache'>('appearance');
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
  }, [open]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-0 md:p-4" onMouseDown={requestClose}>
      <div className="flex h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-2xl md:border" onMouseDown={event => event.stopPropagation()}>
        <div className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-gray-200 px-3 pt-[env(safe-area-inset-top)] dark:border-gray-800 md:min-h-0 md:px-5 md:py-4 md:pt-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">全局设置</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">连接信息和本地数据维护</p>
          </div>
          <button type="button" onClick={requestClose} className="mobile-touch rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label="关闭全局设置">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:space-y-5 md:p-5">
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <button type="button" onClick={() => isMobile && setMobileSection('appearance')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div><h3 className="font-semibold text-gray-900 dark:text-white">外观与隐私</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">主题与图片安全显示状态：{safeMode ? '安全模式已开启' : isDark ? '深色' : '浅色'}</p></div>
              <span className="md:hidden">{mobileSection === 'appearance' ? '⌃' : '⌄'}</span>
            </button>
            {(!isMobile || mobileSection === 'appearance') && <div className="mt-3 space-y-3">
              <div><div className="mb-2 text-xs font-bold text-gray-500 dark:text-gray-400">主题</div><div className="grid grid-cols-3 gap-2">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setThemeMode(value)} className={`mobile-touch rounded-xl border px-2 text-xs font-bold ${themeMode === value ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>{label}</button>)}</div></div>
              <button type="button" onClick={toggleSafeMode} aria-pressed={safeMode} className={`mobile-touch flex w-full items-center justify-between rounded-xl px-3 text-sm font-bold ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span>🛡️ 安全模式</span><span>{safeMode ? '已开启' : '已关闭'}</span></button>
            </div>}
          </section>
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <button type="button" onClick={() => isMobile && setMobileSection('novelai')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">NovelAI 连接</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">生图实验室和画师预览生成共用同一个 API Key。</p>
              </div><span className="md:hidden">{mobileSection === 'novelai' ? '⌃' : '⌄'}</span>
            </button>
            {(!isMobile || mobileSection === 'novelai') && <div className="mt-3">
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
            </div>}
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <button type="button" onClick={() => isMobile && setMobileSection('tags')} className="flex min-h-11 w-full items-center justify-between gap-4 text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Tag 补全词库</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">查看版本、数量并检查中英 Tag 数据更新。</p>
              </div><span className="md:hidden">{mobileSection === 'tags' ? '⌃' : '⌄'}</span>
            </button>
            {(!isMobile || mobileSection === 'tags') && <div className="mt-3 flex justify-end"><TagDictionaryUpdater notify={notify} /></div>}
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <button type="button" onClick={() => isMobile && setMobileSection('cache')} className="flex min-h-11 w-full items-center justify-between text-left">
              <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">手机图片缓存</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">仅保存列表小图，原图和历史数据仍只保存在电脑。缓存被清除后可以重新生成。</p>
              </div><span className="md:hidden">{mobileSection === 'cache' ? '⌃' : '⌄'}</span>
            </button>
            {(!isMobile || mobileSection === 'cache') && <div>
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
        </div>
      </div>
    </div>
  );
};
