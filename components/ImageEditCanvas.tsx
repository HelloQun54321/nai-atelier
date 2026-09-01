import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

export interface ImageEditCanvasProps {
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  focusedRect: { x: number; y: number; width: number; height: number } | null;
  focused: boolean;
  isLoading: boolean;
  isBusy?: boolean;
  maskEditable?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onFocusedInteractionStart?: (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => void;
  onFocusedInteractionMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onFocusedInteractionEnd?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export const ImageEditCanvas: React.FC<ImageEditCanvasProps> = ({
  imageCanvasRef,
  maskCanvasRef,
  overlayCanvasRef,
  width,
  height,
  focusedRect,
  focused,
  isLoading,
  isBusy = false,
  maskEditable = true,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onFocusedInteractionStart,
  onFocusedInteractionMove,
  onFocusedInteractionEnd,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !width || !height) {
      setDisplaySize(null);
      return;
    }
    const update = () => {
      const node = containerRef.current;
      if (!node) return;
      const availableHeight = isFullscreen
        ? Math.min(node.clientHeight, window.innerHeight * 0.85)
        : Math.min(node.clientHeight, window.innerHeight * 0.62);
      const scale = Math.min(node.clientWidth / width, availableHeight / height);
      setDisplaySize({
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
      });
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [width, height, isFullscreen]);

  // Space 键监听与 Esc 全屏退出
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        event.preventDefault();
        setSpacePressed(true);
      }
      if (event.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isFullscreen]);

