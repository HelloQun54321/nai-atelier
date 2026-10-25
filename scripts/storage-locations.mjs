import { createReadStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const execute = promisify(execFile);
const markerName = 'atelier-storage-workspace.json';
const marker = { app: 'nai-atelier', version: 1 };
const inside = (root, path) => { const distance = relative(root, path); return !distance || !distance.startsWith('..') && !isAbsolute(distance); };
const readJson = async (path, missing) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return missing; throw new Error('存储配置损坏，请保留文件并检查目录'); } };
export async function writeStorageJson(path, value, { signal } = {}) {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    signal?.throwIfAborted();
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
export const storageControlFile = anchor => join(anchor, '.atelier-storage.json');
export const storageProgressFile = anchor => join(anchor, '.atelier-storage-progress.json');
export async function assertStorageNotSwitching(anchor) {
  try { await access(join(anchor, '.atelier-storage-switch.lock')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('工坊存储正在切换，请等待复制与核验完成后再打开');
}
export async function resolveStorageDataRoot(anchor, fallback) {
  const value = await readJson(storageControlFile(anchor), {});
  if (value.dataDir && !isAbsolute(value.dataDir)) throw new Error('工坊数据位置配置不是绝对路径');
  if (!value.dataDir) return resolve(fallback);
  const data = resolve(value.dataDir);
  try {
    if (!(await lstat(data)).isDirectory()) throw new Error('不是文件夹');
    const source = await readJson(join(data, markerName), null), desktop = await readJson(join(data, 'workspace', markerName), null);
    const workspace = source?.app === marker.app ? data : desktop?.app === marker.app ? join(data, 'workspace') : null;
    if (!workspace) throw new Error('工坊标记缺失');
    await access(join(workspace, 'wrangler.toml'));
    return data;
  } catch { throw new Error('所选工坊数据目录不可用，请恢复原目录或磁盘连接后再打开；未创建空库'); }
}
export const getStoragePreferences = async (workspace = process.cwd()) => readJson(join(workspace, 'local-data', 'storage-preferences.json'), {});
let preferenceWrite = Promise.resolve();
export function updateStoragePreferences(patch, workspace = process.cwd(), { signal } = {}) {
  const operation = preferenceWrite.then(async () => {
    signal?.throwIfAborted();
    const next = { ...await getStoragePreferences(workspace), ...patch };
    await writeStorageJson(join(workspace, 'local-data', 'storage-preferences.json'), next, { signal });
    return next;
  });
  preferenceWrite = operation.catch(() => {});
  return operation;
}
export async function getDefaultExportDirectory(workspace = process.cwd()) {
  const preferences = await getStoragePreferences(workspace);
  return preferences.exportMode === 'directory' && isAbsolute(preferences.exportDir || '') ? preferences.exportDir : '';
}
export const storageResourcePaths = (workspace, cacheDir = '', unified = false) => ({
  thumbnails: join(cacheDir || join(workspace, 'local-cache'), 'thumbnails'),
  danbooru: join(cacheDir || join(workspace, 'local-cache'), 'danbooru-queries'),
  models: join(cacheDir || join(workspace, 'local-cache'), 'models'),
  artistSamples: join(cacheDir || join(workspace, 'local-cache'), 'artist-samples'),
  artistReference: join(cacheDir || join(workspace, 'local-cache'), 'artist-reference'),
  tagData: cacheDir || unified ? join(cacheDir || join(workspace, 'local-cache'), 'tag-data') : join(workspace, 'public', 'tag-data'),
});
export async function storageLocationStatus({ anchor, dataDir, workspace, mode, canManage }) {
  const preferences = await getStoragePreferences(workspace);
  const cacheDir = preferences.cacheDir || '';
  return { available: process.platform === 'win32', mode, canManage, dataDir, workspaceDir: workspace,
    cacheDir: cacheDir || join(workspace, 'local-cache'), cacheFollowsData: !cacheDir,
    resourcePaths: storageResourcePaths(workspace, cacheDir, preferences.resourceLayout === 'unified'), state: await readJson(storageProgressFile(anchor), { phase: 'idle' }) };
}

let pickingDirectory = false;
export async function pickStorageDirectory(initialPath = '', run = execute) {
  if (process.platform !== 'win32') throw new Error('系统目录选择当前仅支持 Windows');
  if (pickingDirectory) throw new Error('已有文件夹选择窗口，请先完成或取消选择');
  pickingDirectory = true;
  // 隐藏的是 PowerShell 控制台；透明置顶 owner 让系统对话框保持可见、可操作。
  const script = "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; $owner.Opacity=0; $owner.ShowInTaskbar=$false; $owner.StartPosition='CenterScreen'; $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description='NAI Atelier'; $picker.SelectedPath=$env:NAI_PICK_INITIAL; try { $owner.Show(); $owner.Activate(); if($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::WriteLine($picker.SelectedPath)} } finally { $picker.Dispose(); $owner.Dispose() }";
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 300_000, env: { ...process.env, NAI_PICK_INITIAL: initialPath }, encoding: 'utf8' });
    const path = stdout.trim();
    if (path && !isAbsolute(path)) throw new Error('请选择普通文件系统目录');
    return { path, cancelled: !path };
  } catch (error) {
    if (error.killed) throw new Error('文件夹选择等待超时，请重新选择文件夹');
    throw error;
  } finally { pickingDirectory = false; }
}

