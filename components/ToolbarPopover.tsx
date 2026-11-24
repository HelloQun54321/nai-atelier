import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { IconButton, ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { MobileBottomSheet, useMobileHistoryLayer } from './MobileUI';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useGlassRefraction } from './useGlassRefraction';

export const TOOLBAR_LABEL_CLASS = 'block text-xs font-semibold text-gray-500 dark:text-gray-400';
export const TOOLBAR_FIELD_CLASS = 'mobile-touch mt-1.5 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-800 outline-none focus:border-indigo-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const TOOLBAR_MENU_CLASS = 'mobile-touch flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:flex-none';

export type FilterToggleTone = 'rose' | 'amber' | 'violet' | 'cyan' | 'indigo';

const FILTER_TOGGLE_ACTIVE: Record<FilterToggleTone, string> = {
  rose: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-300',
  violet: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700/70 dark:bg-violet-950/40 dark:text-violet-300',
  cyan: 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-700/70 dark:bg-cyan-950/40 dark:text-cyan-300',
  indigo: 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700/70 dark:bg-indigo-950/40 dark:text-indigo-300',
};

/** 筛选浮层内的统一布尔切换芯片，替代各页零散的复选框与自定义按钮。 */
export const FilterToggleButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  tone?: FilterToggleTone;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ active, onClick, icon, tone = 'indigo', disabled, className = '', children }) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={`mobile-touch flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0 ${
      active
        ? FILTER_TOGGLE_ACTIVE[tone]
        : 'appearance-group border-gray-200/80 bg-gray-50/80 text-gray-600 hover:border-gray-300 hover:bg-gray-100/80 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800'
    } ${className}`}
  >
    {icon}
    <span className="truncate">{children}</span>
  </button>
);

