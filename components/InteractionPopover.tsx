import React, { useEffect } from 'react';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';
import { isTopmostModal, useModalA11y } from './useModalA11y';

/** 在 Portal 内容挂载后管理定位、焦点和关闭，不增加原容器高度。 */
export const InteractionPopover: React.FC<React.PropsWithChildren<{
  id: string;
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  width?: number;
  align?: 'center' | 'end';
  className?: string;
}>> = ({ id, label, anchorRef, onClose, width = 320, align = 'center', className = '', children }) => {
  const panel = useModalA11y<HTMLDivElement>(true);
  const position = useAgentPopoverPosition(true, anchorRef, panel, width, align);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(panel.current)) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [anchorRef, onClose, panel]);
  return <>
    <div aria-hidden="true" className="fixed inset-0 z-[1900]" onPointerDown={event => { event.stopPropagation(); onClose(); }} onClick={event => event.stopPropagation()} />
    <div ref={panel} id={id} role="dialog" aria-modal="true" aria-label={label} style={position}
      onClick={event => event.stopPropagation()} className={`appearance-panel fixed z-[1901] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900 ${className}`}>{children}</div>
  </>;
};
