import { RefObject, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { ImageActivityContext } from './SmartImage';

/**
 * keep-alive 视图滚动位置保持。
 *
 * 背景：App 层对已访问过的视图使用 display:none 保持挂载（避免重型图库反复重建）。
 * 浏览器在元素被 display:none 时会把 scrollTop 清零，因此切回视图后列表会回到顶部。
 *
 * 本 hook 在滚动时把 scrollTop 持续写入模块级缓存（视图间共享，天然跨 keep-alive 生命周期），
 * 并在视图重新激活（ImageActivityContext.active 变 true）或容器重新可见时恢复：
 * - useLayoutEffect 绘制前同步首帧恢复，消除切页闪动；
 * - 异步追赶在 1.2s 内每 50ms 追赶，直到实际滚动到位或达到容器可滚最大极限；
 * - 恢复期间锁定 handleScroll 写入，防止容器恢复瞬间浏览器的虚假 0 事件冲刷有效缓存。
 */
const scrollCache = new Map<string, number>();

export const useKeepAliveScrollRestore = (
  scrollRef: RefObject<HTMLElement | null>,
  viewKey: string,
  options?: { skipRestore?: boolean; trigger?: unknown },
) => {
  const active = useContext(ImageActivityContext);
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastActivatedAtRef = useRef(0);
  const isRestoringRef = useRef(false);
  const restoreTimerRef = useRef<number | null>(null);

  const restore = () => {
    const root = scrollRef.current;
    if (!root || !activeRef.current || options?.skipRestore || root.clientHeight === 0) return;
    const saved = scrollCache.get(viewKey);
    if (saved === undefined || saved <= 0) return;
    const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
    if (maxScroll <= 0) return;
    root.scrollTop = Math.min(saved, maxScroll);
  };

  // 1. 同步首帧恢复（在 DOM 布局完成后、绘制前执行，消除页面切回时的视觉跳跃）
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || options?.skipRestore || root.clientHeight === 0) return;
    lastActivatedAtRef.current = Date.now();
    restore();
  }, [active, viewKey, options?.skipRestore, options?.trigger]);

  // 2. 异步持续追赶（针对图片/卡片等异步渲染未撑开全部高度的场景）
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || options?.skipRestore || root.clientHeight === 0) return;

    const saved = scrollCache.get(viewKey);
    if (saved === undefined || saved <= 0) return;

    isRestoringRef.current = true;
    lastActivatedAtRef.current = Date.now();
    restore();

    const tryRestore = () => {
      const currentRoot = scrollRef.current;
      if (!currentRoot || !activeRef.current || currentRoot.clientHeight === 0) return;
      restore();
      const currentSaved = scrollCache.get(viewKey) ?? 0;
      const maxScroll = Math.max(0, currentRoot.scrollHeight - currentRoot.clientHeight);
      // 正确终止条件：当前实际 scrollTop 已达到 saved，或者已达到当前 DOM 能滚动的最大极限
      if (currentRoot.scrollTop >= currentSaved || (maxScroll > 0 && currentRoot.scrollTop >= maxScroll)) {
        if (restoreTimerRef.current !== null) {
          window.clearInterval(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
        isRestoringRef.current = false;
      }
    };

    if (restoreTimerRef.current !== null) window.clearInterval(restoreTimerRef.current);
    restoreTimerRef.current = window.setInterval(tryRestore, 50);
    const timeout = window.setTimeout(() => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      isRestoringRef.current = false;
    }, 1200);

    return () => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      window.clearTimeout(timeout);
      isRestoringRef.current = false;
    };
  }, [active, viewKey, options?.skipRestore, options?.trigger]);

  // 滚动时保存位置（仅在视图处于激活状态且非隐藏塌陷时记录，且在恢复期间/刚激活时屏蔽虚假的 0 滚动事件）
  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root || !activeRef.current || root.clientHeight === 0) return;
    const saved = scrollCache.get(viewKey) ?? 0;
    if (root.scrollTop === 0 && saved > 0 && (isRestoringRef.current || Date.now() - lastActivatedAtRef.current < 250)) {
      return;
    }
    scrollCache.set(viewKey, root.scrollTop);
  };

  return handleScroll;
};
