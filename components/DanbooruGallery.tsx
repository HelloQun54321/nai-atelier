import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, FlaskConical, Heart, RefreshCw, Search } from 'lucide-react';
import {
  DanbooruPost,
  DanbooruTagCategory,
  danbooruAllTags,
  danbooruPromptTags,
  danbooruService,
  resolveDanbooruQuery,
} from '../services/danbooruService';
import { db } from '../services/dbService';
import { createUuid } from '../services/id';
import { IMPORT_SESSION_KEY, PendingImportData } from '../services/metadataService';
import { NAIParams, User } from '../types';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { useStaleGuard } from './useStaleGuard';
import { IconButton, ToolbarButton, ToolbarLink, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel, DetailImageStage, TagChipGroup } from './DetailPanel';
import { ImageTaggerAction } from './ImageTaggerPanel';
import { useMobileHistoryLayer } from './MobileUI';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { OriginalImage, SmartImage } from './SmartImage';
import { buildMediaUrl } from '../services/mobileImageCache';

interface DanbooruGalleryProps {
  active: boolean;
  currentUser: User;
  notify: (message: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onRefreshInspiration?: () => void;
}

const PAGE_SIZE = 40;
/** 追加式自动加载的软上限：超过后停止自动追加，按钮可继续手动加载。 */
const DANBOORU_APPEND_LIMIT = 800;
const defaultParams: NAIParams = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
  useCoords: false,
  variety: false,
  cfgRescale: 0,
};

const categoryLabels: Record<DanbooruTagCategory, string> = {
  artist: '画师',
  copyright: '作品',
  character: '角色',
  general: '普通',
  meta: '元数据',
};

