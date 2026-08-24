import { RefObject, useLayoutEffect, useRef } from 'react';

/**
 * 返回常驻列表时保留原视口；若目标卡片因排序变化离开视口，再将其滚回可见区域。
 */
export const useRestoreListAnchor = (
  scrollRef: RefObject<HTMLElement | null>,
  targetId?: string,
  readyKey?: string | number,
) => {
  const restoredTargetRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (!targetId) {
      restoredTargetRef.current = undefined;
      return;
    }
    if (restoredTargetRef.current === targetId) return;

    const root = scrollRef.current;
    if (!root) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-return-item-id]'))
      .find(element => element.dataset.returnItemId === targetId);
    if (!target) return;

    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const isVisible = targetRect.bottom > rootRect.top && targetRect.top < rootRect.bottom;
    if (!isVisible) {
      const centeredTop = root.scrollTop + targetRect.top - rootRect.top
        - (rootRect.height - targetRect.height) / 2;
      root.scrollTop = Math.max(0, centeredTop);
    }
    restoredTargetRef.current = targetId;
  }, [readyKey, scrollRef, targetId]);
};
