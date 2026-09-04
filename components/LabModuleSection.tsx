import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LabPageModuleId } from '../services/appearancePreferences';

interface LabModuleSectionProps {
  moduleId: LabPageModuleId;
  label: string;
  order: number;
  defaultCollapsed: boolean;
  className?: string;
  children: React.ReactNode;
}

/** 实验室四种模式共用的可排序、可记忆初始展开状态容器。 */
export const LabModuleSection: React.FC<LabModuleSectionProps> = ({ moduleId, label, order, defaultCollapsed, className = '', children }) => {
  const [open, setOpen] = useState(!defaultCollapsed);

  useEffect(() => setOpen(!defaultCollapsed), [defaultCollapsed]);

  return <details
    open={open}
    onToggle={event => setOpen(event.currentTarget.open)}
    data-lab-module={moduleId}
    style={{ order }}
    className={`group min-w-0 rounded-xl border border-gray-200 bg-white/70 shadow-sm transition-all dark:border-gray-800 dark:bg-gray-900/60 overflow-hidden ${className}`}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-gray-50/70 px-4 py-3 text-xs font-bold text-gray-700 transition hover:bg-gray-100/80 hover:text-indigo-600 dark:bg-gray-800/45 dark:text-gray-300 dark:hover:bg-gray-800/70 dark:hover:text-indigo-300 group-open:border-b group-open:border-gray-200/80 group-open:bg-gray-50/90 dark:group-open:border-gray-800 dark:group-open:bg-gray-800/60 [&::-webkit-details-marker]:hidden">
      <span>{label}</span>
      <span className="flex items-center gap-1 text-micro font-medium text-gray-400">
        {open ? '收起' : '展开'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </span>
    </summary>
    <div className="p-4 space-y-4">{children}</div>
  </details>;
};

