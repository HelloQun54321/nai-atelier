// 沙盒页面只接收固定操作；主进程核对窗口、主帧与来源，不开放 Node 或任意 IPC。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atelierExports', { save: input => ipcRenderer.invoke('atelier-export', input) });
contextBridge.exposeInMainWorld('atelierCanvasExport', {
  begin: (kind, filename) => ipcRenderer.invoke('atelier-canvas-export-begin', kind, filename),
  start: token => ipcRenderer.invoke('atelier-canvas-export-start', token),
  write: (token, data) => ipcRenderer.invoke('atelier-canvas-export-chunk', token, data),
  end: token => ipcRenderer.invoke('atelier-canvas-export-end', token),
  abort: token => ipcRenderer.invoke('atelier-canvas-export-abort', token),
});
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
contextBridge.exposeInMainWorld('atelierUpdate', {
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
