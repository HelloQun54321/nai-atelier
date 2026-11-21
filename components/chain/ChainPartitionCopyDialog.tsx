import React, { useEffect, useRef, useState } from 'react';
import { CopyPlus, X } from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import { copyChainsToPartition } from '../../services/chainPartitionCopy';
import { createUuid } from '../../services/id';
import { ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';

interface Props {
  ids: string[];
  destinations: Array<{ id: string; name: string }>;
  onReload: () => Promise<void>;
  onDone: () => void;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}
export const ChainPartitionCopyDialog: React.FC<Props> = props => <ImagePreviewPortal><CopyForm {...props} /></ImagePreviewPortal>;

const CopyForm: React.FC<Props> = ({ ids, destinations, onReload, onDone, onClose, notify }) => {
  useLanguage();
  const [target, setTarget] = useState(destinations[0]?.id || '');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const busyRef = useRef(false), savedRef = useRef(false);
  const operation = useRef('');
  if (!operation.current) operation.current = createUuid();
  const dialogRef = useModalA11y<HTMLElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busyRef.current) return false; onClose(); }, 'chain-partition-copy');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialogRef.current)) { event.preventDefault(); if (!busyRef.current) close(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [close, dialogRef]);
  const copy = async () => {
    if (busyRef.current || !savedRef.current && !destinations.some(item => item.id === target)) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (!savedRef.current) {
        await copyChainsToPartition(ids, target, operation.current);
        savedRef.current = true; setSaved(true);
      }
      await onReload();
      notify(t('已复制 {0} 条风格串', [ids.length]), 'success');
      onDone(); busyRef.current = false; close();
    } catch (cause) {
      if (savedRef.current) setError(t('复制已完成，列表刷新失败，请重试读取'));
      else {
        setError(t(cause instanceof Error ? cause.message : '复制失败，请重试'));
        // 回执丢失后沿用同一操作 ID，重试复用已建副本。
        try { await onReload(); } catch { /* 保留原错误，等待主动重试。 */ }
      }
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) close(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('复制到分区')} aria-busy={busy} className="appearance-panel mobile-safe-bottom w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <header className="mb-4 flex items-center gap-2"><CopyPlus className="h-5 w-5" /><h2 className="flex-1 font-bold">{t('复制 {0} 条风格串', [ids.length])}</h2><button type="button" disabled={busy} aria-label={t('关闭')} onClick={close} className="mobile-touch rounded-lg p-2 disabled:opacity-40"><X className="h-5 w-5" /></button></header>
      <label className="block text-sm font-semibold">{t('目标分区')}<select aria-label={t('目标分区')} value={target} disabled={busy || saved} onChange={event => setTarget(event.target.value)} className="mobile-touch mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
        {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <p className="mt-3 text-xs text-gray-500">{t('原分区保留原串，目标分区新建独立副本。')}</p>
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-600 dark:text-red-400">{error}</p>}
      <footer className="mt-5 flex justify-end gap-2"><ToolbarButton disabled={busy} onClick={close}>{t('取消')}</ToolbarButton><ToolbarButton tone="primary" disabled={busy || !target} onClick={() => void copy()}>{busy ? t('处理中…') : saved ? t('重试读取') : t('确认复制')}</ToolbarButton></footer>
    </section>
  </div>;
};
