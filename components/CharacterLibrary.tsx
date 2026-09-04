import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PromptChain } from '../types';
import { generateImage } from '../services/naiService';
import { api } from '../services/api';
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
import { OriginalImage, SmartImage } from './SmartImage';
import { MobileBottomSheet, MobileDetailView, MobileIconButton } from './MobileUI';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry } from './ShortestColumnMasonry';
import { Check, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Dice5, Eye, GripVertical, Heart, LoaderCircle, Menu, Pencil, Plus, RefreshCw, Settings2, SlidersHorizontal, Tag, UserRound, X } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { DanbooruCover } from './DanbooruCover';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';
import { danbooruService } from '../services/danbooruService';
import type { DanbooruCoverCandidate } from '../services/danbooruService';
import { importDanbooruCoverAsDataUrl } from '../services/danbooruCoverImport';
import { TagCoverActions } from './TagCoverActions';
import { useRestoreListAnchor } from './useRestoreListAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';

const CATALOG_MARKER = '__character_catalog__';
const getDanbooruPostsUrl = (tagName: string) =>
  `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(tagName.trim().replace(/\s+/g, '_'))}`;
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

type CharacterTab = 'all' | 'catalog' | 'custom';
type GachaMode = 'mixed' | 'catalog' | 'custom';

interface CharacterCard {
  key: string;
  kind: 'catalog' | 'custom';
  name: string;
  tagName?: string;
  chinese?: string;
  postCount?: number;
  matchReason?: string;
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
  returnTargetId?: string;
}

const LazyImage = SmartImage;

