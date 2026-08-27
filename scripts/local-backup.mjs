import { spawn, execFile as nodeExecFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);
const IS_WINDOWS = platform() === 'win32';

/** 默认备份路径 */
export const DEFAULT_BACKUP_DIR = IS_WINDOWS ? 'D:\\NaiPromptManager-Backups' : resolve(process.cwd(), '..', 'NaiPromptManager-Backups');
const BACKUP_CONFIG_FILE = join(process.cwd(), 'local-data', 'backup-config.json');

/**
 * 格式化时间戳为 YYYYMMDD-HHmmss
 * @param {Date} date
 */
export function formatBackupTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

/**
 * 解析目录名或文件名中的时间
 * @param {string} name
 * @param {Date} fallbackDate
 */
export function parseBackupNameDate(name, fallbackDate = new Date()) {
  // 匹配 20260827-211945
  const m1 = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m1) {
    const [, y, m, d, hh, mm, ss] = m1;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  // 匹配 2026-06-27-041244
  const m2 = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m2) {
    const [, y, m, d, hh, mm, ss] = m2;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  // 匹配 2026-08-20
  const m3 = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m3) {
    const [, y, m, d] = m3;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallbackDate.toISOString();
}

/**
 * 读取备份配置
 */
export async function getBackupConfig() {
  try {
    const content = await readFile(BACKUP_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.targetDir === 'string' && parsed.targetDir.trim()) {
      return {
        targetDir: normalize(parsed.targetDir.trim()),
      };
    }
  } catch {
    // 默认值
  }
  return {
    targetDir: DEFAULT_BACKUP_DIR,
  };
}

/**
 * 保存备份配置
 * @param {{ targetDir: string }} config
 */
export async function saveBackupConfig(config) {
  const targetDir = String(config?.targetDir || '').trim();
  if (!targetDir) throw new Error('备份目标目录不能为空');
  if (!isAbsolute(targetDir)) throw new Error('备份目标目录必须为绝对路径');

  const normalized = normalize(targetDir);
  const localDataDir = normalize(join(process.cwd(), 'local-data'));
  if (normalized === localDataDir || normalized.startsWith(localDataDir + '\\') || normalized.startsWith(localDataDir + '/')) {
    throw new Error('备份目标目录不能设置在 local-data 保护区内部');
  }

  await mkdir(dirname(BACKUP_CONFIG_FILE), { recursive: true });
  await writeFile(BACKUP_CONFIG_FILE, JSON.stringify({ targetDir: normalized }, null, 2), 'utf8');
  return { targetDir: normalized };
}

/**
 * 递归收集目录下的所有文件信息
 * @param {string} dir
 * @param {string} baseDir
 * @returns {Promise<Array<{ absolutePath: string, relativePath: string, size: number }>>}
 */
export async function collectFilesRecursive(dir, baseDir = dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFilesRecursive(fullPath, baseDir);
      results.push(...sub);
    } else if (entry.isFile()) {
      try {
        const fileStat = await stat(fullPath);
        results.push({
          absolutePath: fullPath,
          relativePath: relative(baseDir, fullPath),
          size: fileStat.size,
        });
      } catch {
        // 忽略无法读取的文件
      }
    }
  }
  return results;
}

/**
 * 快速扫描目录大小和文件数
 * @param {string} dir
 * @returns {Promise<{ fileCount: number, totalBytes: number }>}
 */
export async function scanDirStats(dir) {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(currentDir) {
    if (!existsSync(currentDir)) return;
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const fileStat = await stat(fullPath);
            fileCount += 1;
            totalBytes += fileStat.size;
          } catch {}
        }
      }
    } catch {}
  }

  await walk(dir);
  return { fileCount, totalBytes };
}

/**
 * 扫描历史备份列表
 * @param {string} targetDir
 * @returns {Promise<Array<object>>}
 */
