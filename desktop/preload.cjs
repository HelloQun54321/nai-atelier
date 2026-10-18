// 沙盒页面只接收固定操作；主进程核对窗口、主帧与来源，不开放 Node 或任意 IPC。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atelierExports', { save: input => ipcRenderer.invoke('atelier-export', input) });
contextBridge.exposeInMainWorld('atelierLanguage', {
  initial: process.argv.find(value => value.startsWith('--atelier-language='))?.split('=')[1] || 'zh-CN',
  set: value => ipcRenderer.invoke('atelier-language', value),
});
contextBridge.exposeInMainWorld('atelierDesktop', {
  status: () => ipcRenderer.invoke('atelier-desktop', 'status'),
  retry: () => ipcRenderer.invoke('atelier-desktop', 'retry'),
  logs: () => ipcRenderer.invoke('atelier-desktop', 'logs'),
  quit: () => ipcRenderer.invoke('atelier-desktop', 'quit'),
  onStatus: callback => ipcRenderer.on('atelier-status', (_event, status) => callback(status)),
});
// 桌面外壳：平台标识（标题栏与快捷键提示）、菜单命令（设置、查找）和程序坞／任务栏进度。
contextBridge.exposeInMainWorld('atelierShell', {
  platform: process.platform,
  setProgress: value => ipcRenderer.invoke('atelier-progress', value),
  setTheme: mode => ipcRenderer.invoke('atelier-theme', mode),
  onCommand: callback => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('atelier-command', listener);
    return () => ipcRenderer.removeListener('atelier-command', listener);
  },
});
// macOS 版未签名，不提供应用内安装，设置页改走网页检查与下载页。
if (process.platform === 'win32') contextBridge.exposeInMainWorld('atelierUpdate', {
  status: () => ipcRenderer.invoke('atelier-update', 'status'),
  check: () => ipcRenderer.invoke('atelier-update', 'check'),
  download: () => ipcRenderer.invoke('atelier-update', 'download'),
  install: () => ipcRenderer.invoke('atelier-update', 'install'),
  channel: value => ipcRenderer.invoke('atelier-update', 'channel', value),
  releases: () => ipcRenderer.invoke('atelier-update', 'releases'),
  onStatus: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('atelier-update-status', listener);
    return () => ipcRenderer.removeListener('atelier-update-status', listener);
  },
});
