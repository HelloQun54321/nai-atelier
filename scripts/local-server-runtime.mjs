import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const localUrl = 'http://127.0.0.1:3000';
const requestJson = async (path, fetchImpl) => {
  const response = await fetchImpl(`${localUrl}${path}`, { cache: 'no-store', headers: { Connection: 'close' }, signal: AbortSignal.timeout(2000) });
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
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess -Unique)
if ($taskListeners.Count -ne 1) { throw 'Unable to identify the local server listener' }
$taskServerPid = [int]$taskListeners[0]
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskServerPid"
if ($taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notmatch 'scripts[\\/]local-server\.mjs(?:["\s]|$)') { throw 'The port is not owned by the NAI local server entry point' }
$taskIdentity = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/local-maintenance/desktop-launcher/status' -TimeoutSec 2 -DisableKeepAlive
if (-not $taskIdentity.projectDir -or [IO.Path]::GetFullPath($taskIdentity.projectDir) -ne [IO.Path]::GetFullPath($env:NAI_RESTART_PROJECT_DIR)) { throw 'The running server belongs to a different project folder' }
$taskCurrentListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess -Unique)
if ($taskCurrentListeners.Count -ne 1 -or $taskCurrentListeners[0] -ne $taskServerPid) { throw 'The listener changed while verifying the server' }
& taskkill.exe /PID $taskServerPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to stop the verified server process tree' }
Write-Output $taskServerPid
`;

export const restartOwnedLocalServer = async (projectDir, { fetchImpl = fetch, execFile = execFileSync, os = platform(), waitMs = 12_000 } = {}) => {
  const identity = await requestJson('/api/local-maintenance/desktop-launcher/status', fetchImpl);
  const expected = resolve(projectDir);
  const actual = identity?.projectDir ? resolve(identity.projectDir) : '';
  if (!actual || (os === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) throw new Error('3000 端口上的服务不属于当前项目，已保留该进程，请手动检查');
  let pid;
  if (os === 'win32') {
    pid = Number(execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsRestart], { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: { ...process.env, NAI_RESTART_PROJECT_DIR: expected }, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  } else {
    const listeners = execFile('lsof', ['-t', '-iTCP:3000', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
    if (listeners.length !== 1 || !/^\d+$/.test(listeners[0])) throw new Error('无法唯一确定当前服务进程，请关闭原服务窗口后重试');
    pid = Number(listeners[0]);
    const command = execFile('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
    if (!/scripts\/local-server\.mjs(?:["\s]|$)/.test(command)) throw new Error('当前监听进程不是工坊启动入口，已保留该进程');
    execFile('kill', ['-TERM', String(pid)]);
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('无法确认原服务已停止');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = await requestJson('/api/lan/status', fetchImpl).catch(() => null);
    if (typeof status?.authorized !== 'boolean') return pid;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error('原服务端口尚未释放，已停止继续启动，请关闭原服务窗口后重试');
};
