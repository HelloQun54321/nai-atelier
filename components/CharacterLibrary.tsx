import { useImageRatios } from './useImageRatios';
import { appearanceScrollBehavior } from '../services/appearancePreferences';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NAIParams, PromptChain } from '../types';
import { compilePrompt } from '../services/promptUtils';
import { compareLibraryTags } from '../services/tagLibrary';
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
import { MobileDetailView } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { Check, ChevronDown, Dice5, LoaderCircle, Plus, Tag, UserRound } from 'lucide-react';
import { ToolbarButton, ToolbarSearch, WorkspaceToolbar, EmptyState } from './DesignSystem';
import { useModalA11y } from './useModalA11y';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { DanbooruCover } from './DanbooruCover';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';
import { TagSelectionBar } from './TagSelectionBar';
import { TagCoverActions } from './TagCoverActions';
import { useRestoreListAnchor } from './useRestoreListAnchor';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { ChainInfoModal, UpdateChainInfo } from './chain/ChainInfoModal';

const CATALOG_MARKER = '__character_catalog__';
const getDanbooruPostsUrl = (tagName: string) =>
  `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(tagName.trim().replace(/\s+/g, '_'))}`;
const DEFAULT_PARAMS: NAIParams = {
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
  onUpdateChain: UpdateChainInfo;
  onDelete: (id: string) => Promise<void> | void;
  onNavigateToPlayground: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  returnTargetId?: string;
}

const LazyImage = SmartImage;

