import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { lstat, readFile, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { openInExplorer } from './local-backup.mjs';

export const IS_WINDOWS = platform() === 'win32';

/**
 * 获取系统桌面物理目录
 * @returns {string}
 */
export function getDesktopDir() {
  if (IS_WINDOWS) {
    // 先读取系统实际桌面，兼容 OneDrive／用户重定向；不能先选一个碰巧存在的 Desktop。
    try {
      const desktop = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
      if (desktop && existsSync(desktop)) return normalize(desktop);
    } catch { /* 无法读取系统目录时使用下面的环境变量回退。 */ }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const defaultDesktop = join(userProfile, 'Desktop');
      if (existsSync(defaultDesktop)) {
        return normalize(defaultDesktop);
      }
      // 检查 OneDrive 桌面重定向
      const oneDriveDesktop = join(userProfile, 'OneDrive', 'Desktop');
      if (existsSync(oneDriveDesktop)) {
        return normalize(oneDriveDesktop);
      }
    }
  }

  const fallback = join(homedir() || '.', 'Desktop');
  return normalize(fallback);
}

/**
 * 兼容旧下载入口，也用于准确辨认可迁移的历史桌面脚本。
 * @param {object} options
 * @param {string} options.projectDir 项目绝对根目录
 * @returns {string}
 */
export function generateLauncherBatContent({ projectDir = process.cwd() } = {}) {
  const normalizedProjectDir = normalize(resolve(projectDir));
  return `@echo off
setlocal EnableDelayedExpansion

set "PROJECT_DIR=${normalizedProjectDir}"
title NAI Atelier Launcher

cls
echo ========================================
echo   Start NAI Atelier
echo ========================================
echo.

if not exist "%PROJECT_DIR%\\package.json" (
  echo Project was not found:
  echo %PROJECT_DIR%
  echo.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"

where git >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
  if not "!CURRENT_BRANCH!"=="main" (
    echo Warning: current Git branch is "!CURRENT_BRANCH!", expected "main".
    echo.
    pause
    exit /b 1
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

echo Starting local server...
echo.
echo The browser will open automatically:
echo http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo.

call npm run dev:local -- %*

echo.
if errorlevel 1 (
  echo The launcher did not start a new server. Read the message above.
) else (
  echo Launcher finished.
)
pause
endlocal
`;
}

/**
 * 读取桌面启动器与快捷方式的当前状态
 * @param {object} [options]
 * @param {string} [options.projectDir]
 * @param {string} [options.desktopDir]
 * @returns {object}
 */
export function getDesktopLauncherStatus({ projectDir = process.cwd(), desktopDir = getDesktopDir() } = {}) {
  const normProjectDir = normalize(resolve(projectDir));
  const normDesktopDir = desktopDir ? normalize(resolve(desktopDir)) : '';
  const batPath = join(normProjectDir, 'NaiPromptManager.bat');
  const shortcutPath = normDesktopDir ? join(normDesktopDir, 'NAI Atelier.lnk') : '';
  const iconPath = join(normProjectDir, 'public', 'nai-atelier.ico');

  let batExists = false;
  let batMtime = null;
  if (batPath && existsSync(batPath)) {
    batExists = true;
    try {
      batMtime = statSync(batPath).mtime.toISOString();
    } catch {}
  }

  let shortcutExists = false;
  let shortcutMtime = null;
  if (shortcutPath && existsSync(shortcutPath)) {
    shortcutExists = true;
    try {
      shortcutMtime = statSync(shortcutPath).mtime.toISOString();
    } catch {}
  }

  const iconExists = existsSync(iconPath);

  return {
    supported: IS_WINDOWS,
    platform: platform(),
    projectDir: normProjectDir,
    desktopDir: normDesktopDir,
    desktopExists: existsSync(normDesktopDir),
    batPath,
    batExists,
    batMtime,
    shortcutPath,
    shortcutExists,
    shortcutMtime,
    iconPath,
    iconExists,
  };
}

/**
 * 桌面只创建快捷方式，启动脚本始终使用项目自带文件。
 * @param {object} options
 * @param {string} [options.projectDir]
 * @param {string} [options.desktopDir]
 * @returns {Promise<object>}
 */
