import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { MobileBottomSheet } from './MobileUI';
import { isTopmostModal, useModalA11y } from './useModalA11y';

export const TOOLBAR_FIELD_CLASS = 'mobile-touch mt-1.5 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const TOOLBAR_MENU_CLASS = 'mobile-touch flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:flex-none';

export function getToolbarPopoverPosition(anchor: { left: number; width: number; bottom: number }, panelWidth: number, viewportWidth: number, viewportHeight: number) {
  const width = Math.min(panelWidth, Math.max(0, viewportWidth - 24));
  const left = Math.min(Math.max(anchor.left + anchor.width / 2, width / 2 + 12), viewportWidth - width / 2 - 12);
  const top = Math.min(anchor.bottom + 8, Math.max(12, viewportHeight - 96));
  return { left, top, width, maxHeight: Math.max(0, viewportHeight - top - 12) };
}

const PopoverSurface: React.FC<{ title: string; position: ReturnType<typeof getToolbarPopoverPosition>; onClose: () => void; children: React.ReactNode }> = ({ title, position, onClose, children }) => {
  useLanguage();
  const panelRef = useModalA11y<HTMLDivElement>(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(panelRef.current)) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, panelRef]);
  return <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} style={position} className="appearance-panel fixed z-[1801] -translate-x-1/2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">{children}</div>;
};

/** 桌面弹层以按钮为中心，并脱离工作区裁切和隔离层。 */
export const AnchoredToolbarPopover: React.FC<{
  anchorRef: React.RefObject<HTMLElement | null>;
  title: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchorRef, title, width = 384, onClose, children }) => {
  useLanguage();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  useLayoutEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) { onClose(); return; }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const next = getToolbarPopoverPosition(anchor.getBoundingClientRect(), width, window.innerWidth, window.innerHeight);
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
  }, [anchorRef, width, onClose]);
  return <ImagePreviewPortal>
    <div className="fixed inset-0 z-[1800]" onClick={onClose} />
    <PopoverSurface title={title} position={position} onClose={onClose}>{children}</PopoverSurface>
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
  className?: string;
  children: React.ReactNode | ((close: () => void, mobile: boolean) => React.ReactNode);
}> = ({ label = '筛选', title, icon = <Filter />, count = 0, active, width, className = '', children }) => {
  useLanguage();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const close = React.useCallback(() => setOpen(false), []);
  useLayoutEffect(() => {
    const update = () => {
      const next = window.innerWidth < 768;
      setMobile(next);
      if (next !== mobile) setOpen(false);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [mobile]);
  const content = typeof children === 'function' ? children(close, mobile) : children;
  const countValue = typeof count === 'function' ? count(mobile) : count;
  return <div ref={anchorRef} className={`flex-none ${className}`}>
    <ToolbarButton onClick={() => setOpen(value => !value)} aria-label={`${t(label)}${countValue > 0 ? ` ${countValue}` : ''}`} aria-expanded={open} aria-haspopup="dialog" title={title} className={`mobile-touch !px-2.5 md:!px-3 ${(active ?? countValue > 0) ? '!border-indigo-300 !bg-indigo-50 !text-indigo-600 dark:!border-indigo-700 dark:!bg-indigo-950/40 dark:!text-indigo-300' : ''}`}>
      {icon}<span className="hidden sm:inline">{t(label)}{countValue > 0 ? ` ${countValue}` : ''}</span>
    </ToolbarButton>
    {open && (mobile ? <ImagePreviewPortal><MobileBottomSheet open title={title} onClose={close}>{content}</MobileBottomSheet></ImagePreviewPortal> : <AnchoredToolbarPopover anchorRef={anchorRef} title={title} width={width} onClose={close}>{content}</AnchoredToolbarPopover>)}
  </div>;
};
