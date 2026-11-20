import React, { useLayoutEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { IconButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import { MobileBottomSheet, type ToolbarOverflowItem } from './MobileUI';

/**
 * 顶栏统一的「更多操作」入口：全站统一使用竖三点（MoreVertical）。
 * 桌面以锚定浮层展示，手机以底部面板展示；触发器沿用 IconButton，自动接入全局主题与触控底线。
 */
export const ToolbarOverflowMenu: React.FC<{
  items: ToolbarOverflowItem[];
  label?: string;
  className?: string;
  disabled?: boolean;
}> = ({ items, label = '更多操作', className = '', disabled = false }) => {
  useLanguage();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useLayoutEffect(() => {
    const sync = () => {
      const next = window.innerWidth < 768;
      setMobile(previous => {
        if (previous !== next) setOpen(false);
        return next;
      });
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  const entries = items.filter(Boolean);
  if (!entries.length) return null;
  const list = <div className="space-y-1">
    {entries.map(item => <button
      key={item.label}
      type="button"
      disabled={item.disabled}
      onClick={() => { setOpen(false); item.onClick(); }}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors disabled:opacity-40 ${item.tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
    >
      {item.icon && <span className="flex h-5 w-5 flex-none items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{t(item.label)}</span>
        {item.hint && <span className="mt-0.5 block truncate text-xs font-normal text-gray-500 dark:text-gray-400">{t(item.hint)}</span>}
      </span>
    </button>)}
  </div>;
  return <div ref={anchor} className={`relative flex-none ${className}`}>
    <IconButton
      label={label}
      active={open}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(value => !value)}
    >
      <MoreVertical className="h-4 w-4" />
    </IconButton>
    {open && (mobile
      ? <ImagePreviewPortal><MobileBottomSheet open title={label} onClose={() => setOpen(false)}>{list}</MobileBottomSheet></ImagePreviewPortal>
      : <AnchoredToolbarPopover anchorRef={anchor} title={t(label)} width={260} allowMobile compact onClose={() => setOpen(false)}>{list}</AnchoredToolbarPopover>)}
  </div>;
};
