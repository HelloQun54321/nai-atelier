import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, FlaskConical, Heart, RefreshCw, Search, X } from 'lucide-react';
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
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';
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
  const lastAppendAtRef = useRef(0);

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
    setLoading(true);
    setError('');
    try {
      const result = await danbooruService.search({ query: nextQuery, page: nextPage, limit: PAGE_SIZE });
      setItems(result.items);
      setHasMore(result.hasMore);
      setQuery(result.query);
      setPage(result.page);
      queryRef.current = result.query;
      pageRef.current = result.page;
      setSelectedId(current => result.items.some(item => item.id === current) ? current : null);
      loadedRef.current = true;
      prewarmSources(result.items.map(item => item.sampleUrl));
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch (loadError) {
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
      const result = await danbooruService.search({ query: beforeQuery, page: beforePage + 1, limit: PAGE_SIZE });
      // 加载期间用户搜索/跳页：丢弃本次结果，避免拼接到错误列表上。
      if (pageRef.current !== beforePage || queryRef.current !== beforeQuery) return;
      setItems(previous => [...previous, ...result.items]);
      setHasMore(result.hasMore);
      setPage(result.page);
      pageRef.current = result.page;
      // 追加页同样预热：否则滚到新页时每张图都要首次抓取，出现“断一下”。
      prewarmSources(result.items.map(item => item.sampleUrl));
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

  // 滚动接近列表底部自动加载下一页（追加模式）；分页器按钮保留作兜底/跳页。
  // 内容不足一屏时不触发；追加后冷却 1.5s，图片加载引起的布局事件不会连发。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !hasMore || loading || items.length >= DANBOORU_APPEND_LIMIT) return;
    const onScroll = () => {
      if (Date.now() - lastAppendAtRef.current < 1500) return;
      if (node.scrollHeight - node.clientHeight <= 80) return;
      // 距底部约一屏就触发追加（1000px），滚动到达时新页已就位；冷却防连发。
      if (node.scrollTop + node.clientHeight >= node.scrollHeight - 1000) {
        lastAppendAtRef.current = Date.now();
        void appendNextPage();
      }
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
    // appendNextPage 闭包随 items/page 重建，无需列入依赖。
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

        <aside className={`aitag-detail-panel ${selected ? 'aitag-detail-panel--open flex' : 'aitag-detail-panel--closed hidden'} fixed inset-0 z-[1050] min-h-0 flex-col border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 xl:static xl:z-auto xl:border-l`}>
          <div className="flex h-14 flex-none items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={closeMobileDetail} className="mobile-touch flex items-center justify-center rounded-xl text-gray-500 xl:hidden" aria-label="返回"><ArrowLeft className="h-5 w-5" /></button>
              <div className="min-w-0"><p className="truncate text-sm font-bold">{selected ? `Danbooru #${selected.id}` : '作品详情'}</p>{selected && <p className="text-[10px] text-gray-500">{selected.width}×{selected.height} · {selected.fileExt.toUpperCase()}</p>}</div>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="hidden h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 xl:flex" aria-label="关闭"><X className="h-4 w-4" /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected ? <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30"><OriginalImage src={selected.sampleUrl} alt={`Danbooru #${selected.id}`} className="max-h-[62vh] w-full object-contain" /></div>
              <div className="grid grid-cols-2 gap-2">
                <ToolbarButton tone="primary" onClick={() => importToPlayground(selected)}><FlaskConical />导入实验室</ToolbarButton>
                <ToolbarButton disabled={saving} onClick={() => void saveToInspiration(selected)}><Heart />{saving ? '保存中…' : '加入灵感'}</ToolbarButton>
                <ToolbarButton onClick={() => void copyPrompt(selected)}><Copy />复制生图 Tag</ToolbarButton>
                <a href={selected.postUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"><ExternalLink className="h-4 w-4" />查看原帖</a>
              </div>
              <div className="flex items-center gap-2">
                <ImageTaggerAction notify={notify} imageUrl={buildMediaUrl(selected.sampleUrl, 'original')} actionLabel="复制 {count} 个 Tag" />
                <span className="text-[11px] text-gray-500">反推当前图片（本地识别）</span>
              </div>
              <button type="button" onClick={() => void copyAll(selected)} className="text-xs font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-300">复制包含元数据的全部 Tag</button>
              {(Object.keys(categoryLabels) as DanbooruTagCategory[]).map(category => selected.tags[category].length > 0 && <section key={category}>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-black text-gray-700 dark:text-gray-200">{categoryLabels[category]} · {selected.tags[category].length}</h3><button type="button" onClick={() => void copyText(selected.tags[category].join(', ')).then(() => notify(`已复制${categoryLabels[category]} Tag`))} className="text-[10px] text-gray-500 hover:text-indigo-500">复制</button></div>
                <div className="flex flex-wrap gap-1.5">{selected.tags[category].map(tag => <button key={tag} type="button" onClick={() => { setInput(tag.replaceAll('_', ' ')); void load(`${tag} order:score`, 1); }} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{tag.replaceAll('_', ' ')}</button>)}</div>
              </section>)}
            </div> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">选择一张作品后查看图片、Tag 和导入操作。</div>}
          </div>
        </aside>
      </div>
    </div>
  );
};
