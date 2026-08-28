import { RefObject, useContext, useEffect, useRef } from 'react';
import { ImageActivityContext } from './SmartImage';

/**
 * keep-alive 视图滚动位置保持。
 *
 * 背景：App 层对已访问过的视图使用 display:none 保持挂载（避免重型图库反复重建）。
 * 浏览器在元素被 display:none 时会把 scrollTop 清零，因此切回视图后列表会回到顶部。
 *
 * 本 hook 在滚动时把 scrollTop 持续写入模块级缓存（视图间共享，天然跨 keep-alive 生命周期），
 * 并在视图重新激活（ImageActivityContext.active 变 true）时恢复：
 * - 若内容高度已足够直接恢复；
 * - 否则在 1s 内每帧追赶恢复，直到高度达标或超时。
 *
 * 用法：const scrollRef = useRef<HTMLDivElement>(null);
 *       useKeepAliveScrollRestore(scrollRef, 'characters');
 */
const scrollCache = new Map<string, number>();

export const useKeepAliveScrollRestore = (
  scrollRef: RefObject<HTMLElement | null>,
  viewKey: string,
  options?: { skipRestore?: boolean },
) => {
  const active = useContext(ImageActivityContext);
  const activeRef = useRef(active);
  activeRef.current = active;
  const restoreTimerRef = useRef<number | null>(null);

  // 恢复滚动位置（视图重新激活时）
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || options?.skipRestore) return;

    const restore = () => {
      const saved = scrollCache.get(viewKey);
      if (saved === undefined) return;
      // 内容尚未加载到足以滚动的位置时，先恢复可恢复的部分并继续追赶
      const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
      root.scrollTop = Math.min(saved, maxScroll);
    };
    restore();

    const tryRestore = () => {
      restore();
      const saved = scrollCache.get(viewKey) ?? 0;
      if (root.scrollTop >= saved || (root.scrollHeight - root.clientHeight) >= saved) {
        if (restoreTimerRef.current !== null) {
          window.clearInterval(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
      }
    };

    if (restoreTimerRef.current !== null) window.clearInterval(restoreTimerRef.current);
    restoreTimerRef.current = window.setInterval(tryRestore, 50);
    const timeout = window.setTimeout(() => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    }, 1200);

    return () => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      window.clearTimeout(timeout);
    };
    // scrollRef 不会变化，只依赖激活状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewKey, options?.skipRestore]);

  // 滚动时保存位置（仅在视图处于激活状态且非隐藏塌陷时记录，防止容器隐藏时浏览器的清零 scroll 事件覆盖有效缓存）
  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root || !activeRef.current || root.clientHeight === 0) return;
    scrollCache.set(viewKey, root.scrollTop);
  };

  return handleScroll;
};
