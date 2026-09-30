import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptChain } from '../types';
import type { StSyncEntry, StSyncWorkspace } from '../worker/stChatu8Workspace';
import { api } from './api';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

const path = '/st-chatu8/workspace';
const empty: StSyncWorkspace = { entries: [], lastSnapshotAt: 0 };
const readWorkspace = (value: StSyncWorkspace): StSyncWorkspace => {
  if (!Array.isArray(value?.entries) || value.entries.some(entry => !entry || typeof entry.chainId !== 'string' || typeof entry.requestId !== 'string' || !['pending', 'synced', 'removed'].includes(entry.status)) || !Number.isFinite(value.lastSnapshotAt)) throw new Error('智慧姬同步列表响应无效');
  return value;
};
export type WisdomSyncView = 'pick' | 'pending' | 'records';

/** 挑选草稿、待同步与接收记录分开；服务端回执是状态的唯一依据。 */
export function useStChatu8Selection(enabled: boolean, chains: PromptChain[], notify: (message: string, type?: 'success' | 'error') => void) {
  const [workspace, setWorkspace] = useState<StSyncWorkspace>(empty);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<WisdomSyncView>('pick');
  const [recordFilter, setRecordFilter] = useState<'all' | 'synced' | 'removed'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const working = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const existing = useMemo(() => new Set(chains.filter(chain => !chain.type || chain.type === 'style').map(chain => chain.id)), [chains]);
  const entries = useMemo(() => new Map(workspace.entries.filter(entry => existing.has(entry.chainId)).map(entry => [entry.chainId, entry])), [workspace.entries, existing]);
  const available = useMemo(() => new Set(chains.filter(chain => isStChatu8ExportableChain(chain) && !entries.has(chain.id)).map(chain => chain.id)), [chains, entries]);
  const selected = useMemo(() => new Set([...draft].filter(id => available.has(id))), [draft, available]);
  const pending = [...entries.values()].filter(entry => entry.status === 'pending');
  const records = [...entries.values()].filter(entry => entry.status !== 'pending');

  const load = useCallback(async () => {
    if (working.current) return;
    const ticket = ++revision.current;
    working.current = true; setBusy(true);
    try {
      const result = readWorkspace(await api.get(path, { cache: 'no-store' }));
      if (ticket === revision.current) { setWorkspace(result); setError(''); }
    } catch (cause) {
      if (ticket === revision.current) setError(cause instanceof Error ? cause.message : '读取智慧姬同步列表失败');
    } finally { if (ticket === revision.current) { working.current = false; setBusy(false); } }
  }, []);

  useEffect(() => {
    if (enabled) void load();
    else { setOpen(false); setDraft(new Set()); setBusy(false); working.current = false; }
    return () => { revision.current++; working.current = false; };
  }, [enabled, load]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', refresh);
    // 只在同步工作区可见时核对状态，不轮询整个资料库。
    const timer = open ? window.setInterval(refresh, 5000) : null;
    return () => { window.removeEventListener('focus', refresh); if (timer !== null) window.clearInterval(timer); };
  }, [enabled, open, load]);

  const begin = () => { if (enabled && !working.current) { setOpen(true); setView(pending.length ? 'pending' : 'pick'); setDraft(new Set()); void load(); } };
  const cancel = () => { revision.current++; working.current = false; setOpen(false); setBusy(false); setDraft(new Set()); };
  const toggle = (id: string) => {
    if (working.current || !available.has(id)) return;
    setDraft(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const setFiltered = (ids: string[], checked: boolean) => {
    if (working.current) return;
    setDraft(previous => {
      const next = new Set(previous);
      for (const id of ids) if (available.has(id)) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  };
  const actOnEntries = async (action: 'enqueue' | 'requeue' | 'remove', ids: string[]) => {
    if (!enabled || working.current || !ids.length) return;
    const ticket = ++revision.current;
    working.current = true; setBusy(true);
    try {
      const next = readWorkspace(await api.post(path, { action, chainIds: ids }));
      if (ticket !== revision.current) return;
      setWorkspace(next); setError('');
      if (action === 'enqueue') { setDraft(new Set()); setView('pending'); }
      if (action === 'requeue') setView('pending');
      notifyRef.current(action === 'remove' ? '已移出待同步，原风格串保留' : '已加入待同步，等待智慧姬接收确认', 'success');
    } catch (cause) {
      if (ticket === revision.current) { const message = cause instanceof Error ? cause.message : '更新智慧姬同步列表失败'; setError(message); notifyRef.current(message, 'error'); }
    } finally { if (ticket === revision.current) { working.current = false; setBusy(false); } }
  };
  const save = () => actOnEntries('enqueue', [...selected]);
  const accepts = (chainId: string) => !open || view === 'pick' || (view === 'pending'
    ? entries.get(chainId)?.status === 'pending'
    : !!entries.get(chainId) && entries.get(chainId)?.status !== 'pending' && (recordFilter === 'all' || entries.get(chainId)?.status === recordFilter));
  return { open, view, setView, recordFilter, setRecordFilter, selecting: open && view === 'pick', busy, error, entries, pending, records, selected, available, savedCount: pending.length, lastSnapshotAt: workspace.lastSnapshotAt, begin, cancel, toggle, setFiltered, save, load, actOnEntries, accepts };
}
export type WisdomSyncSelection = ReturnType<typeof useStChatu8Selection>;
export const wisdomEntryLabel = (entry: StSyncEntry) => entry.status === 'synced' ? '已同步' : entry.status === 'removed' ? '智慧姬中已移除' : entry.error ? '等待重试' : '待同步';
