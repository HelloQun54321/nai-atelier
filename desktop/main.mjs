import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopServerOptions, findDesktopPorts, isDesktopNavigation, isExternalWebLink, prepareDesktopWorkspace, pickDesktopDirectory } from '../scripts/desktop-runtime.mjs';
import { createDesktopUpdater } from './app-updater.mjs';
import { LANGUAGES, normalizeLanguage, translate } from '../locales/index.mjs';
import { resolveStorageDataRoot, launchStorageSwitch, getStoragePreferences, assertStorageNotSwitching } from '../scripts/storage-locations.mjs';
import { exportWithPreferences } from '../scripts/export-locations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const startupFile = join(here, 'startup.html');
const startupUrl = pathToFileURL(startupFile).href;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve(here, '..', '.desktop-build', 'runtime');
const storageAnchor = process.env.NAI_DESKTOP_DATA_DIR || join(process.env.LOCALAPPDATA || app.getPath('appData'), 'NAI Atelier');
const selectedDataRoot = await (async () => { await assertStorageNotSwitching(storageAnchor); return resolveStorageDataRoot(storageAnchor, storageAnchor); })().catch(error => error);
const storageLaunchError = selectedDataRoot instanceof Error ? selectedDataRoot : null;
const dataRoot = storageLaunchError ? storageAnchor : selectedDataRoot;
app.setPath('userData', join(dataRoot, 'browser'));
app.setAppUserModelId('com.naiatelier.desktop');
// 下载由用户触发；关闭窗口仍进托盘，安装必须先结束本应用后台。
let window, tray, backend, log, workspace, appUrl = '', quitting = false, starting = false;
let updates;
let language = 'zh-CN';
let languageWrite = Promise.resolve();
const languageFile = join(dataRoot, 'language-preferences.json');
const t = (message, values) => translate(language, message, values);
let status = { phase: 'starting', message: '正在打开工坊…' };
const logFile = join(dataRoot, 'logs', 'desktop.log');
const selfTestFile = process.env.NAI_DESKTOP_SELF_TEST;
const localizedStatus = () => ({ ...status, message: t(status.message), language, labels: { retry: t('重新尝试'), logs: t('查看日志'), quit: t('退出') } });

const setStatus = (phase, message) => {
  status = { phase, message };
  if (window && !window.isDestroyed()) window.webContents.send('atelier-status', localizedStatus());
};
const showWindow = () => { window?.show(); window?.focus(); };
const quitApp = () => { quitting = true; app.quit(); };

function createWindow() {
  window = new BrowserWindow({
    width: 1400, height: 920, minWidth: 360, minHeight: 540,
    title: 'NAI Atelier', icon: join(runtimeRoot, 'public', 'nai-atelier.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, additionalArguments: [`--atelier-language=${language}`] },
    show: !selfTestFile,
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebLink(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url === startupUrl || isDesktopNavigation(url, appUrl)) return;
    event.preventDefault();
    if (isExternalWebLink(url)) void shell.openExternal(url);
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('atelier-status', localizedStatus());
    if (updates) window.webContents.send('atelier-update-status', updates.status());
  });
  window.on('close', event => {
    if (!quitting && !selfTestFile) { event.preventDefault(); window.hide(); tray?.setToolTip(t('NAI Atelier · 后台运行')); }
  });
  if (!selfTestFile) {
    tray = new Tray(join(runtimeRoot, 'public', 'nai-atelier.ico'));
    tray.setToolTip('NAI Atelier');
    tray.on('double-click', showWindow);
  }
  updateMenus();
  return window.loadFile(startupFile);
}

function updateMenus() {
  const roles = (items) => items.map(([role, label]) => ({ role, label: t(label) }));
  const dataItem = { label: t('打开数据目录'), click: () => void shell.openPath(workspace || dataRoot) };
  const quitItem = { label: t('退出工坊'), accelerator: 'Alt+F4', click: quitApp };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: t('工坊'), submenu: [dataItem, { label: t('查看启动日志'), click: () => void shell.openPath(logFile) }, { type: 'separator' }, quitItem] },
    { label: t('编辑'), submenu: roles([['undo', '撤销'], ['redo', '重做'], ['cut', '剪切'], ['copy', '复制'], ['paste', '粘贴'], ['selectAll', '全选']]) },
    { label: t('视图'), submenu: roles([['reload', '刷新'], ['resetZoom', '实际大小'], ['zoomIn', '放大'], ['zoomOut', '缩小'], ['togglefullscreen', '全屏']]) },
  ]));
  tray?.setContextMenu(Menu.buildFromTemplate([{ label: t('打开工坊'), click: showWindow }, dataItem, { type: 'separator' }, quitItem]));
  tray?.setToolTip(window?.isVisible() ? 'NAI Atelier' : t('NAI Atelier · 后台运行'));
}

