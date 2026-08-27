export interface BackupRecord {
  name: string;
  path: string;
  type: 'directory' | 'zip';
  hasLocalData: boolean;
  createdAt: string;
  mtime: string;
  fileCount: number;
  totalBytes: number;
  label?: string;
  appVersion?: string;
}

export interface BackupProgress {
  copiedFiles: number;
  totalFiles: number;
  copiedBytes: number;
  totalBytes: number;
  currentItem: string;
  percent: number;
}

export interface BackupStatus {
  running: boolean;
  phase: 'idle' | 'scanning' | 'copying' | 'completed' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  progress: BackupProgress;
  targetDir: string;
  targetDirExists: boolean;
  sourceDir: string;
  sourceStats: {
    fileCount: number;
    totalBytes: number;
  };
  currentBackup: {
    name: string;
    path: string;
    label: string;
    createdAt: string;
    appVersion: string;
  } | null;
  lastBackup: (BackupRecord & { finishedAt?: string }) | null;
  backups: BackupRecord[];
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : (val >= 100 ? 0 : 1))} ${units[i]}`;
}

/**
 * 格式化备份日期时间
 */
export function formatBackupDate(iso: string | null | undefined): string {
  if (!iso) return '未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * 获取本地备份状态
 */
export async function getLocalBackupStatus(): Promise<BackupStatus> {
  const response = await fetch('/api/local-maintenance/backup/status', { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '无法读取备份状态');
  }
  return data as BackupStatus;
}

/**
 * 启动数据备份任务
 */
export async function startLocalBackup(options: { label?: string; targetDir?: string; appVersion?: string } = {}): Promise<{ status: string; backup: any }> {
  const response = await fetch('/api/local-maintenance/backup/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '启动数据备份失败');
  }
  return data;
}

/**
 * 保存备份目标目录配置
 */
export async function saveLocalBackupConfig(config: { targetDir: string }): Promise<{ targetDir: string }> {
  const response = await fetch('/api/local-maintenance/backup/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '保存备份目标目录失败');
  }
  return data;
}

/**
 * 在系统文件资源管理器中打开指定目录
 */
export async function openLocalBackupFolder(targetPath?: string): Promise<{ success: boolean; path: string }> {
  const response = await fetch('/api/local-maintenance/backup/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '无法在文件管理器中打开目录');
  }
  return data;
}
