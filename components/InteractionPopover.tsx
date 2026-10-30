import { t, useLanguage } from '../services/i18n';
import React, { useEffect } from 'react';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useGlassRefraction } from './useGlassRefraction';
import { useMobileHistoryLayer } from './MobileUI';

/** 在 Portal 内容挂载后管理定位、焦点和关闭，不增加原容器高度。 */
export const InteractionPopover: React.FC<React.PropsWithChildren<{
  id: string;
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  width?: number;
  align?: 'center' | 'end';
  placement?: 'auto' | 'right';
  className?: string;
}>> = ({ id, label, anchorRef, onClose, width = 320, align = 'center', placement = 'auto', className = '', children }) => {
  useLanguage();
  const requestClose = useMobileHistoryLayer(true, onClose, 'interaction-popover');
  const panel = useModalA11y<HTMLDivElement>(true);
  useGlassRefraction(panel);
  const position = useAgentPopoverPosition(true, anchorRef, panel, width, align, placement);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) requestClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(panel.current)) { event.preventDefault(); event.stopPropagation(); requestClose(); }
    };
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [anchorRef, requestClose, panel]);
  return <>
    <div aria-hidden="true" className="fixed inset-0 z-[2100]" onPointerDown={event => { event.stopPropagation(); requestClose(); }} onClick={event => event.stopPropagation()} />
    <div ref={panel} id={id} role="dialog" aria-modal="true" aria-label={t(label)} style={position}
      onClick={event => event.stopPropagation()} className={`appearance-panel appearance-popover fixed z-[2101] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900 ${className}`}><div className="appearance-popover-content">{children}</div></div>
  </>;
};
