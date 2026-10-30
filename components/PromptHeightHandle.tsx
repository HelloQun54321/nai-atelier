import React, { useRef } from 'react';
import { ChevronsUpDown } from 'lucide-react';

/** 触屏把手放在已有操作行；跟随高度开启时鼠标也显示，因原文框会关掉原生拖角。 */
export function PromptHeightHandle({ targetRef, label, onManualResize, alwaysVisible = false }: {
  targetRef: React.RefObject<HTMLElement | null>;
  label: string;
  /** 人工拖动／方向键调高时通知，便于本轮挂载内暂停自动高度。 */
  onManualResize?: () => void;
  alwaysVisible?: boolean;
}) {
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const height = () => {
    const target = targetRef.current!;
    return parseFloat(getComputedStyle(target).height) || target.getBoundingClientRect().height;
  };
  const resize = (next: number) => {
    const target = targetRef.current;
    if (!target) return;
    const style = getComputedStyle(target);
    target.style.height = `${Math.min(parseFloat(style.maxHeight) || Infinity, Math.max(parseFloat(style.minHeight) || 40, next))}px`;
    onManualResize?.();
  };
  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <button type="button" aria-label={label} title={label} style={{ touchAction: 'none' }}
    className={`mobile-touch flex h-7 w-7 shrink-0 cursor-ns-resize select-none items-center justify-center rounded text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-gray-200 ${alwaysVisible ? '' : 'pointer-fine:hidden'}`}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current || !targetRef.current) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { pointerId: event.pointerId, y: event.clientY, height: height() };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      resize(drag.current.height + event.clientY - drag.current.y);
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (!targetRef.current || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      resize(height() + (event.key === 'ArrowDown' ? 32 : -32));
    }}><ChevronsUpDown aria-hidden="true" className="h-4 w-4" /></button>;
}
