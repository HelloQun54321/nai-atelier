import { t, useLanguage } from '../services/i18n';
import React, { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Check, Image, ImageMinus, ListX, LoaderCircle, Palette, Upload } from 'lucide-react';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import type { CollectionTarget } from '../services/collectionFavorites';
import type { ImageGenerationData } from '../services/imageClipboardContext';

const IMAGE_PREVIEW_BUTTON_CLASS = `${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition disabled:cursor-wait disabled:opacity-50`;

/** 左右操作向内换列，为中间翻图和底部工具保留各自空间。 */
export function previewActionLayout(width: number, height: number, counts: number[], widths: number[], size: number, navigation: number, footer: number, gap = 8, inset = 16) {
  const count = Math.max(1, ...counts);
  const occupiedWidth = (rows: number) => counts.reduce((total, items, index) => {
    const columns = Math.ceil(items / rows);
    return total + (columns ? columns * widths[index] + (columns - 1) * gap : 0);
  }, inset * 2 + gap);
  let minRows = 1;
  while (minRows < count && occupiedWidth(minRows) > width) minRows++;
  const available = navigation ? height / 2 - navigation / 2 - gap - inset : height - inset * 2 - footer;
  const rows = Math.max(minRows, Math.min(count, Math.floor((available + gap) / (size + gap))));
  const needed = inset + minRows * (size + gap) - gap;
  const minHeight = navigation ? 2 * (Math.max(needed, footer + inset) + gap + navigation / 2) : needed + inset + footer;
  return { rows, minHeight };
}

interface Props {
  imageUrl?: string | null;
  filename: string;
  generationData?: ImageGenerationData;
    favorite?: CollectionTarget;
  notify?: (message: string, type?: 'success' | 'error') => void;
  canManageHistoryGroup?: boolean;
  onRemoveCurrentHistory?: () => void;
  onClearHistoryGroup?: () => void;
  onSetCover?: () => void;
  onUploadCover?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading?: boolean;
  onSaveArtistSample?: () => void;
  savingArtistSample?: boolean;
  onBack?: () => void;
  backButtonRef?: React.Ref<HTMLButtonElement>;
}

