import React, { useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { InteractionPopover } from './InteractionPopover';

/** 说明与完整值脱离文档流展示，触屏、鼠标和键盘共用同一入口。 */
export const InfoPopover: React.FC<{
  label: string;
  content: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  preserveSelection?: boolean;
}> = ({ label, content, children, className = '', preserveSelection = false }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <>
    <button ref={anchor} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} title={typeof content === 'string' ? content : label}
      onMouseDown={event => { if (preserveSelection) event.preventDefault(); }} onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
      className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${children ? '' : 'mobile-touch inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'} ${className}`}>
      {children ?? <Info className="h-3.5 w-3.5" />}
    </button>
    {open && <ImagePreviewPortal><InteractionPopover id={id} label={label} anchorRef={anchor} onClose={() => setOpen(false)} className="p-3 text-sm text-gray-700 dark:text-gray-200">
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-bold text-gray-500 dark:text-gray-400">{label}</span><button type="button" onClick={() => setOpen(false)} aria-label="关闭说明" className="mobile-touch inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button></div>
      <div className="whitespace-pre-wrap break-words leading-relaxed select-text">{content}</div>
    </InteractionPopover></ImagePreviewPortal>}
  </>;
};
