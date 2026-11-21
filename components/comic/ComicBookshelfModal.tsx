import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import type { ComicBook } from '../../services/comic/comicBookshelf';
import { renderComicPageToBlob } from '../../services/comic/comicExporter';
import type { ComicPageDraft } from '../../services/comic/comicTypes';
import { InlineSpinner } from '../DesignSystem';

interface ComicBookshelfModalProps {
  open: boolean;
  books: ComicBook[];
  activeBookId: string;
  activePageId: string;
  syncedToServer: boolean;
  exportingZip: boolean;
  zipProgressText: string;
  onClose: () => void;
  onSelectBook: (bookId: string) => void;
  onSelectPage: (bookId: string, pageId: string) => void;
  onCreateBook: (title: string) => void;
  onRenameBook: (bookId: string, nextTitle: string) => void;
  onDeleteBook: (bookId: string) => void;
  onAddPage: (bookId: string) => void;
  onDuplicatePage: (bookId: string, pageId: string) => void;
  onDeletePage: (bookId: string, pageId: string) => void;
  onReorderPage: (bookId: string, fromIndex: number, toIndex: number) => void;
  onExportBookZip: (book: ComicBook) => void;
}

const PageThumbnail: React.FC<{ page: ComicPageDraft }> = ({ page }) => {
  const aiUrl = page.creationMode === 'ai-page' ? page.aiPage.generatedPageImage?.url : undefined;
  const firstPanelUrl = page.panels.find(p => p.image?.url)?.image?.url;
  if (aiUrl) {
    return <img src={aiUrl} alt={page.title} className="h-full w-full object-cover" />;
  }
  return (
    <svg viewBox={`0 0 ${page.width} ${page.height}`} className="h-full w-full bg-white">
      {page.creationMode === 'ai-page' ? (
        page.aiPage.guidePanels.map(gp => (
          <rect
            key={gp.id}
            x={gp.x * page.width}
            y={gp.y * page.height}
            width={gp.width * page.width}
            height={gp.height * page.height}
            fill="#f8fafc"
            stroke="#6366f1"
            strokeWidth={Math.max(4, page.width * 0.008)}
            strokeDasharray="14 8"
          />
        ))
      ) : (
        page.panels.map(panel => (
          <g key={panel.id}>
            <polygon
              points={panel.points.map(p => `${p.x * page.width},${p.y * page.height}`).join(' ')}
              fill={panel.image?.url ? '#e2e8f0' : (panel.backgroundColor || '#f8fafc')}
              stroke={panel.borderColor || '#111827'}
              strokeWidth={Math.max(4, panel.borderWidth * 1.6)}
            />
          </g>
        ))
      )}
      {firstPanelUrl && page.creationMode === 'manual' && (
        <text
          x={page.width / 2}
          y={page.height - 28}
          textAnchor="middle"
          fontSize={Math.max(24, page.width * 0.04)}
          fontWeight={700}
          fill="#4f46e5"
        >
          {`${page.panels.filter(p => p.image?.url).length}/${page.panels.length}`}
        </text>
      )}
    </svg>
  );
};

