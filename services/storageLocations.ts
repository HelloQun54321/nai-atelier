import { api, parseErrorResponse } from './api';

export interface StorageLocationStatus {
  available: boolean;
  mode: 'desktop' | 'source';
  canManage: boolean;
  dataDir: string;
  workspaceDir: string;
  cacheDir: string;
  cacheFollowsData: boolean;
  resourcePaths: { thumbnails: string; danbooru: string; models: string; tagData: string; artistSamples?: string; artistReference?: string };
  state: { phase: string; error?: string; copiedBytes?: number; totalBytes?: number };
}
export const getStorageLocationStatus = (): Promise<StorageLocationStatus> => api.get('/local-maintenance/storage');
const action = async <T,>(body: { action: string; [key: string]: unknown }): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body.action === 'pickDirectory' ? 310_000 : 15_000);
  try {
    const response = await fetch('/api/local-maintenance/storage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nai-local-control': 'true' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw await parseErrorResponse(response);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error(['switchData', 'setCacheDir'].includes(body.action) ? '存储切换请求超时，请检查实际状态后再操作；未自动重试或取消迁移' : body.action === 'pickDirectory' ? '文件夹选择等待超时，请重新选择文件夹' : '存储设置请求超时，请重试');
    throw error;
  } finally { clearTimeout(timer); }
};
export const pickStorageDirectory = (kind: 'data' | 'cache' | 'backup' | 'export') => action<{ path: string; cancelled: boolean }>({ action: 'pickDirectory', kind });
export const openStorageDirectory = (path: string) => action<{ success: boolean }>({ action: 'openDirectory', path });
export const switchStorageDataDirectory = (directory: string, operation: 'migrate' | 'open') => action<{ restartRequired: boolean }>({ action: 'switchData', directory, operation });
export const setStorageCacheDirectory = (directory: string) => action<{ restartRequired: boolean }>({ action: 'setCacheDir', directory });
