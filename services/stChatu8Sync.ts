import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptChain } from '../types';
import { api } from './api';
import { isStChatu8ExportableChain } from '../worker/stChatu8Policy.mjs';

const path = '/st-chatu8/export-selection';
const readIds = (value: { chainIds?: unknown }): Set<string> => {
  if (!Array.isArray(value?.chainIds) || value.chainIds.some(id => typeof id !== 'string')) throw new Error('智慧姬同步范围响应无效');
  return new Set(value.chainIds);
};

/** 草稿勾选不立即发送；范围落本机设置，由酒馆下一次同步读取。 */
export function useStChatu8Selection(enabled: boolean, chains: PromptChain[], notify: (message: string, type?: 'success' | 'error') => void) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const available = useMemo(() => new Set(chains.filter(isStChatu8ExportableChain).map(chain => chain.id)), [chains]);
  const selected = useMemo(() => new Set([...draft].filter(id => available.has(id))), [draft, available]);
  const savedCount = [...saved].filter(id => available.has(id)).length;

  const load = useCallback(async (edit = false) => {
    const ticket = ++revision.current;
    setBusy(true);
    try {
      const ids = readIds(await api.get(path, { cache: 'no-store' }));
      if (ticket !== revision.current) return;
      setSaved(ids);
      if (edit) setDraft(ids);
    } catch (error) {
      if (ticket !== revision.current) return;
      if (edit) setSelecting(false);
      notifyRef.current(error instanceof Error ? error.message : '读取智慧姬同步范围失败', 'error');
    } finally { if (ticket === revision.current) setBusy(false); }
  }, []);

  useEffect(() => {
    if (enabled) void load();
    else { setSelecting(false); setBusy(false); }
    return () => { revision.current++; };
  }, [enabled, load]);

  const begin = () => {
    if (!enabled || busy) return;
    setSelecting(true);
    void load(true);
  };
  const cancel = () => { revision.current++; setSelecting(false); setBusy(false); setDraft(saved); };
  const toggle = (id: string) => {
    if (busy || !available.has(id)) return;
    setDraft(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const setFiltered = (ids: string[], checked: boolean) => {
    if (busy) return;
    setDraft(previous => {
      const next = new Set(previous);
      for (const id of ids) if (available.has(id)) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  };
  const save = async () => {
    if (!enabled || busy) return;
    const ticket = ++revision.current;
    setBusy(true);
    try {
      const ids = readIds(await api.post(path, { chainIds: [...selected] }));
      if (ticket !== revision.current) return;
      setSaved(ids); setDraft(ids); setSelecting(false);
      notifyRef.current(`已保存 ${ids.size} 条同步范围，连接器下次同步即可生效`, 'success');
    } catch (error) {
      if (ticket === revision.current) notifyRef.current(error instanceof Error ? error.message : '保存智慧姬同步范围失败', 'error');
    } finally { if (ticket === revision.current) setBusy(false); }
  };
  return { selecting, busy, selected, savedCount, begin, cancel, toggle, setFiltered, save };
}
