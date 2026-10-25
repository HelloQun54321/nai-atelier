import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, symlink, rmdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { executeStorageSwitch, validateStorageSwitch, resolveStorageDataRoot, storageControlFile, getStoragePreferences, updateStoragePreferences, storageResourcePaths, launchStorageSwitch, pickStorageDirectory, requestDesktopStorageDirectory } from '../../scripts/storage-locations.mjs';

test('源码目录选择等待真实回执，取消不返回路径，超时明确报错并释放并发锁', { skip: process.platform !== 'win32' }, async () => {
  let finish, settled = false;
  const pending = pickStorageDirectory('C:\\合成', async (_command, args, options) => {
    assert.match(args.at(-1), /TopMost=\$true/); assert.match(args.at(-1), /ShowDialog\(\$owner\)/);
    assert.match(args.at(-1), /DialogResult\]::OK/); assert.match(args.at(-1), /finally.*Dispose/);
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 300_000);
    assert.equal(options.env.NAI_PICK_INITIAL, 'C:\\合成');
    return new Promise(done => { finish = done; });
  }).then(result => { settled = true; return result; });
  await Promise.resolve(); assert.equal(settled, false);
  await assert.rejects(pickStorageDirectory('', async () => { throw new Error('不应启动第二个选择器'); }), /已有文件夹/);
  finish({ stdout: '' }); assert.deepEqual(await pending, { path: '', cancelled: true });
  await assert.rejects(pickStorageDirectory('', async () => { throw Object.assign(new Error('timeout'), { killed: true }); }), /等待超时/);
  assert.deepEqual(await pickStorageDirectory('', async () => ({ stdout: 'C:\\合成\n' })), { path: 'C:\\合成', cancelled: false });
});

test('安装版选择请求只接受对应IPC回执，取消与失败清理监听器', async () => {
  const channel = new EventEmitter(); channel.connected = true;
  let request;
  channel.send = message => { request = message; };
  const pending = requestDesktopStorageDirectory(channel, 'C:\\合成');
  assert.equal(request.type, 'atelier-directory-pick'); assert.equal(request.initialPath, 'C:\\合成');
  channel.emit('message', { type: 'atelier-directory-result', requestId: 'other', result: { path: 'wrong' } });
  channel.emit('message', { type: 'atelier-directory-result', requestId: request.requestId, result: { path: '', cancelled: true } });
  assert.deepEqual(await pending, { path: '', cancelled: true }); assert.equal(channel.listenerCount('message'), 0);
  const failed = requestDesktopStorageDirectory(channel);
  channel.emit('message', { type: 'atelier-directory-result', requestId: request.requestId, error: 'synthetic error' });
  await assert.rejects(failed, /synthetic error/);
  await assert.rejects(requestDesktopStorageDirectory(channel, '', 1), /等待超时/);
  assert.equal(channel.listenerCount('message'), 0); assert.equal(channel.listenerCount('disconnect'), 0);
});

test('Windows 目录选择输出保留 Unicode，不打开真实文件夹选择器', { skip: process.platform !== 'win32' }, async () => {
  const path = await pickStorageDirectory('', async (command, args, options) => {
    const prefix = args.at(-1).split(';')[0];
    assert.match(prefix, /OutputEncoding.*UTF8Encoding/);
    return promisify(execFile)(command, ['-NoProfile', '-Command', `${prefix}; Write-Output ('C:\\' + [char]0x4E2D + [char]0x6587 + [char]0x65E5)`], options);
  });
  assert.deepEqual(path, { path: 'C:\\中文日', cancelled: false });
});