export async function listBackups(targetDir) {
  if (!targetDir || !existsSync(targetDir)) return [];

  const items = [];
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(targetDir, entry.name);
      try {
        const fileStat = await stat(fullPath);
        if (entry.isDirectory()) {
          const metadataPath = join(fullPath, 'backup-metadata.json');
          const hasMetadata = existsSync(metadataPath);
          let metadata = null;
          if (hasMetadata) {
            try {
              metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
            } catch {}
          }

          const hasLocalData = existsSync(join(fullPath, 'local-data'));
          let fileCount = metadata?.fileCount || 0;
          let totalBytes = metadata?.totalBytes || 0;

          // 若无元数据且是 local-data 备份，做轻量统计（或已记录）
          if (!metadata) {
            const stats = await scanDirStats(fullPath);
            fileCount = stats.fileCount;
            totalBytes = stats.totalBytes;
          }

          items.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            hasLocalData,
            createdAt: metadata?.createdAt || parseBackupNameDate(entry.name, fileStat.birthtime || fileStat.mtime),
            mtime: fileStat.mtime.toISOString(),
            fileCount,
            totalBytes,
            label: metadata?.label || '',
            appVersion: metadata?.appVersion || '',
          });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
          items.push({
            name: entry.name,
            path: fullPath,
            type: 'zip',
            hasLocalData: true,
            createdAt: parseBackupNameDate(entry.name, fileStat.birthtime || fileStat.mtime),
            mtime: fileStat.mtime.toISOString(),
            fileCount: 0,
            totalBytes: fileStat.size,
            label: '',
            appVersion: '',
          });
        }
      } catch {
        // 忽略单项读取失败
      }
    }
  } catch {
    return [];
  }

  // 按创建时间倒序排列
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

/**
 * 唤起系统资源管理器打开指定路径
 * @param {string} targetPath
 */
export async function openInExplorer(targetPath) {
  if (!targetPath || !existsSync(targetPath)) {
    throw new Error('目标路径不存在');
  }

  const normalized = normalize(targetPath);
  if (IS_WINDOWS) {
    // Windows 下使用 explorer
    spawn('explorer.exe', [normalized], { detached: true, stdio: 'ignore' }).unref();
    return { success: true, platform: 'win32', path: normalized };
  }
  if (platform() === 'darwin') {
    spawn('open', [normalized], { detached: true, stdio: 'ignore' }).unref();
    return { success: true, platform: 'darwin', path: normalized };
  }
  spawn('xdg-open', [normalized], { detached: true, stdio: 'ignore' }).unref();
  return { success: true, platform: 'linux', path: normalized };
}

/**
 * 本地数据备份管理器单例
 */
export class LocalBackupService {
  constructor({ sourceDir = join(process.cwd(), 'local-data') } = {}) {
    this.sourceDir = normalize(sourceDir);
    this.status = {
      running: false,
      phase: 'idle', // 'idle' | 'scanning' | 'copying' | 'completed' | 'error'
      startedAt: null,
      finishedAt: null,
      error: null,
      progress: {
        copiedFiles: 0,
        totalFiles: 0,
        copiedBytes: 0,
        totalBytes: 0,
        currentItem: '',
        percent: 0,
      },
      currentBackup: null,
      lastBackup: null,
    };
  }

  /**
   * 获取当前备份服务综合状态
   */
  async getStatus() {
    const config = await getBackupConfig();
    const targetDir = config.targetDir;
    const targetDirExists = existsSync(targetDir);

    let backups = [];
    if (targetDirExists) {
      backups = await listBackups(targetDir);
    }

    // 获取当前 local-data 统计（若不在运行中，做一次轻量读取）
    let sourceStats = null;
    if (!this.status.running && existsSync(this.sourceDir)) {
      sourceStats = await scanDirStats(this.sourceDir);
    }

    return {
      ...this.status,
      targetDir,
      targetDirExists,
      sourceDir: this.sourceDir,
      sourceStats: sourceStats || {
        fileCount: this.status.progress.totalFiles,
        totalBytes: this.status.progress.totalBytes,
      },
      backups,
    };
  }

