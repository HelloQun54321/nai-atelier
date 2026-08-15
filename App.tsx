
import React, { lazy, startTransition, Suspense, useState, useEffect, useRef } from 'react';
import { Layout } from './components/Layout';
import { ChainList } from './components/ChainList';
import { useConfirmDialog } from './components/ConfirmDialog';
import { ImageActivityProvider } from './components/SmartImage';
import { db } from './services/dbService';
import { PromptChain, User, Artist, Inspiration, ChainType } from './types';

const ChainEditor = lazy(() => import('./components/ChainEditor').then(module => ({ default: module.ChainEditor })));
const ArtistLibrary = lazy(() => import('./components/ArtistLibrary').then(module => ({ default: module.ArtistLibrary })));
const InspirationGallery = lazy(() => import('./components/InspirationGallery').then(module => ({ default: module.InspirationGallery })));
const GenHistory = lazy(() => import('./components/GenHistory').then(module => ({ default: module.GenHistory })));
const AitagGallery = lazy(() => import('./components/AitagGallery').then(module => ({ default: module.AitagGallery })));
const DanbooruGallery = lazy(() => import('./components/DanbooruGallery').then(module => ({ default: module.DanbooruGallery })));
const PixivGallery = lazy(() => import('./components/PixivGallery').then(module => ({ default: module.PixivGallery })));
const CharacterLibrary = lazy(() => import('./components/CharacterLibrary').then(module => ({ default: module.CharacterLibrary })));

type ViewState = 'list' | 'characters' | 'edit' | 'library' | 'aitag' | 'danbooru' | 'pixiv' | 'inspiration' | 'history' | 'playground';
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

  // 连续 notify 时旧计时器会把新 toast 提前清掉，先清旧再挂新
  const toastTimerRef = useRef<number | null>(null);
  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
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
      if (['list', 'characters', 'library', 'aitag', 'danbooru', 'pixiv', 'inspiration', 'history', 'playground'].includes(detail.view)) void handleNavigate(detail.view, detail.id);
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
      } else {
        console.error('加载画师串列表失败', e);
        notify('画师串列表加载失败，请稍后重试', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadArtists = async (force = false) => {
    if (!force && artistsCache && Date.now() - lastArtistFetch < CACHE_TTL) return;
    try {
      const data = await db.getAllArtists();
      setArtistsCache(data.sort((a, b) => a.name.localeCompare(b.name)));
      setLastArtistFetch(Date.now());
    } catch (e) {
      console.error('加载画师库失败', e);
      notify('画师库加载失败，请稍后重试', 'error');
    }
  };

  const loadInspirations = async (force = false) => {
    if (!force && inspirationsCache && Date.now() - lastInspirationFetch < CACHE_TTL) return;
    try {
      const data = await db.getAllInspirations();
      setInspirationsCache(data);
      setLastInspirationFetch(Date.now());
    } catch (e) {
      console.error('加载灵感库失败', e);
      notify('灵感库加载失败，请稍后重试', 'error');
    }
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

    // Interactive controls are a hard lookup boundary. Mobile floating actions
    // (for example Generate) can share a wrapper with a preview thumbnail; the
    // old ancestor walk treated that sibling image as the click target and the
    // safe-mode capture handler swallowed the button click before its onClick
    // could run. Images that actually belong to a button/card still work,
    // because the boundary itself is searched before traversal stops.
    const interactiveBoundary = target.closest<HTMLElement>(
      'button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
    );
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
      if (current === interactiveBoundary) break;
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
    // SmartImage 会在同一容器内渲染主图 + 渐进升级高清叠加图，CSS 对每张 img
    // 独立判断 data-safe-revealed；只标记一张会导致叠加图残留模糊，必须整组解除。
    const images = [image];
    if (image.parentElement) {
      images.push(...Array.from(image.parentElement.querySelectorAll<HTMLImageElement>('img')));
    }
    for (const candidate of new Set(images)) {
      if (candidate.dataset.safeModeIgnore === 'true') continue;
      candidate.dataset.safeRevealed = 'true';
    }
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
    try {
      const newId = await db.createChain(name, desc, undefined, type);
      await refreshData(true);
      handleNavigate('edit', newId);
    } catch (e) {
      console.error('创建画师串失败', e);
      notify('创建失败，请稍后重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleForkChain = async (chain: PromptChain, targetType?: ChainType) => {
    const finalType = targetType || chain.type;
    const name = chain.name + (chain.id === 'playground' ? '' : ' (Fork)');
    try {
      await db.createChain(name, chain.description, chain, finalType); // Persist type on fork
      notify('Fork 成功！已保存到您的列表');
      await refreshData(true);
      // Return to appropriate list based on type
      const targetView = finalType === 'character' ? 'characters' : 'list';
      setView(targetView);
      keepViewMounted(targetView);
    } catch (e) {
      console.error('Fork 画师串失败', e);
      notify('Fork 失败，请稍后重试', 'error');
    }
  };

  const handleUpdateChain = async (id: string, updates: Partial<PromptChain>) => {
    try {
      await db.updateChain(id, updates);
      await refreshData(true);
    } catch (e) {
      console.error('保存画师串失败', e);
      notify('保存失败，请稍后重试', 'error');
    }
  };

  const handleCreateChainFromAitag = async (chain: PromptChain) => {
    setLoading(true);
    try {
      const newId = await db.createChain(chain.name, chain.description, chain, 'style');
      await refreshData(true);
      handleNavigate('edit', newId);
    } catch (e) {
      console.error('从 AITag 创建画师串失败', e);
      notify('创建失败，请稍后重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await db.deleteChain(id);
      await refreshData(true);
    } catch (e) {
      console.error('删除画师串失败', e);
      notify('删除失败，请稍后重试', 'error');
    } finally {
      // Stay on current list view
      setLoading(false);
    }
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
      case 'danbooru':
        return <DanbooruGallery
          active={view === 'danbooru'}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onRefreshInspiration={() => loadInspirations(true)}
        />;
      case 'pixiv':
        return <PixivGallery
          active={view === 'pixiv'}
          currentUser={currentUser}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          onRefreshInspiration={() => loadInspirations(true)}
        />;
      case 'inspiration':
        return <InspirationGallery
          currentUser={currentUser}
          inspirationsData={inspirationsCache}
          onRefresh={() => loadInspirations(true)}
          notify={notify}
          onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })}
          chains={chains}
          onCreateArtistChain={handleCreateChainFromAitag}
          onSetChainCover={async (chainId, imageUrl) => {
            await db.updateChain(chainId, { previewImage: imageUrl });
            await refreshData(true);
          }}
        />;
      case 'history':
        return <GenHistory currentUser={currentUser} chains={chains} notify={notify} onNavigateToPlayground={() => handleNavigate('playground', undefined, { externalImport: true })} onRefreshInspiration={() => loadInspirations(true)} />;
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
              <ImageActivityProvider active={view === mountedView}>
                {renderViewContent(mountedView)}
              </ImageActivityProvider>
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
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">正在加载工作区…</div>}>
          {renderContent()}
        </Suspense>
      </Layout>
    </div>
  );
};

export default App;
