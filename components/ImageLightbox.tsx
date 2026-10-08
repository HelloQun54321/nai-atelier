import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Maximize, Minus, Plus } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { OriginalImage } from './SmartImage';
import { ImageShareOverlay, IMAGE_CARD_ACTION_CLASS } from './ImageShareActions';
import { PressRevealSurface } from './PressRevealSurface';
import { useImageViewport } from './useImageViewport';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import type { ImageGenerationData } from '../services/imageClipboardContext';

export const ImageLightbox:React.FC<React.PropsWithChildren<{
  src:string;alt?:string;filename?:string;generationData?:ImageGenerationData;
  notify?:(message:string,type?:'success'|'error')=>void;
  onClose:()=>void;onSwipe?:(delta:number)=>void;customActions?:boolean;
}>>=({src,alt='图片预览',filename='image.png',generationData,notify,onClose,onSwipe,customActions=false,children})=>{
  useLanguage();
  const dialog=useModalA11y<HTMLDivElement>(true);
  const close=useMobileHistoryLayer(true,onClose,'image-zoom');
  const view=useImageViewport(src,undefined,onSwipe);
  useEffect(()=>{
    if(customActions)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&isTopmostModal(dialog.current)){event.preventDefault();close();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  return <ImagePreviewPortal><div ref={dialog} role="dialog" aria-modal="true" aria-label={t("图片预览")} className="fixed inset-0 z-[1500] overflow-hidden bg-black/90 backdrop-blur-sm">
    <PressRevealSurface elementRef={view.stageRef} pressResetKey={src} {...view.handlers} aria-label={t("图片平移与缩放")} className="absolute inset-0 overflow-hidden touch-none" onClick={event=>{if(event.target===event.currentTarget)close();}}>
      <OriginalImage src={src} alt={alt} draggable={false} style={view.imageStyle} onLoad={view.onLoad} data-safe-mode-ignore="true" />
      {!customActions&&<>
        <button type="button" data-card-action="true" aria-label={t("返回图片详情")} className={`${IMAGE_CARD_ACTION_CLASS} absolute left-4 top-4 z-30 flex items-center justify-center`} onClick={close}><ArrowLeft className="h-5 w-5" /></button>
        <ImageShareOverlay imageUrl={src} filename={filename} generationData={generationData} notify={notify} className="!top-4 !right-4" />
      </>}
      {children}
    </PressRevealSurface>
    <div data-card-action="true" className="absolute inset-x-0 bottom-3 z-40 flex items-center justify-center gap-2 text-white" onPointerDown={event=>event.stopPropagation()}>
      <button type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("缩小图片")} disabled={view.zoom<=1} onClick={()=>view.zoomAt(view.zoom/1.25)}><Minus className="mx-auto h-4 w-4" /></button>
      <span className="w-12 text-center text-xs tabular-nums" aria-label={t("图片缩放比例")}>{Math.round(view.fit*view.zoom*100)}%</span>
      <button type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("放大图片")} disabled={view.zoom>=view.maxZoom} onClick={()=>view.zoomAt(view.zoom*1.25)}><Plus className="mx-auto h-4 w-4" /></button>
      <button type="button" className={IMAGE_CARD_ACTION_CLASS} aria-label={t("适应窗口")} onClick={view.reset}><Maximize className="mx-auto h-4 w-4" /></button>
    </div>
  </div></ImagePreviewPortal>;
};

/** 详情原图点按进入同一大图查看器，原有详情滚动与分享控件仍留在原位。 */
export const ViewableImage:React.FC<React.ImgHTMLAttributes<HTMLImageElement>&{src:string;filename?:string;generationData?:ImageGenerationData;notify?:(message:string,type?:'success'|'error')=>void}>=({filename,generationData,notify,onClick,...props})=>{
  useLanguage();
  const [open,setOpen]=useState(false);
  return <><button type="button" className="contents [&:focus-visible>img]:outline-2 [&:focus-visible>img]:outline-indigo-500" aria-label={t("放大查看：{0}", [props.alt||'图片'])} onClick={event=>{event.stopPropagation();setOpen(true);}}><OriginalImage {...props} draggable={false} onClick={onClick} /></button>
    {open&&<ImageLightbox src={props.src} alt={props.alt} filename={filename} generationData={generationData} notify={notify} onClose={()=>setOpen(false)} />}</>;
};
