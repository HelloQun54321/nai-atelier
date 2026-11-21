import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useCallback, useEffect, useState } from 'react';
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
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { openLocalBackupFolder } from '../services/localBackup';
import { beginExportTarget } from '../services/exportLocation';
import { refreshStChatu8Preferences, setStChatu8Enabled, useStChatu8Preferences } from '../services/stChatu8Preferences';
import { refreshStBaiBaiPreferences, setStBaiBaiEnabled, useStBaiBaiPreferences } from '../services/stBaiBaiPreferences';

interface SillyTavernBridgeExportProps {
  notify: (message: string) => void;
}

const BRIDGE_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const FALLBACK_MANIFEST = JSON.stringify({
  display_name: '酒馆同步（智慧姬 / 柏宝绘）',
  loading_order: 110,
  requires: [],
  optional: ['st-chatu8', 'ST-BaiBai-Image'],
  js: `index.js?v=${BRIDGE_VERSION}`,
  css: `style.css?v=${BRIDGE_VERSION}`,
  author: 'HelloQun54321',
  version: BRIDGE_VERSION,
  description: '同步工坊精选风格串、Vibe 与历史图片（支持智慧姬 / 柏宝绘）。',
}, null, 2);

interface StBridgeStatus {
  connected: boolean;
  sillyTavernRoot: string | null;
  linkedArtists: number;
  linkedVibes: number;
  linkedGroups: number;
  linkedHistory: number;
  lastSyncAt: number;
  lastHistorySyncAt: number;
  historySyncing: boolean;
}

