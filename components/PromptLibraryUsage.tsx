/**
 * 提示词库 ↔ 生成图（图墙）展示件：
 *   - PromptLibraryUsageBadge：卡片右下角「N 图」小胶囊
 *   - PromptLibraryUsageSection：详情页「生成记录」区块（总数 + 2:3 缩略图网格 + 加载更多）
 *
 * 关联来自提示词文本匹配推断（见 docs/PRODUCT_DECISIONS.md），文案保持中性，
 * 不写「精确来源」「官方记录」。点缩略图复用现成的大图查看器 ImageLightbox。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import {
  fetchPromptLibraryUsageImages,
  PROMPT_LIBRARY_USAGE_PAGE_SIZE,
  PROMPT_LIBRARY_USAGE_PREVIEW_SIZE,
  type PromptLibraryUsageImage,
} from '../services/promptLibraryUsage';
import { ToolbarButton } from './DesignSystem';
import { ImageLightbox } from './ImageLightbox';
import { SmartImage } from './SmartImage';

/* 与 PromptLibrary 详情页一致的卡片 / 字段样式，保持同一视觉语言。 */
const DETAIL_CARD_CLASS = 'appearance-group rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const DETAIL_LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';

/**
 * 卡片计数胶囊：count<=0 不渲染；点击只做视觉信息展示，不触发卡片打开。
 */
export const PromptLibraryUsageBadge: React.FC<{ count?: number }> = ({ count = 0 }) => {
  useLanguage();
  const total = Math.floor(Number(count) || 0);
  if (total <= 0) return null;
  const label = t('{0} 图', [total]);
  return (
    <span
      data-prompt-library-usage={total}
      aria-label={label}
      title={label}
      onClick={event => { event.stopPropagation(); }}
      className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-micro text-white"
    >{label}</span>
  );
};

export interface PromptLibraryUsageSectionProps {
  chainId: string;
  /** 紧凑预览态：只取首屏缩略图，不显示「加载更多」。 */
  preview?: boolean;
  zIndex?: number;
  notify?: (message: string, type?: 'success' | 'error') => void;
}

/**
 * 详情页「生成记录」：首屏拉一页，总数用后端 count，「加载更多」按同一页大小追加。
 * 加载中 / 失败（可重试）/ 空态 / 有图四态都要有明确落点。
 */
export const PromptLibraryUsageSection: React.FC<PromptLibraryUsageSectionProps> = ({ chainId, preview = false, notify, zIndex }) => {
  useLanguage();
  const pageSize = preview ? PROMPT_LIBRARY_USAGE_PREVIEW_SIZE : PROMPT_LIBRARY_USAGE_PAGE_SIZE;
  const [items, setItems] = useState<PromptLibraryUsageImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setItems([]);
    setTotal(0);
    setViewerIndex(null);
    void (async () => {
      try {
        const page = await fetchPromptLibraryUsageImages(chainId, { limit: pageSize, offset: 0 });
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.count);
      } catch (error) {
        console.warn('Prompt library usage load failed:', error);
        if (cancelled) return;
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chainId, pageSize, reloadKey]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPromptLibraryUsageImages(chainId, { limit: pageSize, offset: items.length });
      setItems(previous => {
        const seen = new Set(previous.map(row => row.id));
        return [...previous, ...page.items.filter(row => !seen.has(row.id))];
      });
      setTotal(page.count);
    } catch (error) {
      console.warn('Prompt library usage load more failed:', error);
      notify?.(t('读取失败，请重试'), 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [chainId, items.length, loading, loadingMore, notify, pageSize]);

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className={DETAIL_LABEL_CLASS}>{t('生成记录')}</span>
      {!loading && !failed && total > 0 && (
        <span className="flex-none text-micro text-gray-500 dark:text-gray-400" data-prompt-library-usage-total={total}>{t('{0} 图', [total])}</span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className={DETAIL_CARD_CLASS}>
        {header}
        <div role="status" aria-live="polite" className="appearance-group mt-1.5 flex min-h-20 items-center justify-center gap-2 rounded-xl bg-gray-50 text-meta text-gray-400 dark:bg-gray-950/60 dark:text-gray-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{t('加载中…')}</span>
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className={DETAIL_CARD_CLASS}>
        {header}
        <div role="alert" className="appearance-group mt-1.5 flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-gray-50 px-3 text-center text-meta text-gray-500 dark:bg-gray-950/60 dark:text-gray-400">
          <span>{t('读取失败，请重试')}</span>
          <ToolbarButton onClick={() => setReloadKey(value => value + 1)} className="mobile-touch">
            <RotateCcw /><span>{t('重试')}</span>
          </ToolbarButton>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className={DETAIL_CARD_CLASS}>
        {header}
        <div className="appearance-group mt-1.5 flex min-h-20 items-center justify-center rounded-xl bg-gray-50 px-3 text-center text-meta text-gray-400 dark:bg-gray-950/60 dark:text-gray-500">{t('还没有用这条提示词生成过的图')}</div>
      </div>
    );
  }

  const current = viewerIndex === null ? null : items[viewerIndex];

  return (
    <>
      <div className={DETAIL_CARD_CLASS} data-prompt-library-usage-section={chainId}>
        {header}
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewerIndex(index)}
              aria-label={t('查看生成图 {0}', [index + 1])}
              title={item.prompt || t('点击查看原图')}
              className="mobile-touch block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
            >
              <SmartImage
                src={item.imageUrl}
                alt={t('生成记录')}
                thumbnailVariant="thumb-480"
                className="h-full w-full object-cover"
                containerClassName="relative aspect-[2/3] w-full overflow-hidden bg-gray-100 dark:bg-gray-950"
              />
            </button>
          ))}
        </div>
        {!preview && items.length < total && (
          <ToolbarButton onClick={() => void loadMore()} disabled={loadingMore} className="mobile-touch mt-2 w-full">
            {loadingMore ? <LoaderCircle className="animate-spin" /> : <ChevronDown />}
            <span>{loadingMore ? t('加载中…') : t('加载更多')}</span>
          </ToolbarButton>
        )}
      </div>
      {current && (
        <ImageLightbox
          zIndex={zIndex}
          src={current.imageUrl}
          alt={t('生成记录')}
          notify={notify}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
};
