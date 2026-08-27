import React from 'react';
import { Search } from 'lucide-react';

/**
 * 内部技术标记：双下划线约定（如 __character_catalog__）或来源/类型标记（NAI、aitag），
 * 仅用于程序内部归类，不应面向用户展示。
 */
const INTERNAL_TAG_NAMES: Record<string, true> = { nai: true, aitag: true };
export const isInternalChainTag = (tag: string): boolean =>
  (tag.startsWith('__') && tag.endsWith('__')) || INTERNAL_TAG_NAMES[tag.toLowerCase()] === true;

/** 批量导入后未亲自实测的风格串标识 */
export const UNTESTED_CHAIN_TAG = '待实测';
export const isUntestedChain = (chain: { tags?: string[] } | null | undefined): boolean =>
  Boolean(chain && Array.isArray(chain.tags) && chain.tags.includes(UNTESTED_CHAIN_TAG));

export const WorkspaceToolbar: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <header className={`workspace-page-heading workspace-command-bar relative z-30 flex flex-none items-center gap-2 overflow-visible border-b border-gray-200 bg-white px-3 py-0 dark:border-gray-800/80 dark:bg-gray-900/90 md:px-5 ${className}`}>
    {children}
  </header>
);

export const ToolbarSearch: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {
  containerClassName?: string;
}> = ({ containerClassName = '', className = '', ...props }) => (
  <label className={`relative block min-w-0 flex-1 md:max-w-md ${containerClassName}`}>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    <input
      {...props}
      className={`h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/10 dark:border-gray-800 dark:bg-gray-950/70 dark:text-gray-100 dark:focus:border-indigo-500/80 dark:focus:bg-gray-900 ${className}`}
    />
  </label>
);

export const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: 'neutral' | 'primary' | 'danger' | 'favorite';
}> = ({ label, tone = 'neutral', className = '', children, ...props }) => {
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : tone === 'favorite'
      ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400 dark:border-rose-500 dark:bg-rose-500 dark:text-white'
    : tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white';
  return (
    <button type="button" aria-label={label} title={label} className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${toneClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const ToolbarButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'neutral' | 'primary' | 'danger' | 'favorite';
}> = ({ tone = 'neutral', className = '', children, ...props }) => {
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : tone === 'favorite'
      ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-400 dark:border-rose-500 dark:bg-rose-500 dark:text-white'
    : tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800';
  return (
    <button type="button" className={`inline-flex h-10 flex-none items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${toneClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const ToolbarLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: 'neutral' | 'primary';
}> = ({ tone = 'neutral', className = '', children, ...props }) => {
  const toneClass = tone === 'primary'
    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-600/90 dark:hover:bg-indigo-500'
    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-white';
  return (
    <a className={`inline-flex h-10 flex-none items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${toneClass} ${className}`} {...props}>
      {children}
    </a>
  );
};

export const MediaCardShell: React.FC<React.HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'div';
  selected?: boolean;
}> = ({ as = 'article', selected = false, className = '', children, ...props }) => {
  const Element = as;
  return (
    <Element className={`media-card overflow-hidden rounded-2xl border bg-white transition dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800/80 dark:hover:border-gray-700'} ${className}`} {...props}>
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
    className={`inline-flex items-center rounded-xl bg-gray-100 p-1 dark:bg-gray-900/90 ${className}`}
  >
    {options.map(option => {
      const active = option.value === value;
      const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs';
      return (
        <button
          key={option.value}
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
          <span>{option.label}</span>
          {option.badge !== undefined && option.badge !== null && option.badge !== '' && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
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
    type="button"
    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-600 text-white font-semibold shadow-sm'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
    } ${className}`}
    {...props}
  >
    {children}
  </button>
);
