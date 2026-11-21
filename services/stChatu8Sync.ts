import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptChain } from '../types';
import type { StSyncEntry, StSyncWorkspace } from '../worker/stChatu8Workspace';
import { api } from './api';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

export type StSyncTarget = 'st-chatu8' | 'st-baibai';
export type WisdomSyncView = 'pick' | 'pending' | 'records';

const TARGET_META: Record<StSyncTarget, { path: string; label: string; invalidMsg: string; loadFailMsg: string; updateFailMsg: string; enqueueOkMsg: string }> = {
  'st-chatu8': {
    path: '/st-chatu8/workspace',
    label: '智慧姬',
    invalidMsg: '智慧姬同步列表响应无效',
    loadFailMsg: '读取智慧姬同步列表失败',
    updateFailMsg: '更新智慧姬同步列表失败',
    enqueueOkMsg: '已加入待同步，等待智慧姬接收确认',
  },
  'st-baibai': {
    path: '/st-baibai/workspace',
    label: '柏宝绘',
    invalidMsg: '柏宝绘同步列表响应无效',
    loadFailMsg: '读取柏宝绘同步列表失败',
    updateFailMsg: '更新柏宝绘同步列表失败',
    enqueueOkMsg: '已加入待同步，请在酒馆连接器手动点击「立即同步」并刷新页面',
  },
};

const empty: StSyncWorkspace = { entries: [], lastSnapshotAt: 0 };
const readWorkspace = (value: StSyncWorkspace, invalidMsg: string): StSyncWorkspace => {
  if (!Array.isArray(value?.entries) || value.entries.some(entry => !entry || typeof entry.chainId !== 'string' || typeof entry.requestId !== 'string' || !['pending', 'synced', 'removed'].includes(entry.status)) || !Number.isFinite(value.lastSnapshotAt)) throw new Error(invalidMsg);
  return value;
};

/** 挑选草稿、待同步与接收记录分开；服务端回执是状态的唯一依据。 */
export function useStBridgeSelection(target: StSyncTarget, enabled: boolean, chains: PromptChain[], notify: (message: string, type?: 'success' | 'error') => void) {
  const meta = TARGET_META[target];
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
      const result = readWorkspace(await api.get(meta.path, { cache: 'no-store' }), meta.invalidMsg);
      if (ticket === revision.current) { setWorkspace(result); setError(''); }
    } catch (cause) {
      if (ticket === revision.current) setError(cause instanceof Error ? cause.message : meta.loadFailMsg);
    } finally { if (ticket === revision.current) { working.current = false; setBusy(false); } }
  }, [meta.path, meta.invalidMsg, meta.loadFailMsg]);

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
      const next = readWorkspace(await api.post(meta.path, { action, chainIds: ids }), meta.invalidMsg);
      if (ticket !== revision.current) return;
      setWorkspace(next); setError('');
      if (action === 'enqueue') { setDraft(new Set()); setView('pending'); }
      if (action === 'requeue') setView('pending');
      notifyRef.current(action === 'remove' ? '已移出待同步，原风格串保留' : meta.enqueueOkMsg, 'success');
    } catch (cause) {
      if (ticket === revision.current) { const message = cause instanceof Error ? cause.message : meta.updateFailMsg; setError(message); notifyRef.current(message, 'error'); }
    } finally { if (ticket === revision.current) { working.current = false; setBusy(false); } }
  };
  const save = () => actOnEntries('enqueue', [...selected]);
  const accepts = (chainId: string) => !open || view === 'pick' || (view === 'pending'
    ? entries.get(chainId)?.status === 'pending'
    : !!entries.get(chainId) && entries.get(chainId)?.status !== 'pending' && (recordFilter === 'all' || entries.get(chainId)?.status === recordFilter));
  return { target, targetLabel: meta.label, open, view, setView, recordFilter, setRecordFilter, selecting: open && view === 'pick', busy, error, entries, pending, records, selected, available, savedCount: pending.length, lastSnapshotAt: workspace.lastSnapshotAt, begin, cancel, toggle, setFiltered, save, load, actOnEntries, accepts };
}

export function useStChatu8Selection(enabled: boolean, chains: PromptChain[], notify: (message: string, type?: 'success' | 'error') => void, target: StSyncTarget = 'st-chatu8') {
  return useStBridgeSelection(target, enabled, chains, notify);
}

export type WisdomSyncSelection = ReturnType<typeof useStBridgeSelection>;
export const wisdomEntryLabel = (entry: StSyncEntry, target: StSyncTarget = 'st-chatu8') =>
  entry.status === 'synced' ? '已同步' : entry.status === 'removed' ? (target === 'st-baibai' ? '柏宝绘中已移除' : '智慧姬中已移除') : entry.error ? '等待重试' : '待同步';
