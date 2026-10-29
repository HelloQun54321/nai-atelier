import { RefObject, useLayoutEffect, useRef } from 'react';

/** 瀑布流按任一列的实际末尾追加；普通网格继续使用原列表底部哨兵。 */
export const useGalleryLoadMore = (
  rootRef: RefObject<HTMLElement | null>,
  sentinelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  loadMore: () => void,
  rootMargin: string,
  // 成功页码／游标前进时，即使该页全被筛除也可继续；失败不推进。
  progress?: number | string,
) => {
  const latestLoadMore = useRef(loadMore);
  useLayoutEffect(() => { latestLoadMore.current = loadMore; }, [loadMore]);
  // DOM 更新时即解绑旧观察器，避免列尾变化与旧回调同时追加。
  useLayoutEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!enabled || !root || !sentinel || !('IntersectionObserver' in window)) return;
    let requested = false;
    let targets: Element[] = [];
    let cards: Element[] = [];
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      if (!disposed && !requested && entries.some(entry => entry.isIntersecting && targets.includes(entry.target))) {
        requested = true;
        latestLoadMore.current();
      }
    }, { root, rootMargin });
    const observeEnds = () => {
      // 分组列表只看最后一组；首帧还未测出列宽时等列尾出现，不误把空容器当成触底。
      const masonry = root.querySelectorAll('.chain-masonry');
      const lastGroup = masonry[masonry.length - 1];
      const nextTargets = lastGroup ? [...lastGroup.querySelectorAll('[data-masonry-load-end]')] : [sentinel];
      // 只以列表直属卡片变化开启下一轮，图标、文字等内部更新不能释放请求锁。
      const lists = lastGroup ? lastGroup.querySelectorAll('.chain-masonry-column') : root.querySelectorAll('.workspace-card-grid');
      const nextCards = [...lists].flatMap(list => [...list.children].filter(child => !child.hasAttribute('data-masonry-load-end')));
      const sameTargets = targets.length === nextTargets.length && targets.every((target, index) => target === nextTargets[index]);
      const sameCards = cards.length === nextCards.length && cards.every((card, index) => card === nextCards[index]);
      if (sameTargets && sameCards) return;
      targets = nextTargets;
      cards = nextCards;
      requested = false;
      observer.disconnect();
      targets.forEach(target => observer.observe(target));
    };
    observeEnds();
    const listSelector = '.chain-masonry, .chain-masonry-column, .workspace-card-grid, [data-masonry-load-end]';
    const mutation = new MutationObserver(records => {
      if (records.some(record => (record.target instanceof Element && record.target.matches(listSelector))
        || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
          && (node.matches(listSelector) || node.querySelector(listSelector))))) observeEnds();
    });
    mutation.observe(root, { childList: true, subtree: true });
    return () => { disposed = true; observer.disconnect(); mutation.disconnect(); };
  }, [rootRef, sentinelRef, enabled, rootMargin, progress]);
};