  /**
   * 启动一次数据备份任务
   * @param {object} options
   * @param {string} [options.label] - 备份备注
   * @param {string} [options.targetDir] - 自定义目标目录
   * @param {string} [options.appVersion] - 应用版本号
   */
  async startBackup({ label = '', targetDir = '', appVersion = '' } = {}) {
    if (this.status.running) {
      const error = new Error('已有备份任务正在进行中');
      error.status = 409;
      throw error;
    }

    if (!existsSync(this.sourceDir)) {
      const error = new Error(`源数据目录不存在: ${this.sourceDir}`);
      error.status = 404;
      throw error;
    }

    const config = await getBackupConfig();
    const destinationDir = normalize((targetDir || config.targetDir).trim());
    if (!isAbsolute(destinationDir)) {
      const error = new Error('备份目标目录必须为绝对路径');
      error.status = 400;
      throw error;
    }

    // 防止目标在 sourceDir 内部
    if (destinationDir === this.sourceDir || destinationDir.startsWith(this.sourceDir + '\\') || destinationDir.startsWith(this.sourceDir + '/')) {
      const error = new Error('备份目标目录不能设置在 local-data 内部');
      error.status = 400;
      throw error;
    }

    const trimmedLabel = String(label || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    const timestamp = formatBackupTimestamp();
    const folderName = trimmedLabel ? `${timestamp}-${trimmedLabel}` : timestamp;
    const backupFolderPath = join(destinationDir, folderName);
    const backupLocalDataPath = join(backupFolderPath, 'local-data');

    // 初始化状态
    this.status = {
      running: true,
      phase: 'scanning',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      progress: {
        copiedFiles: 0,
        totalFiles: 0,
        copiedBytes: 0,
        totalBytes: 0,
        currentItem: '正在扫描待备份文件...',
        percent: 0,
      },
      currentBackup: {
        name: folderName,
        path: backupFolderPath,
        label: trimmedLabel,
        createdAt: new Date().toISOString(),
        appVersion,
      },
      lastBackup: this.status.lastBackup,
    };

    // 异步执行，不阻塞当前 HTTP 响应
    this._runBackupTask({ backupFolderPath, backupLocalDataPath, folderName, trimmedLabel, appVersion }).catch(err => {
      console.error('[Backup] 执行异常:', err);
    });

    return {
      status: 'started',
      backup: this.status.currentBackup,
    };
  }

  /**
   * 后台执行备份的核心流程
   * @private
   */
  async _runBackupTask({ backupFolderPath, backupLocalDataPath, folderName, trimmedLabel, appVersion }) {
    try {
      // 1. 扫描源目录中的所有文件
      const files = await collectFilesRecursive(this.sourceDir);
      const totalFiles = files.length;
      const totalBytes = files.reduce((acc, cur) => acc + cur.size, 0);

      this.status.progress.totalFiles = totalFiles;
      this.status.progress.totalBytes = totalBytes;
      this.status.phase = 'copying';

      // 2. 创建目标目录
      await mkdir(backupLocalDataPath, { recursive: true });

      // 3. 递归复制每个文件
      let copiedFiles = 0;
      let copiedBytes = 0;

      for (const file of files) {
        const destFile = join(backupLocalDataPath, file.relativePath);
        const destDir = dirname(destFile);

        await mkdir(destDir, { recursive: true });
        await copyFile(file.absolutePath, destFile);

        copiedFiles += 1;
        copiedBytes += file.size;

        this.status.progress.copiedFiles = copiedFiles;
        this.status.progress.copiedBytes = copiedBytes;
        this.status.progress.currentItem = file.relativePath;
        this.status.progress.percent = totalBytes > 0 ? Math.min(100, Math.round((copiedBytes / totalBytes) * 100)) : 100;
      }

      // 4. 写入元数据
      const metadata = {
        createdAt: new Date().toISOString(),
        folderName,
        label: trimmedLabel,
        appVersion,
        fileCount: totalFiles,
        totalBytes,
        sourceDir: this.sourceDir,
      };
      await writeFile(join(backupFolderPath, 'backup-metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

      // 5. 完成
      const finishedAt = new Date().toISOString();
      this.status.running = false;
      this.status.phase = 'completed';
      this.status.finishedAt = finishedAt;
      this.status.lastBackup = {
        ...this.status.currentBackup,
        fileCount: totalFiles,
        totalBytes,
        finishedAt,
      };
      this.status.progress.percent = 100;
      this.status.progress.currentItem = '备份完成';
    } catch (error) {
      this.status.running = false;
      this.status.phase = 'error';
      this.status.error = error instanceof Error ? error.message : '备份过程中发生未知错误';
      this.status.finishedAt = new Date().toISOString();
      this.status.progress.currentItem = `备份失败: ${this.status.error}`;
      // 出现严重错误时，尝试清理未完成的临时目录
      try {
        if (existsSync(backupFolderPath)) {
          await rm(backupFolderPath, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}

export const localBackupService = new LocalBackupService();
