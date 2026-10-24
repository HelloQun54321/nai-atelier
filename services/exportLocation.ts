import { isAndroidApp } from './platform';
import { captureAgentExport } from './agentTransfer';
import { openStorageDirectory } from './storageLocations';

export type ExportMode = 'system' | 'directory' | 'ask';
export interface ExportLocation {
  mode: ExportMode;
  directory: string;
  canPickDirectory: boolean;
  canAsk: boolean;
  platform: 'desktop' | 'local' | 'browser' | 'android';
  systemDirectory?: string;
}
export interface ExportReceipt { saved: boolean; cancelled: boolean; path?: string; filename?: string; browserDownload?: boolean }
interface DirectoryHandle {
  name: string;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<{ createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
  removeEntry(name: string): Promise<void>;
}
declare global {
  interface Window {
    atelierExports?: { save(options: { data: string; filename: string }): Promise<ExportReceipt> };
  }
}
const API = '/api/local-maintenance/export-location';
const MODE_KEY = 'nai_export_mode';
const DIRECTORY_KEY = 'nai_export_directory';
const picker = () => (window as unknown as { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandle> }).showDirectoryPicker;
const isLocal = () => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const browserMode = (): ExportMode => {
  const mode = localStorage.getItem(MODE_KEY);
  return mode === 'directory' || mode === 'ask' ? mode : 'system';
};
async function directoryStore(value?: DirectoryHandle | null) {
  return new Promise<DirectoryHandle | undefined>((resolve, reject) => {
    const opening = indexedDB.open('nai-export-directory', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('directory');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction('directory', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('directory');
      const request = value === undefined ? store.get('default') : value === null ? store.delete('default') : store.put(value, 'default');
      transaction.oncomplete = () => { db.close(); resolve(value === undefined ? request.result : value || undefined); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = transaction.onerror;
    };
  });
}
async function localRequest(body?: Record<string, unknown>): Promise<ExportLocation & ExportReceipt> {
  const controller = new AbortController();
  const timeout = body?.action === 'pick' || body?.action === 'save' ? 310_000 : 15_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(API, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify(body) } : { cache: 'no-store' }), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `导出设置读取失败 (${response.status})`);
    return { ...result, platform: window.atelierExports ? 'desktop' : result.platform };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(body?.action === 'pick' ? '文件夹选择等待超时，请重新选择文件夹' : '导出设置请求超时，请重试');
    throw error;
  } finally { clearTimeout(timer); }
}
const browserState = (): ExportLocation => ({ mode: browserMode(), directory: localStorage.getItem(DIRECTORY_KEY) || '', canPickDirectory: Boolean(picker()), canAsk: Boolean(picker()), platform: 'browser' });
export async function getExportLocation(): Promise<ExportLocation> {
  if (isAndroidApp()) { const { native } = await import('../mobile/native'); return await native.exportLocation({ action: 'status' }) as unknown as ExportLocation; }
  if (isLocal()) return localRequest();
  return browserState();
}
/** 打开真实写入位置；浏览器目录句柄的显示名称不能当作电脑路径。 */
export async function openExportDirectory(receipt?: ExportReceipt): Promise<void> {
  if (isAndroidApp() || !isLocal()) throw new Error('当前设备不支持打开导出文件夹');
  const absolute = (path: string) => !/[\x00-\x1f]/.test(path) && /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)|\/)/.test(path);
  let directory = '';
  if (receipt?.saved && !receipt.cancelled && !receipt.browserDownload && receipt.path && absolute(receipt.path)) {
    const index = Math.max(receipt.path.lastIndexOf('/'), receipt.path.lastIndexOf('\\'));
    if (index < receipt.path.length - 1) directory = receipt.path.slice(0, index === 0 ? 1 : /^[A-Za-z]:[\\/]/.test(receipt.path) && index === 2 ? 3 : index);
  }
  if (!directory && !receipt?.browserDownload) {
    const state = await getExportLocation();
    const path = state.mode === 'directory' ? state.directory : state.mode === 'system' ? state.systemDirectory : '';
    if (path && absolute(path)) directory = path;
  }
  if (!directory) throw new Error('当前浏览器无法确定下载目录，请在浏览器下载记录中选择「在文件夹中显示」');
  if (!(await openStorageDirectory(directory)).success) throw new Error('导出文件夹未打开');
}
export async function setExportMode(mode: ExportMode): Promise<ExportLocation> {
  if (isAndroidApp()) { const { native } = await import('../mobile/native'); return await native.exportLocation({ action: 'mode', mode }) as unknown as ExportLocation; }
  if (isLocal()) return localRequest({ action: 'mode', mode });
  if (mode !== 'system' && !picker()) throw new Error('当前浏览器由下载设置决定保存位置');
  if (mode === 'directory' && !localStorage.getItem(DIRECTORY_KEY)) throw new Error('请先选择导出目录');
  localStorage.setItem(MODE_KEY, mode);
  return browserState();
}
export async function pickExportDirectory(): Promise<ExportLocation | null> {
  // 浏览器选择器必须直接发生在用户点击中，不能先等待读取偏好或网络。
  if (!isAndroidApp() && !isLocal()) {
    const choose = picker();
    if (!choose) throw new Error('当前浏览器由下载设置决定保存位置');
    try {
      const handle = await choose.call(window, { mode: 'readwrite', id: 'nai-exports' });
      await directoryStore(handle);
      localStorage.setItem(DIRECTORY_KEY, handle.name);
      localStorage.setItem(MODE_KEY, 'directory');
      return browserState();
    } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return null; throw error; }
  }
  if (isAndroidApp()) { const { native } = await import('../mobile/native'); const result = await native.exportLocation({ action: 'pick' }); return result.cancelled ? null : result as unknown as ExportLocation; }
  const result = await localRequest({ action: 'pick' });
  return result.cancelled ? null : result;
}
export async function clearExportDirectory(): Promise<ExportLocation> {
  if (isAndroidApp()) { const { native } = await import('../mobile/native'); return await native.exportLocation({ action: 'clear' }) as unknown as ExportLocation; }
  if (isLocal()) return localRequest({ action: 'clear' });
  await directoryStore(null);
  localStorage.removeItem(DIRECTORY_KEY); localStorage.removeItem(MODE_KEY);
  return browserState();
}