const config = 'database_name="nai-db"\ndatabase_id="synthetic-stable-key"\nbucket_name="nai-assets"\n';
async function fixture(mode = 'source') {
  const root = createWorkspace('storage-locations-'), source = join(root, 'original'), target = join(root, 'new'), anchor = join(root, 'anchor');
  const workspace = mode === 'desktop' ? join(source, 'workspace') : source;
  for (const directory of ['local-data/v3/d1', 'local-data/v3/r2', 'local-cache/models', 'public/tag-data']) await mkdir(join(workspace, directory), { recursive: true });
  for (const [name, value] of Object.entries({ 'local-data/v3/d1/database.sqlite': 'synthetic-db', 'local-data/v3/r2/image.bin': 'synthetic-original', 'local-data/prompt-agent-sessions/chat.json': 'synthetic-conversation', 'local-cache/models/model.onnx': 'synthetic-model', 'local-cache/artist-samples/packs/artist_thumbnail_nai': 'synthetic-artist-pack', 'local-cache/artist-samples/packs/NAID5-33000-55000-Curated.download': 'synthetic-partial-pack', 'local-cache/artist-samples/v45-index.json': 'synthetic-index', 'public/tag-data/manifest.json': 'synthetic-tags', 'wrangler.toml': config })) {
    await mkdir(join(workspace, name, '..'), { recursive: true }); await writeFile(join(workspace, name), value);
  }
  if (mode === 'desktop') {
    await mkdir(join(source, 'browser'), { recursive: true });
    await writeFile(join(source, 'browser', 'Preferences'), 'synthetic-draft');
    await writeFile(join(source, 'language-preferences.json'), 'synthetic-language');
    await writeFile(join(source, 'update-preferences.json'), 'synthetic-update-channel');
  }
  return { root, job: { kind: 'data', operation: 'migrate', mode, source, target, workspace, anchor } };
}
for (const mode of ['source', 'desktop']) test(`${mode} 复制核验后切入口，保留原件、存储键、完整助手会话与默认资源`, async () => {
  const { root, job } = await fixture(mode);
  try {
    const states = []; const result = await executeStorageSwitch(job, { progress: async state => states.push(state) });
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.target);
    for (const name of ['local-data/v3/d1/database.sqlite', 'local-data/v3/r2/image.bin', 'local-data/prompt-agent-sessions/chat.json', 'local-cache/models/model.onnx', 'local-cache/artist-samples/packs/artist_thumbnail_nai', 'local-cache/artist-samples/packs/NAID5-33000-55000-Curated.download', 'public/tag-data/manifest.json', 'wrangler.toml']) assert.equal(await readFile(join(job.workspace, name), 'utf8'), await readFile(join(result.workspaceDir, name), 'utf8'));
    assert.equal(await readFile(join(result.workspaceDir, 'wrangler.toml'), 'utf8'), config);
    assert.equal(states.at(-1).phase, 'switching');
    if (mode === 'desktop') for (const name of ['browser/Preferences', 'language-preferences.json', 'update-preferences.json']) assert.equal(await readFile(join(job.source, name), 'utf8'), await readFile(join(job.target, name), 'utf8'));
  } finally { removeWorkspace(root); }
});
test('复制错误或哈希不匹配不切入口，原目录保留，暂存失败资料不覆盖目标', async () => {
  const { root, job } = await fixture();
  try {
    await assert.rejects(executeStorageSwitch(job, { copy: async () => { throw new Error('synthetic copy failure'); } }), /copy failure/);
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.source);
    await assert.rejects(executeStorageSwitch(job, { copy: async (_from, to) => writeFile(to, 'wrong') }), /核验失败/);
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.source);
    assert.equal(await readFile(join(job.workspace, 'local-data/v3/r2/image.bin'), 'utf8'), 'synthetic-original');
  } finally { removeWorkspace(root); }
});
test('拒绝覆盖、嵌套路径、私人数据缓存位置与链接，不修改入口', async () => {
  const { root, job } = await fixture();
  try {
    await mkdir(job.target); await writeFile(join(job.target, 'existing.txt'), 'preserve');
    await assert.rejects(validateStorageSwitch(job), /已有内容/);
    await assert.rejects(validateStorageSwitch({ ...job, target: join(job.source, 'child') }), /互相包含/);
    await assert.rejects(validateStorageSwitch({ ...job, target: root }), /互相包含/);
    await assert.rejects(validateStorageSwitch({ ...job, kind: 'cache', source: join(job.workspace, 'local-cache'), target: join(job.workspace, 'local-data', 'cache') }), /私人数据/);
    await symlink(job.source, join(root, 'link'), 'junction');
    await assert.rejects(validateStorageSwitch({ ...job, target: join(root, 'link', 'child') }), /互相包含/);
    assert.equal(await readFile(join(job.target, 'existing.txt'), 'utf8'), 'preserve');
  } finally { removeWorkspace(root); }
});
test('安装目录整个边界受保护，runtime旁的个人资料文件夹同样不能作为事实源', async () => {
  const { root, job } = await fixture('desktop');
  try {
    const installRoot = join(root, 'installation'), runtime = join(installRoot, 'resources/runtime');
    await mkdir(runtime, { recursive: true });
    await assert.rejects(validateStorageSwitch({ ...job, runtime, installRoot, target: join(installRoot, '个人资料') }), /程序安装目录/);
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.source);
  } finally { removeWorkspace(root); }
});
test('打开已有工坊只切指针，拒绝未知及存储键不匹配', async () => {
  const { root, job } = await fixture();
  try {
    await mkdir(job.target);
    await writeFile(join(job.target, 'atelier-storage-workspace.json'), JSON.stringify({ app: 'nai-atelier', version: 1 }));
    await writeFile(join(job.target, 'wrangler.toml'), config);
    await executeStorageSwitch({ ...job, operation: 'open' });
    assert.equal(await readFile(join(job.target, 'wrangler.toml'), 'utf8'), config);
    assert.ok(!(await readdir(job.target)).includes('local-data'));
    await writeFile(join(job.target, 'wrangler.toml'), 'different-key');
    await assert.rejects(validateStorageSwitch({ ...job, operation: 'open' }), /不匹配/);
    assert.equal(await readFile(join(job.workspace, 'local-data/v3/d1/database.sqlite'), 'utf8'), 'synthetic-db');
  } finally { removeWorkspace(root); }
});
test('打开空目录或不存在目录不改变旧指针，也不建立目标工坊', async () => {
  const { root, job } = await fixture();
  try {
    await mkdir(job.anchor);
    await writeFile(storageControlFile(job.anchor), JSON.stringify({ dataDir: job.source }));
    const pointer = await readFile(storageControlFile(job.anchor), 'utf8');
    await assert.rejects(executeStorageSwitch({ ...job, operation: 'open' }), /已有工坊/);
    await assert.rejects(access(job.target), /ENOENT/);
    await mkdir(job.target);
    await assert.rejects(executeStorageSwitch({ ...job, operation: 'open' }), /已有工坊/);
    assert.deepEqual(await readdir(job.target), []);
    assert.equal(await readFile(storageControlFile(job.anchor), 'utf8'), pointer);
  } finally { removeWorkspace(root); }
});
test('源码启动先切数据根再加载启动器与备份链，备份默认目录不会停留在原工坊', async () => {
  const { root, job } = await fixture();
  try {
    await writeFile(join(job.workspace, 'package.json'), JSON.stringify({ name: 'nai-atelier' }));
    await executeStorageSwitch({ ...job, anchor: job.source });
    const entry = new URL('../../scripts/local-server.mjs', import.meta.url);
    const source = await readFile(entry, 'utf8');
    const bootstrap = source.slice(0, source.indexOf('const GATEWAY_PORT')).replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${new URL(relative, entry).href}'`);
    assert.doesNotMatch(bootstrap, /from .*desktop-launcher/);
    const program = bootstrap + `\nawait import(${JSON.stringify(new URL('../../scripts/desktop-launcher.mjs', import.meta.url).href)}); const { localBackupService, DEFAULT_BACKUP_CONFIG_FILE } = await import(${JSON.stringify(new URL('../../scripts/local-backup.mjs', import.meta.url).href)}); console.log(JSON.stringify({ source: localBackupService.sourceDir, config: DEFAULT_BACKUP_CONFIG_FILE }));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', program], { cwd: job.source, env: { ...process.env, NAI_PACKAGED: '', NAI_STORAGE_ANCHOR: '' }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(stdout), { source: join(job.target, 'local-data'), config: join(job.target, 'local-data', 'backup-config.json') });
  } finally { removeWorkspace(root); }
});
test('已选数据目录丢失或标记损坏时启动停止，不静默建立空工坊', async () => {
  const { root, job } = await fixture();
  try {
    await executeStorageSwitch(job);
    await writeFile(join(job.target, 'atelier-storage-workspace.json'), '{broken');
    await assert.rejects(resolveStorageDataRoot(job.anchor, job.source), /未创建空库/);
    await writeFile(storageControlFile(job.anchor), JSON.stringify({ dataDir: join(root, 'missing-disk') }));
    await assert.rejects(resolveStorageDataRoot(job.anchor, job.source), /未创建空库/);
    await assert.rejects(access(join(root, 'missing-disk')), /ENOENT/);
    assert.equal(await readFile(join(job.workspace, 'local-data/v3/r2/image.bin'), 'utf8'), 'synthetic-original');
  } finally { removeWorkspace(root); }
});
test('缓存单独迁移包含图包及续传副本，不带原图/会话/付费恢复，偏好与导出设置共存', async () => {
  const { root, job } = await fixture();
  try {
    await updateStoragePreferences({ exportDir: join(root, 'exports'), exportMode: 'directory' }, job.workspace);
    await executeStorageSwitch({ ...job, kind: 'cache', source: join(job.workspace, 'local-cache') });
    assert.equal(await readFile(join(job.target, 'models/model.onnx'), 'utf8'), 'synthetic-model');
    assert.equal(await readFile(join(job.target, 'tag-data/manifest.json'), 'utf8'), 'synthetic-tags');
    for (const name of ['packs/artist_thumbnail_nai', 'packs/NAID5-33000-55000-Curated.download', 'v45-index.json']) assert.equal(await readFile(join(job.target, 'artist-samples', name), 'utf8'), await readFile(join(job.workspace, 'local-cache/artist-samples', name), 'utf8'));
    assert.ok(!(await readdir(job.target)).includes('local-data'));
    assert.deepEqual(await getStoragePreferences(job.workspace), { exportDir: join(root, 'exports'), exportMode: 'directory', cacheDir: job.target, resourceLayout: 'unified' });
    assert.equal(storageResourcePaths(job.workspace).tagData, join(job.workspace, 'public', 'tag-data'));
    assert.equal(storageResourcePaths(job.workspace, job.target).tagData, join(job.target, 'tag-data'));
    assert.equal(storageResourcePaths(job.workspace, job.target).artistSamples, join(job.target, 'artist-samples'));
    assert.equal(storageResourcePaths(job.workspace, job.target).artistReference, join(job.target, 'artist-reference'));
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.source);
  } finally { removeWorkspace(root); }
});
test('并发切换锁与启动帮助进程失败均不改变原入口', async () => {
  const { root, job } = await fixture();
  try {
    await mkdir(join(job.anchor, '.atelier-storage-switch.lock'), { recursive: true });
    await assert.rejects(launchStorageSwitch(job), /正在进行/);
    const entry = spawn(process.execPath, [fileURLToPath(new URL('../../scripts/local-server.mjs', import.meta.url))], { cwd: job.anchor, env: { ...process.env, NAI_NO_BROWSER: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; entry.stderr.on('data', data => { output += data; });
    const code = await new Promise(done => entry.once('close', done));
    assert.notEqual(code, 0);
    assert.match(output, /存储正在切换/);
    assert.ok(!(await readdir(job.anchor)).includes('local-data'));
    assert.equal(await resolveStorageDataRoot(job.anchor, job.source), job.source);
    await assert.rejects(readFile(storageControlFile(job.anchor)), /ENOENT/);
    await rmdir(join(job.anchor, '.atelier-storage-switch.lock'));
    await assert.rejects(launchStorageSwitch(job, join(root, 'missing-node.exe')), /ENOENT/);
    await assert.rejects(access(join(job.anchor, '.atelier-storage-switch.lock')), /ENOENT/);
    for (const failAt of [1, 2]) {
      let writes = 0;
      const write = async () => { if (++writes === failAt) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); };
      await assert.rejects(launchStorageSwitch(job, process.execPath, undefined, write), /disk full/);
      await assert.rejects(access(join(job.anchor, '.atelier-storage-switch.lock')), /ENOENT/);
    }
  } finally { removeWorkspace(root); }
});
test('独立迁移进程等待旧进程退出再复制，完成后重启；失败重启原入口', async () => {
  for (const operation of ['success', 'conflict']) {
    const { root, job } = await fixture();
    let originalProcess;
    try {
      const receipt = join(root, 'restart.json'), restartScript = join(root, 'restart.mjs');
      await writeFile(restartScript, `import {writeFile} from 'node:fs/promises'; import {resolveStorageDataRoot} from ${JSON.stringify(new URL('../../scripts/storage-locations.mjs', import.meta.url).href)}; await writeFile(${JSON.stringify(receipt)},JSON.stringify({pid:process.pid,root:await resolveStorageDataRoot(${JSON.stringify(job.anchor)},${JSON.stringify(job.source)})}));`);
      originalProcess = spawn(process.execPath, ['-e', 'setTimeout(()=>{},700)'], { cwd: root, windowsHide: true, stdio: 'ignore' });
      const scheduled = { ...job, waitPids: [originalProcess.pid], restart: { command: process.execPath, args: [restartScript], cwd: root, env: { ...process.env } } };
      await launchStorageSwitch(scheduled);
      await assert.rejects(access(storageControlFile(job.anchor)), /ENOENT/);
      if (operation === 'conflict') { await mkdir(job.target); await writeFile(join(job.target, 'conflict.txt'), 'race-after-admission'); }
      const deadline = Date.now() + 10_000;
      while (true) {
        try { await access(receipt); break; } catch {}
        if (Date.now() > deadline) throw new Error('合成迁移没有完成并重启');
        await new Promise(done => setTimeout(done, 30));
      }
      const restarted = JSON.parse(await readFile(receipt));
      assert.equal(restarted.root, operation === 'success' ? job.target : job.source);
      while (true) {
        try { process.kill(restarted.pid, 0); } catch { break; }
        if (Date.now() > deadline) throw new Error('合成重启进程没有退出');
        await new Promise(done => setTimeout(done, 30));
      }
      assert.equal(await readFile(join(job.workspace, 'local-data/v3/r2/image.bin'), 'utf8'), 'synthetic-original');
      assert.ok(!(await readdir(job.anchor)).some(name => name.startsWith('.atelier-storage-job-')));
    } finally { originalProcess?.kill(); removeWorkspace(root); }
  }
});
test('恢复跟随工坊时保留旧默认缓存，带回新词库及模型，私人原件不动', async () => {
  const { root, job } = await fixture();
  try {
    const custom = join(root, 'resources');
    await executeStorageSwitch({ ...job, kind: 'cache', source: join(job.workspace, 'local-cache'), target: custom });
    await writeFile(join(custom, 'models/model.onnx'), 'updated-model');
    await executeStorageSwitch({ ...job, kind: 'cache', source: custom, target: join(job.workspace, 'local-cache'), currentCacheDir: custom, followData: true });
    assert.equal(await readFile(join(job.workspace, 'local-cache/models/model.onnx'), 'utf8'), 'updated-model');
    assert.equal(await readFile(join(job.workspace, 'local-cache/tag-data/manifest.json'), 'utf8'), 'synthetic-tags');
    assert.equal(await readFile(join(job.workspace, 'local-cache/artist-samples/packs/artist_thumbnail_nai'), 'utf8'), 'synthetic-artist-pack');
    assert.equal(await readFile(join(job.workspace, 'local-cache/artist-samples/packs/NAID5-33000-55000-Curated.download'), 'utf8'), 'synthetic-partial-pack');
    assert.equal((await getStoragePreferences(job.workspace)).cacheDir, '');
    assert.equal(await readFile(join(custom, 'models/model.onnx'), 'utf8'), 'updated-model');
    assert.equal(await readFile(join(job.workspace, 'local-data/v3/r2/image.bin'), 'utf8'), 'synthetic-original');
    assert.ok((await readdir(job.workspace)).some(name => name.startsWith('local-cache.atelier-preserved-')));
  } finally { removeWorkspace(root); }
});
