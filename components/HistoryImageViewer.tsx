import { t, useLanguage, getLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Info, LoaderCircle, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../types';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageShareActions } from './ImageShareActions';
import { OriginalImage } from './SmartImage';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import './historyViewer.css';
import { useImageViewport } from './useImageViewport';
export { clampImagePan } from './useImageViewport';

interface Props {
  item: LocalGenItem;
  index: number;
  total: number;
  navigating: boolean;
  favoritePending: boolean;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
  onNavigate: (delta: number) => void;
  onClose: () => void;
  onFavorite: () => Promise<void>;
  onDelete: () => void;
  filename: string;
  notify: (message: string, type?: 'success' | 'error') => void;
  children: React.ReactNode;
}

const imageSize = (item: LocalGenItem) => {
  const valid = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return { width: valid(item.params?.width, 832), height: valid(item.params?.height, 1216) };
};

/** 历史大图：保持同一浏览会话，缩放/手势仅操作视图，不修改原图或生成参数。 */
export const HistoryImageViewer: React.FC<Props> = props => {
  useLanguage();
  const { item, index, total, navigating, onNavigate, onClose } = props;
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const detailsRef = useRef<HTMLElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const view = useImageViewport(item.id, imageSize(item), delta => {
    if (!navigating && index + delta >= 0 && index + delta < total) onNavigate(delta);
  });
  const {stageRef,natural,zoom,fit,maxZoom,reset,zoomAt}=view;
  useEffect(() => {
    setImageFailed(false); setRetry(0);
    if (detailsRef.current) detailsRef.current.scrollTop=0;
  }, [item.id]);
  useEffect(() => {
    const keyDown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing||!isTopmostModal(dialogRef.current))return;
      if(event.key==='Escape'){event.preventDefault();onClose();return;}
      if((event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))||event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key==='ArrowLeft'&&!navigating&&index>0){event.preventDefault();onNavigate(-1);}
      else if(event.key==='ArrowRight'&&!navigating&&index<total-1){event.preventDefault();onNavigate(1);}
      else if(event.key==='0'){event.preventDefault();reset();}
      else if(event.key==='1'){event.preventDefault();zoomAt(1/fit);}
      else if(event.key==='+'||event.key==='='){event.preventDefault();zoomAt(zoom*1.25);}
      else if(event.key==='-'){event.preventDefault();zoomAt(zoom/1.25);}
    };
    window.addEventListener('keydown',keyDown);return()=>window.removeEventListener('keydown',keyDown);
  });

  return <ImagePreviewPortal>
    <div className="history-viewer-layer" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("历史图片查看器")} className={`history-viewer appearance-panel ${props.detailsOpen ? 'history-viewer--details' : ''}`} onClick={event => event.stopPropagation()}>
        <header className="history-viewer-header">
          <button type="button" className="history-viewer-button history-viewer-return" aria-label={t("返回历史列表")} onClick={onClose}><ArrowLeft /></button>
          <div className="history-viewer-caption"><span>{new Date(item.createdAt).toLocaleString(getLanguage())}</span><small>{getNaiModelDisplayLabel(item.params?.model)} · {natural.width} × {natural.height}{item.sourceChainName ? ` · ${item.sourceChainName}` : ''}</small></div>
          <span className="history-viewer-counter" aria-live="polite">{index + 1} / {total}</span>
          <button type="button" className="history-viewer-button" title={t("查看提示词与参数")} aria-label={t("图片详情")} aria-expanded={props.detailsOpen} onClick={() => props.onDetailsChange(!props.detailsOpen)}><Info /></button>
        </header>
        <div className="history-viewer-content">
          <div className="history-viewer-image-column">
            <PressRevealSurface elementRef={stageRef} pressResetKey={item.id} data-agent-interaction="pan" aria-label={t("历史图片平移与缩放")} className={`history-viewer-stage ${zoom > 1 ? 'history-viewer-stage--zoomed' : ''}`} {...view.handlers}>
              <OriginalImage key={`${item.id}:${retry}`} src={item.imageUrl} alt={t("历史生成图片预览")} draggable={false} data-safe-mode-ignore="true" className="history-viewer-image" style={view.imageStyle} onLoad={view.onLoad} onError={() => setImageFailed(true)} />
              {imageFailed && <button data-card-action="true" className="history-viewer-error" onClick={() => { setImageFailed(false); setRetry(value => value + 1); }}>{t("原图加载失败 · 重试")}</button>}
              <div data-card-action="true" className="hover-reveal-touch history-viewer-manage">
                <button className="history-viewer-button history-viewer-delete" aria-label={t("删除这张历史图片")} onClick={props.onDelete}><Trash2 /></button>
              </div>
              <ImageShareActions key={item.id} imageUrl={item.imageUrl} filename={props.filename} generationData={{ prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params }} notify={props.notify} variant="card" className="history-viewer-share" favorite={{ imageUrl: item.imageUrl, sourceType: 'history', sourceId: item.id }} favoriteActive={Boolean(item.isFavorite)} favoritePending={props.favoritePending} onToggleFavorite={props.onFavorite} />
              <button data-card-action="true" className="hover-reveal-touch history-viewer-button history-viewer-previous" aria-label={t("上一张图片")} disabled={index <= 0 || navigating} onClick={() => onNavigate(-1)}><ChevronLeft /></button>
              <button data-card-action="true" className="hover-reveal-touch history-viewer-button history-viewer-next" aria-label={t("下一张图片")} disabled={index >= total - 1 || navigating} onClick={() => onNavigate(1)}><ChevronRight /></button>
              {navigating && <span role="status" className="history-viewer-loading"><LoaderCircle className="animate-spin" />{t("正在加载图片")}</span>}
            </PressRevealSurface>
            <footer className="history-viewer-zoom">
              <button className="history-viewer-button" aria-label={t("缩小图片")} disabled={zoom <= 1} onClick={() => zoomAt(zoom / 1.25)}><Minus /></button>
              <span aria-label={t("图片缩放比例")}>{Math.round(fit * zoom * 100)}%</span>
              <button className="history-viewer-button" aria-label={t("放大图片")} disabled={zoom >= maxZoom} onClick={() => zoomAt(zoom * 1.25)}><Plus /></button>
              <button className="history-viewer-button" onClick={reset} title={t("快捷键 0")}><Maximize />{t("适应窗口")}</button>
              <button className="history-viewer-button" onClick={() => zoomAt(1 / fit)} title={t("快捷键 1")}>100%</button>
            </footer>
          </div>
          {props.detailsOpen && <aside ref={detailsRef} className="history-viewer-details" aria-label={t("图片详情面板")}><div className="history-viewer-details-heading"><strong>{t("图片详情")}</strong><button className="history-viewer-button" aria-label={t("收起图片详情")} onClick={() => props.onDetailsChange(false)}><ChevronRight /></button></div>{props.children}</aside>}
        </div>
      </div>
    </div>
  </ImagePreviewPortal>;
};
