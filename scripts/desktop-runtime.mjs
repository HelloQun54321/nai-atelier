import { access, copyFile, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const DESKTOP_APP_ID = 'com.naiatelier.desktop';
/** 内置 Node 位于 runtime 根目录：Windows 为 node.exe，macOS 为可执行文件 node。 */
export const runtimeNodeName = (platform = process.platform) => platform === 'win32' ? 'node.exe' : 'node';
export const runtimeNodePath = (runtimeRoot, platform = process.platform) => join(runtimeRoot, runtimeNodeName(platform));

export async function pickDesktopDirectory(dialog, window, initialPath = '') {
  if (!window || window.isDestroyed()) throw new Error('工坊窗口已关闭，请重新打开后选择文件夹');
  window.show(); window.focus();
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], ...(initialPath ? { defaultPath: initialPath } : {}) });
  const path = result.cancelled ? '' : result.filePaths[0] || '';
  return { path, cancelled: !path };
}

/** 安装目录只读，工作区独立持久化；不自动接管源码部署的数据。 */
export async function prepareDesktopWorkspace(runtimeRoot, dataRoot, installRoot = runtimeRoot, platform = process.platform) {
  const runtime = resolve(runtimeRoot);
  if (!isAbsolute(dataRoot)) throw new Error('应用数据目录必须为绝对路径');
  const data = resolve(dataRoot);
  const distance = relative(runtime, data);
  if (!distance || (!distance.startsWith('..') && !isAbsolute(distance))) throw new Error('应用数据目录不能位于程序运行目录内');
  const installDistance = relative(resolve(installRoot), data);
  if (!installDistance || (!installDistance.startsWith('..') && !isAbsolute(installDistance))) throw new Error('应用数据目录不能位于程序安装目录内');
  const workspace = join(data, 'workspace');
  const marker = join(workspace, 'desktop-workspace.json');
  let previous;
  try { previous = JSON.parse(await readFile(marker, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('应用工作区标记损坏，请保留数据并检查目录'); }
  if (previous && previous.appId !== DESKTOP_APP_ID) throw new Error('该工作区属于其他应用，已保留原文件');
  if (!previous) {
    const entries = await readdir(workspace).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const storageMarker = entries.includes('atelier-storage-workspace.json')
      ? await readFile(join(workspace, 'atelier-storage-workspace.json'), 'utf8').then(JSON.parse).catch(() => null) : null;
    if (entries.length && storageMarker?.app !== 'nai-atelier') throw new Error('数据目录已有未识别的工作区，已保留原文件');
  }
  await access(runtimeNodePath(runtime, platform));
  await access(join(runtime, 'dist', '_worker.js'));
  const pkg = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
  await mkdir(workspace, { recursive: true });
  await mkdir(join(workspace, 'public'), { recursive: true });
  // 保持 D1/R2 存储名称及 ID 原样，Wrangler 临时目录也落入可写工作区。
  await copyFile(join(runtime, 'wrangler.toml'), join(workspace, 'wrangler.toml'));
  await copyFile(join(runtime, 'package.json'), join(workspace, 'package.json'));
  await copyFile(join(runtime, 'public', 'nai-atelier.ico'), join(workspace, 'public', 'nai-atelier.ico'));
  await cp(join(runtime, 'sillytavern-extension'), join(workspace, 'sillytavern-extension'), { recursive: true });
  await writeFile(marker, JSON.stringify({ appId: DESKTOP_APP_ID, version: pkg.version }, null, 2) + '\n');
  return { workspace, version: pkg.version };
}

export const isPortFree = port => new Promise(done => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => done(true)));
});

/** 源码工坊或其他应用已占端口时选新端口，绝不结束它们的进程。 */
export async function findDesktopPorts({ preferred = 3000, available = isPortFree } = {}) {
  for (let base = preferred; base < preferred + 1000 && base + 3 < 65536; base += 10) {
    if ((await Promise.all([base, base + 2, base + 3].map(available))).every(Boolean)) {
      return { gateway: base, worker: base + 1, tagUpdate: base + 2, launcher: base + 3 };
    }
  }
  throw new Error('无法找到可用的本机服务端口，请关闭冲突程序后重试');
}

export function desktopServerOptions({ runtimeRoot, workspace, executable, ports, documents, downloads, storageAnchor, dataRoot, installRoot, env = process.env, platform = process.platform }) {
  const inherited = Object.fromEntries(Object.entries(env).filter(([key]) => !/^NAI_|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(key)));
  return {
    command: runtimeNodePath(runtimeRoot, platform),
    args: ['--no-warnings', join(runtimeRoot, 'scripts', 'local-server.mjs')],
    options: {
      cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...inherited, NAI_PACKAGED: '1', NAI_APP_ROOT: runtimeRoot,
        NAI_STORAGE_ANCHOR: storageAnchor || dirname(workspace), NAI_STORAGE_DATA_ROOT: dataRoot || dirname(workspace),
        NAI_STORAGE_INSTALL_ROOT: installRoot || runtimeRoot,
        NAI_NO_BROWSER: '1', NAI_NO_DESKTOP_SHORTCUT: '1',
        NAI_DESKTOP_EXECUTABLE: executable,
        NAI_BACKUP_DEFAULT_DIR: join(documents, 'NAI Atelier Backups'),
        NAI_EXPORT_SYSTEM_DIR: downloads || '',
        NAI_GATEWAY_PORT: String(ports.gateway), NAI_WORKER_PORT: String(ports.worker),
        NAI_TAG_UPDATE_PORT: String(ports.tagUpdate), NAI_LAUNCHER_PORT: String(ports.launcher),
        NAI_GATEWAY_URL: `http://127.0.0.1:${ports.gateway}`,
      },
    },
  };
}

export function isDesktopNavigation(url, appUrl) {
  try { const target = new URL(url); return target.origin === new URL(appUrl).origin && !target.username && !target.password; }
  catch { return false; }
}

export function isExternalWebLink(url) {
  try { const target = new URL(url); return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password; }
  catch { return false; }
}