/** 安装版由 Electron 主窗口拥有选择器，后台只等待对应请求回执。 */
export function requestDesktopStorageDirectory(channel = process, initialPath = '', timeout = 300_000) {
  if (!channel.connected) return Promise.reject(new Error('桌面应用连接中断，请重新打开工坊'));
  return new Promise((done, reject) => {
    const requestId = randomUUID();
    const finish = (error, result) => { clearTimeout(timer); channel.off('message', receive); channel.off('disconnect', disconnected); error ? reject(error) : done(result); };
    const receive = message => { if (message?.type === 'atelier-directory-result' && message.requestId === requestId) finish(message.error ? new Error(message.error) : null, message.result); };
    const disconnected = () => finish(new Error('桌面应用连接中断，请重新选择文件夹'));
    const timer = setTimeout(() => finish(new Error('文件夹选择等待超时，请重新选择文件夹')), timeout);
    channel.on('message', receive); channel.once('disconnect', disconnected);
    try { channel.send({ type: 'atelier-directory-pick', requestId, initialPath }); } catch (error) { finish(error); }
  });
}

async function canonical(path) {
  if (!isAbsolute(path || '')) throw new Error('请选择绝对文件夹路径');
  const target = resolve(path);
  let parent = target;
  while (true) {
    try { return resolve(await realpath(parent), relative(parent, target)); }
    catch (error) { if (error.code !== 'ENOENT' || dirname(parent) === parent) throw error; parent = dirname(parent); }
  }
}
async function files(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const result = [];
  for (const entry of entries) {
    const name = join(prefix, entry.name), info = await lstat(join(root, name));
    if (info.isSymbolicLink()) throw new Error('迁移目录包含链接，请先使用普通文件目录');
    if (info.isDirectory()) result.push(...await files(root, name));
    else if (info.isFile()) result.push({ name, size: info.size });
    else throw new Error('迁移目录含不支持的文件类型');
  }
  return result;
}
async function hash(path) {
  const digest = createHash('sha256'), stream = createReadStream(path);
  for await (const chunk of stream) digest.update(chunk);
  if (!stream.closed) await once(stream, 'close');
  return digest.digest('hex');
}
async function requireEmpty(path) {
  const entries = await readdir(path).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (entries.length) throw new Error('目标目录已有内容，迁移不会覆盖；请使用空目录或选择打开另一工坊');
}
async function renameDirectory(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      // Windows 杀毒扫描可能短暂持有刚核验的文件；有界等待后仍失败就保留原入口。
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 4) throw error;
      await new Promise(done => setTimeout(done, 100));
    }
  }
}
export async function validateStorageSwitch(job) {
  if (!['data', 'cache'].includes(job.kind) || !['migrate', 'open'].includes(job.operation)) throw new Error('未知存储操作');
  const source = await canonical(job.source), target = await canonical(job.target);
  if (inside(source, target) || inside(target, source)) throw new Error('新旧目录不能相同或互相包含');
  if (job.mode === 'desktop') {
    for (const root of [job.runtime, job.installRoot].filter(Boolean)) if (inside(await canonical(root), target)) throw new Error('数据目录不能位于程序安装目录');
  }
  if (job.kind === 'cache' && (inside(join(job.workspace, 'local-data'), target) || inside(target, join(job.workspace, 'local-data')))) throw new Error('缓存目录不能包含私人数据目录');
  if (job.operation === 'migrate') {
    if (!(job.kind === 'cache' && job.followData && target === await canonical(join(job.workspace, 'local-cache')))) await requireEmpty(target);
  } else {
    const workspace = job.mode === 'desktop' ? join(target, 'workspace') : target;
    const known = await readJson(join(workspace, markerName), null);
    const desktop = await readJson(join(workspace, 'desktop-workspace.json'), null);
    const sourcePackage = job.mode === 'source' ? await readJson(join(workspace, 'package.json'), null) : null;
    const entries = await readdir(target).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (!entries.length || (known?.app !== marker.app && desktop?.appId !== 'com.naiatelier.desktop' && sourcePackage?.name !== 'nai-atelier')) throw new Error('目标不是已识别的已有工坊，请选择已有工坊目录；迁移现有工坊可使用新目录');
    const config = await readFile(join(workspace, 'wrangler.toml'), 'utf8');
    if (config !== await readFile(join(job.workspace, 'wrangler.toml'), 'utf8')) throw new Error('目标工坊存储配置不匹配，不能切换');
  }
  return { source, target };
}

