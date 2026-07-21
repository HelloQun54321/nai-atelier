import React, { ReactNode, useState } from 'react';
import { GlobalSettings } from './GlobalSettings';
import { useAnlasBudget } from '../services/anlasBudget';
import { CloudQueueStatus } from './CloudQueueStatus';

type AppView = 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground';
type ThemeMode = 'light' | 'dark' | 'system';

interface LayoutProps {
  children: ReactNode;
  onNavigate: (view: AppView, id?: string) => void;
  currentView: string;
  activeView?: string;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  safeMode: boolean;
  toggleSafeMode: () => void;
  toast?: { message: string, type: 'success' | 'error' } | null;
  hideNav?: boolean;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const icons = {
  list: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />,
  character: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  artist: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a9 9 0 100 18h1.5a1.5 1.5 0 001.2-2.4l-.5-.67a1.5 1.5 0 011.2-2.43H18a3 3 0 003-3A9 9 0 0012 3z" /><path strokeLinecap="round" strokeWidth={2.5} d="M7.5 10.5h.01M9.5 7h.01M14 7h.01M17 10h.01" /></>,
  tag: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />,
  resources: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5.5A1.5 1.5 0 015.5 4h4l2 2h7A1.5 1.5 0 0120 7.5v10a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-12z" />,
  lab: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />,
  inspiration: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.16c.969 0 1.371 1.24.588 1.81l-3.365 2.444a1 1 0 00-.364 1.118l1.285 3.956c.3.922-.755 1.688-1.539 1.118l-3.365-2.444a1 1 0 00-1.176 0L8.046 18.02c-.784.57-1.838-.196-1.539-1.118l1.285-3.956a1 1 0 00-.364-1.118L4.063 9.384c-.783-.57-.38-1.81.588-1.81h4.16a1 1 0 00.95-.69l1.286-3.957z" />,
  history: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
  settings: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.6 3.7a1 1 0 01.8-.7h3.2a1 1 0 01.8.7l.5 1.5a7.7 7.7 0 011.2.7l1.5-.3a1 1 0 011 .4l1.6 2.8a1 1 0 01-.2 1.1l-1 1.1v1.4l1 1.1a1 1 0 01.2 1.1l-1.6 2.8a1 1 0 01-1 .4l-1.5-.3a7.7 7.7 0 01-1.2.7l-.5 1.5a1 1 0 01-.8.7h-3.2a1 1 0 01-.8-.7l-.5-1.5a7.7 7.7 0 01-1.2-.7l-1.5.3a1 1 0 01-1-.4l-1.6-2.8a1 1 0 01.2-1.1l1-1.1V11l-1-1.1a1 1 0 01-.2-1.1L5.4 6a1 1 0 011-.4l1.5.3a7.7 7.7 0 011.2-.7l.5-1.5z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></>,
};

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, activeView = currentView, isDark, themeMode, setThemeMode, safeMode, toggleSafeMode, toast, hideNav, notify }) => {
  const anlasBudget = useAnlasBudget();
  const [showSettings, setShowSettings] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const desktopItems = [
    { id: 'list', label: '画师串', icon: icons.list },
    { id: 'characters', label: '角色库', icon: icons.character },
    { id: 'library', label: '画师 Tag', icon: icons.artist },
    { id: 'aitag', label: 'AITag', icon: icons.tag },
    { id: 'inspiration', label: '灵感', icon: icons.inspiration },
    { id: 'playground', label: '实验室', icon: icons.lab },
    { id: 'history', label: '历史', icon: icons.history },
  ];
  const resourceItems = [
    { id: 'library', label: '画师 Tag', icon: icons.artist },
    { id: 'characters', label: '角色库', icon: icons.character },
    { id: 'aitag', label: 'AITag', icon: icons.tag },
    { id: 'inspiration', label: '灵感库', icon: icons.inspiration },
  ];
  const resourceActive = resourceItems.some(item => item.id === activeView);
  const navigateMobile = (id: string) => {
    setShowResources(false);
    onNavigate(id as AppView);
  };

  const MobileNavButton: React.FC<{ label: string; active: boolean; icon: ReactNode; onClick: () => void }> = ({ label, active, icon, onClick }) => (
    <button onClick={onClick} className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-500'}`}>
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-indigo-500" />}
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <div className="relative flex h-[100dvh] bg-gray-50 font-sans text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-gray-100">
      {toast && <div className="fixed left-1/2 top-4 z-[2200] w-[90%] -translate-x-1/2 text-center md:top-6 md:w-auto"><div className={`flex items-center justify-center gap-2 rounded-xl px-5 py-3 shadow-xl ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-800 text-white dark:bg-white dark:text-gray-900'}`}><span>{toast.type === 'error' ? '❌' : '✅'}</span><span className="text-sm font-medium">{toast.message}</span></div></div>}
      <CloudQueueStatus />

      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-colors dark:border-gray-800 dark:bg-gray-950 md:flex">
        <div className="flex items-center space-x-3 border-b border-gray-200 p-6 dark:border-gray-800"><img src="/artist-palette-3d.png" alt="" className="h-8 w-8 object-contain" data-safe-mode-ignore="true" aria-hidden="true" /><span className="font-bold tracking-wide text-gray-800 dark:text-gray-200">咒语构建终端</span></div>
        <nav className="flex-1 space-y-2 p-4">{desktopItems.map(item => <button key={item.id} onClick={() => onNavigate(item.id as AppView)} className={`flex w-full items-center rounded-lg p-3 transition-colors ${activeView === item.id ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-600/20 dark:text-indigo-400' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'}`}><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg><span className="ml-3">{item.label}</span></button>)}</nav>
        <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-800">
          <button type="button" onClick={() => setShowSettings(true)} className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-left text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/70">
            <span><span className="block text-[10px] font-bold uppercase tracking-wider opacity-70">Anlas 预算</span><span className="text-lg font-black tabular-nums">{anlasBudget.loading ? '…' : anlasBudget.remaining}</span></span>
            <span className="text-lg" aria-hidden="true">◈</span>
          </button>
          <button onClick={() => setShowSettings(true)} className="flex w-full items-center justify-start rounded-lg bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"><span className="mr-2 text-xl">⚙️</span><span className="text-sm font-medium">全局设置</span></button>
          <button onClick={toggleSafeMode} aria-pressed={safeMode} className={`flex w-full items-center justify-start rounded-lg p-2 transition-colors ${safeMode ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}><span className="mr-2 text-xl">🛡️</span><span className="text-sm font-medium">安全模式：{safeMode ? '开' : '关'}</span></button>
          <div className="text-left text-xs text-gray-500 dark:text-gray-600">v0.5.0</div>
        </div>
      </aside>

      <main className={`relative flex flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-gray-900 ${hideNav ? 'pb-0' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]'} md:pb-0`}>{children}</main>

      {!hideNav && <>
        {showResources && <div className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px] md:hidden" onClick={() => setShowResources(false)}><div className="absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 rounded-3xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}><div className="mb-2 flex items-center justify-between px-2"><span className="text-sm font-bold">资源库</span><button onClick={() => setShowResources(false)} className="mobile-touch rounded-full bg-gray-100 text-xl dark:bg-gray-800" aria-label="关闭资源库菜单">×</button></div><div className="grid grid-cols-2 gap-2">{resourceItems.map(item => <button key={item.id} onClick={() => navigateMobile(item.id)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl ${activeView === item.id ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg><span className="text-xs font-medium">{item.label}</span></button>)}</div></div></div>}
        <div className="fixed bottom-0 left-0 right-0 z-50 flex h-[calc(4.25rem+env(safe-area-inset-bottom))] items-start border-t border-gray-200 bg-white/95 px-1 pt-1.5 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 md:hidden">
          <MobileNavButton label="画师串" active={activeView === 'list'} icon={icons.list} onClick={() => navigateMobile('list')} />
          <MobileNavButton label="资源库" active={resourceActive || showResources} icon={icons.resources} onClick={() => setShowResources(value => !value)} />
          <MobileNavButton label="实验室" active={activeView === 'playground'} icon={icons.lab} onClick={() => navigateMobile('playground')} />
          <MobileNavButton label="历史" active={activeView === 'history'} icon={icons.history} onClick={() => navigateMobile('history')} />
          <MobileNavButton label="设置" active={showSettings} icon={icons.settings} onClick={() => setShowSettings(true)} />
        </div>
      </>}

      <GlobalSettings open={showSettings} onClose={() => setShowSettings(false)} notify={notify} isDark={isDark} themeMode={themeMode} setThemeMode={setThemeMode} safeMode={safeMode} toggleSafeMode={toggleSafeMode} />
    </div>
  );
};
