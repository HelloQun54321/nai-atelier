import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minus, Plus } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { OriginalImage } from './SmartImage';
import { ImageShareOverlay, IMAGE_CARD_ACTION_CLASS } from './ImageShareActions';
import { PressRevealSurface } from './PressRevealSurface';
import { useImageViewport } from './useImageViewport';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import type { ImageGenerationData } from '../services/imageClipboardContext';
import type { CollectionTarget } from '../services/collectionFavorites';
import { buildMediaUrl, type MediaPreviewTransform } from '../services/mobileImageCache';

export const ImageLightbox:React.FC<React.PropsWithChildren<{
  src:string;alt?:string;filename?:string;generationData?:ImageGenerationData;favorite?:CollectionTarget;
  notify?:(message:string,type?:'success'|'error')=>void;
  onClose:()=>void;onSwipe?:(delta:number)=>void;customActions?:boolean;hideShareActions?:boolean;
  pager?: { index: number; count: number; onChange: (index: number) => void };
  zIndex?: number;
}>>=({src,alt='图片预览',filename='image.png',generationData,favorite,notify,onClose,onSwipe,customActions=false,hideShareActions=false,pager,children,zIndex})=>{
  useLanguage();
  const dialog=useModalA11y<HTMLDivElement>(true);
  const close=useMobileHistoryLayer(true,onClose,'image-zoom');
  const [failedSrc,setFailedSrc]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const failed=failedSrc===src;
  const navigate=(delta:number)=>{
    if(!pager){onSwipe?.(delta);return;}
    const next=pager.index+delta;
    if(next>=0&&next<pager.count)pager.onChange(next);
  };
  const view=useImageViewport(src,undefined,navigate);
  useEffect(()=>{
    if(customActions)return;
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||!isTopmostModal(dialog.current))return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]')))return;
      if(pager&&pager.count>1&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1);}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  return <ImagePreviewPortal><div ref={dialog} role="dialog" aria-modal="true" aria-label={t("图片预览")} style={{ zIndex }} className="fixed inset-0 z-[1500] overflow-hidden bg-black/90 backdrop-blur-sm">
    <PressRevealSurface elementRef={view.stageRef} pressResetKey={src} {...view.handlers} aria-label={t("图片平移与缩放")} className="absolute inset-0 overflow-hidden touch-none" onClick={event=>{if(event.target===event.currentTarget)close();}}>
      <OriginalImage key={`${src}:${retry}`} src={src} alt={alt} draggable={false} style={{...view.imageStyle,visibility:failed?'hidden':undefined}} onLoad={event=>{view.onLoad(event);setFailedSrc(null);}} onError={()=>setFailedSrc(src)} data-safe-mode-ignore="true" />
      {failed&&<button type="button" data-card-action="true" className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/75 px-4 py-3 text-sm text-white" onClick={()=>{setFailedSrc(null);setRetry(value=>value+1);}}>{t('原图加载失败 · 重试')}</button>}
      {!customActions&&<>
        <button data-agent-action="browse" type="button" data-card-action="true" aria-label={t("返回图片详情")} className={`${IMAGE_CARD_ACTION_CLASS} absolute left-4 top-4 z-30 flex items-center justify-center`} onClick={close}><ArrowLeft className="h-5 w-5" /></button>
        {!hideShareActions&&<ImageShareOverlay imageUrl={src} filename={filename} generationData={generationData} favorite={favorite} notify={notify} className="!top-4 !right-4" />}
      </>}
      {children}
    </PressRevealSurface>
    <div data-card-action="true" data-image-preview-footer className="absolute inset-x-0 bottom-3 z-40 flex flex-col items-center justify-center gap-2 text-white" onPointerDown={event=>event.stopPropagation()}>
      {pager&&pager.count>1&&<div className="flex items-center gap-3">
        <button data-agent-action="browse" type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t('上一张图片')} disabled={pager.index<=0} onClick={()=>navigate(-1)}><ChevronLeft className="mx-auto h-4 w-4" /></button>
        <span aria-live="polite" className="min-w-16 rounded-full bg-black/60 px-3 py-1 text-center text-xs tabular-nums">{pager.index+1} / {pager.count}</span>
        <button data-agent-action="browse" type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t('下一张图片')} disabled={pager.index>=pager.count-1} onClick={()=>navigate(1)}><ChevronRight className="mx-auto h-4 w-4" /></button>
      </div>}
      <div className="flex items-center gap-2">
      <button data-agent-action="browse" type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("缩小图片")} disabled={view.zoom<=1} onClick={()=>view.zoomAt(view.zoom/1.25)}><Minus className="mx-auto h-4 w-4" /></button>
      <span className="w-12 text-center text-xs tabular-nums" aria-label={t("图片缩放比例")}>{Math.round(view.fit*view.zoom*100)}%</span>
      <button data-agent-action="browse" type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("放大图片")} disabled={view.zoom>=view.maxZoom} onClick={()=>view.zoomAt(view.zoom*1.25)}><Plus className="mx-auto h-4 w-4" /></button>
      <button data-agent-action="browse" type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("适应窗口")} onClick={view.reset}><Maximize className="mx-auto h-4 w-4" /></button>
      </div>
    </div>
  </div></ImagePreviewPortal>;
};

/** 详情原图点按进入同一大图查看器，原有详情滚动与分享控件仍留在原位。 */
export const ViewableImage:React.FC<React.ImgHTMLAttributes<HTMLImageElement>&{src:string;filename?:string;generationData?:ImageGenerationData;favorite?:CollectionTarget;previewTransform?:MediaPreviewTransform;notify?:(message:string,type?:'success'|'error')=>void}>=({filename,generationData,favorite,previewTransform,notify,onClick,...props})=>{
  useLanguage();
  const [open,setOpen]=useState(false);
  const previewSrc=previewTransform?buildMediaUrl(props.src,'thumb-960',previewTransform):props.src;
  return <><button data-agent-action="browse" type="button" className="contents [&:focus-visible>img]:outline-2 [&:focus-visible>img]:outline-indigo-500" aria-label={t("放大查看：{0}", [props.alt||'图片'])} onClick={event=>{event.stopPropagation();setOpen(true);}}><OriginalImage {...props} src={previewSrc} {...(previewTransform?{"data-agent-original-src":props.src}:{})} draggable={false} onClick={onClick} /></button>
    {open&&<ImageLightbox src={props.src} alt={props.alt} filename={filename} generationData={generationData} favorite={favorite} notify={notify} onClose={()=>setOpen(false)} />}</>;
};
