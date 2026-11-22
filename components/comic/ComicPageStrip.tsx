import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Copy,
  Maximize2,
  PanelLeftClose,
  Plus,
  Trash2,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import type { ComicBook } from '../../services/comic/comicBookshelf';
import type { ComicPageDraft } from '../../services/comic/comicTypes';
import { ImageCardActions } from '../ImageCardActions';
import { IMAGE_CARD_ACTION_CLASS } from '../ImageShareActions';
import { ImageLightbox } from '../ImageLightbox';
import { PressRevealSurface } from '../PressRevealSurface';

interface ComicPageStripProps {
  book?: ComicBook;
  activePageId: string;
  notify?: (message: string, type?: 'success' | 'error') => void;
  onSelectPage: (bookId: string, pageId: string) => void;
  onAddPage: (bookId: string) => void;
  onDuplicatePage: (bookId: string, pageId: string) => void;
  onDeletePage: (bookId: string, pageId: string) => void;
  onOpenBookshelf: () => void;
  onCollapse: () => void;
}

/** 提取某页可直接在大图查看器里展示的已生成原图（AI 整页优先，其次首个已出图分镜）。 */
function resolvePagePreviewUrl(page: ComicPageDraft): string | undefined {
  if (page.creationMode === 'ai-page' && page.aiPage.generatedPageImage?.url) {
    return page.aiPage.generatedPageImage.url;
  }
  return page.panels.find(panel => panel.image?.url)?.image?.url;
}

