import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, systemPreferences, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopServerOptions, findDesktopPorts, isDesktopNavigation, isExternalWebLink, prepareDesktopWorkspace, pickDesktopDirectory, runtimeNodePath } from '../scripts/desktop-runtime.mjs';
import { createDesktopUpdater } from './app-updater.mjs';
import { LANGUAGES, normalizeLanguage, translate } from '../locales/index.mjs';
import { resolveStorageDataRootSync, launchStorageSwitch, getStoragePreferences, assertStorageNotSwitchingSync } from '../scripts/storage-locations.mjs';
import { exportWithPreferences } from '../scripts/export-locations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const startupFile = join(here, 'startup.html');
const startupUrl = pathToFileURL(startupFile).href;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve(here, '..', '.desktop-build', 'runtime');
const storageAnchor = process.env.NAI_DESKTOP_DATA_DIR || join(process.env.LOCALAPPDATA || app.getPath('appData'), 'NAI Atelier');
// macOS 的 Electron 在入口模块执行完之前不运行事件循环，顶层等待异步文件操作会卡死启动，这里必须同步判断。
const selectedDataRoot = (() => { try { assertStorageNotSwitchingSync(storageAnchor); return resolveStorageDataRootSync(storageAnchor, storageAnchor); } catch (error) { return error; } })();
const storageLaunchError = selectedDataRoot instanceof Error ? selectedDataRoot : null;
const dataRoot = storageLaunchError ? storageAnchor : selectedDataRoot;
app.setPath('userData', join(dataRoot, 'browser'));
app.setAppUserModelId('com.naiatelier.desktop');
const isMac = process.platform === 'darwin';
// 工坊不使用系统窗口恢复；异常退出后 macOS 的「重新打开窗口」提示会在隐藏窗口前阻塞启动，直接关闭。
if (isMac) systemPreferences.setUserDefault('ApplePersistenceIgnoreState', 'boolean', true);
// 发布页（mac 版没有签名，不走应用内自动安装，只提示前往下载）。
const RELEASES_URL = 'https://github.com/HelloQun54321/nai-atelier/releases';
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
    // macOS：内容延伸到标题栏，保留原生红绿灯；底色跟随系统明暗，避免启动和切页时闪白。
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 12 }, backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171f' : '#f7f8fb', tabbingIdentifier: 'nai-atelier' } : {}),
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, additionalArguments: [`--atelier-language=${language}`], ...(isMac ? { scrollBounce: true } : {}) },
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
  if (isMac) {
    // 全屏时系统隐藏红绿灯，页面据此收回标题栏留白。
    window.on('enter-full-screen', () => window.webContents.send('atelier-command', 'fullscreen-enter'));
    window.on('leave-full-screen', () => window.webContents.send('atelier-command', 'fullscreen-leave'));
  }
  window.webContents.on('did-finish-load', () => {
    if (isMac && window.isFullScreen()) window.webContents.send('atelier-command', 'fullscreen-enter');
    window.webContents.send('atelier-status', localizedStatus());
    if (updates) window.webContents.send('atelier-update-status', updates.status());
  });
  window.on('close', event => {
    if (!quitting && !selfTestFile) {
      event.preventDefault();
      // macOS 习惯：关窗后应用留在程序坞继续服务手机端；全屏时先退出全屏再隐藏，避免留下黑色空间。
      if (isMac && window.isFullScreen()) { window.once('leave-full-screen', () => window.hide()); window.setFullScreen(false); }
      else window.hide();
      tray?.setToolTip(t('NAI Atelier · 后台运行'));
    }
  });
  // macOS 没有托盘习惯（且 .ico 托盘会卡住主线程），后台状态由程序坞图标与菜单承担。
  if (!selfTestFile && !isMac) {
    tray = new Tray(join(runtimeRoot, 'public', 'nai-atelier.ico'));
    tray.setToolTip('NAI Atelier');
    tray.on('double-click', showWindow);
  }
  updateMenus();
  return window.loadFile(startupFile);
}

/** 菜单命令转交前端页面执行（偏好设置、查找等），页面未就绪时只显示窗口。 */
const sendCommand = command => {
  showWindow();
  if (appUrl && window && !window.isDestroyed() && isDesktopNavigation(window.webContents.getURL(), appUrl)) window.webContents.send('atelier-command', command);
};

