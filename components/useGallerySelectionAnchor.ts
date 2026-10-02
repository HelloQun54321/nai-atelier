import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';

interface SelectionAnchor {
  id: number;
  /** null 表示居中；主动滚动或关闭详情后保留当前屏幕高度。 */
  offset: number | null;
}

/** 按作品身份补偿重排，避免固定 scrollTop 在侧栏展开后指向另一张图。 */
export const useGallerySelectionAnchor = (
  rootRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  selectedId: number | null,
  active: boolean,
) => {
  const anchorRef = useRef<SelectionAnchor | null>(null);
  const previousRef = useRef({ selectedId: null as number | null, active: false });
  const closingRef = useRef(false);
  const suspendedRef = useRef(false);
  const writtenScrollRef = useRef<number | null>(null);

  const getCard = () => {
    const anchor = anchorRef.current;
    return anchor ? rootRef.current?.querySelector<HTMLElement>(`[data-gallery-work-id="${anchor.id}"]`) : null;
  };
  const readOffset = () => {
    const root = rootRef.current;
    const card = getCard();
    if (!root || root.clientHeight === 0 || !card) return null;
    const rect = card.getBoundingClientRect();
    if (rect.height === 0) return null;
    return rect.top + rect.height / 2 - root.getBoundingClientRect().top - root.clientTop;
  };
  const adjust = () => {
    const root = rootRef.current;
    const anchor = anchorRef.current;
    if (!root || !anchor || suspendedRef.current || root.clientHeight === 0) return;
    const offset = readOffset();
    if (offset === null) return;
    const targetOffset = anchor.offset ?? root.clientHeight / 2;
    const nextTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + offset - targetOffset));
    if (Math.abs(root.scrollTop - nextTop) > 1) {
      root.scrollTop = nextTop;
      writtenScrollRef.current = root.scrollTop;
    }
  };

  useLayoutEffect(() => {
    const previous = previousRef.current;
    if (selectedId !== previous.selectedId || active !== previous.active) {
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
    if (active) adjust();
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
      const offset = readOffset();
      if (anchorRef.current && offset !== null) anchorRef.current.offset = offset;
      closingRef.current = true;
    },
    clearAnchor: () => { anchorRef.current = null; closingRef.current = false; },
    onScroll: () => {
      const root = rootRef.current;
      if (!active || !root || root.clientHeight === 0 || !anchorRef.current) return;
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
