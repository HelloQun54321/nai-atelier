import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** 输入区浮层向可用空间展开，适配窄屏、字号变化与软键盘。 */
export const useAgentPopoverPosition = (open: boolean, anchorRef: RefObject<HTMLElement | null>, popoverRef: RefObject<HTMLElement | null>, width = 360, align: 'start' | 'end' = 'start') => {
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) { setPosition(undefined); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth, viewportHeight = viewport?.height || window.innerHeight;
      const actualWidth = Math.min(width, Math.max(0, viewportWidth - 16));
      const above = anchor.top - top - 16, below = top + viewportHeight - anchor.bottom - 16;
      const upward = above >= below;
      const maxHeight = Math.max(0, upward ? above : below);
      const height = Math.min(popoverRef.current?.scrollHeight || 320, maxHeight);
      const desiredLeft = align === 'end' ? anchor.right - actualWidth : anchor.left;
      setPosition({ position: 'fixed', width: actualWidth, maxHeight, left: Math.max(left + 8, Math.min(desiredLeft, left + viewportWidth - actualWidth - 8)), top: Math.max(top + 8, upward ? anchor.top - height - 8 : anchor.bottom + 8) });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, anchorRef, popoverRef, width, align]);
  return position;
};