const formatCount = (value: number) => new Intl.NumberFormat('zh-CN', {
  notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value);

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

export const DanbooruGallery: React.FC<DanbooruGalleryProps> = ({ active, currentUser, notify, onNavigateToPlayground, onRefreshInspiration }) => {
  const imageDisplay = useMobileImageDisplayPreferences();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('order:rank');
  const [items, setItems] = useState<DanbooruPost[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pageInput, setPageInput] = useState('');
  const loadedRef = useRef(false);
  // 追加模式状态：当前查询/页码的同步镜像（防并发与跳页竞态）。
  const queryRef = useRef(query);
  const pageRef = useRef(page);
  const appendingRef = useRef(false);
  // 非追加 load 的竞态守卫：快速连续搜索/跳页时，慢的旧响应会覆盖新结果——
  // 迟到的响应一律丢弃（组件卸载后同样不再写状态）。
  const loadGuard = useStaleGuard();
  // 下一页投机预取：当前页稳定后后台取下一页 JSON 并立即预热其缩略图，
  // 哨兵触底时直接消费预取结果，把"取 JSON → 再抓图"的串行等待从滚动路径上移走。
  const nextPagePrefetchRef = useRef<{ query: string; page: number; promise: Promise<Awaited<ReturnType<typeof danbooruService.search>> | null> } | null>(null);

  const scheduleNextPagePrefetch = (query: string, page: number, hasMore: boolean) => {
    if (!hasMore) return;
    const existing = nextPagePrefetchRef.current;
    if (existing && existing.query === query && existing.page === page + 1) return;
    const promise = danbooruService.search({ query, page: page + 1, limit: PAGE_SIZE })
      .then(result => {
        prewarmSources(result.items.map(item => item.sampleUrl));
        return result;
      })
      .catch(() => null);
    nextPagePrefetchRef.current = { query, page: page + 1, promise };
  };

  const consumeNextPagePrefetch = (query: string, page: number) => {
    const prefetch = nextPagePrefetchRef.current;
    if (!prefetch || prefetch.query !== query || prefetch.page !== page) return null;
    nextPagePrefetchRef.current = null;
    return prefetch.promise;
  };

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId]);
  const closeMobileDetail = useMobileHistoryLayer(Boolean(selected), () => setSelectedId(null), 'danbooru-detail');

  // 后台预热该批缩略图：滚动时缓存命中，不再等待首次抓取。
  const prewarmSources = (sources: string[]) => {
    const valid = sources.filter(Boolean);
    if (!valid.length) return;
    fetch('/api/media/prewarm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: valid }),
    }).catch(() => {});
  };

  const load = async (nextQuery = query, nextPage = page) => {
    const mySeq = loadGuard.begin();
    setLoading(true);
    setError('');
    try {
      const result = await danbooruService.search({ query: nextQuery, page: nextPage, limit: PAGE_SIZE });
      if (!loadGuard.isCurrent(mySeq)) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setQuery(result.query);
      setPage(result.page);
      queryRef.current = result.query;
      pageRef.current = result.page;
      setSelectedId(current => result.items.some(item => item.id === current) ? current : null);
      loadedRef.current = true;
      prewarmSources(result.items.map(item => item.sampleUrl));
      scheduleNextPagePrefetch(result.query, result.page, result.hasMore);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch (loadError) {
      if (!loadGuard.isCurrent(mySeq)) return;
      const message = loadError instanceof Error ? loadError.message : 'Danbooru 查询失败';
      setError(message);
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // 自动加载：把下一页内容追加到当前列表下方（连续滚动、无切页感）。
  // 与 Pixiv/历史页一致；软上限后停止自动追加，按钮可继续手动加载。
  const appendNextPage = async (force = false) => {
    if (appendingRef.current || loading) return;
    if (!force && items.length >= DANBOORU_APPEND_LIMIT) return;
    const beforePage = pageRef.current;
    const beforeQuery = queryRef.current;
    appendingRef.current = true;
    try {
      // 优先消费投机预取的下一页（预取失败则回退正常请求）
      const prefetched = await consumeNextPagePrefetch(beforeQuery, beforePage + 1);
      const result = prefetched || await danbooruService.search({ query: beforeQuery, page: beforePage + 1, limit: PAGE_SIZE });
      // 加载期间用户搜索/跳页：丢弃本次结果，避免拼接到错误列表上。
      if (pageRef.current !== beforePage || queryRef.current !== beforeQuery) return;
      setItems(previous => [...previous, ...result.items]);
      setHasMore(result.hasMore);
      setPage(result.page);
      pageRef.current = result.page;
      // 追加页同样预热：否则滚到新页时每张图都要首次抓取，出现“断一下”。
      prewarmSources(result.items.map(item => item.sampleUrl));
      scheduleNextPagePrefetch(beforeQuery, result.page, result.hasMore);
    } catch (appendError) {
      const message = appendError instanceof Error ? appendError.message : 'Danbooru 加载失败';
      notify(message, 'error');
    } finally {
      appendingRef.current = false;
    }
  };

  useEffect(() => {
    if (active && !loadedRef.current) void load('order:rank', 1);
  }, [active]);

  // 滚动接近列表底部自动加载下一页（追加模式，与 Pixiv 相同的哨兵机制）：
  // 追加完成后若哨兵仍在视口（用户停在底部/快速滚动）会立即再触发，
  // 实现不间断连续加载；内容增长使哨兵移出视口后自然停止。
  const appendSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = appendSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore || loading || items.length >= DANBOORU_APPEND_LIMIT) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void appendNextPage();
    }, { root, rootMargin: '1200px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // appendNextPage 闭包随 items.length 重建，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, items.length, loading]);

  const submitSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      const resolved = await resolveDanbooruQuery(input);
      await load(resolved || 'order:rank', 1);
    } catch (searchError) {
      notify(searchError instanceof Error ? searchError.message : '无法识别这个 Tag', 'error');
    }
  };

  // 页码跳转（显式跳页工具）：替换为第 N 页，此后滚动从该页继续追加。
  const submitPageJump = (event?: FormEvent) => {
    event?.preventDefault();
    const value = Number(pageInput);
    if (!Number.isFinite(value) || value < 1) {
      notify('请输入有效页码', 'error');
      return;
    }
    setPageInput('');
    void load(query, Math.floor(value));
  };

  // 瀑布流（masonry 布局时）：真实宽高比完整显示，最短列分配互相补齐。
  const masonryColumns = useMasonryColumnCount(imageDisplay);
  const getPostRatio = (post: DanbooruPost) => {
    const ratio = Number(post.width) / Math.max(1, Number(post.height) || 1);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
  };
  const estimateDanbooruCardHeight = React.useCallback((post: DanbooruPost, columnWidth: number) => {
    const imageHeight = Math.max(1, columnWidth) / Math.max(0.1, getPostRatio(post));
    return imageHeight + 52; // 标题 + 作者文本区
  }, []);
  const renderDanbooruCard = (post: DanbooruPost) => {
    const title = post.tags.character[0] || post.tags.artist[0] || `#${post.id}`;
    const ratio = `${post.width || 3} / ${post.height || 4}`;
    return <article key={post.id} className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-lg border bg-white transition-colors dark:bg-gray-800 ${selectedId === post.id ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}>
      <button type="button" onClick={() => setSelectedId(post.id)} className="block w-full text-left">
        <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}>
          <SmartImage src={post.sampleUrl} alt={title.replaceAll('_', ' ')} />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-[10px] text-white">
            <span>♥ {formatCount(post.favCount)}</span><span>▲ {formatCount(post.score)}</span>
          </div>
        </div>
        <div className="p-2.5"><p className="truncate text-xs font-bold">{title.replaceAll('_', ' ')}</p><p className="mt-1 truncate text-[10px] text-gray-500">{post.tags.artist.slice(0, 2).join(', ').replaceAll('_', ' ') || `Danbooru #${post.id}`}</p></div>
      </button>
    </article>;
  };

  const importToPlayground = (post: DanbooruPost) => {
    const prompt = danbooruPromptTags(post);
    const pending: PendingImportData = { prompt, negativePrompt: '', params: defaultParams, mode: 'append-prompt' };
    sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(pending));
    notify('Danbooru Tag 已送往实验室');
    onNavigateToPlayground();
  };

  const saveToInspiration = async (post: DanbooruPost) => {
    if (saving) return;
    setSaving(true);
    try {
      const character = post.tags.character[0]?.replaceAll('_', ' ');
      const artist = post.tags.artist[0]?.replaceAll('_', ' ');
      await db.saveInspiration({
        id: createUuid(),
        userId: currentUser.id,
        username: currentUser.username,
        title: character || artist || `Danbooru #${post.id}`,
        imageUrl: post.sampleUrl,
        prompt: danbooruPromptTags(post),
        tags: ['Danbooru', ...post.tags.character.slice(0, 3), ...post.tags.artist.slice(0, 2)],
        sourceType: 'danbooru',
        sourceId: String(post.id),
        sourceUrl: post.postUrl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onRefreshInspiration?.();
      notify('已加入灵感库');
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyPrompt = async (post: DanbooruPost) => {
    await copyText(danbooruPromptTags(post));
    notify('已复制适合生图的 Tag');
  };

  const copyAll = async (post: DanbooruPost) => {
    await copyText(danbooruAllTags(post).join(', '));
    notify('已复制全部 Danbooru Tag');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-gray-900">
      <WorkspaceToolbar className="relative z-20">
        <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <ToolbarSearch value={input} onChange={event => setInput(event.target.value)} placeholder="中文或英文 Tag；两个条件请用逗号分隔" aria-label="搜索 Danbooru" />
          <ToolbarButton type="submit" tone="primary" disabled={loading}><Search />搜索</ToolbarButton>
        </form>
        <IconButton label="刷新" onClick={() => void load(query, page)} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /></IconButton>
        <ImageTaggerAction notify={notify} />
      </WorkspaceToolbar>

      <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
        <main ref={scrollRef} className={`${selected ? 'hidden xl:block' : 'block'} min-h-0 overflow-y-auto p-3 md:p-5`}>
          <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
            <span>{query === 'order:rank' ? '热门普通级作品' : `检索：${query.replaceAll('_', ' ')}`}</span>
            <span>仅显示 General · 已加载 {items.length} 件{hasMore ? ' · 滚动继续加载' : ' · 已全部加载'}</span>
          </div>

          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          {loading && !items.length ? <div className="flex min-h-72 items-center justify-center text-sm text-gray-400">正在读取 Danbooru…</div> : items.length ? (
            imageDisplay.layout === 'masonry' ? (
              <ShortestColumnMasonry
                items={items}
                columns={masonryColumns}
                getItemKey={post => String(post.id)}
                estimateItemHeight={estimateDanbooruCardHeight}
                renderItem={renderDanbooruCard}
              />
            ) : (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {items.map(renderDanbooruCard)}
            </div>
            )
          ) : !loading && <div className="flex min-h-72 flex-col items-center justify-center text-center text-sm text-gray-500"><p className="font-bold">没有找到普通级图片</p><p className="mt-1 text-xs">请检查 Tag 拼写，或减少检索条件。</p></div>}

          <div className="mt-5 flex flex-col items-center gap-3 pb-4">
            <div ref={appendSentinelRef} className="h-1 w-full" aria-hidden="true" />
            {items.length >= DANBOORU_APPEND_LIMIT && hasMore && (
              <ToolbarButton onClick={() => void appendNextPage(true)}><RefreshCw className={appendingRef.current ? 'animate-spin' : ''} />已加载 {DANBOORU_APPEND_LIMIT} 件 · 继续加载更多</ToolbarButton>
            )}
            <form onSubmit={submitPageJump} className="flex items-center gap-2 text-xs text-gray-500">
              <span>滚动浏览 · 跳到第</span>
              <input
                type="number"
                min={1}
                value={pageInput}
                onChange={event => setPageInput(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                aria-label="输入页码跳转"
                className="h-9 w-16 rounded-lg border border-indigo-200 bg-white px-2 text-center text-sm font-bold text-indigo-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-indigo-900/60 dark:bg-gray-800 dark:text-indigo-300"
              />
              <span>页</span>
              <ToolbarButton type="submit" disabled={loading}>跳转</ToolbarButton>
            </form>
          </div>
        </main>

        <DetailSidePanel
          open={Boolean(selected)}
          title={selected ? `Danbooru #${selected.id}` : '作品详情'}
          subInfo={selected ? `${selected.width}×${selected.height} · ${selected.fileExt.toUpperCase()}` : undefined}
          onBack={closeMobileDetail}
          onClose={() => setSelectedId(null)}
        >
          {selected ? <div className="space-y-4">
            <DetailImageStage>
              <OriginalImage src={selected.sampleUrl} alt={`Danbooru #${selected.id}`} className="max-h-[62vh] w-full object-contain" />
            </DetailImageStage>
            <div className="grid grid-cols-2 gap-2">
              <ToolbarButton tone="primary" onClick={() => importToPlayground(selected)}><FlaskConical />导入实验室</ToolbarButton>
              <ToolbarButton disabled={saving} onClick={() => void saveToInspiration(selected)}><Heart />{saving ? '保存中…' : '加入灵感'}</ToolbarButton>
              <ToolbarButton onClick={() => void copyPrompt(selected)}><Copy />复制生图 Tag</ToolbarButton>
              <ToolbarLink href={selected.postUrl} target="_blank" rel="noreferrer"><ExternalLink />查看原帖</ToolbarLink>
            </div>
            <div className="flex items-center gap-2">
              <ImageTaggerAction notify={notify} imageUrl={buildMediaUrl(selected.sampleUrl, 'original')} actionLabel="复制 {count} 个 Tag" />
              <span className="text-[11px] text-gray-500">反推当前图片（本地识别）</span>
            </div>
            <button type="button" onClick={() => void copyAll(selected)} className="text-xs font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-300">复制包含元数据的全部 Tag</button>
            {(Object.keys(categoryLabels) as DanbooruTagCategory[]).map(category => selected.tags[category].length > 0 && <section key={category}>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-black text-gray-700 dark:text-gray-200">{categoryLabels[category]} · {selected.tags[category].length}</h3><button type="button" onClick={() => void copyText(selected.tags[category].join(', ')).then(() => notify(`已复制${categoryLabels[category]} Tag`))} className="text-[10px] text-gray-500 hover:text-indigo-500">复制</button></div>
              <TagChipGroup chips={selected.tags[category].map(tag => ({ label: tag.replaceAll('_', ' '), onClick: () => { setInput(tag.replaceAll('_', ' ')); void load(`${tag} order:score`, 1); } }))} />
            </section>)}
          </div> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">选择一张作品后查看图片、Tag 和导入操作。</div>}
        </DetailSidePanel>
      </div>
    </div>
  );
};