/** 提前请求浏览器目录权限，使图片异步清洗不会丢失本次点击授权。 */
export function beginExportTarget(): Promise<DirectoryHandle | undefined> | undefined {
  if (isAndroidApp() || isLocal() || browserMode() === 'system') return;
  const mode = browserMode();
  const choose = picker();
  if (!choose) throw new Error('当前浏览器由下载设置决定保存位置');
  if (mode === 'ask' && choose) {
    const pending = choose.call(window, { mode: 'readwrite', id: 'nai-exports' });
    void pending.catch(() => {});
    return pending;
  }
  if (mode === 'directory') {
    const authorize = (handle: DirectoryHandle | undefined) => {
      if (!handle) throw new Error('导出目录权限已失效，请重新选择目录');
      return handle.requestPermission({ mode: 'readwrite' }).then(permission => {
        if (permission !== 'granted') throw new Error('导出目录写入权限未允许，请重新选择目录');
        return handle;
      });
    };
    const pending = directoryStore().then(authorize);
    void pending.catch(() => {});
    return pending;
  }
}
async function saveToBrowserDirectory(handle: DirectoryHandle, blob: Blob, filename: string): Promise<ExportReceipt> {
  const extension = filename.match(/\.[^.]+$/)?.[0] || '', stem = filename.slice(0, filename.length - extension.length);
  for (let index = 0; index < 10000; index++) {
    const name = index ? `${stem} (${index})${extension}` : filename;
    try { await handle.getFileHandle(name); continue; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'TypeMismatchError') continue;
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
    }
    const file = await handle.getFileHandle(name, { create: true });
    let writable: Awaited<ReturnType<typeof file.createWritable>> | undefined;
    try { writable = await file.createWritable(); await writable.write(blob); await writable.close(); }
    catch (error) { await writable?.abort().catch(() => {}); await handle.removeEntry(name).catch(() => {}); throw error; }
    return { saved: true, cancelled: false, filename: name, path: `${handle.name}/${name}` };
  }
  throw new Error('导出目录中的同名文件过多');
}
const blobBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
export async function saveExportBlob(blob: Blob, filename: string, target = beginExportTarget()): Promise<ExportReceipt> {
  if (blob.size > 2 * 1024 * 1024 * 1024) throw new Error('导出文件超过 2 GiB 上限');
  if (isAndroidApp()) {
    const { native, writeBlob } = await import('../mobile/native');
    const path = `transfer/${crypto.randomUUID()}`;
    try {
      await writeBlob(blob, path);
      await native.saveFile({ path, filename, mime: blob.type.split(';')[0] || 'application/octet-stream', removeAfterSave: true });
    } catch (error) {
      if (error instanceof Error && error.message === '已取消保存') throw new DOMException('已取消保存', 'AbortError');
      throw error;
    } finally { await native.file({ action: 'delete', path, cache: true }).catch(() => {}); }
    captureAgentExport(blob, filename);
    return { saved: true, cancelled: false };
  }
  let result: ExportReceipt | undefined;
  if (isLocal() && blob.size > 32 * 1024 * 1024) {
    const state = await getExportLocation();
    if (state.mode !== 'system' || state.systemDirectory) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 310_000);
      try {
        const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-nai-local-control': 'true', 'x-nai-export-filename': encodeURIComponent(filename), 'x-nai-export-size': String(blob.size) }, body: blob, signal: controller.signal });
        result = await response.json();
        if (!response.ok) throw new Error((result as ExportReceipt & { error?: string }).error || `导出文件保存失败 (${response.status})`);
      } catch (error) { if (controller.signal.aborted) throw new Error('导出文件传输超时，请重试'); throw error; }
      finally { clearTimeout(timer); }
    }
  }
  else if (window.atelierExports) result = await window.atelierExports.save({ data: await blobBase64(blob), filename });
  else if (isLocal()) {
    const state = await getExportLocation();
    if (state.mode !== 'system') result = await localRequest({ action: 'save', data: await blobBase64(blob), filename });
  } else if (browserMode() !== 'system') {
    const handle = target ? await target : await directoryStore();
    if (!handle || await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('导出目录权限已失效，请重新选择目录');
    const write = () => saveToBrowserDirectory(handle, blob, filename);
    result = navigator.locks ? await navigator.locks.request('nai-export-directory-write', write) : await write();
  }
  if (result?.cancelled) throw new DOMException('已取消保存', 'AbortError');
  if (result && !result.browserDownload) {
    if (!result.saved) throw new Error('导出文件未写入');
    captureAgentExport(blob, result.filename || filename);
    return result;
  }
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  captureAgentExport(blob, filename);
  return { saved: false, cancelled: false, browserDownload: true };
}
