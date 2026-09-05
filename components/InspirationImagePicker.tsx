import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Folder, LoaderCircle, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { db } from '../services/dbService';
import { Inspiration, InspirationBoard } from '../types';
import { SmartImage } from './SmartImage';
import { useModalA11y } from './useModalA11y';

interface InspirationImagePickerProps {
  open: boolean;
  onClose: () => void;
  /** 选中灵感图后回调；importParams 表示是否同时载入该图的提示词与参数（默认仅替换底图）。 */
  onSelect: (item: Inspiration, importParams: boolean) => void;
}

const getImageRatio = (item: Inspiration) => {
  const width = Number(item.params?.width);
  const height = Number(item.params?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 832 / 1216;
};

export const InspirationImagePicker: React.FC<InspirationImagePickerProps> = ({ open, onClose, onSelect }) => {
  const [items, setItems] = useState<Inspiration[]>([]);
  const [boards, setBoards] = useState<InspirationBoard[]>([]);
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [importParams, setImportParams] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [allInspirations, allBoards] = await Promise.all([
        db.getAllInspirations(),
        db.getInspirationBoards(),
      ]);
      setItems(allInspirations.filter(item => !item.archived));
      setBoards(allBoards);
    } catch (loadError) {
      console.error('读取灵感图片失败:', loadError);
      setItems([]);
      setError('灵感库读取失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadData();
  }, [loadData, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const boardNameMap = useMemo(() => new Map(boards.map(b => [b.id, b.name])), [boards]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter(item => {
      if (selectedBoardId === 'unorganized') {
        if (item.boardId) return false;
      } else if (selectedBoardId !== 'all') {
        if (item.boardId !== selectedBoardId) return false;
      }
      if (q) {
        const text = [item.title, item.prompt, item.negativePrompt, item.notes, ...(item.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [items, selectedBoardId, searchQuery]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="选择灵感图片"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-gray-800">
        <header className="flex flex-none items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-900 dark:text-white">选择灵感图片</h2>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-meta font-semibold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                {filteredItems.length} / {items.length} 张
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              从灵感库挑选图片作为底图；勾选「同时导入该图参数」可一并载入提示词与参数。
            </p>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="mobile-touch flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
              aria-label="刷新灵感图片"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mobile-touch flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="关闭灵感图片选择"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* 筛选与搜索工具条 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-950/60 sm:px-5">
          <div className="flex min-w-[12rem] flex-1 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-900">
            <Search className="h-4 w-4 text-gray-400 flex-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索标题、提示词或标签…"
              className="w-full bg-transparent text-xs text-gray-800 outline-none dark:text-gray-100"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setSelectedBoardId('all')}
              className={`flex-none rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                selectedBoardId === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              全部灵感
            </button>
            <button
              type="button"
              onClick={() => setSelectedBoardId('unorganized')}
              className={`flex items-center gap-1 flex-none rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                selectedBoardId === 'unorganized'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              未整理
            </button>
            {boards.map(board => (
              <button
                key={board.id}
                type="button"
                onClick={() => setSelectedBoardId(board.id)}
                className={`flex items-center gap-1.5 flex-none rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  selectedBoardId === board.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: board.color || '#6366f1' }} />
                <span className="truncate max-w-[8rem]">{board.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 灵感网格 */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 dark:bg-gray-950/40 sm:p-4">
          {loading && items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <LoaderCircle className="h-5 w-5 animate-spin" />正在读取灵感库…
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-red-500">
              <span>{error}</span>
              <button type="button" onClick={() => void loadData()} className="rounded-lg bg-red-50 px-3 py-2 font-semibold hover:bg-red-100 dark:bg-red-950/30">
                重新读取
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              <Folder className="h-8 w-8 text-gray-300 dark:text-gray-700 mb-1" />
              <span>没有找到匹配的灵感图片</span>
              {items.length === 0 && <span className="text-micro text-gray-400">可在灵感库中收藏或上传图片</span>}
            </div>
          ) : (
            <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item, importParams)}
                  className="group min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600 dark:hover:ring-indigo-900/50"
                  aria-label={`选择灵感图片：${item.title}`}
                >
                  <div className="w-full overflow-hidden bg-gray-100 dark:bg-gray-950" style={{ aspectRatio: getImageRatio(item) }}>
                    <SmartImage
                      src={item.imageUrl}
                      thumbnailVariant="thumb-320"
                      alt={item.title}
                      className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
                    />
                  </div>
                  <div className="border-t border-gray-100 p-2 text-left dark:border-gray-700">
                    <div className="truncate text-xs font-bold text-gray-900 dark:text-white">{item.title}</div>
                    <div className="mt-0.5 flex items-center justify-between text-meta text-gray-400">
                      <span className="truncate">{item.boardId ? (boardNameMap.get(item.boardId) || '未分类') : '未整理'}</span>
                      {item.params?.width && item.params?.height && (
                        <span className="flex-none font-mono text-micro">{item.params.width}×{item.params.height}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作条 */}
        <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer" title="开启后同时载入该灵感的提示词与生成参数">
            <input
              type="checkbox"
              checked={importParams}
              onChange={event => setImportParams(event.target.checked)}
              className="h-4 w-4 accent-indigo-500 rounded"
            />
            同时导入该图提示词与参数
          </label>
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            取消
          </button>
        </footer>
      </section>
    </div>
  );
};
