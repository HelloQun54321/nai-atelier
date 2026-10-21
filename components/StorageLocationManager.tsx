import React, { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, HardDrive, LoaderCircle } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { isAndroidApp } from '../services/platform';
import { getStorageLocationStatus, openStorageDirectory, pickStorageDirectory, setStorageCacheDirectory, switchStorageDataDirectory, type StorageLocationStatus } from '../services/storageLocations';
import { clearExportDirectory, getExportLocation, pickExportDirectory, setExportMode, type ExportLocation, type ExportMode } from '../services/exportLocation';
import { ToolbarButton, ToolbarSelect } from './DesignSystem';
import { useConfirmDialog } from './ConfirmDialog';

const fieldClass = 'min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
type StorageRow = 'data' | 'cache' | 'export';
type RowFeedback = { phase: 'saving' | 'selecting' | 'opening' | 'success' | 'error'; message?: string };

/** 目录共用一组设置；只有编辑时展开路径和切换方式，长路径不挤出操作按钮。 */
export function StorageLocationManager({ notify }: { notify: (message: string, type?: 'success' | 'error') => void }) {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const [storage, setStorage] = useState<StorageLocationStatus | null>(null);
  const [exports, setExports] = useState<ExportLocation | null>(null);
  const [editing, setEditing] = useState<'data' | 'cache' | null>(null);
  const [directory, setDirectory] = useState('');
  const [operation, setOperation] = useState<'migrate' | 'open'>('migrate');
  const [feedback, setFeedback] = useState<Partial<Record<StorageRow, RowFeedback>>>({});
  const busyRows = useRef(new Set<StorageRow>());
  const retries = useRef<Partial<Record<StorageRow, () => void>>>({});
  const successTimers = useRef<Partial<Record<StorageRow, number>>>({});
  const [switching, setSwitching] = useState(false);
  const [switchingRow, setSwitchingRow] = useState<'data' | 'cache'>('data');
  const android = isAndroidApp();
  const migrating = switching || Boolean(storage && !['idle', 'failed', 'completed'].includes(storage.state.phase));
  const pending = (row: StorageRow) => ['saving', 'selecting', 'opening'].includes(feedback[row]?.phase || '');
  const busy = (['data', 'cache', 'export'] as const).some(pending);
  const pickerOpen = Object.values(feedback).some(value => value?.phase === 'selecting');
  const setRowFeedback = (row: StorageRow, value?: RowFeedback) => setFeedback(previous => ({ ...previous, [row]: value }));

  useEffect(() => () => { Object.values(successTimers.current).forEach(window.clearTimeout); }, []);

  useEffect(() => {
    let active = true;
    const load = async (row: 'data' | 'export') => {
      try {
        if (row === 'data') { const value = await getStorageLocationStatus(); if (active) setStorage(value); }
        else { const value = await getExportLocation(); if (active) setExports(value); }
        if (active) setRowFeedback(row);
      } catch (reason) {
        if (active) {
          retries.current[row] = () => { void load(row); };
          setRowFeedback(row, { phase: 'error', message: reason instanceof Error ? reason.message : t('无法读取存储位置') });
        }
      }
    };
    void load('export');
    if (!android) void load('data');
    return () => { active = false; };
  }, [android]);

  useEffect(() => {
    if (!switching || !storage) return;
    let active = true, requesting = false, stopped = false;
    const timer = window.setInterval(async () => {
      if (requesting) return;
      requesting = true;
      try {
        const next = await getStorageLocationStatus();
        if (!active) return;
        if (next.state.phase === 'failed') { setStorage(next); setSwitching(false); setRowFeedback(switchingRow, { phase: 'error', message: next.state.error }); return; }
        if (!['idle', 'completed'].includes(next.state.phase)) stopped = true;
        // 外部浏览器不会随后台重启；确认新工坊就绪后重读页面，不能保留旧库的列表与草稿视图。
        if (['idle', 'completed'].includes(next.state.phase) && (stopped || next.dataDir !== storage.dataDir || next.cacheDir !== storage.cacheDir)) window.location.reload();
      } catch { stopped = true; }
      finally { requesting = false; }
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [switching, storage, switchingRow]);

  const perform = async (row: StorageRow, work: () => Promise<boolean | void>, phase: 'saving' | 'selecting' | 'opening' = 'saving') => {
    if (busyRows.current.has(row)) return;
    busyRows.current.add(row);
    window.clearTimeout(successTimers.current[row]);
    retries.current[row] = () => { void perform(row, work, phase); };
    setRowFeedback(row, { phase });
    try {
      const saved = await work();
      setRowFeedback(row, saved ? { phase: 'success' } : undefined);
      if (saved) successTimers.current[row] = window.setTimeout(() => setRowFeedback(row), 2000);
    }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : t('存储位置设置失败');
      setRowFeedback(row, { phase: 'error', message });
    } finally { busyRows.current.delete(row); }
  };
  const choose = () => void perform(editing!, async () => {
    const selected = await pickStorageDirectory(editing!);
    if (!selected.cancelled) setDirectory(selected.path);
  }, 'selecting');
  const changeData = () => void perform('data', async () => {
    const target = directory.trim();
    if (!target) throw new Error(t('请选择目标文件夹'));
    if (!await confirmAction({
      rememberKey: `storage.${operation}`, rememberScope: [storage?.dataDir, target],
      title: operation === 'migrate' ? t('迁移现有工坊？') : t('打开另一工坊？'),
      message: operation === 'migrate'
        ? t('将停止当前工坊，复制并核验资料后在新位置重新打开。旧目录保留。\n目标：{0}', [target])
        : t('将停止当前工坊，打开目标位置已有的工坊。当前资料保留，不合并。\n目标：{0}', [target]),
      confirmLabel: operation === 'migrate' ? t('迁移并重启') : t('打开并重启'),
    })) return;
    const result = await switchStorageDataDirectory(target, operation);
    setEditing(null); setSwitchingRow('data'); setSwitching(result.restartRequired);
    notify(result.restartRequired ? '目录切换已开始，请等待工坊重新打开' : '存储位置已更新', 'success');
    if (!result.restartRequired) setStorage(await getStorageLocationStatus());
    return !result.restartRequired;
  });
  const changeCache = (target: string) => void perform('cache', async () => {
    if (!await confirmAction({
      rememberKey: 'storage.cache-directory', rememberScope: [storage?.cacheDir, target.trim()],
      title: t('更改缓存与下载资源位置？'),
      message: t('将停止当前工坊，把已有缩略图、反推模型和词库复制到新位置后重新打开。原件与旧目录保留。'),
      confirmLabel: t('应用并重启'),
    })) return;
    const result = await setStorageCacheDirectory(target.trim());
    setEditing(null); setSwitchingRow('cache'); setSwitching(result.restartRequired);
    notify(result.restartRequired ? '目录切换已开始，请等待工坊重新打开' : '存储位置已更新', 'success');
    if (!result.restartRequired) setStorage(await getStorageLocationStatus());
    return !result.restartRequired;
  });
  const exportMode = (mode: ExportMode) => void perform('export', async () => {
    const next = mode === 'directory' && !exports?.directory ? await pickExportDirectory() : await setExportMode(mode);
    if (next) setExports(next);
    return Boolean(next);
  }, mode === 'directory' && !exports?.directory ? 'selecting' : 'saving');
  const changeExport = () => void perform('export', async () => {
    const next = await pickExportDirectory();
    if (next) setExports(next);
    return Boolean(next);
  }, 'selecting');
  const beginEdit = (kind: 'data' | 'cache') => {
    setEditing(kind); setDirectory(kind === 'data' ? storage!.dataDir : storage!.cacheDir); setOperation('migrate');
  };
  const renderFeedback = (row: StorageRow) => {
    if (migrating && row === switchingRow) return <p role="status" className="mt-2 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300"><LoaderCircle className="h-3.5 w-3.5 flex-none animate-spin" />{t('正在切换存储位置，请等待工坊重新打开…')}</p>;
    const value: RowFeedback | undefined = feedback[row] || (row === switchingRow && storage?.state.phase === 'failed' && storage.state.error ? { phase: 'error', message: storage.state.error } : undefined);
    if (!value) return null;
    if (value.phase === 'error') return <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-600 dark:text-red-400"><span className="min-w-0 break-words">{value.message || t('存储位置设置失败')}</span>{retries.current[row] && <ToolbarButton className="h-9 text-xs" disabled={migrating} onClick={retries.current[row]}>{t('重试')}</ToolbarButton>}</div>;
    if (value.phase === 'success') return <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{t('已保存')}</p>;
    return <p role="status" className="mt-2 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300"><LoaderCircle className="h-3.5 w-3.5 flex-none animate-spin" />{value.phase === 'selecting' ? t('请在系统窗口中选择文件夹…') : value.phase === 'opening' ? t('正在打开文件夹…') : t('正在保存…')}</p>;
  };
  const pathRow = (label: string, path: string, kind: 'data' | 'cache') => <div className="grid min-w-0 gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start" aria-label={t(label)}>
    <div className="pt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{t(label)}</div>
    <div className="min-w-0">
      <p className="truncate pt-2 font-mono text-xs text-gray-700 dark:text-gray-300" title={path}>{path}</p>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{kind === 'data' ? t('风格串、原图、历史与设置。') : t('缩略图、词库、反推模型与画师图包，可重新下载。')}{kind === 'cache' && storage?.cacheFollowsData && <span className="ml-2">{t('跟随工坊')}</span>}</p>
      {renderFeedback(kind)}
    </div>
    {storage?.canManage && <div className="flex flex-none gap-2">
      <ToolbarButton className="h-9 px-2 text-xs" disabled={pending(kind) || migrating} aria-label={t('打开{0}文件夹', [t(label)])} title={t('打开文件夹')} onClick={() => void perform(kind, async () => { await openStorageDirectory(path); }, 'opening')}><FolderOpen /></ToolbarButton>
      <ToolbarButton tone="primary" className="h-9 px-3 text-xs" disabled={pending(kind) || migrating} aria-label={t('更改{0}', [t(label)])} onClick={() => beginEdit(kind)}>{t('更改')}</ToolbarButton>
    </div>}
  </div>;
  const exportDirectory = !exports ? t('正在读取…') : exports.mode === 'directory' ? exports.directory : exports.mode === 'ask' ? t('导出时选择保存位置') : exports.platform === 'android' ? 'Pictures/NAI Atelier' : exports.systemDirectory || t('由浏览器下载设置决定');

  return <div className="min-w-0" aria-label={t('存储位置')}>
    <h4 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><HardDrive className="h-4 w-4 text-indigo-500" />{t('存储位置')}</h4>
    <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
      {storage?.available && <>
        {pathRow('工坊数据', storage.dataDir, 'data')}
        {pathRow('缓存与下载资源', storage.cacheDir, 'cache')}
      </>}
      {!storage?.available && feedback.data && <div className="py-3"><span className="text-sm font-medium">{t('工坊数据')}</span>{renderFeedback('data')}</div>}
      {android && <div className="flex items-center justify-between gap-3 py-3 text-sm"><span>{t('工坊数据')}</span><span className="text-xs text-gray-500">{t('Android 应用私有存储')}</span></div>}
      {editing && <div className="appearance-group space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
        <div className="flex min-w-0 gap-2">
          <input aria-label={editing === 'data' ? t('新的工坊数据位置') : t('新的缓存与下载资源位置')} value={directory} disabled={pending(editing) || migrating} onChange={event => setDirectory(event.target.value)} className={fieldClass} />
          <ToolbarButton className="h-10 text-xs" disabled={pickerOpen || pending(editing) || migrating} onClick={choose}><FolderOpen />{t('浏览')}</ToolbarButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing === 'data' ? <ToolbarSelect label="目录切换方式" value={operation} disabled={pending(editing) || migrating} onChange={event => setOperation(event.target.value as 'migrate' | 'open')} containerClassName="min-w-0 flex-1" className="text-xs">
            <option value="migrate">{t('迁移现有工坊')}</option><option value="open">{t('打开另一工坊')}</option>
          </ToolbarSelect> : !storage?.cacheFollowsData && <ToolbarButton className="h-10 text-xs" disabled={busy || migrating} onClick={() => changeCache('')}>{t('跟随工坊')}</ToolbarButton>}
          <ToolbarButton tone="primary" className="h-10 text-xs" disabled={busy || migrating || !directory.trim() || directory.trim() === (editing === 'data' ? storage?.dataDir : storage?.cacheDir)} onClick={editing === 'data' ? changeData : () => changeCache(directory)}>{editing === 'data' ? operation === 'migrate' ? t('迁移并重启') : t('打开并重启') : t('应用并重启')}</ToolbarButton>
          <ToolbarButton className="h-10 text-xs" disabled={pending(editing) || migrating} onClick={() => setEditing(null)}>{t('取消')}</ToolbarButton>
        </div>
      </div>}
      <div className="grid min-w-0 gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start" aria-label={t('默认导出位置')}>
        <div className="pt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{t('默认导出位置')}</div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarSelect label="导出保存方式" value={exports?.mode || 'system'} disabled={!exports || pending('export') || migrating} onChange={event => exportMode(event.target.value as ExportMode)} className="h-9 text-xs" containerClassName="min-w-0">
              <option value="system">{t('系统默认')}</option><option value="directory" disabled={!exports?.canPickDirectory}>{t('自定义文件夹')}</option><option value="ask" disabled={!exports?.canAsk}>{t('每次询问')}</option>
            </ToolbarSelect>
          </div>
          <div className="appearance-group flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/50">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('当前导出目录')}</p>
              <p className="mt-1 truncate text-xs text-gray-800 dark:text-gray-200" title={exportDirectory}>{exportDirectory}</p>
            </div>
            {exports?.canPickDirectory && <ToolbarButton tone="primary" className="h-9 text-xs" aria-label={t('更改默认导出位置')} disabled={pickerOpen || pending('export') || migrating} onClick={changeExport}><FolderOpen />{t('更改')}</ToolbarButton>}
            {exports?.directory && <ToolbarButton className="h-9 text-xs" disabled={pending('export') || migrating} onClick={() => void perform('export', async () => { setExports(await clearExportDirectory()); return true; })}>{t('清除')}</ToolbarButton>}
          </div>
          <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{exports?.platform === 'android' && exports.mode === 'system' ? t('图片保存到相册；其他文件由系统询问位置。') : t('图片和文件默认导出至此目录；未单独指定导出路径时使用。')}</p>
          {renderFeedback('export')}
        </div>
      </div>
    </div>
    {storage?.available && !storage.canManage && <p className="text-xs leading-5 text-gray-500">{t('请在运行工坊的电脑上更改数据与资源位置。')}</p>}
  </div>;
}
