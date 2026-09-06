import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Info,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
} from 'lucide-react';
import {
  DesktopLauncherStatus,
  getDesktopLauncherStatus,
  createDesktopLauncher,
  openDesktopFolder,
  getLauncherDownloadUrl,
} from '../services/desktopLauncher';

interface DesktopLauncherManagerProps {
  notify: (message: string) => void;
}

export const DesktopLauncherManager: React.FC<DesktopLauncherManagerProps> = ({ notify }) => {
  const [status, setStatus] = useState<DesktopLauncherStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createShortcut, setCreateShortcut] = useState(true);
  const [hideBat, setHideBat] = useState(true);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDesktopLauncherStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法获取桌面启动器状态');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createDesktopLauncher({
        createShortcut,
        hideBat,
      });
      notify(result.message || '桌面启动器已成功创建');
      await loadStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建桌面启动器失败';
      setError(msg);
      notify(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenDesktop = async () => {
    setOpeningFolder(true);
    try {
      await openDesktopFolder();
    } catch (err) {
      notify(err instanceof Error ? err.message : '无法打开桌面文件夹');
    } finally {
      setOpeningFolder(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white">Windows 桌面启动器</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            一键在系统桌面创建或更新启动脚本（<code className="font-mono text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">NaiPromptManager.bat</code>）与专属图标快捷方式（<code className="font-mono text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">NAI Atelier.lnk</code>），双击秒开并自动复用已有服务。
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            className="mobile-touch flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            title="刷新桌面状态"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Monitor className="h-4 w-4 text-indigo-500" />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {status ? (
        <div className="space-y-3">
          {!status.supported && (
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="h-4 w-4 flex-none mt-0.5 text-amber-500" />
              <div className="space-y-1">
                <p>桌面启动器主要针对 Windows 本地宿主机系统（当前环境：{status.platform}）。</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  您仍可以直接下载批处理脚本文件，或在 Windows 电脑端打开工坊进行一键快捷创建。
                </p>
              </div>
            </div>
          )}

          {/* 状态与路径详情 */}
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/70 dark:text-gray-300 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-gray-400 dark:text-gray-500 flex-none">桌面目录:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 truncate" title={status.desktopDir}>
                  {status.desktopDir || '未检测到桌面路径'}
                </span>
              </div>
              {status.desktopExists && status.supported && (
                <button
                  type="button"
                  onClick={() => void handleOpenDesktop()}
                  disabled={openingFolder}
                  className="mobile-touch flex items-center gap-1 text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 font-medium"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>打开桌面</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 dark:text-gray-500">启动脚本 (BAT):</span>
                {status.batExists ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                    已就绪
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">未创建</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-gray-400 dark:text-gray-500">图标快捷方式 (LNK):</span>
                {status.shortcutExists ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                    已就绪
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">未创建</span>
                )}
              </div>
            </div>
          </div>

          {/* 生成选项配置（仅限 Windows 宿主机） */}
          {status.supported && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createShortcut}
                  onChange={e => setCreateShortcut(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                />
                <span>创建专属调色盘图标快捷方式（NAI Atelier.lnk）</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideBat}
                  onChange={e => setHideBat(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
                />
                <span>隐藏底层 .bat 文件（桌面仅显示图标快捷方式）</span>
              </label>
            </div>
          )}

          {/* 操作按钮栏 */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {status.supported ? (
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="mobile-touch flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50 shadow-sm"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                <span>{status.batExists ? '更新桌面启动器' : '发送启动器到桌面'}</span>
              </button>
            ) : null}

            <a
              href={getLauncherDownloadUrl()}
              download="NaiPromptManager.bat"
              className="mobile-touch flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title="直接下载 NaiPromptManager.bat 批处理文件"
            >
              <Download className="h-3.5 w-3.5" />
              <span>下载启动脚本 (.bat)</span>
            </a>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>正在检查桌面环境…</span>
        </div>
      )}
    </div>
  );
};
