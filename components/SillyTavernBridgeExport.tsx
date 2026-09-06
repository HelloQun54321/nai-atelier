import React, { useState } from 'react';
import JSZip from 'jszip';
import { Download, FolderOutput, Info, Link2, Puzzle } from 'lucide-react';

interface SillyTavernBridgeExportProps {
  notify: (message: string) => void;
}

const FALLBACK_MANIFEST = JSON.stringify({
  display_name: 'NaiPromptManager 连接器',
  loading_order: 110,
  requires: [],
  optional: ['st-chatu8'],
  js: 'index.js?v=1.5.0',
  css: 'style.css?v=1.5.0',
  author: 'HelloQun54321',
  version: '1.5.0',
  description: '在 NaiPromptManager 与 st-chatu8 之间同步画师串、Vibe，并将 st-chatu8 原图接入生成历史。',
}, null, 2);

export const SillyTavernBridgeExport: React.FC<SillyTavernBridgeExportProps> = ({ notify }) => {
  const [serverUrl, setServerUrl] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  });
  const [exporting, setExporting] = useState(false);
  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

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
      'README.md': '# SillyTavern — NaiPromptManager 连接器扩展 (npm-bridge)\n\n请参考项目文档完成安装。',
    };
  };

  const prepareFiles = async () => {
    const rawFiles = await fetchExtensionFiles();
    const prepared: Record<string, string> = { ...rawFiles };
    const targetUrl = serverUrl.trim().replace(/\/$/, '') || 'http://localhost:3000';
    if (prepared['index.js']) {
      // Injects user-specified default server URL
      prepared['index.js'] = prepared['index.js'].replace(
        /const DEFAULT_URL = 'http:\/\/localhost:3000';/,
        `const DEFAULT_URL = '${targetUrl}';`
      );
    }
    return prepared;
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
      notify('SillyTavern 连接器扩展包已下载 (npm-bridge.zip)');
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
      const files = await prepareFiles();
      for (const [filename, content] of Object.entries(files)) {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }
      notify(`已成功导出扩展文件到目录：${dirHandle.name}`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        notify(`导出到目录失败：${err?.message || '未知错误'}`);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white">SillyTavern 互通扩展 (npm-bridge)</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            在 SillyTavern 与 NAI Atelier 之间双向同步画师串、Vibe 组合与生图历史原图。
          </p>
        </div>
        <Puzzle className="h-4 w-4 flex-none text-indigo-500" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 text-xs dark:border-gray-700/60 dark:bg-gray-800/50">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-gray-400" />
            <span className="font-medium text-gray-700 dark:text-gray-300">服务连接地址：</span>
            <input
              type="text"
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="w-56 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              title="SillyTavern 连接器向本项目通信所使用的 HTTP 地址"
            />
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            将作为扩展默认值导出
          </span>
        </div>

        <div className="mt-2.5 flex items-start gap-1.5 border-t border-gray-200/70 pt-2 text-[11px] text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-indigo-500" />
          <span>
            安装目标路径：<code className="rounded bg-gray-200/70 px-1 py-0.5 font-mono text-[11px] text-gray-800 dark:bg-gray-700 dark:text-gray-200">SillyTavern/public/scripts/extensions/third-party/npm-bridge/</code>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {supportsDirectoryPicker && (
          <button
            type="button"
            onClick={() => void handleExportToDirectory()}
            disabled={exporting}
            className="mobile-touch flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            title="直接选择 SillyTavern 的扩展目录进行写入"
          >
            <FolderOutput className="h-3.5 w-3.5" />
            {exporting ? '导出中…' : '导出到指定目录'}
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleDownloadZip()}
          disabled={exporting}
          className={`mobile-touch flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 ${
            supportsDirectoryPicker
              ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              : 'bg-indigo-600 text-white hover:bg-indigo-500'
          }`}
          title="将完整的扩展文件打包下载为 ZIP 压缩包"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? '打包中…' : '下载 ZIP 扩展包'}
        </button>
      </div>
    </div>
  );
};
