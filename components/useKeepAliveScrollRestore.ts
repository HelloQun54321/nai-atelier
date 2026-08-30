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
 * - 容器隐藏（clientHeight 为 0，如窄屏打开详情）期间不终止追赶，等恢复可见后自动完成；
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

  // 尝试恢复一次；容器隐藏（clientHeight === 0）时无法恢复，返回 false 由调用方决定继续等待
  const restore = (): boolean => {
    const root = scrollRef.current;
    if (!root || !activeRef.current || options?.skipRestore || root.clientHeight === 0) return false;
    const saved = scrollCache.get(viewKey);
    if (saved === undefined || saved <= 0) return false;
    const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
    if (maxScroll <= 0) return false;
    root.scrollTop = Math.min(saved, maxScroll);
    return true;
  };

  // 1. 同步首帧恢复（在 DOM 布局完成后、绘制前执行，消除页面切回时的视觉跳跃）。
  //    注意：容器隐藏（clientHeight === 0）时仍更新激活时间戳——恢复动作由 restore()
  //    内部忽略，但时间戳保证后续容器恢复可见瞬间的虚假 0 事件落入 250ms 保护窗口。
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || options?.skipRestore) return;
    lastActivatedAtRef.current = Date.now();
    restore();
  }, [active, viewKey, options?.skipRestore, options?.trigger]);

  // 2. 异步持续追赶（针对图片/卡片等异步渲染未撑开全部高度的场景）
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || options?.skipRestore) return;

    const saved = scrollCache.get(viewKey);
    if (saved === undefined || saved <= 0) return;

    // 恢复锁在容器隐藏期间也保持，防止 hidden -> visible 过渡瞬间的 0 事件冲刷有效缓存
    isRestoringRef.current = true;
    lastActivatedAtRef.current = Date.now();
    restore();

    let chaseTimeoutId: number | null = null;

    const stopChasing = () => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      if (chaseTimeoutId !== null) {
        window.clearTimeout(chaseTimeoutId);
        chaseTimeoutId = null;
      }
      isRestoringRef.current = false;
    };

    const tryRestore = () => {
      const currentRoot = scrollRef.current;
      if (!currentRoot || !activeRef.current) return;
      restore();
      // 容器仍隐藏（如窄屏打开详情）时继续等待，不终止追赶
      if (currentRoot.clientHeight === 0) return;
      const currentSaved = scrollCache.get(viewKey) ?? 0;
      const maxScroll = Math.max(0, currentRoot.scrollHeight - currentRoot.clientHeight);
      // 正确终止条件：当前实际 scrollTop 已达到 saved，或者已达到当前 DOM 能滚动的最大极限
      if (currentRoot.scrollTop >= currentSaved || (maxScroll > 0 && currentRoot.scrollTop >= maxScroll)) {
        stopChasing();
      }
    };

    const scheduleChaseTimeout = () => {
      chaseTimeoutId = window.setTimeout(() => {
        const currentRoot = scrollRef.current;
        if (currentRoot && currentRoot.clientHeight === 0) {
          // 容器隐藏（如窄屏详情未关）时继续等待，恢复可见后由 tryRestore 完成恢复
          scheduleChaseTimeout();
          return;
        }
        stopChasing();
      }, 1200);
    };

    if (restoreTimerRef.current !== null) window.clearInterval(restoreTimerRef.current);
    restoreTimerRef.current = window.setInterval(tryRestore, 50);
    scheduleChaseTimeout();

    return () => {
      if (restoreTimerRef.current !== null) {
        window.clearInterval(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      if (chaseTimeoutId !== null) window.clearTimeout(chaseTimeoutId);
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
