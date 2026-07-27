
import React, { startTransition, useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { InspirationGallery } from './components/InspirationGallery';
import { GenHistory } from './components/GenHistory';
import { AitagGallery } from './components/AitagGallery';
import { useConfirmDialog } from './components/ConfirmDialog';
import { CharacterLibrary } from './components/CharacterLibrary';
import { db } from './services/dbService';
import { PromptChain, User, Artist, Inspiration, ChainType } from './types';

type ViewState = 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground';
type KeepAliveView = Exclude<ViewState, 'edit'>;

const CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache

const isKeepAliveView = (targetView: ViewState): targetView is KeepAliveView => targetView !== 'edit';

const App = () => {
  const confirmAction = useConfirmDialog();
  const [view, setView] = useState<ViewState>('list');
  const [mountedViews, setMountedViews] = useState<KeepAliveView[]>(['list']);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);

  // Playground State
  const [playgroundChain, setPlaygroundChain] = useState<PromptChain | null>(null);
  const [playgroundImportToken, setPlaygroundImportToken] = useState(0);
  const [playgroundAgentOpenToken, setPlaygroundAgentOpenToken] = useState(0);
  const [editorAgentOpenToken, setEditorAgentOpenToken] = useState(0);

  // Data Cache State
  const [artistsCache, setArtistsCache] = useState<Artist[] | null>(null);
  const [inspirationsCache, setInspirationsCache] = useState<Inspiration[] | null>(null);

  // Cache Timestamps
  const [lastChainFetch, setLastChainFetch] = useState(0);
  const [lastArtistFetch, setLastArtistFetch] = useState(0);
  const [lastInspirationFetch, setLastInspirationFetch] = useState(0);

  // Dirty State for Navigation Guard
  const [isEditorDirty, setIsEditorDirty] = useState(false);

  // Personal-mode owner loaded from the local service.
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Theme State
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>(() => {
    const saved = localStorage.getItem('nai_theme');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  const [safeMode, setSafeMode] = useState(() => localStorage.getItem('nai_safe_mode') === 'true');

  // Toast State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Personal mode enters directly without a login session.
  useEffect(() => {
    db.getMe().then(user => {
      setCurrentUser(user);
      refreshData();
    }).catch(() => {
      setDbConfigError(true);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const applyPreferences = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (['light', 'dark', 'system'].includes(detail.themeMode)) setThemeMode(detail.themeMode);
      if (typeof detail.safeMode === 'boolean') setSafeMode(detail.safeMode);
    };
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (['list', 'characters', 'library', 'aitag', 'inspiration', 'history', 'playground'].includes(detail.view)) void handleNavigate(detail.view, detail.id);
    };
    window.addEventListener('nai-agent-ui-preferences', applyPreferences);
    window.addEventListener('nai-agent-navigate', navigate);
    return () => {
      window.removeEventListener('nai-agent-ui-preferences', applyPreferences);
      window.removeEventListener('nai-agent-navigate', navigate);
    };
  });

  const refreshData = async (force = false) => {
    // Chains (Always load all chains so we can filter client side and do mutual imports)
    if (!force && chains.length > 0 && Date.now() - lastChainFetch < CACHE_TTL) return;

    setLoading(true);
    try {
      const data = await db.getAllChains();
      setChains(data);
      setLastChainFetch(Date.now());
      setDbConfigError(false);
    } catch (e: any) {
      if (e.message && e.message.includes('Database not configured')) {
        setDbConfigError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadArtists = async (force = false) => {
    if (!force && artistsCache && Date.now() - lastArtistFetch < CACHE_TTL) return;
    const data = await db.getAllArtists();
    setArtistsCache(data.sort((a, b) => a.name.localeCompare(b.name)));
    setLastArtistFetch(Date.now());
  };

  const loadInspirations = async (force = false) => {
    if (!force && inspirationsCache && Date.now() - lastInspirationFetch < CACHE_TTL) return;
    const data = await db.getAllInspirations();
    setInspirationsCache(data);
    setLastInspirationFetch(Date.now());
  };

  useEffect(() => {
    const refreshAgentChanges = () => {
      void refreshData(true);
      void loadArtists(true);
      void loadInspirations(true);
    };
    window.addEventListener('nai-project-data-changed', refreshAgentChanges);
    return () => window.removeEventListener('nai-project-data-changed', refreshAgentChanges);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('nai_theme', themeMode);
  }, [isDark, themeMode]);

  useEffect(() => {
    const onTheme = (event: Event) => setThemeMode((event as CustomEvent<'light' | 'dark' | 'system'>).detail);
    const onSafeMode = (event: Event) => setSafeMode(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('nai-agent-theme-change', onTheme);
    window.addEventListener('nai-agent-safe-mode-change', onSafeMode);
    return () => {
      window.removeEventListener('nai-agent-theme-change', onTheme);
      window.removeEventListener('nai-agent-safe-mode-change', onSafeMode);
    };
  }, []);

  const toggleTheme = () => setThemeMode(isDark ? 'light' : 'dark');

  const resetRevealedImages = () => {
    document.querySelectorAll<HTMLImageElement>('img[data-safe-revealed="true"]').forEach(image => {
      delete image.dataset.safeRevealed;
    });
  };

  const toggleSafeMode = () => {
    resetRevealedImages();
    setSafeMode(enabled => !enabled);
  };

  useEffect(() => {
    localStorage.setItem('nai_safe_mode', String(safeMode));
    resetRevealedImages();

    if (!safeMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetRevealedImages();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetRevealedImages();
    };
    let pointerFrame: number | null = null;
    let pointerPosition = { x: 0, y: 0 };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (pointerFrame !== null) return;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = null;
        document.querySelectorAll<HTMLImageElement>('img[data-safe-revealed="true"]').forEach(image => {
          const rect = image.getBoundingClientRect();
          const isInsideImage = pointerPosition.x >= rect.left && pointerPosition.x <= rect.right
            && pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom;
          if (!isInsideImage) delete image.dataset.safeRevealed;
        });
      });
    };

    window.addEventListener('blur', resetRevealedImages);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('pointermove', handlePointerMove, true);
    return () => {
      if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame);
      window.removeEventListener('blur', resetRevealedImages);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('pointermove', handlePointerMove, true);
    };
  }, [safeMode]);

  useEffect(() => {
    if (safeMode) resetRevealedImages();
  }, [view, safeMode]);

  const findImageAtPointer = (target: HTMLElement, clientX: number, clientY: number) => {
    if (target instanceof HTMLImageElement) return target;

    let current: HTMLElement | null = target;
    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
      const candidates = Array.from(current.querySelectorAll<HTMLImageElement>('img'))
        .filter(image => {
          const rect = image.getBoundingClientRect();
          return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        })
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.width * aRect.height - bRect.width * bRect.height;
        });
      if (candidates[0]) return candidates[0];
    }
    return null;
  };

  const handleSafeModeClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!safeMode || !(event.target instanceof HTMLElement)) return;
    const image = findImageAtPointer(event.target, event.clientX, event.clientY);
    if (!image) {
      resetRevealedImages();
      return;
    }
    if (image.dataset.safeModeIgnore === 'true' || image.dataset.safeRevealed === 'true') return;

    event.preventDefault();
    event.stopPropagation();
    image.dataset.safeRevealed = 'true';
  };

  const keepViewMounted = (targetView: ViewState) => {
    if (!isKeepAliveView(targetView)) return;
    setMountedViews(prev => prev.includes(targetView) ? prev : [...prev, targetView]);
  };

  const ensurePlayground = () => {
    setPlaygroundChain(previous => previous || {
      id: 'playground',
      name: '生图实验室',
      description: '临时生图实验，点击 Fork 可保存到库',
      userId: currentUser?.id || 'local-owner',
      basePrompt: '',
      negativePrompt: '',
      modules: [],
      params: {
        width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined, qualityToggle: true, ucPreset: 4, characters: []
      },
      variableValues: { subject: '' },
      type: 'style',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const handleOpenAgent = () => {
    // Agent is a tool overlay, not a destination. Opening it must never trigger
    // the editor navigation guard or discard the page underneath it.
    if (view === 'edit') {
      window.dispatchEvent(new CustomEvent('nai-open-prompt-agent', { detail: { chainId: selectedId } }));
      return;
    }
    if (playgroundChain && mountedViews.includes('playground')) {
      window.dispatchEvent(new CustomEvent('nai-open-prompt-agent', { detail: { chainId: 'playground' } }));
      return;
    }
    ensurePlayground();
    keepViewMounted('playground');
    setPlaygroundAgentOpenToken(value => value + 1);
  };

  const handleNavigate = async (newView: ViewState, id?: string, options: { externalImport?: boolean } = {}) => {
    if (isEditorDirty) {
      if (!await confirmAction({
        title: '放弃未保存的更改？',
        message: '当前修改尚未保存，离开后将会丢失。',
        confirmLabel: '放弃并离开',
        tone: 'danger',
      })) {
        return;
      }
      // User confirmed, reset dirty state
      setIsEditorDirty(false);
    }

    startTransition(() => {
      setSelectedId(id);
      setView(newView);
      keepViewMounted(newView);
      if (newView === 'playground' && options.externalImport) {
        setPlaygroundImportToken(prev => prev + 1);
      }
      if (newView === 'playground') ensurePlayground();
    });

    // Auto-load data based on view, respecting cache
    if (newView === 'list' || newView === 'characters') refreshData();
    if (newView === 'library') loadArtists();
    if (newView === 'inspiration') loadInspirations();

  };

  const handleUpdatePlaygroundChain = async (id: string, updates: Partial<PromptChain>) => {
    setPlaygroundChain(prev => prev ? { ...prev, ...updates } : null);
  };

  const handleCreateChain = async (name: string, desc: string, type: ChainType) => {
    setLoading(true);
    const newId = await db.createChain(name, desc, undefined, type);
    await refreshData(true);
    setLoading(false);
    handleNavigate('edit', newId);
  };

  const handleForkChain = async (chain: PromptChain, targetType?: ChainType) => {
    const finalType = targetType || chain.type;
    const name = chain.name + (chain.id === 'playground' ? '' : ' (Fork)');
    await db.createChain(name, chain.description, chain, finalType); // Persist type on fork
    notify('Fork 成功！已保存到您的列表');
    await refreshData(true);
    // Return to appropriate list based on type
    const targetView = finalType === 'character' ? 'characters' : 'list';
    setView(targetView);
    keepViewMounted(targetView);
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
    await db.updateChain(id, updates);
    await refreshData(true);
  };

  const handleCreateChainFromAitag = async (chain: PromptChain) => {
    setLoading(true);
    const newId = await db.createChain(chain.name, chain.description, chain, 'style');
    await refreshData(true);
    setLoading(false);
    handleNavigate('edit', newId);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await db.deleteChain(id);
    await refreshData(true);
    // Stay on current list view
    setLoading(false);
  };

  const getSelectedChain = () => chains.find(c => c.id === selectedId);

  if (!currentUser && !dbConfigError) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-500">正在启动本地应用…</div>;
  }

  // --- Database Setup Guide ---
  if (dbConfigError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans dark:text-white">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">本地服务未连接</h2>
          <p>请使用桌面的 NaiPromptManager 启动脚本运行本地服务。</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded">刷新</button>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  const renderViewContent = (targetView: ViewState) => {
    switch (targetView) {
      case 'list':
        return <ChainList
          chains={chains}
          type="style"
          onCreate={handleCreateChain}
          onSelect={(id) => handleNavigate('edit', id)}
          onDelete={handleDelete}
          onRefresh={() => refreshData(true)}
          isLoading={loading}
          notify={notify}
          isGuest={false}
        />;
      case 'characters':
        return <CharacterLibrary
          chains={chains}
          onCreate={handleCreateChain}
          onSelect={(id) => handleNavigate('edit', id)}
          onDelete={handleDelete}
          onRefresh={async () => { await refreshData(true); }}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          notify={notify}
        />;
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor
          chain={editChain}
          allChains={chains}
          onUpdateChain={handleUpdateChain}
          onBack={() => handleNavigate(editChain.type === 'character' ? 'characters' : 'list')}
          onFork={handleForkChain}
          setIsDirty={setIsEditorDirty}
          notify={notify}
          agentOpenToken={editorAgentOpenToken}
        />;
      case 'library':
        return <ArtistLibrary
          artistsData={artistsCache}
          onRefresh={() => loadArtists(true)}
          notify={notify}
          currentUser={currentUser}
        />;
      case 'aitag':
        return <AitagGallery
          active={view === 'aitag'}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onCreateArtistChain={handleCreateChainFromAitag}
          onRefreshInspiration={() => loadInspirations(true)}
        />;
      case 'inspiration':
        return <InspirationGallery
          currentUser={currentUser}
          inspirationsData={inspirationsCache}
          onRefresh={() => loadInspirations(true)}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
        />;
      case 'history':
        return <GenHistory currentUser={currentUser} notify={notify} onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })} onRefreshInspiration={() => loadInspirations(true)} />;
      case 'playground':
        if (!playgroundChain) return <div>Loading...</div>;
        return <ChainEditor
          chain={playgroundChain}
          allChains={chains}
          onUpdateChain={handleUpdatePlaygroundChain}
          onBack={() => handleNavigate('list')}
          onFork={handleForkChain}
          setIsDirty={() => { }}
          notify={notify}
          externalImportToken={playgroundImportToken}
          agentOpenToken={playgroundAgentOpenToken}
        />;
      default:
        return <div>Unknown View</div>;
    }
  };

  const renderContent = () => {
    const viewsToRender = isKeepAliveView(view) && !mountedViews.includes(view)
      ? [...mountedViews, view]
      : mountedViews;

    return (
      <>
        <div className={view === 'edit' ? 'hidden' : 'flex flex-1 min-h-0 flex-col overflow-hidden'}>
          {viewsToRender.map(mountedView => (
            <div
              key={mountedView}
              className={view === mountedView ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'hidden'}
            >
              {renderViewContent(mountedView)}
            </div>
          ))}
        </div>
        {view === 'edit' && renderViewContent('edit')}
      </>
    );
  };

  const getActiveView = (): ViewState => {
    if (view === 'edit') {
      return getSelectedChain()?.type === 'character' ? 'characters' : 'list';
    }
    return view;
  };

  return (
    <div
      className={`agent-stage flex flex-col h-screen ${safeMode ? 'safe-mode' : ''}`}
      onClickCapture={handleSafeModeClickCapture}
    >
      <Layout
        onNavigate={handleNavigate}
        currentView={view}
        activeView={getActiveView()}
        isDark={isDark}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        safeMode={safeMode}
        toggleSafeMode={toggleSafeMode}
        toast={toast}
        hideNav={view === 'edit' || view === 'playground'}
        notify={notify}
        onOpenAgent={handleOpenAgent}
      >
        {renderContent()}
      </Layout>
    </div>
  );
};

export default App;
