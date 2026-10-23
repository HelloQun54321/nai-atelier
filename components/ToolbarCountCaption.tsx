import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 只在原顶栏下沿叠放文字，不参与控件排列或滚动区高度计算。 */
export const ToolbarCountCaption: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const chrome = anchor.current?.closest('.workspace-chrome');
    // 原可见性容器负责收起，跨 React portal 的工具也按实际 DOM 归属定位。
    const target = chrome?.lastElementChild ?? anchor.current?.closest('[data-toolbar-caption-host]') ?? null;
    setHost(previous => previous === target ? previous : target);
  });
  return <><span ref={anchor} hidden />{host && createPortal(
    <span data-toolbar-count-caption="true" role="status"
      className="pointer-events-none absolute left-1/2 top-full z-30 max-w-[calc(100%-1rem)] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap text-center text-meta leading-none tabular-nums text-gray-500 dark:text-gray-300">
      {children}
    </span>, host)}</>;
};
