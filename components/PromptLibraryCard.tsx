import React, { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Layers, LoaderCircle, Trash2 } from 'lucide-react';
import type { PromptChain } from '../types';
import { t } from '../services/i18n';
import { getCustomChainTags } from '../services/chainTags';
import { librarySectionOf } from '../services/promptLibraryEntries';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { PressRevealSurface } from './PressRevealSurface';
import { SmartImage } from './SmartImage';
import { ImageCardActions } from './ImageCardActions';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { useConfirmDialog } from './ConfirmDialog';
import { PromptLibraryCoverGenerateButton, PromptLibraryCoverGenerationStatus } from './usePromptLibraryCoverActions';
import type { PromptLibraryCoverGeneration } from '../services/promptLibraryCoverGeneration';

/** 主浏览和管理入口共用封面、操作分区及信息栏；送到实验室只在详情顶栏，不压在封面上。 */
export function PromptLibraryCard({ chain, label: _label, title, summary, tagContent, openLabel, selected = false, dimmed = false, busy = false, deleteDisabled = busy, onOpen, onDelete, onClearCover, actions, mediaInfo, notify, coverGeneration, coverBusy = false, coverDisabled = false, onGenerateCover, onManageCoverGeneration }: {
  chain: PromptChain; label?: string; title?: React.ReactNode; summary?: React.ReactNode; tagContent?: React.ReactNode; openLabel?: string;
  selected?: boolean; dimmed?: boolean; busy?: boolean; deleteDisabled?: boolean;
  onOpen: () => void; onDelete?: () => void; onClearCover?: () => Promise<void>;
  actions?: React.ReactNode; mediaInfo?: React.ReactNode; notify: (message: string, kind?: 'success' | 'error') => void;
  coverGeneration?: PromptLibraryCoverGeneration; coverBusy?: boolean; coverDisabled?: boolean;
  onGenerateCover?: () => void; onManageCoverGeneration?: (chainId: string, action: 'approve' | 'resume') => Promise<void>;
}) {
  const frosted = useGalleryFrostedCaption();
  const confirm = useConfirmDialog();
  const clearLock = useRef(false);
  const [clearing, setClearing] = useState(false);
  const [imageRatio, setImageRatio] = useState<{ src: string; value: number }>();
  const name = chain.name?.trim() || t('未命名');
  const section = librarySectionOf(chain);
  const combination = section === 'saved';
  const streamingPreview = coverGeneration?.session?.preview?.image
    || (coverGeneration?.phase === 'save_failed' || coverGeneration?.phase === 'saving' ? coverGeneration.item?.imageUrl : coverGeneration?.phase === 'failed' ? coverGeneration.preview : undefined)
    || coverGeneration?.previewImage;
  const imageSrc = streamingPreview || chain.previewImage;
  const ratio = imageRatio && imageRatio.src === imageSrc ? imageRatio.value : 2 / 3;
  const showClearCover = Boolean(onClearCover && chain.previewImage && coverGeneration?.phase !== 'save_failed' && coverGeneration?.phase !== 'saving');
  const clearCover = async () => {
    if (!onClearCover || clearLock.current || !chain.previewImage) return;
    clearLock.current = true;
    try {
      if (!await confirm({
        title: t('删除这张封面？'),
        message: t('只清除条目封面，历史、收藏和原图保留。'),
        confirmLabel: t('删除当前封面'),
        tone: 'danger',
        rememberKey: 'prompt-library-cover.delete',
      })) return;
      setClearing(true);
      await onClearCover();
      notify(t('已清除封面'));
    } catch (cause) {
      notify(t('清除封面失败：{0}', [cause instanceof Error ? cause.message : String(cause)]), 'error');
    } finally {
      clearLock.current = false;
      setClearing(false);
    }
  };
  return <PressRevealSurface as="article" data-agent-action="browse" role="button" tabIndex={0} aria-label={openLabel || t('查看{0}', [name])} aria-pressed={selected} aria-busy={busy} aria-disabled={busy} pressDisabled={busy}
    data-prompt-library-entry={chain.id} data-prompt-library-id={chain.id} data-return-item-id={chain.id} data-gallery-work-id={chain.id} data-safe-mode-work="true"
    className={`appearance-group gallery-image-card gallery-card-visual group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition-[filter,border-color] focus-visible:outline-2 focus-visible:outline-indigo-500 dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 dark:border-gray-800'} ${dimmed ? 'brightness-[.7]' : ''}`}
    style={{ display: frosted ? 'grid' : undefined }} onClick={() => { if (!busy) onOpen(); }} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!busy) onOpen(); } }}>
    <div className={`appearance-media mobile-gallery-frame relative aspect-[2/3] w-full overflow-hidden ${imageSrc ? '' : 'bg-gray-100 dark:bg-gray-800'}`} style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}>
      {imageSrc ? <SmartImage src={imageSrc} alt={name} thumbnailVariant="thumb-640" className="h-full w-full object-cover" containerClassName="h-full w-full" onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight) setImageRatio(previous => previous && previous.src === imageSrc && previous.value === naturalWidth / naturalHeight ? previous : { src: imageSrc, value: naturalWidth / naturalHeight });
      }} /> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 pt-3 text-center text-gray-500 dark:text-gray-400" style={{ paddingBottom: 'calc(var(--image-card-caption-height, 0px) + .75rem)' }}>
        {combination ? <Layers className="h-8 w-8 shrink-0" /> : <FileText className="h-8 w-8 shrink-0" />}
        <p className="mt-2 min-h-0 line-clamp-3 break-words text-xs leading-5">{summary || chain.basePrompt || t('还没有提示词')}</p>
      </div>}
      {onDelete && <div data-card-action data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20"><button type="button" disabled={deleteDisabled} aria-label={t('删除「{0}」', [name])} title={t('删除')} onClick={event => { event.stopPropagation(); onDelete(); }} className="mobile-size-locked inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 md:h-8 md:w-8">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div>}
      {showClearCover && <div data-card-action data-image-action-left className={`absolute left-2 z-20 ${onDelete ? 'top-14 md:top-11' : 'top-2'}`} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <button type="button" aria-label={t('删除当前封面')} title={t('删除当前封面')} disabled={busy || coverBusy || clearing || deleteDisabled}
          onClick={() => void clearCover()} className={`${IMAGE_CARD_ACTION_CLASS} hover-reveal-md flex items-center justify-center`}>
          <span className="relative" aria-hidden="true"><ImageIcon className="h-4 w-4" /><Trash2 className="appearance-contrast absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-gray-900 p-px" /></span>
        </button>
      </div>}
      {mediaInfo}
      {onGenerateCover && onManageCoverGeneration && <PromptLibraryCoverGenerationStatus chainId={chain.id} generation={coverGeneration} busy={coverBusy} hasCover={Boolean(chain.previewImage)} onRetryGenerate={onGenerateCover} manageGeneration={onManageCoverGeneration} />}
      <ImageCardActions>
        {chain.previewImage && <ImageShareActions variant="card" className="flex-col" showTransfer={false} imageUrl={chain.previewImage} filename={`${name}.png`} notify={notify} favorite={{ imageUrl: chain.previewImage, title: name, sourceType: 'other', sourceId: chain.id }} />}
        {onGenerateCover && <PromptLibraryCoverGenerateButton hasCover={Boolean(chain.previewImage)} disabled={busy || coverBusy || coverDisabled} onClick={onGenerateCover} />}
        {actions}
      </ImageCardActions>
    </div>
    <div className="gallery-card-caption min-w-0 p-3">
      {/* 有无封面都占住两行摘要高度，避免瀑布流卡片高低不齐；无封面正文仍只在媒体区展示一次。名称紧贴底部用途／标签，目录路径留给详情与侧栏。 */}
      <p className={`line-clamp-2 min-h-10 break-words text-xs leading-5 ${chain.previewImage && summary ? 'text-gray-600 dark:text-gray-300' : 'invisible'}`} aria-hidden={!chain.previewImage || !summary}>{chain.previewImage ? summary : '\u00a0'}</p>
      <h3 data-safe-mode-title className="mt-2 min-w-0 truncate text-sm font-bold text-gray-800 dark:text-gray-100">{title ?? name}</h3>
      <div className="gallery-card-meta mt-1.5 flex min-w-0 flex-wrap gap-1">{tagContent ?? getCustomChainTags(chain.tags).slice(0, 3).map(tag => <span key={tag} className="gallery-card-badge max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400">{tag}</span>)}</div>
    </div>
  </PressRevealSurface>;
}

export function PromptLibraryGallery({ chains, scrollRef, fitColumns = false, resetKey, renderCard }: {
  chains: PromptChain[]; scrollRef: React.RefObject<HTMLDivElement | null>; fitColumns?: boolean; resetKey: string; renderCard: (chain: PromptChain) => React.ReactNode;
}) {
  const preferences = useMobileImageDisplayPreferences();
  const columns = useMasonryColumnCount(preferences, undefined, scrollRef, 180, fitColumns);
  return preferences.layout === 'masonry'
    ? <ShortestColumnMasonry items={chains} columns={columns} resetKey={resetKey} getItemKey={chain => chain.id} estimateItemHeight={(_chain, width) => width * 1.5 + 80} renderItem={renderCard} />
    : <div className={`${mobileGalleryClassName(preferences)} workspace-card-grid workspace-character-grid items-start`} style={mobileGalleryStyle(preferences, columns)}>{chains.map(chain => <React.Fragment key={chain.id}>{renderCard(chain)}</React.Fragment>)}</div>;
}
