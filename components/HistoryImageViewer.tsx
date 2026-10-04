import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Heart, Info, LoaderCircle, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import type { LocalGenItem } from '../types';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { ImageShareActions } from './ImageShareActions';
import { OriginalImage } from './SmartImage';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import './historyViewer.css';

export const clampImagePan = (pan: { x: number; y: number }, width: number, height: number, box: { width: number; height: number }, zoom: number) => {
  const x = Math.max(0, (width * zoom - box.width) / 2);
  const y = Math.max(0, (height * zoom - box.height) / 2);
  return { x: Math.max(-x, Math.min(x, pan.x)), y: Math.max(-y, Math.min(y, pan.y)) };
};

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
  onFavorite: () => void;
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
  const { item, index, total, navigating, onNavigate, onClose } = props;
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ width: 800, height: 600 });
  const [natural, setNatural] = useState(() => imageSize(item));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageFailed, setImageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const fit = Math.min(box.width / natural.width, box.height / natural.height, 1);
  const width = natural.width * fit;
  const height = natural.height * fit;
  const maxZoom = Math.max(8, 1 / fit);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; pan: typeof pan; zoom: number; distance?: number; pinched?: boolean } | null>(null);
  const handlers = useRef({ onNavigate, onClose, navigating, index, total, zoomAt: (_zoom: number) => {}, reset: () => {}, original: () => {} });
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomAt = (requested: number, point = { x: 0, y: 0 }) => {
    const next = Math.max(1, Math.min(maxZoom, requested));
    const ratio = next / zoom;
    setPan(clampImagePan({ x: point.x - (point.x - pan.x) * ratio, y: point.y - (point.y - pan.y) * ratio }, width, height, box, next));
    setZoom(next);
  };
  handlers.current = { onNavigate, onClose, navigating, index, total, zoomAt, reset, original: () => zoomAt(1 / fit) };

  useEffect(() => {
    setZoom(1); setPan({ x: 0, y: 0 }); setImageFailed(false); setRetry(0);
    setNatural(imageSize(item));
    pointers.current.clear(); gesture.current = null;
    // 翻到另一张图时从详情操作区开始，避免沿用上一张长参数的滚动位置。
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  }, [item.id, item.params?.width, item.params?.height]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setBox({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPan(current => clampImagePan(current, width, height, box, zoom));
  }, [width, height, box, zoom]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (!isTopmostModal(dialogRef.current)) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  });
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopmostModal(dialogRef.current)) return;
      if (event.isComposing) return;
      const h = handlers.current;
      if (event.key === 'Escape') { event.preventDefault(); h.onClose(); return; }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!h.navigating && event.key === 'ArrowLeft' && h.index > 0) { event.preventDefault(); h.onNavigate(-1); }
      else if (!h.navigating && event.key === 'ArrowRight' && h.index < h.total - 1) { event.preventDefault(); h.onNavigate(1); }
      else if (event.key === '0') { event.preventDefault(); h.reset(); }
      else if (event.key === '1') { event.preventDefault(); h.original(); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); h.zoomAt(zoom * 1.25); }
      else if (event.key === '-') { event.preventDefault(); h.zoomAt(zoom / 1.25); }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [dialogRef, zoom]);

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') || (event.button !== 0 && event.button !== -1)) return;
    stageRef.current?.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const pinched = gesture.current?.pinched;
    gesture.current = points.length === 2
      ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2, pan, zoom, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), pinched: true }
      : { x: event.clientX, y: event.clientY, pan, zoom, pinched };
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const start = gesture.current;
    if (points.length === 2 && start.distance) {
      const next = Math.max(1, Math.min(maxZoom, start.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / start.distance));
      const rect = stageRef.current!.getBoundingClientRect();
      const origin = { x: start.x - rect.left - rect.width / 2, y: start.y - rect.top - rect.height / 2 };
      const mid = { x: (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2, y: (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2 };
      setZoom(next);
      setPan(clampImagePan({ x: mid.x - (origin.x - start.pan.x) * next / start.zoom, y: mid.y - (origin.y - start.pan.y) * next / start.zoom }, width, height, box, next));
    } else if (zoom > 1 && !start.pinched) {
      setPan(clampImagePan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y }, width, height, box, zoom));
    }
  };
  const pointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (event.type === 'pointerup' && pointers.current.size === 1 && start && !start.pinched && start.zoom === 1 && !navigating) {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0 && index < total - 1) onNavigate(1);
        if (dx > 0 && index > 0) onNavigate(-1);
      }
    }
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) gesture.current = null;
  };

  return <ImagePreviewPortal>
    <div className="history-viewer-layer" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="历史图片查看器" className={`history-viewer appearance-panel ${props.detailsOpen ? 'history-viewer--details' : ''}`} onClick={event => event.stopPropagation()}>
        <header className="history-viewer-header">
          <button type="button" className="history-viewer-button history-viewer-return" aria-label="返回历史列表" onClick={onClose}><ArrowLeft /></button>
          <div className="history-viewer-caption"><span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span><small>{getNaiModelDisplayLabel(item.params?.model)} · {natural.width} × {natural.height}{item.sourceChainName ? ` · ${item.sourceChainName}` : ''}</small></div>
          <span className="history-viewer-counter" aria-live="polite">{index + 1} / {total}</span>
          <button type="button" className="history-viewer-button" title="查看提示词与参数" aria-label="图片详情" aria-expanded={props.detailsOpen} onClick={() => props.onDetailsChange(!props.detailsOpen)}><Info /></button>
        </header>
        <div className="history-viewer-content">
          <div className="history-viewer-image-column">
            <div ref={stageRef} data-agent-interaction="pan" aria-label="历史图片平移与缩放" className={`history-viewer-stage ${zoom > 1 ? 'history-viewer-stage--zoomed' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) zoom === 1 ? zoomAt(1 / fit) : reset(); }}>
              <OriginalImage key={`${item.id}:${retry}`} src={item.imageUrl} alt="历史生成图片预览" draggable={false} data-safe-mode-ignore="true" className="history-viewer-image" style={{ width, height, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setNatural({ width: image.naturalWidth, height: image.naturalHeight }); }} onError={() => setImageFailed(true)} />
              {imageFailed && <button className="history-viewer-error" onClick={() => { setImageFailed(false); setRetry(value => value + 1); }}>原图加载失败 · 重试</button>}
              <div className="history-viewer-manage">
                <button className="history-viewer-button" aria-label={item.isFavorite ? '取消收藏' : '收藏'} aria-pressed={Boolean(item.isFavorite)} disabled={props.favoritePending} onClick={props.onFavorite}>{props.favoritePending ? <LoaderCircle className="animate-spin" /> : <Heart className={item.isFavorite ? 'fill-current text-rose-400' : ''} />}</button>
                <button className="history-viewer-button history-viewer-delete" aria-label="删除这张历史图片" onClick={props.onDelete}><Trash2 /></button>
              </div>
              <ImageShareActions key={item.id} imageUrl={item.imageUrl} filename={props.filename} generationData={{ prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params }} notify={props.notify} variant="card" className="history-viewer-share" />
              <button className="history-viewer-button history-viewer-previous" aria-label="上一张图片" disabled={index <= 0 || navigating} onClick={() => onNavigate(-1)}><ChevronLeft /></button>
              <button className="history-viewer-button history-viewer-next" aria-label="下一张图片" disabled={index >= total - 1 || navigating} onClick={() => onNavigate(1)}><ChevronRight /></button>
              {navigating && <span role="status" className="history-viewer-loading"><LoaderCircle className="animate-spin" />正在加载图片</span>}
            </div>
            <footer className="history-viewer-zoom">
              <button className="history-viewer-button" aria-label="缩小图片" disabled={zoom <= 1} onClick={() => zoomAt(zoom / 1.25)}><Minus /></button>
              <span aria-label="图片缩放比例">{Math.round(fit * zoom * 100)}%</span>
              <button className="history-viewer-button" aria-label="放大图片" disabled={zoom >= maxZoom} onClick={() => zoomAt(zoom * 1.25)}><Plus /></button>
              <button className="history-viewer-button" onClick={reset} title="快捷键 0"><Maximize />适应窗口</button>
              <button className="history-viewer-button" onClick={() => zoomAt(1 / fit)} title="快捷键 1">100%</button>
            </footer>
          </div>
          {props.detailsOpen && <aside ref={detailsRef} className="history-viewer-details" aria-label="图片详情面板"><div className="history-viewer-details-heading"><strong>图片详情</strong><button className="history-viewer-button" aria-label="收起图片详情" onClick={() => props.onDetailsChange(false)}><ChevronRight /></button></div>{props.children}</aside>}
        </div>
      </div>
    </div>
  </ImagePreviewPortal>;
};
