import { spawn, execSync, execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
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
    try {
      const psOutput = execSync(
        'powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      ).trim();
      if (psOutput && existsSync(psOutput)) {
        return normalize(psOutput);
      }
    } catch {
      // 忽略 powershell 探测异常，回退到用户根目录
    }
  }

  const fallback = join(homedir() || '.', 'Desktop');
  return normalize(fallback);
}

/**
 * 生成桌面专属启动器批处理脚本内容
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

powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/lan/status' -TimeoutSec 2; if ($null -ne $r.authorized) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo NAI Atelier is already running. Opening the existing page...
  start "" "http://localhost:3000"
  exit /b 0
)

call npm run dev:local

echo.
echo NAI Atelier has stopped.
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
  const batPath = normDesktopDir ? join(normDesktopDir, 'NaiPromptManager.bat') : '';
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
 * 在桌面生成或更新启动器脚本与快捷方式
 * @param {object} options
 * @param {string} [options.projectDir]
 * @param {string} [options.desktopDir]
 * @param {boolean} [options.createShortcut=true]
 * @param {boolean} [options.hideBat=false]
 * @returns {Promise<object>}
 */
export async function createDesktopLauncher({
  projectDir = process.cwd(),
  desktopDir = getDesktopDir(),
  createShortcut = true,
  hideBat = false,
} = {}) {
  const status = getDesktopLauncherStatus({ projectDir, desktopDir });
  if (!status.desktopExists) {
    const error = new Error(`桌面目录不存在或无法访问: ${status.desktopDir}`);
    error.status = 400;
    throw error;
  }

  // 如果目标脚本已存在，先移除可能的隐藏与只读属性，避免 writeFile 出现 EPERM
  if (IS_WINDOWS && existsSync(status.batPath)) {
    try {
      execSync(`attrib -h -r "${status.batPath}"`, { stdio: 'ignore', timeout: 3000 });
    } catch {
      // 忽略属性修改失败
    }
  }

  const batContent = generateLauncherBatContent({ projectDir: status.projectDir });
  await writeFile(status.batPath, batContent, 'utf8');

  // 如果在 Windows 下，处理隐藏属性和快捷方式生成
  if (IS_WINDOWS) {
    if (hideBat) {
      try {
        execSync(`attrib +h "${status.batPath}"`, { stdio: 'ignore', timeout: 3000 });
      } catch {
        // 忽略属性修改失败
      }
    }

    if (createShortcut) {
      try {
        const psScript = [
          '$wsh = New-Object -ComObject WScript.Shell;',
          `$s = $wsh.CreateShortcut('${status.shortcutPath.replace(/'/g, "''")}');`,
          `$s.TargetPath = '${status.batPath.replace(/'/g, "''")}';`,
          `$s.WorkingDirectory = '${status.projectDir.replace(/'/g, "''")}';`,
          `if (Test-Path '${status.iconPath.replace(/'/g, "''")}') { $s.IconLocation = '${status.iconPath.replace(/'/g, "''")},0' };`,
          '$s.Description = "NAI Atelier Launcher";',
          '$s.Save();',
          '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) | Out-Null;',
        ].join(' ');

        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch (err) {
        // 如果创建 lnk 失败，不中断主流程，返回提示
        return {
          success: true,
          batCreated: true,
          shortcutCreated: false,
          batPath: status.batPath,
          shortcutPath: status.shortcutPath,
          message: '启动脚本创建成功，但快捷方式生成失败: ' + (err?.message || '未知异常'),
        };
      }
    }
  }

  return {
    success: true,
    batCreated: true,
    shortcutCreated: Boolean(createShortcut && IS_WINDOWS),
    batPath: status.batPath,
    shortcutPath: createShortcut && IS_WINDOWS ? status.shortcutPath : null,
    message: createShortcut && IS_WINDOWS
      ? '桌面启动脚本与专属图标快捷方式已成功创建/更新'
      : '桌面启动脚本已成功创建/更新',
  };
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
