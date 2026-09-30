import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ClipboardList, Pause, Play, RotateCcw } from 'lucide-react';
import { ToolbarButton } from './DesignSystem';

export interface CollectorState {
  available: boolean; enabled: boolean; paused: boolean; session: string; stage: string;
  pending: number; saved: number; skipped: number; failed: number; error: string;
  failures: { id: string; name: string; error: string }[];
}

export const collectorIsLocal = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

export function StyleCollectorControl({ onSaved, notify }: { onSaved: () => void; notify: (message: string, type?: 'success' | 'error') => void }) {
  const [state, setState] = useState<CollectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const callbacks = useRef({ onSaved, notify });
  callbacks.current = { onSaved, notify };
  useEffect(() => {
    if (!collectorIsLocal(window.location.hostname)) return;
    let disposed = false, events: EventSource | undefined, previous = '';
    const update = (next: CollectorState) => {
      if (disposed) return;
      const marker = `${next.session}:${next.saved}`;
      if (next.saved > 0 && marker !== previous) callbacks.current.onSaved();
      previous = marker; setState(next);
    };
    void fetch('/api/style-collector/state').then(async response => {
      if (!response.ok || disposed) return;
      update(await response.json());
      if (disposed) return;
      events = new EventSource('/api/style-collector/events');
      events.onmessage = event => { try { update(JSON.parse(event.data)); } catch { /* 丢弃不完整状态，等待下一条。 */ } };
      events.onerror = () => { if (!disposed) setState(current => current ? { ...current, error: '本机服务连接中断，正在重新连接' } : current); };
    }).catch(() => {});
    // 页面关闭仅取消状态订阅；收集由本机服务和置顶窗继续管理。
    return () => { disposed = true; events?.close(); };
  }, []);
  const act = async (action: string, id?: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/style-collector/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nai-Local-Control': 'true' }, body: JSON.stringify({ id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '收集操作失败');
      setState(result);
    } catch (error) { callbacks.current.notify(error instanceof Error ? error.message : '收集操作失败', 'error'); }
    finally { setBusy(false); }
  };
  if (!state?.available) return null;
  return <div className="relative flex flex-none items-center gap-1">
    <ToolbarButton role="switch" aria-checked={state.enabled} disabled={busy || state.stage === '正在启动' || state.stage === '正在结束'} onClick={() => void act(state.enabled ? 'stop' : 'start')} title="开启后自动收集新复制的图片直链，生成信息完整的原图进入「收集中」标签" className={state.enabled ? '!border-emerald-300 !text-emerald-600 dark:!border-emerald-800 dark:!text-emerald-400' : ''}>
      <ClipboardList className="h-4 w-4" />{state.enabled ? (state.paused ? '收集已暂停' : '收集中') : '收集模式'}
    </ToolbarButton>
    <button type="button" onClick={() => setOpen(value => !value)} aria-label="收集状态与手动重试" aria-expanded={open} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronDown className="h-4 w-4" /></button>
    {open && <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="风格串收集状态" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
        <div className="flex items-center justify-between gap-2"><span>{state.stage} · 待处理 {state.pending}</span>{state.enabled && <button disabled={busy} onClick={() => void act(state.paused ? 'resume' : 'pause')} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">{state.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{state.paused ? '继续' : '暂停'}</button>}</div>
        <p className="mt-2">已保存 {state.saved} · 跳过 {state.skipped} · 失败 {state.failed}</p>
        {state.error && <p className="mt-2 text-amber-600 dark:text-amber-400">{state.error}</p>}
        {state.failures.length > 0 && <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{state.failures.map(item => <div key={item.id} className="flex items-start justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-800"><div className="min-w-0"><p className="truncate">{item.name || '图片链接'}</p><p className="mt-1 text-red-500">{item.error}</p></div><button disabled={busy || !state.enabled} onClick={() => void act('retry', item.id)} title="手动重试" className="rounded-md p-1.5 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><RotateCcw className="h-4 w-4" /></button></div>)}</div>}
      </div>
    </>}
  </div>;
}