/** 筛选浮层统一底栏：左重置，右放辅助或提交操作。 */
export const FilterPanelFooter: React.FC<{
  onReset?: () => void;
  resetLabel?: string;
  resetDisabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}> = ({ onReset, resetLabel = '重置筛选', resetDisabled = false, children, className = '' }) => {
  useLanguage();
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800 ${className}`}>
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className="mobile-touch px-1 text-xs font-semibold text-indigo-600 transition-colors hover:text-indigo-700 disabled:opacity-40 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          {t(resetLabel)}
        </button>
      ) : <span />}
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
};

export function getToolbarPopoverPosition(anchor: { left: number; width: number; bottom: number; top?: number }, panelWidth: number, viewportWidth: number, viewportHeight: number, above = false) {
  const width = Math.min(panelWidth, Math.max(0, viewportWidth - 24));
  const left = Math.min(Math.max(anchor.left + anchor.width / 2, width / 2 + 12), viewportWidth - width / 2 - 12);
  const top = above ? Math.max(12, Math.min((anchor.top ?? anchor.bottom) - 8, viewportHeight - 12)) : Math.min(anchor.bottom + 8, Math.max(12, viewportHeight - 96));
  const originX = Math.max(0, Math.min(width, anchor.left + anchor.width / 2 - left + width / 2));
  return { left, top, width, maxHeight: Math.max(0, above ? top - 12 : viewportHeight - top - 12), transformOrigin: `${originX}px ${above ? 'bottom' : 'top'}` };
}

const PopoverSurface: React.FC<{ title: string; position: ReturnType<typeof getToolbarPopoverPosition>; above?: boolean; compact?: boolean; zIndex?: number; onClose: () => void; children: React.ReactNode }> = ({ title, position, above, compact, zIndex, onClose, children }) => {
  useLanguage();
  const panelRef = useModalA11y<HTMLDivElement>(true);
  useGlassRefraction(panelRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(panelRef.current)) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, panelRef]);
  return <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} data-compact={compact || undefined} style={{ ...position, ...(zIndex !== undefined ? { zIndex: zIndex + 1 } : {}) }} className={`appearance-panel appearance-popover fixed z-[2101] -translate-x-1/2 ${above ? '-translate-y-full' : ''} overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white ${compact ? 'p-1.5' : 'p-4'} shadow-xl dark:border-gray-800 dark:bg-gray-900`}><div className="appearance-popover-content">{children}</div></div>;
};

/** 桌面弹层以按钮为中心，并脱离工作区裁切和隔离层。 */
export const AnchoredToolbarPopover: React.FC<{
  anchorRef: React.RefObject<HTMLElement | null>;
  title: string;
  width?: number;
  above?: boolean;
  compact?: boolean;
  allowMobile?: boolean;
  zIndex?: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchorRef, title, width = 384, above = false, compact = false, allowMobile = false, zIndex, onClose, children }) => {
  useLanguage();
  const requestClose = useMobileHistoryLayer(allowMobile, onClose, 'anchored-popover');
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0, transformOrigin: 'center top' });
  useLayoutEffect(() => {
    const update = () => {
      if (!allowMobile && window.innerWidth < 768) { onClose(); return; }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const next = getToolbarPopoverPosition(anchor.getBoundingClientRect(), width, window.innerWidth, window.innerHeight, above);
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (anchorRef.current) {
      observer?.observe(anchorRef.current);
      if (anchorRef.current.closest('header')) observer?.observe(anchorRef.current.closest('header')!);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, width, above, allowMobile, onClose]);
  return <ImagePreviewPortal>
    <div className="fixed inset-0 z-[2100]" style={{ zIndex }} onClick={requestClose} />
    <PopoverSurface title={title} position={position} above={above} compact={compact} zIndex={zIndex} onClose={requestClose}>{children}</PopoverSurface>
  </ImagePreviewPortal>;
};

/** 同一套内容在桌面锚定展示、手机使用底部面板。 */
export const ToolbarPopover: React.FC<{
  label?: string;
  title: string;
  icon?: React.ReactNode;
  count?: number | ((mobile: boolean) => number);
  active?: boolean;
  width?: number;
  above?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  iconTone?: React.ComponentProps<typeof IconButton>['tone'];
  zIndex?: number;
  disabled?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode | ((close: () => void, mobile: boolean) => React.ReactNode);
}> = ({ label = '筛选', title, icon = <Filter />, count = 0, active, width, above, compact, iconOnly, iconTone, zIndex, disabled, className = '', open: controlledOpen, onOpenChange, children }) => {
  useLanguage();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback((value: boolean) => { setInternalOpen(value); onOpenChange?.(value); }, [onOpenChange]);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  useLayoutEffect(() => {
    const update = () => {
      const next = window.innerWidth < 768;
      setMobile(next);
      if (next !== mobile) setOpen(false);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [mobile, setOpen]);
  const content = typeof children === 'function' ? children(close, mobile) : children;
  const countValue = typeof count === 'function' ? count(mobile) : count;
  const triggerActive = active ?? countValue > 0;
  const accessibleLabel = `${t(label)}${countValue > 0 ? ` ${countValue}` : ''}`;
  return <div ref={anchorRef} className={`flex-none ${className}`}>
    {iconOnly ? <IconButton data-agent-action="browse" label={accessibleLabel} title={title} tone={iconTone} active={triggerActive} disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" className="relative">
      {icon}
      {countValue > 0 && <span aria-hidden="true" data-filter-count={countValue} className="pointer-events-none absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-mini font-bold leading-4 text-white ring-2 ring-white tabular-nums dark:ring-gray-900">{countValue}</span>}
    </IconButton> : <ToolbarButton data-agent-action="browse" disabled={disabled} active={triggerActive} onClick={() => setOpen(!open)} aria-label={accessibleLabel} aria-expanded={open} aria-haspopup="dialog" title={title} className="mobile-touch relative !px-2.5 md:!px-3">
      {icon}<span className="toolbar-responsive-label hidden md:inline">{t(label)}</span>
      {countValue > 0 && <span aria-hidden="true" data-filter-count={countValue} className="pointer-events-none absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-mini font-bold leading-4 text-white ring-2 ring-white tabular-nums dark:ring-gray-900">{countValue}</span>}
    </ToolbarButton>}
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={title} zIndex={zIndex} onClose={close}>{content}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={title} width={width} above={above} compact={compact} zIndex={zIndex} onClose={close}>{content}</AnchoredToolbarPopover>)}
  </div>;
};
