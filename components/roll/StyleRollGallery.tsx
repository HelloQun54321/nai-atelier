import React, { useState } from 'react';
import { AlertTriangle, Check, Dice5, Heart, LoaderCircle, Pause, Save, Trash2 } from 'lucide-react';
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
  /** 本批排序：未出图卡片显示「本批第 n/总数 张」。 */
  positions?: Map<string, { index: number; total: number }>;
  /** 生成状态与操作：直接落在候选卡占位区，不再使用底部悬浮小框。 */
  generationState?: {
    generatingId?: string;
    /** 本轮下一张待生成候选：错误与费用确认显示在这一张。 */
    nextId?: string;
    running: boolean;
    paused: boolean;
    awaiting: boolean;
    saving: boolean;
    error?: { message: string; tone: 'error' | 'warning' } | null;
  } | null;
  onGenerate?: (id: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onApprove?: () => void;
  /** 已收藏图片的候选；多选时卡片上的爱心被勾选框替换，靠它标出收藏状态。 */
  favoriteIds?: ReadonlySet<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const GEN_PRIMARY = 'mobile-touch inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-40';
const GEN_SECONDARY = 'mobile-touch inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200 dark:hover:bg-gray-800';

export const StyleRollGallery: React.FC<Props> = ({ experiment, candidates, images, selectedId, selectionFocusEnabled, historyReady, historyLoading, selecting, selectedIds, onSelect, onToggle, onSave, onArchive, busy, preview, roundNumbers, positions, generationState, onGenerate, onPause, onResume, onCancel, onApprove, favoriteIds, scrollRef, onScroll, notify }) => {
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
                <span className="pointer-events-none flex flex-col items-start rounded-md bg-black/35 px-1.5 py-1 font-mono text-micro leading-tight text-white/90">
          <span>#{index}</span>
          {roundNo ? <span className="text-mini opacity-60">R{roundNo}</span> : null}
        </span>
        {!selecting && <div data-card-action="true" className="hover-reveal-md">
          <button type="button" aria-label={t('删除候选 {0}', [index])} title={t('删除')} disabled={busy} onClick={event => { event.stopPropagation(); onArchive(candidate.id); }} className="nai-float-btn mobile-size-locked flex items-center justify-center rounded-full bg-black/50 text-white shadow-md transition-all hover:scale-110 hover:bg-red-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>}
      </div>

      <div className="appearance-media mobile-gallery-frame relative w-full overflow-hidden border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950" style={{ '--mobile-image-ratio': String(ratio(candidate)) } as React.CSSProperties}>
        {item ? <SmartImage src={item.imageUrl} alt={t('候选 {0}', [index])} className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget, next = image.naturalWidth / Math.max(1, image.naturalHeight); if (next > 0 && next !== ratios[candidate.id]) setRatios(current => ({ ...current, [candidate.id]: next })); }} />
          : preview?.id === candidate.id ? <div className="relative h-full w-full">
            <img src={preview.image} alt={t('生成预览')} className="h-full w-full object-contain" />
            <span className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/55 px-2 py-0.5 text-micro text-white">{generationState?.saving ? t('正在保存…') : t('生成中…')}</span>
          </div>
            : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2.5 px-4 text-center">
              {!historyReady ? (historyLoading ? <InlineSpinner label={t('加载中…')} className="text-xs" /> : <div className="text-xs font-medium">{t('历史暂不可用')}</div>) : (() => {
                const state = generationState, position = positions?.get(candidate.id);
                const isNext = state?.nextId === candidate.id;
                const isGenerating = state?.generatingId === candidate.id;
                const error = isNext ? state?.error : null;
                const positionLabel = position ? t('本批第 {0}/{1} 张', [position.index, position.total]) : '';
                const fire = (action?: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); action?.(); };
                if (error) return <>
                  <AlertTriangle className={`h-6 w-6 ${error.tone === 'warning' ? 'text-amber-500' : 'text-red-500'}`} />
                  <p className={`line-clamp-3 max-w-full break-words text-xs font-medium ${error.tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-300'}`} title={error.message}>{error.message}</p>
                  {onGenerate && <button type="button" disabled={busy} onClick={fire(() => onGenerate(candidate.id))} className={GEN_PRIMARY}><Dice5 className="h-3.5 w-3.5" />{t('重试')}</button>}
                  {positionLabel && <span className="text-mini">{positionLabel}</span>}
                </>;
                if (state?.running) {
                  if (state.awaiting && isNext) return <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span className="text-xs font-medium">{t('等待费用确认')}</span>
                    {onApprove && <button type="button" disabled={busy} onClick={fire(onApprove)} className={GEN_PRIMARY}>{t('确认费用')}</button>}
                    {onCancel && <button type="button" onClick={fire(onCancel)} className={GEN_SECONDARY}>{t('取消')}</button>}
                  </>;
                  if (isGenerating) return <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span className="text-xs font-medium">{state.saving ? t('正在保存…') : t('生成中…')}</span>
                    {state.paused
                      ? onResume && isNext && <button type="button" disabled={busy} onClick={fire(onResume)} className={GEN_SECONDARY}>{t('继续')}</button>
                      : onPause && <button type="button" disabled={busy} onClick={fire(onPause)} className={GEN_SECONDARY}><Pause className="h-3 w-3" />{t('暂停')}</button>}
                    {onCancel && <button type="button" onClick={fire(onCancel)} className={GEN_SECONDARY}>{t('取消')}</button>}
                  </>;
                  return <>
                    <div className="appearance-group flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-900">
                      <Dice5 className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium">{state.paused && isNext ? t('任务已暂停') : t('排队中 · 第 {0} 位', [position?.index ?? 1])}</span>
                    {state.paused && isNext && onResume && <button type="button" disabled={busy} onClick={fire(onResume)} className={GEN_SECONDARY}>{t('继续')}</button>}
                    {positionLabel && <span className="text-mini">{positionLabel}</span>}
                  </>;
                }
                return <>
                  <div className="appearance-group flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-900">
                    <Dice5 className="h-6 w-6" />
                  </div>
                  {onGenerate && <button type="button" disabled={busy} onClick={fire(() => onGenerate(candidate.id))} className={GEN_PRIMARY}>{t('生成')}</button>}
                  {positionLabel && <span className="text-mini">{positionLabel}</span>}
                </>;
              })()}
            </div>}

        {selecting ? (
          <>
            {favoriteIds?.has(candidate.id) && <span role="img" aria-label={t('已收藏')} title={t('已收藏')} className="pointer-events-none absolute right-10 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-rose-400 bg-rose-500 text-white shadow"><Heart className="h-3.5 w-3.5 fill-current" /></span>}
            <span aria-hidden="true" className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow transition-all ${selected ? 'border-indigo-500 bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 text-white scale-105' : 'border-white/80 bg-black/35 text-transparent hover:scale-105'}`}><Check className="h-4 w-4" /></span>
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
                  className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} inline-flex items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg transition-all hover:bg-emerald-800 hover:scale-110 active:scale-95 disabled:opacity-40`}
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
        <div className="flex w-full flex-nowrap items-center gap-1 overflow-hidden min-w-0 flex-1" title={candidate.tags.map(entry => `${entry.tag} (${entry.weight.toFixed(1)})`).join(', ')}>
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
