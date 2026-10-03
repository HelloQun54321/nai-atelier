import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import { formatModelOptionTitle, type PromptAgentModel, type PromptAgentThinkingLevel } from '../services/promptAgent';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';

export const agentThinkingLabels: Record<PromptAgentThinkingLevel, string> = { off: '关闭', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' };
interface Props {
  models: PromptAgentModel[];
  activeModel?: PromptAgentModel;
  thinkingLevels: PromptAgentThinkingLevel[];
  thinkingLevel: PromptAgentThinkingLevel;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onModelChange: (model: PromptAgentModel) => Promise<void>;
  onThinkingChange: (level: PromptAgentThinkingLevel) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onConfigure: () => void;
}

export const AgentModelControl: React.FC<Props> = props => {
  const [view, setView] = useState<'thinking' | 'models'>('thinking');
  const [draftLevel, setDraftLevel] = useState(props.thinkingLevel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const returnFocus = useRef(false);
  const position = useAgentPopoverPosition(props.open, trigger, popover, 360, 'end');
  const positioned = position !== undefined;
  const name = props.activeModel ? formatModelOptionTitle(props.activeModel, props.models) : '选择模型';
  const canThink = Boolean(props.activeModel && props.thinkingLevels.length > 1);
  const actualView = props.activeModel ? view : 'models';
  useEffect(() => { setDraftLevel(props.thinkingLevel); }, [props.thinkingLevel, props.activeModel?.provider, props.activeModel?.id]);
  useEffect(() => { if (!props.open) { setView('thinking'); setQuery(''); setError(''); } }, [props.open]);
  useEffect(() => { if (!props.open && !busy && !props.disabled && returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); } }, [props.open, busy, props.disabled]);
  useEffect(() => { if (props.disabled) props.onOpenChange(false); }, [props.disabled, props.onOpenChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; props.onBusyChange(false); }; }, [props.onBusyChange]);
  useEffect(() => {
    if (props.open && positioned) popover.current?.querySelector<HTMLElement>(actualView === 'thinking' && canThink ? 'input[type="range"]' : '[data-model-trigger], [data-model-current="true"], [data-model-choice], [data-configure]')?.focus();
  }, [props.open, positioned, actualView, canThink]);
  useEffect(() => {
    if (!props.open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) props.onOpenChange(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [props.open, props.onOpenChange]);
  const close = () => { returnFocus.current = true; props.onOpenChange(false); };
  const save = async (action: () => Promise<void>, closeAfter = false) => {
    if (pending.current || props.disabled) return;
    pending.current = true; setBusy(true); setError(''); props.onBusyChange(true);
    try { await action(); if (mounted.current && closeAfter) close(); }
    catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : '设置保存失败'); setDraftLevel(props.thinkingLevel); } }
    finally { pending.current = false; if (mounted.current) { setBusy(false); props.onBusyChange(false); } }
  };
  const thinking = (level: PromptAgentThinkingLevel) => {
    if (level !== props.thinkingLevel && canThink) void save(() => props.onThinkingChange(level));
  };
  return <div className="min-w-0 flex-1">
    <button ref={trigger} type="button" aria-label="模型与思考设置" aria-haspopup="dialog" aria-expanded={props.open} disabled={props.disabled || busy} title={props.disabled ? `${name} · 任务执行期间不能切换` : `${name}${canThink ? ` · 思考：${agentThinkingLabels[props.thinkingLevel]}` : ''}`} onClick={() => props.onOpenChange(!props.open)} className="ml-auto flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-gray-100 px-2.5 text-xs text-gray-700 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{name}</span>{canThink && <span className="shrink-0 text-gray-400 dark:text-gray-500">{agentThinkingLabels[props.thinkingLevel]}</span>}<ChevronDown className="h-3 w-3 shrink-0" />
    </button>
    {props.open && createPortal(<div ref={popover} role="dialog" aria-label="模型与思考" style={{ ...position, visibility: positioned ? 'visible' : 'hidden' }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} className="z-[1300] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        {actualView === 'models' ? <button type="button" onClick={() => setView('thinking')} disabled={!props.activeModel} className="inline-flex min-h-8 items-center gap-1 text-xs text-gray-500 disabled:opacity-50 dark:text-gray-400"><ArrowLeft className="h-3.5 w-3.5" />选择模型</button> : <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{actualView === 'thinking' ? canThink ? `思考 · ${agentThinkingLabels[draftLevel]}` : '模型设置' : ''}</span>
        <button type="button" aria-label="关闭模型菜单" onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
      </div>
      {actualView === 'thinking' ? <>
        <button type="button" data-model-trigger disabled={busy} onClick={() => setView('models')} className="mx-auto mb-3 flex max-w-full items-center gap-1 text-xs text-gray-500 dark:text-gray-400"><span className="truncate">{name}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" /></button>
        {canThink ? <div className="rounded-xl bg-gray-50 px-3 py-3 dark:bg-gray-950">
          <input type="range" aria-label="思考强度" aria-valuetext={agentThinkingLabels[draftLevel]} min={0} max={props.thinkingLevels.length - 1} step={1} value={Math.max(0, props.thinkingLevels.indexOf(draftLevel))} disabled={busy} onChange={event => setDraftLevel(props.thinkingLevels[Number(event.target.value)])} onPointerUp={() => thinking(draftLevel)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) thinking(draftLevel); }} className="block h-6 w-full cursor-pointer accent-indigo-600 disabled:opacity-50 dark:accent-indigo-400" />
          <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${props.thinkingLevels.length}, minmax(0, 1fr))` }}>{props.thinkingLevels.map(level => <button key={level} type="button" disabled={busy} aria-label={`思考强度：${agentThinkingLabels[level]}`} aria-pressed={props.thinkingLevel === level} onClick={() => thinking(level)} className={`min-h-8 rounded-lg text-xs disabled:opacity-50 ${props.thinkingLevel === level ? 'bg-indigo-100 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}>{agentThinkingLabels[level]}</button>)}</div>
        </div> : <p className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">当前模型不提供可调思考强度</p>}
      </> : <>
        {props.models.length > 8 && <input aria-label="搜索模型" placeholder="搜索模型或服务…" value={query} onChange={event => setQuery(event.target.value)} className="mb-2 h-9 w-full rounded-lg border border-gray-200 bg-transparent px-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200" />}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {props.models.filter(model => `${model.id} ${model.name} ${model.providerName || model.provider}`.toLowerCase().includes(query.toLowerCase())).map(model => { const current = model.provider === props.activeModel?.provider && model.id === props.activeModel?.id; return <button key={`${model.provider}/${model.id}`} data-model-choice data-model-current={current} type="button" aria-label={`选择模型：${formatModelOptionTitle(model, props.models)}`} aria-pressed={current} disabled={busy} onClick={() => current ? close() : void save(() => props.onModelChange(model), true)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left disabled:opacity-50 ${current ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm text-gray-800 dark:text-gray-100">{formatModelOptionTitle(model, props.models)}</span><span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{model.providerName || model.provider}{model.imageInput ? ' · 支持图片' : ''}</span></span>{current && <Check className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />}
          </button>; })}
          {!props.models.length && <p className="p-3 text-xs text-gray-500">尚未接入模型服务</p>}
        </div>
      </>}
      {error && <p role="alert" className="mt-3 break-words text-xs text-red-600 dark:text-red-400">{error}</p>}
      {busy && <p role="status" className="mt-2 text-xs text-gray-500">正在保存…</p>}
      <button type="button" data-configure onClick={() => { close(); props.onConfigure(); }} className="mt-3 w-full border-t border-gray-100 pt-3 text-left text-xs text-gray-500 hover:text-gray-800 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-200">配置模型服务 →</button>
    </div>, document.body)}
  </div>;
};
