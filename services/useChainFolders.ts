import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { emptyChainFolders, readChainFolders, type ChainFolderState } from './chainFolders';

export function useChainFolders(enabled: boolean) {
  const [state, setState] = useState(emptyChainFolders);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const reload = useCallback(async () => {
    if (!enabled || locked.current) return;
    locked.current = true;
    try { setState(readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }))); setReady(true); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '文件夹加载失败'); }
    finally { locked.current = false; }
  }, [enabled]);
  useEffect(() => {
    void reload();
    const focus = () => void reload();
    if (enabled) window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [enabled, reload]);
  const save = async (next: ChainFolderState) => {
    if (!ready || error || locked.current) throw Error('文件夹尚未就绪，请重新加载后再试');
    const checked = readChainFolders(next);
    locked.current = true; setBusy(true);
    try { setState(readChainFolders(await api.put('/chain-folders', checked))); }
    catch (cause) {
      // 写入失败不报告成功；冲突或回执丢失后回读真实目录，保留错误供调用者反馈。
      try { setState(readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }))); }
      catch { setError('文件夹回读失败，请重新加载后再整理'); }
      throw cause;
    } finally { locked.current = false; setBusy(false); }
  };
  return { state, ready, busy, error, reload, save };
}
