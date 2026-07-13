
import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { ChainEditor } from './components/ChainEditor';
import { ArtistLibrary } from './components/ArtistLibrary';
import { ArtistAdmin } from './components/ArtistAdmin';
import { InspirationGallery } from './components/InspirationGallery';
import { GenHistory } from './components/GenHistory';
import { AitagGallery } from './components/AitagGallery';
import { db } from './services/dbService';
import { PromptChain, User, Artist, Inspiration, ChainType } from './types';

declare const __APP_VERSION__: string;

type ViewState = 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'inspiration' | 'admin' | 'history' | 'playground';
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
  const [usersCache, setUsersCache] = useState<User[] | null>(null);

  // Cache Timestamps
  const [lastChainFetch, setLastChainFetch] = useState(0);
  const [lastArtistFetch, setLastArtistFetch] = useState(0);
  const [lastInspirationFetch, setLastInspirationFetch] = useState(0);
  const [lastUserFetch, setLastUserFetch] = useState(0);

  // Dirty State for Navigation Guard
  const [isEditorDirty, setIsEditorDirty] = useState(false);

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Guest Login State
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestPasscode, setGuestPasscode] = useState('');

  // Theme State
  const [isDark, setIsDark] = useState(() => localStorage.getItem('nai_theme') === 'dark');

  // Toast State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Check Session on Load
  useEffect(() => {
    db.getMe().then(user => {
      setCurrentUser(user);
      refreshData();
    }).catch(() => {
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

  const loadUsers = async (force = false) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!force && usersCache && Date.now() - lastUserFetch < CACHE_TTL) return;
    const data = await db.getUsers();
    setUsersCache(data);
    setLastUserFetch(Date.now());
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
    if (newView === 'admin') {
      // Admin view handles both artist and user loading internally via props now, 
      // but we trigger it here to ensure fresh data if needed or respect cache
      loadArtists();
      if (currentUser?.role === 'admin') loadUsers();
    }

    if (newView === 'playground' && !playgroundChain) {
      // Initialize Playground Chain
      setPlaygroundChain({
        id: 'playground',
        name: '生图实验室',
        description: '临时生图实验，点击 Fork 可保存到库',
        userId: currentUser?.id || 'guest',
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      let res;
      if (isGuestMode) {
        res = await db.guestLogin(guestPasscode);
      } else {
        res = await db.login(loginUser, loginPass);
      }
      setCurrentUser(res.user);
      // Force refresh chains to apply guest_hidden filter based on new role
      refreshData(true);
      // Guest should not stay in admin/profile view
      if (res.user.role === 'guest' && (view === 'admin' || view === 'edit')) {
        setView('list');
        keepViewMounted('list');
        setSelectedId(undefined);
      }
    } catch (err: any) {
      setLoginError(err.message || '登录失败');
    }
  };

  const handleLogout = async () => {
    await db.logout();
    setCurrentUser(null);
    setLoginUser(''); setLoginPass(''); setGuestPasscode('');
    setIsGuestMode(false);
    // Clear all cache to prevent stale data after role switch
    setChains([]);
    setLastChainFetch(0);
    setUsersCache(null);
    setInspirationsCache(null);
    // Reset view to list to prevent guest from staying in admin view
    setView('list');
    setMountedViews(['list']);
    setSelectedId(undefined);
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

  // --- Login Screen ---
  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl font-bold">N</div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">NAI 咒语构建终端</h2>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">

            {/* Guest Toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg mb-4">
              <button
                type="button"
                onClick={() => setIsGuestMode(false)}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${!isGuestMode ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
              >
                账号登录
              </button>
              <button
                type="button"
                onClick={() => setIsGuestMode(true)}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${isGuestMode ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
              >
                游客参观
              </button>
            </div>

            {!isGuestMode ? (
              <>
                <div>
                  <input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none" placeholder="用户名" autoFocus />
                </div>
                <div>
                  <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none" placeholder="密码" />
                </div>
              </>
            ) : (
              <div>
                <input type="password" value={guestPasscode} onChange={(e) => setGuestPasscode(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none text-center tracking-widest" placeholder="输入游客口令" autoFocus />
                <p className="text-xs text-gray-500 text-center mt-2">游客可查看提示词，填入 API Key 后可测试生图 (数据仅存本地)</p>
              </div>
            )}

            {loginError && <div className="text-red-500 text-sm text-center font-medium animate-pulse">{loginError}</div>}
            <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg">
              {isGuestMode ? '进入参观' : '登录'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-center text-xs text-gray-400">
            <span>v{__APP_VERSION__}</span>
            <button onClick={toggleTheme} className="hover:text-gray-600 dark:hover:text-gray-200">{isDark ? '切换亮色' : '切换深色'}</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Database Setup Guide ---
  if (dbConfigError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans dark:text-white">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">数据库未连接</h2>
          <p>请在 Cloudflare 后台绑定 D1 数据库到变量 `DB` 并重新部署。</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded">刷新</button>
        </div>
      </div>
    );
  }

  const renderViewContent = (targetView: ViewState) => {
    // Guest guard for admin view - guest should never see admin panel
    if (targetView === 'admin' && currentUser?.role === 'guest') {
      return <ChainList
        chains={chains}
        type="style"
        onCreate={handleCreateChain}
        onSelect={(id) => handleNavigate('edit', id)}
        onDelete={handleDelete}
        onRefresh={() => refreshData(true)}
        isLoading={loading}
        notify={notify}
        isGuest={true}
      />;
    }
    
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
          isGuest={currentUser.role === 'guest'}
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
          isGuest={currentUser.role === 'guest'}
        />;
      case 'edit':
        const editChain = getSelectedChain();
        if (!editChain) return <div>Chain not found</div>;
        return <ChainEditor
          chain={editChain}
          allChains={chains}
          currentUser={currentUser}
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
      case 'admin':
        return <ArtistAdmin
          currentUser={currentUser}
          artistsData={artistsCache}
          usersData={usersCache}
          onRefreshArtists={() => loadArtists(true)}
          onRefreshUsers={() => loadUsers(true)}
          isDark={isDark}
          toggleTheme={toggleTheme}
          onLogout={handleLogout}
        />;
      case 'history':
        return <GenHistory currentUser={currentUser} notify={notify} onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })} onRefreshInspiration={() => loadInspirations(true)} />;
      case 'playground':
        if (!playgroundChain) return <div>Loading...</div>;
        return <ChainEditor
          chain={playgroundChain}
          allChains={chains}
          currentUser={currentUser}
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
        currentUser={currentUser}
        onLogout={handleLogout}
        toast={toast}
        hideNav={view === 'edit' || view === 'playground'}
      >
        {renderContent()}
      </Layout>
    </div>
  );
};

export default App;
