import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Zap, X } from 'lucide-react';
import { formatModelOptionTitle, type PromptAgentModel, type PromptAgentThinkingLevel } from '../services/promptAgent';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';
import { AGENT_THINKING_LABELS } from '../services/agentThinking.mjs';
import './AgentModelControl.css';

export const agentThinkingLabels = AGENT_THINKING_LABELS;
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
  const selectedPosition = Math.max(0, props.thinkingLevels.indexOf(props.thinkingLevel));
  const [draftPosition, setDraftPosition] = useState(selectedPosition);
  const [dragging, setDragging] = useState(false);
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
  const lastPosition = Math.max(0, props.thinkingLevels.length - 1);
  const draftLevel = props.thinkingLevels[Math.min(lastPosition, Math.round(draftPosition))] || props.thinkingLevel;
  const actualView = props.activeModel ? view : 'models';
  useEffect(() => { setDraftPosition(selectedPosition); setDragging(false); }, [selectedPosition, props.thinkingLevel, props.activeModel?.provider, props.activeModel?.id]);
  useEffect(() => { if (!props.open) { setView('thinking'); setQuery(''); setError(''); setDraftPosition(selectedPosition); setDragging(false); } }, [props.open, selectedPosition]);
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
    catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : '设置保存失败'); setDraftPosition(selectedPosition); } }
    finally { pending.current = false; if (mounted.current) { setBusy(false); props.onBusyChange(false); } }
  };
  const thinking = (level: PromptAgentThinkingLevel) => {
    if (level !== props.thinkingLevel && canThink) void save(() => props.onThinkingChange(level));
  };
  // 拖动保留连续位置，释放或键盘确认后才吸附并保存模型支持的离散档位。
  const commitPosition = (value: number) => {
    const position = Math.max(0, Math.min(lastPosition, Math.round(value)));
    setDragging(false); setDraftPosition(position);
    const level = props.thinkingLevels[position];
    if (level) thinking(level);
  };
  return <div className="min-w-0 flex-1">
    <button ref={trigger} type="button" aria-label="模型与思考设置" aria-haspopup="dialog" aria-expanded={props.open} disabled={props.disabled || busy} title={props.disabled ? `${name} · 任务执行期间不能切换` : `${name}${canThink ? ` · 思考：${agentThinkingLabels[props.thinkingLevel]}` : ''}`} onClick={() => props.onOpenChange(!props.open)} className="ml-auto flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-gray-100 px-2.5 text-xs text-gray-700 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Zap className="h-3.5 w-3.5 shrink-0" />}<span className="min-w-0 truncate">{name}</span>{canThink && <span className="shrink-0 text-gray-400 dark:text-gray-500">{agentThinkingLabels[props.thinkingLevel]}</span>}<ChevronDown className="h-3 w-3 shrink-0" />
    </button>
    {props.open && createPortal(<div ref={popover} role="dialog" aria-label="模型与思考" style={{ ...position, visibility: positioned ? 'visible' : 'hidden' }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} className="z-[1300] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        {actualView === 'models' ? <button type="button" onClick={() => setView('thinking')} disabled={!props.activeModel} className="inline-flex min-h-8 items-center gap-1 text-xs text-gray-500 disabled:opacity-50 dark:text-gray-400"><ArrowLeft className="h-3.5 w-3.5" />选择模型</button> : <Zap className="h-5 w-5 fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400" />}
        <span className="text-base font-medium text-blue-600 dark:text-blue-400">{actualView === 'thinking' ? canThink ? agentThinkingLabels[draftLevel] : '模型设置' : ''}</span>
        <button type="button" aria-label="关闭模型菜单" onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
      </div>
      {actualView === 'thinking' ? <>
        <button type="button" data-model-trigger disabled={busy} onClick={() => setView('models')} className="mx-auto mb-3 flex max-w-full items-center gap-1 text-xs text-gray-500 dark:text-gray-400"><span className="truncate">{name}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" /></button>
        {canThink ? <div className="px-1 py-1">
          <div className="agent-thinking-slider" data-dragging={dragging} data-saving={busy} data-empty={draftPosition === 0 && draftLevel === 'off'} style={{ '--agent-thinking-ratio': draftPosition / lastPosition } as React.CSSProperties}>
            <div aria-hidden="true" className="agent-thinking-track"><div className="agent-thinking-bed">{props.thinkingLevels.map((level, index) => <span key={level} className="agent-thinking-step" style={{ left: `calc(22px + (100% - 44px) * ${index / lastPosition})` }} />)}</div><div className="agent-thinking-fill"><div className="agent-thinking-flow" /></div></div>
            <div aria-hidden="true" className="agent-thinking-thumb" />
            <input type="range" aria-label="思考强度" aria-valuetext={agentThinkingLabels[draftLevel]} min={0} max={lastPosition} step="any" value={draftPosition} disabled={busy}
              onChange={event => setDraftPosition(Number(event.target.value))}
              onPointerDown={event => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
              onPointerUp={event => commitPosition(Number(event.currentTarget.value))}
              onPointerCancel={() => { setDragging(false); setDraftPosition(selectedPosition); }}
              onKeyDown={event => { const offset = ({ ArrowLeft: -1, ArrowDown: -1, PageDown: -1, ArrowRight: 1, ArrowUp: 1, PageUp: 1 } as Record<string, number>)[event.key]; if (offset !== undefined || event.key === 'Home' || event.key === 'End') { event.preventDefault(); setDraftPosition(event.key === 'Home' ? 0 : event.key === 'End' ? lastPosition : Math.max(0, Math.min(lastPosition, Math.round(draftPosition) + offset))); } }}
              onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitPosition(Number(event.currentTarget.value)); }} className="agent-thinking-range" />
          </div>
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
      {actualView === 'models' && <button type="button" data-configure disabled={busy} onClick={() => { close(); props.onConfigure(); }} className="mt-3 w-full border-t border-gray-100 pt-3 text-left text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-200">配置模型服务 →</button>}
    </div>, document.body)}
  </div>;
};
