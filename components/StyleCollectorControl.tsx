import { t, useLanguage } from '../services/i18n';
import { useEffect, useRef, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { ToolbarButton } from './DesignSystem';
export { collectorIsLocal } from '../services/collectorAppearance';
import { collectorIsLocal } from '../services/collectorAppearance';

export interface CollectorState {
  available: boolean; enabled: boolean; paused: boolean; session: string; stage: string;
  pending: number; saved: number; skipped: number; failed: number; error: string; detail?: string;
}

export function StyleCollectorControl({ onSaved, notify }: { onSaved: () => void; notify: (message: string, type?: 'success' | 'error') => void }) {
  useLanguage();
  const [state, setState] = useState<CollectorState | null>(null);
  const [busy, setBusy] = useState(false);
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
  const act = async (action: 'start' | 'stop') => {
    setBusy(true);
    try {
      const response = await fetch(`/api/style-collector/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nai-Local-Control': 'true' }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '收集操作失败');
      setState(result);
    } catch (error) { callbacks.current.notify(error instanceof Error ? error.message : '收集操作失败', 'error'); }
    finally { setBusy(false); }
  };
  if (!state?.available) return null;
  const label = state.enabled ? (state.paused ? '收集已暂停' : '收集中') : '收集模式';
  const detail = [t(state.error), t(state.detail)].filter(Boolean).join(' · ');
  return <ToolbarButton role="switch" aria-label={t(label)} aria-checked={state.enabled} disabled={busy || state.stage === '正在启动' || state.stage === '正在结束'} onClick={() => void act(state.enabled ? 'stop' : 'start')} title={detail || t("开启后自动收集新复制的图片直链，进度在桌面置顶窗显示")} className={`mobile-touch flex-none !px-3 xl:!px-4 ${state.enabled ? '!border-emerald-300 !text-emerald-600 dark:!border-emerald-800 dark:!text-emerald-400' : ''}`}>
    <ClipboardList className="h-4 w-4" /><span className="hidden xl:inline">{t(label)}</span>
  </ToolbarButton>;
}
