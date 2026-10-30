import { t, useLanguage } from '../services/i18n';
import { PressRevealSurface } from './PressRevealSurface';
import React, { useLayoutEffect, useRef } from 'react';
import { useGlassRefraction } from './useGlassRefraction';
import { toggleTopbarCollapsed, useTopbarCollapsed } from '../services/workspaceTopbar';
import { ArrowLeft, ChevronDown, Inbox, LoaderCircle, Search, X } from 'lucide-react';
export { UNTESTED_CHAIN_TAG, isUntestedChain } from '../services/chainStatus';

/** 弹层/面板右上角的关闭钮：复用 IconButton 的中性色阶与圆角。 */
export const CloseButton: React.FC<{ onClick: (e: React.MouseEvent) => void; label?: string; className?: string; size?: 'sm' | 'md'; 'data-agent-action'?: 'browse' }> = ({ onClick, label = '关闭', className = '', size = 'md', 'data-agent-action': agentAction }) => (
  <button
    data-agent-action={agentAction} data-appearance="control" data-control-kind="icon" data-tone="neutral"
    type="button"
    aria-label={t(label)}
    title={t(label)}
    onClick={onClick}
    className={`flex flex-none items-center justify-center rounded-xl border text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white ${
      size === 'sm' ? 'h-9 w-9' : 'h-10 w-10'
    } [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${className}`}
  >
    <X />
  </button>
);

/** 返回钮：常用于移动端覆盖层标题行左侧。 */
export const BackButton: React.FC<{ onClick: (e: React.MouseEvent) => void; label?: string; className?: string; 'data-agent-action'?: 'browse' }> = ({ onClick, label = '返回', className = '', 'data-agent-action': agentAction }) => (
  <button
    data-agent-action={agentAction} data-appearance="control" data-control-kind="icon" data-tone="neutral"
    type="button"
    aria-label={t(label)}
    title={t(label)}
    onClick={onClick}
    className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 outline-none transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${className}`}
  >
    <ArrowLeft />
  </button>
);

/** 页面级加载态：居中的旋转指示与文案。 */
export const PageSpinner: React.FC<{ label?: string; className?: string }> = ({ label = '加载中…', className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-gray-400 ${className}`} role="status" aria-live="polite">
    <LoaderCircle className="mb-3 h-8 w-8 animate-spin" />
    <p>{t(label)}</p>
  </div>
);

