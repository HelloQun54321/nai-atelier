import React, { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Ellipsis, X } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { InteractionPopover } from './InteractionPopover';

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** 卡片低频操作共用点按入口，不依赖悬停或手机长按。 */
export const ActionMenu: React.FC<{ label: string; actions: MenuAction[]; className?: string }> = ({ label, actions, className = '' }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <>
    <button ref={anchor} type="button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
      className={`mobile-touch inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-gray-300 dark:hover:bg-gray-800 ${className}`}><Ellipsis className="h-4 w-4" /></button>
    {open && <ImagePreviewPortal><InteractionPopover id={id} label={label} anchorRef={anchor} width={240} align="end" onClose={() => setOpen(false)} className="p-1.5">
      {actions.map(action => <button key={action.label} type="button" onClick={() => {
        // 先完成菜单卸载与焦点归还，再打开详情或确认框，避免抢走新窗口焦点。
        flushSync(() => setOpen(false)); action.onSelect();
      }} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-gray-800 [&>svg]:h-4 [&>svg]:w-4 ${action.danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{action.icon}{action.label}</button>)}
      <button type="button" aria-label="关闭更多操作" onClick={() => setOpen(false)} className="flex min-h-11 w-full items-center gap-2 rounded-lg border-t border-gray-200 px-3 text-left text-sm text-gray-500 dark:border-gray-700"><X className="h-4 w-4" />关闭</button>
    </InteractionPopover></ImagePreviewPortal>}
  </>;
};