function updateMacMenus() {
  const roles = (items) => items.map(([role, label]) => ({ role, label: t(label) }));
  const dataItem = { label: t('打开数据目录'), click: () => void shell.openPath(workspace || dataRoot) };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: t('关于 NAI Atelier') },
      { type: 'separator' },
      { label: t('设置…'), accelerator: 'Cmd+,', click: () => sendCommand('preferences') },
      { type: 'separator' },
      { role: 'services', label: t('服务') },
      { type: 'separator' },
      ...roles([['hide', '隐藏 NAI Atelier'], ['hideOthers', '隐藏其他'], ['unhide', '全部显示']]),
      { type: 'separator' },
      { role: 'quit', label: t('退出工坊') },
    ] },
    { label: t('文件'), submenu: [
      dataItem, { label: t('查看启动日志'), click: () => void shell.openPath(logFile) },
      { type: 'separator' }, { role: 'close', label: t('关闭窗口') },
    ] },
    { label: t('编辑'), submenu: [
      ...roles([['undo', '撤销'], ['redo', '重做']]), { type: 'separator' },
      ...roles([['cut', '剪切'], ['copy', '复制'], ['paste', '粘贴'], ['pasteAndMatchStyle', '粘贴并匹配样式'], ['delete', '删除'], ['selectAll', '全选']]),
      { type: 'separator' },
      { label: t('查找'), accelerator: 'Cmd+F', click: () => sendCommand('find') },
      { type: 'separator' },
      { label: t('语音'), submenu: roles([['startSpeaking', '开始朗读'], ['stopSpeaking', '停止朗读']]) },
    ] },
    { label: t('视图'), submenu: [
      ...roles([['reload', '刷新']]), { type: 'separator' },
      ...roles([['resetZoom', '实际大小'], ['zoomIn', '放大'], ['zoomOut', '缩小']]), { type: 'separator' },
      ...roles([['togglefullscreen', '进入全屏幕']]),
      ...(app.isPackaged ? [] : roles([['toggleDevTools', '开发者工具']])),
    ] },
    { role: 'windowMenu', label: t('窗口') },
    { role: 'help', label: t('帮助'), submenu: [{ label: t('发布与下载页'), click: () => void shell.openExternal(RELEASES_URL) }] },
  ]));
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: t('打开工坊'), click: showWindow }, dataItem]));
}

function updateMenus() {
  if (isMac) return updateMacMenus();
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
    // macOS 常见符号链接目录（/var → /private/var、移动过的用户目录）下，后台上报的是真实路径。
    const workspaceReal = await realpath(workspace).catch(() => workspace);
    const ports = await findDesktopPorts({ preferred: Number(process.env.NAI_DESKTOP_PORT || 3000) });
    appUrl = `http://localhost:${ports.gateway}`;
    const spec = desktopServerOptions({ runtimeRoot, workspace, executable: process.execPath, ports, documents: app.getPath('documents'), downloads: app.getPath('downloads'), storageAnchor, dataRoot, installRoot });
    // macOS 安装版由应用包登记 pixiv:// 协议，回调经 open-url 交给本进程，后台据此告知前端可自动完成登录。
    if (isMac && app.isPackaged && app.isDefaultProtocolClient('pixiv')) spec.options.env.NAI_PIXIV_APP_SCHEME = '1';
    const child = spawn(spec.command, spec.args, spec.options);
    backend = child;
    child.on('message', message => {
      if (message?.type === 'atelier-dock-badge') { if (isMac) app.dock?.setBadge(typeof message.text === 'string' ? message.text.slice(0, 8) : ''); return; }
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
          restart: { command: process.execPath, args: app.isPackaged ? [] : process.argv.slice(1), cwd: dirname(process.execPath), env: { ...process.env } } }, runtimeNodePath(runtimeRoot), join(runtimeRoot, 'scripts', 'storage-locations.mjs'));
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
      if (identity?.phase === 'running' && identity.pid === child.pid && [workspace, workspaceReal].includes(resolve(identity.projectDir))) {
        await window.loadURL(appUrl);
        setStatus('ready', '工坊已就绪');
        if (pendingPixivCallback) void completePixivCallback(pendingPixivCallback);
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
      // 后台通常 1 秒内就绪，短间隔探测让窗口尽早切到工坊页面（本机回环请求，开销可忽略）。
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('启动等待超时，请查看日志并重新尝试');
  } catch (error) {
    if (backend?.connected) backend.send({ type: 'atelier-shutdown' });
    setStatus('error', error.message || '无法启动工坊');
    if (selfTestFile) { console.error(error.message); app.exit(1); }
    else await window.loadFile(startupFile);
  } finally { starting = false; }
}