/** 空结果按整个页面正文居中；空间不足时仍留在滚动区内，避免压住目录。 */
export const WorkspacePageState: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current, content = host?.firstElementChild;
    const body = host?.closest('[data-workspace-body]');
    if (!host || !content || !body) return;
    const measure = () => {
      const area = body.getBoundingClientRect(), box = host.getBoundingClientRect();
      if (!area.width || !box.width) return;
      const room = Math.max(0, (box.width - content.getBoundingClientRect().width) / 2);
      const offset = (area.left + area.right - box.left - box.right) / 2;
      host.style.setProperty('--workspace-state-offset', `${Math.max(-room, Math.min(room, offset))}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    [host, content, body].forEach(node => observer?.observe(node));
    return () => observer?.disconnect();
  }, []);
  return <div {...props} ref={ref} data-workspace-page-state className={`flex justify-center ${className}`}>
    <div className="max-w-full" style={{ transform: 'translateX(var(--workspace-state-offset, 0px))' }}>{children}</div>
  </div>;
};

/** 列表/网格空态：可带图标、标题、提示与主操作。 */
export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode; className?: string }> = ({ icon, title, hint, action, className = '' }) => (
  <WorkspacePageState className={`items-center text-center ${className}`}>
    <div className="appearance-group flex max-w-xl flex-col items-center rounded-2xl p-6">
      <div className="appearance-group flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100 text-gray-400 dark:bg-gray-800/80 dark:text-gray-500">
        {icon ?? <Inbox className="h-8 w-8" aria-hidden="true" />}
      </div>
      <p className="mt-4 text-base font-bold text-gray-600 dark:text-gray-300">{title}</p>
      {hint && <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">{t(hint)}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  </WorkspacePageState>
);

/** 把顶栏及状态行叠在滚动内容上，实际高度同时用于首屏留白和焦点避让。 */
export const WorkspaceChrome: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const collapsed = useTopbarCollapsed();
  useLayoutEffect(() => {
    const chrome = ref.current, host = chrome?.parentElement;
    if (!chrome || !host) return;
    const previous = host.style.getPropertyValue('--workspace-chrome-height');
    let height = 0;
    const measure = () => {
      // 收起时无论隐藏与否都归零，让滚动内容真正顶到页面边缘。
      if (collapsed) {
        height = 0;
        host.style.setProperty('--workspace-chrome-height', '0px');
        return;
      }
      const next = chrome.offsetHeight;
      // 缓存页面隐藏时保留上次高度，重新显示不会先把内容拉到顶栏下面。
      if (next > 0 && next !== height) {
        height = next;
        host.style.setProperty('--workspace-chrome-height', `${height}px`);
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(chrome);
    return () => {
      observer?.disconnect();
      if (previous) host.style.setProperty('--workspace-chrome-height', previous);
      else host.style.removeProperty('--workspace-chrome-height');
    };
  }, [collapsed]);
  return <div ref={ref} className="workspace-chrome relative z-30 grid flex-none grid-cols-[2.75rem_minmax(0,1fr)] md:flex md:flex-col">
    {/* 手机展开时独占左列；电脑保留顶边中央把手和原有布局。 */}
    <button
      type="button"
      data-workspace-topbar-toggle="true"
      aria-expanded={!collapsed}
      aria-label={collapsed ? t('展开顶栏') : t('收起顶栏')}
      title={collapsed ? t('展开顶栏') : t('收起顶栏')}
      onClick={() => toggleTopbarCollapsed()}
      className={`group ${collapsed ? 'absolute left-0 top-0' : 'self-start'} z-40 flex h-11 min-h-11 w-11 min-w-11 items-center justify-center overflow-hidden rounded-full border border-gray-400/80 bg-transparent px-2 text-micro font-semibold leading-none text-gray-600 shadow-lg backdrop-blur-[2px] transition-all duration-150 hover:border-indigo-500 hover:bg-indigo-600 hover:text-white focus-visible:border-indigo-500 focus-visible:bg-indigo-600 focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:border-gray-400/70 dark:text-gray-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-500 md:absolute md:left-1/2 md:top-0 md:h-5 md:min-h-0 md:w-auto md:-translate-x-1/2`}
    >
      {/* CSS 三角尖角会让等距空隙显偏上／下；静止态也不给隐藏文案留 gap，避免三角偏一侧。 */}
      <span aria-hidden="true" className={`block h-0 w-0 shrink-0 border-x-[5px] border-x-transparent ${collapsed ? 'border-t-[6px] border-t-current -translate-y-px' : 'border-b-[6px] border-b-current translate-y-px'}`} />
      <span className="hidden max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 md:block md:group-hover:ml-1 md:group-hover:max-w-12 md:group-hover:opacity-100 md:group-focus-visible:ml-1 md:group-focus-visible:max-w-12 md:group-focus-visible:opacity-100">{collapsed ? t('展开') : t('收起')}</span>
    </button>
    {/* 收起时只切换可见性：实验室三分区依赖顶栏测量，重建子树会让共用底板丢失。 */}
    <div className={collapsed ? 'hidden' : 'flex min-w-0 flex-col md:contents'}>{children}</div>
  </div>;
};

export const WorkspaceToolbar: React.FC<{
  children: React.ReactNode;
  className?: string;
  /** 手机放不下时整排横向滑动；自带窄屏排布的顶栏可关闭。 */
  scrollable?: boolean;
}> = ({ children, className = '', scrollable = true }) => {
  const surface = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useGlassRefraction(surface);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // 只标记两侧是否还有被遮住的控件，由样式在对应边缘淡出；电脑端此层不产生盒子，始终不标记。
    const update = () => {
      const overflow = element.scrollWidth - element.clientWidth;
      element.toggleAttribute('data-overflow-start', overflow > 1 && element.scrollLeft > 1);
      element.toggleAttribute('data-overflow-end', overflow > 1 && element.scrollLeft < overflow - 1);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    // 跨过断点时此层在 contents 与滚动容器间切换，ResizeObserver 不一定触发，窗口尺寸变化也重算。
    window.addEventListener('resize', update);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const observeChildren = () => { resize?.disconnect(); resize?.observe(element); Array.from(element.children).forEach(child => resize?.observe(child)); update(); };
    observeChildren();
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(observeChildren);
    mutation?.observe(element, { childList: true });
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, []);
  return <header ref={surface} className={`workspace-page-heading workspace-command-bar relative z-30 flex flex-none items-center gap-2 overflow-visible border-b border-gray-200 bg-white px-3 py-0 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 ${className}`}>
    {scrollable ? <div ref={scroller} className="workspace-toolbar-scroll flex min-w-0 flex-1 items-center gap-2 self-stretch md:contents">{children}</div> : children}
  </header>;
};

export const ToolbarSearch: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {
  containerClassName?: string;
}> = ({ containerClassName = '', className = '', type = 'search', children, ...props }) => {
  const hasLeadingContent = children !== undefined;
  const Container = hasLeadingContent ? 'div' : 'label';
  return <Container className={`relative min-w-0 flex-1 md:max-w-md ${hasLeadingContent ? 'appearance-group flex items-center rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-1 max-[360px]:pl-1 max-[360px]:[&>svg]:hidden transition focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/10 dark:border-gray-800 dark:bg-gray-950/70 dark:focus-within:border-indigo-500/80 dark:focus-within:bg-gray-900' : 'block'} ${containerClassName}`}>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    {children}
    <input
      data-appearance="control" data-tone="neutral"
      type={type}
      autoComplete="off"
      data-lpignore="true"
      data-1p-ignore="true"
      data-form-type="other"
      {...props}
      className={`h-10 text-sm text-gray-900 outline-none transition dark:text-gray-100 ${hasLeadingContent ? 'min-w-0 flex-1 border-0 bg-transparent px-2 dark:bg-transparent' : 'w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-800 dark:bg-gray-950/70 dark:focus:border-indigo-500/80 dark:focus:bg-gray-900'} ${className}`}
    />
  </Container>;
};

const ICON_CONTROL_CLASS = 'inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';
const ICON_NEUTRAL_CLASS = 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white';

/** 来源导航使用原生链接，尺寸与图标按钮一致，并保留新窗口／键盘行为。 */
export const IconLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { label: string }> = ({ label, className = '', children, ...props }) => (
  <a data-appearance="control" data-control-kind="icon" data-tone="neutral" aria-label={t(label)} title={t(label)} className={`${ICON_CONTROL_CLASS} ${ICON_NEUTRAL_CLASS} ${className}`} {...props}>{children}</a>
);

export const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: 'neutral' | 'primary' | 'save' | 'edit' | 'danger' | 'favorite';
}> = ({ label, tone = 'neutral', className = '', children, ...props }) => {
  useLanguage();
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : tone === 'save'
      ? 'border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-700/90 dark:hover:bg-emerald-800'
    : tone === 'edit'
      ? 'border-purple-600 bg-purple-600 text-white hover:bg-purple-500 dark:border-purple-500/40 dark:bg-purple-600/90 dark:hover:bg-purple-500'
    : tone === 'favorite'
      ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400 dark:border-rose-500 dark:bg-rose-500 dark:text-white'
    : tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
      : ICON_NEUTRAL_CLASS;
  return (
    <button data-appearance="control" data-control-kind="icon" data-tone={tone} type="button" aria-label={t(label)} title={t(label)} className={`${ICON_CONTROL_CLASS} ${toneClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

/** 按钮与选择器共用外观；尺寸、字号和圆角由全局主题变量控制。 */
export const TOOLBAR_CONTROL_CLASS = 'inline-flex h-10 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';
const TOOLBAR_NEUTRAL_CLASS = 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800';

export const ToolbarButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'neutral' | 'primary' | 'save' | 'danger' | 'favorite';
  active?: boolean;
}> = ({ tone = 'neutral', active = false, className = '', children, ...props }) => {
  useLanguage();
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : tone === 'save'
      ? 'border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-700/90 dark:hover:bg-emerald-800'
    : tone === 'favorite'
      ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400 dark:border-rose-500 dark:bg-rose-500 dark:text-white'
    : tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
      : active
        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/60'
        : TOOLBAR_NEUTRAL_CLASS;
  return (
    <button data-appearance="control" data-tone={tone} data-active={active || undefined} type="button" className={`${TOOLBAR_CONTROL_CLASS} px-3 ${toneClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

/** 保留原生选择器键盘行为，用共用按钮外观与图标替代系统下拉外观。 */
export const ToolbarSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  icon?: React.ReactNode;
  containerClassName?: string;
}> = ({ label, icon, containerClassName = '', className = '', children, ...props }) => (
  <span className={`relative inline-flex flex-none ${containerClassName}`}>
    {icon && <span aria-hidden="true" className="toolbar-select-icon pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
    <select data-appearance="control" data-tone="neutral" aria-label={t(label)} title={t(label)} className={`${TOOLBAR_CONTROL_CLASS} ${TOOLBAR_NEUTRAL_CLASS} w-full appearance-none ${icon ? 'pl-9' : 'pl-3'} pr-9 ${className}`} {...props}>{children}</select>
    <ChevronDown aria-hidden="true" className="toolbar-select-chevron pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
  </span>
);

export const ToolbarLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: 'neutral' | 'primary';
}> = ({ tone = 'neutral', className = '', children, ...props }) => {
  useLanguage();
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white';
  return (
    <a data-appearance="control" data-tone={tone} className={`inline-flex h-10 flex-none items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${toneClass} ${className}`} {...props}>
      {children}
    </a>
  );
};

export const MediaCardShell: React.FC<React.HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'div';
  selected?: boolean;
  pressReveal?: boolean;
  pressDisabled?: boolean;
}> = ({ as = 'article', selected = false, pressReveal = false, pressDisabled = false, className = '', children, ...props }) => {
  useLanguage();
  const Element = pressReveal ? PressRevealSurface : as;
  return (
    <Element {...(pressReveal ? { as, pressDisabled } : {})} className={`media-card overflow-hidden rounded-2xl border bg-white transition dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800/80 dark:hover:border-gray-700'} ${className}`} {...props}>
      {children}
    </Element>
  );
};

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  title?: string;
  badge?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export const SegmentedControl = <T extends string = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
  ariaLabel,
}: SegmentedControlProps<T>) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={`inline-flex items-center rounded-xl border border-gray-200/60 bg-gray-100/90 p-1 dark:border-gray-800/80 dark:bg-gray-900/90 ${className}`}
  >
    {options.map(option => {
      const active = option.value === value;
      const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs';
      return (
        <button
          key={option.value}
          data-appearance="control"
          type="button"
          role="tab"
          aria-selected={active}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`flex items-center gap-1.5 rounded-lg font-bold transition-colors select-none whitespace-nowrap ${sizeClass} ${
            active
              ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span>{typeof option.label === 'string' ? t(option.label) : option.label}</span>
          {option.badge !== undefined && option.badge !== null && option.badge !== '' && (
            <span className={`rounded-full px-1.5 py-0.5 text-micro font-semibold leading-none ${
              active
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                : 'bg-gray-200/80 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
            }`}>
              {option.badge}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export const FilterPill: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}> = ({ active = false, className = '', children, ...props }) => (
  <button
    data-appearance="control"
    data-tone="neutral"
    data-active={active || undefined}
    aria-pressed={active}
    type="button"
    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-indigo-600 bg-indigo-600 text-white font-semibold shadow-sm'
        : 'border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
    } ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const ToolbarActionRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    detail?: string;
    tone?: 'default' | 'danger' | 'primary';
    disabled?: boolean;
    onClick: () => void;
}> = ({ icon, label, detail, tone = 'default', disabled = false, onClick }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`mobile-touch flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            tone === 'danger'
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                : tone === 'primary'
                    ? 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
        }`}
    >
        <span className="flex-none">{icon}</span>
        <span className="min-w-0 flex-1">{t(label)}</span>
        {detail && <span className="flex-none text-xs font-normal text-gray-400">{detail}</span>}
    </button>
);
