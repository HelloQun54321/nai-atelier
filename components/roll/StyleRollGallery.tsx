import React, { useState } from 'react';
import { Check, Dice5, Heart, Save, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../../types';
import { t } from '../../services/i18n';
import { type RollCandidate, type RollExperiment } from '../../services/styleRoll';
import { buildRollWeightBand, rollChipColor } from './rollPalette';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { useGalleryFrostedCaption } from '../../services/appearancePreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from '../ShortestColumnMasonry';
import { PressRevealSurface } from '../PressRevealSurface';
import { SmartImage } from '../SmartImage';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from '../ImageShareActions';
import { ImageCardActions } from '../ImageCardActions';
import { EmptyState, InlineSpinner } from '../DesignSystem';

interface Props {
  experiment: RollExperiment; candidates: RollCandidate[]; images: Map<string, LocalGenItem>; selectedId: string; selectionFocusEnabled: boolean;
  historyReady: boolean; historyLoading: boolean;
  selecting: boolean; selectedIds: Set<string>; onSelect: (id: string) => void; onToggle: (id: string) => void;
  onSave: (id: string) => void; onArchive: (id: string) => void; busy: boolean;
  /** 正在生成的候选与其流式预览图。 */
  preview?: { id: string; image: string } | null;
  /** 每个候选所属轮次，用于在编号旁标出 R2/R3。 */
  roundNumbers?: Map<string, number>;
  /** 正在等待生成的候选；没有流式预览时也显示进行中。 */
  generatingId?: string;
  /** 已收藏图片的候选；多选时卡片上的爱心被勾选框替换，靠它标出收藏状态。 */
  favoriteIds?: ReadonlySet<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

export const StyleRollGallery: React.FC<Props> = ({ experiment, candidates, images, selectedId, selectionFocusEnabled, historyReady, historyLoading, selecting, selectedIds, onSelect, onToggle, onSave, onArchive, busy, preview, roundNumbers, generatingId, favoriteIds, scrollRef, onScroll, notify }) => {
  const display = useMobileImageDisplayPreferences('roll');
  const requestedColumns = useMasonryColumnCount(display, undefined, scrollRef, 220);
  const columns = display.desktopColumns === 'auto' ? Math.min(4, requestedColumns) : requestedColumns;
  const frosted = useGalleryFrostedCaption();
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const ratio = (candidate: RollCandidate) => ratios[candidate.id] || (images.get(candidate.id)?.params.width ?? experiment.template.params.width) / (images.get(candidate.id)?.params.height ?? experiment.template.params.height);

  const renderCard = (candidate: RollCandidate) => {
    const item = images.get(candidate.id), index = experiment.candidates.indexOf(candidate) + 1;
    const roundNo = roundNumbers?.get(candidate.id);
    const selected = selecting ? selectedIds.has(candidate.id) : selectedId === candidate.id;
    const activate = () => { if (selecting) { if (!busy) onToggle(candidate.id); } else onSelect(selectedId === candidate.id ? '' : candidate.id); };

    // 权重色带：颜色跟画师走，宽度按占比，整体按权重降序铺开
    const band = buildRollWeightBand(candidate.tags);

    return <PressRevealSurface key={candidate.id} pressDisabled={selecting} role={selecting ? 'checkbox' : 'button'} tabIndex={0}
      data-agent-action="select" data-gallery-work-id={candidate.id} data-safe-mode-work="true"
      aria-label={t(selecting ? '选择候选 {0}' : '查看候选 {0}', [index])} aria-checked={selecting ? selected : undefined} aria-pressed={selecting ? undefined : selected} aria-disabled={selecting ? busy : undefined}
      onClick={activate} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } }}
      className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm text-left transition-all duration-200 dark:bg-gray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? '!border-indigo-500 ring-2 ring-indigo-500/25 shadow-md shadow-indigo-500/10' : 'border-gray-200/90 hover:border-indigo-400 hover:shadow-md dark:border-gray-800/80 dark:hover:border-indigo-500/50'} ${!selecting && selectionFocusEnabled && selectedId && !selected ? 'brightness-[.7]' : ''}`}>

      <div data-image-action-left className="absolute left-2.5 top-2.5 z-20 flex flex-col items-start gap-1.5">
        {/* 左上角：编号（参与搜索与详情标题）与删除按钮上下排列。 */}
                <span className="pointer-events-none flex flex-col items-start rounded-md bg-black/35 px-1.5 py-1 font-mono text-micro leading-tight text-white/90 backdrop-blur-sm">
          <span>#{index}</span>
          {roundNo ? <span className="text-mini opacity-60">R{roundNo}</span> : null}
        </span>
        {!selecting && <div data-card-action="true" className="hover-reveal-md">
          <button type="button" aria-label={t('删除候选 {0}', [index])} title={t('删除')} disabled={busy} onClick={event => { event.stopPropagation(); onArchive(candidate.id); }} className="nai-float-btn mobile-size-locked flex items-center justify-center rounded-full bg-black/50 text-white shadow-md backdrop-blur-md transition-all hover:scale-110 hover:bg-red-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>}
      </div>

      <div className="appearance-media mobile-gallery-frame relative w-full overflow-hidden border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950" style={{ '--mobile-image-ratio': String(ratio(candidate)) } as React.CSSProperties}>
        {item ? <SmartImage src={item.imageUrl} alt={t('候选 {0}', [index])} className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget, next = image.naturalWidth / Math.max(1, image.naturalHeight); if (next > 0 && next !== ratios[candidate.id]) setRatios(current => ({ ...current, [candidate.id]: next })); }} />
          : preview?.id === candidate.id ? <img src={preview.image} alt={t('生成预览')} className="h-full w-full object-contain" />
            : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-4 text-gray-400 dark:text-gray-500">
              <div className="appearance-group flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900 text-gray-400">
                <Dice5 className="h-6 w-6 animate-pulse" />
              </div>
              <div className="text-xs font-medium">{historyReady ? t(generatingId === candidate.id ? '生成中…' : '待生成') : historyLoading ? <InlineSpinner label={t('加载中…')} className="text-xs" /> : t('历史暂不可用')}</div>
            </div>}

        {selecting ? (
          <>
            {favoriteIds?.has(candidate.id) && <span role="img" aria-label={t('已收藏')} title={t('已收藏')} className="pointer-events-none absolute right-10 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-rose-400 bg-rose-500 text-white shadow backdrop-blur"><Heart className="h-3.5 w-3.5 fill-current" /></span>}
            <span aria-hidden="true" className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur transition-all ${selected ? 'border-indigo-500 bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 text-white scale-105' : 'border-white/80 bg-black/35 text-transparent hover:scale-105'}`}><Check className="h-4 w-4" /></span>
          </>
        ) : (
          <>
            {/* 右上角只留筛图要连点的两个：收藏与存为风格串；下载／复制在详情页做。 */}
            <ImageCardActions>
              {item && <ImageShareActions imageUrl={item.imageUrl} filename={`roll-${item.id}.png`} generationData={item} favorite={{ imageUrl: item.imageUrl, sourceType: 'history', sourceId: item.id }} notify={notify} variant="card" className="flex-col" showTransfer={false} />}
              {item && (candidate.savedChainId
                ? <span data-image-action-item aria-label={t('已保存候选 {0}', [index])} title={t('已保存到风格串')} className={`${IMAGE_CARD_ACTION_CLASS} inline-flex items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg backdrop-blur-md`}><Check className="h-4 w-4" /></span>
                : <button
                  type="button"
                  aria-label={t('保存候选 {0}', [index])}
                  title={t('存为风格串')}
                  disabled={busy}
                  onClick={event => { event.stopPropagation(); onSave(candidate.id); }}
                  className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg backdrop-blur-md transition-all hover:bg-emerald-800 hover:scale-110 active:scale-95 disabled:opacity-40`}
                >
                  <Save className="h-4 w-4" />
                </button>
              )}
            </ImageCardActions>
          </>
        )}

        {/* 底部微型画师权重色带：颜色锚定画师位置，按权重降序铺开，段与段直接相接 */}
        {band.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex h-1 w-full overflow-hidden bg-black/30 opacity-80 transition-opacity group-hover:opacity-100">
            {band.map(segment => (
              <span key={segment.key} title={segment.label} className="h-full shrink-0" style={{ flexGrow: segment.pct, flexBasis: 0, backgroundColor: segment.color }} />
            ))}
          </div>
        )}
      </div>



      {/* 卡片底栏：只露画师名与剩余数量，权重留到详情——挑图时不关心 0.7 还是 1.3。 */}
      <div className="gallery-card-caption flex items-center justify-between px-3 py-2 gap-2 bg-white/95 dark:bg-gray-850/95 border-t border-gray-100 dark:border-gray-800" style={frosted ? { paddingBottom: '1.75rem' } : undefined}>
        <div className="flex flex-nowrap items-center gap-1 overflow-hidden min-w-0 flex-1" title={candidate.tags.map(entry => `${entry.tag} (${entry.weight.toFixed(1)})`).join(', ')}>
          {candidate.tags.slice(0, 3).map((entry, entryIndex) => (
            <span key={entry.tag} className="gallery-card-badge inline-flex min-w-0 shrink items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-1 py-0.5 text-micro font-medium text-gray-700 dark:text-gray-200 border border-gray-200/50 dark:border-gray-700/50">
              <span className="inline-block h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: rollChipColor(entryIndex) }} />
              <span className="truncate">{entry.tag}</span>
            </span>
          ))}
          {candidate.tags.length > 3 && (
            <span className="gallery-card-badge shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-micro font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              +{candidate.tags.length - 3}
            </span>
          )}
        </div>
      </div>
    </PressRevealSurface>;
  };

  return <section ref={scrollRef} onScroll={onScroll} aria-label={t('候选图库')} className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">
    {candidates.length ? display.layout === 'masonry' ? <ShortestColumnMasonry items={candidates} columns={columns} getItemKey={candidate => candidate.id} estimateItemHeight={(candidate, width) => width / ratio(candidate) + (frosted ? 2 : 80)} renderItem={renderCard} />
      : <div className={`${mobileGalleryClassName(display)} workspace-card-grid workspace-roll-grid`} style={mobileGalleryStyle(display, columns)}>{candidates.map(renderCard)}</div>
      : <EmptyState className="h-full min-h-60" title={t('暂无匹配候选')} />}
  </section>;
};
