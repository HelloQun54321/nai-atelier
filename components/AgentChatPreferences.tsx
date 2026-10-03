import React, { useEffect, useState } from 'react';
import { getAgentDisplayPreferences, setAgentDisplayPreferences, type AgentDisplayPreferences } from '../services/agentDisplayPreferences';

export const useAgentDisplayPreferences = () => {
  const [value, setValue] = useState(getAgentDisplayPreferences);
  useEffect(() => {
    const changed = (event: Event) => setValue((event as CustomEvent<AgentDisplayPreferences>).detail || getAgentDisplayPreferences());
    const stored = () => setValue(getAgentDisplayPreferences());
    window.addEventListener('nai-agent-display-changed', changed); window.addEventListener('storage', stored);
    return () => { window.removeEventListener('nai-agent-display-changed', changed); window.removeEventListener('storage', stored); };
  }, []);
  return value;
};

export const AgentChatDisplayOptions: React.FC = () => {
  const value = useAgentDisplayPreferences();
  return <fieldset className="space-y-1">
    <legend className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">过程显示</legend>
    {([['thinkingExpanded', '默认展开思考'], ['toolsExpanded', '默认展开工具']] as const).map(([key, label]) => <div key={key} className="flex min-h-10 items-center justify-between gap-4 rounded-lg px-1 text-sm text-gray-700 dark:text-gray-200">
      <span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={value[key]} onClick={() => setAgentDisplayPreferences({ [key]: !value[key] })} className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${value[key] ? 'bg-gray-800 dark:bg-gray-200' : 'bg-gray-200 dark:bg-gray-700'}`}><span className={`h-4 w-4 rounded-full shadow-sm transition-transform ${value[key] ? 'translate-x-4 bg-white dark:bg-gray-900' : 'translate-x-0 bg-white'}`} /></button>
    </div>)}
    <p className="pt-1 text-xs leading-5 text-gray-400">关闭时默认折叠，仍可逐条展开。会记住你的选择。</p>
  </fieldset>;
};

export const AgentDisclosure: React.FC<{ title: React.ReactNode; label: string; defaultExpanded: boolean; children: React.ReactNode; error?: boolean }> = ({ title, label, defaultExpanded, children, error }) => {
  const [open, setOpen] = useState(defaultExpanded);
  useEffect(() => setOpen(defaultExpanded), [defaultExpanded]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="my-2 min-w-0">
    <summary aria-label={label} className={`cursor-pointer select-none text-xs leading-6 ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{title}</summary>
    {open && <div className="mt-1 border-l border-gray-200 pl-3 dark:border-gray-700">{children}</div>}
  </details>;
};
