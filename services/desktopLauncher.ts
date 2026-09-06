export interface DesktopLauncherStatus {
  supported: boolean;
  platform: string;
  projectDir: string;
  desktopDir: string;
  desktopExists: boolean;
  batPath: string;
  batExists: boolean;
  batMtime: string | null;
  shortcutPath: string;
  shortcutExists: boolean;
  shortcutMtime: string | null;
  iconPath: string;
  iconExists: boolean;
}

export interface CreateDesktopLauncherResult {
  success: boolean;
  batCreated: boolean;
  shortcutCreated: boolean;
  batPath: string;
  shortcutPath: string | null;
  message: string;
}

/**
 * 获取桌面启动器与快捷方式状态
 */
export async function getDesktopLauncherStatus(): Promise<DesktopLauncherStatus> {
  const response = await fetch('/api/local-maintenance/desktop-launcher/status', { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '无法读取桌面启动器状态');
  }
  return data as DesktopLauncherStatus;
}

/**
 * 在用户桌面创建或更新启动器与快捷方式
 */
export async function createDesktopLauncher(options: {
  createShortcut?: boolean;
  hideBat?: boolean;
} = {}): Promise<CreateDesktopLauncherResult> {
  const response = await fetch('/api/local-maintenance/desktop-launcher/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '创建桌面启动器失败');
  }
  return data as CreateDesktopLauncherResult;
}

/**
 * 在系统文件管理器中打开桌面文件夹
 */
export async function openDesktopFolder(): Promise<{ success: boolean; path: string }> {
  const response = await fetch('/api/local-maintenance/desktop-launcher/open-desktop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || '无法打开桌面目录');
  }
  return data;
}

/**
 * 获取启动脚本直接下载链接
 */
export function getLauncherDownloadUrl(): string {
  return '/api/local-maintenance/desktop-launcher/download';
}
