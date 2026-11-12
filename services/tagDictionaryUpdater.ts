export type TagUpdatePhase = 'idle' | 'checking' | 'downloading' | 'generating' | 'building' | 'completed' | 'unchanged' | 'error';

export interface TagUpdateStatus {
  available: boolean;
  running: boolean;
  phase: TagUpdatePhase;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  manifest: {
    count: number;
    generatedAt: string | null;
    sourceLastModified: string | null;
  } | null;
}

const CONTROL_URL = '/api/tag-dictionary';
const IMPORT_URL = '/api/tag-dictionary/import';
/** 手动导入上限；与服务端和生成脚本一致，避免大文件在本地服务间反复缓冲。 */
export const TAG_IMPORT_MAX_BYTES = 256 * 1024 * 1024;

const request = async (method: 'GET' | 'POST'): Promise<TagUpdateStatus> => {
  const response = await fetch(CONTROL_URL, {
    method,
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Tag 更新服务请求失败：${response.status}`);
  return body as TagUpdateStatus;
};

export const getTagUpdateStatus = () => request('GET');
export const startTagUpdate = () => request('POST');

/**
 * 手动导入词库文件：内置下载线路不可用时，把用户自备的上游 tag.sqlite 交给本地服务生成。
 * 用 XHR 而不是 fetch 是为了拿到上传进度；收到回执后与在线更新共用同一套状态轮询。
 */
export const importTagDictionaryFile = (file: Blob, onProgress?: (percent: number) => void): Promise<TagUpdateStatus> => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', IMPORT_URL);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.upload.onprogress = event => {
    if (event.lengthComputable && event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
  };
  xhr.onload = () => {
    let body: (Partial<TagUpdateStatus> & { error?: string }) = {};
    try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* 非 JSON 响应按空对象处理，统一回退到状态码。 */ }
    if (xhr.status >= 200 && xhr.status < 300) resolve(body as TagUpdateStatus);
    else reject(new Error(body.error || `词库文件上传失败：${xhr.status}`));
  };
  xhr.onerror = () => reject(new Error('词库文件上传失败，请检查本地服务是否在运行'));
  xhr.onabort = () => reject(new Error('已取消导入词库文件'));
  xhr.ontimeout = () => reject(new Error('词库文件上传超时，请重试'));
  xhr.timeout = 300_000;
  xhr.send(file);
});