  // Ctrl + 滚轮缩放监听
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.25 : -0.25;
        setZoom(previous => Math.min(4, Math.max(1, Math.round((previous + delta) * 100) / 100)));
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // 漫游拖拽（鼠标右键 button === 2、中键 button === 1 或按住空格）
  const handleContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2 || event.button === 1 || spacePressed) {
      isPanningRef.current = true;
      const container = containerRef.current;
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: container ? container.scrollLeft : 0,
        scrollTop: container ? container.scrollTop : 0,
      };
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleContainerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current && containerRef.current) {
      const deltaX = event.clientX - panStartRef.current.x;
      const deltaY = event.clientY - panStartRef.current.y;
      containerRef.current.scrollLeft = panStartRef.current.scrollLeft - deltaX;
      containerRef.current.scrollTop = panStartRef.current.scrollTop - deltaY;
    }
  };

  const handleContainerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const handleZoomIn = () => setZoom(previous => Math.min(4, Math.round((previous + 0.5) * 10) / 10));
  const handleZoomOut = () => setZoom(previous => Math.max(1, Math.round((previous - 0.5) * 10) / 10));
  const handleZoomReset = () => setZoom(1);
  const canvasBoxStyle: React.CSSProperties = displaySize
    ? {
        width: Math.round(displaySize.width * zoom),
        height: Math.round(displaySize.height * zoom),
        maxWidth: zoom > 1 ? 'none' : '100%',
        maxHeight: zoom > 1 ? 'none' : '100%',
      }
    : { aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[950] flex flex-col bg-gray-950/95 p-4 backdrop-blur-md sm:p-6 select-none'
          : 'relative flex flex-1 flex-col min-h-0 w-full'
      }
    >
      {/* 全屏顶栏 */}
      {isFullscreen && (
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold">全屏大画板精修</span>
            <span className="text-xs text-gray-400">{width} × {height} 像素</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 hidden sm:inline">鼠标右键/中键或按住空格拖拽平移 · Ctrl+滚轮缩放</span>
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              <X className="h-4 w-4" />
              <span>完成 (Esc)</span>
            </button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={handleContainerPointerDown}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        className={`relative flex flex-1 overflow-auto rounded-xl border border-gray-200 bg-white transition-colors dark:border-gray-800 dark:bg-gray-950/50 ${
          isFullscreen ? 'h-full min-h-0 w-full' : 'min-h-[300px]'
        } ${spacePressed ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {/* 缩放与全屏悬浮工具条 */}
        {width > 0 && height > 0 && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1 rounded-lg border border-gray-200/80 bg-white/90 p-1 shadow-sm backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/90">
            <button
              type="button"
              title="缩小"
              disabled={zoom <= 1}
              onClick={handleZoomOut}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="重置缩放 (适应视口)"
              onClick={handleZoomReset}
              className="px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {zoom === 1 ? '适应' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              title="放大"
              disabled={zoom >= 4}
              onClick={handleZoomIn}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <div className="mx-0.5 h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
            <button
              type="button"
              title={isFullscreen ? '退出全屏精修' : '展开全屏大画板'}
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}

        <div data-safe-mode-work="true" data-safe-mode-canvas="true" className={`relative overflow-hidden shadow-2xl flex-shrink-0 m-auto ${zoom === 1 ? 'max-h-full max-w-full' : ''}`} style={canvasBoxStyle}>
          <canvas ref={imageCanvasRef} data-safe-mode-image="true" className="absolute inset-0 h-full w-full" />
          <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <canvas
            ref={maskCanvasRef}
            tabIndex={maskEditable ? 0 : -1}
            aria-label="图片编辑画布"
            aria-disabled={!maskEditable || isBusy}
            className={`absolute inset-0 h-full w-full opacity-0 ${spacePressed ? 'pointer-events-none' : maskEditable && !isBusy ? 'cursor-crosshair touch-none' : 'pointer-events-none cursor-default'}`}
            onPointerDown={e => {
              if (e.button === 2 || e.button === 1 || spacePressed) {
                handleContainerPointerDown(e as unknown as React.PointerEvent<HTMLDivElement>);
                return;
              }
              onPointerDown(e);
            }}
            onPointerMove={e => {
              if (isPanningRef.current) {
                handleContainerPointerMove(e as unknown as React.PointerEvent<HTMLDivElement>);
                return;
              }
              onPointerMove(e);
            }}
            onPointerUp={e => {
              if (isPanningRef.current) {
                handleContainerPointerUp(e as unknown as React.PointerEvent<HTMLDivElement>);
                return;
              }
              onPointerUp(e);
            }}
            onPointerCancel={onPointerUp}
          />
          {maskEditable && focused && focusedRect && <div className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/10" style={{ left: `${focusedRect.x / Math.max(1, width) * 100}%`, top: `${focusedRect.y / Math.max(1, height) * 100}%`, width: `${focusedRect.width / Math.max(1, width) * 100}%`, height: `${focusedRect.height / Math.max(1, height) * 100}%` }}>
            <div
              role="button"
              tabIndex={0}
              aria-label="移动 Focused 选区"
              className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-move rounded bg-amber-300/90 px-1.5 py-0.5 text-[9px] font-bold text-amber-950 shadow"
              onPointerDown={event => onFocusedInteractionStart?.(event, 'move')}
              onPointerMove={onFocusedInteractionMove}
              onPointerUp={onFocusedInteractionEnd}
              onPointerCancel={onFocusedInteractionEnd}
            >移动</div>
            <div
              role="button"
              tabIndex={0}
              aria-label="调整 Focused 选区大小"
              className="pointer-events-auto absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-se-resize rounded-full border-2 border-amber-950 bg-amber-300 shadow"
              onPointerDown={event => onFocusedInteractionStart?.(event, 'resize')}
              onPointerMove={onFocusedInteractionMove}
              onPointerUp={onFocusedInteractionEnd}
              onPointerCancel={onFocusedInteractionEnd}
            />
          </div>}
        </div>
        {!width && <div className="absolute inset-x-6 bottom-6 rounded-lg border border-dashed border-gray-300 bg-white/90 px-3 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-400">请先生成图片、选择历史图片或导入 PNG、JPEG、WebP 底图</div>}
      </div>
    </div>
  );
};
