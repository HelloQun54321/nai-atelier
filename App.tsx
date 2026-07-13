
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { InspirationGallery } from './components/InspirationGallery';
import { GenHistory } from './components/GenHistory';
import { AitagGallery } from './components/AitagGallery';
import { db } from './services/dbService';
import { PromptChain, User, Artist, Inspiration, ChainType } from './types';

type ViewState = 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground';
type KeepAliveView = Exclude<ViewState, 'edit'>;

const CACHE_TTL = 60 * 60 * 1000; // 1 Hour Cache

const isKeepAliveView = (targetView: ViewState): targetView is KeepAliveView => targetView !== 'edit';

const App = () => {
  const [view, setView] = useState<ViewState>('list');
  const [mountedViews, setMountedViews] = useState<KeepAliveView[]>(['list']);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [chains, setChains] = useState<PromptChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbConfigError, setDbConfigError] = useState(false);

  // Playground State
  const [playgroundChain, setPlaygroundChain] = useState<PromptChain | null>(null);
  const [playgroundImportToken, setPlaygroundImportToken] = useState(0);

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
  const [isDark, setIsDark] = useState(() => localStorage.getItem('nai_theme') === 'dark');

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
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('nai_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('nai_theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  const keepViewMounted = (targetView: ViewState) => {
    if (!isKeepAliveView(targetView)) return;
    setMountedViews(prev => prev.includes(targetView) ? prev : [...prev, targetView]);
  };

  const handleNavigate = (newView: ViewState, id?: string, options: { externalImport?: boolean } = {}) => {
    if (isEditorDirty) {
      if (!confirm('您有未保存的更改，确定要离开吗？')) {
        return;
      }
      // User confirmed, reset dirty state
      setIsEditorDirty(false);
    }

    setSelectedId(id);
    setView(newView);
    keepViewMounted(newView);
    if (newView === 'playground' && options.externalImport) {
      setPlaygroundImportToken(prev => prev + 1);
    }

    // Auto-load data based on view, respecting cache
    if (newView === 'list' || newView === 'characters') refreshData();
    if (newView === 'library') loadArtists();
    if (newView === 'inspiration') loadInspirations();

    if (newView === 'playground' && !playgroundChain) {
      // Initialize Playground Chain
      setPlaygroundChain({
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
    }
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
        return <ChainList
          chains={chains}
          type="character"
          onCreate={handleCreateChain}
          onSelect={(id) => handleNavigate('edit', id)}
          onDelete={handleDelete}
          onRefresh={() => refreshData(true)}
          isLoading={loading}
          notify={notify}
          isGuest={false}
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
        />;
      case 'library':
        return <ArtistLibrary
          isDark={isDark}
          toggleTheme={toggleTheme}
          artistsData={artistsCache}
          onRefresh={() => loadArtists(true)}
          notify={notify}
          currentUser={currentUser}
        />;
      case 'aitag':
        return <AitagGallery
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
    <div className="flex flex-col h-screen">
      <Layout
        onNavigate={handleNavigate}
        currentView={view}
        activeView={getActiveView()}
        isDark={isDark}
        toggleTheme={toggleTheme}
        toast={toast}
        hideNav={view === 'edit' || view === 'playground'}
      >
        {renderContent()}
      </Layout>
    </div>
  );
};

export default App;
