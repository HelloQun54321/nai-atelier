import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { emptyReferenceFolders, readReferenceFolders, type ReferenceFolderKind, type ReferenceFolderState } from './referenceFolders';

const REFERENCE_FOLDERS_UPDATED = 'nai-reference-folders-updated';

export async function saveReferenceFolders(kind: ReferenceFolderKind, next: ReferenceFolderState): Promise<ReferenceFolderState> {
  const saved = readReferenceFolders(await api.put(`/reference-folders/${kind}`, readReferenceFolders(next)));
  window.dispatchEvent(new CustomEvent<ReferenceFolderState>(REFERENCE_FOLDERS_UPDATED, { detail: saved }));
  return saved;
}

/** 与 `useChainFolders` 同一套乐观锁语义，按资料库类型分别保存。 */
export function useReferenceFolders(kind: ReferenceFolderKind, enabled: boolean) {
  const [state, setState] = useState(emptyReferenceFolders);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const accept = useCallback((next: ReferenceFolderState) => {
    setState(current => next.revision >= current.revision ? next : current);
    setReady(true); setError('');
  }, []);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try { accept(readReferenceFolders(await api.get(`/reference-folders/${kind}`, { cache: 'no-store' }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '目录加载失败'); }
  }, [enabled, kind, accept]);
  const reload = useCallback(async () => {
    if (!enabled || locked.current) return;
    locked.current = true;
    try { await refresh(); } finally { locked.current = false; }
  }, [enabled, refresh]);
  useEffect(() => {
    void reload();
    const focus = () => void reload();
    const updated = (event: Event) => accept((event as CustomEvent<ReferenceFolderState>).detail);
    const projectChanged = (event: Event) => {
      if ((event as CustomEvent<{ resource?: string }>).detail?.resource === `reference_folders:${kind}`) void refresh();
    };
    if (enabled) {
      window.addEventListener('focus', focus);
      window.addEventListener(REFERENCE_FOLDERS_UPDATED, updated);
      window.addEventListener('nai-project-data-changed', projectChanged);
    }
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener(REFERENCE_FOLDERS_UPDATED, updated);
      window.removeEventListener('nai-project-data-changed', projectChanged);
    };
  }, [enabled, kind, reload, refresh, accept]);
  const save = async (next: ReferenceFolderState) => {
    if (!ready || error || locked.current) throw Error('目录尚未就绪，请重新加载后再整理');
    locked.current = true; setBusy(true);
    try { accept(await saveReferenceFolders(kind, next)); }
    catch (cause) {
      try { accept(readReferenceFolders(await api.get(`/reference-folders/${kind}`, { cache: 'no-store' }))); }
      catch { setError('目录回读失败，请重新加载后再整理'); }
      throw cause;
    } finally { locked.current = false; setBusy(false); }
  };
  return { state, ready, busy, error, reload, save };
}