export async function createDesktopLauncher({
  projectDir = process.cwd(),
  desktopDir = getDesktopDir(),
  os = platform(),
  execFile = execFileSync,
} = {}) {
  if (os !== 'win32') return { success: false, supported: false, message: '当前系统请使用命令行启动 Atelier' };
  const status = getDesktopLauncherStatus({ projectDir, desktopDir });
  if (!status.desktopExists) {
    const error = new Error(`桌面目录不存在或无法访问: ${status.desktopDir}`);
    error.status = 400;
    throw error;
  }

  if (!status.batExists || !status.iconExists) throw Object.assign(new Error('项目启动脚本或图标缺失，请检查项目文件完整性'), { status: 400 });
  // 路径通过环境变量传递，中文、空格、单引号和命令字符都不会进入 PowerShell 代码。
  const result = JSON.parse(execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shortcutScript], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NAI_SHORTCUT_PATH: status.shortcutPath, NAI_SHORTCUT_TARGET: status.batPath, NAI_SHORTCUT_PROJECT: status.projectDir, NAI_SHORTCUT_ICON: status.iconPath },
  }));
  if (normalize(result.targetPath || '').toLowerCase() !== status.batPath.toLowerCase()) throw new Error('快捷方式目标校验失败，已保留旧桌面脚本');

  let legacyBatRemoved = false;
  const legacyBatPath = join(status.desktopDir, 'NaiPromptManager.bat');
  // 新快捷方式已保存并复读确认后，才清理与本项目旧模板完全相同的副本。
  if (resolve(legacyBatPath).toLowerCase() !== resolve(status.batPath).toLowerCase()) {
    try {
      const file = await lstat(legacyBatPath);
      const normalizeText = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
      if (file.isFile() && !file.isSymbolicLink() && normalizeText(await readFile(legacyBatPath, 'utf8')) === normalizeText(generateLauncherBatContent({ projectDir: status.projectDir }))) {
        await unlink(legacyBatPath);
        legacyBatRemoved = true;
      }
    } catch (error) { if (error.code !== 'ENOENT') console.warn('旧桌面脚本未清理，快捷方式已指向项目内启动器。'); }
  }

  return {
    success: true,
    batCreated: false,
    shortcutCreated: true,
    changed: result.changed === true,
    legacyBatRemoved,
    batPath: status.batPath,
    shortcutPath: status.shortcutPath,
    message: '桌面快捷方式已就绪，启动脚本保留在项目内',
  };
}

const shortcutScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$shell = New-Object -ComObject WScript.Shell
try {
  $path = $env:NAI_SHORTCUT_PATH
  $exists = Test-Path -LiteralPath $path
  $shortcut = $shell.CreateShortcut($path)
  if ($exists -and $shortcut.Description -ne 'NAI Atelier Launcher') { throw 'A custom desktop shortcut already exists; it has been preserved' }
  $icon = $env:NAI_SHORTCUT_ICON + ',0'
  $changed = -not $exists -or $shortcut.TargetPath -ne $env:NAI_SHORTCUT_TARGET -or $shortcut.WorkingDirectory -ne $env:NAI_SHORTCUT_PROJECT -or $shortcut.IconLocation -ne $icon
  if ($changed) {
    $shortcut.TargetPath = $env:NAI_SHORTCUT_TARGET
    $shortcut.WorkingDirectory = $env:NAI_SHORTCUT_PROJECT
    $shortcut.IconLocation = $icon
    $shortcut.Description = 'NAI Atelier Launcher'
    $shortcut.Save()
  }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)
  $verified = $shell.CreateShortcut($path)
  if ($verified.TargetPath -ne $env:NAI_SHORTCUT_TARGET -or $verified.WorkingDirectory -ne $env:NAI_SHORTCUT_PROJECT -or $verified.IconLocation -ne $icon) { throw 'Desktop shortcut verification failed' }
  @{ changed = [bool]$changed; targetPath = $verified.TargetPath } | ConvertTo-Json -Compress
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($verified)
} finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
`;

/** 安装和日常启动共用；创建失败只提示，不阻断依赖安装或本地服务。 */
export async function ensureDesktopLauncher(options = {}) {
  if (platform() !== 'win32' || process.env.CI || process.env.NAI_NO_DESKTOP_SHORTCUT === '1') return;
  try {
    const result = await createDesktopLauncher(options);
    if (result.changed || result.legacyBatRemoved) console.log('NAI Atelier 桌面快捷方式已创建／更新，启动脚本位于项目内。');
    return result;
  } catch (error) { console.warn(`无法自动创建桌面快捷方式，可在「设置 → 数据与维护」重试：${error.message}`); }
}

/**
 * 在系统文件管理器中打开桌面
 * @param {string} [desktopDir]
 * @returns {Promise<object>}
 */
export async function openDesktopFolder(desktopDir = getDesktopDir()) {
  if (!desktopDir || !existsSync(desktopDir)) {
    const error = new Error('桌面路径不存在');
    error.status = 404;
    throw error;
  }
  return openInExplorer(desktopDir);
}
