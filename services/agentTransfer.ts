import { createUuid } from './id';

/** 仅保存当前标签页主动操作产生的图片与导出，不监听系统剪贴板。 */
const exports = new Map<string, { blob: Blob; name: string } | { name: string; bytes: number; mimeType: string; error: string }>();
let exportCaptureDepth = 0;
let capturedBlobs = new WeakSet<Blob>();
let copied: { blob: Blob; name: string; label: string } | null = null;
export const getAgentExports = () => [...exports].map(([id, item]) => ({ id, name: item.name, ...('blob' in item ? { bytes: item.blob.size, mimeType: item.blob.type, available: true } : { bytes: item.bytes, mimeType: item.mimeType, available: false, error: item.error }) }));
export const getAgentExport = (id: string) => { const item = exports.get(id); if (!item) throw new Error('导出副本已过期，请重新执行导出'); if (!('blob' in item)) throw new Error(item.error); return item; };
export const getAgentCopiedImage = () => { if (!copied) throw new Error('还没有暂存图片，请先读取并暂存实际图片'); return copied; };
export const captureAgentExport = (blob: Blob, name: string) => {
  if (!exportCaptureDepth || capturedBlobs.has(blob)) return;
  capturedBlobs.add(blob);
  // 局域网 HTTP 可能缺少 crypto.randomUUID，沿用 createUuid 回退。
  exports.set(createUuid(), blob.size > 30 * 1024 * 1024
    ? { name, bytes: blob.size, mimeType: blob.type, error: '导出文件超过助手 30 MB 暂存上限，无法通过助手另存；请核对页面原有导出结果，不能据此确认指定目录已保存' }
    : { blob, name });
  while (exports.size > 4) exports.delete(exports.keys().next().value!);
  window.dispatchEvent(new Event('nai-agent-capabilities-changed'));
};
export const copyAgentImage = async (image: HTMLImageElement, signal?: AbortSignal) => {
  const src = new URL(image.dataset.agentOriginalSrc || image.currentSrc || image.src, location.href).href;
  if (!image.complete || !image.naturalWidth || !/^(https?:|blob:|data:image\/)/.test(src)) throw new Error('当前图片尚未准备好');
  const response = await fetch(src, { signal, credentials: src.startsWith(location.origin + '/') ? 'same-origin' : 'omit' });
  if (!response.ok) throw new Error('读取当前原图失败');
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > 30 * 1024 * 1024) throw new Error('只接受 30 MB 以内的实际图片');
  const suffix = blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1];
  copied = { blob, name: `nai-image.${suffix}`, label: image.alt || '当前图片' };
  return { copied: true, label: copied.label, bytes: blob.size, destination: '当前工坊标签页的图片暂存，可粘贴到任意图片上传入口' };
};
/** 临时捕获 Agent 触发的实际下载产物，不改变用户的正常浏览器下载。 */
export const captureAgentExports = () => {
  if (!exportCaptureDepth++) capturedBlobs = new WeakSet<Blob>();
  const blobs = new Map<string, Blob>(), create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { const url = create.call(URL, blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function () {
    const blob = blobs.get(this.href);
    if (this.download && blob) {
      captureAgentExport(blob, this.download);
    }
    click.call(this);
  };
  return () => { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; blobs.clear(); exportCaptureDepth--; };
};