/** 小图与大图共用操作位置、紧凑尺寸及权限，仅大图增加返回入口。 */
export const ImagePreviewActions: React.FC<Props> = ({
  imageUrl, filename, generationData, favorite, notify, canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
  onSetCover, onUploadCover, isUploading = false, onSaveArtistSample, savingArtistSample = false, onBack, backButtonRef,
}) => {
  useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const visibility = onBack ? 'hover-reveal-md' : 'hover-reveal-lg';
  useLayoutEffect(() => {
    const stage = actionsRef.current?.parentElement;
    if (!stage) return;
    const root = actionsRef.current!;
    const surface = stage.closest('[role="dialog"]') || stage;
    let groups: HTMLElement[] = [], items: HTMLButtonElement[][] = [], navigation: HTMLElement[] = [], footers: HTMLElement[] = [];
    let observed = new Set<HTMLElement>();
    const originalRows = new Map<HTMLElement, string>();
    const originalMinHeight = stage.style.minHeight;
    const update = () => {
      if (!items.flat().length) {
        if (stage.style.minHeight !== originalMinHeight) stage.style.minHeight = originalMinHeight;
        return;
      }
      const size = Math.max(0, ...items.flat().map(item => item.offsetHeight));
      if (!size || !stage.clientWidth || !stage.clientHeight) return;
      const footer = Math.max(0, ...footers.map(item => item.offsetHeight ? item.offsetHeight + (parseFloat(getComputedStyle(item).bottom) || 0) : 0));
      const style = getComputedStyle(groups[0]);
      const layout = previewActionLayout(stage.clientWidth, stage.clientHeight, items.map(group => group.length), items.map(group => Math.max(0, ...group.map(item => item.offsetWidth))), size, Math.max(0, ...navigation.map(item => item.offsetHeight)), footer, parseFloat(style.rowGap) || 8, parseFloat(style.top) || 16);
      groups.forEach((group, index) => {
        const rows = `repeat(${Math.min(layout.rows, items[index].length)}, ${size}px)`;
        if (group.style.gridTemplateRows !== rows) group.style.gridTemplateRows = rows;
      });
      const minHeight = originalMinHeight ? `max(${originalMinHeight}, ${layout.minHeight}px)` : `${layout.minHeight}px`;
      if (stage.style.minHeight !== minHeight) stage.style.minHeight = minHeight;
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    // 回调与忙碌图标不影响排布，只同步真正参与测量的节点。
    const syncTargets = () => {
      groups = [...root.querySelectorAll<HTMLElement>('.image-preview-action-group')];
      items = groups.map(group => [...group.querySelectorAll<HTMLButtonElement>('button')]);
      navigation = [...stage.querySelectorAll<HTMLElement>('[data-image-preview-navigation]')];
      footers = [...surface.querySelectorAll<HTMLElement>('[data-image-preview-footer]')];
      const next = new Set([stage, ...groups, ...items.flat(), ...navigation, ...footers]);
      if (next.size === observed.size && [...next].every(element => observed.has(element))) return;
      for (const [group, rows] of originalRows) if (!groups.includes(group)) {
        group.style.gridTemplateRows = rows;
        originalRows.delete(group);
      }
      for (const group of groups) if (!originalRows.has(group)) originalRows.set(group, group.style.gridTemplateRows);
      for (const element of observed) if (!next.has(element)) observer?.unobserve(element);
      for (const element of next) if (!observed.has(element)) observer?.observe(element);
      observed = next;
      update();
    };
    syncTargets();
    const mutation = new MutationObserver(syncTargets);
    mutation.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-image-preview-navigation', 'data-image-preview-footer'] });
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', update);
      stage.style.minHeight = originalMinHeight;
      for (const [group, rows] of originalRows) group.style.gridTemplateRows = rows;
    };
  }, []);
  return <div ref={actionsRef} className="contents">
    {(onBack || (imageUrl && canManageHistoryGroup)) && <div data-card-action="true" className="image-preview-action-group pointer-events-none absolute top-4 left-4 z-30 gap-2" onClick={event => event.stopPropagation()}>
      {onBack && <button data-agent-action="browse" ref={backButtonRef} type="button" onClick={onBack} aria-label={t("返回小图")} title={t("返回小图")} className={`${IMAGE_PREVIEW_BUTTON_CLASS} pointer-events-auto !h-12 !w-12`}>
        <ArrowLeft className="h-7 w-7" aria-hidden="true" />
      </button>}
      {imageUrl && canManageHistoryGroup && <>
        <button type="button" onClick={() => onRemoveCurrentHistory?.()} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS} !bg-red-600/90 hover:!bg-red-500`} aria-label={t("移除当前图片")} title={t("移除当前图片，历史页仍会保留")}><ImageMinus className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" onClick={() => onClearHistoryGroup?.()} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS} !bg-gray-900/85 hover:!bg-gray-800`} aria-label={t("清空当前历史组")} title={t("清空当前历史组，历史页仍会保留")}><ListX className="h-4 w-4" aria-hidden="true" /></button>
      </>}
    </div>}
    {imageUrl && <div data-card-action="true" className="image-preview-action-group image-preview-action-group-right absolute top-4 right-4 z-30 gap-2" onClick={event => event.stopPropagation()}>
      <ImageShareActions imageUrl={imageUrl} generationData={generationData} favorite={favorite} filename={filename} notify={notify} variant="card" className="flex-col" revealClassName={visibility} />
      {onSaveArtistSample && <button type="button" onClick={onSaveArtistSample} disabled={savingArtistSample} aria-busy={savingArtistSample} aria-label={t('保存为画师样张')} title={t('保存为画师样张')} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS}`}>
        {savingArtistSample ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
      </button>}
      {onSetCover && <button type="button" onClick={onSetCover} disabled={isUploading} aria-busy={isUploading} aria-label={t("设为封面")} title={isUploading ? t("封面处理中…") : t("设为封面并保存")} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS} !bg-indigo-600/90 hover:!bg-indigo-600`}>
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="relative h-4 w-4" aria-hidden="true"><Image className="h-4 w-4" /><Check className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-indigo-600" strokeWidth={3} /></span>}
      </button>}
    </div>}
    {onUploadCover && <div data-card-action="true" data-image-preview-footer className={`absolute bottom-4 right-4 z-30 ${visibility}`} onClick={event => event.stopPropagation()}>
      <input aria-label={t("上传作品封面")} type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onUploadCover} />
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} aria-busy={isUploading} aria-label={t("手动上传封面")} title={isUploading ? t("封面处理中…") : t("手动上传封面并保存")} className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-gray-800/80 hover:!bg-gray-700`}>
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>}
  </div>;
};