// 复制与核验完成之前不改入口；失败留下独立暂存目录，旧工坊始终保留。
export async function executeStorageSwitch(job, { progress = async () => {}, copy = copyFile } = {}) {
  const { source, target } = await validateStorageSwitch(job);
  const stage = `${target}.atelier-copy-${randomUUID()}`;
  if (job.operation === 'migrate') {
    await mkdir(dirname(stage), { recursive: true });
    await mkdir(stage, { recursive: false });
    const mappings = job.kind === 'cache' ? Object.entries(storageResourcePaths(job.workspace, job.currentCacheDir || '', job.currentResourceLayout === 'unified')).map(([key, from]) => ({ from, to: key === 'tagData' ? 'tag-data' : key === 'danbooru' ? 'danbooru-queries' : key === 'artistSamples' ? 'artist-samples' : key === 'artistReference' ? 'artist-reference' : key }))
      : job.mode === 'desktop' ? ['workspace', 'browser', 'language-preferences.json', 'update-preferences.json', 'logs'].map(name => ({ from: join(source, name), to: name }))
      : ['local-data', 'local-cache', 'public/tag-data', 'wrangler.toml'].map(name => ({ from: join(source, name), to: name }));
    const manifest = [];
    for (const mapping of mappings) {
      const info = await lstat(mapping.from).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) continue;
      if (info.isSymbolicLink()) throw new Error('迁移来源不能是链接');
      const list = info.isDirectory() ? await files(mapping.from) : [{ name: '', size: info.size }];
      for (const entry of list) manifest.push({ from: entry.name ? join(mapping.from, entry.name) : mapping.from, to: join(stage, mapping.to, entry.name), size: entry.size });
    }
    const totalBytes = manifest.reduce((sum, file) => sum + file.size, 0); let copiedBytes = 0;
    for (const file of manifest) {
      await mkdir(dirname(file.to), { recursive: true });
      await copy(file.from, file.to);
      if (await hash(file.from) !== await hash(file.to)) throw new Error('迁移文件核验失败，原工坊入口未改变');
      copiedBytes += file.size;
      await progress({ phase: 'verifying', copiedBytes, totalBytes });
    }
    if (job.kind === 'cache' && job.followData) {
      // 恢复默认位置时保留旧默认缓存目录，不能将新资源覆盖到旧文件上。
      const preserved = `${target}.atelier-preserved-${randomUUID()}`;
      let moved = false;
      try { await renameDirectory(target, preserved); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await renameDirectory(stage, target); }
      catch (error) { if (moved) await renameDirectory(preserved, target); throw error; }
    } else {
      await requireEmpty(target);
      await rmdir(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await renameDirectory(stage, target);
    }
  } else await mkdir(target, { recursive: true });
  const workspace = job.kind === 'cache' ? job.workspace : job.mode === 'desktop' ? join(target, 'workspace') : target;
  if (job.kind === 'data') {
    await mkdir(workspace, { recursive: true });
    // 目标工坊继续使用已核验的存储配置，不改 D1/R2 存储键。
    try { await access(join(workspace, 'wrangler.toml')); } catch { await copyFile(join(job.workspace, 'wrangler.toml'), join(workspace, 'wrangler.toml')); }
    await writeStorageJson(join(workspace, markerName), marker);
    await progress({ phase: 'switching' });
    await writeStorageJson(storageControlFile(job.anchor), { dataDir: target });
  } else {
    await progress({ phase: 'switching' });
    await updateStoragePreferences({ cacheDir: job.followData ? '' : target, resourceLayout: 'unified' }, job.workspace);
  }
  return { dataDir: job.kind === 'data' ? target : job.source, workspaceDir: workspace };
}

export async function launchStorageSwitch(job, nodeExecutable = process.execPath, workerScript = fileURLToPath(import.meta.url), write = writeStorageJson) {
  await validateStorageSwitch(job);
  const lock = join(job.anchor, '.atelier-storage-switch.lock');
  await mkdir(job.anchor, { recursive: true });
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('已有存储切换正在进行，请等待完成'); throw error; }
  const path = join(job.anchor, `.atelier-storage-job-${randomUUID()}.json`);
  try {
    await write(path, job);
    await write(storageProgressFile(job.anchor), { phase: 'waiting_stop' });
    const child = spawn(nodeExecutable, [workerScript, '--run-job', path], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    child.unref();
  } catch (error) { await unlink(path).catch(() => {}); await rmdir(lock); throw error; }
  return { phase: 'waiting_stop', restartRequired: true };
}
const running = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (process.argv[2] === '--run-job') {
  const job = await readJson(process.argv[3]);
  const progress = state => writeStorageJson(storageProgressFile(job.anchor), state);
  try {
    const deadline = Date.now() + 45_000;
    while ((job.waitPids || []).some(running)) {
      if (Date.now() > deadline) throw new Error('工坊未完全停止，原入口未改变');
      await new Promise(done => setTimeout(done, 250));
    }
    await progress({ phase: 'copying' });
    await executeStorageSwitch(job, { progress });
    await progress({ phase: 'idle' }).catch(() => {});
  } catch (error) { await progress({ phase: 'failed', error: error.message }).catch(() => {}); }
  finally {
    await unlink(process.argv[3]).catch(() => {});
    await rmdir(join(job.anchor, '.atelier-storage-switch.lock')).catch(() => {});
  }
  const environment = { ...job.restart.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(job.restart.command, job.restart.args || [], { cwd: job.restart.cwd, env: environment, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
}
