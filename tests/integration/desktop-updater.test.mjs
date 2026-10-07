import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { bundleDesktopUpdater } from '../../scripts/build-desktop.mjs';
import { createDesktopUpdater } from '../../desktop/app-updater.mjs';

test('实际捆绑更新器读取本地发行元数据、校验下载，篡改安装包被拒绝', { timeout: 20_000 }, async () => {
  const root = createWorkspace('desktop-updater-');
  const bytes = Buffer.from('synthetic-installer-not-executable');
  let corrupt = false;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) return res.end(`version: 1.1.0\nfiles:\n  - url: synthetic.exe\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\n    size: ${bytes.length}\n`);
    res.setHeader('Content-Length', bytes.length);
    res.end(corrupt ? Buffer.alloc(bytes.length) : bytes);
  });
  try {
    const packages = await bundleDesktopUpdater(root);
    assert.ok(packages.some(directory => directory.endsWith('electron-updater')));
    assert.ok((await readdir(join(root, 'desktop/updater-licenses'))).includes('electron-updater'));
    const require = createRequire(import.meta.url);
    const { NsisUpdater } = require(join(root, 'desktop/updater.cjs'));
    const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor.js');
    const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor.js');
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    await writeFile(join(root, 'unused.yml'), 'updaterCacheDirName: synthetic-updater\n');
    const make = suffix => {
      const updater = new NsisUpdater(undefined, {
        version: '1.0.0', name: 'synthetic', isPackaged: true, appUpdateConfigPath: join(root, 'unused.yml'),
        userDataPath: join(root, suffix), baseCachePath: join(root, suffix), whenReady: async () => {},
      });
      updater.httpExecutor = new NodeHttpExecutor(); updater.logger = null;
      // 使用真实下载／校验实现，仅将 Electron 网络传输替换为 Node 的本地 HTTP。
      updater.httpExecutor.download = ElectronHttpExecutor.prototype.download;
      updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}` });
      const service = createDesktopUpdater({ updater, version: '1.0.0', publish: () => {}, prepareInstall: async () => {}, stopBackend: async () => {}, resumeBackend: async () => {}, savePreference: async () => {}, openReleasePage: async () => {} });
      return { updater, service };
    };
    const valid = make('valid');
    await valid.service.action('check');
    assert.equal(valid.service.status().phase, 'available');
    assert.equal(valid.updater.installerPath, null, '检查不自动下载');
    await valid.service.action('download');
    assert.equal(valid.service.status().phase, 'downloaded');
    assert.deepEqual(await readFile(valid.updater.installerPath), bytes);
    corrupt = true;
    const invalid = make('invalid');
    await invalid.service.action('check');
    await assert.rejects(invalid.service.action('download'), /checksum|sha512/i);
    assert.equal(invalid.service.status().phase, 'error');
    assert.equal(invalid.updater.autoInstallOnAppQuit, false);
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done)); removeWorkspace(root);
  }
});
