import React, { useLayoutEffect, useRef } from 'react';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';

/** 先填满右列，再向左换列；窄图保留左侧操作，空间不足时只补足必需高度。 */
export function imageCardActionLayout({ width, height, count, buttonWidth, buttonHeight, gap, inset, bottom, leftWidth, leftBottom, singleColumn = false }: {
  width: number; height: number; count: number; buttonWidth: number; buttonHeight: number;
  gap: number; inset: number; bottom: number; leftWidth: number; leftBottom: number;
  singleColumn?: boolean;
}) {
  const stackBelowLeft = width - 2 * inset - leftWidth < buttonWidth;
  const top = stackBelowLeft ? Math.max(inset, leftBottom + gap) : inset;
  const columns = singleColumn ? 1 : Math.max(1, Math.floor((width - 2 * inset - (stackBelowLeft ? 0 : leftWidth) + gap) / (buttonWidth + gap)));
  const minRows = Math.ceil(count / columns);
  const rows = Math.min(count, Math.max(minRows, Math.floor((height - top - bottom - inset + gap) / (buttonHeight + gap))));
  const minHeight = Math.max(top + minRows * (buttonHeight + gap) - gap, leftBottom) + bottom + inset;
  return { rows, top, minHeight };
}

type ImageCardActionsProps = React.HTMLAttributes<HTMLDivElement> & { singleColumn?: boolean };

type LayoutMeasure = () => (() => void) | undefined;
const pendingLayouts = new Set<LayoutMeasure>();
let layoutFrame: number | null = null;
// 整个图库缩放时先统一读尺寸，再统一写样式，避免每张卡片都迫使下一张同步排版。
function scheduleLayout(measure: LayoutMeasure) {
  pendingLayouts.add(measure);
  if (layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    const batch = [...pendingLayouts];
    pendingLayouts.clear();
    const writes = batch.map(read => read());
    writes.forEach(write => write?.());
  });
}

export const ImageCardActions: React.FC<ImageCardActionsProps> = ({ children, className = '', singleColumn = false, ...props }) => {
  const ref = useRef<HTMLDivElement>(null);
  const frostedCaption = useGalleryFrostedCaption();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root?.parentElement) return;
    const frame = root.closest<HTMLElement>('.mobile-gallery-frame')
      ?? root.parentElement.querySelector<HTMLElement>('.mobile-gallery-frame') ?? root.parentElement;
    const card = frame.closest<HTMLElement>('.gallery-image-card, .press-reveal-surface') ?? root.parentElement;
    let captions: HTMLElement[] = [], left: HTMLElement[] = [], navigation: HTMLElement[] = [], items: HTMLElement[] = [];
    let observed = new Set<HTMLElement>();
    const originalMinHeight = frame.style.minHeight;
    const restoreFrame = () => {
      frame.style.minHeight = originalMinHeight;
      frame.style.removeProperty('--image-card-caption-height');
      frame.removeAttribute('data-image-action-frame');
    };
    const measure: LayoutMeasure = () => {
      if (!items.length) {
        return () => {
          restoreFrame();
          root.style.removeProperty('grid-template-rows');
          root.style.removeProperty('top');
        };
      }
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
        leftBottom: Math.max(0, ...leftRects.map(rect => rect.bottom - bounds.top)), singleColumn,
      });
      const rows = `repeat(${layout.rows}, ${buttonHeight}px)`, top = `${layout.top}px`;
      const minHeight = originalMinHeight ? `max(${originalMinHeight}, ${Math.ceil(layout.minHeight)}px)` : `${Math.ceil(layout.minHeight)}px`;
      return () => {
        if (root.style.gridTemplateRows !== rows) root.style.gridTemplateRows = rows;
        if (root.style.top !== top) root.style.top = top;
        if (frame.style.minHeight !== minHeight) frame.style.minHeight = minHeight;
        if (frame.style.getPropertyValue('--image-card-caption-height') !== `${captionHeight}px`) frame.style.setProperty('--image-card-caption-height', `${captionHeight}px`);
        if (frame.getAttribute('data-image-action-frame') !== 'true') frame.setAttribute('data-image-action-frame', 'true');
      };
    };
    const schedule = () => scheduleLayout(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    // JSX 引用、收藏色及忙碌图标变化不重测；只同步实际参与排布的节点。
    const syncTargets = () => {
      captions = [...card.querySelectorAll<HTMLElement>('.gallery-card-caption, [data-image-action-caption]')];
      left = [...card.querySelectorAll<HTMLElement>(`[data-image-action-left]${frostedCaption ? ', .gallery-cover-source' : ''}`)];
      navigation = [...frame.querySelectorAll<HTMLElement>('.gallery-cover-navigation')];
      items = [...root.querySelectorAll<HTMLElement>('button, [data-image-action-item]')];
      const next = new Set([frame, ...captions, ...left, ...navigation, ...items]);
      if (next.size === observed.size && [...next].every(element => observed.has(element))) return;
      for (const element of observed) if (!next.has(element)) observer?.unobserve(element);
      for (const element of next) if (!observed.has(element)) observer?.observe(element);
      observed = next;
      measure()?.();
    };
    syncTargets();
    const mutation = new MutationObserver(syncTargets);
    mutation.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-image-action-item', 'data-image-action-caption', 'data-image-action-left'] });
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      pendingLayouts.delete(measure);
      if (!pendingLayouts.size && layoutFrame !== null) { cancelAnimationFrame(layoutFrame); layoutFrame = null; }
      restoreFrame();
    };
  }, [frostedCaption, singleColumn]);
  return <div {...props} ref={ref} data-card-action="true" className={`image-card-actions absolute right-2 top-2 z-20 gap-2 ${className}`}>{children}</div>;
};