async function startBackend() {
  if (starting || backend) return;
  starting = true;
  try {
    setStatus('starting', '正在打开工坊…');
    const installRoot = app.isPackaged ? dirname(process.execPath) : runtimeRoot;
    const prepared = await prepareDesktopWorkspace(runtimeRoot, dataRoot, installRoot);
    workspace = prepared.workspace;
    const ports = await findDesktopPorts({ preferred: Number(process.env.NAI_DESKTOP_PORT || 3000) });
    appUrl = `http://localhost:${ports.gateway}`;
    const spec = desktopServerOptions({ runtimeRoot, workspace, executable: process.execPath, ports, documents: app.getPath('documents'), downloads: app.getPath('downloads'), storageAnchor, dataRoot, installRoot });
    const child = spawn(spec.command, spec.args, spec.options);
    backend = child;
    child.on('message', message => {
      if (message?.type === 'atelier-artist-file-pick') {
        void dialog.showOpenDialog(window, { title: t('选择画师图包'), properties: ['openFile'], ...(message.initialPath ? { defaultPath: message.initialPath } : {}) }).then(result => {
          if (child.connected) child.send({ type: 'atelier-artist-file-result', requestId: message.requestId, result: { cancelled: result.canceled, path: result.filePaths[0] || '' } });
        }, error => {
          if (child.connected) child.send({ type: 'atelier-artist-file-result', requestId: message.requestId, error: error.message });
        });
        return;
      }
      if (message?.type === 'atelier-directory-pick') {
        void chooseDirectory(message.initialPath).then(result => {
          if (child.connected) child.send({ type: 'atelier-directory-result', requestId: message.requestId, result });
        }, error => {
          if (child.connected) child.send({ type: 'atelier-directory-result', requestId: message.requestId, error: error.message });
        });
        return;
      }
      if (message?.type !== 'atelier-storage-switch') return;
      void (async () => {
        if (updates && ['downloading', 'installing'].includes(updates.status().phase)) throw new Error('应用更新进行中，请稍后切换存储位置');
        await languageWrite;
        const preferences = await getStoragePreferences(workspace);
        await launchStorageSwitch({ ...message.request, anchor: storageAnchor, source: message.request.kind === 'data' ? dataRoot : preferences.cacheDir || join(workspace, 'local-cache'),
          workspace, mode: 'desktop', runtime: runtimeRoot, installRoot, currentCacheDir: preferences.cacheDir || '', currentResourceLayout: preferences.resourceLayout, waitPids: [process.pid, child.pid],
          restart: { command: process.execPath, args: app.isPackaged ? [] : process.argv.slice(1), cwd: dirname(process.execPath), env: { ...process.env } } }, join(runtimeRoot, 'node.exe'), join(runtimeRoot, 'scripts', 'storage-locations.mjs'));
        await stopForUpdate();
        await new Promise(done => log.end(done));
        app.quit();
      })().catch(error => {
        quitting = false;
        if (child.connected) child.send({ type: 'atelier-cancel-update' });
        dialog.showErrorBox(t('NAI Atelier 无法启动'), error.message);
      });
    });
    child.stdout.on('data', data => log.write(data));
    child.stderr.on('data', data => log.write(data));
    let failure;
    child.once('error', error => { failure = error; });
    child.once('exit', code => {
      if (backend === child) backend = null;
      if (!quitting && !starting) {
        setStatus('error', `工坊服务已停止（${code ?? '未知'}），可重新尝试或查看日志。`);
        void window.loadFile(startupFile);
      }
    });
    const deadline = Date.now() + 210_000;
    while (Date.now() < deadline) {
      if (quitting) return;
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error('服务启动失败，请查看启动日志');
      const identity = await fetch(`http://127.0.0.1:${ports.launcher}/__atelier/launcher`, { signal: AbortSignal.timeout(1200) }).then(response => response.json()).catch(() => null);
      if (identity?.phase === 'running' && identity.pid === child.pid && resolve(identity.projectDir) === workspace) {
        await window.loadURL(appUrl);
        setStatus('ready', '工坊已就绪');
        if (selfTestFile) {
          // 发布回归入口仅访问本次合成工作区，不生成或读取私人项目数据。
          const { writeFile } = await import('node:fs/promises');
          const renderDeadline = Date.now() + 60_000;
          let rendered = false;
          while (Date.now() < renderDeadline) {
            const styleSelector = `nav button[aria-label=${JSON.stringify(t('风格串'))}]`;
            const settingsSelector = `button[aria-label=${JSON.stringify(t('全局设置'))}]`;
            rendered = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(styleSelector)}) && document.querySelector(${JSON.stringify(settingsSelector)}))`);
            if (rendered) break;
            await new Promise(done => setTimeout(done, 250));
          }
          if (!rendered) throw new Error('发布验证失败：前端未正常渲染');
          // Windows 隐藏窗口可能保留旧绘制帧；短暂显示真实窗口后核对实际画面。
          window.showInactive();
          await new Promise(done => setTimeout(done, 500));
          await writeFile(`${selfTestFile}.png`, (await window.webContents.capturePage()).toPNG());
          await writeFile(selfTestFile, JSON.stringify({ version: app.getVersion(), url: window.webContents.getURL(), title: window.webContents.getTitle(), rendered, workspace, ports, node: await readFile(join(runtimeRoot, 'node-runtime.json'), 'utf8') }, null, 2));
          app.quit();
        }
        return;
      }
      await new Promise(done => setTimeout(done, 400));
    }
    throw new Error('启动等待超时，请查看日志并重新尝试');
  } catch (error) {
    if (backend?.connected) backend.send({ type: 'atelier-shutdown' });
    setStatus('error', error.message || '无法启动工坊');
    if (selfTestFile) { console.error(error.message); app.exit(1); }
    else await window.loadFile(startupFile);
  } finally { starting = false; }
}

ipcMain.handle('atelier-desktop', async (event, action) => {
  if (event.senderFrame?.url !== startupUrl) throw new Error('此操作只对启动窗口开放');
  if (action === 'status') return localizedStatus();
  if (action === 'retry') return startBackend();
  if (action === 'logs') return shell.openPath(logFile);
  if (action === 'quit') return quitApp();
  throw new Error('未知操作');
});

ipcMain.handle('atelier-language', async (event, value) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isDesktopNavigation(event.senderFrame.url, appUrl)) throw new Error('语言设置只允许本应用主窗口操作');
  if (!LANGUAGES.some(item => item.code === value)) throw new Error('不支持的语言');
  const operation = languageWrite.then(async () => {
    await writeFile(languageFile, JSON.stringify({ language: value }) + '\n');
    language = value;
    updateMenus();
  });
  languageWrite = operation.catch(() => {});
  return operation;
});

ipcMain.handle('atelier-update', async (event, action, value) => {
  if (!updates || event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isDesktopNavigation(event.senderFrame.url, appUrl)) throw new Error('更新只允许本应用主窗口操作');
  return updates.action(action, value);
});

let directoryPickerOpen = false;
async function chooseDirectory(initialPath = '') {
  if (directoryPickerOpen) throw new Error('已有文件夹选择窗口，请先完成或取消选择');
  directoryPickerOpen = true;
  try { return await pickDesktopDirectory(dialog, window, initialPath); }
  finally { directoryPickerOpen = false; }
}

ipcMain.handle('atelier-export', async (event, input) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isDesktopNavigation(event.senderFrame.url, appUrl)) throw new Error('文件导出只允许本应用主窗口操作');
  if (typeof input?.data !== 'string' || input.data.length > 180 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data) || input.data.length % 4 !== 0) throw new Error('导出文件无效或过大');
  return exportWithPreferences({ data: Buffer.from(input.data, 'base64'), filename: input.filename, workspace, pickDirectory: chooseDirectory, systemDirectory: app.getPath('downloads') });
});

// 画布导出使用独立目录偏好；仅保留选择结果，不改变全局导出设置。
const canvasExportPreferenceFile = join(dataRoot, 'canvas-export-preferences.json');
const canvasExportDirectories = readFile(canvasExportPreferenceFile, 'utf8').then(JSON.parse).catch(() => ({}));
let canvasExportPreferenceWrite = Promise.resolve();
const canvasExportTargets = new Map();
const checkCanvasExportSender = event => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isDesktopNavigation(event.senderFrame.url, appUrl)) throw new Error('画布导出只允许本应用主窗口操作');
};

ipcMain.handle('atelier-canvas-export-begin', async (event, kind, filename) => {
  checkCanvasExportSender(event);
  if (!['project', 'image'].includes(kind) || typeof filename !== 'string' || !filename || filename !== basename(filename)) throw new Error('画布导出文件名无效');
  const directories = await canvasExportDirectories;
  const extension = filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'png';
  const filters = kind === 'project' ? [{ name: '画布工程', extensions: ['nai-canvas'] }] : [{ name: '图片', extensions: extension === 'jpg' ? ['jpg', 'jpeg'] : ['png'] }];
  const result = await dialog.showSaveDialog(window, { defaultPath: join(directories[kind] || app.getPath('downloads'), filename), filters });
  if (result.canceled || !result.filePath) return null;
  directories[kind] = dirname(result.filePath);
  const operation = canvasExportPreferenceWrite.then(() => writeFile(canvasExportPreferenceFile, JSON.stringify(directories) + '\n'));
  canvasExportPreferenceWrite = operation.catch(() => {});
  await operation;
  const token = randomUUID();
  canvasExportTargets.set(token, { path: result.filePath, tempPath: null, handle: null });
  return token;
});

ipcMain.handle('atelier-canvas-export-start', async (event, token) => {
  checkCanvasExportSender(event);
  const target = canvasExportTargets.get(token);
  if (!target || target.handle) throw new Error('画布导出目标已失效');
  const tempPath = join(dirname(target.path), `.nai-canvas-${randomUUID()}.tmp`);
  target.handle = await open(tempPath, 'wx');
  target.tempPath = tempPath;
});

ipcMain.handle('atelier-canvas-export-chunk', async (event, token, data) => {
  checkCanvasExportSender(event);
  const target = canvasExportTargets.get(token);
  if (!target?.handle || !(data instanceof Uint8Array)) throw new Error('画布导出数据无效');
  await target.handle.writeFile(data);
});

ipcMain.handle('atelier-canvas-export-end', async (event, token) => {
  checkCanvasExportSender(event);
  const target = canvasExportTargets.get(token);
  if (!target?.handle) throw new Error('画布导出目标已失效');
  await target.handle.close();
  target.handle = null;
  await rename(target.tempPath, target.path);
  canvasExportTargets.delete(token);
});

ipcMain.handle('atelier-canvas-export-abort', async (event, token) => {
  checkCanvasExportSender(event);
  const target = canvasExportTargets.get(token);
  canvasExportTargets.delete(token);
  try {
    if (target?.handle) await target.handle.close();
  } finally {
    if (target?.tempPath) await unlink(target.tempPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});

function prepareUpdate() {
  if (!backend?.connected || starting) throw new Error('工坊服务未就绪，请稍后重试');
  const child = backend, requestId = randomUUID();
  return new Promise((done, reject) => {
    const finish = error => {
      clearTimeout(timer); child.off('message', receive); child.off('exit', exited);
      error ? reject(error) : done();
    };
    const receive = message => { if (message?.type === 'atelier-update-ready' && message.requestId === requestId) finish(message.error ? new Error(message.error) : null); };
    const exited = () => finish(new Error('工坊服务已停止，请重新打开后更新'));
    const timer = setTimeout(() => finish(new Error('无法确认后台任务状态，请稍后重试')), 5000);
    child.on('message', receive); child.once('exit', exited);
    child.send({ type: 'atelier-prepare-update', requestId });
  });
}

async function stopForUpdate() {
  quitting = true;
  const child = backend;
  if (!child) return;
  await new Promise((done, reject) => {
    const closed = () => { clearTimeout(timer); backend = null; done(); };
    const timer = setTimeout(() => { child.off('close', closed); reject(new Error('后台尚未完全退出，已停止安装')); }, 15_000);
    child.once('close', closed);
    if (child.connected) child.send({ type: 'atelier-shutdown' });
    else { clearTimeout(timer); child.off('close', closed); reject(new Error('后台连接中断，已停止安装')); }
  });
}

async function startUpdates() {
  if (!app.isPackaged) return;
  const preferenceFile = join(dataRoot, 'update-preferences.json');
  const preference = await readFile(preferenceFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const { autoUpdater } = createRequire(import.meta.url)('./updater.cjs');
  autoUpdater.logger = { info: message => log.write(`[更新] ${message}\n`), warn: message => log.write(`[更新] ${message}\n`), error: message => log.write(`[更新] ${message}\n`), debug: () => {} };
  updates = createDesktopUpdater({
    updater: autoUpdater, version: app.getVersion(), allowPrerelease: preference.allowPrerelease !== false,
    savePreference: value => writeFile(preferenceFile, JSON.stringify({ allowPrerelease: value }) + '\n'),
    publish: state => { if (window && !window.isDestroyed()) window.webContents.send('atelier-update-status', state); },
    onBeforeQuitForUpdate: () => { quitting = true; },
    prepareInstall: prepareUpdate, stopBackend: stopForUpdate,
    resumeBackend: async () => { quitting = false; if (backend?.connected) backend.send({ type: 'atelier-cancel-update' }); else if (!backend) await startBackend(); },
    openReleasePage: url => shell.openExternal(url),
  });
}

app.on('before-quit', event => {
  quitting = true;
  if (backend) {
    event.preventDefault();
    const child = backend;
    const timer = setTimeout(() => { child.kill(); }, 5000);
    child.once('exit', () => { clearTimeout(timer); backend = null; log?.end(); app.quit(); });
    if (child.connected) child.send({ type: 'atelier-shutdown' });
    else child.kill();
  }
});
app.on('window-all-closed', () => { if (quitting || selfTestFile) app.quit(); });
app.on('second-instance', showWindow);
app.on('activate', showWindow);
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  if (storageLaunchError) throw storageLaunchError;
  await mkdir(dirname(logFile), { recursive: true });
  log = createWriteStream(logFile, { flags: 'a' });
  language = normalizeLanguage(await readFile(languageFile, 'utf8').then(JSON.parse).then(value => value.language).catch(() => 'zh-CN'));
  await createWindow();
  await startUpdates();
  await startBackend();
  // 启动检查安静进行；合成发布验收不连接真实更新服务器。
  if (!selfTestFile) void updates?.action('check').catch(() => {});
}).catch(error => { if (!selfTestFile) dialog.showErrorBox(t('NAI Atelier 无法启动'), t(error.message)); app.exit(1); });
