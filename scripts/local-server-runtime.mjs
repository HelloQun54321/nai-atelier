import { execFileSync } from 'node:child_process';
import { networkInterfaces, platform } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { connect } from 'node:net';

export const LOCAL_LAUNCHER_PORT = 3003;

/** 启动日志与设置页共用真实网卡地址，排除手机无法访问的虚拟网卡。 */
export const getLanUrls = (port, interfaces = networkInterfaces()) => {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|tailscale|zerotier|utun|tun|tap/i.test(name)) continue;
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // 链路本地、未指定与 TUN 代理常用的保留测试段不作为手机入口。
      if (/^(169\.254|0\.|198\.1[89]\.)/.test(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  const unique = [...new Set(addresses)];
  unique.sort((a, b) => Number(!/^192\.168\./.test(a)) - Number(!/^192\.168\./.test(b)));
  return unique.map(address => `http://${address}:${port}`);
};

const launcherPath = '/__atelier/launcher';
const launcherMarker = 'nai-atelier-local-launcher';
const requestJson = async (path, fetchImpl, port = 3000, timeout = 2000) => {
  const response = await fetchImpl(`http://127.0.0.1:${port}${path}`, { cache: 'no-store', headers: { Connection: 'close' }, signal: AbortSignal.timeout(timeout) });
  return response.ok ? response.json() : null;
};

/** 已运行不代表已更新：启动器必须先辨认实际加载的后端。 */
export const inspectExistingLocalServer = async (expectedVersion, fetchImpl = fetch) => {
  const status = await requestJson('/api/lan/status', fetchImpl).catch(() => null);
  if (typeof status?.authorized !== 'boolean') return null;
  const config = await requestJson('/api/prompt-agent/config', fetchImpl).catch(() => null);
  return { current: Boolean(config?.backendVersion === expectedVersion && !config.restartRequired), backendVersion: config?.backendVersion || '', expectedVersion };
};

// 不按进程名批量终止：核对项目目录、监听 PID 和入口，再停止这一棵服务树。
const windowsRestart = String.raw`
$ErrorActionPreference = 'Stop'
$taskPort = [int]$env:NAI_RESTART_PORT
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort $taskPort | Select-Object -ExpandProperty OwningProcess -Unique)
if ($taskListeners.Count -ne 1) { throw 'Unable to identify the local server listener' }
$taskServerPid = [int]$taskListeners[0]
if ($env:NAI_RESTART_EXPECTED_PID -and $taskServerPid -ne [int]$env:NAI_RESTART_EXPECTED_PID) { throw 'The launcher owner changed before verification' }
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskServerPid"
if ($taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notmatch 'scripts[\\/]local-server\.mjs(?:["\s]|$)') { throw 'The port is not owned by the NAI local server entry point' }
$taskIdentity = Invoke-RestMethod -Uri $env:NAI_RESTART_STATUS_URL -TimeoutSec 2 -DisableKeepAlive
if (-not $taskIdentity.projectDir -or [IO.Path]::GetFullPath($taskIdentity.projectDir) -ne [IO.Path]::GetFullPath($env:NAI_RESTART_PROJECT_DIR)) { throw 'The running server belongs to a different project folder' }
if ($env:NAI_RESTART_EXPECTED_PID -and ($taskIdentity.app -ne 'nai-atelier-local-launcher' -or $taskIdentity.pid -ne $taskServerPid -or $taskIdentity.phase -ne 'running')) { throw 'The launcher identity changed during verification' }
$taskCurrentListeners = @(Get-NetTCPConnection -State Listen -LocalPort $taskPort | Select-Object -ExpandProperty OwningProcess -Unique)
if ($taskCurrentListeners.Count -ne 1 -or $taskCurrentListeners[0] -ne $taskServerPid) { throw 'The listener changed while verifying the server' }
& taskkill.exe /PID $taskServerPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to stop the verified server process tree' }
Write-Output $taskServerPid
`;

const sameProject = (actual, expected, os = platform()) => actual && (os === 'win32' ? resolve(actual).toLowerCase() === resolve(expected).toLowerCase() : resolve(actual) === resolve(expected));

export const isLocalPortBusy = port => new Promise(resolveBusy => {
  const socket = connect({ host: '127.0.0.1', port });
  const finish = busy => { socket.destroy(); resolveBusy(busy); };
  socket.setTimeout(500, () => finish(true));
  socket.once('connect', () => finish(true));
  socket.once('error', error => finish(error.code !== 'ECONNREFUSED'));
});

export const restartOwnedLocalServer = async (projectDir, { fetchImpl = fetch, execFile = execFileSync, os = platform(), waitMs = 12_000, port = 3000, identityPath = '/api/local-maintenance/desktop-launcher/status', expectedPid, portBusy = isLocalPortBusy } = {}) => {
  const identity = await requestJson(identityPath, fetchImpl, port);
  const expected = resolve(projectDir);
  if (!sameProject(identity?.projectDir, expected, os)) throw new Error(`${port} 端口上的服务不属于当前项目，已保留该进程，请手动检查`);
  if (expectedPid && (identity.app !== launcherMarker || identity.pid !== expectedPid || identity.phase !== 'running')) throw new Error('启动实例身份已变化，已停止本次重启');
  let pid;
  if (os === 'win32') {
    pid = Number(execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsRestart], { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: { ...process.env, NAI_RESTART_PROJECT_DIR: expected, NAI_RESTART_PORT: String(port), NAI_RESTART_STATUS_URL: `http://127.0.0.1:${port}${identityPath}`, NAI_RESTART_EXPECTED_PID: expectedPid ? String(expectedPid) : '' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  } else {
    const listeners = execFile('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
    if (listeners.length !== 1 || !/^\d+$/.test(listeners[0])) throw new Error('无法唯一确定当前服务进程，请关闭原服务窗口后重试');
    pid = Number(listeners[0]);
    if (expectedPid && pid !== expectedPid) throw new Error('启动实例身份已变化，已停止本次重启');
    const command = execFile('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
    if (!/scripts\/local-server\.mjs(?:["\s]|$)/.test(command)) throw new Error('当前监听进程不是工坊启动入口，已保留该进程');
    const verified = await requestJson(identityPath, fetchImpl, port);
    const currentListeners = execFile('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim();
    if (!sameProject(verified?.projectDir, expected, os) || currentListeners !== String(pid) || (expectedPid && (verified.app !== launcherMarker || verified.pid !== pid || verified.phase !== 'running'))) throw new Error('服务身份已变化，已停止本次重启');
    execFile('kill', ['-TERM', String(pid)]);
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('无法确认原服务已停止');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!await portBusy(port)) return pid;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error('原服务端口尚未释放，已停止继续启动，请关闭原服务窗口后重试');
};

/** 内核持有的启动占位从构建前持续到退出，进程崩溃也不会留下文件锁。 */
export const reserveLocalLauncher = async (projectDir, port = LOCAL_LAUNCHER_PORT) => {
  let phase = 'starting';
  const server = createServer((req, res) => {
    res.setHeader('Connection', 'close');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || req.url !== launcherPath) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ app: launcherMarker, projectDir: resolve(projectDir), pid: process.pid, phase }));
  });
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, ready);
  });
  return {
    markRunning: () => { phase = 'running'; },
    close: () => new Promise(done => { server.close(done); server.closeAllConnections(); }),
    port: server.address().port,
  };
};

/** 所有完整启动入口共用此检查；已运行则重启，启动中则合并连续点击。 */
export const prepareLocalServerLaunch = async (projectDir, { port = LOCAL_LAUNCHER_PORT, servicePort = 3000, reserve = reserveLocalLauncher, fetchImpl = fetch, restart = restartOwnedLocalServer, portBusy = isLocalPortBusy, log = console.log } = {}) => {
  let guard;
  try {
    guard = await reserve(projectDir, port);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const identity = await requestJson(launcherPath, fetchImpl, port, 1000).catch(() => null);
    if (identity?.app !== launcherMarker || !sameProject(identity.projectDir, projectDir) || !Number.isSafeInteger(identity.pid) || identity.pid <= 0) throw new Error('启动检查端口被其他程序或无法确认身份的实例占用，已停止重复启动，请检查原窗口');
    if (identity.phase === 'starting') { log('NAI Atelier 已在启动中，已关闭多余启动器，请等待原窗口完成。'); return null; }
    if (identity.phase !== 'running') throw new Error('无法确认原实例状态，已停止重复启动，请检查原窗口');
    log('正在重启当前项目的本地服务（会结束原服务上的未完成任务）...');
    const pid = await restart(projectDir, { port, identityPath: launcherPath, expectedPid: identity.pid, fetchImpl, portBusy });
    log(`原服务进程 ${pid} 已停止，将构建并启动最新版本。`);
    // 原实例停止后仍须原子争用，不能让同时点击的两个启动器都继续构建。
    try { guard = await reserve(projectDir, port); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; log('另一个启动器已接管启动，本窗口结束。'); return null; }
  }
  try {
    if (await portBusy(servicePort)) {
      log('正在检查并重启当前项目的已有服务（会结束原服务上的未完成任务）...');
      const pid = await restart(projectDir, { port: servicePort, fetchImpl, portBusy });
      log(`原服务进程 ${pid} 已停止，将构建并启动最新版本。`);
    }
    if (await portBusy(servicePort)) throw new Error(`${servicePort} 端口尚未释放，已停止继续启动，请检查原窗口`);
    return guard;
  } catch (error) { await guard.close(); throw error; }
};
