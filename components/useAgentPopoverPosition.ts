import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** 输入区浮层向可用空间展开，适配窄屏、字号变化与软键盘。 */
export const useAgentPopoverPosition = (open: boolean, anchorRef: RefObject<HTMLElement | null>, popoverRef: RefObject<HTMLElement | null>, width = 360, align: 'start' | 'center' | 'end' = 'start', placement: 'auto' | 'right' = 'auto') => {
  const [position, setPosition] = useState<CSSProperties>();
  const positionRef = useRef<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) { positionRef.current = undefined; setPosition(undefined); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth, viewportHeight = viewport?.height || window.innerHeight;
      const actualWidth = Math.min(width, Math.max(0, viewportWidth - 16));
      const above = anchor.top - top - 16, below = top + viewportHeight - anchor.bottom - 16;
      const upward = above >= below;
      const maxHeight = placement === 'right' ? Math.max(0, viewportHeight - 16) : Math.max(0, upward ? above : below);
      const height = Math.min(popoverRef.current?.scrollHeight || 320, maxHeight);
      const availableRight = left + viewportWidth - 8;
      const rightCandidate = anchor.right + 8;
      const desiredLeft = placement === 'right'
        ? rightCandidate + actualWidth <= availableRight ? rightCandidate : anchor.left - actualWidth - 8
        : align === 'center' ? anchor.left + (anchor.width - actualWidth) / 2 : align === 'end' ? anchor.right - actualWidth : anchor.left;
      const desiredTop = placement === 'right' ? anchor.top : upward ? anchor.top - height - 8 : anchor.bottom + 8;
      const panelLeft = Math.max(left + 8, Math.min(desiredLeft, left + viewportWidth - actualWidth - 8));
      const panelTop = Math.max(top + 8, Math.min(desiredTop, top + viewportHeight - height - 8));
      const originX = placement === 'right' ? panelLeft >= anchor.right ? 0 : actualWidth : Math.max(0, Math.min(actualWidth, anchor.left + anchor.width / 2 - panelLeft));
      const originY = placement === 'right' ? `${Math.max(0, Math.min(height, anchor.top + anchor.height / 2 - panelTop))}px` : upward ? 'bottom' : 'top';
      const next: CSSProperties = { position: 'fixed', width: actualWidth, maxHeight, left: panelLeft, top: panelTop, transformOrigin: `${originX}px ${originY}` };
      if (Object.entries(next).every(([key, value]) => positionRef.current?.[key as keyof CSSProperties] === value)) return;
      positionRef.current = next;
      setPosition(next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, anchorRef, popoverRef, width, align, placement]);
  return position;
};
