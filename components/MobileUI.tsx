import React, { useContext, useEffect, useId, useRef } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useModalA11y } from './useModalA11y';
import { ImageActivityContext } from './SmartImage';

export const MobileIconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
}> = ({ label, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`mobile-touch inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0 ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const useMobileHistoryLayer = (open: boolean, onClose: () => void, prefix: string) => {
  const active = useContext(ImageActivityContext);
  const reactId = useId();
  const markerRef = useRef(`${prefix}-${reactId}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 手机与平板窗口注册返回关闭，历史／灵感等模态同样适用；后台视图不参与返回。
    if (!open || !active || typeof window === 'undefined' || !window.matchMedia('(max-width: 1279px)').matches) return;
    const marker = markerRef.current;
    if (window.history.state?.__naiMobileLayer !== marker) {
      window.history.pushState({ ...(window.history.state || {}), __naiMobileLayer: marker,
        __naiMobileLayers: [...(window.history.state?.__naiMobileLayers || []), marker] }, '');
    }
    // 返回到子层的上一层时，仍在历史中的父层继续保留；不能一次返回全关。
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state?.__naiMobileLayers?.includes(marker)) onCloseRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.__naiMobileLayer === marker) window.history.back();
    };
  }, [open, active]);

  return () => {
    const marker = markerRef.current;
    if (typeof window !== 'undefined' && window.history.state?.__naiMobileLayer === marker) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };
};

export const MobileBottomSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, title, onClose, children, footer }) => {
  const requestClose = useMobileHistoryLayer(open, onClose, 'sheet');
  const dragStart = useRef<number | null>(null);
  // P2-17：底部弹层焦点管理（移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLElement>(open);
  if (!open) return null;

  return (
    <div className="mobile-layer md:hidden" onPointerDown={event => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mobile-sheet appearance-panel"
        onPointerDown={event => { dragStart.current = event.clientY; }}
        onPointerUp={event => {
          if (dragStart.current !== null && event.clientY - dragStart.current > 90) requestClose();
          dragStart.current = null;
        }}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-600" />
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="font-bold text-gray-900 dark:text-white">{title}</h2>
          <MobileIconButton label="关闭" onClick={requestClose} className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><X className="h-5 w-5" /></MobileIconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="appearance-surface mobile-safe-bottom border-t border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">{footer}</footer>}
      </section>
    </div>
  );
};

export const MobileDetailView: React.FC<{
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** 将本详情整体接入安全模式的点击揭示逻辑（标题 + 内嵌作品图一起随 work 组显示）。 */
  sensitiveTitle?: boolean;
}> = ({ open, title, subtitle, onClose, actions, footer, children, sensitiveTitle = false }) => {
  const requestClose = useMobileHistoryLayer(open, onClose, 'detail');
  // P2-17：全屏详情层焦点管理（移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLElement>(open);
  if (!open) return null;

  return (
    <section
      ref={dialogRef}
      className="mobile-detail appearance-surface md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-safe-mode-work={sensitiveTitle ? 'true' : undefined}
    >
      <header className="mobile-detail-header">
        <MobileIconButton label="返回" onClick={requestClose} className="text-gray-600 dark:text-gray-300">
          <ArrowLeft className="h-6 w-6" />
        </MobileIconButton>
        <div className="min-w-0 flex-1">
          <h2 data-safe-mode-title={sensitiveTitle ? 'true' : undefined} className="truncate text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <div data-safe-mode-title={sensitiveTitle ? 'true' : undefined} className="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${footer ? 'pb-24' : ''}`}>{children}</div>
      {footer && <footer className="mobile-detail-footer">{footer}</footer>}
    </section>
  );
};
