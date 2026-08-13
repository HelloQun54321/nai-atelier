import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ExternalLink, FlaskConical, Heart, RefreshCw, Search, X } from 'lucide-react';
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
import { OriginalImage, SmartImage } from './SmartImage';

interface DanbooruGalleryProps {
  active: boolean;
  currentUser: User;
  notify: (message: string, type?: 'success' | 'error') => void;
  onNavigateToPlayground: () => void;
  onRefreshInspiration?: () => void;
}

const PAGE_SIZE = 40;
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
  const loadedRef = useRef(false);

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId]);
  const closeMobileDetail = useMobileHistoryLayer(Boolean(selected), () => setSelectedId(null), 'danbooru-detail');

  const load = async (nextQuery = query, nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const result = await danbooruService.search({ query: nextQuery, page: nextPage, limit: PAGE_SIZE });
      setItems(result.items);
      setHasMore(result.hasMore);
      setQuery(result.query);
      setPage(result.page);
      setSelectedId(current => result.items.some(item => item.id === current) ? current : null);
      loadedRef.current = true;
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Danbooru 查询失败';
      setError(message);
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active && !loadedRef.current) void load('order:rank', 1);
  }, [active]);

  // 滚动接近列表底部自动翻下一页；按钮保留作兜底。
  // 用 scroll 事件触发（整页替换模式：IO sentinel 在内容高度不足时会连环翻页）。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !hasMore || loading) return;
    const onScroll = () => {
      // 内容不足一屏（图片未加载时卡片可能很矮）时任何滚动都会触发翻页，先排除。
      if (node.scrollHeight - node.clientHeight <= 80) return;
      if (node.scrollTop + node.clientHeight >= node.scrollHeight - 200) {
        void load(query, page + 1);
      }
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
    // load 闭包随 query/page 重建，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, page, query]);

  const submitSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      const resolved = await resolveDanbooruQuery(input);
      await load(resolved || 'order:rank', 1);
    } catch (searchError) {
      notify(searchError instanceof Error ? searchError.message : '无法识别这个 Tag', 'error');
    }
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
            <span>仅显示 General · 第 {page} 页</span>
          </div>

          {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          {loading && !items.length ? <div className="flex min-h-72 items-center justify-center text-sm text-gray-400">正在读取 Danbooru…</div> : items.length ? (
            <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid`} style={mobileGalleryStyle(imageDisplay)}>
              {items.map(post => {
                const title = post.tags.character[0] || post.tags.artist[0] || `#${post.id}`;
                return <article key={post.id} className={`mobile-gallery-item group relative flex-col overflow-hidden rounded-lg border bg-white transition-colors dark:bg-gray-800 ${selectedId === post.id ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-500'}`}>
                  <button type="button" onClick={() => setSelectedId(post.id)} className="block w-full text-left">
                    <div className="mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': '3 / 4' } as React.CSSProperties}>
                      <SmartImage src={post.sampleUrl} alt={title.replaceAll('_', ' ')} thumbnailVariant="thumb-640" />
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-[10px] text-white">
                        <span>♥ {formatCount(post.favCount)}</span><span>▲ {formatCount(post.score)}</span>
                      </div>
                    </div>
                    <div className="p-2.5"><p className="truncate text-xs font-bold">{title.replaceAll('_', ' ')}</p><p className="mt-1 truncate text-[10px] text-gray-500">{post.tags.artist.slice(0, 2).join(', ').replaceAll('_', ' ') || `Danbooru #${post.id}`}</p></div>
                  </button>
                </article>;
              })}
            </div>
          ) : !loading && <div className="flex min-h-72 flex-col items-center justify-center text-center text-sm text-gray-500"><p className="font-bold">没有找到普通级图片</p><p className="mt-1 text-xs">请检查 Tag 拼写，或减少检索条件。</p></div>}

          <div className="mt-5 flex items-center justify-center gap-3 pb-4">
            <ToolbarButton disabled={loading || page <= 1} onClick={() => void load(query, page - 1)}><ChevronLeft />上一页</ToolbarButton>
            <span className="text-xs font-bold text-gray-500">{page}</span>
            <ToolbarButton disabled={loading || !hasMore} onClick={() => void load(query, page + 1)}>下一页<ChevronRight /></ToolbarButton>
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
