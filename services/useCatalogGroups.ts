import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { emptyCatalogGroups, readCatalogGroups, type CatalogGroupKind, type CatalogGroupState } from './catalogGroups';

const UPDATED = 'nai-catalog-groups-updated';

export function useCatalogGroups(kind: CatalogGroupKind) {
  // 切换目录类型后，旧读取／写入只能结束自身请求，不能接管新目录。
  const scope = useMemo(() => ({ kind, locked: false }), [kind]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState(() => ({ scope, state: emptyCatalogGroups(), ready: false, busy: false, error: '' }));
  const current = snapshot.scope === scope ? snapshot : { scope, state: emptyCatalogGroups(), ready: false, busy: false, error: '' };
  const accept = useCallback((next: CatalogGroupState) => {
    if (scopeRef.current !== scope) return;
    setSnapshot(previous => ({ scope, state: previous.scope === scope && previous.ready && previous.state.revision >= next.revision ? previous.state : next,
      ready: true, busy: previous.scope === scope && previous.busy, error: '' }));
  }, [scope]);
  const fail = useCallback((message: string) => {
    if (scopeRef.current === scope) setSnapshot(previous => ({ ...(previous.scope === scope ? previous : { scope, state: emptyCatalogGroups(), ready: false, busy: false }), error: message }));
  }, [scope]);
  const reload = useCallback(async () => {
    if (scope.locked || scopeRef.current !== scope) return;
    scope.locked = true;
    try { accept(readCatalogGroups(await api.get(`/catalog-groups/${kind}`, { cache: 'no-store' }))); }
    catch (cause) { fail(cause instanceof Error ? cause.message : '分组加载失败'); }
    finally { scope.locked = false; }
  }, [scope, kind, accept, fail]);
  useEffect(() => {
    void reload();
    const focus = () => void reload();
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: CatalogGroupKind; state: CatalogGroupState }>).detail;
      if (detail.kind === kind) accept(readCatalogGroups(detail.state));
    };
    window.addEventListener('focus', focus); window.addEventListener(UPDATED, updated);
    return () => { window.removeEventListener('focus', focus); window.removeEventListener(UPDATED, updated); };
  }, [kind, accept, reload]);
  const save = async (next: CatalogGroupState) => {
    if (!current.ready || current.error || scope.locked || scopeRef.current !== scope) throw Error('分组尚未就绪，请重新加载后再试');
    const checked = readCatalogGroups(next);
    scope.locked = true; setSnapshot(previous => ({ ...previous, busy: true }));
    try {
      const saved = readCatalogGroups(await api.put(`/catalog-groups/${kind}`, checked));
      window.dispatchEvent(new CustomEvent(UPDATED, { detail: { kind, state: saved } }));
      accept(saved);
    } catch (cause) {
      try { accept(readCatalogGroups(await api.get(`/catalog-groups/${kind}`, { cache: 'no-store' }))); }
      catch { fail('分组回读失败，请重新加载后再整理'); }
      throw cause;
    } finally {
      scope.locked = false;
      if (scopeRef.current === scope) setSnapshot(previous => ({ ...previous, busy: false }));
    }
  };
  return { state: current.state, ready: current.ready, busy: current.busy, error: current.error, reload, save };
}