export const SillyTavernBridgeExport: React.FC<SillyTavernBridgeExportProps> = ({ notify }) => {
  useLanguage();
  const chatu8Preferences = useStChatu8Preferences();
  const baiBaiPreferences = useStBaiBaiPreferences();
  const anyEnabled = chatu8Preferences.enabled || baiBaiPreferences.enabled;

  const [serverUrl, setServerUrl] = useState(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  });
  const [stRoot, setStRoot] = useState('');
  const [detectedRoot, setDetectedRoot] = useState('');
  const [chatu8Status, setChatu8Status] = useState<StBridgeStatus | null>(null);
  const [baiBaiStatus, setBaiBaiStatus] = useState<StBridgeStatus | null>(null);
  const [installedPath, setInstalledPath] = useState('');
  const [installing, setInstalling] = useState(false);
  const [savingRoot, setSavingRoot] = useState(false);
  const [scanningTarget, setScanningTarget] = useState<'st-chatu8' | 'st-baibai' | null>(null);
  const [exporting, setExporting] = useState(false);
  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const normalizeStatus = (data: Partial<StBridgeStatus> | null | undefined): StBridgeStatus | null => {
    if (!data || typeof data !== 'object') return null;
    const root = typeof data.sillyTavernRoot === 'string' ? data.sillyTavernRoot : null;
    return {
      connected: Boolean(data.connected ?? root),
      sillyTavernRoot: root,
      linkedArtists: Number(data.linkedArtists || 0),
      linkedVibes: Number(data.linkedVibes || 0),
      linkedGroups: Number(data.linkedGroups || 0),
      linkedHistory: Number(data.linkedHistory || 0),
      lastSyncAt: Number(data.lastSyncAt || 0),
      lastHistorySyncAt: Number(data.lastHistorySyncAt || 0),
      historySyncing: Boolean(data.historySyncing),
    };
  };

  const applyTargetStatus = useCallback((target: 'st-chatu8' | 'st-baibai', data: Partial<StBridgeStatus> | null | undefined, fillInput = false) => {
    const normalized = normalizeStatus(data);
    if (!normalized) return;
    if (target === 'st-chatu8') setChatu8Status(normalized);
    else setBaiBaiStatus(normalized);
    if (normalized.sillyTavernRoot) {
      setDetectedRoot(normalized.sillyTavernRoot);
      if (fillInput) setStRoot(prev => prev || normalized.sillyTavernRoot!);
    }
  }, []);

  useEffect(() => {
    if (!chatu8Preferences.enabled) return;
    let active = true;
    fetch('/api/integrations/st-chatu8/status', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (active && data) applyTargetStatus('st-chatu8', data, true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [chatu8Preferences.enabled, applyTargetStatus]);

  useEffect(() => {
    if (!baiBaiPreferences.enabled) return;
    let active = true;
    fetch('/api/integrations/st-baibai/status', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (active && data) applyTargetStatus('st-baibai', data, true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [baiBaiPreferences.enabled, applyTargetStatus]);

  const handleToggleChatu8 = async (enabled: boolean) => {
    try { await setStChatu8Enabled(enabled); }
    catch (error) { notify(error instanceof Error ? error.message : '保存智慧姬同步设置失败'); }
  };

  const handleToggleBaiBai = async (enabled: boolean) => {
    try { await setStBaiBaiEnabled(enabled); }
    catch (error) { notify(error instanceof Error ? error.message : '保存柏宝绘同步设置失败'); }
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

  const primaryBridgePrefix = chatu8Preferences.enabled ? '/api/integrations/st-chatu8' : '/api/integrations/st-baibai';

  const fetchExtensionFiles = async (): Promise<Record<string, string>> => {
    try {
      const res = await fetch(`${primaryBridgePrefix}/extension/files`);
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
      'README.md': '# 酒馆同步扩展 (npm-bridge)\n\n请参考项目文档完成安装。',
    };
  };

  const prepareFiles = async () => {
    const rawFiles = await fetchExtensionFiles();
    const prepared: Record<string, string> = { ...rawFiles };
    const targetUrl = serverUrl.trim().replace(/\/$/, '') || 'http://localhost:3000';
    if (prepared['index.js']) {
      prepared['index.js'] = prepared['index.js'].replace(
        /const DEFAULT_URL = 'http:\/\/localhost:3000';/,
        `const DEFAULT_URL = '${targetUrl}';`
      );
    }
    return prepared;
  };

  const handleInstallExtension = async () => {
    const rootToUse = stRoot.trim() || detectedRoot;
    if (!rootToUse) {
      notify('请先填写或选择 SillyTavern 的安装根目录');
      return;
    }
    setInstalling(true);
    try {
      const res = await fetch(`${primaryBridgePrefix}/extension/install`, {
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
      if (data.chatu8Status) applyTargetStatus('st-chatu8', data.chatu8Status, false);
      else if (chatu8Preferences.enabled && data.status) applyTargetStatus('st-chatu8', data.status, false);
      if (data.baiBaiStatus) applyTargetStatus('st-baibai', data.baiBaiStatus, false);
      else if (baiBaiPreferences.enabled && data.status) applyTargetStatus('st-baibai', data.status, false);
      notify(`已成功安装扩展至：${data.targetPath}，刷新酒馆页面即可生效！`);
    } catch (err: any) {
      notify(`安装失败：${err?.message || '未知错误'}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleSaveRoot = async () => {
    const trimmed = stRoot.trim();
    if (!trimmed) {
      notify('请先填写 SillyTavern 的安装根目录');
      return;
    }
    setSavingRoot(true);
    try {
      const res = await fetch(`${primaryBridgePrefix}/root`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sillyTavernRoot: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '保存酒馆目录失败');
      if (chatu8Preferences.enabled) applyTargetStatus('st-chatu8', data, false);
      if (baiBaiPreferences.enabled) applyTargetStatus('st-baibai', data, false);
      if (data?.sillyTavernRoot) setStRoot(data.sillyTavernRoot);
      notify(`已绑定 SillyTavern 目录：${data?.sillyTavernRoot || trimmed}`);
    } catch (err: any) {
      notify(`保存目录失败：${err?.message || '未知错误'}`);
    } finally {
      setSavingRoot(false);
    }
  };

  const handleScanHistory = async (target: 'st-chatu8' | 'st-baibai') => {
    setScanningTarget(target);
    try {
      const res = await fetch(`/api/integrations/${target}/history/scan`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '扫描酒馆历史失败');
      applyTargetStatus(target, data, false);
      notify(`${target === 'st-baibai' ? '柏宝绘' : '智慧姬'}历史扫描完成，共关联 ${Number(data?.linkedHistory || 0)} 张原图`);
    } catch (err: any) {
      notify(`扫描历史失败：${err?.message || '未知错误'}`);
    } finally {
      setScanningTarget(null);
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
      const exportTarget = beginExportTarget();
      const files = await prepareFiles();
      const zip = new JSZip();
      for (const [filename, content] of Object.entries(files)) {
        zip.file(filename, content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const { downloadFile } = await import('../services/fileDownload');
      const receipt = await downloadFile(blob, 'npm-bridge.zip', exportTarget);
      notify(receipt.browserDownload ? '已交给浏览器下载 (npm-bridge.zip)' : '智慧姬同步扩展包已下载 (npm-bridge.zip)');
    } catch (err: any) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
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
      {/* 智慧姬同步独立开关 */}
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block font-semibold text-gray-900 dark:text-white">{t("智慧姬同步")}</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t("发送工坊精选，接收酒馆预设；关闭保留资料。")}</span>
        </span>
        <input type="checkbox" aria-label={t("智慧姬同步")} checked={chatu8Preferences.enabled} disabled={!chatu8Preferences.ready || chatu8Preferences.busy || installing || exporting}
          onChange={event => { void handleToggleChatu8(event.target.checked); }} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600 disabled:opacity-40" />
      </label>
      {chatu8Preferences.error && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"><span>{t(chatu8Preferences.error)}</span><button type="button" data-appearance="control" data-tone="neutral" onClick={() => { void refreshStChatu8Preferences(); }} disabled={chatu8Preferences.busy} className="mobile-touch shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-indigo-600 underline transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">{t("重新读取")}</button></div>}

      {/* 柏宝绘同步独立开关 */}
      <label className="flex cursor-pointer items-start justify-between gap-4 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
        <span className="min-w-0">
          <span className="block font-semibold text-gray-900 dark:text-white">{t("柏宝绘同步")}</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
            {t("接收柏宝绘预设、Vibe 与历史图；仅在酒馆手动点击「立即同步」时写回，写入后需刷新酒馆页面生效。")}</span>
        </span>
        <input type="checkbox" aria-label={t("柏宝绘同步")} checked={baiBaiPreferences.enabled} disabled={!baiBaiPreferences.ready || baiBaiPreferences.busy || installing || exporting}
          onChange={event => { void handleToggleBaiBai(event.target.checked); }} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600 disabled:opacity-40" />
      </label>
      {baiBaiPreferences.error && <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"><span>{t(baiBaiPreferences.error)}</span><button type="button" data-appearance="control" data-tone="neutral" onClick={() => { void refreshStBaiBaiPreferences(); }} disabled={baiBaiPreferences.busy} className="mobile-touch shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-indigo-600 underline transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">{t("重新读取")}</button></div>}

      {anyEnabled && <>
        <div className="appearance-group rounded-xl border border-gray-200 bg-gray-50/70 p-3 text-xs dark:border-gray-700/60 dark:bg-gray-800/50">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 酒馆根目录 */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                  <Folder className="h-3.5 w-3.5 text-gray-400" />
                  <span>{t("SillyTavern 安装路径：")}</span>
                </label>
                {detectedRoot && stRoot === detectedRoot && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-micro font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("已自动检测")}</span>
                )}
              </div>
              <input
                type="text"
                value={stRoot}
                onChange={e => setStRoot(e.target.value)}
                placeholder={t("例如：D:\\SillyTavern")}
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                title={t("SillyTavern 本地安装根目录")}
              />
            </div>

            {/* 服务连接地址 */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                  <Link2 className="h-3.5 w-3.5 text-gray-400" />
                  <span>{t("服务连接地址：")}</span>
                </label>
                <span className="text-micro text-gray-400 dark:text-gray-500">
                  {t("写入扩展作为默认值")}</span>
              </div>
              <input
                type="text"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                title={t("SillyTavern 连接器向本项目通信所使用的 HTTP 地址")}
              />
            </div>
          </div>

          {/* 自动补全路径预览 */}
          <div className="mt-3 flex items-start gap-1.5 border-t border-gray-200/70 pt-2.5 text-meta text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-indigo-500" />
            <div className="min-w-0 flex-1">
              <span>{t("安装目标路径（共用同一扩展，自动识别已启用的酒馆插件）：")}</span>
              <code className="appearance-group mt-0.5 block truncate rounded bg-gray-200/70 px-1.5 py-0.5 font-mono text-meta text-gray-800 dark:bg-gray-700 dark:text-gray-200" title={currentTargetPath}>
                {currentTargetPath}
              </code>
            </div>
            {stRoot.trim() && stRoot.trim() !== detectedRoot && (
              <button
                type="button"
                data-appearance="control" data-tone="neutral"
                disabled={savingRoot}
                onClick={() => void handleSaveRoot()}
                className="mobile-touch shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-micro font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {savingRoot ? t("保存中…") : t("保存目录")}
              </button>
            )}
          </div>

          {chatu8Preferences.enabled && chatu8Status && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/70 pt-2.5 text-meta text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
              <span>
                {chatu8Status.connected
                  ? t("智慧姬 · 风格串 {0} · Vibe 组 {1} · 历史 {2} 张", [chatu8Status.linkedArtists, chatu8Status.linkedGroups, chatu8Status.linkedHistory])
                  : t("智慧姬：未检测到酒馆目录（历史零拷贝与导入封面需绑定有效路径）")}
                {chatu8Status.lastSyncAt > 0 && ` · ${t("上次同步 {0}", [new Date(chatu8Status.lastSyncAt).toLocaleTimeString(getLanguage(), { hour12: false })])}`}
              </span>
              {chatu8Status.connected && (
                <button
                  type="button"
                  data-appearance="control" data-tone="neutral"
                  aria-label={t("扫描智慧姬历史")}
                  disabled={scanningTarget !== null || chatu8Status.historySyncing}
                  onClick={() => void handleScanHistory('st-chatu8')}
                  className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-micro font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <RefreshCw className={`h-3 w-3 ${scanningTarget === 'st-chatu8' || chatu8Status.historySyncing ? 'animate-spin' : ''}`} />
                  {scanningTarget === 'st-chatu8' || chatu8Status.historySyncing ? t("扫描中…") : t("扫描历史")}
                </button>
              )}
            </div>
          )}

          {baiBaiPreferences.enabled && baiBaiStatus && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/70 pt-2.5 text-meta text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
              <span>
                {baiBaiStatus.connected
                  ? t("柏宝绘 · 风格串 {0} · Vibe {1} · 历史 {2} 张", [baiBaiStatus.linkedArtists, baiBaiStatus.linkedVibes, baiBaiStatus.linkedHistory])
                  : t("柏宝绘：未检测到酒馆目录（历史零拷贝与导入封面需绑定有效路径）")}
                {baiBaiStatus.lastSyncAt > 0 && ` · ${t("上次同步 {0}", [new Date(baiBaiStatus.lastSyncAt).toLocaleTimeString(getLanguage(), { hour12: false })])}`}
              </span>
              {baiBaiStatus.connected && (
                <button
                  type="button"
                  data-appearance="control" data-tone="neutral"
                  aria-label={t("扫描柏宝绘历史")}
                  disabled={scanningTarget !== null || baiBaiStatus.historySyncing}
                  onClick={() => void handleScanHistory('st-baibai')}
                  className="mobile-touch inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-micro font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <RefreshCw className={`h-3 w-3 ${scanningTarget === 'st-baibai' || baiBaiStatus.historySyncing ? 'animate-spin' : ''}`} />
                  {scanningTarget === 'st-baibai' || baiBaiStatus.historySyncing ? t("扫描中…") : t("扫描历史")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 操作按钮区 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-appearance="control" data-tone="primary"
            onClick={() => void handleInstallExtension()}
            disabled={installing}
            className="mobile-touch flex items-center gap-1.5 rounded-lg bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={t("将扩展直接安装/更新写入到指定的 SillyTavern 插件目录")}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {installing ? t("正在安装…") : (detectedRoot ? t("一键安装 / 更新扩展") : t("安装扩展到酒馆"))}
          </button>

          {(installedPath || detectedRoot) && (
            <button
              type="button"
              data-appearance="control" data-tone="neutral"
              onClick={() => void handleOpenFolder()}
              className="appearance-group mobile-touch flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title={t("在系统文件管理器中打开安装目录")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("定位扩展目录")}</button>
          )}

          {supportsDirectoryPicker && (
            <button
              type="button"
              data-appearance="control" data-tone="neutral"
              onClick={() => void handleExportToDirectory()}
              disabled={exporting}
              className="appearance-group mobile-touch flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title={t("手动选择本地目录导出（选中酒馆根目录亦可自动补全）")}
            >
              <FolderOutput className="h-3.5 w-3.5" />
              {exporting ? t("导出中…") : t("选择目录导出")}
            </button>
          )}

          <button
            type="button"
            data-appearance="control" data-tone="neutral"
            onClick={() => void handleDownloadZip()}
            disabled={exporting}
            className="appearance-group mobile-touch flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            title={t("将完整的扩展文件打包下载为 ZIP 压缩包")}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? t("打包中…") : t("下载 ZIP 扩展包")}
          </button>
        </div>
      </>}
    </div>
  );
};
