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
    className={`group min-w-0 ${className}`}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs font-bold text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800/45 dark:text-gray-400 dark:hover:border-indigo-700 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
      <span>{label}</span>
      <span className="flex items-center gap-1 text-[10px] font-medium text-gray-400">
        {open ? '收起' : '展开'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </span>
    </summary>
    <div className="mt-4 space-y-6">{children}</div>
  </details>;
};

