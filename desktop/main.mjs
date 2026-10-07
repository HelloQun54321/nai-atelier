import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopServerOptions, findDesktopPorts, isDesktopNavigation, isExternalWebLink, prepareDesktopWorkspace } from '../scripts/desktop-runtime.mjs';
import { createDesktopUpdater } from './app-updater.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const startupFile = join(here, 'startup.html');
const startupUrl = pathToFileURL(startupFile).href;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve(here, '..', '.desktop-build', 'runtime');
const dataRoot = process.env.NAI_DESKTOP_DATA_DIR || join(process.env.LOCALAPPDATA || app.getPath('appData'), 'NAI Atelier');
app.setPath('userData', join(dataRoot, 'browser'));
app.setAppUserModelId('com.naiatelier.desktop');
// 下载由用户触发；关闭窗口仍进托盘，安装必须先结束本应用后台。
let window, tray, backend, log, workspace, appUrl = '', quitting = false, starting = false;
let updates;
let status = { phase: 'starting', message: '正在打开工坊…' };
const logFile = join(dataRoot, 'logs', 'desktop.log');
const selfTestFile = process.env.NAI_DESKTOP_SELF_TEST;

const setStatus = (phase, message) => {
  status = { phase, message };
  if (window && !window.isDestroyed()) window.webContents.send('atelier-status', status);
};
const showWindow = () => { window?.show(); window?.focus(); };

function createWindow() {
  window = new BrowserWindow({
    width: 1400, height: 920, minWidth: 360, minHeight: 540,
    title: 'NAI Atelier', icon: join(runtimeRoot, 'public', 'nai-atelier.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
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
    window.webContents.send('atelier-status', status);
    if (updates) window.webContents.send('atelier-update-status', updates.status());
  });
  window.on('close', event => {
    if (!quitting && !selfTestFile) { event.preventDefault(); window.hide(); tray?.setToolTip('NAI Atelier · 后台运行'); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '工坊', submenu: [{ label: '打开数据目录', click: () => void shell.openPath(workspace || dataRoot) }, { label: '查看启动日志', click: () => void shell.openPath(logFile) }, { type: 'separator' }, { label: '退出工坊', accelerator: 'Alt+F4', click: () => app.quit() }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  if (!selfTestFile) {
    tray = new Tray(join(runtimeRoot, 'public', 'nai-atelier.ico'));
    tray.setToolTip('NAI Atelier');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开工坊', click: showWindow }, { label: '打开数据目录', click: () => void shell.openPath(workspace || dataRoot) }, { type: 'separator' }, { label: '退出工坊', click: () => app.quit() }]));
    tray.on('double-click', showWindow);
  }
  return window.loadFile(startupFile);
}

async function startBackend() {
  if (starting || backend) return;
  starting = true;
  try {
    setStatus('starting', '正在打开工坊…');
    const prepared = await prepareDesktopWorkspace(runtimeRoot, dataRoot);
    workspace = prepared.workspace;
    const ports = await findDesktopPorts({ preferred: Number(process.env.NAI_DESKTOP_PORT || 3000) });
    appUrl = `http://localhost:${ports.gateway}`;
    const spec = desktopServerOptions({ runtimeRoot, workspace, executable: process.execPath, ports, documents: app.getPath('documents') });
    const child = spawn(spec.command, spec.args, spec.options);
    backend = child;
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
            rendered = await window.webContents.executeJavaScript("Boolean(document.querySelector('nav button[aria-label=\"风格串\"]') && document.querySelector('button[aria-label=\"全局设置\"]'))");
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
  if (action === 'status') return status;
  if (action === 'retry') return startBackend();
  if (action === 'logs') return shell.openPath(logFile);
  if (action === 'quit') return app.quit();
  throw new Error('未知操作');
});

ipcMain.handle('atelier-update', async (event, action, value) => {
  if (!updates || event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isDesktopNavigation(event.senderFrame.url, appUrl)) throw new Error('更新只允许本应用主窗口操作');
  return updates.action(action, value);
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
  await mkdir(dirname(logFile), { recursive: true });
  log = createWriteStream(logFile, { flags: 'a' });
  await createWindow();
  await startUpdates();
  await startBackend();
  // 启动检查安静进行；合成发布验收不连接真实更新服务器。
  if (!selfTestFile) void updates?.action('check').catch(() => {});
}).catch(error => { if (!selfTestFile) dialog.showErrorBox('NAI Atelier 无法启动', error.message); app.exit(1); });
