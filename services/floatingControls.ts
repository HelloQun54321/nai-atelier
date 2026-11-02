import { useEffect, useState } from 'react';

/**
 * 图片上悬浮操作按钮（收藏／下载／复制／保存／删除、左右切换）的统一尺寸。
 * 只在本端保存：它影响的是点击手感，不属于主题预设，导入别人的主题不该改掉它。
 */
const STORAGE_KEY = 'nai_floating_control_size';
export const FLOATING_CONTROL_MIN = 28;
export const FLOATING_CONTROL_MAX = 48;
export const FLOATING_CONTROL_DEFAULT = 32;
export const FLOATING_CONTROL_EVENT = 'nai-floating-control-changed';

const clamp = (value: number) => Math.min(FLOATING_CONTROL_MAX, Math.max(FLOATING_CONTROL_MIN, Math.round(value)));

export const getFloatingControlSize = (): number => {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clamp(stored) : FLOATING_CONTROL_DEFAULT;
};

/** 写到根节点变量，所有悬浮按钮按它取宽高；缺省值时各处仍按 36px 回退。 */
export const applyFloatingControlSize = (size = getFloatingControlSize(), root: HTMLElement = document.documentElement) => {
  root.style.setProperty('--nai-float-control', `${clamp(size)}px`);
};

export const setFloatingControlSize = (size: number): number => {
  const next = clamp(size);
  localStorage.setItem(STORAGE_KEY, String(next));
  applyFloatingControlSize(next);
  window.dispatchEvent(new CustomEvent(FLOATING_CONTROL_EVENT, { detail: next }));
  return next;
};

export const restoreFloatingControlSize = () => applyFloatingControlSize();

export const useFloatingControlSize = (): [number, (size: number) => void] => {
  const [size, setSize] = useState(getFloatingControlSize);
  useEffect(() => {
    const sync = (event: Event) => setSize(Number((event as CustomEvent<number>).detail) || getFloatingControlSize());
    window.addEventListener(FLOATING_CONTROL_EVENT, sync);
    return () => window.removeEventListener(FLOATING_CONTROL_EVENT, sync);
  }, []);
  return [size, value => setSize(setFloatingControlSize(value))];
};
