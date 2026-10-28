import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';

/** 用途分组只折叠显示；展开过的输入框保留挂载，收起不丢撤销与编辑状态。 */
export function PromptPurposeGroup({ id, label, summary = '', defaultOpen = false, children }: {
  id: string; label: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  useLanguage();
  const [open, setOpen] = useState(defaultOpen);
  const [visited, setVisited] = useState(defaultOpen);
  return <section data-prompt-purpose-group={id} className="appearance-group min-w-0 rounded-xl border border-gray-200 dark:border-gray-700">
    <button type="button" aria-expanded={open} aria-label={t(label)} onClick={() => { setOpen(!open); setVisited(true); }}
      className="mobile-touch flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-200">
      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      <span className="shrink-0">{t(label)}</span>
      {summary && <span title={summary} className="min-w-0 flex-1 truncate text-right text-xs font-normal text-gray-500 dark:text-gray-400">{summary}</span>}
    </button>
    {visited && <div hidden={!open} className="min-w-0 space-y-3 p-3 pt-1">{children}</div>}
  </section>;
}
