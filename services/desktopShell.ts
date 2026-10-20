import { getActiveGenerationProgress, subscribeGenerationSeries } from './generationSeries';

export type DesktopShellCommand = 'preferences' | 'find' | 'fullscreen-enter' | 'fullscreen-leave';
export interface DesktopShellBridge {
  platform: string;
  setProgress: (value: number) => Promise<void>;
  setTheme?: (mode: 'light' | 'dark' | 'system') => Promise<void>;
  onCommand: (callback: (command: DesktopShellCommand) => void) => () => void;
}
declare global { interface Window { atelierShell?: DesktopShellBridge } }

export const desktopShell = () => (typeof window === 'undefined' ? undefined : window.atelierShell);
export const isMacDesktop = () => desktopShell()?.platform === 'darwin';

/** 程序坞／任务栏进度：开始即显示一小段，按已完成张数推进，全部结束后清除。 */
export const generationProgressValue = (progress: { current: number; total: number } | null) => progress ? Math.min(1, Math.max(0.02, progress.current / Math.max(1, progress.total))) : -1;

/** ⌘F：聚焦当前页面最靠上的可见搜索／筛选输入框；没有时不做任何事。 */
export const focusPageSearch = (root: ParentNode = document) => {
  const candidates = [...root.querySelectorAll<HTMLInputElement>('.app-workspace input[type="search"], .app-workspace input[type="text"][placeholder], .app-workspace input:not([type])[placeholder]')]
    .filter(input => !input.disabled && !input.readOnly && input.getClientRects().length > 0)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const target = candidates[0];
  if (!target) return false;
  target.focus();
  target.select();
  return true;
};

/** 桌面外壳初始化：标记 macOS 标题栏样式、同步全屏状态与生成进度；网页／手机访问无副作用。 */
export const installDesktopShell = () => {
  const shell = desktopShell();
  if (!shell) return () => {};
  const root = document.documentElement;
  if (shell.platform === 'darwin') root.classList.add('mac-titlebar');
  let last = -1;
  const sync = () => {
    const value = generationProgressValue(getActiveGenerationProgress());
    if (value === last) return;
    last = value;
    void shell.setProgress(value).catch(() => { /* 进度只是附加显示，失败不影响生成。 */ });
  };
  const unsubscribeSeries = subscribeGenerationSeries(sync);
  const unsubscribeCommand = shell.onCommand(command => {
    if (command === 'fullscreen-enter') root.classList.add('mac-fullscreen');
    if (command === 'fullscreen-leave') root.classList.remove('mac-fullscreen');
    if (command === 'find') focusPageSearch();
  });
  return () => { unsubscribeSeries(); unsubscribeCommand(); };
};
