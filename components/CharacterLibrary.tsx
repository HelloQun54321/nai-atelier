import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PromptChain } from '../types';
import { generateImage } from '../services/naiService';
import { db } from '../services/dbService';
import { compilePrompt } from '../services/promptUtils';
import { IMPORT_SESSION_KEY } from '../services/metadataService';
import {
  CharacterDictionaryEntry,
  CharacterDictionarySort,
  getCharacterDictionaryEntriesAt,
  getCharacterDictionaryPage,
  searchCharacterDictionary,
} from '../services/tagDictionary';
import { useConfirmDialog } from './ConfirmDialog';

const CATALOG_MARKER = '__character_catalog__';
const DEFAULT_PARAMS = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
};

type CharacterTab = 'all' | 'catalog' | 'custom' | 'favorites';
type GachaMode = 'mixed' | 'catalog' | 'custom';

interface CharacterCard {
  key: string;
  kind: 'catalog' | 'custom';
  name: string;
  tagName?: string;
  chinese?: string;
  postCount?: number;
  previewImage?: string;
  chain?: PromptChain;
}

interface CharacterLibraryProps {
  chains: PromptChain[];
  onCreate: (name: string, description: string, type: 'character') => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void> | void;
  onRefresh: () => Promise<void>;
  onNavigateToPlayground: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const LazyImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '500px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-full w-full bg-gray-200 dark:bg-gray-900">
      {visible && <img src={src} alt={alt} onLoad={() => setLoaded(true)} className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`} />}
    </div>
  );
};

export const CharacterLibrary: React.FC<CharacterLibraryProps> = ({
  chains,
  onCreate,
  onSelect,
  onDelete,
  onRefresh,
  onNavigateToPlayground,
  notify,
}) => {
  const confirmAction = useConfirmDialog();
  const [tab, setTab] = useState<CharacterTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<CharacterDictionarySort>(() => {
    const saved = localStorage.getItem('nai_character_sort');
    return saved === 'least' || saved === 'name-asc' || saved === 'name-desc' ? saved : 'popular';
  });
  const [loadedCatalog, setLoadedCatalog] = useState<CharacterDictionaryEntry[]>([]);
  const [searchResults, setSearchResults] = useState<CharacterDictionaryEntry[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [nextPage, setNextPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nai_character_favorites') || '[]')); }
    catch { return new Set(); }
  });
  const [gachaMode, setGachaMode] = useState<GachaMode>(() => {
    const saved = localStorage.getItem('nai_character_gacha_mode');
    return saved === 'catalog' || saved === 'custom' ? saved : 'mixed';
  });
  const [gachaCount, setGachaCount] = useState<6 | 12 | 24>(() => {
    const saved = Number(localStorage.getItem('nai_character_gacha_count'));
    return saved === 6 || saved === 24 ? saved : 12;
  });
  const [gachaCards, setGachaCards] = useState<CharacterCard[] | null>(null);
  const [isGachaLoading, setIsGachaLoading] = useState(false);
  const [gridColumns, setGridColumns] = useState(() => Number(localStorage.getItem('nai_character_grid_columns')) || 6);
  const [lightbox, setLightbox] = useState<CharacterCard | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const catalogGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const recentGachaRef = useRef<number[][]>([]);

  const characterChains = useMemo(() => chains.filter(chain => chain.type === 'character'), [chains]);
  const catalogChains = useMemo(() => characterChains.filter(chain => chain.tags?.includes(CATALOG_MARKER)), [characterChains]);
  const customChains = useMemo(() => characterChains.filter(chain => !chain.tags?.includes(CATALOG_MARKER)), [characterChains]);
  const persistedCatalog = useMemo(() => new Map(catalogChains.map(chain => [chain.basePrompt.trim().toLowerCase(), chain])), [catalogChains]);

  useEffect(() => {
    const syncApiKey = (event: Event) => setApiKey((event as CustomEvent<string>).detail || sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
    window.addEventListener('nai-api-key-changed', syncApiKey);
    return () => window.removeEventListener('nai-api-key-changed', syncApiKey);
  }, []);

  useEffect(() => {
    localStorage.setItem('nai_character_sort', sort);
    const generation = ++catalogGenerationRef.current;
    setIsLoading(true);
    setLoadedCatalog([]);
    setNextPage(0);
    setPageCount(0);
    setGachaCards(null);
    getCharacterDictionaryPage(0, sort)
      .then(result => {
        if (generation !== catalogGenerationRef.current) return;
        setLoadedCatalog(result.entries);
        setCatalogTotal(result.total);
        setPageCount(result.pageCount);
        setNextPage(1);
      })
      .catch(error => {
        console.warn('Character tag catalog is unavailable:', error);
        notify('角色 Tag 目录加载失败', 'error');
      })
      .finally(() => generation === catalogGenerationRef.current && setIsLoading(false));
  }, [sort]);

  useEffect(() => {
    const query = searchTerm.trim();
    const generation = ++searchGenerationRef.current;
    if (!query) {
      setSearchResults([]);
      return;
    }
    setIsLoading(true);
    const timer = window.setTimeout(() => {
      searchCharacterDictionary(query, 300, sort)
        .then(results => generation === searchGenerationRef.current && setSearchResults(results))
        .catch(error => console.warn('Character tag search failed:', error))
        .finally(() => generation === searchGenerationRef.current && setIsLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchTerm, sort]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || nextPage >= pageCount || searchTerm.trim() || gachaCards) return;
    const generation = catalogGenerationRef.current;
    setIsLoadingMore(true);
    try {
      const result = await getCharacterDictionaryPage(nextPage, sort);
      if (generation !== catalogGenerationRef.current) return;
      setLoadedCatalog(previous => [...previous, ...result.entries]);
      setNextPage(result.page + 1);
    } finally {
      if (generation === catalogGenerationRef.current) setIsLoadingMore(false);
    }
  }, [gachaCards, isLoadingMore, nextPage, pageCount, searchTerm, sort]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || searchTerm.trim() || gachaCards || nextPage >= pageCount) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { root, rootMargin: '800px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [gachaCards, loadMore, nextPage, pageCount, searchTerm]);

  const catalogToCard = useCallback((entry: CharacterDictionaryEntry): CharacterCard => {
    const chain = persistedCatalog.get(entry.name.toLowerCase());
    return {
      key: `catalog:${entry.name}`,
      kind: 'catalog',
      name: entry.chinese || entry.name,
      tagName: entry.name,
      chinese: entry.chinese,
      postCount: entry.postCount,
      previewImage: chain?.previewImage,
      chain,
    };
  }, [persistedCatalog]);

  const customToCard = useCallback((chain: PromptChain): CharacterCard => ({
    key: `custom:${chain.id}`,
    kind: 'custom',
    name: chain.name,
    previewImage: chain.previewImage,
    chain,
  }), []);

  const visibleCards = useMemo(() => {
    if (gachaCards) return gachaCards;
    const query = searchTerm.trim().toLowerCase();
    const catalog = (query ? searchResults : loadedCatalog).map(catalogToCard);
    const custom = customChains
      .filter(chain => !query || chain.name.toLowerCase().includes(query) || chain.basePrompt.toLowerCase().includes(query))
      .map(customToCard);
    let cards = tab === 'catalog' ? catalog : tab === 'custom' ? custom : [...custom, ...catalog];
    if (tab === 'favorites') cards = [...custom, ...catalog].filter(card => favorites.has(card.key));
    return cards;
  }, [catalogToCard, customChains, customToCard, favorites, gachaCards, loadedCatalog, searchResults, searchTerm, tab]);

  const toggleFavorite = (card: CharacterCard) => {
    setFavorites(previous => {
      const next = new Set(previous);
      if (next.has(card.key)) next.delete(card.key); else next.add(card.key);
      localStorage.setItem('nai_character_favorites', JSON.stringify([...next]));
      return next;
    });
  };

  const copyCharacter = async (card: CharacterCard) => {
    const text = card.kind === 'catalog'
      ? card.tagName || card.name
      : compilePrompt(card.chain!, card.chain?.variableValues?.subject || '');
    await navigator.clipboard.writeText(text);
    notify(card.kind === 'catalog' ? '角色 Tag 已复制' : '完整角色提示词已复制');
  };

  const sendToPlayground = (card: CharacterCard) => {
    const chain = card.chain;
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
      prompt: card.kind === 'catalog' ? card.tagName : compilePrompt(chain!, chain?.variableValues?.subject || ''),
      negativePrompt: chain?.negativePrompt || '',
      params: chain?.params || DEFAULT_PARAMS,
    }));
    onNavigateToPlayground();
  };

  const generatePreview = async (card: CharacterCard) => {
    if (!apiKey) {
      notify('请先在全局设置中填写 NovelAI API Key', 'error');
      return;
    }
    if (generatingKey) return;
    setGeneratingKey(card.key);
    try {
      const chain = card.chain;
      const prompt = card.kind === 'catalog'
        ? `${card.tagName}, solo, character focus, full body, simple background`
        : compilePrompt(chain!, chain?.variableValues?.subject || '');
      const negative = chain?.negativePrompt || 'lowres, bad anatomy, bad hands, text, watermark, multiple views';
      const params = chain?.params || DEFAULT_PARAMS;
      const result = await generateImage(apiKey, prompt, negative, params);
      let chainId = chain?.id;
      if (!chainId) {
        chainId = await db.createChain(card.chinese || card.tagName || card.name, `角色 Tag：${card.tagName}`, undefined, 'character');
        await db.updateChain(chainId, {
          basePrompt: card.tagName || '',
          negativePrompt: '',
          tags: [CATALOG_MARKER],
          variableValues: { subject: '' },
          params: DEFAULT_PARAMS,
        });
      }
      await db.updateChain(chainId, { previewImage: result.image });
      await onRefresh();
      notify('角色预览已生成并保存到本地');
    } catch (error) {
      notify(`生成失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setGeneratingKey(null);
    }
  };

  const drawIndex = (total: number) => Math.random() < 0.7
    ? Math.floor(Math.random() * Math.min(total, 20_000))
    : Math.floor(Math.random() * total);

  const drawGacha = async () => {
    if (isGachaLoading || catalogTotal <= 0) return;
    if (gachaMode === 'custom' && customChains.length === 0) {
      notify('还没有自定义还原角色', 'error');
      return;
    }
    setIsGachaLoading(true);
    setSearchTerm('');
    localStorage.setItem('nai_character_gacha_mode', gachaMode);
    localStorage.setItem('nai_character_gacha_count', String(gachaCount));
    try {
      const customCards = [...customChains].sort(() => Math.random() - 0.5).slice(0, gachaCount).map(customToCard);
      const customTarget = gachaMode === 'custom' ? gachaCount : gachaMode === 'mixed' ? Math.min(customCards.length, Math.max(1, Math.round(gachaCount * 0.25))) : 0;
      const catalogTarget = gachaCount - customTarget;
      const recent = new Set(recentGachaRef.current.flat());
      const indices = new Set<number>();
      let attempts = 0;
      while (indices.size < catalogTarget && attempts++ < 10_000) {
        const index = drawIndex(catalogTotal);
        if (!recent.has(index)) indices.add(index);
      }
      while (indices.size < catalogTarget) indices.add(drawIndex(catalogTotal));
      const entries = await getCharacterDictionaryEntriesAt([...indices]);
      const cards = [...customCards.slice(0, customTarget), ...entries.map(catalogToCard)].sort(() => Math.random() - 0.5);
      setGachaCards(cards);
      recentGachaRef.current = [...recentGachaRef.current, [...indices]].slice(-5);
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.warn('Character gacha failed:', error);
      notify('角色抽卡失败', 'error');
    } finally {
      setIsGachaLoading(false);
    }
  };

  const deleteCustom = async (card: CharacterCard) => {
    if (!card.chain || !await confirmAction({
      title: `删除“${card.name}”？`,
      message: '该自定义角色还原及其本地预览将被永久删除，此操作无法撤销。',
      confirmLabel: '确认删除',
      tone: 'danger',
    })) return;
    await onDelete(card.chain.id);
    notify('自定义角色已删除');
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, newDescription.trim(), 'character');
    setShowCreate(false);
    setNewName('');
    setNewDescription('');
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <header className="flex flex-none flex-col gap-4 border-b border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">角色库</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">角色 Tag 完整目录与我的自定义角色还原</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => setShowCreate(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">＋ 自定义角色</button>
            <select value={gachaMode} onChange={event => setGachaMode(event.target.value as GachaMode)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white">
              <option value="mixed">Tag + 自定义</option><option value="catalog">只抽角色 Tag</option><option value="custom">只抽自定义</option>
            </select>
            <select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white">
              <option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option>
            </select>
            <button onClick={() => void drawGacha()} disabled={isGachaLoading} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500 disabled:opacity-50">🎲 {gachaCards ? '再抽一批' : '随机抽卡'}</button>
            {gachaCards && <button onClick={() => setGachaCards(null)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:text-gray-200">返回目录</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            ['all', `全部`], ['catalog', `角色 Tag`], ['custom', `我的自定义 ${customChains.length}`], ['favorites', '收藏'],
          ] as [CharacterTab, string][]).map(([value, label]) => (
            <button key={value} onClick={() => { setTab(value); setGachaCards(null); }} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}>{label}</button>
          ))}
          <div className="min-w-[220px] flex-1" />
          <span className="text-xs text-gray-400">列数</span>
          <input type="range" min="3" max="10" value={gridColumns} onChange={event => { const value = Number(event.target.value); setGridColumns(value); localStorage.setItem('nai_character_grid_columns', String(value)); }} className="w-24" />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[260px] flex-1">
            <svg className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setGachaCards(null); }} placeholder="搜索中文角色名或英文 Tag…" className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          </div>
          <select value={sort} disabled={Boolean(gachaCards)} onChange={event => setSort(event.target.value as CharacterDictionarySort)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-white">
            <option value="popular">热度从高到低</option><option value="least">热度从低到高</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option>
          </select>
          <div className="flex items-center rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
            显示 {visibleCards.length.toLocaleString('zh-CN')} · 目录 {catalogTotal.toLocaleString('zh-CN')} · 自定义 {customChains.length}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto p-4 pb-28 md:p-6">
        {isLoading && <div className="absolute inset-x-0 top-3 z-20 flex justify-center"><span className="rounded-full bg-gray-900/80 px-4 py-2 text-xs text-white">正在加载角色目录…</span></div>}
        <div className="grid gap-3 md:gap-4" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
          {visibleCards.map(card => {
            const favorite = favorites.has(card.key);
            const generating = generatingKey === card.key;
            return (
              <article key={card.key} className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-indigo-400 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <div className="relative aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-900">
                  {card.previewImage ? <button className="h-full w-full" onClick={() => setLightbox(card)}><LazyImage src={card.previewImage} alt={card.name} /></button> : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center text-gray-400">
                      <span className="text-3xl">{card.kind === 'catalog' ? '🏷️' : '🧩'}</span>
                      <span className="mt-2 text-[11px]">尚未生成本地预览</span>
                      <button disabled={!apiKey || generating} onClick={() => void generatePreview(card)} className="mt-3 rounded bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">{generating ? '生成中…' : '生成预览'}</button>
                    </div>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-bold text-white shadow ${card.kind === 'catalog' ? 'bg-blue-600' : 'bg-purple-600'}`}>{card.kind === 'catalog' ? '角色 Tag' : '自定义还原'}</span>
                  <button onClick={() => toggleFavorite(card)} className={`absolute right-2 top-2 rounded-full bg-black/55 p-1.5 ${favorite ? 'text-yellow-400' : 'text-white'}`} aria-label="收藏">
                    <svg className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
                  </button>
                  {card.previewImage && <button disabled={generating} onClick={() => void generatePreview(card)} className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-40">{generating ? '生成中…' : '重新生成'}</button>}
                </div>
                <div className="p-3">
                  <h2 className="truncate text-sm font-bold text-gray-900 dark:text-white" title={card.name}>{card.name}</h2>
                  {card.kind === 'catalog' ? <>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-gray-400" title={card.tagName}>{card.tagName}</div>
                    <div className="mt-1 text-[10px] text-orange-500">作品 {(card.postCount || 0).toLocaleString('zh-CN')}</div>
                  </> : <div className="mt-1 truncate text-[10px] text-gray-400">{card.chain?.description || '手工组合外貌与服装提示词'}</div>}
                  <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
                    <button onClick={() => void copyCharacter(card)} className="rounded bg-gray-100 px-2 py-1.5 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">复制</button>
                    <button onClick={() => sendToPlayground(card)} className="rounded bg-indigo-50 px-2 py-1.5 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300">实验室</button>
                    {card.kind === 'custom' ? <>
                      <button onClick={() => onSelect(card.chain!.id)} className="rounded bg-purple-50 px-2 py-1.5 text-purple-600 hover:bg-purple-100 dark:bg-purple-950/50 dark:text-purple-300">编辑还原</button>
                      <button onClick={() => void deleteCustom(card)} className="rounded bg-red-50 px-2 py-1.5 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400">删除</button>
                    </> : <a href={`https://danbooru.donmai.us/posts?tags=${encodeURIComponent(card.tagName || '')}`} target="_blank" rel="noreferrer" className="col-span-2 rounded bg-blue-50 px-2 py-1.5 text-center text-blue-600 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-300">Danbooru</a>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!searchTerm.trim() && !gachaCards && tab !== 'custom' && tab !== 'favorites' && (
          <div ref={sentinelRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-gray-400">
            {isLoadingMore ? '正在加载更多角色…' : nextPage < pageCount ? <button onClick={() => void loadMore()} className="rounded-full border border-gray-300 px-4 py-2 hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">继续向下滚动加载更多</button> : catalogTotal ? '已加载完整角色目录' : null}
          </div>
        )}
        {!isLoading && visibleCards.length === 0 && <div className="py-20 text-center text-gray-400">没有找到符合条件的角色</div>}
      </div>

      {lightbox?.previewImage && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <img src={lightbox.previewImage} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={event => event.stopPropagation()} />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded bg-black/65 px-4 py-2 text-center text-sm text-white">{lightbox.name}{lightbox.tagName ? ` · ${lightbox.tagName}` : ''}</div>
          <button onClick={() => setLightbox(null)} className="absolute right-5 top-5 text-3xl text-white">×</button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800" onClick={event => event.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">新建自定义还原角色</h2>
            <p className="mt-1 text-sm text-gray-500">适合 NovelAI 没有收录角色 Tag，需要手工组合外貌与服装的角色。</p>
            <input autoFocus value={newName} onChange={event => setNewName(event.target.value)} placeholder="角色名称，例如：穆宁雪" className="mt-5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
            <textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="简单描述（可选）" className="mt-3 h-24 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded px-4 py-2 text-sm text-gray-500">取消</button><button onClick={submitCreate} disabled={!newName.trim()} className="rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">创建并编辑</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
