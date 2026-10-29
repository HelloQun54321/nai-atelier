import React, { useState } from 'react';
import { Copy, FileText, Layers, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
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
import { ToolbarButton } from './DesignSystem';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';

/** 主浏览和管理入口共用封面、操作分区及信息栏。 */
export function PromptLibraryCard({ chain, label, title, summary, tagContent, openLabel, selected = false, dimmed = false, busy = false, deleteDisabled = busy, editDisabled = busy, onOpen, onEdit, onCopy, onDelete, onUse, actions, mediaInfo, notify }: {
  chain: PromptChain; label: string; title?: React.ReactNode; summary?: React.ReactNode; tagContent?: React.ReactNode; openLabel?: string;
  selected?: boolean; dimmed?: boolean; busy?: boolean; deleteDisabled?: boolean; editDisabled?: boolean;
  onOpen: () => void; onEdit?: () => void; onCopy?: () => void; onDelete?: () => void; onUse?: () => void;
  actions?: React.ReactNode; mediaInfo?: React.ReactNode; notify: (message: string, kind?: 'success' | 'error') => void;
}) {
  const frosted = useGalleryFrostedCaption();
  const [imageRatio, setImageRatio] = useState<{ src: string; value: number }>();
  const ratio = imageRatio && imageRatio.src === chain.previewImage ? imageRatio.value : 2 / 3;
  const name = chain.name?.trim() || t('未命名');
  const section = librarySectionOf(chain);
  const combination = section === 'saved';
  return <PressRevealSurface as="article" data-agent-action="browse" role="button" tabIndex={0} aria-label={openLabel || t('查看{0}', [name])} aria-pressed={selected} aria-busy={busy} aria-disabled={busy} pressDisabled={busy}
    data-prompt-library-entry={chain.id} data-prompt-library-id={chain.id} data-return-item-id={chain.id} data-gallery-work-id={chain.id} data-safe-mode-work="true"
    className={`appearance-group gallery-image-card gallery-card-visual group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition-[filter,border-color] focus-visible:outline-2 focus-visible:outline-indigo-500 dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 dark:border-gray-800'} ${dimmed ? 'brightness-[.7]' : ''}`}
    style={{ display: frosted ? 'grid' : undefined }} onClick={() => { if (!busy) onOpen(); }} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!busy) onOpen(); } }}>
    <div className={`appearance-media mobile-gallery-frame relative aspect-[2/3] w-full overflow-hidden ${chain.previewImage ? '' : 'bg-gray-100 dark:bg-gray-800'}`} style={{ '--mobile-image-ratio': ratio } as React.CSSProperties}>
      {chain.previewImage ? <SmartImage src={chain.previewImage} alt={name} thumbnailVariant="thumb-640" className="h-full w-full object-cover" containerClassName="h-full w-full" onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight) setImageRatio(previous => previous && previous.src === chain.previewImage && previous.value === naturalWidth / naturalHeight ? previous : { src: chain.previewImage!, value: naturalWidth / naturalHeight });
      }} /> : <div className="absolute inset-0 flex flex-col items-center justify-center px-3 pt-3 text-center text-gray-500 dark:text-gray-400" style={{ paddingBottom: 'calc(var(--image-card-caption-height, 0px) + .75rem)' }}>
        {combination ? <Layers className="h-8 w-8 shrink-0" /> : <FileText className="h-8 w-8 shrink-0" />}
        <p className="mt-2 min-h-0 line-clamp-3 break-words text-xs leading-5">{summary || chain.basePrompt || t('还没有提示词')}</p>
      </div>}
      {onDelete && <div data-card-action data-image-action-left className="hover-reveal-md absolute left-2 top-2 z-20"><button type="button" disabled={deleteDisabled} aria-label={t('删除「{0}」', [name])} title={t('删除')} onClick={event => { event.stopPropagation(); onDelete(); }} className="mobile-size-locked inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 md:h-8 md:w-8">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div>}
      {mediaInfo}
      <ImageCardActions>
        {chain.previewImage && <ImageShareActions variant="card" className="flex-col" imageUrl={chain.previewImage} filename={`${name}.png`} notify={notify} favorite={{ imageUrl: chain.previewImage, title: name, sourceType: 'other', sourceId: chain.id }} />}
        {onEdit && <button data-card-action type="button" disabled={editDisabled} aria-label={t('编辑{0}', [name])} title={t('编辑')} onClick={event => { event.stopPropagation(); onEdit(); }} className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}><Pencil className="h-4 w-4" /></button>}
        {onCopy && <button data-card-action type="button" disabled={busy} aria-label={combination ? t('复制组合数据') : t('复制{0}', [name])} title={t(combination ? '复制组合数据' : '复制提示词')} onClick={event => { event.stopPropagation(); onCopy(); }} className={`hover-reveal-md inline-flex items-center justify-center ${IMAGE_CARD_ACTION_CLASS}`}><Copy className="h-4 w-4" /></button>}
        {actions}
      </ImageCardActions>
    </div>
    <div className="gallery-card-caption min-w-0 p-3">
      <div className="flex items-center justify-between gap-2"><h3 data-safe-mode-title className="min-w-0 truncate text-sm font-bold text-gray-800 dark:text-gray-100">{title ?? name}</h3><span title={label} className="gallery-card-badge max-w-[45%] truncate rounded px-1.5 py-0.5 text-micro text-indigo-600 dark:text-indigo-300">{label}</span></div>
      {chain.previewImage && summary && <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-gray-600 dark:text-gray-300">{summary}</p>}
      <div className="gallery-card-meta mt-2 flex items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap gap-1">{tagContent ?? getCustomChainTags(chain.tags).slice(0, 3).map(tag => <span key={tag} className="gallery-card-badge max-w-24 truncate rounded bg-gray-100 px-1.5 py-0.5 text-micro text-gray-500 dark:bg-gray-800 dark:text-gray-400">{tag}</span>)}</div>
        {onUse && section !== 'items' && <ToolbarButton data-card-action tone="primary" disabled={busy} onClick={event => { event.stopPropagation(); onUse(); }}>{t('送到实验室')}</ToolbarButton>}
      </div>
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