export const CharacterLibrary: React.FC<CharacterLibraryProps> = ({
  chains,
  onCreate,
  onSelect,
  onDelete,
  onRefresh,
  onNavigateToPlayground,
  notify,
  returnTargetId,
}) => {
  const imageDisplay = useMobileImageDisplayPreferences();
    // 瀑布流（masonry 布局时）：封面按真实宽高比完整显示，最短列分配互相补齐。
    const [cardRatios, setCardRatios] = useState<Record<string, number>>({});
    const estimateCharacterCardHeight = React.useCallback((card: CharacterCard, columnWidth: number) => {
      const ratio = cardRatios[card.key] || 2 / 3;
      const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
      return imageHeight + 82; // 名称 + tagName/描述文本区
    }, [cardRatios]);
    const renderCharacterCard = (card: CharacterCard) => {
            const favorite = favorites.has(card.key);
            const generating = generatingKey === card.key;
            const selected = selectedKeys.has(card.key);
            const showPin = card.kind === 'catalog' && Boolean(coverCandidates[card.key]);
            return (
              <article key={card.key} data-safe-mode-work="true" data-return-item-id={card.kind === 'custom' ? card.chain?.id : undefined} onClick={() => toggleSelect(card)} aria-pressed={selected} className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-2xl border bg-white transition-colors cursor-pointer dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-indigo-400 dark:border-gray-800 dark:hover:border-indigo-600'}`}>
                <div className="mobile-gallery-frame relative md:aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': cardRatios[card.key] ? `${Math.round(cardRatios[card.key] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                  {card.kind === 'catalog' && card.tagName ? <DanbooruCover tag={card.tagName} kind="character" alt={card.name} fixedSrc={card.previewImage} onCandidateChange={candidate => rememberCoverCandidate(card.key, candidate)} onImageLoad={(width, height) => { const r = width / Math.max(1, height); if (Number.isFinite(r) && r > 0) setCardRatios(previous => (previous[card.key] === r ? previous : { ...previous, [card.key]: r })); }} /> : card.previewImage ? <button className="h-full w-full" onClick={event => { event.stopPropagation(); setLightbox(card); }}><LazyImage src={card.previewImage} alt={card.name} onLoad={event => { const img = event.currentTarget; if (img.naturalWidth > 0 && img.naturalHeight > 0) { const r = img.naturalWidth / img.naturalHeight; if (Number.isFinite(r) && r > 0) setCardRatios(previous => (previous[card.key] === r ? previous : { ...previous, [card.key]: r })); } }} /></button> : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center text-gray-400">
                      {card.kind === 'catalog' ? <Tag className="h-8 w-8" /> : <UserRound className="h-8 w-8" />}
                      <span className="mt-2 text-[11px]">尚未生成本地预览</span>
                      <button disabled={!apiKey || generating} onClick={event => { event.stopPropagation(); void generatePreview(card); }} className="mt-3 rounded bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">{generating ? '生成中…' : '生成预览'}</button>
                    </div>
                  )}
                  <TagCoverActions
                    favorite={favorite}
                    onToggleFavorite={() => toggleFavorite(card)}
                    candidate={card.kind === 'catalog' ? coverCandidates[card.key] : null}
                    onSetCover={card.kind === 'catalog' ? candidate => setDanbooruCover(card, candidate) : undefined}
                    pinPlacement="bottom-right"
                  />
                  {card.previewImage && <button disabled={generating} onClick={event => { event.stopPropagation(); void generatePreview(card); }} className={`absolute bottom-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-40 ${showPin ? 'right-12' : 'right-2'}`}>{generating ? '生成中…' : '重新生成'}</button>}
                  {card.kind === 'custom' && (
                    <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity md:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          if (card.chain) onSelect(card.chain.id);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-indigo-600 shadow-sm backdrop-blur hover:bg-indigo-50 dark:bg-black/70 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
                        title="编辑还原角色与 Prompt"
                        aria-label="编辑自定义角色"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {selected && (
                    <div className="pointer-events-none absolute inset-0 z-10 border-4 border-indigo-500/80">
                      <div className="absolute left-2 top-2 rounded-full bg-indigo-600 p-1 text-white shadow-lg"><Check className="h-3 w-3" strokeWidth={4} /></div>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1.5">
                    <h2 data-safe-mode-title="true" className="truncate text-sm font-bold text-gray-900 dark:text-white" title={card.name}>{card.name}</h2>
                    {card.kind === 'custom' ? (
                      <span className="flex-none rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">自定义</span>
                    ) : (
                      <span className="flex-none rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Tag 词库</span>
                    )}
                  </div>
                  {card.kind === 'catalog' ? <>
                    <div data-safe-mode-title="true" className="mt-0.5 truncate font-mono text-[10px] text-gray-400" title={card.tagName}>{card.tagName}</div>
                    <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-gray-500">作品 {(card.postCount || 0).toLocaleString('zh-CN')}</span>
                      {card.matchReason && <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-700 dark:text-gray-300" title={`匹配：${card.matchReason}`}>匹配：{card.matchReason}</span>}
                    </div>
                  </> : (
                    <div className="mt-1 flex items-center justify-between gap-1.5 text-[10px]">
                      <div className="truncate font-mono text-gray-400 dark:text-gray-500" title={card.chain?.basePrompt || card.chain?.description || ''}>
                        {card.chain?.basePrompt || card.chain?.description || '手工组合外貌与服装提示词'}
                      </div>
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          if (card.chain) onSelect(card.chain.id);
                        }}
                        className="flex-none font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      >
                        编辑
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          
    };

  const confirmAction = useConfirmDialog();
  const [tab, setTab] = useState<CharacterTab>('all');
  const [showFavOnly, setShowFavOnly] = useState(false);
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
  // 收藏条目的展示快照（名字/中文名/作品数）：词库是无限分页加载的，"只看收藏"若只在
  // 已加载子集里过滤，未加载页的收藏将永远不可见。收藏时把条目信息落一份快照，
  // 筛选时直接按收藏清单渲染，不再依赖"恰好加载到那一页"。
  const [favoriteDetails, setFavoriteDetails] = useState<Record<string, { name?: string; chinese?: string; postCount?: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('nai_character_favorite_details') || '{}'); }
    catch { return {}; }
  });
  const [coverCandidates, setCoverCandidates] = useState<Record<string, DanbooruCoverCandidate | null>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
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
  const gridColumns = 6;
  const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [lightbox, setLightbox] = useState<CharacterCard | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showGachaTools, setShowGachaTools] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const catalogGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const recentGachaRef = useRef<number[][]>([]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

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

  // 旧收藏没有展示快照：进入"只看收藏"时按名字向本地词库逐个检索补齐（串行 + 间隔，避免压垮词库读取）。
  // 检索不到的（可能已从词库下架）记一个仅含名字的快照，避免每次进入都重复检索。
  useEffect(() => {
    if (!showFavOnly || searchTerm.trim()) return;
    const missing = Array.from(favorites).filter(key => key.startsWith('catalog:') && !favoriteDetails[key]);
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      for (const key of missing) {
        if (cancelled) return;
        const tagName = key.slice('catalog:'.length);
        try {
          const results = await searchCharacterDictionary(tagName, 5, sort);
          if (cancelled) return;
          const entry = results.find(item => item.name === tagName)
            ?? results.find(item => item.name.toLowerCase() === tagName.toLowerCase());
          setFavoriteDetails(previous => {
            if (previous[key] || cancelled) return previous;
            const next = {
              ...previous,
              [key]: entry
                ? { name: entry.name, chinese: entry.chinese, postCount: entry.postCount }
                : { name: tagName },
            };
            try { localStorage.setItem('nai_character_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
            return next;
          });
        } catch {
          return; // 词库检索失败：中止本轮，下次进入筛选时继续补
        }
        await new Promise(resolve => window.setTimeout(resolve, 120));
      }
    })();
    return () => { cancelled = true; };
  }, [showFavOnly, searchTerm, favorites, favoriteDetails, sort]);

  useEffect(() => {
    const query = searchTerm.trim();
    const generation = ++searchGenerationRef.current;
    if (!query) {
      setSearchResults([]);
      // 清空搜索词时必须复位 loading：在途请求的 finally 会被上面递增的代际守卫拦下，不复位就永久转圈
      setIsLoading(false);
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
      matchReason: entry.matchReason,
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
    // "只看收藏"（无搜索词时）以收藏清单为准渲染：词库是无限分页加载的，按"已加载子集"
    // 过滤会让未加载页的收藏永远显示不出来。自定义角色取本地链，词库角色取已加载条目 →
    // 收藏快照 → 按键名兜底（名称/封面来自本地已有角色链）。
    if (showFavOnly && !query) {
      const customByKey = new Map(customChains.map(chain => [`custom:${chain.id}`, customToCard(chain)]));
      const loadedByName = new Map(loadedCatalog.map(entry => [entry.name, entry]));
      const cards: CharacterCard[] = [];
      for (const key of favorites) {
        if (key.startsWith('custom:')) {
          if (tab === 'catalog') continue;
          const customCard = customByKey.get(key);
          if (customCard) cards.push(customCard);
          continue;
        }
        if (!key.startsWith('catalog:')) continue;
        if (tab === 'custom') continue;
        const tagName = key.slice('catalog:'.length);
        const loaded = loadedByName.get(tagName);
        if (loaded) {
          cards.push(catalogToCard(loaded));
          continue;
        }
        const snapshot = favoriteDetails[key];
        const chain = persistedCatalog.get(tagName.toLowerCase());
        cards.push({
          key,
          kind: 'catalog',
          name: snapshot?.chinese || snapshot?.name || tagName,
          tagName,
          chinese: snapshot?.chinese,
          postCount: snapshot?.postCount,
          previewImage: chain?.previewImage,
          chain,
        });
      }
      return cards;
    }
    const catalog = (query ? searchResults : loadedCatalog).map(catalogToCard);
    const custom = customChains
      .filter(chain => !query || chain.name.toLowerCase().includes(query) || chain.basePrompt.toLowerCase().includes(query))
      .map(customToCard);
    let cards = tab === 'catalog' ? catalog : tab === 'custom' ? custom : [...custom, ...catalog];
    if (showFavOnly) cards = cards.filter(card => favorites.has(card.key));
    return cards;
  }, [catalogToCard, customChains, customToCard, favoriteDetails, favorites, gachaCards, loadedCatalog, persistedCatalog, searchResults, searchTerm, showFavOnly, tab]);
  useRestoreListAnchor(scrollRef, returnTargetId, `${visibleCards.length}:${isLoading ? 1 : 0}`);
  const onScrollRestore = useKeepAliveScrollRestore(scrollRef, 'characters');

  // 目录预取：当前页可见目录角色（前 40 个）的封面候选提前请求并固定保存（pin），
  // 滚动/浏览时封面秒出；getCoverSet 自带 14 天缓存与 300ms 串行限流，不重复打 Danbooru API。
  const coverPrewarmedRef = useRef(new Set<string>());
  useEffect(() => {
    if (gachaCards || tab === 'custom' || showFavOnly) return;
    const targets = visibleCards
      .filter(card => card.kind === 'catalog' && card.tagName && !coverPrewarmedRef.current.has(card.key))
      .slice(0, 40);
    if (!targets.length) return;
    for (const card of targets) {
      coverPrewarmedRef.current.add(card.key);
      // 上方 filter 已保证 catalog 卡片带有 tagName
      void danbooruService.getCoverSet(card.tagName!, 'character').then(set => {
        const src = set.representative?.sampleUrl || set.candidates?.[0]?.sampleUrl;
        if (!src) return;
        fetch('/api/media/prewarm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sources: [src], pin: true }),
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [gachaCards, showFavOnly, tab, visibleCards]);

  const toggleFavorite = (card: CharacterCard) => {
    const wasFavorite = favorites.has(card.key);
    setFavorites(previous => {
      const next = new Set(previous);
      if (next.has(card.key)) next.delete(card.key); else next.add(card.key);
      localStorage.setItem('nai_character_favorites', JSON.stringify([...next]));
      return next;
    });
    setFavoriteDetails(previous => {
      if (wasFavorite) {
        if (!(card.key in previous)) return previous;
        const next = { ...previous };
        delete next[card.key];
        try { localStorage.setItem('nai_character_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
        return next;
      }
      if (card.kind !== 'catalog' || !card.tagName) return previous;
      const next = { ...previous, [card.key]: { name: card.tagName, chinese: card.chinese, postCount: card.postCount } };
      try { localStorage.setItem('nai_character_favorite_details', JSON.stringify(next)); } catch { /* 配额满时保留会话内状态 */ }
      return next;
    });
  };

  const rememberCoverCandidate = useCallback((cardKey: string, candidate: DanbooruCoverCandidate | null) => {
    setCoverCandidates(previous => previous[cardKey]?.id === candidate?.id ? previous : { ...previous, [cardKey]: candidate });
  }, []);

  /** 单卡复制文本：角色 Tag 用其英文 Tag，自定义角色用编译后的完整提示词。 */
  const cardPromptText = (card: CharacterCard): string => card.kind === 'catalog'
    ? card.tagName || card.name
    : compilePrompt(card.chain!, card.chain?.variableValues?.subject || '');

  const copyCharacter = async (card: CharacterCard) => {
    await navigator.clipboard.writeText(cardPromptText(card));
    notify(card.kind === 'catalog' ? '角色 Tag 已复制' : '完整角色提示词已复制');
  };

  const sendToPlayground = (card: CharacterCard) => {
    const chain = card.chain;
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
      prompt: cardPromptText(card),
      negativePrompt: chain?.negativePrompt || '',
      params: chain?.params || DEFAULT_PARAMS,
    }));
    onNavigateToPlayground();
  };

  /** 当前选中的卡片集合；key 与卡片 key 一致（catalog:tagName / custom:chainId），
   *  跨搜索/抽卡/切换 Tab 保持选中。 */
  /** 选中角色槽位列表：支持有序调整槽位 (1..N) 与位置 */
  const [selectedSlotOrder, setSelectedSlotOrder] = useState<string[]>([]);
  const [showSlotDetail, setShowSlotDetail] = useState(false);
  const [draggingSlotIndex, setDraggingSlotIndex] = useState<number | null>(null);

  // 同步已选卡片的顺序（新选中的加到末尾，取消选中的移出）
  useEffect(() => {
    setSelectedSlotOrder(prev => {
      const currentKeys = Array.from(selectedKeys);
      const kept = prev.filter(k => selectedKeys.has(k));
      const added = currentKeys.filter(k => !prev.includes(k));
      return [...kept, ...added];
    });
  }, [selectedKeys]);

  /** 当前选中的卡片集合（按 slotOrder 排列） */
  const selectedCards = useMemo(() => {
    const cardMap = new Map<string, CharacterCard>();
    selectedKeys.forEach(key => {
      if (key.startsWith('catalog:')) {
        const tagName = key.slice('catalog:'.length);
        const chain = persistedCatalog.get(tagName.toLowerCase());
        cardMap.set(key, { key, kind: 'catalog', name: chain?.name || tagName, tagName, chain });
      } else if (key.startsWith('custom:')) {
        const id = key.slice('custom:'.length);
        const chain = customChains.find(candidate => candidate.id === id);
        if (chain) cardMap.set(key, { key, kind: 'custom', name: chain.name, previewImage: chain.previewImage, chain });
      }
    });
    return selectedSlotOrder.map(k => cardMap.get(k)).filter((c): c is CharacterCard => Boolean(c));
  }, [customChains, persistedCatalog, selectedKeys, selectedSlotOrder]);

  const moveSlot = (index: number, delta: number) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= selectedSlotOrder.length) return;
    setSelectedSlotOrder(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };
  const reorderSlots = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setSelectedSlotOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const removeSlot = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const toggleSelect = (card: CharacterCard) => {
    setSelectedKeys(previous => {
      const next = new Set(previous);
      if (next.has(card.key)) next.delete(card.key); else next.add(card.key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setSelectedSlotOrder([]);
  };

  /** 批量复制：各角色按单卡语义取提示词，英文逗号拼接 */
  const copyAllSelected = async () => {
    if (selectedCards.length === 0) return;
    await navigator.clipboard.writeText(selectedCards.map(cardPromptText).join(', '));
    notify(`已复制 ${selectedCards.length} 个角色提示词`);
  };

  /** 批量导入实验室：自动将选中的多个角色分别填入独立的角色槽位 (CharacterParams[])，
   * 并按选中的角色数量自动均匀分配站位坐标 (X: 0.2 ~ 0.8, Y: 0.5) */
  const importAllSelected = () => {
    if (selectedCards.length === 0) return;
    const count = selectedCards.length;
    
    // 计算站位横坐标：单人居中 0.5；多人均匀分布
    const getSlotX = (index: number, total: number) => {
      if (total <= 1) return 0.5;
      const step = 0.6 / (total - 1);
      return parseFloat((0.2 + index * step).toFixed(2));
    };

    const characters = selectedCards.map((card, idx) => ({
      id: `char-${Date.now()}-${idx}`,
      prompt: cardPromptText(card),
      negativePrompt: card.chain?.negativePrompt || '',
      x: getSlotX(idx, count),
      y: 0.5,
    }));

    const firstChain = selectedCards.find(card => card.chain)?.chain;
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
      prompt: '',
      negativePrompt: firstChain?.negativePrompt || '',
      params: {
        ...(firstChain?.params || DEFAULT_PARAMS),
        characters,
        useCoords: true,
      },
    }));
    clearSelection();
    notify(`已把 ${count} 个角色分配至独立槽位送往实验室`);
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
      // generateImage 返回的是会话级 blob: URL，必须先转存为持久资产再写库，
      // 否则重启后封面失效（数据库只保存 /api/assets/covers/... 地址）。
      const extension = result.blob.type === 'image/jpeg' ? 'jpg' : (result.blob.type.split('/')[1] || 'png');
      const file = new File([result.blob], `character-cover.${extension}`, { type: result.blob.type });
      const upload = await api.uploadFile(file, 'covers');
      URL.revokeObjectURL(result.image);
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
      await db.updateChain(chainId, { previewImage: upload.url });
      await onRefresh();
      notify('角色预览已生成并保存到本地');
    } catch (error) {
      notify(`生成失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setGeneratingKey(null);
    }
  };

  const setDanbooruCover = async (card: CharacterCard, candidate: DanbooruCoverCandidate) => {
    if (card.kind !== 'catalog' || !card.tagName) return;
    try {
      // 先通过本机媒体网关读取原图；失败时不创建/修改任何记录
      const coverDataUrl = await importDanbooruCoverAsDataUrl(candidate.sampleUrl);
      let chainId = card.chain?.id;
      if (!chainId) {
        chainId = await db.createChain(card.chinese || card.tagName, `角色 Tag：${card.tagName}`, undefined, 'character');
        await db.updateChain(chainId, {
          basePrompt: card.tagName,
          negativePrompt: '',
          tags: [CATALOG_MARKER],
          variableValues: { subject: '' },
          params: DEFAULT_PARAMS,
        });
      }
      // Worker 将 data URL 图片复制进项目自己的存储，数据库只保存 /api/assets/covers/... 地址
      await db.updateChain(chainId, { previewImage: coverDataUrl });
      await onRefresh();
      notify(`已将当前热门图设为“${card.name}”的封面`);
    } catch (error) {
      notify(`设置封面失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
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
    setSelectedKeys(previous => {
      const next = new Set(previous);
      next.delete(card.key);
      return next;
    });
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
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
       <WorkspaceToolbar>
         <div className="flex gap-2 md:hidden">
           <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setGachaCards(null); }} placeholder="搜索角色、作品或 Tag" />
           <MobileIconButton label="筛选和抽卡设置" onClick={() => setShowMobileFilters(true)} className="border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><Menu className="h-5 w-5" /></MobileIconButton>
           <ImageTaggerAction notify={notify} />
           <MobileIconButton label={gachaCards ? '再抽一批' : '随机抽卡'} onClick={() => void drawGacha()} className="bg-indigo-600 text-white"><Dice5 className="h-5 w-5" /></MobileIconButton>
         </div>
         <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
             <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setGachaCards(null); }} placeholder="搜索角色、作品、变体或英文 Tag…" containerClassName="min-w-0 flex-1 md:max-w-none" />
             <select
               value={tab}
               onChange={event => { setTab(event.target.value as CharacterTab); setGachaCards(null); }}
               className="h-10 flex-none rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-700 outline-none hover:border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700"
               aria-label="角色范围筛选"
             >
               <option value="all">全部角色</option>
               <option value="catalog">角色 Tag</option>
              <option value="custom">自定义角色</option>
             </select>
             <select
               value={sort}
               disabled={Boolean(gachaCards)}
               onChange={event => setSort(event.target.value as CharacterDictionarySort)}
               className="h-10 flex-none rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-700 outline-none hover:border-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700"
             >
               <option value="popular">{searchTerm.trim() ? '相关性优先 · 热度高' : '热度从高到低'}</option><option value="least">{searchTerm.trim() ? '相关性优先 · 热度低' : '热度从低到高'}</option><option value="name-asc">{searchTerm.trim() ? '相关性优先 · 名称 A → Z' : '名称 A → Z'}</option><option value="name-desc">{searchTerm.trim() ? '相关性优先 · 名称 Z → A' : '名称 Z → A'}</option>
             </select>
             <div className="relative flex flex-none items-center">
               <ToolbarButton
                 onClick={() => void drawGacha()}
                 disabled={isGachaLoading || catalogTotal <= 0}
                 className="!rounded-r-none !border-r-0 !bg-indigo-600 !text-white hover:!bg-indigo-500"
               >
                 {isGachaLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Dice5 className="h-4 w-4" />}
                 {gachaCards ? '再抽一批' : '随机抽卡'}
               </ToolbarButton>
               <IconButton
                 label="抽卡设置"
                 onClick={() => setShowGachaTools(value => !value)}
                 className="!rounded-l-none"
                 aria-expanded={showGachaTools}
                 aria-haspopup="dialog"
               >
                 <ChevronDown className="h-3.5 w-3.5" />
               </IconButton>
               {showGachaTools && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={() => setShowGachaTools(false)} />
                   <div role="dialog" aria-label="随机抽卡设置" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                     <div className="mb-2 text-xs font-bold text-gray-800 dark:text-white">随机抽卡设置</div>
                     <div className="grid grid-cols-2 gap-2">
                       <label className="text-xs text-gray-500 dark:text-gray-400">
                         抽卡范围
                         <select
                           value={gachaMode}
                           onChange={event => setGachaMode(event.target.value as GachaMode)}
                           className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-800 dark:text-white"
                         >
                           <option value="mixed">Tag + 自定义</option>
                           <option value="catalog">只抽角色 Tag</option>
                           <option value="custom">只抽自定义</option>
                         </select>
                       </label>
                       <label className="text-xs text-gray-500 dark:text-gray-400">
                         数量
                         <select
                           value={gachaCount}
                           onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)}
                           className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none dark:border-gray-800 dark:bg-gray-800 dark:text-white"
                         >
                           <option value={6}>6 位</option>
                           <option value={12}>12 位</option>
                           <option value={24}>24 位</option>
                         </select>
                       </label>
                     </div>
                     {gachaCards && (
                       <button
                         type="button"
                         onClick={() => { setGachaCards(null); setShowGachaTools(false); }}
                         className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                       >
                         返回完整目录
                       </button>
                     )}
                   </div>
                 </>
               )}
             </div>
             <IconButton label={showFavOnly ? '显示全部角色' : '只看收藏'} tone={showFavOnly ? 'favorite' : 'neutral'} onClick={() => setShowFavOnly(value => !value)}><Heart className={`h-4 w-4 ${showFavOnly ? 'fill-current' : ''}`} /></IconButton>
             <IconButton label="刷新列表" onClick={() => void onRefresh()} disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
             <ImageTaggerAction notify={notify} />
             <ToolbarButton tone="primary" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" />自定义角色</ToolbarButton>
         </div>
       </WorkspaceToolbar>

       {gachaCards && (
         <GalleryActiveStateBanner
           count={visibleCards.length}
           entityName="角色"
           onDrawAgain={() => void drawGacha()}
           onExit={() => setGachaCards(null)}
           isLoading={isGachaLoading}
         />
       )}

       <MobileBottomSheet open={showMobileFilters} title="角色筛选与抽卡" onClose={() => setShowMobileFilters(false)}>
         <div className="space-y-5">
           <div className="grid grid-cols-2 gap-2">
             <button onClick={() => { setShowMobileFilters(false); setShowCreate(true); }} className="mobile-touch rounded-xl bg-indigo-600 px-3 text-sm font-bold text-white">＋ 新建自定义角色</button>
             {gachaCards && <button onClick={() => { setGachaCards(null); setShowMobileFilters(false); }} className="mobile-touch rounded-xl border border-gray-300 px-3 text-sm dark:border-gray-600">返回目录</button>}
           </div>
           <div><div className="mb-2 text-sm font-bold dark:text-white">显示范围</div><div className="grid grid-cols-3 gap-2">
            {([['all', '全部'], ['catalog', '角色 Tag'], ['custom', '自定义角色']] as [CharacterTab, string][]).map(([value, label]) => <button key={value} onClick={() => { setTab(value); setGachaCards(null); }} className={`mobile-touch rounded-xl px-2 text-xs font-bold ${tab === value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{label}</button>)}
           </div></div>
           <button onClick={() => setShowFavOnly(value => !value)} className={`mobile-touch w-full rounded-xl text-sm font-bold ${showFavOnly ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>★ 只看收藏 {favorites.size > 0 ? `(${favorites.size})` : ''}</button>
           <label className="block text-sm font-bold dark:text-white">排序方式<select value={sort} disabled={Boolean(gachaCards)} onChange={event => setSort(event.target.value as CharacterDictionarySort)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 font-normal dark:border-gray-600 dark:bg-gray-800"><option value="popular">热度从高到低</option><option value="least">热度从低到高</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option></select></label>
           <div className="grid grid-cols-2 gap-3">
             <label className="text-sm font-bold dark:text-white">抽卡范围<select value={gachaMode} onChange={event => setGachaMode(event.target.value as GachaMode)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-600 dark:bg-gray-800"><option value="mixed">Tag + 自定义</option><option value="catalog">只抽角色 Tag</option><option value="custom">只抽自定义</option></select></label>
             <label className="text-sm font-bold dark:text-white">抽卡数量<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-300 bg-white px-2 font-normal dark:border-gray-600 dark:bg-gray-800"><option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option></select></label>
           </div>
           <div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">目录 {catalogTotal.toLocaleString('zh-CN')} · 自定义 {customChains.length} · 当前显示 {visibleCards.length}</div>
         </div>
       </MobileBottomSheet>

      <div ref={scrollRef} onScroll={onScrollRestore} className="relative flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-24">
        <div className="mb-3 hidden items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 md:flex">
          <span>显示 {visibleCards.length.toLocaleString('zh-CN')}</span><span className="opacity-50">·</span><span>目录 {catalogTotal.toLocaleString('zh-CN')}</span><span className="opacity-50">·</span><span>自定义 {customChains.length}</span>
        </div>
        {isLoading && <div className="absolute inset-x-0 top-3 z-20 flex justify-center"><span className="rounded-full bg-gray-900/80 px-4 py-2 text-xs text-white">正在加载角色目录…</span></div>}
        {imageDisplay.layout === 'masonry' ? (
          <ShortestColumnMasonry<CharacterCard>
            items={visibleCards}
            columns={gridColumns}
            getItemKey={(card: CharacterCard) => card.key}
            estimateItemHeight={estimateCharacterCardHeight}
            renderItem={(card: CharacterCard) => renderCharacterCard(card)}
          />
        ) : (
        <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-character-grid`} style={{ ...mobileGalleryStyle(imageDisplay), ...(isMobileViewport ? {} : { '--mobile-gallery-columns': gridColumns }) }}>
          {visibleCards.map(renderCharacterCard)}
        </div>
        )}

        {!searchTerm.trim() && !gachaCards && tab !== 'custom' && !showFavOnly && (
          <div ref={sentinelRef} className="flex min-h-20 items-center justify-center py-6 text-sm text-gray-400">
            {isLoadingMore ? '正在加载更多角色…' : nextPage < pageCount ? <button onClick={() => void loadMore()} className="rounded-full border border-gray-300 px-4 py-2 hover:border-indigo-400 hover:text-indigo-500 dark:border-gray-700">继续向下滚动加载更多</button> : catalogTotal ? '已加载完整角色目录' : null}
          </div>
        )}
        {!isLoading && visibleCards.length === 0 && <div className="py-20 text-center text-gray-400">没有找到符合条件的角色</div>}
      </div>

      {/* 底部悬浮多选操作栏 */}
      <div className={`pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 transition-all duration-300 ${selectedCards.length > 0 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
        <div className="pointer-events-auto relative flex flex-col items-center">
          {showSlotDetail && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSlotDetail(false)} />
              <div role="dialog" aria-label="角色槽位与站位排布" className="absolute bottom-[calc(100%+0.5rem)] z-50 max-h-72 w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-bold text-gray-800 dark:text-white">
                  <span>多角色槽位分配（导入时自动填入实验室各角色槽）</span>
                  <span className="text-[11px] font-normal text-gray-500">支持直接拖拽，也可点 ↑ / ↓ 调整顺序</span>
                </div>
                <div className="space-y-1.5">
                  {selectedCards.map((card, idx) => (
                    <div
                      key={card.key}
                      draggable
                      onDragStart={event => {
                        setDraggingSlotIndex(idx);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(idx));
                      }}
                      onDragEnd={() => setDraggingSlotIndex(null)}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        if (draggingSlotIndex !== null) {
                          reorderSlots(draggingSlotIndex, idx);
                          setDraggingSlotIndex(null);
                        }
                      }}
                      className={`flex cursor-grab active:cursor-grabbing items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-xs transition-colors ${
                        draggingSlotIndex === idx
                          ? 'border-indigo-500 bg-indigo-50/60 opacity-60 dark:bg-indigo-950/40'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 flex-none text-gray-400" />
                        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-600 font-mono text-[10px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <span className="truncate font-bold text-gray-800 dark:text-gray-100">{card.name}</span>
                        {card.tagName && <span className="truncate font-mono text-[10px] text-gray-400">({card.tagName})</span>}
                      </div>
                      <div className="flex flex-none items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveSlot(idx, -1)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-white"
                          title="上移槽位"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === selectedCards.length - 1}
                          onClick={() => moveSlot(idx, 1)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-white"
                          title="下移槽位"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlot(card.key)}
                          className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                          title="移除"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-2.5 shadow-2xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
            <button
              type="button"
              onClick={() => setShowSlotDetail(value => !value)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-400"
              title="点击查看/调整角色槽位顺序"
            >
              <span>已选 <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedCards.length}</span> 个角色</span>
              <SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />
            </button>
            <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              清空
            </button>
            <div className="flex items-center gap-1.5">
              <ToolbarButton
                tone="neutral"
                disabled={selectedCards.length === 0}
                onClick={() => void copyAllSelected()}
                className="!h-8 !px-3 !text-xs"
              >
                复制全部
              </ToolbarButton>
              <ToolbarButton
                tone="primary"
                disabled={selectedCards.length === 0}
                onClick={importAllSelected}
                className="!h-8 !px-3 !text-xs"
              >
                导入实验室
              </ToolbarButton>
            </div>
          </div>
        </div>
      </div>

       {lightbox?.previewImage && (
         <div className="ui-backdrop-enter fixed inset-0 z-[1500] hidden items-center justify-center bg-black/90 p-4 backdrop-blur-sm md:flex" onClick={() => setLightbox(null)}>
          <OriginalImage src={lightbox.previewImage} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={event => event.stopPropagation()} />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded bg-black/65 px-4 py-2 text-center text-sm text-white">{lightbox.name}{lightbox.tagName ? ` · ${lightbox.tagName}` : ''}</div>
          <button onClick={() => setLightbox(null)} className="absolute right-5 top-5 text-3xl text-white">×</button>
        </div>
       )}
       <MobileDetailView open={Boolean(lightbox)} title={lightbox?.name || '角色详情'} subtitle={lightbox?.tagName} onClose={() => setLightbox(null)} footer={lightbox ? <>
         <button onClick={() => void copyCharacter(lightbox)} className="mobile-touch flex-1 rounded-xl bg-gray-200 font-bold text-gray-700 dark:bg-gray-700 dark:text-white">复制</button>
         <button onClick={() => sendToPlayground(lightbox)} className="mobile-touch flex-1 rounded-xl bg-indigo-600 font-bold text-white">导入实验室</button>
       </> : null}>
         {lightbox && <div className="space-y-4 p-3">
           <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30">{lightbox.previewImage ? <OriginalImage src={lightbox.previewImage} alt={lightbox.name} className="w-full object-contain" /> : <div className="flex aspect-[2/3] items-center justify-center text-gray-400">尚未生成预览</div>}</div>
           <div className="rounded-2xl bg-white p-4 text-sm shadow-sm dark:bg-gray-800">
             <div className="font-bold dark:text-white">{lightbox.name}</div>
             {lightbox.tagName && <div className="mt-1 break-all font-mono text-xs text-gray-500">{lightbox.tagName}</div>}
             <div className="mt-3 grid grid-cols-2 gap-2">
               <button disabled={generatingKey === lightbox.key} onClick={() => void generatePreview(lightbox)} className="mobile-touch rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">{generatingKey === lightbox.key ? '生成中…' : '生成预览'}</button>
               {lightbox.kind === 'custom' ? <button onClick={() => { const id = lightbox.chain!.id; setLightbox(null); onSelect(id); }} className="mobile-touch rounded-xl bg-gray-100 dark:bg-gray-700">编辑还原</button> : <a href={getDanbooruPostsUrl(lightbox.tagName || '')} target="_blank" rel="noreferrer" className="mobile-touch flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40">Danbooru</a>}
             </div>
             {lightbox.kind === 'custom' && <button onClick={() => void deleteCustom(lightbox)} className="mobile-touch mt-2 w-full rounded-xl bg-red-50 font-bold text-red-600 dark:bg-red-950/40 dark:text-red-400">删除这个自定义角色</button>}
           </div>
         </div>}
       </MobileDetailView>

      {showCreate && (
        <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="ui-modal-enter w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">新建自定义还原角色</h2>
            <p className="mt-1 text-sm text-gray-500">适合 NovelAI 没有收录角色 Tag，需要手工组合外貌与服装的角色。</p>
            <input autoFocus value={newName} onChange={event => setNewName(event.target.value)} placeholder="角色名称，例如：穆宁雪" className="mt-5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
            <textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="简单描述（可选）" className="mt-3 h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded px-4 py-2 text-sm text-gray-500">取消</button><button onClick={submitCreate} disabled={!newName.trim()} className="rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">创建并编辑</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
