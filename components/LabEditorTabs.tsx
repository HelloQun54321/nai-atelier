import React, { useLayoutEffect, useRef } from 'react';
import { t } from '../services/i18n';
import { useTopbarCollapsed } from '../services/workspaceTopbar';

const scrollAreas = (nav: HTMLElement | null) => {
  const body = nav?.nextElementSibling as HTMLElement | null;
  return [body, body?.querySelector<HTMLElement>('.chain-editor-main')];
};

/** 四模式共用分区；只切换可见内容，桌面编辑栏与手机正文分别保留滚动位置。 */
export const LabEditorTabs = <T extends string,>({ value, options, onChange }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) => {
  const navRef = useRef<HTMLElement>(null);
  const positions = useRef<Partial<Record<T, [number, number]>>>({});
  const collapsed = useTopbarCollapsed();
  useLayoutEffect(() => {
    const nav = navRef.current;
    const host = nav?.closest<HTMLElement>('.chain-editor-workspace');
    const chrome = host?.querySelector<HTMLElement>('.workspace-chrome');
    const header = host?.querySelector<HTMLElement>('.chain-editor-header');
    const modes = header?.querySelector<HTMLElement>('.generation-mode-nav');
    const firstMode = modes?.querySelector<HTMLButtonElement>(':scope > button:first-child');
    const lastMode = modes?.querySelector<HTMLButtonElement>(':scope > button:last-child');
    if (!nav || !host || !chrome || !header || !modes || !firstMode || !lastMode) return;
    // 次级分区在首尾模式按钮之间居中，宽度收紧；连续底板保留原来的转折弧度。
    const measure = () => {
      const firstRect = firstMode.getBoundingClientRect(), lastRect = lastMode.getBoundingClientRect();
      const modeRect = modes.getBoundingClientRect(), headerRect = header.getBoundingClientRect();
      const bodyRect = nav.nextElementSibling?.getBoundingClientRect();
      const available = lastRect.right - firstRect.left;
      if (!bodyRect || available <= 0) return;
      const width = Math.min(available, 30 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
      const inset = (available - width) / 2;
      nav.style.setProperty('--lab-tabs-width', `${width}px`);
      nav.style.setProperty('--lab-tabs-left', `${firstRect.left + inset - bodyRect.left}px`);
      // 共用一个连续轮廓，避免两块半透明底板重叠形成接缝。
      const w = headerRect.width, h = headerRect.height;
      const left = modeRect.left - headerRect.left + inset, right = modeRect.right - headerRect.left - inset;
      const bottom = h + nav.getBoundingClientRect().height;
      const radius = Math.min(parseFloat(getComputedStyle(header).borderTopLeftRadius) || 10, h / 2);
      const lowerRadius = Math.min(parseFloat(getComputedStyle(modes).borderTopLeftRadius) || radius, nav.getBoundingClientRect().height / 2);
      const turn = Math.max(0, Math.min(8, left - radius, w - right - radius));
      const outline = [
        `M ${radius} 0 H ${w - radius} Q ${w} 0 ${w} ${radius}`,
        `V ${h - radius} Q ${w} ${h} ${w - radius} ${h} H ${right + turn} Q ${right} ${h} ${right} ${h + turn}`,
        `V ${bottom - lowerRadius} Q ${right} ${bottom} ${right - lowerRadius} ${bottom}`,
        `H ${left + lowerRadius} Q ${left} ${bottom} ${left} ${bottom - lowerRadius}`,
        `V ${h + turn} Q ${left} ${h} ${left - turn} ${h} H ${radius} Q 0 ${h} 0 ${h - radius}`,
        `V ${radius} Q 0 0 ${radius} 0 Z`,
      ].join(' ');
      header.style.setProperty('--lab-navigation-outline', `path("${outline}")`);
      header.dataset.labNavigation = 'joined';
      const gap = collapsed ? 0 : Math.max(0, chrome.getBoundingClientRect().bottom - headerRect.bottom);
      // 留白变量也供同一工作区的正文避让使用；顶栏收起时编辑分区直接贴顶。
      host.style.setProperty('--lab-tabs-chrome-gap', `${gap}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // 正文尺寸就绪后再测一次：首次挂载时兄弟节点可能尚无宽度，漏测会让底板停在未连接状态。
    const body = nav.nextElementSibling as HTMLElement | null;
    for (const element of [chrome, header, modes, firstMode, lastMode, nav, body]) if (element) observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      host.style.removeProperty('--lab-tabs-chrome-gap');
      header.style.removeProperty('--lab-navigation-outline');
      delete header.dataset.labNavigation;
    };
  }, [collapsed]);
  useLayoutEffect(() => {
    const saved = positions.current[value] || [0, 0];
    scrollAreas(navRef.current).forEach((area, index) => { if (area) area.scrollTop = saved[index]; });
  }, [value]);
  const select = (next: T) => {
    if (next === value) return;
    const [body, main] = scrollAreas(navRef.current);
    positions.current[value] = [body?.scrollTop || 0, main?.scrollTop || 0];
    onChange(next);
  };
  return <nav ref={navRef} role="tablist" aria-label={t('编辑分区')} data-topbar-collapsed={collapsed ? 'true' : undefined} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} className="workspace-mode-tabs appearance-segmented relative z-30 grid h-11 flex-none border-b border-gray-200 bg-gray-100/90 dark:border-gray-800 dark:bg-gray-900/90">
    {options.map(([key, label], index) => <button key={key} type="button" role="tab" data-appearance="control" aria-selected={value === key} tabIndex={value === key ? 0 : -1}
      onClick={() => select(key)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index + options.length - 1) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        select(options[next][0]);
        navRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}
      className={`relative min-w-0 rounded-lg text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-indigo-500 ${value === key ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>
      {t(label)}
    </button>)}
  </nav>;
};
