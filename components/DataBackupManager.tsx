import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  BackupRecord,
  BackupStatus,
  formatBackupDate,
  formatBytes,
  getLocalBackupStatus,
  openLocalBackupFolder,
  saveLocalBackupConfig,
  startLocalBackup,
} from '../services/localBackup';
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  ExternalLink,
  Folder,
  FolderArchive,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  X,
  AlertCircle,
} from 'lucide-react';

interface DataBackupManagerProps {
  notify: (message: string, type?: 'success' | 'error') => void;
}

export const DataBackupManager: React.FC<DataBackupManagerProps> = ({ notify }) => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [backupLabel, setBackupLabel] = useState('');
  const [isEditingTargetDir, setIsEditingTargetDir] = useState(false);
  const [customTargetDir, setCustomTargetDir] = useState('');
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const lastFinishedAtRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      const data = await getLocalBackupStatus();
      setStatus(data);
      setError('');
      if (!isEditingTargetDir) {
        setCustomTargetDir(data.targetDir);
      }

      // 侦测刚刚完成的任务并弹出提示；首次观测只记录基线，
      // 否则每次打开设置页都会把上次的历史完成误报为"刚刚完成"
      if (data.phase === 'completed' && data.finishedAt) {
        const isFirstObservation = lastFinishedAtRef.current === null;
        lastFinishedAtRef.current = data.finishedAt;
        if (!isFirstObservation) {
          const count = data.lastBackup?.fileCount || data.progress.totalFiles;
          const bytes = data.lastBackup?.totalBytes || data.progress.totalBytes;
          notify(`数据备份完成！已备份 ${count} 个文件（${formatBytes(bytes)}）`, 'success');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法读取备份状态';
      setError(msg);
    } finally {
      if (isManual) setLoading(false);
    }
  }, [isEditingTargetDir, notify]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // 运行中时以高频 1 秒轮询进度，空闲时低频 6 秒轮询
  useEffect(() => {
    const isRunning = Boolean(status?.running);
    const interval = isRunning ? 1000 : 6000;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, interval);
    return () => window.clearInterval(timer);
  }, [status?.running, fetchStatus]);

  const handleStartBackup = async () => {
    try {
      setError('');
      const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
      await startLocalBackup({
        label: backupLabel.trim(),
        appVersion,
      });
      notify('备份任务已启动，正在复制 local-data...', 'success');
      setBackupLabel('');
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动备份失败';
      setError(msg);
      notify(msg, 'error');
    }
  };

  const handleSaveTargetDir = async () => {
    const trimmed = customTargetDir.trim();
    if (!trimmed) {
      notify('目标目录路径不能为空', 'error');
      return;
    }
    try {
      await saveLocalBackupConfig({ targetDir: trimmed });
      setIsEditingTargetDir(false);
      notify('备份目标目录已更新', 'success');
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存目标目录失败';
      notify(msg, 'error');
    }
  };

  const handleOpenFolder = async (path?: string) => {
    try {
      await openLocalBackupFolder(path);
      notify('已在系统文件管理器中打开备份位置', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法打开目录';
      notify(msg, 'error');
    }
  };

  const isRunning = Boolean(status?.running);
  const progress = status?.progress || { copiedFiles: 0, totalFiles: 0, copiedBytes: 0, totalBytes: 0, currentItem: '', percent: 0 };
  const sourceStats = status?.sourceStats || { fileCount: 0, totalBytes: 0 };
  const backups = status?.backups || [];

  return (
    <div className="space-y-4">
      {/* 头部概述与源数据指标 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900 dark:text-white">重要数据备份</h4>
            {isRunning && (
              <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-meta font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在备份
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            完整备份 <code>local-data</code>（数据库、生成的原图、历史、配置与密钥）至外部安全位置。
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchStatus(true)}
            disabled={loading || isRunning}
            className="mobile-touch flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            title="刷新备份状态"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFolder(status?.targetDir)}
            className="mobile-touch flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            title="在系统文件管理器中打开备份总目录"
          >
            <FolderOpen className="h-3.5 w-3.5 text-indigo-500" />
            打开备份文件夹
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="h-4 w-4 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {/* 源数据与目标位置卡片 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* 源数据 */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700/80 dark:bg-gray-800/40">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-indigo-500" />
              当前本地源数据 (local-data)
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">
              {formatBytes(sourceStats.totalBytes)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              · {sourceStats.fileCount.toLocaleString('zh-CN')} 个文件
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-micro text-gray-400 dark:text-gray-500" title={status?.sourceDir}>
            {status?.sourceDir || 'local-data'}
          </p>
        </div>

        {/* 目标目录 */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700/80 dark:bg-gray-800/40">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5 text-indigo-500" />
              备份目标目录
            </span>
            {!isEditingTargetDir && (
              <button
                type="button"
                onClick={() => setIsEditingTargetDir(true)}
                className="text-meta font-bold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                修改路径
              </button>
            )}
          </div>

          {isEditingTargetDir ? (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="text"
                value={customTargetDir}
                onChange={e => setCustomTargetDir(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-indigo-400 bg-white px-2 py-1 text-xs font-mono text-gray-800 outline-none dark:border-indigo-500 dark:bg-gray-900 dark:text-gray-100"
                placeholder="D:\NaiPromptManager-Backups"
              />
              <button
                type="button"
                onClick={handleSaveTargetDir}
                className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-500"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingTargetDir(false);
                  setCustomTargetDir(status?.targetDir || '');
                }}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400"
              >
                取消
              </button>
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="truncate text-sm font-bold font-mono text-gray-800 dark:text-gray-100" title={status?.targetDir}>
                  {status?.targetDir || 'D:\\NaiPromptManager-Backups'}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1 text-micro text-gray-400 dark:text-gray-500">
                {status?.targetDirExists ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    目录已就绪（含 {backups.length} 个历史备份）
                  </span>
                ) : (
                  <span>首次备份时将自动创建该目录</span>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      {/* 备份操作控制台 */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={backupLabel}
              onChange={e => setBackupLabel(e.target.value)}
              disabled={isRunning}
              maxLength={30}
              placeholder="可选备注名（例如：升级前备份 / 阶段归档）"
              className="mobile-touch w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-xs text-gray-800 outline-none transition focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800/80 dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={handleStartBackup}
            disabled={isRunning}
            className={`mobile-touch flex flex-none items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition ${
              isRunning
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-800'
                : 'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]'
            }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在备份中…</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                <span>立即完整备份</span>
              </>
            )}
          </button>
        </div>

        {/* 动态进度条 */}
        {isRunning && (
          <div className="mt-4 space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/30">
            <div className="flex items-center justify-between text-xs font-bold text-indigo-700 dark:text-indigo-300">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {progress.percent < 100 ? `正在复制文件 (${progress.percent}%)` : '正在写入元数据与校验...'}
              </span>
              <span className="tabular-nums">
                {progress.copiedFiles.toLocaleString('zh-CN')} / {progress.totalFiles.toLocaleString('zh-CN')} 文件
                {' · '}
                {formatBytes(progress.copiedBytes)} / {formatBytes(progress.totalBytes)}
              </span>
            </div>

            {/* 进度条轨道 */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200/60 dark:bg-indigo-900/60">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300 ease-out dark:bg-indigo-400"
                style={{ width: `${progress.percent}%` }}
              />
            </div>

            {progress.currentItem && (
              <p className="truncate font-mono text-micro text-gray-500 dark:text-gray-400" title={progress.currentItem}>
                正在处理: {progress.currentItem}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 历史备份列表 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-800/40">
        <button
          type="button"
          onClick={() => setIsHistoryExpanded(expanded => !expanded)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-gray-100/60 dark:hover:bg-gray-800/80"
        >
          <div className="flex items-center gap-2">
            <FolderArchive className="h-4 w-4 text-indigo-500" />
            <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
              历史备份存档
            </span>
            <span className="rounded-full bg-gray-200/80 px-2 py-0.5 text-micro font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {backups.length} 个
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>{isHistoryExpanded ? '收起列表' : '展开查看'}</span>
            {isHistoryExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </button>

        {isHistoryExpanded && (
          <div className="border-t border-gray-200 p-3 dark:border-gray-700">
            {backups.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                暂无历史备份记录，点击上方「立即完整备份」创建第一份存档。
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {backups.map(backup => {
                  const isZip = backup.type === 'zip';
                  return (
                    <div
                      key={backup.name}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-2.5 text-xs transition hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-700"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                          {isZip ? <Archive className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-bold font-mono text-gray-800 dark:text-gray-100" title={backup.name}>
                              {backup.name}
                            </span>
                            {backup.label && (
                              <span className="flex-none rounded bg-indigo-50 px-1.5 py-0.5 text-micro font-medium text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                                {backup.label}
                              </span>
                            )}
                            {isZip && (
                              <span className="flex-none rounded bg-amber-50 px-1.5 py-0.5 text-micro font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                ZIP 压缩包
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-gray-400">
                            <span>{formatBackupDate(backup.createdAt)}</span>
                            <span>·</span>
                            <span>{formatBytes(backup.totalBytes)}</span>
                            {backup.fileCount > 0 && (
                              <>
                                <span>·</span>
                                <span>{backup.fileCount.toLocaleString('zh-CN')} 文件</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-none items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleOpenFolder(backup.path)}
                          className="mobile-touch flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-meta font-medium text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                          title="在文件资源管理器中打开此备份"
                        >
                          <ExternalLink className="h-3 w-3" />
                          定位
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
