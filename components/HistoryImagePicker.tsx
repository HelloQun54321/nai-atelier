import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { PAGINATION_CONFIG } from '../config/pagination';
import { localHistory } from '../services/localHistory';
import { LocalGenItem } from '../types';
import { SmartImage } from './SmartImage';

interface HistoryImagePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: LocalGenItem) => void;
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

export const HistoryImagePicker: React.FC<HistoryImagePickerProps> = ({ open, onClose, onSelect }) => {
  const [items, setItems] = useState<LocalGenItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pageSize = PAGINATION_CONFIG.PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const loadPage = useCallback(async (targetPage: number) => {
    const nextPage = Math.max(1, targetPage);
    setLoading(true);
    setError('');
    try {
      const result = await localHistory.getPage(nextPage - 1, pageSize, undefined, true);
      const count = Number(result.count || 0);
      const maxPage = Math.max(1, Math.ceil(count / pageSize));
      if (nextPage > maxPage) {
        setPage(maxPage);
        const lastPage = await localHistory.getPage(maxPage - 1, pageSize, undefined, true);
        setItems(lastPage.items);
        setTotalCount(Number(lastPage.count || count));
      } else {
        setItems(result.items);
        setTotalCount(count);
        setPage(nextPage);
      }
    } catch (loadError) {
      console.error('读取历史图片失败:', loadError);
      setItems([]);
      setError('历史图片读取失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    if (!open) return;
    void loadPage(1);
    const unsubscribe = localHistory.subscribe(() => { void loadPage(1); });
    return unsubscribe;
  }, [loadPage, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="选择历史图片"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
        <header className="flex flex-none items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900 dark:text-white">选择历史图片</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-300">全部 {totalCount} 张</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">数据与历史页面一致；选择后只替换底图，提示词与参数保持不变。</p>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button type="button" onClick={() => void loadPage(page)} disabled={loading} className="mobile-touch flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800" aria-label="刷新历史图片"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
            <button type="button" onClick={onClose} className="mobile-touch flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="关闭历史图片选择"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 dark:bg-gray-950/40 sm:p-4">
          {loading && items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400"><LoaderCircle className="h-5 w-5 animate-spin" />正在读取历史图片…</div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-red-500"><span>{error}</span><button type="button" onClick={() => void loadPage(page)} className="rounded-lg bg-red-50 px-3 py-2 font-semibold hover:bg-red-100 dark:bg-red-950/30">重新读取</button></div>
          ) : items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-gray-500 dark:text-gray-400">历史页面中还没有生成图片</div>
          ) : (
            <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600 dark:hover:ring-indigo-900/50"
                  aria-label={`选择历史生成图片，${new Date(item.createdAt).toLocaleString('zh-CN')}`}
                >
                  <div className="w-full overflow-hidden bg-gray-100 dark:bg-gray-950" style={{ aspectRatio: getImageRatio(item) }}>
                    <SmartImage src={item.imageUrl} thumbnailVariant={HISTORY_THUMBNAIL_VARIANT} alt="历史生成图片" className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]" />
                  </div>
                  <div className="truncate border-t border-gray-100 px-2 py-2 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">{getHistoryTypeLabel(item)} · {new Date(item.createdAt).toLocaleString('zh-CN')}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">第 {page} / {totalPages} 页 · 每页 {pageSize} 张</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void loadPage(page - 1)} disabled={loading || page <= 1} className="mobile-touch flex h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" aria-label="上一页历史图片"><ChevronLeft className="h-4 w-4" />上一页</button>
            <button type="button" onClick={() => void loadPage(page + 1)} disabled={loading || page >= totalPages} className="mobile-touch flex h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" aria-label="下一页历史图片">下一页<ChevronRight className="h-4 w-4" /></button>
          </div>
        </footer>
      </section>
    </div>
  );
};
