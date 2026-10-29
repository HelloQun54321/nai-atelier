import React, { memo } from 'react';
import { Trash2 } from 'lucide-react';
import type { Inspiration, User } from '../../types';
import { collectionGroupKey, getCollectionPreviewTransform } from '../../services/inspirationUtils';
import { getMobileOriginalUrl } from '../../services/mobileImageCache';
import { t, useLanguage } from '../../services/i18n';
import { MediaCardShell } from '../DesignSystem';
import { SmartImage } from '../SmartImage';
import { ImageShareOverlay } from '../ImageShareActions';
import { canEditItem } from './InspirationShared';

interface Props {
  group: Inspiration[];
  currentUser: User;
  selectedCount: number;
  focused: boolean;
  selectionMode: boolean;
  busy: boolean;
  frostedCaption: boolean;
  masonry: boolean;
  imageRatio?: number;
  notify: (message: string, type?: 'success' | 'error') => void;
  onOpen: (key: string) => void;
  onToggle: (ids: string[]) => void;
  onDelete: (ids: string[]) => Promise<void>;
  onImageRatio: (id: string, width: number, height: number) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, ids: string[], selected: boolean) => void;
  onDragEnd: () => void;
}

/** 详情开关只更新被选中的卡片，其余图片与操作组件保留。 */
export const CollectionCard = memo(function CollectionCard({ group, currentUser, selectedCount, focused, selectionMode, busy, frostedCaption, masonry, imageRatio, notify, onOpen, onToggle, onDelete, onImageRatio, onDragStart, onDragEnd }: Props) {
  useLanguage();
  const item = group[0], ids = group.map(image => image.id);
  const key = collectionGroupKey(item), editable = canEditItem(item, currentUser);
  const isGroup = group.length > 1 || Boolean(item.sourceId && ['aitag', 'pixiv', 'codex', 'codex-community'].includes(item.sourceType || '') && Number(item.analysis?.collectionGroupSize) > 1);
  const title = isGroup ? item.title.replace(/ · \d+$/, '') : item.title;
  const selected = selectedCount === ids.length, partial = selectedCount > 0 && !selected;
  const ratio = imageRatio || (item.params?.width && item.params?.height ? item.params.width / item.params.height : 832 / 1216);
  const activate = () => selectionMode ? onToggle(ids) : onOpen(key);
  return <MediaCardShell pressReveal pressDisabled={selectionMode} style={{ contentVisibility: 'visible' }} data-safe-mode-work="true" data-gallery-work-id={key} data-collection-active={focused || undefined} selected={selected || partial || focused} className="collection-work-card gallery-image-card gallery-card-visual group relative flex flex-col transition-[filter,box-shadow,border-color] duration-150"
    draggable={editable && !busy}
    onDragStart={event => {
      if (busy || ['touch', 'pen'].includes(event.currentTarget.dataset.pressInput || '') || !editable || (event.target as Element).closest('[data-card-action]')) { event.preventDefault(); return; }
      onDragStart(event, ids, selected);
    }} onDragEnd={onDragEnd}>
    <div className="mobile-gallery-frame relative overflow-hidden md:aspect-square" style={{ '--mobile-image-ratio': `${ratio}` } as React.CSSProperties}>
      <button type="button" title={editable ? t('拖动到收藏夹') : undefined} data-agent-action={selectionMode ? undefined : 'browse'} disabled={selectionMode && (busy || !editable)} onClick={activate} className="absolute inset-0 block h-full w-full text-left">{item.imageUrl ? <SmartImage src={item.imageUrl} previewTransform={getCollectionPreviewTransform(item)} alt={title} thumbnailVariant="thumb-320" className={masonry && !imageRatio ? 'h-full w-full object-contain' : undefined} onLoad={event => onImageRatio(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /> : <span className="flex h-full min-h-40 items-center justify-center text-xs text-gray-400">{t('暂无样张')}</span>}</button>
      {!frostedCaption && <span className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-black/65 px-2 py-1 text-xs font-bold text-white">{t('{0}页', [group.length])}</span>}
      {selectionMode && currentUser.role !== 'guest' && editable && <button data-card-action="true" type="button" aria-pressed={partial ? 'mixed' : selected} title={partial ? t('部分选中') : undefined} disabled={busy} onClick={() => onToggle(ids)} className={`mobile-size-locked absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold shadow backdrop-blur transition ${selected || partial ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'}`} aria-label={t('选择收藏')}>{selected ? '✓' : partial ? '−' : ''}</button>}
      {!selectionMode && editable && <button data-card-action="true" data-image-action-left type="button" aria-label={t('删除收藏')} title={t('删除')} disabled={busy} onClick={event => { event.stopPropagation(); void onDelete(ids); }} className="hover-reveal-md mobile-size-locked absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 md:h-8 md:w-8"><Trash2 className="h-4 w-4" /></button>}
      {!selectionMode && item.imageUrl && <ImageShareOverlay imageUrl={getMobileOriginalUrl(item.imageUrl)} generationData={item.params ? { prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params } : undefined} filename={`${title || 'inspiration'}.png`} favorite={{ imageUrl: item.imageUrl, collectionId: item.id, ...(isGroup ? { sourceType: item.sourceType, sourceId: item.sourceId, groupSize: group.length, getGroup: async () => group.map(image => ({ ...image, collectionId: image.id })) } : {}) }} notify={notify} />}
    </div>
    <button type="button" data-agent-action={selectionMode ? undefined : 'browse'} disabled={selectionMode && (busy || !editable)} onClick={activate} className="gallery-card-caption min-w-0 flex-1 p-3 text-left"><div className="flex items-start gap-2"><h3 data-safe-mode-title="true" className="min-w-0 flex-1 truncate text-sm font-black text-gray-950 dark:text-white">{title}</h3>{frostedCaption && <span className="gallery-card-meta flex-none text-micro">{t('{0}页', [group.length])}</span>}</div>{(item.tags || []).length > 0 && <div className="mt-2 flex gap-1 overflow-hidden">{item.tags?.slice(0, 3).map(tag => <span key={tag} className="gallery-card-badge max-w-24 truncate rounded-md bg-gray-100 px-1.5 py-0.5 text-mini font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">#{tag}</span>)}{(item.tags?.length || 0) > 3 && <span className="text-mini text-gray-400">+{(item.tags?.length || 0) - 3}</span>}</div>}</button>
  </MediaCardShell>;
});
