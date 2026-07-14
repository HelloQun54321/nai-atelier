
import React, { ReactNode, useState } from 'react';
import { GlobalSettings } from './GlobalSettings';

interface LayoutProps {
  children: ReactNode;
  onNavigate: (view: 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground', id?: string) => void;
  currentView: string;
  activeView?: string;
  isDark: boolean;
  toggleTheme: () => void;
  safeMode: boolean;
  toggleSafeMode: () => void;
  toast?: { message: string, type: 'success' | 'error' } | null;
  hideNav?: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, activeView = currentView, isDark, toggleTheme, safeMode, toggleSafeMode, toast, hideNav, notify }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const navItems = [
    { id: 'list', label: '画师串', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /> },
    { id: 'characters', label: '角色库', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> },
    { id: 'library', label: '画师tag', icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a9 9 0 100 18h1.5a1.5 1.5 0 001.2-2.4l-.5-.67a1.5 1.5 0 011.2-2.43H18a3 3 0 003-3A9 9 0 0012 3z" /><path strokeLinecap="round" strokeWidth={2.5} d="M7.5 10.5h.01M9.5 7h.01M14 7h.01M17 10h.01" /></> },
    { id: 'aitag', label: 'aitag', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /> },
    { id: 'inspiration', label: '灵感', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.16c.969 0 1.371 1.24.588 1.81l-3.365 2.444a1 1 0 00-.364 1.118l1.285 3.956c.3.922-.755 1.688-1.539 1.118l-3.365-2.444a1 1 0 00-1.176 0L8.046 18.02c-.784.57-1.838-.196-1.539-1.118l1.285-3.956a1 1 0 00-.364-1.118L4.063 9.384c-.783-.57-.38-1.81.588-1.81h4.16a1 1 0 00.95-.69l1.286-3.957z" /> },
    { id: 'playground', label: '实验室', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /> }, // Reusing icon for now or use Flask
    { id: 'history', label: '历史', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /> },
  ];
  const mobilePrimaryIds = new Set(['list', 'characters', 'library', 'playground']);
  const mobilePrimaryItems = navItems.filter(item => mobilePrimaryIds.has(item.id));
  const mobileMoreItems = navItems.filter(item => !mobilePrimaryIds.has(item.id));
  const activeMobileMore = mobileMoreItems.some(item => item.id === activeView);
  const currentLabel = navItems.find(item => item.id === activeView)?.label || 'NaiPromptManager';
  const navigateMobile = (id: string) => {
    setShowMobileMore(false);
    onNavigate(id as any);
  };

  return (
    <div className="relative flex h-[100dvh] bg-gray-50 font-sans text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-gray-100">

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-down w-[90%] md:w-auto text-center">
          <div className={`px-6 py-3 rounded-lg shadow-xl flex items-center justify-center gap-2 ${toast.type === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-gray-800 dark:bg-white text-white dark:text-gray-900'
            }`}>
            <span>{toast.type === 'error' ? '❌' : '✅'}</span>
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Mobile Top Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-sm shadow-md">N</div>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-medium uppercase tracking-wider text-gray-400">NAI Manager</div>
            <div className="truncate text-sm font-bold text-gray-800 dark:text-gray-200">{currentLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            aria-label="打开全局设置"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            title="全局设置"
          >
            ⚙️
          </button>
          <button
            onClick={toggleSafeMode}
            aria-label="切换安全模式"
            aria-pressed={safeMode}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}
            title={safeMode ? '安全模式已开启' : '安全模式已关闭'}
          >
            🛡️
          </button>
        </div>
      </div>

      {/* Desktop Sidebar (Hidden on Mobile) */}
      <aside className="hidden md:flex w-20 md:w-64 flex-shrink-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex-col transition-colors duration-300">
        <div className="p-4 md:p-6 flex items-center justify-center md:justify-start space-x-3 border-b border-gray-200 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xl shadow-lg">
            N
          </div>
          <span className="hidden md:block font-bold text-lg tracking-wide text-gray-800 dark:text-gray-200">咒语构建终端</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as any)}
              className={`w-full flex items-center p-3 rounded-lg transition-colors ${activeView === item.id
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
              <span className="hidden md:block ml-3">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-3">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center justify-center md:justify-start p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="NovelAI 连接与 Tag 词库设置"
          >
            <span className="text-xl mr-0 md:mr-2">⚙️</span>
            <span className="hidden md:block text-sm font-medium">全局设置</span>
          </button>

          <button
            onClick={toggleSafeMode}
            aria-pressed={safeMode}
            className={`w-full flex items-center justify-center md:justify-start p-2 rounded-lg transition-colors ${safeMode
              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            title="开启后所有图片默认模糊；点击单张图片可临时显示"
          >
            <span className="text-xl mr-0 md:mr-2">🛡️</span>
            <span className="hidden md:block text-sm font-medium">安全模式：{safeMode ? '开' : '关'}</span>
          </button>

          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-center md:justify-start p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-xl mr-0 md:mr-2">{isDark ? '🌙' : '☀️'}</span>
            <span className="hidden md:block text-sm font-medium">{isDark ? '切换亮色' : '切换深色'}</span>
          </button>

          <div className="text-xs text-gray-500 dark:text-gray-600 text-center md:text-left">v0.5.0</div>
        </div>
      </aside>

      {/* Main Content (Added pt-14 for mobile header) */}
      <main className={`flex-1 overflow-hidden flex flex-col relative bg-white dark:bg-gray-900 transition-colors duration-300 ${hideNav ? 'pb-0' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]'} md:pb-0 pt-14 md:pt-0`}>
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      {!hideNav && (
        <>
          {showMobileMore && (
            <div className="md:hidden fixed inset-0 z-[60] bg-black/45 backdrop-blur-sm" onClick={() => setShowMobileMore(false)}>
              <div className="absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 rounded-3xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">更多功能</span>
                  <button onClick={() => setShowMobileMore(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl dark:bg-gray-800" aria-label="关闭更多菜单">×</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {mobileMoreItems.map(item => (
                    <button key={item.id} onClick={() => navigateMobile(item.id)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl ${activeView === item.id ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
                      <span className="text-xs font-medium">{item.label}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <button onClick={() => { setShowMobileMore(false); setShowSettings(true); }} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><span className="text-xl">⚙️</span><span className="text-[11px]">设置</span></button>
                  <button onClick={toggleSafeMode} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl ${safeMode ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}><span className="text-xl">🛡️</span><span className="text-[11px]">安全模式</span></button>
                  <button onClick={toggleTheme} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><span className="text-xl">{isDark ? '🌙' : '☀️'}</span><span className="text-[11px]">切换主题</span></button>
                </div>
              </div>
            </div>
          )}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex h-[calc(4.25rem+env(safe-area-inset-bottom))] items-start justify-around border-t border-gray-200 bg-white/95 px-1 pt-1.5 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
          {mobilePrimaryItems.map(item => (
            <button
              key={item.id}
              onClick={() => navigateMobile(item.id)}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl ${activeView === item.id
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-500'
                }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
          <button onClick={() => setShowMobileMore(previous => !previous)} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl ${showMobileMore || activeMobileMore ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-500'}`}>
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            <span className="text-[10px] font-medium">更多</span>
          </button>
        </div>
        </>
      )}

      <GlobalSettings open={showSettings} onClose={() => setShowSettings(false)} notify={notify} />
    </div>
  );
};
