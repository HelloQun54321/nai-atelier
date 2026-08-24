import React from 'react';

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
};

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
}) => (
  <div className="relative flex min-h-[300px] flex-1 items-center justify-center overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/50">
    {isLoading && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-sm text-white">正在载入底图...</div>}
    <div data-safe-mode-work="true" data-safe-mode-canvas="true" className="relative max-h-full max-w-full overflow-hidden shadow-2xl" style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` }}>
      <canvas ref={imageCanvasRef} data-safe-mode-image="true" className="block max-h-[62vh] max-w-full object-contain" />
      <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <canvas
        ref={maskCanvasRef}
        tabIndex={maskEditable ? 0 : -1}
        aria-label="图片编辑画布"
        aria-disabled={!maskEditable || isBusy}
        className={`absolute inset-0 h-full w-full opacity-0 ${maskEditable && !isBusy ? 'cursor-crosshair touch-none' : 'pointer-events-none cursor-default'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
);
