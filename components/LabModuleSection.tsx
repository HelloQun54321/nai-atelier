import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LabPageModuleId } from '../services/appearancePreferences';

interface LabModuleSectionProps {
  moduleId: LabPageModuleId;
  label: string;
  defaultCollapsed: boolean;
  className?: string;
  children: React.ReactNode;
}

/** 实验室四种模式共用的可折叠、可设置初始展开状态容器。 */
export const LabModuleSection: React.FC<LabModuleSectionProps> = ({ moduleId, label, defaultCollapsed, className = '', children }) => {
  useLanguage();
  const [open, setOpen] = useState(!defaultCollapsed);

  useEffect(() => setOpen(!defaultCollapsed), [defaultCollapsed]);

  // 标题栏不另铺底色／appearance-group：与模块卡同一表面，展开后才像「这一块」而不是上条下卡。
  return <details
    open={open}
    onToggle={event => setOpen(event.currentTarget.open)}
    data-lab-module={moduleId}
    className={`lab-module-section appearance-reading-surface appearance-card appearance-group group min-w-0 rounded-xl border border-gray-200 bg-white/70 shadow-sm transition-all dark:border-gray-800 dark:bg-gray-900/60 overflow-hidden ${className}`}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-transparent px-4 py-3 text-xs font-bold text-gray-700 transition hover:bg-black/[0.03] hover:text-indigo-600 dark:text-gray-200 dark:hover:bg-white/[0.04] dark:hover:text-indigo-300 group-open:border-b group-open:border-gray-200/70 dark:group-open:border-gray-700/70 [&::-webkit-details-marker]:hidden">
      <span>{t(label)}</span>
      <span className="flex items-center gap-1 text-micro font-medium text-gray-400 dark:text-gray-500">
        {open ? t("收起") : t("展开")}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </span>
    </summary>
    <div className="space-y-4 p-4 pt-3">{children}</div>
  </details>;
};

