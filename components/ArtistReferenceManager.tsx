import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, MoreHorizontal, RefreshCw, Trash2, X } from 'lucide-react';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { useConfirmDialog } from './ConfirmDialog';
import { ARTIST_REFERENCE_CHANGED, controlArtistReference, getArtistReferenceStatus, type ArtistReferenceAction, type ArtistReferenceStatus } from '../services/artistReference';

const SOURCE_URL = 'https://artist-string-library-moran.navyolm32.chatgpt.site';

/** 画师组串参考与样张图包同属可重新下载的资源，由工坊电脑手动下载与更新。 */
export const ArtistReferenceManager: React.FC = () => {
  useLanguage();
  const confirm = useConfirmDialog();
  const [status, setStatus] = useState<ArtistReferenceStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState<ArtistReferenceAction | ''>('');
  const [actionError, setActionError] = useState('');
  const activeRef = useRef(true);

  const readStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getArtistReferenceStatus(signal);
      if (activeRef.current) { setStatus(next); setStatusError(''); }
    } catch (error) {
      if (activeRef.current && !signal?.aborted) setStatusError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    void readStatus(controller.signal);
    return () => { activeRef.current = false; controller.abort(); };
  }, [readStatus]);
  const syncing = status?.sync.stage === 'fetching' || status?.sync.stage === 'thumbnails';
  useEffect(() => {
    if (!syncing) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void readStatus(controller.signal), 1000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [syncing, readStatus]);
  // 同步结束后通知画师库换用新版本数据。
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing) window.dispatchEvent(new Event(ARTIST_REFERENCE_CHANGED));
    wasSyncing.current = Boolean(syncing);
  }, [syncing]);

  const act = async (action: ArtistReferenceAction) => {
    if (action === 'remove' && !await confirm({ title: '删除画师组串参考', message: t('只删除已下载的参考数据与例图缓存，收藏过的例图保留，之后可重新下载。'), confirmLabel: t('删除'), tone: 'danger' })) return;
    setBusy(action); setActionError('');
    try {
      const result = await controlArtistReference(action);
      if (activeRef.current) setStatus(result.status);
    } catch (error) {
      if (activeRef.current) setActionError(error instanceof Error ? error.message : String(error));
    } finally { if (activeRef.current) setBusy(''); }
  };

  const title = t('画师组串参考');
  const canManage = status?.canManage === true;
  const ready = status?.phase === 'ready';
  const sync = status?.sync;
  const percent = sync && sync.total > 0 ? Math.min(100, Math.round(sync.done / sync.total * 100)) : 0;
  const updated = status?.updatedAt ? new Date(status.updatedAt).toLocaleDateString(getLanguage()) : '';
  const summary = !status ? t('正在读取画师组串参考状态…')
    : sync?.stage === 'fetching' ? t('正在下载参考数据…')
    : sync?.stage === 'thumbnails' ? t('正在下载例图缩略图：{0} / {1}', [sync.done, sync.total])
    : ready ? t('可用 · {0} 位画师 · 第 {1} 版', [status.artistCount, status.revision]) + (updated ? ` · ${updated}` : '')
    : status.phase === 'error' ? t('参考数据不可读取') : t('未下载');
  const mainLabel = !canManage ? t('仅工坊电脑可操作')
    : busy === 'sync' ? t('正在启动下载…')
    : syncing ? t('取消')
    : ready ? t('检查更新') : t('下载参考 · 约 11 MB');
  return <section aria-label={title} className="space-y-3 border-b border-gray-200 pb-5 dark:border-gray-700">
    <div className="flex items-start gap-2"><BookOpen className="mt-0.5 h-4 w-4 flex-none text-indigo-500" /><div className="min-w-0"><h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('来源')} <a href={status?.source?.url || SOURCE_URL} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300">{t('画师串工作室')}</a> · {t('风格标签、组串定位与例图由来源整理，未经工坊复测。')}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{status?.credits?.testers.length ? t('致谢：感谢画师串工作室的整理与维护，以及测试者 {0} 提供的例图与评价。', [status.credits.testers.join(getLanguage().startsWith('zh') ? '、' : ', ')]) : t('致谢：感谢画师串工作室的整理与维护。')}</p>
    </div></div>
    {statusError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{statusError} <button type="button" className="mobile-touch font-semibold underline" onClick={() => void readStatus()}>{t('重试读取状态')}</button></p>}
    {status && <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1"><p className="text-xs text-gray-500 dark:text-gray-400">{summary}</p>
        {ready && !syncing && status.thumbnails.total > 0 && status.thumbnails.cached < status.thumbnails.total && <p className="mt-0.5 text-xs text-gray-400">{t('已缓存例图缩略图 {0} / {1}，其余浏览时下载', [status.thumbnails.cached, status.thumbnails.total])}</p>}
      </div>
      <button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void act(syncing ? 'cancel' : 'sync')} aria-label={mainLabel}
        className={`mobile-touch inline-flex flex-none items-center rounded-lg px-2.5 py-2 text-xs font-semibold ${!canManage || busy ? 'appearance-group bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}>
        {syncing ? <X className="mr-1 h-3.5 w-3.5" /> : ready ? <RefreshCw className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}{mainLabel}
      </button>
      {canManage && <ToolbarPopover label={t('参考数据管理')} title={t('参考数据管理')} icon={<MoreHorizontal />} iconOnly width={300} disabled={Boolean(busy)}>
        {close => <div className="space-y-1">
          {status.directory && <p className="break-all px-3 py-2 text-xs text-gray-500">{status.directory}</p>}
          <button type="button" className={TOOLBAR_MENU_CLASS + ' !text-red-600 dark:!text-red-300'} disabled={!ready && status.phase !== 'error'} onClick={() => { close(); void act('remove'); }}><Trash2 />{t('删除参考数据')}</button>
        </div>}
      </ToolbarPopover>}
    </div>}
    {syncing && sync?.stage === 'thumbnails' && <div role="progressbar" aria-label={t('例图缩略图下载进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} /></div>}
    {sync?.stage === 'ready' && sync.failed > 0 && <p className="text-xs text-amber-600 dark:text-amber-300">{t('{0} 张例图缩略图未下载，浏览时会再次尝试', [sync.failed])}</p>}
    {(actionError || sync?.stage === 'error' && sync.error || status?.error) && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{actionError || sync?.error || status?.error}</p>}
  </section>;
};
