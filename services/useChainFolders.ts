import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { emptyChainFolders, readChainFolders, type ChainFolderState } from './chainFolders';

const CHAIN_FOLDERS_UPDATED = 'nai-chain-folders-updated';

export async function saveChainFolders(next: ChainFolderState): Promise<ChainFolderState> {
  const saved = readChainFolders(await api.put('/chain-folders', readChainFolders(next)));
  window.dispatchEvent(new CustomEvent<ChainFolderState>(CHAIN_FOLDERS_UPDATED, { detail: saved }));
  return saved;
}

export function useChainFolders(enabled: boolean) {
  const [state, setState] = useState(emptyChainFolders);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  // 页面保活时直接接收保存回执；迟到的旧读取不能把最新归属覆盖回去。
  const accept = useCallback((next: ChainFolderState) => {
    setState(current => next.revision >= current.revision ? next : current);
    setReady(true); setError('');
  }, []);
  const reload = useCallback(async () => {
    if (!enabled || locked.current) return;
    locked.current = true;
    try { accept(readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '文件夹加载失败'); }
    finally { locked.current = false; }
  }, [enabled, accept]);
  useEffect(() => {
    void reload();
    const focus = () => void reload();
    const updated = (event: Event) => accept((event as CustomEvent<ChainFolderState>).detail);
    if (enabled) {
      window.addEventListener('focus', focus);
      window.addEventListener(CHAIN_FOLDERS_UPDATED, updated);
    }
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener(CHAIN_FOLDERS_UPDATED, updated);
    };
  }, [enabled, reload, accept]);
  const save = async (next: ChainFolderState) => {
    if (!ready || error || locked.current) throw Error('文件夹尚未就绪，请重新加载后再试');
    locked.current = true; setBusy(true);
    try { accept(await saveChainFolders(next)); }
    catch (cause) {
      // 写入失败不报告成功；冲突或回执丢失后回读真实目录，保留错误供调用者反馈。
      try { accept(readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }))); }
      catch { setError('文件夹回读失败，请重新加载后再整理'); }
      throw cause;
    } finally { locked.current = false; setBusy(false); }
  };
  return { state, ready, busy, error, reload, save };
}
