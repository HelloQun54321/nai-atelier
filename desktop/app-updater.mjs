import { compareReleaseVersions, releaseVersion, RELEASE_PAGE } from '../services/appReleases.mjs';

/** 更新器只接收固定操作；安装前由主进程冻结请求并等待自身后台退出。 */
export function createDesktopUpdater({ updater, version, allowPrerelease = true, savePreference, publish, prepareInstall, stopBackend, resumeBackend, openReleasePage }) {
  let state = { phase: 'idle', currentVersion: version, version: '', progress: 0, allowPrerelease, message: '', releaseNotes: '' };
  let pending = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = allowPrerelease;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.disableWebInstaller = true;
  const update = patch => { state = { ...state, ...patch }; publish({ ...state }); };
  const fail = error => update({ phase: 'error', message: error.message || '更新失败，可重试或打开下载页' });
  updater.on('error', error => {
    if (state.phase !== 'installing') return fail(error);
    update({ phase: 'downloaded', message: error.message || '安装未完成' });
    void resumeBackend().catch(fail);
  });
  updater.on('update-available', info => {
    if (!releaseVersion(info.version) || compareReleaseVersions(info.version, version) <= 0) return fail(new Error('发行版本号无效或低于当前版本'));
    update({ phase: 'available', version: info.version, progress: 0, message: '', releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 8000) : '' });
  });
  updater.on('update-not-available', () => update({ phase: 'latest', version: '', message: '', releaseNotes: '' }));
  updater.on('download-progress', info => update({ phase: 'downloading', progress: Math.max(0, Math.min(100, Math.round(info.percent))) }));
  updater.on('update-downloaded', info => {
    if (info.version !== state.version || !releaseVersion(info.version)) return fail(new Error('下载版本与检查结果不一致'));
    update({ phase: 'downloaded', progress: 100, message: '' });
  });
  return {
    status: () => ({ ...state }),
    async action(action, value) {
      if (action === 'status') return { ...state };
      if (action === 'releases') { await openReleasePage(RELEASE_PAGE); return { ...state }; }
      if (pending || ['downloading', 'installing'].includes(state.phase)) throw new Error('更新操作正在进行');
      pending = true;
      try {
        if (action === 'channel') {
          if (typeof value !== 'boolean') throw new Error('更新渠道无效');
          await savePreference(value);
          updater.allowPrerelease = value;
          updater.allowDowngrade = false;
          update({ phase: 'idle', allowPrerelease: value, version: '', progress: 0, message: '', releaseNotes: '' });
        } else if (action === 'check') {
          if (state.phase === 'downloaded') return { ...state };
          update({ phase: 'checking', message: '' });
          await updater.checkForUpdates();
        } else if (action === 'download') {
          if (!state.version || !['available', 'error'].includes(state.phase)) throw new Error('请先检查可用更新');
          update({ phase: 'downloading', progress: 0, message: '' });
          await updater.downloadUpdate();
        } else if (action === 'install') {
          if (state.phase !== 'downloaded') throw new Error('请先完成更新下载');
          if (releaseVersion(state.version)?.[0] !== releaseVersion(version)?.[0]) throw new Error('此版本涉及兼容性变化，请完整备份后从下载页手动安装');
          await prepareInstall();
          update({ phase: 'installing', message: '' });
          await stopBackend();
          updater.quitAndInstall(false, true);
        } else throw new Error('未知更新操作');
      } catch (error) {
        // 安装受阻仍保留已下载包；下载／安装错误不冒充已完成。
        if (action === 'install') {
          update({ phase: 'downloaded', message: error.message || '安装未完成' });
          await resumeBackend();
        } else fail(error);
        throw error;
      } finally { pending = false; }
      return { ...state };
    },
  };
}
