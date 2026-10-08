import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog';
import { InfoPopover } from './InfoPopover';
import { AppUpdateState, desktopUpdateBridge, preserveUpdateDrafts, clearUpdateDrafts } from '../services/appUpdate';
import { compareReleaseVersions, fetchPublishedRelease, RELEASE_PAGE } from '../services/appReleases.mjs';

export const AppUpdateManager: React.FC = () => {
  useLanguage();
  const bridge = desktopUpdateBridge();
  const confirm = useConfirmDialog();
  const [state, setState] = useState<AppUpdateState>({ phase: 'idle', currentVersion: __APP_VERSION__, version: '', progress: 0, allowPrerelease: true, message: '', releaseNotes: '' });
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const update = (next: AppUpdateState) => { if (active) setState(next); };
    const unsubscribe = bridge.onStatus(update);
    void bridge.status().then(update).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
  const action = async (kind: 'check' | 'download' | 'install') => {
    try {
      if (kind === 'install' && !await confirm({ title: '重启并安装更新？', message: '工坊将暂时退出，手机连接会中断。当前任务需先完成；个人数据保留。', confirmLabel: '重启并安装' })) return;
      if (bridge) {
        if (kind === 'install') preserveUpdateDrafts();
        setState(await bridge[kind]()); return;
      }
      setState(previous => ({ ...previous, phase: 'checking', message: '' }));
      const release = await fetchPublishedRelease(state.allowPrerelease);
      const version = release?.tag_name.replace(/^v/, '') || '';
      setState(previous => ({ ...previous, phase: version && compareReleaseVersions(version, __APP_VERSION__) > 0 ? 'available' : 'latest', version, releaseNotes: String(release?.body || '').slice(0, 8000) }));
    } catch (error) {
      if (kind === 'install') { try { clearUpdateDrafts(); } catch { /* 存储不可用 */ } }
      setState(previous => ({ ...previous, phase: previous.phase === 'downloaded' ? 'downloaded' : 'error', message: error instanceof Error ? error.message : '更新失败，请稍后重试' }));
    }
  };
  const button = 'mobile-touch inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50';
  const status = state.phase === 'checking' ? '正在检查…' : state.phase === 'latest' ? '当前渠道没有更新版本' : state.phase === 'downloading' ? `正在下载 ${state.progress}%` : state.phase === 'downloaded' ? `v${state.version} 已下载` : state.phase === 'installing' ? '正在退出工坊并安装…' : state.version ? `可用版本 v${state.version}` : '';
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
        <h4 className="whitespace-nowrap font-semibold text-gray-900 dark:text-white">{t("应用更新")}</h4>
        <span className="text-xs text-gray-500 dark:text-gray-400">v{state.currentVersion}</span>
        {!bridge && <InfoPopover label={t("更新方式")} content={t("请在电脑更新工坊：安装版使用应用内入口；源码版退出服务后，双击项目中的「更新 NAI Atelier.bat」。")} />}
      </div>
      {status && <span role="status" className="text-xs text-gray-500 dark:text-gray-400">{t(status)}</span>}
      <label title={t("仅检查已发布版本，勾选后包含预发布")} className="flex items-center gap-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={state.allowPrerelease} disabled={busy || state.phase === 'downloaded'} onChange={async event => {
        const value = event.target.checked;
        try { setState(bridge ? await bridge.channel(value) : { ...state, allowPrerelease: value, phase: 'idle', version: '', message: '' }); }
        catch (error) { setState(previous => ({ ...previous, message: error instanceof Error ? error.message : '设置保存失败' })); }
      }} className="h-4 w-4 accent-indigo-600" />{t("接收预发布版本")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || state.phase === 'downloaded'} onClick={() => void action('check')}><RefreshCw className={`h-3.5 w-3.5 ${state.phase === 'checking' ? 'animate-spin' : ''}`} />{t("检查更新")}</button>
        {bridge && state.version && ['available', 'error'].includes(state.phase) && <button type="button" className={button} onClick={() => void action('download')}><Download className="h-3.5 w-3.5" />{t("下载更新")}</button>}
        {bridge && state.phase === 'downloaded' && <button type="button" className={button} onClick={() => void action('install')}>{t("重启并安装")}</button>}
        <a href={RELEASE_PAGE} target="_blank" rel="noreferrer" className="mobile-touch inline-flex items-center gap-1.5 px-2 py-2 text-xs text-indigo-600 dark:text-indigo-300"><ExternalLink className="h-3.5 w-3.5" />{t("下载页")}</a>
      </div>
    </div>
    {state.phase === 'downloading' && <progress aria-label={t("更新下载进度")} value={state.progress} max={100} className="h-2 w-full accent-indigo-600" />}
    {state.message && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{t(state.message)}</p>}
    {state.releaseNotes && <details className="text-xs text-gray-500 dark:text-gray-400"><summary className="cursor-pointer">{t("更新说明")}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap leading-5">{state.releaseNotes}</p></details>}
  </div>;
};
