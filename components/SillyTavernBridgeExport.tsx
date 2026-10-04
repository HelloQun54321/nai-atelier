import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Folder,
  FolderOutput,
  Info,
  Link2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { openLocalBackupFolder } from '../services/localBackup';
import { refreshStChatu8Preferences, setStChatu8Enabled, useStChatu8Preferences } from '../services/stChatu8Preferences';

interface SillyTavernBridgeExportProps {
  notify: (message: string) => void;
}

const BRIDGE_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const FALLBACK_MANIFEST = JSON.stringify({
  display_name: '智慧姬同步',
  loading_order: 110,
  requires: [],
  optional: ['st-chatu8'],
  js: `index.js?v=${BRIDGE_VERSION}`,
  css: `style.css?v=${BRIDGE_VERSION}`,
  author: 'HelloQun54321',
  version: BRIDGE_VERSION,
  description: '同步工坊精选、酒馆预设、Vibe 与历史图片。',
}, null, 2);

export const SillyTavernBridgeExport: React.FC<SillyTavernBridgeExportProps> = ({ notify }) => {
  const preferences = useStChatu8Preferences();
  const [serverUrl, setServerUrl] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  });
  const [stRoot, setStRoot] = useState('');
  const [detectedRoot, setDetectedRoot] = useState('');
  const [installedPath, setInstalledPath] = useState('');
  const [installing, setInstalling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  // 自动尝试从本地桥接探测已有的 SillyTavern 根目录
  useEffect(() => {
    if (!preferences.enabled) return;
    let active = true;
    fetch('/api/integrations/st-chatu8/status')
      .then(res => res.json())
      .then(data => {
        if (active && data?.sillyTavernRoot && typeof data.sillyTavernRoot === 'string') {
          setDetectedRoot(data.sillyTavernRoot);
          setStRoot(prev => prev || data.sillyTavernRoot);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [preferences.enabled]);

  const handleToggle = async (enabled: boolean) => {
    try { await setStChatu8Enabled(enabled); }
    catch (error) { notify(error instanceof Error ? error.message : '保存智慧姬同步设置失败'); }
  };

  const computeTargetDir = (root: string) => {
    const trimmed = root.trim();
    if (!trimmed) return 'SillyTavern/public/scripts/extensions/third-party/npm-bridge/';
    const normalized = trimmed.replaceAll('/', '\\');
    if (normalized.toLowerCase().endsWith('\\npm-bridge')) return trimmed;
    if (normalized.toLowerCase().endsWith('\\third-party')) return `${trimmed}\\npm-bridge`;
    if (normalized.toLowerCase().endsWith('\\extensions')) return `${trimmed}\\third-party\\npm-bridge`;
    if (normalized.toLowerCase().endsWith('\\scripts')) return `${trimmed}\\extensions\\third-party\\npm-bridge`;
    if (normalized.toLowerCase().endsWith('\\public')) return `${trimmed}\\scripts\\extensions\\third-party\\npm-bridge`;
    const sep = trimmed.includes('/') ? '/' : '\\';
    return `${trimmed.replace(/[\\/]+$/, '')}${sep}public${sep}scripts${sep}extensions${sep}third-party${sep}npm-bridge`;
  };

  const fetchExtensionFiles = async (): Promise<Record<string, string>> => {
    try {
      const res = await fetch('/api/integrations/st-chatu8/extension/files');
      if (res.ok) {
        const data = await res.json();
        if (data.files && typeof data.files === 'object') {
          return data.files as Record<string, string>;
        }
      }
    } catch {
      // Fallback below if gateway route unavailable
    }
    return {
      'manifest.json': FALLBACK_MANIFEST,
      'README.md': '# 智慧姬同步扩展 (npm-bridge)\n\n请参考项目文档完成安装。',
    };
  };

  const prepareFiles = async () => {
    const rawFiles = await fetchExtensionFiles();
    const prepared: Record<string, string> = { ...rawFiles };
    const targetUrl = serverUrl.trim().replace(/\/$/, '') || 'http://localhost:3000';
    if (prepared['index.js']) {
      // 注入指定的服务连接地址
      prepared['index.js'] = prepared['index.js'].replace(
        /const DEFAULT_URL = 'http:\/\/localhost:3000';/,
        `const DEFAULT_URL = '${targetUrl}';`
      );
    }
    return prepared;
  };

  /**
   * 服务端直接一键安装/更新到 SillyTavern
   */
  const handleInstallExtension = async () => {
    const rootToUse = stRoot.trim() || detectedRoot;
    if (!rootToUse) {
      notify('请先填写或选择 SillyTavern 的安装根目录');
      return;
    }
    setInstalling(true);
    try {
      const res = await fetch('/api/integrations/st-chatu8/extension/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sillyTavernRoot: rootToUse,
          targetUrl: serverUrl.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || '安装扩展失败');
      }
      setInstalledPath(data.targetPath);
      notify(`已成功安装扩展至：${data.targetPath}，刷新酒馆页面即可生效！`);
    } catch (err: any) {
      notify(`安装失败：${err?.message || '未知错误'}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleOpenFolder = async () => {
    const target = installedPath || computeTargetDir(stRoot || detectedRoot);
    try {
      await openLocalBackupFolder(target);
    } catch (err: any) {
      notify(`无法打开目录：${err?.message || '目标目录可能尚未创建'}`);
    }
  };

  const handleDownloadZip = async () => {
    setExporting(true);
    try {
      const files = await prepareFiles();
      const zip = new JSZip();
      for (const [filename, content] of Object.entries(files)) {
        zip.file(filename, content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'npm-bridge.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notify('智慧姬同步扩展包已下载 (npm-bridge.zip)');
    } catch (err: any) {
      notify(`下载失败：${err?.message || '未知错误'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportToDirectory = async () => {
    if (!supportsDirectoryPicker) {
      void handleDownloadZip();
      return;
    }
    setExporting(true);
    try {
      // @ts-expect-error Window.showDirectoryPicker is experimental but supported in Chromium
      const dirHandle = await window.showDirectoryPicker({
        id: 'sillytavern-extension-export',
        mode: 'readwrite',
      });

      // 智能路径补全：若用户选中 SillyTavern 根目录，自动创建与进入子扩展目录
      let targetDirHandle = dirHandle;
      const nameLower = String(dirHandle.name || '').toLowerCase();
      if (nameLower === 'sillytavern') {
        const publicDir = await dirHandle.getDirectoryHandle('public', { create: true });
        const scriptsDir = await publicDir.getDirectoryHandle('scripts', { create: true });
        const extDir = await scriptsDir.getDirectoryHandle('extensions', { create: true });
        const thirdPartyDir = await extDir.getDirectoryHandle('third-party', { create: true });
        targetDirHandle = await thirdPartyDir.getDirectoryHandle('npm-bridge', { create: true });
      } else if (nameLower === 'third-party') {
        targetDirHandle = await dirHandle.getDirectoryHandle('npm-bridge', { create: true });
      } else if (nameLower !== 'npm-bridge') {
        try {
          const publicDir = await dirHandle.getDirectoryHandle('public', { create: false });
          const scriptsDir = await publicDir.getDirectoryHandle('scripts', { create: true });
          const extDir = await scriptsDir.getDirectoryHandle('extensions', { create: true });
          const thirdPartyDir = await extDir.getDirectoryHandle('third-party', { create: true });
          targetDirHandle = await thirdPartyDir.getDirectoryHandle('npm-bridge', { create: true });
        } catch {
          // 用户选中的就是目标目录或自定义子目录，直接写入
        }
      }

      const files = await prepareFiles();
      for (const [filename, content] of Object.entries(files)) {
        const fileHandle = await targetDirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }
      notify(`已成功导出并写入扩展文件到目录：${targetDirHandle.name}`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        notify(`导出到目录失败：${err?.message || '未知错误'}`);
      }
    } finally {
      setExporting(false);
    }
  };

  const currentTargetPath = computeTargetDir(stRoot || detectedRoot);

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block font-semibold text-gray-900 dark:text-white">智慧姬同步</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
            发送工坊精选，接收酒馆预设；关闭保留资料。
          </span>
        </span>
        <input type="checkbox" aria-label="智慧姬同步" checked={preferences.enabled} disabled={!preferences.ready || preferences.busy || installing || exporting}
          onChange={event => { void handleToggle(event.target.checked); }} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600 disabled:opacity-40" />
      </label>
      {preferences.error && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"><span>{preferences.error}</span><button type="button" onClick={() => { void refreshStChatu8Preferences(); }} disabled={preferences.busy} className="shrink-0 underline">重新读取</button></div>}

      {preferences.enabled && <>
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 text-xs dark:border-gray-700/60 dark:bg-gray-800/50">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 酒馆根目录 */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                  <Folder className="h-3.5 w-3.5 text-gray-400" />
                  <span>SillyTavern 安装路径：</span>
                </label>
                {detectedRoot && stRoot === detectedRoot && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-micro font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    已自动检测
                  </span>
                )}
              </div>
              <input
                type="text"
                value={stRoot}
                onChange={e => setStRoot(e.target.value)}
                placeholder="例如：D:\SillyTavern"
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                title="SillyTavern 本地安装根目录"
              />
            </div>

            {/* 服务连接地址 */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                  <Link2 className="h-3.5 w-3.5 text-gray-400" />
                  <span>服务连接地址：</span>
                </label>
                <span className="text-micro text-gray-400 dark:text-gray-500">
                  写入扩展作为默认值
                </span>
              </div>
              <input
                type="text"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                title="SillyTavern 连接器向本项目通信所使用的 HTTP 地址"
              />
            </div>
          </div>

          {/* 自动补全路径预览 */}
          <div className="mt-3 flex items-start gap-1.5 border-t border-gray-200/70 pt-2.5 text-meta text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-indigo-500" />
            <div className="min-w-0 flex-1">
              <span>安装目标路径（自动补全）：</span>
              <code className="mt-0.5 block truncate rounded bg-gray-200/70 px-1.5 py-0.5 font-mono text-meta text-gray-800 dark:bg-gray-700 dark:text-gray-200" title={currentTargetPath}>
                {currentTargetPath}
              </code>
            </div>
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleInstallExtension()}
            disabled={installing}
            className="mobile-touch flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            title="将扩展直接安装/更新写入到指定的 SillyTavern 插件目录"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {installing ? '正在安装…' : (detectedRoot ? '一键安装 / 更新扩展' : '安装扩展到酒馆')}
          </button>

          {(installedPath || detectedRoot) && (
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="mobile-touch flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title="在系统文件管理器中打开安装目录"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              定位扩展目录
            </button>
          )}

          {supportsDirectoryPicker && (
            <button
              type="button"
              onClick={() => void handleExportToDirectory()}
              disabled={exporting}
              className="mobile-touch flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              title="手动选择本地目录导出（选中酒馆根目录亦可自动补全）"
            >
              <FolderOutput className="h-3.5 w-3.5" />
              {exporting ? '导出中…' : '选择目录导出'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleDownloadZip()}
            disabled={exporting}
            className="mobile-touch flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            title="将完整的扩展文件打包下载为 ZIP 压缩包"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? '打包中…' : '下载 ZIP 扩展包'}
          </button>
        </div>
      </>}
    </div>
  );
};
