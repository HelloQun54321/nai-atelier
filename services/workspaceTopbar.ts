import { useSyncExternalStore } from 'react';

/**
 * 页面顶栏收起状态：所有 keep-alive 页面共用一份，刷新后保留。
 * 收起后顶栏与状态行整体隐藏，只在顶边中央留下一个展开把手。
 * 手机与平板（没有侧栏、顶栏横跨整屏的形态）不渲染把手，
 * 收起态在那里一律按展开处理，避免顶栏和恢复入口一起消失。
 */
const STORAGE_KEY = 'nai_workspace_topbar_collapsed';
/** 与 index.css 隐藏把手的断点保持一致：1024 起才有侧栏，也才有把手。 */
const PHONE_QUERY = '(max-width: 1023px)';
const listeners = new Set<() => void>();

const read = (): boolean => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
};

const media = typeof window === 'undefined' || typeof window.matchMedia !== 'function'
  ? null
  : (() => { try { return window.matchMedia(PHONE_QUERY); } catch { return null; } })();

let collapsed = typeof window === 'undefined' ? false : read();
let phone = media?.matches === true;

const emit = () => listeners.forEach(listener => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** 跨标签页同步；同一窗口由模块内监听集合即时通知。 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    collapsed = read();
    emit();
  });
}

/** 跨断点时重新广播：宽屏收起后缩到手机宽度，顶栏要立刻回来。 */
if (media) {
  const sync = (matches: boolean) => {
    if (phone === matches) return;
    phone = matches;
    emit();
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', event => sync(event.matches));
  else if (typeof media.addListener === 'function') media.addListener(event => sync(event.matches));
}

/** 手机没有把手，收起态不生效；真值仍留在存储里，回到宽屏继续沿用。 */
export const getTopbarCollapsed = () => collapsed && !phone;

export const setTopbarCollapsed = (value: boolean) => {
  if (collapsed === value) return;
  collapsed = value;
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* 隐私模式仍保留本次会话状态 */ }
  emit();
};

export const toggleTopbarCollapsed = () => setTopbarCollapsed(!collapsed);

export const useTopbarCollapsed = () => useSyncExternalStore(subscribe, getTopbarCollapsed, () => false);
