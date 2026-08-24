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
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => (
  <div className="relative flex min-h-[300px] flex-1 items-center justify-center overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/50">
    {isLoading && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-sm text-white">正在载入底图...</div>}
    <div className="relative max-h-full max-w-full overflow-hidden shadow-2xl" style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}` }}>
      <canvas ref={imageCanvasRef} className="block max-h-[62vh] max-w-full object-contain" />
      <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <canvas
        ref={maskCanvasRef}
        tabIndex={0}
        aria-label="图片编辑画布"
        className={`absolute inset-0 h-full w-full cursor-crosshair opacity-0 touch-none ${isBusy ? 'pointer-events-none' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {focused && focusedRect && <div className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/10" style={{ left: `${focusedRect.x / Math.max(1, width) * 100}%`, top: `${focusedRect.y / Math.max(1, height) * 100}%`, width: `${focusedRect.width / Math.max(1, width) * 100}%`, height: `${focusedRect.height / Math.max(1, height) * 100}%` }} />}
    </div>
    {!width && <div className="absolute inset-x-6 bottom-6 rounded-lg border border-dashed border-gray-300 bg-white/90 px-3 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-400">请先生成图片、选择历史图片或导入 PNG、JPEG、WebP 底图</div>}
  </div>
);
