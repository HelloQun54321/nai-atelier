import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { formatModelOptionTitle, type PromptAgentModel, type PromptAgentThinkingLevel } from '../services/promptAgent';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';
import { AGENT_THINKING_LABELS } from '../services/agentThinking.mjs';
import './AgentModelControl.css';

export const agentThinkingLabels = AGENT_THINKING_LABELS;
// 稳定坐标让增减粒子时已有光点留在原位；整层播放无需逐粒子计时。
const particles = Array.from({ length: 24 }, (_, index) => {
  const random = (salt: number) => { const value = Math.sin((index + 1) * salt) * 43758.5453; return value - Math.floor(value); };
  const x = random(12.9898) * 100, y = 14 + random(78.233) * 72, size = .7 + random(39.425) * 1.1;
  return `radial-gradient(circle at ${x}% ${y}%, rgb(255 255 255 / ${.35 + random(53.11) * .55}) 0 ${size}px, transparent ${size + .8}px)`;
});
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
  contextUsage?: { used: number; limit: number };
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
  const flow = useRef<HTMLDivElement>(null);
  const position = useAgentPopoverPosition(props.open, trigger, popover, 300, 'center');
  const positioned = position !== undefined;
  const name = props.activeModel ? formatModelOptionTitle(props.activeModel, props.models) : '选择模型';
  const canThink = Boolean(props.activeModel && props.thinkingLevels.length > 1);
  const lastPosition = Math.max(0, props.thinkingLevels.length - 1);
  const draftLevel = props.thinkingLevels[Math.min(lastPosition, Math.round(draftPosition))] || props.thinkingLevel;
  const intensity = lastPosition ? draftPosition / lastPosition : 0;
  const particleCount = draftLevel === 'off' ? 0 : 5 + Math.round((lastPosition ? Math.round(draftPosition) / lastPosition : 0) * 19);
  const particleBackground = useMemo(() => [0, 1].map(layer => particles.slice(0, particleCount).filter((_, index) => index % 2 === layer).join(', ')), [particleCount]);
  const ultra = canThink && Math.round(draftPosition) === lastPosition && draftLevel !== 'off';
  const actualView = props.activeModel ? view : 'models';
  useEffect(() => {
    // 改播放速率而非动画时长，保留当前时间线，避免切档时光点跳回起点。
    flow.current?.getAnimations?.({ subtree: true }).forEach((animation, index) => animation.updatePlaybackRate((.65 + intensity * 2.35) * (index === 0 ? 1 : .72)));
  }, [intensity, props.open, actualView]);
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
  const usage = props.contextUsage;
  const percent = usage ? Math.min(100, Math.max(0, usage.used / usage.limit * 100)) : undefined;
  const contextTitle = usage ? `上下文已用 ${Math.round(percent!)}% · ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens（最近一次模型回复用量，含缓存与输出）` : '上下文使用情况：尚未收到当前模型的用量数据';
  return <div className="min-w-0 flex-1">
    <button ref={trigger} type="button" aria-label="模型与思考设置" aria-haspopup="dialog" aria-expanded={props.open} disabled={props.disabled || busy} title={props.disabled ? `${name} · 任务执行期间不能切换` : `${name}${canThink ? ` · 思考：${agentThinkingLabels[props.thinkingLevel]}` : ''}`} onClick={() => props.onOpenChange(!props.open)} className="ml-auto flex min-h-9 max-w-full items-center gap-1.5 rounded-lg bg-transparent px-1.5 text-xs text-gray-700 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:text-gray-200 dark:hover:text-white">
      <span role={usage ? 'meter' : 'img'} aria-label={usage ? '上下文使用情况' : contextTitle} aria-valuemin={usage ? 0 : undefined} aria-valuemax={usage ? 100 : undefined} aria-valuenow={percent} aria-valuetext={contextTitle} title={contextTitle} className={`agent-context-ring shrink-0 ${percent !== undefined && percent >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}><svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4"><circle className="agent-context-ring-bed" cx="10" cy="10" r="7" /><circle className="agent-context-ring-value" cx="10" cy="10" r="7" pathLength="100" strokeDasharray={usage ? `${percent} 100` : '12 8'} /></svg></span><span className="min-w-0 truncate">{name}</span>{canThink && <span className="min-w-8 shrink-0 text-center text-gray-400 dark:text-gray-500">{agentThinkingLabels[props.thinkingLevel]}</span>}<ChevronDown className="h-3 w-3 shrink-0" />
    </button>
    {props.open && createPortal(<div ref={popover} role="dialog" aria-label="模型与思考" data-ultra={ultra && actualView === 'thinking'} style={{ ...position, visibility: positioned ? 'visible' : 'hidden' }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} className="appearance-panel agent-model-popover z-[1300] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="agent-model-heading">
        {actualView === 'models' ? <button type="button" aria-label="选择模型" onClick={() => setView('thinking')} disabled={!props.activeModel} className="flex items-center justify-center rounded-lg text-gray-500 disabled:opacity-50 dark:text-gray-400"><ArrowLeft className="h-4 w-4" /></button> : <span>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}</span>}
        <span className="agent-thinking-title text-sm font-medium text-indigo-600 dark:text-indigo-400">{actualView === 'thinking' ? canThink ? ultra ? 'Ultra' : agentThinkingLabels[draftLevel] : '模型设置' : '选择模型'}</span>
        <button type="button" aria-label="关闭模型菜单" onClick={close} className="flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
      </div>
      {actualView === 'thinking' ? <>
        <button type="button" data-model-trigger disabled={busy} onClick={() => setView('models')} className="agent-model-name mx-auto flex max-w-full items-center gap-1 text-xs text-gray-500 dark:text-gray-400"><span className="truncate">{name}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" /></button>
        {canThink ? <div className="px-1 py-1">
          <div className="agent-thinking-slider" data-dragging={dragging} data-saving={busy} data-empty={draftPosition === 0 && draftLevel === 'off'} style={{ '--agent-thinking-ratio': draftPosition / lastPosition } as React.CSSProperties}>
            <div aria-hidden="true" className="agent-thinking-track"><div className="agent-thinking-bed">{props.thinkingLevels.map((level, index) => <span key={level} className="agent-thinking-step" style={{ left: `calc(18px + (100% - 36px) * ${index / lastPosition})` }} />)}</div><div className="agent-thinking-fill"><div className="agent-thinking-ultra-wash" /><div ref={flow} className="agent-thinking-particles" data-particles={particleCount}>{particleBackground.map((backgroundImage, index) => <div key={index} className={`agent-thinking-flow${index ? ' agent-thinking-flow-secondary' : ''}`} style={{ backgroundImage }} />)}</div></div></div>
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
      {busy && <p role="status" className="sr-only">正在保存…</p>}
      {actualView === 'models' && <button type="button" data-configure disabled={busy} onClick={() => { close(); props.onConfigure(); }} className="mt-3 w-full border-t border-gray-100 pt-3 text-left text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-200">配置模型服务 →</button>}
    </div>, document.body)}
  </div>;
};
