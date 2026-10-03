import React, { useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ImageShareActions } from './ImageShareActions';
import type { ImageGenerationData } from '../services/imageClipboardContext';

const IMAGE_PREVIEW_BUTTON_CLASS = 'inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium leading-4 whitespace-nowrap disabled:opacity-50';

interface Props {
  imageUrl?: string | null;
  filename: string;
  generationData?: ImageGenerationData;
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
  imageUrl, filename, generationData, notify, canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
  onSetCover, onUploadCover, isUploading = false, onBack, backButtonRef,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibility = onBack ? '' : 'opacity-100 lg:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity';
  return <>
    {(onBack || (imageUrl && canManageHistoryGroup)) && <div className={`absolute top-4 left-4 z-30 flex flex-col items-start ${onBack ? 'gap-6' : 'gap-2'} ${visibility}`} onClick={event => event.stopPropagation()}>
      {onBack && <button ref={backButtonRef} type="button" onClick={onBack} aria-label="返回小图" title="返回小图" className="mobile-touch inline-flex h-12 w-12 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-black/85">
        <ArrowLeft className="h-7 w-7" aria-hidden="true" />
      </button>}
      {imageUrl && canManageHistoryGroup && <>
        <button type="button" onClick={() => onRemoveCurrentHistory?.()} className={`${IMAGE_PREVIEW_BUTTON_CLASS} bg-red-600/90 text-white shadow-lg backdrop-blur hover:bg-red-500`} title="从当前风格串历史组移除这张图，历史页仍会保留">删除</button>
        <button type="button" onClick={() => onClearHistoryGroup?.()} className={`${IMAGE_PREVIEW_BUTTON_CLASS} bg-gray-900/85 text-white shadow-lg backdrop-blur hover:bg-gray-800`} title="清空当前风格串历史组，历史页仍会保留">清除</button>
      </>}
    </div>}
    {imageUrl && <div className={`absolute top-4 right-4 z-30 flex flex-col items-stretch gap-2 ${visibility}`} onClick={event => event.stopPropagation()}>
      <ImageShareActions imageUrl={imageUrl} generationData={generationData} filename={filename} notify={notify} variant="overlay" className="flex-col" />
      {onSetCover && <button type="button" onClick={onSetCover} disabled={isUploading} className={`${IMAGE_PREVIEW_BUTTON_CLASS} bg-indigo-600/90 text-white hover:bg-indigo-600`}>{isUploading ? '上传中...' : '设为封面'}</button>}
    </div>}
    {onUploadCover && <div className={`absolute bottom-4 right-4 z-30 ${visibility}`} onClick={event => event.stopPropagation()}>
      <input aria-label="上传作品封面" type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={onUploadCover} />
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className={`${IMAGE_PREVIEW_BUTTON_CLASS} bg-gray-800/80 text-white shadow-lg backdrop-blur hover:bg-gray-700`}>{isUploading ? '上传中...' : '手动上传'}</button>
    </div>}
  </>;
};
