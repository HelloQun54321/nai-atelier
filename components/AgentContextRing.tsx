import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentContextUsage } from '../services/agentContextUsage';
import { useAgentPopoverPosition } from './useAgentPopoverPosition';

const compactTokens = (value: number) => value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(1))}m` : value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}k` : value.toLocaleString();

export const AgentContextRing: React.FC<{ usage?: AgentContextUsage }> = ({ usage }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const id = useId();
  const position = useAgentPopoverPosition(open, anchor, tooltip, 260, 'center');
  const percent = usage ? Math.min(100, Math.max(0, usage.used / usage.limit * 100)) : undefined;
  const contextTitle = usage ? `上下文已用 ${Math.round(percent!)}% · ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens（最近一次模型回复用量，含缓存与输出）` : '上下文使用情况：尚未收到当前模型的用量数据';
  const cache = usage?.cacheHitRate;
  return <>
    <span ref={anchor} tabIndex={0} role={usage ? 'meter' : 'img'} aria-label={usage ? '上下文使用情况' : contextTitle} aria-valuemin={usage ? 0 : undefined} aria-valuemax={usage ? 100 : undefined} aria-valuenow={percent} aria-valuetext={contextTitle} aria-describedby={open ? id : undefined} title="" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }} className={`agent-context-ring flex shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 ${percent !== undefined && percent >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4"><circle className="agent-context-ring-bed" cx="10" cy="10" r="7" /><circle className="agent-context-ring-value" cx="10" cy="10" r="7" pathLength="100" strokeDasharray={usage ? `${percent} 100` : '12 8'} /></svg>
    </span>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" style={{ ...position, visibility: position ? 'visible' : 'hidden' }} className="agent-context-tooltip appearance-panel pointer-events-none z-[1400] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-center text-sm leading-6 text-gray-800 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
      <div className="text-gray-500 dark:text-gray-400">上下文窗口：</div>
      <div className="text-gray-500 dark:text-gray-400">{usage ? `${Math.round(percent!)}% 已用` : '用量未知'}</div>
      <div>{usage ? `已用 ${compactTokens(usage.used)} 标记，共 ${compactTokens(usage.limit)}` : '当前模型尚未返回用量'}</div>
      <div className="mt-1 border-t border-gray-200 pt-1 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">缓存命中率：{cache === undefined ? '未知' : `${cache.toFixed(1)}%`}</div>
    </div>, document.body)}
  </>;
};
