import React, { useState } from 'react';
import { AlertTriangle, Check, Dice5, Heart, LoaderCircle, Play, RotateCw, Save, Square, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../../types';
import { t } from '../../services/i18n';
import { type RollCandidate, type RollExperiment } from '../../services/styleRoll';
import type { GenerationStatusDescriptor } from '../../services/generationStatus';
import { formatGenerationDuration, readGenerationDurationMs } from '../../services/generationDuration';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { useGalleryFrostedCaption } from '../../services/appearancePreferences';
import { ShortestColumnMasonry, useMasonryColumnCount } from '../ShortestColumnMasonry';
import { PressRevealSurface } from '../PressRevealSurface';
import { SmartImage } from '../SmartImage';
import { IMAGE_CARD_ACTION_CLASS, IMAGE_CARD_ACTION_TONE, ImageShareActions } from '../ImageShareActions';
import { ImageCardActions } from '../ImageCardActions';
import { EmptyState, InlineSpinner, ToolbarButton } from '../DesignSystem';

export interface RollGalleryEmptyState {
  title: string;
  hint?: string;
  actionLabel?: string;
  actionPrimary?: boolean;
  actionDisabled?: boolean;
  onAction?: () => void;
}

interface Props {
  experiment: RollExperiment; candidates: RollCandidate[]; images: Map<string, LocalGenItem>; selectedId: string; selectionFocusEnabled: boolean;
  historyReady: boolean; historyLoading: boolean;
  selecting: boolean; selectedIds: Set<string>; onSelect: (id: string) => void; onToggle: (id: string) => void;
  onSave: (id: string) => void; onArchive: (id: string) => void; busy: boolean;
  /** 由页面统一算好的当前列数（与默认满一行张数同源，省略时按图库默认规则计算）。 */
  columns?: number;
  /** 正在生成的候选与其流式预览图。 */
  preview?: { id: string; image: string } | null;
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
    stopping?: boolean;
    /** 与实验室生成按钮同源的实时状态语义（图标 + 文案）。 */
    status?: GenerationStatusDescriptor | null;
    /** 正在生成时的 0.1s 实时跳表文案，紧贴生成圆钮下方展示。 */
    liveElapsedLabel?: string;
    error?: { message: string; tone: 'error' | 'warning' } | null;
  } | null;
  /** 当前轮剩余可一次性唤醒的待生成张数（>1 时队头卡主按钮直接恢复整批队列）。 */
  pendingBatchCount?: number;
  onGenerate?: (id: string) => void;
  onGeneratePending?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onApprove?: () => void;
  /** 已收藏图片的候选；多选时卡片上的爱心被勾选框替换，靠它标出收藏状态。 */
  favoriteIds?: ReadonlySet<string>;
  emptyState?: RollGalleryEmptyState;
  scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const GEN_PRIMARY = 'mobile-touch inline-flex items-center gap-1.5 rounded-full bg-[var(--nai-accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-40';
const GEN_SECONDARY = 'mobile-touch inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200 dark:hover:bg-gray-800';
const ICON_CIRCLE_PRIMARY = 'mobile-touch inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nai-accent)] text-white shadow-md transition-all hover:scale-105 hover:brightness-110 active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nai-accent)] focus-visible:ring-offset-2';
const ICON_CIRCLE_MUTED = 'mobile-touch inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200/90 bg-gray-100/90 text-gray-500 shadow-xs transition-all hover:scale-105 hover:border-[var(--nai-accent)]/50 hover:text-[var(--nai-accent)] active:scale-95 disabled:opacity-40 dark:border-gray-700/80 dark:bg-gray-900/90 dark:text-gray-400';
const ICON_CIRCLE_STOP = 'mobile-touch relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-gray-200/80 bg-white/90 text-gray-700 shadow-sm transition-all hover:scale-105 hover:border-red-300 hover:bg-red-50 hover:text-red-600 active:scale-95 disabled:opacity-50 dark:border-gray-700/80 dark:bg-gray-900/85 dark:text-gray-200 dark:hover:border-red-500/50 dark:hover:bg-red-950/60 dark:hover:text-red-300';
const INLINE_LINK_BTN = 'mobile-touch inline-flex items-center justify-center rounded-full px-2 py-0.5 text-mini font-medium text-gray-500 transition-colors hover:text-[var(--nai-accent)] disabled:opacity-40 dark:text-gray-400';

export const StyleRollGallery: React.FC<Props> = ({ experiment, candidates, images, selectedId, selectionFocusEnabled, historyReady, historyLoading, selecting, selectedIds, onSelect, onToggle, onSave, onArchive, busy, columns: columnsProp, preview, positions, generationState, pendingBatchCount = 0, onGenerate, onGeneratePending, onResume, onCancel, onApprove, favoriteIds, emptyState, scrollRef, onScroll, notify }) => {
  const display = useMobileImageDisplayPreferences('roll');
  const requestedColumns = useMasonryColumnCount(display, undefined, scrollRef, 220, false, Boolean(selectedId));
  const columns = columnsProp ?? (display.desktopColumns === 'auto' ? Math.min(4, requestedColumns) : requestedColumns);
  const frosted = useGalleryFrostedCaption();
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const ratio = (candidate: RollCandidate) => ratios[candidate.id] || (images.get(candidate.id)?.params.width ?? experiment.template.params.width) / (images.get(candidate.id)?.params.height ?? experiment.template.params.height);

  const renderCard = (candidate: RollCandidate) => {
    const item = images.get(candidate.id), index = experiment.candidates.indexOf(candidate) + 1;
    const selected = selecting ? selectedIds.has(candidate.id) : selectedId === candidate.id;
    const activate = () => { if (selecting) { if (!busy) onToggle(candidate.id); } else onSelect(selectedId === candidate.id ? '' : candidate.id); };
    const isActiveGenerating = !item && Boolean(
      preview?.id === candidate.id
      || (generationState?.running && !generationState.paused && !generationState.awaiting && generationState.generatingId === candidate.id),
    );
    const durationLabel = item ? formatGenerationDuration(readGenerationDurationMs(item)) : '';
    const liveElapsedLabel = isActiveGenerating ? (generationState?.liveElapsedLabel || '') : '';

    return <PressRevealSurface key={candidate.id} pressDisabled={selecting} role={selecting ? 'checkbox' : 'button'} tabIndex={0}
      data-agent-action="select" data-gallery-work-id={candidate.id} data-safe-mode-work="true" data-generating={isActiveGenerating ? 'true' : undefined}
      aria-label={t(selecting ? '选择候选 {0}' : '查看候选 {0}', [index])} aria-checked={selecting ? selected : undefined} aria-pressed={selecting ? undefined : selected} aria-disabled={selecting ? busy : undefined}
      onClick={activate} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } }}
      className={`appearance-group mobile-gallery-item gallery-image-card gallery-card-visual group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm text-left transition-all duration-200 dark:bg-gray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isActiveGenerating ? 'roll-card-generating' : ''} ${selected ? '!border-indigo-500 ring-2 ring-indigo-500/25 shadow-md shadow-indigo-500/10' : 'border-gray-200/90 hover:border-indigo-400 hover:shadow-md dark:border-gray-800/80 dark:hover:border-indigo-500/50'} ${!selecting && selectionFocusEnabled && selectedId && !selected ? 'brightness-[.7]' : ''}`}>

      {isActiveGenerating && <span aria-hidden="true" className="roll-card-orbit-glow" />}

      {!selecting && <div data-image-action-left className="absolute left-2.5 top-2.5 z-20 flex flex-col items-start gap-1.5">
        <div data-card-action="true" className="hover-reveal-md">
          <button type="button" aria-label={t('删除候选 {0}', [index])} title={t('删除')} disabled={busy} onClick={event => { event.stopPropagation(); onArchive(candidate.id); }} className="nai-float-btn mobile-size-locked flex items-center justify-center rounded-full bg-black/50 text-white shadow-md transition-all hover:scale-110 hover:bg-red-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>}

      <div className="appearance-media mobile-gallery-frame relative w-full overflow-hidden border-b border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-950" style={{ '--mobile-image-ratio': String(ratio(candidate)) } as React.CSSProperties}>
        {item ? <SmartImage src={item.imageUrl} alt={t('候选 {0}', [index])} className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget, next = image.naturalWidth / Math.max(1, image.naturalHeight); if (next > 0 && next !== ratios[candidate.id]) setRatios(current => ({ ...current, [candidate.id]: next })); }} />
          : preview?.id === candidate.id ? <div className="relative h-full w-full">
            <img src={preview.image} alt={t('生成预览')} className="h-full w-full object-contain" />
            <span className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-0.5 text-micro text-white">
              <span>{generationState?.status?.label || (generationState?.saving ? t('正在保存…') : t('生成中…'))}</span>
              {liveElapsedLabel && <span className="tabular-nums opacity-85">{liveElapsedLabel}</span>}
            </span>
          </div>
            : <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-4 text-center">
              {!historyReady ? (historyLoading ? <InlineSpinner label={t('加载中…')} className="text-xs" /> : <div className="text-xs font-medium">{t('历史暂不可用')}</div>) : (() => {
                const state = generationState, position = positions?.get(candidate.id);
                const isNext = state?.nextId === candidate.id;
                const isGenerating = state?.generatingId === candidate.id;
                const error = isNext ? state?.error : null;
                const positionLabel = position ? t('本批第 {0}/{1} 张', [position.index, position.total]) : '';
                const canResumeBatch = Boolean(pendingBatchCount > 1 && onGeneratePending);
                const fire = (action?: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); action?.(); };
                if (error) {
                  const retryTone = error.tone === 'warning' ? 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500' : 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-500';
                  const retryLabel = canResumeBatch ? t('重试并继续（{0} 张）', [pendingBatchCount]) : t('重试');
                  return <>
                    <p className={`line-clamp-3 max-w-full break-words text-xs font-medium ${error.tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-300'}`} title={error.message}>{error.message}</p>
                    {(canResumeBatch ? onGeneratePending : onGenerate) && (
                      <button type="button" disabled={busy} aria-label={retryLabel} title={retryLabel} onClick={fire(canResumeBatch ? onGeneratePending : () => onGenerate?.(candidate.id))} className={`mobile-touch inline-flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${retryTone}`}>
                        <RotateCw className="h-5 w-5" />
                      </button>
                    )}
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{retryLabel}</span>
                    {canResumeBatch && onGenerate && <button type="button" disabled={busy} onClick={fire(() => onGenerate(candidate.id))} className={INLINE_LINK_BTN}>{t('仅生此张')}</button>}
                    {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                  </>;
                }
                if (state?.running) {
                  if (state.awaiting && isNext) return <>
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="text-xs font-medium">{state.status?.label || t('等待确认费用')}</span>
                    {onApprove && <button type="button" disabled={busy} onClick={fire(onApprove)} className={GEN_PRIMARY}>{t('确认费用')}</button>}
                    {onCancel && <button type="button" onClick={fire(onCancel)} className={GEN_SECONDARY}>{t('取消')}</button>}
                  </>;
                  if (isGenerating) return <>
                    <button type="button" disabled={!onCancel || state.stopping} aria-label={t('停止生成')} title={t('停止生成')} onClick={fire(onCancel)} className={ICON_CIRCLE_STOP}>
                      {!state.stopping && <span aria-hidden="true" className="roll-stop-btn-ring" />}
                      {state.stopping ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      <span>{state.status?.label || (state.saving ? t('正在保存…') : t('生成中…'))}</span>
                      {liveElapsedLabel && <span className="tabular-nums opacity-75" data-live-duration>{liveElapsedLabel}</span>}
                    </span>
                    {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                  </>;
                  if (state.paused && isNext) return <>
                    {onResume && <button type="button" disabled={busy} aria-label={t('继续')} title={t('继续')} onClick={fire(onResume)} className={ICON_CIRCLE_PRIMARY}>
                      <Play className="h-5 w-5 translate-x-0.5 fill-current" />
                    </button>}
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{state.status?.label || t('已暂停')}</span>
                    {onCancel && <button type="button" disabled={state.stopping} onClick={fire(onCancel)} className={INLINE_LINK_BTN}>{t('取消')}</button>}
                    {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                  </>;
                  return <>
                    <div className="appearance-group flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-900">
                      <Dice5 className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium">{t('排队中 · 第 {0} 位', [position?.index ?? 1])}</span>
                    {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                  </>;
                }
                if (isNext && canResumeBatch) return <>
                  <button type="button" disabled={busy} aria-label={t('继续生成剩余 {0} 张', [pendingBatchCount])} title={t('继续生成剩余 {0} 张', [pendingBatchCount])} onClick={fire(onGeneratePending)} className={ICON_CIRCLE_PRIMARY}>
                    <Play className="h-5 w-5 translate-x-0.5 fill-current" />
                  </button>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('继续剩余 {0} 张', [pendingBatchCount])}</span>
                  {onGenerate && <button type="button" disabled={busy} onClick={fire(() => onGenerate(candidate.id))} className={INLINE_LINK_BTN}>{t('仅生此张')}</button>}
                  {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                </>;
                if (canResumeBatch) return <>
                  {onGenerate && <button type="button" disabled={busy} aria-label={t('仅生此张')} title={t('仅生此张')} onClick={fire(() => onGenerate(candidate.id))} className={ICON_CIRCLE_MUTED}>
                    <Play className="h-4 w-4 translate-x-0.5 fill-current" />
                  </button>}
                  {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
                </>;
                return <>
                  {onGenerate && <button type="button" disabled={busy} aria-label={t('生成')} title={t('生成')} onClick={fire(() => onGenerate(candidate.id))} className={ICON_CIRCLE_PRIMARY}>
                    <Play className="h-5 w-5 translate-x-0.5 fill-current" />
                  </button>}
                  {positionLabel && <span className="text-mini text-gray-400 dark:text-gray-500">{positionLabel}</span>}
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
                ? <span data-image-action-item aria-label={t('已保存候选 {0}', [index])} title={t('已保存到风格串')} className={`${IMAGE_CARD_ACTION_CLASS} ${IMAGE_CARD_ACTION_TONE.saved} inline-flex items-center justify-center rounded-full shadow-lg`}><Check className="h-4 w-4" strokeWidth={3} /></span>
                : <button
                  type="button"
                  aria-label={t('保存候选 {0}', [index])}
                  title={t('存为风格串')}
                  disabled={busy}
                  onClick={event => { event.stopPropagation(); onSave(candidate.id); }}
                  className={`hover-reveal-md ${IMAGE_CARD_ACTION_CLASS} ${IMAGE_CARD_ACTION_TONE.save} inline-flex items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 active:scale-95 disabled:opacity-40`}
                >
                  <Save className="h-4 w-4" />
                </button>
              )}
            </ImageCardActions>
          </>
        )}

      </div>

      {/* 卡片底栏：按权重优先展示前 2 位主画师与剩余数量；出图完成后在正下方居左永久保留生成耗时。 */}
      <div className="gallery-card-caption flex flex-col items-stretch justify-center px-3 py-2 gap-1 bg-white/95 dark:bg-gray-850/95 border-t border-gray-100 dark:border-gray-800">
        <div className="flex w-full flex-nowrap items-center gap-1 overflow-hidden min-w-0" title={candidate.tags.map(entry => `${entry.tag} (${entry.weight.toFixed(1)})`).join(', ')}>
          {candidate.tags
            .map((entry, originalIndex) => ({ entry, originalIndex }))
            .sort((a, b) => b.entry.weight - a.entry.weight || a.originalIndex - b.originalIndex)
            .slice(0, 2)
            .map(({ entry }) => (
            <span key={entry.tag} className="gallery-card-badge inline-flex min-w-0 shrink items-center rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-micro font-medium text-gray-700 dark:text-gray-200 border border-gray-200/50 dark:border-gray-700/50">
              <span className="truncate">{entry.tag}</span>
            </span>
          ))}
          {candidate.tags.length > 2 && (
            <span className="gallery-card-badge shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-micro font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              +{candidate.tags.length - 2}
            </span>
          )}
        </div>
        {durationLabel && (
          <div className="gallery-card-meta text-left text-mini leading-none tabular-nums text-gray-500 dark:text-gray-400" data-generation-duration>
            {durationLabel}
          </div>
        )}
      </div>
    </PressRevealSurface>;
  };

  return <section ref={scrollRef} onScroll={onScroll} aria-label={t('候选图库')} className="workspace-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-5">
    {candidates.length ? display.layout === 'masonry' ? <ShortestColumnMasonry items={candidates} columns={columns} getItemKey={candidate => candidate.id} estimateItemHeight={(candidate, width) => width / ratio(candidate) + (frosted ? 2 : 80)} renderItem={renderCard} />
      : <div className={`${mobileGalleryClassName(display)} workspace-card-grid workspace-roll-grid`} style={mobileGalleryStyle(display, columns)}>{candidates.map(renderCard)}</div>
      : <EmptyState
        className="h-full min-h-60"
        title={emptyState?.title ?? t('暂无匹配候选')}
        hint={emptyState?.hint}
        action={emptyState?.actionLabel && emptyState.onAction ? <ToolbarButton tone={emptyState.actionPrimary ? 'primary' : 'neutral'} disabled={emptyState.actionDisabled} onClick={emptyState.onAction}>{emptyState.actionLabel}</ToolbarButton> : undefined}
      />}
  </section>;
};
