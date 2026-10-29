import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { PAGINATION_CONFIG } from '../config/pagination';
import { localHistory } from '../services/localHistory';
import { LocalGenItem } from '../types';
import { SmartImage } from './SmartImage';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ToolbarCountCaption } from './ToolbarCountCaption';
import { useGalleryLoadMore } from './useGalleryLoadMore';

interface HistoryImagePickerProps {
  zIndex?: number;
  allowImportParams?: boolean;
  open: boolean;
  onClose: () => void;
  /** 选中历史图后回调；importParams 表示是否同时载入该图的提示词与参数（默认仅替换底图）。 */
  onSelect: (item: LocalGenItem, importParams: boolean) => void;
  /**
   * 只列某个库条目自己生成过的图（来自 `prompt_library_links` 关联）。
   * 之后用这条提示词生成的图会自动出现在这里，方便换封面。
   */
  scopeChainId?: string | null;
}

const HISTORY_THUMBNAIL_VARIANT = 'thumb-960';

const getImageRatio = (item: LocalGenItem) => {
  const width = Number(item.params?.width);
  const height = Number(item.params?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 832 / 1216;
};

const getHistoryTypeLabel = (item: LocalGenItem) => {
  if (!item.edit) return '文生图';
  if (item.edit.operation === 'image-to-image') return '图生图';
  if (item.edit.operation === 'inpaint') return '局部重绘';
  return '扩图';
};

export const HistoryImagePicker: React.FC<HistoryImagePickerProps> = ({ open, onClose, onSelect, scopeChainId = null, zIndex, allowImportParams = true }) => {
  useLanguage();
  const [items, setItems] = useState<LocalGenItem[]>([]);
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const appendCursorRef = useRef({ page: 0, hasMore: false });
  const lastRequestRef = useRef({ page: 1, append: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const pending = loading || !loaded || (!error && loadedScope !== scopeChainId);
  const matchingScope = loadedScope === scopeChainId;
  const [importParams, setImportParams] = useState(false);
  const pageSize = PAGINATION_CONFIG.PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const loadPage = useCallback(async (targetPage: number, append = false) => {
    if (append && (loadingRef.current || !appendCursorRef.current.hasMore || targetPage <= appendCursorRef.current.page)) return;
    const request = ++requestRef.current;
    const nextPage = Math.max(1, targetPage);
    lastRequestRef.current = { page: nextPage, append };
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      if (scopeChainId) {
        // 只看这条库条目自己生成过的图：后续用同一提示词生成的图会自动出现在这里。
        const fetchScoped = async (page: number) => {
          const offset = (page - 1) * pageSize;
          const response = await fetch(`/api/prompt-library-links/images?chainId=${encodeURIComponent(scopeChainId)}&limit=${pageSize}&offset=${offset}`);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return await response.json() as { items?: Array<{ id: string; imageUrl?: string; createdAt?: number; prompt?: string; sourceChainName?: string }>; count?: number };
        };
        let target = nextPage;
        let data = await fetchScoped(target);
        const count = Number(data.count || (data.items || []).length);
        const maxPage = Math.max(1, Math.ceil(count / pageSize));
        if (target > maxPage) {
          target = maxPage;
          data = await fetchScoped(target);
        }
        if (request !== requestRef.current) return;
        setLoadedScope(scopeChainId);
        const incoming = (data.items || []).map(row => ({
          id: String(row.id),
          imageUrl: String(row.imageUrl || `/api/local-history/${row.id}/image`),
          createdAt: Number(row.createdAt || 0),
          prompt: String(row.prompt || ''),
          params: {},
        } as unknown as LocalGenItem));
        setItems(previous => append ? [...previous, ...incoming.filter(item => !previous.some(current => current.id === item.id))] : incoming);
        setTotalCount(count);
        setPage(target);
        appendCursorRef.current = { page: target, hasMore: incoming.length > 0 && target < maxPage };
        setHasMore(appendCursorRef.current.hasMore);
        return;
      }
      const result = await localHistory.getPage(nextPage - 1, pageSize, undefined, true);
      if (request !== requestRef.current) return;
      const count = Number(result.count || 0);
      const maxPage = Math.max(1, Math.ceil(count / pageSize));
      if (nextPage > maxPage) {
        setPage(maxPage);
        const lastPage = await localHistory.getPage(maxPage - 1, pageSize, undefined, true);
        if (request !== requestRef.current) return;
        setItems(previous => append ? [...previous, ...lastPage.items.filter(item => !previous.some(current => current.id === item.id))] : lastPage.items);
        setTotalCount(Number(lastPage.count || count));
        appendCursorRef.current = { page: maxPage, hasMore: false };
        setHasMore(false);
      } else {
        setItems(previous => append ? [...previous, ...result.items.filter(item => !previous.some(current => current.id === item.id))] : result.items);
        setTotalCount(count);
        setPage(nextPage);
        appendCursorRef.current = { page: nextPage, hasMore: result.items.length > 0 && nextPage < maxPage };
        setHasMore(appendCursorRef.current.hasMore);
      }
      setLoadedScope(scopeChainId);
    } catch (loadError) {
      console.error('读取历史图片失败:', loadError);
      if (request !== requestRef.current) return;
      setError('历史图片读取失败，请重试。');
    } finally {
      if (request === requestRef.current) { loadingRef.current = false; setLoading(false); setLoaded(true); }
    }
  }, [pageSize, scopeChainId]);

  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    void loadPage(1);
    const unsubscribe = scopeChainId ? undefined : localHistory.subscribe(() => { void loadPage(1); });
    return () => { requestRef.current++; loadingRef.current = false; unsubscribe?.(); };
  }, [loadPage, open, scopeChainId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const retry = () => { const last = lastRequestRef.current; void loadPage(last.page, last.append); };
  useGalleryLoadMore(scrollRef, loadMoreRef, open && !pending && !error && matchingScope && hasMore, () => { void loadPage(page + 1, true); }, '600px 0px', `${scopeChainId}:${page}:${items.length}`);

  if (!open) return null;

  return (
    <ImagePreviewPortal>
    <div
      ref={dialogRef}
      style={{ zIndex }} className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("选择历史图片")}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="operation-dialog flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <header data-toolbar-caption-host="true" className="relative flex flex-none items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900 dark:text-white">{t("选择历史图片")}</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-meta text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {scopeChainId ? t("这条目的生成图 {0} 张", [pending || error ? '—' : totalCount]) : t("全部 {0} 张", [pending || error ? '—' : totalCount])}
              </span>
            </div>
            {scopeChainId ? (
              <p className="mt-1 text-micro text-gray-400">{t("只显示这条提示词自己生成过的图，之后用它的图会自动出现。")}</p>
            ) : null}
          </div>
          <div className="flex flex-none items-center gap-1">
            <button type="button" onClick={onClose} className="mobile-touch flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t("关闭历史图片选择")}><X className="h-5 w-5" /></button>
          </div>
          <ToolbarCountCaption>{t(scopeChainId ? '当前 {0} 张' : '共 {0} 张', [pending || error ? '—' : totalCount])}</ToolbarCountCaption>
        </header>

        <div ref={scrollRef} className="appearance-group min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 dark:bg-gray-950/40 sm:p-4">
          {pending && (!matchingScope || items.length === 0) ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400"><LoaderCircle className="h-5 w-5 animate-spin" />{t("正在读取历史图片…")}</div>
          ) : error && (!matchingScope || items.length === 0) ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-red-500"><span>{t(error)}</span><button type="button" onClick={retry} className="rounded-lg bg-red-50 px-3 py-2 font-semibold hover:bg-red-100 dark:bg-red-950/30">{t("重新读取")}</button></div>
          ) : items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              {scopeChainId ? t("这条提示词还没有生成过的图") : t("历史页面中还没有生成图片")}
            </div>
          ) : (
            <div className="operation-card-grid workspace-card-grid grid items-start gap-3">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item, allowImportParams && importParams)}
                  className="appearance-group group min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600 dark:hover:ring-indigo-900/50"
                  aria-label={t("选择历史生成图片，{0}", [new Date(item.createdAt).toLocaleString(getLanguage())])}
                >
                  <div className="appearance-media w-full overflow-hidden bg-gray-100 dark:bg-gray-950" style={{ aspectRatio: getImageRatio(item) }}>
                    <SmartImage src={item.imageUrl} thumbnailVariant={HISTORY_THUMBNAIL_VARIANT} alt={t("历史生成图片")} className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]" />
                  </div>
                  <div className="truncate border-t border-gray-100 px-2 py-2 text-meta text-gray-600 dark:border-gray-700 dark:text-gray-300">{getHistoryTypeLabel(item)} · {new Date(item.createdAt).toLocaleString(getLanguage())}</div>
                </button>
              ))}
            </div>
          )}
          {pending && matchingScope && items.length > 0 && <p role="status" className="mt-3 text-sm text-gray-500">{t('正在读取历史图片…')}</p>}
          {error && matchingScope && items.length > 0 && <p role="alert" className="mt-3 text-sm text-red-500">{t(error)} <button type="button" onClick={retry} className="underline">{t('重新读取')}</button></p>}
          {matchingScope && items.length > 0 && hasMore && <div ref={loadMoreRef} data-history-picker-load-more="true" aria-hidden="true" className="h-4" />}
        </div>

        <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t("第 {0} / {1} 页 · 每页 {2} 张", [page, totalPages, pageSize])}</span>
          {allowImportParams && <label className={`flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 ${scopeChainId ? 'invisible' : ''}`} title={t("开启后同时载入该图的提示词与生成参数")}>
            <input type="checkbox" checked={importParams} onChange={event => setImportParams(event.target.checked)} className="h-4 w-4 accent-indigo-500" />
            {t("同时导入该图参数")}</label>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void loadPage(page - 1)} disabled={loading || page <= 1} className="appearance-group mobile-touch flex h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" aria-label={t("上一页历史图片")}><ChevronLeft className="h-4 w-4" />{t("上一页")}</button>
            <button type="button" onClick={() => void loadPage(page + 1)} disabled={loading || page >= totalPages} className="appearance-group mobile-touch flex h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" aria-label={t("下一页历史图片")}>{t("下一页")}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </footer>
      </section>
    </div>
    </ImagePreviewPortal>
  );
};
