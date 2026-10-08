import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Info,
  Loader2,
  Monitor,
  Play,
} from 'lucide-react';
import {
  DesktopLauncherStatus,
  getDesktopLauncherStatus,
  createDesktopLauncher,
  openDesktopFolder,
} from '../services/desktopLauncher';

interface DesktopLauncherManagerProps {
  notify: (message: string) => void;
}

export const DesktopLauncherManager: React.FC<DesktopLauncherManagerProps> = ({ notify }) => {
  useLanguage();
  const [status, setStatus] = useState<DesktopLauncherStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setError(null);
    try {
      const data = await getDesktopLauncherStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法获取桌面启动器状态');
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createDesktopLauncher();
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
          <h4 className="font-semibold text-gray-900 dark:text-white">{t("Windows 桌面启动器")}</h4>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          <Monitor className="h-4 w-4 text-indigo-500" />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">
          {t(error)}
        </div>
      )}

      {status ? (
        <div className="space-y-3">
          {!status.supported && (
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="h-4 w-4 flex-none mt-0.5 text-amber-500" />
              <div className="space-y-1">
                <p>{t("仅支持 Windows（当前：{0}）。", [status.platform])}</p>
                <p className="text-meta text-amber-700 dark:text-amber-300">
                  {t("运行 npm run dev:local")}</p>
              </div>
            </div>
          )}

          {/* 状态与路径详情 */}
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/70 dark:text-gray-300 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-gray-400 dark:text-gray-500 flex-none">{t("桌面目录:")}</span>
                <span className="font-mono text-gray-800 dark:text-gray-200 truncate" title={status.desktopDir}>
                  {status.desktopDir || t("未检测到桌面路径")}
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
                  <span>{t("打开桌面")}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 dark:text-gray-500">{status.launcherKind === 'exe' ? t("桌面应用:") : t("项目内启动脚本:")}</span>
                {status.batExists ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                    {t("已就绪")}</span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">{t("项目文件缺失")}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-gray-400 dark:text-gray-500">{t("图标快捷方式 (LNK):")}</span>
                {status.shortcutExists ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
                    {t("已就绪")}</span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">{t("未创建")}</span>
                )}
              </div>
            </div>
          </div>

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
                <span>{status.shortcutExists ? t("修复桌面快捷方式") : t("创建桌面快捷方式")}</span>
              </button>
            ) : null}

          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{t("正在检查桌面环境…")}</span>
        </div>
      )}
    </div>
  );
};
