import React from 'react';
import { ChevronRight } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';

/**
 * 全局设置页共用视觉基元。
 * 统一所有设置分页与子模块的卡片容器、标题栏、滑动开关、下拉框、输入框、按钮与折叠面板，
 * 避免各模块各自拼接圆角、字号、边框套娃与开关形态。
 */

export const SETTINGS_CARD_CLASS =
  'appearance-group rounded-2xl border border-gray-200/90 bg-white/95 p-4 dark:border-gray-800 dark:bg-gray-900/75';

export const SETTINGS_SUBPANEL_CLASS =
  'appearance-group rounded-xl border border-gray-200/80 bg-gray-50/75 p-3 dark:border-gray-700/70 dark:bg-gray-800/45';

export const SETTINGS_DIVIDE_CLASS = 'divide-y divide-gray-100 dark:divide-gray-800/80';

export const SETTINGS_INPUT_CLASS =
  'mobile-touch h-9 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-100';

export const SETTINGS_TEXTAREA_CLASS =
  'w-full min-w-0 resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-100';

export const SETTINGS_BTN_PRIMARY =
  'mobile-touch inline-flex h-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-700 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600';

export const SETTINGS_BTN_NEUTRAL =
  'appearance-group mobile-touch inline-flex h-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800';

export const SETTINGS_BTN_DANGER =
  'mobile-touch inline-flex h-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-red-200/80 bg-red-50/70 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50';

export const SETTINGS_BTN_INLINE =
  'mobile-touch inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40';

export const SETTINGS_BTN_ICON =
  'mobile-touch inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-gray-200/80 bg-white/80 text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700/80 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-indigo-300';

export const SETTINGS_BTN_ICON_DANGER =
  'mobile-touch inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-transparent text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-400 dark:hover:bg-red-950/35';

export const SETTINGS_SEGMENT_CLASS =
  'mobile-touch flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-xs font-semibold transition md:min-h-9';
export const SETTINGS_SEGMENT_ON =
  'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-300';
export const SETTINGS_SEGMENT_OFF =
  'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600';

export interface SettingsCardHeaderProps {
  title: React.ReactNode;
  titleId?: string;
  headingLevel?: 3 | 4;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const SettingsCardHeader: React.FC<SettingsCardHeaderProps> = ({
  title,
  titleId,
  headingLevel = 3,
  icon,
  badge,
  description,
  action,
  className = '',
}) => {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {icon && <span aria-hidden="true" className="flex flex-none items-center text-indigo-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <Heading id={titleId} className="text-sm font-bold text-gray-900 dark:text-white">{title}</Heading>
          {badge}
        </div>
        {description && (
          <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</div>
        )}
      </div>
      {action && <div className="flex flex-none flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
};

export interface SettingsCardProps {
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  title?: React.ReactNode;
  titleId?: string;
  headingLevel?: 3 | 4;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  'data-agent-private'?: string;
  children: React.ReactNode;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  id,
  ariaLabel,
  ariaLabelledBy,
  title,
  titleId,
  headingLevel = 3,
  icon,
  badge,
  description,
  action,
  className = '',
  bodyClassName = '',
  'data-agent-private': agentPrivate,
  children,
}) => (
  <section
    id={id}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    data-agent-private={agentPrivate}
    className={`${SETTINGS_CARD_CLASS} ${className}`}
  >
    {title !== undefined && (
      <SettingsCardHeader
        title={title}
        titleId={titleId}
        headingLevel={headingLevel}
        icon={icon}
        badge={badge}
        description={description}
        action={action}
        className="mb-3"
      />
    )}
    <div className={bodyClassName}>{children}</div>
  </section>
);

export interface SettingsSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** 独立滑动开关控件：全设置页唯一尺寸（h-6 w-11）与唯一主题强调色。 */
export const SettingsSwitch: React.FC<SettingsSwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 flex-none cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45 ${
      checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'
    } ${className}`}
  >
    <span
      aria-hidden="true"
      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
        checked ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

export interface SettingsSwitchRowProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** 默认按 i18n 翻译；当调用方已翻译好时传 rawLabel=true 避免二次查表。 */
  rawLabel?: boolean;
  description?: string;
  note?: string;
  icon?: React.ReactNode;
  bordered?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * 整行可点滑动开关行：刻意不挂 data-appearance 与 mobile-touch，
 * 避免 themeDetails.css 固定 36px 控件高度压扁多行标题＋描述。
 */
export const SettingsSwitchRow: React.FC<SettingsSwitchRowProps> = ({
  checked,
  onChange,
  label,
  rawLabel = false,
  description,
  note,
  icon,
  bordered = false,
  disabled = false,
  className = '',
}) => {
  useLanguage();
  const displayLabel = rawLabel ? label : t(label);
  const displayDescription = description ? (rawLabel ? description : t(description)) : undefined;
  const displayNote = note ? (rawLabel ? note : t(note)) : undefined;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={displayLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        bordered
          ? 'appearance-group rounded-xl border border-gray-200/85 bg-white/80 px-3.5 py-2.5 hover:border-indigo-300 dark:border-gray-700/80 dark:bg-gray-900/60 dark:hover:border-indigo-700'
          : 'rounded-xl px-1 py-2.5 hover:text-indigo-700 dark:hover:text-indigo-300'
      } ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
          {icon && <span aria-hidden="true" className="flex flex-none items-center text-indigo-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <span className="min-w-0">{displayLabel}</span>
        </span>
        {displayDescription && (
          <span className="mt-1 block text-xs leading-5 font-normal text-gray-500 dark:text-gray-400">{displayDescription}</span>
        )}
        {displayNote && (
          <span className="mt-1 block text-meta leading-4 font-normal text-amber-600 dark:text-amber-400">{displayNote}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 flex-none rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
};

export interface SettingsSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

/** 统一原生下拉框：沿用原生单行箭头渲染，避免 Chromium 在自定义箭头下叠加双箭头或换行。 */
export const SettingsSelect: React.FC<SettingsSelectProps> = ({
  containerClassName = '',
  className = '',
  children,
  ...props
}) => (
  <span className={`inline-flex min-w-0 items-center ${containerClassName}`}>
    <select
      data-appearance="control"
      data-tone="neutral"
      className={`mobile-touch h-9 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-800 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-55 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-100 ${className}`}
      {...props}
    >
      {children}
    </select>
  </span>
);

export interface SettingsDisclosureProps {
  summary: React.ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  summaryClassName?: string;
  children: React.ReactNode;
}

/** 统一折叠面板：所有设置子页共用同一 ChevronRight 旋转指示器。 */
export const SettingsDisclosure: React.FC<SettingsDisclosureProps> = ({
  summary,
  open,
  onToggle,
  className = '',
  summaryClassName = '',
  children,
}) => (
  <details
    open={open}
    onToggle={onToggle ? event => onToggle(event.currentTarget.open) : undefined}
    className={`group min-w-0 ${className}`}
  >
    <summary
      className={`mobile-touch flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-gray-600 transition hover:text-indigo-600 dark:text-gray-300 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden ${summaryClassName}`}
    >
      <ChevronRight className="h-3.5 w-3.5 flex-none text-gray-400 transition-transform group-open:rotate-90" />
      <span className="min-w-0 flex-1">{summary}</span>
    </summary>
    {children}
  </details>
);
