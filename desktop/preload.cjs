// 沙盒启动页只接收状态和三个固定操作，不向业务页面开放 Node 或任意 IPC。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atelierDesktop', {
  status: () => ipcRenderer.invoke('atelier-desktop', 'status'),
  retry: () => ipcRenderer.invoke('atelier-desktop', 'retry'),
  logs: () => ipcRenderer.invoke('atelier-desktop', 'logs'),
  quit: () => ipcRenderer.invoke('atelier-desktop', 'quit'),
  onStatus: callback => ipcRenderer.on('atelier-status', (_event, status) => callback(status)),
});