const ComicPageThumbVisual: React.FC<{ page: ComicPageDraft }> = ({ page }) => {
  const aiUrl = page.creationMode === 'ai-page' ? page.aiPage.generatedPageImage?.url : undefined;
  if (aiUrl) {
    return (
      <img
        src={aiUrl}
        alt={page.title || t('未命名漫画页')}
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <svg
      viewBox={`0 0 ${page.width} ${page.height}`}
      className="h-full w-full bg-white dark:bg-gray-900"
      aria-hidden="true"
    >
      {page.creationMode === 'ai-page' ? (
        page.aiPage.guidePanels.map(gp => (
          <rect
            key={gp.id}
            x={gp.x * page.width}
            y={gp.y * page.height}
            width={gp.width * page.width}
            height={gp.height * page.height}
            fill="rgba(99, 102, 241, 0.06)"
            stroke="#6366f1"
            strokeWidth={Math.max(4, page.width * 0.008)}
            strokeDasharray="14 8"
          />
        ))
      ) : (
        page.panels.map(panel => {
          const pts = panel.points.map(p => `${p.x * page.width},${p.y * page.height}`).join(' ');
          const clipId = `comic-strip-clip-${page.id}-${panel.id}`;
          const xs = panel.points.map(p => p.x * page.width);
          const ys = panel.points.map(p => p.y * page.height);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const boxW = Math.max(1, Math.max(...xs) - minX);
          const boxH = Math.max(1, Math.max(...ys) - minY);
          return (
            <g key={panel.id}>
              {panel.image?.url && (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <polygon points={pts} />
                    </clipPath>
                  </defs>
                  <image
                    href={panel.image.url}
                    x={minX}
                    y={minY}
                    width={boxW}
                    height={boxH}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId})`}
                  />
                </>
              )}
              <polygon
                points={pts}
                fill={panel.image?.url ? 'none' : (panel.backgroundColor || '#f8fafc')}
                stroke={panel.borderColor || '#1e293b'}
                strokeWidth={Math.max(4, panel.borderWidth * 1.5)}
              />
            </g>
          );
        })
      )}
    </svg>
  );
};

/**
 * 左侧竖向作品组漫画滚动展示条：
 * - 直接浏览、切换、复制与移除本作品组内留存的漫画页（移出本组不影响全局生成历史原图）；
 * - 复用 Atelier 统一的 PressRevealSurface / ImageCardActions 图片悬浮操作与 ImageLightbox 大图查看器。
 */
export const ComicPageStrip: React.FC<ComicPageStripProps> = ({
  book,
  activePageId,
  notify,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onOpenBookshelf,
  onCollapse,
}) => {
  useLanguage();
  const [lightboxPageId, setLightboxPageId] = useState<string | null>(null);
  const pages = book?.pages || [];

  const viewablePages = useMemo(
    () => pages
      .map((page, idx) => ({ page, idx, src: resolvePagePreviewUrl(page) }))
      .filter((item): item is { page: ComicPageDraft; idx: number; src: string } => Boolean(item.src)),
    [pages],
  );

  const lightboxIndex = lightboxPageId
    ? viewablePages.findIndex(item => item.page.id === lightboxPageId)
    : -1;
  const activeLightbox = lightboxIndex >= 0 ? viewablePages[lightboxIndex] : null;

  if (!book) return null;

  return (
    <>
      <aside
        aria-label={t('作品组漫画列表')}
        className="appearance-panel hidden h-full w-32 flex-none flex-col border-r border-gray-200/80 bg-white/85 backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-900/85 md:flex lg:w-36"
      >
        {/* 顶栏：当前作品组名称 + 书架切换 + 收起条 */}
        <div className="flex flex-none items-center justify-between gap-1 border-b border-gray-200/80 px-2 py-2 dark:border-gray-800/80">
          <button
            type="button"
            onClick={onOpenBookshelf}
            title={t('切换作品组或打开书架')}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-semibold text-gray-700 transition hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
          >
            <BookOpen className="h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
            <span className="truncate">{book.title || t('速写单页集')}</span>
          </button>
          <button
            type="button"
            aria-label={t('收起漫画页条')}
            title={t('收起左侧漫画页条')}
            onClick={onCollapse}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* 竖向滚动缩略图列表 */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {pages.map((page, index) => {
            const isActive = page.id === activePageId;
            const previewUrl = resolvePagePreviewUrl(page);
            const pageTag = `P${String(index + 1).padStart(2, '0')}`;
            return (
              <PressRevealSurface
                key={page.id}
                as="article"
                className={`gallery-image-card group relative overflow-hidden rounded-xl border transition ${isActive ? 'border-indigo-500 ring-2 ring-indigo-500/25 dark:border-indigo-400' : 'border-gray-200/90 hover:border-indigo-300 dark:border-gray-700/80 dark:hover:border-indigo-500/60'}`}
              >
                <div
                  className="mobile-gallery-frame relative aspect-[3/4] w-full cursor-pointer overflow-hidden bg-gray-50 dark:bg-gray-900"
                  onClick={() => onSelectPage(book.id, page.id)}
                >
                  <ComicPageThumbVisual page={page} />

                  {/* 左上页码标记 */}
                  <span
                    data-card-left-action
                    className={`pointer-events-none absolute top-1.5 left-1.5 z-10 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none shadow-xs ${isActive ? 'bg-indigo-600 text-white' : 'bg-black/65 text-white backdrop-blur-xs'}`}
                  >
                    {pageTag}
                  </span>

                  {/* 复用 Atelier 图片悬浮操作组件 */}
                  <ImageCardActions
                    singleColumn
                    className="hover-reveal-md absolute top-1.5 right-1.5 z-20 grid auto-cols-max grid-flow-col gap-1"
                  >
                    {previewUrl && (
                      <button
                        type="button"
                        data-card-action="true"
                        aria-label={t('放大查看 {0}', [page.title || pageTag])}
                        title={t('放大查看原图')}
                        onClick={event => {
                          event.stopPropagation();
                          setLightboxPageId(page.id);
                        }}
                        className={`${IMAGE_CARD_ACTION_CLASS} !h-6 !w-6 flex items-center justify-center`}
                      >
                        <Maximize2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      data-card-action="true"
                      aria-label={t('复制 {0}', [page.title || pageTag])}
                      title={t('复制此页')}
                      onClick={event => {
                        event.stopPropagation();
                        onDuplicatePage(book.id, page.id);
                      }}
                      className={`${IMAGE_CARD_ACTION_CLASS} !h-6 !w-6 flex items-center justify-center`}
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </button>
                    {pages.length > 1 && (
                      <button
                        type="button"
                        data-card-action="true"
                        aria-label={t('从作品组移除 {0}', [page.title || pageTag])}
                        title={t('从本作品组移除（历史记录原图保留）')}
                        onClick={event => {
                          event.stopPropagation();
                          onDeletePage(book.id, page.id);
                        }}
                        className={`${IMAGE_CARD_ACTION_CLASS} !h-6 !w-6 flex items-center justify-center hover:!bg-red-600`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </ImageCardActions>

                  {/* 底部标题条 */}
                  <div
                    data-card-caption
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-1.5 pt-3 pb-1 text-[10px] font-medium text-white"
                  >
                    <div className="truncate">{page.title || `${t('第')} ${index + 1} ${t('页')}`}</div>
                  </div>
                </div>
              </PressRevealSurface>
            );
          })}
        </div>

        {/* 底部：直接新增一页 */}
        <div className="flex-none border-t border-gray-200/80 p-2 dark:border-gray-800/80">
          <button
            type="button"
            onClick={() => onAddPage(book.id)}
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-2 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-indigo-400 hover:bg-indigo-50/60 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('新建一页')}</span>
          </button>
        </div>
      </aside>

      {/* 复用 Atelier 大图预览查看器（带缩放、下载、复制、翻页） */}
      {activeLightbox && (
        <ImageLightbox
          src={activeLightbox.src}
          alt={activeLightbox.page.title || `P${activeLightbox.idx + 1}`}
          filename={`${activeLightbox.page.title || `comic-p${activeLightbox.idx + 1}`}.png`}
          notify={notify}
          pager={viewablePages.length > 1 ? {
            index: lightboxIndex,
            count: viewablePages.length,
            onChange: next => {
              const target = viewablePages[next];
              if (target) setLightboxPageId(target.page.id);
            },
          } : undefined}
          onClose={() => setLightboxPageId(null)}
        />
      )}
    </>
  );
};
