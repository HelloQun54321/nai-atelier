import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  Beaker,
  CheckCircle2,
  ChevronLeft,
  CircleUserRound,
  Clock3,
  FolderOpen,
  Gem,
  Lightbulb,
  Palette,
  PanelLeft,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
  XCircle,
} from 'lucide-react';
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
  list: Archive,
  character: CircleUserRound,
  artist: Palette,
  tag: Tag,
  resources: FolderOpen,
  lab: Beaker,
  inspiration: Lightbulb,
  history: Clock3,
  safe: ShieldCheck,
  settings: Settings,
};

const SIDEBAR_COLLAPSED_WIDTH = 68;
const SIDEBAR_DEFAULT_WIDTH = 216;
const SIDEBAR_MIN_WIDTH = 192;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_COLLAPSE_SNAP = 112;
const clampSidebarWidth = (value: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
type MobileAgentDock = { side: 'left' | 'right'; y: number };
type StoredMobileAgentDock = MobileAgentDock & { version?: number };
const MOBILE_AGENT_DOCK_VERSION = 2;
const clampMobileAgentY = (value: number, hideNav: boolean) => Math.min(hideNav ? 0.92 : 0.86, Math.max(0.1, value));
const readMobileAgentDock = (): MobileAgentDock => {
  try {
    const stored = JSON.parse(localStorage.getItem('nai_mobile_agent_dock') || '{}') as Partial<StoredMobileAgentDock>;
    if (stored.version === MOBILE_AGENT_DOCK_VERSION && (stored.side === 'left' || stored.side === 'right') && Number.isFinite(stored.y)) {
      return { side: stored.side, y: Math.min(0.92, Math.max(0.1, Number(stored.y))) };
    }
  } catch {
    // Ignore malformed local preferences and restore the default position.
  }
  return { side: 'left', y: 0.82 };
};

export const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, activeView = currentView, isDark, themeMode, setThemeMode, safeMode, toggleSafeMode, toast, hideNav, notify, onOpenAgent }) => {
  const anlasBudget = useAnlasBudget();
  const [showSettings, setShowSettings] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('nai_sidebar_collapsed') === 'true');
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem('nai_sidebar_width')) || SIDEBAR_DEFAULT_WIDTH));
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [mobileAgentDock, setMobileAgentDock] = useState<MobileAgentDock>(readMobileAgentDock);
  const [mobileAgentDrag, setMobileAgentDrag] = useState<{ left: number; y: number } | null>(null);
  const mobileAgentDragRef = useRef<{ pointerId: number; target: HTMLButtonElement; startX: number; startY: number; offsetX: number; offsetY: number; width: number; height: number; moved: boolean } | null>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const mobileDragFrameRef = useRef<number | null>(null);
  const pendingSidebarRef = useRef<{ collapsed: boolean; width: number } | null>(null);
  const pendingMobileDragRef = useRef<{ left: number; y: number } | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
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

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const syncEditorLayout = () => {
      const agentDocked = document.documentElement.classList.contains('agent-panel-docked');
      workspace.classList.toggle('workspace-editor-compact', agentDocked && workspace.clientWidth <= 1180);
    };
    syncEditorLayout();
    const observer = new ResizeObserver(syncEditorLayout);
    observer.observe(workspace);
    const frame = window.requestAnimationFrame(syncEditorLayout);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [currentView]);
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
      pendingSidebarRef.current = rawWidth <= SIDEBAR_COLLAPSE_SNAP
        ? { collapsed: true, width: sidebarWidth }
        : { collapsed: false, width: clampSidebarWidth(rawWidth) };
      if (sidebarResizeFrameRef.current !== null) return;
      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        sidebarResizeFrameRef.current = null;
        const next = pendingSidebarRef.current;
        if (!next) return;
        setSidebarCollapsed(next.collapsed);
        if (!next.collapsed) setSidebarWidth(next.width);
      });
    };
    const handleEnd = () => {
      if (sidebarResizeFrameRef.current !== null) window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      sidebarResizeFrameRef.current = null;
      const next = pendingSidebarRef.current;
      pendingSidebarRef.current = null;
      if (next) {
        setSidebarCollapsed(next.collapsed);
        if (!next.collapsed) {
          setSidebarWidth(next.width);
          localStorage.setItem('nai_sidebar_width', String(Math.round(next.width)));
        }
      }
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

  const startMobileAgentDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Older mobile browsers can still use the window-level fallback below.
    }
    mobileAgentDragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setMobileAgentDrag({ left: rect.left, y: clampMobileAgentY((rect.top + rect.height / 2) / window.innerHeight, Boolean(hideNav)) });

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = mobileAgentDragRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) < 5) return;
      drag.moved = true;
      moveEvent.preventDefault();
      const left = Math.min(window.innerWidth - drag.width, Math.max(0, moveEvent.clientX - drag.offsetX));
      const centerY = moveEvent.clientY - drag.offsetY + drag.height / 2;
      pendingMobileDragRef.current = { left, y: clampMobileAgentY(centerY / window.innerHeight, Boolean(hideNav)) };
      if (mobileDragFrameRef.current !== null) return;
      mobileDragFrameRef.current = window.requestAnimationFrame(() => {
        mobileDragFrameRef.current = null;
        if (pendingMobileDragRef.current) setMobileAgentDrag(pendingMobileDragRef.current);
      });
    };
    const finishDrag = (endEvent: PointerEvent, cancelled = false) => {
      const drag = mobileAgentDragRef.current;
      if (!drag || endEvent.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleCancel);
      try {
        if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
      } catch {
        // The browser may already have released capture after a cancelled gesture.
      }
      mobileAgentDragRef.current = null;
      if (mobileDragFrameRef.current !== null) window.cancelAnimationFrame(mobileDragFrameRef.current);
      mobileDragFrameRef.current = null;
      pendingMobileDragRef.current = null;
      if (drag.moved && !cancelled) {
        const centerY = endEvent.clientY - drag.offsetY + drag.height / 2;
        const next: MobileAgentDock = {
          side: endEvent.clientX < window.innerWidth / 2 ? 'left' : 'right',
          y: clampMobileAgentY(centerY / window.innerHeight, Boolean(hideNav)),
        };
        setMobileAgentDock(next);
        localStorage.setItem('nai_mobile_agent_dock', JSON.stringify({ ...next, version: MOBILE_AGENT_DOCK_VERSION }));
      }
      setMobileAgentDrag(null);
      if (!drag.moved && !cancelled) onOpenAgent();
    };
    const handleEnd = (endEvent: PointerEvent) => finishDrag(endEvent);
    const handleCancel = (cancelEvent: PointerEvent) => finishDrag(cancelEvent, true);
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleCancel);
  };

  const MobileNavButton: React.FC<{ label: string; active: boolean; icon: React.ElementType; onClick: () => void }> = ({ label, active, icon: Icon, onClick }) => (
    <button onClick={onClick} className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-500'}`}>
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-indigo-500" />}
      <span className="flex h-6 w-6 items-center justify-center"><Icon aria-hidden="true" className="h-[19px] w-[19px]" strokeWidth={1.8} /></span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <div className="relative flex h-[100dvh] bg-gray-50 font-sans text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-gray-100">
      {toast && <div className="fixed left-1/2 top-4 z-[2200] w-[90%] -translate-x-1/2 text-center md:top-6 md:w-auto"><div className={`flex items-center justify-center gap-2 rounded-xl px-5 py-3 shadow-xl ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-800 text-white dark:bg-white dark:text-gray-900'}`}>{toast.type === 'error' ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}<span className="text-sm font-medium">{toast.message}</span></div></div>}
      <CloudQueueStatus hidden={Boolean(hideNav)} />

      <aside style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth }} className={`relative hidden flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 md:flex ${isSidebarResizing ? '' : 'transition-[width] duration-200'}`}>
        <div className={`flex h-16 flex-none items-center border-b border-gray-200 dark:border-gray-800 ${sidebarCollapsed ? 'justify-center gap-1 px-2' : 'gap-2 px-3'}`}>
          <img src="/artist-palette-3d.png" alt="" className={`${sidebarCollapsed ? 'h-6 w-6' : 'h-7 w-7'} flex-none object-contain`} data-safe-mode-ignore="true" aria-hidden="true" />
          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate text-sm font-bold tracking-wide text-gray-800 dark:text-gray-200">咒语构建终端</span>}
          <button type="button" onClick={() => setSidebarCollapsed(value => !value)} className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-gray-400 outline-none transition hover:bg-gray-100 hover:text-indigo-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-gray-800" aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'} title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
            {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className={`min-h-0 flex-1 overflow-y-auto py-2 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {desktopGroups.map((group, groupIndex) => <div key={group.label} className={groupIndex ? 'mt-2 border-t border-gray-100 pt-2 dark:border-gray-800' : ''}>
            {!sidebarCollapsed && <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-600">{group.label}</div>}
            <div className="space-y-1">{group.items.map(item => {
              const active = activeView === item.id;
              return <button key={item.id} type="button" title={sidebarCollapsed ? item.label : undefined} aria-label={item.label} onClick={() => onNavigate(item.id as AppView)} className={`relative flex h-11 w-full items-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'} ${active ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}>
                {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-500" />}
                <item.icon aria-hidden="true" className="h-5 w-5 flex-none" strokeWidth={1.8} />
                {!sidebarCollapsed && <span className="ml-3 min-w-0 truncate text-sm">{item.label}</span>}
              </button>;
            })}</div>
          </div>)}
        </nav>

        <div className={`flex flex-none flex-col gap-2 border-t border-gray-200 py-2 dark:border-gray-800 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <button type="button" onClick={onOpenAgent} title={sidebarCollapsed ? '项目 Agent' : undefined} aria-label="项目 Agent" className={`flex h-11 w-full items-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/15 outline-none transition hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}><Sparkles className="h-5 w-5 flex-none" />{!sidebarCollapsed && <span className="ml-2 truncate text-sm font-bold">项目 Agent</span>}</button>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-900/70">
            <div role="status" title={sidebarCollapsed ? `Anlas 预算：${anlasBudget.loading ? '加载中' : anlasBudget.remaining}` : undefined} aria-label={`Anlas 预算 ${anlasBudget.loading ? '加载中' : anlasBudget.remaining}`} className={`flex h-11 w-full cursor-default select-none items-center border-b border-gray-200 text-indigo-600 dark:border-gray-800 dark:text-indigo-300 ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}><span className="flex items-center"><Gem className="h-4 w-4" />{!sidebarCollapsed && <span className="ml-2 text-xs font-medium text-gray-600 dark:text-gray-300">Anlas</span>}</span>{!sidebarCollapsed && <span className="text-sm font-black tabular-nums">{anlasBudget.loading ? '…' : anlasBudget.remaining}</span>}</div>
            <button type="button" onClick={toggleSafeMode} title={sidebarCollapsed ? `安全模式：${safeMode ? '开' : '关'}` : undefined} aria-label={`安全模式：${safeMode ? '开' : '关'}`} aria-pressed={safeMode} className={`relative flex h-11 w-full items-center border-b border-gray-200 text-gray-500 outline-none transition hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'}`}><span className="flex items-center"><span className="relative"><ShieldCheck className={`h-5 w-5 ${safeMode ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />{sidebarCollapsed && safeMode && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-white bg-emerald-500 dark:border-gray-900" />}</span>{!sidebarCollapsed && <span className="ml-2 text-xs font-medium">安全模式</span>}</span>{!sidebarCollapsed && <span className={`relative h-6 w-11 flex-none rounded-full transition-colors ${safeMode ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${safeMode ? 'translate-x-5' : 'translate-x-0'}`} /></span>}</button>
            <button type="button" onClick={() => setShowSettings(true)} title={sidebarCollapsed ? '全局设置' : undefined} aria-label="全局设置" className={`flex h-11 w-full items-center text-gray-500 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}><Settings className="h-5 w-5 flex-none" />{!sidebarCollapsed && <span className="ml-2 text-xs font-medium">全局设置</span>}</button>
          </div>
        </div>

        <button type="button" aria-label="调整侧边栏宽度" title="拖动调整宽度；双击恢复默认" onPointerDown={startSidebarResize} onDoubleClick={() => { setSidebarCollapsed(false); setSidebarWidth(SIDEBAR_DEFAULT_WIDTH); localStorage.setItem('nai_sidebar_width', String(SIDEBAR_DEFAULT_WIDTH)); }} className="group absolute -right-1 top-0 bottom-0 z-30 hidden w-2 cursor-col-resize outline-none md:block"><span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isSidebarResizing ? 'bg-indigo-500' : 'bg-transparent group-hover:bg-indigo-400'}`} /></button>
      </aside>

      <main ref={workspaceRef} className={`workspace-container relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-gray-900 ${hideNav ? 'pb-0' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]'} md:pb-0`}>{children}</main>

      {!showResources && !showSettings && <button
        type="button"
        onPointerDown={startMobileAgentDrag}
        onClick={event => { if (event.detail === 0) onOpenAgent(); }}
        aria-label="打开项目 Agent"
        title="项目 Agent（可拖动）"
        style={mobileAgentDrag
          ? { left: mobileAgentDrag.left, right: 'auto', top: `${clampMobileAgentY(mobileAgentDrag.y, Boolean(hideNav)) * 100}dvh` }
          : { left: mobileAgentDock.side === 'left' ? 0 : 'auto', right: mobileAgentDock.side === 'right' ? 0 : 'auto', top: `${clampMobileAgentY(mobileAgentDock.y, Boolean(hideNav)) * 100}dvh` }}
        className={`fixed z-[950] flex h-11 w-9 touch-none select-none items-center justify-center border border-indigo-300/70 bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-950/20 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:border-indigo-400/40 dark:from-indigo-600 dark:to-violet-700 md:hidden ${mobileAgentDrag ? 'cursor-grabbing rounded-xl transition-none' : `cursor-grab transition-all duration-200 hover:from-indigo-400 hover:to-violet-500 ${mobileAgentDock.side === 'left' ? 'rounded-r-xl border-l-0' : 'rounded-l-xl border-r-0'}`} -translate-y-1/2`}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </button>}

      {!hideNav && <>
        {showResources && <div className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px] md:hidden" onClick={() => setShowResources(false)}><div className="absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 rounded-3xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={event => event.stopPropagation()}><div className="mb-2 flex items-center justify-between px-2"><span className="text-sm font-bold">资源库</span><button onClick={() => setShowResources(false)} className="mobile-touch flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800" aria-label="关闭资源库菜单"><X className="h-[18px] w-[18px]" /></button></div><div className="grid grid-cols-2 gap-2">{resourceItems.map(item => { const ResourceIcon = item.icon; return <button key={item.id} onClick={() => navigateMobile(item.id)} className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl ${activeView === item.id ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><span className="flex h-6 w-6 items-center justify-center"><ResourceIcon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span><span className="text-[11px] font-medium leading-none">{item.label}</span></button>; })}</div></div></div>}
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
