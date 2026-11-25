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
    if (!nav || !host || !chrome || !header || !modes) return;
    // 次级分区在首尾模式按钮之间居中，宽度收紧；连续底板保留原来的转折弧度。
    // 手机紧凑模式只有「当前模式」一粒按钮，不再按它收窄分区条。
    const measure = () => {
      const buttons = [...modes.querySelectorAll<HTMLButtonElement>(':scope > button')];
      const firstMode = buttons[0];
      const lastMode = buttons[buttons.length - 1];
      const gap = collapsed ? 0 : Math.max(0, chrome.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom);
      host.style.setProperty('--lab-tabs-chrome-gap', `${gap}px`);
      header.style.removeProperty('--lab-navigation-outline');
      delete header.dataset.labNavigation;
      if (!firstMode || !lastMode || buttons.length < 2 || modes.dataset.modeChrome === 'compact') {
        nav.style.removeProperty('--lab-tabs-width');
        nav.style.removeProperty('--lab-tabs-left');
        return;
      }
      const firstRect = firstMode.getBoundingClientRect(), lastRect = lastMode.getBoundingClientRect();
      const bodyRect = nav.nextElementSibling?.getBoundingClientRect();
      const available = lastRect.right - firstRect.left;
      if (!bodyRect || available <= 0) return;
      const width = Math.min(available, 30 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
      const inset = (available - width) / 2;
      nav.style.setProperty('--lab-tabs-width', `${width}px`);
      nav.style.setProperty('--lab-tabs-left', `${firstRect.left + inset - bodyRect.left}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // 正文尺寸就绪后再测一次：首次挂载时兄弟节点可能尚无宽度，漏测会让底板停在未连接状态。
    const body = nav.nextElementSibling as HTMLElement | null;
    for (const element of [chrome, header, modes, nav, body]) if (element) observer?.observe(element);
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    mutations?.observe(modes, { childList: true, attributes: true, attributeFilter: ['data-mode-chrome'] });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
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
        navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
      className={`relative min-w-0 rounded-lg text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-indigo-500 ${value === key ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>
      {t(label)}
    </button>)}
  </nav>;
};