let pendingPixivCallback = '';
/** Pixiv 回调只转交本机后台核验与换取令牌，不落盘、不记日志；后台未就绪时暂存到就绪后再提交。 */
async function completePixivCallback(url) {
  if (!appUrl || starting || !backend) { pendingPixivCallback = url; return; }
  pendingPixivCallback = '';
  showWindow();
  await fetch(`${appUrl.replace('//localhost:', '//127.0.0.1:')}/api/pixiv/login/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callbackUrl: url }), redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => {});
}
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (typeof url === 'string' && url.startsWith('pixiv://') && url.length <= 4096) void completePixivCallback(url);
});

let lastProgress = -1;
const fromMainWindow = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && isDesktopNavigation(event.senderFrame.url, appUrl);
// 生成进度显示在程序坞／任务栏图标：0～1 为进度，负数清除。
ipcMain.handle('atelier-progress', async (event, value) => {
  if (!fromMainWindow(event)) throw new Error('进度只允许本应用主窗口设置');
  const progress = Number(value);
  if (!Number.isFinite(progress)) throw new Error('进度无效');
  window.setProgressBar(progress < 0 ? -1 : Math.min(1, progress));
  // 任务全部结束而窗口不在前台时，程序坞图标轻跳一次提示查看结果。
  if (progress < 0 && lastProgress >= 0 && !window.isFocused()) app.dock?.bounce('informational');
  lastProgress = progress;
});

// 应用内选择浅色／深色时，原生文件面板、菜单与滚动条一并切换；跟随系统时交还系统设置。
ipcMain.handle('atelier-theme', async (event, mode) => {
  if (!fromMainWindow(event)) throw new Error('主题只允许本应用主窗口设置');
  if (!['light', 'dark', 'system'].includes(mode)) throw new Error('主题无效');
  nativeTheme.themeSource = mode;
  if (isMac) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#14171f' : '#f7f8fb');
});

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
  // macOS 版不签名，系统不允许自动替换应用；设置页沿用网页检查并引导到下载页。
  if (!app.isPackaged || isMac) return;
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
app.on('second-instance', (_event, argv) => {
  showWindow();
  // Windows 协议回调由注册命令处理；其他平台第二实例携带的 pixiv:// 参数也交给本实例。
  const callback = argv.find(value => typeof value === 'string' && value.startsWith('pixiv://'));
  if (callback && callback.length <= 4096) void completePixivCallback(callback);
});
app.on('activate', showWindow);
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  if (storageLaunchError) throw storageLaunchError;
  await mkdir(dirname(logFile), { recursive: true });
  if (isMac && app.isPackaged && !app.isDefaultProtocolClient('pixiv')) app.setAsDefaultProtocolClient('pixiv');
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(runtimeRoot, 'public', 'app-icon.png'));
  log = createWriteStream(logFile, { flags: 'a' });
  language = normalizeLanguage(await readFile(languageFile, 'utf8').then(JSON.parse).then(value => value.language).catch(() => 'zh-CN'));
  // 启动页加载与后台启动并行；后台先就绪时直接切到工坊页面，启动页被替换的中断不算失败。
  const startupPage = createWindow().catch(() => {});
  await startUpdates();
  await startBackend();
  await startupPage;
  // 启动检查安静进行；合成发布验收不连接真实更新服务器。
  if (!selfTestFile) void updates?.action('check').catch(() => {});
}).catch(error => { if (!selfTestFile) dialog.showErrorBox(t('NAI Atelier 无法启动'), t(error.message)); app.exit(1); });
