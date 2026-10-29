import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, ChevronRight, Database, Download, FolderOpen, Pause, RotateCw, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { ToolbarPopover, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import {
  broadcastArtistSamplesChanged, controlArtistSamplePack, getArtistSampleStatus,
  isArtistSampleSourceForPack,
  type ArtistSamplePack, type ArtistSamplePackAction, type ArtistSamplePackStatus, type ArtistSampleStatus,
} from '../services/artistSamples';

const PACKS: ArtistSamplePack[] = ['v45', 'v5'];
const PACKAGE_INFO = {
  v45: { filename: 'artist_thumbnail_nai', size: '2.73 GB' },
  v5: { filename: 'V5 Full（7个图包）', size: `${(16_507_137_927 / 1_000_000_000).toFixed(2)} GB` },
} satisfies Record<ArtistSamplePack, { filename: string; size: string }>;

const emptyStatus: ArtistSampleStatus = { available: false, canManage: false, packs: [] };
const isDownloadActive = (stage?: string) => stage === 'downloading' || stage === 'verifying';

export const ArtistSampleManager: React.FC = () => {
  useLanguage();
  const [status, setStatus] = useState<ArtistSampleStatus>(emptyStatus);
  const [statusReady, setStatusReady] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const actionLock = useRef(false);
  const activeRef = useRef(true);
  const statusRef = useRef(status);

  const acceptStatus = useCallback((next: ArtistSampleStatus, notifyReady = false) => {
    const previous = statusRef.current;
    const becameReady = next.packs.some(pack => {
      if (pack.phase !== 'ready' || !isArtistSampleSourceForPack(pack.id, pack)) return false;
      const prior = previous.packs.find(item => item.id === pack.id);
      return prior?.phase !== 'ready' || prior.revision !== pack.revision || prior.model !== pack.model || (pack.managed === true && prior.managed !== true);
    });
    statusRef.current = next;
    setStatus(next);
    setStatusReady(true);
    setStatusError('');
    if (notifyReady && becameReady) broadcastArtistSamplesChanged();
  }, []);

  const readStatus = useCallback(async (signal?: AbortSignal, notifyReady = false) => {
    try {
      const next = await getArtistSampleStatus(signal);
      if (activeRef.current) acceptStatus(next, notifyReady);
      return next;
    } catch (error) {
      if (activeRef.current && !signal?.aborted) setStatusError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [acceptStatus]);

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    void readStatus(controller.signal).catch(() => {});
    return () => { activeRef.current = false; controller.abort(); };
  }, [readStatus]);

  const isDownloading = status.packs.some(pack => isDownloadActive(pack.download?.stage) || pack.files?.some(file => isDownloadActive(file.download.stage)));
  const isIndexing = status.packs.some(pack => pack.phase === 'indexing');
  useEffect(() => {
    if (!isDownloading && !isIndexing) return;
    let active = true;
    const controller = new AbortController();
    let timer: number;
    const delay = isDownloading ? 1000 : 1500;
    const poll = async () => {
      try { await readStatus(controller.signal, true); } catch { /* 读取失败后按正常间隔重试状态，不重启下载任务。 */ }
      if (active && !controller.signal.aborted) timer = window.setTimeout(() => void poll(), delay);
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [isIndexing, isDownloading, readStatus]);

  const act = async (action: ArtistSamplePackAction, pack: ArtistSamplePack, file?: string) => {
    if (actionLock.current) return;
    actionLock.current = true;
    const key = file ? `${pack}:${file}` : pack;
    setBusy(current => ({ ...current, [key]: action }));
    setActionErrors(current => ({ ...current, [key]: undefined }));
    try {
      const result = file ? await controlArtistSamplePack(action, pack, file) : await controlArtistSamplePack(action, pack);
      if (activeRef.current && result.status) acceptStatus(result.status, action === 'download');
    } catch (error) {
      if (activeRef.current) setActionErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
    } finally { actionLock.current = false; if (activeRef.current) setBusy(current => ({ ...current, [key]: '' })); }
  };

  const title = t('画师预览图库');
  const packData = status.packs;
  const activeDownloadPack = packData.find(pack => isDownloadActive(pack.download?.stage) || pack.files?.some(file => isDownloadActive(file.download.stage)))?.id;
  const pickBusy = Object.values(busy).includes('pick');
  const actionPending = Object.values(busy).some(Boolean);
  return <section aria-label={title} className="space-y-3 border-b border-gray-200 pb-5 dark:border-gray-700">
    <div className="flex items-start gap-2"><Database className="mt-0.5 h-4 w-4 flex-none text-indigo-500" /><div><h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4></div></div>
    {status.canManage === false && status.available && <p className="text-xs text-gray-500 dark:text-gray-400">{t('图包下载与本地文件操作需在工坊电脑进行。')}</p>}
    {statusError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{statusError} <button type="button" className="mobile-touch font-semibold underline" onClick={() => void readStatus().catch(() => {})}>{t('重试读取状态')}</button></p>}
    {PACKS.map((pack, index) => {
      const item: ArtistSamplePackStatus | undefined = packData.find(entry => entry.id === pack);
      const files = pack === 'v5' && item?.files?.length ? item.files : undefined;
      const canManageFiles = status.canManage;
      const pending = busy[pack];
      const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      const path = item?.path || '';
      const linked = Boolean(item?.path);
      const download = item?.download;
      const packageInfo = { ...PACKAGE_INFO[pack], size: pack === 'v5' && download && download.totalBytes > 0 ? `${(download.totalBytes / 1_000_000_000).toFixed(2)} GB` : PACKAGE_INFO[pack].size };
      const percent = download && download.totalBytes > 0 ? Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100)) : 0;
      const anotherDownload = Boolean(activeDownloadPack && activeDownloadPack !== pack);
      const downloading = download?.stage === 'downloading';
      const verifying = download?.stage === 'verifying';
      const sourceMatches = isArtistSampleSourceForPack(pack, item);
      const packageReady = sourceMatches && (files ? files.every(file => file.active) : download?.stage === 'ready' && item?.managed === true);
      const packDownloading = downloading || verifying || Boolean(files?.some(file => isDownloadActive(file.download.stage)));
      const mainAction: ArtistSamplePackAction | undefined = packDownloading ? 'pause' : (download?.stage === 'paused' || download?.stage === 'error' || download?.stage === 'ready' || !download || download.stage === 'missing') ? 'download' : undefined;
      const mainLabel = !canManageFiles ? t('仅工坊电脑可操作')
        : pending === 'download' ? t('正在启动下载…')
        : pending === 'pause' ? t('正在暂停…')
        : pending === 'pick' ? t('正在选择文件…')
        : item?.phase === 'indexing' && (!files || !packDownloading) ? t('正在建立索引…')
        : packDownloading ? t('暂停下载')
        : download?.stage === 'paused' ? t(files ? '继续全部下载' : '继续下载')
        : download?.stage === 'error' ? t(files ? '重试全部下载' : '重试下载')
        : packageReady && item?.phase === 'ready' ? t(files ? '已全部接入' : '已下载')
        : packageReady && item?.phase === 'error' ? t('重试下载')
        : files ? t('全部下载 · 约 {0}', [packageInfo.size])
        : download?.stage === 'ready' ? t('使用已下载图包')
        : t('下载图包 · 约 {0}', [packageInfo.size]);
      const mainDisabled = !canManageFiles || actionPending || anotherDownload || pickBusy || (item?.phase === 'indexing' && (!files || !packDownloading)) || (packageReady && item?.phase === 'ready' && (!files || !['paused', 'error'].includes(download?.stage || '')));
      const statusText = !statusReady ? statusError ? '—' : t('加载中…') : files && item && sourceMatches && files.some(file => file.active) ? t('可用 · {0} 个画师 Tag', [item.count])
        : downloading || verifying ? (verifying ? t('正在校验图包…') : t('图包下载中：{0}%', [percent])) : item?.phase === 'ready' && !sourceMatches ? t('当前图包未确认为 V5 Full，原文件已保留') : item?.phase === 'ready' ? t('可用 · {0} 个画师 Tag', [item.count]) : item?.phase === 'indexing' ? t('样张索引中：{0}%', [Math.round(item.progress)]) : download?.stage === 'paused' ? t('已暂停') : item?.phase === 'error' ? t('索引失败') : download?.stage === 'ready' ? t('未启用') : t('未下载');
      return <div key={pack} className={`${index === PACKS.length - 1 ? '' : 'border-b border-gray-100 pb-3 dark:border-gray-800'}`}>
        <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><span className="text-sm font-bold text-gray-800 dark:text-gray-100">NovelAI {pack === 'v45' ? 'V4.5' : 'V5 Full'}</span><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{statusText}</p></div>
          <button type="button" className={`mobile-touch flex-none inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-semibold ${mainDisabled ? 'appearance-group bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`} onClick={() => mainAction && void act(mainAction, pack)} disabled={mainDisabled} aria-label={mainLabel}>
          {mainAction === 'pause' ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}{mainLabel}
          </button>
          {canManageFiles && <ToolbarPopover label={t('图包管理')} title={t('图包管理')} icon={<MoreHorizontal />} iconOnly width={300} disabled={actionPending || pickBusy}>
            {close => <div className="space-y-1"><p title={path || undefined} className="break-all px-3 py-2 text-xs text-gray-500">{pack === 'v5' && sourceMatches ? item?.filename || packageInfo.filename : path || packageInfo.filename}<br />{t('Hugging Face · 约 {0}', [packageInfo.size])}</p>
              <button type="button" className={TOOLBAR_MENU_CLASS} disabled={Boolean(activeDownloadPack) || item?.phase === 'indexing'} onClick={() => { close(); void act('pick', pack); }}><FolderOpen />{t('使用本地文件')}</button>
              {item?.phase === 'indexing' ? <button type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { close(); void act('cancel', pack); }}><X />{t('取消索引')}</button> : <>
                <button type="button" className={TOOLBAR_MENU_CLASS} disabled={!linked || packDownloading} onClick={() => { close(); void act('reindex', pack); }}><RotateCw />{t('重新建立索引')}</button>
                <button type="button" className={TOOLBAR_MENU_CLASS + ' !text-red-600 dark:!text-red-300'} disabled={!linked || Boolean(activeDownloadPack)} onClick={() => { close(); void act('remove', pack); }}><X />{t('解除关联（不删文件）')}</button>
              </>}
            </div>}
          </ToolbarPopover>}
        </div>
        {download && ['downloading', 'verifying', 'paused'].includes(download.stage) && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400"><div className="flex items-center justify-between gap-2"><span>{verifying ? t('正在校验图包…') : t('已接收 {0} / {1} · {2}%', [formatBytes(download.receivedBytes), download.totalBytes > 0 ? formatBytes(download.totalBytes) : t('未知大小'), percent])}</span>{download.stage === 'paused' && <span>{t('已暂停')}</span>}</div><div role="progressbar" aria-label={verifying ? t('正在校验图包…') : t('图包下载进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} /></div></div>}
        {(download?.stage === 'error' && download.error || actionErrors[pack]) && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">{actionErrors[pack] || download?.error}</p>}
        {item?.phase === 'error' && item.error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">{item.error}</p>}
        {item?.phase === 'indexing' && !packDownloading && <div role="progressbar" aria-label={t('正在建立索引')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, item.progress))} className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500" style={{ width: Math.max(0, Math.min(100, item.progress)) + '%' }} /></div>}
        {files && <details className="group mt-2 min-w-0">
          <summary className="mobile-touch flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300 [&::-webkit-details-marker]:hidden"><ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />{t('分别下载图包（{0}）', [files.length])}</summary>
          <div className="min-w-0 space-y-2">{files.map(file => {
            const key = `${pack}:${file.filename}`, filePending = busy[key], stage = file.download.stage;
            const running = isDownloadActive(stage), filePercent = file.download.totalBytes > 0 ? Math.min(100, Math.round(file.download.receivedBytes / file.download.totalBytes * 100)) : 0;
            const fileLabel = filePending === 'download' ? t('正在启动下载…') : filePending === 'pause' ? t('正在暂停…') : running ? t('暂停下载') : stage === 'paused' ? t('继续下载') : stage === 'error' ? t('重试下载') : file.active ? t('已接入') : stage === 'ready' ? t('使用已下载图包') : t('下载图包');
            const fileDisabled = !canManageFiles || actionPending || Boolean(activeDownloadPack && !running) || (item?.phase === 'indexing' && !running) || (file.active && !running && stage !== 'error' && stage !== 'paused');
            const fileStatus = file.active ? file.count === undefined ? t('已接入') : t('已接入 · {0} 个画师 Tag', [file.count]) : stage === 'paused' ? t('已暂停') : stage === 'error' ? t('下载失败') : stage === 'ready' ? t('未接入') : running ? stage === 'verifying' ? t('正在校验图包…') : t('图包下载中：{0}%', [filePercent]) : t('未下载');
            return <section key={file.filename} aria-label={file.filename} className="appearance-group min-w-0 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-700">
              <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><p className="break-all font-mono text-xs text-gray-800 dark:text-gray-200">{file.filename}</p><p className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{`${(file.size / 1_000_000_000).toFixed(2)} GB`} · {fileStatus}</p></div>
                <button type="button" aria-label={t('{0}：{1}', [fileLabel, file.filename])} disabled={fileDisabled} onClick={() => void act(running ? 'pause' : 'download', pack, file.filename)} className="mobile-touch inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500">{running ? <Pause className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}{fileLabel}</button>
              </div>
              {['downloading', 'verifying', 'paused'].includes(stage) && <div className="mt-1.5 min-w-0 text-xs text-gray-500"><p className="break-words">{t('已接收 {0} / {1} · {2}%', [formatBytes(file.download.receivedBytes), formatBytes(file.download.totalBytes || file.size), filePercent])}</p><div role="progressbar" aria-label={t('{0} 下载进度', [file.filename])} aria-valuemin={0} aria-valuemax={100} aria-valuenow={filePercent} className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full bg-indigo-500" style={{ width: `${filePercent}%` }} /></div></div>}
              {(actionErrors[key] || file.download.error) && <p role="alert" className="mt-1 break-words text-xs text-red-600 dark:text-red-300">{actionErrors[key] || file.download.error}</p>}
            </section>;
          })}</div>
        </details>}
      </div>;
    })}
    {!status.available && !statusError && <p className="text-xs text-gray-500 dark:text-gray-400">{t('正在读取样张图库状态…')}</p>}
  </section>;
};