export const ComicBookshelfModal: React.FC<ComicBookshelfModalProps> = ({
  open,
  books,
  activeBookId,
  activePageId,
  syncedToServer,
  exportingZip,
  zipProgressText,
  onClose,
  onSelectBook,
  onSelectPage,
  onCreateBook,
  onRenameBook,
  onDeleteBook,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onReorderPage,
  onExportBookZip,
}) => {
  useLanguage();
  const [viewMode, setViewMode] = useState<'shelf' | 'reader'>('shelf');
  const [readerLayout, setReaderLayout] = useState<'scroll' | 'single'>('scroll');
  const [readerIndex, setReaderIndex] = useState(0);
  const [readerUrls, setReaderUrls] = useState<string[]>([]);
  const [renderingReader, setRenderingReader] = useState(false);

  const [creatingBook, setCreatingBook] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [renamingBookId, setRenamingBookId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggingPageIndex, setDraggingPageIndex] = useState<number | null>(null);

  const selectedBook = books.find(b => b.id === activeBookId) || books[0];

  // 切换到连续阅读器时，按原画幅合成每一页预览图（含所有气泡、文字、贴纸与手绘层）
  useEffect(() => {
    if (!open || viewMode !== 'reader' || !selectedBook) return;
    let cancelled = false;
    const createdUrls: string[] = [];
    setRenderingReader(true);
    (async () => {
      try {
        for (const page of selectedBook.pages) {
          if (cancelled) break;
          const blob = await renderComicPageToBlob(page);
          createdUrls.push(URL.createObjectURL(blob));
        }
        if (!cancelled) setReaderUrls(createdUrls);
      } catch {
        if (!cancelled) setReaderUrls([]);
      } finally {
        if (!cancelled) setRenderingReader(false);
      }
    })();
    return () => {
      cancelled = true;
      createdUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [open, viewMode, selectedBook]);

  // 单页阅读模式支持左右方向键翻页与 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (viewMode === 'reader') setViewMode('shelf');
        else onClose();
      } else if (viewMode === 'reader' && readerLayout === 'single' && selectedBook) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          setReaderIndex(idx => Math.min(selectedBook.pages.length - 1, idx + 1));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          setReaderIndex(idx => Math.max(0, idx - 1));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, viewMode, readerLayout, selectedBook, onClose]);

  if (!open || !selectedBook) return null;

  const submitCreateBook = () => {
    const clean = newBookTitle.trim();
    if (!clean) return;
    onCreateBook(clean);
    setNewBookTitle('');
    setCreatingBook(false);
  };

  const submitRename = (bookId: string) => {
    const clean = renameDraft.trim();
    if (clean) onRenameBook(bookId, clean);
    setRenamingBookId(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('漫画书架与整话阅读')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs md:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* 弹窗顶栏 */}
        <div className="flex flex-none items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-4.5 w-4.5 text-indigo-500" />
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {viewMode === 'reader' ? `${t('整话阅读')} · ${selectedBook.title}` : t('漫画书架')}
            </h2>
            <span className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${syncedToServer ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${syncedToServer ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {syncedToServer ? t('D1 已同步 · 回收站引用受保护') : t('本地暂存（重启后端后自动同步 D1）')}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {viewMode === 'reader' ? (
              <>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
                  <button
                    type="button"
                    onClick={() => setReaderLayout('scroll')}
                    className={`rounded-md px-2 py-1 font-semibold ${readerLayout === 'scroll' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    {t('连续条漫')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReaderLayout('single')}
                    className={`rounded-md px-2 py-1 font-semibold ${readerLayout === 'single' ? 'bg-white text-indigo-600 shadow-xs dark:bg-gray-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    {t('单页翻阅')}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setViewMode('shelf')}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> {t('返回书架')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { setReaderIndex(0); setViewMode('reader'); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <Eye className="h-3.5 w-3.5 text-indigo-500" /> {t('整话连续阅读')}
                </button>
                <button
                  type="button"
                  disabled={exportingZip}
                  onClick={() => onExportBookZip(selectedBook)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {exportingZip ? <InlineSpinner className="h-3.5 w-3.5 text-white" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{exportingZip ? (zipProgressText || t('打包中…')) : t('整话打包导出 ZIP')}</span>
                </button>
              </>
            )}

            <button
              type="button"
              aria-label={t('关闭书架')}
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 主内容区：书架两栏 vs 整话连续阅读器 */}
        {viewMode === 'shelf' ? (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* 左栏：作品 / 话列表 */}
            <div className="flex w-full flex-none flex-col border-b border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40 md:w-64 md:border-r md:border-b-0">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{t('作品 / 话')} ({books.length})</span>
                <button
                  type="button"
                  onClick={() => setCreatingBook(open => !open)}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-900 dark:bg-gray-800 dark:text-indigo-300"
                >
                  <FolderPlus className="h-3 w-3" /> {t('新建作品')}
                </button>
              </div>

              {creatingBook && (
                <div className="mb-2 flex items-center gap-1 rounded-lg border border-indigo-300 bg-white p-1.5 dark:border-indigo-700 dark:bg-gray-900">
                  <input
                    type="text"
                    autoFocus
                    aria-label={t('新作品名称')}
                    value={newBookTitle}
                    onChange={e => setNewBookTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitCreateBook(); }}
                    placeholder={t('例如：第 1 话 雨中重逢')}
                    className="min-w-0 flex-1 bg-transparent px-1 text-xs text-gray-800 outline-none dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={submitCreateBook}
                    className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                  >
                    {t('创建')}
                  </button>
                </div>
              )}

              <div className="flex-1 space-y-1 overflow-y-auto">
                {books.map(book => {
                  const isActive = book.id === selectedBook.id;
                  const isRenaming = renamingBookId === book.id;
                  return (
                    <div
                      key={book.id}
                      className={`group flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs transition ${isActive ? 'border-indigo-500 bg-indigo-50/80 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-transparent bg-white/80 text-gray-700 hover:border-gray-200 dark:bg-gray-900/60 dark:text-gray-200 dark:hover:border-gray-700'}`}
                    >
                      {isRenaming ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            onChange={e => setRenameDraft(e.target.value)}
                            onBlur={() => submitRename(book.id)}
                            onKeyDown={e => { if (e.key === 'Enter') submitRename(book.id); }}
                            className="min-w-0 flex-1 rounded border border-indigo-400 bg-white px-1.5 py-0.5 text-xs text-gray-900 outline-none dark:bg-gray-800 dark:text-white"
                          />
                          <button type="button" onClick={() => submitRename(book.id)} className="text-indigo-600"><Check className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelectBook(book.id)}
                            className="flex min-w-0 flex-1 flex-col text-left"
                          >
                            <span className="truncate font-semibold">{book.title}</span>
                            <span className="text-[10px] text-gray-400">{t('共 {0} 页', [book.pages.length])}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={t('重命名作品 {0}', [book.title])}
                            onClick={() => { setRenamingBookId(book.id); setRenameDraft(book.title); }}
                            className="rounded p-1 text-gray-400 opacity-0 transition hover:text-indigo-600 group-hover:opacity-100"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {books.length > 1 && (
                            <button
                              type="button"
                              aria-label={t('删除作品 {0}', [book.title])}
                              onClick={() => onDeleteBook(book.id)}
                              className="rounded p-1 text-gray-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右栏：本话页序网格（支持拖拽排页、新增、复制、删除与点击编辑） */}
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{selectedBook.title}</h3>
                  <p className="text-[11px] text-gray-400">{t('共 {0} 页 · 可拖拽卡片调整页序，点击卡片立即进入编辑', [selectedBook.pages.length])}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onAddPage(selectedBook.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                >
                  <Plus className="h-3.5 w-3.5" /> {t('新增一页')}
                </button>
              </div>

              <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                {selectedBook.pages.map((page, index) => {
                  const isCurrent = selectedBook.id === activeBookId && page.id === activePageId;
                  return (
                    <div
                      key={page.id}
                      draggable
                      onDragStart={() => setDraggingPageIndex(index)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => {
                        if (draggingPageIndex !== null && draggingPageIndex !== index) {
                          onReorderPage(selectedBook.id, draggingPageIndex, index);
                        }
                        setDraggingPageIndex(null);
                      }}
                      className={`group flex flex-col overflow-hidden rounded-xl border bg-white transition dark:bg-gray-800/70 ${isCurrent ? 'border-indigo-500 ring-2 ring-indigo-500/25' : 'border-gray-200 hover:border-indigo-300 dark:border-gray-700'}`}
                    >
                      <button
                        type="button"
                        onClick={() => { onSelectPage(selectedBook.id, page.id); onClose(); }}
                        className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100 dark:bg-gray-900"
                      >
                        <PageThumbnail page={page} />
                        <span className="absolute top-2 left-2 rounded-md bg-gray-900/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          P{String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="absolute top-2 right-2 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-900/85 dark:text-gray-200">
                          {page.creationMode === 'ai-page' ? t('AI 整页') : t('手动逐格')}
                        </span>
                        {isCurrent && (
                          <span className="absolute right-2 bottom-2 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {t('当前编辑')}
                          </span>
                        )}
                      </button>
                      <div className="flex items-center justify-between gap-1 border-t border-gray-100 px-2 py-1.5 text-xs dark:border-gray-700/80">
                        <span className="min-w-0 flex-1 truncate font-medium text-gray-700 dark:text-gray-200">
                          {page.title || t('第 {0} 页', [index + 1])}
                        </span>
                        <div className="flex flex-none items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={t('前移第 {0} 页', [index + 1])}
                            disabled={index === 0}
                            onClick={() => onReorderPage(selectedBook.id, index, index - 1)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('后移第 {0} 页', [index + 1])}
                            disabled={index === selectedBook.pages.length - 1}
                            onClick={() => onReorderPage(selectedBook.id, index, index + 1)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('复制第 {0} 页', [index + 1])}
                            onClick={() => onDuplicatePage(selectedBook.id, page.id)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {selectedBook.pages.length > 1 && (
                            <button
                              type="button"
                              aria-label={t('删除第 {0} 页', [index + 1])}
                              onClick={() => onDeletePage(selectedBook.id, page.id)}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* 整话连续阅读视图 */
          <div className="flex min-h-0 flex-1 flex-col bg-slate-950">
            {renderingReader ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-slate-300">
                <InlineSpinner className="h-6 w-6 text-indigo-400" />
                <span>{t('正在合成整话高清预览…')}</span>
              </div>
            ) : readerLayout === 'scroll' ? (
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6">
                {selectedBook.pages.map((page, idx) => (
                  <div key={page.id} className="mx-auto flex max-w-3xl flex-col items-center gap-2">
                    <div className="flex w-full items-center justify-between text-xs text-slate-400">
                      <span>P{String(idx + 1).padStart(2, '0')} · {page.title || t('未命名漫画页')}</span>
                      <button
                        type="button"
                        onClick={() => { onSelectPage(selectedBook.id, page.id); onClose(); }}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:border-indigo-400"
                      >
                        <Edit3 className="h-3 w-3" /> {t('编辑此页')}
                      </button>
                    </div>
                    {readerUrls[idx] ? (
                      <img src={readerUrls[idx]} alt={page.title} className="w-full rounded-sm shadow-2xl" />
                    ) : (
                      <div className="flex h-64 w-full items-center justify-center rounded bg-slate-900 text-xs text-slate-500">
                        <Layers className="mr-1.5 h-4 w-4" /> {t('空白漫画页')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-between p-4">
                <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
                  {readerUrls[readerIndex] && (
                    <img
                      src={readerUrls[readerIndex]}
                      alt={selectedBook.pages[readerIndex]?.title || ''}
                      className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
                    />
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-200">
                  <button
                    type="button"
                    disabled={readerIndex <= 0}
                    onClick={() => setReaderIndex(i => Math.max(0, i - 1))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-semibold disabled:opacity-40"
                  >
                    {t('上一页')}
                  </button>
                  <span className="font-mono">{readerIndex + 1} / {selectedBook.pages.length}</span>
                  <button
                    type="button"
                    disabled={readerIndex >= selectedBook.pages.length - 1}
                    onClick={() => setReaderIndex(i => Math.min(selectedBook.pages.length - 1, i + 1))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-semibold disabled:opacity-40"
                  >
                    {t('下一页')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const pg = selectedBook.pages[readerIndex];
                      if (pg) { onSelectPage(selectedBook.id, pg.id); onClose(); }
                    }}
                    className="ml-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> {t('编辑此页')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
