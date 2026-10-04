import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const AgentPreferenceSwitch: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={onChange} className="mobile-touch inline-flex h-11 w-11 shrink-0 items-center justify-center bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2"><span className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}><span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} /></span></button>;

export const AgentChatDisplayOptions: React.FC = () => {
  const value = useAgentDisplayPreferences();
  return <fieldset className="space-y-1">
    <legend className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">过程显示</legend>
    {([['thinkingExpanded', '默认展开思考'], ['toolsExpanded', '默认展开工具']] as const).map(([key, label]) => <div key={key} className="flex min-h-10 items-center justify-between gap-4 rounded-lg px-1 text-sm text-gray-700 dark:text-gray-200">
      <span>{label}</span><AgentPreferenceSwitch label={label} checked={value[key]} onChange={() => setAgentDisplayPreferences({ [key]: !value[key] })} />
    </div>)}
  </fieldset>;
};

export const AgentGenerationOptions: React.FC = () => {
  const value = useAgentDisplayPreferences();
  return <div className="space-y-2">
    {([['autoApplyDraft', '自动应用提示词与参数'], ['autoShowGenerated', '生成后在聊天展示图片']] as const).map(([key, label]) => <div key={key} className="flex min-h-10 items-center justify-between gap-4 text-sm text-gray-700 dark:text-gray-200"><span>{label}</span><AgentPreferenceSwitch label={label} checked={value[key]} onChange={() => setAgentDisplayPreferences({ [key]: !value[key] })} /></div>)}
    <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">冲突保留两份；生图需确认。</p>
  </div>;
};

export const AgentDisclosure: React.FC<{ title: React.ReactNode; label: string; defaultExpanded: boolean; children: React.ReactNode; error?: boolean }> = ({ title, label, defaultExpanded, children, error }) => {
  const [open, setOpen] = useState(defaultExpanded);
  useEffect(() => setOpen(defaultExpanded), [defaultExpanded]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="my-2 min-w-0">
    <summary aria-label={label} className={`cursor-pointer select-none text-xs leading-6 ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{title}</summary>
    {open && <div className="mt-1 border-l border-gray-200 pl-3 dark:border-gray-700">{children}</div>}
  </details>;
};

/** 当前输出跟随末尾；主动上翻暂停，回到末尾或重新展开后恢复。历史内容保持阅读位置。 */
export const AgentLiveOutput: React.FC<{ text: string; live: boolean; label: string; className: string; as?: 'div' | 'pre' }> = ({ text, live, label, className, as: Element = 'div' }) => {
  const viewportRef = useRef<HTMLElement | null>(null);
  const followingRef = useRef(true);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (live && followingRef.current && element && !element.closest('details:not([open])')) element.scrollTop = element.scrollHeight;
  }, [text, live]);
  useEffect(() => {
    const element = viewportRef.current;
    const disclosure = element?.closest('details');
    if (!element || !disclosure || !live) return;
    const opened = () => {
      if (!disclosure.open) return;
      followingRef.current = true;
      if (!element.closest('details:not([open])')) element.scrollTop = element.scrollHeight;
    };
    disclosure.addEventListener('toggle', opened);
    return () => disclosure.removeEventListener('toggle', opened);
  }, [live]);
  return <Element ref={(element: HTMLDivElement | HTMLPreElement | null) => { viewportRef.current = element; }} aria-label={label} className={className} onScroll={event => {
    const element = event.currentTarget;
    followingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
  }}>{text}</Element>;
};
