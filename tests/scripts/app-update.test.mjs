import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { latestPublishedRelease, compareReleaseVersions, fetchPublishedRelease, RELEASE_PAGE, RELEASE_REPOSITORY } from '../../services/appReleases.mjs';
import { createDesktopUpdater } from '../../desktop/app-updater.mjs';

const release = (version, patch = {}) => ({ tag_name: `v${version}`, html_url: `${RELEASE_PAGE}/tag/v${version}`, assets: [{ name: `NAI-Atelier-Setup-${version}-x64.exe`, browser_download_url: `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/NAI-Atelier-Setup-${version}-x64.exe` }], ...patch });
test('发行选择按版本排序，排除草稿、无安装包、错误来源，并区分预发布渠道', () => {
  const releases = [release('1.2.0'), release('1.10.0', { prerelease: true }), release('9.0.0', { draft: true }), release('8.0.0', { assets: [] }), release('7.0.0', { html_url: 'https://evil.test' }), release('invalid')];
  assert.equal(latestPublishedRelease(releases).tag_name, 'v1.10.0');
  assert.equal(latestPublishedRelease(releases, false).tag_name, 'v1.2.0');
  assert.equal(latestPublishedRelease([]), null);
  assert.equal(compareReleaseVersions('1.10.0', '1.9.99'), 1);
  assert.throws(() => compareReleaseVersions('1.0', '1.0.0'), /无效/);
});
test('检查网络失败明确报错，不当作没有更新', async () => {
  await assert.rejects(fetchPublishedRelease(true, async () => ({ ok: false, status: 503 })), /503/);
});

const fixture = (options = {}) => {
  const order = [], states = [], updater = new EventEmitter();
  updater.checkForUpdates = async () => { order.push('check'); updater.emit('update-available', { version: '1.2.0', releaseNotes: '更新说明' }); };
  updater.downloadUpdate = async () => { order.push('download'); updater.emit('download-progress', { percent: 53.6 }); updater.emit('update-downloaded', { version: '1.2.0' }); };
  updater.quitAndInstall = () => order.push('install');
  const service = createDesktopUpdater({ updater, version: '1.1.0', savePreference: async () => order.push('preference'), publish: state => states.push(state), prepareInstall: async () => order.push('prepare'), stopBackend: async () => order.push('stop'), resumeBackend: async () => order.push('resume'), openReleasePage: async () => order.push('open'), ...options });
  return { service, updater, order, states };
};
test('只自动检查，显式下载后先检查任务并停服，再安装；进度和说明真实反馈', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false); assert.equal(f.updater.disableWebInstaller, true);
  await f.service.action('check'); assert.deepEqual(f.order, ['check']);
  await f.service.action('download'); assert.equal(f.service.status().phase, 'downloaded');
  assert.ok(f.states.some(state => state.progress === 54));
  assert.equal(f.service.status().releaseNotes, '更新说明');
  await f.service.action('install'); assert.deepEqual(f.order, ['check', 'download', 'prepare', 'stop', 'install']);
});
test('进行中的任务和跨主要版本阻止安装，保留下载包，正常退出也不会自动安装', async () => {
  const f = fixture({ prepareInstall: async () => { throw new Error('生成仍在进行'); } });
  await f.service.action('check'); await f.service.action('download');
  await assert.rejects(f.service.action('install'), /仍在进行/);
  assert.equal(f.service.status().phase, 'downloaded'); assert.equal(f.order.includes('install'), false);
  f.updater.emit('update-available', { version: '2.0.0' });
  f.updater.emit('update-downloaded', { version: '2.0.0' });
  await assert.rejects(f.service.action('install'), /完整备份/);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
});
test('渠道变更持久化且不降级，重复下载与失败不会发起安装', async () => {
  const f = fixture();
  await f.service.action('channel', false); assert.equal(f.service.status().allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
  await f.service.action('check');
  let finish;
  f.updater.downloadUpdate = () => new Promise(done => { finish = done; });
  const running = f.service.action('download');
  await assert.rejects(f.service.action('download'), /正在进行/);
  await assert.rejects(f.service.action('install'), /正在进行/);
  finish(); await running;
  f.updater.emit('error', new Error('校验失败'));
  assert.equal(f.service.status().phase, 'error'); assert.equal(f.order.includes('install'), false);
});

test('安装器启动报错恢复工坊，保留已校验的安装包供重试', async () => {
  const f = fixture();
  await f.service.action('check'); await f.service.action('download'); await f.service.action('install');
  f.updater.emit('error', new Error('无法启动安装器'));
  await new Promise(done => setImmediate(done));
  assert.equal(f.service.status().phase, 'downloaded');
  assert.match(f.service.status().message, /无法启动/);
  assert.equal(f.order.at(-1), 'resume');
});