export const CharacterLibrary: React.FC<CharacterLibraryProps> = ({
  chains,
  onCreate,
  onSelect,
  onUpdateChain,
  onDelete,
  onNavigateToPlayground,
  notify,
  returnTargetId,
}) => {
  const imageDisplay = useMobileImageDisplayPreferences();
    // 瀑布流（masonry 布局时）：封面按真实宽高比完整显示，最短列分配互相补齐。
    const [cardRatios, updateImageRatio] = useImageRatios();
    const estimateCharacterCardHeight = React.useCallback((card: CharacterCard, columnWidth: number) => {
      const ratio = cardRatios[card.key] || 2 / 3;
      const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, ratio);
      return imageHeight + 82; // 名称 + tagName/描述文本区
    }, [cardRatios]);
    const renderCharacterCard = (card: CharacterCard) => {
            const favorite = favorites.has(card.key);
            const selected = selectedKeys.has(card.key);
            return (
              <article key={card.key} data-safe-mode-work="true" data-return-item-id={card.kind === 'custom' ? card.chain?.id : undefined} role="button" data-agent-action="select" aria-label={`选择角色：${card.name}`} tabIndex={0} onClick={() => toggleSelect(card)} onKeyDown={event => {
                if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault(); toggleSelect(card);
              }} aria-pressed={selected} className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-2xl border bg-white transition-colors cursor-pointer dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-indigo-400 dark:border-gray-800 dark:hover:border-indigo-600'}`}>
                <div className="mobile-gallery-frame relative md:aspect-[2/3] overflow-hidden bg-gray-200 dark:bg-gray-900" style={{ '--mobile-image-ratio': cardRatios[card.key] ? `${Math.round(cardRatios[card.key] * 1000)} / 1000` : '2 / 3' } as React.CSSProperties}>
                  {card.kind === 'catalog' && card.tagName ? <DanbooruCover tag={card.tagName} kind="character" alt={card.name} fixedSrc={card.previewImage} onImageLoad={(width, height) => updateImageRatio(card.key, width, height)} /> : card.previewImage ? <button className="h-full w-full" onClick={event => { event.stopPropagation(); setLightbox(card); }}><LazyImage src={card.previewImage} alt={card.name} onLoad={event => updateImageRatio(card.key, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /></button> : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center text-gray-400">
                      {card.kind === 'catalog' ? <Tag className="h-8 w-8" /> : <UserRound className="h-8 w-8" />}
                      <span className="mt-2 text-meta">暂无封面</span>
                    </div>
                  )}
                  <TagCoverActions favorite={favorite} onToggleFavorite={() => toggleFavorite(card)} onEditInfo={card.kind === 'custom' && card.chain ? () => setInfoChain(card.chain!) : undefined} />
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
                      <span className="flex-none rounded bg-indigo-50 px-1.5 py-0.5 text-micro font-semibold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">自定义</span>
                    ) : (
                      <span className="flex-none rounded bg-gray-100 px-1.5 py-0.5 text-micro font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Tag 词库</span>
                    )}
                  </div>
                  {card.kind === 'catalog' ? <>
                    <div data-safe-mode-title="true" className="mt-0.5 truncate font-mono text-micro text-gray-400" title={card.tagName}>{card.tagName}</div>
                    <div className="mt-1 flex items-center justify-between gap-1 text-micro">
                      <span className="text-gray-500">作品 {(card.postCount || 0).toLocaleString('zh-CN')}</span>
                      {card.matchReason && <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-700 dark:text-gray-300" title={`匹配：${card.matchReason}`}>匹配：{card.matchReason}</span>}
                    </div>
                  </> : (
                    <div className="mt-1 flex items-center justify-between gap-1.5 text-micro">
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
  const [infoChain, setInfoChain] = useState<PromptChain | null>(null);
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
  const gridColumns = useMasonryColumnCount(imageDisplay, 6);
  const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [lightbox, setLightbox] = useState<CharacterCard | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  // P2-17：新建角色模态的焦点管理（移入 / Tab 圈禁 / 关闭后归还）；
  // 移动详情层的焦点管理已内置在 MobileDetailView 内。
  const createDialogRef = useModalA11y<HTMLDivElement>(showCreate);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const catalogGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const recentGachaRef = useRef<number[][]>([]);
  const gachaGenerationRef = useRef(0);
  const leaveGacha = useCallback(() => {
      gachaGenerationRef.current++;
      setGachaCards(null);
      setIsGachaLoading(false);
  }, []);
  useEffect(() => () => { gachaGenerationRef.current++; }, []);
  // 无限加载失败的时间戳：失败后 300ms 内挡住哨兵的立即重触发，避免静默失败循环。
  const lastLoadMoreErrorAtRef = useRef(0);

  // 新建角色 / 图片灯箱等模态：Esc 关闭。新建表单内没有依赖 Esc 取消的中间状态，
  // 直接关闭即可；灯箱同理。
  useEffect(() => {
    if (!showCreate && !lightbox) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showCreate) { setShowCreate(false); return; }
      setLightbox(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreate, lightbox]);

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
    localStorage.setItem('nai_character_sort', sort);
    const generation = ++catalogGenerationRef.current;
    setIsLoading(true);
    setLoadedCatalog([]);
    setNextPage(0);
    setPageCount(0);
    leaveGacha();
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
    // 失败后 300ms 内防抖：哨兵仍在视口内会立即再次触发，失败静默会变成无限重试循环。
    if (Date.now() - lastLoadMoreErrorAtRef.current < 300) return;
    const generation = catalogGenerationRef.current;
    setIsLoadingMore(true);
    try {
      const result = await getCharacterDictionaryPage(nextPage, sort);
      if (generation !== catalogGenerationRef.current) return;
      setLoadedCatalog(previous => [...previous, ...result.entries]);
      setNextPage(result.page + 1);
    } catch (error) {
      // 失败也要对用户可见，而不是由哨兵在后台静默反复重试。
      lastLoadMoreErrorAtRef.current = Date.now();
      notify('加载更多角色失败，请稍后重试', 'error');
      console.warn('Character tag catalog loadMore failed:', error);
    } finally {
      if (generation === catalogGenerationRef.current) setIsLoadingMore(false);
    }
  }, [gachaCards, isLoadingMore, nextPage, pageCount, searchTerm, sort, notify]);

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
    if (gachaCards) return gachaCards.flatMap(card => {
      if (card.kind !== 'custom') return [card];
      const current = customChains.find(chain => chain.id === card.chain?.id);
      return current ? [customToCard(current)] : [];
    });
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
      return cards.sort((left, right) => compareLibraryTags(left, right, sort));
    }
    const catalog = (query ? searchResults : loadedCatalog).map(catalogToCard);
    const custom = customChains
      .filter(chain => !query || chain.name.toLowerCase().includes(query) || chain.basePrompt.toLowerCase().includes(query))
      .map(customToCard)
      .sort((left, right) => compareLibraryTags(left, right, sort));
    let cards = tab === 'catalog' ? catalog : tab === 'custom' ? custom : [...custom, ...catalog];
    if (showFavOnly) cards = cards.filter(card => favorites.has(card.key));
    return cards;
  }, [catalogToCard, customChains, customToCard, favoriteDetails, favorites, gachaCards, loadedCatalog, persistedCatalog, searchResults, searchTerm, showFavOnly, sort, tab]);
  useRestoreListAnchor(scrollRef, returnTargetId, `${visibleCards.length}:${isLoading ? 1 : 0}`);
  const onScrollRestore = useKeepAliveScrollRestore(scrollRef, 'characters');

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
    return [...selectedKeys].map(k => cardMap.get(k)).filter((c): c is CharacterCard => Boolean(c));
  }, [customChains, persistedCatalog, selectedKeys]);

  const toggleSelect = (card: CharacterCard) => {
    setSelectedKeys(previous => {
      const next = new Set(previous);
      if (next.has(card.key)) next.delete(card.key); else next.add(card.key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
  };

  /** 批量复制：各角色按单卡语义取提示词，英文逗号拼接 */
  const copyAllSelected = async () => {
    if (selectedCards.length === 0) return;
    await navigator.clipboard.writeText(selectedCards.map(cardPromptText).join(', '));
    notify(`已复制 ${selectedCards.length} 个角色提示词`);
  };

  /** 选中角色送往独立槽位，默认交给 AI 构图；手动站位在实验室设置。 */
  const importAllSelected = () => {
    if (selectedCards.length === 0) return;
    const count = selectedCards.length;
    const characters = selectedCards.map((card, idx) => ({
      id: `char-${Date.now()}-${idx}`,
      prompt: cardPromptText(card),
      negativePrompt: card.chain?.negativePrompt || '',
      x: 0.5,
      y: 0.5,
    }));

    const firstChain = selectedCards.find(card => card.chain)?.chain;
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({
      prompt: '',
      negativePrompt: firstChain?.negativePrompt || '',
      params: {
        ...(firstChain?.params || DEFAULT_PARAMS),
        characters,
        useCoords: false,
      },
    }));
    clearSelection();
    notify(`已把 ${count} 个角色分配至独立槽位送往实验室`);
    onNavigateToPlayground();
  };
  const drawIndex = (total: number) => Math.random() < 0.7
    ? Math.floor(Math.random() * Math.min(total, 20_000))
    : Math.floor(Math.random() * total);

  const drawGacha = async () => {
    if (isGachaLoading || (gachaMode !== 'custom' && catalogTotal <= 0)) return;
    if (gachaMode === 'custom' && customChains.length === 0) {
      notify('还没有自定义还原角色', 'error');
      return;
    }
    const generation = ++gachaGenerationRef.current;
    setIsGachaLoading(true);
    setSearchTerm('');
    setShowFavOnly(false);
    setTab('all');
    localStorage.setItem('nai_character_gacha_mode', gachaMode);
    localStorage.setItem('nai_character_gacha_count', String(gachaCount));
    try {
      const customCards = [...customChains].sort(() => Math.random() - 0.5).slice(0, gachaCount).map(customToCard);
      const customTarget = gachaMode === 'custom' ? gachaCount : gachaMode === 'mixed' ? Math.min(customCards.length, Math.max(1, Math.round(gachaCount * 0.25))) : 0;
      const catalogTarget = Math.min(catalogTotal, gachaCount - customTarget);
      const recent = new Set(recentGachaRef.current.flat());
      const indices = new Set<number>();
      let attempts = 0;
      while (indices.size < catalogTarget && attempts++ < 10_000) {
        const index = drawIndex(catalogTotal);
        if (!recent.has(index)) indices.add(index);
      }
      for (let index = 0; indices.size < catalogTarget && index < catalogTotal; index++) indices.add(index);
      const entries = indices.size ? await getCharacterDictionaryEntriesAt([...indices]) : [];
      const cards = [...customCards.slice(0, customTarget), ...entries.map(catalogToCard)].sort(() => Math.random() - 0.5);
      if (generation !== gachaGenerationRef.current) return;
      setGachaCards(cards);
      recentGachaRef.current = [...recentGachaRef.current, [...indices]].slice(-5);
      scrollRef.current?.scrollTo({ top: 0, behavior: appearanceScrollBehavior() });
    } catch (error) {
      if (generation !== gachaGenerationRef.current) return;
      console.warn('Character gacha failed:', error);
      notify('角色抽卡失败', 'error');
    } finally {
      if (generation === gachaGenerationRef.current) setIsGachaLoading(false);
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
       {infoChain && <ChainInfoModal key={infoChain.id} chain={infoChain} onSave={onUpdateChain} onClose={() => setInfoChain(null)} notify={notify} />}
       <WorkspaceToolbar>
         <div className="relative min-w-0 flex-1">
           <ToolbarSearch value={searchTerm} onChange={event => { setSearchTerm(event.target.value); leaveGacha(); }} placeholder="搜索角色、作品或 Tag" containerClassName="md:max-w-none!" className="pr-9" />
           {isLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />}
         </div>
         <ToolbarPopover title="筛选角色" count={Number(tab !== 'all') + Number(sort !== 'popular') + Number(showFavOnly)}>
           <div className="space-y-3">
             <label className="block text-sm font-semibold dark:text-white">显示范围<select aria-label="角色范围" value={tab} onChange={event => { setTab(event.target.value as CharacterTab); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}><option value="all">全部角色</option><option value="catalog">角色 Tag</option><option value="custom">自定义角色</option></select></label>
             <label className="block text-sm font-semibold dark:text-white">排序<select aria-label="角色排序" value={sort} onChange={event => { setSort(event.target.value as CharacterDictionarySort); leaveGacha(); }} className={TOOLBAR_FIELD_CLASS}><option value="popular">{searchTerm.trim() ? '相关性优先 · 热度高' : '热度从高到低'}</option><option value="least">{searchTerm.trim() ? '相关性优先 · 热度低' : '热度从低到高'}</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option></select></label>
             <label className="mobile-touch flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={showFavOnly} onChange={event => { setShowFavOnly(event.target.checked); leaveGacha(); }} />只看收藏</label>
             <button type="button" onClick={() => { setTab('all'); setSort('popular'); setShowFavOnly(false); leaveGacha(); }} className="text-xs font-bold text-indigo-600 dark:text-indigo-300">重置筛选</button>
           </div>
         </ToolbarPopover>
         <div className="flex flex-none items-center border-l border-gray-200 pl-2 dark:border-gray-700">
           <ToolbarButton aria-label={gachaCards ? '再抽一批' : '随机抽卡'} onClick={() => void drawGacha()} disabled={isGachaLoading || (gachaMode === 'custom' ? customChains.length === 0 : catalogTotal <= 0)} className="mobile-touch !rounded-r-none !border-r-0" tone="neutral">{isGachaLoading ? <LoaderCircle className="animate-spin" /> : <Dice5 />}<span className="hidden sm:inline">{gachaCards ? '再抽一批' : '随机抽卡'}</span></ToolbarButton>
           <ToolbarPopover label="抽卡设置" title="角色抽卡设置" icon={<ChevronDown />} className="[&_button[aria-haspopup]]:rounded-l-none [&_button[aria-haspopup]>span]:hidden" width={320}>
             <div className="grid grid-cols-2 gap-3">
               <label className="text-sm font-semibold dark:text-white">抽卡范围<select value={gachaMode} onChange={event => setGachaMode(event.target.value as GachaMode)} className={TOOLBAR_FIELD_CLASS}><option value="mixed">Tag + 自定义</option><option value="catalog">只抽角色 Tag</option><option value="custom">只抽自定义</option></select></label>
               <label className="text-sm font-semibold dark:text-white">数量<select value={gachaCount} onChange={event => setGachaCount(Number(event.target.value) as 6 | 12 | 24)} className={TOOLBAR_FIELD_CLASS}><option value={6}>6 位</option><option value={12}>12 位</option><option value={24}>24 位</option></select></label>
             </div>
           </ToolbarPopover>
         </div>
         <ToolbarButton tone="primary" aria-label="新建自定义角色" onClick={() => setShowCreate(true)} className="mobile-touch !px-2.5 md:!px-3"><Plus /><span className="hidden sm:inline">新建角色</span></ToolbarButton>
       </WorkspaceToolbar>

       {gachaCards && <GalleryActiveStateBanner count={visibleCards.length} entityName="角色" showDrawAgain={false} onDrawAgain={() => void drawGacha()} onExit={() => leaveGacha()} isLoading={isGachaLoading} />}

      <div ref={scrollRef} onScroll={onScrollRestore} className="relative flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-24">
        {imageDisplay.layout === 'masonry' ? (
          <ShortestColumnMasonry<CharacterCard>
            stableColumns
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
        {!isLoading && visibleCards.length === 0 && (
          <EmptyState
            title="没有找到符合条件的角色"
            className="py-20"
            icon={<UserRound className="h-8 w-8" aria-hidden="true" />}
          />
        )}
      </div>

      <TagSelectionBar count={selectedCards.length} unit="个角色" onClear={clearSelection} onCopy={copyAllSelected} onImport={importAllSelected} />

       <ImagePreviewPortal>{lightbox?.previewImage && (
         <div role="dialog" aria-modal="true" aria-label={lightbox.name} className="ui-backdrop-enter fixed inset-0 z-[1500] hidden items-center justify-center bg-black/90 p-4 backdrop-blur-sm md:flex" onClick={() => setLightbox(null)}>
          <OriginalImage src={lightbox.previewImage} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={event => event.stopPropagation()} data-safe-mode-ignore="true" />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded bg-black/65 px-4 py-2 text-center text-sm text-white">{lightbox.name}{lightbox.tagName ? ` · ${lightbox.tagName}` : ''}</div>
          <button onClick={() => setLightbox(null)} className="absolute right-5 top-5 text-3xl text-white">×</button>
        </div>
       )}
       <MobileDetailView open={Boolean(lightbox)} title={lightbox?.name || '角色详情'} subtitle={lightbox?.tagName} onClose={() => setLightbox(null)} sensitiveTitle={Boolean(lightbox)} footer={lightbox ? <>
         <button onClick={() => void copyCharacter(lightbox)} className="mobile-touch flex-1 rounded-xl bg-gray-200 font-bold text-gray-700 dark:bg-gray-700 dark:text-white">复制</button>
         <button onClick={() => sendToPlayground(lightbox)} className="mobile-touch flex-1 rounded-xl bg-indigo-600 font-bold text-white">导入实验室</button>
       </> : null}>
         {lightbox && <div className="space-y-4 p-3">
           <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30">{lightbox.previewImage ? <OriginalImage src={lightbox.previewImage} alt={lightbox.name} className="w-full object-contain" data-safe-mode-ignore="true" /> : <div className="flex aspect-[2/3] items-center justify-center text-gray-400">暂无封面</div>}</div>
           <div className="rounded-2xl bg-white p-4 text-sm shadow-sm dark:bg-gray-800">
             <div className="font-bold dark:text-white">{lightbox.name}</div>
             {lightbox.tagName && <div className="mt-1 break-all font-mono text-xs text-gray-500">{lightbox.tagName}</div>}
             <div className="mt-3 grid grid-cols-2 gap-2">
               {lightbox.kind === 'custom' ? <button onClick={() => { const id = lightbox.chain!.id; setLightbox(null); onSelect(id); }} className="mobile-touch rounded-xl bg-gray-100 dark:bg-gray-700">编辑还原</button> : <a href={getDanbooruPostsUrl(lightbox.tagName || '')} target="_blank" rel="noreferrer" className="mobile-touch flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">Danbooru</a>}
             </div>
             {lightbox.kind === 'custom' && <button onClick={() => void deleteCustom(lightbox)} className="mobile-touch mt-2 w-full rounded-xl bg-red-50 font-bold text-red-600 dark:bg-red-950/40 dark:text-red-400">删除这个自定义角色</button>}
           </div>
         </div>}
       </MobileDetailView></ImagePreviewPortal>

      {showCreate && (<ImagePreviewPortal>
        <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div
            ref={createDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="新建自定义还原角色"
            className="appearance-panel ui-modal-enter w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            onClick={event => event.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">新建自定义还原角色</h2>
            <p className="mt-1 text-sm text-gray-500">适合 NovelAI 没有收录角色 Tag，需要手工组合外貌与服装的角色。</p>
            <input autoFocus value={newName} onChange={event => setNewName(event.target.value)} placeholder="角色名称，例如：穆宁雪" className="mt-5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
            <textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="简单描述（可选）" className="mt-3 h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded px-4 py-2 text-sm text-gray-500">取消</button><button onClick={submitCreate} disabled={!newName.trim()} className="rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">创建并编辑</button></div>
          </div>
        </div>
      </ImagePreviewPortal>)}
    </div>
  );
};
