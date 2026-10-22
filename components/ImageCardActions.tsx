import React, { useLayoutEffect, useRef } from 'react';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';

/** 先填满右列，再向左换列；窄图保留左侧操作，空间不足时只补足必需高度。 */
export function imageCardActionLayout({ width, height, count, buttonWidth, buttonHeight, gap, inset, bottom, leftWidth, leftBottom }: {
  width: number; height: number; count: number; buttonWidth: number; buttonHeight: number;
  gap: number; inset: number; bottom: number; leftWidth: number; leftBottom: number;
}) {
  const stackBelowLeft = width - 2 * inset - leftWidth < buttonWidth;
  const top = stackBelowLeft ? Math.max(inset, leftBottom + gap) : inset;
  const columns = Math.max(1, Math.floor((width - 2 * inset - (stackBelowLeft ? 0 : leftWidth) + gap) / (buttonWidth + gap)));
  const minRows = Math.ceil(count / columns);
  const rows = Math.min(count, Math.max(minRows, Math.floor((height - top - bottom - inset + gap) / (buttonHeight + gap))));
  const minHeight = Math.max(top + minRows * (buttonHeight + gap) - gap, leftBottom) + bottom + inset;
  return { rows, top, minHeight };
}

export const ImageCardActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => {
  const ref = useRef<HTMLDivElement>(null);
  const frostedCaption = useGalleryFrostedCaption();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root?.parentElement) return;
    const frame = root.closest<HTMLElement>('.mobile-gallery-frame')
      ?? root.parentElement.querySelector<HTMLElement>('.mobile-gallery-frame') ?? root.parentElement;
    const card = frame.closest<HTMLElement>('.gallery-image-card, .press-reveal-surface') ?? root.parentElement;
    const captions = [...card.querySelectorAll<HTMLElement>('.gallery-card-caption, [data-image-action-caption]')];
    const left = [...card.querySelectorAll<HTMLElement>(`[data-image-action-left]${frostedCaption ? ', .gallery-cover-source' : ''}`)];
    const navigation = [...frame.querySelectorAll<HTMLElement>('.gallery-cover-navigation')];
    const items = [...root.querySelectorAll<HTMLElement>('button, [data-image-action-item]')];
    const originalMinHeight = frame.style.minHeight;
    const update = () => {
      const bounds = frame.getBoundingClientRect();
      const buttonWidth = Math.max(0, ...items.map(item => item.offsetWidth));
      const buttonHeight = Math.max(0, ...items.map(item => item.offsetHeight));
      if (!bounds.width || !bounds.height || !buttonWidth || !buttonHeight) return;
      const style = getComputedStyle(root);
      const gap = parseFloat(style.rowGap) || 8;
      const inset = parseFloat(style.right) || 8;
      const captionHeight = Math.max(0, ...captions.map(caption => {
        const rect = caption.getBoundingClientRect();
        return rect.width && rect.top < bounds.bottom && rect.bottom > bounds.top
          ? Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top) : 0;
      }));
      const navigationHeight = Math.max(0, ...navigation.map(item => item.offsetHeight));
      const leftRects = left.map(item => item.getBoundingClientRect()).filter(rect => rect.width && rect.height && rect.top < bounds.bottom && rect.bottom > bounds.top);
      const layout = imageCardActionLayout({ width: bounds.width, height: bounds.height, count: items.length,
        buttonWidth, buttonHeight, gap, inset, bottom: captionHeight + (navigationHeight ? navigationHeight + gap : 0),
        leftWidth: Math.max(0, ...leftRects.map(rect => rect.right - bounds.left + gap - inset)),
        leftBottom: Math.max(0, ...leftRects.map(rect => rect.bottom - bounds.top)),
      });
      root.style.gridTemplateRows = `repeat(${layout.rows}, ${buttonHeight}px)`;
      root.style.top = `${layout.top}px`;
      frame.style.minHeight = originalMinHeight ? `max(${originalMinHeight}, ${Math.ceil(layout.minHeight)}px)` : `${Math.ceil(layout.minHeight)}px`;
      frame.style.setProperty('--image-card-caption-height', `${captionHeight}px`);
      frame.setAttribute('data-image-action-frame', 'true');
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    for (const element of new Set([frame, ...captions, ...left, ...navigation, ...items])) observer?.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      frame.style.minHeight = originalMinHeight;
      frame.style.removeProperty('--image-card-caption-height');
      frame.removeAttribute('data-image-action-frame');
    };
  }, [children, frostedCaption]);
  return <div {...props} ref={ref} data-card-action="true" className={`image-card-actions absolute right-2 top-2 z-20 gap-2 ${className}`}>{children}</div>;
};
