import { t, useLanguage } from '../services/i18n';
import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X, MoreHorizontal } from 'lucide-react';
import { useModalA11y } from './useModalA11y';
import { ImageActivityContext } from './SmartImage';

export const MobileIconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
}> = ({ label, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={t(label)}
    title={t(label)}
    className={`mobile-touch inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0 ${className}`}
    {...props}
  >
    {children}
  </button>
);

export type ToolbarOverflowItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** 危险操作在菜单里标红，不与常规项同色。 */
  tone?: 'danger';
  hint?: string;
};

/**
 * 手机顶栏的「更多」入口：顶栏只留搜索、主操作和它，其余低频操作收进底部弹层。
 * 每行 44px 且带文字，替代原先挤在顶栏里的纯图标按钮。
 */
export const MobileOverflowMenu: React.FC<{
  items: ToolbarOverflowItem[];
  label?: string;
  className?: string;
}> = ({ items, label = '更多操作', className = '' }) => {
  useLanguage();
  const [open, setOpen] = useState(false);
  const entries = items.filter(Boolean);
  if (!entries.length) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t(label)}
        title={t(label)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`appearance-group mobile-touch inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 ${className}`}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {/* 顶栏带玻璃滤镜会创建定位包含块，弹层必须挂到 body，否则会被困在 56px 高的顶栏里。 */}
      {typeof document === 'undefined' ? null : createPortal(
        <MobileBottomSheet open={open} title={label} onClose={() => setOpen(false)}>
          <div className="space-y-1">
            {entries.map(item => (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors disabled:opacity-40 ${item.tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
              >
                {item.icon && <span className="flex h-5 w-5 flex-none items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t(item.label)}</span>
                  {item.hint && <span className="mt-0.5 block truncate text-xs font-normal text-gray-500 dark:text-gray-400">{t(item.hint)}</span>}
                </span>
              </button>
            ))}
          </div>
        </MobileBottomSheet>,
        document.body,
      )}
    </>
  );
};

export const useMobileHistoryLayer = (open: boolean, onClose: () => void | boolean, prefix: string) => {
  const active = useContext(ImageActivityContext);
  const reactId = useId();
  const markerRef = useRef(`${prefix}-${reactId}`);
  const registrationRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [historyReady, setHistoryReady] = useState(false);
  // 首次挂载稳定后再入栈，避免 StrictMode 试清理的异步返回关闭新窗口。
  useEffect(() => setHistoryReady(true), []);

  useEffect(() => {
    // 手机与平板窗口注册返回关闭，历史／灵感等模态同样适用；后台视图不参与返回。
    if (!historyReady || !open || !active || typeof window === 'undefined') return;
    // 窄窗打开父层后放宽窗口，子层仍沿用该返回栈，避免一次返回连带关闭父层。
    if (!window.matchMedia?.('(max-width: 1279px)').matches && !window.history.state?.__naiMobileLayers?.length) return;
    const marker = markerRef.current;
    const registration = ++registrationRef.current;
    if (!window.history.state?.__naiMobileLayers?.includes(marker)) {
      window.history.pushState({ ...(window.history.state || {}), __naiMobileLayer: marker,
        __naiMobileLayers: [...(window.history.state?.__naiMobileLayers || []), marker] }, '');
    }
    const layerState = window.history.state;
    // 返回到子层的上一层时，仍在历史中的父层继续保留；不能一次返回全关。
    const handlePopState = (event: PopStateEvent) => {
      if (!event.state?.__naiMobileLayers?.includes(marker) && onCloseRef.current() === false) {
        // 在途保存拒绝关闭时补回当前层，下一次返回仍只作用于此窗口。
        window.history.pushState(layerState, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // StrictMode／保留子树重连会立刻重新 setup，不把试清理当作真实关闭。
      queueMicrotask(() => {
        if (registrationRef.current === registration && window.history.state?.__naiMobileLayer === marker) window.history.back();
      });
    };
  }, [historyReady, open, active]);

  return React.useCallback(() => {
    const marker = markerRef.current;
    if (typeof window !== 'undefined' && window.history.state?.__naiMobileLayer === marker) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  }, []);
};

export const MobileBottomSheet: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  zIndex?: number;
}> = ({ open, title, onClose, children, footer, zIndex }) => {
  useLanguage();
  const requestClose = useMobileHistoryLayer(open, onClose, 'sheet');
  const dragStart = useRef<number | null>(null);
  // P2-17：底部弹层焦点管理（移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLElement>(open);
  if (!open) return null;

  return (
    <div className="mobile-layer md:hidden" style={{ zIndex }} onPointerDown={event => {
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
          <MobileIconButton data-agent-action="browse" label={t("关闭")} onClick={requestClose} className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><X className="h-5 w-5" /></MobileIconButton>
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
  useLanguage();
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
        <MobileIconButton data-agent-action="browse" label={t("返回")} onClick={requestClose} className="text-gray-600 dark:text-gray-300">
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
