import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** 判断元素是否对用户可见：排除 hidden 属性 / aria-hidden / 计算样式为隐藏。
 *  不依赖 offsetParent / 尺寸（jsdom 中恒为空，且对 fixed 定位祖先也失真）。 */
const isExposed = (element: HTMLElement) => {
  if (element.hasAttribute('hidden')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

/** 弹层内当前可聚焦元素（排除禁用 / aria-hidden / 不可见）。 */
const getFocusable = (root: HTMLElement | null) => {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element =>
    !element.closest('[aria-hidden="true"]') && isExposed(element),
  );
};

/**
 * 模态可访问性：打开时记住打开前的焦点元素并移入弹层，Tab/Shift+Tab 在弹层内循环，
 * 关闭后把焦点归还给触发元素。Esc 关闭仍由各组件既有的 window keydown 处理，
 * 不在本 hook 内重复绑定，避免与手势返回等路径双发。
 * 返回的 ref 应挂在弹层的内容容器（role="dialog" 节点）上。
 */
export const useModalA11y = <T extends HTMLElement = HTMLElement>(open: boolean) => {
  const dialogRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // 记住触发元素：多数弹层由按钮打开，此时焦点就在该按钮上；
    // 打开前焦点在 body（例如经程序触发）则不强行归还。
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;

    const dialog = dialogRef.current;
    if (dialog) {
      // 让弹层容器本身可聚焦（对话框卸载时移除该临时 tabindex 不必要——容器随 open 一并卸载）。
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      // 各弹层的 autoFocus 目标（取消钮/搜索框/名称输入）均位于首个可聚焦位置，
      // React 挂载时已聚焦，这里仅在无 autoFocus 时兜底移入第一个可聚焦元素。
      const autoFocused = dialog.querySelector<HTMLElement>('[autofocus]');
      const focusable = getFocusable(dialog);
      if (!autoFocused) (focusable[0] ?? dialog)?.focus();
    }

    // Tab 圈禁：焦点在弹层外或到达首/末元素时折返。
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = getFocusable(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !root.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !root.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      document.removeEventListener('keydown', handleTab);
      // 关闭后归还焦点；目标元素可能已卸载，仅当仍在文档中才聚焦。
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && target.isConnected && !(target instanceof HTMLButtonElement && target.disabled)) {
        target.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
};
