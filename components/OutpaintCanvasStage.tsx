import React, { useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import { ImageEditCanvasExpansion } from '../types';
import { OUTPAINT_RATIO_PRESETS } from '../services/imageEdit';

export interface OutpaintCanvasStageProps {
  sourceWidth: number;
  sourceHeight: number;
  baseImagePreview?: string | null;
  expansion: ImageEditCanvasExpansion;
  onExpansionChange: (expansion: ImageEditCanvasExpansion) => void;
  selectedRatioId: string;
  onSelectRatioId: (ratioId: string) => void;
  isBusy?: boolean;
}

export const OutpaintCanvasStage: React.FC<OutpaintCanvasStageProps> = ({
  sourceWidth,
  sourceHeight,
  baseImagePreview,
  expansion,
  onExpansionChange,
  selectedRatioId,
  onSelectRatioId,
  isBusy = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startLeft: number; startTop: number }>({
    clientX: 0,
    clientY: 0,
    startLeft: 0,
    startTop: 0,
  });

  const srcW = Math.max(64, Math.floor(Number(sourceWidth) || 1024));
  const srcH = Math.max(64, Math.floor(Number(sourceHeight) || 1024));

  const currentPreset = OUTPAINT_RATIO_PRESETS.find(p => p.id === selectedRatioId) || OUTPAINT_RATIO_PRESETS[0];
  const targetRatio = currentPreset.widthRatio / currentPreset.heightRatio;
  const currentRatio = srcW / srcH;

  let targetW: number;
  let targetH: number;

  if (currentRatio < targetRatio) {
    targetH = Math.ceil(srcH / 64) * 64;
    const calcW = targetH * targetRatio;
    targetW = Math.ceil(calcW / 64) * 64;
  } else {
    targetW = Math.ceil(srcW / 64) * 64;
    const calcH = targetW / targetRatio;
    targetH = Math.ceil(calcH / 64) * 64;
  }

  targetW = Math.max(targetW, Math.ceil(srcW / 64) * 64);
  targetH = Math.max(targetH, Math.ceil(srcH / 64) * 64);

  const deltaW = Math.max(0, targetW - srcW);
  const deltaH = Math.max(0, targetH - srcH);

  // 动态测量外框容器，确保舞台无论何种比例都能等比居中渲染
  const [stageDimensions, setStageDimensions] = useState<{ width: number; height: number }>({ width: 320, height: 200 });

  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padW = 20;
      const padH = 20;
      const availW = Math.max(60, rect.width - padW);
      const availH = Math.max(60, (rect.height || 220) - padH);

      if (availW / availH > targetRatio) {
        const h = availH;
        const w = h * targetRatio;
        setStageDimensions({ width: Math.round(w), height: Math.round(h) });
      } else {
        const w = availW;
        const h = w / targetRatio;
        setStageDimensions({ width: Math.round(w), height: Math.round(h) });
      }
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [targetRatio]);

  // 鼠标拖拽原图逻辑（64px 动态吸附）
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isBusy || (!deltaW && !deltaH)) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      startLeft: expansion.left || 0,
      startTop: expansion.top || 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = targetW / rect.width;
    const scaleY = targetH / rect.height;

    const dx = (event.clientX - dragStartRef.current.clientX) * scaleX;
    const dy = (event.clientY - dragStartRef.current.clientY) * scaleY;

    const rawLeft = dragStartRef.current.startLeft + dx;
    const rawTop = dragStartRef.current.startTop + dy;

    // 64 像素动态吸附与越界钳位
    const newLeft = deltaW > 0 ? Math.max(0, Math.min(deltaW, Math.round(rawLeft / 64) * 64)) : 0;
    const newRight = deltaW > 0 ? Math.max(0, deltaW - newLeft) : 0;
    const newTop = deltaH > 0 ? Math.max(0, Math.min(deltaH, Math.round(rawTop / 64) * 64)) : 0;
    const newBottom = deltaH > 0 ? Math.max(0, deltaH - newTop) : 0;

    onExpansionChange({ top: newTop, right: newRight, bottom: newBottom, left: newLeft });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  // 点击画布空白处快速定位
  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingRef.current || isBusy || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const targetPosX = (clickX / rect.width) * targetW - srcW / 2;
    const targetPosY = (clickY / rect.height) * targetH - srcH / 2;

    const newLeft = deltaW > 0 ? Math.max(0, Math.min(deltaW, Math.round(targetPosX / 64) * 64)) : 0;
    const newRight = deltaW > 0 ? Math.max(0, deltaW - newLeft) : 0;
    const newTop = deltaH > 0 ? Math.max(0, Math.min(deltaH, Math.round(targetPosY / 64) * 64)) : 0;
    const newBottom = deltaH > 0 ? Math.max(0, deltaH - newTop) : 0;

    onExpansionChange({ top: newTop, right: newRight, bottom: newBottom, left: newLeft });
  };

  // 快速对齐预设
  const setHorizontalAlign = (align: 'left' | 'center' | 'right') => {
    if (deltaW <= 0) return;
    let newLeft = 0;
    if (align === 'left') newLeft = 0;
    if (align === 'center') newLeft = Math.floor((deltaW / 2) / 64) * 64;
    if (align === 'right') newLeft = deltaW;
    onExpansionChange({ ...expansion, left: newLeft, right: deltaW - newLeft });
  };

  const setVerticalAlign = (align: 'top' | 'center' | 'bottom') => {
    if (deltaH <= 0) return;
    let newTop = 0;
    if (align === 'top') newTop = 0;
    if (align === 'center') newTop = Math.floor((deltaH / 2) / 64) * 64;
    if (align === 'bottom') newTop = deltaH;
    onExpansionChange({ ...expansion, top: newTop, bottom: deltaH - newTop });
  };

  const handleRatioSelect = (ratioId: string) => {
    onSelectRatioId(ratioId);
    const option = OUTPAINT_RATIO_PRESETS.find(p => p.id === ratioId) || OUTPAINT_RATIO_PRESETS[0];
    const r = option.widthRatio / option.heightRatio;
    let tw = srcW;
    let th = srcH;
    if (srcW / srcH < r) {
      th = Math.ceil(srcH / 64) * 64;
      tw = Math.ceil((th * r) / 64) * 64;
    } else {
      tw = Math.ceil(srcW / 64) * 64;
      th = Math.ceil((tw / r) / 64) * 64;
    }
    const dw = Math.max(0, tw - srcW);
    const dh = Math.max(0, th - srcH);
    const l = Math.floor((dw / 2) / 64) * 64;
    const t = Math.floor((dh / 2) / 64) * 64;
    onExpansionChange({ top: t, right: dw - l, bottom: dh - t, left: l });
  };

  const leftPercent = targetW > 0 ? (expansion.left / targetW) * 100 : 0;
  const topPercent = targetH > 0 ? (expansion.top / targetH) * 100 : 0;
  const widthPercent = targetW > 0 ? (srcW / targetW) * 100 : 100;
  const heightPercent = targetH > 0 ? (srcH / targetH) * 100 : 100;

  return (
    <div className="space-y-3">
      {/* 目标画幅比例选择 pills */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">目标画幅比例（画布外框）</span>
          <span className="text-[10px] text-gray-400">输出：{targetW} × {targetH} px ({currentPreset.ratio})</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {OUTPAINT_RATIO_PRESETS.map(preset => {
            const isSelected = selectedRatioId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={isBusy}
                onClick={() => handleRatioSelect(preset.id)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50 font-bold text-indigo-700 shadow-sm dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'border-gray-200 bg-gray-50/70 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {preset.ratio} <span className="text-[10px] opacity-75">{preset.label.split(' ')[1]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 模拟画板（“布”）交互区 */}
      <div className="rounded-xl border border-gray-200 bg-gray-100 p-3 dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-200">画幅模拟摆放台</span>
          <span className="text-[10px]">可直接拖拽原图 · 64px 动态吸附</span>
        </div>

        <div
          ref={containerRef}
          className="flex h-60 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-200/80 p-2 dark:bg-gray-900/70"
        >
          {/* 目标比例外框（“布”） */}
          <div
            ref={stageRef}
            onClick={handleStageClick}
            style={{
              width: `${stageDimensions.width}px`,
              height: `${stageDimensions.height}px`,
            }}
            className="relative cursor-pointer select-none touch-none overflow-hidden rounded-lg border-2 border-dashed border-indigo-500/80 bg-white/95 shadow-md dark:border-indigo-400/70 dark:bg-gray-900"
          >
            {/* 网格斜纹提示 AI 扩图区域 */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#6366f1_1.2px,transparent_1.2px)] [background-size:12px_12px] opacity-20" />

            {/* 四周扩展数值标签 */}
            {expansion.top > 0 && (
              <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                上 +{expansion.top}px
              </div>
            )}
            {expansion.bottom > 0 && (
              <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                下 +{expansion.bottom}px
              </div>
            )}
            {expansion.left > 0 && (
              <div className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                左 +{expansion.left}px
              </div>
            )}
            {expansion.right > 0 && (
              <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                右 +{expansion.right}px
              </div>
            )}

            {/* 可拖拽的原图内框 */}
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                width: `${widthPercent}%`,
                height: `${heightPercent}%`,
              }}
              className={`absolute flex flex-col items-center justify-center overflow-hidden rounded border-2 border-indigo-600 bg-indigo-100/95 shadow-md touch-none ${
                deltaW > 0 || deltaH > 0
                  ? 'cursor-grab hover:border-indigo-500 hover:shadow-lg active:cursor-grabbing active:scale-[0.99] active:ring-2 active:ring-indigo-400'
                  : 'cursor-default'
              } dark:border-indigo-400 dark:bg-indigo-950/95`}
            >
              {baseImagePreview ? (
                <img
                  src={baseImagePreview}
                  alt="原图缩略"
                  className="pointer-events-none h-full w-full object-cover"
                />
              ) : (
                <div className="pointer-events-none flex flex-col items-center justify-center p-1 text-center">
                  <Move className="mb-0.5 h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-[10px] font-bold text-indigo-900 dark:text-indigo-200">原图</span>
                </div>
              )}
              <div className="pointer-events-none absolute bottom-0 inset-x-0 bg-indigo-950/80 px-1 py-0.5 text-center text-[8px] font-mono text-white">
                {srcW} × {srcH}
              </div>
            </div>
          </div>
        </div>

        {/* 快捷方位按钮 */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {deltaW > 0 ? (
            <div>
              <span className="mb-1 block text-[10px] font-semibold text-gray-500 dark:text-gray-400">水平位置 (多出 {deltaW}px)</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setHorizontalAlign('left')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.left === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  靠左
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setHorizontalAlign('center')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.left > 0 && expansion.right > 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  居中
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setHorizontalAlign('right')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.right === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  靠右
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center text-[10px] text-gray-400">
              水平已填满（无多余宽度）
            </div>
          )}

          {deltaH > 0 ? (
            <div>
              <span className="mb-1 block text-[10px] font-semibold text-gray-500 dark:text-gray-400">垂直位置 (多出 {deltaH}px)</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setVerticalAlign('top')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.top === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  靠顶
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setVerticalAlign('center')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.top > 0 && expansion.bottom > 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  居中
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setVerticalAlign('bottom')}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium transition ${expansion.bottom === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold dark:border-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                >
                  靠底
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center text-[10px] text-gray-400">
              垂直已填满（无多余高度）
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
