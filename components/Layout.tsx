import React, { ReactNode, useEffect, useState } from 'react';
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
  onOpenAgent: () => void;
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
  safe: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-4" />,
  settings: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.6 3.7a1 1 0 01.8-.7h3.2a1 1 0 01.8.7l.5 1.5a7.7 7.7 0 011.2.7l1.5-.3a1 1 0 011 .4l1.6 2.8a1 1 0 01-.2 1.1l-1 1.1v1.4l1 1.1a1 1 0 01.2 1.1l-1.6 2.8a1 1 0 01-1 .4l-1.5-.3a7.7 7.7 0 01-1.2.7l-.5 1.5a1 1 0 01-.8.7h-3.2a1 1 0 01-.8-.7l-.5-1.5a7.7 7.7 0 01-1.2-.7l-1.5.3a1 1 0 01-1-.4l-1.6-2.8a1 1 0 01.2-1.1l1-1.1V11l-1-1.1a1 1 0 01-.2-1.1L5.4 6a1 1 0 011-.4l1.5.3a7.7 7.7 0 011.2-.7l.5-1.5z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></>,
};

const SIDEBAR_COLLAPSED_WIDTH = 68;
const SIDEBAR_DEFAULT_WIDTH = 216;
const SIDEBAR_MIN_WIDTH = 192;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_COLLAPSE_SNAP = 112;
const clampSidebarWidth = (value: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, activeView = currentView, isDark, themeMode, setThemeMode, safeMode, toggleSafeMode, toast, hideNav, notify, onOpenAgent }) => {
  const anlasBudget = useAnlasBudget();
  const [showSettings, setShowSettings] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nai_sidebar_collapsed') === 'true');
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem('nai_sidebar_width')) || SIDEBAR_DEFAULT_WIDTH));
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const desktopGroups = [
    { label: '工作区', items: [
      { id: 'list', label: '画师串', icon: icons.list },
      { id: 'playground', label: '实验室', icon: icons.lab },
    ] },
    { label: '资源库', items: [
      { id: 'characters', label: '角色库', icon: icons.character },
      { id: 'library', label: '画师 Tag', icon: icons.artist },
      { id: 'aitag', label: 'AITag', icon: icons.tag },
      { id: 'inspiration', label: '灵感', icon: icons.inspiration },
    ] },
    { label: '记录', items: [
      { id: 'history', label: '历史', icon: icons.history },
    ] },
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

  useEffect(() => {
    localStorage.setItem('nai_sidebar_collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('nai_sidebar_width', String(sidebarWidth));
  }, [sidebarWidth]);

  const startSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const rawWidth = startWidth + moveEvent.clientX - startX;
      if (rawWidth <= SIDEBAR_COLLAPSE_SNAP) {
        setSidebarCollapsed(true);
        return;
      }
      setSidebarCollapsed(false);
      setSidebarWidth(clampSidebarWidth(rawWidth));
    };
    const handleEnd = () => {
      setIsSidebarResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
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
      <CloudQueueStatus hidden={Boolean(hideNav)} />

      <aside style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth }} className={`relative hidden flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 md:flex ${isSidebarResizing ? '' : 'transition-[width] duration-200'}`}>
        <div className={`flex h-16 flex-none items-center border-b border-gray-200 dark:border-gray-800 ${sidebarCollapsed ? 'justify-center gap-1 px-2' : 'gap-2 px-3'}`}>
          <img src="/artist-palette-3d.png" alt="" className={`${sidebarCollapsed ? 'h-6 w-6' : 'h-7 w-7'} flex-none object-contain`} data-safe-mode-ignore="true" aria-hidden="true" />
          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate text-sm font-bold tracking-wide text-gray-800 dark:text-gray-200">咒语构建终端</span>}
          <button type="button" onClick={() => setSidebarCollapsed(value => !value)} className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-100 hover:text-indigo-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-gray-800" aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'} title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            <svg className={`h-4 w-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>

        <nav className={`min-h-0 flex-1 overflow-y-auto py-2 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {desktopGroups.map((group, groupIndex) => <div key={group.label} className={groupIndex ? 'mt-2 border-t border-gray-100 pt-2 dark:border-gray-800' : ''}>
            {!sidebarCollapsed && <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-600">{group.label}</div>}
            <div className="space-y-1">{group.items.map(item => {
              const active = activeView === item.id;
              return <button key={item.id} type="button" title={sidebarCollapsed ? item.label : undefined} aria-label={item.label} onClick={() => onNavigate(item.id as AppView)} className={`relative flex h-11 w-full items-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'} ${active ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}>
                {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-500" />}
                <svg className="h-5 w-5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
                {!sidebarCollapsed && <span className="ml-3 min-w-0 truncate text-sm">{item.label}</span>}
              </button>;
            })}</div>
          </div>)}
        </nav>

        <div className={`flex flex-none flex-col gap-2 border-t border-gray-200 py-2 dark:border-gray-800 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <button type="button" onClick={onOpenAgent} title={sidebarCollapsed ? '项目 Agent' : undefined} aria-label="项目 Agent" className={`flex h-11 w-full items-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-md shadow-fuchsia-500/15 outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-fuchsia-400 ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}><span className="flex h-6 w-6 flex-none items-center justify-center text-lg" aria-hidden="true">✦</span>{!sidebarCollapsed && <span className="ml-2 truncate text-sm font-bold">项目 Agent</span>}</button>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-900/70">
            <div role="status" title={sidebarCollapsed ? `Anlas 预算：${anlasBudget.loading ? '加载中' : anlasBudget.remaining}` : undefined} aria-label={`Anlas 预算 ${anlasBudget.loading ? '加载中' : anlasBudget.remaining}`} className={`flex h-11 w-full cursor-default select-none items-center border-b border-gray-200 text-violet-600 dark:border-gray-800 dark:text-violet-300 ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}><span className="flex items-center"><span className="flex h-5 w-5 items-center justify-center text-base" aria-hidden="true">◈</span>{!sidebarCollapsed && <span className="ml-2 text-xs font-medium text-gray-600 dark:text-gray-300">Anlas</span>}</span>{!sidebarCollapsed && <span className="text-sm font-black tabular-nums">{anlasBudget.loading ? '…' : anlasBudget.remaining}</span>}</div>
            <button type="button" onClick={toggleSafeMode} title={sidebarCollapsed ? `安全模式：${safeMode ? '开' : '关'}` : undefined} aria-label={`安全模式：${safeMode ? '开' : '关'}`} aria-pressed={safeMode} className={`relative flex h-11 w-full items-center border-b border-gray-200 text-gray-500 outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}><span className="flex items-center"><span className="relative"><svg className={`h-5 w-5 ${safeMode ? 'text-emerald-600 dark:text-emerald-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{icons.safe}</svg>{sidebarCollapsed && safeMode && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-white bg-emerald-500 dark:border-gray-900" />}</span>{!sidebarCollapsed && <span className="ml-2 text-xs font-medium">安全模式</span>}</span>{!sidebarCollapsed && <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeMode ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeMode ? 'translate-x-5' : 'translate-x-0'}`} /></span>}</button>
            <button type="button" onClick={() => setShowSettings(true)} title={sidebarCollapsed ? '全局设置' : undefined} aria-label="全局设置" className={`flex h-11 w-full items-center text-gray-500 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}><svg className="h-5 w-5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icons.settings}</svg>{!sidebarCollapsed && <span className="ml-2 text-xs font-medium">全局设置</span>}</button>
          </div>
        </div>

        <button type="button" aria-label="调整侧边栏宽度" title="拖动调整宽度；双击恢复默认" onPointerDown={startSidebarResize} onDoubleClick={() => { setSidebarCollapsed(false); setSidebarWidth(SIDEBAR_DEFAULT_WIDTH); }} className="group absolute -right-1 top-0 bottom-0 z-30 hidden w-2 cursor-col-resize outline-none md:block"><span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isSidebarResizing ? 'bg-indigo-500' : 'bg-transparent group-hover:bg-indigo-400'}`} /></button>
      </aside>

      <main className={`workspace-container relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-gray-900 ${hideNav ? 'pb-0' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]'} md:pb-0`}>{children}</main>

      {!hideNav && <>
        {showResources && <div className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px] md:hidden" onClick={() => setShowResources(false)}><div className="absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 rounded-3xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}><div className="mb-2 flex items-center justify-between px-2"><span className="text-sm font-bold">资源库</span><button onClick={() => setShowResources(false)} className="mobile-touch rounded-full bg-gray-100 text-xl dark:bg-gray-800" aria-label="关闭资源库菜单">×</button></div><div className="grid grid-cols-2 gap-2">{resourceItems.map(item => <button key={item.id} onClick={() => navigateMobile(item.id)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl ${activeView === item.id ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg><span className="text-xs font-medium">{item.label}</span></button>)}</div><button type="button" onClick={() => { setShowResources(false); onOpenAgent(); }} className="mobile-touch mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-sm font-bold text-white"><span aria-hidden="true">✦</span>打开项目 Agent</button></div></div>}
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
