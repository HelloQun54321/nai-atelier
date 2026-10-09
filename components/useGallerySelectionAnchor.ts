import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { appearanceScrollBehavior } from '../services/appearancePreferences';

interface SelectionAnchor {
  id: string | number;
  /** null 表示居中；主动滚动或关闭详情后保留当前屏幕高度。 */
  offset: number | null;
}

/** 点击作品平滑居中，按作品身份补偿重排，避免侧栏展开后定位到另一张图。 */
export const useGallerySelectionAnchor = (
  rootRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  selectedId: string | number | null,
  active: boolean,
) => {
  const anchorRef = useRef<SelectionAnchor | null>(null);
  const previousRef = useRef({ selectedId: null as string | number | null, active: false });
  const closingRef = useRef(false);
  const suspendedRef = useRef(false);
  const writtenScrollRef = useRef<number | null>(null);
  const smoothTargetRef = useRef<number | null>(null);
  const stopSmoothScroll = () => {
    if (smoothTargetRef.current === null) return;
    smoothTargetRef.current = null;
    const root = rootRef.current;
    if (root && root.clientHeight > 0) root.scrollTo({ top: root.scrollTop, behavior: 'instant' });
  };

  const getCard = () => {
    const anchor = anchorRef.current;
    return anchor ? Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-gallery-work-id]') || [])
      .find(card => card.dataset.galleryWorkId === String(anchor.id)) : null;
  };
  const readOffset = () => {
    const root = rootRef.current;
    const card = getCard();
    if (!root || root.clientHeight === 0 || !card) return null;
    const rect = card.getBoundingClientRect();
    if (rect.height === 0) return null;
    return rect.top + rect.height / 2 - root.getBoundingClientRect().top - root.clientTop;
  };
  const adjust = (smooth = false) => {
    const root = rootRef.current;
    const anchor = anchorRef.current;
    if (!root || !anchor || suspendedRef.current || root.clientHeight === 0) return;
    const offset = readOffset();
    if (offset === null) return;
    const targetOffset = anchor.offset ?? root.clientHeight / 2;
    const nextTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + offset - targetOffset));
    if (Math.abs(root.scrollTop - nextTop) > 1) {
      const animate = smooth || smoothTargetRef.current !== null;
      if (animate && smoothTargetRef.current !== null && Math.abs(smoothTargetRef.current - nextTop) <= 1) return;
      smoothTargetRef.current = animate ? nextTop : null;
      root.scrollTo({ top: nextTop, behavior: animate ? 'smooth' : 'instant' });
      writtenScrollRef.current = animate ? nextTop : root.scrollTop;
    } else if (smoothTargetRef.current !== null) {
      smoothTargetRef.current = null;
      writtenScrollRef.current = root.scrollTop;
    }
  };

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const smooth = active && previous.active && selectedId !== null && selectedId !== previous.selectedId
      && appearanceScrollBehavior() === 'smooth';
    if (selectedId !== previous.selectedId || active !== previous.active) {
      stopSmoothScroll();
      if (selectedId !== null) {
        anchorRef.current = { id: selectedId, offset: null };
      } else if (!closingRef.current || !active || !previous.active) {
        anchorRef.current = null;
      }
      closingRef.current = false;
      suspendedRef.current = false;
      writtenScrollRef.current = null;
    }
    previousRef.current = { selectedId, active };
    if (active) adjust(smooth);
  });

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!active || !root || !content) return;
    let adjustmentFrame: number | null = null;
    let inputFrame: number | null = null;
    let observedCard: HTMLElement | null = null;
    const resize = new ResizeObserver(() => {
      // 尺寸回调发生在绘制前，立即补偿；瀑布流随后重建由 DOM 观察补偿。
      adjust();
      schedule();
    });
    const observeCard = () => {
      const card = getCard() ?? null;
      if (observedCard === card) return;
      if (observedCard) resize.unobserve(observedCard);
      observedCard = card;
      if (card) resize.observe(card);
    };
    const schedule = () => {
      if (adjustmentFrame !== null) return;
      adjustmentFrame = requestAnimationFrame(() => {
        adjustmentFrame = null;
        observeCard();
        adjust();
      });
    };
    const mutation = new MutationObserver(schedule);
    resize.observe(root);
    resize.observe(content);
    observeCard();
    mutation.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    // 滚轮、触摸、滚动条和键盘滚动优先于自动定位，异步加载不能拉回用户。
    const onIntent = (event: Event) => {
      if (event instanceof KeyboardEvent && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        || (event.target instanceof Element && event.target.closest('input, textarea, select, button, [role="button"]')))) return;
      if (!anchorRef.current) return;
      stopSmoothScroll();
      suspendedRef.current = true;
      writtenScrollRef.current = null;
      if (adjustmentFrame !== null) cancelAnimationFrame(adjustmentFrame);
      adjustmentFrame = null;
      if (inputFrame !== null) cancelAnimationFrame(inputFrame);
      inputFrame = requestAnimationFrame(() => {
        inputFrame = null;
        suspendedRef.current = false;
      });
    };
    root.addEventListener('wheel', onIntent, { passive: true });
    root.addEventListener('touchstart', onIntent, { passive: true });
    root.addEventListener('pointerdown', onIntent, { passive: true });
    root.addEventListener('keydown', onIntent);
    schedule();
    return () => {
      stopSmoothScroll();
      resize.disconnect();
      mutation.disconnect();
      if (adjustmentFrame !== null) cancelAnimationFrame(adjustmentFrame);
      if (inputFrame !== null) cancelAnimationFrame(inputFrame);
      suspendedRef.current = false;
      root.removeEventListener('wheel', onIntent);
      root.removeEventListener('touchstart', onIntent);
      root.removeEventListener('pointerdown', onIntent);
      root.removeEventListener('keydown', onIntent);
    };
    // 观察器读取 ref 中的最新锚点，不随图片与收藏状态重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rootRef, contentRef]);

  return {
    // 关闭详情后的重排也交给作品锚点，避免像素恢复定时器与它争抢滚动。
    hasAnchor: selectedId !== null || anchorRef.current !== null,
    preserveOnClose: () => {
      stopSmoothScroll();
      const offset = readOffset();
      if (anchorRef.current && offset !== null) anchorRef.current.offset = offset;
      closingRef.current = true;
    },
    clearAnchor: () => { stopSmoothScroll(); anchorRef.current = null; closingRef.current = false; },
    onScroll: () => {
      const root = rootRef.current;
      if (!active || !root || root.clientHeight === 0 || !anchorRef.current) return;
      // 原生平滑滚动的中间帧不改变居中目标，手动输入会先停止动画。
      if (smoothTargetRef.current !== null) {
        if (Math.abs(root.scrollTop - smoothTargetRef.current) <= 1) {
          smoothTargetRef.current = null;
          writtenScrollRef.current = root.scrollTop;
        }
        return;
      }
      if (writtenScrollRef.current !== null && Math.abs(root.scrollTop - writtenScrollRef.current) <= 1) return;
      if (selectedId === null) {
        anchorRef.current = null;
      } else {
        const offset = readOffset();
        if (offset !== null) anchorRef.current.offset = offset;
      }
    },
  };
};
