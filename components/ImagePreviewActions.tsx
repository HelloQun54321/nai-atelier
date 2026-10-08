import { t, useLanguage } from '../services/i18n';
import React, { useRef } from 'react';
import { ArrowLeft, Check, Image, ImageMinus, ListX, LoaderCircle, Upload } from 'lucide-react';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import type { CollectionTarget } from '../services/collectionFavorites';
import type { ImageGenerationData } from '../services/imageClipboardContext';

const IMAGE_PREVIEW_BUTTON_CLASS = `${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition disabled:cursor-wait disabled:opacity-50`;

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
  onBack?: () => void;
  backButtonRef?: React.Ref<HTMLButtonElement>;
}

/** 小图与大图共用操作位置、紧凑尺寸及权限，仅大图增加返回入口。 */
export const ImagePreviewActions: React.FC<Props> = ({
  imageUrl, filename, generationData, favorite, notify, canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
  onSetCover, onUploadCover, isUploading = false, onBack, backButtonRef,
}) => {
  useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibility = onBack ? 'hover-reveal-md' : 'hover-reveal-lg';
  return <>
    {(onBack || (imageUrl && canManageHistoryGroup)) && <div data-card-action="true" className={`pointer-events-none absolute top-4 left-4 z-30 flex flex-col items-start ${onBack ? 'gap-6' : 'gap-2'} ${onBack ? '' : visibility}`} onClick={event => event.stopPropagation()}>
      {onBack && <button ref={backButtonRef} type="button" onClick={onBack} aria-label={t("返回小图")} title={t("返回小图")} className={`${IMAGE_PREVIEW_BUTTON_CLASS} pointer-events-auto !h-12 !w-12`}>
        <ArrowLeft className="h-7 w-7" aria-hidden="true" />
      </button>}
      {imageUrl && canManageHistoryGroup && <div className={`flex flex-col gap-2 ${visibility}`}>
        <button type="button" onClick={() => onRemoveCurrentHistory?.()} className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-red-600/90 hover:!bg-red-500`} aria-label={t("移除当前图片")} title={t("移除当前图片，历史页仍会保留")}><ImageMinus className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" onClick={() => onClearHistoryGroup?.()} className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-gray-900/85 hover:!bg-gray-800`} aria-label={t("清空当前历史组")} title={t("清空当前历史组，历史页仍会保留")}><ListX className="h-4 w-4" aria-hidden="true" /></button>
      </div>}
    </div>}
    {imageUrl && <div data-card-action="true" className={`absolute top-4 right-4 z-30 flex flex-col items-center gap-2`} onClick={event => event.stopPropagation()}>
      <ImageShareActions imageUrl={imageUrl} generationData={generationData} favorite={favorite} filename={filename} notify={notify} variant="card" className="flex-col" revealClassName={visibility} />
      {onSetCover && <button type="button" onClick={onSetCover} disabled={isUploading} aria-busy={isUploading} aria-label={t("设为封面")} title={isUploading ? t("封面处理中…") : t("设为封面并保存")} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS} !bg-indigo-600/90 hover:!bg-indigo-600`}>
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="relative h-4 w-4" aria-hidden="true"><Image className="h-4 w-4" /><Check className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-indigo-600" strokeWidth={3} /></span>}
      </button>}
    </div>}
    {onUploadCover && <div data-card-action="true" className={`absolute bottom-4 right-4 z-30 ${visibility}`} onClick={event => event.stopPropagation()}>
      <input aria-label={t("上传作品封面")} type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onUploadCover} />
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} aria-busy={isUploading} aria-label={t("手动上传封面")} title={isUploading ? t("封面处理中…") : t("手动上传封面并保存")} className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-gray-800/80 hover:!bg-gray-700`}>
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>}
  </>;
};
