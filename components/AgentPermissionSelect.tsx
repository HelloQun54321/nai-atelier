import { t, useLanguage } from '../services/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';
import { Check, ChevronDown, Eye, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { promptAgentService, type AgentPermissionMode } from '../services/promptAgent';

const levels = [
  { mode: 'read_only', name: '只读', icon: Eye, description: '查询项目资料、浏览和展示图片，不修改或保存。' },
  { mode: 'standard', name: '标准', icon: ShieldCheck, description: '正常操作项目；首次向电脑目标目录写入图片时请你批准。' },
  { mode: 'full', name: '完全访问', icon: ShieldAlert, description: '自动读取、保存和复制图片，也可创建目标文件夹。' },
] as const;

export const AgentPermissionSelect: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  useLanguage();
  const [mode, setMode] = useState<AgentPermissionMode>('standard');
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const position = useAgentPopoverPosition(open, trigger, menu);
  const mounted = useRef(false);
  const saving = useRef(false);
  const requestSequence = useRef(0);
  const selected = levels.find(item => item.mode === mode)!;
  const Icon = selected.icon;
  const positioned = position !== undefined;

  const load = useCallback(async () => {
    if (saving.current) return;
    const sequence = ++requestSequence.current;
    try {
      const config = await promptAgentService.getConfig();
      if (!mounted.current || sequence !== requestSequence.current) return;
      const supported = levels.some(item => item.mode === config.permissionMode);
      if (supported) setMode(config.permissionMode!);
      setAvailable(supported);
      setError(supported ? '' : '请先重启本地服务以启用权限设置');
    } catch {
      if (mounted.current && sequence === requestSequence.current) setError('权限设置暂不可用');
    } finally {
      if (mounted.current && sequence === requestSequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    window.addEventListener('nai-agent-permissions-changed', load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false; requestSequence.current++;
      window.removeEventListener('nai-agent-permissions-changed', load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  useEffect(() => { if (disabled || !available) setOpen(false); }, [disabled, available]);
  useEffect(() => {
    if (open && positioned) menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open, positioned]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const change = async (next: AgentPermissionMode) => {
    if (next === mode) { close(); return; }
    saving.current = true; requestSequence.current++; setBusy(true); setError('');
    let saved = false;
    try {
      const config = await promptAgentService.setPermissionMode(next);
      if (!mounted.current) return;
      setMode(config.permissionMode || next); close(); saved = true;
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '权限修改失败');
    } finally {
      saving.current = false;
      if (mounted.current) { setBusy(false); if (saved) window.dispatchEvent(new Event('nai-agent-permissions-changed')); }
    }
  };
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    }
  };
  return <div className="min-w-0">
    <button ref={trigger} type="button" aria-label={t("助手权限")} aria-haspopup="menu" aria-expanded={open} disabled={disabled || busy || !available} title={disabled ? t("任务执行期间不能切换权限") : `${t(selected.name)}: ${t(selected.description)}`} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-xs transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:hover:bg-gray-800 ${mode === 'full' && available ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}<span>{available ? t(selected.name) : busy ? t("读取权限…") : t("权限未就绪")}</span><ChevronDown className="h-3 w-3" />
    </button>
    {error && <p role="alert" className="max-w-64 break-words text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
    {open && createPortal(<div ref={menu} role="menu" data-agent-surface aria-label={t("选择助手权限")} onKeyDown={keyboard} style={{ ...position, visibility: position ? 'visible' : 'hidden' }} className="appearance-panel z-[1300] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      {levels.map(item => { const LevelIcon = item.icon; const active = item.mode === mode; return <button key={item.mode} type="button" role="menuitemradio" aria-checked={active} disabled={busy || disabled} onClick={() => void change(item.mode)} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:opacity-50 ${active ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'} ${item.mode === 'full' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'}`}>
        <LevelIcon className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t(item.name)}</span><span className={`mt-0.5 block text-xs leading-5 ${item.mode === 'full' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{t(item.description)}</span></span>{active && <Check aria-label={t("已选择")} className="mt-0.5 h-4 w-4 shrink-0" />}
      </button>; })}
      <p className="mt-1 border-t border-gray-100 px-3 pb-1 pt-2 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:text-gray-400">{t("仅图片文件；生图／删除／清空需确认。")}</p>
    </div>, document.body)}
  </div>;
};
